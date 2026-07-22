// src/lib/qs/channels.ts
// -----------------------------------------------------------------------------
// Canais de contato HABILITADOS (Configurações → Canais de Contato).
//
// O admin liga/desliga canais em qs_channel_config. Este helper resolve o
// conjunto EFETIVO de canais disponíveis pra CRIAR atividade (cadência + extra):
// um canal aparece a menos que exista uma linha explícita `enabled = false`.
//
// FAIL-OPEN: se a leitura falhar (tabela ausente, RLS, rede), devolve TODOS os
// canais. Nunca deixa o SDR sem opção de canal por causa de um erro de config.
// Os defaults abaixo espelham a tela de Configurações (redes sociais nascem
// desligadas; os canais de trabalho, ligados) — mesma verdade nos dois lados.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import type { ChannelType } from "@/components/sdr/types";

export const ALL_CHANNELS: ChannelType[] = [
  "pesquisa", "email", "ligacao", "ligacao_whatsapp", "whatsapp",
  "linkedin", "instagram", "tiktok", "youtube",
];

// Estado padrão de cada canal quando o admin NUNCA mexeu (sem linha no banco).
// Bate 1:1 com os defaults da CanaisSection em Configurações.
export const CHANNEL_DEFAULT_ENABLED: Record<ChannelType, boolean> = {
  pesquisa: true,
  email: true,
  ligacao: true,
  ligacao_whatsapp: true,
  whatsapp: true,
  linkedin: true,
  instagram: false,
  tiktok: false,
  youtube: false,
};

/**
 * Conjunto de canais habilitados = default de cada canal, SOBRESCRITO pelas
 * linhas explícitas de qs_channel_config. Em erro de leitura → todos habilitados.
 */
export async function fetchEnabledChannels(): Promise<Set<ChannelType>> {
  const enabled = new Set<ChannelType>(
    ALL_CHANNELS.filter((c) => CHANNEL_DEFAULT_ENABLED[c])
  );
  try {
    const { data, error } = await supabase.from("qs_channel_config").select("type, enabled");
    if (error) throw error;
    for (const row of (data ?? []) as { type: ChannelType; enabled: boolean }[]) {
      if (!ALL_CHANNELS.includes(row.type)) continue;
      if (row.enabled) enabled.add(row.type);
      else enabled.delete(row.type);
    }
  } catch (e) {
    // Fail-open: erro de config não pode esconder canal do SDR.
    console.warn("[channels] fetchEnabledChannels — usando todos (fail-open):", e);
    return new Set<ChannelType>(ALL_CHANNELS);
  }
  return enabled;
}
