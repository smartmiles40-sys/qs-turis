/**
 * Validação de CPF (com dígitos verificadores).
 * Usado no cadastro/importação de passageiros.
 */

/** Só os dígitos do CPF. */
export function soDigitosCpf(cpf: string | null | undefined): string {
  return (cpf ?? "").replace(/\D/g, "");
}

/**
 * Valida um CPF: 11 dígitos, não todos iguais, e dígitos verificadores corretos.
 */
export function cpfValido(cpf: string | null | undefined): boolean {
  const d = soDigitosCpf(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // 000... / 111... etc.

  const dv = (qtd: number): number => {
    let soma = 0;
    for (let i = 0; i < qtd; i++) soma += Number(d[i]) * (qtd + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Formata 11 dígitos como 000.000.000-00 (se válido em tamanho). */
export function formatarCpf(cpf: string | null | undefined): string {
  const d = soDigitosCpf(cpf);
  if (d.length !== 11) return cpf ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Máscara PROGRESSIVA pra digitação: vai formando 000.000.000-00 conforme digita. */
export function mascaraCpf(valor: string): string {
  const d = soDigitosCpf(valor).slice(0, 11);
  let out = d.slice(0, 3);
  if (d.length > 3) out += "." + d.slice(3, 6);
  if (d.length > 6) out += "." + d.slice(6, 9);
  if (d.length > 9) out += "-" + d.slice(9, 11);
  return out;
}
