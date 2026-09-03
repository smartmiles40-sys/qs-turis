// src/lib/qs/carteira.ts
// -----------------------------------------------------------------------------
// O RETRABALHO DA CARTEIRA: reiniciar um lead e a atividade que morre no dia.
//
// -- POR QUE A ATIVIDADE EXPIRA (Bruno, 01/09) -------------------------------
//
// Retrabalho é trabalho EXTRA — o que o SDR faz quando a fila do dia acabou.
// Se ele virasse dívida, a primeira semana de uso encheria a fila de todo mundo
// com um atraso que ninguém pediu, e a lição das 124 reuniões sem desfecho é
// exatamente essa: fila que não zera deixa de ser fila e vira ruído.
//
// Então a atividade nasce para HOJE e, se não for executada, fecha sozinha como
// `ignorada` na primeira abertura de tela do dia seguinte. O lead volta pra
// carteira inteiro e pode ser reiniciado outro dia.
//
// -- POR QUE A VARREDURA É NO CLIENTE ----------------------------------------
//
// Não há cron. Poderia haver — e o `wa-vigia` já mostrou o preço de depender de
// um agendador externo: ficou dois dias mudo sem ninguém perceber. A varredura
// aqui pega carona no tráfego real: é idempotente, custa um UPDATE filtrado, e
// só roda quando alguém abre a carteira, que é justamente quando o número
// importa. Se ninguém abre, não há quem esteja sendo enganado pelo atraso.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";
import { createCadenceTasks } from "@/lib/qs/queries";

/** Marca as atividades nascidas de retrabalho. É por ela que a varredura acha. */
export const TAG_RETRABALHO = "retrabalho";

/** Meia-noite de hoje no fuso do time (não no do navegador de quem abriu). */
function inicioDoDiaSP(): string {
  const agora = new Date();
  const emSP = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const meiaNoite = new Date(emSP);
  meiaNoite.setHours(0, 0, 0, 0);
  return new Date(agora.getTime() - (emSP.getTime() - meiaNoite.getTime())).toISOString();
}

/**
 * Fecha o retrabalho de ontem pra trás.
 *
 * `ignorada`, e não `concluida`: ninguém executou nada, e marcar como feito
 * mentiria no indicador de atividade — o mesmo erro que "cancelada" seria nas
 * reuniões arquivadas.
 *
 * Best-effort e silenciosa: é higiene de tela, não uma ação do usuário. Falhar
 * aqui não pode virar aviso pra quem só queria abrir a carteira.
 */
