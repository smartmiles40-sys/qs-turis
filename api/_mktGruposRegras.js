// api/_mktGruposRegras.js
// -----------------------------------------------------------------------------
// GRUPOS DO WHATSAPP DO MARKETING (0243, 30/10/2026) — as regras PURAS.
// Nada aqui fala com rede nem com banco: é o que dá pra testar
// (tests/mkt-grupos/regras.test.ts). Quem lê o banco e chama a Evolution é
// api/_mktGruposEvo.js e api/_mktGruposMotor.js.
//
// Trazido do SendFlow (~/sendflow: src/lib/dispatch/fanout.ts, ritmo.ts,
// src/lib/whatsapp/evolution.ts) e adaptado ao QS.
//
// REGRAS DO BRUNO que este arquivo materializa:
//   • Grupo só pelo CHIP (Evolution). Massa pra pessoa só pela API oficial —
//     por isso o destino de campanha aqui é SEMPRE grupo (…@g.us).
//   • Pela instância do Relacionamento "de forma alguma deve sair mensagem":
//     motivoBloqueioInstancia() recusa a instância do Rel e de qualquer setor
//     que não seja o Marketing. A MESMA regra existe no banco
//     (mkt_grupos_motivo_bloqueio, 0243) — se uma camada falhar, a outra segura.
// -----------------------------------------------------------------------------

// Endereço de grupo do WhatsApp: "1203634…@g.us" (ou o antigo "5511…-1612…@g.us").
const JID_GRUPO = /^[0-9]+(-[0-9]+)?@g\.us$/;
export const ehGrupo = (jid) => JID_GRUPO.test(String(jid || ''));
/** Conversa com pessoa (telefone ou @lid). */
export const ehPessoa = (jid) => /^[0-9]+@(s\.whatsapp\.net|lid)$/.test(String(jid || ''));

// ── TRAVA DE INSTÂNCIA ──────────────────────────────────────────────────────

/** A instância do Rel que já existe no QS (0137, docs/REL-GRUPOS.md). */
export const INSTANCIAS_FIXAS_PROIBIDAS = ['relacionamento-grupos-4183'];
/** O número do Relacionamento (+55 11 98012-4183). */
export const NUMEROS_FIXOS_PROIBIDOS = ['5511980124183'];

// Palavras de OUTRO setor no nome da instância. "rel" sozinho só conta como
// palavra inteira (rel, rel-grupos, grupos_rel) pra não pegar "relampago".
const OUTRO_SETOR = /(relacionamento|comercial|closer|sdr|financeiro|operac|(^|[^a-z])rel([^a-z]|$))/;
const DO_MARKETING = /(marketing|mkt)/;

export const normalizarInstancia = (s) => String(s ?? '').trim().toLowerCase();
export const digitos = (s) => String(s ?? '').replace(/\D/g, '');
/** 55 + DDD + 9 + 8 dígitos → sem o 9 (o WhatsApp às vezes guarda assim). */
export const semNono = (n) => digitos(n).replace(/^(55\d{2})9(\d{8})$/, '$1$2');

/**
 * Devolve o MOTIVO pelo qual esta instância NÃO pode mandar nada pelo
 * Marketing, ou null quando está liberada. Igual à função do banco.
 *   proibidas: nomes de instância de outros setores (env do Rel, linhas dos SDRs, lista do banco)
 *   numerosProibidos: telefones de outros setores
 *   fixada: se MKT_GRUPOS_INSTANCIA estiver definida, só ELA vale
 */
