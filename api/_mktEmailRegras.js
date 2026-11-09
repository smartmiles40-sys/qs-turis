// api/_mktEmailRegras.js
// -----------------------------------------------------------------------------
// E-MAIL MARKETING (0245) — regras puras (sem banco, sem rede), testadas em
// tests/mkt-email/*.test.ts:
//   • segmentos: validação das regras (espelho da lista FECHADA que o banco
//     compila em mkt_seg_condicao_sql — o banco é a palavra final)
//   • fila: o que fazer com um destinatário depois de um erro (429 devolve a
//     tentativa e respeita o Retry-After; 4xx é definitivo; resto tenta 3x)
//   • automações: andar a sequência até a próxima espera
//   • score: pesos editáveis
// -----------------------------------------------------------------------------

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Segmentos ──────────────────────────────────────────────────────────────

const TEXTO = ['contem', 'nao_contem', 'igual', 'diferente', 'preenchido', 'vazio'];
const ENGAJ = ['ultimos_dias', 'nao_ultimos_dias', 'nunca', 'campanha', 'nao_campanha'];

/** campo → operadores aceitos. TEM que andar junto com mkt_seg_condicao_sql (0245). */
export const OPERADORES = {
  tag: ['tem', 'nao_tem'],
  lista: ['esta', 'nao_esta'],
  nome: TEXTO,
  email: TEXTO,
  telefone: TEXTO,
  origem: TEXTO,
  campo: [...TEXTO, 'maior', 'menor'],
  score: ['maior_igual', 'menor'],
  criado: ['ultimos_dias', 'mais_de_dias', 'depois_de', 'antes_de'],
  abriu_email: ENGAJ,
  clicou_email: ENGAJ,
};

const SEM_VALOR = new Set(['preenchido', 'vazio', 'nunca']);
export const MAX_NIVEL = 3;
export const MAX_CONDICOES = 30;

