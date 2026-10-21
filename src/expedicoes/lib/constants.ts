export const MARGEM_MINIMA = 0.20;
export const MARGEM_IDEAL = 0.30;
export const PROVISAO_EXTRA_PADRAO = 0.05;

export const STATUS_EXPEDICAO = [
  "Planejamento",
  "Vendas Abertas",
  "Em andamento",
  "Concluída",
  "Cancelada",
] as const;
export type StatusExpedicao = (typeof STATUS_EXPEDICAO)[number];

export const STATUS_RESERVA = [
  "Lead",
  "Pré-reserva",
  "Confirmado",
  "Cancelado",
] as const;
export type StatusReserva = (typeof STATUS_RESERVA)[number];

export const TIPO_PASSAGEIRO = ["Pagante", "Cortesia", "Líder"] as const;
export type TipoPassageiro = (typeof TIPO_PASSAGEIRO)[number];

export const TIPO_FORNECEDOR = [
  "DMC",
  "Hotel",
  "Guia",
  "Aéreo",
  "Receptivo",
  "Seguro",
  "Outros",
] as const;
export type TipoFornecedor = (typeof TIPO_FORNECEDOR)[number];

export const CATEGORIA_CUSTO = [
  "Hotelaria",
  "Aéreo",
  "Terrestre",
  "Ingressos",
  "Guias",
  "Seguro",
  "Taxas",
  "Brindes",
  "Outros",
] as const;
export type CategoriaCusto = (typeof CATEGORIA_CUSTO)[number];

export const STATUS_CUSTO = [
  "A programar",
  "Programado",
  "Pago",
  "Parcial",
  "Vencido",
] as const;
export type StatusCusto = (typeof STATUS_CUSTO)[number];

export const STATUS_PAGAMENTO = [
  "Pendente",
  "Programado",
  "Pago",
  "Parcial",
  "Vencido",
  "Cancelado",
] as const;
export type StatusPagamento = (typeof STATUS_PAGAMENTO)[number];

// Fases do checklist = SOP real da agência (ClickUp "Processos - Expedição").
// Organizado por ANTECEDÊNCIA ao embarque, não por categoria genérica.
export const ETAPA_CHECKLIST = [
  "Após o fechamento",
  "12 a 6 meses",
  "6 a 2 meses",
  "2 meses a 15 dias",
  "Na semana",
  "Pós-viagem",
] as const;
export type EtapaChecklist = (typeof ETAPA_CHECKLIST)[number];

/**
 * Metadados de cada fase: ordem na timeline, descrição da janela e o
 * intervalo de "dias até o embarque" que caracteriza a fase como ATUAL.
 * `diasReferencia` é usado pelo seeding pra calcular o prazo padrão de uma
 * tarefa (data_embarque − diasReferencia).
 */
export const FASES_CHECKLIST: {
  etapa: EtapaChecklist;
  descricao: string;
  diasMin: number; // limite inferior de "dias até embarque" (exclusivo)
  diasMax: number; // limite superior de "dias até embarque" (inclusivo)
  diasReferencia: number; // offset padrão de prazo (dias antes do embarque)
}[] = [
  { etapa: "Após o fechamento", descricao: "Logo após fechar a venda", diasMin: 365, diasMax: Infinity, diasReferencia: 300 },
  { etapa: "12 a 6 meses", descricao: "12 a 6 meses antes do embarque", diasMin: 180, diasMax: 365, diasReferencia: 240 },
  { etapa: "6 a 2 meses", descricao: "6 a 2 meses antes do embarque", diasMin: 60, diasMax: 180, diasReferencia: 120 },
  { etapa: "2 meses a 15 dias", descricao: "2 meses a 15 dias antes", diasMin: 15, diasMax: 60, diasReferencia: 35 },
  { etapa: "Na semana", descricao: "Na semana da expedição", diasMin: 0, diasMax: 15, diasReferencia: 5 },
  { etapa: "Pós-viagem", descricao: "Depois do retorno", diasMin: -Infinity, diasMax: 0, diasReferencia: -7 },
];

/** Fase atual da expedição com base nos dias até o embarque. */
export function faseAtualChecklist(diasAteEmbarque: number | null): EtapaChecklist | null {
  if (diasAteEmbarque == null) return null;
  const fase = FASES_CHECKLIST.find(
    (f) => diasAteEmbarque > f.diasMin && diasAteEmbarque <= f.diasMax,
  );
  return fase?.etapa ?? null;
}

export const STATUS_CHECKLIST = [
  "Pendente",
  "Em andamento",
  "Atenção",
  "Concluído",
  "Bloqueado",
] as const;
export type StatusChecklist = (typeof STATUS_CHECKLIST)[number];

export const PRIORIDADE = ["Baixa", "Média", "Alta", "Crítica"] as const;
export type Prioridade = (typeof PRIORIDADE)[number];