export function motivoBloqueioInstancia(instancia, numero, { proibidas = [], numerosProibidos = [], fixada = '' } = {}) {
  const i = normalizarInstancia(instancia);
  if (!i) return 'Nenhuma instância do Marketing configurada.';
  if (!DO_MARKETING.test(i)) return `A instância "${instancia}" não é do Marketing (o nome precisa ter "marketing" ou "mkt").`;
  if (OUTRO_SETOR.test(i)) return `A instância "${instancia}" tem nome de outro setor — envio bloqueado.`;
  const lista = new Set([...INSTANCIAS_FIXAS_PROIBIDAS, ...proibidas].map(normalizarInstancia).filter(Boolean));
  if (lista.has(i)) return `A instância "${instancia}" é de outro setor (Relacionamento/Comercial) — envio bloqueado.`;
  const fix = normalizarInstancia(fixada);
  if (fix && fix !== i) return `A instância "${instancia}" não é a fixada em MKT_GRUPOS_INSTANCIA — envio bloqueado.`;
  const n = semNono(numero);
  if (n) {
    const nums = new Set([...NUMEROS_FIXOS_PROIBIDOS, ...numerosProibidos].map(semNono).filter(Boolean));
    if (nums.has(n)) return `O número ${digitos(numero)} é de outro setor (Relacionamento) — envio bloqueado.`;
  }
  return null;
}

/**
 * O caminho que vai pra Evolution termina na instância do Marketing?
 * Toda chamada passa por aqui antes do fetch: não existe caminho "solto".
 */
export function caminhoDaInstancia(caminho, instancia) {
  const c = String(caminho || '');
  const alvo = `/${encodeURIComponent(String(instancia || ''))}`;
  const semQuery = c.split('?')[0];
  if (!instancia || !semQuery.endsWith(alvo)) return false;
  // Nada de "../" nem de rota sem instância (ex.: /instance/fetchInstances lista TODAS).
  return /^\/(instance|message|group|chat|webhook)\/[A-Za-z]+\//.test(c) && !c.includes('..');
}

/**
 * Pra onde a caixa "Celular" pode responder: SÓ GRUPO (Bruno, 09/11/2026).
 * O chip do Marketing é só de grupos; conversa com pessoa (lead que manda
 * mensagem no número) não aparece no QS e não é respondida por aqui — pessoa
 * vai pela API oficial. Não há chave que libere.
 */
export function destinoDaCaixaPermitido(jid) {
  if (ehGrupo(jid)) return null;
  if (ehPessoa(jid)) return 'O chip do Marketing é só de grupos. Conversa com pessoa vai pela API oficial.';
  return 'Destino inválido.';
}

// ── CAMPANHA ────────────────────────────────────────────────────────────────

export const TIPOS = ['texto', 'imagem', 'video', 'documento', 'audio', 'enquete'];
export const TIPOS_COM_MIDIA = ['imagem', 'video', 'documento', 'audio'];
export const MAX_TEXTO = 4096;

