/**
 * Avaliador de Prontidão para Embarque — a fonte de verdade do semáforo.
 *
 * Mesma lógica da view SQL `vw_prontidao_passageiro` (migration 0010), mas em TS
 * para rodar no modo mock e alimentar a UI. Dado um passageiro + a expedição + as
 * instâncias de requisito, devolve uma checagem por exigência e o status final
 * Apto / Atenção / Bloqueado.
 *
 * Fontes por exigência:
 *  - COLUNA  (Contrato, Dados Pessoais): derivada direto dos campos do passageiro.
 *  - INSTÂNCIA (Seguro, Visto, Vacina, RG, Aéreo…): lida de `passageiro_requisitos`,
 *    onde o time registra status, validade e evidência.
 *  - HÍBRIDA (Passaporte): validade vem das colunas (validade_passaporte) E o anexo
 *    foto/PDF vem da instância (arquivo_id) — só fica Apto com os dois ok.
 */
import { parseISO } from "date-fns";
import { MESES_VALIDADE_PASSAPORTE_PADRAO } from "@/expedicoes/lib/constants";
import { requisitosDoDestino } from "@/expedicoes/lib/prontidao/requisitos-destino";
import type {
  PassageiroRow,
  PassageiroRequisitoRow,
  TipoRequisito,
  Obrigatoriedade,
  Prontidao,
} from "@/expedicoes/lib/database";

/** Tipos cuja prontidão é derivada de colunas do passageiro (não viram instância). */
export const REQUISITOS_DE_COLUNA: ReadonlySet<TipoRequisito> = new Set([
  "Contrato",
  "Dados Pessoais",
]);

// "Passaporte" é HÍBRIDO: a validade vem das colunas (checarPassaporte) e o anexo
// (foto/PDF) vem da instância (arquivo_id). Só fica Apto com os DOIS ok. Por isso
// saiu de REQUISITOS_DE_COLUNA (precisa virar instância p/ guardar o arquivo) e é
// tratado num ramo próprio em avaliarProntidao.

/**
 * Requisitos que NÃO se aplicam a passageiros do tipo "Líder" (vai a trabalho,
 * não-pagante). Fica só o Contrato como "não necessário" (semáforo N/A); os demais
 * (Seguro, Aéreo, Vacina, etc.) valem igual aos outros passageiros.
 */
export const DISPENSAVEIS_LIDER: ReadonlySet<TipoRequisito> = new Set([
  "Contrato",
]);

/**
 * Requisitos que só são "ok" com o ARQUIVO de evidência anexado — não basta
 * mudar o status. Hoje: a foto do documento pessoal (RG/CNH/passaporte) e o
 * voucher/bilhete do aéreo internacional. A prontidão lê `arquivo_id` da
 * instância em passageiro_requisitos.
 */
export const REQUISITOS_COM_ANEXO_OBRIGATORIO: ReadonlySet<TipoRequisito> = new Set([
  // Passaporte e os Ingressos têm ramos PRÓPRIOS em avaliarProntidao (não caem no
  // caminho genérico abaixo). Ficam neste conjunto só para o drawer (ProntidaoPaxDrawer)
  // renderizar o anexador. OBS: os Ingressos são OPCIONAIS (não bloqueiam); o do
  // Passaporte é obrigatório (validade + anexo, agora 1 por pessoa via
  // passageiros.passaporte_arquivo_id).
  "Passaporte",
  "Ingresso Machu Picchu",
  "Ingresso Trem Machu Picchu",
  "Aéreo Internacional",
  "Aéreo Doméstico",
  "Voo Interno",
  "Seguro",
  "Vacina",
]);

/**
 * Requisitos de ANEXO OPCIONAL: não bloqueiam nem alarmam. Anexado/Dispensado = ok,
 * reprovado = atenção, sem anexo = neutro ("na"). Tratados num ramo próprio em
 * avaliarProntidao e sempre clicáveis no drawer (pra poder criar a instância e anexar).
 */
export const ANEXO_OPCIONAL: ReadonlySet<TipoRequisito> = new Set([
  "Ingresso Machu Picchu",
  "Ingresso Trem Machu Picchu",
]);

export type Semaforo = "ok" | "atencao" | "bloqueio" | "na";

