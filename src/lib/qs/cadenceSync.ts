// src/lib/qs/cadenceSync.ts
// -----------------------------------------------------------------------------
// APLICAR O PLANO NOS LEADS QUE JÁ ESTÃO NA CADÊNCIA.
//
// Como era até 18/08: as atividades nascem TODAS de uma vez, na entrada do lead
// — um retrato do plano naquele instante. Editar a cadência depois não mudava
// nada para quem já estava dentro; só valia para os próximos. Na prática o time
// ajustava o fluxo (acrescentava um toque, trocava um canal) e a fila continuava
// executando o plano antigo, sem ninguém perceber.
//
// Pedido do Bruno (18/08): "quando alteramos o fluxo da cadência, ela adicionar
// as atividades que atualizamos".
//
// COMO ISTO DECIDE O QUE FAZER
//
// Cada atividade do plano tem uma identidade estável: DIA + CANAL (a tarefa já
// carrega `tags: ["dia:N"]` desde 2026-07-24). Comparando essa chave com o que
// o lead já tem:
//
//   está no plano e o lead NÃO tem  → cria a atividade que faltava
//   o lead tem PENDENTE e saiu do plano → encerra (status "ignorada")
//   o lead JÁ CONCLUIU                 → não encosta. Trabalho feito é história.
//
// Três decisões que valem explicar:
//
// 1. NADA NASCE ATRASADO. Se o "Dia 3" de um lead que entrou há duas semanas já
//    passou, a atividade não é criada com data retroativa — ela cai no próximo
//    momento de expediente. Criar 400 tarefas vencidas de uma vez transformaria
//    a fila do dia numa parede vermelha, e o SDR perderia a régua do que é
//    realmente urgente.
//
// 2. SÓ LEAD VIVO. Ganho, perdido e quem não tem mais nada aberto ficam de fora:
//    ressuscitar atividade em lead fechado é criar trabalho que ninguém pediu.
//
// 3. ATIVIDADE AVULSA NUNCA É TOCADA (is_extra). Ela foi criada à mão, por
//    alguém, para aquele lead — não pertence ao plano.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { loadWorkHours, scheduleWeekdays, planCadenceDates, clampToWorkWindow, nextWorkMoment } from "@/lib/workHours";
import type { CadenceActivity, CadenceDay, PriorityLevel, TaskStatus } from "../../components/sdr/types";

/** O que a sincronização fez — vira a mensagem que o gestor lê no fim. */
export interface ResultadoSync {
  leads: number;
  criadas: number;
  encerradas: number;
  /** Das criadas, quantas caem HOJE — é o número que decide se dá pra tocar. */
  paraHoje: number;
  erro?: string;
}

/** Chave de identidade de uma atividade do plano dentro de um lead. */
function chave(dia: number, canal: string): string {
  return `${dia}|${canal}`;
}

function diaDaTag(tags: string[] | null): number | null {
  const t = (tags ?? []).find((x) => x.startsWith("dia:"));
  if (!t) return null;
  const n = Number(t.slice(4));
  return Number.isFinite(n) ? n : null;
}

/**
 * Conta quantos leads seriam afetados — usado para perguntar antes de aplicar.
 * Uma edição de plano pode encostar em centenas de filas; ninguém deve descobrir
 * isso depois de clicar.
 */
export async function contarLeadsAtivos(cadenceId: string): Promise<number> {
  const { count } = await supabase
    .from("qs_leads")
    .select("id", { count: "exact", head: true })
    .eq("cadence_id", cadenceId)
    .in("status", ["em_prospeccao", "nao_iniciado"]);
  return count ?? 0;
}

/**
 * Aplica o plano ATUAL da cadência em todos os leads vivos que estão nela.
 * Idempotente: rodar duas vezes seguidas não cria nada na segunda.
 */
