// src/components/sdr/wa/WaDesconhecidos.tsx
// -----------------------------------------------------------------------------
// A CAIXA DE TRIAGEM — quem escreveu no WhatsApp da empresa e não é lead do QS.
//
// Por que ela é manual: dos 18 números que estavam esperando em 13/08, 13 já
// existiam no Bitrix (cliente antigo, pós-venda) e TRÊS eram do próprio time.
// Criar lead automático encheria a fila de prospecção de colega de trabalho —
// e é assim que um time aprende a ignorar uma tela.
//
// O que a tela mostra: quem (o nome que o WhatsApp exibe), quando, quantas
// mensagens e por qual número. O TEXTO não é guardado no QS (LGPD, decisão da
// 0038); quem precisa ler abre a conversa no Chatwoot.
//
// Duas saídas, ambas definitivas: vira lead (e a conversa é puxada junto) ou é
// ignorado. Um item tratado nunca mais volta.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { formatPhoneDisplay } from "@/lib/whatsapp";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { createCadenceTasks } from "@/lib/qs/queries";
import { syncThread, getInboxLabels, inboxTag, type InboxLabels } from "@/lib/qs/waInbox";
import {
  listDesconhecidos, ignorarDesconhecido, vincularDesconhecido, marcarResgatado,
  type Desconhecido,
} from "@/lib/qs/waDesconhecidos";
import { WaAvatar } from "./WaBits";

interface Props {
  onFechar: () => void;
  /** Avisa a página pra atualizar o selo do cabeçalho. */
  onMudou?: (pendentes: number) => void;
}

interface CadenciaLite { id: string; name: string }

