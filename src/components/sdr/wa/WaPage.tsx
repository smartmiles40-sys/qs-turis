// src/components/sdr/wa/WaPage.tsx
// -----------------------------------------------------------------------------
// A ABA de WhatsApp — o atendimento em tela cheia.
//
// Por que existe, se já havia o dock lateral: o dock foi desenhado pro SDR, que
// atende ENQUANTO executa a cadência — conversa é o meio, a fila é o trabalho.
// Para um time de atendimento a relação se inverte: a conversa É o trabalho, o
// dia inteiro. Num painel de 440px isso custa caro (lista espremida, sem contexto
// do cliente à vista, rolagem constante).
//
// DESENHO — o que a tela cheia compra que o dock não conseguia:
//
//  1. TRÊS colunas: lista · conversa · contexto. O dock só cabia duas, então
//     saber "quem é essa pessoa" exigia sair da conversa e abrir o card.
//  2. O contexto mostra o aviso de JANELA DE 24H. Passa a valer dinheiro quando
//     o número oficial entrar: fora da janela, a Meta só aceita template, e
//     descobrir isso pelo erro de envio é descobrir tarde.
//  3. Reaproveita <WaThreadList/> e <WaConversation/> INTEIROS. Nada aqui é
//     cópia — se fossem duas versões, cada correção viraria dois lugares pra
//     lembrar, e um deles ficaria pra trás.
//
// O dock não é montado enquanto esta aba está aberta (ver SdrLayout): dois
// WhatsApps na mesma tela confundem e assinam o realtime duas vezes.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { useChatAppDock } from "@/contexts/ChatAppDockContext";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { transferLead } from "@/lib/qs/queries";
import { notifySuccess } from "@/lib/qs/notify";
import { useWaAvisos } from "@/lib/qs/waAvisos";
import WaThreadList from "./WaThreadList";
import WaConversation from "./WaConversation";
import WaDesconhecidos from "./WaDesconhecidos";
import { countDesconhecidos } from "@/lib/qs/waDesconhecidos";
import { WaAvatar, WaSeloNumero } from "./WaBits";
import BriefingDoLead from "../agenda/BriefingDoLead";
import {
  getInboxLabels, inboxTag, listUsersLite, threadTitle, userName,
  esperandoDesde, humanizarEspera, exportarConversaTxt,
  type WaThread, type UserLite, type InboxLabels,
} from "@/lib/qs/waInbox";

interface Props {
  onOpenLead?: (leadId: string) => void;
}

/** O que a página guarda da conversa aberta. */
interface Selecao {
  leadId: string;
  nome: string;
  phone: string | null;
  ownerId: string | null;
  /** A linha completa, quando veio da lista — traz janela de 24h, caixa, espera. */
  thread: WaThread | null;
  /** Rascunho vindo de um roteiro de cadência (quando o SDR chega de uma tarefa). */
  draft?: string | null;
}

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const P = {
  chat: "M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5z",
  back: "M15 18l-6-6 6-6",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  bellOff: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18",
  info: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
};

