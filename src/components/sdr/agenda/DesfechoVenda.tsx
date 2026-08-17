// src/components/sdr/agenda/DesfechoVenda.tsx
// -----------------------------------------------------------------------------
// O que o especialista informa ao fechar a reunião: VALOR e TIPO DA VENDA.
//
// Existe como componente próprio porque o desfecho é lançado de DOIS lugares —
// o modal de detalhe da reunião e o painel da agenda do dia — e a pergunta tem
// que ser a mesma nos dois. Duplicar o formulário foi como o QS já perdeu campo
// antes: um lado ganha um ajuste, o outro fica pra trás em silêncio.
//
// Os dois campos são OPCIONAIS de propósito: reunião sem valor definido não pode
// impedir o closer de registrar que ela aconteceu. O que estiver em branco
// simplesmente não é enviado — e o servidor descarta vazio pra nunca APAGAR um
// valor que já esteja no card do Bitrix.
// -----------------------------------------------------------------------------

import { useState } from "react";

/** "Tipo de venda" do card do Bitrix (campo UF_CRM_1743296167520), lido do
 *  portal em 17/08 — é o campo que o comercial mais usa lá. Os ids são os do
 *  Bitrix: se criarem um tipo novo no portal, some aqui, senão ele não aparece
 *  pro closer. */
export const TIPOS_DE_VENDA = [
  { id: "69",  nome: "Expedições" },
  { id: "67",  nome: "Pacotes de Viagens" },
  { id: "71",  nome: "Passagens aéreas" },
  { id: "77",  nome: "Hospedagem" },
  { id: "73",  nome: "Seguro Viagem" },
  { id: "75",  nome: "Passeios e transfers" },
  { id: "229", nome: "Concierge" },
  { id: "325", nome: "Cruzeiro" },
  { id: "79",  nome: "Outros" },
];

/** "34.000,00" → 34000. Vírgula é o que o brasileiro digita; o Bitrix quer ponto. */
export function valorNumerico(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface DesfechoVendaProps {
  tipo: "realizada" | "no_show";
  busy?: boolean;
  onVoltar: () => void;
  onConfirmar: (venda: { valor: number | null; tipoVenda: string | null }) => void;
}

export default function DesfechoVenda({ tipo, busy = false, onVoltar, onConfirmar }: DesfechoVendaProps) {
  const [valor, setValor] = useState("");
  const [tipoVenda, setTipoVenda] = useState("");
  const realizada = tipo === "realizada";

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2.5 text-left">
      <p className="text-sm font-semibold text-gray-800">
        {realizada ? "Reunião realizada" : "Cliente não compareceu"}
        <span className="font-normal text-gray-500">
          {realizada ? " → vai para Em Negociação" : " → vai para No-Show"}
        </span>
      </p>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Valor da venda</span>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-sm text-gray-500">R$</span>
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))}
            inputMode="decimal"
            placeholder="34.000,00"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
          />
        </div>
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-gray-600">Tipo da venda</span>
        <select
          value={tipoVenda}
          onChange={(e) => setTipoVenda(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
        >
          <option value="">Não informar</option>
          {TIPOS_DE_VENDA.map((t) => (
            <option key={t.id} value={t.id}>{t.nome}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          onClick={onVoltar}
          disabled={busy}
          className="py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          Voltar
        </button>
        <button
          onClick={() => onConfirmar({ valor: valorNumerico(valor), tipoVenda: tipoVenda || null })}
          disabled={busy}
          className={`py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${
            realizada ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {busy ? "Salvando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
