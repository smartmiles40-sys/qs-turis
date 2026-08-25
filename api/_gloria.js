// api/_gloria.js
// -----------------------------------------------------------------------------
// O que a Glória (a IA de atendimento, que mora no n8n) precisa do lado do QS.
//
// Duas rotas usam este arquivo: `gloria-responder` (ela manda o que escreveu) e
// `gloria-transferir` (ela devolve a conversa pro time). Nenhuma delas passa por
// login de usuário — quem chama é uma máquina — então TUDO aqui depende de um
// segredo compartilhado (GLORIA_SECRET) e de a IA estar ligada no banco.
//
// Envs: GLORIA_SECRET + SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// -----------------------------------------------------------------------------

import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { parseCwDate } from './_wa.js';

/**
 * O nome com que as mensagens dela são gravadas.
 *
 * Não é enfeite: é este texto que o gatilho `qs_gloria_humano_assumiu` (0053)
 * usa pra saber que a mensagem que acabou de entrar foi ELA, e não o SDR
 * assumindo a conversa. Mudar aqui sem mudar na migration faz a IA se desligar
 * sozinha a cada resposta que der.
 */
export const ASSINATURA_IA = 'Glória (IA)';

/**
 * Portaria das rotas da Glória. Devolve null quando pode seguir, ou um objeto
 * { status, error } pra rota responder.
 *
 * O segredo pode vir no header `x-gloria-secret` ou em `?secret=` — o n8n manda
 * pelo header (credencial Header Auth), a querystring fica pro teste no curl.
 */
export function portaria(req) {
  const esperado = String(process.env.GLORIA_SECRET || '').trim();
  if (!esperado) {
    console.error('[gloria] GLORIA_SECRET ausente — rota desligada');
    return { status: 503, error: 'Atendimento por IA não configurado' };
  }
  // .trim() dos dois lados: segredo colado no painel da Vercel vem com espaço
  // invisível com frequência alta demais, e o sintoma (401 em tudo) é péssimo
  // de diagnosticar.
  const recebido = String(req.headers['x-gloria-secret'] || req.query?.secret || '').trim();
  if (!segredoConfere(recebido, esperado)) {
    console.warn(`[gloria] segredo não confere (recebido: ${recebido ? 'presente' : 'ausente'})`);
    return { status: 401, error: 'Não autorizado' };
  }
  return null;
}

/** O lead, com o mínimo que as duas rotas precisam. */
export async function buscarLead(leadId) {
  const rows = await rest(
    `qs_leads?select=id,owner_id,full_name,first_name,last_name,phone,status,segment,bitrix_id` +
    `&id=eq.${encodeURIComponent(leadId)}&limit=1`
  );
  return (Array.isArray(rows) && rows[0]) || null;
}

/**
 * A sessão da IA neste lead. É o interruptor: `ativa=false` significa que
 * alguém (ou o gatilho) já tirou a IA desta conversa, e nada mais pode sair em
 * nome dela — nem uma mensagem que o n8n já tinha na mão quando isso aconteceu.
 */