/** O que falta pra campanha poder ser agendada. Lista vazia = pode. */
export function validarCampanha(c, { agora = new Date(), exigirData = true } = {}) {
  const erros = [];
  const tipo = String(c?.tipo || '');
  const texto = String(c?.texto || '').trim();
  if (!TIPOS.includes(tipo)) erros.push('Tipo de mensagem inválido.');
  if (!String(c?.nome || '').trim()) erros.push('Dê um nome pra campanha.');
  if (tipo === 'texto' && !texto) erros.push('Escreva a mensagem.');
  if (texto.length > MAX_TEXTO) erros.push(`Texto acima de ${MAX_TEXTO} caracteres.`);
  if (TIPOS_COM_MIDIA.includes(tipo) && !/^https:\/\//.test(String(c?.midia_url || ''))) erros.push('Escolha o arquivo (link https).');
  if (tipo === 'enquete') {
    const ops = (c?.enquete_opcoes || []).map((o) => String(o || '').trim()).filter(Boolean);
    if (!texto) erros.push('Escreva a pergunta da enquete.');
    if (ops.length < 2 || ops.length > 12) erros.push('A enquete precisa de 2 a 12 opções.');
    if (new Set(ops.map((o) => o.toLowerCase())).size !== ops.length) erros.push('Opções repetidas na enquete.');
  }
  const temDestino = (c?.tag_ids || []).length > 0 || (c?.grupo_jids || []).length > 0;
  if (!temDestino) erros.push('Escolha os grupos (por tag ou um a um). Destino vazio NÃO quer dizer "todos".');
  for (const j of c?.grupo_jids || []) if (!ehGrupo(j)) { erros.push(`Destino que não é grupo: ${j}`); break; }
  const { min, max } = intervalo(c);
  if (min < 5) erros.push('Intervalo mínimo entre grupos: 5 segundos.');
  if (max < min) erros.push('O intervalo máximo é menor que o mínimo.');
  if (exigirData) {
    const t = Date.parse(String(c?.enviar_em || ''));
    if (Number.isNaN(t)) erros.push('Diga o dia e a hora do envio.');
    else if (t < agora.getTime() - 5 * 60_000) erros.push('A data do envio já passou.');
  }
  return erros;
}

export function intervalo(c, padrao = { min: 20, max: 45 }) {
  const min = Number.isFinite(Number(c?.intervalo_min_seg)) && c?.intervalo_min_seg != null ? Number(c.intervalo_min_seg) : padrao.min;
  const max = Number.isFinite(Number(c?.intervalo_max_seg)) && c?.intervalo_max_seg != null ? Number(c.intervalo_max_seg) : Math.max(min, padrao.max);
  return { min, max };
}

/**
 * Os grupos de uma campanha: os escolhidos um a um MAIS os das tags.
 * Só grupo em que o número ainda está (sem saiu_em). Sem duplicar.
 * Grupo escolhido um a um que não está mais na lista (saiu) fica de fora e
 * vira aviso — em grupo, mandar pra quem saiu dá erro no WhatsApp.
 */
export function resolverGrupos({ tagIds = [], grupoJids = [], grupos = [], links = [] }) {
  const porJid = new Map(grupos.map((g) => [g.jid, g]));
  const tags = new Set(tagIds);
  const escolhidos = new Set(grupoJids.filter(ehGrupo));
  for (const l of links) if (tags.has(l.tag_id)) escolhidos.add(l.grupo_jid);
  const avisos = [];
  const lista = [];
  for (const jid of escolhidos) {
    const g = porJid.get(jid);
    if (!g) { avisos.push(`Grupo ${jid} não está na lista do Marketing.`); continue; }
    if (g.saiu_em) { avisos.push(`O número saiu de "${g.nome || jid}".`); continue; }
    if (g.so_admins_enviam && g.eu_admin === false) { avisos.push(`"${g.nome || jid}": só admins mandam e o número não é admin.`); continue; }
    lista.push(g);
  }
  lista.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
  return { grupos: lista, avisos };
}

/** A fila (uma linha por grupo destino), igual ao SendFlow: a fila É o estado. */
export function montarFila(campanhaId, grupos) {
  const vistos = new Set();
  const linhas = [];
  for (const g of grupos) {
    if (!ehGrupo(g.jid) || vistos.has(g.jid)) continue;
    vistos.add(g.jid);
    linhas.push({ campanha_id: campanhaId, grupo_jid: g.jid, grupo_nome: g.nome || null, status: 'pendente' });
  }
  return linhas;
}

/** Resumo contado na fila. "Chegou" = o WhatsApp aceitou no grupo (não há lido por participante). */
export function resumirFila(linhas) {
  const c = { total: 0, pendentes: 0, enviando: 0, chegaram: 0, falhas: 0, cancelados: 0, pulados: 0 };
  for (const l of linhas || []) {
    c.total += 1;
    if (l.status === 'pendente') c.pendentes += 1;
    else if (l.status === 'enviando') c.enviando += 1;
    else if (l.status === 'enviado' || l.status === 'chegou') c.chegaram += 1;
    else if (l.status === 'falha') c.falhas += 1;
    else if (l.status === 'cancelado') c.cancelados += 1;
    else if (l.status === 'pulado') c.pulados += 1;
  }
  return c;
}

/** A campanha acabou quando não sobra nada pendente nem enviando. */
export const campanhaTerminou = (r) => r.total > 0 && r.pendentes === 0 && r.enviando === 0;

/**
 * Linha presa em "enviando" (a função caiu no meio): NÃO reenvia sozinho —
 * em grupo, mensagem repetida todo mundo vê. Vira falha pra alguém conferir.
 */
export function linhaPresa(l, agora = new Date(), minutos = 5) {
  if (l?.status !== 'enviando' || !l.reivindicado_em) return false;
  return agora.getTime() - Date.parse(l.reivindicado_em) > minutos * 60_000;
}

// ── RITMO ───────────────────────────────────────────────────────────────────

export function sortearIntervaloMs(minSeg, maxSeg, aleatorio = Math.random()) {
  const min = Math.max(0, Math.floor(minSeg));
  const max = Math.max(min, Math.floor(maxSeg));
  const r = Math.min(Math.max(aleatorio, 0), 0.999999);
  return (min + Math.floor(r * (max - min + 1))) * 1000;
}

export function liberadaEm(proximoEnvioEm, agora = new Date()) {
  if (!proximoEnvioEm) return true;
  const t = Date.parse(proximoEnvioEm);
  return Number.isNaN(t) || t <= agora.getTime();
}

// America/Sao_Paulo é UTC−03:00 fixo desde 2019 (sem horário de verão).
const SP_MS = 3 * 3600_000;
const minutosSP = (d) => { const x = new Date(d.getTime() - SP_MS); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
const hhmm = (s) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

/** Janela de envio (ex.: 08:00–21:00). Fim < início = cruza a meia-noite. */
export function dentroDaJanela(agora, inicio, fim) {
  const a = minutosSP(agora); const i = hhmm(inicio); const f = hhmm(fim);
  if (i === null || f === null) return true;
  return i <= f ? a >= i && a <= f : a >= i || a <= f;
}

// ── AGENDAMENTO / RECORRÊNCIA ───────────────────────────────────────────────

/** "2026-11-03" + "19:30" (hora de SP) → ISO em UTC. */
export function isoDeSP(dataYmd, horaHm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dataYmd || ''));
  const h = hhmm(horaHm);
  if (!m || h === null) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0) + h * 60_000 + SP_MS).toISOString();
}