function validarCondicao(c, onde) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return `${onde}: condição inválida.`;
  const ops = OPERADORES[c.campo];
  if (!ops) return `${onde}: escolha o campo.`;
  if (!ops.includes(c.op)) return `${onde}: escolha a regra.`;
  const v = c.valor === undefined || c.valor === null ? '' : String(c.valor).trim();
  if (c.campo === 'campo' && !/^[a-z0-9_]{1,60}$/.test(String(c.chave ?? ''))) return `${onde}: escolha o campo personalizado.`;
  if (SEM_VALOR.has(c.op)) return null;
  if (['ultimos_dias', 'nao_ultimos_dias', 'mais_de_dias'].includes(c.op)) {
    return /^\d{1,5}$/.test(v) ? null : `${onde}: digite um número de dias.`;
  }
  if (['depois_de', 'antes_de'].includes(c.op)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00-03:00`)) ? null : `${onde}: escolha a data.`;
  }
  if (c.campo === 'lista' || ['campanha', 'nao_campanha'].includes(c.op)) {
    return UUID.test(v) ? null : `${onde}: escolha ${c.campo === 'lista' ? 'a lista' : 'a campanha'}.`;
  }
  if (c.campo === 'score') return /^-?\d{1,6}$/.test(v) ? null : `${onde}: digite a pontuação (número inteiro).`;
  if (['maior', 'menor'].includes(c.op)) return /^-?\d+(\.\d+)?$/.test(v) ? null : `${onde}: digite um número.`;
  if (!v) return `${onde}: preencha o valor.`;
  if (v.length > 200) return `${onde}: valor longo demais.`;
  return null;
}

/**
 * Confere as regras (grupo raiz). Devolve null se ok, ou o erro em português da
 * PRIMEIRA coisa que não fecha. Raiz vazia é aceita (= ninguém); grupo interno vazio não.
 */
export function validarRegras(regras, nivel = 0, caminho = 'Regra') {
  if (nivel > MAX_NIVEL) return `No máximo ${MAX_NIVEL} níveis de grupo.`;
  if (!regras || typeof regras !== 'object' || !Array.isArray(regras.condicoes)) return 'Regras inválidas.';
  if (!['todas', 'qualquer'].includes(regras.combinar)) return 'Escolha "todas" (E) ou "qualquer" (OU).';
  if (regras.condicoes.length > MAX_CONDICOES) return `No máximo ${MAX_CONDICOES} condições por grupo.`;
  if (nivel > 0 && regras.condicoes.length === 0) return `${caminho}: grupo vazio.`;
  for (const [i, item] of regras.condicoes.entries()) {
    const onde = `${caminho} ${i + 1}`;
    const erro = item && typeof item === 'object' && Array.isArray(item.condicoes)
      ? validarRegras(item, nivel + 1, onde)
      : validarCondicao(item, onde);
    if (erro) return erro;
  }
  return null;
}

// ── Público da campanha ────────────────────────────────────────────────────

/** {listas, segmento_id, tags} limpo. Vazio = erro (nunca "todos"). */
export function limparPublico(p) {
  const listas = [...new Set((Array.isArray(p?.listas) ? p.listas : []).map(String).filter((x) => UUID.test(x)))];
  const tags = [...new Set((Array.isArray(p?.tags) ? p.tags : []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 50);
  const segmento_id = UUID.test(String(p?.segmento_id ?? '')) ? String(p.segmento_id) : null;
  if (!listas.length && !tags.length && !segmento_id) return { erro: 'Escolha pelo menos uma lista, tag ou segmento.' };
  return { publico: { listas, segmento_id, tags } };
}

// ── Fila: depois de um erro ────────────────────────────────────────────────

export const MAX_TENTATIVAS = 3;

/**
 * O que fazer com o destinatário que deu erro.
 * `tentativas` é o número JÁ contado nesta tentativa (o reivindicar soma 1).
 *   429      → volta 'pendente' com a tentativa DEVOLVIDA e o tick para por
 *              Retry-After (sem isso o limite de ritmo queima a campanha toda).
 *   permanente (4xx) → 'falha' já.
 *   resto    → 'pendente' até MAX_TENTATIVAS, depois 'falha'.
 */
export function decidirAposErro(erro, tentativas) {
  const status = Number(erro?.status ?? 0);
  if (status === 429) {
    const espera = Number(erro?.esperarMs ?? 0);
    return {
      status: 'pendente',
      tentativas: Math.max(0, tentativas - 1),
      pausarMs: Number.isFinite(espera) && espera > 0 ? Math.min(espera, 60_000) : 5_000,
    };
  }
  if (erro?.permanente || tentativas >= MAX_TENTATIVAS) return { status: 'falha', tentativas, pausarMs: 0 };
  return { status: 'pendente', tentativas, pausarMs: 0 };
}

/**
 * Teto diário (0340, aquecimento do domínio): quantos e-mails ainda podem sair
 * hoje. Sem teto válido → Infinity. Nunca negativo.
 */
export function calcularRestante(teto, enviadosHoje) {
  const t = Number(teto);
  if (!Number.isInteger(t) || t <= 0) return Infinity;
  const h = Math.max(0, Number(enviadosHoje) || 0);
  return Math.max(0, t - h);
}

/** Retry-After (segundos ou data HTTP) → ms. Sem cabeçalho: 5 s. */
export function retryAfterMs(valor, agora = Date.now()) {
  if (valor === null || valor === undefined || valor === '') return 5_000;
  const n = Number(valor);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const d = Date.parse(String(valor));
  return Number.isFinite(d) ? Math.max(0, d - agora) : 5_000;
}

/** Orçamento do tick: quanto tempo ainda dá pra gastar. */
export function criarOrcamento(totalMs, agora = () => Date.now()) {
  const fim = agora() + totalMs;
  return { cabe: (ms) => agora() + ms <= fim, resta: () => Math.max(0, fim - agora()) };
}

// ── Automações ─────────────────────────────────────────────────────────────

/** Mesma regra do mkt_email_passos_ok (0245). */
export function validarPassos(passos) {
  if (!Array.isArray(passos) || passos.length === 0) return 'Coloque pelo menos um passo.';
  if (passos.length > 20) return 'No máximo 20 passos.';
  for (const [i, p] of passos.entries()) {
    if (p?.tipo === 'email') {
      if (!UUID.test(String(p.modelo_id ?? ''))) return `Passo ${i + 1}: escolha o modelo de e-mail.`;
    } else if (p?.tipo === 'esperar') {
      const m = Number(p.minutos);
      if (!Number.isInteger(m) || m < 1 || m > 129_600) return `Passo ${i + 1}: espera entre 1 minuto e 90 dias.`;
    } else {
      return `Passo ${i + 1}: tipo desconhecido.`;
    }
  }
  return null;
}

/**
 * A partir do passo atual, junta os e-mails a enfileirar até a próxima espera.
 * Devolve { emails: [{passo, modelo_id}], proximoPasso, proximoEm (ms) | null, concluida }.
 */
export function planejarExecucao(passos, passoAtual, agoraMs) {
  const emails = [];
  let i = Math.max(0, passoAtual | 0);
  while (i < passos.length) {
    const p = passos[i];
    if (p.tipo === 'email') {
      emails.push({ passo: i, modelo_id: p.modelo_id });
      i += 1;
      continue;
    }
    if (p.tipo === 'esperar') {
      return { emails, proximoPasso: i + 1, proximoEm: agoraMs + Number(p.minutos) * 60_000, concluida: false };
    }
    i += 1; // tipo estranho: pula (o banco já recusa na gravação)
  }
  return { emails, proximoPasso: passos.length, proximoEm: null, concluida: true };
}

// ── Score ──────────────────────────────────────────────────────────────────

export const PESOS_PADRAO = { email_abriu: 1, email_clicou: 3, formulario: 5, whatsapp_respondeu: 3, email_descadastrou: -10 };

/** Pesos: tipo de evento (a-z, _) → inteiro entre -100 e 100. */
export function limparPesos(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { erro: 'Pesos inválidos.' };
  const out = {};
  for (const [k, v] of Object.entries(entrada)) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) return { erro: `Evento "${k}" com nome inválido.` };
    const n = Number(v);
    if (!Number.isInteger(n) || n < -100 || n > 100) return { erro: `Peso de "${k}" deve ser inteiro entre -100 e 100.` };
    out[k] = n;
  }
  if (Object.keys(out).length > 40) return { erro: 'No máximo 40 tipos de evento.' };
  return { pesos: out };
}

/** O recálculo diário: roda se nunca rodou ou se o último foi em outro dia (São Paulo). */
export function precisaRecalcularScore(ultimoIso, agora = new Date()) {
  if (!ultimoIso) return true;
  const dia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  const ultimo = new Date(ultimoIso);
  if (Number.isNaN(ultimo.getTime())) return true;
  return dia(ultimo) !== dia(agora);
}

// ── E-mail ─────────────────────────────────────────────────────────────────

export function emailValido(e) {
  return /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}$/i.test(String(e ?? '').trim());
}

/** O remetente precisa ser do domínio verificado (o Resend recusa os outros). */
export function remetenteDoDominio(email, dominio) {
  if (!emailValido(email) || !dominio) return false;
  const d = String(email).trim().toLowerCase().split('@')[1];
  const alvo = String(dominio).trim().toLowerCase();
  return d === alvo;
}
