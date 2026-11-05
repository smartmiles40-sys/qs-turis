// src/expedicoes/contexto.tsx
// Contexto comum das telas de Expedições: quem pode editar (o banco decide de
// verdade via is_readonly(); aqui é só pra esconder botões), lista de usuários
// do sistema (responsáveis) e a navegação entre telas.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, listarUsuarios } from "./lib/banco";
import { esquecer } from "./lib/cache";
import type { UsuarioRow } from "./lib/database";

/** Telas das Expedições dentro da área (#ops/<tela>/<id>). */
export const TELAS_EXP = ["exp-inicio", "avisos", "expedicoes", "pacotes", "passageiros", "clientes", "inscricoes", "fornecedores", "acessos-amigo", "exp-config", "checklist-padrao", "receitas", "saude", "painel", "novas-vendas"] as const;
export type TelaExp = (typeof TELAS_EXP)[number];

export interface ExpCtx {
  somenteLeitura: boolean;
  /** Em validação (0317): o espelho do sistema antigo está ligado → tudo só leitura. */
  emValidacao: boolean;
  /** Relacionamento só vê, mas aprova/recusa inscrições (regra do app antigo). */
  podeDecidirInscricao: boolean;
  usuarios: UsuarioRow[];
  recarregarUsuarios: () => void;
  /** Navega: ir("expedicoes", "<id>/passageiros"). */
  ir: (tela: TelaExp, id?: string) => void;
  avisar: (texto: string, tom?: "ok" | "erro") => void;
}

const Ctx = createContext<ExpCtx | null>(null);

/** "atualizado há 3 min" a partir do horário da última sincronia do espelho. */
export function textoAtualizadoHa(iso: string | null | undefined, agora = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "aguardando a primeira sincronia";
  const min = Math.max(0, Math.floor((agora - t) / 60000));
  if (min < 1) return "atualizado há menos de 1 min";
  if (min < 60) return `atualizado há ${min} min`;
  const h = Math.floor(min / 60);
  return `atualizado há ${h} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

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
  // Modo validação (05/11, 0317): enquanto o espelho antigo → QS estiver ligado, nada se edita aqui.
  const [espelho, setEspelho] = useState<{ ligado: boolean; sincronizadoEm: string | null }>({ ligado: false, sincronizadoEm: null });
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    const ler = () => supabase.rpc("exp_espelho_status").then(({ data, error }) => {
      if (!vivo) return;
      // Sem a 0317 aplicada a RPC não existe: segue o modo normal.
      const d = (error ? null : data) as { ligado?: boolean; sincronizado_em?: string | null } | null;
      setEspelho({ ligado: d?.ligado === true, sincronizadoEm: d?.sincronizado_em ?? null });
    });
    ler();
    const a = setInterval(ler, 120_000);
    const b = setInterval(() => setAgora(Date.now()), 30_000);
    return () => { vivo = false; clearInterval(a); clearInterval(b); };
  }, []);
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

  const emValidacao = espelho.ligado;
  const valor: ExpCtx = {
    somenteLeitura: somenteLeitura || emValidacao,
    emValidacao,
    podeDecidirInscricao: !emValidacao && (!somenteLeitura || setorRelacionamento),
    usuarios,
    recarregarUsuarios: () => { esquecer("usuarios"); setSinal((n) => n + 1); },
    ir,
    avisar: (texto, tom = "ok") => setToast({ texto, tom }),
  };
  return (
    <Ctx.Provider value={valor}>
      {emValidacao && (
        <div role="status" className="mb-3 px-3 py-2 rounded-lg text-[12.5px] flex flex-wrap items-center gap-x-2 gap-y-0.5" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>
          <strong className="font-semibold">Em validação</strong>
          <span>— os dados vêm do sistema atual a cada 5 minutos. Edite no sistema atual.</span>
          <span className="opacity-75">· {textoAtualizadoHa(espelho.sincronizadoEm, agora)}</span>
        </div>
      )}
      {somenteLeitura && !emValidacao && (
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
