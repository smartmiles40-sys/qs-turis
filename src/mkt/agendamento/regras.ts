// src/mkt/agendamento/regras.ts — regras PURAS dos links de agendamento (0354).
// Sem React e sem Supabase: testadas em tests/mkt/linksAgendamento.test.ts.

export type TipoLink = "closer" | "sdr" | "sdr-semana";

export const TIPOS_LINK: { id: TipoLink; rotulo: string; texto: string }[] = [
  { id: "closer", rotulo: "Reunião com especialista (closer)", texto: "1 hora no Meet com um closer, pelo rodízio. Pede e-mail pro convite." },
  { id: "sdr", rotulo: "Ligação com SDR", texto: "5 minutos no WhatsApp com o SDR dono do lead (ou o rodízio, se o lead é novo)." },
  { id: "sdr-semana", rotulo: "Ligação com SDR (seg–sex, com motivo)", texto: "A mesma ligação, só de segunda a sexta, e a pessoa conta por que quer viajar." },
];
export const NOME_TIPO: Record<TipoLink, string> = { closer: "Closer", sdr: "SDR", "sdr-semana": "SDR seg–sex" };

/** Sugestões do utm_source/medium (o campo continua livre). */
export const FONTES_UTM = ["instagram", "facebook", "whatsapp", "email", "google", "youtube", "tiktok", "site", "indicacao"];
export const MEIOS_UTM = ["bio", "stories", "direct", "post", "reels", "grupo", "lista", "cpc", "newsletter", "live"];

export interface LinkForm {
  nome: string;
  tipo: TipoLink;
  expedicao: string;
  origem: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  dias: string;
  /** Até quantos dias úteis à frente dá pra marcar (1 a 3; a regra geral é 3). */
  dias_uteis: 1 | 2 | 3;
  tema_stfv: boolean;
}

export const OPCOES_DIAS_UTEIS: { n: 1 | 2 | 3; rotulo: string }[] = [
  { n: 1, rotulo: "Até 1 dia útil" },
  { n: 2, rotulo: "Até 2 dias úteis" },
  { n: 3, rotulo: "Até 3 dias úteis" },
];

export const FORM_VAZIO: LinkForm = {
  nome: "", tipo: "closer", expedicao: "", origem: "", utm_source: "", utm_medium: "",
  utm_campaign: "", utm_content: "", utm_term: "", dias: "", dias_uteis: 3, tema_stfv: false,
};

/** "Japão 2027 — Stories!" → "japao-2027-stories" (sem acento, até 40). */
export function slug(texto: string, max = 40): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}

/** Código do link: slug do nome + 4 caracteres pra não colidir. */
export function novoCodigo(nome: string, sorte: () => number = Math.random): string {
  const base = slug(nome, 40) || "link";
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  let fim = "";
  for (let i = 0; i < 4; i++) fim += abc[Math.floor(sorte() * abc.length) % abc.length];
  return `${base}-${fim}`;
}

/** UTM limpa: sem espaço nas pontas; espaços do meio viram "-"; minúsculas no source/medium. */
export function limparUtm(v: string, minusculo = false): string {
  const t = v.trim().replace(/\s+/g, "-");
  return minusculo ? t.toLowerCase() : t;
}

/** O que falta pra salvar (vazio = pode). */
export function problemasDoForm(f: LinkForm): string[] {
  const p: string[] = [];
  if (f.nome.trim().length < 2) p.push("Dê um nome ao link (ex.: \"Japão — stories 10/11\").");
  if (!f.utm_source.trim()) p.push("Preencha o utm_source (de onde vem: instagram, whatsapp…).");
  if (!f.utm_campaign.trim()) p.push("Preencha o utm_campaign (a campanha: japao-2027, black-friday…).");
  if (f.dias.trim()) {
    const n = Number(f.dias);
    if (!Number.isInteger(n) || n < 1 || n > 14) p.push("\"Só os próximos N dias\" vai de 1 a 14.");
  }
  return p;
}

export interface LinkSalvo {
  codigo: string;
  tipo: TipoLink;
  expedicao: string | null;
  origem: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  dias: number | null;
  dias_uteis: number;
  tema_stfv: boolean;
}

/** A URL pública: {base}/agendar/?com=…&expedicao=…&utm_*=…&l=codigo */
export function urlDoLink(base: string, l: LinkSalvo): string {
  const p = new URLSearchParams();
  if (l.tipo !== "closer") p.set("com", l.tipo);
  if (l.expedicao) p.set("expedicao", l.expedicao);
  if (l.origem) p.set("origem", l.origem);
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const) {
    const v = l[k];
    if (v) p.set(k, v);
  }
  if (l.dias) p.set("dias", String(l.dias));
  // 3 é a regra geral: só vai na URL quando o link encurta (1 ou 2).
  if (l.dias_uteis && l.dias_uteis < 3) p.set("uteis", String(l.dias_uteis));
  if (l.tema_stfv) p.set("tema", "stfv");
  p.set("l", l.codigo);
  return `${base.replace(/\/+$/, "")}/agendar/?${p.toString()}`;
}

/** O form vira a linha do banco (campos vazios = null). */
export function linhaDoForm(f: LinkForm): Omit<LinkSalvo, "codigo"> & { nome: string } {
  const ou = (v: string) => (v.trim() ? v.trim() : null);
  return {
    nome: f.nome.trim(),
    tipo: f.tipo,
    expedicao: ou(f.expedicao),
    origem: ou(f.origem),
    utm_source: ou(limparUtm(f.utm_source, true)),
    utm_medium: ou(limparUtm(f.utm_medium, true)),
    utm_campaign: ou(limparUtm(f.utm_campaign)),
    utm_content: ou(limparUtm(f.utm_content)),
    utm_term: ou(limparUtm(f.utm_term)),
    dias: f.dias.trim() ? Number(f.dias) : null,
    dias_uteis: f.dias_uteis,
    tema_stfv: f.tema_stfv,
  };
}
