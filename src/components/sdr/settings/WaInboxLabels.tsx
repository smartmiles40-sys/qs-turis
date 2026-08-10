// src/components/sdr/settings/WaInboxLabels.tsx
// -----------------------------------------------------------------------------
// Ajuste FINO do selo que o atendente vê em cada conversa: de qual número ela
// veio e se aquele número é WhatsApp comum (QR/Baileys) ou API oficial da Meta.
//
// MUDOU: o tipo agora é DERIVADO do canal que o Chatwoot informa
// (Channel::Whatsapp = oficial, Channel::Api = comum), então o selo funciona
// sem ninguém preencher nada aqui. Antes dependia só desta tela — e como ela
// nunca foi preenchida, o selo não aparecia em NENHUMA das conversas da base.
//
// Esta tela continua valendo pra duas coisas: dar um nome humano ao número
// ("Comercial", "Pós-venda") e corrigir o tipo no caso raro em que o canal do
// Chatwoot não represente a realidade. O que estiver aqui vence o automático.
//
// A chave de cada linha é o ID da CAIXA no Chatwoot (1, 2, ...), que é o que a
// conversa carrega. Aparece em Chatwoot → Configurações → Caixas de entrada (na
// URL da caixa).
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/qsSettings";
import { WA_INBOX_LABELS_KEY, preencherFotos, type InboxLabels } from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

/**
 * Preencher as fotos de perfil que faltam.
 *
 * Existe porque a foto só chega quando alguém ABRE a conversa, e esperar 566
 * conversas serem abertas uma a uma não é um plano. Vai de 25 em 25: do outro
 * lado é um WhatsApp de verdade, e rajada de consulta é o padrão que derruba
 * número por abuso — clicar de novo continua de onde parou.
 */
function BotaoFotos() {
  const [rodando, setRodando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  async function rodar() {
    setRodando(true);
    const r = await preencherFotos(25);
    setRodando(false);
    if (!r.ok) { notifyError(r.error || "Não consegui buscar as fotos."); setUltimo(null); return; }
    setUltimo(
      r.tentadas === 0
        ? "Nenhuma conversa sem foto — está tudo preenchido."
        : `${r.preenchidas} de ${r.tentadas} conversas ganharam foto.`
    );
    if (r.preenchidas > 0) notifySuccess(`${r.preenchidas} foto(s) trazidas do WhatsApp.`);
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900">Fotos de perfil dos clientes</h3>
      <p className="text-xs text-gray-500 mt-1 leading-snug">
        A foto entra sozinha quando alguém abre a conversa. Use o botão para preencher as antigas de
        uma vez — ele processa <b>25 por clique</b>, para não bater demais no WhatsApp de uma vez.
      </p>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={rodar}
          disabled={rodando}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60 transition-opacity"
          style={{ background: "#0147FF" }}
        >
          {rodando ? "buscando…" : "Buscar fotos que faltam"}
        </button>
        {ultimo && <span className="text-[11.5px] text-gray-500">{ultimo}</span>}
      </div>
      <p className="text-[11px] text-gray-400 mt-2 leading-snug">
        Cliente que configurou "foto de perfil: só meus contatos" continua sem foto — o WhatsApp não
        mostra para quem não está na agenda dele, e aí as iniciais coloridas são a resposta certa.
      </p>
    </div>
  );
}

interface Linha { id: string; nome: string; tipo: "normal" | "api" }

export default function WaInboxLabels() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    (async () => {
      const v = (await getSetting<InboxLabels>(WA_INBOX_LABELS_KEY)) || {};
      const l = Object.entries(v).map(([id, d]) => ({
        id,
        nome: d?.nome ?? "",
        tipo: d?.tipo === "api" ? "api" : "normal",
      })) as Linha[];
      setLinhas(l.length ? l : [{ id: "", nome: "", tipo: "normal" }]);
      setCarregado(true);
    })();
  }, []);

  function mudar(i: number, campo: keyof Linha, valor: string) {
    setLinhas((prev) => prev.map((l, k) => (k === i ? { ...l, [campo]: valor } : l)));
  }

  async function salvar() {
    setSalvando(true);
    const mapa: InboxLabels = {};
    for (const l of linhas) {
      const id = l.id.trim();
      if (!id || !Number.isFinite(Number(id))) continue;   // linha vazia/inválida é ignorada
      mapa[id] = { nome: l.nome.trim() || `Caixa ${id}`, tipo: l.tipo === "api" ? "api" : "normal" };
    }
    const ok = await setSetting(WA_INBOX_LABELS_KEY, mapa);
    setSalvando(false);
    if (ok) notifySuccess("Selos dos números salvos. O SDR vê na próxima vez que abrir a lista.");
    else notifyError("Não foi possível salvar (só admin/gestor grava configurações).");
  }

  if (!carregado) return null;

  return (
    <>
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900">Nome dos números (comum × API oficial)</h3>
      <p className="text-xs text-gray-500 mt-1 leading-snug">
        O selo de cada conversa já funciona sozinho: o tipo vem do canal que o Chatwoot informa.
        Preencha aqui só para dar um <b>nome humano</b> ao número ("Comercial", "Pós-venda") ou para
        corrigir o tipo num caso fora do padrão. Use o <b>ID da caixa</b> do Chatwoot (aparece na URL
        da caixa em Configurações → Caixas de entrada).
      </p>

      <div className="mt-3 space-y-2">
        {linhas.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={l.id}
              onChange={(e) => mudar(i, "id", e.target.value)}
              placeholder="ID"
              inputMode="numeric"
              className="w-16 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 text-center focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
            />
            <input
              value={l.nome}
              onChange={(e) => mudar(i, "nome", e.target.value)}
              placeholder="Nome que o SDR vê (ex.: Comercial)"
              className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20"
            />
            <select
              value={l.tipo}
              onChange={(e) => mudar(i, "tipo", e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none"
            >
              <option value="normal">normal</option>
              <option value="api">API oficial</option>
            </select>
            <button
              onClick={() => setLinhas((prev) => prev.filter((_, k) => k !== i))}
              className="px-2 py-1.5 text-sm text-gray-400 hover:text-red-600 transition-colors"
              title="Remover"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => setLinhas((prev) => [...prev, { id: "", nome: "", tipo: "normal" }])}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
        >
          + adicionar número
        </button>
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60 transition-opacity"
          style={{ background: "#0147FF" }}
        >
          {salvando ? "salvando…" : "Salvar nomes"}
        </button>
      </div>
    </div>
    <BotaoFotos />
    </>
  );
}
