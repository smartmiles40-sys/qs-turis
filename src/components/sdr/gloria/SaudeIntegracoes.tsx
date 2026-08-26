// src/components/sdr/gloria/SaudeIntegracoes.tsx
// -----------------------------------------------------------------------------
// AS PORTAS DA GLÓRIA.
//
// Ela depende de cinco coisas que moram fora do QS: o n8n que pensa, o n8n que
// marca no Google, a OpenAI que ouve áudio, o Chatwoot que fala com a Meta e o
// Bitrix que recebe a reunião. Quando uma delas fecha, o sintoma é sempre o
// mesmo — "a Glória não fez nada" — e a causa é sempre diferente.
//
// Entre 21 e 26 de agosto isso custou cinco dias, três vezes, sempre por uma
// credencial com o campo errado. Em nenhuma das três a informação faltava: ela
// só não tinha onde aparecer. Esta tela é o onde.
//
// A LISTA CARREGA SOZINHA (o que dá pra saber de graça: variável configurada,
// última rodada da fila, últimos erros dela). BATER NA PORTA é botão, porque
// bater tem custo: cada teste cria execução no n8n e consome API do Chatwoot.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { authHeaders } from "@/lib/qs/waInbox";
import { useQsAuth } from "@/contexts/QsAuthContext";

interface Porta {
  nome: string;
  estado: "ok" | "atencao" | "erro";
  resumo: string;
  /** O que fazer. Só aparece quando existe algo pra fazer. */
  conserto?: string;
}

interface Tropeco {
  lead_id: string | null;
  motivo: string | null;
  conteudo: string | null;
  criado_em: string;
}

interface Retrato {
  fila?: { rodadaEm: string | null; paradoHaMs: number | null; ultimo: unknown } | null;
  variaveis?: Record<string, boolean>;
  primeiroContato?: { modelo: string | null; teto: number | null; hoje: number | null };
  tropecos?: Tropeco[];
}

const CORES: Record<Porta["estado"], { bg: string; ponto: string; texto: string }> = {
  ok: { bg: "#F0FDF4", ponto: "#16A34A", texto: "#166534" },
  atencao: { bg: "#FFFBEB", ponto: "#D97706", texto: "#92400E" },
  erro: { bg: "#FEF2F2", ponto: "#DC2626", texto: "#B4242A" },
};

/**
 * As variáveis que precisam existir na Vercel, com o que quebra sem cada uma.
 * A frase é o ponto: "OPENAI_API_KEY ausente" não diz nada pra quem não escreveu
 * o código; "ela não consegue ouvir áudio" diz.
 */
const O_QUE_QUEBRA: Record<string, string> = {
  GLORIA_WEBHOOK_URL: "sem isto ela não pensa: nenhuma resposta é gerada",
  GLORIA_SECRET: "sem isto o n8n recusa tudo com 403",
  N8N_AGENDA_URL: "sem isto a reunião é marcada, mas sem link do Meet",
  N8N_AGENDA_SECRET: "sem isto a agenda recusa com 403",
  OPENAI_API_KEY: "sem isto áudio do cliente entra sem transcrição e ela não responde",
  BITRIX_WEBHOOK_BASE: "sem isto a reunião não vira atividade no card do Bitrix",
  CHATWOOT_API_TOKEN: "sem isto nada sai no WhatsApp",
};

