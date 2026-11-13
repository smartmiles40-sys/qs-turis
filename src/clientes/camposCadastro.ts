// src/clientes/camposCadastro.ts
// -----------------------------------------------------------------------------
// Rótulos e formatação dos campos do cadastro único que podem divergir entre a
// ficha (rel_clientes) e a ida (passageiros). Puro (sem supabase) pra poder ser
// testado; cadastroUnico.ts reexporta tudo daqui.
//
// 'nome' entrou com a migration 0379 (o nome também é sincronizado). Antes dela o
// banco nunca devolve campo = 'nome' — o rótulo só fica sem uso.
// -----------------------------------------------------------------------------

export type CampoDivergente = "pessoa" | "cpf" | "passaporte" | "passaporte_validade" | "nascimento" | "email" | "telefone" | "nome";

export const NOME_CAMPO: Record<CampoDivergente, string> = {
  pessoa: "Pessoa", cpf: "CPF", passaporte: "Passaporte", passaporte_validade: "Validade do passaporte",
  nascimento: "Nascimento", email: "E-mail", telefone: "Telefone", nome: "Nome",
};

/** Rótulo de um campo vindo do banco; campo desconhecido aparece cru em vez de "undefined". */
export function rotuloCampo(campo: string): string {
  return (NOME_CAMPO as Record<string, string>)[campo] ?? campo;
}

/** Mostra um valor de divergência de forma legível (datas em dd/mm/aaaa). */
export function valorLegivel(campo: CampoDivergente, v: string | null): string {
  if (!v) return "—";
  if ((campo === "nascimento" || campo === "passaporte_validade") && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [a, m, d] = v.split("-"); return `${d}/${m}/${a}`;
  }
  if (campo === "cpf" && /^\d{11}$/.test(v)) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v;
}