export default function WaPage({ onOpenLead }: Props) {
  const { currentUser } = useQsAuth();
  const { target } = useChatAppDock();
  const { naoLidas, avisos, alternarAvisos } = useWaAvisos();

  const [sel, setSel] = useState<Selecao | null>(null);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [rotulos, setRotulos] = useState<InboxLabels>({});
  const [contextoAberto, setContextoAberto] = useState(true);

  const [transferindo, setTransferindo] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);

  // Triagem de quem escreveu sem ser lead. Só a gestão enxerga — a RLS da
  // qs_wa_descartadas devolve zero pro SDR, então o botão simplesmente não
  // aparece pra ele em vez de aparecer e recusar o clique.
  const [triagem, setTriagem] = useState(false);
  const [desconhecidos, setDesconhecidos] = useState(0);

  useEffect(() => {
    void listUsersLite().then(setUsers);
    void getInboxLabels().then(setRotulos);
    void countDesconhecidos().then(setDesconhecidos);
  }, []);

  // Clicou no WhatsApp de um lead em outra tela com a aba já aberta: abre a
  // conversa dele aqui. Só temos o leadId nesse caminho — o resto do contexto
  // aparece assim que a lista entregar a linha completa.
  useEffect(() => {
    if (!target?.leadId) return;
    setTransferindo(false);
    setSel({
      leadId: target.leadId,
      nome: target.name || "Lead",
      phone: target.phone ?? null,
      ownerId: target.ownerId ?? null,
      thread: null,
      draft: target.draft ?? null,
    });
  }, [target?.leadId, target?.name, target?.phone, target?.ownerId, target?.draft]);

  const escolher = useCallback((t: WaThread) => {
    setTransferindo(false);
    setSel({
      leadId: t.lead_id,
      nome: threadTitle(t),
      phone: t.lead?.phone ?? null,
      ownerId: t.lead?.owner_id ?? null,
      thread: t,
    });
  }, []);

  const transferirPara = useCallback(async (destino: UserLite) => {
    if (!sel || transferBusy) return;
    setTransferBusy(true);
    const ok = await transferLead(
      sel.leadId,
      sel.ownerId ?? currentUser?.id ?? null,
      destino.id,
      `Transferido pelo atendimento (WhatsApp) por ${currentUser?.name ?? "?"}`
    );
    setTransferBusy(false);
    setTransferindo(false);
    // Transferiu = a conversa deixa de ser deste usuário (a RLS corta na hora).
    // Fechar evita a tela morta de "conversa que não carrega mais".
    if (ok) {
      notifySuccess(`${sel.nome} transferido para ${destino.name} — a conversa foi junto.`);
      setSel(null);
    }
  }, [sel, transferBusy, currentUser]);

  const t = sel?.thread ?? null;
  const tag = inboxTag(rotulos, t?.cw_inbox_id ?? null);
  const espera = t ? esperandoDesde(t) : null;
  const dono = userName(users, sel?.ownerId);
  const foraDaJanela = t?.can_reply === false;
  const destinos = users.filter((u) => u.is_active && (u.role === "sdr" || u.role === "closer") && u.id !== (sel?.ownerId ?? currentUser?.id));

  return (
    <div className="qs-wa h-full flex flex-col overflow-hidden">
      {/* Cabeçalho da página */}
      <header className="shrink-0 flex items-center gap-3 px-4 sm:px-6 h-14"
              style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <span style={{ color: "var(--wa)" }}><Icon d={P.chat} size={20} /></span>
        <div className="flex-1 min-w-0">
          <h1 className="text-[16px] font-semibold leading-tight truncate" style={{ color: "var(--ink)" }}>
            WhatsApp
          </h1>
          <p className="text-[12px] leading-tight truncate" style={{ color: "var(--ink3)" }}>
            {naoLidas > 0
              ? `${naoLidas} conversa${naoLidas > 1 ? "s" : ""} esperando você`
              : "Nenhuma conversa esperando"}
          </p>
        </div>

        {desconhecidos > 0 && !triagem && (
          <button onClick={() => setTriagem(true)}
                  title="Números que escreveram e não são lead"
                  className="shrink-0 flex items-center gap-2 px-3 h-9 rounded-lg text-[13px] font-semibold"
                  style={{ background: "rgba(245,130,31,.12)", color: "var(--orange)", border: "1px solid rgba(245,130,31,.35)" }}>
            <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] text-white"
                  style={{ background: "var(--orange)" }}>
              {desconhecidos}
            </span>
            <span className="hidden sm:inline">sem lead</span>
          </button>
        )}

        <button onClick={alternarAvisos}
                title={avisos ? "Desligar som e notificação" : "Ligar som e notificação"}
                aria-label={avisos ? "Desligar avisos" : "Ligar avisos"}
                aria-pressed={avisos}
                className="wa-icon-btn w-9 h-9 grid place-items-center rounded-lg">
          <Icon d={avisos ? P.bell : P.bellOff} size={17} />
        </button>
        {sel && (
          <button onClick={() => setContextoAberto((v) => !v)}
                  title={contextoAberto ? "Esconder os dados do cliente" : "Mostrar os dados do cliente"}
                  aria-pressed={contextoAberto}
                  className="wa-icon-btn hidden xl:grid w-9 h-9 place-items-center rounded-lg">
            <Icon d={P.info} size={17} />
          </button>
        )}
      </header>

      {/* A triagem toma a tela inteira de propósito: decidir quem vira lead é
          um trabalho em si, não algo pra fazer de canto de olho enquanto uma
          conversa espera resposta do outro lado. */}
      {triagem && (
        <div className="flex-1 min-h-0">
          <WaDesconhecidos onFechar={() => setTriagem(false)} onMudou={setDesconhecidos} />
        </div>
      )}

      <div className={`flex-1 min-h-0 ${triagem ? "hidden" : "flex"}`}>
        {/* ── Lista ─────────────────────────────────────────────────────────
            No celular, lista e conversa se revezam (a lista some ao abrir uma
            conversa). A partir de lg as duas convivem. */}
        <div className={`${sel ? "hidden lg:block" : "block"} w-full lg:w-[340px] shrink-0 min-h-0`}
             style={{ borderRight: "1px solid var(--line)" }}>
          <WaThreadList selectedLeadId={sel?.leadId ?? null} onPick={escolher} onOpenLead={onOpenLead} />
        </div>

        {/* ── Conversa ──────────────────────────────────────────────────── */}
        <div className={`${sel ? "flex" : "hidden lg:flex"} flex-1 min-w-0 flex-col min-h-0`}>
          {sel ? (
            <>
              {/* Barra da conversa — SEMPRE visível, não só no celular. Entre
                  1024 e 1280px não cabe o painel de contexto, e a
                  <WaConversation/> não tem cabeçalho próprio: sem esta barra,
                  o atendente só saberia com quem fala pela linha marcada na
                  lista. O botão de voltar é que é exclusivo do celular, onde a
                  lista realmente sai da tela. */}
              <div className="shrink-0 flex items-center gap-2 px-2 sm:px-3 h-14"
                   style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
                <button onClick={() => setSel(null)} aria-label="Voltar para as conversas"
                        className="wa-icon-btn lg:hidden w-9 h-9 grid place-items-center rounded-lg shrink-0">
                  <Icon d={P.back} />
                </button>
                <div className="hidden lg:block shrink-0">
                  <WaAvatar nome={sel.nome} url={t?.avatar_url} size={36} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold leading-tight truncate" style={{ color: "var(--ink)" }}>
                    {sel.nome}
                  </p>
                  <span className="flex items-center gap-1.5 leading-tight">
                    <span className="text-[11.5px] truncate tabular-nums" style={{ color: "var(--ink3)" }}>
                      {formatPhoneDisplay(sel.phone) || "WhatsApp"}
                    </span>
                    {/* Por qual dos NOSSOS números essa conversa corre. Aqui
                        aparece sempre: e uma linha so, nao 566. */}
                    {tag && <WaSeloNumero tipo={tag.tipo} nome={tag.nome} numero={tag.numero} compacto />}
                  </span>
                </div>
                {/* Abaixo de xl o painel de contexto não existe: estas duas
                    informações são as que mudam a decisão de escrever agora. */}
                {foraDaJanela && (
                  <span className="xl:hidden shrink-0 px-2 py-1 rounded-lg text-[11px] font-semibold"
                        style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}
                        title="O cliente não escreve há mais de 24h — num número oficial, só sai template aprovado.">
                    fora da janela
                  </span>
                )}
                {onOpenLead && (
                  <button onClick={() => onOpenLead(sel.leadId)}
                          className="wa-chip xl:hidden shrink-0 px-2.5 h-8 rounded-lg text-[12px] font-semibold"
                          style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
                    Ver card
                  </button>
                )}
                <button onClick={() => void exportarConversaTxt(sel.leadId, sel.nome, sel.phone)}
                        title="Baixar a conversa inteira (.txt)"
                        aria-label="Baixar conversa"
                        className="wa-icon-btn shrink-0 w-9 h-9 grid place-items-center rounded-lg">
                  <Icon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <WaConversation
                  key={sel.leadId}
                  leadId={sel.leadId}
                  leadName={sel.nome}
                  phone={sel.phone}
                  initialText={sel.draft}
                />
              </div>
            </>
          ) : (
            <div className="h-full grid place-items-center px-8 text-center" style={{ background: "var(--bg)" }}>
              <div>
                <span className="inline-grid place-items-center w-14 h-14 rounded-2xl mb-3"
                      style={{ background: "var(--card2)", color: "var(--ink3)" }}>
                  <Icon d={P.chat} size={26} />
                </span>
                <p className="text-[15px] font-semibold" style={{ color: "var(--ink2)" }}>
                  Escolha uma conversa
                </p>
                <p className="text-[13px] mt-1" style={{ color: "var(--ink3)" }}>
                  A lista à esquerda mostra quem está esperando resposta.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Contexto do cliente ────────────────────────────────────────────
            Some abaixo de xl: espremer três colunas numa tela de notebook
            deixaria a conversa — que é o trabalho — estreita demais. */}
        {sel && contextoAberto && (
          <aside className="hidden xl:flex w-[300px] shrink-0 flex-col overflow-y-auto"
                 style={{ borderLeft: "1px solid var(--line)", background: "var(--card)" }}>
            <div className="p-5 text-center" style={{ borderBottom: "1px solid var(--line)" }}>
              <div className="flex justify-center mb-3">
                <WaAvatar nome={sel.nome} url={t?.avatar_url} size={64} />
              </div>
              <p className="text-[15px] font-semibold leading-tight" style={{ color: "var(--ink)" }}>
                {sel.nome}
              </p>
              <p className="text-[12.5px] mt-0.5 tabular-nums" style={{ color: "var(--ink3)" }}>
                {formatPhoneDisplay(sel.phone) || "sem telefone"}
              </p>
            </div>

            {/* Alertas: o que muda a decisão de escrever agora */}
            {(foraDaJanela || espera) && (
              <div className="px-4 py-3 space-y-2" style={{ borderBottom: "1px solid var(--line)" }}>
                {foraDaJanela && (
                  <div className="rounded-lg px-3 py-2 text-[11.5px] leading-snug"
                       style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}>
                    <b>Fora da janela de 24h.</b> O cliente não escreve há mais de um dia. Num
                    número oficial da Meta, só sai template aprovado — texto livre é recusado.
                  </div>
                )}
                {espera && (
                  <div className="rounded-lg px-3 py-2 text-[11.5px] leading-snug"
                       style={{ background: "var(--wa-err-bg)", color: "var(--wa-err-ink)" }}>
                    <b>Esperando resposta há {humanizarEspera(espera)}.</b> O cliente falou por último.
                  </div>
                )}
              </div>
            )}

            <div className="mb-3"><BriefingDoLead leadId={sel.leadId} /></div>
            <dl className="px-4 py-3 space-y-3 text-[12.5px]" style={{ borderBottom: "1px solid var(--line)" }}>
              <div>
                <dt className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>
                  Atendido por
                </dt>
                <dd className="mt-0.5" style={{ color: "var(--ink)" }}>{dono || "sem dono"}</dd>
              </div>
              {t?.lead?.status && (
                <div>
                  <dt className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>
                    Situação do lead
                  </dt>
                  <dd className="mt-0.5" style={{ color: "var(--ink)" }}>{t.lead.status}</dd>
                </div>
              )}
              {tag && (
                <div>
                  <dt className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>
                    Número
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-1.5" style={{ color: "var(--ink)" }}>
                    <span className="min-w-0 truncate">{tag.nome}</span>
                    <WaSeloNumero tipo={tag.tipo} nome={tag.nome} numero={tag.numero} />
                  </dd>
                </div>
              )}
            </dl>

            <div className="p-4 space-y-2">
              {onOpenLead && (
                <button onClick={() => onOpenLead(sel.leadId)}
                        className="wa-chip w-full px-3 py-2 rounded-lg text-[12.5px] font-semibold"
                        style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
                  Abrir o card do cliente
                </button>
              )}

              <div className="relative">
                <button onClick={() => setTransferindo((v) => !v)}
                        aria-expanded={transferindo}
                        className="wa-chip w-full px-3 py-2 rounded-lg text-[12.5px] font-semibold"
                        style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
                  Transferir para outro atendente
                </button>
                {transferindo && (
                  <div className="absolute left-0 right-0 bottom-11 z-30 rounded-xl border shadow-lg overflow-hidden"
                       style={{ borderColor: "var(--line)", background: "var(--card)" }}>
                    <p className="px-3 pt-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide"
                       style={{ color: "var(--ink3)" }}>
                      Transferir para
                    </p>
                    {destinos.length === 0 ? (
                      <p className="px-3 pb-3 text-[12px]" style={{ color: "var(--ink3)" }}>
                        Nenhum outro atendente ativo.
                      </p>
                    ) : (
                      destinos.map((u) => (
                        <button key={u.id}
                                onClick={() => void transferirPara(u)}
                                disabled={transferBusy}
                                className="wa-row-btn w-full text-left px-3 py-2 text-[13px] font-medium disabled:opacity-50"
                                style={{ color: "var(--ink)" }}>
                          {u.name}
                        </button>
                      ))
                    )}
                    <p className="px-3 py-2 text-[10.5px] leading-snug border-t"
                       style={{ color: "var(--ink3)", borderColor: "var(--line)" }}>
                      A conversa, as atividades e o histórico vão junto. Esta conversa sai da sua lista.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
