// src/ops/OpsApp.tsx
// -----------------------------------------------------------------------------
// ÁREA OPERAÇÕES (0126, 14/10/2026). Porta própria no login, cor âmbar,
// endereço #ops/<tela>. O resto das telas é a Fase 6 do roadmap do QS — a base
// vai ser o sistema de Expedições (voos, passageiros, fornecedores).
//
// 20/10 (0149): a CENTRAL DE SOLICITAÇÕES é a casa de Operações — o Início abre
// direto nela ("Operações vai ficar 100% no QS, ainda mais na questão de
// demandas" — Bruno). #ops/solicitacoes/<id> abre um pedido.
//
// Pra pôr uma tela: mesmo jeito do src/fin/FinApp.tsx (TELAS → grupo → render).
// Banco: ops_tem_acesso() / ops_pode_configurar() nas policies (0126).
//
// 21/10: EXPEDIÇÕES — todas as telas internas do Sistema de Expedições vivem
// aqui (src/expedicoes/, banco 0160–0162). Grupo "Expedições" no menu.
// -----------------------------------------------------------------------------
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import CascaDeArea, { ICONES_AREA, hashDaArea, lerHashDaArea, type GrupoDoMenu } from "@/area/CascaDeArea";
import EquipePage from "@/rel/equipe/EquipePage";
import { podeGerirTime } from "@/rel/equipe/permissao";
import { REL_CSS } from "@/rel/ui";
import SolicitacoesPage from "@/solicitacoes/SolicitacoesPage";
import { bolinhaDaCentral, useContagemSolicitacoes } from "@/solicitacoes/useContagem";
import PropostasPage from "@/propostas/PropostasPage";
import { useAprovacoesNovas } from "@/propostas/lib";
import { TELAS_EXP, type TelaExp } from "@/expedicoes/contexto";
import { grupoExpedicoes } from "@/expedicoes/menu";
import { useContagensExp } from "@/expedicoes/useContagensExp";
import { setoresDe } from "@/contexts/QsAuthContext";

const ExpedicoesArea = lazy(() => import("@/expedicoes/ExpedicoesArea"));
// 23/10 (cadastro único): a ficha do cliente é a MESMA do Relacionamento (0172/0173).
const ClientesPage = lazy(() => import("@/rel/clientes/ClientesPage"));
const ClienteFicha = lazy(() => import("@/rel/clientes/ClienteFicha"));
const FilaDivergencias = lazy(() => import("@/clientes/FilaDivergencias"));

/** Cor de Operações: âmbar escuro (#B45309 com texto branco = 5:1, WCAG AA). */
const OPS_CSS = `${REL_CSS}
:root { --rel: #B45309; --rel-hover: #92400E; --rel-ink: #9A3412; --rel-soft: #FDF0E3; --ops: #B45309; }
html.dark { --rel-ink: #FDBA74; --rel-soft: rgba(251, 146, 60, .15); }
.rel-input:focus, .rel-input:focus-visible { box-shadow: 0 0 0 3px rgba(180, 83, 9, .25); }
`;

const PREFIXO = "ops";
const TELAS = ["inicio", "solicitacoes", "propostas", "equipe", "fichas", "ficha", "arrumar", ...TELAS_EXP] as const;
type Tela = (typeof TELAS)[number];
const ehExp = (t: string): t is TelaExp => (TELAS_EXP as readonly string[]).includes(t);
interface Rota { tela: Tela; id?: string }

function lerRota(): Rota {
  const r = lerHashDaArea(PREFIXO);
  return (TELAS as readonly string[]).includes(r.tela) ? (r as Rota) : { tela: "inicio" };
}

