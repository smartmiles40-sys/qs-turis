// src/components/sdr/agenda/BriefingDoLead.tsx
// -----------------------------------------------------------------------------
// O RESUMO DO TRABALHO DO SDR, na tela do closer.
//
// A reclamação que originou isto (Bruno, 18/08): o closer entra na reunião sem
// contexto e pergunta ao cliente o que o SDR já perguntou. O que o SDR construiu
// — notas, classificações de ligação, temperatura, fonte — existia no banco e o
// closer não via, porque a RLS amarra essas tabelas ao dono do lead.
//
// Os dados vêm de /api/wa-sync?briefing=1: o SERVIDOR valida o papel (closer é
// liberado no assertCanAccessLead) e lê com a chave de serviço — funciona hoje,
// sem depender de migration de RLS.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/qs/waInbox";

interface Briefing {
  lead: {
    nome: string | null; telefone: string | null; email: string | null;
    fonte: string | null; temperatura: string | null; status: string | null;
    dono: string | null; papelDono: string | null;
  };
  notas: { body: string; tags: string[] | null; created_at: string }[];
  tarefas: { channel_type: string | null; contact_result: string | null; completed_at: string | null; notes: string | null }[];
  reunioes: { title: string | null; scheduled_at: string; status: string; meeting_owner: string | null; sal: string | null }[];
  conversa?: { texto: string; deQuem: "nos" | "cliente"; quando: string }[];
}

const RESULTADO: Record<string, string> = {
  atendeu: "atendeu", nao_atendeu: "não atendeu", caixa_postal: "caixa postal",
  numero_errado: "número errado", desligou: "desligou", ganho: "ganhou",
  com_avanco: "ligação com avanço", sem_avanco: "ligação sem avanço",
  gatekeeper: "falou com intermediário", persona_indisponivel: "decisor indisponível",
  telefone_incorreto: "telefone incorreto", sem_conexao: "sem conexão",
};

function quando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
    " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export default function BriefingDoLead({ leadId }: { leadId: string }) {
  const [dados, setDados] = useState<Briefing | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(true);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    (async () => {
      try {
        const r = await fetch(`/api/wa-sync?leadId=${encodeURIComponent(leadId)}&briefing=1`, {
          headers: await authHeaders(),
        });
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok) { setErro(d?.error || "Não consegui carregar o resumo."); return; }
        setDados(d as Briefing);
      } catch {
        if (vivo) setErro("Sem conexão.");
      }
    })();
    return () => { vivo = false; };
  }, [leadId]);

  if (erro) return <p className="text-xs text-gray-400">{erro}</p>;
  if (!dados) return <p className="text-xs text-gray-400">Carregando o resumo do atendimento…</p>;

  const { lead, notas, tarefas, reunioes } = dados;
  // Notas que CONTAM algo. "Ligação — Caixa postal" é eco do histórico de
  // contatos logo abaixo: repetida aqui, empurrava a nota útil pra fora do
  // corte de 4 e o closer via um resumo que não resumia nada.
  const notasHumanas = notas.filter(
    (n) => !(n.tags || []).includes("origem") &&
      !/^(ligação|liga[çc]ao|whatsapp|e-?mail)\s*[—–-]\s*(caixa postal|não atendeu|nao atendeu|desligou|sem conex|número|numero)/i.test(n.body.trim())
  );
  const ligacoes = tarefas.filter((t) => t.contact_result);
  const conversa = dados.conversa ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
          Resumo do atendimento{lead.dono ? ` · com ${lead.dono}` : ""}
        </span>
        <span className="text-gray-400 text-xs">{aberto ? "esconder" : "mostrar"}</span>
      </button>

      {aberto && (
        <div className="px-3.5 pb-3.5 space-y-3 text-sm">
          {/* A ficha: o que se sabe do cliente num relance. */}
          <div className="flex flex-wrap gap-1.5">
            {lead.temperatura && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{
                      background: /quente|hot/i.test(lead.temperatura) ? "#FEF2F2" : /morno|warm/i.test(lead.temperatura) ? "#FFFBEB" : "#EFF6FF",
                      color: /quente|hot/i.test(lead.temperatura) ? "#B91C1C" : /morno|warm/i.test(lead.temperatura) ? "#92400E" : "#1D4ED8",
                    }}>
                {lead.temperatura}
              </span>
            )}
            {lead.fonte && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                {lead.fonte}
              </span>
            )}
            {lead.telefone && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 tabular-nums">
                {lead.telefone}
              </span>
            )}
          </div>

          {/* O que o SDR anotou — é a resposta de "o que já foi conversado?". */}
          {notasHumanas.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-gray-400">O que o SDR anotou</p>
              {notasHumanas.slice(0, 4).map((n, i) => (
                <div key={i} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                  <p className="text-[12.5px] text-gray-700 whitespace-pre-line">
                    {n.body.length > 280 ? n.body.slice(0, 280) + "…" : n.body}
                  </p>
                  <p className="text-[10.5px] text-gray-400 mt-0.5">{quando(n.created_at)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">O SDR não deixou notas neste lead.</p>
          )}

          {/* O QUE FOI FALADO. É a resposta literal do pedido: o closer lê a
              conversa que o SDR teve e não repete a mesma entrevista. */}
          {conversa.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1">
                A conversa no WhatsApp · últimas {Math.min(conversa.length, 12)}
              </p>
              <div className="max-h-52 overflow-y-auto rounded-lg bg-gray-50 p-2 space-y-1">
                {conversa.slice(-12).map((m, i) => (
                  <p key={i} className="text-[12px] leading-snug">
                    <span className={m.deQuem === "cliente" ? "font-bold text-gray-900" : "font-semibold text-gray-400"}>
                      {m.deQuem === "cliente" ? "Cliente" : "Nós"}:{" "}
                    </span>
                    <span className={m.deQuem === "cliente" ? "text-gray-800" : "text-gray-500"}>
                      {m.texto.length > 220 ? m.texto.slice(0, 220) + "…" : m.texto}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* As tentativas de contato e como terminaram. */}
          {ligacoes.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1">Contatos do SDR</p>
              <div className="flex flex-wrap gap-1">
                {ligacoes.slice(0, 6).map((t, i) => (
                  <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] text-gray-600">
                    {quando(t.completed_at)} · {RESULTADO[t.contact_result!] ?? t.contact_result}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Reuniões anteriores (remarcações, no-show antigo…) contam história. */}
          {reunioes.length > 1 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 mb-1">Reuniões deste cliente</p>
              {reunioes.slice(0, 3).map((r, i) => (
                <p key={i} className="text-[12px] text-gray-600">
                  {quando(r.scheduled_at)} · {r.status}{r.title ? ` · ${r.title}` : ""}{r.sal ? ` · SAL ${r.sal}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
