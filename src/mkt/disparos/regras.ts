// src/mkt/disparos/regras.ts
// -----------------------------------------------------------------------------
// Regras PURAS da base de contatos do Marketing (0242): leitura do CSV,
// normalização de telefone/e-mail/tags e as descrições de recorrência e
// sequência. Portado do SendFlow (src/lib/contatos.ts), que já tinha apanhado
// do Excel brasileiro: BOM, ponto e vírgula, aspas, telefone formatado.
// A régua de telefone é a MESMA de api/_mktRegras.js (o teste confere).
// -----------------------------------------------------------------------------

// ── Telefone e e-mail ───────────────────────────────────────────────────────

/** Ver api/_mktRegras.js: 55 + DDD + número, celular de 8 dígitos ganha o 9. */
export function normalizarTelefone(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  // Com + ou 00 na frente, o DDI veio escrito: não adivinha 55 (ex.: +1 415…).
  const comDdi = /^\s*(\+|00)/.test(String(raw));
  if (d.startsWith("00")) d = d.slice(2);
  // 0 de discagem interurbana ("011 9…", "0 21 …"): cai fora.
  else if (!comDdi && d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (!comDdi && (d.length === 10 || d.length === 11)) d = `55${d}`;
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  if (d.startsWith("55")) return /^55[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(d) ? d : "";
  return d.length >= 10 && d.length <= 15 ? d : "";
}

/** `5511999999999` → `+55 11 99999-9999`. */
export function formatarTelefone(v: string | null | undefined): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith("55")) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  return d ? `+${d}` : "";
}

/** Minúsculo e sem espaço: o índice único é sobre a coluna crua. */
export const normalizarEmail = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
export function emailValido(v: string): boolean {
  const e = normalizarEmail(v);
  return e.length <= 254 && /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/.test(e);
}

// ── Tags ────────────────────────────────────────────────────────────────────

