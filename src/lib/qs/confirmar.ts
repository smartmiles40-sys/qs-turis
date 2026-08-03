// src/lib/qs/confirmar.ts
// -----------------------------------------------------------------------------
// Confirmação global — SEM dependência de React, igual ao notify.ts.
//
// Existe porque `window.confirm` trava a aba inteira, não dá pra estilizar e, no
// celular, aparece como um alerta do NAVEGADOR (o SDR não reconhece como sendo
// do QS). Além disso, ação que dispara efeito no mundo real — uma ligação toca
// no telefone do cliente — não pode sair de um clique acidental na fila.
//
// Uso:
//   if (!(await confirmar({ titulo: "…", mensagem: "…" }))) return;
//
// Quem desenha é o <ConfirmDialog/>, montado uma vez no SdrLayout.
// -----------------------------------------------------------------------------

export interface PedidoDeConfirmacao {
  titulo: string;
  mensagem?: string;
  /** Texto do botão que confirma. Padrão: "Confirmar". */
  confirmarLabel?: string;
  /** Texto do botão que recusa. Padrão: "Recusar". */
  recusarLabel?: string;
  /** Ação destrutiva pinta o botão de vermelho (excluir, encerrar). */
  perigo?: boolean;
}

export interface ConfirmacaoAberta extends PedidoDeConfirmacao {
  id: number;
  resolver: (ok: boolean) => void;
}

type Listener = (pedido: ConfirmacaoAberta) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/**
 * Pergunta e devolve true/false. Se ninguém estiver ouvindo (host não montado —
 * páginas de preview, testes), devolve `true`: a confirmação é uma trava de
 * segurança da INTERFACE, não pode virar um bloqueio que impede a ação.
 */
export function confirmar(pedido: PedidoDeConfirmacao): Promise<boolean> {
  if (listeners.size === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let respondido = false;
    const umaVezSo = (ok: boolean) => {
      // Duplo clique no botão / Esc junto com clique não podem resolver duas vezes.
      if (respondido) return;
      respondido = true;
      resolve(ok);
    };
    const aberto: ConfirmacaoAberta = { ...pedido, id: nextId++, resolver: umaVezSo };
    listeners.forEach((l) => {
      try { l(aberto); } catch { /* listener quebrado não derruba os demais */ }
    });
  });
}

/** Assina os pedidos de confirmação. Retorna o unsubscribe. */
export function subscribeConfirmacoes(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
