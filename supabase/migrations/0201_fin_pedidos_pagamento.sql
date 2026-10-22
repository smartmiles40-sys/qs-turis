-- 0201_fin_pedidos_pagamento.sql
-- -----------------------------------------------------------------------------
-- PEDIDOS DE PAGAMENTO AO FINANCEIRO (Bruno, 22/10/2026):
--   "Comercial: às vezes precisa solicitar um pagamento via Pix para pagar algum
--    fornecedor ou pedir algum link de pagamento para enviar ao cliente.
--    Relacionamento: às vezes precisa de cartão para pagar assento, emissão de
--    assento; solicita link de pagamento para expedição também. Operações:
--    provisionam pagamento, solicitam cartão para pagar algo e pedem links para
--    pagamento. Eu preciso que o financeiro consiga ter uma visualização fácil e
--    também que quem está solicitando consiga fazer isso atrelado a algum cliente
--    ou especifique para o que está subindo a solicitação, já amarrando tudo."
--
-- NÃO é um sistema novo: são TIPOS da Central de Solicitações (0149) pro
-- Financeiro, com formulário próprio em qs_solicitacoes.formulario (igual à
-- cotação, 0158) — formulario = 'pagamento' no tipo.
--
--   fin_fornecedor      → "Pix para fornecedor"            (o tipo "Pagar fornecedor" que já existia)
--   fin_link_pagamento  → "Link de pagamento para o cliente" (o do closer, 0181 — o mesmo tipo)
--   fin_cartao          → "Pagamento no cartão da empresa"  (novo)
--   fin_provisao        → "Provisionar pagamento"           (novo; vira parcelas "a pagar")
--
-- Todo pedido fica AMARRADO: cliente e/ou venda (EscolherClienteVenda), lead,
-- uma EXPEDIÇÃO (coluna nova qs_solicitacoes.expedicao_id) — ou, se não é de
-- cliente, "Para que é" (categoria + texto). O banco confere (gatilho
-- fin_pag_validar), não só a tela.
--
-- O lado do Financeiro (fin_pag_acao): colar o link gerado · marcar pago (com
-- comprovante) · provisionar (gera as parcelas). Cada um CONCLUI a solicitação
-- pela qs_sol_acao — então o aviso de "concluída" pra quem pediu (0196) e o link
-- no cartão do closer (0181) continuam saindo sozinhos.
--
-- Arquivos (boleto, nota, print, comprovante): bucket privado fin-pagamentos,
-- pasta = id da solicitação; quem vê a solicitação vê os arquivos.
--
-- Idempotente. Depende de 0149/0150/0158/0159/0175/0181/0196/0197.
-- -----------------------------------------------------------------------------
set lock_timeout = '5s';

-- ── 1) O tipo pode ter formulário de PAGAMENTO ──────────────────────────────
alter table qs_solicitacao_tipos drop constraint if exists qs_solicitacao_tipos_formulario_check;
alter table qs_solicitacao_tipos add constraint qs_solicitacao_tipos_formulario_check
  check (formulario in ('cotacao', 'pagamento'));

-- ── 2) Os 4 tipos (2 que já existiam viram formulário; 2 novos) ─────────────
insert into qs_solicitacao_tipos (id, setor, rotulo, prazo_horas, prazo_alta_horas, prazo_urgente_horas, ordem, formulario)
values
  ('fin_fornecedor',     'financeiro', 'Pix para fornecedor',                                      8, 4, 2, 1, 'pagamento'),
  ('fin_link_pagamento', 'financeiro', 'Link de pagamento para o cliente',                         4, 2, 1, 2, 'pagamento'),
  ('fin_cartao',         'financeiro', 'Pagamento no cartão da empresa (assento, emissão, taxa…)', 4, 2, 1, 3, 'pagamento'),
  ('fin_provisao',       'financeiro', 'Provisionar pagamento (conta futura)',                    16, 8, 4, 4, 'pagamento')
