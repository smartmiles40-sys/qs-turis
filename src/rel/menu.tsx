// src/rel/menu.tsx
// -----------------------------------------------------------------------------
// MENU DO RELACIONAMENTO COMO DADOS (V2, 30/10/2026).
//
// Bruno, 30/10: tirar o "Mais ▸" recolhido ("ninguém vai usar") e mostrar a
// cada pessoa só os painéis do papel dela ("pra quem está começando não se
// perder"). Por isso o menu saiu do JSX do RelApp e virou um CATÁLOGO: cada
// item tem nome, ícone e grupo definidos uma vez só, e quem monta (o RelApp e a
// pré-visualização "o menu dela fica assim" na tela Time e cargos) chama a
// mesma função `montarMenuRel`. O que se vê na pré-visualização é o que a
// pessoa vê.
//
// Regra 3 da spec do menu (docs/ref-menu): nenhum item some pra quem usa hoje.
//   • Sem filtro por papel (padrão, e sempre pra gestão/admin) = menu completo.
//   • Com filtro, o que ficou de fora continua alcançável: o item "Outros
//     painéis" no fim do menu abre a grade com o resto, e todo link antigo
//     (#rel/disparos, #rel/exp-receitas…) continua abrindo a tela.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import type { ShellGroup, ShellItem } from "@/components/ui/AppShell";
import { Icon } from "@/components/ui/icons";

export type GrupoRel = "topo" | "atendimento" | "entre" | "posvenda" | "expedicoes" | "carteira" | "acompanhamento" | "supervisao";

/** Ordem fixa dos grupos; grupo vazio não aparece. */
export const GRUPOS_REL: { id: GrupoRel; rotulo?: string }[] = [
  { id: "topo" },
  { id: "atendimento", rotulo: "Atendimento" },
  { id: "entre", rotulo: "Entre setores" },
  { id: "posvenda", rotulo: "Pós-venda" },
  { id: "expedicoes", rotulo: "Expedições" },
  { id: "carteira", rotulo: "Carteira" },
  { id: "acompanhamento", rotulo: "Acompanhamento" },
  { id: "supervisao", rotulo: "Supervisão" },
];

export interface ItemRel {
  id: string;
  label: string;
  icon: ReactNode;
  grupo: GrupoRel;
  /** Uma linha pra grade "Outros painéis" e pro editor de menus por papel. */
  dica: string;
  /** false = não fica no menu completo (mora dentro da página Campanhas), mas
   *  um papel pode pôr no menu dele (ex.: Hunter com Recompra à mão). */
  noCompleto?: boolean;
  /** Quem pode ver: supervisão do Rel, quem cuida do time, quem vê os KPIs. */
  so?: "supervisao" | "time" | "kpis";
}

export const ITENS_REL: ItemRel[] = [
  { id: "inicio", label: "Início", icon: Icon.inicio, grupo: "topo", dica: "Resumo do dia" },
  { id: "esteira", label: "Minhas atividades", icon: Icon.check, grupo: "topo", dica: "Etapas das viagens que você cuida" },
  { id: "atendimento", label: "Conversas", icon: Icon.chat, grupo: "atendimento", dica: "WhatsApp com os clientes" },
  { id: "grupos", label: "Grupos", icon: Icon.pessoas, grupo: "atendimento", dica: "Grupos do WhatsApp das viagens" },
  { id: "chamados", label: "Chamados", icon: Icon.chamado, grupo: "atendimento", dica: "Problemas e reclamações em andamento" },
  { id: "solicitacoes", label: "Solicitações", icon: Icon.inbox, grupo: "entre", dica: "Pedidos que chegam dos outros setores" },
  { id: "propostas", label: "Propostas", icon: Icon.doc, grupo: "entre", dica: "Propostas pra aprovar e acompanhar" },
  { id: "viagens", label: "Viagens", icon: Icon.aviao, grupo: "posvenda", dica: "Todas as viagens vendidas" },
  { id: "prioridades", label: "Prioridades", icon: Icon.alerta, grupo: "posvenda", dica: "Pacotes prioritários e o check do dia" },
  { id: "alertas", label: "Alertas", icon: Icon.alerta, grupo: "posvenda", dica: "Passaporte vencendo, etapa atrasada…" },
  { id: "vendas", label: "Pipeline de vendas", icon: Icon.funil, grupo: "posvenda", dica: "Oportunidades de vender de novo pra base" },
  { id: "campanhas", label: "Campanhas", icon: Icon.disparo, grupo: "posvenda", dica: "Disparos, automações, pesquisas e recompra" },
  { id: "recompra", label: "Recompra", icon: Icon.recompra, grupo: "posvenda", dica: "Quem voltou e está pronto pra próxima", noCompleto: false },
  { id: "disparos", label: "Disparos e remarketing", icon: Icon.megafone, grupo: "posvenda", dica: "Mensagem em massa pra base", noCompleto: false },
  { id: "automacoes", label: "Automações", icon: Icon.cadencia, grupo: "posvenda", dica: "Mensagens que saem sozinhas", noCompleto: false },
  { id: "pesquisas", label: "Pesquisas", icon: Icon.pesquisa, grupo: "posvenda", dica: "Satisfação de quem voltou", noCompleto: false },
  { id: "exp-expedicoes", label: "Expedições", icon: Icon.mapa, grupo: "expedicoes", dica: "Grupos das expedições (só leitura)" },
  { id: "exp-pacotes", label: "Pacotes", icon: Icon.carteira, grupo: "expedicoes", dica: "Pacotes vendidos" },
  { id: "exp-inscricoes", label: "Inscrições", icon: Icon.inscricao, grupo: "expedicoes", dica: "Fichas de inscrição pra decidir" },
  { id: "exp-avisos", label: "Avisos das expedições", icon: Icon.megafone, grupo: "expedicoes", dica: "O que foi avisado aos passageiros" },
  { id: "clientes", label: "Clientes", icon: Icon.cliente, grupo: "carteira", dica: "Fichas dos clientes e arrumar cadastros" },
  { id: "agenda", label: "Agenda do time", icon: Icon.agenda, grupo: "acompanhamento", dica: "Compromissos de todo o time" },
  { id: "kpis", label: "Desempenho", icon: Icon.kpi, grupo: "acompanhamento", dica: "KPIs e prazo de resposta", so: "kpis" },
  { id: "faxina", label: "Faxina das viagens", icon: Icon.ferramenta, grupo: "supervisao", dica: "Viagens sem dono e filas de arrumação", so: "supervisao" },
  { id: "modelos", label: "Modelos de mensagem", icon: Icon.modelo, grupo: "supervisao", dica: "Respostas prontas do time", so: "supervisao" },
  { id: "equipe", label: "Time e cargos", icon: Icon.time, grupo: "supervisao", dica: "Quem é quem, o que recebe e o que vê", so: "time" },
];

