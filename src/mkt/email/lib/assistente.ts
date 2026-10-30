// src/mkt/email/lib/assistente.ts
// -----------------------------------------------------------------------------
// Regras PURAS dos assistentes de e-mail (campanha e automação): os passos, o que
// falta em cada um e os textos de resumo. Sem React e sem Supabase, pra rodar no
// node:test (tests/mkt-email/assistente.test.ts).
//
// O que falta aqui é só pra GUIAR a pessoa; quem trava de verdade é o banco
// (RLS da 0245: campanha só muda em rascunho; CHECK dos passos da automação) e
// a /api/mkt-email (supressão, rodapé com descadastro, domínio do remetente).
// -----------------------------------------------------------------------------
import type { Bloco } from "./blocos";

export interface PublicoLeve { listas: string[]; segmento_id: string | null; tags: string[] }

export type PassoCampanha = "para" | "conteudo" | "quando" | "revisar";
export const PASSOS_CAMPANHA: { id: PassoCampanha; rotulo: string }[] = [
  { id: "para", rotulo: "Para quem" },
  { id: "conteudo", rotulo: "Conteúdo" },
  { id: "quando", rotulo: "Quando" },
  { id: "revisar", rotulo: "Revisar" },
];

export type PassoAutomacao = "gatilho" | "sequencia" | "revisar";
export const PASSOS_AUTOMACAO: { id: PassoAutomacao; rotulo: string }[] = [
  { id: "gatilho", rotulo: "Quem entra" },
  { id: "sequencia", rotulo: "E-mails e esperas" },
  { id: "revisar", rotulo: "Revisar e ligar" },
];

/** Sem lista, tag nem segmento ninguém recebe (regra do banco). */
export function publicoVazio(p: PublicoLeve | null | undefined): boolean {
  return !p || ((p.listas?.length ?? 0) === 0 && (p.tags?.length ?? 0) === 0 && !p.segmento_id);
}

/** "Lista Japão + Lista China · tag vip · segmento Quentes". */
export function resumoPublico(p: PublicoLeve, nomesListas: Record<string, string>, nomesSegmentos: Record<string, string>): string {
  if (publicoVazio(p)) return "Ninguém escolhido ainda";
  const partes: string[] = [];
  if (p.listas.length) partes.push(p.listas.map((id) => nomesListas[id] ?? "lista apagada").join(" + "));
  if (p.tags.length) partes.push(`${p.tags.length > 1 ? "tags" : "tag"} ${p.tags.join(", ")}`);
  if (p.segmento_id) partes.push(`segmento ${nomesSegmentos[p.segmento_id] ?? "apagado"}`);
  return partes.join(" · ");
}

const ehHttps = (u: unknown) => typeof u === "string" && /^https:\/\/[^\s/]+\.[^\s]+/i.test(u.trim());

/** Botão sem link, imagem sem endereço… — o que deixaria o e-mail quebrado. */
export function problemasDosBlocos(blocos: Bloco[]): string[] {
  const out: string[] = [];
  const lista = Array.isArray(blocos) ? blocos : [];
  if (!lista.some((b) => b.tipo !== "rodape" && b.tipo !== "divisor" && b.tipo !== "espaco")) out.push("O e-mail está sem conteúdo");
  for (const b of lista) {
    if (b.tipo === "botao" && !ehHttps(b.url)) out.push(`O botão "${b.texto || "sem texto"}" está sem link (precisa começar com https://)`);
    if (b.tipo === "imagem" && !ehHttps(b.url)) out.push("Tem uma imagem sem endereço (https://…)");
  }
  return out;
}

/** "AAAA-MM-DDTHH:mm" do campo (horário de Brasília) → ISO. Vazio/ruim = null. */
export function quandoParaIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface CampanhaLeve {
  nome: string; publico: PublicoLeve; assunto: string | null; blocos: Bloco[];
  remetente_email: string | null;
}
export interface Envio { modo: "agora" | "agendar"; quando: string }

