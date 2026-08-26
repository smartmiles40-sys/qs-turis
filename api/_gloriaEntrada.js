// api/_gloriaEntrada.js
// -----------------------------------------------------------------------------
// LEAD NOVO CAINDO DIRETO NO ATENDIMENTO POR IA.
//
// Até aqui, colocar alguém no pipeline da Glória era trabalho de gente: abrir a
// tela Atendimento IA, procurar o lead pelo nome, clicar. Isso serve pra testar
// com cinco leads e não serve pra absolutamente nada com tráfego ligado —
// entram ~120 por dia.
//
// A ligação é a CADÊNCIA. O `lead-inbound` já sabe rotear por lista
// (`?lista=ia` → uma cadência), e a 0060 já definiu que "estar no atendimento
// por IA" é "ter a cadência de `execution_mode = 'ia'`". Então não é preciso
// conceito novo: se o destino é a cadência da IA, o lead é dela.
//
// Criar a porta de entrada nova:
//
//   1. qs_settings.webhook_listas  →  { "ia": "<uuid da cadência Atendimento IA>" }
//   2. a automação passa a postar em  /api/lead-inbound?lista=ia
//
// Nenhum deploy, e a lista antiga continua funcionando do lado — o que permite
// mandar SÓ uma campanha pra ela e comparar com o time. Trocar tudo de uma vez
// transforma "a IA converte melhor?" numa pergunta sem resposta.
//
// TRÊS COISAS QUE ESTE ARQUIVO SE RECUSA A FAZER:
//
//   • DERRUBAR A CRIAÇÃO DO LEAD. Tudo aqui é best-effort. Se a Glória estiver
//     desligada, sem modelo, no teto do dia ou o n8n fora do ar, o lead existe
//     do mesmo jeito, no lugar certo. Lead pago perdido não tem desfazer.
//   • ROUBAR LEAD QUE JÁ ESTÁ SENDO TRABALHADO. Lead deduplicado (já existia)
//     não é puxado pra IA: pode estar no meio de uma negociação com um humano,
//     e o dedupe não sabe disso. Quem quer mover alguém pra IA usa o quadro,
//     que é uma decisão consciente.
//   • DEIXAR LEAD INVISÍVEL. Ver a rede de segurança, no fim do arquivo.
// -----------------------------------------------------------------------------

import { rest, insert } from './_supabaseAdmin.js';
import { abordar } from './_abordagem.js';

/** Cache do id da cadência de IA (é uma por instalação, e ela não muda). */
let cacheCadencia; // undefined = não consultado ainda; null = não existe

async function cadenciaDaIA() {
  if (cacheCadencia !== undefined) return cacheCadencia;
  try {
    const rows = await rest(
      'qs_cadences?select=id&execution_mode=eq.ia&status=neq.congelada&order=created_at.asc&limit=1'
    );
    cacheCadencia = rows?.[0]?.id ?? null;
  } catch (e) {
    console.warn('[gloria-entrada] não consegui achar a cadência de IA:', e?.message);
    cacheCadencia = null;
  }
  return cacheCadencia;
}

/**
 * O lead acabou de ser criado. Ele é da Glória?
 *
 * Devolve `{ aplicavel: false }` quando não tem nada a ver com a IA — que é o
 * caso da esmagadora maioria das chamadas, e por isso é a primeira coisa
 * decidida, com uma consulta só e em cache.
 */
