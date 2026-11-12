// api/qs-alertas.js
// -----------------------------------------------------------------------------
// ALARMES DA GESTÃO (09/11/2026) — avisa admin + gestores quando algo quebra.
//
// Cron da Vercel a cada 15 min (GET com Bearer CRON_SECRET, igual a /api/avisos).
// Só roda de 8h às 20h (Brasília), segunda a sábado. Checagens (só leitura):
//   a) reuniões que não subiram pro Bitrix (bitrix_synced=false há > 30 min, nas
//      últimas 24h) ≥ 2, ou qualquer uma em que o reparo "desisti" (24h);
//   b) entrada de leads hoje até agora < 50% da média do mesmo horário nos 7 dias
//      úteis (seg–sáb) anteriores — só depois das 12h e se a média for ≥ 4;
//   c) WhatsApp parado: qs_settings 'wa_meta_pulso' sem batida há > 30 min (a
//      partir das 8h30, pra não acusar o silêncio da madrugada);
//   d) cartões do closer com bitrix_status='pendente' criados há > 24h, acima de 20;
//   e) gravações achadas (gravacao_status='achada') que não foram pro Bitrix
//      (bitrix_gravacao_em nulo) há > 1 dia — aviso baixo;
//   f) leads abertos (nao_iniciado/em_prospeccao, criados há > 1 h) SEM NENHUMA
//      tarefa pendente/atrasada — somem da fila do SDR (12/11/2026: 224, dos
//      quais 181 parados atrás de cadência congelada) — aviso baixo.
//   g) leads ABERTOS sem card no Bitrix (bitrix_id nulo) criados há mais de 30 min
//      (12/11/2026, diretriz "todo card do QS nasce no Bitrix"; rotina de nova
//      tentativa em api/_leadCardBitrix.js).
//   h) (12/11) cartões do closer esperando o Bitrix (pendente/erro) há > 6 h
//      (bitrix_pendente_em da 0365; sem ela, atualizado_em) — qualquer um;
//   i) (12/11) pessoas sem contato no Bitrix há > 2 h (fila rel_clientes_bitrix
//      da 0366; sem ela, rel_clientes sem bitrix_contato_id) — aviso baixo.
//
// Canal: o sininho do QS (qs_avisos via rpc qs_aviso_criar, o mesmo dos avisos de
// prazo/reunião). Dedupe: cada alerta no máximo 1x a cada 6h (aviso baixo: 24h);
// o estado fica em qs_settings 'qs_alertas_estado' = { [id]: ultimoEnvioISO }.
//
// `?seco=1` → devolve o que alertaria, sem mandar nada nem gravar estado (roda
// fora do horário também, pra dar pra testar).
//
// f) (12/11/2026) automações paradas/pulando/falhando — regra e catálogo em
//    api/_rotinaPulso.js (cada cron grava um pulso em qs_settings 'rotina_pulso:*').
//
// COMO PÔR UM ALERTA NOVO (sem mexer no resto): escreva a regra pura e uma
// função `checarX(agoraMs)` que devolve { dados, alerta } (um alerta ou null) ou
// { dados, alertas: [...] } (vários), e acrescente UMA linha em CHECAGENS.
// Cada alerta = { id (estável — é a chave do dedupe), nivel: 'alto'|'baixo',
// titulo, texto }. Uma checagem que lança não derruba as outras.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { checarRotinas } from './_rotinaPulso.js';

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const BRT_OFFSET_MS = 3 * HORA; // Brasil sem horário de verão desde 2019: UTC-3 fixo.
const CHAVE_ESTADO = 'qs_alertas_estado';
const JANELA_PADRAO_MS = 6 * HORA;
const JANELA_BAIXA_MS = 24 * HORA;

// ---------------------------------------------------------------- relógio BRT

/** Partes da data/hora em Brasília (UTC-3). dow: 0=domingo … 6=sábado. */
export function relogioBRT(agoraMs) {
  const d = new Date(agoraMs - BRT_OFFSET_MS);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dia = d.getUTCDate();
  return {
    hora: d.getUTCHours(),
    minuto: d.getUTCMinutes(),
    dow: d.getUTCDay(),
    minutosDoDia: d.getUTCHours() * 60 + d.getUTCMinutes(),
    // 00:00 de hoje em Brasília, em ms UTC.
    inicioDoDiaMs: Date.UTC(y, m, dia) + BRT_OFFSET_MS,
  };
}

