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
//   3. SEM REGRA NENHUMA (sprint 2026-07-24): a cadência é ENCERRADA DE VERDADE
//      mesmo assim — o lead ganha uma nota "🏁 Fim de cadência" (uma vez só) e
//      aparece no painel de Saúde da Cadência como "plano concluído, aguardando
//      decisão". Antes esse era o beco sem saída: lead "em prospecção" eterno,
//      invisível na fila, sem ninguém saber que a cadência tinha acabado.
//
// Execução: no carregamento do app (SdrLayout), uma vez por sessão. Idempotente
// e com guarda de corrida (updates condicionados ao estado atual — se outra
// sessão tratou primeiro, o update afeta 0 linhas e nada duplica). O alcance
// segue a RLS: SDR varre os próprios leads; gestor/admin varre todos.
//
// CONGELAR pausa este motor (Sprint 4): cadência congelada (ou rascunho) não
// dispara redirecionamento nem perda automática — congelar = pausar a cadência
// sem mexer nas tarefas já criadas. E o DESTINO do redirecionamento precisa
// estar "disponivel": destino congelado não recebe lead novo — o lead espera
// (sem cair na perda, porque o redirecionamento configurado vence a perda) até
// o destino ser retomado.
//
// PAGINAÇÃO (fix 2026-07-24, P1): as consultas de leads e de tarefas abertas
// usam fetchAllRows + ordem estável. Antes, o teto de 1000 linhas do PostgREST
// cortava a lista de tarefas abertas e o motor podia REDIRECIONAR ou PERDER um
// lead que ainda tinha atividades pendentes (as tarefas dele tinham ficado fora
// do corte). Com volume de admin isso era questão de tempo.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { notifyBitrix } from "./bitrixSync";
import { createCadenceTasks, fetchAllRows } from "./queries";

