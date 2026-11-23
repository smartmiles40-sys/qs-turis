// api/_relDisparoRegras.js
// -----------------------------------------------------------------------------
// DISPARO DO RELACIONAMENTO "IGUAL AO MANYCHAT" (0408, 19/11/2026) — regras PURAS.
//
// Sem banco e sem Meta (provadas em tests/rel-disparo/regras.test.ts). Quem
// fala com o banco e com a Meta é api/_relDisparoOficial.js. As regras do envio
// (componentes do modelo, erros da Meta, tier, preço) são as do Marketing
// (api/_mktOficialRegras.js) — aqui só o que é do Rel.
// -----------------------------------------------------------------------------

export const RITMO_REL = {
  por_segundo: 3, por_dia: 400, margem_tier: 0.6,
  inicio: '09:00', fim: '19:00', dias: [1, 2, 3, 4, 5, 6], tier_padrao: 'TIER_250', intervalo_dias: 7,
};

/**
 * O envio REAL do Rel só acontece com TODAS as travas ligadas:
 *   1. env REL_DISPARO_ENVIO=1 na Vercel;
 *   2. qs_settings.rel_disparo_simulacao = false;
 *   3. número do Relacionamento conectado (qs_wa_numeros_meta, setor relacionamento);
 *   4. o QS tem o token desse número.
 */
export function travasDoEnvioRel({ envLigado, simulacao, numero, temToken }) {
  const motivos = [];
  if (!envLigado) motivos.push('a trava REL_DISPARO_ENVIO=1 não está ligada na Vercel');
  if (simulacao !== false) motivos.push('o modo simulação do Relacionamento está ligado');
  if (!numero?.phone_number_id) motivos.push('o Relacionamento não tem número conectado');
  else if (!temToken) motivos.push('o QS não tem o token do número do Relacionamento (conecte pelo painel de WhatsApp)');
  return { real: motivos.length === 0, motivos };
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

/** " VIP  Japão " → "vip japão". Vazio ou longo demais = null. */
export function normalizarEtiqueta(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 40) return null;
  return t;
}

/** Lista de etiquetas limpa e sem repetir. Aceita "a, b; c" ou array. */
export function listaDeEtiquetas(v) {
  const bruto = Array.isArray(v) ? v : String(v ?? '').split(/[,;|]/);
  return [...new Set(bruto.map(normalizarEtiqueta).filter(Boolean))];
}

