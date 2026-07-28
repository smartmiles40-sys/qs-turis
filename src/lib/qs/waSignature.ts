// src/lib/qs/waSignature.ts
// -----------------------------------------------------------------------------
// A ASSINATURA DO SDR nas mensagens de WhatsApp — lado do navegador.
//
// O envio pelo atendimento nativo (/api/wa-send) é assinado no SERVIDOR, que é
// onde a regra vale de verdade: o navegador manda só o texto e quem diz quem
// está assinando é a sessão autenticada. Este arquivo existe para os caminhos
// que NÃO passam pelo servidor:
//
//   • o texto que o modal copia pra área de transferência (colar no ChatApp)
//   • o link wa.me com mensagem pré-preenchida
//
// A regra é a mesma dos dois lados — se mudar aqui, mude em `api/_wa.js`
// (`nomeCurto` / `assinarTexto`), senão o mesmo SDR assina diferente conforme o
// caminho que usar.
// -----------------------------------------------------------------------------

import { getSetting } from "@/lib/qsSettings";

export const WA_SIGNATURE_MAP_KEY = "wa_signature_names";
export const WA_SIGNATURE_ENABLED_KEY = "wa_signature_enabled";

const CONECTIVOS = new Set(["da", "de", "do", "das", "dos", "e"]);

/** "Victor Hugo Silva" → "Victor Hugo" · "Mariana de Souza" → "Mariana". */
export function nomeCurto(nomeCompleto: string | null | undefined): string {
  const partes = String(nomeCompleto ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "";
  if (partes.length > 1 && !CONECTIVOS.has(partes[1].toLowerCase())) {
    return `${partes[0]} ${partes[1]}`;
  }
  return partes[0];
}

/**
 * Põe o nome como primeira linha, em negrito do WhatsApp. Idempotente: texto que
 * já está assinado com o mesmo nome não ganha uma segunda assinatura.
 */
export function assinarTexto(text: string, nome: string): string {
  const corpo = String(text ?? "");
  const assinatura = String(nome ?? "").trim();
  if (!assinatura) return corpo;
  const primeiraLinha = corpo.split("\n", 1)[0].trim();
  if (primeiraLinha === `*${assinatura}*`) return corpo;
  return corpo ? `*${assinatura}*\n${corpo}` : `*${assinatura}*`;
}

/**
 * Como este usuário assina hoje. Devolve "" quando a assinatura está desligada
 * (ou quando o admin mapeou este usuário como "sem assinatura").
 */
export async function loadSignatureName(
  user: { id?: string | null; name?: string | null } | null | undefined
): Promise<string> {
  if (!user?.id) return "";
  const [ligada, mapa] = await Promise.all([
    getSetting<boolean>(WA_SIGNATURE_ENABLED_KEY),
    getSetting<Record<string, string>>(WA_SIGNATURE_MAP_KEY),
  ]);
  if (ligada === false) return "";
  const escolhido = mapa?.[user.id];
  if (typeof escolhido === "string") return escolhido.trim();
  return nomeCurto(user.name);
}
