// src/solicitacoes/cotacao.ts
// -----------------------------------------------------------------------------
// O FORMULÁRIO DA COTAÇÃO pro Operações (0158, Bruno 21/10/2026): "preciso que
// fique algo mais completo para o Operacional".
//
//   1ª parte — passageiro, prioridade, nº de viajantes, perfil do cliente
//   2ª parte — o que está sendo pedido (pacote, só aéreo, só hospedagem,
//              alteração, correção) e só as perguntas daquele pedido:
//              pacote → saída/destino, datas, passeios, investimento por pessoa
//              hospedagem → categoria, acomodação, regime, hotel de preferência
//              aéreo incluso? → classe, companhia, horário
//
// Fica em qs_solicitacoes.formulario (jsonb). Título e descrição são gerados
// daqui (pra busca, cartão e histórico continuarem funcionando).
// -----------------------------------------------------------------------------
import type { Solicitacao, StatusSol } from "./lib";

export type OQuePede = "pacote" | "aereo" | "hospedagem" | "alteracao" | "correcao";

export interface FormCotacao {
  v: 1;
  passageiro: string;
  adultos: number;
  criancas: number;
  idades_criancas: string;
  bebes: number;
  perfil: string[];
  perfil_comentario: string;
  pedido: OQuePede | "";
  // viagem
  saida: string;
  destino: string;
  ida: string;
  volta: string;
  datas_flexiveis: boolean;
  periodo: string;
  passeios: string;
  investimento: string;
  // hospedagem
  hospedagem: boolean;
  hotel_categoria: string;
  acomodacao: string;
  regime: string;
  tem_hotel_pref: boolean;
  hotel_preferencia: string;
  // aéreo
  aereo: boolean;
  classe: string;
  cia: string;
  horario: string;
  // alteração / correção
  servico_alterar: string;
  localizador: string;
  o_que_mudar: string;
  observacoes: string;
}

export const PEDIDOS: { id: OQuePede; rotulo: string; dica: string }[] = [
  { id: "pacote", rotulo: "Pacote completo", dica: "roteiro com hospedagem, passeios e (se quiser) aéreo" },
  { id: "aereo", rotulo: "Só aéreo", dica: "passagens" },
  { id: "hospedagem", rotulo: "Só hospedagem", dica: "hotel" },
  { id: "alteracao", rotulo: "Alteração", dica: "mudar algo já cotado ou vendido" },
  { id: "correcao", rotulo: "Correção", dica: "algo saiu errado e precisa corrigir" },
];
/** 0203: a cotação virou 3 tipos — o tipo já diz o que é. */
export const PEDIDO_DO_TIPO: Record<string, OQuePede> = { ops_cotacao: "pacote", ops_cot_aereo: "aereo", ops_cot_hotel: "hospedagem" };

export const NOME_PEDIDO: Record<OQuePede, string> = {
  pacote: "Pacote completo", aereo: "Só aéreo", hospedagem: "Só hospedagem", alteracao: "Alteração", correcao: "Correção",
};

export const PERFIS: [string, string][] = [
  ["casal", "Casal"], ["familia", "Família"], ["amigos", "Grupo de amigos"], ["lua_de_mel", "Lua de mel"], ["luxo", "Luxo"],
  ["melhor_idade", "Melhor idade"], ["influenciadores", "Influenciadores"], ["corporativo", "Corporativo"], ["expedicao", "Expedição"],
];
export const INVESTIMENTOS = [
  "Até R$ 5 mil", "R$ 5 a 10 mil", "R$ 10 a 20 mil", "R$ 20 a 35 mil", "R$ 35 a 50 mil", "Acima de R$ 50 mil", "Cliente não informou",
];
export const CATEGORIAS_HOTEL = ["Sem preferência", "Econômico (3★)", "Conforto (4★)", "Luxo (5★)", "Boutique", "Resort", "Pousada"];
export const ACOMODACOES = ["Single", "Duplo", "Triplo", "Família", "Suíte"];
export const REGIMES = ["Sem refeição", "Café da manhã", "Meia pensão", "Pensão completa", "All inclusive"];
export const CLASSES = ["Econômica", "Premium Economy", "Executiva", "Primeira classe"];
export const HORARIOS = ["Sem preferência", "Manhã", "Tarde", "Noite", "Evitar madrugada"];
export const SERVICOS_ALTERAR = ["Aéreo", "Hospedagem", "Passeio / serviço", "Seguro", "Pacote inteiro", "Outro"];