on conflict (id) do update set formulario = 'pagamento', rotulo = excluded.rotulo, ordem = excluded.ordem, ativo = true, atualizado_em = now();

-- ── 3) A solicitação pode ser de uma EXPEDIÇÃO ──────────────────────────────
alter table qs_solicitacoes add column if not exists expedicao_id uuid references expedicoes(id) on delete set null;
create index if not exists qs_sol_expedicao_idx on qs_solicitacoes (expedicao_id) where expedicao_id is not null;

-- ── 4) Conferência do formulário (null = pode enviar; senão, o que falta) ───
create or replace function fin_pag_tipo_do(p_tipo_id text) returns text
language sql immutable set search_path = public as $$
  select case p_tipo_id when 'fin_fornecedor' then 'pix' when 'fin_link_pagamento' then 'link'
                        when 'fin_cartao' then 'cartao' when 'fin_provisao' then 'provisao' end;
$$;

create or replace function fin_pag_falta(f jsonb, p_tipo_id text, p_cliente uuid, p_viagem uuid, p_lead uuid, p_expedicao uuid)
returns text language plpgsql immutable set search_path = public as $$
declare
  k     text := fin_pag_tipo_do(p_tipo_id);
  doc   text;
  n     int;
  dt    text := '^\d{4}-\d{2}-\d{2}$';
begin
  if f is null or jsonb_typeof(f) <> 'object' then return 'Preencha o formulário do pagamento.'; end if;
  if k is null or f->>'tipo' is distinct from k then return 'O formulário não é desse tipo de pedido.'; end if;
  if coalesce(f->>'valor', '') !~ '^\d+(\.\d+)?$' or (f->>'valor')::numeric <= 0 then return 'Diga o valor (maior que zero).'; end if;
  if coalesce(f->>'moeda', 'BRL') not in ('BRL','USD','EUR','GBP','CLP','ARS','JPY') then return 'Escolha a moeda.'; end if;

  if k = 'pix' then
    if coalesce(f->>'moeda', 'BRL') <> 'BRL' then return 'Pix é só em reais.'; end if;
    if nullif(trim(coalesce(f->>'favorecido', '')), '') is null then return 'Escreva o nome de quem recebe (favorecido).'; end if;
    doc := regexp_replace(coalesce(f->>'documento', ''), '\D', '', 'g');
    if length(doc) not in (11, 14) then return 'CPF (11 números) ou CNPJ (14 números) de quem recebe.'; end if;
    if nullif(trim(coalesce(f->>'chave_pix', '')), '') is null then return 'Escreva a chave Pix.'; end if;
    if coalesce(f->>'data_limite', '') !~ dt then return 'Escolha até quando precisa ser pago.'; end if;
    if nullif(trim(coalesce(f->>'para_que', '')), '') is null then return 'Diga para que é o pagamento.'; end if;
  elsif k = 'link' then
    if coalesce(f->>'parcelas_max', '') !~ '^\d+$' or (f->>'parcelas_max')::int not between 1 and 48 then return 'Parcelas: de 1 a 48.'; end if;
    if f->>'vencimento' is not null and f->>'vencimento' !~ dt then return 'Data de vencimento inválida.'; end if;
    if nullif(trim(coalesce(f->>'descricao_cliente', '')), '') is null then return 'Escreva a descrição que aparece pro cliente.'; end if;
  elsif k = 'cartao' then
    if nullif(trim(coalesce(f->>'o_que', '')), '') is null then return 'Diga o que vai ser comprado.'; end if;
    if nullif(trim(coalesce(f->>'fornecedor', '')), '') is null then return 'Diga onde comprar (fornecedor ou site).'; end if;
    if coalesce(f->>'data_limite', '') !~ dt then return 'Escolha até quando precisa ser pago.'; end if;
  elsif k = 'provisao' then
    if nullif(trim(coalesce(f->>'fornecedor', '')), '') is null then return 'Diga o fornecedor (quem vai receber).'; end if;
    if coalesce(f->>'vencimento', '') !~ dt then return 'Escolha o (1º) vencimento.'; end if;
    if coalesce(f->>'parcelas', '') !~ '^\d+$' or (f->>'parcelas')::int not between 1 and 60 then return 'Parcelas: de 1 a 60.'; end if;
    n := (f->>'parcelas')::int;
    if n > 1 and coalesce(f->>'frequencia', '') not in ('mensal','quinzenal','semanal') then return 'Diga a frequência das parcelas.'; end if;
    if nullif(trim(coalesce(f->>'para_que', '')), '') is null then return 'Diga para que é o pagamento.'; end if;
  end if;

  -- Amarração: cliente / venda / lead / expedição — ou "para que é".
  if p_cliente is null and p_viagem is null and p_lead is null and p_expedicao is null then
    if coalesce(f->>'finalidade', '') not in ('fornecedor_expedicao','operacional','marketing','outro')
       or nullif(trim(coalesce(f->>'finalidade_texto', '')), '') is null then
      return 'Amarre o pedido a um cliente, uma venda ou uma expedição — ou diga para que é (categoria + explicação).';
    end if;
  end if;
  return null;
