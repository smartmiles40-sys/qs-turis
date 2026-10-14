// src/rel/equipe/permissao.ts
// Quem configura uma área e cuida do time dela: admin, ou gestor(a) com o setor
// da área (mesma regra do banco: rel_pode_configurar 0101; fin_/ops_pode_configurar
// 0126).
import { setoresDe } from "@/contexts/QsAuthContext";
import type { SdrUser } from "@/components/sdr/types";
import type { AreaComTime } from "@/lib/adminUsers";

type Quem = Pick<SdrUser, "role" | "setores" | "is_active"> | null | undefined;

export function podeGerirArea(u: Quem, area: AreaComTime): boolean {
  if (!u || u.is_active === false) return false;
  if (u.role === "admin") return true;
  return u.role === "gestor" && setoresDe(u).includes(area);
}

/**
 * Cuida do TIME da área (tela Funcionários): admin, ou gestor só da área — sem
 * o Comercial. Mesma regra do servidor (api/admin-user.js: gestor que também é
 * do Comercial é gestor do Comercial e não cadastra pela tela da área).
 */
export function podeGerirTime(u: Quem, area: AreaComTime): boolean {
  if (!podeGerirArea(u, area)) return false;
  return u!.role === "admin" || !setoresDe(u).includes("comercial");
}

export function podeGerirRelacionamento(u: Quem): boolean {
  return podeGerirArea(u, "relacionamento");
}
