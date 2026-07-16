// src/lib/qs/cadenceSweep.ts
// -----------------------------------------------------------------------------
// FIM DE CADÊNCIA — aplica o que a tela de cadência promete (decisão do Bruno,
// auditoria 2026-07-16): quando o lead termina TODAS as atividades do plano sem
// virar ganho/perdido…
//   1. REDIRECIONAMENTO (redirect_cadence_id): o lead entra automaticamente na
//      cadência de destino (novas atividades criadas). Vence a perda.
//   2. PERDA AUTOMÁTICA (auto_loss_days): se também estourou o prazo em dias,
//      o lead vira "perdido" sozinho — e a perda é ESPELHADA NO BITRIX (mesmo
//      evento do perdido manual, via n8n).
// Antes, esses dois campos eram gravados no banco e NUNCA aplicados: fim de
// cadência era um beco sem saída (lead "em prospecção" eterno, fora da fila).
//
// Execução: no carregamento do app (SdrLayout), uma vez por sessão. Idempotente
// e com guarda de corrida (updates condicionados ao estado atual — se outra
// sessão tratou primeiro, o update afeta 0 linhas e nada duplica). O alcance
// segue a RLS: SDR varre os próprios leads; gestor/admin varre todos.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { notifyBitrix } from "./bitrixSync";
import { createCadenceTasks } from "./queries";

export interface SweepResult {
  redirected: number;
  lost: number;
}

interface SweepCadence {
  id: string;
  name: string;
  auto_loss_days: number | null;
  redirect_cadence_id: string | null;
}

interface SweepLead {
  id: string;
  full_name: string | null;
  bitrix_id: string | null;
  owner_id: string | null;
  cadence_id: string;
  cadence_started_at: string | null;
  arrived_at: string | null;
}

export async function sweepCadenceEndings(): Promise<SweepResult> {
  const result: SweepResult = { redirected: 0, lost: 0 };
  try {
    // 1. Cadências que têm alguma regra de fim configurada.
    const { data: cadences } = await supabase
      .from("qs_cadences")
      .select("id, name, auto_loss_days, redirect_cadence_id")
      .or("auto_loss_days.not.is.null,redirect_cadence_id.not.is.null");
    const rules = (cadences ?? []) as SweepCadence[];
    if (rules.length === 0) return result;
    const ruleById = new Map(rules.map((c) => [c.id, c]));

    // 2. Leads ativos nessas cadências.
    const { data: leadsData } = await supabase
      .from("qs_leads")
      .select("id, full_name, bitrix_id, owner_id, cadence_id, cadence_started_at, arrived_at")
      .in("cadence_id", rules.map((c) => c.id))
      .in("status", ["nao_iniciado", "em_prospeccao"])
      .limit(500);
    const leads = (leadsData ?? []) as SweepLead[];
    if (leads.length === 0) return result;

    // 3. Fim de plano = lead SEM nenhuma tarefa aberta.
    const { data: openTasks } = await supabase
      .from("qs_tasks")
      .select("lead_id")
      .in("lead_id", leads.map((l) => l.id))
      .in("status", ["pendente", "atrasada"]);
    const hasOpen = new Set(((openTasks ?? []) as { lead_id: string }[]).map((t) => t.lead_id));

    const now = Date.now();
    for (const lead of leads) {
      if (hasOpen.has(lead.id)) continue; // plano ainda em andamento — não mexe
      const rule = ruleById.get(lead.cadence_id);
      if (!rule) continue;

      // 3a. REDIRECIONAR (vence a perda): move pra cadência de destino.
      if (rule.redirect_cadence_id && rule.redirect_cadence_id !== lead.cadence_id) {
        const { data: updated } = await supabase
          .from("qs_leads")
          .update({
            cadence_id: rule.redirect_cadence_id,
            cadence_started_at: new Date().toISOString(),
            status: "em_prospeccao",
          })
          .eq("id", lead.id)
          .eq("cadence_id", lead.cadence_id) // guarda de corrida: outra sessão já moveu?
          .in("status", ["nao_iniciado", "em_prospeccao"])
          .select("id");
        if (!updated || updated.length === 0) continue;
        await createCadenceTasks(lead.id, rule.redirect_cadence_id, lead.owner_id ?? null);
        await supabase.from("qs_notes").insert({
          lead_id: lead.id,
          author_id: null,
          body: `🔁 Fim da cadência "${rule.name}" sem desfecho — lead redirecionado automaticamente para a próxima cadência.`,
          tags: ["bitrix", "cadencia", "redirecionamento"],
        });
        result.redirected++;
        continue;
      }

      // 3b. PERDA AUTOMÁTICA: terminou o plano E estourou o prazo em dias.
      if (rule.auto_loss_days && rule.auto_loss_days > 0) {
        const base = lead.cadence_started_at || lead.arrived_at;
        if (!base) continue;
        const days = Math.floor((now - new Date(base).getTime()) / 86_400_000);
        if (days < rule.auto_loss_days) continue; // ainda dentro do prazo
        const { data: updated } = await supabase
          .from("qs_leads")
          .update({ status: "perdido" }) // closed_at é gravado pelo trigger 0012
          .eq("id", lead.id)
          .in("status", ["nao_iniciado", "em_prospeccao"]) // guarda de corrida
          .select("id");
        if (!updated || updated.length === 0) continue;
        await supabase.from("qs_notes").insert({
          lead_id: lead.id,
          author_id: null,
          body: `⛔ Perda automática: ${days} dias na cadência "${rule.name}" sem desfecho (limite: ${rule.auto_loss_days}).`,
          tags: ["bitrix", "cadencia", "perda-automatica"],
        });
        // Espelha a perda no Bitrix (decisão do Bruno) — mesmo caminho do perdido manual.
        notifyBitrix("perdido", { lead_id: lead.id, bitrix_id: lead.bitrix_id, full_name: lead.full_name });
        result.lost++;
      }
    }
  } catch (e) {
    console.warn("[cadenceSweep] falha (não bloqueia o app):", (e as Error)?.message);
  }
  return result;
}
