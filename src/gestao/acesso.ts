// src/gestao/acesso.ts
// -----------------------------------------------------------------------------
// Quem abre o PAINEL DE GESTÃO (Bruno, 27/10/2026) e o endereço dele.
// Fica separado do painel pra o App e a sidebar saberem disso sem baixar a tela.
// Mesmo esquema da Área do Closer: endereço próprio (#gestao), aberto pelo
// seletor de setor. O banco continua mandando no que cada um lê (RLS).
// -----------------------------------------------------------------------------
import type { SdrUser } from "@/components/sdr/types";

/** Admin e gestor (o qs_is_manager() do banco). */
export function podeAbrirGestao(u: Pick<SdrUser, "role"> | null | undefined): boolean {
  return u?.role === "admin" || u?.role === "gestor";
}
export const ehHashDaGestao = () => /^#\/?gestao(\/|$)/.test(window.location.hash);
export function abrirGestao() { window.location.hash = "#gestao"; }
/** Sai do #gestao e avisa o App (replaceState não dispara hashchange sozinho). */
export function sairDaGestao() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
