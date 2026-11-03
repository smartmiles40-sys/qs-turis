// src/components/sdr/leads/ficha/PassagemDoSdr.tsx
// -----------------------------------------------------------------------------
// "PASSAGEM DO SDR" na ficha do closer (desenho de 03/11): o que o SDR já
// descobriu, pra o closer não refazer a entrevista. Tudo de dado real:
//   · Interesse = Fonte/Produto do lead (lead.segment);
//   · as respostas do formulário da LP (com quem viaja, quando… — as perguntas
//     que o Bitrix tiver), via /api/lead-formulario (o mesmo cache da ficha);
//   · o resumo = a nota mais recente que conta algo (sem o eco "Ligação — Caixa
//     postal"), e as tentativas de contato, via /api/wa-sync?briefing=1 — o
//     servidor libera o closer a ler o que a RLS amarra ao SDR (BriefingDoLead).
// "Objeções" não existe como campo no QS: não aparece (nada inventado).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/qs/waInbox";
import { carregarRespostasDoFormulario, respostasEmCache, type RespostaFormulario } from "@/lib/qs/formulario";
import { notaHumana, quandoCurto } from "./regras";

interface Briefing {
  lead: { dono: string | null; papelDono: string | null };
  notas: { body: string; tags: string[] | null; created_at: string }[];
  tarefas: { channel_type: string | null; contact_result: string | null; completed_at: string | null }[];
  conversa?: { texto: string; deQuem: "nos" | "cliente"; quando: string }[];
}

const RESULTADO: Record<string, string> = {
  atendeu: "atendeu", nao_atendeu: "não atendeu", caixa_postal: "caixa postal", numero_errado: "número errado",
  desligou: "desligou", ganho: "ganhou", com_avanco: "com avanço", sem_avanco: "sem avanço",
  gatekeeper: "intermediário", persona_indisponivel: "decisor indisponível", telefone_incorreto: "telefone incorreto",
  sem_conexao: "sem conexão", sem_interesse: "sem interesse", concluida: "concluída",
};

export default function PassagemDoSdr({ leadId, interesse, agendadoPor }: {
  leadId: string; interesse: string | null; agendadoPor: string | null;
}) {
  const [b, setB] = useState<Briefing | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState<RespostaFormulario[]>(() => respostasEmCache(leadId)?.respostas ?? []);

  useEffect(() => {
    let vivo = true;
    setB(null); setErro(null);
    void carregarRespostasDoFormulario(leadId).then((r) => { if (vivo) setForm(r.respostas); });
    (async () => {
      try {
        const r = await fetch(`/api/wa-sync?leadId=${encodeURIComponent(leadId)}&briefing=1`, { headers: await authHeaders() });
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) { setErro(d?.error || "Não consegui carregar o que o SDR registrou."); return; }
        setB(d as Briefing);
      } catch { if (vivo) setErro("Sem conexão pra carregar o que o SDR registrou."); }
    })();
    return () => { vivo = false; };
  }, [leadId]);

  const agora = new Date();
  const notas = (b?.notas ?? []).filter(notaHumana);
  const contatos = (b?.tarefas ?? []).filter((t) => t.contact_result);
  const conversa = b?.conversa ?? [];
  const por = agendadoPor || (b?.lead.papelDono === "sdr" ? b.lead.dono : null);

  return (
    <section className="fl-card" aria-label="Passagem do SDR">
      <div className="fl-card__topo">
        <h2>Passagem do SDR</h2>
        {por && <span className="fl-card__meta">por {por}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="fl-linha"><span>Interesse</span><span>{interesse || "—"}</span></div>
        {form.map((r) => (
          <div key={r.campo} className="fl-linha"><span>{r.rotulo}</span><span>{r.valor}</span></div>
        ))}
      </div>
      {erro ? <p className="fl-mudo">{erro}</p>
        : !b ? <p className="fl-mudo">Carregando o que o SDR registrou…</p>
        : notas.length === 0 ? <p className="fl-mudo">O SDR não deixou anotação neste lead.</p>
        : (
          <>
            <p className="fl-caixa" style={{ whiteSpace: "pre-wrap" }}>
              {notas[0].body.length > 400 ? notas[0].body.slice(0, 400) + "…" : notas[0].body}
              <span className="fl-card__meta" style={{ display: "block", marginTop: 6 }}>{quandoCurto(notas[0].created_at, agora)}</span>
            </p>
            {notas.length > 1 && (
              <details>
                <summary className="fl-btn fl-btn--link" style={{ display: "inline-flex", listStyle: "none" }}>
                  Mais {notas.length - 1} anotação(ões) do SDR
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                  {notas.slice(1, 6).map((n, i) => (
                    <p key={i} className="fl-caixa" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                      {n.body.length > 280 ? n.body.slice(0, 280) + "…" : n.body}
                      <span className="fl-card__meta" style={{ display: "block", marginTop: 4 }}>{quandoCurto(n.created_at, agora)}</span>
                    </p>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      {contatos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="fl-rotulo">Contatos do SDR</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {contatos.slice(0, 6).map((t, i) => (
              <span key={i} className="fl-selo">
                {t.completed_at ? quandoCurto(t.completed_at, agora) + " · " : ""}{RESULTADO[t.contact_result!] ?? t.contact_result}
              </span>
            ))}
          </div>
        </div>
      )}
      {conversa.length > 0 && (
        <details>
          <summary className="fl-btn fl-btn--link" style={{ display: "inline-flex", listStyle: "none" }}>
            Ver a conversa no WhatsApp (últimas {Math.min(conversa.length, 12)})
          </summary>
          <div className="fl-caixa" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {conversa.slice(-12).map((m, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13 }}>
                <strong style={{ color: m.deQuem === "cliente" ? "var(--text)" : "var(--muted)" }}>{m.deQuem === "cliente" ? "Cliente" : "Nós"}: </strong>
                <span style={{ color: m.deQuem === "cliente" ? "var(--text)" : "var(--muted)" }}>{m.texto.length > 220 ? m.texto.slice(0, 220) + "…" : m.texto}</span>
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