/** Data (YYYY-MM-DD) e dia da semana (0 = domingo) em SP. */
function diaSP(d) {
  const x = new Date(d.getTime() - SP_MS);
  return { ymd: x.toISOString().slice(0, 10), dow: x.getUTCDay() };
}

/**
 * As ocorrências de uma recorrência entre `de` (exclusivo) e `ate` (inclusivo).
 * Ex.: aquecimento da live — seg/qua/sex às 19:00 de 03/11 a 20/11.
 * Idempotente do lado do banco: índice único (recorrencia_id, enviar_em).
 */
export function ocorrencias(rec, de, ate) {
  const dias = new Set((rec?.dias_semana || []).map(Number));
  if (!dias.size || hhmm(rec?.hora) === null || !(ate > de)) return [];
  const saida = [];
  // anda dia a dia em SP, no máximo 62 dias por chamada
  let d = new Date(de.getTime());
  for (let i = 0; i < 62 && saida.length < 200; i++) {
    const { ymd, dow } = diaSP(d);
    if (dias.has(dow) && (!rec.inicio || ymd >= rec.inicio) && (!rec.fim || ymd <= rec.fim)) {
      const iso = isoDeSP(ymd, rec.hora);
      const t = Date.parse(iso);
      if (t > de.getTime() && t <= ate.getTime()) saida.push(iso);
    }
    d = new Date(d.getTime() + 86400_000);
    if (d.getTime() - 86400_000 > ate.getTime()) break;
  }
  return saida;
}

/** A campanha que uma ocorrência da recorrência vira (mesmo molde, data marcada). */
export function campanhaDaOcorrencia(rec, enviarEm) {
  return {
    nome: `${rec.nome} · ${new Date(Date.parse(enviarEm) - SP_MS).toISOString().slice(0, 16).replace('T', ' ')}`,
    tipo: rec.tipo, texto: rec.texto || '', midia_url: rec.midia_url || null, midia_nome: rec.midia_nome || null,
    enquete_opcoes: rec.enquete_opcoes || null, enquete_multipla: Boolean(rec.enquete_multipla),
    mencionar_todos: Boolean(rec.mencionar_todos), tag_ids: rec.tag_ids || [], grupo_jids: rec.grupo_jids || [],
    intervalo_min_seg: rec.intervalo_min_seg ?? null, intervalo_max_seg: rec.intervalo_max_seg ?? null,
    enviar_em: enviarEm, status: 'agendada', cadencia_id: rec.cadencia_id || null, recorrencia_id: rec.id,
  };
}

