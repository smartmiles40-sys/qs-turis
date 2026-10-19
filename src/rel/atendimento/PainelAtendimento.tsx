// src/rel/atendimento/PainelAtendimento.tsx
// -----------------------------------------------------------------------------
// PAINEL DO ATENDIMENTO (Bruno, 19/10/2026 — migration 0145). Fica à direita
// da conversa e TODO MUNDO vê o mesmo (sem distribuição automática):
//   • quem está atendendo o cliente (assumir / passar pra outra pessoa);
//   • o atendimento aberto: há quanto tempo, a 1ª resposta (dentro ou fora do
//     prazo) e quantas vezes foi reaberto;
//   • CONCLUIR (com motivo) / REABRIR;
//   • o histórico dos atendimentos desse cliente: quem atendeu, em quanto
//     tempo respondeu e resolveu, o motivo e a nota da pesquisa.
// Tempos de resposta e solução contam só o horário de atendimento (úteis).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  MOTIVOS_CONCLUSAO, assumirConversa, atendimentosDaConversa, concluirConversa, duracao, passarConversa, reabrirConversa, rotuloMotivo,
  type Atendimento, type Conversa, type MotivoConclusao,
} from "../lib/whatsapp";
import { equipeRelacionamento } from "../lib/pos";
import { Aviso, Botao, Modal } from "../ui";
import { AvatarWa } from "./waUi";

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const minutosDesde = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const primeiro = (nome: string | null | undefined) => (nome || "").trim().split(/\s+/)[0] || "—";

// ── Concluir (motivo obrigatório) ───────────────────────────────────────────

