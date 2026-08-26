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
// (`?lista=trafego-ia` → uma cadência), e a 0060 já definiu que "estar no
// atendimento por IA" é "ter a cadência de `execution_mode = 'ia'`". Então não
// é preciso conceito novo: se o destino é a cadência da IA, o lead é dela.
//
// Criar uma porta de entrada nova pra IA:
//
//   1. qs_settings.webhook_listas  →  { "ia": "<uuid da cadência Atendimento IA>" }
//   2. a automação passa a postar em  /api/lead-inbound?lista=ia
//
// Nenhum deploy, e a lista antiga continua funcionando do lado — o que permite
// mandar SÓ uma campanha pra ela e comparar com o time.
//
// TRÊS COISAS QUE ESTE ARQUIVO SE RECUSA A FAZER:
//
//   • DERRUBAR A CRIAÇÃO DO LEAD. Tudo aqui é best-effort. Se a Glória estiver
//     desligada, sem template, no teto do dia ou o n8n fora do ar, o lead
//     existe do mesmo jeito, no lugar certo. Lead pago perdido não tem desfazer.
//   • ROUBAR LEAD QUE JÁ ESTÁ SENDO TRABALHADO. Lead deduplicado (já existia)
//     não é puxado pra IA: pode estar no meio de uma negociação com um humano.
//     Quem quer mover alguém pra IA usa o quadro, que é uma decisão consciente.
//   • ABORDAR SEM ENTRAR. A abordagem só sai depois da sessão existir e estar
//     ativa — senão a resposta do cliente chegaria numa conversa em que a IA
//     não está ligada, e morreria sem resposta.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { abordar } from './_abordagem.js';

/** Cache do id da cadência de IA (uma por instalação, e ela não muda). */
let cacheCadencia; // undefined = não consultado; null = não existe

async function cadenciaDaIA() {
  if (cacheCadencia !== undefined) return cacheCadencia;
  try {
    const rows = await rest(
      "qs_cadences?select=id&execution_mode=eq.ia&status=neq.congelada&order=created_at.asc&limit=1"
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
export async function entregarAGloria({ lead, cadenceId, deduped = false }) {
  if (!lead?.id || !cadenceId) return { aplicavel: false };

  const cadIA = await cadenciaDaIA();
  if (!cadIA || String(cadenceId) !== String(cadIA)) return { aplicavel: false };

  // Daqui pra baixo o lead É da IA, então tudo que acontecer merece resposta
  // explícita: quem chamou está olhando um lead que ele mandou pra Glória.
  if (deduped) {
    return { aplicavel: true, entrou: false, motivo: 'lead_ja_existia' };
  }

  // (1) Entrar no pipeline. A RPC da 0060/0061 faz o pacote inteiro: troca a
  //     cadência, encerra as tarefas humanas que sobraram, abre a sessão com
  //     etapa coerente e dá os 30 min de carência antes da fila de toques
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

  // (2) Puxar assunto. Aqui mora o freio do dia, a escolha entre template e
  //     texto livre, e a recusa de abordar duas vezes — tudo em `_abordagem.js`.
  //
  //     Bater o teto NÃO é erro: o lead fica no pipeline, esperando. Ele
  //     aparece no quadro na coluna de quem ainda não respondeu, e a abordagem
  //     sai no dia seguinte ou na mão, pelo botão.
  const abordagem = await abordar({ lead, origem: 'entrada_automatica' });

  return { aplicavel: true, entrou: true, abordagem };
}
