// src/lib/qs/notify.ts
// -----------------------------------------------------------------------------
// Notificações globais de erro/sucesso (toasts) — SEM dependência de React.
// A camada de dados (queries.ts) e qualquer componente podem chamar
// notifyError()/notifySuccess(); o componente <GlobalToasts/> (montado uma vez
// no SdrLayout) escuta e desenha.
//
// Razão de existir: gravações que falham não podem mais morrer no console —
// o SDR precisa SABER que a nota/desfecho/reunião não foi salva (P0 da auditoria).
// -----------------------------------------------------------------------------

export interface AppToast {
  id: number;
  kind: "error" | "success";
  text: string;
}

type Listener = (toast: AppToast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

// Anti-spam: não repete o mesmo texto em janela curta (ex.: várias gravações
// falhando em lote por queda de rede viram UM aviso, não dez).
let lastText = "";
let lastAt = 0;

function emit(kind: AppToast["kind"], text: string) {
  const now = Date.now();
  if (text === lastText && now - lastAt < 4000) return;
  lastText = text;
  lastAt = now;
  const toast: AppToast = { id: nextId++, kind, text };
  listeners.forEach((l) => {
    try { l(toast); } catch { /* listener quebrado não derruba os demais */ }
  });
}

/** Erro visível ao usuário (usar em TODA gravação crítica que falhar). */
export function notifyError(text: string): void {
  emit("error", text);
}

/** Confirmação visível (usar com parcimônia — sucesso silencioso costuma bastar). */
export function notifySuccess(text: string): void {
  emit("success", text);
}

/** Assina o fluxo de toasts. Retorna o unsubscribe. */
export function subscribeToasts(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
