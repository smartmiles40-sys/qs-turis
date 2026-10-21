// src/expedicoes/paginas/_globais/pessoasUnificadas.ts
// Pessoas do Clube de viajantes agrupadas pela FICHA do cliente (cadastro único,
// 0172: passageiros.cliente_id → rel_clientes). Quem ainda não tem ficha cai na
// chave de identidade antiga (CPF → Bitrix → e-mail → nome, lib/pessoas.ts).
// Uma linha sem ficha (ex.: lead) entra na ficha das outras linhas da mesma
// identidade quando elas apontam pra UMA ficha só.
// Antes da 0172 a coluna não vem no select("*") → fica igual ao listPessoas().
import { lerTudo } from "../../lib/banco";
import { chaveIdentidade, type PessoaAgregada } from "../../lib/pessoas";
import type { ExpedicaoRow, PassageiroRow } from "../../lib/database";

export type PessoaUnificada = PessoaAgregada & {
  /** Ficha do Relacionamento (null = sem ficha ou cadastro único ainda desligado). */
  cliente_id: string | null;
};

type Linha = PassageiroRow & { cliente_id?: string | null };

/** Chave do grupo de cada linha: `cli:<ficha>` ou a identidade antiga. */
function chavesDoGrupo(linhas: Linha[]): Map<string, string> {
  // identidade → fichas vistas nela
  const fichasDaIdentidade = new Map<string, Set<string>>();
  for (const p of linhas) {
    if (!p.cliente_id) continue;
    const k = chaveIdentidade(p);
    if (!fichasDaIdentidade.has(k)) fichasDaIdentidade.set(k, new Set());
    fichasDaIdentidade.get(k)!.add(p.cliente_id);
  }
  const out = new Map<string, string>();
  for (const p of linhas) {
    if (p.cliente_id) { out.set(p.id, `cli:${p.cliente_id}`); continue; }
    const k = chaveIdentidade(p);
    const fichas = fichasDaIdentidade.get(k);
    out.set(p.id, fichas && fichas.size === 1 ? `cli:${[...fichas][0]}` : k);
  }
  return out;
}

function agregar(passageiros: Linha[], expedicoes: ExpedicaoRow[]): PessoaUnificada[] {
  const expById = new Map(expedicoes.map((e) => [e.id, e]));
  const ordenados = [...passageiros].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const chaves = chavesDoGrupo(ordenados);
  const mapa = new Map<string, PessoaUnificada>();
  const recente = <T,>(atual: T | null, novo: T | null): T | null => novo ?? atual;

  for (const p of ordenados) {
    const chave = chaves.get(p.id)!;
    let pessoa = mapa.get(chave);
    if (!pessoa) {
      pessoa = {
        chave,
        cliente_id: chave.startsWith("cli:") ? chave.slice(4) : null,
        nome_completo: p.nome_completo,
        cpf: p.cpf,
        passaporte: p.passaporte,
        validade_passaporte: p.validade_passaporte,
        passaporte_arquivo_id: p.passaporte_arquivo_id,
        data_nascimento: p.data_nascimento,
        email: p.email,
        telefone: p.telefone,
        contato_emergencia_nome: p.contato_emergencia_nome,
        contato_emergencia_fone: p.contato_emergencia_fone,
        restricoes_alimentares: p.restricoes_alimentares,
        condicoes_medicas: p.condicoes_medicas,
        saude: p.saude ?? null,
        perfil_viajante: p.perfil_viajante ?? null,
        foto_arquivo_id: p.foto_arquivo_id ?? null,
        idsPassageiros: [],
        expedicaoIdAncora: null,
        passageiroIdAncora: null,
        totalExpedicoes: 0,
        expedicoes: [],
      };
      mapa.set(chave, pessoa);
    } else {
      // o dado mais recente disponível ganha (mesma regra do lib/pessoas.ts)
      pessoa.nome_completo = p.nome_completo || pessoa.nome_completo;
      pessoa.cpf = recente(pessoa.cpf, p.cpf);
      pessoa.passaporte = recente(pessoa.passaporte, p.passaporte);
      pessoa.validade_passaporte = recente(pessoa.validade_passaporte, p.validade_passaporte);
      pessoa.passaporte_arquivo_id = recente(pessoa.passaporte_arquivo_id, p.passaporte_arquivo_id);
      pessoa.data_nascimento = recente(pessoa.data_nascimento, p.data_nascimento);
      pessoa.email = recente(pessoa.email, p.email);
      pessoa.telefone = recente(pessoa.telefone, p.telefone);
      pessoa.contato_emergencia_nome = recente(pessoa.contato_emergencia_nome, p.contato_emergencia_nome);
      pessoa.contato_emergencia_fone = recente(pessoa.contato_emergencia_fone, p.contato_emergencia_fone);
      pessoa.restricoes_alimentares = recente(pessoa.restricoes_alimentares, p.restricoes_alimentares);
      pessoa.condicoes_medicas = recente(pessoa.condicoes_medicas, p.condicoes_medicas);
      pessoa.saude = recente(pessoa.saude, p.saude ?? null);
      pessoa.perfil_viajante = recente(pessoa.perfil_viajante, p.perfil_viajante ?? null);
      pessoa.foto_arquivo_id = recente(pessoa.foto_arquivo_id, p.foto_arquivo_id ?? null);
    }
    pessoa.idsPassageiros.push(p.id);
    const exp = p.expedicao_id ? expById.get(p.expedicao_id) : undefined;
    if (exp) {
      pessoa.expedicoes.push({
        expedicao_id: exp.id, passageiro_id: p.id, nome: exp.nome, destino: exp.destino,
        data_embarque: exp.data_embarque, status_reserva: p.status_reserva, tipo: p.tipo,
      });
    }
  }

  for (const pessoa of mapa.values()) {
    pessoa.expedicoes.sort((a, b) => b.data_embarque.localeCompare(a.data_embarque));
    pessoa.totalExpedicoes = pessoa.expedicoes.filter((e) => e.status_reserva !== "Cancelado").length;
    const ancora = pessoa.expedicoes[0];
    if (ancora) { pessoa.expedicaoIdAncora = ancora.expedicao_id; pessoa.passageiroIdAncora = ancora.passageiro_id; }
  }
  return [...mapa.values()].sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));
}

export async function listPessoasUnificadas(): Promise<PessoaUnificada[]> {
  const [pax, exps] = await Promise.all([lerTudo<Linha>("passageiros"), lerTudo<ExpedicaoRow>("expedicoes")]);
  return agregar(pax, exps);
}