/** Severidade relativa dos semáforos (pra combinar duas checagens no pior caso). */
const SEVERIDADE_SEMAFORO: Record<Semaforo, number> = { na: 0, ok: 1, atencao: 2, bloqueio: 3 };
function piorSemaforo(a: Semaforo, b: Semaforo): Semaforo {
  return SEVERIDADE_SEMAFORO[a] >= SEVERIDADE_SEMAFORO[b] ? a : b;
}

export type ChecagemProntidao = {
  tipo: TipoRequisito;
  descricao: string;
  obrigatoriedade: Obrigatoriedade;
  bloqueia_embarque: boolean;
  semaforo: Semaforo;
  detalhe: string;
  /** id da instância em passageiro_requisitos, quando a fonte é instância. */
  requisito_id: string | null;
};

export type ResultadoProntidao = {
  passageiro_id: string;
  prontidao: Prontidao;
  bloqueios: number;
  atencoes: number;
  checagens: ChecagemProntidao[];
};

type ExpedicaoLite = { data_embarque: string; data_retorno: string; status?: string };

function addMonths(iso: string, months: number): Date {
  const d = parseISO(iso);
  d.setMonth(d.getMonth() + months);
  return d;
}

/** Compara duas datas ISO; retorna a − b em ms (negativo = a antes de b). */
function antesDe(aIso: string, bIso: string): boolean {
  return parseISO(aIso).getTime() < parseISO(bIso).getTime();
}

/** Reduz uma lista de semáforos ao status final do passageiro. */
function consolidar(checagens: ChecagemProntidao[]): {
  prontidao: Prontidao;
  bloqueios: number;
  atencoes: number;
} {
  const bloqueios = checagens.filter((c) => c.semaforo === "bloqueio").length;
  const atencoes = checagens.filter((c) => c.semaforo === "atencao").length;
  const prontidao: Prontidao =
    bloqueios > 0 ? "Bloqueado" : atencoes > 0 ? "Atenção" : "Apto";
  return { prontidao, bloqueios, atencoes };
}

// --- Checagens derivadas de coluna --------------------------------------------

function checarPassaporte(
  p: PassageiroRow,
  exp: ExpedicaoLite,
  bloqueia: boolean,
): Semaforo {
  if (!p.passaporte || !p.validade_passaporte) return bloqueia ? "bloqueio" : "atencao";
  // Vence antes do retorno → bloqueio.
  if (antesDe(p.validade_passaporte, exp.data_retorno)) return "bloqueio";
  // Válido pro retorno, mas vence dentro da janela de 6 meses → atenção.
  const limite = addMonths(exp.data_retorno, MESES_VALIDADE_PASSAPORTE_PADRAO).toISOString();
  if (antesDe(p.validade_passaporte, limite)) return "atencao";
  return "ok";
}

function checarContrato(p: PassageiroRow): Semaforo {
  // Contrato NÃO é obrigatório p/ prontidão: assinado = ok; senão neutro ("na"),
  // sem gerar atenção/bloqueio. A aba serve só pra anexar o contrato.
  return p.contrato_assinado ? "ok" : "na";
}

function checarDadosPessoais(p: PassageiroRow, bloqueia: boolean): Semaforo {
  const completo = Boolean(p.cpf && p.data_nascimento && p.nome_completo);
  if (completo) return "ok";
  return bloqueia ? "bloqueio" : "atencao";
}

function detalheColuna(tipo: TipoRequisito, p: PassageiroRow, sem: Semaforo): string {
  switch (tipo) {
    case "Passaporte":
      if (!p.passaporte || !p.validade_passaporte) return "Sem passaporte cadastrado";
      return sem === "bloqueio"
        ? `Vence em ${p.validade_passaporte.slice(0, 10)} (antes do retorno)`
        : sem === "atencao"
          ? `Vence em ${p.validade_passaporte.slice(0, 10)} — dentro de 6 meses do retorno`
          : `Válido até ${p.validade_passaporte.slice(0, 10)}`;
    case "Contrato":
      return p.contrato_assinado ? "Assinado" : "Contrato não assinado";
    case "Dados Pessoais":
      return sem === "ok" ? "Cadastro completo" : "Faltam dados (CPF/nascimento)";
    default:
      return "";
  }
}

