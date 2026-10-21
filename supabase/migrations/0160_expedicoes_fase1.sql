-- 0160 · EXPEDIÇÕES NO QS — Fase 1 (Bruno 21/10/2026): o banco do Sistema de Expedições
-- (bnbpsuenlokhljrkvlke) passa a morar no QS, com os mesmos nomes. APLICADA em 3 partes
-- (0160a tipos/tabelas/chaves, 0160b FKs, 0160c funções/RLS/gatilhos/realtime/buckets).
-- Dados e arquivos: scripts/expedicoes-fase1/copiar-dados.mjs e copiar-arquivos.mjs.

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

-- Fase 1 · parte B: chaves primárias/únicas/checks + RLS ligado (sem policy = só service role enxerga).
alter table acesso_links add constraint acesso_links_pkey PRIMARY KEY (id);
alter table acesso_links add constraint acesso_links_codigo_key UNIQUE (codigo);
alter table acesso_senhas add constraint acesso_senhas_pkey PRIMARY KEY (cpf);
alter table arquivos add constraint arquivos_storage_path_key UNIQUE (storage_path);
alter table arquivos add constraint arquivos_pkey PRIMARY KEY (id);
alter table audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table cambios add constraint cambios_pkey PRIMARY KEY (moeda);
alter table cambios add constraint cambios_taxa_brl_check CHECK ((taxa_brl > (0)::numeric));
alter table checklist_itens add constraint checklist_itens_pkey PRIMARY KEY (id);
alter table compras_bitrix add constraint compras_bitrix_bitrix_deal_id_key UNIQUE (bitrix_deal_id);
alter table compras_bitrix add constraint compras_bitrix_pkey PRIMARY KEY (id);
alter table custos add constraint custos_pkey PRIMARY KEY (id);
alter table documentos add constraint documentos_pkey PRIMARY KEY (id);
alter table expedamigo_acessos add constraint expedamigo_acessos_evento_chk CHECK ((evento = ANY (ARRAY['login'::text, 'download_pdf'::text, 'viagem_aberta'::text, 'download_voucher'::text, 'primeiro_acesso'::text])));
alter table expedamigo_acessos add constraint expedamigo_acessos_pkey PRIMARY KEY (id);
alter table expedicao_avisos add constraint expedicao_avisos_pkey PRIMARY KEY (id);
alter table expedicao_info add constraint expedicao_info_pkey PRIMARY KEY (id);
alter table expedicao_passeios add constraint expedicao_passeios_pkey PRIMARY KEY (id);
alter table expedicao_voos add constraint expedicao_voos_pkey PRIMARY KEY (id);
alter table expedicoes add constraint expedicoes_check CHECK ((data_retorno >= data_embarque));
alter table expedicoes add constraint expedicoes_codigo_key UNIQUE (codigo);
alter table expedicoes add constraint expedicoes_pkey PRIMARY KEY (id);
alter table expedicoes add constraint expedicoes_tipo_chk CHECK ((tipo = ANY (ARRAY['expedicao'::text, 'pacote'::text])));
alter table extensoes add constraint extensoes_pkey PRIMARY KEY (id);
alter table fornecedores add constraint fornecedores_pkey PRIMARY KEY (id);
alter table grupos_expedicao add constraint grupos_expedicao_expedicao_id_nome_key UNIQUE (expedicao_id, nome);
alter table grupos_expedicao add constraint grupos_expedicao_pkey PRIMARY KEY (id);
alter table grupos_expedicao add constraint grupos_expedicao_check CHECK (((data_retorno IS NULL) OR (data_embarque IS NULL) OR (data_retorno >= data_embarque)));
alter table inscricoes_decisoes add constraint inscricoes_decisoes_acao_check CHECK ((acao = ANY (ARRAY['aprovada'::text, 'recusada'::text, 'restaurada'::text, 'excluida'::text])));
alter table inscricoes_decisoes add constraint inscricoes_decisoes_pkey PRIMARY KEY (id);
alter table inscricoes_pendentes add constraint inscricoes_pendentes_expedicao_id_cpf_key UNIQUE (expedicao_id, cpf);
alter table inscricoes_pendentes add constraint inscricoes_pendentes_status_chk CHECK ((status = ANY (ARRAY['pendente'::text, 'recusada'::text])));
alter table inscricoes_pendentes add constraint inscricoes_pendentes_pkey PRIMARY KEY (id);
alter table links_expedicao add constraint links_expedicao_pkey PRIMARY KEY (id);
alter table pagamentos add constraint pagamentos_pkey PRIMARY KEY (id);
alter table passageiro_extensao add constraint passageiro_extensao_passageiro_id_extensao_id_key UNIQUE (passageiro_id, extensao_id);
alter table passageiro_extensao add constraint passageiro_extensao_pkey PRIMARY KEY (id);
alter table passageiro_quarto add constraint passageiro_quarto_passageiro_id_quarto_id_key UNIQUE (passageiro_id, quarto_id);
alter table passageiro_quarto add constraint passageiro_quarto_pkey PRIMARY KEY (id);
alter table passageiro_requisitos add constraint passageiro_requisitos_passageiro_id_tipo_key UNIQUE (passageiro_id, tipo);
alter table passageiro_requisitos add constraint passageiro_requisitos_pkey PRIMARY KEY (id);
alter table passageiros add constraint passageiros_bitrix_deal_id_key UNIQUE (bitrix_deal_id);
alter table passageiros add constraint passageiros_pkey PRIMARY KEY (id);
alter table passeio_opcional_compras add constraint passeio_opcional_compras_pkey PRIMARY KEY (id);
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passageiro_id_passeio_opcional_id_key UNIQUE (passageiro_id, passeio_opcional_id);
alter table passeios_opcionais add constraint passeios_opcionais_pkey PRIMARY KEY (id);
alter table quartos add constraint quartos_pkey PRIMARY KEY (id);
alter table requisitos_destino add constraint requisitos_destino_destino_tipo_key UNIQUE (destino, tipo);
alter table requisitos_destino add constraint requisitos_destino_pkey PRIMARY KEY (id);
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_pkey PRIMARY KEY (id);
alter table roteiro_dias add constraint roteiro_dias_pkey PRIMARY KEY (id);
alter table roteiro_lider_dias add constraint roteiro_lider_dias_pkey PRIMARY KEY (id);
alter table usuarios add constraint usuarios_email_key UNIQUE (email);
alter table usuarios add constraint usuarios_pkey PRIMARY KEY (id);