/** Seg–sáb, 8h00 até 19h59 (Brasília). */
export function dentroDoHorario(agoraMs) {
  const r = relogioBRT(agoraMs);
  return r.dow >= 1 && r.dow <= 6 && r.hora >= 8 && r.hora < 20;
}

// ---------------------------------------------------------------- regras puras

/** a) reuniões sem Bitrix. */
export function regraReunioesBitrix({ pendentes, desistidas }) {
  if (desistidas > 0 || pendentes >= 2) {
    const partes = [];
    if (pendentes) partes.push(`${pendentes} reunião(ões) há mais de 30 min sem subir pro Bitrix`);
    if (desistidas) partes.push(`${desistidas} em que o reparo desistiu`);
    return {
      id: 'reunioes_bitrix',
      nivel: 'alto',
      titulo: 'Reuniões não estão indo pro Bitrix',
      texto: `${partes.join(' e ')} (últimas 24h). Card do Bitrix pode não estar andando.`,
    };
  }
  return null;
}

/**
 * b) entrada de leads. `instantesMs` = created_at (ms) dos leads desde o início
 * do 1º dia comparado. Compara hoje até agora com o mesmo trecho do dia nos 7
 * dias úteis (seg–sáb) anteriores.
 */
export function avaliarEntrada(instantesMs, agoraMs, { diasComparar = 7 } = {}) {
  const r = relogioBRT(agoraMs);
  const trechoMs = r.minutosDoDia * MIN;
  const dias = [];
  let ini = r.inicioDoDiaMs;
  while (dias.length < diasComparar) {
    ini -= DIA;
    const dow = new Date(ini - BRT_OFFSET_MS + HORA).getUTCDay(); // meio da madrugada BRT → dia certo
    if (dow === 0) continue; // domingo não é dia útil
    dias.push(ini);
  }
  const contar = (de, ate) => instantesMs.filter((t) => t >= de && t < ate).length;
  const hoje = contar(r.inicioDoDiaMs, agoraMs + 1);
  const porDia = dias.map((d) => contar(d, d + trechoMs));
  const media = porDia.length ? porDia.reduce((s, n) => s + n, 0) / porDia.length : 0;
  return { hoje, media, porDia, desdeMs: dias.length ? dias[dias.length - 1] : r.inicioDoDiaMs };
}

export function regraEntradaLeads(av, agoraMs, { mediaMinima = 4 } = {}) {
  if (relogioBRT(agoraMs).hora < 12) return null;
  if (av.media < mediaMinima) return null; // base pequena demais = ruído
  if (av.hoje >= av.media * 0.5) return null;
  return {
    id: 'entrada_leads',
    nivel: 'alto',
    titulo: 'Entrada de leads muito abaixo do normal',
    texto: `Hoje entraram ${av.hoje} lead(s) até agora; nesse horário a média dos últimos 7 dias úteis é ${av.media.toFixed(1)}. Conferir formulários/LPs/webhook.`,
  };
}

/** c) WhatsApp parado: valor de qs_settings 'wa_meta_pulso' ({ ultimo_em, … }). */
export function regraPulsoWhatsApp(valor, updatedAt, agoraMs) {
  const r = relogioBRT(agoraMs);
  if (r.minutosDoDia < 8 * 60 + 30) return null;
  const ultimo = Date.parse((valor && (valor.ultimo_em || valor.ultimo_valido_em)) || updatedAt || '');
  const parado = Number.isFinite(ultimo) ? agoraMs - ultimo : Infinity;
  if (parado <= 30 * MIN) return null;
  const quanto = Number.isFinite(parado) ? `há ${Math.round(parado / MIN)} min` : 'sem registro';
  return {
    id: 'whatsapp_parado',
    nivel: 'alto',
    titulo: 'WhatsApp parado: nada chega da Meta',
    texto: `Última batida do webhook da Meta ${quanto}. Mensagens podem não estar entrando no QS.`,
  };
}