/** O que falta em cada passo da campanha (lista vazia = passo pronto). */
export function pendenciasCampanha(
  c: CampanhaLeve,
  envio: Envio,
  cfg: { dominio?: string | null; remetentePadrao?: string | null } = {},
  agora: Date = new Date(),
): Record<PassoCampanha, string[]> {
  const para = publicoVazio(c.publico) ? ["Escolha pelo menos uma lista, tag ou segmento"] : [];
  const conteudo = [
    ...(!(c.assunto ?? "").trim() ? ["Escreva o assunto"] : []),
    ...problemasDosBlocos(c.blocos),
  ];
  const quando: string[] = [];
  const remetente = (c.remetente_email || cfg.remetentePadrao || "").trim().toLowerCase();
  if (!remetente) quando.push("Falta o e-mail do remetente (aqui ou na conexão)");
  else if (cfg.dominio && !remetente.endsWith(`@${cfg.dominio.toLowerCase()}`)) quando.push(`O remetente precisa ser @${cfg.dominio}`);
  if (envio.modo === "agendar") {
    const iso = quandoParaIso(envio.quando);
    if (!iso) quando.push("Escolha o dia e a hora do envio");
    else if (new Date(iso).getTime() < agora.getTime()) quando.push("O horário escolhido já passou");
  }
  return { para, conteudo, quando, revisar: [...para, ...conteudo, ...quando] };
}

// ── Automação ────────────────────────────────────────────────────────────────

export type PassoSeq = { tipo: "email"; modelo_id: string } | { tipo: "esperar"; minutos: number };
export interface AutomacaoLeve { gatilho_tipo: "lista" | "tag" | "formulario"; gatilho_valor: string | null; passos: PassoSeq[] }

export const MIN_ESPERA = 1;
export const MAX_ESPERA = 90 * 1440; // 90 dias (o CHECK do banco)

export type Unidade = "minutos" | "horas" | "dias";
export const FATOR: Record<Unidade, number> = { minutos: 1, horas: 60, dias: 1440 };
export const emUnidade = (min: number): [number, Unidade] =>
  min % 1440 === 0 ? [min / 1440, "dias"] : min % 60 === 0 ? [min / 60, "horas"] : [min, "minutos"];

export function textoEspera(min: number): string {
  const [n, u] = emUnidade(min);
  const nome = { minutos: ["minuto", "minutos"], horas: ["hora", "horas"], dias: ["dia", "dias"] }[u];
  return `${n} ${n === 1 ? nome[0] : nome[1]}`;
}

export function pendenciasAutomacao(a: AutomacaoLeve): Record<PassoAutomacao, string[]> {
  const gatilho: string[] = [];
  if (a.gatilho_tipo === "lista" && !a.gatilho_valor) gatilho.push("Escolha a lista");
  if (a.gatilho_tipo === "tag" && !(a.gatilho_valor ?? "").trim()) gatilho.push("Escreva a tag");
  const sequencia: string[] = [];
  const emails = a.passos.filter((p) => p.tipo === "email");
  if (emails.length === 0) sequencia.push("Ponha pelo menos um e-mail");
  a.passos.forEach((p, i) => {
    if (p.tipo === "email" && !p.modelo_id) sequencia.push(`Passo ${i + 1}: escolha o modelo do e-mail`);
    if (p.tipo === "esperar" && (!(p.minutos >= MIN_ESPERA) || p.minutos > MAX_ESPERA)) sequencia.push(`Passo ${i + 1}: a espera vai de 1 minuto a 90 dias`);
  });
  return { gatilho, sequencia, revisar: [...gatilho, ...sequencia] };
}

/** "Quando entrar na lista Japão" / "Quando ganhar a tag vip" / "Quando responder qualquer formulário". */
export function textoGatilho(a: Pick<AutomacaoLeve, "gatilho_tipo" | "gatilho_valor">, nomesListas: Record<string, string>): string {
  if (a.gatilho_tipo === "lista") return a.gatilho_valor ? `Quando entrar na lista ${nomesListas[a.gatilho_valor] ?? "(apagada)"}` : "Quando entrar numa lista (escolha qual)";
  if (a.gatilho_tipo === "tag") return a.gatilho_valor ? `Quando ganhar a tag "${a.gatilho_valor}"` : "Quando ganhar uma tag (escreva qual)";
  return a.gatilho_valor ? `Quando responder o formulário "${a.gatilho_valor}"` : "Quando responder qualquer formulário";
}
