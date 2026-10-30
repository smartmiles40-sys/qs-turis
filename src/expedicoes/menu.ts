// src/expedicoes/menu.ts
// Grupo "Expedições" do menu lateral (mesmos itens do app antigo, menos Câmbios).
// 23/10 (cadastro único): Passageiros (Clube), Clientes & compras e Acessos ExpedAmigo
// saíram daqui — viraram abas da FICHA do cliente (grupo "Clientes" do OpsApp). As
// telas continuam no endereço antigo pra link salvo não quebrar. "Usuários
// (Expedições)" é a equipe, não cliente: foi pro grupo Time.
// Fica fora do ExpedicoesArea pra o menu não puxar as telas pro pacote principal.
import { ICONES_AREA, type GrupoDoMenu } from "@/area/CascaDeArea";

export function grupoExpedicoes(contagens: { avisos?: number; inscricoes?: number; receitas?: number } = {}): GrupoDoMenu {
  return {
    id: "expedicoes", rotulo: "Expedições", icone: ICONES_AREA.aviao, itens: [
      // Redesign (out/2026): o "Início" das expedições virou o Início de Operações
      // (topo do menu) e a ordem segue o HANDOFF.md.
      { id: "expedicoes", rotulo: "Expedições" },
      { id: "pacotes", rotulo: "Pacotes" },
      { id: "inscricoes", rotulo: "Inscrições", badge: contagens.inscricoes || undefined },
      { id: "avisos", rotulo: "Avisos", badge: contagens.avisos || undefined },
      // 29/10 (Carol): receitas a enviar — conta só as que já estão na janela de 20 dias
      { id: "receitas", rotulo: "Receitas", badge: contagens.receitas || undefined, alerta: true },
      { id: "fornecedores", rotulo: "Fornecedores" },
      // 30/10: "Checklist padrão" saiu do menu — virou a aba Checklist do cockpit
      // (botão "Editar o padrão"). O endereço #ops/checklist-padrao redireciona.
    ],
  };
}
