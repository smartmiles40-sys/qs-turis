// src/rel/kpis/KpisGoogle.tsx
// -----------------------------------------------------------------------------
// Nota e nº de avaliações no Google (Bruno, 13/10/2026). Vem da Places API
// quando há chave (GOOGLE_PLACES_API_KEY na Vercel) e Place ID (Configurações);
// senão o admin/gestor digita os números à mão — e a tela diz de onde veio.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth, setoresDe } from "@/contexts/QsAuthContext";
import { lerGoogle, salvarGoogleManual, type Google } from "../lib/kpis";
import { Aviso, Botao, Entrada } from "../ui";

function Estrelas({ nota }: { nota: number }) {
  return (
    <span className="inline-flex" aria-label={`${nota} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const cheio = Math.max(0, Math.min(1, nota - (i - 1)));
        return (
          <svg key={i} width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <defs><linearGradient id={`g${i}`}><stop offset={`${cheio * 100}%`} stopColor="#F5B400" /><stop offset={`${cheio * 100}%`} stopColor="var(--line)" /></linearGradient></defs>
            <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" fill={`url(#g${i})`} />
          </svg>
        );
      })}
    </span>
  );
}

export default function KpisGoogle() {
  const { currentUser } = useQsAuth();
  const pode = currentUser?.role === "admin" || (currentUser?.role === "gestor" && setoresDe(currentUser).includes("relacionamento"));
  const [g, setG] = useState<Google | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [nota, setNota] = useState("");
  const [total, setTotal] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = () => lerGoogle().then((x) => { setG(x); setErro(null); }).catch((e) => setErro(e instanceof Error ? e.message : "Falhou."));
  useEffect(() => { void carregar(); }, []);

  async function salvar() {
    setSalvando(true);
    try {
      await salvarGoogleManual(nota, Number(total));
      setEditando(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não salvou.");
    } finally {
      setSalvando(false);
    }
  }

  const quando = g?.em ? new Date(g.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <section className="rel-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Avaliações no Google</h2>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {g?.fonte === "google" ? `Lido do Google${g.nome ? ` (${g.nome})` : ""}${quando ? ` em ${quando}` : ""} — atualiza a cada 6 h.`
              : g?.fonte === "manual" ? `Digitado à mão${quando ? ` em ${quando}` : ""}${g.temChave ? "" : " — pra vir sozinho, falta a chave do Google na Vercel"}${g.place_id ? "" : " e o Place ID em Configurações"}.`
                : "Ainda sem dado: cole o Place ID em Configurações (com a chave do Google na Vercel) ou digite os números."}
          </p>
        </div>
        {pode && g?.fonte !== "google" && !editando && (
          <Botao onClick={() => { setNota(g?.nota != null ? String(g.nota).replace(".", ",") : ""); setTotal(g?.total != null ? String(g.total) : ""); setEditando(true); }}>
            {g?.fonte === "manual" ? "Atualizar números" : "Digitar números"}
          </Botao>
        )}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {g?.aviso && <Aviso>{g.aviso}</Aviso>}
      {g && g.nota != null && (
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <span className="block text-4xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>{String(g.nota).replace(".", ",")}</span>
            <Estrelas nota={g.nota} />
          </div>
          <div>
            <span className="block text-3xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>{(g.total ?? 0).toLocaleString("pt-BR")}</span>
            <span className="text-[12px]" style={{ color: "var(--ink3)" }}>avaliações</span>
          </div>
        </div>
      )}
      {editando && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px]" style={{ color: "var(--ink2)" }}>Nota (1 a 5)
            <Entrada value={nota} onChange={(e) => setNota(e.target.value)} inputMode="decimal" placeholder="4,9" style={{ width: 90 }} />
          </label>
          <label className="text-[12px]" style={{ color: "var(--ink2)" }}>Nº de avaliações
            <Entrada value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="312" style={{ width: 120 }} />
          </label>
          <Botao variante="primario" disabled={salvando || !nota || !total} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
          <Botao disabled={salvando} onClick={() => setEditando(false)}>Cancelar</Botao>
        </div>
      )}
    </section>
  );
}
