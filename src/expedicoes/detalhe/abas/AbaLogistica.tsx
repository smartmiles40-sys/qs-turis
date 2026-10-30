// src/expedicoes/detalhe/abas/AbaLogistica.tsx
// -----------------------------------------------------------------------------
// ABA "LOGÍSTICA" DO COCKPIT (redesign 29/10, spec §3.2). Junta 4 abas antigas:
//   • Hospedagem e rooming  (era "Rooming")      → hotéis com "x/y alocados" +
//     Exportar Excel + o quadro de arrastar (RoomingBoard, sem mudança)
//   • Roteiro do líder      (era "Roteiro Líder") → mesmo editor, com tags por dia
//   • Divisões              (era "Grupos")
// (30/10: o Checklist saiu daqui e virou aba própria do cockpit, entre Logística e
// Financeiro — AbaChecklist.tsx. ?secao=checklist redireciona pra ela, ver rota.ts.)
// Cada bloco é uma seção recolhível; ?secao=rooming|roteiro|divisoes abre
// e rola até ela (os links antigos chegam assim — ver lib/cockpit/rota.ts).
// Não existe em pacote (o cockpit nem mostra a aba).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Btn } from "@/components/ui";
import { useExp } from "../../contexto";
import { useAoVivo, Carregando } from "../../ui";
import { carregarRooming, type DadosRooming } from "../../rooming/dados";
import { calcularRooming } from "../../rooming/calculos";
import { exportarRoomingExcel } from "../../rooming/exportar";
import RoomingBoard from "../../rooming/RoomingBoard";
import { formatDate } from "../../lib/utils";
import type { SecaoCockpit } from "../../lib/cockpit/rota";
import type { PropsAba } from "../ExpedicaoDetalhe";
import AbaRoteiroLider from "./AbaRoteiroLider";
import AbaGrupos from "./AbaGrupos";

type SecaoLog = "rooming" | "roteiro" | "divisoes";
const SECOES_LOG: readonly SecaoLog[] = ["rooming", "roteiro", "divisoes"];