alter table acesso_links enable row level security;
alter table acesso_senhas enable row level security;
alter table arquivos enable row level security;
alter table audit_log enable row level security;
alter table cambios enable row level security;
alter table checklist_itens enable row level security;
alter table compras_bitrix enable row level security;
alter table custos enable row level security;
alter table documentos enable row level security;
alter table expedamigo_acessos enable row level security;
alter table expedicao_avisos enable row level security;
alter table expedicao_info enable row level security;
alter table expedicao_passeios enable row level security;
alter table expedicao_voos enable row level security;
alter table expedicoes enable row level security;
alter table extensoes enable row level security;
alter table fornecedores enable row level security;
alter table grupos_expedicao enable row level security;
alter table inscricoes_decisoes enable row level security;
alter table inscricoes_pendentes enable row level security;
alter table links_expedicao enable row level security;
alter table pagamentos enable row level security;
alter table passageiro_extensao enable row level security;
alter table passageiro_quarto enable row level security;
alter table passageiro_requisitos enable row level security;
alter table passageiros enable row level security;
alter table passeio_opcional_compras enable row level security;
alter table passeios_opcionais enable row level security;
alter table quartos enable row level security;
alter table requisitos_destino enable row level security;
alter table roteiro_dia_fotos enable row level security;
alter table roteiro_dias enable row level security;
alter table roteiro_lider_dias enable row level security;
alter table usuarios enable row level security;