export interface SweepResult {
  redirected: number;
  lost: number;
  /** Planos concluídos SEM regra de fim — encerrados com nota, aguardando decisão humana. */
  finished: number;
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

/** Fatia um array em blocos de `size` (o `.in()` do PostgREST vira URL — não pode crescer sem limite). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function sweepCadenceEndings(): Promise<SweepResult> {
  const result: SweepResult = { redirected: 0, lost: 0, finished: 0 };
  try {
    // 1. TODAS as cadências disponíveis — as sem regra também entram (fim de
    //    plano sem regra agora é encerrado com nota, não limbo). Congelada/
    //    rascunho = motor pausado (semântica do Congelar, Sprint 4).
    const { data: cadences, error: cadErr } = await supabase
      .from("qs_cadences")
      .select("id, name, auto_loss_days, redirect_cadence_id")
      .eq("status", "disponivel");
    if (cadErr) throw cadErr;
    const rules = (cadences ?? []) as SweepCadence[];
    if (rules.length === 0) return result;
    const ruleById = new Map(rules.map((c) => [c.id, c]));

    // 1b. Status dos DESTINOS de redirecionamento (podem não estar em `rules`):
    //     destino que não está "disponivel" não recebe lead novo.
    const redirectIds = Array.from(
      new Set(rules.map((c) => c.redirect_cadence_id).filter(Boolean))
    ) as string[];
    let redirectStatus = new Map<string, string>();
    if (redirectIds.length > 0) {
      const { data: targets } = await supabase
        .from("qs_cadences")
        .select("id, status")
        .in("id", redirectIds);
      redirectStatus = new Map(
        ((targets ?? []) as { id: string; status: string }[]).map((t) => [t.id, t.status])
      );
    }

    // 2. Leads ativos nessas cadências — paginado com ordem estável (sem o
    //    antigo .limit(500) não-determinístico).
    const cadenceIds = rules.map((c) => c.id);
    const leads: SweepLead[] = [];
    for (const ids of chunk(cadenceIds, 100)) {
      const rows = await fetchAllRows<SweepLead>((from, to) =>
        supabase
          .from("qs_leads")
          .select("id, full_name, bitrix_id, owner_id, cadence_id, cadence_started_at, arrived_at")
          .in("cadence_id", ids)
          .in("status", ["nao_iniciado", "em_prospeccao"])
          .order("id")
          .range(from, to)
      );
      leads.push(...rows);
    }
    if (leads.length === 0) return result;

    // 3. Fim de plano = lead SEM nenhuma tarefa aberta. Paginado + em blocos:
    //    é ESTA lista que, cortada no teto de 1000, fazia o motor "perder" lead
    //    com atividade pendente.
    const hasOpen = new Set<string>();
    for (const ids of chunk(leads.map((l) => l.id), 100)) {
      const rows = await fetchAllRows<{ lead_id: string }>((from, to) =>
        supabase
          .from("qs_tasks")
          .select("lead_id")
          .in("lead_id", ids)
          .in("status", ["pendente", "atrasada"])
          .order("id")
          .range(from, to)
      );
      for (const r of rows) hasOpen.add(r.lead_id);
    }

    const done = leads.filter((l) => !hasOpen.has(l.id));
    if (done.length === 0) return result;

    // 3a'. Idempotência do "fim sem regra": quem já tem a nota 🏁 não ganha outra.
    const alreadyFinished = new Set<string>();
    for (const ids of chunk(done.map((l) => l.id), 100)) {
      const { data: prevNotes } = await supabase
        .from("qs_notes")
        .select("lead_id")
        .in("lead_id", ids)
        .contains("tags", ["fim-cadencia"]);
      for (const n of (prevNotes ?? []) as { lead_id: string }[]) alreadyFinished.add(n.lead_id);
    }

    const now = Date.now();
    for (const lead of done) {
      const rule = ruleById.get(lead.cadence_id);
      if (!rule) continue;

      // 3a. REDIRECIONAR (vence a perda): move pra cadência de destino.
      if (rule.redirect_cadence_id && rule.redirect_cadence_id !== lead.cadence_id) {
        // Destino congelado/rascunho NÃO recebe lead novo: o lead ESPERA (não
        // redireciona nem cai na perda automática — o redirecionamento
        // configurado vence a perda). Quando o destino for retomado, o próximo
        // sweep move normalmente.
        if (redirectStatus.get(rule.redirect_cadence_id) !== "disponivel") continue;
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
        const created = await createCadenceTasks(lead.id, rule.redirect_cadence_id, lead.owner_id ?? null);
        if (created === null) {
          // Geração falhou (fix 2026-07-24): sem isso o lead ficava "em
          // prospecção" na cadência nova com ZERO atividades — órfão fora da
          // fila. Reverte o vínculo pro estado anterior e tenta no próximo sweep.
          await supabase
            .from("qs_leads")
            .update({ cadence_id: lead.cadence_id, cadence_started_at: lead.cadence_started_at })
            .eq("id", lead.id)
            .eq("cadence_id", rule.redirect_cadence_id);
          console.warn("[cadenceSweep] redirecionamento revertido (tasks não criadas):", lead.id);
          continue;
        }
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
        continue;
      }

      // 3c. SEM REGRA (2026-07-24): encerra a cadência DE VERDADE — nota única
      //     "🏁" pro lead sair do limbo e aparecer como "aguardando decisão" na
      //     Saúde da Cadência. Ninguém perde/ganha sozinho: a decisão é humana.
      if (alreadyFinished.has(lead.id)) continue;
      const { error: noteErr } = await supabase.from("qs_notes").insert({
        lead_id: lead.id,
        author_id: null,
        body: `🏁 Fim da cadência "${rule.name}" sem desfecho — todas as atividades do plano foram concluídas. Decida: ganho, perdido ou vincular a uma nova cadência.`,
        tags: ["cadencia", "fim-cadencia"],
      });
      if (!noteErr) result.finished++;
    }
  } catch (e) {
    console.warn("[cadenceSweep] falha (não bloqueia o app):", (e as Error)?.message);
  }
  return result;
}
