// src/mkt/trafego/MetaAdsPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › TRÁFEGO › META ADS (0265, 03/11/2026). Uma entrada no menu, cinco
// abas: Verba (o período e o ritmo), Funil (destino e campanha), Travas,
// Campanhas e Histórico. O painel inteiro vem pronto da /api/mkt-trafego; as
// abas só leem do contexto daqui.
//
// "A verba vive estourando. Hoje são R$ 15.000 até o dia 15. Quero travas:
//  desligar campanha se o custo por reunião passar do que a gente estipular."
// -----------------------------------------------------------------------------
import { createContext, lazy, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PaginaComAbas } from "../Abas";
import { Aviso, Botao } from "@/rel/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { atualizarAgora, lerPainel } from "./api";
import type { Painel } from "./tipos";
import { haQuanto } from "./ui";

interface Valor {
  painel: Painel | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => Promise<void>;
  periodoId: string | null;
  setPeriodoId: (id: string | null) => void;
}
const Ctx = createContext<Valor | null>(null);
export function useTrafego(): Valor {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTrafego fora da página Meta Ads.");
  return v;
}

const VerbaAba = lazy(() => import("./VerbaAba"));
const FunilAba = lazy(() => import("./FunilAba"));
const TravasAba = lazy(() => import("./TravasAba"));
const CampanhasAba = lazy(() => import("./CampanhasAba"));
const HistoricoAba = lazy(() => import("./HistoricoAba"));

export default function MetaAdsPage() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodoId, setPeriodoId] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const recarregar = useCallback(async () => {
    try { setPainel(await lerPainel(periodoId)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); }
    finally { setCarregando(false); }
  }, [periodoId]);
  useEffect(() => { void recarregar(); }, [recarregar]);
  // A Meta é lida a cada 30 min pelo servidor; a tela relê a cada 5.
  useEffect(() => { const t = setInterval(() => void recarregar(), 5 * 60_000); return () => clearInterval(t); }, [recarregar]);

  async function lerAgora() {
    setLendo(true);
    try { await atualizarAgora(); notifySuccess("Meta lida agora."); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não leu."); }
    finally { setLendo(false); }
  }

  const valor = useMemo<Valor>(() => ({ painel, carregando, erro, recarregar, periodoId, setPeriodoId }), [painel, carregando, erro, recarregar, periodoId]);

  const est = painel?.estado;
  const subtitulo = !painel ? "Gasto, funil e travas das campanhas da Meta"
    : painel.faltaBanco ? "Falta aplicar a migration 0265 no banco"
    : !painel.configurado ? "Integração com a Meta ainda não configurada"
    : <>Meta lida {haQuanto(est?.ultima_sync_ok)}{est?.conta_nome ? ` · conta ${est.conta_nome}` : ""}{painel.semDado ? " · DADO PARADO" : ""}</>;

  return (
    <Ctx.Provider value={valor}>
      <div className="flex flex-col gap-3">
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {painel && <Configuracao p={painel} />}
        <PaginaComAbas
          titulo="Meta Ads"
          subtitulo={subtitulo}
          acoes={painel?.configurado && painel.podeEditar ? (
            <Botao onClick={() => void lerAgora()} disabled={lendo} title="Lê a Meta agora e roda as travas">{lendo ? "Lendo…" : "Atualizar agora"}</Botao>
          ) : null}
          abas={[
            { id: "verba", rotulo: "Verba", componente: VerbaAba },
            { id: "funil", rotulo: "Funil", componente: FunilAba },
            { id: "travas", rotulo: "Travas", badge: painel?.regras?.filter((r) => r.ativa && r.avaliacao.situacao === "disparou").length || undefined, componente: TravasAba },
            { id: "campanhas", rotulo: "Campanhas", componente: CampanhasAba },
            { id: "historico", rotulo: "Histórico", componente: HistoricoAba },
          ]}
        />
        {carregando && !painel && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}
      </div>
    </Ctx.Provider>
  );
}

/** O que falta pra integração funcionar — explicado, sem quebrar a tela. */
function Configuracao({ p }: { p: Painel }) {
  if (p.faltaBanco) {
    return (
      <Aviso tom="aviso">
        As tabelas do Meta Ads ainda não existem no banco. Falta aplicar a migration <b>0265_mkt_trafego.sql</b> (Supabase).
        Até lá esta tela fica vazia — nada mais no QS é afetado.
      </Aviso>
    );
  }
  if (!p.configurado) {
    return (
      <Aviso tom="aviso">
        A Meta ainda não está ligada ao QS. Falta na Vercel: <b>{p.falta.join(", ")}</b>. O passo a passo (token de usuário do sistema
        no Business Manager com ads_read e ads_management) está em <code>docs/TRAFEGO-META.md</code>. Já dá pra cadastrar o período de verba e as travas;
        os números aparecem na primeira leitura.
      </Aviso>
    );
  }
  return null;
}
