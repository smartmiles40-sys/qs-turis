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
//
// UMA MENSAGEM POR SDR (Bruno, 29/09/2026): na Coexistence cada SDR tem a
// própria conta na Meta, e modelo do oficial não existe na conta dele. O
// supervisor escolhe o SDR no topo e escreve a mensagem DELE ("Oi, aqui é a
// Mariana…"); ela vai pra análise no número daquele SDR e, aprovada, aparece
// só na conversa que sai por aquele número.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  listarModelosAdmin, criarModeloNaMeta, excluirModeloNaMeta,
  type WaModeloAdmin, type NovoModelo,
} from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { confirmar } from "@/lib/qs/confirmar";
import { carregarPainelMeta, type NumeroMeta } from "@/lib/qs/metaConexao";

const VAZIO: NovoModelo = { nome: "", categoria: "UTILITY", idioma: "pt_BR", corpo: "", cabecalho: "", rodape: "" };

function selo(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED") return { texto: "Aprovado", cor: "#047857", fundo: "#ECFDF5" };
  if (s === "PENDING") return { texto: "Em análise", cor: "#92400E", fundo: "#FFFBEB" };
  if (s === "REJECTED") return { texto: "Reprovado", cor: "#B91C1C", fundo: "#FEF2F2" };
  if (s === "PAUSED") return { texto: "Pausado", cor: "#92400E", fundo: "#FFFBEB" };
  return { texto: s || "—", cor: "#475569", fundo: "#F1F5F9" };
}

/** Número de SDR (conta própria); o oficial não tem dono. O do Relacionamento
 *  (0101) também tem conta própria e entra na lista. */
const ehDeSdr = (n: NumeroMeta) => (!!n.donoId || n.setor === "relacionamento") && n.modo !== "env";
const nomeDoNumero = (n: NumeroMeta) => (n.setor === "relacionamento" ? "Relacionamento" : n.dono || n.nome || "SDR");

export default function ModelosMeta() {
  // "" = número oficial. Senão, o phone_number_id do número do SDR.
  const [phoneId, setPhoneId] = useState("");
  const [numeros, setNumeros] = useState<NumeroMeta[]>([]);
  const [sdrs, setSdrs] = useState<{ id: string; nome: string }[]>([]);
  const [modelos, setModelos] = useState<WaModeloAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<NovoModelo>(VAZIO);
  // Existe número oficial ligado? Desde 29/09 pode não existir (o time fala só
  // pelos números próprios) — aí a tela abre direto no primeiro SDR.
  const [temOficial, setTemOficial] = useState(true);
  const [pronto, setPronto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await listarModelosAdmin(phoneId || null);
    setModelos(r.modelos);
    setErro(r.error ?? null);
    setCarregando(false);
  }, [phoneId]);

  useEffect(() => { if (pronto) void carregar(); }, [carregar, pronto]);

  useEffect(() => {
    carregarPainelMeta()
      .then((p) => {
        const deSdr = p.numeros.filter((n) => n.status === "conectado" && ehDeSdr(n));
        const oficial = p.numeros.some((n) => !n.donoId && n.setor !== "relacionamento" && n.status === "conectado");
        setNumeros(deSdr);
        setSdrs(p.sdrs);
        setTemOficial(oficial);
        if (!oficial && deSdr[0]) setPhoneId(deSdr[0].phoneId);
      })
      .catch(() => { /* sem o painel, fica só o oficial — como era antes */ })
      .finally(() => setPronto(true));
  }, []);

  const atual = numeros.find((n) => n.phoneId === phoneId) ?? null;
  const primeiroNome = (atual?.setor === "relacionamento" ? "" : atual?.dono || "").trim().split(/\s+/)[0] || "";
  // SDR sem número conectado aparece, mas ainda não dá pra escrever pra ele.
  const semNumero = sdrs.filter((s) => !numeros.some((n) => n.donoId === s.id));

  function trocarNumero(id: string) {
    setPhoneId(id);
    setCriando(false);
    setForm(VAZIO);
  }

  async function enviar() {
    setSalvando(true);
    const r = await criarModeloNaMeta({ ...form, nome: form.nome.trim().toLowerCase().replace(/\s+/g, "_") }, phoneId || null);
    setSalvando(false);
    if (!r.ok) { notifyError(r.error || "Não consegui enviar."); return; }
    notifySuccess(`Modelo enviado para análise da Meta${atual ? ` no número de ${nomeDoNumero(atual)}` : ""}. O status aparece aqui quando ela responder.`);
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
    const r = await excluirModeloNaMeta(m.nome, phoneId || null);
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

      {/* De quem é a mensagem. Cada SDR com número conectado tem a conta dele. */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Mensagens de</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {temOficial && (
            <button
              onClick={() => trocarNumero("")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${phoneId === "" ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              Número oficial
            </button>
          )}
          {numeros.map((n) => (
            <button
              key={n.phoneId}
              onClick={() => trocarNumero(n.phoneId)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${phoneId === n.phoneId ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              {nomeDoNumero(n)}
              {n.numero && <span className="ml-1.5 text-[11px] font-normal text-gray-400">{n.numero}</span>}
            </button>
          ))}
          {semNumero.map((s) => (
            <span
              key={s.id}
              title="Este SDR ainda não conectou o WhatsApp dele em Configurações → WhatsApp (Meta)"
              className="cursor-not-allowed rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-sm text-gray-400"
            >
              {s.nome} · sem número
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          {atual
            ? atual.setor === "relacionamento"
              ? "Mensagens do número do Relacionamento. Aprovadas, aparecem na área de Relacionamento (cliente que não escreve há mais de 24h)."
              : `Mensagens da conta de ${atual.dono}. Aprovadas, aparecem só nas conversas que saem pelo número dele(a).`
            : "Mensagens do número oficial. Para escrever a mensagem de um SDR, escolha o nome dele acima."}
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
          {atual ? `Nova mensagem para ${nomeDoNumero(atual)}` : "Novo modelo"}
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
                placeholder={primeiroNome
                  ? `abordagem_${primeiroNome.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "")}`
                  : "retomada_outubro"}
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
              placeholder={primeiroNome
                ? `Olá {{1}}! Aqui é ${primeiroNome}, da Se Tu For, Eu Vou.\nVi seu interesse na nossa expedição e queria te ajudar com o roteiro.`
                : "Olá {{1}}! Aqui é da Se Tu For, Eu Vou.\nPassando para retomar nossa conversa sobre a sua viagem."}
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
