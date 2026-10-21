/**
 * Catálogo canônico de requisitos de embarque por destino.
 *
 * É a fonte de verdade do QUE cada destino exige de um passageiro brasileiro.
 * O builder `construirRequisitosPadrao` (lib/prontidao/template.ts) instancia
 * estes templates como linhas de `passageiro_requisitos` ao confirmar um pax.
 *
 * ⚠️ Regras de visto/vacina mudam com frequência e dependem de nacionalidade.
 * Os valores abaixo são defaults razoáveis para passageiro BR — o time de
 * operações pode sobrescrever por destino direto na tabela `requisitos_destino`
 * (a UI de catálogo lê de lá; este arquivo é só o seed inicial).
 */
import type {
  TipoRequisito,
  Obrigatoriedade,
  PapelUsuario,
  RequisitoDestinoRow,
} from "@/expedicoes/lib/database";
import { MESES_VALIDADE_PASSAPORTE_PADRAO } from "@/expedicoes/lib/constants";

export type RequisitoDestinoTemplate = {
  tipo: TipoRequisito;
  descricao: string;
  obrigatoriedade: Obrigatoriedade;
  bloqueia_embarque: boolean;
  /** Só pra documentos com validade (passaporte). */
  meses_validade_minima?: number;
  papel_responsavel?: PapelUsuario;
  observacoes?: string;
};

const P = MESES_VALIDADE_PASSAPORTE_PADRAO;

