// api/cadencia-sweep.js
// -----------------------------------------------------------------------------
// FIM DE CADÊNCIA NO SERVIDOR (auditoria 09/11/2026) — o motor PRINCIPAL.
//
// A regra é a mesma de src/lib/qs/cadenceSweep.ts (decisão do Bruno, 16/07 e
// 25/09). Lead aberto (nao_iniciado/em_prospeccao) numa cadência "disponivel"
// que NÃO tem mais nenhuma tarefa pendente/atrasada terminou o plano:
//   1. REDIRECIONAMENTO (redirect_cadence_id): entra na cadência de destino com
//      atividades novas. Vence a perda. Destino não "disponivel" (congelado /
//      rascunho) = o lead ESPERA: não redireciona e também não cai na perda.
//      1b. REVISÃO (12/11/2026): esperando, o lead ficava SEM NENHUMA tarefa e
//      sumia da fila do SDR (180 leads da "Cadência SDR" parados atrás da
//      "Resgate — Base Fria" congelada). Agora ganha UMA tarefa de revisão
//      ("cadência terminou — decidir o próximo passo"), uma vez só (nota
//      revisar-fim-cadencia), só em horário comercial e com teto por SDR por
//      dia (?revisar_dia=N, padrão 5) — sem avalanche na fila. Se o destino
//      voltar a "disponivel", o redirecionamento normal ainda acontece.
//   2. PERDA AUTOMÁTICA (auto_loss_days): se passou do prazo em dias (desde
//      cadence_started_at, ou arrived_at), vira "perdido" com o motivo
//      "Fim de cadência" e a perda vai pro Bitrix (moverParaPerdido).
//   3. SEM REGRA: nota 🏁 uma vez só + registro na carteira do SDR.
// CONGELAR pausa o motor: cadência congelada/rascunho não entra na varredura
// (só "disponivel"), exatamente como no navegador.
//
// Por que existir: o do navegador só roda quando alguém abre o app e só
// enxerga o que a RLS daquele usuário vê (SDR = os próprios leads). Aqui é
// service role, todos os leads, de hora em hora pelo Cron da Vercel. O do
// navegador continua ligado (é idempotente e tem guarda de corrida: os updates
// são condicionados ao estado atual, então quem chega segundo afeta 0 linhas).
//
// Diferença consciente: as atividades do redirecionamento saem do
// generateCadenceTasks do servidor (api/_leads.js) — mesma regra de dia útil e
// expediente, sem o "teto de entrada por dia" (0216) que só o front aplica.
//
// GET (Vercel Cron, Authorization: Bearer CRON_SECRET)
//   ?seco=1     só conta o que faria (não grava nada, não chama o Bitrix)
//   ?limite=N   máximo de ações por rodada (padrão 50, teto 300)
//   ?revisar_dia=N  teto de tarefas de revisão por SDR por dia (padrão 5; 0 desliga)
// Env: CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (+ BITRIX_WEBHOOK_BASE
// pra espelhar a perda; sem ela a perda fica só no QS, como no bitrix-sync).
// Recomendado em vercel.json: "api/cadencia-sweep.js": { "maxDuration": 60 }.
// -----------------------------------------------------------------------------

import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { generateCadenceTasks } from './_leads.js';
import { bitrixConfigurado } from './_bitrixLead.js';

const enc = encodeURIComponent;
const ABERTOS = ['nao_iniciado', 'em_prospeccao'];
const LIMITE_PADRAO = 50;
const LIMITE_TETO = 300;
// Para de COMEÇAR ações novas depois disto (cada ação é curta; folga pro fim).
const PRAZO_MS = 40_000;
const DIA_MS = 86_400_000;
// Tarefa de revisão do lead parado atrás de destino congelado (ver 1b acima).
const TAG_REVISAR = 'revisar-fim-cadencia';
const REVISAR_DIA_PADRAO = 5;
const REVISAR_DIA_TETO = 50;
const BRT_MS = -3 * 3_600_000; // Brasil sem horário de verão desde 2019

/** Seg–sex, 09:00–18:00 em Brasília: só aí nasce tarefa de revisão. */
export function emExpediente(agoraMs) {
  const d = new Date(agoraMs + BRT_MS);
  const dia = d.getUTCDay();
  const min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return dia >= 1 && dia <= 5 && min >= 9 * 60 && min < 18 * 60;
}