export async function aplicarPlanoNosLeads(
  cadenceId: string,
  /**
   * true = só calcula e devolve os números, sem gravar nada.
   *
   * Existe porque a conta só aparece DEPOIS de comparar o plano com cada lead:
   * uma troca de dias (1,3,7,10 → 1,2,5,7) parece pequena na tela e significa 800
   * atividades novas em 160 filas. O gestor decide com o número na mão, não com
   * uma estimativa.
   */
  apenasSimular = false
): Promise<ResultadoSync> {
  const vazio: ResultadoSync = { leads: 0, criadas: 0, encerradas: 0, paraHoje: 0 };
  try {
    // ── 1. O plano de agora ────────────────────────────────────────────────
    const { data: days, error: eDays } = await supabase
      .from("qs_cadence_days")
      .select("*, activities:qs_cadence_activities(*)")
      .eq("cadence_id", cadenceId)
      .order("day_number");
    if (eDays) throw eDays;
    const dayList = (days ?? []) as (CadenceDay & { activities: CadenceActivity[] })[];
    // Plano sem atividade nenhuma: encerrar tudo deixaria os leads sem fila, o
    // que é pior do que não fazer nada. Sai sem tocar em ninguém.
    if (dayList.length === 0) return vazio;

    const { data: cadRow } = await supabase
      .from("qs_cadences")
      .select("execution_weekdays, offday_policy")
      .eq("id", cadenceId)
      .maybeSingle();
    const cad = cadRow as { execution_weekdays: number[] | null; offday_policy: string | null } | null;

    const wh = await loadWorkHours();
    const allowedWeekdays = scheduleWeekdays(wh, cad?.execution_weekdays ?? null);

    // Todas as atividades do plano, achatadas e com a chave de identidade.
    const doPlano = dayList.flatMap((d) =>
      [...(d.activities ?? [])]
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .map((a) => ({ dia: d.day_number ?? 1, act: a, k: chave(d.day_number ?? 1, a.channel_type) }))
    );
    const chavesDoPlano = new Set(doPlano.map((x) => x.k));

    // ── 2. Os leads vivos desta cadência ───────────────────────────────────
    const { data: leadsRaw, error: eLeads } = await supabase
      .from("qs_leads")
      .select("id, owner_id, cadence_started_at, arrived_at")
      .eq("cadence_id", cadenceId)
      .in("status", ["em_prospeccao", "nao_iniciado"]);
    if (eLeads) throw eLeads;
    const leads = (leadsRaw ?? []) as {
      id: string; owner_id: string | null; cadence_started_at: string | null; arrived_at: string | null;
    }[];
    if (leads.length === 0) return vazio;

    // ── 3. O que esses leads já têm (uma leitura só, em blocos) ────────────
    const existentes: { id: string; lead_id: string; channel_type: string; status: string; tags: string[] | null }[] = [];
    const ids = leads.map((l) => l.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("qs_tasks")
        .select("id, lead_id, channel_type, status, tags")
        .in("lead_id", ids.slice(i, i + 200))
        .eq("is_extra", false);
      if (error) throw error;
      existentes.push(...((data ?? []) as typeof existentes));
    }

    const porLead = new Map<string, typeof existentes>();
    for (const t of existentes) {
      const arr = porLead.get(t.lead_id) ?? [];
      arr.push(t);
      porLead.set(t.lead_id, arr);
    }

    // ── 4. Decidir, lead a lead ────────────────────────────────────────────
    const novas: Record<string, unknown>[] = [];
    const encerrar: string[] = [];
    const agora = Date.now();
    let tocados = 0;

    for (const lead of leads) {
      const tarefas = porLead.get(lead.id) ?? [];
      // Lead sem NADA aberto já terminou o plano — quem cuida dele é a varredura
      // de fim de cadência, não esta função. Mexer aqui o traria de volta à fila
      // sem ninguém ter pedido.
      const temAberta = tarefas.some((t) => t.status === "pendente" || t.status === "atrasada");
      if (!temAberta) continue;

      const jaTem = new Set<string>();
      for (const t of tarefas) {
        const d = diaDaTag(t.tags);
        if (d != null) jaTem.add(chave(d, t.channel_type));
      }

      // A régua de datas deste lead sai do dia em que ELE entrou na cadência.
      const base = new Date(lead.cadence_started_at ?? lead.arrived_at ?? new Date());
      const dateByDay = planCadenceDates(
        dayList.map((d) => d.day_number ?? 1),
        allowedWeekdays,
        cad?.offday_policy ?? null,
        base
      );

      let mexeu = false;

      // 4a. O que o plano tem e o lead não tem → criar.
      for (const item of doPlano) {
        if (jaTem.has(item.k)) continue;
        const quando = new Date(dateByDay.get(item.dia) ?? new Date());
        const [h, m] = (item.act.scheduled_time || "09:00").split(":").map(Number);
        quando.setHours(h || 9, m || 0, 0, 0);
        // Passou? Então é para agora (próximo momento de expediente) — nunca
        // retroativo. Ver a decisão 1 no cabeçalho.
        const final = quando.getTime() < agora
          ? nextWorkMoment(wh, new Date(agora))
          : clampToWorkWindow(wh, quando);
        novas.push({
          lead_id: lead.id,
          cadence_id: cadenceId,
          owner_id: lead.owner_id,
          channel_type: item.act.channel_type,
          priority: (!item.act.scheduled_time
            ? "baixa"
            : item.act.scheduled_time >= "12:30"
              ? "media"
              : "alta") as PriorityLevel,
          scheduled_at: final.toISOString(),
          status: "pendente" as TaskStatus,
          is_extra: false,
          tags: [`dia:${item.dia}`],
        });
        mexeu = true;
      }

      // 4b. O que o lead tem PENDENTE e saiu do plano → encerrar.
      for (const t of tarefas) {
        if (t.status !== "pendente" && t.status !== "atrasada") continue;
        const d = diaDaTag(t.tags);
        if (d == null) continue;                       // sem carimbo de dia: não é do plano
        if (chavesDoPlano.has(chave(d, t.channel_type))) continue;
        encerrar.push(t.id);
        mexeu = true;
      }

      if (mexeu) tocados++;
    }

    // ── 5. Gravar ──────────────────────────────────────────────────────────
    // Encerra ANTES de criar: se o insert falhar no meio, o lead fica com o
    // plano antigo parcialmente aberto — situação que o gestor enxerga na fila.
    // O contrário (criar e não conseguir encerrar) deixaria carga dobrada, que
    // é justamente o que a troca de plano deveria evitar.
    // Quantas das novas caem hoje — o número que diz se a fila do dia aguenta.
    const fimDeHoje = new Date(); fimDeHoje.setHours(23, 59, 59, 999);
    const paraHoje = novas.filter(
      (n) => new Date(String(n.scheduled_at)).getTime() <= fimDeHoje.getTime()
    ).length;

    if (apenasSimular) {
      return { leads: tocados, criadas: novas.length, encerradas: encerrar.length, paraHoje };
    }

    for (let i = 0; i < encerrar.length; i += 200) {
      const { error } = await supabase
        .from("qs_tasks")
        .update({ status: "ignorada", skip_reason: "Atividade saiu do plano da cadência" })
        .in("id", encerrar.slice(i, i + 200));
      if (error) throw error;
    }
    for (let i = 0; i < novas.length; i += 200) {
      const { error } = await supabase.from("qs_tasks").insert(novas.slice(i, i + 200));
      if (error) throw error;
    }

    return { leads: tocados, criadas: novas.length, encerradas: encerrar.length, paraHoje };
  } catch (err) {
    console.warn("[QS] aplicarPlanoNosLeads falhou:", err);
    return { ...vazio, erro: err instanceof Error ? err.message : "Falha ao aplicar o plano" };
  }
}
