// src/expedicoes/lib/inscricaoPax.ts
// -----------------------------------------------------------------------------
// ESTADO DA INSCRIÇÃO DE CADA PASSAGEIRO (Bruno, 03/11: "Inscrições achei muito
// vago; isso pode ficar dentro das expedições, atrelado ao nome da pessoa, assim
// fica mais visual"). A aba Passageiros do cockpit põe um selo junto do nome:
//
//   Aguardando aprovação → tem inscrição do formulário público com status
//                          'pendente' nesta expedição, com o mesmo CPF;
//   Inscrição recusada   → só tem inscrição 'recusada' (fica à parte, dá pra restaurar);
//   Inscrição aprovada   → o passageiro veio do formulário (inscricao_origem);
//   Ficha respondida     → preencheu o perfil por outro caminho (regra do app antigo);
//   Falta responder      → nenhuma das anteriores.
//
// Inscrição sem passageiro com o mesmo CPF na lista (comprou por fora do Bitrix,
// CPF digitado diferente) vai pra `semPassageiro` — aparece à parte, pra decidir.
// Lógica PURA (sem alias "@/") pra rodar no node:test.
// -----------------------------------------------------------------------------
import type { InscricaoPendenteRow, PassageiroRow } from "./database";

/** Preencheu o formulário? (perfil do viajante ou veio do formulário público — regra do app antigo). */
export function preencheuFormulario(p: Pick<PassageiroRow, "perfil_viajante" | "inscricao_origem">): boolean {
  const pv = p.perfil_viajante;
  const temPerfil = !!pv && typeof pv === "object" && (
    pv.confirmou_veracidade === true ||
    [pv.profissao, pv.descricao_grupo, pv.anima_expedicao, pv.significado, pv.instagram, pv.camiseta, pv.musica]
      .some((v) => v && String(v).trim() !== "")
  );
  return temPerfil || p.inscricao_origem === "Formulário público";
}

export type EstadoInscricao = "aguardando" | "recusada" | "aprovada" | "respondida" | "falta";

export const ROTULO_INSCRICAO: Record<EstadoInscricao, string> = {
  aguardando: "Aguardando aprovação",
  recusada: "Inscrição recusada",
  aprovada: "Inscrição aprovada",
  respondida: "Ficha respondida",
  falta: "Falta responder a ficha",
};
export const TOM_INSCRICAO: Record<EstadoInscricao, "aviso" | "erro" | "ok" | "neutro"> = {
  aguardando: "aviso", recusada: "erro", aprovada: "ok", respondida: "ok", falta: "neutro",
};

export type PaxInscricao = Pick<PassageiroRow, "id" | "cpf" | "status_reserva" | "perfil_viajante" | "inscricao_origem"> & { saude?: unknown };
export type InscricaoMin = Pick<InscricaoPendenteRow, "id" | "cpf" | "status" | "expedicao_id">;

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

function respondeu(p: PaxInscricao): boolean {
  const s = p.saude;
  return preencheuFormulario(p) || (!!s && typeof s === "object" && Object.keys(s as object).length > 0);
}

export interface EstadosInscricao {
  porPax: Map<string, { estado: EstadoInscricao; inscricaoId: string | null }>;
  /** inscrições pendentes desta expedição sem passageiro com o mesmo CPF */
  semPassageiro: InscricaoMin[];
  resumo: Record<EstadoInscricao, number> & { semPassageiro: number };
}

/** Estado da inscrição de cada passageiro (cancelados ficam de fora). `inscricoes` = só desta expedição. */
export function estadosDeInscricao(pax: readonly PaxInscricao[], inscricoes: readonly InscricaoMin[]): EstadosInscricao {
  const pendPorCpf = new Map<string, InscricaoMin>();
  const recPorCpf = new Map<string, InscricaoMin>();
  for (const i of inscricoes) {
    const c = soDigitos(i.cpf);
    if (!c) continue;
    if (i.status === "pendente") { if (!pendPorCpf.has(c)) pendPorCpf.set(c, i); }
    else if (i.status === "recusada") { if (!recPorCpf.has(c)) recPorCpf.set(c, i); }
  }
  const porPax: EstadosInscricao["porPax"] = new Map();
  const resumo = { aguardando: 0, recusada: 0, aprovada: 0, respondida: 0, falta: 0, semPassageiro: 0 };
  const cpfsComPax = new Set<string>();
  for (const p of pax) {
    if (p.status_reserva === "Cancelado") continue;
    const c = soDigitos(p.cpf);
    if (c) cpfsComPax.add(c);
    const pend = c ? pendPorCpf.get(c) : undefined;
    const rec = c ? recPorCpf.get(c) : undefined;
    let estado: EstadoInscricao;
    let inscricaoId: string | null = null;
    if (pend) { estado = "aguardando"; inscricaoId = pend.id; }
    else if (p.inscricao_origem === "Formulário público") estado = "aprovada";
    else if (respondeu(p)) estado = "respondida";
    else if (rec) { estado = "recusada"; inscricaoId = rec.id; }
    else estado = "falta";
    porPax.set(p.id, { estado, inscricaoId });
    resumo[estado]++;
  }
  const semPassageiro = inscricoes.filter((i) => i.status === "pendente" && !cpfsComPax.has(soDigitos(i.cpf)));
  resumo.semPassageiro = semPassageiro.length;
  return { porPax, semPassageiro, resumo };
}

/** "3 aguardando aprovação · 5 falta responder · 12 aprovadas" (só o que tem). */
export function textoResumoInscricoes(r: EstadosInscricao["resumo"]): string {
  const ok = r.aprovada + r.respondida;
  const partes = [
    r.aguardando ? `${r.aguardando} aguardando aprovação` : "",
    r.semPassageiro ? `${r.semPassageiro} inscriç${r.semPassageiro === 1 ? "ão" : "ões"} sem passageiro na lista` : "",
    r.falta ? `${r.falta} falta${r.falta === 1 ? "" : "m"} responder` : "",
    r.recusada ? `${r.recusada} recusada${r.recusada === 1 ? "" : "s"}` : "",
    ok ? `${ok} com ficha ok` : "",
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Ninguém na lista ainda";
}