/** d) cartões do closer presos em "pendente". */
export function regraCloserPendente(qtd, { limite = 20 } = {}) {
  if (qtd <= limite) return null;
  return {
    id: 'closer_pendente',
    nivel: 'alto',
    titulo: 'Cartões do closer presos sem Bitrix',
    texto: `${qtd} cartão(ões) do closer com Bitrix "pendente" há mais de 24h. O envio ao Bitrix pode estar parado.`,
  };
}

/** e) gravações achadas que não foram pro Bitrix (aviso baixo). */
export function regraGravacoes(qtd) {
  if (qtd <= 0) return null;
  return {
    id: 'gravacoes_sem_bitrix',
    nivel: 'baixo',
    titulo: 'Gravações achadas que não foram pro Bitrix',
    texto: `${qtd} gravação(ões) achada(s) há mais de 1 dia ainda sem ir pro card do Bitrix.`,
  };
}

/**
 * f) leads abertos sem nenhuma atividade pendente (aviso baixo).
 * `leads` = [{ id, cadence_id }] abertos; `comTarefa` = Set de lead_id com
 * tarefa aberta; `cadAtiva` = Set de cadências "disponivel".
 */
export function regraLeadsSemAtividade(leads, comTarefa, cadAtiva) {
  const sem = leads.filter((l) => !comTarefa.has(l.id));
  if (!sem.length) return { qtd: 0, semCadencia: 0, cadenciaPausada: 0, cadenciaAtiva: 0, alerta: null };
  const semCadencia = sem.filter((l) => !l.cadence_id).length;
  const cadenciaAtiva = sem.filter((l) => l.cadence_id && cadAtiva.has(l.cadence_id)).length;
  const cadenciaPausada = sem.length - semCadencia - cadenciaAtiva;
  const partes = [];
  if (cadenciaAtiva) partes.push(`${cadenciaAtiva} em cadência ativa que terminou`);
  if (cadenciaPausada) partes.push(`${cadenciaPausada} em cadência congelada/rascunho`);
  if (semCadencia) partes.push(`${semCadencia} sem cadência`);
  return {
    qtd: sem.length, semCadencia, cadenciaPausada, cadenciaAtiva,
    alerta: {
      id: 'leads_sem_atividade',
      nivel: 'baixo',
      titulo: 'Leads abertos sem nenhuma atividade',
      texto: `${sem.length} lead(s) aberto(s) sem nenhuma tarefa pendente — não aparecem na fila de ninguém (${partes.join(', ')}).`,
    },
  };
}

/** f) leads abertos sem card no Bitrix há mais de X min (12/11/2026). */
export const LEADS_SEM_CARD_MIN = 30;
export function regraLeadsSemCard(qtd, { rotinaLigada = false, minutos = LEADS_SEM_CARD_MIN } = {}) {
  if (qtd <= 0) return null;
  return {
    id: 'leads_sem_card',
    nivel: 'alto',
    titulo: 'Leads sem card no Bitrix',
    texto: `${qtd} lead(s) aberto(s) sem card no Bitrix há mais de ${minutos} min. ` +
      (rotinaLigada
        ? 'A rotina está tentando de novo; se o número não cair, conferir o Bitrix.'
        : 'A rotina de nova tentativa está DESLIGADA (LEADS_BITRIX_RETENTATIVA_LIGADA) — ninguém está criando esses cards.'),
  };
}

/** f) cartões do closer esperando o Bitrix há mais de X horas (12/11). */
export function regraCloserAtrasado(qtd, { horas = 6, automatico = false } = {}) {
  if (qtd <= 0) return null;
  return {
    id: 'closer_bitrix_atrasado',
    nivel: 'alto',
    titulo: 'Cartões do closer sem ir pro Bitrix',
    texto: `${qtd} cartão(ões) do closer esperando o Bitrix (pendente ou com erro) há mais de ${horas}h.` +
      (automatico ? ' O reenvio automático está ligado: conferir os erros nos cartões.' : ' O reenvio automático está DESLIGADO (CLOSER_CRON_BITRIX_LIGADO): use "Enviar agora" no cartão.'),
  };
}

