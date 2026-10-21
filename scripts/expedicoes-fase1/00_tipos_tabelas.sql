-- Fase 1 · parte A: tipos e tabelas do Sistema de Expedições, criados no QS com os MESMOS nomes
-- (extraídos do projeto bnbpsuenlokhljrkvlke em 21/10/2026; nenhum nome colide com o QS).
create type acao_audit as enum ('insert', 'update', 'delete');
create type categoria_arquivo as enum ('Aéreos', 'Documentos pessoais', 'Bilhetes', 'Vistos', 'Seguros', 'Hospedagem', 'Vouchers', 'Outros', 'Contrato', 'Cartão de embarque');
create type categoria_custo as enum ('Hotelaria', 'Aéreo', 'Terrestre', 'Ingressos', 'Guias', 'Seguro', 'Taxas', 'Brindes', 'Outros');
create type etapa_checklist as enum ('Após o fechamento', '12 a 6 meses', '6 a 2 meses', '2 meses a 15 dias', 'Na semana', 'Pós-viagem');
create type obrigatoriedade as enum ('Obrigatório', 'Condicional', 'Recomendado');
create type papel_usuario as enum ('admin', 'operacional', 'comercial', 'financeiro', 'leitura', 'relacionamento');
create type prioridade as enum ('Baixa', 'Média', 'Alta', 'Crítica');
create type status_checklist as enum ('Pendente', 'Em andamento', 'Atenção', 'Concluído', 'Bloqueado');
create type status_custo as enum ('A programar', 'Programado', 'Pago', 'Parcial', 'Vencido');
create type status_expedicao as enum ('Planejamento', 'Vendas Abertas', 'Em andamento', 'Concluída', 'Cancelada');
create type status_fornecedor as enum ('Ativo', 'Pausado', 'Bloqueado');
create type status_pagamento as enum ('Pendente', 'Programado', 'Pago', 'Parcial', 'Vencido', 'Cancelado');
create type status_requisito as enum ('Pendente', 'Em análise', 'Enviado', 'Aprovado', 'Vencido', 'Dispensado', 'Reprovado');
create type status_reserva as enum ('Lead', 'Pré-reserva', 'Confirmado', 'Cancelado');
create type tipo_fornecedor as enum ('DMC', 'Hotel', 'Guia', 'Aéreo', 'Receptivo', 'Seguro', 'Outros');
create type tipo_passageiro as enum ('Pagante', 'Cortesia', 'Líder');
create type tipo_quarto as enum ('Single', 'Duplo', 'Twin', 'Triplo', 'Compartilhado', 'Líder');
create type tipo_requisito as enum ('Passaporte', 'RG', 'Visto', 'Vacina', 'Seguro', 'Aéreo Internacional', 'Aéreo Doméstico', 'Voo Interno', 'Contrato', 'Autorização de Menor', 'Pagamento', 'Dados Pessoais', 'Documento Pessoal', 'Ingresso Machu Picchu', 'Ingresso Trem Machu Picchu');

create table acesso_links (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  passageiro_id uuid not null,
  expira_em timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);
