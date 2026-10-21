/**
 * Tipos do schema Postgres. Escritos à mão (Supabase ainda não conectado).
 * Quando o projeto Supabase existir, regerar com:
 *   supabase gen types typescript --project-id <id> > types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PapelUsuario = "admin" | "operacional" | "comercial" | "financeiro" | "relacionamento" | "leitura";
export type StatusExpedicao = "Planejamento" | "Vendas Abertas" | "Em andamento" | "Concluída" | "Cancelada";
export type StatusReserva = "Lead" | "Pré-reserva" | "Confirmado" | "Cancelado";
export type TipoPassageiro = "Pagante" | "Cortesia" | "Líder";
export type TipoFornecedor = "DMC" | "Hotel" | "Guia" | "Aéreo" | "Receptivo" | "Seguro" | "Outros";
export type StatusFornecedor = "Ativo" | "Pausado" | "Bloqueado";
export type CategoriaCusto = "Hotelaria" | "Aéreo" | "Terrestre" | "Ingressos" | "Guias" | "Seguro" | "Taxas" | "Brindes" | "Outros";
export type StatusCusto = "A programar" | "Programado" | "Pago" | "Parcial" | "Vencido";
export type StatusPagamento = "Pendente" | "Programado" | "Pago" | "Parcial" | "Vencido" | "Cancelado";
export type EtapaChecklist =
  | "Após o fechamento"
  | "12 a 6 meses"
  | "6 a 2 meses"
  | "2 meses a 15 dias"
  | "Na semana"
  | "Pós-viagem";
export type StatusChecklist = "Pendente" | "Em andamento" | "Atenção" | "Concluído" | "Bloqueado";
export type Prioridade = "Baixa" | "Média" | "Alta" | "Crítica";
export type TipoQuarto = "Single" | "Duplo" | "Twin" | "Triplo" | "Compartilhado" | "Líder";

// Motor de Prontidão para Embarque (migration 0010)
export type TipoRequisito =
  | "Passaporte"
  | "RG"
  | "Visto"
  | "Vacina"
  | "Seguro"
  | "Aéreo Internacional"
  | "Aéreo Doméstico"
  | "Voo Interno"
  | "Contrato"
  | "Autorização de Menor"
  | "Pagamento"
  | "Dados Pessoais"
  | "Ingresso Machu Picchu"
  | "Ingresso Trem Machu Picchu";
export type Obrigatoriedade = "Obrigatório" | "Condicional" | "Recomendado";
export type StatusRequisito =
  | "Pendente"
  | "Em análise"
  | "Enviado"
  | "Aprovado"
  | "Vencido"
  | "Dispensado"
  | "Reprovado";
/** Semáforo consolidado de prontidão de um passageiro. */
export type Prontidao = "Apto" | "Atenção" | "Bloqueado";

// ========== Row interfaces ==========

export type UsuarioRow = {
  id: string;
  email: string;
  nome: string;
  papel: PapelUsuario;
  avatar_url: string | null;
  /** true = conta criada com senha provisória; força troca no 1º acesso (migration 0032). */
  senha_provisoria: boolean;
  created_at: string;
  updated_at: string;
}

