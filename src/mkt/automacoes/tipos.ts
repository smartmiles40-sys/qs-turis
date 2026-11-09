// src/mkt/automacoes/tipos.ts
// -----------------------------------------------------------------------------
// O vocabulário das automações do Marketing ("igual ManyChat"), lado da tela.
// Porte do SendFlow (src/lib/automacao/tipos.ts).
//
// Um FLUXO é um grafo: blocos ligados por setas. Cada seta sai de uma SAÍDA
// nomeada do bloco ("proximo", o id de um botão, "sim"/"nao"…) e entra em outro
// bloco. O grafo mora em mkt_fluxos.grafo (jsonb) — o editor desenha, o motor
// (api/_mktMotor.js) percorre.
//
// ⚠️ `saidasDoNo` existe também em api/_mktAutoRegras.js (o QS não compartilha
// código entre src/ e api/). tests/mkt/regras.test.ts confere que as duas dão
// o mesmo resultado — mexeu numa, mexa na outra.
// -----------------------------------------------------------------------------

export type TipoNo = "inicio" | "mensagem" | "template" | "pergunta" | "aguardar" | "condicao" | "acao" | "randomizador" | "ir_para" | "fim";

export type Bloco =
  | { tipo: "texto"; texto: string }
  | { tipo: "imagem" | "video" | "audio" | "documento"; url: string; legenda?: string; nome?: string };

export interface BotaoResposta { id: string; titulo: string }
export interface ItemLista { id: string; titulo: string; descricao?: string }
export interface SecaoLista { titulo: string; itens: ItemLista[] }

export type Interacao =
  | { tipo: "nenhuma" }
  | { tipo: "botoes"; botoes: BotaoResposta[] }
  | { tipo: "lista"; rotuloBotao: string; secoes: SecaoLista[] }
  | { tipo: "link"; rotulo: string; url: string };

export interface DadosMensagem {
  blocos: Bloco[];
  interacao: Interacao;
  cabecalho?: string;
  rodape?: string;
  /** Prazo do clique antes da saída "Não respondeu". 0 = espera para sempre. */
  esperarMinutos?: number;
  digitando?: boolean;
}
export interface DadosTemplate {
  nome: string;
  idioma: string;
  /** posição → texto com marcadores: {"1": "{{primeiro_nome}}"} */
  variaveis: Record<string, string>;
  cabecalhoUrl?: string | null;
  /** Textos dos botões de resposta rápida do modelo — cada um vira uma saída. */
  botoes?: string[];
}
export type TipoResposta = "texto" | "numero" | "email" | "telefone" | "data" | "qualquer";
export interface DadosPergunta {
  pergunta: string;
  tipoResposta: TipoResposta;
  salvarEm: string | null;
  sugestoes?: string[];
  mensagemErro?: string;
  tentativas?: number;
  esperarMinutos?: number;
}
export type UnidadeTempo = "minutos" | "horas" | "dias";
export interface DadosAguardar { quantidade: number; unidade: UnidadeTempo; janelaInicio?: string | null; janelaFim?: string | null }
export type CampoCondicao = "tag" | "campo" | "nome" | "email" | "telefone" | "janela_aberta" | "inscrito_whatsapp";
export type OperadorCondicao = "tem" | "nao_tem" | "igual" | "diferente" | "contem" | "nao_contem" | "vazio" | "preenchido" | "maior" | "menor";
export interface Regra { campo: CampoCondicao; chave?: string; operador: OperadorCondicao; valor?: string }
export interface DadosCondicao { combinar: "todas" | "qualquer"; regras: Regra[] }

export type Acao =
  | { tipo: "adicionar_tag"; tag: string }
  | { tipo: "remover_tag"; tag: string }
  | { tipo: "definir_campo"; chave: string; valor: string }
  | { tipo: "limpar_campo"; chave: string }
  | { tipo: "adicionar_lista"; lista: string }
  | { tipo: "remover_lista"; lista: string }
  | { tipo: "descadastrar" }
  | { tipo: "reinscrever" }
  | { tipo: "pausar_automacao"; horas: number }
  | { tipo: "avisar_humano"; usuarios: string[]; mensagem: string; horas?: number }
  | { tipo: "webhook"; url: string }
  | { tipo: "parar_outros_fluxos" };