-- Fase 1 · parte C: chaves estrangeiras (sem usuarios.id → auth.users: 4 usuários do sistema antigo
-- ainda não têm login no QS; os 5 que têm foram remapeados pro id do QS na cópia).
alter table acesso_links add constraint acesso_links_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table arquivos add constraint arquivos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table audit_log add constraint audit_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table checklist_itens add constraint checklist_itens_dependencia_id_fkey FOREIGN KEY (dependencia_id) REFERENCES checklist_itens(id) ON DELETE SET NULL;
alter table checklist_itens add constraint checklist_itens_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table checklist_itens add constraint checklist_itens_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES checklist_itens(id) ON DELETE CASCADE;
alter table checklist_itens add constraint checklist_itens_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table custos add constraint custos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table custos add constraint custos_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table custos add constraint custos_pago_por_fkey FOREIGN KEY (pago_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table documentos add constraint documentos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table expedamigo_acessos add constraint expedamigo_acessos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE SET NULL;
alter table expedicao_avisos add constraint expedicao_avisos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_info add constraint expedicao_info_arquivo_id_2_fkey FOREIGN KEY (arquivo_id_2) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_info add constraint expedicao_info_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_info add constraint expedicao_info_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_passeios add constraint expedicao_passeios_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_passeios add constraint expedicao_passeios_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_voos add constraint expedicao_voos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table expedicao_voos add constraint expedicao_voos_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_expedicao(id) ON DELETE SET NULL;
alter table expedicao_voos add constraint expedicao_voos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table expedicoes add constraint expedicoes_dmc_principal_id_fkey FOREIGN KEY (dmc_principal_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_hospedagem_voucher_arquivo_id_fkey FOREIGN KEY (hospedagem_voucher_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_responsavel_comercial_id_fkey FOREIGN KEY (responsavel_comercial_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table expedicoes add constraint expedicoes_responsavel_operacional_id_fkey FOREIGN KEY (responsavel_operacional_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table extensoes add constraint extensoes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table extensoes add constraint extensoes_hospedagem_voucher_arquivo_id_fkey FOREIGN KEY (hospedagem_voucher_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table grupos_expedicao add constraint grupos_expedicao_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table inscricoes_decisoes add constraint inscricoes_decisoes_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table inscricoes_decisoes add constraint inscricoes_decisoes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_passaporte_arquivo_id_fkey FOREIGN KEY (passaporte_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table inscricoes_pendentes add constraint inscricoes_pendentes_recusa_arquivo_id_fkey FOREIGN KEY (recusa_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table links_expedicao add constraint links_expedicao_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table pagamentos add constraint pagamentos_custo_id_fkey FOREIGN KEY (custo_id) REFERENCES custos(id) ON DELETE CASCADE;
alter table pagamentos add constraint pagamentos_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
alter table passageiro_extensao add constraint passageiro_extensao_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE CASCADE;
alter table passageiro_extensao add constraint passageiro_extensao_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_quarto add constraint passageiro_quarto_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_quarto add constraint passageiro_quarto_quarto_id_fkey FOREIGN KEY (quarto_id) REFERENCES quartos(id) ON DELETE CASCADE;
alter table passageiro_requisitos add constraint passageiro_requisitos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiro_requisitos add constraint passageiro_requisitos_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passageiro_requisitos add constraint passageiro_requisitos_responsavel_id_fkey FOREIGN KEY (responsavel_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table passageiro_requisitos add constraint passageiro_requisitos_verificado_por_fkey FOREIGN KEY (verificado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table passageiros add constraint passageiros_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_grupo_id_fkey FOREIGN KEY (grupo_id) REFERENCES grupos_expedicao(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_passaporte_arquivo_id_fkey FOREIGN KEY (passaporte_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passageiros add constraint passageiros_quarto_id_fkey FOREIGN KEY (quarto_id) REFERENCES quartos(id) ON DELETE SET NULL;
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passageiro_id_fkey FOREIGN KEY (passageiro_id) REFERENCES passageiros(id) ON DELETE CASCADE;
alter table passeio_opcional_compras add constraint passeio_opcional_compras_passeio_opcional_id_fkey FOREIGN KEY (passeio_opcional_id) REFERENCES passeios_opcionais(id) ON DELETE CASCADE;
alter table passeios_opcionais add constraint passeios_opcionais_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table passeios_opcionais add constraint passeios_opcionais_foto_arquivo_id_fkey FOREIGN KEY (foto_arquivo_id) REFERENCES arquivos(id) ON DELETE SET NULL;
alter table passeios_opcionais add constraint passeios_opcionais_roteiro_dia_id_fkey FOREIGN KEY (roteiro_dia_id) REFERENCES roteiro_dias(id) ON DELETE CASCADE;
alter table quartos add constraint quartos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table quartos add constraint quartos_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_arquivo_id_fkey FOREIGN KEY (arquivo_id) REFERENCES arquivos(id) ON DELETE CASCADE;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table roteiro_dia_fotos add constraint roteiro_dia_fotos_roteiro_dia_id_fkey FOREIGN KEY (roteiro_dia_id) REFERENCES roteiro_dias(id) ON DELETE CASCADE;
alter table roteiro_dias add constraint roteiro_dias_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;
alter table roteiro_dias add constraint roteiro_dias_extensao_id_fkey FOREIGN KEY (extensao_id) REFERENCES extensoes(id) ON DELETE SET NULL;
alter table roteiro_lider_dias add constraint roteiro_lider_dias_expedicao_id_fkey FOREIGN KEY (expedicao_id) REFERENCES expedicoes(id) ON DELETE CASCADE;

-- Fase 1 · parte D: funções, view, gatilhos, permissões (RLS), realtime e buckets.
--
-- Diferença pro sistema antigo (lá qualquer login via tudo): aqui no QS o banco é
-- compartilhado com SDRs/closers, então só enxerga Expedições quem
--   · tem linha em `usuarios` (os usuários do app antigo), ou
--   · no QS é admin, Operações, Relacionamento ou Financeiro.
-- Só leitura (is_readonly): papel leitura/relacionamento no app antigo; no QS,
-- quem não está em `usuarios` e não é Operações/Financeiro/admin (ex.: Relacionamento).

-- ── funções ──────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function audit_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  begin v_user := auth.uid(); exception when others then v_user := null; end;
  -- usuario_id tem FK pra usuarios: quem é só do QS (sem linha em usuarios) fica nulo.
  if v_user is not null and not exists (select 1 from usuarios where id = v_user) then v_user := null; end if;
  if (tg_op = 'INSERT') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_depois)
      values (tg_table_name, new.id, v_user, 'insert', to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_antes, dados_depois)
      values (tg_table_name, new.id, v_user, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into audit_log(tabela, registro_id, usuario_id, acao, dados_antes)
      values (tg_table_name, old.id, v_user, 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end $$;

create or replace function exp_tem_acesso() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid())
      or qs_do_setor('operacional') or qs_do_setor('relacionamento') or qs_do_setor('financeiro');
$$;

create or replace function exp_eh_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from usuarios where id = auth.uid() and papel = 'admin')
      or exists (select 1 from qs_users where id = auth.uid() and is_active and role = 'admin');
$$;

create or replace function is_readonly() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select papel::text in ('relacionamento', 'leitura') from usuarios where id = auth.uid()),
    not (qs_do_setor('operacional') or qs_do_setor('financeiro'))
  );
$$;

create or replace function prontidao_marcar_vencidos() returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  with alvo as (
    select pr.id
    from passageiro_requisitos pr
    join passageiros p on p.id = pr.passageiro_id
    join expedicoes  e on e.id = p.expedicao_id
    where pr.validade is not null
      and pr.validade < e.data_retorno
      and pr.status not in ('Vencido', 'Dispensado', 'Reprovado')
  )
  update passageiro_requisitos
     set status = 'Vencido', updated_at = now()
   where id in (select id from alvo);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function audit_change(), exp_tem_acesso(), exp_eh_admin(), is_readonly(), prontidao_marcar_vencidos() from public, anon;
grant execute on function exp_tem_acesso(), exp_eh_admin(), is_readonly() to authenticated;
grant execute on function prontidao_marcar_vencidos() to authenticated, service_role;

-- ── view (agora security_invoker: respeita o RLS de quem consulta) ──────────
create or replace view vw_prontidao_passageiro with (security_invoker = true) as
WITH req AS (
  SELECT pr.passageiro_id,
    count(*) FILTER (WHERE (pr.bloqueia_embarque AND (NOT ((pr.status = ANY (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])) AND ((pr.validade IS NULL) OR (pr.validade >= e_1.data_retorno)))))) AS bloqueios_abertos,
    count(*) FILTER (WHERE ((NOT pr.bloqueia_embarque) AND (pr.status <> ALL (ARRAY['Aprovado'::status_requisito, 'Dispensado'::status_requisito])))) AS pendencias_leves,
    count(*) FILTER (WHERE ((pr.tipo = 'Passaporte'::tipo_requisito) AND (pr.validade IS NOT NULL) AND (pr.validade >= e_1.data_retorno) AND (pr.validade < (e_1.data_retorno + '6 mons'::interval)))) AS passaporte_em_alerta
  FROM passageiro_requisitos pr
  JOIN passageiros p_1 ON p_1.id = pr.passageiro_id
  JOIN expedicoes e_1 ON e_1.id = p_1.expedicao_id
  GROUP BY pr.passageiro_id
)
SELECT p.id AS passageiro_id,
  p.expedicao_id,
  p.nome_completo,
  e.data_embarque,
  e.data_retorno,
  (e.data_embarque - CURRENT_DATE) AS dias_ate_embarque,
  COALESCE(r.bloqueios_abertos, 0::bigint) AS bloqueios_abertos,
  COALESCE(r.pendencias_leves, 0::bigint) AS pendencias_leves,
  COALESCE(r.passaporte_em_alerta, 0::bigint) AS passaporte_em_alerta,
  (p.saldo_brl > 0::numeric) AS tem_saldo,
  CASE
    WHEN COALESCE(r.bloqueios_abertos, 0::bigint) > 0 THEN 'Bloqueado'::text
    WHEN (p.saldo_brl > 0::numeric) AND ((e.data_embarque - CURRENT_DATE) <= 15) THEN 'Bloqueado'::text
    WHEN (COALESCE(r.passaporte_em_alerta, 0::bigint) > 0) OR (COALESCE(r.pendencias_leves, 0::bigint) > 0) OR (p.saldo_brl > 0::numeric) THEN 'Atenção'::text
    ELSE 'Apto'::text
  END AS prontidao
FROM passageiros p
JOIN expedicoes e ON e.id = p.expedicao_id
LEFT JOIN req r ON r.passageiro_id = p.id;
revoke all on vw_prontidao_passageiro from anon;

-- ── índices ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_acesso_links_codigo ON public.acesso_links USING btree (codigo);
CREATE INDEX idx_arquivos_categoria ON public.arquivos USING btree (categoria);
CREATE INDEX idx_arquivos_expedicao ON public.arquivos USING btree (expedicao_id);
CREATE INDEX idx_arquivos_passageiro ON public.arquivos USING btree (passageiro_id);
CREATE INDEX idx_audit_created_at ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_tabela_registro ON public.audit_log USING btree (tabela, registro_id);
CREATE INDEX idx_checklist_etapa ON public.checklist_itens USING btree (expedicao_id, etapa, ordem);
CREATE INDEX idx_checklist_expedicao ON public.checklist_itens USING btree (expedicao_id);
CREATE INDEX idx_checklist_parent ON public.checklist_itens USING btree (parent_id);
CREATE INDEX idx_checklist_status ON public.checklist_itens USING btree (status);
CREATE INDEX idx_compras_bitrix_contact ON public.compras_bitrix USING btree (bitrix_contact_id);
CREATE INDEX idx_compras_bitrix_cpf ON public.compras_bitrix USING btree (cpf);
CREATE INDEX idx_compras_bitrix_data ON public.compras_bitrix USING btree (data_compra DESC);
CREATE INDEX idx_custos_categoria ON public.custos USING btree (categoria);
CREATE INDEX idx_custos_expedicao ON public.custos USING btree (expedicao_id);
CREATE INDEX idx_custos_status ON public.custos USING btree (status);
CREATE INDEX idx_documentos_passageiro ON public.documentos USING btree (passageiro_id);
CREATE INDEX idx_expedamigo_acessos_cpf ON public.expedamigo_acessos USING btree (cpf);
CREATE INDEX idx_expedamigo_acessos_criado ON public.expedamigo_acessos USING btree (created_at DESC);
CREATE INDEX idx_expedicao_avisos_exp ON public.expedicao_avisos USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_info_exp ON public.expedicao_info USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_passeios_exp ON public.expedicao_passeios USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_voos_exp ON public.expedicao_voos USING btree (expedicao_id, ordem);
CREATE INDEX idx_expedicao_voos_extensao ON public.expedicao_voos USING btree (extensao_id);
CREATE INDEX idx_expedicao_voos_grupo ON public.expedicao_voos USING btree (grupo_id);
CREATE INDEX idx_expedicao_voos_passageiro ON public.expedicao_voos USING btree (passageiro_id);
CREATE INDEX idx_expedicoes_data_embarque ON public.expedicoes USING btree (data_embarque);
CREATE INDEX idx_expedicoes_destino ON public.expedicoes USING btree (destino);
CREATE INDEX idx_expedicoes_ordem ON public.expedicoes USING btree (ordem);
CREATE INDEX idx_expedicoes_status ON public.expedicoes USING btree (status);
CREATE INDEX idx_expedicoes_tipo ON public.expedicoes USING btree (tipo);
CREATE INDEX idx_extensoes_exp ON public.extensoes USING btree (expedicao_id, ordem);
CREATE INDEX idx_fornecedores_status ON public.fornecedores USING btree (status);
CREATE INDEX idx_fornecedores_tipo ON public.fornecedores USING btree (tipo);
CREATE INDEX idx_grupos_expedicao_id ON public.grupos_expedicao USING btree (expedicao_id);
CREATE INDEX idx_insc_decisoes_created ON public.inscricoes_decisoes USING btree (created_at DESC);
CREATE INDEX idx_inscricoes_pendentes_status ON public.inscricoes_pendentes USING btree (status);
CREATE INDEX idx_links_expedicao ON public.links_expedicao USING btree (expedicao_id);
CREATE INDEX idx_links_expedicao_ordem ON public.links_expedicao USING btree (expedicao_id, ordem);
CREATE INDEX idx_pagamentos_custo ON public.pagamentos USING btree (custo_id);
CREATE INDEX idx_pagamentos_status ON public.pagamentos USING btree (status);
CREATE INDEX idx_pagamentos_vencimento ON public.pagamentos USING btree (vencimento_saldo);
CREATE INDEX idx_passageiros_avulsos ON public.passageiros USING btree (id) WHERE (expedicao_id IS NULL);
CREATE INDEX idx_passageiros_bitrix_deal ON public.passageiros USING btree (bitrix_deal_id);
CREATE INDEX idx_passageiros_conexao_viagem ON public.passageiros USING btree (conexao_viagem_id);
CREATE INDEX idx_passageiros_expedicao ON public.passageiros USING btree (expedicao_id);
CREATE INDEX idx_passageiros_grupo ON public.passageiros USING btree (grupo_id);
CREATE INDEX idx_passageiros_pendente ON public.passageiros USING btree (pendente_aprovacao) WHERE pendente_aprovacao;
CREATE INDEX idx_passageiros_status ON public.passageiros USING btree (status_reserva);
CREATE INDEX idx_passeio_compras_passeio ON public.passeio_opcional_compras USING btree (passeio_opcional_id);
CREATE INDEX idx_passeio_compras_pax ON public.passeio_opcional_compras USING btree (passageiro_id);
CREATE INDEX idx_passeios_opcionais_dia ON public.passeios_opcionais USING btree (roteiro_dia_id, ordem);
CREATE INDEX idx_passeios_opcionais_exp ON public.passeios_opcionais USING btree (expedicao_id, ordem);
CREATE INDEX idx_pax_extensao_ext ON public.passageiro_extensao USING btree (extensao_id);
CREATE INDEX idx_pax_extensao_pax ON public.passageiro_extensao USING btree (passageiro_id);
CREATE INDEX idx_pq_passageiro ON public.passageiro_quarto USING btree (passageiro_id);
CREATE INDEX idx_pq_quarto ON public.passageiro_quarto USING btree (quarto_id);
CREATE INDEX idx_preq_passageiro ON public.passageiro_requisitos USING btree (passageiro_id);
CREATE INDEX idx_preq_status ON public.passageiro_requisitos USING btree (status);
CREATE INDEX idx_preq_tipo ON public.passageiro_requisitos USING btree (tipo);
CREATE INDEX idx_quartos_expedicao ON public.quartos USING btree (expedicao_id);
CREATE INDEX idx_quartos_extensao ON public.quartos USING btree (extensao_id);
CREATE INDEX idx_requisitos_destino_destino ON public.requisitos_destino USING btree (destino);
CREATE INDEX idx_roteiro_dia_fotos_dia ON public.roteiro_dia_fotos USING btree (roteiro_dia_id, ordem);
CREATE INDEX idx_roteiro_dia_fotos_exp ON public.roteiro_dia_fotos USING btree (expedicao_id);
CREATE INDEX idx_roteiro_dias_exp ON public.roteiro_dias USING btree (expedicao_id, ordem);
CREATE INDEX idx_roteiro_dias_extensao ON public.roteiro_dias USING btree (extensao_id);
CREATE INDEX idx_roteiro_lider_dias_exp ON public.roteiro_lider_dias USING btree (expedicao_id, ordem);
CREATE UNIQUE INDEX ux_passageiros_avulso_cpf ON public.passageiros USING btree (regexp_replace(cpf, '\D'::text, ''::text, 'g'::text)) WHERE ((cpf IS NOT NULL) AND (expedicao_id IS NULL));
CREATE UNIQUE INDEX ux_passageiros_expedicao_cpf ON public.passageiros USING btree (expedicao_id, regexp_replace(cpf, '\D'::text, ''::text, 'g'::text)) WHERE ((cpf IS NOT NULL) AND (expedicao_id IS NOT NULL));

-- ── gatilhos (updated_at + auditoria) ───────────────────────────────────────
do $$ declare t text; begin
  foreach t in array array['acesso_senhas','arquivos','checklist_itens','compras_bitrix','custos','documentos','expedicao_avisos','expedicao_info','expedicao_passeios','expedicao_voos','expedicoes','extensoes','fornecedores','grupos_expedicao','inscricoes_pendentes','links_expedicao','pagamentos','passageiro_requisitos','passageiros','passeios_opcionais','quartos','requisitos_destino','roteiro_dia_fotos','roteiro_dias','roteiro_lider_dias','usuarios'] loop
    execute format('create trigger tg_%s_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
  foreach t in array array['custos','expedicoes','pagamentos','passageiro_requisitos','passageiros'] loop
    execute format('create trigger trg_%s_audit after insert or update or delete on %I for each row execute function audit_change()', t, t);
  end loop;
end $$;

-- ── permissões ───────────────────────────────────────────────────────────────
create policy exp_ler on arquivos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on arquivos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on arquivos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on arquivos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on arquivos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on cambios for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on cambios for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on cambios as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on cambios as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on cambios as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on checklist_itens for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on checklist_itens for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on checklist_itens as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on checklist_itens as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on checklist_itens as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on custos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on custos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on custos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on custos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on custos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on documentos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on documentos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on documentos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on documentos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on documentos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedamigo_acessos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedamigo_acessos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedamigo_acessos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedamigo_acessos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedamigo_acessos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_avisos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_avisos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_avisos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_avisos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_avisos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_info for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_info for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_info as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_info as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_info as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_passeios for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_passeios for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_passeios as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_passeios as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_passeios as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicao_voos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicao_voos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicao_voos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicao_voos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicao_voos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on expedicoes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on expedicoes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on expedicoes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on expedicoes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on expedicoes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on extensoes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on extensoes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on extensoes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on extensoes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on extensoes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on fornecedores for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on fornecedores for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on fornecedores as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on fornecedores as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on fornecedores as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on grupos_expedicao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on grupos_expedicao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on grupos_expedicao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on grupos_expedicao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on grupos_expedicao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on inscricoes_pendentes for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on inscricoes_pendentes for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on inscricoes_pendentes as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on inscricoes_pendentes as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on inscricoes_pendentes as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on links_expedicao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on links_expedicao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on links_expedicao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on links_expedicao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on links_expedicao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on pagamentos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on pagamentos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on pagamentos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on pagamentos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on pagamentos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_extensao for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_extensao for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_extensao as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_extensao as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_extensao as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_quarto for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_quarto for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_quarto as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_quarto as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_quarto as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiro_requisitos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiro_requisitos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiro_requisitos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiro_requisitos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiro_requisitos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passageiros for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passageiros for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passageiros as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passageiros as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passageiros as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passeio_opcional_compras for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passeio_opcional_compras for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passeio_opcional_compras as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passeio_opcional_compras as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passeio_opcional_compras as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on passeios_opcionais for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on passeios_opcionais for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on passeios_opcionais as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on passeios_opcionais as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on passeios_opcionais as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on quartos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on quartos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on quartos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on quartos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on quartos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on requisitos_destino for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on requisitos_destino for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on requisitos_destino as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on requisitos_destino as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on requisitos_destino as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_dia_fotos for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_dia_fotos for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_dia_fotos as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_dia_fotos as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_dia_fotos as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_dias for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_dias for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_dias as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_dias as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_dias as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on roteiro_lider_dias for select to authenticated using (exp_tem_acesso());
create policy exp_escrever on roteiro_lider_dias for all to authenticated using (exp_tem_acesso()) with check (exp_tem_acesso());
create policy ro_block_insert on roteiro_lider_dias as restrictive for insert to authenticated with check (not is_readonly());
create policy ro_block_update on roteiro_lider_dias as restrictive for update to authenticated using (not is_readonly()) with check (not is_readonly());
create policy ro_block_delete on roteiro_lider_dias as restrictive for delete to authenticated using (not is_readonly());
create policy exp_ler on compras_bitrix for select to authenticated using (exp_tem_acesso());
create policy exp_ler on inscricoes_decisoes for select to authenticated using (exp_tem_acesso());
create policy exp_ler on audit_log for select to authenticated using (exp_tem_acesso());
create policy exp_inserir on audit_log for insert to authenticated with check (exp_tem_acesso());
-- usuarios: todos com acesso leem; cada um mexe na própria linha sem trocar o papel; admin mexe em todos.
-- O 1º login no app antigo cria a linha como "leitura" — só pra quem já é Operações/Rel/Fin no QS.
create policy exp_ler on usuarios for select to authenticated using (exp_tem_acesso());
create policy exp_criar on usuarios for insert to authenticated
  with check (exp_eh_admin() or (id = auth.uid() and papel = 'leitura' and exp_tem_acesso()));
create policy exp_editar on usuarios for update to authenticated
  using (exp_eh_admin() or id = auth.uid())
  with check (exp_eh_admin() or (id = auth.uid() and papel = (select u.papel from usuarios u where u.id = auth.uid())));
create policy exp_apagar on usuarios for delete to authenticated using (exp_eh_admin());
-- acesso_links e acesso_senhas (login do portal do viajante): sem policy = só o servidor (service role).

-- ── realtime ─────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table arquivos;
alter publication supabase_realtime add table cambios;
alter publication supabase_realtime add table checklist_itens;
alter publication supabase_realtime add table custos;
alter publication supabase_realtime add table documentos;
alter publication supabase_realtime add table expedicoes;
alter publication supabase_realtime add table fornecedores;
alter publication supabase_realtime add table grupos_expedicao;
alter publication supabase_realtime add table links_expedicao;
alter publication supabase_realtime add table pagamentos;
alter publication supabase_realtime add table passageiro_requisitos;
alter publication supabase_realtime add table passageiros;
alter publication supabase_realtime add table quartos;
alter publication supabase_realtime add table requisitos_destino;
alter publication supabase_realtime add table usuarios;

-- ── buckets (sem policy de storage, igual ao antigo: só o servidor acessa) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('arquivos-expedicoes', 'arquivos-expedicoes', false, 52428800), ('pasta_public', 'pasta_public', true, null)
on conflict (id) do nothing;