/** Sempre no menu de todo mundo, com ou sem papel. */
export const BASE_REL = ["inicio", "esteira", "solicitacoes", "agenda"];

/** Itens que o gestor escolhe por papel (os da base e os da supervisão não entram). */
export const ESCOLHIVEIS_REL = ITENS_REL.filter((i) => !BASE_REL.includes(i.id) && i.so !== "supervisao" && i.so !== "time");

/** Item que abre a grade com o que não está no menu (só com filtro por papel). */
export const OUTROS_ID = "mais";

export interface Acesso { supervisao: boolean; verTime: boolean; verKpis: boolean }
export type Contagens = Partial<Record<string, { count?: number; late?: boolean; label?: string }>>;

const pode = (i: ItemRel, a: Acesso) =>
  i.so === "supervisao" ? a.supervisao : i.so === "time" ? a.verTime : i.so === "kpis" ? a.verKpis : true;

/** Itens que a pessoa vê no menu. `filtro` null = menu completo. */
export function itensDoMenu(a: Acesso, filtro: Set<string> | null): ItemRel[] {
  return ITENS_REL.filter((i) => pode(i, a) && (filtro
    ? BASE_REL.includes(i.id) || filtro.has(i.id) || i.so === "supervisao" || i.so === "time"
    : i.noCompleto !== false));
}

/** O que ficou fora do menu mas a pessoa pode abrir (a grade "Outros painéis"). */
export function itensDeFora(a: Acesso, filtro: Set<string> | null): ItemRel[] {
  const no = new Set(itensDoMenu(a, filtro).map((i) => i.id));
  // Os 4 de dentro de Campanhas só aparecem soltos se Campanhas também ficou de fora.
  const dentroDeCampanhas = no.has("campanhas");
  return ITENS_REL.filter((i) => pode(i, a) && !no.has(i.id) && !(dentroDeCampanhas && i.noCompleto === false));
}

/** Os grupos prontos pro AppShell. */
export function montarMenuRel(a: Acesso, filtro: Set<string> | null, cont: Contagens = {}): ShellGroup[] {
  const itens = itensDoMenu(a, filtro);
  const grupos: ShellGroup[] = GRUPOS_REL.map((g) => ({
    label: g.rotulo,
    items: itens.filter((i) => i.grupo === g.id).map((i): ShellItem => ({
      id: i.id, label: cont[i.id]?.label ?? i.label, icon: i.icon,
      count: cont[i.id]?.count || undefined, late: cont[i.id]?.late,
    })),
  })).filter((g) => g.items.length);
  if (filtro && itensDeFora(a, filtro).length) {
    grupos.push({ items: [{ id: OUTROS_ID, label: "Outros painéis", icon: Icon.mais }] });
  }
  return grupos;
}