/** g) pessoas do QS sem contato no Bitrix (12/11). Aviso baixo. */
export function regraPessoasSemContato(qtd, { horas = 2, automatico = false } = {}) {
  if (qtd <= 0) return null;
  return {
    id: 'pessoas_sem_bitrix',
    nivel: 'baixo',
    titulo: 'Pessoas sem contato no Bitrix',
    texto: `${qtd} pessoa(s) cadastrada(s) no QS sem contato no Bitrix há mais de ${horas}h.` +
      (automatico ? ' O envio automático está ligado: conferir as que falharam (ficha › Contato).' : ' O envio automático está DESLIGADO (REL_PESSOA_BITRIX_LIGADO): use "Enviar agora" na ficha.'),
  };
}

/** Dedupe: devolve os alertas que podem sair agora e o estado novo. */
export function filtrarDedupe(alertas, estado, agoraMs) {
  const base = estado && typeof estado === 'object' && !Array.isArray(estado) ? estado : {};
  const novo = { ...base };
  const enviar = [];
  for (const a of alertas) {
    const janela = a.nivel === 'baixo' ? JANELA_BAIXA_MS : JANELA_PADRAO_MS;
    const ultimo = Date.parse(base[a.id] || '');
    if (Number.isFinite(ultimo) && agoraMs - ultimo < janela) continue;
    enviar.push(a);
    novo[a.id] = new Date(agoraMs).toISOString();
  }
  return { enviar, novoEstado: novo };
}

// ---------------------------------------------------------------- leitura

const iso = (ms) => new Date(ms).toISOString();

/** Lê todas as linhas (pagina de 1000 em 1000 — teto do PostgREST). */
async function listarTudo(path, ordem) {
  const linhas = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const lote = await rest(`${path}&order=${ordem}&limit=1000&offset=${offset}`);
    if (!Array.isArray(lote)) break;
    linhas.push(...lote);
    if (lote.length < 1000) break;
  }
  return linhas;
}

const contar = async (path) => (await listarTudo(path, 'id.asc')).length;

async function checarReunioes(agoraMs) {
  const desde = iso(agoraMs - DIA), ate = iso(agoraMs - 30 * MIN);
  const pendentes = await contar(
    `qs_meetings?select=id&bitrix_synced=eq.false&created_at=gte.${desde}&created_at=lt.${ate}`);
  const desistidas = await contar(
    `qs_meetings?select=id&bitrix_error=ilike.*desisti*&created_at=gte.${desde}`);
  return { dados: { pendentes, desistidas }, alerta: regraReunioesBitrix({ pendentes, desistidas }) };
}

async function checarLeads(agoraMs) {
  if (relogioBRT(agoraMs).hora < 12) return { dados: { pulado: 'antes das 12h' }, alerta: null };
  const desdeMs = avaliarEntrada([], agoraMs).desdeMs;
  const linhas = await listarTudo(`qs_leads?select=id,created_at&created_at=gte.${iso(desdeMs)}`, 'created_at.asc,id.asc');
  const av = avaliarEntrada(linhas.map((l) => Date.parse(l.created_at)).filter(Number.isFinite), agoraMs);
  return { dados: { hoje: av.hoje, media: Number(av.media.toFixed(2)), porDia: av.porDia }, alerta: regraEntradaLeads(av, agoraMs) };
}

