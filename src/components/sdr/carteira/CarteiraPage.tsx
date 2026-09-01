// src/components/sdr/carteira/CarteiraPage.tsx
// -----------------------------------------------------------------------------
// A CARTEIRA DO SDR.
//
// Substitui a "Cobertura de Leads", que respondia "quem está esperando contato
// AGORA" — uma pergunta de plantão, não de relacionamento. Some quando zera, e
// zerada ela não diz nada sobre a base que o SDR construiu ao longo de meses.
//
// A carteira responde outra: QUEM É MEU. Inclui quem já foi trabalhado, quem
// esfriou e quem nunca respondeu — e é exatamente aí que está o trabalho que
// ninguém estava fazendo, porque a fila do dia nunca aponta pra lá.
//
// -- O RETRABALHO NÃO PODE VIRAR DÍVIDA --------------------------------------
//
// A atividade criada aqui nasce pra HOJE e morre hoje (decisão do Bruno,
// 01/09). Se o SDR não executar, ela fecha sozinha como "não executada" e o
// lead volta pra carteira inteiro, pronto pra ser reiniciado outro dia.
//
// Isso é o oposto da cadência normal, e de propósito: retrabalho é trabalho
// EXTRA, feito quando sobra tempo. Se ele virasse atrasado, a primeira semana de
// uso encheria a fila de todo mundo com uma dívida que ninguém pediu — e a
// lição das 124 reuniões sem desfecho é que fila que não zera deixa de ser fila
// e vira ruído.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth, canSeeAllData } from "@/contexts/QsAuthContext";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { varrerRetrabalhoVencido, reiniciarLead, TAG_RETRABALHO } from "@/lib/qs/carteira";

interface Props {
  onOpenLead: (leadId: string) => void;
}

interface ItemCarteira {
  chave: string;
  sdrId: string;
  sdrNome: string | null;
  substitutoNome: string | null;
  substitutoAte: string | null;
  /** O card mais recente deste telefone — é ele que o SDR abre e retrabalha. */
  leadId: string | null;
  nome: string | null;
  telefone: string | null;
  status: string | null;
  segmento: string | null;
  ultimoContato: string | null;
  temAtividadeAberta: boolean;
}

interface Cadencia { id: string; name: string }

const STATUS_ROTULO: Record<string, string> = {
  nao_iniciado: "Não iniciado",
  em_prospeccao: "Em prospecção",
  ganho: "Ganho",
  perdido: "Perdido",
};

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
}

