// src/propostas/PropostasPage.tsx
// -----------------------------------------------------------------------------
// Lista de propostas (0156) + abre o editor. Endereço: #<area>/propostas[/<id>|/nova].
// Aprovação pelo link que quem montou ainda não viu fica em destaque no topo.
//
// 0157: cada time vê as SUAS + as que pediu pra outro time montar (essas abrem
// no lado de quem envia — PropostaParaEnviar — via o editor).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Entrada, Etiqueta, Vazio } from "@/rel/ui";
import PropostaEditor from "./PropostaEditor";
import { NOME_SETOR } from "@/solicitacoes/lib";
import { STATUS_PROPOSTA, TOM_PROPOSTA, dataBr, listarPropostas, type PropostaResumo, type StatusProposta } from "./lib";
import type { Setor } from "@/components/sdr/types";

type Filtro = "abertas" | "aprovada" | "recusada" | "todas";
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: "abertas", rotulo: "Em aberto" }, { id: "aprovada", rotulo: "Aprovadas" }, { id: "recusada", rotulo: "Recusadas" }, { id: "todas", rotulo: "Todas" },
];

function haQuanto(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

export default function PropostasPage({ setor, abrirId, onAbrirId, onMudou }: {
  setor: Setor;
  /** id da proposta aberta, "nova" ou null (lista). */
  abrirId: string | null;
  onAbrirId: (id: string | null) => void;
  /** Recontar a bolinha do menu. */
  onMudou?: () => void;
}) {
  const { currentUser } = useQsAuth();
  const [filtro, setFiltro] = useState<Filtro>("abertas");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<PropostaResumo[]>([]);
  const [novas, setNovas] = useState<PropostaResumo[]>([]);
  const [prontas, setProntas] = useState<PropostaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [l, aprov, pr] = await Promise.all([
        listarPropostas({ setor, status: filtro === "todas" ? undefined : filtro === "abertas" ? "abertas" : (filtro as StatusProposta), busca }),
        listarPropostas({ setor, status: "aprovada" }),
        listarPropostas({ setor, status: "pronta" }),
      ]);
      setLista(l);
      setNovas(aprov.filter((x) => (x.criado_por === currentUser?.id || x.enviada_por === currentUser?.id) && !x.aprovacao_vista_em));
      setProntas(pr.filter((x) => x.de_outro_time && x.sol_de_setor === setor));
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
    setCarregando(false);
  }, [filtro, busca, currentUser?.id, setor]);

  useEffect(() => {
    if (abrirId) return;
    const t = setTimeout(() => void carregar(), busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [carregar, abrirId, busca]);

  if (abrirId) {
    return (
      <PropostaEditor key={abrirId} id={abrirId === "nova" ? null : abrirId} setor={setor}
        onVoltar={() => { onAbrirId(null); onMudou?.(); }} onAbrir={(id) => { onAbrirId(id); onMudou?.(); }} />
    );
  }

  return (
    <div className="max-w-[980px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Propostas</h1>
        <Botao variante="primario" onClick={() => onAbrirId("nova")}>+ Nova proposta</Botao>
      </div>

      {novas.length > 0 && (
        <div className="rounded-xl p-3 space-y-1.5" style={{ background: "var(--rel-soft)" }}>
          <p className="text-[13px] font-bold" style={{ color: "var(--rel-ink)" }}>✅ {novas.length === 1 ? "Um cliente aprovou" : `${novas.length} clientes aprovaram`} pelo link</p>
          {novas.map((x) => (
            <button key={x.id} type="button" onClick={() => onAbrirId(x.id)} className="block text-left text-[13.5px] underline" style={{ color: "var(--ink)" }}>
              Nº {x.numero} · {x.cliente_nome || x.titulo || x.destino || "Proposta"} · há {haQuanto(x.aprovada_em!)}
            </button>
          ))}
        </div>
      )}

      {prontas.length > 0 && (
        <div className="rounded-xl p-3 space-y-1.5 border" style={{ borderColor: "var(--rel)" }}>
          <p className="text-[13px] font-bold" style={{ color: "var(--rel-ink)" }}>📄 {prontas.length === 1 ? "Uma proposta pronta" : `${prontas.length} propostas prontas`} pra você conferir e enviar ao cliente</p>
          {prontas.map((x) => (
            <button key={x.id} type="button" onClick={() => onAbrirId(x.id)} className="block text-left text-[13.5px] underline" style={{ color: "var(--ink)" }}>
              Nº {x.numero} · {x.cliente_nome || x.titulo || x.destino || "Proposta"} · montada por {NOME_SETOR[x.setor]}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
            className="px-3 py-1.5 rounded-full text-[13px] font-semibold border"
            style={filtro === f.id ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
            {f.rotulo}
          </button>
        ))}
        <div className="flex-1 min-w-[200px]"><Entrada placeholder="Buscar cliente, destino ou nº" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {carregando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : lista.length === 0 ? (
          <Vazio titulo={busca ? "Nada encontrado" : "Nenhuma proposta aqui"}
            texto={busca ? "Tente outro nome ou o número." : "Monte uma proposta nova ou abra uma solicitação de cotação e clique em \"Montar proposta\"."}
            acao={!busca ? <Botao variante="primario" onClick={() => onAbrirId("nova")}>+ Nova proposta</Botao> : undefined} />
        ) : (
          <ul className="rel-card divide-y overflow-hidden" style={{ borderColor: "var(--line)" }}>
            {lista.map((x) => (
              <li key={x.id} style={{ borderColor: "var(--line)" }}>
                <button type="button" onClick={() => onAbrirId(x.id)} className="rel-linha w-full text-left px-4 py-3 flex items-center gap-3">
                  <span className="text-[12px] tabular-nums w-12 flex-shrink-0" style={{ color: "var(--ink3)" }}>nº {x.numero}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
                      {x.cliente_nome || "Sem cliente"}{x.titulo || x.destino ? ` · ${x.titulo || x.destino}` : ""}
                    </span>
                    <span className="block text-[12.5px]" style={{ color: "var(--ink3)" }}>
                      {x.setor !== setor ? `${NOME_SETOR[x.setor]} montou${x.sol_numero ? ` (pedido #${x.sol_numero})` : ""} · ` : ""}
                      {x.data_ida ? `Ida ${dataBr(x.data_ida)} · ` : ""}{x.criado_por_nome ? `${x.criado_por_nome.split(" ")[0]} · ` : ""}mexida há {haQuanto(x.atualizado_em)}
                      {x.status === "enviada" && (x.vista_em ? ` · 👀 cliente abriu ${x.visualizacoes}×` : " · cliente ainda não abriu")}
                    </span>
                  </span>
                  <Etiqueta tom={TOM_PROPOSTA[x.status]}>{STATUS_PROPOSTA[x.status]}</Etiqueta>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