function quando(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

export default function WaDesconhecidos({ onFechar, onMudou }: Props) {
  const { currentUser } = useQsAuth();
  const [itens, setItens] = useState<Desconhecido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [precisaMigration, setPrecisaMigration] = useState(false);
  const [rotulos, setRotulos] = useState<InboxLabels>({});
  const [cadencias, setCadencias] = useState<CadenciaLite[]>([]);

  // Qual item está com o formulário aberto, e o que já foi digitado nele.
  const [criando, setCriando] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cadenciaId, setCadenciaId] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { itens: lista, precisaMigration: falta } = await listDesconhecidos();
    setItens(lista);
    setPrecisaMigration(falta);
    setCarregando(false);
    onMudou?.(lista.length);
  }, [onMudou]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    void getInboxLabels().then(setRotulos);
    void supabase
      .from("qs_cadences")
      .select("id, name")
      .eq("status", "disponivel")
      .order("name")
      .then(({ data }) => setCadencias((data as CadenciaLite[]) || []));
  }, []);

  const abrirFormulario = (d: Desconhecido) => {
    setCriando(d.phone);
    setNome(d.nome || "");
    setCadenciaId(cadencias[0]?.id || "");
  };

  const remover = (phone: string) => {
    setItens((prev) => {
      const resto = prev.filter((x) => x.phone !== phone);
      onMudou?.(resto.length);
      return resto;
    });
  };

  /**
   * O lead já existe e só a conversa nunca veio. Criar outro lead duplicaria a
   * pessoa — a base já tem 68 casos assim, alguns com "ganho" num card e
   * "perdido" no outro. O que falta aqui é puxar o histórico.
   */
  const trazerConversa = async (d: Desconhecido) => {
    if (!d.leadId) return;
    setOcupado(true);
    const sync = await syncThread(d.leadId);
    if (sync.importadas > 0 || sync.conversationId) {
      // O retorno importa: se a RLS recusar o carimbo, o item voltaria no
      // próximo carregamento — remover da tela agora seria fingir sucesso.
      const ok = await marcarResgatado(d.ids, d.leadId);
      if (!ok) { setOcupado(false); return; } // o erro já foi notificado
      remover(d.phone);
      notifySuccess(
        sync.importadas > 0
          ? `Conversa trazida — ${sync.importadas} mensagem(ns) agora aparecem no atendimento.`
          : "Conversa vinculada."
      );
    } else {
      // Sem conversa no Chatwoot não há o que trazer, e carimbar como resolvido
      // esconderia o caso pra sempre. Fica na fila com o motivo à vista.
      notifyError(`Não veio nada do Chatwoot (${sync.motivo || "sem conversa"}).`);
    }
    setOcupado(false);
  };

  const ignorar = async (d: Desconhecido) => {
    setOcupado(true);
    const ok = await ignorarDesconhecido(d.ids);
    setOcupado(false);
    if (ok) remover(d.phone);
  };

  const criarLead = async (d: Desconhecido) => {
    const nomeFinal = nome.trim() || formatPhoneDisplay(d.phone) || d.phone;
    setOcupado(true);

    const partes = nomeFinal.split(" ");
    const temCadencia = Boolean(cadenciaId);
    const agora = new Date().toISOString();

    // owner_id vai NULO de propósito: o gatilho de rodízio (0028) escolhe o SDR
    // da vez. Mandar um dono daqui furaria a fila de distribuição.
    const { data: criado, error } = await supabase
      .from("qs_leads")
      .insert({
        full_name: nomeFinal,
        first_name: partes[0],
        last_name: partes.slice(1).join(" ") || null,
        phone: d.phone,
        owner_id: null,
        cadence_id: cadenciaId || null,
        // "manual", não "whatsapp": o CHECK de qs_leads.source só aceita
        // manual|api|integracao|importacao — "whatsapp" estourava 23514 e o
        // botão falhava com erro genérico. A origem real fica na nota abaixo.
        source: "manual",
        status: temCadencia ? "em_prospeccao" : "nao_iniciado",
        arrived_at: d.primeira,          // chegou quando ESCREVEU, não agora
        cadence_started_at: temCadencia ? agora : null,
      })
      .select()
      .single();

    if (error || !criado) {
      console.warn("[wa] criar lead da triagem:", error);
      notifyError("Não foi possível criar o lead. Confira o telefone e tente de novo.");
      setOcupado(false);
      return;
    }

    // Rastro de onde veio — daqui a um mês ninguém lembra por que este lead
    // existe sem ter vindo do Bitrix.
    await supabase.from("qs_notes").insert({
      lead_id: criado.id,
      author_id: currentUser?.id ?? null,
      body: `💬 Entrou pelo WhatsApp: mandou ${d.mensagens} mensagem${d.mensagens > 1 ? "s" : ""} a partir de ${new Date(d.primeira).toLocaleString("pt-BR")} sem ser lead. Cadastrado na triagem.`,
      tags: ["whatsapp", "triagem"],
    });

    if (temCadencia) {
      await createCadenceTasks(criado.id, cadenciaId, criado.owner_id ?? null);
    }

    // Puxa a conversa do Chatwoot pro lead novo. É o que faz a mensagem que
    // motivou tudo isto finalmente aparecer na tela de atendimento.
    const sync = await syncThread(criado.id);
    const carimbou = await vincularDesconhecido(d.ids, criado.id);

    setOcupado(false);
    setCriando(null);
    if (!carimbou) {
      // O lead JÁ EXISTE — o que falhou foi o carimbo (RLS/rede). Remover o
      // item fingiria sucesso; mantê-lo como estava convidaria um SEGUNDO
      // clique em "Criar lead" = a mesma pessoa duas vezes na base. O item
      // fica, mas apontando pro lead criado: o botão vira "Trazer conversa".
      setItens((prev) => prev.map((x) => (x.phone === d.phone ? { ...x, leadId: criado.id } : x)));
      return;
    }
    remover(d.phone);
    notifySuccess(
      sync.importadas > 0
        ? `${nomeFinal} virou lead — ${sync.importadas} mensagem(ns) trazidas pra conversa.`
        : `${nomeFinal} virou lead.`
    );
    if (sync.importadas === 0 && sync.motivo) {
      console.warn("[wa] triagem: conversa não veio —", sync.motivo);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0" style={{ background: "var(--bg)" }}>
      <header
        className="shrink-0 flex items-center gap-3 px-4 sm:px-6 h-14"
        style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: "var(--ink)" }}>
            Escreveram e não são lead
          </h2>
          <p className="text-[12px] leading-tight" style={{ color: "var(--ink3)" }}>
            {carregando
              ? "Carregando…"
              : itens.length === 0
                ? "Nada esperando — tudo tratado"
                : `${itens.length} número${itens.length > 1 ? "s" : ""} esperando uma decisão`}
          </p>
        </div>
        <button
          onClick={onFechar}
          className="wa-icon-btn px-3 h-9 rounded-lg text-[13px] font-medium"
          style={{ color: "var(--ink2)" }}
        >
          Voltar às conversas
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
        {precisaMigration && (
          <div
            className="mb-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: "rgba(245,130,31,.10)", border: "1px solid rgba(245,130,31,.35)", color: "var(--ink)" }}
          >
            <strong>Falta aplicar a migration 0047.</strong> Sem ela não dá pra separar quem já foi
            tratado de quem não foi — a lista apareceria com casos velhos misturados. Cole
            <code className="mx-1 px-1 rounded" style={{ background: "var(--card2)" }}>
              supabase/migrations/0047_wa_triagem_desconhecidos.sql
            </code>
            no SQL Editor do Supabase e recarregue.
          </div>
        )}

        {!carregando && !precisaMigration && itens.length === 0 && (
          <div className="text-center py-16" style={{ color: "var(--ink3)" }}>
            <p className="text-[14px]">Ninguém escreveu de um número desconhecido.</p>
            <p className="text-[12px] mt-1">
              Quando alguém escrever sem ser lead, aparece aqui pra você decidir.
            </p>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {itens.map((d) => {
            const tag = inboxTag(rotulos, d.inboxId);
            const aberto = criando === d.phone;
            return (
              <li
                key={d.phone}
                className="rounded-xl px-4 py-3"
                style={{ background: "var(--card)", border: "1px solid var(--line)" }}
              >
                <div className="flex items-center gap-3">
                  <WaAvatar nome={d.nome || d.phone} size={40} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                      {d.nome || formatPhoneDisplay(d.phone) || d.phone}
                    </p>
                    <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                      {d.nome ? `${formatPhoneDisplay(d.phone) || d.phone} · ` : ""}
                      {d.mensagens} mensagem{d.mensagens > 1 ? "s" : ""} · {quando(d.ultima)}
                      {tag ? ` · ${tag.nome}` : ""}
                    </p>
                    {d.leadId && (
                      <p className="text-[12px] mt-0.5" style={{ color: "var(--orange)" }}>
                        Já é lead — a conversa é que nunca foi trazida pro QS.
                      </p>
                    )}
                  </div>
                  {!aberto && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => ignorar(d)}
                        disabled={ocupado}
                        className="px-3 h-9 rounded-lg text-[13px] font-medium disabled:opacity-50"
                        style={{ color: "var(--ink2)", border: "1px solid var(--line)" }}
                      >
                        Ignorar
                      </button>
                      {/* Quem JÁ é lead não pode virar lead de novo — seria a
                          mesma pessoa duas vezes na base, cada metade com um
                          pedaço da história. */}
                      <button
                        onClick={() => (d.leadId ? trazerConversa(d) : abrirFormulario(d))}
                        disabled={ocupado}
                        className="px-3 h-9 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                        style={{ background: "var(--wa)" }}
                      >
                        {d.leadId ? "Trazer conversa" : "Criar lead"}
                      </button>
                    </div>
                  )}
                </div>

                {aberto && (
                  <div className="mt-3 pt-3 flex flex-col gap-3" style={{ borderTop: "1px solid var(--line)" }}>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <label className="flex-1 text-[12px] font-medium" style={{ color: "var(--ink3)" }}>
                        Nome
                        <input
                          value={nome}
                          onChange={(e) => setNome(e.target.value)}
                          placeholder={formatPhoneDisplay(d.phone) || d.phone}
                          className="mt-1 w-full h-10 px-3 rounded-lg text-[14px]"
                          style={{ background: "var(--card2)", border: "1px solid var(--line)", color: "var(--ink)" }}
                        />
                      </label>
                      <label className="flex-1 text-[12px] font-medium" style={{ color: "var(--ink3)" }}>
                        Cadência
                        <select
                          value={cadenciaId}
                          onChange={(e) => setCadenciaId(e.target.value)}
                          className="mt-1 w-full h-10 px-3 rounded-lg text-[14px]"
                          style={{ background: "var(--card2)", border: "1px solid var(--line)", color: "var(--ink)" }}
                        >
                          <option value="">Sem cadência (não entra na fila)</option>
                          {cadencias.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                      O SDR sai do rodízio automático. A conversa do WhatsApp vem junto.
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => criarLead(d)}
                        disabled={ocupado}
                        className="px-4 h-10 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
                        style={{ background: "var(--wa)" }}
                      >
                        {ocupado ? "Criando…" : "Criar e trazer a conversa"}
                      </button>
                      <button
                        onClick={() => setCriando(null)}
                        disabled={ocupado}
                        className="px-3 h-10 rounded-lg text-[13px] font-medium disabled:opacity-50"
                        style={{ color: "var(--ink2)", border: "1px solid var(--line)" }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