/** `"VIP, cliente; 2026"` → `['vip','cliente','2026']`. */
export function separarTags(v: string | null | undefined): string[] {
  return [...new Set(String(v ?? "").split(/[,;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
export function unirTags(...listas: (string[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const l of listas) for (const t of l ?? []) { const x = t.trim().toLowerCase(); if (x && !out.includes(x)) out.push(x); }
  return out;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function contarForaDeAspas(linha: string, sep: string): number {
  let dentro = false; let n = 0;
  for (const ch of linha) { if (ch === '"') dentro = !dentro; else if (ch === sep && !dentro) n++; }
  return n;
}

/** Planilha brasileira sai com `;` (a vírgula é decimal aqui). */
export function detectarSeparador(primeiraLinha: string): string {
  let melhor = ","; let maior = 0;
  for (const sep of [";", ",", "\t"]) { const n = contarForaDeAspas(primeiraLinha, sep); if (n > maior) { maior = n; melhor = sep; } }
  return melhor;
}

/** CSV com aspas, `""` dentro do campo, quebra de linha entre aspas, CRLF e BOM. */
export function parseCsv(texto: string, separador?: string): string[][] {
  const limpo = texto.replace(/^﻿/, "");
  const sep = separador ?? detectarSeparador(limpo.split(/\r?\n/)[0] ?? "");
  const linhas: string[][] = [];
  let campo = ""; let linha: string[] = []; let aspas = false;
  for (let i = 0; i < limpo.length; i++) {
    const ch = limpo[i];
    if (aspas) {
      if (ch === '"') { if (limpo[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
      continue;
    }
    if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (ch !== "\r") campo += ch;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

const SINONIMOS: Record<"nome" | "email" | "telefone" | "tags", string[]> = {
  nome: ["nome", "name", "nome completo", "fullname", "full name", "contato", "cliente", "primeiro nome"],
  email: ["email", "e-mail", "e mail", "mail", "endereco de email", "endereco de e-mail", "correio"],
  telefone: ["telefone", "celular", "whatsapp", "fone", "phone", "numero", "tel", "zap", "telefone celular"],
  tags: ["tags", "tag", "etiquetas", "marcadores", "segmento"],
};

/** Tira acento, espaço duplicado e caixa: "Endereço de E-mail" ≈ "endereco de e-mail". */
export function chaveDeColuna(v: string): string {
  return String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface MapaColunas {
  nome: number | null; email: number | null; telefone: number | null; tags: number | null;
  /** O resto vira `campos` (variável "campo" do disparo). */
  extras: { chave: string; indice: number }[];
}

export function mapearColunas(cabecalho: string[]): MapaColunas {
  const m: MapaColunas = { nome: null, email: null, telefone: null, tags: null, extras: [] };
  const campos = ["nome", "email", "telefone", "tags"] as const;
  cabecalho.forEach((bruto, i) => {
    const k = chaveDeColuna(bruto);
    // A PRIMEIRA coluna vence: "email" e "email secundário" → o 2º vira campo livre.
    const c = campos.find((x) => SINONIMOS[x].includes(k) && m[x] === null);
    if (c) m[c] = i;
    else if (k) m.extras.push({ chave: k.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""), indice: i });
  });
  return m;
}

export interface ContatoImportado { nome: string | null; telefone: string | null; email: string | null; tags: string[]; campos: Record<string, string> }
export interface ResultadoCsv { contatos: ContatoImportado[]; ignoradas: { linha: number; motivo: string }[]; colunas: MapaColunas; total: number }

/**
 * Lê o arquivo inteiro. Corte: e-mail válido OU telefone aproveitável.
 * Duplicado DENTRO do arquivo sai aqui (telefone ou e-mail repetido); o que
 * já existe no banco é resolvido na importação (mkt_importar_contatos).
 */
export function lerCsvDeContatos(texto: string, colunas?: MapaColunas): ResultadoCsv {
  const linhas = parseCsv(texto);
  if (!linhas.length) return { contatos: [], ignoradas: [], colunas: mapearColunas([]), total: 0 };
  const col = colunas ?? mapearColunas(linhas[0]);
  const corpo = linhas.slice(1);
  const contatos: ContatoImportado[] = [];
  const ignoradas: { linha: number; motivo: string }[] = [];
  const vistosTel = new Set<string>(); const vistosMail = new Set<string>();
  const cel = (l: string[], i: number | null) => (i === null ? "" : (l[i] ?? "").trim());

  corpo.forEach((l, idx) => {
    const n = idx + 2;
    const telBruto = cel(l, col.telefone); const mailBruto = cel(l, col.email);
    const tel = telBruto ? normalizarTelefone(telBruto) : "";
    const mail = mailBruto ? normalizarEmail(mailBruto) : "";
    const telOk = !!tel; const mailOk = !!mail && emailValido(mail);
    if (!telOk && !mailOk) {
      ignoradas.push({ linha: n, motivo: telBruto || mailBruto ? `Telefone/e-mail inválido: ${telBruto || mailBruto}` : "Sem telefone e sem e-mail." });
      return;
    }
    if ((telOk && vistosTel.has(tel)) || (mailOk && vistosMail.has(mail))) {
      ignoradas.push({ linha: n, motivo: `Repetido no arquivo: ${telOk && vistosTel.has(tel) ? telBruto : mailBruto}` });
      return;
    }
    if (telOk) vistosTel.add(tel);
    if (mailOk) vistosMail.add(mail);
    const campos: Record<string, string> = {};
    for (const e of col.extras) { const v = cel(l, e.indice); if (v && e.chave) campos[e.chave] = v; }
    contatos.push({ nome: cel(l, col.nome) || null, telefone: telOk ? tel : null, email: mailOk ? mail : null, tags: separarTags(cel(l, col.tags)), campos });
  });
  return { contatos, ignoradas, colunas: col, total: corpo.length };
}

// ── Recorrência e sequência (só descrição; a conta da data é no servidor) ───

export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "Toda segunda e quinta às 09:00" / "Todo dia às 10:00". */
export function descreverRecorrencia(dias: number[], hora: string): string {
  const ds = [...new Set(dias)].filter((d) => d >= 0 && d <= 6).sort();
  if (!ds.length) return "Sem dia escolhido";
  if (ds.length === 7) return `Todo dia às ${hora}`;
  if (ds.join() === "1,2,3,4,5") return `De segunda a sexta às ${hora}`;
  const nomes = ds.map((d) => DIAS_SEMANA[d]);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0];
  const artigo = ds.length === 1 && (ds[0] === 0 || ds[0] === 6) ? "Todo" : "Toda";
  return `${artigo} ${lista} às ${hora}`;
}

export interface PassoResumo { dia_offset: number; hora: string }
/** "Dia 0 às 10:00 → dia 3 às 10:00 → dia 7 às 18:00". Dias fora de ordem = erro. */
export function descreverSequencia(passos: PassoResumo[]): { texto: string; erro: string | null } {
  let erro: string | null = null;
  for (let i = 1; i < passos.length; i++) if (passos[i].dia_offset < passos[i - 1].dia_offset) erro = `O passo ${i + 1} vem antes do passo ${i}: ponha os dias em ordem.`;
  const texto = passos.map((p, i) => `${i === 0 ? "Dia" : "dia"} ${p.dia_offset} às ${p.hora}`).join(" → ");
  return { texto: texto || "Sem passos", erro };
}