export const TIPO_QUARTO = [
  "Single",
  "Duplo",
  "Twin",
  "Triplo",
  "Compartilhado",
  "Líder",
] as const;
export type TipoQuarto = (typeof TIPO_QUARTO)[number];

/** Quantas pessoas cabem em cada tipo de quarto (usado no rooming). */
export const CAPACIDADE_QUARTO: Record<string, number> = {
  Single: 1,
  Twin: 2,
  Duplo: 2,
  Triplo: 3,
  Compartilhado: 4,
  Líder: 2,
};

export const PAPEL_USUARIO = [
  "admin",
  "operacional",
  "comercial",
  "financeiro",
  "relacionamento",
  "leitura",
] as const;
export type PapelUsuario = (typeof PAPEL_USUARIO)[number];

/** Rótulo amigável de cada papel (o que aparece na UI). */
export const PAPEL_LABEL: Record<PapelUsuario, string> = {
  admin: "Admin",
  operacional: "Operação",
  comercial: "Comercial",
  financeiro: "Financeiro",
  relacionamento: "Relacionamento",
  leitura: "Leitura",
};

/** Papéis oferecidos no seletor de "Mudar papel" (os 3 perfis em uso). */
export const PAPEIS_ATRIBUIVEIS: PapelUsuario[] = ["admin", "operacional", "relacionamento"];

export const MOEDAS = ["BRL", "USD", "EUR", "PEN", "GBP", "JPY", "ARS", "CLP"] as const;
export type Moeda = (typeof MOEDAS)[number];

export const STATUS_FORNECEDOR = ["Ativo", "Pausado", "Bloqueado"] as const;
export type StatusFornecedor = (typeof STATUS_FORNECEDOR)[number];

export const STATUS_VISTO = ["Não necessário", "A solicitar", "Em análise", "Aprovado", "Negado"] as const;
export const STATUS_SEGURO = ["Pendente", "Solicitado", "Emitido"] as const;

// =============================================================================
// Prontidão para Embarque (migration 0010)
// =============================================================================
export const TIPO_REQUISITO = [
  "Passaporte",
  "RG",
  "Visto",
  "Vacina",
  "Seguro",
  "Aéreo Internacional",
  "Aéreo Doméstico",
  "Voo Interno",
  "Contrato",
  "Autorização de Menor",
  "Pagamento",
  "Dados Pessoais",
  "Ingresso Machu Picchu",
  "Ingresso Trem Machu Picchu",
] as const;
export type TipoRequisito = (typeof TIPO_REQUISITO)[number];

export const OBRIGATORIEDADE = ["Obrigatório", "Condicional", "Recomendado"] as const;
export type Obrigatoriedade = (typeof OBRIGATORIEDADE)[number];

export const STATUS_REQUISITO = [
  "Pendente",
  "Em análise",
  "Enviado",
  "Aprovado",
  "Vencido",
  "Dispensado",
  "Reprovado",
] as const;
export type StatusRequisito = (typeof STATUS_REQUISITO)[number];

export const PRONTIDAO = ["Apto", "Atenção", "Bloqueado"] as const;
export type Prontidao = (typeof PRONTIDAO)[number];

/** Meses de validade do passaporte exigidos após o retorno (padrão de mercado). */
export const MESES_VALIDADE_PASSAPORTE_PADRAO = 6;

/**
 * Mapa semáforo → token de cor semântica do tema (app/globals.css).
 * Reaproveita a paleta do CLAUDE.md: verde=ok, laranja=atenção, vermelho=crítico.
 */
export const COR_PRONTIDAO: Record<Prontidao, "vinculado" | "atencao" | "critico"> = {
  Apto: "vinculado",
  Atenção: "atencao",
  Bloqueado: "critico",
};

export const CATEGORIA_ARQUIVO = [
  "Aéreos",
  "Documentos pessoais",
  "Contrato",
  "Bilhetes",
  "Vistos",
  "Seguros",
  "Hospedagem",
  "Vouchers",
  "Cartão de embarque",
  "Outros",
] as const;
export type CategoriaArquivo = (typeof CATEGORIA_ARQUIVO)[number];

/**
 * Marcador (em `arquivos.descricao`) que identifica um DOCUMENTO DA EXPEDIÇÃO
 * destinado à Área do Líder (ex.: manual do líder). Guardado como categoria
 * "Outros" + esta descrição, pra distinguir de fotos/vouchers de nível-expedição
 * sem precisar de novo valor no enum `categoria_arquivo`.
 */
export const MARCADOR_DOC_LIDER = "Documento do líder";

/** Tamanho máximo permitido por upload (15 MB) — barra DoS de storage. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * MIME types aceitos no upload de arquivos. Cobre o que o time anexa de fato:
 * passaportes/vistos/vouchers (PDF + imagens) e planilhas/documentos do Office.
 */
export const MIME_ARQUIVO_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
] as const;