end $$;

create or replace function fin_pag_validar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_form  text;
  v_exp   uuid;
  v_falta text;
begin
  select formulario into v_form from qs_solicitacao_tipos where id = new.tipo_id;
  if v_form is distinct from 'pagamento' then return new; end if;
  -- Num UPDATE, só confere se o formulário/tipo mudou (amarrar cliente depois, mudar status etc. passam direto).
  if tg_op = 'UPDATE' and new.formulario is not distinct from old.formulario and new.tipo_id is not distinct from old.tipo_id then
    return new;
  end if;
  v_exp := case when coalesce(new.formulario->>'vinculo', '') = 'expedicao'
                 and coalesce(new.formulario->>'expedicao_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (new.formulario->>'expedicao_id')::uuid end;
  if v_exp is not null and not exists (select 1 from expedicoes where id = v_exp) then
    raise exception 'Essa expedição não existe mais.';
  end if;
  new.expedicao_id := coalesce(v_exp, case when tg_op = 'UPDATE' then old.expedicao_id end);
  v_falta := fin_pag_falta(new.formulario, new.tipo_id, new.cliente_id, new.viagem_id, new.lead_id, new.expedicao_id);
  if v_falta is not null then raise exception '%', v_falta; end if;
  if new.sobre_nome is null and new.expedicao_id is not null then
    select 'Expedição ' || coalesce(nullif(e.nome, ''), e.codigo) into new.sobre_nome from expedicoes e where e.id = new.expedicao_id;
  end if;
  return new;
end $$;
revoke all on function fin_pag_validar() from public, anon, authenticated;
drop trigger if exists trg_fin_pag_validar on qs_solicitacoes;
create trigger trg_fin_pag_validar before insert or update of formulario, tipo_id on qs_solicitacoes
  for each row execute function fin_pag_validar();

-- ── 5) O que o Financeiro fez + parcelas da provisão + arquivos ─────────────
create table if not exists fin_pagamentos (
  solicitacao_id uuid primary key references qs_solicitacoes(id) on delete cascade,
  link           text,
  pago_em        date,
  pago_valor     numeric(14,2),
  pago_moeda     text,
  obs            text,
  feito_por      uuid references qs_users(id) on delete set null,
  feito_em       timestamptz not null default now()
);

create table if not exists fin_pag_parcelas (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references qs_solicitacoes(id) on delete cascade,
  numero         int not null check (numero >= 1),
  valor          numeric(14,2) not null check (valor > 0),
  moeda          text not null default 'BRL',
  vencimento     date not null,
  status         text not null default 'a_pagar' check (status in ('a_pagar','pago','cancelado')),
  pago_em        date,
  pago_valor     numeric(14,2),
  pago_por       uuid references qs_users(id) on delete set null,
  obs            text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (solicitacao_id, numero)
);
create index if not exists fin_pag_parcelas_venc on fin_pag_parcelas (status, vencimento);