export interface DadosAcao { acoes: Acao[] }
export interface Variante { id: string; nome: string; peso: number }
export interface DadosRandomizador { variantes: Variante[] }
export interface DadosIrPara { fluxoId: string | null }

interface NoBase<T extends TipoNo, D> { id: string; tipo: T; x: number; y: number; titulo?: string; dados: D }
export type No =
  | NoBase<"inicio", Record<string, never>>
  | NoBase<"mensagem", DadosMensagem>
  | NoBase<"template", DadosTemplate>
  | NoBase<"pergunta", DadosPergunta>
  | NoBase<"aguardar", DadosAguardar>
  | NoBase<"condicao", DadosCondicao>
  | NoBase<"acao", DadosAcao>
  | NoBase<"randomizador", DadosRandomizador>
  | NoBase<"ir_para", DadosIrPara>
  | NoBase<"fim", Record<string, never>>;

export interface Ligacao { id: string; de: string; saida: string; para: string }
export interface Grafo { nos: No[]; ligacoes: Ligacao[] }

export interface Saida { id: string; rotulo: string; secundaria?: boolean }

/** As saídas de um bloco (as bolinhas de onde saem as setas). MESMA regra do motor. */
export function saidasDoNo(no: No): Saida[] {
  switch (no.tipo) {
    case "inicio":
      return [{ id: "proximo", rotulo: "Começar" }];
    case "mensagem": {
      const d = no.dados;
      const it = d.interacao ?? { tipo: "nenhuma" };
      const extras: Saida[] = [];
      if ((d.esperarMinutos ?? 0) > 0 && it.tipo !== "nenhuma" && it.tipo !== "link") extras.push({ id: "sem_resposta", rotulo: "Não respondeu", secundaria: true });
      extras.push({ id: "janela_fechada", rotulo: "Janela de 24 h fechada", secundaria: true });
      if (it.tipo === "botoes") return [...it.botoes.map((b) => ({ id: b.id, rotulo: b.titulo || "Botão" })), { id: "texto_livre", rotulo: "Digitou outra coisa", secundaria: true }, ...extras];
      if (it.tipo === "lista") return [...it.secoes.flatMap((s) => s.itens.map((i) => ({ id: i.id, rotulo: i.titulo || "Opção" }))), { id: "texto_livre", rotulo: "Digitou outra coisa", secundaria: true }, ...extras];
      return [{ id: "proximo", rotulo: "Depois de enviar" }, ...extras];
    }
    case "template":
      return [{ id: "proximo", rotulo: "Depois de enviar" }, ...(no.dados.botoes ?? []).map((b, i) => ({ id: `botao_${i}`, rotulo: b })), { id: "falha", rotulo: "Não enviou", secundaria: true }];
    case "pergunta":
      return [
        { id: "respondeu", rotulo: "Respondeu" },
        { id: "nao_respondeu", rotulo: "Não respondeu / inválido", secundaria: true },
        { id: "janela_fechada", rotulo: "Janela de 24 h fechada", secundaria: true },
      ];
    case "aguardar":
      return [{ id: "proximo", rotulo: "Depois de esperar" }];
    case "condicao":
      return [{ id: "sim", rotulo: "Sim" }, { id: "nao", rotulo: "Não" }];
    case "acao":
      return [{ id: "proximo", rotulo: "Depois" }];
    case "randomizador":
      return no.dados.variantes.map((v) => ({ id: v.id, rotulo: `${v.nome} · ${v.peso}%` }));
    default:
      return [];
  }
}

export const LIMITES = { botoes: 3, tituloBotao: 20, itensLista: 10, tituloItem: 24, descricaoItem: 72, rotuloBotaoLista: 20, textoInterativo: 1024, texto: 4096, cabecalho: 60, rodape: 60 } as const;

export interface ProblemaGrafo { noId: string | null; mensagem: string; grave: boolean }

/** O canal do fluxo (0343). Fluxo sem canal = WhatsApp. */
export type Canal = "whatsapp" | "instagram";
export const canalDo = (f: { canal?: Canal | null } | null | undefined): Canal => (f?.canal === "instagram" ? "instagram" : "whatsapp");