export default function CarteiraPage({ onOpenLead }: Props) {
  const { currentUser } = useQsAuth();
  const gestor = currentUser ? canSeeAllData(currentUser.role) : false;

  const [itens, setItens] = useState<ItemCarteira[]>([]);
  const [cadencias, setCadencias] = useState<Cadencia[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "parados" | "sem_resposta">("todos");
  const [reiniciando, setReiniciando] = useState<ItemCarteira | null>(null);
  const [cadenciaEscolhida, setCadenciaEscolhida] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!currentUser) return;
    setCarregando(true);
    setErro(null);
    try {
      // A RLS da 0073 já corta pro dono (e pra quem está cobrindo). O gestor vê
      // tudo — por isso o limite: carteira do time inteiro passa de 2 mil.
      const { data: linhas, error: e1 } = await supabase
        .from("qs_carteira")
        .select("chave_telefone, sdr_id, substituto_id, substituto_ate")
        .limit(gestor ? 500 : 2000);
      if (e1) throw e1;

      const chaves = (linhas ?? []) as {
        chave_telefone: string; sdr_id: string;
        substituto_id: string | null; substituto_ate: string | null;
      }[];
      if (!chaves.length) { setItens([]); return; }

      // Os leads de quem está na carteira. A carteira é por TELEFONE e o lead é
      // por card, então casa-se pelo dono: o SDR só enxerga os cards dele mesmo,
      // que é o que ele vai retrabalhar.
      const donos = [...new Set(chaves.map((c) => c.substituto_id ?? c.sdr_id))];
      const { data: leads, error: e2 } = await supabase
        .from("qs_leads")
        .select("id, full_name, phone, status, segment, owner_id, updated_at, created_at")
        .in("owner_id", donos)
        .order("created_at", { ascending: false })
        .limit(4000);
      if (e2) throw e2;

      const [{ data: usuarios }, { data: cads }, { data: abertas }] = await Promise.all([
        supabase.from("qs_users").select("id, name"),
        supabase.from("qs_cadences").select("id, name").neq("status", "congelada").order("name"),
        supabase.from("qs_tasks").select("lead_id").eq("status", "pendente").limit(5000),
      ]);

      const nomeDe = new Map((usuarios ?? []).map((u: { id: string; name: string }) => [u.id, u.name]));
      const comAtividade = new Set((abertas ?? []).map((t: { lead_id: string }) => t.lead_id));
      setCadencias((cads ?? []) as Cadencia[]);

      // O card MAIS RECENTE de cada dono+telefone. Sem a chave do banco aqui, o
      // casamento é pelo dono — que basta: a carteira é dele.
      const porDono = new Map<string, typeof leads>();
      for (const l of (leads ?? [])) {
        const arr = porDono.get(l.owner_id!) ?? [];
        arr.push(l);
        porDono.set(l.owner_id!, arr);
      }

      const montados: ItemCarteira[] = [];
      for (const c of chaves) {
        const dono = c.substituto_id ?? c.sdr_id;
        const candidatos = porDono.get(dono) ?? [];
        // A chave da carteira são os 8 últimos dígitos (DDD+8). Comparar por aí
        // é o mesmo critério do banco, sem reimplementar qs_wa_key no navegador.
        const fim = c.chave_telefone.replace(/\D/g, "").slice(-8);
        const lead = candidatos.find((l) => (l.phone ?? "").replace(/\D/g, "").slice(-8) === fim) ?? null;
        montados.push({
          chave: c.chave_telefone,
          sdrId: c.sdr_id,
          sdrNome: nomeDe.get(c.sdr_id) ?? null,
          substitutoNome: c.substituto_id ? nomeDe.get(c.substituto_id) ?? null : null,
          substitutoAte: c.substituto_ate,
          leadId: lead?.id ?? null,
          nome: lead?.full_name ?? null,
          telefone: lead?.phone ?? null,
          status: lead?.status ?? null,
          segmento: lead?.segment ?? null,
          ultimoContato: lead?.updated_at ?? null,
          temAtividadeAberta: lead ? comAtividade.has(lead.id) : false,
        });
      }
      // Sem card visível não há o que retrabalhar — a linha só faria volume.
      setItens(montados.filter((i) => i.leadId));
    } catch (e: unknown) {
      console.warn("[carteira]", e);
      setErro(
        (e as { message?: string })?.message?.includes("qs_carteira")
          ? "A carteira ainda não existe no banco — aplique a migration 0073."
          : "Não consegui carregar a carteira."
      );
    } finally {
      setCarregando(false);
    }
  }, [currentUser, gestor]);

  useEffect(() => { void carregar(); }, [carregar]);
  // O retrabalho de ontem fecha sozinho. Idempotente e barato: uma varredura
  // por abertura de tela, no mesmo espírito do sweepOutcomeTasks.
  useEffect(() => { void varrerRetrabalhoVencido(); }, []);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (termo && !`${i.nome ?? ""} ${i.telefone ?? ""}`.toLowerCase().includes(termo)) return false;
      if (filtro === "parados") {
        const d = diasDesde(i.ultimoContato);
        return !i.temAtividadeAberta && d !== null && d >= 15 && i.status !== "ganho";
      }
      if (filtro === "sem_resposta") return i.status === "perdido" || i.status === "nao_iniciado";
      return true;
    });
  }, [itens, busca, filtro]);

  async function confirmarReinicio() {
    if (!reiniciando?.leadId || !cadenciaEscolhida) return;
    setSalvando(true);
    const r = await reiniciarLead(reiniciando.leadId, cadenciaEscolhida, currentUser?.id ?? null);
    setSalvando(false);
    if (!r.ok) { notifyError(r.error); return; }
    notifySuccess(
      `${reiniciando.nome ?? "Lead"} reiniciado — ${r.tarefas} atividade(s) na sua fila de HOJE. ` +
      "O que não for feito hoje fecha sozinho, sem virar atraso."
    );
    setReiniciando(null);
    setCadenciaEscolhida("");
    void carregar();
  }

  if (carregando) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-3">
        <div className="h-8 w-64 rounded bg-gray-100 animate-pulse" />
        <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Carteira de Leads</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {gestor
            ? "Quem é de quem. Cliente que volta cai sempre com o mesmo SDR, mesmo entrando por outro card."
            : "Seus clientes. Quem já é seu continua seu — mesmo voltando com outro card ou outro ID do Bitrix."}
        </p>
      </header>

      {erro && <p className="mb-4 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-800">{erro}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone…"
          className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
        />
        {([
          ["todos", `Todos (${itens.length})`],
          ["parados", "Parados há 15+ dias"],
          ["sem_resposta", "Perdidos / não iniciados"],
        ] as const).map(([k, rotulo]) => (
          <button
            key={k}
            onClick={() => setFiltro(k)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${
              filtro === k ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">
          {itens.length === 0
            ? "Sua carteira está vazia — ela se preenche sozinha conforme os leads entram."
            : "Nada nesse filtro."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden bg-white">
          {visiveis.slice(0, 200).map((i) => {
            const dias = diasDesde(i.ultimoContato);
            return (
              <li key={i.chave} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => i.leadId && onOpenLead(i.leadId)}
                    className="text-sm font-semibold text-gray-900 hover:text-[#0147FF] truncate block text-left"
                  >
                    {i.nome ?? "Sem nome"}
                  </button>
                  <p className="text-[11.5px] text-gray-500 truncate">
                    {STATUS_ROTULO[i.status ?? ""] ?? i.status ?? "—"}
                    {i.segmento ? ` · ${i.segmento}` : ""}
                    {dias !== null ? ` · parado há ${dias} dia${dias === 1 ? "" : "s"}` : ""}
                    {gestor && i.sdrNome ? ` · ${i.sdrNome}` : ""}
                    {i.substitutoNome ? ` · coberto por ${i.substitutoNome} até ${i.substitutoAte}` : ""}
                  </p>
                </div>
                {i.temAtividadeAberta ? (
                  // Já está na fila: reiniciar criaria atividade em cima de
                  // atividade e o SDR trabalharia o mesmo lead duas vezes.
                  <span className="shrink-0 text-[11px] text-gray-400 px-2">já está na fila</span>
                ) : (
                  <button
                    onClick={() => { setReiniciando(i); setCadenciaEscolhida(""); }}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[#0147FF] text-white text-xs font-bold hover:bg-[#0139cc]"
                  >
                    Retrabalhar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {visiveis.length > 200 && (
        <p className="mt-3 text-[12px] text-gray-500">
          Mostrando 200 de {visiveis.length}. Use a busca pra chegar em alguém específico.
        </p>
      )}

      {/* ── Reiniciar ────────────────────────────────────────────────────── */}
      {reiniciando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h2 className="text-base font-bold text-gray-900">Retrabalhar {reiniciando.nome ?? "lead"}</h2>
            <p className="mt-1 text-[13px] text-gray-600">
              Escolha a cadência. As atividades entram na sua fila de <strong>hoje</strong>.
            </p>

            <label className="block mt-4 text-xs font-medium text-gray-700 mb-1">Cadência</label>
            <select
              value={cadenciaEscolhida}
              onChange={(e) => setCadenciaEscolhida(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm"
            >
              <option value="">— escolha —</option>
              {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              O que você não fizer hoje <strong>fecha sozinho</strong> à meia-noite e não vira atraso.
              O lead volta pra carteira e pode ser reiniciado outro dia.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setReiniciando(null)} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={() => void confirmarReinicio()}
                disabled={!cadenciaEscolhida || salvando}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-white text-sm font-semibold disabled:opacity-50"
              >
                {salvando ? "Criando…" : "Colocar na fila de hoje"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-[11px] text-gray-400">
        As atividades de retrabalho ficam marcadas com <code>{TAG_RETRABALHO}</code> e não entram na conta de atraso.
      </p>
    </div>
  );
}
