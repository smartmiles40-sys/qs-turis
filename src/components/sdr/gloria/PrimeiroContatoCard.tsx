// src/components/sdr/gloria/PrimeiroContatoCard.tsx
// -----------------------------------------------------------------------------
// PRIMEIRO CONTATO — a Glória falando antes do cliente.
//
// Duas decisões moram aqui, e as duas são do Bruno, não do código:
//
//   1. QUAL MODELO APROVADO ela usa pra puxar assunto. Sem modelo, ela só
//      responde quem escreveu primeiro — o que basta pra quem vem do WhatsApp e
//      não serve pra tráfego, onde quase todo mundo vem de formulário.
//   2. QUANTOS por dia, no máximo. Cada conversa iniciada por modelo é cobrada
//      pela Meta, e uma campanha que escala de madrugada não pede licença.
//
// O TETO NÃO PERDE LEAD. Quem passa do teto fica no quadro esperando; a
// abordagem sai no dia seguinte ou na mão, pelo botão do card.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { useQsAuth } from "@/contexts/QsAuthContext";

const CHAVE_TEMPLATE = "gloria_template_abertura";
const CHAVE_TETO = "gloria_teto_dia";

/**
 * Os apelidos que `montarParams` (api/_abordagem.js) sabe traduzir. Esta lista
 * PRECISA bater com a de lá: apelido que só existe aqui vira erro na hora do
 * envio, e apelido que só existe lá ninguém consegue escolher.
 */
const APELIDOS: { valor: string; label: string; ajuda: string }[] = [
  { valor: "{{primeiro_nome}}", label: "Primeiro nome", ajuda: "Bruno" },
  { valor: "{{nome}}", label: "Nome completo", ajuda: "Bruno Oliveira" },
  { valor: "{{expedicao}}", label: "Expedição/fonte do lead", ajuda: "o que veio no campo Fonte" },
  { valor: "{{empresa}}", label: "Nome da agência", ajuda: "Se Tu For, Eu Vou" },
];

interface ModeloSalvo {
  nome: string;
  idioma?: string;
  params?: Record<string, string>;
}

