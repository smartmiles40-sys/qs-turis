// src/expedicoes/paginas/_globais/pessoaAcoes.ts
// Ações da base de pessoas (app antigo: app/(app)/expedicoes/actions.ts →
// criarPassageiroAvulso, atualizarDadosPessoais/propagarDadosPessoais,
// atualizarAnexoPassaporte, excluirPessoa, importarPassageirosGlobal;
// expedamigo-actions.ts → estadoSenhaCpf, gerarNovaSenhaCpf). As que mexem em
// várias linhas viraram funções do banco (migração 0171), numa tacada só.
import { lerTudo, supabase, traduzirErro } from "../../lib/banco";
import { cpfValido, soDigitosCpf } from "../../lib/cpf";
import { construirRequisitosPadrao } from "../../lib/prontidao/template";
import { espalharCertificadoVacina } from "../../lib/prontidao/vacina-sync";
import { MAX_UPLOAD_BYTES } from "../../lib/constants";
import type { DadosImport } from "../../lib/csv/passageiros-import";
import type { ExpedicaoRow, PassageiroRow } from "../../lib/database";

const falha = (e: { message: string } | null) => { if (e) throw new Error(traduzirErro(e.message)); };

export type NovoAvulso = {
  nome_completo: string; cpf: string | null; data_nascimento: string | null; passaporte: string | null;
  validade_passaporte: string | null; email: string | null; telefone: string | null;
};

/** Pessoa na base sem expedição (status Lead). CPF, se vier, precisa ser válido e não pode existir. */
export async function criarPassageiroAvulso(d: NovoAvulso): Promise<void> {
  if (d.nome_completo.trim().length < 2) throw new Error("Nome completo obrigatório");
  if (d.cpf) {
    if (!cpfValido(d.cpf)) throw new Error("CPF inválido");
    const dig = soDigitosCpf(d.cpf);
    const todos = await lerTudo<{ id: string; cpf: string | null }>("passageiros", (q) => q.not("cpf", "is", null), "id, cpf");
    if (todos.some((p) => soDigitosCpf(p.cpf) === dig)) throw new Error("Já existe um passageiro com este CPF no sistema.");
  }
  const { error } = await supabase.from("passageiros").insert({
    expedicao_id: null, nome_completo: d.nome_completo.trim(), tipo: "Pagante", status_reserva: "Lead",
    cpf: d.cpf, passaporte: d.passaporte, validade_passaporte: d.validade_passaporte, data_nascimento: d.data_nascimento,
    email: d.email, telefone: d.telefone,
  });
  falha(error);
}

/** Grava campos pessoais em TODAS as linhas da pessoa. `saude`: chave com null = apagar a resposta. */
export async function propagarPessoais(refId: string, patch: Record<string, unknown>): Promise<{ linhas: number; expedicoes: string[] }> {
  const { data, error } = await supabase.rpc("exp_pessoa_propagar", { p_ref: refId, p_patch: patch });
  falha(error);
  return data as { linhas: number; expedicoes: string[] };
}

export async function excluirPessoa(refId: string): Promise<number> {
  const { data, error } = await supabase.rpc("exp_pessoa_excluir", { p_ref: refId });
  falha(error);
  return Number(data ?? 0);
}

const nomeSeguro = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "arquivo";

