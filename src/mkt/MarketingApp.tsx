// src/mkt/MarketingApp.tsx
// -----------------------------------------------------------------------------
// ÁREA MARKETING (0240, 30/10/2026). Porta própria no login, cor magenta,
// endereço #mkt/<tela>/<id>. Orgânico e Tráfego trabalham no MESMO quadro.
//
// O menu vem de ROTAS_MKT (src/mkt/rotas.ts — contrato com as outras frentes:
// drive, disparos, grupos, automações, e-mail). Pra pôr uma tela: crie a rota
// no rotas.ts da sua frente; nada muda aqui.
// Banco: mkt_tem_acesso() / mkt_pode_gerir() / mkt_eh_aprovador() nas policies.
// -----------------------------------------------------------------------------
import { Suspense, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import CascaDeArea, { type GrupoDoMenu } from "@/area/CascaDeArea";
import { REL_CSS } from "@/rel/ui";
import { MktProvider, useMkt } from "./contexto";
import { ICONES_MKT, ICONE_GRUPO_MKT } from "./icones";
import { agruparRotas } from "./menu";
import { irMkt, useRotaMkt } from "./navegacao";
import { GRUPOS_MKT, ROTAS_MKT } from "./rotas";
import { contarEmAprovacao } from "./conteudo/dados";
import { ROTA_SOLICITACOES_MKT } from "./solicitacoes/rotas";
import { centralTemMarketing } from "@/solicitacoes/lib";
import { bolinhaDaCentral, useContagemSolicitacoes } from "@/solicitacoes/useContagem";

/** Magenta escuro: #BE185D com texto branco = 6:1 (WCAG AA). */
const MKT_CSS = `${REL_CSS}
:root { --rel: #BE185D; --rel-hover: #9D174D; --rel-ink: #9D174D; --rel-soft: #FCE7F3; --mkt: #BE185D; }
html.dark { --rel-ink: #F9A8D4; --rel-soft: rgba(244, 114, 182, .15); }
.rel-input:focus, .rel-input:focus-visible { box-shadow: 0 0 0 3px rgba(190, 24, 93, .25); }
`;

/** A tela que o "Início" abre. */
const INICIO = "quadro";

export default function MarketingApp() {
  return (
    <MktProvider>
      <Area />
    </MktProvider>
  );
}

function Area() {
  const { currentUser } = useQsAuth();
  const { meusPapeis, aprovador } = useMkt();
  const rota = useRotaMkt();
  const [pendentes, setPendentes] = useState(0);

  // Bolinha do "Aprovações" (pro gestor): recontagem leve a cada troca de tela e a cada minuto.
  useEffect(() => {
    if (!aprovador) { setPendentes(0); return; }
    let vivo = true;
    const contar = () => { void contarEmAprovacao().then((n) => { if (vivo) setPendentes(n); }); };
    contar();
    const t = setInterval(contar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [aprovador, rota.tela]);

  // Central de Solicitações (0283): só entra no menu quando o banco aceita o
  // Marketing (tem tipo de pedido dele). Bolinha = pedido novo pro Marketing +
  // novidade no que eu pedi (recontagem a cada 30 s e na hora, pelo aviso).
  const [comCentral, setComCentral] = useState(false);
  useEffect(() => { void centralTemMarketing().then(setComCentral).catch(() => setComCentral(false)); }, []);
  const [central] = useContagemSolicitacoes("marketing");
  const bCentral = bolinhaDaCentral(central);
  const rotas = comCentral ? [...ROTAS_MKT, ROTA_SOLICITACOES_MKT] : ROTAS_MKT;

  if (!currentUser) return null;
  const grupos: GrupoDoMenu[] = agruparRotas(rotas, GRUPOS_MKT, meusPapeis, aprovador).map((g) => ({
    id: g.id,
    rotulo: g.rotulo,
    icone: ICONE_GRUPO_MKT[g.id] ?? ICONES_MKT.lista,
    itens: g.rotas.map((r) => ({
      id: r.id, rotulo: r.rotulo, icone: r.icone ? ICONES_MKT[r.icone] : undefined,
      badge: r.id === "aprovacoes" && pendentes ? pendentes : r.id === "solicitacoes" ? bCentral.badge : undefined,
      ...(r.id === "solicitacoes" && bCentral.alerta ? { alerta: true } : {}),
    })),
  }));

  // Rota desconhecida (ou "inicio") cai no quadro. A rota existe mesmo escondida
  // do menu pelo papel: esconder não é trava (a trava é a RLS).
  const tela = rota.tela === "inicio" ? INICIO : rota.tela;
  const atual = rotas.find((r) => r.id === tela) ?? rotas.find((r) => r.id === INICIO);
  const Tela = atual?.componente;

  return (
    <CascaDeArea setor="marketing" nome="Marketing" subtitulo="orgânico e tráfego" css={MKT_CSS}
      grupos={grupos} inicioId={INICIO} ativo={atual?.id ?? INICIO} onIr={(t) => irMkt(t)} chaveMenu="qs_mkt_menu_aberto">
      <Suspense fallback={<p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
        {Tela ? <Tela key={atual?.id} /> : null}
      </Suspense>
    </CascaDeArea>
  );
}
