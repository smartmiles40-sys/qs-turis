// src/expedicoes/lib/alertas/expedicoes.ts
// -----------------------------------------------------------------------------
// "PRECISA DE ATENÇÃO" da Central de Expedições (redesign 29/10, spec §2.2).
// Irmão do ./regras.ts: lá são os avisos POR PASSAGEIRO (exigência pendente na
// janela do tipo — tela Avisos); aqui são os avisos POR EXPEDIÇÃO, consolidados.
// As duas tabelas de configuração moram nesta pasta — é o lugar central das regras.
//
// Lógica PURA (sem React, sem banco, sem alias "@/"): recebe os números já
// lidos e devolve a lista pronta, ordenada (severidade, depois data) e com as
// expedições IRMÃS agrupadas ("Tailândia G1 e G2 embarcam em 15 dias…").
// Testes: tests/expedicoes/alertas.test.ts.
//
// Dado que ainda não existe (ver docs/MAPA-EXPEDICOES.md › Lacunas): quando o
// campo vem `null`/`undefined`, a regra simplesmente não dispara.
// -----------------------------------------------------------------------------
import { diasEntre, infoFase, type Fase } from "../fase.ts";
import { juntarGrupos, nomeDaExpedicao } from "../nomeExpedicao.ts";

export type SeveridadeExp = "critico" | "atencao" | "info";

export const ROTULO_SEVERIDADE: Record<SeveridadeExp, string> = { critico: "Crítico", atencao: "Atenção", info: "Info" };
const PESO: Record<SeveridadeExp, number> = { critico: 0, atencao: 1, info: 2 };

/** Limiares das regras (ajuste aqui). */
export const REGRAS_ATENCAO = {
  /** Fase embarque com menos que isso de aptos → Crítico. */
  embarqueAptosMin: 0.5,
  /** Fase preparação, faltando menos que `preparacaoDias`, com menos que isso de aptos → Atenção. */
  preparacaoAptosMin: 0.2,
  preparacaoDias: 60,
  /** Ação "crítica" do Roteiro do Líder nos próximos N dias → Atenção. */
  acaoCriticaDias: 3,
  /** Vendendo com ocupação abaixo disso faltando menos que `vendendoDias` → Info. */
  vendendoOcupacaoMin: 0.3,
  vendendoDias: 365,
} as const;

/** Uma ação do Roteiro do Líder (campo de ação dentro do dia). */
export interface AcaoRoteiro {
  /** Nº do dia (D1, D2…) — só pra texto. */
  dia: number | null;
  /** Data do dia ("YYYY-MM-DD"). Sem data a ação não entra nas regras de prazo. */
  data: string | null;
  titulo: string;
  /** Severidade marcada no roteiro. Só "critico" entra na regra dos 3 dias. */
  severidade: "critico" | "atencao" | "ok" | null;
  /**
   * Já teve baixa? `null` = o banco ainda não guarda baixa (Lacuna [SCHEMA]):
   * aí a regra "dia passado sem baixa" não dispara, pra não acusar tudo.
   */
  baixada: boolean | null;
}

/** O que a regra precisa saber de cada expedição. */
export interface DadosAlertaExp {
  id: string;
  nome: string;
  grupo_rotulo?: string | null;
  /** Vínculo das irmãs (0029). Sem ele, irmã = mesmo nome base + mesma data de embarque. */
  viagem_grupo?: string | null;
  data_embarque: string | null;
  data_retorno: string | null;
  status?: string | null;
  /** Ocupação: confirmados (sem líderes) / vagas planejadas. */
  pax_confirmados: number;
  pax_planejados: number;
  /** Prontidão: aptos / total avaliado (não cancelados, líderes contam). */
  prontidao_aptos: number;
  prontidao_total: number;
  /** Passageiros sem valor lançado (Valores). null/undefined = não lido. */
  pax_sem_valor?: number | null;
  /** Passageiros com seguro exigido e sem apólice anexada. null/undefined = sem dado. */
  seguro_sem_apolice?: number | null;
  /** Ações do Roteiro do Líder. null/undefined = não lido. */
  acoes_roteiro?: AcaoRoteiro[] | null;
}

export type RegraId =
  | "embarque_aptos" | "preparacao_aptos" | "acao_critica" | "acao_sem_baixa"
  | "sem_valor" | "seguro_sem_apolice" | "vendendo_ocupacao";

/** Aba do detalhe (endereço ANTIGO #ops/expedicoes/<id>/<aba>; o cockpit novo redireciona). */
export type AbaAlvo = "" | "passageiros" | "valores" | "roteiro-lider";

export interface AlertaExp {
  chave: string;
  regra: RegraId;
  severidade: SeveridadeExp;
  titulo: string;
  sub: string;
  /** Texto do botão. */
  cta: string;
  /** Expedição que o botão abre (a primeira do grupo) e a aba. */
  expedicaoId: string;
  aba: AbaAlvo;
  /** Todas as expedições cobertas (irmãs agrupadas). */
  expedicaoIds: string[];
  /** Data de referência pra ordenar (embarque, ou o dia da ação). */
  data: string;
}

