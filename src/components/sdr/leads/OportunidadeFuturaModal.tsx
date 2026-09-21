// src/components/sdr/leads/OportunidadeFuturaModal.tsx
// -----------------------------------------------------------------------------
// "OPORTUNIDADE FUTURA" — o closer registra que o cliente quer, mas não agora.
// Três perguntas e mais nada: QUANDO retomar, QUEM retoma e O QUE o cliente
// disse. O motivo é obrigatório porque é ele que o SDR vai ler meses depois,
// quando nem lembra quem era o cliente.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { listUsersLite, type UserLite } from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { confirmar } from "@/lib/qs/confirmar";
import {
  amanha, cancelarOportunidadeFutura, dataCurta, devolverAgora, oportunidadeAberta, registrarOportunidadeFutura, somarDias,
  type OportunidadeFutura,
} from "@/lib/qs/oportunidadeFutura";

const ATALHOS: { rotulo: string; dias: number }[] = [
  { rotulo: "1 mês", dias: 30 },
  { rotulo: "2 meses", dias: 60 },
  { rotulo: "3 meses", dias: 90 },
  { rotulo: "6 meses", dias: 182 },
];

export default function OportunidadeFuturaModal({
  leadId, leadName, meetingId = null, onFechar, onSalvo,
}: {
  leadId: string;
  leadName: string;
  meetingId?: string | null;
  onFechar: () => void;
  onSalvo?: () => void;
}) {
  const [data, setData] = useState(somarDias(30));
  const [quem, setQuem] = useState<"sdr" | "closer">("sdr");
  const [responsavel, setResponsavel] = useState("");   // "" = automático
  const [motivo, setMotivo] = useState("");
  const [usuarios, setUsuarios] = useState<UserLite[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { void listUsersLite().then(setUsuarios); }, []);

  const opcoes = usuarios.filter((u) => u.is_active && (quem === "sdr" ? u.role === "sdr" : u.role === "closer"));
  const fimDeSemana = (() => { const d = new Date(`${data}T12:00:00`).getDay(); return d === 0 || d === 6; })();
  const podeSalvar = !salvando && data >= amanha() && motivo.trim().length >= 10;

  async function salvar() {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    const r = await registrarOportunidadeFutura({
      leadId, retomarEm: data, quem, motivo: motivo.trim(), responsavelId: responsavel || null, meetingId,
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.error || "Não consegui salvar.");
      // Não achou o SDR sozinho: abre a lista pra escolher.
      if (r.motivo === "sem-sdr") setResponsavel(opcoes[0]?.id ?? "");
      return;
    }
    notifySuccess(`Oportunidade futura registrada — ${leadName} volta em ${dataCurta(data)}.`);
    onSalvo?.();
    onFechar();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onFechar}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Oportunidade futura">
        <h2 className="text-base font-bold text-gray-900">Oportunidade futura</h2>
        <p className="mt-1 text-xs leading-snug text-gray-500">
          <b>{leadName}</b> quer, mas não agora. O card vai pra coluna <b>Oportunidade futura</b> no Bitrix,
          as atividades abertas saem da fila e, no dia escolhido, o lead volta pra quem vai retomar.
        </p>

        {/* Quando */}
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-gray-400">Retomar em</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ATALHOS.map((a) => {
            const valor = somarDias(a.dias);
            const ativo = data === valor;
            return (
              <button key={a.dias} type="button" onClick={() => setData(valor)}
                      className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${ativo ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                {a.rotulo}
              </button>
            );
          })}
        </div>
        <input type="date" value={data} min={amanha()} onChange={(e) => setData(e.target.value)}
               className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        {fimDeSemana && (
          <p className="mt-1 text-[11px] text-amber-700">Essa data cai num fim de semana — a atividade vai aparecer, mas talvez ninguém esteja trabalhando.</p>
        )}

        {/* Quem */}
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-gray-400">Quem retoma</label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {([
            ["sdr", "SDR rechama", "O lead volta a ser do SDR (card em Pré-Vendas › Follow-up 1)"],
            ["closer", "Closer retoma", "Fica com o closer (card em Comercial 1 › Em Negociação)"],
          ] as const).map(([valor, titulo, desc]) => (
            <button key={valor} type="button" onClick={() => { setQuem(valor); setResponsavel(""); }}
                    className={`rounded-xl border p-2.5 text-left ${quem === valor ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"}`}>
              <span className="block text-sm font-semibold text-gray-900">{titulo}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{desc}</span>
            </button>
          ))}
        </div>
        <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
          <option value="">
            {quem === "sdr" ? "O SDR que trouxe este lead (automático)" : "Eu mesmo / o closer atual (automático)"}
          </option>
          {opcoes.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        {/* O quê */}
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-gray-400">O que o cliente disse</label>
        <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3}
                  placeholder="Ex.: quer ir pro Japão em 2027, espera o 13º sair em dezembro. Pediu pra falar de novo em janeiro."
                  className="mt-1.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <p className="text-[11px] text-gray-400">Quem retomar vai ler isto — escreva como se fosse pra alguém que nunca falou com o cliente.</p>

        {erro && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={() => void salvar()} disabled={!podeSalvar}
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
            {salvando ? "salvando…" : `Registrar — volta em ${dataCurta(data)}`}
          </button>
          <button onClick={onFechar} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── A faixa na ficha do lead ────────────────────────────────────────────────
// Quem abre o card precisa saber, antes de ligar, que o cliente pediu pra
// esperar — e até quando. Sem isto, o SDR que cai no lead por acaso liga no
// meio da espera e queima a oportunidade.

export function FaixaOportunidadeFutura({ leadId, podeAgir, versao = 0, onMudou }: {
  leadId: string;
  podeAgir: boolean;
  versao?: number;
  onMudou?: () => void;
}) {
  const [of, setOf] = useState<OportunidadeFutura | null>(null);
  const [usuarios, setUsuarios] = useState<UserLite[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => { void oportunidadeAberta(leadId).then(setOf); }, [leadId]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  useEffect(() => { void listUsersLite().then(setUsuarios); }, []);

  if (!of) return null;
  const resp = usuarios.find((u) => u.id === of.responsavel_id)?.name ?? "—";

  async function agir(tipo: "cancelar" | "devolver") {
    if (!of) return;
    const ok = await confirmar(tipo === "cancelar"
      ? { titulo: "Cancelar a oportunidade futura?", mensagem: "O lead fica onde está e ninguém é lembrado na data.", confirmarLabel: "Cancelar oportunidade", recusarLabel: "Voltar", perigo: true }
      : { titulo: `Devolver agora para ${resp}?`, mensagem: "Faz hoje o que aconteceria na data: troca o dono (se for SDR), cria a atividade e move o card no Bitrix.", confirmarLabel: "Devolver agora", recusarLabel: "Voltar" });
    if (!ok) return;
    setOcupado(true);
    const r = tipo === "cancelar" ? await cancelarOportunidadeFutura(of.id) : await devolverAgora(of.id);
    setOcupado(false);
    if (!r.ok) { notifyError(r.error || "Não consegui."); return; }
    notifySuccess(tipo === "cancelar" ? "Oportunidade futura cancelada." : `Devolvida para ${resp}.`);
    carregar();
    onMudou?.();
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
      <p className="text-sm font-bold text-indigo-900">
        🔁 Oportunidade futura — volta em {dataCurta(of.retomar_em)} para {resp} ({of.quem === "sdr" ? "SDR" : "closer"})
      </p>
      <p className="mt-1 whitespace-pre-line text-sm text-indigo-800">{of.motivo}</p>
      {of.bitrix_ida && <p className="mt-1 text-[11px] text-indigo-500">Bitrix: {of.bitrix_ida}</p>}
      {podeAgir && of.status === "aguardando" && (
        <div className="mt-2 flex gap-3">
          <button onClick={() => void agir("devolver")} disabled={ocupado}
                  className="text-xs font-semibold text-indigo-700 underline underline-offset-2 disabled:opacity-50">
            Devolver agora
          </button>
          <button onClick={() => void agir("cancelar")} disabled={ocupado}
                  className="text-xs font-semibold text-red-600 underline underline-offset-2 disabled:opacity-50">
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
