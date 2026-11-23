// api/_coordena.js
// -----------------------------------------------------------------------------
// 0413 (23/11/2026) — CO-COORDENADORES. A regra única do servidor, espelho de
// qs_coordena() no banco e de coordena() em src/contexts/QsAuthContext.tsx:
// coordena o setor = admin, OU gestor com o setor, OU co-coordenador dele
// (qs_users.coordena). O `u` precisa ter vindo com role, setores e coordena.
// -----------------------------------------------------------------------------

const lista = (v) => (Array.isArray(v) ? v : []);

/** Setores de um gestor (sem nenhum = Comercial, igual ao gatilho do banco). */
const setoresDoGestor = (u) => (lista(u.setores).length ? lista(u.setores) : ['comercial']);

export function coordenaSetor(u, setor) {
  if (!u || u.is_active === false) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'gestor') return setoresDoGestor(u).includes(setor);
  return lista(u.coordena).includes(setor);
}

/** Coordena (ou co-coordena) algum setor. */
export function coordenaAlgum(u) {
  if (!u || u.is_active === false) return false;
  return u.role === 'admin' || u.role === 'gestor' || lista(u.coordena).length > 0;
}