export async function entregarAGloria({ lead, cadenceId, ownerId = null, deduped = false }) {
  if (!lead?.id || !cadenceId) return { aplicavel: false };

  const cadIA = await cadenciaDaIA();
  if (!cadIA || String(cadenceId) !== String(cadIA)) return { aplicavel: false };

  // Daqui pra baixo o lead É da IA, então tudo que acontecer merece resposta
  // explícita: quem chamou está olhando um lead que ele mandou pra Glória.
  if (deduped) return { aplicavel: true, entrou: false, motivo: 'lead_ja_existia' };

  // O dono vem do gatilho de rodízio (0028) e pode ainda não estar na linha que
  // o insert devolveu. O `lead-inbound` já resolveu esse valor — usa o dele.
  const dono = ownerId ?? lead.owner_id ?? null;

  // (1) Entrar no pipeline. A RPC da 0060/0061 faz o pacote inteiro: troca a
  //     cadência, encerra as tarefas humanas que sobraram, abre a sessão com a
  //     etapa coerente e dá os 30 min de carência antes de a fila de toques
  //     julgar o silêncio dele.
  let entrada;
  try {
    entrada = await rest('rpc/qs_gloria_entrar_no_pipeline', {
      method: 'POST',
      body: { p_lead: lead.id },
    });
  } catch (e) {
    return { aplicavel: true, entrou: false, motivo: 'falha_ao_entrar', detalhe: e?.message };
  }

  const r = Array.isArray(entrada) ? entrada[0] : entrada;
  if (!r?.ok) return { aplicavel: true, entrou: false, motivo: r?.motivo || 'recusado' };

  // (2) Puxar assunto. Aqui mora o freio do dia, a escolha entre modelo
  //     aprovado e texto livre, e a recusa de abordar duas vezes — tudo em
  //     `_abordagem.js`.
  const abordagem = await abordar({ lead: { ...lead, owner_id: dono }, origem: 'entrada_automatica' });

  // (3) A REDE DE SEGURANÇA.
  //
  // Entrar no pipeline ENCERRA as tarefas humanas do lead. Se logo depois a
  // abordagem falhar, ninguém fica com tarefa nenhuma desse lead: ele aparece
  // só no quadro da IA — que ninguém olha de hora em hora — e em fila nenhuma.
  // Lead pago invisível é a pior coisa que este arquivo poderia produzir.
  //
  // O TETO DO DIA NÃO ENTRA AQUI. Ali a abordagem foi só ADIADA: o lead está no
  // quadro de propósito e sai amanhã, ou na mão pelo botão "falar". As outras
  // falhas são todas "ela não consegue falar", e essas viram tarefa de gente.
  if (!abordagem?.ok && abordagem?.motivo !== 'teto_do_dia') {
    await redeDeSeguranca({ ...lead, owner_id: dono }, abordagem);
  }

  return { aplicavel: true, entrou: true, abordagem };
}

/**
 * A Glória não conseguiu falar com um lead que acabou de entrar. Alguém tem que
 * falar — então nasce uma tarefa pro dono dele, AGORA, com o motivo por
 * extenso: "a IA falhou" não diz o que fazer; "falta escolher o modelo aprovado
 * do primeiro contato" diz.
 *
 * `is_extra` porque não faz parte do plano de nenhuma cadência: não pode contar
 * como o toque do dia nem empurrar os próximos. É a mesma escolha que
 * `devolverProTime` faz quando ela devolve a conversa.
 *
 * Best-effort de novo: se ISTO falhar, o lead continua existindo e o erro vai
 * pro log da função.
 */
async function redeDeSeguranca(lead, abordagem) {
  const PORQUE = {
    gloria_desligada: 'a Glória está desligada',
    sem_template_de_abertura: 'falta escolher o modelo aprovado do primeiro contato',
    template_incompleto: 'o modelo do primeiro contato pede um dado que este lead não tem',
    'modelo-nao-encontrado': 'o modelo do primeiro contato não está mais aprovado na Meta',
    'modelo-sem-corpo': 'o modelo do primeiro contato não tem corpo de texto',
    n8n_recusou: 'o n8n recusou — confira a credencial do webhook dela',
    envio_falhou: 'o WhatsApp recusou o envio',
    chatwoot_nao_configurado: 'o WhatsApp não está configurado',
    lead_sem_telefone: 'o lead não tem telefone',
  };

  const motivo = String(abordagem?.motivo || 'motivo desconhecido');
  const frase = PORQUE[motivo] || motivo;

  try {
    await insert('qs_tasks', {
      lead_id: lead.id,
      owner_id: lead.owner_id ?? null,
      channel_type: 'whatsapp',
      priority: 'alta',
      scheduled_at: new Date().toISOString(),
      status: 'pendente',
      is_extra: true,
      notes: `Lead novo do atendimento por IA, mas a Glória não conseguiu falar: ${frase}. Fale você.`.slice(0, 500),
      tags: ['gloria', 'abordagem_falhou'],
    }, { returning: false });
  } catch (e) {
    console.error('[gloria-entrada] nem a rede de segurança funcionou:', e?.message);
  }
}
