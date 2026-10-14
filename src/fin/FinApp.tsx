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
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import CascaDeArea, { EmConstrucao, ICONES_AREA, hashDaArea, lerHashDaArea, type GrupoDoMenu } from "@/area/CascaDeArea";
import EquipePage from "@/rel/equipe/EquipePage";
import { podeGerirTime } from "@/rel/equipe/permissao";
import { FIN_CSS } from "./ui";
import AtendimentosPage, { FaixaDoAtendimento } from "./atendimentos/AtendimentosPage";
import AtendimentoPage from "@/rel/atendimento/AtendimentoPage";
import { supabase } from "@/lib/supabase";

const PREFIXO = "fin";
/** As telas do Financeiro. */
// 14/10: atendimentos (a fila de quem foi mandado ao Financeiro) e conversas
// (o WhatsApp do Relacionamento, só as conversas que estão com o Financeiro).
const TELAS = ["inicio", "atendimentos", "conversas", "equipe"] as const;
type Tela = (typeof TELAS)[number];
interface Rota { tela: Tela; id?: string }

function lerRota(): Rota {
  const r = lerHashDaArea(PREFIXO);
  return (TELAS as readonly string[]).includes(r.tela) ? (r as Rota) : { tela: "inicio" };
}

export default function FinApp() {
  const { currentUser } = useQsAuth();
  const [rota, setRota] = useState<Rota>(lerRota);
  const [cont, setCont] = useState<{ novos: number; esperando: number }>({ novos: 0, esperando: 0 });

  // Bolinhas do menu: atendimentos sem dono e conversas esperando resposta.
  const contar = useCallback(async () => {
    const [a, c] = await Promise.all([
      supabase.from("fin_atendimentos").select("id", { count: "exact", head: true }).eq("status", "novo"),
      supabase.from("rel_wa_fila").select("id", { count: "exact", head: true }).eq("setor", "financeiro").not("aguardando_desde", "is", null),
    ]);
    setCont({ novos: a.count ?? 0, esperando: c.count ?? 0 });
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
    ] },
    // Time: só gestor(a) do Financeiro e admin cadastram e cuidam do time.
    ...(gestor ? [{ id: "time", rotulo: "Time", icone: ICONES_AREA.equipe, itens: [{ id: "equipe", rotulo: "Funcionários" }] }] : []),
  ];

  return (
    <CascaDeArea setor="financeiro" nome="Financeiro" subtitulo="recebimentos e pagamentos" css={FIN_CSS}
      grupos={grupos} ativo={rota.tela} onIr={(t) => ir({ tela: t as Tela })} chaveMenu="qs_fin_menu_aberto">
      {/* ── Telas ── */}
      {rota.tela === "inicio" && (
        <EmConstrucao
          titulo={`Olá, ${currentUser.name.split(" ")[0]}! Bem-vindo(a) ao Financeiro.`}
          texto={cont.novos ? `Tem ${cont.novos} cliente(s) esperando alguém do Financeiro assumir — veja em Atendimento → Atendimentos.` : "Os clientes que o Comercial, o Relacionamento e Operações mandarem pro Financeiro aparecem em Atendimento → Atendimentos."}
        />
      )}
      {rota.tela === "atendimentos" && (
        <AtendimentosPage abrirId={rota.id ?? null} onAbrirId={(id) => ir(id ? { tela: "atendimentos", id } : { tela: "atendimentos" })}
          onAbrirConversa={(id) => ir({ tela: "conversas", id })} />
      )}
      {rota.tela === "conversas" && (
        <AtendimentoPage setor="financeiro" conversaId={rota.id ?? null}
          abrir={(id) => ir(id ? { tela: "conversas", id } : { tela: "conversas" })}
          onAbrirCliente={() => undefined} onMudou={() => void contar()}
          extraCabecalho={(c, recarregar) => (
            <FaixaDoAtendimento conversaId={c.id} onAbrir={(id) => ir({ tela: "atendimentos", id })} onMudou={() => { recarregar(); void contar(); }} />
          )} />
      )}
      {rota.tela === "equipe" && <EquipePage area="financeiro" />}
    </CascaDeArea>
  );
}