// --- Checagens de instância ---------------------------------------------------

function checarInstancia(
  r: PassageiroRequisitoRow,
  exp: ExpedicaoLite,
): Semaforo {
  const validadeOk = !r.validade || !antesDe(r.validade, exp.data_retorno);
  const resolvido = (r.status === "Aprovado" || r.status === "Dispensado") && validadeOk;
  if (resolvido) return "ok";
  if (r.status === "Vencido" || !validadeOk || r.status === "Reprovado") {
    return r.bloqueia_embarque ? "bloqueio" : "atencao";
  }
  // Pendente / Em análise / Enviado
  if (r.obrigatoriedade === "Recomendado") return "atencao";
  return r.bloqueia_embarque ? "bloqueio" : "atencao";
}

/**
 * Requisito que exige evidência anexada (ex.: foto do documento pessoal):
 * só fica "ok" quando há um arquivo vinculado. Dispensado segue valendo como ok;
 * Reprovado/Vencido derrubam.
 */
function checarDocumentoAnexo(r: PassageiroRequisitoRow): Semaforo {
  if (r.status === "Dispensado") return "ok";
  if (r.status === "Reprovado" || r.status === "Vencido") {
    return r.bloqueia_embarque ? "bloqueio" : "atencao";
  }
  if (r.arquivo_id) return "ok";
  return r.bloqueia_embarque ? "bloqueio" : "atencao";
}

function detalheAnexo(r: PassageiroRequisitoRow | undefined): string {
  if (!r) return "Falta anexar o documento";
  if (r.status === "Dispensado") return "Dispensado";
  if (r.status === "Reprovado") return "Documento reprovado — reenviar";
  if (r.arquivo_id) return "Documento anexado";
  return "Falta anexar o documento";
}

function detalheInstancia(r: PassageiroRequisitoRow | undefined, sem: Semaforo): string {
  if (!r) return "Ainda não iniciado";
  if (sem === "ok") return r.status + (r.validade ? ` (val. ${r.validade.slice(0, 10)})` : "");
  if (r.status === "Vencido") return `Vencido${r.validade ? ` em ${r.validade.slice(0, 10)}` : ""}`;
  return r.status;
}

/**
 * Avalia a prontidão de um passageiro. As colunas (checagens) seguem a ordem do
 * catálogo do destino, então a tabela do painel fica consistente entre pax.
 */