export async function varrerRetrabalhoVencido(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("qs_tasks")
      .update({ status: "ignorada", skip_reason: "retrabalho não executado no dia" })
      .contains("tags", [TAG_RETRABALHO])
      .in("status", ["pendente", "atrasada"])
      .lt("scheduled_at", inicioDoDiaSP())
      .select("id");
    if (error) return 0;
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

/**
 * Põe o lead numa cadência de novo, com as atividades caindo HOJE.
 *
 * A cadência é escolhida pelo SDR (não herdada): retrabalhar alguém que esfriou
 * há três meses não é a mesma abordagem de quando ele entrou, e obrigar a
 * repetir a cadência antiga seria repetir o que já não funcionou.
 */
export async function reiniciarLead(
  leadId: string,
  cadenceId: string,
  ownerId: string | null
): Promise<{ ok: true; tarefas: number } | { ok: false; error: string }> {
  try {
    // A cadência vai pro lead antes das tarefas: é ela que o resto do QS lê pra
    // saber em que fluxo a pessoa está (a Saúde da Cadência, o fim de cadência).
    const { error: eLead } = await supabase
      .from("qs_leads")
      .update({ cadence_id: cadenceId, status: "em_prospeccao", cadence_started_at: new Date().toISOString() })
      .eq("id", leadId);
    if (eLead) return { ok: false, error: `Não consegui atualizar o lead: ${eLead.message}` };

    const criadas = await createCadenceTasks(leadId, cadenceId, ownerId);
    if (!criadas) return { ok: false, error: "O lead foi reiniciado, mas as atividades não foram criadas." };

    // Duas coisas de uma vez, e as duas obrigatórias: puxar tudo pra HOJE (a
    // cadência espalha ao longo de dias, e retrabalho é uma sessão só) e marcar
    // com a tag, que é o que faz a varredura achar isso amanhã.
    const agora = new Date().toISOString();
    const ids = criadas.map((t) => t.id);
    if (ids.length) {
      const { error: eTags } = await supabase
        .from("qs_tasks")
        .update({ scheduled_at: agora, tags: ["cadencia", TAG_RETRABALHO], is_extra: true })
        .in("id", ids);
      if (eTags) {
        // As tarefas existem e estão na fila; o que se perde é a expiração —
        // elas virariam atraso amanhã. Melhor dizer do que deixar acontecer.
        return { ok: false, error: "As atividades foram criadas, mas não consegui marcá-las como retrabalho — avise a gestão, elas podem virar atraso." };
      }
    }
    return { ok: true, tarefas: ids.length };
  } catch (e: unknown) {
    return { ok: false, error: (e as { message?: string })?.message ?? "Falha ao reiniciar o lead." };
  }
}

/**
 * REINICIAR HOJE: um clique, sem escolher nada.
 *
 * Repete a cadência em que o lead JÁ ESTAVA. É o caso comum do retrabalho em
 * volume — "põe esses 30 na minha fila" — onde parar pra escolher a cadência 30
 * vezes é o que faz ninguém usar a tela.
 *
 * Sem cadência vinculada não há o que repetir, e aí a resposta é mandar pro
 * caminho que resolve (escolher uma), não um erro genérico.
 */
export async function reiniciarLeadHoje(
  leadId: string,
  ownerId: string | null
): Promise<{ ok: true; tarefas: number } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase
      .from("qs_leads")
      .select("cadence_id")
      .eq("id", leadId)
      .maybeSingle();
    if (error) return { ok: false, error: "Não consegui ler o lead: " + error.message };
    const cadenceId = (data as { cadence_id: string | null } | null)?.cadence_id ?? null;
    if (!cadenceId) {
      return { ok: false, error: 'Esse lead nunca esteve numa cadência — use "Reiniciar cadência" e escolha uma.' };
    }
    return reiniciarLead(leadId, cadenceId, ownerId);
  } catch (e: unknown) {
    return { ok: false, error: (e as { message?: string })?.message ?? "Falha ao reiniciar o lead." };
  }
}

/** O que aconteceu com cada lead de um lote. */
export interface ResultadoLote {
  reiniciados: number;
  tarefas: number;
  falhas: { leadId: string; nome: string | null; motivo: string }[];
}

/**
 * Reinicia vários leads. `cadenceId` null = cada um repete a própria cadência.
 *
 * Vai de 4 em 4, e não todos de uma vez: cada lead custa várias idas ao banco
 * (ler a cadência, criar as tarefas, marcar as tags), e 30 leads soltos em
 * paralelo viram perto de 90 requisições simultâneas — o Supabase começa a
 * recusar e o SDR recebe "falhou" num lead que estava perfeito.
 *
 * Falha de um NÃO derruba o lote: o retorno diz quantos entraram e lista, com
 * nome, quem ficou de fora e por quê. Lote que morre inteiro por causa de um
 * lead sem cadência seria pior que lote nenhum.
 */
export async function reiniciarEmLote(
  leads: { id: string; nome: string | null }[],
  cadenceId: string | null,
  ownerId: string | null,
  aoAvancar?: (feitos: number, total: number) => void
): Promise<ResultadoLote> {
  const out: ResultadoLote = { reiniciados: 0, tarefas: 0, falhas: [] };
  const LOTE = 4;
  let feitos = 0;

  for (let i = 0; i < leads.length; i += LOTE) {
    const fatia = leads.slice(i, i + LOTE);
    const rs = await Promise.all(
      fatia.map(async (l) => ({
        lead: l,
        r: cadenceId
          ? await reiniciarLead(l.id, cadenceId, ownerId)
          : await reiniciarLeadHoje(l.id, ownerId),
      }))
    );
    for (const { lead, r } of rs) {
      if (r.ok) { out.reiniciados++; out.tarefas += r.tarefas; }
      else out.falhas.push({ leadId: lead.id, nome: lead.nome, motivo: r.error });
    }
    feitos += fatia.length;
    aoAvancar?.(feitos, leads.length);
  }
  return out;
}

/**
 * Sorteia `quantidade` itens de uma lista.
 *
 * Fisher-Yates numa CÓPIA. `sort(() => Math.random() - 0.5)` é o embaralhamento
 * errado que todo mundo escreve: ele enviesa pro começo da lista, e aqui isso
 * significaria sortear quase sempre os mesmos leads — exatamente o oposto do
 * que o botão promete.
 */
export function sortear<T>(itens: T[], quantidade: number): T[] {
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, Math.max(0, quantidade));
}
