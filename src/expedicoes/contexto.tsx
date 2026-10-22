// src/expedicoes/contexto.tsx
// Contexto comum das telas de Expedições: quem pode editar (o banco decide de
// verdade via is_readonly(); aqui é só pra esconder botões), lista de usuários
// do sistema (responsáveis) e a navegação entre telas.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, listarUsuarios } from "./lib/banco";
import { esquecer } from "./lib/cache";
import type { UsuarioRow } from "./lib/database";

/** Telas das Expedições dentro da área (#ops/<tela>/<id>). */
export const TELAS_EXP = ["exp-inicio", "avisos", "expedicoes", "pacotes", "passageiros", "clientes", "inscricoes", "fornecedores", "acessos-amigo", "exp-config"] as const;
export type TelaExp = (typeof TELAS_EXP)[number];

export interface ExpCtx {
  somenteLeitura: boolean;
  /** Relacionamento só vê, mas aprova/recusa inscrições (regra do app antigo). */
  podeDecidirInscricao: boolean;
  usuarios: UsuarioRow[];
  recarregarUsuarios: () => void;
  /** Navega: ir("expedicoes", "<id>/passageiros"). */
  ir: (tela: TelaExp, id?: string) => void;
  avisar: (texto: string, tom?: "ok" | "erro") => void;
}

const Ctx = createContext<ExpCtx | null>(null);

export function useExp(): ExpCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useExp fora do ExpProvider");
  return c;
}

export function ExpProvider({ ir, setorRelacionamento, children }: {
  ir: ExpCtx["ir"];
  /** true quando quem abriu é do Relacionamento (pode decidir inscrições mesmo só lendo). */
  setorRelacionamento: boolean;
  children: ReactNode;
}) {
  const [somenteLeitura, setSomenteLeitura] = useState(true);
  const [usuarios, setUsuarios] = useState<UsuarioRow[]>([]);
  const [sinal, setSinal] = useState(0);
  const [toast, setToast] = useState<{ texto: string; tom: "ok" | "erro" } | null>(null);

  useEffect(() => {
    supabase.rpc("is_readonly").then(({ data, error }) => setSomenteLeitura(error ? true : Boolean(data)));
  }, []);
  // Mesma leitura guardada que os agregados usam (lib/cache.ts) — uma ida só ao banco.
  useEffect(() => { listarUsuarios().then(setUsuarios).catch(() => setUsuarios([])); }, [sinal]);
  // Vigia da memória curta (22/10): enquanto alguém está nas Expedições, mudança
  // nestas tabelas (de qualquer pessoa, inclusive a própria) só DERRUBA o que está
  // guardado — não recarrega nada. Assim a próxima tela aberta já lê fresco mesmo
  // que a tela atual não assine aquela tabela.
  useEffect(() => {
    const canal = supabase.channel(`exp:cache:${Math.random().toString(36).slice(2, 8)}`);
    for (const tabela of ["expedicoes", "passageiros", "passageiro_requisitos", "usuarios"]) {
      canal.on("postgres_changes" as never, { event: "*", schema: "public", table: tabela } as never, () => esquecer(tabela));
    }
    canal.subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tom === "erro" ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const valor: ExpCtx = {
    somenteLeitura,
    podeDecidirInscricao: !somenteLeitura || setorRelacionamento,
    usuarios,
    recarregarUsuarios: () => { esquecer("usuarios"); setSinal((n) => n + 1); },
    ir,
    avisar: (texto, tom = "ok") => setToast({ texto, tom }),
  };
  return (
    <Ctx.Provider value={valor}>
      {somenteLeitura && (
        <div className="mb-3 px-3 py-2 rounded-lg text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>
          Modo leitura — você vê tudo das Expedições.{setorRelacionamento ? " Pode aprovar e recusar inscrições, mas não editar o resto." : " Edições ficam desativadas."}
        </div>
      )}
      {children}
      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-[13px] font-semibold shadow-lg max-w-[90vw]"
          style={toast.tom === "erro" ? { background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" } : { background: "var(--ink)", color: "var(--bg)" }}>
          {toast.texto}
        </div>
      )}
    </Ctx.Provider>
  );
}