export function avaliarProntidao(params: {
  passageiro: PassageiroRow;
  expedicao: ExpedicaoLite;
  destino: string;
  requisitos: PassageiroRequisitoRow[];
}): ResultadoProntidao {
  const { passageiro, expedicao, destino, requisitos } = params;
  const porTipo = new Map(requisitos.map((r) => [r.tipo, r]));
  const templates = requisitosDoDestino(destino);

  // Expedição concluída: a viagem já aconteceu, então não faz sentido alarmar a
  // prontidão. Todos entram como "Apto" (cada exigência marcada como N/A).
  if (expedicao.status === "Concluída") {
    const checagens: ChecagemProntidao[] = templates.map((t) => ({
      tipo: t.tipo,
      descricao: t.descricao,
      obrigatoriedade: t.obrigatoriedade,
      bloqueia_embarque: t.bloqueia_embarque,
      semaforo: "na" as Semaforo,
      detalhe: "Expedição concluída",
      requisito_id: porTipo.get(t.tipo)?.id ?? null,
    }));
    return { passageiro_id: passageiro.id, prontidao: "Apto", bloqueios: 0, atencoes: 0, checagens };
  }

  const checagens: ChecagemProntidao[] = templates.map((t) => {
    // Líder não precisa de contrato, seguro, aéreo internacional nem vacina.
    if (passageiro.tipo === "Líder" && DISPENSAVEIS_LIDER.has(t.tipo)) {
      return {
        tipo: t.tipo,
        descricao: t.descricao,
        obrigatoriedade: t.obrigatoriedade,
        bloqueia_embarque: t.bloqueia_embarque,
        semaforo: "na" as Semaforo,
        detalhe: "Não necessário (líder)",
        requisito_id: porTipo.get(t.tipo)?.id ?? null,
      };
    }
    // Passaporte: HÍBRIDO — validade (colunas) + anexo (foto/PDF). O anexo é 1 por
    // PESSOA (passageiros.passaporte_arquivo_id, propaga entre as expedições dela).
    // Só fica Apto com passaporte válido E arquivo anexado. "Dispensado" libera ambos.
    if (t.tipo === "Passaporte") {
      const inst = porTipo.get("Passaporte");
      const bloqueia = t.bloqueia_embarque;
      if (inst?.status === "Dispensado") {
        return {
          tipo: t.tipo, descricao: t.descricao, obrigatoriedade: t.obrigatoriedade,
          bloqueia_embarque: bloqueia, semaforo: "ok", detalhe: "Dispensado",
          requisito_id: inst.id,
        };
      }
      const semValidade = checarPassaporte(passageiro, expedicao, bloqueia);
      const temArquivo = Boolean(passageiro.passaporte_arquivo_id);
      const semAnexo: Semaforo = temArquivo ? "ok" : bloqueia ? "bloqueio" : "atencao";
      const semaforo = piorSemaforo(semValidade, semAnexo);
      const msgValidade = detalheColuna("Passaporte", passageiro, semValidade);
      const msgAnexo = temArquivo ? "documento anexado" : "falta anexar o passaporte";
      return {
        tipo: t.tipo, descricao: t.descricao, obrigatoriedade: t.obrigatoriedade,
        bloqueia_embarque: bloqueia, semaforo,
        detalhe: `${msgValidade} · ${msgAnexo}`,
        requisito_id: inst?.id ?? null,
      };
    }
    // Anexo OPCIONAL (Ingressos Machu Picchu): não bloqueia nem alarma se faltar.
    // Anexado/Dispensado = ok; reprovado = atenção; sem anexo = neutro ("na").
    if (ANEXO_OPCIONAL.has(t.tipo)) {
      const inst = porTipo.get(t.tipo);
      let semaforo: Semaforo;
      if (!inst) semaforo = "na";
      else if (inst.status === "Dispensado") semaforo = "ok";
      else if (inst.status === "Reprovado") semaforo = "atencao";
      else semaforo = inst.arquivo_id ? "ok" : "na";
      return {
        tipo: t.tipo,
        descricao: inst?.descricao ?? t.descricao,
        obrigatoriedade: inst?.obrigatoriedade ?? t.obrigatoriedade,
        bloqueia_embarque: false,
        semaforo,
        detalhe:
          semaforo === "ok" ? "Anexado"
            : semaforo === "atencao" ? "Reprovado — reenviar"
              : "Anexo opcional",
        requisito_id: inst?.id ?? null,
      };
    }
    if (REQUISITOS_DE_COLUNA.has(t.tipo)) {
      let semaforo: Semaforo;
      switch (t.tipo) {
        case "Contrato":
          semaforo = checarContrato(passageiro);
          break;
        case "Dados Pessoais":
          semaforo = checarDadosPessoais(passageiro, t.bloqueia_embarque);
          break;
        default:
          semaforo = "na";
      }
      return {
        tipo: t.tipo,
        descricao: t.descricao,
        obrigatoriedade: t.obrigatoriedade,
        bloqueia_embarque: t.bloqueia_embarque,
        semaforo,
        detalhe: detalheColuna(t.tipo, passageiro, semaforo),
        requisito_id: null,
      };
    }
    const inst = porTipo.get(t.tipo);
    const exigeAnexo = REQUISITOS_COM_ANEXO_OBRIGATORIO.has(t.tipo);
    const semaforo: Semaforo = inst
      ? exigeAnexo
        ? checarDocumentoAnexo(inst)
        : checarInstancia(inst, expedicao)
      : t.bloqueia_embarque
        ? "bloqueio"
        : "atencao";
    return {
      tipo: t.tipo,
      descricao: inst?.descricao ?? t.descricao,
      obrigatoriedade: inst?.obrigatoriedade ?? t.obrigatoriedade,
      bloqueia_embarque: inst?.bloqueia_embarque ?? t.bloqueia_embarque,
      semaforo,
      detalhe: exigeAnexo ? detalheAnexo(inst) : detalheInstancia(inst, semaforo),
      requisito_id: inst?.id ?? null,
    };
  });

  return { passageiro_id: passageiro.id, ...consolidar(checagens), checagens };
}
