// src/expedicoes/menu.ts
// Grupo "Expedições" do menu lateral (mesmos itens do app antigo, menos Câmbios).
// Fica fora do ExpedicoesArea pra o menu não puxar as telas pro pacote principal.
import { ICONES_AREA, type GrupoDoMenu } from "@/area/CascaDeArea";

export function grupoExpedicoes(contagens: { avisos?: number; inscricoes?: number } = {}): GrupoDoMenu {
  return {
    id: "expedicoes", rotulo: "Expedições", icone: ICONES_AREA.aviao, itens: [
      { id: "exp-inicio", rotulo: "Início" },
      { id: "avisos", rotulo: "Avisos", badge: contagens.avisos || undefined },
      { id: "expedicoes", rotulo: "Expedições" },
      { id: "pacotes", rotulo: "Pacotes" },
      { id: "passageiros", rotulo: "Passageiros" },
      { id: "clientes", rotulo: "Clientes & compras" },
      { id: "inscricoes", rotulo: "Inscrições", badge: contagens.inscricoes || undefined },
      { id: "fornecedores", rotulo: "Fornecedores" },
      { id: "acessos-amigo", rotulo: "Acessos ExpedAmigo" },
      { id: "exp-config", rotulo: "Usuários (Expedições)" },
    ],
  };
}