export function ConcluirModal({ conversa, onFechar, onFeito }: {
  conversa: Conversa | null; onFechar: () => void; onFeito: (pesquisa: boolean) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoConclusao | null>(null);
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (conversa) { setMotivo(null); setNota(""); setErro(null); } }, [conversa]);
  if (!conversa) return null;

  // Última mensagem é do cliente e ninguém respondeu: avisa antes.
  const semResposta = !!conversa.aguardando_desde && !conversa.sem_sla;

  async function salvar() {
    if (!conversa || !motivo) { setErro("Escolha o motivo."); return; }
    if (motivo === "outro" && !nota.trim()) { setErro('Em "Outro", escreva o motivo.'); return; }
    setSalvando(true); setErro(null);
    try { const r = await concluirConversa(conversa.id, motivo, nota); onFeito(!!r.pedir_nota); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não concluiu."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo="Concluir o atendimento" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar} disabled={salvando}>Cancelar</Botao>
        <Botao variante="primario" onClick={() => void salvar()} disabled={salvando || !motivo}>{salvando ? "Concluindo…" : "Concluir"}</Botao></>}>
      <div className="space-y-3 text-[14px]" style={{ color: "var(--ink2)" }}>
        {semResposta && (
          <Aviso tom="erro">O cliente escreveu e <b>ainda ninguém respondeu</b>. Tem certeza que dá pra concluir sem responder?</Aviso>
        )}
        <p>Por que este atendimento terminou?</p>
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Motivo">
          {MOTIVOS_CONCLUSAO.map((m) => (
            <button key={m.id} role="radio" aria-checked={motivo === m.id} onClick={() => setMotivo(m.id)}
              className="rounded-lg px-3 py-2 text-left border"
              style={motivo === m.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
              <span className="block text-[13px] font-semibold">{m.rotulo}</span>
              <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{m.dica}</span>
            </button>
          ))}
        </div>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={500}
          placeholder={motivo === "outro" ? "Escreva o motivo (obrigatório)" : "Observação (opcional)"} aria-label="Observação"
          className="w-full rounded-lg border px-3 py-2 text-[14px]" style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink)" }} />
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          Se o cliente escrever de novo logo depois, o atendimento reabre sozinho e conta como reaberto.
        </p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Painel ──────────────────────────────────────────────────────────────────

export default function PainelAtendimento({ c, meuId, onMudou, onConcluir, onFechar }: {
  c: Conversa; meuId: string; onMudou: () => void; onConcluir: () => void; onFechar: () => void;
}) {
  const [historico, setHistorico] = useState<Atendimento[] | null>(null);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    equipeRelacionamento().then(setEquipe).catch(() => undefined);
    supabase.from("qs_users").select("id, name").then(({ data }) =>
      setNomes(new Map(((data ?? []) as { id: string; name: string }[]).map((u) => [u.id, u.name]))));
  }, []);
  useEffect(() => {
    let vivo = true;
    atendimentosDaConversa(c.id).then((h) => { if (vivo) setHistorico(h); }).catch(() => { if (vivo) setHistorico([]); });
    return () => { vivo = false; };
  }, [c.id, c.estado, c.atend_id, c.atend_reaberturas, c.atendente_id, c.atend_primeira_resposta_em]);

  async function acao(fn: () => Promise<unknown>) {
    setErro(null); setOcupado(true);
    try { await fn(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  const concluida = c.estado === "resolvida";
  const minha = c.atendente_id === meuId;
  const nomeDe = (id: string | null) => (id ? nomes.get(id) || equipe.find((e) => e.id === id)?.name || "—" : null);
  const ultimo = historico?.find((h) => h.concluido_em) ?? null;

  return (
    <div className="flex flex-col h-full min-h-0 wa-lista" aria-label="Atendimento">
      <header className="wa-cab h-[60px] flex items-center gap-2 px-4 flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        <span className="flex-1 text-[16px]" style={{ color: "var(--wa-txt)" }}>Atendimento</span>
        <button onClick={onFechar} className="wa-icone w-9 h-9 inline-flex items-center justify-center" aria-label="Fechar o painel" title="Fechar o painel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Quem está atendendo */}
        <section className="px-4 py-4" style={{ borderBottom: "8px solid var(--wa-head)" }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--wa-meta)" }}>Quem está atendendo</h3>
          <div className="flex items-center gap-3">
            {c.atendente_nome
              ? <AvatarWa nome={c.atendente_nome} tamanho={44} />
              : <span className="w-11 h-11 rounded-full inline-flex items-center justify-center text-[20px]" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }} aria-hidden>?</span>}
            <span className="flex-1 min-w-0">
              <span className="block text-[16px] truncate" style={{ color: "var(--wa-txt)", fontWeight: 600 }}>
                {c.atendente_nome || "Ninguém ainda"}{minha && " (você)"}
              </span>
              <span className="block text-[12.5px]" style={{ color: "var(--wa-meta)" }}>
                {c.atendente_nome ? "responsável por este cliente" : "quem responder primeiro vira o responsável"}
              </span>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {!minha && (
              <button disabled={ocupado} onClick={() => void acao(() => assumirConversa(c.id, meuId))}
                className="h-8 px-3 rounded-full text-[13px] font-semibold wa-verde disabled:opacity-60">
                {c.atendente_id ? "Assumir pra mim" : "Assumir"}
              </button>
            )}
            <label className="sr-only" htmlFor={`passar-${c.id}`}>Passar para</label>
            <select id={`passar-${c.id}`} value="" disabled={ocupado}
              onChange={(e) => { const v = e.target.value; if (v) void acao(() => passarConversa(c.id, v === "ninguem" ? null : v)); }}
              className="h-8 px-2 rounded-full text-[13px] border" style={{ borderColor: "var(--wa-line)", background: "var(--wa-list)", color: "var(--wa-txt)" }}>
              <option value="">Passar para…</option>
              {equipe.filter((u) => u.id !== c.atendente_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              {c.atendente_id && <option value="ninguem">Ninguém (tirar responsável)</option>}
            </select>
          </div>
        </section>

        {/* Atendimento de agora */}
        <section className="px-4 py-4 space-y-2" style={{ borderBottom: "8px solid var(--wa-head)" }}>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--wa-meta)" }}>Agora</h3>
          {c.sem_sla ? (
            <p className="text-[13.5px]" style={{ color: "var(--wa-meta)" }}>Esta conversa <b>não conta no prazo</b> (grupo, fornecedor, equipe…) — não tem atendimento medido.</p>
          ) : concluida ? (
            <>
              <p className="flex items-center gap-2 text-[14px]" style={{ color: "var(--wa-txt)" }}>
                <span className="inline-flex h-6 px-2 rounded-full items-center text-[12px] font-semibold" style={{ background: "#D9FDD3", color: "#008069" }}>✓ Concluído</span>
                {ultimo?.concluido_em && <span className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>{dataHora(ultimo.concluido_em)}</span>}
              </p>
              {ultimo && (
                <p className="text-[13px]" style={{ color: "var(--wa-meta)" }}>
                  {rotuloMotivo(ultimo.motivo)}{ultimo.automatico ? " (automático)" : ultimo.concluido_por ? ` · por ${primeiro(nomeDe(ultimo.concluido_por))}` : ""}
                  {ultimo.min_solucao != null && ultimo.origem === "cliente" && <> · resolvido em <b>{duracao(ultimo.min_solucao)}</b> úteis</>}
                </p>
              )}
              <button disabled={ocupado} onClick={() => void acao(() => reabrirConversa(c.id))}
                className="h-9 px-4 rounded-full text-[13.5px] font-semibold border disabled:opacity-60" style={{ borderColor: "var(--wa-line)", color: "var(--wa-txt)" }}>
                Reabrir
              </button>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[14px]" style={{ color: "var(--wa-txt)" }}>
                <span className="inline-flex h-6 px-2 rounded-full items-center text-[12px] font-semibold" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>Em aberto</span>
                {c.atend_aberto_em && <span className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>há {duracao(minutosDesde(c.atend_aberto_em))}</span>}
              </p>
              <dl className="text-[13px] space-y-1" style={{ color: "var(--wa-meta)" }}>
                <div className="flex justify-between gap-2">
                  <dt>1ª resposta</dt>
                  <dd style={{ color: "var(--wa-txt)" }}>
                    {c.atend_min_primeira_resposta != null
                      ? <span style={{ color: c.atend_min_primeira_resposta > c.meta_min ? "var(--err-ink)" : "var(--wa-green-ink)", fontWeight: 600 }}>
                          {duracao(c.atend_min_primeira_resposta)} {c.atend_min_primeira_resposta > c.meta_min ? "· fora do prazo" : "· no prazo"}
                        </span>
                      : c.atend_primeira_resposta_em ? "respondido"
                      : c.aguardando_desde ? <span style={{ color: c.minutos_esperando > c.meta_min ? "var(--err-ink)" : "var(--warn-ink)", fontWeight: 600 }}>esperando há {duracao(c.minutos_esperando)}</span>
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2"><dt>Prazo de resposta</dt><dd style={{ color: "var(--wa-txt)" }}>{duracao(c.meta_min)} úteis</dd></div>
                {(c.atend_reaberturas ?? 0) > 0 && (
                  <div className="flex justify-between gap-2"><dt>Reaberto</dt><dd style={{ color: "var(--err-ink)", fontWeight: 600 }}>{c.atend_reaberturas}×</dd></div>
                )}
              </dl>
              <button disabled={ocupado} onClick={onConcluir}
                className="w-full h-10 rounded-full text-[14px] font-semibold wa-verde disabled:opacity-60" title="Concluir (Ctrl+Alt+Shift+R)">
                Concluir atendimento
              </button>
            </>
          )}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </section>

        {/* Histórico */}
        <section className="px-4 py-4">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--wa-meta)" }}>Histórico deste cliente</h3>
          {historico === null && <div className="h-14 rounded-lg animate-pulse" style={{ background: "var(--wa-head)" }} />}
          {historico && historico.length === 0 && <p className="text-[13px]" style={{ color: "var(--wa-meta)" }}>Nenhum atendimento ainda.</p>}
          <ol className="space-y-2">
            {historico?.map((h) => (
              <li key={h.id} className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--wa-head)", color: "var(--wa-meta)" }}>
                <div className="flex items-baseline justify-between gap-2">
                  <span style={{ color: "var(--wa-txt)", fontWeight: 600 }}>{dataHora(h.aberto_em)}</span>
                  <span>{h.concluido_em ? rotuloMotivo(h.motivo) : <b style={{ color: "var(--warn-ink)" }}>em aberto</b>}</span>
                </div>
                <div className="mt-0.5">
                  {primeiro(nomeDe(h.atendente_id)) !== "—" ? primeiro(nomeDe(h.atendente_id)) : "sem responsável"}
                  {h.min_primeira_resposta != null && <> · respondeu em <b style={{ color: h.min_primeira_resposta > h.meta_min ? "var(--err-ink)" : "var(--wa-txt)" }}>{duracao(h.min_primeira_resposta)}</b></>}
                  {h.min_solucao != null && h.origem === "cliente" && !h.automatico && <> · resolveu em <b style={{ color: "var(--wa-txt)" }}>{duracao(h.min_solucao)}</b></>}
                  {h.reaberturas > 0 && <> · reaberto {h.reaberturas}×</>}
                  {h.automatico && <> · concluído sozinho</>}
                  {h.csat_nota != null && <> · nota <b style={{ color: "var(--wa-txt)" }}>{h.csat_nota}/5</b></>}
                </div>
                {h.nota && <div className="mt-0.5 italic">“{h.nota}”</div>}
              </li>
            ))}
          </ol>
          <p className="text-[11.5px] mt-3" style={{ color: "var(--wa-meta)" }}>Tempos contados só no horário de atendimento.</p>
        </section>
      </div>
    </div>
  );
}