export function cotacaoVazia(passageiro = ""): FormCotacao {
  return {
    v: 1, passageiro, adultos: 2, criancas: 0, idades_criancas: "", bebes: 0, perfil: [], perfil_comentario: "", pedido: "",
    saida: "", destino: "", ida: "", volta: "", datas_flexiveis: false, periodo: "", passeios: "", investimento: "",
    hospedagem: true, hotel_categoria: "", acomodacao: "", regime: "", tem_hotel_pref: false, hotel_preferencia: "",
    aereo: true, classe: "", cia: "", horario: "",
    servico_alterar: "", localizador: "", o_que_mudar: "", observacoes: "",
  };
}

/** Lê o jsonb do banco sem quebrar se faltar campo. */
export function lerCotacao(x: unknown): FormCotacao | null {
  if (!x || typeof x !== "object") return null;
  return { ...cotacaoVazia(), ...(x as Partial<FormCotacao>) };
}

/** O que aparece em cada pedido. */
export function blocos(f: Pick<FormCotacao, "pedido" | "hospedagem" | "aereo">) {
  const p = f.pedido;
  return {
    viagem: p === "pacote" || p === "aereo" || p === "hospedagem",
    saida: p === "pacote" || p === "aereo",
    passeios: p === "pacote",
    investimento: p === "pacote" || p === "aereo" || p === "hospedagem",
    perguntaHospedagem: p === "pacote",
    hospedagem: p === "hospedagem" || (p === "pacote" && f.hospedagem),
    perguntaAereo: p === "pacote",
    aereo: p === "aereo" || (p === "pacote" && f.aereo),
    alteracao: p === "alteracao" || p === "correcao",
  };
}

/** Primeiro problema do formulário (ou null se dá pra enviar). */
export function faltaNaCotacao(f: FormCotacao): string | null {
  if (!f.passageiro.trim()) return "Escreva o nome do passageiro.";
  if (f.adultos < 1 && f.criancas < 1) return "Diga quantos viajantes são.";
  if (f.criancas > 0 && !f.idades_criancas.trim()) return "Diga a idade das crianças (muda o preço).";
  if (!f.perfil.length) return "Marque o perfil do cliente.";
  if (!f.pedido) return "Escolha o que está sendo pedido.";
  const b = blocos(f);
  if (b.viagem) {
    if (!f.destino.trim()) return "Escreva o destino.";
    if (b.saida && !f.saida.trim()) return "Escreva a cidade de saída.";
    if (f.datas_flexiveis) { if (!f.periodo.trim()) return "Diga o período aproximado (ex.: março/2027, uns 10 dias)."; }
    else {
      if (!f.ida) return f.pedido === "hospedagem" ? "Escolha a data de entrada." : "Escolha a data de ida.";
      if (f.pedido !== "aereo" && !f.volta) return f.pedido === "hospedagem" ? "Escolha a data de saída." : "Escolha a data de volta.";
      if (f.volta && f.volta < f.ida) return "A volta está antes da ida.";
    }
    if (b.investimento && !f.investimento) return "Escolha a faixa de investimento por pessoa (ou “Cliente não informou”).";
  }
  if (b.hospedagem) {
    if (!f.hotel_categoria) return "Escolha a categoria da hospedagem.";
    if (!f.acomodacao) return "Escolha o tipo de acomodação.";
    if (!f.regime) return "Escolha o regime alimentar.";
    if (f.tem_hotel_pref && !f.hotel_preferencia.trim()) return "Escreva o hotel de preferência.";
  }
  if (b.aereo && !f.classe) return "Escolha a classe do voo.";
  if (b.alteracao) {
    if (!f.servico_alterar) return "Escolha o que vai ser alterado/corrigido.";
    if (!f.o_que_mudar.trim()) return "Explique o que precisa mudar.";
  }
  return null;
}

