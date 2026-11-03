// src/venda/propostaAnexo.ts
// -----------------------------------------------------------------------------
// "Proposta enviada ao cliente" — anexo OBRIGATÓRIO na hora de registrar a
// venda (0295, Bruno 03/11/2026: "só pedirmos para anexar a proposta na hora
// da venda"). Mesmo padrão do src/solicitacoes/pagamento.ts: bucket privado,
// link assinado de 5 min, e o arquivo é apagado se o registro falhar.
//
// Ordem (SubirVenda): anexarPropostas (sobe + registra) → venda_subir →
// vincularPropostas. Se a venda falhar, desfazerAnexos apaga o que acabou de subir.
// -----------------------------------------------------------------------------
import { supabase } from "@/lib/supabase";

import { EXT, problemaNoArquivo } from "./propostaAnexoRegras";
export { ACEITA_PROPOSTA, LIMITE_MB, MSG_SEM_PROPOSTA, faltaProposta, problemaNoArquivo, tamanhoLegivel } from "./propostaAnexoRegras";

const BUCKET = "vendas-propostas";

export interface PropostaAnexada {
  id: string;
  venda_id: string | null;
  negocio_id: string | null;
  lead_id: string | null;
  cliente_id: string | null;
  arquivo_path: string;
  arquivo_nome: string;
  mime: string | null;
  tamanho: number | null;
  criado_por: string | null;
  criado_em: string;
}

function semTabela(m: string) { return /qs_venda_propostas|venda_proposta_anexar|venda_propostas_vincular|vendas-propostas|bucket not found|relation|does not exist|schema cache/i.test(m); }
function erroAmigo(m: string) {
  return semTabela(m) ? "O banco ainda não tem a migration 0295 (anexo da proposta na venda) — peça pra aplicar." : m;
}

function uuid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); });
}

/** Os anexos já feitos neste cartão do closer (ou nesta venda). Sem a 0295, lista vazia — sem erro vermelho. */
export async function listarPropostasDaVenda(f: { negocioId?: string | null; vendaId?: string | null; leadId?: string | null; clienteId?: string | null }): Promise<PropostaAnexada[]> {
  const ors = [
    f.negocioId && `negocio_id.eq.${f.negocioId}`, f.vendaId && `venda_id.eq.${f.vendaId}`,
    f.leadId && `lead_id.eq.${f.leadId}`, f.clienteId && `cliente_id.eq.${f.clienteId}`,
  ].filter(Boolean) as string[];
  if (!ors.length) return [];
  const { data, error } = await supabase.from("qs_venda_propostas").select("*").or(ors.join(",")).order("criado_em", { ascending: false }).limit(100);
  if (error) { if (semTabela(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as PropostaAnexada[];
}

/**
 * Sobe e registra cada arquivo. Se um falhar no meio, apaga TODOS os desta
 * leva (nada fica pela metade) e lança o erro.
 */
export async function anexarPropostas(arquivos: File[], ctx: { negocioId?: string | null; clienteId?: string | null }): Promise<string[]> {
  for (const f of arquivos) { const p = problemaNoArquivo(f); if (p) throw new Error(p); }
  const pasta = ctx.negocioId || uuid();
  const feitos: { id: string; path: string }[] = [];
  try {
    for (const f of arquivos) {
      const path = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[f.type]}`;
      const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) throw new Error(`"${f.name}" não subiu: ${erroAmigo(up.error.message)}`);
      const { data, error } = await supabase.rpc("venda_proposta_anexar", {
        p_path: path, p_nome: f.name, p_mime: f.type, p_tamanho: f.size, p_negocio: ctx.negocioId ?? null, p_cliente: ctx.clienteId ?? null,
      });
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]); // não deixa arquivo órfão
        throw new Error(erroAmigo(error.message));
      }
      feitos.push({ id: data as string, path });
    }
  } catch (e) {
    await desfazerAnexos(feitos.map((x) => x.id), feitos.map((x) => x.path));
    throw e;
  }
  return feitos.map((x) => x.id);
}

/** A venda falhou: apaga os anexos que acabaram de subir (registro + arquivo). */
export async function desfazerAnexos(ids: string[], paths?: string[]) {
  if (!ids.length) return;
  let caminhos = paths;
  if (!caminhos) {
    const { data } = await supabase.from("qs_venda_propostas").select("arquivo_path").in("id", ids);
    caminhos = (data ?? []).map((x: { arquivo_path: string }) => x.arquivo_path);
  }
  await supabase.from("qs_venda_propostas").delete().in("id", ids);
  if (caminhos.length) await supabase.storage.from(BUCKET).remove(caminhos);
}

/** Depois que a venda gravou: amarra os anexos nela (e no cliente). */
export async function vincularPropostas(ids: string[], vendaId: string): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.rpc("venda_propostas_vincular", { p_ids: ids, p_venda: vendaId });
  if (error) throw new Error(erroAmigo(error.message));
}

/** Link de 5 minutos pra abrir o arquivo (o bucket é privado). */
export async function abrirProposta(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error("Não consegui abrir o arquivo.");
  return data.signedUrl;
}

/** Tirar um anexo (quem subiu ou a gestão). */
export async function apagarProposta(a: Pick<PropostaAnexada, "id" | "arquivo_path">): Promise<void> {
  const { error } = await supabase.from("qs_venda_propostas").delete().eq("id", a.id);
  if (error) throw new Error(error.message);
  await supabase.storage.from(BUCKET).remove([a.arquivo_path]);
}