export type FornecedorRow = {
  id: string;
  nome: string;
  tipo: TipoFornecedor;
  contato_nome: string | null;
  contato_email: string | null;
  contato_whatsapp: string | null;
  destino_cidade: string | null;
  servicos: string[] | null;
  moeda_padrao: string;
  politica_pagamento: string | null;
  status: StatusFornecedor;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type CambioRow = {
  moeda: string;
  taxa_brl: number;
  atualizado_em: string;
}

export type ExpedicaoRow = {
  id: string;
  codigo: string;
  nome: string;
  destino: string;
  data_embarque: string;
  data_retorno: string;
  responsavel_operacional_id: string | null;
  responsavel_comercial_id: string | null;
  dmc_principal_id: string | null;
  status: StatusExpedicao;
  pax_planejados: number;
  pax_cortesia: number;
  preco_venda_brl: number;
  bitrix_pipeline_id: string | null;
  observacoes: string | null;
  ordem: number | null;
  /** 'expedicao' = viagem em grupo (padrão) · 'pacote' = pacote personalizado (migration 0060). */
  tipo?: "expedicao" | "pacote";
  /** Vínculo leve entre expedições irmãs que rodam juntas (migration 0029). */
  viagem_grupo?: string | null;
  grupo_rotulo?: string | null;
  /** Voucher único da hospedagem (arquivos.id) — mesmo hotel p/ todos (migration 0030). */
  hospedagem_voucher_arquivo_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type PassageiroRow = {
  id: string;
  expedicao_id: string | null; // null = passageiro avulso (na base, sem expedição)
  grupo_id: string | null;
  // Token de "viajam juntas" (mesmo quarto no rooming). Pax com o mesmo valor,
  // dentro da expedição, formam uma conexão. Null = sem conexão. (migration 0019)
  conexao_viagem_id: string | null;
  bitrix_contact_id: string | null;
  bitrix_deal_id: string | null;
  nome_completo: string;
  tipo: TipoPassageiro;
  cpf: string | null;
  passaporte: string | null;
  data_nascimento: string | null;
  validade_passaporte: string | null;
  /** Arquivo do passaporte (foto/PDF) — 1 por PESSOA, propaga entre expedições. Migration 0026. */
  passaporte_arquivo_id: string | null;
  email: string | null;
  telefone: string | null;
  status_reserva: StatusReserva;
  voo_nacional_necessario: boolean;
  companhia_aerea: string | null;
  localizador: string | null;
  quarto_id: string | null;
  // Financeiro espelhado do Bitrix (migration 0010)
  valor_contratado_brl: number;
  valor_pago_brl: number;
  saldo_brl: number; // gerado: valor_contratado_brl - valor_pago_brl
  status_financeiro: string;
  // Dados de embarque/pessoais (migration 0010)
  contato_emergencia_nome: string | null;
  contato_emergencia_fone: string | null;
  contato_emergencia_vinculo: string | null;
  restricoes_alimentares: string | null;
  condicoes_medicas: string | null;
  saude?: SaudePassageiro | null;
  contrato_assinado: boolean;
  checkin_online_feito: boolean;
  observacoes: string | null;
  // Inscrição pública / aprovação (migration 0027)
  pendente_aprovacao: boolean;
  inscricao_origem: string | null;
  // Endereço (dado PESSOAL — propaga entre expedições)
  endereco_cep: string | null;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  endereco_bairro: string | null;
  endereco_cidade: string | null;
  endereco_estado: string | null;
  // Preferências de voo (dado da RESERVA)
  pref_marcar_assento: boolean | null;
  pref_upgrade_classe: string | null;
  // Histórico de viagem (dado PESSOAL)
  ja_viajou_internacional: boolean | null;
  paises_visitados: string | null;
  // Acompanhante (dado da RESERVA)
  acompanhante_nome: string | null;
  acompanhante_divide_quarto: string | null;
  acompanhante_vinculo?: string | null;
  acompanhante_dividir_com?: string | null;
  // Perfil/conexão do formulário de inscrição (jsonb) + foto (migration 0038)
  perfil_viajante?: PerfilViajante | null;
  foto_arquivo_id?: string | null;
  /** ExpedAmigo: a expedição só aparece no portal do viajante quando liberada. Migration 0040. */
  liberado_expedamigo?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Perguntas de perfil/conexão do formulário de inscrição (coluna jsonb
 * `perfil_viajante`). Guardado por RESERVA (não propaga). Migration 0038.
 */
export type PerfilViajante = {
  profissao?: string;
  instagram?: string;
  camiseta?: string;
  musica?: string;
  descricao_grupo?: string;
  anima_expedicao?: string;
  significado?: string;
  confirmou_veracidade?: boolean;
};

/**
 * Questionário de saúde do passageiro (coluna jsonb `saude`). Dado PESSOAL —
 * propaga entre as expedições da pessoa. Perguntas Sim/Não guardam "Sim"/"Não";
 * os "_qual" guardam o detalhe (texto). Campos ausentes = não respondido.
 */
export type SaudePassageiro = {
  problema_saude?: string;
  problema_saude_qual?: string;
  medicamento_diario?: string;
  medicamento_diario_qual?: string;
  alergia_medicamento?: string;
  alergia_medicamento_qual?: string;
  alergia_alimentar?: string;
  alergia_alimentar_qual?: string;
  restricao_alimentar?: string;
  restricao_alimentar_qual?: string;
  limitacao_fisica?: string;
  limitacao_fisica_qual?: string;
  cirurgia_importante?: string;
  cirurgia_qual?: string;
  vacina_febre_amarela?: string;
  /** id do arquivo do Certificado de Vacinação (Febre Amarela), quando anexado. */
  vacina_febre_amarela_arquivo_id?: string;
  // Acréscimos da médica da agência (migration 0027 — só JSONB, sem coluna).
  /** Detalhe do medicamento diário: refrigeração / equipamento-seringa. */
  medicamento_refrigeracao?: string;
  anafilaxia_emergencia?: string;
  gravidez?: string;
  gravidez_semanas?: string;
  enjoo_transporte?: string;
  medo_altura?: string;
  ronca_cpap?: string;
  /** "Se sim, qual?" do sono (ronco, CPAP, sono leve) — preenchido quando ronca_cpap = "Sim". */
  ronca_cpap_qual?: string;
};

export type RequisitoDestinoRow = {
  id: string;
  destino: string;
  tipo: TipoRequisito;
  descricao: string;
  obrigatoriedade: Obrigatoriedade;
  bloqueia_embarque: boolean;
  meses_validade_minima: number | null;
  papel_responsavel: PapelUsuario | null;
  ordem: number;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type PassageiroRequisitoRow = {
  id: string;
  passageiro_id: string;
  tipo: TipoRequisito;
  descricao: string;
  status: StatusRequisito;
  obrigatoriedade: Obrigatoriedade;
  bloqueia_embarque: boolean;
  validade: string | null;
  numero: string | null;
  arquivo_id: string | null;
  responsavel_id: string | null;
  verificado_em: string | null;
  verificado_por: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

/** Linha da view vw_prontidao_passageiro (mesma lógica em lib/prontidao/regras.ts). */
export type ProntidaoPassageiroView = {
  passageiro_id: string;
  expedicao_id: string;
  nome_completo: string;
  data_embarque: string;
  data_retorno: string;
  dias_ate_embarque: number;
  bloqueios_abertos: number;
  pendencias_leves: number;
  passaporte_em_alerta: number;
  tem_saldo: boolean;
  prontidao: Prontidao;
}

export type CategoriaArquivo =
  | "Aéreos"
  | "Documentos pessoais"
  | "Contrato"
  | "Bilhetes"
  | "Vistos"
  | "Seguros"
  | "Hospedagem"
  | "Vouchers"
  | "Cartão de embarque"
  | "Outros";

export type ArquivoRow = {
  id: string;
  expedicao_id: string;
  passageiro_id: string | null;
  categoria: CategoriaArquivo;
  nome: string;
  descricao: string | null;
  mime: string | null;
  tamanho_bytes: number | null;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type GrupoExpedicaoRow = {
  id: string;
  expedicao_id: string;
  nome: string;
  data_embarque: string | null;
  data_retorno: string | null;
  pax_planejados: number;
  observacoes: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export type QuartoRow = {
  id: string;
  expedicao_id: string;
  numero: string;
  tipo: TipoQuarto;
  hotel_cidade: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string;
  observacoes: string | null;
  /** Hotel deste quarto pertence a uma extensão (só quem contratou entra). Migration 0054. */
  extensao_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Alocação muitos-para-muitos: um passageiro pode ter um quarto por hotel/trecho. */
export type AlocacaoQuartoRow = {
  id: string;
  passageiro_id: string;
  quarto_id: string;
  created_at: string;
}

export type CustoRow = {
  id: string;
  expedicao_id: string;
  categoria: CategoriaCusto;
  servico: string;
  fornecedor_id: string | null;
  cidade: string | null;
  data_servico: string | null;
  moeda: string;
  valor_planejado: number;
  valor_realizado: number | null;
  cambio_aplicado: number | null;
  valor_planejado_brl: number;
  valor_realizado_brl: number | null;
  status: StatusCusto;
  pago_por: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type PagamentoRow = {
  id: string;
  custo_id: string;
  fornecedor_id: string | null;
  servico: string;
  moeda: string;
  valor_total: number;
  entrada: number;
  saldo: number;
  vencimento_saldo: string | null;
  status: StatusPagamento;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type ChecklistItemRow = {
  id: string;
  expedicao_id: string;
  etapa: EtapaChecklist;
  tarefa: string;
  responsavel_id: string | null;
  status: StatusChecklist;
  prazo: string | null;
  prioridade: Prioridade;
  dependencia_id: string | null;
  parent_id: string | null; // subtarefa: aponta pro item pai
  ordem: number; // ordem dentro da fase (ou dentro do pai)
  evidencia_url: string | null;
  bitrix_task_id: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type LinkExpedicaoRow = {
  id: string;
  expedicao_id: string;
  label: string;
  url: string;
  ordem: number;
  created_at: string;
  updated_at: string;
}

// ===== Portal do ExpedAmigo (conteúdo da viagem, migration 0021) =====

export type RoteiroDiaRow = {
  id: string;
  expedicao_id: string;
  dia: number;
  data: string | null;
  titulo: string;
  descricao: string | null;
  cidade: string | null;
  refeicoes: string | null;
  hospedagem: string | null;
  /** Extensão a que este dia pertence (null = grupo principal, todos veem). Migration 0052. */
  extensao_id: string | null;
  /** true = só aparece para quem NÃO contratou extensão (ex.: último dia do grupo base). Migration 0053. */
  apenas_sem_extensao: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type ExpedicaoVooRow = {
  id: string;
  expedicao_id: string;
  trecho: string;
  companhia: string | null;
  numero_voo: string | null;
  origem: string | null;
  destino: string | null;
  partida: string | null;
  chegada: string | null;
  localizador: string | null;
  observacoes: string | null;
  /** Voucher anexado (arquivos.id), migration 0024. */
  arquivo_id: string | null;
  /** Extensão a que este voo pertence (null = grupo principal, todos veem). Migration 0052. */
  extensao_id: string | null;
  /** true = só aparece para quem NÃO contratou extensão (ex.: voo de volta do grupo base). Migration 0053. */
  apenas_sem_extensao: boolean;
  /** Subgrupo (G1/G2) a que este voo pertence (null = todos veem). Migration 0055. */
  grupo_id: string | null;
  /** Voo INDIVIDUAL de um passageiro (null = voo de grupo). Migration 0057. Quando um
   *  passageiro tem voo(s) próprio(s), o portal mostra SÓ os dele (ignora os do grupo). */
  passageiro_id: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type ExpedicaoPasseioRow = {
  id: string;
  expedicao_id: string;
  nome: string;
  data: string | null;
  horario: string | null;
  local: string | null;
  incluso: boolean;
  observacoes: string | null;
  /** Voucher/ingresso anexado (arquivos.id), migration 0024. */
  arquivo_id: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type ExpedicaoInfoRow = {
  id: string;
  expedicao_id: string;
  titulo: string;
  conteudo: string;
  /** PDF/imagem anexado (arquivos.id), migration 0033 — baixável no portal. */
  arquivo_id: string | null;
  /** Nome do link do 1º arquivo (migration 0034); vazio → "Baixar PDF". */
  arquivo_label: string | null;
  /** 2º arquivo opcional e seu rótulo (migration 0034). */
  arquivo_id_2: string | null;
  arquivo_label_2: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type RoteiroDiaFotoRow = {
  id: string;
  expedicao_id: string;
  roteiro_dia_id: string;
  arquivo_id: string;
  legenda: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

export type ExpedicaoAvisoRow = {
  id: string;
  expedicao_id: string;
  tipo: string; // Aviso | Boa prática | Dica
  titulo: string;
  conteudo: string;
  ordem: number;
  created_at: string;
  updated_at: string;
};

// ===== Passeios opcionais dos dias livres (migration 0044) =====
export type PasseioOpcionalRow = {
  id: string;
  expedicao_id: string;
  roteiro_dia_id: string;
  titulo: string | null;
  descricao: string | null;
  /** Foto do passeio (arquivos.id). */
  foto_arquivo_id: string | null;
  /** Link "Falar no WhatsApp". */
  whatsapp_url: string | null;
  /** 'opcional' = substitui o dia inteiro (com WhatsApp); 'adicional' = só "adquirido" (sem WhatsApp, não substitui). Migration 0049. */
  tipo: string;
  ordem: number;
  created_at: string;
  updated_at: string;
};

/** Compra de um passeio opcional por um passageiro — presença = comprou. */
export type PasseioOpcionalCompraRow = {
  id: string;
  passageiro_id: string;
  passeio_opcional_id: string;
  created_at: string;
};

// ===== Extensões da expedição (dias/voos extras por subgrupo, migration 0052) =====
export type ExtensaoRow = {
  id: string;
  expedicao_id: string;
  nome: string;
  descricao: string | null;
  /** Voucher de hospedagem próprio da extensão (arquivos.id). Migration 0054. */
  hospedagem_voucher_arquivo_id: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

/** Contratação de uma extensão por um passageiro — presença = contratou. */
export type PassageiroExtensaoRow = {
  id: string;
  passageiro_id: string;
  extensao_id: string;
  created_at: string;
};

// ===== Roteiro do Líder (resumo operacional dia a dia, migration 0029) =====
export type RoteiroLiderDiaRow = {
  id: string;
  expedicao_id: string;
  dia: number;
  data: string | null;
  fase: string | null;
  local: string | null;
  programacao: string | null;
  lideres_ativos: string | null;
  pax: string | null;
  observacoes: string | null;
  alerta_nivel: string | null; // Crítico | Atenção | Verificar
  alerta_texto: string | null;
  alerta_acao: string | null;
  alerta_responsavel: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
};

// ===== Senha de acesso por pessoa (ExpedAmigo / Líder, migration 0031) =====
export type AcessoSenhaRow = {
  cpf: string;
  senha_hash: string | null;
  /** Senha inicial aleatória (legível) até o viajante criar a própria. Migration 0040. */
  senha_provisoria: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentoRow = {
  id: string;
  passageiro_id: string;
  visto_necessario: boolean;
  status_visto: string;
  seguro_status: string;
  apolice_url: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export type AuditLogRow = {
  id: string;
  tabela: string;
  registro_id: string;
  usuario_id: string | null;
  acao: "insert" | "update" | "delete";
  dados_antes: Json | null;
  dados_depois: Json | null;
  origem: string | null;
  created_at: string;
}

/** Inscrição do formulário público aguardando aprovação (staging; migration 0037). */
export type InscricaoPendenteRow = {
  id: string;
  expedicao_id: string;
  cpf: string;
  data_nascimento: string | null;
  nome_completo: string | null;
  dados: Json;
  passaporte_arquivo_id: string | null;
  foto_arquivo_id: string | null;
  origem: string | null;
  /** 'pendente' (fila) | 'recusada' (aguardando à parte). Migration 0041. */
  status: string;
  recusada_em: string | null;
  /** Motivo da recusa + anexo técnico opcional (migration 0042). */
  motivo_recusa: string | null;
  recusa_arquivo_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Log de acesso ao portal ExpedAmigo (migration 0043). */
export type ExpedamigoAcessoRow = {
  id: string;
  cpf: string;
  evento: "login" | "download_pdf" | "viagem_aberta" | "download_voucher" | "primeiro_acesso";
  expedicao_id: string | null;
  created_at: string;
}

// ========== Database shape (formato esperado pelo @supabase/supabase-js) ==========

export type Database = {
  public: {
    Tables: {
      usuarios: { Row: UsuarioRow; Insert: Partial<UsuarioRow> & Pick<UsuarioRow, "id" | "email" | "nome">; Update: Partial<UsuarioRow> };
      fornecedores: { Row: FornecedorRow; Insert: Partial<FornecedorRow> & Pick<FornecedorRow, "nome" | "tipo">; Update: Partial<FornecedorRow> };
      cambios: { Row: CambioRow; Insert: { moeda: string; taxa_brl: number; atualizado_em?: string }; Update: Partial<CambioRow> };
      expedicoes: { Row: ExpedicaoRow; Insert: Partial<ExpedicaoRow> & Pick<ExpedicaoRow, "codigo" | "nome" | "destino" | "data_embarque" | "data_retorno">; Update: Partial<ExpedicaoRow> };
      passageiros: { Row: PassageiroRow; Insert: Partial<PassageiroRow> & Pick<PassageiroRow, "nome_completo">; Update: Partial<PassageiroRow> };
      grupos_expedicao: { Row: GrupoExpedicaoRow; Insert: Partial<GrupoExpedicaoRow> & Pick<GrupoExpedicaoRow, "expedicao_id" | "nome">; Update: Partial<GrupoExpedicaoRow> };
      arquivos: { Row: ArquivoRow; Insert: Partial<ArquivoRow> & Pick<ArquivoRow, "expedicao_id" | "nome" | "storage_path">; Update: Partial<ArquivoRow> };
      quartos: { Row: QuartoRow; Insert: Partial<QuartoRow> & Pick<QuartoRow, "expedicao_id" | "numero" | "tipo">; Update: Partial<QuartoRow> };
      passageiro_quarto: { Row: AlocacaoQuartoRow; Insert: Partial<AlocacaoQuartoRow> & Pick<AlocacaoQuartoRow, "passageiro_id" | "quarto_id">; Update: Partial<AlocacaoQuartoRow> };
      custos: { Row: CustoRow; Insert: Partial<CustoRow> & Pick<CustoRow, "expedicao_id" | "categoria" | "servico" | "moeda" | "valor_planejado">; Update: Partial<CustoRow> };
      pagamentos: { Row: PagamentoRow; Insert: Partial<PagamentoRow> & Pick<PagamentoRow, "custo_id" | "servico" | "moeda" | "valor_total">; Update: Partial<PagamentoRow> };
      checklist_itens: { Row: ChecklistItemRow; Insert: Partial<ChecklistItemRow> & Pick<ChecklistItemRow, "expedicao_id" | "etapa" | "tarefa">; Update: Partial<ChecklistItemRow> };
      documentos: { Row: DocumentoRow; Insert: Partial<DocumentoRow> & Pick<DocumentoRow, "passageiro_id">; Update: Partial<DocumentoRow> };
      links_expedicao: { Row: LinkExpedicaoRow; Insert: Partial<LinkExpedicaoRow> & Pick<LinkExpedicaoRow, "expedicao_id" | "label" | "url">; Update: Partial<LinkExpedicaoRow> };
      roteiro_dias: { Row: RoteiroDiaRow; Insert: Partial<RoteiroDiaRow> & Pick<RoteiroDiaRow, "expedicao_id" | "titulo">; Update: Partial<RoteiroDiaRow> };
      expedicao_voos: { Row: ExpedicaoVooRow; Insert: Partial<ExpedicaoVooRow> & Pick<ExpedicaoVooRow, "expedicao_id" | "trecho">; Update: Partial<ExpedicaoVooRow> };
      expedicao_passeios: { Row: ExpedicaoPasseioRow; Insert: Partial<ExpedicaoPasseioRow> & Pick<ExpedicaoPasseioRow, "expedicao_id" | "nome">; Update: Partial<ExpedicaoPasseioRow> };
      expedicao_info: { Row: ExpedicaoInfoRow; Insert: Partial<ExpedicaoInfoRow> & Pick<ExpedicaoInfoRow, "expedicao_id" | "titulo" | "conteudo">; Update: Partial<ExpedicaoInfoRow> };
      roteiro_dia_fotos: { Row: RoteiroDiaFotoRow; Insert: Partial<RoteiroDiaFotoRow> & Pick<RoteiroDiaFotoRow, "expedicao_id" | "roteiro_dia_id" | "arquivo_id">; Update: Partial<RoteiroDiaFotoRow> };
      expedicao_avisos: { Row: ExpedicaoAvisoRow; Insert: Partial<ExpedicaoAvisoRow> & Pick<ExpedicaoAvisoRow, "expedicao_id" | "titulo" | "conteudo">; Update: Partial<ExpedicaoAvisoRow> };
      passeios_opcionais: { Row: PasseioOpcionalRow; Insert: Partial<PasseioOpcionalRow> & Pick<PasseioOpcionalRow, "expedicao_id" | "roteiro_dia_id">; Update: Partial<PasseioOpcionalRow> };
      passeio_opcional_compras: { Row: PasseioOpcionalCompraRow; Insert: Partial<PasseioOpcionalCompraRow> & Pick<PasseioOpcionalCompraRow, "passageiro_id" | "passeio_opcional_id">; Update: Partial<PasseioOpcionalCompraRow> };
      extensoes: { Row: ExtensaoRow; Insert: Partial<ExtensaoRow> & Pick<ExtensaoRow, "expedicao_id" | "nome">; Update: Partial<ExtensaoRow> };
      passageiro_extensao: { Row: PassageiroExtensaoRow; Insert: Partial<PassageiroExtensaoRow> & Pick<PassageiroExtensaoRow, "passageiro_id" | "extensao_id">; Update: Partial<PassageiroExtensaoRow> };
      roteiro_lider_dias: { Row: RoteiroLiderDiaRow; Insert: Partial<RoteiroLiderDiaRow> & Pick<RoteiroLiderDiaRow, "expedicao_id">; Update: Partial<RoteiroLiderDiaRow> };
      acesso_senhas: { Row: AcessoSenhaRow; Insert: Partial<AcessoSenhaRow> & Pick<AcessoSenhaRow, "cpf" | "senha_hash">; Update: Partial<AcessoSenhaRow> };
      requisitos_destino: { Row: RequisitoDestinoRow; Insert: Partial<RequisitoDestinoRow> & Pick<RequisitoDestinoRow, "destino" | "tipo" | "descricao">; Update: Partial<RequisitoDestinoRow> };
      passageiro_requisitos: { Row: PassageiroRequisitoRow; Insert: Partial<PassageiroRequisitoRow> & Pick<PassageiroRequisitoRow, "passageiro_id" | "tipo" | "descricao">; Update: Partial<PassageiroRequisitoRow> };
      audit_log: { Row: AuditLogRow; Insert: Partial<AuditLogRow> & Pick<AuditLogRow, "tabela" | "registro_id" | "acao">; Update: Partial<AuditLogRow> };
      inscricoes_pendentes: { Row: InscricaoPendenteRow; Insert: Partial<InscricaoPendenteRow> & Pick<InscricaoPendenteRow, "expedicao_id" | "cpf" | "dados">; Update: Partial<InscricaoPendenteRow> };
      expedamigo_acessos: { Row: ExpedamigoAcessoRow; Insert: Partial<ExpedamigoAcessoRow> & Pick<ExpedamigoAcessoRow, "cpf" | "evento">; Update: Partial<ExpedamigoAcessoRow> };
    };
    Views: {
      vw_prontidao_passageiro: { Row: ProntidaoPassageiroView };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TableInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TableUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

// Tipos enriquecidos pra UI (com agregados)
export type ExpedicaoComAgregados = ExpedicaoRow & {
  pax_confirmados: number;
  docs_pendentes: number;
  /** Fração (0..1) dos processos do checklist concluídos. */
  checklist_pct: number;
  /** Passageiros aptos a embarcar / total avaliado (não cancelados). */
  prontidao_aptos: number;
  prontidao_total: number;
  responsavel_op_nome: string | null;
  responsavel_com_nome: string | null;
};