function haQuantoTempo(ms: number | null): string {
  if (ms == null) return "nunca rodou";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`;
}

export default function SaudeIntegracoes({ onRetrato }: { onRetrato?: (r: Retrato) => void }) {
  // Bater na porta cria execucao no n8n e consome API do Chatwoot, entao a
  // rota so aceita gestor/admin. O retrato (GET) todo mundo ve: saber que a
  // cadencia dela parou e informacao operacional, nao privilegio.
  const { currentUser } = useQsAuth();
  const podeTestar = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [retrato, setRetrato] = useState<Retrato | null>(null);
  const [portas, setPortas] = useState<Porta[] | null>(null);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/gloria-saude", { headers: await authHeaders() });
      if (!r.ok) return;
      const d = (await r.json()) as Retrato;
      setRetrato(d);
      onRetrato?.(d);
    } catch { /* painel que quebra a tela não serve */ }
  }, [onRetrato]);

  useEffect(() => { void carregar(); }, [carregar]);

  const testar = useCallback(async () => {
    setTestando(true);
    setErro(null);
    try {
      const r = await fetch("/api/gloria-saude", { method: "POST", headers: await authHeaders() });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d?.error || "Não consegui testar."); return; }
      setPortas((d?.portas ?? []) as Porta[]);
      setAberto(true);
    } catch {
      setErro("Sem conexão.");
    } finally {
      setTestando(false);
    }
  }, []);

  const faltando = Object.entries(retrato?.variaveis ?? {}).filter(([, posto]) => !posto);
  const filaParada = (retrato?.fila?.paradoHaMs ?? 0) > 30 * 60_000;
  // O resumo do topo tem que ser lido de relance: ou tem coisa pra fazer, ou não tem.
  const temProblema = faltando.length > 0 || filaParada || (portas ?? []).some((p) => p.estado === "erro");

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-900 flex items-center gap-2">
            As portas dela
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: temProblema ? "#DC2626" : "#16A34A" }}
            />
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5 max-w-2xl">
            {temProblema
              ? "Tem coisa pra arrumar aqui embaixo — enquanto estiver assim, ela vai falhar em silêncio."
              : podeTestar
                ? "Tudo que ela depende está configurado. Clique em Testar pra bater em cada porta de verdade."
                : "Tudo que ela depende está configurado."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setAberto((v) => !v)}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {aberto ? "Fechar" : "Detalhes"}
          </button>
          {podeTestar && (
            <button
              onClick={() => void testar()}
              disabled={testando}
              className="text-[12px] font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ background: "#0147FF" }}
            >
              {testando ? "Batendo nas portas..." : "Testar agora"}
            </button>
          )}
        </div>
      </div>

      {/* A fila de toques: é a única peça que morre CALADA. Fica sempre visível. */}
      <div className="mt-3 flex items-center flex-wrap gap-3 text-[13px] text-gray-600">
        <span>
          Cadência dela rodou{" "}
          <strong className={filaParada ? "text-[#B4242A]" : "text-gray-900"}>
            {haQuantoTempo(retrato?.fila?.paradoHaMs ?? null)}
          </strong>
        </span>
        {filaParada && (
          <span className="text-[12px] text-gray-500">
            — parada assim, quem sumiu no meio da conversa não recebe follow-up
          </span>
        )}
      </div>

      {erro && (
        <p className="mt-3 text-[12px]" style={{ color: "var(--err-ink)" }}>{erro}</p>
      )}

      {aberto && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
          {/* ── O resultado do teste ──────────────────────────────────────── */}
          {portas && (
            <div className="space-y-2">
              {portas.map((p) => {
                const c = CORES[p.estado] ?? CORES.atencao;
                return (
                  <div key={p.nome} className="rounded-lg px-3 py-2.5" style={{ background: c.bg }}>
                    <div className="flex items-start gap-2">
                      <span className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: c.ponto }} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold" style={{ color: c.texto }}>{p.nome}</p>
                        <p className="text-[12px] text-gray-700 mt-0.5">{p.resumo}</p>
                        {p.conserto && (
                          <p className="text-[12px] text-gray-600 mt-1.5 border-l-2 pl-2" style={{ borderColor: c.ponto }}>
                            {p.conserto}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── As variáveis que faltam ───────────────────────────────────── */}
          {faltando.length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-gray-700 mb-1.5">
                Faltando na Vercel ({faltando.length})
              </p>
              <ul className="space-y-1">
                {faltando.map(([nome]) => (
                  <li key={nome} className="text-[12px] text-gray-600">
                    <span className="font-mono text-gray-800">{nome}</span> — {O_QUE_QUEBRA[nome] ?? "não configurada"}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500 mt-2">
                Vercel → Settings → Environment Variables. Depois de salvar é preciso{" "}
                <strong>Redeploy</strong>: variável nova não vale pro deploy que já está no ar.
              </p>
            </div>
          )}

          {/* ── Os últimos tropeços dela ──────────────────────────────────── */}
          {(retrato?.tropecos ?? []).length > 0 && (
            <div>
              <p className="text-[12px] font-semibold text-gray-700 mb-1.5">Os últimos erros que ela registrou</p>
              <ul className="space-y-1">
                {(retrato?.tropecos ?? []).map((t, i) => (
                  <li key={i} className="text-[12px] text-gray-600">
                    <span className="text-gray-400">
                      {new Date(t.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>{" "}
                    — {t.motivo ?? "erro"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