/** Só dígitos; com 10–11 dígitos (sem DDI) ganha o 55. */
export function telefoneDaPlanilha(s) {
  let d = String(s ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

const cpfDe = (s) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 11 ? d : null; };
const emailDe = (s) => { const t = String(s ?? '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null; };

/**
 * Lê o CSV/planilha colada da importação de etiquetas. Cada linha vira
 * { telefone?, cpf?, email?, etiquetas[] }. Cabeçalho opcional: se a 1ª linha
 * tiver "telefone", "cpf", "email" ou "etiqueta(s)", as colunas vêm por nome;
 * senão a 1ª coluna é o contato (telefone, CPF ou e-mail — descobre sozinho)
 * e a 2ª, as etiquetas. `etiquetasExtra` entra em todas as linhas.
 */
export function lerPlanilhaEtiquetas(texto, etiquetasExtra = []) {
  const linhas = String(texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return { linhas: [], invalidas: 0 };
  const sep = [';', '\t', ','].find((s) => linhas[0].includes(s)) || ',';
  const cortar = (l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
  const cab = cortar(linhas[0]).map((c) => c.toLowerCase());
  const temCab = cab.some((c) => /^(telefone|celular|whatsapp|fone|cpf|e-?mail|etiquetas?|tags?)$/.test(c));
  const col = (re) => cab.findIndex((c) => re.test(c));
  const iTel = temCab ? col(/^(telefone|celular|whatsapp|fone)$/) : -1;
  const iCpf = temCab ? col(/^cpf$/) : -1;
  const iMail = temCab ? col(/^e-?mail$/) : -1;
  const iTag = temCab ? col(/^(etiquetas?|tags?)$/) : 1;
  const extra = listaDeEtiquetas(etiquetasExtra);
  const out = [];
  let invalidas = 0;
  for (const l of temCab ? linhas.slice(1) : linhas) {
    const c = cortar(l);
    let telefone = null; let cpf = null; let email = null;
    if (temCab) {
      telefone = iTel >= 0 ? telefoneDaPlanilha(c[iTel]) : null;
      cpf = iCpf >= 0 ? cpfDe(c[iCpf]) : null;
      email = iMail >= 0 ? emailDe(c[iMail]) : null;
    } else {
      const v = c[0];
      email = emailDe(v);
      if (!email) {
        const d = String(v ?? '').replace(/\D/g, '');
        // 11 dígitos é ambíguo (CPF ou celular sem DDI): CPF só se tiver ponto/traço.
        if (d.length === 11 && /[.-]/.test(v)) cpf = d; else telefone = telefoneDaPlanilha(v);
      }
    }
    const etiquetas = [...new Set([...(iTag >= 0 ? listaDeEtiquetas(c[iTag]) : []), ...extra])];
    if ((!telefone && !cpf && !email) || !etiquetas.length) { invalidas++; continue; }
    out.push({ telefone, cpf, email, etiquetas });
  }
  return { linhas: out, invalidas };
}

// ── Botões: "clicou → próxima mensagem" ─────────────────────────────────────

const limpo = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Confere as respostas dos botões de resposta rápida (QUICK_REPLY) do modelo.
 * Entrada (da tela): { [indice]: { texto?, etiqueta?, tirar_etiqueta?, avisar? } }.
 * Saída: { respostas } com o rótulo do botão guardado (é ele que volta no clique),
 * ou { erro }. Botão sem nada configurado sai da lista.
 */
export function conferirRespostas(modelo, respostas) {
  const r = respostas && typeof respostas === 'object' ? respostas : {};
  const out = {};
  for (const b of modelo?.botoes || []) {
    if (b.tipo !== 'QUICK_REPLY') continue;
    const x = r[b.indice] ?? r[String(b.indice)];
    if (!x || typeof x !== 'object') continue;
    const texto = String(x.texto ?? '').trim();
    if (texto.length > 4096) return { erro: `A resposta do botão "${b.texto}" passa de 4096 caracteres.` };
    const etiqueta = x.etiqueta ? normalizarEtiqueta(x.etiqueta) : null;
    if (x.etiqueta && !etiqueta) return { erro: `A etiqueta do botão "${b.texto}" é inválida (até 40 letras).` };
    const tirar = x.tirar_etiqueta ? normalizarEtiqueta(x.tirar_etiqueta) : null;
    const avisar = x.avisar === true;
    if (!texto && !etiqueta && !tirar && !avisar) continue;
    out[String(b.indice)] = { rotulo: b.texto, ...(texto ? { texto } : {}), ...(etiqueta ? { etiqueta } : {}), ...(tirar ? { tirar_etiqueta: tirar } : {}), ...(avisar ? { avisar: true } : {}) };
  }
  return { respostas: out };
}

/** O botão clicado (texto ou payload que a Meta devolve) → a configuração dele, ou null. */
export function respostaDoBotao(respostas, clicado) {
  const alvo = limpo(clicado);
  if (!alvo || !respostas || typeof respostas !== 'object') return null;
  for (const [indice, cfg] of Object.entries(respostas)) {
    if (limpo(cfg?.rotulo) === alvo) return { indice, ...cfg };
  }
  return null;
}

/** "Oi {{nome}}" → "Oi Ana". Só {{nome}} e {{destino}} na resposta do botão. */
export function personalizarResposta(texto, { nome, destino }) {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0] || '';
  return String(texto ?? '')
    .replace(/{{\s*nome\s*}}/gi, primeiro)
    .replace(/{{\s*destino\s*}}/gi, String(destino ?? '').trim())
    .replace(/[ \t]+\n/g, '\n').trim();
}

// ── Link rastreado ──────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** https://qs…/l/<envio>/<variavel> — o clique passa pelo QS e segue pro destino. */
export function linkRastreado(base, envioId, variavel) {
  const b = String(base || '').replace(/\/+$/, '');
  return `${b}/l/${envioId}/${encodeURIComponent(String(variavel))}`;
}

/** Confere o pedaço da URL do clique. null = inválido (não registra nada). */
export function lerClique(envioId, variavel) {
  const id = String(envioId || '');
  const k = String(variavel || '').slice(0, 40);
  if (!UUID.test(id) || !/^[\w-]{1,40}$/.test(k)) return null;
  return { envioId: id, variavel: k };
}

/** 0414: link do bloco Mensagem de um FLUXO → https://qs…/l/f/<execução>/<bloco>. */
export function linkDoFluxo(base, execId, noId) {
  const b = String(base || '').replace(/\/+$/, '');
  return `${b}/l/f/${execId}/${encodeURIComponent(String(noId))}`;
}

/** Confere o pedaço da URL do clique de fluxo. null = inválido. */
export function lerCliqueFluxo(execId, noId) {
  const id = String(execId || '');
  const no = String(noId || '').slice(0, 60);
  if (!UUID.test(id) || !/^[\w-]{1,60}$/.test(no)) return null;
  return { execId: id, noId: no };
}

/**
 * 0414: troca a URL do botão "link" (cta_url) pelo link rastreado. Só quando a
 * URL é fixa (sem {{variável}}): no clique o QS precisa achar o destino no grafo.
 */
export function rastrearLinkDoCorpo(corpo, urlOriginal, rastreado) {
  const it = corpo?.interactive;
  if (corpo?.type !== 'interactive' || it?.type !== 'cta_url') return corpo;
  const p = it.action?.parameters;
  if (!p?.url || /\{\{/.test(String(urlOriginal || '')) || p.url !== urlOriginal) return corpo;
  return { ...corpo, interactive: { ...it, action: { ...it.action, parameters: { ...p, url: rastreado } } } };
}

/** Só segue pra http(s) — nada de javascript: ou data:. */
export const urlSegura = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || '').trim());

/**
 * Troca os `params` de fonte "link" por texto com o link rastreado DESTE envio.
 * As outras fontes passam iguais (quem resolve é valoresDasVariaveis).
 */
export function paramsComLinks(params, base, envioId) {
  const out = {};
  for (const [k, cfg] of Object.entries(params || {})) {
    out[k] = cfg?.fonte === 'link' ? { fonte: 'texto', valor: linkRastreado(base, envioId, k) } : cfg;
  }
  return out;
}