create table if not exists fin_pag_anexos (
  id             uuid primary key default gen_random_uuid(),
  solicitacao_id uuid not null references qs_solicitacoes(id) on delete cascade,
  parcela_id     uuid references fin_pag_parcelas(id) on delete set null,
  tipo           text not null check (tipo in ('documento','comprovante')),
  path           text not null unique,
  nome           text not null,
  enviado_por    uuid references qs_users(id) on delete set null,
  criado_em      timestamptz not null default now()
);
create index if not exists fin_pag_anexos_sol on fin_pag_anexos (solicitacao_id);

alter table fin_pagamentos   enable row level security;
alter table fin_pag_parcelas enable row level security;
alter table fin_pag_anexos   enable row level security;

-- Quem vê a solicitação (o RLS da qs_solicitacoes decide) vê o pagamento dela.
drop policy if exists fin_pagamentos_ler on fin_pagamentos;
create policy fin_pagamentos_ler on fin_pagamentos for select to authenticated
  using ((select fin_tem_acesso()) or exists (select 1 from qs_solicitacoes s where s.id = solicitacao_id));
drop policy if exists fin_pag_parcelas_ler on fin_pag_parcelas;
create policy fin_pag_parcelas_ler on fin_pag_parcelas for select to authenticated
  using ((select fin_tem_acesso()) or exists (select 1 from qs_solicitacoes s where s.id = solicitacao_id));
drop policy if exists fin_pag_anexos_ler on fin_pag_anexos;
create policy fin_pag_anexos_ler on fin_pag_anexos for select to authenticated
  using ((select fin_tem_acesso()) or exists (select 1 from qs_solicitacoes s where s.id = solicitacao_id));

revoke all on fin_pagamentos, fin_pag_parcelas, fin_pag_anexos from anon;
revoke insert, update, delete on fin_pagamentos, fin_pag_parcelas, fin_pag_anexos from authenticated;
grant select on fin_pagamentos, fin_pag_parcelas, fin_pag_anexos to authenticated;

-- ── 6) Bucket dos arquivos (privado; pasta = id da solicitação) ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fin-pagamentos', 'fin-pagamentos', false, 15728640,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

create or replace function fin_pag_ve_arquivo(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select fin_tem_acesso() or exists (
    select 1 from qs_solicitacoes s
     where s.id = case when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then split_part(p_name, '/', 1)::uuid end
       and qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id));
$$;
revoke all on function fin_pag_ve_arquivo(text) from public, anon;
grant execute on function fin_pag_ve_arquivo(text) to authenticated;

drop policy if exists fin_pag_arquivos_ler on storage.objects;
create policy fin_pag_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'fin-pagamentos' and fin_pag_ve_arquivo(name));
drop policy if exists fin_pag_arquivos_subir on storage.objects;
create policy fin_pag_arquivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'fin-pagamentos' and fin_pag_ve_arquivo(name));
-- Apagar: o Financeiro, ou quem subiu (pra não deixar arquivo órfão se o registro falhar).
drop policy if exists fin_pag_arquivos_apagar on storage.objects;
create policy fin_pag_arquivos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'fin-pagamentos' and ((select fin_tem_acesso()) or owner_id = (select auth.uid())::text));

-- ── 7) Textos de dinheiro ("R$ 1.234,56", "US$ 300,00") ─────────────────────
create or replace function fin_pag_dinheiro(p_valor numeric, p_moeda text) returns text
language sql immutable set search_path = public as $$
  select case coalesce(p_moeda, 'BRL') when 'BRL' then 'R$ ' when 'USD' then 'US$ ' when 'EUR' then '€ ' when 'GBP' then '£ '
              else coalesce(p_moeda, '') || ' ' end
         || translate(to_char(coalesce(p_valor, 0), 'FM999,999,990.00'), ',.', '.,');
$$;