export default function PrimeiroContatoCard({
  hojeAbordados,
  onMudou,
}: {
  /** Quantos primeiros contatos já saíram hoje (vem de /api/gloria-saude). */
  hojeAbordados: number | null;
  onMudou?: () => void;
}) {
  // qs_settings so aceita escrita de gestor/admin (0011). Quem nao pode
  // gravar ve o resumo — que e a parte util pra todo mundo: com que modelo
  // ela puxa assunto e quanto ja saiu hoje — sem o botao que daria erro.
  const { currentUser } = useQsAuth();
  const podeMexer = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [modelos, setModelos] = useState<WaModeloAdmin[]>([]);
  const [carregandoModelos, setCarregandoModelos] = useState(true);
  const [erroModelos, setErroModelos] = useState<string | null>(null);

  const [salvo, setSalvo] = useState<ModeloSalvo | null>(null);
  const [teto, setTeto] = useState<number>(30);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  // O rascunho é separado do salvo: mexer no seletor não pode mudar o que a
  // Glória está usando AGORA. Só o botão Salvar faz isso.
  const [rascunho, setRascunho] = useState<ModeloSalvo | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("qs_settings").select("key, value").in("key", [CHAVE_TEMPLATE, CHAVE_TETO]);
    const mapa = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    const m = (mapa[CHAVE_TEMPLATE] ?? null) as ModeloSalvo | null;
    setSalvo(m?.nome ? m : null);
    setRascunho(m?.nome ? m : null);
    const t = Number(mapa[CHAVE_TETO]);
    setTeto(Number.isFinite(t) ? t : 30);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const { modelos: ms, error } = await listarModelosAdmin();
      if (!vivo) return;
      // Só modelo aprovado e sem cabeçalho de mídia: o de mídia exige anexar um
      // arquivo em cada envio, o que a abordagem automática não tem como fazer.
      setModelos(ms.filter((m) => String(m.status || "").toLowerCase() === "approved" && !m.cabecalhoMidia));
      setErroModelos(error ?? null);
      setCarregandoModelos(false);
    })();
    return () => { vivo = false; };
  }, []);

  const escolhido = modelos.find((m) => m.nome === rascunho?.nome) ?? null;

  const salvarTudo = useCallback(async () => {
    setSalvando(true);
    try {
      const linhas: { key: string; value: unknown }[] = [
        { key: CHAVE_TETO, value: Math.max(0, Math.floor(teto)) },
      ];
      linhas.push({
        key: CHAVE_TEMPLATE,
        value: rascunho?.nome
          ? { nome: rascunho.nome, idioma: rascunho.idioma ?? null, params: rascunho.params ?? {} }
          // {} e nao null: qs_settings.value e NOT NULL no banco.
          : {},
      });
      const { error } = await supabase.from("qs_settings").upsert(linhas, { onConflict: "key" });
      if (error) throw error;
      notifySuccess("Primeiro contato salvo.");
      await carregar();
      onMudou?.();
    } catch (e: unknown) {
      notifyError((e as { message?: string })?.message ?? "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }, [rascunho, teto, carregar, onMudou]);

  const noTeto = hojeAbordados != null && hojeAbordados >= teto && teto > 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 md:px-6 py-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-gray-900">Primeiro contato</p>
          <p className="text-[12px] text-gray-500 mt-0.5 max-w-2xl">
            Quem vem de formulário nunca escreveu no WhatsApp, então fora da janela de 24h só passa
            modelo aprovado pela Meta. É este modelo que permite a Glória puxar assunto sozinha —
            sem ele, ela só responde quem falar primeiro.
          </p>
        </div>
        {podeMexer && (
          <button
            onClick={() => setAberto((v) => !v)}
            className="shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            {aberto ? "Fechar" : "Configurar"}
          </button>
        )}
      </div>

      {/* O resumo de uma linha: é o que responde "posso subir a verba hoje?" */}
      <div className="mt-3 flex items-center flex-wrap gap-3 text-[13px]">
        {salvo?.nome ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold"
            style={{ background: "#E1F5F0", color: "#0F766E" }}>
            modelo: {salvo.nome}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold"
            style={{ background: "#FEF3C7", color: "#92400E" }}>
            sem modelo — ela não puxa assunto
          </span>
        )}
        <span className="text-gray-600">
          <strong className="text-gray-900">{hojeAbordados ?? "—"}</strong> de{" "}
          <strong className="text-gray-900">{teto}</strong> primeiros contatos hoje
        </span>
        {noTeto && (
          <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#FEF2F2", color: "#B4242A" }}>
            teto atingido
          </span>
        )}
      </div>

      {aberto && podeMexer && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
          {/* ── Teto ──────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">
              Máximo de primeiros contatos por dia
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="number"
                min={0}
                max={500}
                value={teto}
                onChange={(e) => setTeto(Number(e.target.value))}
                className="w-24 px-3 py-1.5 text-[13px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
              />
              <p className="text-[12px] text-gray-500 max-w-md">
                Vira zero à meia-noite de São Paulo. Em <strong>0</strong> ninguém é abordado —
                é o freio de mão pra parar a IA sem desligar ela das conversas que já estão de pé.
              </p>
            </div>
          </div>

          {/* ── Modelo ────────────────────────────────────────────────────── */}
          <div>
            <label className="block text-[12px] font-semibold text-gray-700 mb-1">
              Modelo aprovado da Meta
            </label>

            {carregandoModelos ? (
              <p className="text-[12px] text-gray-500">Carregando os modelos da conta...</p>
            ) : erroModelos ? (
              <p className="text-[12px]" style={{ color: "var(--err-ink)" }}>{erroModelos}</p>
            ) : modelos.length === 0 ? (
              <p className="text-[12px] text-gray-500">
                Nenhum modelo aprovado e sem mídia nesta conta. Crie um em Ajustes → Modelos da Meta
                e espere a aprovação (costuma sair em minutos, às vezes leva horas).
              </p>
            ) : (
              <select
                value={rascunho?.nome ?? ""}
                onChange={(e) => {
                  const m = modelos.find((x) => x.nome === e.target.value);
                  setRascunho(m ? { nome: m.nome, idioma: m.idioma, params: {} } : null);
                }}
                className="w-full max-w-lg px-3 py-1.5 text-[13px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
              >
                <option value="">— nenhum (ela não puxa assunto) —</option>
                {modelos.map((m) => (
                  <option key={`${m.nome}:${m.idioma}`} value={m.nome}>
                    {m.nome} ({m.idioma}) · {m.categoria}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── As variáveis do modelo ────────────────────────────────────── */}
          {escolhido && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-3">
              <p className="text-[12px] text-gray-600 whitespace-pre-wrap mb-3">{escolhido.corpo}</p>

              {escolhido.variaveis.length === 0 ? (
                <p className="text-[12px] text-gray-500">Este modelo não tem variáveis — sai igual pra todo mundo.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] font-semibold text-gray-700">O que entra em cada buraco</p>
                  {escolhido.variaveis.map((v) => (
                    <div key={v} className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-mono text-gray-500 w-14 shrink-0">{`{{${v}}}`}</span>
                      <select
                        value={rascunho?.params?.[v] ?? ""}
                        onChange={(e) =>
                          setRascunho((r) => (r ? { ...r, params: { ...(r.params ?? {}), [v]: e.target.value } } : r))
                        }
                        className="px-2.5 py-1 text-[12px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
                      >
                        <option value="">— escolha —</option>
                        {APELIDOS.map((a) => (
                          <option key={a.valor} value={a.valor}>{a.label} ({a.ajuda})</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="text-[11px] text-gray-500 pt-1">
                    Variável sem valor no lead <strong>cancela a abordagem</strong> em vez de mandar
                    o buraco vazio — a Meta recusa, e o cliente veria um texto quebrado.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void salvarTudo()}
              disabled={salvando}
              className="text-[12px] font-semibold px-4 py-1.5 rounded-lg text-white disabled:opacity-50"
              style={{ background: "#0147FF" }}
            >
              {salvando ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setRascunho(salvo); void carregar(); }}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