export async function sessao(leadId) {
  try {
    const rows = await rest(
      `qs_gloria_sessoes?select=lead_id,ativa,motivo,etapa,temperatura,resumo,respondidas,transferida_em` +
      `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
    );
    return (Array.isArray(rows) && rows[0]) || null;
  } catch (e) {
    // Tabela ausente = a 0053 ainda não foi colada. Quem trata é a rota.
    if (/qs_gloria_sessoes|schema cache|does not exist/i.test(String(e?.message))) {
      const err = new Error('A migration 0053 (Glória) ainda não foi aplicada no banco');
      err.code = 'SEM_0053';
      throw err;
    }
    throw e;
  }
}

/** Uma linha no diário da IA. Best-effort: log que quebra rota não serve. */
export async function registrar(leadId, direcao, conteudo, motivo = null, payload = {}) {
  try {
    await insert('qs_gloria_log', { lead_id: leadId, direcao, conteudo, motivo, payload }, { returning: false });
  } catch (e) {
    console.warn('[gloria] não deu pra registrar no log:', e?.message);
  }
}

/** Desliga a IA nesta conversa (rpc da 0053). */
export function pausar(leadId, motivo, resumo = null, transferida = false) {
  return rest('rpc/qs_gloria_pausar', {
    method: 'POST',
    body: { p_lead: leadId, p_motivo: motivo, p_resumo: resumo, p_transferida: transferida },
  });
}

/**
 * Cutuca o n8n: "chegou mensagem deste lead, veja se você responde".
 *
 * Chamado pelo webhook do WhatsApp a cada mensagem NOVA do cliente. Três
 * decisões que importam:
 *
 * • NÃO decide nada aqui. Quem sabe se a IA está ligada, se já respondeu e se a
 *   janela está aberta é o banco (qs_gloria_contexto, 0053), e quem pergunta é
 *   o n8n. Duplicar essa regra em dois lugares é como ela começa a divergir.
 *
 * • É `await`, e não fire-and-forget. Na Vercel a função pode ser congelada no
 *   instante em que responde: um fetch solto morreria pela metade em parte das
 *   execuções — o pior tipo de bug, o que só acontece às vezes. O workflow
 *   responde na hora (ele processa depois), então a espera é de milissegundos.
 *
 * • Falhar aqui NUNCA pode derrubar o webhook. n8n fora do ar significa lead
 *   sem resposta automática; erro propagado significa mensagem que não entra no
 *   QS. A segunda é muito pior.
 */
export async function avisarGloria({
  lead, message = null, conversationId = null, telefone = null,
  // 'resposta' = o lead falou e ela responde (o de sempre).
  // 'toque'    = ninguém falou; é a cadência dela puxando a conversa de volta.
  modo = 'resposta', passo = null,
}) {
  const url = String(process.env.GLORIA_WEBHOOK_URL || '').trim();
  if (!url) return { ok: false, motivo: 'sem_url' };

  const texto = String(message?.content || '').trim();
  // Áudio/imagem sem texto: a IA não tem o que ler. Fica com o humano.
  // No toque não existe mensagem nova — o silêncio É o gatilho.
  if (!texto && modo !== 'toque') return { ok: false, motivo: 'sem_texto' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gloria-secret': String(process.env.GLORIA_SECRET || '').trim(),
      },
      body: JSON.stringify({
        lead_id: lead?.id,
        telefone: telefone || lead?.phone || null,
        nome: lead?.first_name || lead?.full_name || null,
        mensagem: texto,
        modo,
        passo,
        conversation_id: conversationId,
        cw_message_id: message?.id ?? null,
        // O n8n usa este instante pra saber se, depois de esperar o lead
        // terminar de escrever, chegou mensagem mais nova que esta.
        // parseCwDate porque o Chatwoot manda epoch em SEGUNDOS: `new Date(x)`
        // cru daria 1970 e a comparação lá no banco perderia o sentido.
        sent_at: parseCwDate(message?.created_at),
      }),
      signal: ctrl.signal,
    });
    // 403 AQUI NAO CRIA EXECUCAO NENHUMA NO n8n, e ate 24/08 nao deixava rastro
    // aqui tambem — o retorno ia pro corpo da resposta do webhook e ninguem le
    // corpo de webhook. O sintoma era "nao chega nada no n8n", que parece "o QS
    // nao chamou". Custou duas horas em 21/08 e mais duas em 24/08, as duas
    // vezes pela credencial `Header Auth account` do n8n nao bater com o
    // GLORIA_SECRET da Vercel. Agora grita.
    if (!r.ok) {
      console.error(
        `[gloria] o n8n RECUSOU o aviso: HTTP ${r.status}. ` +
        (r.status === 403
          ? 'A credencial do webhook no n8n nao bate com o GLORIA_SECRET da Vercel. ' +
            'Confira o header (x-gloria-secret) e o valor nos DOIS lados.'
          : r.status === 404
            ? 'O workflow esta INATIVO ou a GLORIA_WEBHOOK_URL esta errada.'
            : 'Veja a execucao no n8n.')
      );
    }
    return { ok: r.ok, status: r.status };
  } catch (e) {
    console.warn('[gloria] não consegui avisar o n8n:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    return { ok: false, motivo: 'falha' };
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o corpo tanto quando a Vercel já parseou quanto quando veio string. */
export function corpo(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

// ─── DEVOLVER PRO TIME ───────────────────────────────────────────────────────

export const MOTIVOS_DE_SAIDA = {
  pedido_humano: 'o lead pediu para falar com uma pessoa',
  qualificado: 'qualificação concluída — hora de agendar a call',
  urgencia: 'o lead demonstrou urgência',
  reclamacao: 'o lead reclamou',
  fora_da_janela_24h: 'janela de 24h fechada — só template aprovado passa',
  erro_da_ia: 'a IA não conseguiu responder',
  duvida_sem_resposta: 'o lead perguntou algo que não está na base de conhecimento',
  // A Glória NÃO empurra reunião pra quem já disse não (data, investimento ou
  // momento). Reunião empurrada é o que queima a agenda do especialista.
  nao_qualificado: 'o lead não tem perfil para agendar agora (data, investimento ou momento)',
  pacote_personalizado: 'o lead quer roteiro sob medida, e preço de personalizado é do especialista',
  // Fim da cadência da IA: ela deu os toques e o lead não voltou.
  sem_resposta: 'a cadência da IA terminou sem resposta do lead',
  // Ela mesma marcou a reunião (gloria-agendar). A conversa passa pro
  // especialista dono do horário, não pro SDR.
  agendada: 'a Glória agendou a reunião com o especialista',
  // Desqualificado de vez: o lead vira PERDIDO no QS e o card sai do funil.
  perdido: 'o lead se desqualificou e a Glória marcou como perdido',
};

/**
 * Os motivos de perda que ela pode escolher SOZINHA.
 *
 * A tabela `qs_loss_reasons` tem sete, e ela só pode usar quatro: os que saem
 * da boca do cliente na conversa. "Comprou com concorrente" e "Contato
 * inválido" ela não tem como saber, e "Não respondeu" já é a cadência dela
 * (motivo `sem_resposta`). Motivo de perda chutado é pior que motivo em
 * branco, porque vira número no relatório e ninguém desconfia de número.
 *
 * A chave é a palavra que o modelo manda; o valor é o `label` da tabela. O id
 * é procurado em tempo de execução de propósito: uuid escrito na mão aqui vira
 * lead perdido com motivo errado no dia em que alguém reordenar a lista.
 */
const MOTIVOS_DE_PERDA = {
  sem_orcamento: 'Sem orçamento no momento',
  momento: 'Momento inadequado',
  sem_interesse: 'Sem interesse',
  fora_do_perfil: 'Fora do perfil (ICP)',
};

async function idDoMotivoDePerda(chave) {
  const label = MOTIVOS_DE_PERDA[String(chave || '').trim().toLowerCase()];
  if (!label) return null;
  try {
    const rows = await rest(`qs_loss_reasons?select=id&label=eq.${encodeURIComponent(label)}&limit=1`);
    return rows?.[0]?.id ?? null;
  } catch (e) {
    console.warn('[gloria] motivo de perda não resolvido:', e?.message);
    return null;
  }
}

/**
 * O lead se desqualificou de vez.
 *
 * Sem isto, `nao_qualificado` só pausava a IA e deixava o lead em prospecção
 * para sempre: a fila do SDR enchia de gente que já tinha dito não, e o card
 * ficava parado no funil do Bitrix. Agora fecha de verdade dos dois lados.
 *
 * Best-effort de cima a baixo. A sessão já foi pausada antes de chegar aqui, e
 * é isso que importa; se o Bitrix estiver fora, o QS continua sendo a fonte da
 * verdade e o card fica pra trás (visível em `bitrix_status_synced`).
 */
async function marcarPerdido(lead, chaveMotivo, resumo) {
  const reasonId = await idDoMotivoDePerda(chaveMotivo);
  const label = MOTIVOS_DE_PERDA[String(chaveMotivo || '').trim().toLowerCase()] || 'não informado';

  try {
    const patch = { status: 'perdido' };
    if (reasonId) patch.loss_reason_id = reasonId;
    await rest(
      `qs_leads?id=eq.${encodeURIComponent(lead.id)}&status=not.in.(ganho,perdido)`,
      { method: 'PATCH', prefer: 'return=minimal', body: patch }
    );
  } catch (e) {
    console.error('[gloria] lead NÃO virou perdido:', e?.message);
    return { ok: false, erro: e?.message };
  }

  // As atividades do plano humano morrem junto. As da reunião não: se existe
  // reunião marcada, ela tem história própria e não é isto que a apaga.
  try {
    const pendentes = await rest(
      `qs_tasks?select=id,tags&lead_id=eq.${encodeURIComponent(lead.id)}&status=eq.pendente`
    );
    for (const t of (Array.isArray(pendentes) ? pendentes : [])) {
      if ((t.tags || []).some((g) => String(g).startsWith('meeting:'))) continue;
      await rest(`qs_tasks?id=eq.${t.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'ignorada', skip_reason: `Lead perdido pela Glória: ${label}` },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[gloria] atividades seguem abertas no lead perdido:', e?.message);
  }

  if (lead.bitrix_id) {
    try {
      const { moverParaPerdido } = await import('./bitrix-sync.js');
      await moverParaPerdido(lead.bitrix_id, `${label}${resumo ? ` — ${resumo}` : ''}`);
    } catch (e) {
      console.warn('[gloria] card do Bitrix não foi movido:', e?.message);
    }
  }

  return { ok: true, motivo_perda: label };
}

/** A qualificação que ela já tinha juntado, em texto de gente. */
export function blocoQualificacao(s) {
  if (!s) return '';
  const linhas = [
    ['Necessidade (perfil, por que o destino)', s.perfil_viajante],
    ['Autoridade (com quem viaja, quem decide)', s.como_pretende_viajar],
    ['Orçamento (a faixa faz sentido)', s.resposta_investimento],
    ['Prazo (a data faz sentido)', s.resposta_data],
    ['Prazo de decisão', s.resposta_decisao],
  ].filter(([, v]) => v);
  if (!linhas.length) return '\n\nQualificação: a Glória ainda não descobriu nenhum ponto do BANT.';
  return `\n\nQualificação (${linhas.length}/5)\n` + linhas.map(([k, v]) => `• ${k}: ${v}`).join('\n');
}

/**
 * A IA sai e o time entra: desliga a sessão, escreve a nota com o resumo e a
 * qualificação, e cria a tarefa pro dono do lead.
 *
 * Mora aqui, e não dentro da rota, porque hoje são DOIS caminhos que precisam
 * disso: a rota `gloria-transferir` (quando o próprio modelo decide sair) e a
 * fila de toques (quando a cadência dela termina sem resposta). Duplicar isso
 * seria duplicar a regra de "como se entrega o bastão" — e é o tipo de coisa
 * que diverge em silêncio.
 *
 * A ORDEM importa: pausar PRIMEIRO. Se qualquer coisa abaixo falhar, o pior
 * cenário é o time ser avisado por outro caminho — e não a IA continuar
 * falando com alguém que pediu para falar com uma pessoa.
 */
export async function devolverProTime({ leadId, motivo, resumo = '', temperatura = null, lead = null, teste = false, motivoPerda = null }) {
  const alvo = lead || (await buscarLead(leadId));
  if (!alvo) return { ok: false, motivo: 'lead_inexistente' };

  const razao = String(motivo || 'pedido_humano').trim().slice(0, 80);
  const texto = String(resumo || '').trim().slice(0, 2000);
  const temp = ['Quente', 'Morno', 'Frio'].includes(temperatura) ? temperatura : null;

  if (teste) {
    return {
      ok: true, teste: true,
      aviso: 'MODO TESTE — a IA continua ligada, nenhuma nota ou tarefa foi criada.',
      transferiria: { lead: { id: alvo.id, nome: alvo.first_name || alvo.full_name }, para: alvo.owner_id, motivo: razao, temperatura: temp, resumo: texto || null },
      marcaria_perdido: razao === 'perdido' ? (MOTIVOS_DE_PERDA[String(motivoPerda||'').toLowerCase()] || 'motivo invalido') : undefined,
    };
  }

  await pausar(leadId, razao, texto || null, true);

  if (temp) {
    await rest('rpc/qs_gloria_salvar', {
      method: 'POST',
      body: { p_lead: leadId, p_temperatura: temp },
    }).catch((e) => console.warn('[gloria] temperatura:', e?.message));
  }

  // PERDIDO fecha o lead dos dois lados. Vem DEPOIS do pausar, pela mesma razão
  // de sempre: se qualquer coisa aqui falhar, o pior cenário é um lead que
  // continua em prospecção — nunca uma IA que segue falando com quem já disse
  // não.
  let perda = null;
  if (razao === 'perdido') {
    perda = await marcarPerdido(alvo, motivoPerda, texto);
  }

  // A qualificação DEPOIS do pausar: assim a nota já sai com o que ela acabou
  // de gravar na mesma rodada.
  let ses = null;
  try {
    const rows = await rest(`qs_gloria_sessoes?select=*&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`);
    ses = rows?.[0] || null;
  } catch (e) {
    console.warn('[gloria] sessão:', e?.message);
  }

  const corpoNota =
    (perda?.ok ? '🤖 Glória (IA) marcou este lead como PERDIDO\n' : '🤖 Glória (IA) devolveu a conversa\n') +
    `Motivo: ${MOTIVOS_DE_SAIDA[razao] || razao}` +
    (perda?.ok ? `\nMotivo da perda: ${perda.motivo_perda}` : '') +
    (ses?.temperatura ? `\nTemperatura: ${ses.temperatura}` : '') +
    (ses?.toques ? `\nToques da cadência da IA: ${ses.toques}` : '') +
    (texto ? `\n\n${texto}` : '') +
    blocoQualificacao(ses);

  let notaOk = false;
  try {
    await insert('qs_notes', { lead_id: leadId, author_id: null, body: corpoNota, tags: ['gloria'] }, { returning: false });
    notaOk = true;
  } catch (e) {
    console.warn('[gloria] nota:', e?.message);
  }

  // LEAD PERDIDO NÃO GERA TAREFA. Cobrar contato de quem acabou de dizer não é
  // exatamente o que entope a fila do SDR, e foi pra isso que este caminho
  // passou a existir. A nota fica; a cobrança, não.
  //
  // Nos outros casos vai com `is_extra`, porque não faz parte do plano de
  // nenhuma cadência: não pode contar como o toque do dia nem empurrar os
  // próximos.
  let tarefaOk = false;
  if (!perda?.ok) {
    try {
      await insert('qs_tasks', {
        lead_id: leadId,
        owner_id: alvo.owner_id ?? null,
        channel_type: 'whatsapp',
        priority: razao === 'qualificado' || razao === 'urgencia' ? 'alta' : 'media',
        scheduled_at: new Date().toISOString(),
        status: 'pendente',
        is_extra: true,
        notes: `Glória devolveu a conversa: ${MOTIVOS_DE_SAIDA[razao] || razao}`.slice(0, 500),
        tags: ['gloria', razao],
      }, { returning: false });
      tarefaOk = true;
    } catch (e) {
      console.warn('[gloria] tarefa:', e?.message);
    }
  }

  await registrar(leadId, 'evento', texto || null, `transferida: ${razao}`, { notaOk, tarefaOk, perdido: perda?.ok || undefined });

  return {
    ok: true, lead_id: leadId, motivo: razao, nota: notaOk, tarefa: tarefaOk,
    owner_id: alvo.owner_id ?? null,
    ...(perda?.ok ? { perdido: true, motivo_perda: perda.motivo_perda } : {}),
  };
}

// ─── A CADÊNCIA DELA ─────────────────────────────────────────────────────────

const CHAVE_FILA = 'gloria_fila_estado';

async function estadoDaFila() {
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE_FILA}&limit=1`);
    const v = rows?.[0]?.value;
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

async function salvarEstadoDaFila(valor) {
  await rest('qs_settings', {
    method: 'POST',
    body: { key: CHAVE_FILA, value: valor, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  }).catch((e) => console.warn('[gloria] estado da fila:', e?.message));
}

/**
 * Pega a trava da rodada. Devolve true só pra QUEM PEGOU — e é o ponto todo.
 *
 * A trava antiga lia o carimbo e depois gravava. Em 25/08, às 8h25, três
 * chamadas caíram no mesmo milissegundo (o webhook de uma mensagem que entrou +
 * o QS abrindo em duas telas): as três leram o carimbo velho, as três acharam
 * que eram a rodada da vez, e o mesmo lead levou o mesmo toque TRÊS vezes — em
 * três redações diferentes, então nem a checagem de duplicata do responder
 * segurou. Pior que o incômodo: cada rodada carimbou um toque, a cadência de 3
 * virou 4, e o lead foi devolvido pro time 10 horas antes da hora tendo
 * recebido 1 dos 3 toques.
 *
 * Agora quem decide é o Postgres, num UPDATE condicional na própria linha: duas
 * chamadas simultâneas disputam a MESMA linha, o banco serializa, e a segunda
 * reavalia o filtro contra o valor já carimbado pela primeira — não casa, volta
 * zero linhas, não roda. Não dá pra fazer isso lendo antes e gravando depois.
 */
async function pegarATrava(minutos, estado) {
  const corte = new Date(Date.now() - minutos * 60_000).toISOString();
  const valor = { ...estado, rodadaEm: new Date().toISOString() };
  try {
    const linhas = await rest(
      `qs_settings?key=eq.${CHAVE_FILA}` +
      `&or=(value->>rodadaEm.is.null,value->>rodadaEm.lt."${corte}")`,
      { method: 'PATCH', body: { value: valor, updated_at: valor.rodadaEm }, prefer: 'return=representation' }
    );
    if (Array.isArray(linhas) && linhas.length > 0) return true;
  } catch (e) {
    console.warn('[gloria] trava da fila:', e?.message);
    return false; // Banco ruim não é hora de martelar lead.
  }
  // Zero linhas tem duas leituras: ou alguém pegou a trava agora, ou a chave
  // nunca existiu. Só o segundo caso pode virar rodada.
  const existe = await rest(`qs_settings?select=key&key=eq.${CHAVE_FILA}&limit=1`).catch(() => null);
  if (Array.isArray(existe) && existe.length === 0) {
    await salvarEstadoDaFila(valor);
    return true;
  }
  return false;
}

/**
 * Roda a cadência da IA: quem está devendo um toque leva o toque, quem chegou
 * ao fim volta pro time.
 *
 * SEM AGENDADOR EXTERNO, de propósito. O vigia dos números dependia de um, o
 * agendador parou em 17/08 e ninguém notou por dois dias — silêncio parece
 * "está tudo bem". Aqui é o contrário: esta função pega carona em quem já
 * acontece (o webhook de cada mensagem que entra e o QS aberto na tela de
 * alguém), e a trava de 5 minutos no banco impede que mil abas virem mil
 * rodadas.
 *
 * Quem decide QUANDO tocar é o banco (`qs_gloria_fila_de_toques`); quem escreve
 * o texto é a Glória no n8n. Aqui só se junta uma coisa com a outra.
 */
export async function rodarFilaDeToques({ limite = 8, forcar = false, minutos = 5 } = {}) {
  if (!String(process.env.GLORIA_WEBHOOK_URL || '').trim()) {
    return { pulou: true, motivo: 'sem_url' };
  }

  const estado = await estadoDaFila();
  const idade = estado?.rodadaEm ? Date.now() - new Date(estado.rodadaEm).getTime() : Infinity;

  // A trava é o carimbo, e ele vem ANTES de qualquer trabalho: quem não pegou,
  // não roda. `forcar` (só pela porta do segredo) fura a espera, mas ainda
  // carimba, senão duas forçadas juntas voltariam ao mesmo problema.
  if (forcar) {
    await salvarEstadoDaFila({ ...estado, rodadaEm: new Date().toISOString() });
  } else if (!(await pegarATrava(minutos, estado))) {
    return { pulou: true, motivo: 'recente', idadeMs: Number.isFinite(idade) ? idade : null };
  }

  let fila = [];
  try {
    fila = await rest('rpc/qs_gloria_fila_de_toques', { method: 'POST', body: { p_limite: limite } });
  } catch (e) {
    if (/qs_gloria_fila_de_toques|does not exist|schema cache/i.test(String(e?.message))) {
      return { pulou: true, motivo: 'sem_0060' };
    }
    await salvarEstadoDaFila({ ...estado, rodadaEm: new Date().toISOString(), falha: { em: new Date().toISOString(), motivo: String(e?.message || 'erro') } });
    return { pulou: false, erro: String(e?.message || 'erro') };
  }

  const resultado = { pulou: false, tocados: 0, devolvidos: 0, falhas: 0, detalhes: [] };

  for (const item of Array.isArray(fila) ? fila : []) {
    try {
      if (item.acao === 'devolver') {
        const horas = Math.round((item.silencio_min || 0) / 60);
        await devolverProTime({
          leadId: item.lead_id,
          motivo: 'sem_resposta',
          resumo:
            `A Glória deu os toques da cadência e o lead não voltou (${horas}h de silêncio). ` +
            'Dentro da janela de 24h ela não pode mais insistir — daqui pra frente é conversa de gente.',
        });
        resultado.devolvidos++;
        resultado.detalhes.push({ lead: item.lead_id, acao: 'devolvido', motivo: item.motivo });
        continue;
      }

      // O carimbo vem ANTES de mandar escrever. Se o n8n estiver fora, perde-se
      // um toque — o que é muito melhor que martelar o mesmo lead a cada rodada.
      await rest('rpc/qs_gloria_marcar_toque', {
        method: 'POST',
        body: { p_lead: item.lead_id, p_passo: item.passo },
      });

      const r = await avisarGloria({
        lead: { id: item.lead_id, phone: item.telefone, first_name: item.nome },
        telefone: item.telefone,
        modo: 'toque',
        passo: item.passo,
      });

      if (r?.ok) resultado.tocados++; else resultado.falhas++;
      resultado.detalhes.push({ lead: item.lead_id, acao: 'toque', passo: item.passo, ok: !!r?.ok });
    } catch (e) {
      resultado.falhas++;
      console.warn('[gloria] fila de toques:', e?.message);
      await registrar(item.lead_id, 'erro', null, `falha_no_toque: ${e?.message || 'erro'}`);
    }
  }

  await salvarEstadoDaFila({
    rodadaEm: new Date().toISOString(),
    ultimo: { tocados: resultado.tocados, devolvidos: resultado.devolvidos, falhas: resultado.falhas, fila: fila.length },
  });

  return resultado;
}

/** Há quanto tempo a cadência da IA não roda, e o que ela fez por último. */
export async function saudeDaFila() {
  const estado = await estadoDaFila();
  const ultimo = estado?.rodadaEm ? new Date(estado.rodadaEm).getTime() : null;
  return {
    rodadaEm: estado?.rodadaEm || null,
    paradoHaMs: ultimo ? Date.now() - ultimo : null,
    ultimo: estado?.ultimo || null,
    falha: estado?.falha || null,
  };
}
