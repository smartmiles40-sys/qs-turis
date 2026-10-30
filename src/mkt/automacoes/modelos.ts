// src/mkt/automacoes/modelos.ts
// -----------------------------------------------------------------------------
// "COMECE POR UM MODELO" (igual ManyChat, pedido do Bruno 30/10/2026): as
// automações prontas de uma agência de viagens e as respostas básicas num
// formulário simples. Tudo aqui é PURO (sem React, sem Supabase) — vira grafo
// (mkt_fluxos.grafo) + gatilho (mkt_fluxo_gatilhos), no MESMO formato que o
// editor de fluxo desenha e o motor (api/_mktMotor.js) percorre.
// Testado em tests/mkt/modelos-automacao.test.ts.
//
// Regras que os modelos respeitam:
//   • nenhum modelo começa conversa com lead: todos respondem a quem ESCREVEU
//     (por isso não há modelo de webhook/LP aqui);
//   • PARAR é do servidor (api/_mktMotor.js): descadastra e não responde. O
//     cartão "PARAR" só explica — não cria fluxo.
// -----------------------------------------------------------------------------
import { novoId, type Grafo, type GatilhoConfig, type Ligacao, type No, type TipoGatilho, type Acao } from "./tipos.ts";

export type IdModelo = "boas_vindas" | "resposta_padrao" | "palavra_expedicao" | "anuncio" | "link_bio" | "pedido_humano" | "parar";

export interface CampoModelo {
  chave: string;
  rotulo: string;
  dica?: string;
  tipo: "texto" | "texto_longo" | "palavras" | "link" | "usuarios";
  padrao: string | string[];
  obrigatorio?: boolean;
}

export interface ModeloAutomacao {
  id: IdModelo;
  titulo: string;
  descricao: string;
  /** null = só explica (PARAR). */
  gatilho: TipoGatilho | null;
  campos: CampoModelo[];
}

export type ParamsModelo = Record<string, string | string[]>;

export interface AutomacaoMontada {
  nome: string;
  grafo: Grafo;
  gatilho: { tipo: TipoGatilho; config: GatilhoConfig; prioridade: number };
}