create table acesso_senhas (
  cpf text not null,
  senha_hash text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  senha_provisoria text
);
create table arquivos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  passageiro_id uuid,
  categoria categoria_arquivo default 'Outros'::categoria_arquivo not null,
  nome text not null,
  descricao text,
  mime text,
  tamanho_bytes bigint,
  storage_path text not null,
  uploaded_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table audit_log (
  id uuid default gen_random_uuid() not null,
  tabela text not null,
  registro_id uuid not null,
  usuario_id uuid,
  acao acao_audit not null,
  dados_antes jsonb,
  dados_depois jsonb,
  origem text,
  created_at timestamp with time zone default now() not null
);
create table cambios (
  moeda text not null,
  taxa_brl numeric(14,6) not null,
  atualizado_em timestamp with time zone default now() not null
);
create table checklist_itens (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  etapa etapa_checklist not null,
  tarefa text not null,
  responsavel_id uuid,
  status status_checklist default 'Pendente'::status_checklist not null,
  prazo date,
  prioridade prioridade default 'Média'::prioridade not null,
  dependencia_id uuid,
  evidencia_url text,
  bitrix_task_id text,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  parent_id uuid,
  ordem integer default 0 not null
);
create table compras_bitrix (
  id uuid default gen_random_uuid() not null,
  bitrix_deal_id text not null,
  bitrix_contact_id text,
  cpf text,
  nome_contato text,
  titulo text,
  data_compra date,
  valor numeric,
  moeda text default 'BRL'::text,
  funil text,
  etapa text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  produto text
);
create table custos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  categoria categoria_custo not null,
  servico text not null,
  fornecedor_id uuid,
  cidade text,
  data_servico date,
  moeda text default 'BRL'::text not null,
  valor_planejado numeric(14,2) default 0 not null,
  valor_realizado numeric(14,2),
  cambio_aplicado numeric(14,6),
  valor_planejado_brl numeric(14,2) generated always as ((valor_planejado * COALESCE(cambio_aplicado, (1)::numeric))) stored,
  valor_realizado_brl numeric(14,2),
  status status_custo default 'A programar'::status_custo not null,
  pago_por uuid,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table documentos (
  id uuid default gen_random_uuid() not null,
  passageiro_id uuid not null,
  visto_necessario boolean default false not null,
  status_visto text default 'Não necessário'::text not null,
  seguro_status text default 'Pendente'::text not null,
  apolice_url text,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table expedamigo_acessos (
  id uuid default gen_random_uuid() not null,
  cpf text not null,
  evento text not null,
  expedicao_id uuid,
  created_at timestamp with time zone default now() not null
);
create table expedicao_avisos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  tipo text default 'Aviso'::text not null,
  titulo text not null,
  conteudo text not null,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table expedicao_info (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  titulo text not null,
  conteudo text not null,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  arquivo_id uuid,
  arquivo_label text,
  arquivo_id_2 uuid,
  arquivo_label_2 text
);
create table expedicao_passeios (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  nome text not null,
  data date,
  horario text,
  local text,
  incluso boolean default true not null,
  observacoes text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  arquivo_id uuid
);
create table expedicao_voos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  trecho text default 'Ida'::text not null,
  companhia text,
  numero_voo text,
  origem text,
  destino text,
  partida text,
  chegada text,
  localizador text,
  observacoes text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  arquivo_id uuid,
  extensao_id uuid,
  apenas_sem_extensao boolean default false not null,
  grupo_id uuid,
  passageiro_id uuid
);
create table expedicoes (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  nome text not null,
  destino text not null,
  data_embarque date not null,
  data_retorno date not null,
  responsavel_operacional_id uuid,
  responsavel_comercial_id uuid,
  dmc_principal_id uuid,
  status status_expedicao default 'Planejamento'::status_expedicao not null,
  pax_planejados integer default 0 not null,
  pax_cortesia integer default 0 not null,
  preco_venda_brl numeric(14,2) default 0 not null,
  bitrix_pipeline_id text,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  ordem integer,
  viagem_grupo text,
  grupo_rotulo text,
  hospedagem_voucher_arquivo_id uuid,
  tipo text default 'expedicao'::text not null
);
create table extensoes (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  nome text not null,
  descricao text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  hospedagem_voucher_arquivo_id uuid
);
create table fornecedores (
  id uuid default gen_random_uuid() not null,
  nome text not null,
  tipo tipo_fornecedor not null,
  contato_nome text,
  contato_email text,
  contato_whatsapp text,
  destino_cidade text,
  servicos text[],
  moeda_padrao text default 'BRL'::text not null,
  politica_pagamento text,
  status status_fornecedor default 'Ativo'::status_fornecedor not null,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table grupos_expedicao (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  nome text not null,
  data_embarque date,
  data_retorno date,
  pax_planejados integer default 0 not null,
  observacoes text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table inscricoes_decisoes (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid,
  cpf text,
  nome_completo text,
  acao text not null,
  motivo text,
  decidido_por uuid,
  decidido_por_nome text,
  created_at timestamp with time zone default now() not null
);
create table inscricoes_pendentes (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  cpf text not null,
  data_nascimento date,
  nome_completo text,
  dados jsonb not null,
  passaporte_arquivo_id uuid,
  origem text default 'Formulário público'::text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  foto_arquivo_id uuid,
  status text default 'pendente'::text not null,
  recusada_em timestamp with time zone,
  motivo_recusa text,
  recusa_arquivo_id uuid
);
create table links_expedicao (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  label text not null,
  url text not null,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table pagamentos (
  id uuid default gen_random_uuid() not null,
  custo_id uuid not null,
  fornecedor_id uuid,
  servico text not null,
  moeda text default 'BRL'::text not null,
  valor_total numeric(14,2) default 0 not null,
  entrada numeric(14,2) default 0 not null,
  saldo numeric(14,2) generated always as ((valor_total - entrada)) stored,
  vencimento_saldo date,
  status status_pagamento default 'Pendente'::status_pagamento not null,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table passageiro_extensao (
  id uuid default gen_random_uuid() not null,
  passageiro_id uuid not null,
  extensao_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table passageiro_quarto (
  id uuid default gen_random_uuid() not null,
  passageiro_id uuid not null,
  quarto_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table passageiro_requisitos (
  id uuid default gen_random_uuid() not null,
  passageiro_id uuid not null,
  tipo tipo_requisito not null,
  descricao text not null,
  status status_requisito default 'Pendente'::status_requisito not null,
  obrigatoriedade obrigatoriedade default 'Obrigatório'::obrigatoriedade not null,
  bloqueia_embarque boolean default true not null,
  validade date,
  numero text,
  arquivo_id uuid,
  responsavel_id uuid,
  verificado_em timestamp with time zone,
  verificado_por uuid,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table passageiros (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid,
  bitrix_contact_id text,
  bitrix_deal_id text,
  nome_completo text not null,
  tipo tipo_passageiro default 'Pagante'::tipo_passageiro not null,
  cpf text,
  passaporte text,
  data_nascimento date,
  validade_passaporte date,
  email text,
  telefone text,
  status_reserva status_reserva default 'Lead'::status_reserva not null,
  voo_nacional_necessario boolean default false not null,
  companhia_aerea text,
  localizador text,
  quarto_id uuid,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  grupo_id uuid,
  valor_contratado_brl numeric(14,2) default 0 not null,
  valor_pago_brl numeric(14,2) default 0 not null,
  saldo_brl numeric(14,2) generated always as ((valor_contratado_brl - valor_pago_brl)) stored,
  status_financeiro text default 'Em aberto'::text not null,
  contato_emergencia_nome text,
  contato_emergencia_fone text,
  restricoes_alimentares text,
  condicoes_medicas text,
  contrato_assinado boolean default false not null,
  checkin_online_feito boolean default false not null,
  saude jsonb,
  conexao_viagem_id uuid,
  passaporte_arquivo_id uuid,
  pendente_aprovacao boolean default false not null,
  inscricao_origem text,
  endereco_cep text,
  endereco_rua text,
  endereco_numero text,
  endereco_complemento text,
  endereco_bairro text,
  endereco_cidade text,
  endereco_estado text,
  pref_marcar_assento boolean,
  pref_upgrade_classe text,
  ja_viajou_internacional boolean,
  paises_visitados text,
  acompanhante_nome text,
  acompanhante_divide_quarto text,
  contato_emergencia_vinculo text,
  perfil_viajante jsonb,
  foto_arquivo_id uuid,
  acompanhante_vinculo text,
  acompanhante_dividir_com text,
  liberado_expedamigo boolean default false not null
);
create table passeio_opcional_compras (
  id uuid default gen_random_uuid() not null,
  passageiro_id uuid not null,
  passeio_opcional_id uuid not null,
  created_at timestamp with time zone default now() not null
);
create table passeios_opcionais (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  roteiro_dia_id uuid not null,
  titulo text,
  descricao text,
  foto_arquivo_id uuid,
  whatsapp_url text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  tipo text default 'opcional'::text not null
);
create table quartos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  numero text not null,
  tipo tipo_quarto not null,
  hotel_cidade text,
  check_in date,
  check_out date,
  status text default 'Reservado'::text not null,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  extensao_id uuid
);
create table requisitos_destino (
  id uuid default gen_random_uuid() not null,
  destino text not null,
  tipo tipo_requisito not null,
  descricao text not null,
  obrigatoriedade obrigatoriedade default 'Obrigatório'::obrigatoriedade not null,
  bloqueia_embarque boolean default true not null,
  meses_validade_minima integer,
  papel_responsavel papel_usuario,
  ordem integer default 0 not null,
  observacoes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table roteiro_dia_fotos (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  roteiro_dia_id uuid not null,
  arquivo_id uuid not null,
  legenda text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table roteiro_dias (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  dia integer default 1 not null,
  data date,
  titulo text not null,
  descricao text,
  cidade text,
  refeicoes text,
  hospedagem text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  extensao_id uuid,
  apenas_sem_extensao boolean default false not null
);
create table roteiro_lider_dias (
  id uuid default gen_random_uuid() not null,
  expedicao_id uuid not null,
  dia integer default 1 not null,
  data date,
  fase text,
  local text,
  programacao text,
  lideres_ativos text,
  pax text,
  observacoes text,
  alerta_nivel text,
  alerta_texto text,
  alerta_acao text,
  alerta_responsavel text,
  ordem integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);
create table usuarios (
  id uuid not null,
  email text not null,
  nome text not null,
  papel papel_usuario default 'leitura'::papel_usuario not null,
  avatar_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  senha_provisoria boolean default true not null
);
