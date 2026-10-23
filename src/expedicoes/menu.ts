// src/expedicoes/menu.ts
// Grupo "Expedições" do menu lateral (mesmos itens do app antigo, menos Câmbios).
// 23/10 (cadastro único): Passageiros (Clube), Clientes & compras e Acessos ExpedAmigo
// saíram daqui — viraram abas da FICHA do cliente (grupo "Clientes" do OpsApp). As
// telas continuam no endereço antigo pra link salvo não quebrar. "Usuários
// (Expedições)" é a equipe, não cliente: foi pro grupo Time.
// Fica fora do ExpedicoesArea pra o menu não puxar as telas pro pacote principal.
import { ICONES_AREA, type GrupoDoMenu } from "@/area/CascaDeArea";

export function grupoExpedicoes(contagens: { avisos?: number; inscricoes?: number } = {}): GrupoDoMenu {
  return {
    id: "expedicoes", rotulo: "Expedições", icone: ICONES_AREA.aviao, itens: [
      { id: "exp-inicio", rotulo: "Início" },
      { id: "avisos", rotulo: "Avisos", badge: contagens.avisos || undefined },
      { id: "expedicoes", rotulo: "Expedições" },
      { id: "pacotes", rotulo: "Pacotes" },
      { id: "inscricoes", rotulo: "Inscrições", badge: contagens.inscricoes || undefined },
      { id: "fornecedores", rotulo: "Fornecedores" },
    ],
  };
}
