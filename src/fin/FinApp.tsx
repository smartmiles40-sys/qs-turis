// src/fin/FinApp.tsx
// -----------------------------------------------------------------------------
// ÁREA FINANCEIRO (Bruno, 14/10/2026: "outro formato de acesso pra mais 2 áreas,
// Financeiro e Operações — hoje vamos mexer no financeiro").
//
// Um app à parte dentro do QS, igual ao Relacionamento: porta própria no login,
// cor própria (índigo), menu em grupos e endereço #fin/<tela>/<id>. A casca é a
// comum das áreas novas (src/area/CascaDeArea); aqui só entra o que é do
// Financeiro.
//
// COMO POR UMA TELA NOVA:
//   1. acrescente o id em TELAS;
//   2. ponha o item num grupo de `grupos` (ou crie um grupo);
//   3. renderize a tela no bloco "Telas" lá embaixo (rota.id serve pra detalhe:
//      #fin/<tela>/<id>).
// Componentes de interface: importe de ./ui (já vêm na cor do Financeiro).
// Banco: fin_tem_acesso() / fin_pode_configurar() nas policies (0126).
// -----------------------------------------------------------------------------
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import CascaDeArea, { ICONES_AREA, hashDaArea, lerHashDaArea, type GrupoDoMenu } from "@/area/CascaDeArea";
import { podeGerirTime } from "@/rel/equipe/permissao";
import { FIN_CSS } from "./ui";
import AtendimentosPage, { FaixaDoAtendimento } from "./atendimentos/AtendimentosPage";
import { supabase } from "@/lib/supabase";
import { bolinhaDaCentral, useContagemSolicitacoes } from "@/solicitacoes/useContagem";

// Telas sob demanda (22/10, desempenho): a conversa do WhatsApp (a do Rel, com
// emojis, editor de foto e modelos da Meta) e os Modelos só baixam quando abertas.
const AtendimentoPage = lazy(() => import("@/rel/atendimento/AtendimentoPage"));
const ModelosPage = lazy(() => import("./modelos/ModelosPage"));
const ContasReceberPage = lazy(() => import("./receber/ContasReceberPage"));
const SolicitacoesPage = lazy(() => import("@/solicitacoes/SolicitacoesPage"));
const EquipePage = lazy(() => import("@/rel/equipe/EquipePage"));
const PagamentosPage = lazy(() => import("./pagamentos/PagamentosPage"));

const PREFIXO = "fin";
/** As telas do Financeiro. */
// 14/10: atendimentos (a fila de quem foi mandado ao Financeiro) e conversas
// (o WhatsApp do Relacionamento, só as conversas que estão com o Financeiro).
// 20/10: solicitacoes (Central de Solicitações entre setores, 0149).
// 19/10: modelos (o próprio time manda os modelos fin_* pra aprovação da Meta).
// 22/10: receber (Contas a receber — parcelas da venda consolidada pelo closer, 0175).
// 22/10: pagamentos (pedidos de Pix, link, cartão e provisão dos outros setores, 0201).
const TELAS = ["inicio", "atendimentos", "conversas", "solicitacoes", "receber", "pagamentos", "modelos", "equipe"] as const;
type Tela = (typeof TELAS)[number];
interface Rota { tela: Tela; id?: string }

interface Contagem { novos: number; esperando: number; atrasadas: number; pagamentos: number; parcelas: number | null }