/** Meia-noite de hoje em Brasília, em ISO UTC (base do teto diário). */
export function inicioDoDiaBrt(agoraMs) {
  const d = new Date(agoraMs + BRT_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - BRT_MS).toISOString();
}

function blocos(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * A DECISÃO, sem rede (testada em tests/cadencia-sweep.test.ts).
 * Mesma ordem do navegador: redirecionar > perder > encerrar (sem regra).
 *
 * @param {object} p
 * @param {Array<{id,cadence_id,cadence_started_at,arrived_at}>} p.leads  leads abertos
 * @param {Map<string,{id,name,auto_loss_days,redirect_cadence_id}>} p.regras  só cadências "disponivel"
 * @param {Map<string,string>} p.statusDestino  status das cadências de destino
 * @param {Set<string>} p.comAbertas  leads com tarefa pendente/atrasada
 * @param {Set<string>} p.jaEncerrados  leads que já têm a nota fim-cadencia
 * @param {Set<string>} [p.jaRevisados]  leads que já ganharam a tarefa de revisão (nota revisar-fim-cadencia)
 * @param {Map<string,number>} [p.revisarHoje]  tarefas de revisão já criadas hoje, por SDR
 * @param {number} [p.revisarDia]  teto de tarefas de revisão por SDR por dia (0 = desligado)
 * @param {number} p.agoraMs
 * @returns {Array<{lead, regra, acao: 'redirecionar'|'perder'|'encerrar'|'revisar', dias?: number}>}
 */
export function decidirFimDeCadencia({
  leads, regras, statusDestino, comAbertas, jaEncerrados,
  jaRevisados = new Set(), revisarHoje = new Map(), revisarDia = 0, agoraMs,
}) {
  const out = [];
  const cota = new Map(revisarHoje); // cópia: a decisão não mexe no que recebeu
  for (const lead of leads) {
    if (comAbertas.has(lead.id)) continue; // plano ainda em andamento
    const regra = regras.get(lead.cadence_id);
    if (!regra) continue; // cadência congelada/rascunho/sumida: motor pausado

    if (regra.redirect_cadence_id && regra.redirect_cadence_id !== lead.cadence_id) {
      // Destino pausado: o lead ESPERA (o redirecionamento vence a perda) —
      // mas não some: ganha UMA tarefa de revisão, dentro do teto do dono.
      if (statusDestino.get(regra.redirect_cadence_id) !== 'disponivel') {
        if (!(revisarDia > 0) || !lead.owner_id || jaRevisados.has(lead.id)) continue;
        if (!emExpediente(agoraMs)) continue;
        const usadas = cota.get(lead.owner_id) || 0;
        if (usadas >= revisarDia) continue;
        cota.set(lead.owner_id, usadas + 1);
        out.push({ lead, regra, acao: 'revisar' });
        continue;
      }
      out.push({ lead, regra, acao: 'redirecionar' });
      continue;
    }

    if (regra.auto_loss_days && regra.auto_loss_days > 0) {
      const base = lead.cadence_started_at || lead.arrived_at;
      if (!base) continue;
      const dias = Math.floor((agoraMs - new Date(base).getTime()) / DIA_MS);
      if (!(dias >= regra.auto_loss_days)) continue; // dentro do prazo (ou data inválida)
      out.push({ lead, regra, acao: 'perder', dias });
      continue;
    }

    if (jaEncerrados.has(lead.id)) continue;
    out.push({ lead, regra, acao: 'encerrar' });
  }
  return out;
}

/** Lê tudo de uma consulta do PostgREST paginando por id (teto de 1000 por resposta). */
async function lerTudo(base) {
  const out = [];
  let ultimo = null;
  for (let i = 0; i < 200; i++) {
    const filtro = ultimo ? `&id=gt.${enc(ultimo)}` : '';
    const rows = await rest(`${base}${filtro}&order=id.asc&limit=1000`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < 1000) break;
    ultimo = rows[rows.length - 1].id;
  }
  return out;
}

async function carregar() {
  const cadencias = await rest('qs_cadences?select=id,name,auto_loss_days,redirect_cadence_id&status=eq.disponivel');
  const regras = new Map((cadencias || []).map((c) => [c.id, c]));
  if (regras.size === 0) return { regras, leads: [] };

  const destinos = [...new Set([...regras.values()].map((c) => c.redirect_cadence_id).filter(Boolean))];
  const statusDestino = new Map();
  if (destinos.length) {
    const rows = await rest(`qs_cadences?select=id,status&id=in.(${destinos.map(enc).join(',')})`);
    for (const r of rows || []) statusDestino.set(r.id, r.status);
  }

  const leads = [];
  for (const ids of blocos([...regras.keys()], 100)) {
    leads.push(...await lerTudo(
      'qs_leads?select=id,full_name,phone,bitrix_id,owner_id,cadence_id,cadence_started_at,arrived_at' +
      `&cadence_id=in.(${ids.map(enc).join(',')})&status=in.(${ABERTOS.join(',')})`
    ));
  }

  // Fim de plano = nenhuma tarefa aberta. Paginado: a lista cortada no teto de
  // 1000 é o que fazia o motor perder lead com atividade pendente (fix 24/07).
  const comAbertas = new Set();
  for (const ids of blocos(leads.map((l) => l.id), 100)) {
    const rows = await lerTudo(
      `qs_tasks?select=id,lead_id&lead_id=in.(${ids.join(',')})&status=in.(pendente,atrasada)`
    );
    for (const r of rows) comAbertas.add(r.lead_id);
  }

  const semAbertas = leads.filter((l) => !comAbertas.has(l.id)).map((l) => l.id);
  const jaEncerrados = new Set();
  const jaRevisados = new Set();
  for (const ids of blocos(semAbertas, 100)) {
    const rows = await lerTudo(
      `qs_notes?select=id,lead_id,tags&lead_id=in.(${ids.join(',')})` +
      `&tags=ov.${enc(`{fim-cadencia,${TAG_REVISAR}}`)}`
    );
    for (const r of rows) {
      const tags = Array.isArray(r.tags) ? r.tags : [];
      if (tags.includes('fim-cadencia')) jaEncerrados.add(r.lead_id);
      if (tags.includes(TAG_REVISAR)) jaRevisados.add(r.lead_id);
    }
  }

  // Teto diário por SDR: quantas tarefas de revisão cada um já ganhou hoje.
  const revisarHoje = new Map();
  const hoje = await lerTudo(
    `qs_tasks?select=id,owner_id&tags=cs.${enc(`{${TAG_REVISAR}}`)}&created_at=gte.${enc(inicioDoDiaBrt(Date.now()))}`
  );
  for (const r of hoje) if (r.owner_id) revisarHoje.set(r.owner_id, (revisarHoje.get(r.owner_id) || 0) + 1);

  return { regras, statusDestino, leads, comAbertas, jaEncerrados, jaRevisados, revisarHoje };
}

async function nota(leadId, body, tags) {
  await insert('qs_notes', { lead_id: leadId, author_id: null, body, tags }, { returning: false });
}

async function redirecionar({ lead, regra }) {
  const destino = regra.redirect_cadence_id;
  // Guarda de corrida: só move se ainda está na cadência antiga e aberto.
  const movidos = await rest(
    `qs_leads?id=eq.${enc(lead.id)}&cadence_id=eq.${enc(lead.cadence_id)}&status=in.(${ABERTOS.join(',')})&select=id`,
    { method: 'PATCH', body: { cadence_id: destino, cadence_started_at: new Date().toISOString(), status: 'em_prospeccao' }, prefer: 'return=representation' }
  );
  if (!Array.isArray(movidos) || movidos.length === 0) return false;
  try {
    await generateCadenceTasks({ leadId: lead.id, cadenceId: destino, ownerId: lead.owner_id ?? null });
  } catch (e) {
    // Sem atividades o lead ficaria órfão na cadência nova: volta e tenta na próxima rodada.
    await rest(`qs_leads?id=eq.${enc(lead.id)}&cadence_id=eq.${enc(destino)}`, {
      method: 'PATCH', body: { cadence_id: lead.cadence_id, cadence_started_at: lead.cadence_started_at }, prefer: 'return=minimal',
    });
    console.warn('[cadencia-sweep] redirecionamento revertido:', lead.id, e?.message);
    return false;
  }
  await nota(lead.id,
    `🔁 Fim da cadência "${regra.name}" sem desfecho — lead redirecionado automaticamente para a próxima cadência.`,
    ['bitrix', 'cadencia', 'redirecionamento']);
  return true;
}

async function revisar({ lead, regra }, destinoNome) {
  // Guarda de corrida: só cria se o lead continua aberto, na mesma cadência e
  // ainda sem nenhuma tarefa aberta (o SDR pode ter agido entre a leitura e aqui).
  const ainda = await rest(
    `qs_leads?select=id&id=eq.${enc(lead.id)}&cadence_id=eq.${enc(lead.cadence_id)}&status=in.(${ABERTOS.join(',')})`
  );
  if (!Array.isArray(ainda) || ainda.length === 0) return false;
  const abertas = await rest(`qs_tasks?select=id&lead_id=eq.${enc(lead.id)}&status=in.(pendente,atrasada)&limit=1`);
  if (Array.isArray(abertas) && abertas.length > 0) return false;

  const destino = destinoNome ? `"${destinoNome}"` : 'de destino';
  await insert('qs_tasks', {
    lead_id: lead.id,
    cadence_id: lead.cadence_id,
    owner_id: lead.owner_id,
    channel_type: 'pesquisa', // não é contato com o cliente: é decisão interna
    priority: 'media',
    scheduled_at: new Date().toISOString(),
    status: 'pendente',
    is_extra: true,
    notes:
      `Cadência terminou — decidir o próximo passo. O plano da "${regra.name}" acabou sem desfecho ` +
      `e a cadência ${destino} está pausada, então o lead não foi redirecionado. ` +
      'Reinicie uma cadência, agende, marque como perdido ou devolva à carteira.',
    tags: ['cadencia', TAG_REVISAR],
  }, { returning: false });
  await nota(lead.id,
    `⏸️ Fim da cadência "${regra.name}" sem desfecho — a cadência ${destino} está pausada. ` +
    'Criada uma tarefa de revisão para o SDR decidir o próximo passo.',
    ['cadencia', TAG_REVISAR]);
  return true;
}

async function perder({ lead, regra, dias }, motivoId) {
  const body = { status: 'perdido', ...(motivoId ? { loss_reason_id: motivoId } : {}) }; // closed_at: trigger 0012
  const perdidos = await rest(
    `qs_leads?id=eq.${enc(lead.id)}&status=in.(${ABERTOS.join(',')})&select=id`,
    { method: 'PATCH', body, prefer: 'return=representation' }
  );
  if (!Array.isArray(perdidos) || perdidos.length === 0) return { ok: false };
  await nota(lead.id,
    `⛔ Perda automática: ${dias} dias na cadência "${regra.name}" sem desfecho (limite: ${regra.auto_loss_days}).`,
    ['bitrix', 'cadencia', 'perda-automatica']);

  // Espelho no Bitrix — mesmo caminho do perdido manual (api/bitrix-sync.js).
  // Best-effort: o lead já está perdido no QS; falha aqui só fica no log.
  let bitrix = 'sem-card';
  if (lead.bitrix_id && bitrixConfigurado()) {
    try {
      const { moverParaPerdido } = await import('./bitrix-sync.js');
      const r = await moverParaPerdido(lead.bitrix_id, 'Fim de cadência');
      bitrix = r?.ok ? r.code : (r?.code || 'falhou');
      if (r?.ok) {
        await rest(`qs_leads?id=eq.${enc(lead.id)}`, {
          method: 'PATCH', body: { bitrix_status_synced: 'perdido' }, prefer: 'return=minimal',
        }).catch(() => {});
      }
    } catch (e) {
      bitrix = 'falhou';
      console.warn('[cadencia-sweep] Bitrix da perda falhou:', lead.id, e?.message);
    }
  } else if (lead.bitrix_id) {
    bitrix = 'bitrix-desligado';
  }
  return { ok: true, bitrix };
}

async function encerrar({ lead, regra }) {
  if (lead.phone && lead.owner_id) {
    await rest('rpc/qs_carteira_registrar', {
      method: 'POST', body: { p_telefone: lead.phone, p_sdr: lead.owner_id, p_motivo: 'fim-cadencia' },
    }).catch((e) => console.warn('[cadencia-sweep] carteira:', lead.id, e?.message));
  }
  await nota(lead.id,
    `🏁 Fim da cadência "${regra.name}" sem desfecho — todas as atividades do plano foram concluídas. O lead voltou pra carteira do SDR e pode ser reiniciado por lá.`,
    ['cadencia', 'fim-cadencia']);
  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  const q = req.query || {};
  const seco = ['1', 'true', 'sim'].includes(String(q.seco || '').toLowerCase());
  const limite = Math.max(1, Math.min(LIMITE_TETO, Number.parseInt(q.limite, 10) || LIMITE_PADRAO));
  const revisarParam = Number.parseInt(q.revisar_dia, 10);
  const revisarDia = Number.isFinite(revisarParam)
    ? Math.max(0, Math.min(REVISAR_DIA_TETO, revisarParam))
    : REVISAR_DIA_PADRAO;
  const inicio = Date.now();

  let dados;
  try {
    dados = await carregar();
  } catch (e) {
    console.error('[cadencia-sweep] leitura falhou:', String(e?.message || '').slice(0, 200));
    return res.status(500).json({ error: 'leitura falhou', detalhe: String(e?.message || '').slice(0, 200) });
  }
  if (!dados.leads.length) return res.status(200).json({ seco, leads_abertos: 0, candidatos: 0 });

  const decisoes = decidirFimDeCadencia({ ...dados, revisarDia, agoraMs: Date.now() });
  const previsto = { redirecionar: 0, perder: 0, encerrar: 0, revisar: 0 };
  for (const d of decisoes) previsto[d.acao]++;

  const saida = {
    seco, limite,
    leads_abertos: dados.leads.length,
    sem_tarefa_aberta: dados.leads.length - dados.comAbertas.size,
    candidatos: decisoes.length,
    previsto,
  };
  if (seco) {
    console.log(`[cadencia-sweep] seco ${JSON.stringify(saida)}`);
    return res.status(200).json(saida);
  }

  let motivoId = null;
  try {
    const m = await rest(`qs_loss_reasons?select=id&label=eq.${enc('Fim de cadência')}&limit=1`);
    motivoId = (m && m[0] && m[0].id) || null;
  } catch { /* sem a 0093 a perda sai sem motivo, como no navegador */ }

  // Nome das cadências de destino (pausadas) para o texto da tarefa de revisão.
  const nomeDestino = new Map();
  const destinosRevisar = [...new Set(decisoes.filter((d) => d.acao === 'revisar').map((d) => d.regra.redirect_cadence_id))];
  if (destinosRevisar.length) {
    try {
      const rows = await rest(`qs_cadences?select=id,name&id=in.(${destinosRevisar.map(enc).join(',')})`);
      for (const r of rows || []) nomeDestino.set(r.id, r.name);
    } catch { /* sem nome, o texto diz "de destino" */ }
  }

  const feito = { redirecionados: 0, perdidos: 0, encerrados: 0, revisoes: 0, pulados: 0, erros: 0 };
  const bitrix = {};
  let tentadas = 0;
  for (const d of decisoes) {
    if (tentadas >= limite || Date.now() - inicio > PRAZO_MS) break;
    tentadas++;
    try {
      if (d.acao === 'redirecionar') {
        if (await redirecionar(d)) feito.redirecionados++; else feito.pulados++;
      } else if (d.acao === 'perder') {
        const r = await perder(d, motivoId);
        if (r.ok) { feito.perdidos++; bitrix[r.bitrix] = (bitrix[r.bitrix] || 0) + 1; } else feito.pulados++;
      } else if (d.acao === 'revisar') {
        if (await revisar(d, nomeDestino.get(d.regra.redirect_cadence_id))) feito.revisoes++; else feito.pulados++;
      } else if (await encerrar(d)) {
        feito.encerrados++;
      }
    } catch (e) {
      feito.erros++;
      console.warn('[cadencia-sweep] ação falhou:', d.acao, d.lead.id, String(e?.message || '').slice(0, 200));
    }
  }

  Object.assign(saida, feito, { bitrix, restam: decisoes.length - tentadas, ms: Date.now() - inicio });
  console.log(`[cadencia-sweep] ${JSON.stringify(saida)}`);
  // 500 só quando TUDO o que tentou falhou (aí o alerta da Vercel serve pra algo).
  return res.status(tentadas > 0 && feito.erros === tentadas ? 500 : 200).json(saida);
}