-- ── 8) Registrar um arquivo já enviado ao bucket ────────────────────────────
--   'documento'   → boleto / nota / print (quem pediu ou o Financeiro)
--   'comprovante' → comprovante do pagamento (só o Financeiro)
create or replace function fin_pag_anexar(p_sol uuid, p_tipo text, p_path text, p_nome text, p_parcela uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  s    qs_solicitacoes;
  v_id uuid;
begin
  select * into s from qs_solicitacoes where id = p_sol;
  if s.id is null or not qs_ve_solicitacao(s.de_setor, s.para_setor, s.criado_por, s.responsavel_id) then
    raise exception 'Sem acesso a essa solicitação.';
  end if;
  if p_tipo not in ('documento','comprovante') then raise exception 'Tipo de arquivo inválido.'; end if;
  if p_tipo = 'comprovante' and not fin_tem_acesso() then raise exception 'Só o Financeiro anexa comprovante.'; end if;
  if coalesce(p_path, '') not like p_sol::text || '/%' then raise exception 'Arquivo fora da pasta da solicitação.'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'fin-pagamentos' and o.name = p_path) then
    raise exception 'O arquivo não chegou — tente enviar de novo.';
  end if;
  if p_parcela is not null and not exists (select 1 from fin_pag_parcelas x where x.id = p_parcela and x.solicitacao_id = p_sol) then
    raise exception 'Parcela não é desta solicitação.';
  end if;
  insert into fin_pag_anexos (solicitacao_id, parcela_id, tipo, path, nome, enviado_por)
  values (p_sol, p_parcela, p_tipo, p_path, left(coalesce(nullif(trim(p_nome), ''), 'arquivo'), 160), auth.uid())
  returning id into v_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome)
  values (p_sol, 'comentario', case when p_tipo = 'comprovante' then '📎 Comprovante anexado: ' else '📎 Arquivo anexado: ' end || left(coalesce(p_nome, ''), 160), qs_eu_nome());
  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = p_sol;
  return v_id;
end $$;
revoke all on function fin_pag_anexar(uuid, text, text, text, uuid) from public, anon;
grant execute on function fin_pag_anexar(uuid, text, text, text, uuid) to authenticated;

