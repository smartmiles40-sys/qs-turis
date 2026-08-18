// src/components/sdr/wa/WaThreadList.tsx
// -----------------------------------------------------------------------------
// "Minhas conversas": a lista de WhatsApp do usuário logado.
//
// O recorte de QUEM aparece vem da RLS (migrations 0024/0025) — o Supabase só
// devolve as conversas dos leads dele (mais as que ele passou pro closer, pra
// poder acompanhar). As abas e filtros daqui são organização em cima disso, não
// segurança: mesmo que alguém refaça a query no DevTools, continua vendo só o seu.
//
// DESENHO — três decisões que mudam a leitura da lista:
//  1. Avatar à esquerda: dá a âncora de varredura que não existia (79% das
//     pessoas varrem em F; sem coluna fixa à esquerda, varrer vira ler).
//  2. Trilho de 3px na borda: carrega o estado (ativa/fixada/esperando) em vez
//     de três selos coloridos brigando por espaço na mesma linha.
//  3. Altura previsível: 2 linhas fixas + 1 de meta que NUNCA quebra. Antes a
//     altura variava de 62 a 90px e o olho perdia o ritmo.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listMyThreads, listPinnedLeadIds, listUsersLite, togglePin, getInboxLabels,
  shortWhen, subscribeToThreads, threadTitle, isCloser, userName,
  esperandoDesde, humanizarEspera, inboxTag, listWaNumeros,
  markThreadRead, markThreadUnread, exportarConversaTxt,
  type WaThread, type UserLite, type InboxLabels, type WaNumero,
} from "@/lib/qs/waInbox";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { WaAvatar, WaLinhaEsqueleto, WaSeloNumero } from "./WaBits";
import { waPlain } from "./waFormat";
import WaMenuContexto, { IconeMenu, PATHS, useToqueLongo, type ItemMenu, type PosMenu } from "./WaMenuContexto";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

type Aba = "meus" | "closers" | "todos";

interface Props {
  selectedLeadId?: string | null;
  onPick: (t: WaThread) => void;
  /** Abrir o card do cliente — vira um item do menu do botão direito. */
  onOpenLead?: (leadId: string) => void;
}

function IconPin({ size = 13, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
         stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
    </svg>
  );
}