// Início do Financeiro (27/10): saiu o "Em construção". Mostra o que já
// funciona, com o número de cada fila, e diz com honestidade quando as
// parcelas vão aparecer (fin_planos/fin_parcelas ainda vazios).
function InicioFin({ nome, cont, ir }: { nome: string; cont: Contagem; ir: (t: Tela) => void }) {
  const cartoes: { tela: Tela; rotulo: string; n: number; texto: string; alerta?: boolean }[] = [
    { tela: "atendimentos", rotulo: "Atendimentos", n: cont.novos, alerta: cont.novos > 0,
      texto: cont.novos ? `${cont.novos} cliente${cont.novos === 1 ? "" : "s"} esperando alguém do Financeiro assumir.` : "Clientes que os outros setores mandam pro Financeiro. Nenhum esperando agora." },
    { tela: "pagamentos", rotulo: "Pedidos de pagamento", n: cont.pagamentos,
      texto: cont.pagamentos ? `${cont.pagamentos} aberto${cont.pagamentos === 1 ? "" : "s"}: Pix, link, cartão ou provisão pedidos pelos outros setores.` : "Pix, link, cartão e provisão pedidos pelos outros setores. Nenhum aberto agora." },
    { tela: "conversas", rotulo: "Conversas (WhatsApp)", n: cont.esperando, alerta: cont.esperando > 0,
      texto: cont.esperando ? `${cont.esperando} esperando resposta.` : "As conversas que estão com o Financeiro. Nenhuma esperando resposta." },
  ];
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Olá, {nome.split(" ")[0]}!</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Financeiro · o que já está funcionando hoje.</p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {cartoes.map((c) => (
          <button key={c.tela} type="button" onClick={() => ir(c.tela)} className="rel-card p-4 text-left transition-shadow hover:shadow-md"
            style={c.alerta ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : undefined}>
            <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{c.rotulo}</span>
            <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: c.alerta ? "var(--rel-ink)" : "var(--ink)" }}>{c.n}</span>
            <span className="block text-[12px] mt-1" style={{ color: "var(--ink3)" }}>{c.texto}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={() => ir("receber")} className="rel-card p-4 w-full text-left transition-shadow hover:shadow-md">
        <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Contas a receber</span>
        <span className="block text-[13.5px] mt-1" style={{ color: "var(--ink)" }}>
          {cont.parcelas === null ? "Conferindo…"
            : cont.parcelas === 0 ? "Ainda não há parcelas. As parcelas aparecem aqui quando o closer fechar a primeira venda com o plano de pagamento."
            : `${cont.parcelas} parcela${cont.parcelas === 1 ? "" : "s"} no total${cont.atrasadas ? ` · ${cont.atrasadas} atrasada${cont.atrasadas === 1 ? "" : "s"}` : " · nenhuma atrasada"}.`}
        </span>
      </button>
    </div>
  );
}

function lerRota(): Rota {
  const r = lerHashDaArea(PREFIXO);
  return (TELAS as readonly string[]).includes(r.tela) ? (r as Rota) : { tela: "inicio" };
}

