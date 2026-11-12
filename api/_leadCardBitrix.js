// api/_leadCardBitrix.js
// -----------------------------------------------------------------------------
// O CARD DO LEAD NO BITRIX: PENDÊNCIA VISÍVEL + NOVA TENTATIVA (12/11/2026).
//
// Diretriz do Bruno: "QS = ferramenta, Bitrix = banco de dados. Todo card criado
// no QS TEM que nascer no Bitrix e ficar amarrado. Falha = pendência visível +
// nova tentativa."
//
// O estado mora no próprio lead (migration 0362):
//   bitrix_card_status 'ok' | 'pendente' | 'falhou' | null (antigo, nunca avaliado)
//   bitrix_card_erro / _tentativas / _proxima (recuo) / _trava (exclusão mútua)
// O gatilho do banco marca 'pendente' em todo INSERT sem bitrix_id (inclusive o
// que o navegador grava direto: CSV, cadastro manual) e 'ok' quando o bitrix_id
// chega — então aqui só se escreve a FALHA e o vínculo.
//
// COMO UM LEAD GANHA CARD (garantirCardDoLead):
//   1. Trava o lead por 3 min (bitrix_card_trava): o cron e o botão "Tentar
//      agora" nunca criam dois negócios pro mesmo lead ao mesmo tempo.
//   2. PROCURA ANTES DE CRIAR, pelo telefone (mesma busca do leads-sem-card e
//      do wa-webhook: crm.duplicate.findbycomm com todas as variantes).
//      • achou negócio criado perto do lead (±48h) e que nenhum outro lead do
//        QS usa → VINCULA (é o negócio deste lead: formulário de live, ou uma
//        criação anterior que deu certo lá e a resposta se perdeu);
//      • achou só o contato, ou um negócio antigo/de outro lead → CRIA um
//        negócio novo reaproveitando o CONTATO (não duplica a pessoa);
//      • não achou → CRIA contato + negócio (funil Pré-Vendas, como sempre);
//      • não conseguiu perguntar → FALHA (nunca cria às cegas).
//   3. Falhou → recuo 5 min, 15 min, 1 h, 3 h, 12 h; na 6ª falha vira 'falhou'
//      e para de tentar sozinho (o botão "Tentar agora" continua valendo).
//
// A ROTINA (rodadaRetentativa) roda pelo cron de /api/leads-sem-card?acao=retentar
// e só ENVIA com LEADS_BITRIX_RETENTATIVA_LIGADA=1. Desligada (padrão) ela só
// responde quantos estão na fila. Lote pequeno (5) e 1 s entre leads: o Bitrix
// aceita ~2 chamadas/s por webhook e cada lead custa de 2 a 4.
// -----------------------------------------------------------------------------
import { rest, insert } from './_supabaseAdmin.js';
import { bitrixConfigurado, procurarNegocioPorTelefone, criarNegocioParaLead } from './_bitrixLead.js';

const MIN = 60_000;

/** Recuo entre tentativas, em minutos (1ª falha → 5 min, …). */
export const RECUO_MIN = [5, 15, 60, 180, 720];
/** Na 6ª falha o lead vira 'falhou' e sai da rotina automática. */
export const MAX_TENTATIVAS = 6;
/** Status de lead que a rotina trabalha por padrão (perdido só com perdidos=1). */
export const STATUS_ABERTOS = ['nao_iniciado', 'em_prospeccao', 'ganho'];
/** Negócio achado pelo telefone só é "deste lead" se nasceu até 48h dele. */
export const JANELA_VINCULO_MS = 48 * 60 * MIN;
const TRAVA_MS = 3 * MIN;
const PAUSA_ENTRE_LEADS_MS = 1_000;

/** Interruptor da rotina automática (padrão: desligada = só marca, não envia). */
export function retentativaLigada(env = process.env) {
  return ['1', 'true', 'sim', 'on'].includes(String(env.LEADS_BITRIX_RETENTATIVA_LIGADA || '').trim().toLowerCase());
}

