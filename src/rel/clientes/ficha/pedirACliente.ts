// src/rel/clientes/ficha/pedirACliente.ts
// -----------------------------------------------------------------------------
// "Pedir" e "Pedir tudo à cliente" da ficha (spec 29/10, bloco "Pronta para
// embarcar?"): viram uma SOLICITAÇÃO pro Relacionamento, tipo "Falar com o
// cliente" (rel_contato, 0149), já ligada a esta ficha. Quem pega o pedido é a
// distribuição automática do banco — aqui não se escolhe responsável.
// Reaproveita criarSolicitacao (RPC qs_sol_criar), a mesma da Central.
// -----------------------------------------------------------------------------
import { criarSolicitacao, type Setor } from "@/solicitacoes/lib";

/** O tipo "Falar com o cliente" do Relacionamento (seed da 0149). */
export const TIPO_FALAR_COM_CLIENTE = "rel_contato";

/** Item do cadastro que dá pra pedir. `oQue` entra no título: "Solicitar <oQue> de Fulana". */
export interface ItemPedivel { chave: string; oQue: string; dica?: string }

export const ITENS_PEDIVEIS: Record<string, ItemPedivel> = {
  cpf: { chave: "cpf", oQue: "o CPF" },
  telefone: { chave: "telefone", oQue: "o telefone" },
  email: { chave: "email", oQue: "o e-mail" },
  nascimento: { chave: "nascimento", oQue: "a data de nascimento", dica: "necessária para emitir passagem" },
  passaporte: { chave: "passaporte", oQue: "o número do passaporte" },
  passaporte_validade: { chave: "passaporte_validade", oQue: "a validade do passaporte", dica: "mínimo de 6 meses após a volta" },
  doc_passaporte: { chave: "doc_passaporte", oQue: "a foto do passaporte", dica: "frente legível, sem reflexo" },
  endereco: { chave: "endereco", oQue: "o endereço", dica: "entra no contrato e no envio de kits" },
  lgpd: { chave: "lgpd", oQue: "o aceite do termo LGPD", dica: "termo de uso de dados e comunicação" },
};

function erroAmigavel(e: unknown, deSetor: Setor): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  // qs_sol_criar recusa pedido pro próprio setor (de = para). Quem está no
  // Relacionamento pedindo ao Relacionamento cai aqui até o banco aceitar.
  if (/outro setor/i.test(msg) && deSetor === "relacionamento") {
    return "O banco ainda não aceita pedido do Relacionamento para o próprio Relacionamento. Use \"Pedir a outro setor\" ou fale direto com a cliente.";
  }
  if (/Tipo de pedido inválido/i.test(msg)) return "O tipo \"Falar com o cliente\" está desligado em Tipos e prazos do Relacionamento.";
  return msg || "Não consegui criar o pedido.";
}

/** Um item faltando → uma solicitação. Devolve o id criado. */
export async function pedirItem(p: { clienteId: string; nome: string; deSetor: Setor; item: ItemPedivel }): Promise<string> {
  const primeiro = p.nome.split(/\s+/)[0] || p.nome;
  try {
    return await criarSolicitacao({
      de: p.deSetor, para: "relacionamento", tipo: TIPO_FALAR_COM_CLIENTE, prioridade: "normal",
      titulo: `Solicitar ${p.item.oQue} de ${primeiro}`,
      descricao: `Falta ${p.item.oQue} no cadastro de ${p.nome}.${p.item.dica ? ` (${p.item.dica})` : ""}\nPedido criado pela ficha do cliente — "Pronta para embarcar?".`,
      clienteId: p.clienteId, sobre: p.nome,
    });
  } catch (e) { throw new Error(erroAmigavel(e, p.deSetor)); }
}

/** Tudo que falta → UMA solicitação com a lista (não enche a fila com 7 pedidos). */
export async function pedirTudo(p: { clienteId: string; nome: string; deSetor: Setor; itens: ItemPedivel[] }): Promise<string> {
  if (!p.itens.length) throw new Error("Não falta nada para pedir.");
  if (p.itens.length === 1) return pedirItem({ ...p, item: p.itens[0] });
  const primeiro = p.nome.split(/\s+/)[0] || p.nome;
  try {
    return await criarSolicitacao({
      de: p.deSetor, para: "relacionamento", tipo: TIPO_FALAR_COM_CLIENTE, prioridade: "normal",
      titulo: `Solicitar ${p.itens.length} dados que faltam de ${primeiro}`,
      descricao: `Falta no cadastro de ${p.nome}:\n${p.itens.map((i) => `• ${i.oQue}${i.dica ? ` (${i.dica})` : ""}`).join("\n")}\n\nPedido criado pela ficha do cliente — "Pedir tudo à cliente".`,
      clienteId: p.clienteId, sobre: p.nome,
    });
  } catch (e) { throw new Error(erroAmigavel(e, p.deSetor)); }
}