export const MODELOS_AUTOMACAO: ModeloAutomacao[] = [
  {
    id: "boas_vindas", titulo: "Boas-vindas", gatilho: "boas_vindas",
    descricao: "A primeira mensagem de quem nunca falou com o número do Marketing recebe um oi da agência.",
    campos: [
      { chave: "texto", rotulo: "Mensagem", tipo: "texto_longo", obrigatorio: true,
        padrao: "Oi, {{primeiro_nome}}! Aqui é a Se Tu For, Eu Vou! ✈️\nQue bom te ver por aqui. Conta pra gente: qual viagem você está sonhando?" },
      { chave: "link_rotulo", rotulo: "Botão de link (opcional)", tipo: "texto", padrao: "Ver expedições", dica: "Até 20 letras. Vazio = sem botão." },
      { chave: "link_url", rotulo: "Endereço do botão", tipo: "link", padrao: "https://setuforeuvou.com.br" },
    ],
  },
  {
    id: "resposta_padrao", titulo: "Resposta padrão", gatilho: "padrao",
    descricao: "Quando nada mais combinar, avisa que recebeu e que o time responde já já (no máximo 1× por dia por pessoa).",
    campos: [
      { chave: "texto", rotulo: "Mensagem", tipo: "texto_longo", obrigatorio: true,
        padrao: "Recebi sua mensagem! 🙌 Já já alguém do nosso time te responde por aqui." },
      { chave: "intervalo_horas", rotulo: "No máximo uma vez a cada (horas)", tipo: "texto", padrao: "24" },
    ],
  },
  {
    id: "palavra_expedicao", titulo: "Palavra-chave de live ou expedição", gatilho: "palavra_chave",
    descricao: "Na live você fala \"manda JAPÃO no WhatsApp\": quem mandar recebe o roteiro e ganha a tag da expedição.",
    campos: [
      { chave: "palavras", rotulo: "Palavras", tipo: "palavras", obrigatorio: true, padrao: ["japão", "japao"], dica: "Separe por vírgula. Acento e maiúscula não importam." },
      { chave: "destino", rotulo: "Nome da expedição", tipo: "texto", obrigatorio: true, padrao: "Japão" },
      { chave: "texto", rotulo: "Mensagem", tipo: "texto_longo", obrigatorio: true,
        padrao: "Oi, {{primeiro_nome}}! Que bom que você quer conhecer a expedição {{destino}} 🗺️\nAqui está o roteiro completo, com datas e valores:" },
      { chave: "link_rotulo", rotulo: "Texto do botão", tipo: "texto", padrao: "Ver o roteiro" },
      { chave: "link_url", rotulo: "Link do roteiro", tipo: "link", obrigatorio: true, padrao: "https://setuforeuvou.com.br" },
    ],
  },
  {
    id: "anuncio", titulo: "Veio do anúncio", gatilho: "anuncio",
    descricao: "Quem clica no anúncio \"Enviar mensagem\" da Meta recebe a resposta certa e ganha a tag do anúncio.",
    campos: [
      { chave: "ad_ids", rotulo: "IDs dos anúncios (vazio = qualquer anúncio)", tipo: "palavras", padrao: [], dica: "O ID do anúncio no Gerenciador da Meta. Separe por vírgula." },
      { chave: "tag", rotulo: "Tag", tipo: "texto", padrao: "veio-de-anuncio" },
      { chave: "texto", rotulo: "Mensagem", tipo: "texto_longo", obrigatorio: true,
        padrao: "Oi, {{primeiro_nome}}! Vi que você veio pelo nosso anúncio 😊\nQuer receber o roteiro e as próximas datas?" },
      { chave: "link_rotulo", rotulo: "Botão de link (opcional)", tipo: "texto", padrao: "" },
      { chave: "link_url", rotulo: "Endereço do botão", tipo: "link", padrao: "" },
    ],
  },
  {
    id: "link_bio", titulo: "Link da bio ou QR do evento", gatilho: "link_ref",
    descricao: "Um link wa.me com código escondido: cada lugar (bio, story, QR da feira) começa a conversa certa.",
    campos: [
      { chave: "codigo", rotulo: "Código do link", tipo: "texto", obrigatorio: true, padrao: "bio", dica: "Letras, números e hífen. Ex.: bio, feira-sp, story-japao." },
      { chave: "texto_link", rotulo: "Texto que já vem escrito", tipo: "texto", padrao: "Olá! Vim pelo Instagram" },
      { chave: "texto", rotulo: "Resposta", tipo: "texto_longo", obrigatorio: true,
        padrao: "Oi, {{primeiro_nome}}! Que bom que você chegou até aqui 💛\nSobre qual destino você quer saber?" },
    ],
  },
  {
    id: "pedido_humano", titulo: "Pedido de atendente", gatilho: "palavra_chave",
    descricao: "Quem pedir \"atendente\" ou \"falar com alguém\": o robô para, a conversa fica marcada e o time é avisado no sininho.",
    campos: [
      { chave: "palavras", rotulo: "Palavras", tipo: "palavras", obrigatorio: true, padrao: ["atendente", "humano", "falar com alguém", "falar com alguem"] },
      { chave: "texto", rotulo: "Mensagem", tipo: "texto_longo", obrigatorio: true,
        padrao: "Combinado! Já chamei alguém do time pra falar com você. Em instantes te respondem por aqui 🙂" },
      { chave: "usuarios", rotulo: "Quem é avisado", tipo: "usuarios", padrao: [] },
    ],
  },
  {
    id: "parar", titulo: "PARAR (sair da lista)", gatilho: null,
    descricao: "Já vem ligado e não precisa configurar: quem mandar PARAR, SAIR ou CANCELAR sai na hora e não recebe mais nada do Marketing.",
    campos: [],
  },
];

// ── Ajudantes ────────────────────────────────────────────────────────────────

const str = (v: string | string[] | undefined, padrao = "") => (Array.isArray(v) ? v.join(", ") : (v ?? padrao)).trim();
const lista = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : String(v ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);

/** Troca {{destino}} (e outros marcadores DO MODELO) pelo valor; {{primeiro_nome}} fica pro motor. */
function preencher(texto: string, valores: Record<string, string>) {
  return texto.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k: string) => (k in valores ? valores[k] : m));
}