/** O que gravar no lead depois de uma falha. Puro. */
export function planoDaFalha(tentativasAntes, erro, agoraMs = Date.now()) {
  const n = Math.max(0, Number(tentativasAntes) || 0) + 1;
  const desistiu = n >= MAX_TENTATIVAS;
  const recuo = RECUO_MIN[Math.min(n - 1, RECUO_MIN.length - 1)];
  return {
    bitrix_card_status: desistiu ? 'falhou' : 'pendente',
    bitrix_card_tentativas: n,
    bitrix_card_erro: String(erro || 'falha desconhecida').slice(0, 300),
    bitrix_card_proxima: desistiu ? null : new Date(agoraMs + recuo * MIN).toISOString(),
    bitrix_card_trava: null,
  };
}

/**
 * Decide o que fazer com o que o Bitrix respondeu sobre o telefone. Puro.
 *   achado    = retorno de procurarNegocioPorTelefone (ou { achou:false, semTelefone:true })
 *   ocupadoPor = lead do QS que já usa o negócio achado ({ id, full_name }) ou null
 * → { acao: 'vincular'|'criar'|'erro', dealId?, contatoId?, motivo }
 */
export function decidirVinculo(lead, achado, ocupadoPor) {
  if (!achado || achado.indisponivel) {
    return { acao: 'erro', motivo: `não consegui perguntar ao Bitrix (${achado?.motivo || 'sem resposta'})` };
  }
  if (achado.semTelefone) return { acao: 'criar', contatoId: null, motivo: 'lead sem telefone: cria contato e negócio novos' };
  if (!achado.achou) return { acao: 'criar', contatoId: null, motivo: 'telefone não existe no Bitrix: cria contato e negócio' };
  const contatoId = achado.contatoId || null;
  if (!achado.dealId) return { acao: 'criar', contatoId, motivo: `contato ${contatoId} já existe, sem negócio: cria o negócio nele` };

  const criado = Date.parse(achado.deal?.DATE_CREATE || '');
  const nasceu = Date.parse(lead?.created_at || lead?.arrived_at || '');
  const perto = Number.isFinite(criado) && Number.isFinite(nasceu) && Math.abs(criado - nasceu) <= JANELA_VINCULO_MS;
  if (perto && !ocupadoPor) {
    return { acao: 'vincular', dealId: String(achado.dealId), contatoId, motivo: `negócio ${achado.dealId} nasceu junto com este lead` };
  }
  const porque = ocupadoPor
    ? `o negócio ${achado.dealId} já é do lead "${ocupadoPor.full_name || ocupadoPor.id}"`
    : `o negócio mais recente do contato (${achado.dealId}, de ${String(achado.deal?.DATE_CREATE || '?').slice(0, 10)}) não é deste lead`;
  return { acao: 'criar', contatoId, motivo: `${porque}: cria negócio novo no contato ${contatoId}` };
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const id = (v) => encodeURIComponent(String(v));
/** Valor entre aspas para filtro dentro de or=/and= do PostgREST. */
const pgv = (v) => encodeURIComponent(`"${String(v).replace(/["\\]/g, '\\$&')}"`);

async function lerLead(leadId) {
  const rows = await rest(`qs_leads?select=*&id=eq.${id(leadId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

/** Grava a falha no lead. Nunca levanta (a 0362 pode não estar aplicada). */
export async function marcarFalha(leadId, erro, tentativasAntes = 0) {
  if (!leadId) return false;
  try {
    // Resgate (so_qs) fica só no QS por decisão: nunca vira pendência.
    await rest(`qs_leads?id=eq.${id(leadId)}&bitrix_id=is.null&or=(bitrix_card_status.is.null,bitrix_card_status.neq.so_qs)`, {
      method: 'PATCH', prefer: 'return=minimal', body: planoDaFalha(tentativasAntes, erro),
    });
    return true;
  } catch (e) {
    console.warn('[lead-card] não gravei a pendência (0362 aplicada?):', e?.message);
    return false;
  }
}

/** Pega a trava do lead. false = outro processo está nele agora. */
async function travar(leadId, agoraMs) {
  const agora = new Date(agoraMs).toISOString();
  const rows = await rest(
    `qs_leads?id=eq.${id(leadId)}&bitrix_id=is.null` +
    `&or=(bitrix_card_trava.is.null,bitrix_card_trava.lt.${pgv(agora)})&select=id`,
    { method: 'PATCH', prefer: 'return=representation', body: { bitrix_card_trava: new Date(agoraMs + TRAVA_MS).toISOString() } },
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Quem no QS já usa este negócio? (null = ninguém). Erro de leitura = "ocupado". */
async function quemUsaONegocio(dealId) {
  try {
    const rows = await rest(`qs_leads?select=id,full_name&bitrix_id=eq.${id(dealId)}&limit=1`);
    return (Array.isArray(rows) && rows[0]) || null;
  } catch {
    return { id: '?', full_name: '(não deu pra conferir)' };
  }
}

/** Pergunta ao Bitrix e decide — só leitura, nos dois lados. */
export async function planejarCard(lead) {
  const achado = lead?.phone
    ? await procurarNegocioPorTelefone(lead.phone, 6_000)
    : { achou: false, semTelefone: true };
  const ocupadoPor = achado?.dealId ? await quemUsaONegocio(achado.dealId) : null;
  return decidirVinculo(lead, achado, ocupadoPor);
}

/**
 * Garante que o lead tenha card no Bitrix (vincula o que já existe ou cria).
 * `origem` só vai pro log/nota: 'rotina' | 'manual' | 'cadastro'.
 * → { resultado: 'ja_tinha'|'vinculado'|'criado'|'falhou'|'ocupado'|'desligado'|'inexistente', bitrixId?, motivo? }
 */
export async function garantirCardDoLead(leadId, { origem = 'rotina', leadPronto = null } = {}) {
  const lead = leadPronto || await lerLead(leadId);
  if (!lead) return { resultado: 'inexistente', motivo: 'lead não existe' };
  if (lead.bitrix_id) return { resultado: 'ja_tinha', bitrixId: String(lead.bitrix_id) };
  if (lead.bitrix_card_status === 'so_qs') return { resultado: 'so_qs', motivo: 'lead de resgate: fica só no QS (decisão de 12/11)' };
  if (!bitrixConfigurado()) return { resultado: 'desligado', motivo: 'integração com o Bitrix desligada (BITRIX_WEBHOOK_BASE)' };

  const agoraMs = Date.now();
  let travado = false;
  try { travado = await travar(lead.id, agoraMs); } catch (e) {
    return { resultado: 'falhou', motivo: `não consegui travar o lead (${e?.message || 'erro no banco'})` };
  }
  if (!travado) return { resultado: 'ocupado', motivo: 'outro processo está criando o card deste lead agora' };

  const tentativas = Number(lead.bitrix_card_tentativas) || 0;
  const falhar = async (motivo) => {
    await marcarFalha(lead.id, motivo, tentativas);
    console.warn(`[lead-card] ${origem}: lead ${lead.id} sem card — ${motivo}`);
    return { resultado: 'falhou', motivo };
  };

  let plano;
  try { plano = await planejarCard(lead); } catch (e) { return falhar(`erro ao consultar o Bitrix: ${e?.message || e}`); }
  if (plano.acao === 'erro') return falhar(plano.motivo);

  let dealId = plano.dealId || null;
  if (plano.acao === 'criar') {
    dealId = await criarNegocioParaLead({ ...lead, bitrix_contato_id: plano.contatoId || null }).catch(() => null);
    if (!dealId) return falhar('o Bitrix não criou o negócio (recusou ou não respondeu a tempo)');
  }

  try {
    // bitrix_id=is.null: se alguém amarrou um card no meio do caminho, não sobrescreve.
    const gravou = await rest(`qs_leads?id=eq.${id(lead.id)}&bitrix_id=is.null&select=id`, {
      method: 'PATCH', prefer: 'return=representation', body: { bitrix_id: String(dealId) },
    });
    if (!Array.isArray(gravou) || !gravou.length) {
      // Já tinha card quando fomos gravar. Se criamos um negócio agora, ele ficou
      // solto no Bitrix — fica no log pra conferir.
      if (plano.acao === 'criar') console.warn(`[lead-card] lead ${lead.id} ganhou card no meio do caminho; negócio ${dealId} ficou solto no Bitrix`);
      return { resultado: 'ja_tinha', bitrixId: null, motivo: 'o lead ganhou card enquanto eu trabalhava' };
    }
  } catch (e) {
    const code = e?.details?.code || e?.code || '';
    // Negócio criado e não gravado: a próxima tentativa ACHA ele pelo telefone
    // (nasceu agora, perto do lead) e vincula — não cria outro.
    return falhar(code === '23505'
      ? `o negócio ${dealId} já está amarrado a outro lead do QS`
      : `negócio ${dealId} existe no Bitrix, mas não consegui gravar no lead (${e?.message || 'erro no banco'})`);
  }

  try {
    await insert('qs_notes', {
      lead_id: lead.id, author_id: null,
      body: plano.acao === 'vincular'
        ? `🔗 Card amarrado ao negócio ${dealId} que já existia no Bitrix (${plano.motivo}).`
        : `🔗 Negócio ${dealId} criado no Bitrix para este lead${tentativas ? ` (tentativa ${tentativas + 1})` : ''}.`,
      tags: ['bitrix', 'vinculo'],
    }, { returning: false });
  } catch { /* rastro é enfeite */ }

  console.log(`[lead-card] ${origem}: lead ${lead.id} → negócio ${dealId} (${plano.acao})`);
  return { resultado: plano.acao === 'vincular' ? 'vinculado' : 'criado', bitrixId: String(dealId), motivo: plano.motivo };
}

/** Caminho da fila (sem a parte do tempo). Exportado pros testes. */
export function caminhoDaFila({ perdidos = false, agoraIso, limite, apenasVencidos = true, offset = 0 }) {
  const status = perdidos ? [...STATUS_ABERTOS, 'perdido'] : STATUS_ABERTOS;
  const conds = ['or(bitrix_card_status.is.null,bitrix_card_status.eq.pendente)'];
  if (apenasVencidos) conds.push(`or(bitrix_card_proxima.is.null,bitrix_card_proxima.lte.${pgv(agoraIso)})`);
  return 'qs_leads?select=id,full_name,phone,status,created_at,arrived_at,segment,bitrix_id,' +
    'bitrix_card_status,bitrix_card_erro,bitrix_card_tentativas,bitrix_card_proxima' +
    `&bitrix_id=is.null&status=in.(${status.join(',')})&and=(${conds.join(',')})` +
    `&order=bitrix_card_proxima.asc.nullsfirst,created_at.asc,id.asc&limit=${limite}` +
    (offset > 0 ? `&offset=${Math.floor(offset)}` : '');
}

/**
 * Uma rodada da rotina.
 *   seco=true  → NÃO grava nada (nem no QS nem no Bitrix): lista a fila e o que
 *                faria. Com consultar=true faz as LEITURAS no Bitrix (buscar o
 *                telefone) pra dizer "vincularia ao X" / "criaria"; sem, nem
 *                encosta no Bitrix.
 *   seco=false → envia, se LEADS_BITRIX_RETENTATIVA_LIGADA=1. Senão só conta.
 *   perdidos   → inclui os perdidos sem card (fora por padrão).
 *   offset     → (só no seco) pula os N primeiros — pra consultar a fila em partes.
 */
export async function rodadaRetentativa({ seco = false, consultar = false, perdidos = false, limite, offset = 0, orcamentoMs = 40_000 } = {}) {
  const agoraIso = new Date().toISOString();
  const lim = Math.max(1, Math.min(Number(limite) || (seco ? 300 : 5), seco ? 1000 : 20));
  // No seco a lista mostra TODA a fila (inclusive quem está no recuo).
  const fila = (await rest(caminhoDaFila({ perdidos, agoraIso, limite: lim, apenasVencidos: !seco, offset: seco ? Math.max(0, Number(offset) || 0) : 0 }))) || [];
  const ligada = retentativaLigada();

  if (seco) {
    const inicio = Date.now();
    const itens = [];
    let naoConsultados = 0;
    for (const l of fila) {
      const item = {
        lead_id: l.id, nome: l.full_name, status: l.status, criado_em: l.created_at,
        estado: l.bitrix_card_status || '(antigo, sem marca)', tentativas: l.bitrix_card_tentativas || 0,
        proxima: l.bitrix_card_proxima, ultimo_erro: l.bitrix_card_erro || null,
        faria: 'procurar pelo telefone no Bitrix; vincular se achar o negócio dele, senão criar',
      };
      if (consultar) {
        if (Date.now() - inicio > orcamentoMs) { naoConsultados++; item.faria = '(não consultado: acabou o tempo)'; }
        else {
          try {
            const p = await planejarCard(l);
            item.faria = p.acao === 'vincular' ? `vincularia ao negócio ${p.dealId}` : p.acao === 'criar' ? 'criaria negócio novo' : 'não faria nada agora';
            item.motivo = p.motivo;
          } catch (e) { item.faria = 'não faria nada agora'; item.motivo = e?.message || 'erro ao consultar'; }
          await dorme(PAUSA_ENTRE_LEADS_MS);
        }
      }
      itens.push(item);
    }
    const porStatus = {};
    for (const l of fila) porStatus[l.status] = (porStatus[l.status] || 0) + 1;
    const resumo = { na_fila: fila.length, por_status: porStatus, rotina_ligada: ligada, perdidos_incluidos: perdidos };
    if (consultar) {
      resumo.vincularia = itens.filter((i) => String(i.faria).startsWith('vincularia')).length;
      resumo.criaria = itens.filter((i) => i.faria === 'criaria negócio novo').length;
      resumo.nada_agora = itens.filter((i) => i.faria === 'não faria nada agora').length;
      resumo.nao_consultados = naoConsultados;
    }
    return { seco: true, consultou_bitrix: consultar, resumo, itens };
  }

  if (!ligada) {
    return { seco: false, desligada: true, na_fila_agora: fila.length, mensagem: 'Rotina desligada (LEADS_BITRIX_RETENTATIVA_LIGADA): nada enviado ao Bitrix.' };
  }
  if (!bitrixConfigurado()) return { seco: false, desligada: true, mensagem: 'BITRIX_WEBHOOK_BASE ausente: nada enviado.' };

  const inicio = Date.now();
  const contagem = { criado: 0, vinculado: 0, falhou: 0, ocupado: 0, ja_tinha: 0, outros: 0, sobrou: 0 };
  const detalhes = [];
  for (const l of fila) {
    if (Date.now() - inicio > orcamentoMs) { contagem.sobrou++; continue; }
    const r = await garantirCardDoLead(l.id, { origem: 'rotina' })
      .catch((e) => ({ resultado: 'falhou', motivo: e?.message || 'erro' }));
    if (r.resultado in contagem) contagem[r.resultado]++; else contagem.outros++;
    detalhes.push({ lead_id: l.id, resultado: r.resultado, bitrix_id: r.bitrixId || null, motivo: r.motivo || null });
    await dorme(PAUSA_ENTRE_LEADS_MS);
  }
  return { seco: false, processados: detalhes.length, ...contagem, detalhes };
}