async function checarPulso(agoraMs) {
  const rows = await rest(`qs_settings?select=value,updated_at&key=eq.wa_meta_pulso&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  return {
    dados: { ultimo_em: row?.value?.ultimo_em ?? null, updated_at: row?.updated_at ?? null },
    alerta: regraPulsoWhatsApp(row?.value, row?.updated_at, agoraMs),
  };
}

async function checarCloser(agoraMs) {
  const qtd = await contar(
    `qs_closer_negocios?select=id&bitrix_status=eq.pendente&criado_em=lt.${iso(agoraMs - DIA)}`);
  return { dados: { pendentes24h: qtd }, alerta: regraCloserPendente(qtd) };
}

async function checarGravacoes(agoraMs) {
  // "há > 1 dia": a reunião já devia ter terminado faz um dia (scheduled_at).
  const qtd = await contar(
    `qs_meetings?select=id&gravacao_status=eq.achada&bitrix_gravacao_em=is.null&scheduled_at=lt.${iso(agoraMs - DIA)}`);
  return { dados: { gravacoes: qtd }, alerta: regraGravacoes(qtd) };
}

async function checarLeadsSemAtividade(agoraMs) {
  // Lead que acabou de entrar ainda pode estar ganhando o plano: 1 h de folga.
  const leads = await listarTudo(
    `qs_leads?select=id,cadence_id&status=in.(nao_iniciado,em_prospeccao)&created_at=lt.${iso(agoraMs - HORA)}`, 'id.asc');
  const tarefas = await listarTudo('qs_tasks?select=id,lead_id&status=in.(pendente,atrasada)', 'id.asc');
  const cads = await rest('qs_cadences?select=id&status=eq.disponivel');
  const r = regraLeadsSemAtividade(
    leads, new Set(tarefas.map((t) => t.lead_id)), new Set((cads || []).map((c) => c.id)));
  const { alerta, ...dados } = r;
  return { dados, alerta };
}

async function checarLeadsSemCard(agoraMs) {
  // Só bitrix_id nulo (não depende da 0362): aberto = não perdido.
  const qtd = await contar(
    `qs_leads?select=id&bitrix_id=is.null&status=in.(nao_iniciado,em_prospeccao,ganho)` +
    `&created_at=lt.${iso(agoraMs - LEADS_SEM_CARD_MIN * MIN)}`);
  const rotinaLigada = ['1', 'true', 'sim', 'on'].includes(String(process.env.LEADS_BITRIX_RETENTATIVA_LIGADA || '').trim().toLowerCase());
  return { dados: { leadsSemCard: qtd, rotinaLigada }, alerta: regraLeadsSemCard(qtd, { rotinaLigada }) };
}

const ligado = (k) => String(process.env[k] || '').trim() === '1';
const faltaColuna = (e, nome) => new RegExp(nome).test(String(e?.message || ''));

async function checarCloserAtrasado(agoraMs) {
  const limite = iso(agoraMs - 6 * HORA);
  let qtd;
  try {
    qtd = await contar(`qs_closer_negocios?select=id&bitrix_status=in.(pendente,erro)&arquivado_em=is.null&bitrix_pendente_em=lt.${limite}`);
  } catch (e) {
    if (!faltaColuna(e, 'bitrix_pendente_em')) throw e; // banco sem a 0365
    qtd = await contar(`qs_closer_negocios?select=id&bitrix_status=in.(pendente,erro)&arquivado_em=is.null&atualizado_em=lt.${limite}`);
  }
  return { dados: { atrasados6h: qtd }, alerta: regraCloserAtrasado(qtd, { automatico: ligado('CLOSER_CRON_BITRIX_LIGADO') }) };
}

async function checarPessoas(agoraMs) {
  const limite = iso(agoraMs - 2 * HORA);
  let qtd;
  try {
    qtd = (await listarTudo(`rel_clientes_bitrix?select=cliente_id&status=in.(pendente,falhou,sem_dados)&pendente_em=lt.${limite}`, 'cliente_id.asc')).length;
  } catch (e) {
    if (!faltaColuna(e, 'rel_clientes_bitrix')) throw e; // banco sem a 0366
    qtd = await contar(`rel_clientes?select=id&bitrix_contato_id=is.null&mesclado_em_id=is.null&arquivado_em=is.null&criado_em=lt.${limite}`);
  }
  return { dados: { pessoasSemContato: qtd }, alerta: regraPessoasSemContato(qtd, { automatico: ligado('REL_PESSOA_BITRIX_LIGADO') }) };
}

// ---------------------------------------------------------------- envio

async function destinatarios() {
  const rows = await rest('qs_users?select=id,name&is_active=eq.true&role=in.(admin,gestor)');
  return Array.isArray(rows) ? rows : [];
}

async function lerEstado() {
  const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE_ESTADO}&limit=1`);
  return (Array.isArray(rows) && rows[0]?.value) || {};
}