export default function OpsApp() {
  const { currentUser } = useQsAuth();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [central, recontar] = useContagemSolicitacoes("operacional");
  const [aprovacoes, recontarAprovacoes] = useAprovacoesNovas(currentUser?.id, "operacional");
  const contExp = useContagensExp();

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
  const grupos: GrupoDoMenu[] = [
    { id: "demandas", rotulo: "Demandas", icone: ICONES_AREA.pedidos, itens: [
      { id: "solicitacoes", rotulo: "Solicitações", ...bolinhaDaCentral(central) },
      { id: "propostas", rotulo: "Propostas", badge: aprovacoes || undefined },
    ] },
    { id: "clientes-ops", rotulo: "Clientes", icone: ICONES_AREA.lista, itens: [
      { id: "fichas", rotulo: "Fichas" },
      { id: "arrumar", rotulo: "Arrumar cadastros" },
    ] },
    grupoExpedicoes(contExp),
    { id: "time", rotulo: "Time", icone: ICONES_AREA.equipe, itens: [
      ...(podeGerirTime(currentUser, "operacional") ? [{ id: "equipe", rotulo: "Funcionários" }] : []),
      { id: "exp-config", rotulo: "Acesso às Expedições" },
    ] },
  ];

  return (
    <CascaDeArea setor="operacional" nome="Operações" subtitulo="expedições e embarques" css={OPS_CSS}
      grupos={grupos} ativo={rota.tela === "inicio" ? "solicitacoes" : rota.tela === "ficha" || rota.tela === "passageiros" || rota.tela === "clientes" || rota.tela === "acessos-amigo" ? "fichas" : rota.tela} onIr={(t) => ir({ tela: t as Tela })} chaveMenu="qs_ops_menu_aberto">
      {(rota.tela === "inicio" || rota.tela === "solicitacoes") && (
        <SolicitacoesPage setor="operacional" abrirId={rota.id ?? null} onMudou={recontar}
          onAbrirId={(id) => ir(id ? { tela: "solicitacoes", id } : { tela: "solicitacoes" })}
          links={{ onAbrirProposta: (id) => ir({ tela: "propostas", id }) }} />
      )}
      {rota.tela === "propostas" && (
        <PropostasPage setor="operacional" abrirId={rota.id ?? null} onMudou={recontarAprovacoes}
          onAbrirId={(id) => ir(id ? { tela: "propostas", id } : { tela: "propostas" })} />
      )}
      {rota.tela === "equipe" && <EquipePage area="operacional" />}
      {rota.tela === "fichas" && <Suspense fallback={null}><ClientesPage onAbrir={(id) => ir({ tela: "ficha", id })} /></Suspense>}
      {rota.tela === "ficha" && rota.id && (
        <Suspense fallback={null}>
          <ClienteFicha key={rota.id} id={rota.id} setor="operacional" onAbrir={(id) => ir({ tela: "ficha", id })} onVoltar={() => ir({ tela: "fichas" })}
            onAbrirViagem={setoresDe(currentUser).includes("relacionamento") ? (id) => { window.location.hash = `#rel/viagem/${id}`; } : undefined}
            onAbrirExpedicao={(exp, tipo, pax) => ir({ tela: tipo === "pacote" ? "pacotes" : "expedicoes", id: pax ? `${exp}/passageiros/pax/${pax}` : exp })} />
        </Suspense>
      )}
      {rota.tela === "arrumar" && (
        <Suspense fallback={null}>
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Arrumar cadastros</h1>
              <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
                Onde a ficha do cliente e o passageiro da expedição discordam (CPF, passaporte, nascimento…). Escolha o que vale: a ficha e todas as viagens da pessoa ficam iguais.
              </p>
            </div>
            <FilaDivergencias onAbrirCliente={(id) => ir({ tela: "ficha", id })}
              onAbrirPassageiro={(exp, tipo, pax) => ir({ tela: tipo === "pacote" ? "pacotes" : "expedicoes", id: `${exp}/passageiros/pax/${pax}` })} />
          </div>
        </Suspense>
      )}
      {ehExp(rota.tela) && (
        <Suspense fallback={null}>
          <ExpedicoesArea tela={rota.tela} caminho={rota.id} ir={(tela, id) => ir({ tela, id })} />
        </Suspense>
      )}
    </CascaDeArea>
  );
}
