// src/rel/atendimento/GruposPage.tsx
// -----------------------------------------------------------------------------
// GRUPOS do WhatsApp do Relacionamento (0137, 15/10/2026).
//
// Os grupos do número do Relacionamento chegam por uma ligação SEPARADA
// (Evolution, QR) — a API oficial da Meta não entrega grupo. Essa ligação só
// trata grupo: conversa com pessoa nunca entra aqui, e o envio só sai pra grupo.
// Mesmo visual do Atendimento (WA_CSS), sem SLA nem etiquetas.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConversaGrupo from "./ConversaGrupo";
import { AvatarWa, WA_CSS, horaDaLista } from "./waUi";
import { estadoDosGrupos, listarGrupos, marcarGrupoLido, sincronizarGrupos, type Grupo } from "../lib/grupos";

/** Enquanto a aba está visível, roda `fn` a cada `ms`. */
function useRepetir(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    const volta = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", volta);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", volta); };
  }, [ms]);
}

const nomeDoGrupo = (g: Grupo) => g.nome?.trim() || "Grupo sem nome";

export default function GruposPage({ grupoJid, abrir }: { grupoJid: string | null; abrir: (jid: string | null) => void }) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [estado, setEstado] = useState<{ conectado: boolean; estado: string } | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try { setGrupos(await listarGrupos()); } catch { /* mantém a lista */ }
    setCarregando(false);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useRepetir(carregar, 10000);

  const conferirEstado = useCallback(async () => {
    try { setEstado(await estadoDosGrupos()); } catch { setEstado({ conectado: false, estado: "erro" }); }
  }, []);
  useEffect(() => { void conferirEstado(); }, [conferirEstado]);
  useRepetir(conferirEstado, 60000);

  const sincronizar = async () => {
    setSincronizando(true); setAviso(null);
    try {
      const r = await sincronizarGrupos();
      setAviso(`${r.grupos} grupo${r.grupos === 1 ? "" : "s"} encontrado${r.grupos === 1 ? "" : "s"}.`);
      await carregar();
    } catch (e) { setAviso((e as Error).message); }
    setSincronizando(false);
  };

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? grupos.filter((g) => nomeDoGrupo(g).toLowerCase().includes(q)) : grupos;
  }, [grupos, busca]);
  const aberto = grupos.find((g) => g.jid === grupoJid) || null;
  // abriu o grupo = leu (zera a bolinha e o @)
  useEffect(() => {
    if (!aberto || (!(aberto.nao_lidas ?? 0) && !aberto.mencionado_em)) return;
    void marcarGrupoLido(aberto.jid).then(() => setGrupos((l) => l.map((g) => (g.jid === aberto.jid ? { ...g, nao_lidas: 0, mencionado_em: null } : g))));
  }, [aberto]);

  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-6 lg:-my-8 wa">
      <style>{WA_CSS}</style>
      {estado && !estado.conectado && (
        <div className="px-4 py-2 text-[13px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          A ligação dos grupos está fora do ar ({estado.estado}) — mensagens novas dos grupos não estão chegando.
        </div>
      )}
      <div className="flex relative h-[calc(100dvh-56px)] lg:h-[100dvh]">
        <aside className={`${grupoJid ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[380px] xl:w-[420px] lg:flex-shrink-0 border-r min-h-0 wa-lista`}
          style={{ borderColor: "var(--wa-line)" }}>
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <h1 className="text-[20px] font-bold flex-1" style={{ color: "var(--wa-txt)" }}>Grupos</h1>
            <button type="button" className="wa-icone px-3 py-1.5 text-[13px] font-medium" onClick={sincronizar} disabled={sincronizando}
              title="Buscar os grupos do número no WhatsApp">
              {sincronizando ? "Buscando…" : "Atualizar lista"}
            </button>
          </div>
          <div className="px-3 pb-2">
            <input className="wa-campo w-full px-3 py-2 text-[14px]" style={{ background: "var(--wa-head)" }} placeholder="Pesquisar grupo"
              value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar grupo" />
          </div>
          {aviso && <p className="px-4 pb-2 text-[12.5px]" style={{ color: "var(--wa-meta)" }}>{aviso}</p>}
          <div className="flex-1 overflow-y-auto min-h-0">
            {carregando && <p className="px-4 py-6 text-[13px]" style={{ color: "var(--wa-meta)" }}>Carregando…</p>}
            {!carregando && visiveis.length === 0 && (
              <div className="px-6 py-10 text-center text-[13.5px]" style={{ color: "var(--wa-meta)" }}>
                {busca ? "Nenhum grupo com esse nome." : <>Nenhum grupo ainda. Clique em <strong>Atualizar lista</strong> para buscar os grupos do número.</>}
              </div>
            )}
            {visiveis.map((g) => (
              <button key={g.jid} type="button" onClick={() => abrir(g.jid)} aria-current={g.jid === grupoJid}
                className="wa-item w-full text-left flex items-center gap-3 px-3 py-2.5">
                <AvatarWa nome={nomeDoGrupo(g)} />
                <span className="flex-1 min-w-0 border-b pb-2.5 -mb-2.5" style={{ borderColor: "var(--wa-line)" }}>
                  <span className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[16px]" style={{ color: "var(--wa-txt)" }}>{nomeDoGrupo(g)}</span>
                    <span className="text-[12px] flex-shrink-0" style={{ color: (g.nao_lidas ?? 0) > 0 ? "var(--wa-green)" : "var(--wa-meta)", fontWeight: (g.nao_lidas ?? 0) > 0 ? 600 : 400 }}>{horaDaLista(g.ultima_msg_em)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: (g.nao_lidas ?? 0) > 0 ? "var(--wa-txt)" : "var(--wa-meta)" }}>{g.ultima_msg || (g.participantes ? `${g.participantes} participantes` : "")}</span>
                    {/* igual ao WhatsApp: @ quando marcaram o número, bolinha verde com as não lidas */}
                    {g.mencionado_em && <span className="w-5 h-5 rounded-full flex-shrink-0 inline-flex items-center justify-center text-[12px] font-bold" style={{ background: "var(--wa-green)", color: "#fff" }} title="Marcaram o número neste grupo" aria-label="Marcaram o número neste grupo">@</span>}
                    {(g.nao_lidas ?? 0) > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full flex-shrink-0 inline-flex items-center justify-center text-[11.5px] font-bold tabular-nums" style={{ background: "var(--wa-green)", color: "#fff" }} aria-label={`${g.nao_lidas} não lidas`}>{g.nao_lidas! > 99 ? "99+" : g.nao_lidas}</span>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className={`${grupoJid ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 min-h-0`}>
          {aberto ? <ConversaGrupo key={aberto.jid} grupo={aberto} onVoltar={() => abrir(null)} onMudou={carregar} />
            : (
              <div className="flex-1 flex items-center justify-center px-8 text-center wa-cab">
                <p className="text-[14px] max-w-sm" style={{ color: "var(--wa-meta)" }}>
                  Escolha um grupo à esquerda. Por aqui só passam <strong>grupos</strong> — conversas com pessoas continuam em Conversas.
                </p>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