export default function FinApp() {
  const { currentUser } = useQsAuth();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [cont, setCont] = useState<Contagem>({ novos: 0, esperando: 0, atrasadas: 0, pagamentos: 0, parcelas: null });
  const [central, recontarCentral] = useContagemSolicitacoes("financeiro");

  // Bolinhas do menu: atendimentos sem dono e conversas esperando resposta.
  const contar = useCallback(async () => {
    const [a, c, r, p, t] = await Promise.all([
      supabase.from("fin_atendimentos").select("id", { count: "exact", head: true }).eq("status", "novo"),
      supabase.from("rel_wa_fila").select("id", { count: "exact", head: true }).eq("setor", "financeiro").not("aguardando_desde", "is", null),
      // Parcelas atrasadas (0175). Antes da migration aplicada a view não existe: conta 0.
      supabase.from("fin_contas_receber_v").select("id", { count: "exact", head: true }).eq("situacao", "atrasado"),
      // Pedidos de pagamento abertos (0201). Antes da migration: 0.
      supabase.from("fin_pagamentos_v").select("id", { count: "exact", head: true }).eq("para_setor", "financeiro").eq("aberta", true),
      // Quantas parcelas existem (o Início explica quando ainda não há nenhuma).
      supabase.from("fin_contas_receber_v").select("id", { count: "exact", head: true }),
    ]);
    setCont({ novos: a.count ?? 0, esperando: c.count ?? 0, atrasadas: r.error ? 0 : r.count ?? 0, pagamentos: p.error ? 0 : p.count ?? 0, parcelas: t.error ? 0 : t.count ?? 0 });
  }, []);
  useEffect(() => {
    void contar();
    const t = setInterval(() => { if (!document.hidden) void contar(); }, 30_000);
    return () => clearInterval(t);
  }, [contar]);

  useEffect(() => {
    const onHash = () => setRota(lerRota());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const ir = useCallback((r: Rota) => {
    window.location.hash = hashDaArea(PREFIXO, r);
    setRota(r);
    window.scrollTo(0, 0);
  }, []);

  if (!currentUser) return null;
  const gestor = podeGerirTime(currentUser, "financeiro");

  const grupos: GrupoDoMenu[] = [
    { id: "atendimento", rotulo: "Atendimento", icone: ICONES_AREA.dinheiro, itens: [
      { id: "atendimentos", rotulo: "Atendimentos", badge: cont.novos || undefined, alerta: true },
      { id: "conversas", rotulo: "Conversas (WhatsApp)", badge: cont.esperando || undefined },
      { id: "modelos", rotulo: "Modelos de mensagem" },
    ] },
    // Redesign (out/2026): Financeiro = recebimentos + pagamentos num grupo só;
    // Gestão = Solicitações + Time (HANDOFF.md, "Menus por setor").
    { id: "financeiro", rotulo: "Financeiro", icone: ICONES_AREA.lista, itens: [
      { id: "receber", rotulo: "Contas a receber", badge: cont.atrasadas || undefined, alerta: true },
      { id: "pagamentos", rotulo: "Pedidos de pagamento", badge: cont.pagamentos || undefined },
    ] },
    { id: "gestao", rotulo: "Gestão", icone: ICONES_AREA.pedidos, itens: [
      { id: "solicitacoes", rotulo: "Solicitações", ...bolinhaDaCentral(central) },
      // Time: só gestor(a) do Financeiro e admin cadastram e cuidam do time.
      ...(gestor ? [{ id: "equipe", rotulo: "Time" }] : []),
    ] },
  ];

  return (
    <CascaDeArea setor="financeiro" nome="Financeiro" subtitulo="recebimentos e pagamentos" css={FIN_CSS}
      grupos={grupos} ativo={rota.tela} onIr={(t) => ir({ tela: t as Tela })} chaveMenu="qs_fin_menu_aberto">
      {/* ── Telas ── */}
      <Suspense fallback={<p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}>
      {rota.tela === "inicio" && <InicioFin nome={currentUser.name} cont={cont} ir={(t) => ir({ tela: t })} />}
      {rota.tela === "atendimentos" && (
        <AtendimentosPage abrirId={rota.id ?? null} onAbrirId={(id) => ir(id ? { tela: "atendimentos", id } : { tela: "atendimentos" })}
          onAbrirConversa={(id) => ir({ tela: "conversas", id })} />
      )}
      {rota.tela === "conversas" && (
        <AtendimentoPage setor="financeiro" conversaId={rota.id ?? null}
          abrir={(id) => ir(id ? { tela: "conversas", id } : { tela: "conversas" })}
          onMudou={() => void contar()}
          extraCabecalho={(c, recarregar) => (
            <FaixaDoAtendimento conversaId={c.id} onAbrir={(id) => ir({ tela: "atendimentos", id })} onMudou={() => { recarregar(); void contar(); }} />
          )} />
      )}
      {rota.tela === "modelos" && <ModelosPage />}
      {rota.tela === "receber" && <ContasReceberPage onMudou={() => void contar()} />}
      {rota.tela === "pagamentos" && (
        <PagamentosPage abrirId={rota.id ?? null} onMudou={() => { void contar(); recontarCentral(); }}
          onAbrirId={(id) => ir(id ? { tela: "pagamentos", id } : { tela: "pagamentos" })} />
      )}
      {rota.tela === "solicitacoes" && (
        <SolicitacoesPage setor="financeiro" abrirId={rota.id ?? null} onMudou={recontarCentral}
          onAbrirId={(id) => ir(id ? { tela: "solicitacoes", id } : { tela: "solicitacoes" })} />
      )}
      {rota.tela === "equipe" && <EquipePage area="financeiro" />}
      </Suspense>
    </CascaDeArea>
  );
}
