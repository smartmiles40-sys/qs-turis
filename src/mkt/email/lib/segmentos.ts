// src/mkt/email/lib/segmentos.ts
// Catálogo de campos/operadores que a tela oferece. TEM que andar junto com
// api/_mktEmailRegras.js (OPERADORES) e mkt_seg_condicao_sql (0245): o banco
// recusa o que não conhece (filtro não entendido nunca vira "todo mundo").
import type { Condicao, Regras } from "./api";

export type TipoValor = "nenhum" | "texto" | "numero" | "dias" | "data" | "tag" | "lista" | "campanha";
export interface Operador { op: string; rotulo: string; valor: TipoValor }
export interface CampoDef { campo: string; rotulo: string; grupo: string; ops: Operador[] }

const TEXTO: Operador[] = [
  { op: "contem", rotulo: "contém", valor: "texto" },
  { op: "nao_contem", rotulo: "não contém", valor: "texto" },
  { op: "igual", rotulo: "é igual a", valor: "texto" },
  { op: "diferente", rotulo: "é diferente de", valor: "texto" },
  { op: "preenchido", rotulo: "está preenchido", valor: "nenhum" },
  { op: "vazio", rotulo: "está vazio", valor: "nenhum" },
];
const ENGAJ = (verbo: string): Operador[] => [
  { op: "ultimos_dias", rotulo: `${verbo} algum e-mail nos últimos (dias)`, valor: "dias" },
  { op: "nao_ultimos_dias", rotulo: `não ${verbo} nenhum e-mail nos últimos (dias)`, valor: "dias" },
  { op: "nunca", rotulo: `nunca ${verbo} e-mail`, valor: "nenhum" },
  { op: "campanha", rotulo: `${verbo} a campanha`, valor: "campanha" },
  { op: "nao_campanha", rotulo: `recebeu e não ${verbo} a campanha`, valor: "campanha" },
];

export const CAMPOS: CampoDef[] = [
  { campo: "tag", rotulo: "Tag", grupo: "Contato", ops: [{ op: "tem", rotulo: "tem a tag", valor: "tag" }, { op: "nao_tem", rotulo: "não tem a tag", valor: "tag" }] },
  { campo: "lista", rotulo: "Lista", grupo: "Contato", ops: [{ op: "esta", rotulo: "está na lista", valor: "lista" }, { op: "nao_esta", rotulo: "não está na lista", valor: "lista" }] },
  { campo: "nome", rotulo: "Nome", grupo: "Contato", ops: TEXTO },
  { campo: "email", rotulo: "E-mail", grupo: "Contato", ops: TEXTO },
  { campo: "telefone", rotulo: "Telefone", grupo: "Contato", ops: TEXTO },
  { campo: "origem", rotulo: "Origem", grupo: "Contato", ops: TEXTO },
  { campo: "campo", rotulo: "Campo personalizado", grupo: "Contato", ops: [...TEXTO, { op: "maior", rotulo: "é maior que", valor: "numero" }, { op: "menor", rotulo: "é menor que", valor: "numero" }] },
  { campo: "criado", rotulo: "Data de cadastro", grupo: "Contato", ops: [
    { op: "ultimos_dias", rotulo: "entrou nos últimos (dias)", valor: "dias" },
    { op: "mais_de_dias", rotulo: "entrou há mais de (dias)", valor: "dias" },
    { op: "depois_de", rotulo: "entrou a partir de", valor: "data" },
    { op: "antes_de", rotulo: "entrou antes de", valor: "data" },
  ] },
  { campo: "score", rotulo: "Pontuação", grupo: "Engajamento", ops: [{ op: "maior_igual", rotulo: "é pelo menos", valor: "numero" }, { op: "menor", rotulo: "é menor que", valor: "numero" }] },
  { campo: "abriu_email", rotulo: "Abertura de e-mail", grupo: "Engajamento", ops: ENGAJ("abriu") },
  { campo: "clicou_email", rotulo: "Clique em e-mail", grupo: "Engajamento", ops: ENGAJ("clicou") },
];

export const definicao = (campo: string) => CAMPOS.find((c) => c.campo === campo) ?? CAMPOS[0];
export const operador = (campo: string, op: string) => definicao(campo).ops.find((o) => o.op === op) ?? definicao(campo).ops[0];

export function condicaoPadrao(campo = "tag"): Condicao {
  const d = definicao(campo);
  const o = d.ops[0];
  return { campo: d.campo, op: o.op, valor: o.valor === "dias" ? "30" : "", ...(d.campo === "campo" ? { chave: "" } : {}) };
}

export const ehGrupo = (x: Condicao | Regras): x is Regras => Array.isArray((x as Regras).condicoes);
export const REGRAS_VAZIAS: Regras = { combinar: "todas", condicoes: [] };