export default function WaThreadList({ selectedLeadId, onPick, onOpenLead }: Props) {
  const { currentUser } = useQsAuth();
  const ehGestor = currentUser?.role === "admin" || currentUser?.role === "gestor";
  // O closer atende a empresa inteira (0050): pra ele "Meus" nunca teve
  // sentido — ele não tem carteira. As abas passam a funcionar como as do
  // gestor, e ele abre já numa lista com gente de verdade dentro.
  const ehCloser = currentUser?.role === "closer";
  const visaoDeEquipe = ehGestor || ehCloser;

  const [threads, setThreads] = useState<WaThread[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [fixadas, setFixadas] = useState<Set<string>>(new Set());
  const [rotulos, setRotulos] = useState<InboxLabels>({});
  // Os números de WhatsApp da conta. Com um número só, tanto o selo de origem
  // quanto o filtro seriam ruído — a resposta seria sempre a mesma. Os dois
  // aparecem sozinhos no dia em que o segundo número conectar.
  const [numeros, setNumeros] = useState<WaNumero[]>([]);
  const varios = numeros.length > 1;
  const [loading, setLoading] = useState(true);

  const [aba, setAba] = useState<Aba>(
    // O closer não tem leads próprios: abrir em "Meus" era abrir vazio.
    currentUser?.role === "closer" ? "todos" : "meus"
  );
  const [busca, setBusca] = useState("");
  const [soNaoRespondidas, setSoNaoRespondidas] = useState(false);
  const [donoFiltro, setDonoFiltro] = useState<string>("todos");   // só gestor
  const [numeroFiltro, setNumeroFiltro] = useState<string>("todos");

  const carregar = useCallback(async () => {
    const [ts, ps] = await Promise.all([listMyThreads(), listPinnedLeadIds()]);
    setThreads(ts);
    setFixadas(ps);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => subscribeToThreads(carregar), [carregar]);

  // Rede de segurança do tempo real: o websocket cai (notebook dorme, wi-fi
  // troca, proxy derruba conexão ociosa) e volta SEM reenviar o que perdeu — uma
  // conversa nova ficaria fora da lista até um F5. Recarrega ao voltar o foco e
  // a cada 60s com a aba visível. Barato, e é o que faz "sumiu uma conversa"
  // virar "apareceu um minuto depois".
  useEffect(() => {
    const aoVoltar = () => { if (!document.hidden) carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    const t = setInterval(aoVoltar, 60_000);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [carregar]);
  useEffect(() => {
    listUsersLite().then(setUsers);
    getInboxLabels().then(setRotulos);
    listWaNumeros().then(setNumeros);
  }, []);

  const alternarFixar = useCallback(async (leadId: string) => {
    const novo = await togglePin(leadId);
    if (novo == null) return;
    setFixadas((prev) => {
      const s = new Set(prev);
      if (novo) s.add(leadId); else s.delete(leadId);
      return s;
    });
  }, []);

  // ── Menu do botão direito na conversa ─────────────────────────────────────
  const [menu, setMenu] = useState<{ pos: PosMenu; t: WaThread } | null>(null);

  const alternarLida = useCallback(async (t: WaThread) => {
    const temNaoLida = (t.unread || 0) > 0;
    if (temNaoLida) {
      await markThreadRead(t.lead_id);
    } else if (!(await markThreadUnread(t.lead_id))) {
      // Sem a 0045 no banco a marcação não existe — dizer isso é melhor do que
      // um clique que não faz nada e deixa a pessoa clicando de novo.
      notifyError("Marcar como não lida ainda não está ativo no banco (falta a migration 0045).");
      return;
    }
    // Otimista: a lista recarrega sozinha pelo realtime, mas o retorno visual
    // imediato é o que faz o clique parecer que funcionou.
    setThreads((prev) => prev.map((x) =>
      x.lead_id === t.lead_id ? { ...x, unread: temNaoLida ? 0 : Math.max(1, x.unread || 0) } : x
    ));
    notifySuccess(temNaoLida ? "Conversa marcada como lida." : "Conversa marcada como não lida.");
  }, []);

  const itensMenu = useCallback((t: WaThread): ItemMenu[] => {
    const naoLida = (t.unread || 0) > 0;
    const fixada = fixadas.has(t.lead_id);
    return [
      {
        id: "lida",
        label: naoLida ? "Marcar como lida" : "Marcar como não lida",
        icone: <IconeMenu d={naoLida ? PATHS.lida : PATHS.naoLida} />,
        onClick: () => void alternarLida(t),
      },
      {
        id: "fixar",
        label: fixada ? "Desafixar" : "Fixar no topo",
        icone: <IconeMenu d={PATHS.fixar} />,
        onClick: () => void alternarFixar(t.lead_id),
      },
      {
        id: "card",
        label: "Abrir o card do cliente",
        icone: <IconeMenu d={PATHS.card} />,
        escondido: !onOpenLead,
        onClick: () => onOpenLead?.(t.lead_id),
      },
      {
        id: "baixar",
        label: "Baixar conversa (.txt)",
        icone: <IconeMenu d={PATHS.baixar} />,
        onClick: () => void exportarConversaTxt(t.lead_id, threadTitle(t), t.lead?.phone ?? null),
      },
    ];
  }, [fixadas, alternarLida, alternarFixar, onOpenLead]);

  // No celular não existe botão direito: segurar o dedo abre o mesmo menu. O ref
  // guarda QUAL linha está sob o dedo — hook não pode ser chamado dentro do map.
  const alvoToque = useRef<WaThread | null>(null);
  const toque = useToqueLongo(useCallback((pos: PosMenu) => {
    if (alvoToque.current) setMenu({ pos, t: alvoToque.current });
  }, []));

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const soDigitos = q.replace(/\D/g, "");

    const out = threads.filter((t) => {
      const dono = t.lead?.owner_id ?? null;

      if (aba === "meus") {
        // Gestor não tem carteira própria: pra ele a primeira aba é "a equipe",
        // ou seja, tudo que NÃO está com um closer.
        if (visaoDeEquipe ? isCloser(users, dono) : dono !== currentUser?.id) return false;
      } else if (aba === "closers") {
        if (!isCloser(users, dono)) return false;
      }

      if (visaoDeEquipe && donoFiltro !== "todos" && dono !== donoFiltro) return false;
      if (soNaoRespondidas && !esperandoDesde(t)) return false;

      // Por qual dos NOSSOS números a conversa corre. Conversa sem número
      // identificado (as antigas, anteriores ao registro da caixa) fica de fora
      // de propósito quando se filtra por um número específico: ninguém sabe se
      // ela é daquele número, e chutar seria pior que omitir.
      if (numeroFiltro !== "todos" && String(t.cw_inbox_id ?? "") !== numeroFiltro) return false;

      if (q) {
        const nome = threadTitle(t).toLowerCase();
        const fone = (t.lead?.phone || "").replace(/\D/g, "");
        if (!nome.includes(q) && !(soDigitos.length >= 3 && fone.includes(soDigitos))) return false;
      }
      return true;
    });

    // Fixadas no topo; dentro de cada grupo, a mais recente primeiro.
    return [...out].sort((a, b) => {
      const fa = fixadas.has(a.lead_id) ? 1 : 0;
      const fb = fixadas.has(b.lead_id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.last_at || 0).getTime() - new Date(a.last_at || 0).getTime();
    });
  }, [threads, aba, busca, soNaoRespondidas, donoFiltro, numeroFiltro, fixadas, users, visaoDeEquipe, currentUser?.id]);

  const contarAba = useCallback((a: Aba) => {
    return threads.filter((t) => {
      const dono = t.lead?.owner_id ?? null;
      if (a === "meus") return visaoDeEquipe ? !isCloser(users, dono) : dono === currentUser?.id;
      if (a === "closers") return isCloser(users, dono);
      return true;
    }).length;
  }, [threads, users, visaoDeEquipe, currentUser?.id]);

  const naoRespondidas = useMemo(() => threads.filter((t) => esperandoDesde(t)).length, [threads]);
  const temFiltro = Boolean(busca) || soNaoRespondidas || donoFiltro !== "todos" || numeroFiltro !== "todos";

  /** Quantas conversas correm por cada número — o filtro precisa dizer isso antes do clique. */
  const porNumero = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) {
      const k = String(t.cw_inbox_id ?? "");
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [threads]);

  const ABAS: { key: Aba; label: string }[] = [
    { key: "meus", label: visaoDeEquipe ? "Da equipe" : "Meus leads" },
    { key: "closers", label: "Com closers" },
    { key: "todos", label: "Todos" },
  ];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Abas */}
      <div className="shrink-0 flex" style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}
           role="tablist" aria-label="Filtrar conversas">
        {ABAS.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={aba === a.key}
            onClick={() => {
              setAba(a.key);
              // "Equipe" e "Todos" agora vêm sem teto de 100 — são mais de mil
              // conversas. Abrir com o filtro de quem espera resposta ligado é o
              // que torna isso útil em vez de uma parede de nomes; o botão ao
              // lado desliga quando alguém quiser ver a lista inteira.
              // Liga nas abas de equipe (lista sem teto) e DESLIGA ao voltar —
              // senão "Meus" ficava escondendo conversa respondida sem aviso.
              setSoNaoRespondidas(a.key !== "meus");
            }}
            className="wa-tab flex-1 px-2 py-2.5 text-[12px] font-semibold"
          >
            {a.label}
            <span className="ml-1.5 font-normal tabular-nums" style={{ color: "var(--ink3)" }}>
              {contarAba(a.key)}
            </span>
          </button>
        ))}
      </div>

      {/* Busca e filtros */}
      <div className="shrink-0 px-3 py-2.5 space-y-2"
           style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <div className="relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
               style={{ color: "var(--ink3)" }}>
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome ou telefone"
            aria-label="Buscar conversa"
            className="w-full rounded-lg pl-9 pr-3 py-2 text-[13px] outline-none"
            style={{ border: "1px solid var(--line)", background: "var(--card2)", color: "var(--ink)" }}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSoNaoRespondidas((v) => !v)}
            aria-pressed={soNaoRespondidas}
            title="Só conversas em que o cliente falou por último"
            className="wa-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold"
            style={soNaoRespondidas
              ? { background: "var(--wa-err-bg)", color: "var(--wa-err-ink)", border: "1px solid transparent" }
              : { background: "transparent", color: "var(--ink3)", border: "1px solid var(--line)" }}
          >
            Esperando resposta
            {naoRespondidas > 0 && <span className="ml-1 tabular-nums">{naoRespondidas}</span>}
          </button>

          {/* Filtrar por número só existe quando há mais de um: com um número
              só, "todos" e "aquele" devolveriam a mesma lista. */}
          {varios && (
            <select
              value={numeroFiltro}
              onChange={(e) => setNumeroFiltro(e.target.value)}
              aria-label="Filtrar por número de WhatsApp"
              title="De qual dos nossos números é a conversa"
              className="rounded-lg px-2 py-1 text-[11px] outline-none"
              style={numeroFiltro !== "todos"
                ? { border: "1px solid var(--wa)", background: "transparent", color: "var(--wa)", fontWeight: 600 }
                : { border: "1px solid var(--line)", background: "transparent", color: "var(--ink2)" }}
            >
              <option value="todos">Todos os números</option>
              {numeros.map((n) => (
                <option key={n.id} value={String(n.id)}>
                  {n.nome}{n.numero ? ` · ${n.numero}` : ""}{n.tipo === "api" ? " (oficial)" : ""} · {porNumero.get(String(n.id)) ?? 0}
                </option>
              ))}
            </select>
          )}

          {visaoDeEquipe && (
            <select
              value={donoFiltro}
              onChange={(e) => setDonoFiltro(e.target.value)}
              aria-label="Filtrar por atendente"
              className="ml-auto rounded-lg px-2 py-1 text-[11px] outline-none"
              style={{ border: "1px solid var(--line)", background: "transparent", color: "var(--ink2)" }}
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
          Array.from({ length: 7 }).map((_, i) => <WaLinhaEsqueleto key={i} />)
        ) : lista.length === 0 ? (
          <div className="text-center py-12 px-6">
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink2)" }}>
              {temFiltro ? "Nada com esse filtro" : "Nenhuma conversa ainda"}
            </p>
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--ink3)" }}>
              {temFiltro
                ? "Tente outro nome, número ou período."
                : aba === "closers"
                  ? "Aqui aparecem os seus leads que já foram para um closer."
                  : "As conversas dos seus leads aparecem assim que alguém escrever."}
            </p>
            {temFiltro && (
              <button
                onClick={() => { setBusca(""); setSoNaoRespondidas(false); setDonoFiltro("todos"); }}
                className="wa-chip mt-3 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}
              >
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          lista.map((t) => {
            const ativa = t.lead_id === selectedLeadId;
            const naoLidas = t.unread || 0;
            const fixada = fixadas.has(t.lead_id);
            const espera = esperandoDesde(t);
            const dono = userName(users, t.lead?.owner_id);
            const tag = inboxTag(rotulos, t.cw_inbox_id);
            const nome = threadTitle(t);
            // O próprio nome repetido em 40 linhas é ruído: só mostra o dono
            // quando ele NÃO é você.
            const mostraDono = Boolean(dono) && t.lead?.owner_id !== currentUser?.id;

            return (
              <div key={t.lead_id} className="wa-row"
                   data-ativa={ativa} data-fixada={fixada}
                   data-esperando={Boolean(espera)} data-nao-lida={naoLidas > 0}
                   onContextMenu={(e) => { e.preventDefault(); setMenu({ pos: { x: e.clientX, y: e.clientY }, t }); }}
                   onTouchStart={(e) => { alvoToque.current = t; toque.onTouchStart(e); }}
                   onTouchMove={toque.onTouchMove}
                   onTouchEnd={toque.onTouchEnd}
                   onTouchCancel={toque.onTouchCancel}>
                <button
                  onClick={() => onPick(t)}
                  className="wa-row-btn w-full text-left flex items-start gap-3 pl-3 pr-10 py-2.5"
                >
                  <WaAvatar nome={nome} url={t.avatar_url} size={40} />

                  <span className="flex-1 min-w-0">
                    {/* linha 1 — nome + hora */}
                    <span className="flex items-baseline gap-2">
                      <span className="wa-row-nome flex-1 min-w-0 truncate text-[14px] font-medium"
                            style={{ color: "var(--ink)" }}>
                        {nome}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums"
                            style={{ color: espera ? "var(--red)" : "var(--ink3)" }}>
                        {shortWhen(t.last_at)}
                      </span>
                    </span>

                    {/* linha 2 — prévia + não lidas (altura sempre igual) */}
                    <span className="flex items-center gap-2 mt-0.5">
                      <span className="wa-row-preview flex-1 min-w-0 truncate text-[12px]"
                            style={{ color: "var(--ink2)" }}>
                        {t.last_direction === "out" && <span style={{ color: "var(--ink3)" }}>você: </span>}
                        {/* Sem os sinais de formatação: numa linha só, truncada,
                            negrito não ajuda — e `*Victor Hugo*` só rouba espaço. */}
                        {waPlain(t.last_message) || formatPhoneDisplay(t.lead?.phone) || "—"}
                      </span>
                      {naoLidas > 0 && (
                        <span className="shrink-0 min-w-[19px] h-[19px] px-1.5 rounded-full text-white text-[11px] font-semibold grid place-items-center tabular-nums"
                              style={{ background: "var(--wa-bright)" }}>
                          {naoLidas > 99 ? "99+" : naoLidas}
                        </span>
                      )}
                    </span>

                    {/* linha 3 — meta. Uma linha só, com truncate: nunca quebra. */}
                    {(espera || mostraDono || (varios && tag)) && (
                      <span className="flex items-center gap-2 mt-1 min-w-0 text-[11px]">
                        {espera && (
                          <span className="shrink-0 font-semibold" style={{ color: "var(--red)" }}>
                            esperando {humanizarEspera(espera)}
                          </span>
                        )}
                        {varios && tag && (
                          <WaSeloNumero tipo={tag.tipo} nome={tag.nome} numero={tag.numero} compacto />
                        )}
                        {mostraDono && (
                          <span className="min-w-0 truncate" style={{ color: "var(--ink3)" }}>{dono}</span>
                        )}
                      </span>
                    )}
                  </span>
                </button>

                {/* Alfinete FORA do botão: interativo dentro de interativo é HTML
                    inválido e deixava fixar inalcançável por teclado. */}
                <button
                  onClick={() => alternarFixar(t.lead_id)}
                  aria-pressed={fixada}
                  aria-label={fixada ? `Desafixar ${nome}` : `Fixar ${nome} no topo`}
                  title={fixada ? "Desafixar" : "Fixar no topo"}
                  className="wa-pin absolute right-2 top-2.5 w-8 h-8 grid place-items-center rounded-lg"
                >
                  <IconPin size={13} filled={fixada} />
                </button>
              </div>
            );
          })
        )}
      </div>

      <WaMenuContexto
        pos={menu?.pos ?? null}
        titulo={menu ? threadTitle(menu.t) : null}
        itens={menu ? itensMenu(menu.t) : []}
        onFechar={() => setMenu(null)}
      />
    </div>
  );
}