/**
 * Limites do Instagram (api/_mktIgRegras.js): texto até 1000 bytes; botões de
 * resposta viram "respostas rápidas" (até 13, 20 letras); documento só PDF.
 */
export const LIMITES_IG = { textoBytes: 1000, respostasRapidas: 13 } as const;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export const ROTULO_TIPO: Record<TipoNo, string> = {
  inicio: "Início", mensagem: "Mensagem", template: "Template (fora das 24 h)", pergunta: "Pergunta", aguardar: "Aguardar",
  condicao: "Condição", acao: "Ações", randomizador: "Teste A/B", ir_para: "Ir para outro fluxo", fim: "Fim",
};

const nomeDo = (no: No) => no.titulo || ROTULO_TIPO[no.tipo];

/** Confere o grafo antes de ATIVAR: erro (grave) impede; aviso não. */
export function validarGrafo(g: Grafo, canal: Canal = "whatsapp"): ProblemaGrafo[] {
  const p: ProblemaGrafo[] = [];
  if (canal === "instagram") p.push(...problemasDoInstagram(g));
  const ids = new Set(g.nos.map((n) => n.id));
  const inicio = g.nos.filter((n) => n.tipo === "inicio");
  if (inicio.length !== 1) p.push({ noId: null, mensagem: 'O fluxo precisa de exatamente um bloco "Início".', grave: true });
  for (const l of g.ligacoes) if (!ids.has(l.de) || !ids.has(l.para)) p.push({ noId: l.de, mensagem: "Há uma seta ligada a um bloco que não existe mais.", grave: false });
  const ligada = (id: string, s: string) => g.ligacoes.some((l) => l.de === id && l.saida === s);
  if (inicio[0] && !ligada(inicio[0].id, "proximo")) p.push({ noId: inicio[0].id, mensagem: 'Ligue o "Início" ao primeiro bloco.', grave: true });

  for (const no of g.nos) {
    const nome = nomeDo(no);
    const erro = (mensagem: string, grave = true) => p.push({ noId: no.id, mensagem: `"${nome}": ${mensagem}`, grave });
    switch (no.tipo) {
      case "mensagem": {
        const d = no.dados;
        if (!d.blocos.length) erro("a mensagem está vazia.");
        d.blocos.forEach((b, i) => {
          if (b.tipo === "texto") {
            if (!b.texto.trim()) erro(`o texto ${i + 1} está vazio.`);
            if (b.texto.length > LIMITES.texto) erro(`texto passa de ${LIMITES.texto} caracteres.`);
          } else if (!/^https:\/\//i.test(b.url)) erro(`a mídia ${i + 1} precisa de um link https.`);
        });
        const it = d.interacao;
        if (it.tipo !== "nenhuma") {
          const ult = d.blocos[d.blocos.length - 1];
          if (!ult || ult.tipo !== "texto") erro("botões, lista e link vão presos a um TEXTO — termine com um texto.");
          else if (ult.texto.length > LIMITES.textoInterativo) erro(`texto com botões/lista: no máximo ${LIMITES.textoInterativo} caracteres.`);
        }
        if (it.tipo === "botoes") {
          if (!it.botoes.length || it.botoes.length > LIMITES.botoes) erro(`use de 1 a ${LIMITES.botoes} botões.`);
          const vistos = new Set<string>();
          for (const b of it.botoes) {
            const t = b.titulo.trim();
            if (!t) erro("há botão sem texto.");
            if (t.length > LIMITES.tituloBotao) erro(`o botão "${t}" passa de ${LIMITES.tituloBotao} caracteres.`);
            if (vistos.has(t.toLowerCase())) erro("dois botões com o mesmo texto — a Meta recusa.");
            vistos.add(t.toLowerCase());
            if (!ligada(no.id, b.id)) erro(`o botão "${t || "?"}" não leva a lugar nenhum.`, false);
          }
        }
        if (it.tipo === "lista") {
          const itens = it.secoes.flatMap((s) => s.itens);
          if (!itens.length || itens.length > LIMITES.itensLista) erro(`a lista precisa de 1 a ${LIMITES.itensLista} opções.`);
          if (!it.rotuloBotao.trim() || it.rotuloBotao.length > LIMITES.rotuloBotaoLista) erro(`o botão que abre a lista precisa de 1 a ${LIMITES.rotuloBotaoLista} caracteres.`);
          for (const i of itens) if (!i.titulo.trim() || i.titulo.length > LIMITES.tituloItem) erro(`opção "${i.titulo}" precisa de 1 a ${LIMITES.tituloItem} caracteres.`);
        }
        if (it.tipo === "link") {
          if (!/^https?:\/\//i.test(it.url)) erro("o botão de link precisa de um endereço http(s).");
          if (!it.rotulo.trim() || it.rotulo.length > LIMITES.tituloBotao) erro(`o texto do botão de link precisa de 1 a ${LIMITES.tituloBotao} caracteres.`);
        }
        if ((d.cabecalho ?? "").length > LIMITES.cabecalho) erro(`cabeçalho passa de ${LIMITES.cabecalho} caracteres.`);
        if ((d.rodape ?? "").length > LIMITES.rodape) erro(`rodapé passa de ${LIMITES.rodape} caracteres.`);
        break;
      }
      case "template":
        if (!no.dados.nome) erro("escolha o modelo.");
        break;
      case "pergunta":
        if (!no.dados.pergunta.trim()) erro("escreva a pergunta.");
        if ((no.dados.sugestoes ?? []).length > LIMITES.botoes) erro(`no máximo ${LIMITES.botoes} sugestões.`);
        break;
      case "aguardar":
        if (!(no.dados.quantidade > 0)) erro("o tempo de espera precisa ser maior que zero.");
        break;
      case "condicao":
        if (!no.dados.regras.length) erro("adicione pelo menos uma regra.");
        break;
      case "acao":
        if (!no.dados.acoes.length) erro("adicione pelo menos uma ação.", false);
        for (const a of no.dados.acoes) {
          if ((a.tipo === "adicionar_tag" || a.tipo === "remover_tag") && !a.tag.trim()) erro("ação de tag sem tag.");
          if ((a.tipo === "definir_campo" || a.tipo === "limpar_campo") && !a.chave) erro("escolha o campo.");
          if ((a.tipo === "adicionar_lista" || a.tipo === "remover_lista") && !a.lista.trim()) erro("escreva o nome da lista.");
          if (a.tipo === "webhook" && !/^https:\/\//i.test(a.url)) erro("o webhook precisa de endereço https.");
          if (a.tipo === "avisar_humano" && !a.usuarios.length) erro("escolha quem será avisado.", false);
        }
        break;
      case "randomizador":
        if (no.dados.variantes.length < 2) erro("o teste A/B precisa de pelo menos 2 caminhos.");
        if (no.dados.variantes.every((v) => !(v.peso > 0))) erro("todos os pesos estão zerados.");
        break;
      case "ir_para":
        if (!no.dados.fluxoId) erro("escolha para qual fluxo ir.");
        break;
    }
  }
  // Blocos soltos: ninguém chega neles.
  const alc = new Set<string>();
  const fila = inicio.map((n) => n.id);
  while (fila.length) {
    const a = fila.shift() as string;
    if (alc.has(a)) continue;
    alc.add(a);
    for (const l of g.ligacoes) if (l.de === a) fila.push(l.para);
  }
  for (const no of g.nos) if (!alc.has(no.id)) p.push({ noId: no.id, mensagem: `"${nomeDo(no)}" está solto — nenhuma seta chega nele.`, grave: false });
  return p;
}

/** Instagram: o que o editor avisa antes de ativar (o motor recusaria). */
function problemasDoInstagram(g: Grafo): ProblemaGrafo[] {
  const p: ProblemaGrafo[] = [];
  for (const no of g.nos) {
    const nome = nomeDo(no);
    if (no.tipo === "template") p.push({ noId: no.id, mensagem: `"${nome}": Template é só do WhatsApp — no Instagram use uma Mensagem.`, grave: true });
    if (no.tipo === "mensagem") {
      for (const b of no.dados.blocos) {
        if (b.tipo === "texto" && bytes(b.texto) > LIMITES_IG.textoBytes) p.push({ noId: no.id, mensagem: `"${nome}": no Instagram o texto vai até ~1.000 caracteres (sem emoji demais).`, grave: true });
        if (b.tipo === "documento" && !/\.pdf(\?|$)/i.test(b.url)) p.push({ noId: no.id, mensagem: `"${nome}": no Instagram, documento só PDF.`, grave: true });
      }
    }
  }
  // Comentário → DM: só UMA mensagem sai antes da pessoa responder.
  const inicio = g.nos.find((n) => n.tipo === "inicio");
  const prox = inicio && g.ligacoes.find((l) => l.de === inicio.id && l.saida === "proximo");
  const primeiro = prox && g.nos.find((n) => n.id === prox.para);
  if (primeiro?.tipo === "mensagem") {
    const it = primeiro.dados.interacao;
    const saem = primeiro.dados.blocos.filter((b) => b.tipo !== "texto").length * 2 + primeiro.dados.blocos.filter((b) => b.tipo === "texto").length;
    if (saem > 1) p.push({ noId: primeiro.id, mensagem: `"${nomeDo(primeiro)}": vindo de COMENTÁRIO, só a 1ª bolha sai antes da pessoa responder. Deixe um texto só (com botões) e o resto depois do clique.`, grave: false });
    else if (it.tipo === "nenhuma") p.push({ noId: primeiro.id, mensagem: `"${nomeDo(primeiro)}": vindo de COMENTÁRIO, ponha um botão — o clique abre a conversa e o resto do fluxo pode sair.`, grave: false });
  }
  return p;
}

export const TIPOS_GATILHO = [
  "palavra_chave", "boas_vindas", "padrao", "link_ref", "anuncio", "tag_adicionada", "webhook",
  "ig_comentario", "ig_dm_palavra", "ig_story_resposta", "ig_story_mencao", "ig_boas_vindas", "ig_ref",
] as const;
export type TipoGatilho = (typeof TIPOS_GATILHO)[number];
export const GATILHOS_IG: TipoGatilho[] = ["ig_comentario", "ig_dm_palavra", "ig_story_resposta", "ig_story_mencao", "ig_boas_vindas", "ig_ref"];
export const ehGatilhoIg = (t: TipoGatilho) => t.startsWith("ig_");
export const ROTULO_GATILHO: Record<TipoGatilho, string> = {
  palavra_chave: "Palavra-chave", boas_vindas: "Boas-vindas (1ª mensagem)", padrao: "Resposta padrão", link_ref: "Link de referência (wa.me / QR)",
  anuncio: "Anúncio clique-para-WhatsApp", tag_adicionada: "Tag adicionada", webhook: "Webhook (LP, n8n)",
  ig_comentario: "Comentário no post/reels", ig_dm_palavra: "Palavra na DM", ig_story_resposta: "Resposta ao story", ig_story_mencao: "Menção no story",
  ig_boas_vindas: "Boas-vindas (1ª DM)", ig_ref: "Link ig.me / QR",
};
export interface GatilhoConfig {
  palavras?: string[]; modo?: "contem" | "exata" | "comeca"; codigo?: string; texto?: string; ad_ids?: string[]; tag?: string; intervalo_horas?: number; token?: string;
  /** Instagram: qualquer comentário/DM, só nestes posts, respostas públicas (sorteia uma). */
  qualquer_palavra?: boolean; posts?: string[]; respostas_publicas?: string[];
  /** Link de entrada: nome que só o time vê. */
  nome?: string;
}
export interface Gatilho { id: string; fluxo_id: string; tipo: TipoGatilho; config: GatilhoConfig; ativo: boolean; prioridade: number; disparos: number; cliques?: number; criado_em: string }
export interface Fluxo { id: string; nome: string; descricao: string | null; status: "rascunho" | "ativo" | "pausado"; grafo: Grafo; pasta: string | null; execucoes_total: number; concluidas_total: number; criado_em: string; atualizado_em: string; canal?: Canal }
export interface CampoPersonalizado { id: string; chave: string; rotulo: string; tipo: "texto" | "numero" | "data" | "sim_nao" | "email" | "telefone"; descricao: string | null }

export const JANELA_MS = 24 * 3_600_000;
export function janelaAberta(ultima: string | null | undefined, agora = Date.now()): boolean {
  if (!ultima) return false;
  const t = new Date(ultima).getTime();
  return Number.isFinite(t) && agora - t < JANELA_MS - 2 * 60_000;
}

export function novoId(prefixo = "n"): string {
  return `${prefixo}_${Math.random().toString(36).slice(2, 9)}`;
}

export function noPadrao(tipo: TipoNo, x: number, y: number): No {
  const id = novoId(tipo.slice(0, 3));
  switch (tipo) {
    case "inicio": return { id, tipo, x, y, dados: {} };
    case "mensagem": return { id, tipo, x, y, dados: { blocos: [{ tipo: "texto", texto: "" }], interacao: { tipo: "nenhuma" }, digitando: true } };
    case "template": return { id, tipo, x, y, dados: { nome: "", idioma: "pt_BR", variaveis: {}, botoes: [] } };
    case "pergunta": return { id, tipo, x, y, dados: { pergunta: "", tipoResposta: "texto", salvarEm: null, sugestoes: [], mensagemErro: "Não entendi. Pode mandar de novo?", tentativas: 2, esperarMinutos: 0 } };
    case "aguardar": return { id, tipo, x, y, dados: { quantidade: 1, unidade: "dias", janelaInicio: null, janelaFim: null } };
    case "condicao": return { id, tipo, x, y, dados: { combinar: "todas", regras: [{ campo: "tag", operador: "tem", valor: "" }] } };
    case "acao": return { id, tipo, x, y, dados: { acoes: [] } };
    case "randomizador": return { id, tipo, x, y, dados: { variantes: [{ id: novoId("v"), nome: "A", peso: 50 }, { id: novoId("v"), nome: "B", peso: 50 }] } };
    case "ir_para": return { id, tipo, x, y, dados: { fluxoId: null } };
    case "fim": return { id, tipo, x, y, dados: {} };
  }
}

export function grafoInicial(): Grafo {
  const inicio = noPadrao("inicio", 40, 160);
  const msg = noPadrao("mensagem", 340, 120);
  return { nos: [inicio, msg], ligacoes: [{ id: novoId("l"), de: inicio.id, saida: "proximo", para: msg.id }] };
}

/** ig.me/m/<conta>?ref=<código> — abre a DM e o código chega no webhook (gatilho ig_ref). */
export function linkIgMe(usuario: string, codigo: string): string {
  return `https://ig.me/m/${encodeURIComponent(String(usuario).replace(/^@/, "").trim())}?ref=${encodeURIComponent(codigo)}`;
}

/** O link curto do QS que conta o clique: <site>/e/<código> (QR leva ?q=1). */
export function linkCurto(origem: string, codigo: string, qr = false): string {
  return `${origem.replace(/\/+$/, "")}/e/${encodeURIComponent(codigo)}${qr ? "?q=1" : ""}`;
}

export function linkDeReferencia(numero: string, codigo: string, texto?: string): string {
  const frase = `${(texto ?? "").trim() || "Olá!"} [ref:${codigo}]`;
  return `https://wa.me/${String(numero).replace(/\D/g, "")}?text=${encodeURIComponent(frase)}`;
}

/** Token do Instagram (mesma regra de api/_mktIgRegras.js situacaoToken): ok / vence em < 7 dias / vencido / erro / desconhecido. */
export type SituacaoToken = "ok" | "vence_logo" | "vencido" | "erro" | "desconhecido";
export function situacaoToken(conta: { status?: string | null; token_expira_em?: string | null } | null | undefined, agora = Date.now()): SituacaoToken {
  if (!conta) return "desconhecido";
  if (conta.status === "erro") return "erro";
  const expira = conta.token_expira_em ? Date.parse(conta.token_expira_em) : NaN;
  if (!Number.isFinite(expira)) return "desconhecido";
  if (expira <= agora) return "vencido";
  return expira - agora < 7 * 86_400_000 ? "vence_logo" : "ok";
}