type Bruto = Omit<AlertaExp, "chave" | "titulo" | "sub" | "expedicaoIds"> & {
  /** Agrupa irmãs com a mesma chave; null = não agrupa. */
  agrupar: string | null;
  exp: DadosAlertaExp;
  /** Monta título e sub a partir do nome (já juntado) e das expedições do grupo. */
  texto: (nome: string, grupo: DadosAlertaExp[]) => { titulo: string; sub: string };
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const emDias = (d: number) => (d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const soma = (g: DadosAlertaExp[], f: (e: DadosAlertaExp) => number) => g.reduce((a, e) => a + f(e), 0);
const verbo = (g: DadosAlertaExp[], um: string, varios: string) => (g.length > 1 ? varios : um);

/** Chave das irmãs: (viagem_grupo, senão nome base) + MESMA data de embarque — G1/G2 que saem em 13/11 juntam; G3/G4 de 17/11 viram outro aviso. */
function chaveIrmas(e: DadosAlertaExp): string {
  return `${e.viagem_grupo ? `vg:${e.viagem_grupo}` : `nb:${nomeDaExpedicao(e).base.toLowerCase()}`}|${e.data_embarque ?? ""}`;
}

/** Fase da expedição hoje (cancelada fica fora de tudo). */
export function faseParaAlerta(e: Pick<DadosAlertaExp, "data_embarque" | "data_retorno">, hoje: string | Date): Fase {
  return infoFase(e.data_embarque, e.data_retorno, hoje).fase;
}

function regrasDe(e: DadosAlertaExp, hoje: string | Date): Bruto[] {
  if (e.status === "Cancelada") return [];
  const out: Bruto[] = [];
  const inf = infoFase(e.data_embarque, e.data_retorno, hoje);
  const { fase, diasParaInicio } = inf;
  const irmas = chaveIrmas(e);
  const dataRef = e.data_embarque ?? "9999-12-31";
  const fracAptos = e.prontidao_total ? e.prontidao_aptos / e.prontidao_total : null;
  const R = REGRAS_ATENCAO;

  // 1. Embarque e aptos < 50% → Crítico
  if (fase === "embarque" && fracAptos != null && fracAptos < R.embarqueAptosMin) {
    out.push({ regra: "embarque_aptos", severidade: "critico", cta: "Ver pendências", aba: "passageiros", expedicaoId: e.id, data: dataRef,
      agrupar: `embarque_aptos|${irmas}`, exp: e,
      texto: (nome, g) => ({
        titulo: `${nome} ${verbo(g, "embarca", "embarcam")} ${emDias(diasParaInicio)} com ${soma(g, (x) => x.prontidao_aptos)} de ${soma(g, (x) => x.prontidao_total)} passageiros aptos`,
        sub: g.length > 1 ? "Documentos e formulários pendentes nos grupos" : "Documentos e formulários pendentes",
      }) });
  }
  // 2. Preparação, aptos < 20% e faltando menos de 60 dias → Atenção
  if (fase === "preparacao" && diasParaInicio < R.preparacaoDias && fracAptos != null && fracAptos < R.preparacaoAptosMin) {
    out.push({ regra: "preparacao_aptos", severidade: "atencao", cta: "Ver pendências", aba: "passageiros", expedicaoId: e.id, data: dataRef,
      agrupar: `preparacao_aptos|${irmas}`, exp: e,
      texto: (nome, g) => ({
        titulo: `${nome} com ${soma(g, (x) => x.prontidao_aptos)} de ${soma(g, (x) => x.prontidao_total)} aptos a ${diasParaInicio} dias do embarque`,
        sub: `Menos de ${Math.round(R.preparacaoAptosMin * 100)}% prontos faltando menos de ${R.preparacaoDias} dias`,
      }) });
  }
  // 3 e 4. Ações do Roteiro do Líder (não agrupa: cada ação é de um dia)
  for (const a of e.acoes_roteiro ?? []) {
    if (!a.data || a.baixada === true) continue;
    const d = diasEntre(hoje, a.data);
    const qual = a.dia != null ? `Dia ${a.dia} (${ddmm(a.data)})` : ddmm(a.data);
    if (a.severidade === "critico" && d >= 0 && d <= R.acaoCriticaDias) {
      out.push({ regra: "acao_critica", severidade: "atencao", cta: "Abrir roteiro", aba: "roteiro-lider", expedicaoId: e.id, data: a.data,
        agrupar: null, exp: e,
        texto: (nome) => ({ titulo: `${nome} · ${a.titulo} no ${qual}`, sub: `Ação crítica do roteiro ${emDias(d)}` }) });
    } else if (d < 0 && a.baixada === false) {
      out.push({ regra: "acao_sem_baixa", severidade: "atencao", cta: "Abrir roteiro", aba: "roteiro-lider", expedicaoId: e.id, data: a.data,
        agrupar: null, exp: e,
        texto: (nome) => ({ titulo: `${nome} · ${a.titulo} no ${qual} sem baixa`, sub: "Dia já passou e a ação não foi marcada como resolvida" }) });
    }
  }
  const viajandoOuEmbarque = fase === "em_viagem" || fase === "embarque";
  // 5. Em viagem/embarque com passageiros sem valor → Atenção
  if (viajandoOuEmbarque && (e.pax_sem_valor ?? 0) > 0) {
    out.push({ regra: "sem_valor", severidade: "atencao", cta: "Ver financeiro", aba: "valores", expedicaoId: e.id, data: dataRef,
      agrupar: `sem_valor|${irmas}`, exp: e,
      texto: (nome, g) => ({
        titulo: `${nome} ${fase === "em_viagem" ? "em viagem" : "embarcando"} com ${plural(soma(g, (x) => x.pax_sem_valor ?? 0), "passageiro sem valor lançado", "passageiros sem valor lançado")}`,
        sub: "Lance o valor de cada passageiro na aba Valores",
      }) });
  }
  // 6. Em viagem/embarque com seguro sem apólice → Atenção
  if (viajandoOuEmbarque && (e.seguro_sem_apolice ?? 0) > 0) {
    out.push({ regra: "seguro_sem_apolice", severidade: "atencao", cta: "Ver passageiros", aba: "passageiros", expedicaoId: e.id, data: dataRef,
      agrupar: `seguro|${irmas}`, exp: e,
      texto: (nome, g) => ({
        titulo: `${nome} ${fase === "em_viagem" ? "em viagem" : "embarcando"} com ${plural(soma(g, (x) => x.seguro_sem_apolice ?? 0), "apólice de seguro não anexada", "apólices de seguro não anexadas")}`,
        sub: "Anexe a apólice no requisito Seguro de cada passageiro",
      }) });
  }
  // 7. Vendendo, ocupação < 30% e faltando menos de 365 dias → Info
  if (fase === "vendendo" && diasParaInicio < R.vendendoDias && e.pax_planejados > 0 && e.pax_confirmados / e.pax_planejados < R.vendendoOcupacaoMin) {
    out.push({ regra: "vendendo_ocupacao", severidade: "info", cta: "Ver expedição", aba: "", expedicaoId: e.id, data: dataRef,
      agrupar: `vendendo|${irmas}`, exp: e,
      texto: (nome, g) => ({
        titulo: `${nome} com ${soma(g, (x) => x.pax_confirmados)} de ${soma(g, (x) => x.pax_planejados)} vagas vendidas`,
        sub: `Faltam ${diasParaInicio} dias para o embarque`,
      }) });
  }
  return out;
}

/** Gera, agrupa as irmãs e ordena (severidade, depois data, depois título). */
export function alertasDasExpedicoes(exps: DadosAlertaExp[], hoje: string | Date): AlertaExp[] {
  const brutos = exps.flatMap((e) => regrasDe(e, hoje));
  const grupos = new Map<string, Bruto[]>();
  const soltos: Bruto[][] = [];
  for (const b of brutos) {
    if (!b.agrupar) { soltos.push([b]); continue; }
    const g = grupos.get(b.agrupar);
    if (g) g.push(b); else grupos.set(b.agrupar, [b]);
  }
  const out: AlertaExp[] = [...grupos.values(), ...soltos].map((g) => {
    const exps = [...g].sort((a, b) => (nomeDaExpedicao(a.exp).grupo ?? "").localeCompare(nomeDaExpedicao(b.exp).grupo ?? "", undefined, { numeric: true })).map((b) => b.exp);
    const primeiro = g[0];
    const base = nomeDaExpedicao(exps[0]).base;
    const nome = juntarGrupos(base, exps.map((x) => nomeDaExpedicao(x).grupo));
    const { titulo, sub } = primeiro.texto(nome, exps);
    return {
      chave: `${primeiro.regra}|${exps.map((x) => x.id).join(",")}|${primeiro.data}|${titulo}`,
      regra: primeiro.regra, severidade: primeiro.severidade, cta: primeiro.cta,
      expedicaoId: exps[0].id, aba: primeiro.aba, expedicaoIds: exps.map((x) => x.id),
      data: g.reduce((m, b) => (b.data < m ? b.data : m), primeiro.data),
      titulo, sub,
    };
  });
  return out.sort((a, b) => PESO[a.severidade] - PESO[b.severidade] || a.data.localeCompare(b.data) || a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/** Contagem do selo do card: só o que NÃO é informativo. */
export const contarAlertasAcionaveis = (alertas: AlertaExp[]) => alertas.filter((a) => a.severidade !== "info").length;

/** Alertas não informativos por expedição (coluna "Alertas" da Central). */
export function alertasPorExpedicao(alertas: AlertaExp[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of alertas) {
    if (a.severidade === "info") continue;
    for (const id of a.expedicaoIds) m.set(id, (m.get(id) ?? 0) + 1);
  }
  return m;
}
