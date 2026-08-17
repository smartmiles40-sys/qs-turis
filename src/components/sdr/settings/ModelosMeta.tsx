// src/components/sdr/settings/ModelosMeta.tsx
// -----------------------------------------------------------------------------
// PORTAL DE MODELOS DE MENSAGEM — o que hoje se faz entrando no Gerenciador do
// WhatsApp Business, feito aqui dentro.
//
// Modelo é o único jeito de falar com quem não respondeu nas últimas 24h. Quem
// escreve o texto é o comercial; quem aprova é a Meta, e a análise leva de
// minutos a alguns dias. Por isso a tela mostra o STATUS de cada um — inclusive
// os reprovados, com o motivo — e não só os que já dá pra usar.
//
// Só admin/gestor: o modelo vai pra análise em nome da empresa, e reprovação
// repetida derruba a qualidade do número inteiro.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  listarModelosAdmin, criarModeloNaMeta, excluirModeloNaMeta,
  type WaModeloAdmin, type NovoModelo,
} from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { confirmar } from "@/lib/qs/confirmar";

const VAZIO: NovoModelo = { nome: "", categoria: "UTILITY", idioma: "pt_BR", corpo: "", cabecalho: "", rodape: "" };

function selo(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return { texto: "Aprovado", cor: "#047857", fundo: "#ECFDF5" };
  if (s === "PENDING") return { texto: "Em análise", cor: "#92400E", fundo: "#FFFBEB" };
  if (s === "REJECTED") return { texto: "Reprovado", cor: "#B91C1C", fundo: "#FEF2F2" };
  if (s === "PAUSED") return { texto: "Pausado", cor: "#92400E", fundo: "#FFFBEB" };
  return { texto: s || "—", cor: "#475569", fundo: "#F1F5F9" };
}

export default function ModelosMeta() {
  const [modelos, setModelos] = useState<WaModeloAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<NovoModelo>(VAZIO);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await listarModelosAdmin();
    setModelos(r.modelos);
    setErro(r.error ?? null);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function enviar() {
    setSalvando(true);
    const r = await criarModeloNaMeta({ ...form, nome: form.nome.trim().toLowerCase().replace(/\s+/g, "_") });
    setSalvando(false);
    if (!r.ok) { notifyError(r.error || "Não consegui enviar."); return; }
    notifySuccess("Modelo enviado para análise da Meta. O status aparece aqui quando ela responder.");
    setForm(VAZIO);
    setCriando(false);
    void carregar();
  }

  async function excluir(m: WaModeloAdmin) {
    const ok = await confirmar({
      titulo: `Excluir o modelo "${m.nome}"?`,
      mensagem: "Ele deixa de existir na Meta e some do painel de atendimento. Não dá para desfazer — só criar de novo e esperar nova aprovação.",
      confirmarLabel: "Excluir",
      recusarLabel: "Manter",
    });
    if (!ok) return;
    const r = await excluirModeloNaMeta(m.nome);
    if (!r.ok) { notifyError(r.error || "Não consegui excluir."); return; }
    notifySuccess("Modelo excluído.");
    void carregar();
  }

  // Prévia do que o cliente lê: as variáveis viram exemplo, como no WhatsApp.
  const previa = form.corpo.replace(/{{\s*(\d+)\s*}}/g, (_, n) => (n === "1" ? "Maria" : `[campo ${n}]`));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Modelos de mensagem</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          São as mensagens que a Meta precisa aprovar antes do time usar. É por elas que se
          fala com quem não respondeu nas últimas 24 horas — e é o único caminho para a
          primeira abordagem pelo número oficial.
        </p>
      </div>

      {erro && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{erro}</div>
      )}

      {!criando && (
        <button
          onClick={() => setCriando(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Novo modelo
        </button>
      )}

      {criando && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Nome interno</span>
              <input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="retomada_outubro"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
              />
              <span className="text-[11px] text-gray-400">Só minúsculas, números e _ . O cliente não vê este nome.</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Tipo</span>
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value as NovoModelo["categoria"] })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
              >
                <option value="UTILITY">Utilidade — aviso, confirmação, retorno</option>
                <option value="MARKETING">Marketing — oferta, retomada, novidade</option>
              </select>
              <span className="text-[11px] text-gray-400">Utilidade costuma ser aprovada mais rápido.</span>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Mensagem</span>
            <textarea
              value={form.corpo}
              onChange={(e) => setForm({ ...form, corpo: e.target.value })}
              rows={5}
              placeholder={"Olá {{1}}! Aqui é da Se Tu For, Eu Vou.\nPassando para retomar nossa conversa sobre a sua viagem."}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-y"
            />
            <span className="text-[11px] text-gray-400">
              Use <code className="bg-gray-100 px-1 rounded">{"{{1}}"}</code>, <code className="bg-gray-100 px-1 rounded">{"{{2}}"}</code>… onde o
              atendente vai preencher (nome do cliente, destino). Não comece nem termine o texto com um campo — a Meta recusa.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Rodapé (opcional)</span>
            <input
              value={form.rodape}
              onChange={(e) => setForm({ ...form, rodape: e.target.value })}
              placeholder="Se não quiser mais receber, responda SAIR"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </label>

          {form.corpo.trim() && (
            <div className="rounded-lg bg-gray-50 border border-dashed border-gray-300 p-3">
              <p className="text-[11px] font-semibold text-gray-500 mb-1">Como o cliente vai ver</p>
              <p className="text-sm whitespace-pre-line text-gray-800">{previa}</p>
              {form.rodape?.trim() && <p className="text-xs text-gray-400 mt-1.5">{form.rodape}</p>}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setCriando(false); setForm(VAZIO); }}
              disabled={salvando}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => void enviar()}
              disabled={salvando || !form.nome.trim() || !form.corpo.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {salvando ? "Enviando…" : "Enviar para aprovação"}
            </button>
          </div>
        </div>
      )}

      {carregando ? (
        <p className="text-sm text-gray-400">Carregando os modelos…</p>
      ) : (
        <div className="space-y-2">
          {modelos.length === 0 && !erro && (
            <p className="text-sm text-gray-500">Nenhum modelo ainda. Crie o primeiro acima.</p>
          )}
          {modelos.map((m) => {
            const s = selo(m.status);
            return (
              <div key={m.id} className="rounded-xl border border-gray-200 p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900 text-sm">{m.nome}</span>
                      <span className="rounded px-2 py-0.5 text-[11px] font-bold" style={{ background: s.fundo, color: s.cor }}>
                        {s.texto}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {m.categoria === "MARKETING" ? "Marketing" : "Utilidade"} · {m.idioma}
                        {m.variaveis.length > 0 && ` · ${m.variaveis.length} campo${m.variaveis.length > 1 ? "s" : ""}`}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-gray-600 whitespace-pre-line">{m.corpo}</p>
                    {m.motivo && (
                      <p className="mt-1.5 text-xs text-red-600">A Meta recusou: {m.motivo}</p>
                    )}
                    {m.cabecalhoMidia && (
                      <p className="mt-1.5 text-xs text-amber-700">
                        Tem {m.cabecalhoMidia.toLowerCase()} no topo — o atendimento do QS ainda não envia esse tipo.
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => void excluir(m)}
                    className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-500 hover:border-red-200 hover:text-red-600"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