/** Sobe foto/PDF de documento pessoal na linha do passageiro (mesmo caminho do app antigo). Devolve o id em `arquivos`. */
export async function subirDocumentoPessoal(expedicaoId: string, passageiroId: string, arquivo: File, descricao: string): Promise<string> {
  if (arquivo.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo maior que 15 MB.");
  if (!/^image\/|^application\/pdf$/.test(arquivo.type)) throw new Error("Envie uma foto ou PDF.");
  const caminho = `${expedicaoId}/passageiros/${passageiroId}/Documentos_pessoais/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const up = await supabase.storage.from("arquivos-expedicoes").upload(caminho, arquivo, { contentType: arquivo.type || "application/octet-stream", upsert: false });
  falha(up.error);
  const { data: u } = await supabase.auth.getUser();
  const ins = await supabase.from("arquivos").insert({
    expedicao_id: expedicaoId, passageiro_id: passageiroId, categoria: "Documentos pessoais", nome: arquivo.name,
    descricao, mime: arquivo.type || null, tamanho_bytes: arquivo.size, storage_path: caminho,
    uploaded_by: u.user?.id ?? null,
  }).select("id").single();
  if (ins.error) {
    await supabase.storage.from("arquivos-expedicoes").remove([caminho]);
    falha(ins.error);
  }
  return (ins.data as { id: string }).id;
}

/** Link assinado (5 min) de um arquivo pelo id. */
export async function abrirArquivo(arquivoId: string): Promise<void> {
  // Abre a aba já no clique (senão o navegador bloqueia o pop-up) e depois aponta pro link.
  const aba = window.open("", "_blank");
  try {
    const { data, error } = await supabase.from("arquivos").select("storage_path").eq("id", arquivoId).maybeSingle();
    falha(error);
    if (!data) throw new Error("Arquivo não encontrado.");
    const s = await supabase.storage.from("arquivos-expedicoes").createSignedUrl((data as { storage_path: string }).storage_path, 300);
    falha(s.error);
    if (aba) aba.location.href = s.data!.signedUrl; else window.location.assign(s.data!.signedUrl);
  } catch (e) { aba?.close(); throw e; }
}

/** Sobe o passaporte (1 por pessoa) na linha-âncora e propaga o id do arquivo pra todas as expedições. */
export async function anexarPassaporte(expedicaoId: string, passageiroId: string, arquivo: File): Promise<void> {
  const id = await subirDocumentoPessoal(expedicaoId, passageiroId, arquivo, "Passaporte — prontidão");
  await propagarPessoais(passageiroId, { passaporte_arquivo_id: id });
}

export async function removerPassaporte(passageiroId: string): Promise<void> {
  await propagarPessoais(passageiroId, { passaporte_arquivo_id: null });
}

// ---------------------------------------------------------------- senha ExpedAmigo
export type EstadoSenha = { admin: boolean; tem_hash?: boolean; senha_provisoria?: string | null };
export async function estadoSenhaCpf(cpf: string): Promise<EstadoSenha> {
  const { data, error } = await supabase.rpc("exp_pessoa_senha_estado", { p_cpf: cpf });
  if (error) return { admin: false };
  return data as EstadoSenha;
}
export async function gerarNovaSenhaCpf(cpf: string): Promise<string> {
  const { data, error } = await supabase.rpc("exp_pessoa_senha_nova", { p_cpf: cpf });
  falha(error);
  return String(data);
}

// ---------------------------------------------------------------- import CSV global
function statusFinanceiroDe(tipo: string, contratado: number, pago: number): string {
  if (tipo !== "Pagante" && contratado === 0) return "Cortesia";
  if (contratado > 0 && pago >= contratado) return "Quitado";
  return "Em aberto";
}

/**
 * Importa linhas já validadas (com expedicao_codigo). Pula CPF que já existe na
 * mesma expedição. Cria os requisitos de prontidão do destino junto, na mesma
 * transação, e depois herda o certificado de vacina de quem já tem.
 */
export async function importarPassageirosGlobal(linhas: DadosImport[], expedicoes: ExpedicaoRow[]): Promise<{ inseridos: number; ignorados: number; semExpedicao: number }> {
  if (linhas.length === 0) return { inseridos: 0, ignorados: 0, semExpedicao: 0 };
  if (linhas.length > 2000) throw new Error("No máximo 2000 linhas por importação.");
  const porCodigo = new Map(expedicoes.map((e) => [e.codigo, e]));
  const idsExp = [...new Set(linhas.map((l) => porCodigo.get(l.expedicao_codigo ?? "")?.id).filter((x): x is string => !!x))];
  const existentes = idsExp.length
    ? await lerTudo<{ id: string; expedicao_id: string; cpf: string | null }>("passageiros", (q) => q.in("expedicao_id", idsExp).not("cpf", "is", null), "id, expedicao_id, cpf")
    : [];
  const vistos = new Set(existentes.map((p) => `${p.expedicao_id}|${soDigitosCpf(p.cpf)}`));

  let ignorados = 0, semExpedicao = 0;
  const novos: (PassageiroRow & { _destino: string })[] = [];
  const agora = new Date().toISOString();
  for (const l of linhas) {
    const exp = porCodigo.get(l.expedicao_codigo ?? "");
    if (!exp) { semExpedicao++; continue; }
    const dig = soDigitosCpf(l.cpf);
    if (dig.length === 11) {
      const k = `${exp.id}|${dig}`;
      if (vistos.has(k)) { ignorados++; continue; }
      vistos.add(k);
    }
    const contratado = l.valor_contratado_brl ?? 0, pago = l.valor_pago_brl ?? 0;
    novos.push({
      id: crypto.randomUUID(), expedicao_id: exp.id, nome_completo: l.nome_completo, tipo: l.tipo, status_reserva: l.status_reserva,
      cpf: l.cpf, passaporte: l.passaporte, data_nascimento: l.data_nascimento, validade_passaporte: l.validade_passaporte,
      email: l.email, telefone: l.telefone, observacoes: l.observacoes, valor_contratado_brl: contratado, valor_pago_brl: pago,
      status_financeiro: statusFinanceiroDe(l.tipo, contratado, pago),
      // campos que o construtor de requisitos lê (padrões do banco)
      localizador: null, voo_nacional_necessario: false, created_at: agora, updated_at: agora, _destino: exp.destino,
    } as unknown as PassageiroRow & { _destino: string });
  }
  if (novos.length === 0) return { inseridos: 0, ignorados, semExpedicao };

  const reqs = novos.filter((p) => p.status_reserva !== "Cancelado").flatMap((p) =>
    construirRequisitosPadrao({ passageiro: p, destino: p._destino, idPrefix: "tmp" }).map((r) => ({
      passageiro_id: r.passageiro_id, tipo: r.tipo, descricao: r.descricao, status: r.status, obrigatoriedade: r.obrigatoriedade,
      bloqueia_embarque: r.bloqueia_embarque, numero: r.numero, observacoes: r.observacoes,
    })));
  const pax = novos.map((p) => ({
    id: p.id, expedicao_id: p.expedicao_id, nome_completo: p.nome_completo, tipo: p.tipo, status_reserva: p.status_reserva,
    cpf: p.cpf, passaporte: p.passaporte, data_nascimento: p.data_nascimento, validade_passaporte: p.validade_passaporte,
    email: p.email, telefone: p.telefone, observacoes: p.observacoes, valor_contratado_brl: p.valor_contratado_brl,
    valor_pago_brl: p.valor_pago_brl, status_financeiro: p.status_financeiro,
  }));
  const { data, error } = await supabase.rpc("exp_importar_passageiros", { p_pax: pax, p_reqs: reqs });
  falha(error);

  // Vacina universal: quem já tem o certificado de febre amarela herda no slot novo (melhor esforço).
  for (const cpf of [...new Set(novos.map((p) => p.cpf).filter((c): c is string => !!c))]) {
    try { await espalharCertificadoVacina(supabase, cpf); } catch { /* segue */ }
  }
  return { inseridos: Number(data ?? novos.length), ignorados, semExpedicao };
}