async function gravarEstado(valor) {
  await rest('qs_settings?on_conflict=key', {
    method: 'POST',
    body: { key: CHAVE_ESTADO, value: valor, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

async function enviarAviso(userId, alerta, agoraMs) {
  await rest('rpc/qs_aviso_criar', {
    method: 'POST',
    body: {
      p_user: userId,
      p_tipo: 'alerta',
      p_area: 'comercial',
      p_titulo: `${alerta.nivel === 'baixo' ? 'Aviso' : 'Alerta'}: ${alerta.titulo}`,
      p_texto: alerta.texto,
      p_link: null,
      p_origem: 'qs_alertas',
      p_origem_id: alerta.id,
      p_chave: `alerta:${alerta.id}:${iso(agoraMs).slice(0, 16)}`,
    },
  });
}

// Checagens que moram em outro arquivo (cada uma com seu catálogo/teste).
const CHECAGENS_EXTERNAS = {
  rotinas: checarRotinas,
};

// ---------------------------------------------------------------- handler

const CHECAGENS = {
  reunioes_bitrix: checarReunioes,
  entrada_leads: checarLeads,
  whatsapp_parado: checarPulso,
  closer_pendente: checarCloser,
  gravacoes_sem_bitrix: checarGravacoes,
  leads_sem_atividade: checarLeadsSemAtividade,
  leads_sem_card: checarLeadsSemCard,
  closer_bitrix_atrasado: checarCloserAtrasado,
  pessoas_sem_bitrix: checarPessoas,
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  const params = new URL(req.url || '/', 'http://x').searchParams;
  const seco = params.get('seco') === '1';
  const agoraMs = Date.now();

  if (!seco && !dentroDoHorario(agoraMs)) {
    return res.status(200).json({ pulado: 'fora do horário (seg–sáb 8h–20h)' });
  }

  const saida = { seco, dados: {}, erros: {}, alertas: [] };
  for (const [id, fn] of Object.entries({ ...CHECAGENS, ...CHECAGENS_EXTERNAS })) {
    try {
      const r = await fn(agoraMs);
      saida.dados[id] = r.dados;
      if (r.alerta) saida.alertas.push(r.alerta);
      if (Array.isArray(r.alertas)) saida.alertas.push(...r.alertas.filter(Boolean));
    } catch (e) {
      saida.erros[id] = String(e?.message || 'falhou').slice(0, 200);
    }
  }

  let estado = {};
  try { estado = await lerEstado(); } catch (e) { saida.erros.estado = String(e?.message || '').slice(0, 200); }
  const { enviar } = filtrarDedupe(saida.alertas, estado, agoraMs);
  saida.enviar = enviar.map((a) => a.id);

  if (seco) {
    try { saida.destinatarios = (await destinatarios()).map((u) => u.name); } catch { /* só informativo */ }
    return res.status(200).json(saida);
  }

  if (enviar.length) {
    let pessoas = [];
    try { pessoas = await destinatarios(); } catch (e) { saida.erros.destinatarios = String(e?.message || '').slice(0, 200); }
    const enviados = [];
    for (const a of enviar) {
      let ok = 0;
      for (const p of pessoas) {
        try { await enviarAviso(p.id, a, agoraMs); ok++; } catch (e) {
          console.warn(`[qs-alertas] aviso ${a.id} → ${p.id} falhou:`, String(e?.message || '').slice(0, 200));
        }
      }
      if (ok) enviados.push(a);
    }
    saida.enviados = enviados.map((a) => a.id);
    // Só marca no estado o que de fato saiu (falhou = tenta de novo em 15 min).
    if (enviados.length) {
      const { novoEstado } = filtrarDedupe(enviados, estado, agoraMs);
      try { await gravarEstado(novoEstado); } catch (e) { saida.erros.gravarEstado = String(e?.message || '').slice(0, 200); }
    }
  }

  console.log(`[qs-alertas] ${JSON.stringify({ alertas: saida.alertas.map((a) => a.id), enviados: saida.enviados || [], erros: saida.erros })}`);
  return res.status(200).json(saida);
}
