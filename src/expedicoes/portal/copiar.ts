// src/expedicoes/portal/copiar.ts
// "Copiar de outra expedição" (Bruno, 29/10: "deixa de uma forma de
// preenchimento mais fácil"). Informações do destino e Avisos se repetem quase
// iguais de uma edição pra outra (Egito 09 → Egito 10, Japão & China G1 → G2…),
// e era tudo redigitado. Aqui o conteúdo de uma expedição vira o ponto de
// partida da outra — depois é só ajustar.
//
// Regras:
//  · só ACRESCENTA (nunca apaga nem sobrescreve o que já está na expedição);
//  · anexos (PDFs, vouchers, fotos) NÃO vêm: o arquivo é de outra expedição e
//    o voucher de uma não serve pra outra. O resultado diz quantos ficaram de fora;
//  · roteiro só copia se a expedição ainda não tem nenhum dia (senão duplicaria),
//    com as datas recalculadas a partir do embarque desta;
//  · extensões copiadas levam junto o vínculo dos dias do roteiro com elas;
//  · voos não copiam (datas, números e localizadores são de cada edição).
import { addDays, format, parseISO } from "date-fns";
import { supabase, lerTudo, traduzirErro } from "../lib/banco";
import type { ExpedicaoAvisoRow, ExpedicaoInfoRow, ExpedicaoPasseioRow, ExtensaoRow, RoteiroDiaRow } from "../lib/database";

export type PedacoCopia = "info" | "avisos" | "passeios" | "extensoes" | "roteiro";

export const PEDACOS_COPIA: { id: PedacoCopia; rotulo: string; dica: string }[] = [
  { id: "info", rotulo: "Informações do destino", dica: "moeda, clima, tomadas, vistos…" },
  { id: "avisos", rotulo: "Avisos e boas práticas", dica: "" },
  { id: "passeios", rotulo: "Passeios e ingressos", dica: "sem data — ajuste depois" },
  { id: "extensoes", rotulo: "Extensões", dica: "sem o voucher da hospedagem" },
  { id: "roteiro", rotulo: "Roteiro dia a dia", dica: "só se esta ainda não tem dias; datas a partir do embarque" },
];

export interface ResumoOrigem { info: number; avisos: number; passeios: number; extensoes: number; roteiro: number }

export interface ResultadoCopia {
  copiados: Partial<Record<PedacoCopia, number>>;
  /** Itens que tinham anexo na origem (o anexo não veio). */
  semAnexo: number;
  /** Motivo de um pedaço não ter sido copiado. */
  pulados: { pedaco: PedacoCopia; motivo: string }[];
}

const daExp = (id: string) => (q: any) => q.eq("expedicao_id", id); // eslint-disable-line @typescript-eslint/no-explicit-any

/** Quanto conteúdo cada expedição tem (pra sugerir de onde copiar). */
export async function resumoDoPortal(ids: string[]): Promise<Map<string, ResumoOrigem>> {
  const m = new Map<string, ResumoOrigem>(ids.map((id) => [id, { info: 0, avisos: 0, passeios: 0, extensoes: 0, roteiro: 0 }]));
  if (!ids.length) return m;
  const contar = async (tabela: string, chave: keyof ResumoOrigem) => {
    const linhas = await lerTudo<{ expedicao_id: string }>(tabela, (q) => q.in("expedicao_id", ids), "expedicao_id");
    for (const l of linhas) { const r = m.get(l.expedicao_id); if (r) r[chave]++; }
  };
  await Promise.all([
    contar("expedicao_info", "info"), contar("expedicao_avisos", "avisos"), contar("expedicao_passeios", "passeios"),
    contar("extensoes", "extensoes"), contar("roteiro_dias", "roteiro"),
  ]);
  return m;
}

async function proximaOrdem(tabela: string, expedicaoId: string): Promise<number> {
  const { data } = await supabase.from(tabela).select("ordem").eq("expedicao_id", expedicaoId).order("ordem", { ascending: false }).limit(1);
  return ((data?.[0] as { ordem: number } | undefined)?.ordem ?? -1) + 1;
}

async function inserir(tabela: string, linhas: Record<string, unknown>[]): Promise<{ id: string }[]> {
  if (!linhas.length) return [];
  const { data, error } = await supabase.from(tabela).insert(linhas).select("id");
  if (error) throw new Error(traduzirErro(error.message));
  return (data ?? []) as { id: string }[];
}

const porOrdem = <T extends { ordem: number; created_at: string }>(a: T, b: T) => a.ordem - b.ordem || a.created_at.localeCompare(b.created_at);

