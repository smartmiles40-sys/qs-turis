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

import { useEffect, useState } from "react";
import { getSetting } from "@/lib/qsSettings";
import type { MeetingSal } from "@/components/sdr/types";

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
  // "34.000,00" (ponto de milhar) e "34000.50" (ponto decimal) são AMBOS
  // formas que o time digita. Regra: se o ponto é seguido de 1-2 dígitos no
  // fim e não há vírgula, ele é DECIMAL — tratá-lo como milhar multiplicava o
  // valor por 100 no card do Bitrix.
  const n = /^\d+\.\d{1,2}$/.test(limpo)
    ? Number(limpo)
    : Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Motivos de recusa, caso `qs_settings.sal_motivos` não esteja preenchido. */
const MOTIVOS_PADRAO = [
  "Sem perfil para o produto",
  "Sem orçamento",
  "Sem interesse real",
  "Fora do momento de compra",
  "Dado errado / não é o decisor",
];

export interface DesfechoVendaProps {
  tipo: "realizada" | "no_show";
  busy?: boolean;
  /**
   * Pedir o SAL junto com o desfecho (padrão: sim).
   *
   * Falso nas reuniões de RETOMADA: SAL é a qualificação do lead e isso se
   * decide na primeira call. Perguntar de novo na 2ª call de um pacote só cria
   * a chance de alguém marcar "não é SAL" e mandar pra perdido um cliente que
   * está em negociação.
   */
  pedirSal?: boolean;
  onVoltar: () => void;
  onConfirmar: (venda: {
    valor: number | null;
    tipoVenda: string | null;
    sal: { valor: MeetingSal; motivo: string | null } | null;
  }) => void;
}

export default function DesfechoVenda({ tipo, busy = false, pedirSal = true, onVoltar, onConfirmar }: DesfechoVendaProps) {
  const [valor, setValor] = useState("");
  const [tipoVenda, setTipoVenda] = useState("");
  const [sal, setSal] = useState<MeetingSal | null>(null);
  const [motivo, setMotivo] = useState("");
  const [motivos, setMotivos] = useState<string[]>(MOTIVOS_PADRAO);
  const realizada = tipo === "realizada";

  useEffect(() => {
    if (!pedirSal) return;
    void getSetting<string[]>("sal_motivos").then((lista) => {
      if (Array.isArray(lista) && lista.length) setMotivos(lista);
    });
  }, [pedirSal]);

  // O SAL é OBRIGATÓRIO aqui, ao contrário de valor e tipo da venda. Ele já
  // existia como ação solta, num segundo clique depois de fechar a reunião — e
  // por isso ficava em branco quase sempre. Ou ele sai junto com o desfecho, ou
  // não sai. Recusado exige motivo: o banco recusa sem ele (0032), e sem motivo
  // ninguém consegue discutir a qualidade do lead depois.
  const salFalta = pedirSal && (!sal || (sal === "recusado" && !motivo.trim()));

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

      {pedirSal && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-2">
          <span className="text-xs font-semibold text-gray-700">
            Esse lead é SAL? <span className="font-normal text-gray-500">· obrigatório</span>
          </span>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: "aceito" as const,   rotulo: "Sim, é SAL",  classe: "border-emerald-500 bg-emerald-500 text-white" },
              { v: "recusado" as const, rotulo: "Não é SAL",   classe: "border-red-500 bg-red-500 text-white" },
            ]).map((op) => (
              <button
                key={op.v}
                type="button"
                onClick={() => { setSal(op.v); if (op.v === "aceito") setMotivo(""); }}
                className={`py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  sal === op.v ? op.classe : "border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                }`}
              >
                {op.rotulo}
              </button>
            ))}
          </div>

          {sal === "recusado" && (
            <label className="block">
              <span className="text-xs font-semibold text-gray-600">Por quê?</span>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-400"
              >
                <option value="">Escolha o motivo</option>
                {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {/* Aviso antes do clique, não depois: o lead sai da fila de todo
                  mundo e as atividades dele são encerradas. */}
              <span className="mt-1.5 block text-[11px] text-red-700">
                O lead vai direto para <b>perdido</b> e as atividades abertas dele são encerradas.
              </span>
            </label>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        <button
          onClick={onVoltar}
          disabled={busy}
          className="py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          Voltar
        </button>
        <button
          onClick={() => onConfirmar({
            valor: valorNumerico(valor),
            tipoVenda: tipoVenda || null,
            sal: pedirSal && sal ? { valor: sal, motivo: sal === "recusado" ? motivo.trim() : null } : null,
          })}
          disabled={busy || salFalta}
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