-- ── 9) O Financeiro resolve o pedido ────────────────────────────────────────
--   'link'        → p_link (http/https). Conclui com o link na resolução (o
--                   gatilho da 0181 leva pro cartão do closer).
--   'pago'        → Pix / cartão: p_data (padrão hoje), p_valor (padrão o pedido). Conclui.
--   'provisionar' → gera as parcelas da provisão a partir do formulário. Conclui.
create or replace function fin_pag_acao(p_id uuid, p_acao text, p_link text default null, p_data date default null,
  p_valor numeric default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s      qs_solicitacoes;
  f      jsonb;
  k      text;
  v_link text := nullif(trim(coalesce(p_link, '')), '');
  v_obs  text := nullif(trim(coalesce(p_obs, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_data date;
  v_val  numeric;
  v_moe  text;
  v_n    int;
  v_freq text;
  v_ven  date;
  v_txt  text;
  i      int;
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro resolve pedidos de pagamento.'; end if;
  select * into s from qs_solicitacoes where id = p_id for update;
  if s.id is null then raise exception 'Solicitação não encontrada.'; end if;
  if s.para_setor <> 'financeiro' then raise exception 'Esse pedido não é do Financeiro.'; end if;
  if s.status not in ('nova','em_andamento','aguardando') then raise exception 'Essa solicitação já foi fechada.'; end if;
  k := fin_pag_tipo_do(s.tipo_id);
  if k is null then raise exception 'Isso não é um pedido de pagamento.'; end if;
  f := coalesce(s.formulario, '{}'::jsonb);
  v_moe := coalesce(f->>'moeda', 'BRL');

  if p_acao = 'link' then
    if k <> 'link' then raise exception 'Esse pedido não é de link de pagamento.'; end if;
    if v_link is null or v_link !~* '^https?://\S+$' then raise exception 'Cole o link completo (começando com https://).'; end if;
    insert into fin_pagamentos (solicitacao_id, link, obs, feito_por, feito_em)
    values (s.id, v_link, v_obs, auth.uid(), now())
    on conflict (solicitacao_id) do update set link = excluded.link, obs = coalesce(excluded.obs, fin_pagamentos.obs),
      feito_por = excluded.feito_por, feito_em = now();
    v_txt := 'Link de pagamento: ' || v_link || coalesce(E'\n' || v_obs, '');

  elsif p_acao = 'pago' then
    if k not in ('pix','cartao') then raise exception 'Use "provisionar" (provisão) ou "colar o link" (link).'; end if;
    v_data := coalesce(p_data, v_hoje);
    if v_data > v_hoje then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
    if p_valor is not null and p_valor <= 0 then raise exception 'Valor inválido.'; end if;
    v_val := coalesce(p_valor, nullif(f->>'valor', '')::numeric);
    if not exists (select 1 from fin_pag_anexos a where a.solicitacao_id = s.id and a.tipo = 'comprovante') then
      raise exception 'Anexe o comprovante antes de marcar como pago.';
    end if;
    insert into fin_pagamentos (solicitacao_id, pago_em, pago_valor, pago_moeda, obs, feito_por, feito_em)
    values (s.id, v_data, v_val, v_moe, v_obs, auth.uid(), now())
    on conflict (solicitacao_id) do update set pago_em = excluded.pago_em, pago_valor = excluded.pago_valor,
      pago_moeda = excluded.pago_moeda, obs = coalesce(excluded.obs, fin_pagamentos.obs), feito_por = excluded.feito_por, feito_em = now();
    v_txt := case k when 'pix' then 'Pix pago' else 'Pago no cartão' end || ' em ' || to_char(v_data, 'DD/MM/YYYY')
             || ' — ' || fin_pag_dinheiro(v_val, v_moe) || '. Comprovante anexado.' || coalesce(E'\n' || v_obs, '');

  elsif p_acao = 'provisionar' then
    if k <> 'provisao' then raise exception 'Esse pedido não é de provisão.'; end if;
    if exists (select 1 from fin_pag_parcelas x where x.solicitacao_id = s.id and x.status = 'pago') then
      raise exception 'Já tem parcela paga nesta provisão — ajuste as parcelas na tela de Pagamentos.';
    end if;
    v_val := nullif(f->>'valor', '')::numeric;
    v_n := coalesce(nullif(f->>'parcelas', '')::int, 1);
    v_freq := coalesce(f->>'frequencia', 'mensal');
    v_ven := (f->>'vencimento')::date;
    delete from fin_pag_parcelas where solicitacao_id = s.id and status <> 'pago';
    for i in 1..v_n loop
      insert into fin_pag_parcelas (solicitacao_id, numero, valor, moeda, vencimento)
      values (s.id, i, v_val, v_moe,
              case when i = 1 or v_n = 1 then v_ven
                   when v_freq = 'semanal' then v_ven + (i - 1) * 7
                   when v_freq = 'quinzenal' then v_ven + (i - 1) * 14
                   else (v_ven + make_interval(months => i - 1))::date end);
    end loop;
    insert into fin_pagamentos (solicitacao_id, obs, feito_por, feito_em)
    values (s.id, v_obs, auth.uid(), now())
    on conflict (solicitacao_id) do update set obs = coalesce(excluded.obs, fin_pagamentos.obs), feito_por = excluded.feito_por, feito_em = now();
    v_txt := 'Provisionado: ' || v_n || ' parcela' || case when v_n > 1 then 's' else '' end || ' de ' || fin_pag_dinheiro(v_val, v_moe)
             || case when v_n > 1 then ' (' || v_freq || ')' else '' end
             || ', 1º vencimento ' || to_char(v_ven, 'DD/MM/YYYY') || '.' || coalesce(E'\n' || v_obs, '');
  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;

  -- Conclui pela Central: mesmo histórico, avisos (0196) e link no cartão do closer (0181).
  perform qs_sol_acao(s.id, 'concluir', v_txt, null);
end $$;
revoke all on function fin_pag_acao(uuid, text, text, date, numeric, text) from public, anon;
grant execute on function fin_pag_acao(uuid, text, text, date, numeric, text) to authenticated;

-- ── 10) Parcela da provisão: pago / desfazer / cancelar ─────────────────────
create or replace function fin_pag_parcela(p_id uuid, p_acao text, p_data date default null, p_valor numeric default null, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  x      fin_pag_parcelas;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_obs  text := nullif(trim(coalesce(p_obs, '')), '');
  v_tot  int;
  v_txt  text;
begin
  if not fin_tem_acesso() then raise exception 'Só o Financeiro dá baixa.'; end if;
  select * into x from fin_pag_parcelas where id = p_id for update;
  if x.id is null then raise exception 'Parcela não encontrada.'; end if;
  select count(*) into v_tot from fin_pag_parcelas where solicitacao_id = x.solicitacao_id;
  if p_acao = 'pago' then
    if x.status = 'pago' then raise exception 'Essa parcela já está paga.'; end if;
    if coalesce(p_data, v_hoje) > v_hoje then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
    if p_valor is not null and p_valor <= 0 then raise exception 'Valor inválido.'; end if;
    update fin_pag_parcelas set status = 'pago', pago_em = coalesce(p_data, v_hoje), pago_valor = coalesce(p_valor, x.valor),
           pago_por = auth.uid(), obs = coalesce(v_obs, obs), atualizado_em = now() where id = x.id;
    v_txt := 'Parcela ' || x.numero || '/' || v_tot || ' paga em ' || to_char(coalesce(p_data, v_hoje), 'DD/MM/YYYY')
             || ' — ' || fin_pag_dinheiro(coalesce(p_valor, x.valor), x.moeda) || '.';
  elsif p_acao = 'desfazer' then
    update fin_pag_parcelas set status = 'a_pagar', pago_em = null, pago_valor = null, pago_por = null, atualizado_em = now() where id = x.id;
    v_txt := 'Parcela ' || x.numero || '/' || v_tot || ' voltou pra "a pagar".';
  elsif p_acao = 'cancelar' then
    if x.status = 'pago' then raise exception 'Parcela paga não se cancela — desfaça o pagamento antes.'; end if;
    update fin_pag_parcelas set status = 'cancelado', obs = coalesce(v_obs, obs), atualizado_em = now() where id = x.id;
    v_txt := 'Parcela ' || x.numero || '/' || v_tot || ' cancelada.';
  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, texto, autor_nome)
  values (x.solicitacao_id, 'comentario', v_txt || coalesce(' ' || v_obs, ''), qs_eu_nome());
  update qs_solicitacoes set atualizado_em = now(), atualizado_por = auth.uid() where id = x.solicitacao_id;
end $$;
revoke all on function fin_pag_parcela(uuid, text, date, numeric, text) from public, anon;
grant execute on function fin_pag_parcela(uuid, text, date, numeric, text) to authenticated;

-- ── 11) Escolher a expedição (Comercial e Relacionamento não leem expedicoes) ─
create or replace function fin_pag_expedicoes(p_termo text default null)
returns table (id uuid, nome text, codigo text, destino text, data_embarque date)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, e.codigo, e.destino, e.data_embarque
    from expedicoes e
   where exists (select 1 from qs_users u where u.id = auth.uid() and u.is_active)
     and e.status::text <> 'Cancelada'
     and (nullif(trim(coalesce(p_termo, '')), '') is null
          or e.nome ilike '%' || trim(p_termo) || '%' or e.codigo ilike '%' || trim(p_termo) || '%' or e.destino ilike '%' || trim(p_termo) || '%')
   order by (e.data_embarque is null), e.data_embarque, e.nome
   limit 60;
$$;
revoke all on function fin_pag_expedicoes(text) from public, anon;
grant execute on function fin_pag_expedicoes(text) to authenticated;

-- ── 12) As listas da tela "Pagamentos" do Financeiro ────────────────────────
create or replace view fin_pagamentos_v with (security_invoker = true) as
select s.*,
       q.expedicao_id,
       p.link        as pag_link,
       p.pago_em     as pag_pago_em,
       p.pago_valor  as pag_pago_valor,
       p.pago_moeda  as pag_pago_moeda,
       p.obs         as pag_obs,
       p.feito_em    as pag_feito_em,
       uf.name       as pag_feito_por_nome,
       (select count(*) from fin_pag_anexos a where a.solicitacao_id = s.id)::int as pag_anexos,
       (select count(*) from fin_pag_parcelas x where x.solicitacao_id = s.id and x.status = 'a_pagar')::int as pag_parcelas_abertas,
       (select count(*) from fin_pag_parcelas x where x.solicitacao_id = s.id and x.status = 'pago')::int as pag_parcelas_pagas
  from qs_solicitacoes_v s
  join qs_solicitacao_tipos t on t.id = s.tipo_id and t.formulario = 'pagamento'
  join qs_solicitacoes q on q.id = s.id
  left join fin_pagamentos p on p.solicitacao_id = s.id
  left join qs_users uf on uf.id = p.feito_por;
revoke all on fin_pagamentos_v from anon;
grant select on fin_pagamentos_v to authenticated;

create or replace view fin_pag_parcelas_v with (security_invoker = true) as
select x.id, x.solicitacao_id, x.numero, x.valor, x.moeda, x.vencimento, x.status, x.pago_em, x.pago_valor, x.obs,
       case when x.status = 'a_pagar' and x.vencimento < (now() at time zone 'America/Sao_Paulo')::date then 'atrasado' else x.status end as situacao,
       (select count(*) from fin_pag_parcelas y where y.solicitacao_id = x.solicitacao_id)::int as total_parcelas,
       s.numero as sol_numero, s.titulo, s.sobre_nome, s.de_setor, s.cliente_id, s.viagem_id, s.expedicao_id,
       s.criado_por, uc.name as criado_por_nome, s.formulario
  from fin_pag_parcelas x
  join qs_solicitacoes s on s.id = x.solicitacao_id
  left join qs_users uc on uc.id = s.criado_por;
revoke all on fin_pag_parcelas_v from anon;
grant select on fin_pag_parcelas_v to authenticated;

-- ── 13) O pedido de link do closer (0181) passa a mandar o formulário ───────
-- Reescreve só a chamada da qs_sol_criar na definição VIGENTE (padrão da 0197).
-- Sem isso, o gatilho do item 4 recusaria o pedido do closer (sem formulário).
do $$
declare
  def  text;
  novo text;
begin
  select pg_get_functiondef('public.closer_pedir_link_pagamento(uuid, text, numeric, integer, date, text, text)'::regprocedure) into def;
  if position('fin_pag:formulario' in def) > 0 then return; end if;  -- já aplicado
  novo := replace(def,
    'n.viagem_id, n.lead_id, null, null, null);',
    'n.viagem_id, n.lead_id, null, null, /* fin_pag:formulario */ jsonb_build_object(''v'', 1, ''tipo'', ''link'', ''valor'', p_valor, ''moeda'', ''BRL'', '
      || '''parcelas_max'', coalesce(p_parcelas, 1), ''vencimento'', p_vencimento, ''descricao_cliente'', v_mod, '
      || '''obs'', nullif(trim(coalesce(p_obs, '''')), ''''), ''vinculo'', ''cliente'', '
      || '''finalidade'', ''outro'', ''finalidade_texto'', ''Venda do closer (cartão do negócio)''));');
  if novo = def then
    raise exception '[0201] closer_pedir_link_pagamento não está como esperado — nada foi alterado.';
  end if;
  execute novo;
end $$;