export async function copiarPortal(origemId: string, destino: { id: string; data_embarque: string | null }, pedacos: PedacoCopia[]): Promise<ResultadoCopia> {
  const quer = new Set(pedacos);
  const res: ResultadoCopia = { copiados: {}, semAnexo: 0, pulados: [] };
  const o = daExp(origemId);

  // Extensões primeiro: o roteiro copiado precisa do id novo de cada uma.
  const novaExtensao = new Map<string, string>();
  if (quer.has("extensoes")) {
    const ext = (await lerTudo<ExtensaoRow>("extensoes", o)).sort(porOrdem);
    const base = await proximaOrdem("extensoes", destino.id);
    const ids = await inserir("extensoes", ext.map((e, i) => ({ expedicao_id: destino.id, ordem: base + i, nome: e.nome, descricao: e.descricao })));
    ext.forEach((e, i) => { if (ids[i]) novaExtensao.set(e.id, ids[i].id); });
    res.semAnexo += ext.filter((e) => e.hospedagem_voucher_arquivo_id).length;
    res.copiados.extensoes = ids.length;
  }

  if (quer.has("info")) {
    const info = (await lerTudo<ExpedicaoInfoRow>("expedicao_info", o)).sort(porOrdem);
    const base = await proximaOrdem("expedicao_info", destino.id);
    res.copiados.info = (await inserir("expedicao_info", info.map((x, i) => ({ expedicao_id: destino.id, ordem: base + i, titulo: x.titulo, conteudo: x.conteudo })))).length;
    res.semAnexo += info.filter((x) => x.arquivo_id || x.arquivo_id_2).length;
  }

  if (quer.has("avisos")) {
    const av = (await lerTudo<ExpedicaoAvisoRow>("expedicao_avisos", o)).sort(porOrdem);
    const base = await proximaOrdem("expedicao_avisos", destino.id);
    res.copiados.avisos = (await inserir("expedicao_avisos", av.map((x, i) => ({ expedicao_id: destino.id, ordem: base + i, tipo: x.tipo ?? "Aviso", titulo: x.titulo, conteudo: x.conteudo })))).length;
  }

  if (quer.has("passeios")) {
    const ps = (await lerTudo<ExpedicaoPasseioRow>("expedicao_passeios", o)).sort(porOrdem);
    const base = await proximaOrdem("expedicao_passeios", destino.id);
    res.copiados.passeios = (await inserir("expedicao_passeios", ps.map((x, i) => ({ expedicao_id: destino.id, ordem: base + i, nome: x.nome, horario: x.horario, local: x.local, observacoes: x.observacoes })))).length;
    res.semAnexo += ps.filter((x) => x.arquivo_id).length;
  }

  if (quer.has("roteiro")) {
    const { count } = await supabase.from("roteiro_dias").select("id", { count: "exact", head: true }).eq("expedicao_id", destino.id);
    if (count) {
      res.pulados.push({ pedaco: "roteiro", motivo: `esta expedição já tem ${count} dia${count === 1 ? "" : "s"} no roteiro` });
    } else {
      const dias = (await lerTudo<RoteiroDiaRow>("roteiro_dias", o))
        .sort((a, b) => a.dia - b.dia || (a.data ?? "").localeCompare(b.data ?? "") || a.ordem - b.ordem);
      // Data nova = embarque desta + a mesma distância que o dia tinha do 1º dia da origem.
      const primeira = dias.map((d) => d.data).filter(Boolean).sort()[0] ?? null;
      const dataNova = (d: string | null) => {
        if (!d || !primeira || !destino.data_embarque) return null;
        const desloc = Math.round((parseISO(d.slice(0, 10)).getTime() - parseISO(primeira.slice(0, 10)).getTime()) / 86_400_000);
        return format(addDays(parseISO(destino.data_embarque.slice(0, 10)), desloc), "yyyy-MM-dd");
      };
      res.copiados.roteiro = (await inserir("roteiro_dias", dias.map((d) => ({
        expedicao_id: destino.id, dia: d.dia, ordem: d.ordem, data: dataNova(d.data), titulo: d.titulo, descricao: d.descricao,
        cidade: d.cidade, refeicoes: d.refeicoes, hospedagem: d.hospedagem,
        extensao_id: d.extensao_id ? novaExtensao.get(d.extensao_id) ?? null : null,
        apenas_sem_extensao: d.apenas_sem_extensao,
      })))).length;
      const semExt = dias.filter((d) => d.extensao_id && !novaExtensao.has(d.extensao_id)).length;
      if (semExt) res.pulados.push({ pedaco: "extensoes", motivo: `${semExt} dia(s) eram de extensão e ficaram pro grupo todo (copie as extensões junto pra manter)` });
    }
  }
  return res;
}
