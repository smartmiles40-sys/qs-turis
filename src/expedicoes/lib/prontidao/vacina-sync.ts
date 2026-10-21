/**
 * Vacina é UNIVERSAL da pessoa: o Certificado de Febre Amarela vale para todas as
 * expedições dela. O requisito "Vacina", porém, é uma instância POR expedição
 * (`passageiro_requisitos`), porque cada destino pode exigir ou dispensar a vacina.
 *
 * Este helper concilia os dois: espalha o certificado da pessoa (por CPF) para o
 * slot "Vacina" de TODAS as linhas dela — respeitando decisões por expedição.
 *
 * Regras (conservadoras — nunca sobrescreve decisão do time):
 *  - Só preenche slot VAZIO (sem `arquivo_id`).
 *  - Não toca em "Dispensado" (destino não exige) nem "Reprovado".
 *  - Preenche o arquivo e marca "Enviado" (mantém "Aprovado" se já estava).
 *
 * O `arquivo` já é 1 por pessoa (mesmo id apontado em várias linhas); não duplica.
 */
import { formatarCpf } from "@/expedicoes/lib/cpf";

// Aceita o client de service-role (admin) ou o de sessão (ssr) — ambos com schema
// não-tipado aqui; a query é simples e validada em runtime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export async function espalharCertificadoVacina(
  sb: Cliente,
  cpf: string | null | undefined,
  certIdPreferido?: string | null,
): Promise<{ atualizados: number; certId: string | null }> {
  const digitos = (cpf ?? "").replace(/\D/g, "");
  if (digitos.length !== 11) return { atualizados: 0, certId: null };

  const client = sb as Cliente;
  // A coluna `cpf` é gravada ora como dígitos, ora formatada (000.000.000-00) —
  // casar só por dígitos deixava a herança de vacina passar batido. Casa as duas formas.
  const variantes = [...new Set([digitos, formatarCpf(digitos)])];
  const { data: pxs } = await client.from("passageiros").select("id").in("cpf", variantes);
  const ids = ((pxs ?? []) as { id: string }[]).map((p) => p.id);
  if (!ids.length) return { atualizados: 0, certId: null };

  const { data: reqData } = await client
    .from("passageiro_requisitos")
    .select("id, arquivo_id, status")
    .in("passageiro_id", ids)
    .eq("tipo", "Vacina");
  const reqs = (reqData ?? []) as { id: string; arquivo_id: string | null; status: string }[];

  // Certificado da pessoa: o preferido (recém-anexado), senão o que já estiver num
  // slot de vacina, senão o arquivo solto "Febre Amarela" vinculado a alguma linha.
  let certId = certIdPreferido ?? reqs.find((r) => r.arquivo_id)?.arquivo_id ?? null;
  if (!certId) {
    const { data: arqs } = await client
      .from("arquivos")
      .select("id")
      .in("passageiro_id", ids)
      .ilike("descricao", "%Febre Amarela%")
      .limit(1);
    certId = ((arqs ?? []) as { id: string }[])[0]?.id ?? null;
  }
  if (!certId) return { atualizados: 0, certId: null };

  let atualizados = 0;
  for (const r of reqs) {
    if (r.arquivo_id) continue;
    if (r.status === "Dispensado" || r.status === "Reprovado") continue;
    const { error } = await client
      .from("passageiro_requisitos")
      .update({ arquivo_id: certId, status: r.status === "Aprovado" ? "Aprovado" : "Enviado" })
      .eq("id", r.id);
    if (!error) atualizados++;
  }
  return { atualizados, certId };
}