const dm = (iso: string) => iso ? iso.split("-").reverse().slice(0, 2).join("/") : "";
const dma = (iso: string) => iso ? iso.split("-").reverse().join("/") : "";

export function textoViajantes(f: FormCotacao): string {
  const p: string[] = [];
  if (f.adultos) p.push(`${f.adultos} adulto${f.adultos > 1 ? "s" : ""}`);
  if (f.criancas) p.push(`${f.criancas} criança${f.criancas > 1 ? "s" : ""}${f.idades_criancas.trim() ? ` (${f.idades_criancas.trim()})` : ""}`);
  if (f.bebes) p.push(`${f.bebes} bebê${f.bebes > 1 ? "s" : ""}`);
  return p.join(" + ");
}

export function textoDatas(f: FormCotacao): string {
  if (f.datas_flexiveis) return f.periodo.trim() ? `${f.periodo.trim()} (flexível)` : "datas flexíveis";
  if (f.ida && f.volta) return `${dm(f.ida)} a ${dma(f.volta)}`;
  return f.ida ? `${f.pedido === "aereo" ? "só ida " : ""}${dma(f.ida)}` : "";
}

export function tituloDaCotacao(f: FormCotacao): string {
  const pax = textoViajantes(f).replace(/ \([^)]*\)/, "");
  let t: string;
  if (f.pedido === "alteracao" || f.pedido === "correcao") {
    t = [NOME_PEDIDO[f.pedido], f.servico_alterar, f.localizador.trim(), f.passageiro.trim()].filter(Boolean).join(" · ");
  } else {
    const onde = f.pedido === "aereo" ? `${f.saida.trim()} → ${f.destino.trim()}` : f.destino.trim();
    const nome = f.pedido === "aereo" ? "aéreo" : f.pedido === "hospedagem" ? "hospedagem" : "pacote";
    t = [`Cotação ${nome}`, onde, textoDatas(f), pax].filter(Boolean).join(" · ");
  }
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** As linhas "Rótulo: valor" de cada parte (a tela e a descrição usam as mesmas). */
export function secoesDaCotacao(f: FormCotacao): { titulo: string; linhas: [string, string][] }[] {
  const b = blocos(f);
  const perfil = f.perfil.map((k) => PERFIS.find((p) => p[0] === k)?.[1] ?? k).join(", ");
  const s: { titulo: string; linhas: [string, string][] }[] = [];
  s.push({ titulo: "Cliente", linhas: [
    ["Passageiro", f.passageiro.trim()],
    ["Viajantes", textoViajantes(f)],
    ["Perfil", [perfil, f.perfil_comentario.trim()].filter(Boolean).join(" — ")],
  ] });
  s.push({ titulo: f.pedido ? NOME_PEDIDO[f.pedido] : "Pedido", linhas: b.alteracao ? [
    ["O que muda", f.servico_alterar],
    ["Localizador / reserva", f.localizador.trim()],
    ["Detalhe", f.o_que_mudar.trim()],
  ] : [
    ["Saída", b.saida ? f.saida.trim() : ""],
    ["Destino", f.destino.trim()],
    [f.pedido === "hospedagem" ? "Entrada e saída" : "Datas", textoDatas(f)],
    ["Passeios e experiências", b.passeios ? f.passeios.trim() : ""],
    ["Investimento por pessoa", b.investimento ? f.investimento : ""],
  ] });
  if (b.perguntaHospedagem || b.hospedagem) {
    s.push({ titulo: "Hospedagem", linhas: b.hospedagem ? [
      ["Categoria", f.hotel_categoria],
      ["Acomodação", f.acomodacao],
      ["Regime", f.regime],
      ["Hotel de preferência", f.tem_hotel_pref ? f.hotel_preferencia.trim() : "Não tem"],
    ] : [["Hospedagem", "Não incluir"]] });
  }
  if (b.perguntaAereo || b.aereo) {
    s.push({ titulo: "Aéreo", linhas: b.aereo ? [
      ["Classe", f.classe],
      ["Companhia preferida", f.cia.trim() || "Sem preferência"],
      ["Horário do voo", f.horario || "Sem preferência"],
    ] : [["Aéreo", "Não incluir"]] });
  }
  if (f.observacoes.trim()) s.push({ titulo: "Observações", linhas: [["", f.observacoes.trim()]] });
  return s.map((x) => ({ ...x, linhas: x.linhas.filter(([, v]) => !!v) })).filter((x) => x.linhas.length);
}

