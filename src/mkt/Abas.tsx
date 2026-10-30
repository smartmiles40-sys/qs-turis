// src/mkt/Abas.tsx
// -----------------------------------------------------------------------------
// Uma entrada no menu = UMA página com abas (pedido do Bruno, 30/10/2026: "não
// precisa ter tanta coisa no menu esquerdo, pode ser um campo dentro da página").
// A aba aberta vai no endereço (#mkt/<tela>?aba=<id>) pra dar pra mandar o link;
// trocar de aba não remonta a página nem enche o "voltar" do navegador.
//
//   <PaginaComAbas titulo="Grupos" abas={[{ id: "campanhas", rotulo: "Campanhas", componente: Campanhas }]} />
//
// `acoes` fica à direita do título (ex.: o selo "Chip conectado" com engrenagem).
// -----------------------------------------------------------------------------
import { Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";

export interface AbaMkt {
  id: string;
  rotulo: string;
  /** Ícone opcional (ReactNode, ex.: ICONES_MKT.grupo). */
  icone?: ReactNode;
  /** Número na bolinha da aba (ex.: conversas não lidas). */
  badge?: number;
  componente: ComponentType;
}

export function useAbaMkt(ids: string[], padrao = ids[0]): [string, (id: string) => void] {
  const ler = () => {
    const a = lerParamDoHash("aba");
    return a && ids.includes(a) ? a : padrao;
  };
  const [aba, setAba] = useState(ler);
  useEffect(() => {
    const voltar = () => setAba(ler());
    window.addEventListener("hashchange", voltar);
    return () => window.removeEventListener("hashchange", voltar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  // Trocar de aba limpa o resto do estado do endereço (item aberto, filtro…):
  // senão o item da aba anterior reabre quando a pessoa volta pra ela.
  const ir = (id: string) => {
    setAba(id);
    const base = window.location.hash.split("?")[0] || "#";
    history.replaceState(history.state, "", window.location.pathname + window.location.search + base);
    gravarParamNoHash("aba", id === padrao ? null : id);
  };
  return [aba, ir];
}

export function PaginaComAbas({ titulo, subtitulo, abas, acoes }: {
  titulo: string;
  subtitulo?: ReactNode;
  abas: AbaMkt[];
  acoes?: ReactNode;
}) {
  const [aba, ir] = useAbaMkt(abas.map((a) => a.id));
  const atual = abas.find((a) => a.id === aba) ?? abas[0];
  const Tela = atual?.componente;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight" style={{ color: "var(--ink)" }}>{titulo}</h1>
          {subtitulo && <p className="mt-1 text-[13px]" style={{ color: "var(--ink3)" }}>{subtitulo}</p>}
        </div>
        {acoes && <div className="flex items-center gap-2">{acoes}</div>}
      </header>
      {abas.length > 1 && (
        <nav role="tablist" aria-label={titulo} className="-mx-1 flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--line)" }}>
          {abas.map((a) => {
            const ativa = a.id === atual?.id;
            return (
              <button key={a.id} type="button" role="tab" aria-selected={ativa} onClick={() => ir(a.id)}
                className="relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-[14px] font-medium transition-colors"
                style={{ color: ativa ? "var(--rel-ink)" : "var(--ink3)" }}>
                {a.icone && <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center">{a.icone}</span>}
                {a.rotulo}
                {a.badge ? (
                  <span className="rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: "var(--rel)" }}>{a.badge}</span>
                ) : null}
                {ativa && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full" style={{ background: "var(--rel)" }} />}
              </button>
            );
          })}
        </nav>
      )}
      <Suspense fallback={<p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
        {Tela ? <Tela key={atual?.id} /> : null}
      </Suspense>
    </div>
  );
}
