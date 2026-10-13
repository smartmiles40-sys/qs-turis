// src/rel/equipe/permissao.ts
// Quem configura o Relacionamento e cuida do time: admin, ou gestor(a) com o
// setor Relacionamento (mesma regra do banco: rel_pode_configurar, 0101).
import { setoresDe } from "@/contexts/QsAuthContext";
import type { SdrUser } from "@/components/sdr/types";

export function podeGerirRelacionamento(u: Pick<SdrUser, "role" | "setores" | "is_active"> | null | undefined): boolean {
  if (!u || u.is_active === false) return false;
  if (u.role === "admin") return true;
  return u.role === "gestor" && setoresDe(u).includes("relacionamento");
}