export default function AbaLogistica(props: PropsAba) {
  const { cockpit } = props;
  const pedida = cockpit?.secao ?? null;
  const [abertas, setAbertas] = useState<Set<SecaoLog>>(() => new Set<SecaoLog>([ehLog(pedida) ? pedida : "rooming"]));

  // Link com ?secao= → abre e rola até a seção.
  useEffect(() => {
    if (!ehLog(pedida)) return;
    setAbertas((s) => (s.has(pedida) ? s : new Set(s).add(pedida)));
    const t = window.setTimeout(() => document.getElementById(`ck-sec-${pedida}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => window.clearTimeout(t);
  }, [pedida]);

  const alternar = (id: SecaoLog, aberta: boolean) => setAbertas((s) => {
    if (s.has(id) === aberta) return s;
    const n = new Set(s);
    if (aberta) n.add(id); else n.delete(id);
    return n;
  });

  const secao = (id: SecaoLog, titulo: string, nota: ReactNode, corpo: ReactNode) => (
    <details key={id} id={`ck-sec-${id}`} className="ck-sec" open={abertas.has(id)}
      onToggle={(e) => alternar(id, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h3 className="ck-h3">{titulo}</h3>{nota && <span className="ck-nota">{nota}</span>}</summary>
      {/* Só monta o conteúdo aberto: cada seção lê o banco por conta própria. */}
      {abertas.has(id) && <div className="ck-sec__b">{corpo}</div>}
    </details>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {secao("rooming", "Hospedagem e rooming", "hotéis pelas datas dos quartos", <Hospedagem {...props} />)}
      {secao("roteiro", "Roteiro do líder", "aparece na Área do Líder, nesta ordem", <AbaRoteiroLider {...props} />)}
      {secao("divisoes", "Divisões", "G1 / G2 e quem vai em cada", <AbaGrupos {...props} />)}
    </div>
  );
}

const ehLog = (s: SecaoCockpit | null): s is SecaoLog => !!s && (SECOES_LOG as readonly string[]).includes(s);

/** Hotéis (trechos do rooming) com "x/y alocados" + Exportar Excel + quadro de arrastar. */
function Hospedagem({ exp, cockpit }: PropsAba) {
  const { avisar } = useExp();
  const [dados, setDados] = useState<DadosRooming | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [quadro, setQuadro] = useState(false);
  const [exportando, setExportando] = useState(false);
  const refQuadro = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try { setDados(await carregarRooming(exp.id)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar o rooming"); }
  }, [exp.id]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);
  useAoVivo([
    { tabela: "quartos", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "extensoes", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "grupos_expedicao", filtro: `expedicao_id=eq.${exp.id}` },
  ], carregar, 500);
  // Sem expedicao_id no realtime: espera de 2 s (igual à aba Rooming antiga).
  useAoVivo([{ tabela: "passageiro_quarto" }, { tabela: "passageiro_extensao" }], carregar, 2000);

  const r = useMemo(() => (dados ? calcularRooming(dados, dados.alocacoes) : null), [dados]);

  // Mudou algo no quadro → o resumo do cockpit (faixa da viagem, matriz) também.
  const recarregar = useCallback(async () => { await carregar(); cockpit?.recarregarResumo(); }, [carregar, cockpit]);

  if (erro && !dados) return <p className="ck-vazio" style={{ color: "var(--danger)" }}>{erro}</p>;
  if (!dados || !r) return <Carregando texto="Carregando rooming…" />;

  async function exportar() {
    if (!r) return;
    setExportando(true);
    try { await exportarRoomingExcel(r); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao exportar", "erro"); }
    finally { setExportando(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {r.trechos.length === 0 ? (
        <p className="ck-vazio">Nenhum quarto cadastrado ainda. Abra o rooming pra criar os quartos dos hotéis.</p>
      ) : r.trechos.map((t) => {
        const relevantes = r.paxRelevantes(t).length;
        const faltam = r.semQuarto(t).length;
        const ok = relevantes > 0 && faltam === 0;
        return (
          <div key={t.key} className="ck-lin">
            <span className={`ck-tag ck-tag--${ok ? "ok" : relevantes === 0 ? "info" : "warn"}`}>{relevantes - faltam}/{relevantes} alocados</span>
            <div className="ck-lin__tx">
              <span className="ck-lin__t">{t.hotel_cidade || "Hotel sem nome"}{t.extensao_id ? ` · ${(r.nomeExtensao.get(t.extensao_id) ?? "extensão")}` : ""}</span>
              <span className="ck-lin__s">
                {t.check_in || t.check_out ? `${formatDate(t.check_in)} → ${formatDate(t.check_out)}` : "sem datas"} · {t.quartos.length} quarto{t.quartos.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        );
      })}
      <div className="ck-chips">
        {r.conexoes.length > 0 && <span className="ck-tag ck-tag--info">{r.conexoes.length} conex{r.conexoes.length === 1 ? "ão" : "ões"} de viagem</span>}
        {r.conexoesSeparadas.length > 0 && <span className="ck-tag ck-tag--warn">{r.conexoesSeparadas.length} conexão separada em quartos diferentes</span>}
        {r.acompanhantes.length > 0 && <span className="ck-tag ck-tag--info">{r.acompanhantes.length} acompanhante{r.acompanhantes.length === 1 ? "" : "s"} pra conectar</span>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Btn variant="primary" onClick={() => { setQuadro((v) => !v); window.setTimeout(() => refQuadro.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }}>
          {quadro ? "Fechar rooming" : "Abrir rooming"}
        </Btn>
        <Btn onClick={() => void exportar()} disabled={!r.completo || exportando}
          title={r.completo ? undefined : "Libera quando todos estiverem alocados em todos os hotéis e as conexões juntas"}>
          {exportando ? "Exportando…" : "Exportar Excel"}
        </Btn>
      </div>
      {quadro && <div ref={refQuadro}><RoomingBoard expId={exp.id} dados={dados} recarregar={recarregar} /></div>}
    </div>
  );
}