export function descricaoDaCotacao(f: FormCotacao): string {
  return secoesDaCotacao(f).map((s) => [`— ${s.titulo} —`, ...s.linhas.map(([r, v]) => (r ? `${r}: ${v}` : v))].join("\n")).join("\n\n");
}

// ── Etapas e desfecho ───────────────────────────────────────────────────────

export const MOTIVOS_NAO_SEGUIU: [string, string][] = [
  ["preco", "Preço acima do esperado"],
  ["outra_agencia", "Fechou com outra agência"],
  ["desistiu", "Desistiu ou adiou a viagem"],
  ["mudou", "Mudou destino ou datas"],
  ["sem_resposta", "Cliente parou de responder"],
  ["demora", "A cotação demorou"],
  ["nao_atendeu", "A cotação não atendeu o pedido"],
  ["outro", "Outro"],
];
export const NOME_MOTIVO = Object.fromEntries(MOTIVOS_NAO_SEGUIU) as Record<string, string>;

type ParaRotulo = Pick<Solicitacao, "status" | "aguardando_quem" | "cotacao" | "desfecho" | "desfecho_atrasado">;

const AGUARDANDO_TXT: Record<string, string> = { cliente: "o cliente", fornecedor: "o fornecedor", outro_setor: "outro setor" };

/** O nome da etapa: na cotação, os nomes do Bruno (Nova solicitação · Aguardando ajustes · Em cotação · Cotação entregue). */
export function rotuloStatus(s: ParaRotulo, curto = false): string {
  const ajuste = s.status === "aguardando" && s.aguardando_quem === "solicitante";
  if (ajuste) return "Aguardando ajustes";
  if (s.cotacao) {
    if (s.status === "nova") return curto ? "Nova solicitação" : "Nova solicitação — esperando aprovação";
    if (s.status === "em_andamento") return "Em cotação";
    if (s.status === "aguardando") return curto ? "Em cotação" : `Em cotação · aguardando ${AGUARDANDO_TXT[s.aguardando_quem ?? ""] ?? ""}`;
    if (s.status === "concluida") {
      if (s.desfecho === "fechou") return "Entregue · fechou";
      if (s.desfecho === "nao_seguiu") return "Entregue · não seguiu";
      return s.desfecho_atrasado ? "Entregue · desfecho atrasado" : "Cotação entregue";
    }
  }
  const base: Record<StatusSol, string> = {
    nova: curto ? "Nova" : "Nova — ninguém pegou", em_andamento: "Em andamento", aguardando: "Aguardando",
    concluida: "Concluída", recusada: "Recusada", cancelada: "Cancelada",
  };
  if (s.status === "aguardando" && s.aguardando_quem && !curto) return `Aguardando ${AGUARDANDO_TXT[s.aguardando_quem] ?? ""}`;
  return base[s.status];
}

export function tomStatus(s: ParaRotulo): "neutro" | "rel" | "aviso" | "erro" {
  if (s.status === "aguardando" && s.aguardando_quem === "solicitante") return "aviso";
  if (s.status === "concluida" && s.cotacao) return s.desfecho === "nao_seguiu" ? "neutro" : s.desfecho_atrasado ? "erro" : "rel";
  return ({ nova: "aviso", em_andamento: "rel", aguardando: "neutro", concluida: "rel", recusada: "erro", cancelada: "neutro" } as const)[s.status];
}