// ── ENVIO (formato da Evolution v2) ─────────────────────────────────────────

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', pdf: 'application/pdf', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4' };
export function mimeDaUrl(url, tipo) {
  const ext = (String(url || '').split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
  if (MIME[ext]) return MIME[ext];
  return tipo === 'imagem' ? 'image/jpeg' : tipo === 'video' ? 'video/mp4' : tipo === 'documento' ? 'application/pdf' : 'application/octet-stream';
}
const nomeDoArquivo = (url) => decodeURIComponent((String(url || '').split('?')[0].split('/').pop() || 'arquivo')) || 'arquivo';

/**
 * Rota e corpo do envio. Só monta: quem chama a Evolution é o _mktGruposEvo.js.
 * `mentionsEveryOne` = @todos nativo da Evolution (ela busca os participantes).
 * `citar` = { id, fromMe, participant, texto } (responder citando, na caixa).
 */
export function montarEnvio(instancia, e) {
  const number = String(e?.destino || '');
  if (!ehGrupo(number) && !ehPessoa(number)) throw new Error('Destino inválido.');
  const inst = encodeURIComponent(instancia);
  const mencao = e.mencionarTodos && ehGrupo(number) ? { mentionsEveryOne: true } : {};
  const quoted = e.citar?.id ? { quoted: { key: { id: e.citar.id, remoteJid: number, fromMe: Boolean(e.citar.fromMe), ...(e.citar.participant ? { participant: e.citar.participant } : {}) }, ...(e.citar.texto ? { message: { conversation: e.citar.texto } } : {}) } } : {};
  const tipo = e.tipo || 'texto';
  if (tipo === 'enquete') {
    const values = (e.enqueteOpcoes || []).map((o) => String(o).trim()).filter(Boolean);
    return { caminho: `/message/sendPoll/${inst}`, corpo: { number, name: e.texto, selectableCount: e.enqueteMultipla ? values.length : 1, values, ...mencao } };
  }
  if (tipo === 'texto' || !e.midiaUrl) {
    return { caminho: `/message/sendText/${inst}`, corpo: { number, text: e.texto, linkPreview: true, ...mencao, ...quoted } };
  }
  if (tipo === 'audio') {
    return { caminho: `/message/sendWhatsAppAudio/${inst}`, corpo: { number, audio: e.midiaUrl, ...mencao, ...quoted } };
  }
  const mediatype = tipo === 'imagem' ? 'image' : tipo === 'video' ? 'video' : 'document';
  return {
    caminho: `/message/sendMedia/${inst}`,
    corpo: {
      number, mediatype, mimetype: mimeDaUrl(e.midiaUrl, tipo), media: e.midiaUrl,
      ...(e.texto ? { caption: e.texto } : {}),
      ...(mediatype === 'document' ? { fileName: e.midiaNome || nomeDoArquivo(e.midiaUrl) } : {}),
      ...mencao, ...quoted,
    },
  };
}

/** Linha da fila + campanha → envio. */
export const envioDaFila = (linha, camp) => ({
  destino: linha.grupo_jid, tipo: camp.tipo, texto: camp.texto || '', midiaUrl: camp.midia_url, midiaNome: camp.midia_nome,
  mencionarTodos: camp.mencionar_todos, enqueteOpcoes: camp.enquete_opcoes, enqueteMultipla: camp.enquete_multipla,
});

/** Erro que não melhora repetindo (grupo não existe, não é admin…). */
export function erroPermanente(msg) {
  return /\b4(00|01|03|04)\b|not-authorized|forbidden|item-not-found|\[object Object\]|not-acceptable/i.test(String(msg || ''));
}

const ERROS = [
  [/\[object Object\]/, 'o WhatsApp recusou: grupo não encontrado (o número ainda participa?)'],
  [/not-authorized|forbidden/i, 'o WhatsApp recusou: o número precisa ser admin do grupo'],
  [/item-not-found/i, 'o WhatsApp não encontrou o grupo ou a mensagem'],
  [/rate-overlimit/i, 'o WhatsApp pediu pra ir mais devagar'],
  [/Reaction must be a single emoji/i, 'use um emoji só na reação'],
];
export function traduzirErro(msg) {
  const m = String(msg || '');
  for (const [re, frase] of ERROS) if (re.test(m)) return `${frase}. (${m.slice(0, 120)})`;
  return m.slice(0, 300);
}

// ── LEITURA DA EVOLUTION ────────────────────────────────────────────────────

const telDe = (s) => { const d = digitos(String(s || '').split('@')[0].split(':')[0]); return d.length >= 10 ? d : null; };

/** findGroupInfos → colunas de mkt_grupos. `meuNumero` decide eu_admin. */
export function lerGrupo(info, meuNumero) {
  const parts = Array.isArray(info?.participants) ? info.participants : [];
  const meu = semNono(meuNumero);
  const lista = parts.map((p) => ({
    id: String(p?.id || ''), telefone: telDe(p?.phoneNumber) || telDe(p?.jid) || telDe(p?.id),
    admin: p?.admin || null,
  })).filter((p) => p.id);
  const admins = lista.filter((p) => p.admin);
  const souEu = (p) => meu && p.telefone && semNono(p.telefone) === meu;
  const tamanho = typeof info?.size === 'number' ? info.size : (parts.length || null);
  return {
    jid: String(info?.id || ''),
    nome: info?.subject ?? null,
    descricao: info?.desc ?? null,
    foto_url: info?.pictureUrl || null,
    participantes: tamanho,
    so_admins_enviam: typeof info?.announce === 'boolean' ? info.announce : null,
    so_admins_editam: typeof info?.restrict === 'boolean' ? info.restrict : null,
    dono: info?.owner || null,
    ...(parts.length ? { participantes_lista: lista, admins, eu_admin: lista.some((p) => p.admin && souEu(p)) } : {}),
  };
}

/** findChats → itens da caixa (grupos primeiro marcados). */
export function lerConversas(brutas) {
  return (Array.isArray(brutas) ? brutas : []).map((c) => {
    const jid = String(c?.remoteJid || c?.id || '');
    const ultima = c?.lastMessage || {};
    const msg = ultima?.message || {};
    return {
      jid,
      grupo: ehGrupo(jid),
      nome: c?.pushName || c?.name || c?.subject || jid.split('@')[0],
      foto_url: c?.profilePicUrl || null,
      nao_lidas: Number(c?.unreadCount || 0),
      ultima_em: c?.updatedAt || (ultima?.messageTimestamp ? new Date(Number(ultima.messageTimestamp) * 1000).toISOString() : null),
      previa: String(msg?.conversation || msg?.extendedTextMessage?.text || msg?.imageMessage?.caption || (msg?.imageMessage ? '📷 Foto' : '') || (msg?.audioMessage ? '🎤 Áudio' : '') || '').slice(0, 140),
    };
  // Só grupos: conversas particulares do chip nunca saem do servidor (09/11/2026).
  }).filter((c) => ehGrupo(c.jid));
}

/** findMessages → bolhas. */
export function lerMensagens(registros) {
  return (Array.isArray(registros) ? registros : []).map((r) => {
    const k = r?.key || {};
    const m = r?.message || {};
    const tipo = m.conversation || m.extendedTextMessage ? 'texto' : m.imageMessage ? 'imagem' : m.videoMessage ? 'video' : m.audioMessage ? 'audio' : m.documentMessage ? 'documento' : m.pollCreationMessage || m.pollCreationMessageV3 ? 'enquete' : m.reactionMessage ? 'reacao' : m.stickerMessage ? 'figurinha' : 'outro';
    return {
      id: String(k.id || ''), de_mim: Boolean(k.fromMe), autor: k.participant || null,
      autor_nome: r?.pushName || null, tipo,
      texto: String(m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || m.documentMessage?.fileName || m.pollCreationMessage?.name || m.pollCreationMessageV3?.name || m.reactionMessage?.text || ''),
      quando: r?.messageTimestamp ? new Date(Number(r.messageTimestamp) * 1000).toISOString() : null,
    };
  }).filter((m) => m.id && m.tipo !== 'reacao');
}
