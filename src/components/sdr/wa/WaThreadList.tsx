// src/components/sdr/wa/WaThreadList.tsx
// -----------------------------------------------------------------------------
// "Minhas conversas": a lista de WhatsApp do usuário logado.
//
// O recorte de QUEM aparece vem da RLS (migrations 0024/0025) — o Supabase só
// devolve as conversas dos leads dele (mais as que ele passou pro closer, pra
// poder acompanhar). As abas e filtros daqui são organização em cima disso, não
// segurança: mesmo que alguém refaça a query no DevTools, continua vendo só o seu.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listMyThreads, listPinnedLeadIds, listUsersLite, togglePin, getInboxLabels,
  shortWhen, subscribeToThreads, threadTitle, isCloser, userName,
  esperandoDesde, humanizarEspera, inboxTag,
  type WaThread, type UserLite, type InboxLabels,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { useQsAuth } from "@/contexts/QsAuthContext";

type Aba = "meus" | "closers" | "todos";

interface Props {
  selectedLeadId?: string | null;
  onPick: (t: WaThread) => void;
}

function IconPin({ size = 13, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
    </svg>
  );
}

export default function WaThreadList({ selectedLeadId, onPick }: Props) {
  const { currentUser } = useQsAuth();
  const ehGestor = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [threads, setThreads] = useState<WaThread[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [fixadas, setFixadas] = useState<Set<string>>(new Set());
  const [rotulos, setRotulos] = useState<InboxLabels>({});
  const [loading, setLoading] = useState(true);

  const [aba, setAba] = useState<Aba>("meus");
  const [busca, setBusca] = useState("");
  const [soNaoRespondidas, setSoNaoRespondidas] = useState(false);
  const [donoFiltro, setDonoFiltro] = useState<string>("todos");   // só gestor

  const carregar = useCallback(async () => {
    const [ts, ps] = await Promise.all([listMyThreads(), listPinnedLeadIds()]);
    setThreads(ts);
    setFixadas(ps);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => subscribeToThreads(carregar), [carregar]);
  useEffect(() => {
    listUsersLite().then(setUsers);
    getInboxLabels().then(setRotulos);
  }, []);

  const alternarFixar = useCallback(async (e: React.MouseEvent, leadId: string) => {
    e.stopPropagation();   // não abre a conversa ao clicar no alfinete
    const novo = await togglePin(leadId);
    if (novo == null) return;
    setFixadas((prev) => {
      const s = new Set(prev);
      if (novo) s.add(leadId); else s.delete(leadId);
      return s;
    });
  }, []);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const soDigitos = q.replace(/\D/g, "");

    let out = threads.filter((t) => {
      const dono = t.lead?.owner_id ?? null;

      // Abas
      if (aba === "meus") {
        // Gestor não tem carteira própria: pra ele a primeira aba é "a equipe",
        // ou seja, tudo que NÃO está com um closer.
        if (ehGestor ? isCloser(users, dono) : dono !== currentUser?.id) return false;
      } else if (aba === "closers") {
        if (!isCloser(users, dono)) return false;
      }

      if (ehGestor && donoFiltro !== "todos" && dono !== donoFiltro) return false;
      if (soNaoRespondidas && !esperandoDesde(t)) return false;

      if (q) {
        const nome = threadTitle(t).toLowerCase();
        const fone = (t.lead?.phone || "").replace(/\D/g, "");
        if (!nome.includes(q) && !(soDigitos.length >= 3 && fone.includes(soDigitos))) return false;
      }
      return true;
    });

    // Fixadas sempre no topo; dentro de cada grupo, a mais recente primeiro.
    out = [...out].sort((a, b) => {
      const fa = fixadas.has(a.lead_id) ? 1 : 0;
      const fb = fixadas.has(b.lead_id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.last_at || 0).getTime() - new Date(a.last_at || 0).getTime();
    });
    return out;
  }, [threads, aba, busca, soNaoRespondidas, donoFiltro, fixadas, users, ehGestor, currentUser?.id]);

  const contarAba = useCallback((a: Aba) => {
    return threads.filter((t) => {
      const dono = t.lead?.owner_id ?? null;
      if (a === "meus") return ehGestor ? !isCloser(users, dono) : dono === currentUser?.id;
      if (a === "closers") return isCloser(users, dono);
      return true;
    }).length;
  }, [threads, users, ehGestor, currentUser?.id]);

  const naoRespondidas = useMemo(
    () => threads.filter((t) => esperandoDesde(t)).length,
    [threads]
  );

  const ABAS: { key: Aba; label: string }[] = [
    { key: "meus", label: ehGestor ? "Da equipe" : "Meus Leads" },
    { key: "closers", label: "Com Closers" },
    { key: "todos", label: "Todos os contatos" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Abas */}
      <div className="shrink-0 flex border-b" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        {ABAS.map((a) => {
          const ativa = aba === a.key;
          return (
            <button
              key={a.key}
              onClick={() => setAba(a.key)}
              className="flex-1 px-2 py-2 text-[11.5px] font-bold transition-colors"
              style={{
                color: ativa ? "var(--wa)" : "var(--ink3)",
                borderBottom: ativa ? "2px solid var(--wa-bright)" : "2px solid transparent",
              }}
            >
              {a.label}
              <span className="ml-1 font-normal opacity-70">{contarAba(a.key)}</span>
            </button>
          );
        })}
      </div>

      {/* Busca e filtros */}
      <div className="shrink-0 p-2 border-b space-y-1.5" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          className="w-full rounded-full px-3 py-1.5 text-[12.5px] outline-none"
          style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoNaoRespondidas((v) => !v)}
            className="px-2 py-1 rounded-full text-[10.5px] font-bold transition-colors"
            style={soNaoRespondidas
              ? { background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }
              : { background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}
            title="Só conversas em que o cliente falou por último"
          >
            Esperando resposta {naoRespondidas > 0 && `(${naoRespondidas})`}
          </button>

          {ehGestor && (
            <select
              value={donoFiltro}
              onChange={(e) => setDonoFiltro(e.target.value)}
              className="ml-auto rounded-full px-2 py-1 text-[10.5px] outline-none"
              style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
              title="Ver as conversas de um atendente específico"
            >
              <option value="todos">Todos os atendentes</option>
              {users.filter((u) => u.is_active).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: "var(--bg)" }}>
        {loading ? (
          <p className="text-center text-[12px] py-6" style={{ color: "var(--ink3)" }}>carregando…</p>
        ) : lista.length === 0 ? (
          <div className="text-center py-10 px-5">
            <p className="text-[12.5px] font-bold" style={{ color: "var(--ink2)" }}>
              {busca || soNaoRespondidas ? "Nada encontrado" : "Nenhuma conversa aqui"}
            </p>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>
              {busca || soNaoRespondidas
                ? "Tente outro filtro."
                : aba === "closers"
                  ? "Aqui aparecem os seus leads que já foram para um closer."
                  : "As conversas dos seus leads aparecem assim que alguém escrever."}
            </p>
          </div>
        ) : (
          lista.map((t) => {
            const ativa = t.lead_id === selectedLeadId;
            const naoLidas = t.unread || 0;
            const fixada = fixadas.has(t.lead_id);
            const espera = esperandoDesde(t);
            const dono = userName(users, t.lead?.owner_id);
            const tag = inboxTag(rotulos, t.cw_inbox_id);
            return (
              <button
                key={t.lead_id}
                onClick={() => onPick(t)}
                className="w-full text-left px-3 py-2.5 border-b transition-colors"
                style={{
                  borderColor: "var(--line2)",
                  background: ativa ? "var(--accent-soft)" : fixada ? "var(--card2)" : "var(--card)",
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 truncate text-[13px] font-bold" style={{ color: "var(--ink)" }}>
                    {threadTitle(t)}
                  </span>
                  <span className="shrink-0 text-[10.5px]" style={{ color: "var(--ink3)" }}>
                    {shortWhen(t.last_at)}
                  </span>
                  <span
                    onClick={(e) => alternarFixar(e, t.lead_id)}
                    role="button"
                    tabIndex={-1}
                    title={fixada ? "Desafixar" : "Fixar no topo"}
                    className="shrink-0 p-0.5 rounded hover:opacity-100 transition-opacity"
                    style={{ color: fixada ? "var(--amber)" : "var(--ink3)", opacity: fixada ? 1 : 0.45 }}
                  >
                    <IconPin size={13} filled={fixada} />
                  </span>
                </div>

                {/* Selos: dono · número · esperando resposta */}
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {dono && (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {dono}
                    </span>
                  )}
                  {tag && (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                          style={tag.ehApi
                            ? { background: "var(--wa-ok-bg)", color: "var(--wa)" }
                            : { background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}
                          title={tag.ehApi ? "Número oficial (API)" : "WhatsApp normal"}>
                      {tag.ehApi ? "API oficial" : "normal"} · {tag.nome}
                    </span>
                  )}
                  {espera && (
                    <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold"
                          style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}
                          title="O cliente falou por último — ninguém respondeu ainda">
                      esperando {humanizarEspera(espera)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                  <span className="flex-1 min-w-0 truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {t.last_direction === "out" && <span>você: </span>}
                    {t.last_message || formatPhoneDisplay(t.lead?.phone) || "—"}
                  </span>
                  {naoLidas > 0 && (
                    <span
                      className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-white text-[10px] font-bold grid place-items-center"
                      style={{ background: "var(--wa-bright)" }}
                    >
                      {naoLidas > 99 ? "99+" : naoLidas}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