/** Exigências comuns a praticamente toda expedição internacional. */
const BASE_INTERNACIONAL: RequisitoDestinoTemplate[] = [
  { tipo: "Passaporte", descricao: `Passaporte válido (≥ ${P} meses após o retorno) + foto/PDF anexado`, obrigatoriedade: "Obrigatório", bloqueia_embarque: true, meses_validade_minima: P, papel_responsavel: "operacional" },
  { tipo: "Dados Pessoais", descricao: "Cadastro completo (CPF, nascimento, contato)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
  { tipo: "Contrato", descricao: "Contrato assinado", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "comercial" },
  { tipo: "Seguro", descricao: "Seguro viagem emitido cobrindo todo o período", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "comercial" },
  { tipo: "Aéreo Internacional", descricao: "Bilhete internacional emitido (localizador)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
];

const VACINA_FEBRE_AMARELA: RequisitoDestinoTemplate = {
  tipo: "Vacina",
  descricao: "Certificado Internacional de Vacinação (febre amarela)",
  obrigatoriedade: "Condicional",
  bloqueia_embarque: true,
  papel_responsavel: "operacional",
  observacoes: "Exigível conforme regiões visitadas / país de origem.",
};

const VOO_DOMESTICO: RequisitoDestinoTemplate = {
  tipo: "Aéreo Doméstico",
  descricao: "Trecho doméstico no destino emitido",
  obrigatoriedade: "Condicional",
  bloqueia_embarque: false,
  papel_responsavel: "operacional",
};

const VOO_INTERNO: RequisitoDestinoTemplate = {
  tipo: "Voo Interno",
  descricao: "Voo interno (trecho aéreo) emitido",
  obrigatoriedade: "Condicional",
  bloqueia_embarque: false,
  papel_responsavel: "operacional",
};

/**
 * Templates por destino. A chave casa com `expedicoes.destino`.
 * Destinos não listados caem em BASE_INTERNACIONAL (ver `requisitosDoDestino`).
 */
export const REQUISITOS_POR_DESTINO: Record<string, RequisitoDestinoTemplate[]> = {
  // Peru — BR entra sem visto; voo interno a Cusco; febre amarela p/ Amazônia.
  Peru: [
    ...BASE_INTERNACIONAL,
    { ...VACINA_FEBRE_AMARELA, observacoes: "Recomendada para selva/Machu Picchu; conferir exigência." },
    VOO_DOMESTICO,
    VOO_INTERNO,
    { tipo: "Ingresso Machu Picchu", descricao: "Ingresso de Machu Picchu (anexo)", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
    { tipo: "Ingresso Trem Machu Picchu", descricao: "Ingresso de trem para Machu Picchu — ida e volta (anexos)", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
  ],
  // Argentina — Mercosul: RG ou passaporte; sem visto; sem vacina obrigatória.
  Argentina: [
    ...BASE_INTERNACIONAL,
    { tipo: "RG", descricao: "RG válido (≤ 10 anos) — alternativa ao passaporte no Mercosul", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
    VOO_DOMESTICO,
    VOO_INTERNO,
  ],
  // Chile — Mercosul, mesmas regras da Argentina.
  Chile: [
    ...BASE_INTERNACIONAL,
    { tipo: "RG", descricao: "RG válido (≤ 10 anos) — alternativa ao passaporte no Mercosul", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
    VOO_DOMESTICO,
    VOO_INTERNO,
  ],
  // Japão — confirmar regra de isenção de visto vigente para BR.
  Japão: [
    ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Visto de turismo (confirmar isenção vigente para BR)", obrigatoriedade: "Condicional", bloqueia_embarque: true, papel_responsavel: "operacional", observacoes: "Verificar regra de isenção atual antes de instanciar como obrigatório." },
    VOO_DOMESTICO,
    VOO_INTERNO,
  ],
  // Egito — visto obrigatório (e-visa / on arrival); febre amarela condicional.
  Egito: [
    ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Visto do Egito (e-visa ou on arrival)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
    VACINA_FEBRE_AMARELA,
    VOO_DOMESTICO,
    VOO_INTERNO,
  ],
  // Tailândia — BR sem visto p/ turismo até 30 dias; febre amarela exigível conforme
  // país de origem/regiões; trechos domésticos (ilhas/norte) comuns.
  Tailândia: [
    ...BASE_INTERNACIONAL,
    { ...VACINA_FEBRE_AMARELA, observacoes: "Febre amarela exigível conforme país de origem/regiões — conferir." },
    VOO_DOMESTICO,
    VOO_INTERNO,
  ],
  // Itália / Schengen — sem visto p/ turismo até 90 dias; ETIAS a caminho.
  Itália: [
    ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Autorização ETIAS (quando exigível) — Schengen", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional", observacoes: "ETIAS para isentos de visto; confirmar data de entrada em vigor." },
  ],
};

/**
 * Destinos cadastrados = chaves do catálogo acima. É a lista de opções
 * oferecidas ao criar uma expedição: só se cria expedição num destino
 * previamente cadastrado, já com suas condicionais (requisitos) definidas.
 */
export const DESTINOS_CADASTRADOS = Object.keys(REQUISITOS_POR_DESTINO);

/** True se o destino tem cadastro (condicionais definidas). */
export function destinoCadastrado(destino: string): boolean {
  return Object.prototype.hasOwnProperty.call(REQUISITOS_POR_DESTINO, destino);
}

/** Templates do destino, com fallback para a base internacional. */
export function requisitosDoDestino(destino: string): RequisitoDestinoTemplate[] {
  return REQUISITOS_POR_DESTINO[destino] ?? BASE_INTERNACIONAL;
}

/**
 * Converte os templates de um destino em linhas de `requisitos_destino`
 * (usado no mock e como base do seed). `idPrefix` gera IDs determinísticos.
 */
export function construirRequisitosDestino(params: {
  destino: string;
  idPrefix?: string;
  createdAt?: string;
}): RequisitoDestinoRow[] {
  const { destino, idPrefix, createdAt } = params;
  const now = createdAt ?? new Date().toISOString();
  let seq = 0;
  const mkId = () =>
    idPrefix
      ? `${idPrefix}-${String(++seq).padStart(3, "0")}`
      : `rd${Math.random().toString(36).slice(2, 14).padEnd(12, "0")}`;

  return requisitosDoDestino(destino).map((t, i) => ({
    id: mkId(),
    destino,
    tipo: t.tipo,
    descricao: t.descricao,
    obrigatoriedade: t.obrigatoriedade,
    bloqueia_embarque: t.bloqueia_embarque,
    meses_validade_minima: t.meses_validade_minima ?? null,
    papel_responsavel: t.papel_responsavel ?? null,
    ordem: i + 1,
    observacoes: t.observacoes ?? null,
    created_at: now,
    updated_at: now,
  }));
}