export function slugTag(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

const X0 = 40;
const PASSO_X = 320;
const Y = 160;

function noMensagem(x: number, texto: string, link?: { rotulo: string; url: string } | null): No {
  return {
    id: novoId("men"), tipo: "mensagem", x, y: Y,
    dados: {
      blocos: [{ tipo: "texto", texto }],
      interacao: link && link.rotulo && link.url ? { tipo: "link", rotulo: link.rotulo, url: link.url } : { tipo: "nenhuma" },
      digitando: true,
    },
  };
}
function noAcoes(x: number, acoes: Acao[]): No {
  return { id: novoId("aca"), tipo: "acao", x, y: Y, dados: { acoes } };
}

/** Início → blocos em fila, cada um ligado pela saída "proximo". */
function emFila(blocos: No[]): Grafo {
  const inicio: No = { id: novoId("ini"), tipo: "inicio", x: X0, y: Y, dados: {} };
  const nos = [inicio, ...blocos.map((b, i) => ({ ...b, x: X0 + PASSO_X * (i + 1) }))];
  const ligacoes: Ligacao[] = [];
  for (let i = 0; i < nos.length - 1; i++) ligacoes.push({ id: novoId("l"), de: nos[i].id, saida: "proximo", para: nos[i + 1].id });
  return { nos, ligacoes };
}

function linkDe(p: ParamsModelo): { rotulo: string; url: string } | null {
  const rotulo = str(p.link_rotulo).slice(0, 20);
  const url = str(p.link_url);
  return rotulo && /^https?:\/\//i.test(url) ? { rotulo, url } : null;
}

/** Valores de partida do formulário de um modelo. */
export function paramsPadrao(id: IdModelo): ParamsModelo {
  const m = MODELOS_AUTOMACAO.find((x) => x.id === id);
  return Object.fromEntries((m?.campos ?? []).map((c) => [c.chave, Array.isArray(c.padrao) ? [...c.padrao] : c.padrao]));
}

/** O que falta preencher (vazio = pode criar). */
export function faltandoNoModelo(id: IdModelo, p: ParamsModelo): string[] {
  const m = MODELOS_AUTOMACAO.find((x) => x.id === id);
  if (!m) return ["modelo desconhecido"];
  const falta: string[] = [];
  for (const c of m.campos) {
    if (!c.obrigatorio) continue;
    const v = c.tipo === "palavras" || c.tipo === "usuarios" ? lista(p[c.chave]) : str(p[c.chave]);
    if (!v.length) falta.push(c.rotulo);
    if (c.tipo === "link" && v.length && !/^https?:\/\//i.test(String(v))) falta.push(`${c.rotulo} (comece com https://)`);
  }
  if (id === "link_bio" && str(p.codigo) && !/^[a-z0-9_-]{2,40}$/.test(slugTag(str(p.codigo)))) falta.push("Código do link (letras, números e hífen)");
  const rot = str(p.link_rotulo);
  if (rot.length > 20) falta.push("Texto do botão (no máximo 20 letras)");
  return falta;
}

/** Monta o fluxo + o gatilho de um modelo. */
export function montarModelo(id: IdModelo, p: ParamsModelo): AutomacaoMontada | { erro: string } {
  const falta = faltandoNoModelo(id, p);
  if (falta.length) return { erro: `Falta: ${falta.join(", ")}.` };
  const texto = str(p.texto);
  switch (id) {
    case "boas_vindas":
      return { nome: "Boas-vindas", grafo: emFila([noMensagem(0, texto, linkDe(p))]), gatilho: { tipo: "boas_vindas", config: {}, prioridade: 0 } };
    case "resposta_padrao": {
      const h = Number(str(p.intervalo_horas, "24"));
      return {
        nome: "Resposta padrão", grafo: emFila([noMensagem(0, texto)]),
        gatilho: { tipo: "padrao", config: { intervalo_horas: Number.isFinite(h) && h >= 1 ? Math.min(Math.round(h), 720) : 24 }, prioridade: 0 },
      };
    }
    case "palavra_expedicao": {
      const destino = str(p.destino);
      const palavras = lista(p.palavras);
      const tag = `quer-${slugTag(destino) || slugTag(palavras[0] ?? "expedicao")}`;
      return {
        nome: `Palavra-chave · ${destino}`,
        grafo: emFila([noAcoes(0, [{ tipo: "adicionar_tag", tag }]), noMensagem(0, preencher(texto, { destino }), linkDe(p))]),
        gatilho: { tipo: "palavra_chave", config: { palavras, modo: "contem" }, prioridade: 0 },
      };
    }
    case "anuncio": {
      const tag = slugTag(str(p.tag)) || "veio-de-anuncio";
      const ad_ids = lista(p.ad_ids).map((x) => x.replace(/\D/g, "")).filter(Boolean);
      return {
        nome: ad_ids.length ? `Anúncio · ${ad_ids.join(", ")}` : "Veio do anúncio",
        grafo: emFila([noAcoes(0, [{ tipo: "adicionar_tag", tag }]), noMensagem(0, texto, linkDe(p))]),
        gatilho: { tipo: "anuncio", config: { ad_ids }, prioridade: ad_ids.length ? 1 : 0 },
      };
    }
    case "link_bio": {
      const codigo = slugTag(str(p.codigo));
      return {
        nome: `Link · ${codigo}`,
        grafo: emFila([noAcoes(0, [{ tipo: "adicionar_tag", tag: `link-${codigo}` }]), noMensagem(0, texto)]),
        gatilho: { tipo: "link_ref", config: { codigo, texto: str(p.texto_link) || "Olá!" }, prioridade: 0 },
      };
    }
    case "pedido_humano": {
      const usuarios = lista(p.usuarios);
      return {
        nome: "Pedido de atendente",
        grafo: emFila([
          noMensagem(0, texto),
          noAcoes(0, [{ tipo: "avisar_humano", usuarios, mensagem: "{{primeiro_nome}} pediu para falar com alguém do time.", horas: 12 }]),
        ]),
        // Ganha das palavras de expedição: "quero falar com alguém sobre o Japão" vai pro time.
        gatilho: { tipo: "palavra_chave", config: { palavras: lista(p.palavras), modo: "contem" }, prioridade: 10 },
      };
    }
    case "parar":
      return { erro: "O PARAR já vem pronto no servidor — não precisa criar nada." };
  }
}

// ── Respostas básicas (formulário simples, sem editor) ───────────────────────

export interface RespostaSimples { texto: string; link: { rotulo: string; url: string } | null }

/** Início → uma mensagem (texto + botão de link opcional). */
export function grafoDeRespostaSimples(r: RespostaSimples): Grafo {
  return emFila([noMensagem(0, r.texto.trim(), r.link)]);
}

/**
 * O fluxo ainda é "simples" (Início → 1 mensagem de texto, sem botões de
 * resposta)? Se sim, devolve o conteúdo pra editar no formulário; se alguém
 * mexeu no editor avançado, devolve null (aí a tela manda pro "Editar fluxo").
 */
export function lerRespostaSimples(g: Grafo | null | undefined): RespostaSimples | null {
  if (!g?.nos?.length) return null;
  const inicio = g.nos.filter((n) => n.tipo === "inicio");
  const resto = g.nos.filter((n) => n.tipo !== "inicio");
  if (inicio.length !== 1 || resto.length !== 1) return null;
  const m = resto[0];
  if (m.tipo !== "mensagem") return null;
  if (!g.ligacoes.some((l) => l.de === inicio[0].id && l.saida === "proximo" && l.para === m.id)) return null;
  if (m.dados.blocos.length !== 1 || m.dados.blocos[0].tipo !== "texto") return null;
  const it = m.dados.interacao ?? { tipo: "nenhuma" };
  if (it.tipo !== "nenhuma" && it.tipo !== "link") return null;
  return { texto: m.dados.blocos[0].texto, link: it.tipo === "link" ? { rotulo: it.rotulo, url: it.url } : null };
}

// ── Linguagem simples nos cartões ────────────────────────────────────────────

const aspas = (s: string) => `“${s}”`;
function juntarOu(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  const mostra = itens.slice(0, 3);
  const resto = itens.length - mostra.length;
  return resto > 0 ? `${mostra.join(", ")} (+${resto})` : `${mostra.slice(0, -1).join(", ")} ou ${mostra[mostra.length - 1]}`;
}

/** "Quando alguém mandar “JAPÃO”" — o lado do gatilho do cartão. */
export function fraseDoGatilho(tipo: TipoGatilho, c: GatilhoConfig): string {
  switch (tipo) {
    case "palavra_chave": {
      const ps = (c.palavras ?? []).map((p) => aspas(p.toUpperCase()));
      const modo = c.modo === "exata" ? "exatamente " : c.modo === "comeca" ? "começando com " : "";
      return ps.length ? `Quando alguém mandar ${modo}${juntarOu(ps)}` : "Quando alguém mandar a palavra (falta escrever)";
    }
    case "boas_vindas": return "Quando alguém mandar a primeira mensagem";
    case "padrao": return `Quando nada mais combinar (até 1× a cada ${c.intervalo_horas ?? 24} h)`;
    case "link_ref": return c.codigo ? `Quando alguém chegar pelo link ${aspas(c.codigo)}` : "Quando alguém chegar pelo link";
    case "anuncio": return (c.ad_ids ?? []).length ? `Quando alguém vier do anúncio ${juntarOu(c.ad_ids ?? [])}` : "Quando alguém vier de um anúncio";
    case "tag_adicionada": return c.tag ? `Quando a tag ${aspas(c.tag)} entrar no contato` : "Quando uma tag entrar no contato";
    case "webhook": return "Quando a LP ou o n8n chamar o endereço";
  }
}

/** "responde com “Oi…”" — o que o fluxo faz primeiro, pulando Início/Ações/Aguardar. */
export function fraseDaResposta(g: Grafo | null | undefined, max = 70): string {
  if (!g?.nos?.length) return "não faz nada ainda";
  const porId = new Map(g.nos.map((n) => [n.id, n]));
  const proximo = (id: string) => g.ligacoes.find((l) => l.de === id && l.saida === "proximo")?.para;
  let atual: No | undefined = g.nos.find((n) => n.tipo === "inicio");
  const vistos = new Set<string>();
  const corta = (s: string) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  while (atual && !vistos.has(atual.id)) {
    vistos.add(atual.id);
    if (atual.tipo === "mensagem") {
      const t = atual.dados.blocos.find((b) => b.tipo === "texto");
      const txt = t && t.tipo === "texto" ? t.texto.replace(/\s+/g, " ").trim() : "";
      return txt ? `responde com ${aspas(corta(txt))}` : "responde com uma mídia";
    }
    if (atual.tipo === "template") return atual.dados.nome ? `manda o modelo ${aspas(atual.dados.nome)}` : "manda um modelo (falta escolher)";
    if (atual.tipo === "pergunta") return atual.dados.pergunta ? `pergunta ${aspas(corta(atual.dados.pergunta))}` : "faz uma pergunta";
    if (atual.tipo === "condicao" || atual.tipo === "randomizador") return "segue um caminho conforme a regra";
    if (atual.tipo === "ir_para") return "continua em outro fluxo";
    if (atual.tipo === "fim") return "encerra";
    const p = proximo(atual.id);
    atual = p ? porId.get(p) : undefined;
  }
  return "não faz nada ainda";
}

// ── Instagram: a regra do cartão em linguagem simples ────────────────────────

export type GatilhoIg = "comentario" | "dm_palavra" | "story_resposta" | "story_mencao" | "boas_vindas";
export interface ConfigIgFrase { palavras?: string[]; qualquer_palavra?: boolean; posts?: string[]; respostas_publicas?: string[]; dm_texto?: string; dm_botoes?: { titulo: string; url: string }[] }

/** "Quando alguém comentar “ROTEIRO” em qualquer post" → "manda DM “Oi…” e responde no post". */
export function fraseInstagram(g: GatilhoIg, c: ConfigIgFrase, max = 60): { quando: string; entao: string } {
  const ps = (c.palavras ?? []).map((p) => aspas(p.toUpperCase()));
  const qualquer = c.qualquer_palavra || !ps.length;
  const ondePost = (c.posts ?? []).length ? ((c.posts ?? []).length === 1 ? "num post escolhido" : `em ${(c.posts ?? []).length} posts escolhidos`) : "em qualquer post";
  let quando: string;
  switch (g) {
    case "comentario": quando = qualquer ? `Quando alguém comentar ${ondePost}` : `Quando alguém comentar ${juntarOu(ps)} ${ondePost}`; break;
    case "dm_palavra": quando = qualquer ? "Quando alguém mandar qualquer DM" : `Quando alguém mandar ${juntarOu(ps)} na DM`; break;
    case "story_resposta": quando = qualquer ? "Quando alguém responder um story" : `Quando alguém responder um story com ${juntarOu(ps)}`; break;
    case "story_mencao": quando = "Quando alguém te mencionar num story"; break;
    case "boas_vindas": quando = "Quando alguém mandar a primeira DM"; break;
  }
  const txt = (c.dm_texto ?? "").replace(/\s+/g, " ").trim();
  const dm = txt ? `manda DM ${aspas(txt.length > max ? `${txt.slice(0, max - 1).trimEnd()}…` : txt)}` : "manda DM (falta escrever)";
  const extras: string[] = [];
  if ((c.dm_botoes ?? []).filter((b) => b.titulo && b.url).length) extras.push("com botão de link");
  if (g === "comentario" && (c.respostas_publicas ?? []).length) extras.push("responde no post");
  return { quando, entao: [dm, ...extras].join(" e ").replace(/ e (com botão)/, " $1") };
}
