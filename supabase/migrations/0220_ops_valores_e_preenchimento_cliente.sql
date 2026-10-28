-- =============================================================================
-- 0220 · Ops: valor de cada cliente + preenchimento do cliente 100% no QS
-- 28/10/2026 · frente "ops-valores" (branch f2-ops-valores)
--
-- NADA aqui foi executado. Arquivo idempotente (pode rodar 2x). Rollback no fim.
--
-- O que faz:
--  1. VALORES POR PASSAGEIRO
--     - expedicoes.preco_sem_aereo_brl (preço de referência sem aéreo; o com aéreo
--       continua em preco_venda_brl).
--     - passageiros.condicao_pagamento ('padrao' | 'sem_aereo' | 'expedamigo' |
--       'especial') + condicao_obs (texto da condição especial) + quem mexeu por
--       último no valor (valor_atualizado_em/_por/_por_nome).
--     - status_financeiro passa a ser calculado sozinho (Sem valor / Em aberto /
--       Parcial / Quitado) sempre que contratado ou pago mudam — venha a mudança
--       da tela de Valores, da tela de venda (frente subir-venda) ou de script.
--     - exp_valor_historico: cada mudança de valor/condição vira uma linha (quem,
--       quando, de → para). O audit_log não serve: grava usuario_id nulo pra quem
--       é só do QS (FK em usuarios).
--     - exp_pax_salvar_valores(pax, patch): a escrita da tela (só campos de valor).
--     - exp_valores_financeiro(exp): liga com o Financeiro (fin_planos/fin_parcelas):
--       por passageiro, o plano de pagamento da venda dele (se houver), recebido e
--       a receber. O "pago" do passageiro continua sendo o campo da expedição; a
--       tela mostra o do Financeiro ao lado e deixa copiar.
--  2. PREENCHIMENTO DO CLIENTE
--     - Requisitos dão BAIXA SOZINHOS quando o dado chega no passageiro
--       (venha da inscrição, da aprovação, do portal, da equipe ou do Bitrix):
--         Passaporte: número + validade ≥ 6 meses após o retorno + anexo → Aprovado;
--                     número + validade boa, sem anexo → Enviado;
--                     validade curta → Vencido.
--         Aéreo Internacional: localizador preenchido → Aprovado.
--         Aéreo Doméstico: voo_nacional_necessario = false → Dispensado (e volta a
--                     Pendente se passar a ser necessário).
--       Nunca rebaixa um Aprovado (só pra Vencido, se a validade nova não serve)
--       e não mexe em Dispensado.
--     - Cadastro único: além dos 6 campos que a 0172 já leva pra rel_clientes, o
--       contato de emergência, o endereço e as restrições alimentares vão pra
--       rel_clientes.dados_expedicoes (mescla; não apaga o que já existe).
--     - Inscrição de quem JÁ É passageiro da expedição pode ser aprovada sozinha
--       (chave ops_config 'inscricao_auto_aprovar' = true; DESLIGADA por padrão).
--       Pessoa nova continua indo pra fila de Inscrições.
--  3. REQUISITOS DE QUEM NÃO TEM
--     - exp_gerar_requisitos_faltantes(): cria os requisitos de todo passageiro
--       ativo que não tem nenhum (143 em 28/10) e já dá a baixa automática.
--     - exp_requisitos_dar_baixa_todos(): roda a baixa automática na base inteira
--       (não mexe em Reprovado).
--     Pra rodar depois de aplicar (logado como admin no SQL Editor não funciona —
--     auth.uid() é nulo; use a tela ou chame com a sessão de um admin):
--       select exp_gerar_requisitos_faltantes();
--       select exp_requisitos_dar_baixa_todos();
--     No SQL Editor (postgres), use as versões internas, sem checagem de login:
--       select _exp_gerar_requisitos_faltantes();
--       select _exp_requisitos_dar_baixa_todos();
-- =============================================================================

begin;

-- ── 1. Colunas ──────────────────────────────────────────────────────────────
alter table public.expedicoes add column if not exists preco_sem_aereo_brl numeric(12,2);
comment on column public.expedicoes.preco_sem_aereo_brl is 'Preço de referência por pessoa SEM aéreo (o com aéreo é preco_venda_brl). 0220.';

alter table public.passageiros add column if not exists condicao_pagamento text not null default 'padrao';
alter table public.passageiros add column if not exists condicao_obs text;
alter table public.passageiros add column if not exists valor_atualizado_em timestamptz;
alter table public.passageiros add column if not exists valor_atualizado_por uuid;
alter table public.passageiros add column if not exists valor_atualizado_por_nome text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'passageiros_condicao_pagamento_chk') then
    alter table public.passageiros add constraint passageiros_condicao_pagamento_chk
      check (condicao_pagamento in ('padrao', 'sem_aereo', 'expedamigo', 'especial'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'passageiros_valores_nao_negativos_chk') then
    alter table public.passageiros add constraint passageiros_valores_nao_negativos_chk
      check (valor_contratado_brl >= 0 and valor_pago_brl >= 0) not valid;
  end if;
end $$;
comment on column public.passageiros.condicao_pagamento is 'padrao | sem_aereo | expedamigo | especial (texto em condicao_obs). 0220.';

-- ── 2. Histórico de valores ─────────────────────────────────────────────────
create table if not exists public.exp_valor_historico (
  id uuid primary key default gen_random_uuid(),
  passageiro_id uuid not null references public.passageiros(id) on delete cascade,
  expedicao_id uuid,
  campo text not null,
  antes text,
  depois text,
  usuario_id uuid,
  usuario_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists exp_valor_historico_pax_idx on public.exp_valor_historico (passageiro_id, criado_em desc);
create index if not exists exp_valor_historico_exp_idx on public.exp_valor_historico (expedicao_id, criado_em desc);
alter table public.exp_valor_historico enable row level security;

drop policy if exists exp_valor_historico_ler on public.exp_valor_historico;
create policy exp_valor_historico_ler on public.exp_valor_historico
  for select using ((select exp_tem_acesso()));
-- Escrita só pelo gatilho (security definer). Barreira da 0210 (tabela nova não ganha sozinha):
drop policy if exists app_cliente_barreira on public.exp_valor_historico;
create policy app_cliente_barreira on public.exp_valor_historico as restrictive
  for all using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));

-- ── 3. Gatilhos dos valores ─────────────────────────────────────────────────
-- ANTES: calcula status_financeiro e carimba quem mexeu.
create or replace function public._exp_trg_pax_valores()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.condicao_pagamento = 'especial' and nullif(btrim(coalesce(new.condicao_obs, '')), '') is null then
    raise exception 'Condição especial: descreva a condição (ex.: "entrada + 10x sem juros").';
  end if;
  new.status_financeiro := case
    when coalesce(new.valor_contratado_brl, 0) <= 0 then case when coalesce(new.valor_pago_brl, 0) > 0 then 'Parcial' else 'Sem valor' end
    when coalesce(new.valor_pago_brl, 0) >= new.valor_contratado_brl then 'Quitado'
    when coalesce(new.valor_pago_brl, 0) > 0 then 'Parcial'
    else 'Em aberto' end;
  if tg_op = 'INSERT'
     or new.valor_contratado_brl is distinct from old.valor_contratado_brl
     or new.valor_pago_brl is distinct from old.valor_pago_brl
     or new.condicao_pagamento is distinct from old.condicao_pagamento
     or new.condicao_obs is distinct from old.condicao_obs then
    if tg_op = 'UPDATE' or coalesce(new.valor_contratado_brl, 0) > 0 or coalesce(new.valor_pago_brl, 0) > 0 then
      new.valor_atualizado_em := now();
      new.valor_atualizado_por := auth.uid();
      new.valor_atualizado_por_nome := coalesce(exp__nome_usuario(), case when auth.uid() is null then 'sistema' end);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tg_passageiros_valores on public.passageiros;
create trigger tg_passageiros_valores
  before insert or update of valor_contratado_brl, valor_pago_brl, condicao_pagamento, condicao_obs on public.passageiros
  for each row execute function public._exp_trg_pax_valores();

-- DEPOIS: uma linha de histórico por campo que mudou.
create or replace function public._exp_trg_pax_valores_log()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_nome text := coalesce(exp__nome_usuario(), case when auth.uid() is null then 'sistema' end);
begin
  insert into exp_valor_historico (passageiro_id, expedicao_id, campo, antes, depois, usuario_id, usuario_nome)
  select new.id, new.expedicao_id, c.campo, c.antes, c.depois, auth.uid(), v_nome
    from (values
      ('valor_contratado_brl', case when tg_op = 'UPDATE' then old.valor_contratado_brl::text end, new.valor_contratado_brl::text),
      ('valor_pago_brl',       case when tg_op = 'UPDATE' then old.valor_pago_brl::text end,       new.valor_pago_brl::text),
      ('condicao_pagamento',   case when tg_op = 'UPDATE' then old.condicao_pagamento end,         new.condicao_pagamento),
      ('condicao_obs',         case when tg_op = 'UPDATE' then old.condicao_obs end,               new.condicao_obs)
    ) as c(campo, antes, depois)
   where c.antes is distinct from c.depois
     and not (tg_op = 'INSERT' and (c.depois is null or c.depois in ('0', '0.00', 'padrao')));
  return null;
exception when others then
  raise warning 'histórico de valores: passageiro % não registrou: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_passageiros_valores_log on public.passageiros;
create trigger trg_passageiros_valores_log
  after insert or update of valor_contratado_brl, valor_pago_brl, condicao_pagamento, condicao_obs on public.passageiros
  for each row execute function public._exp_trg_pax_valores_log();

-- ── 4. Escrita da tela de Valores ───────────────────────────────────────────
create or replace function public.exp_pax_salvar_valores(p_pax uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r passageiros%rowtype;
begin
  if not exp_tem_acesso() or is_readonly() then raise exception 'Seu perfil é só de leitura nas Expedições — essa ação não é permitida.'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nada pra salvar.'; end if;
  update passageiros set
    valor_contratado_brl = case when p_patch ? 'valor_contratado_brl' then coalesce(nullif(p_patch->>'valor_contratado_brl', '')::numeric, 0) else valor_contratado_brl end,
    valor_pago_brl       = case when p_patch ? 'valor_pago_brl'       then coalesce(nullif(p_patch->>'valor_pago_brl', '')::numeric, 0)       else valor_pago_brl end,
    condicao_pagamento   = case when p_patch ? 'condicao_pagamento'   then coalesce(nullif(p_patch->>'condicao_pagamento', ''), 'padrao')    else condicao_pagamento end,
    condicao_obs         = case when p_patch ? 'condicao_obs'         then nullif(btrim(coalesce(p_patch->>'condicao_obs', '')), '')         else condicao_obs end
  where id = p_pax
  returning * into r;
  if r.id is null then raise exception 'Passageiro não encontrado.'; end if;
  if r.valor_contratado_brl < 0 or r.valor_pago_brl < 0 then raise exception 'Valor não pode ser negativo.'; end if;
  return jsonb_build_object('id', r.id, 'valor_contratado_brl', r.valor_contratado_brl, 'valor_pago_brl', r.valor_pago_brl,
    'saldo_brl', r.saldo_brl, 'status_financeiro', r.status_financeiro, 'condicao_pagamento', r.condicao_pagamento,
    'condicao_obs', r.condicao_obs, 'valor_atualizado_em', r.valor_atualizado_em, 'valor_atualizado_por_nome', r.valor_atualizado_por_nome);
end $$;

-- ── 5. Ligação com o Financeiro (fin_planos / fin_parcelas) ─────────────────
-- Plano da venda do passageiro = plano cuja viagem (rel_viagens) é desta expedição
-- e cujo cliente é o passageiro (comprador) ou está entre os passageiros da viagem.
-- Um plano pode cobrir mais de uma pessoa (casal): pax_no_plano diz quantas.
create or replace function public.exp_valores_financeiro(p_exp uuid)
returns table (passageiro_id uuid, plano_id uuid, plano_total numeric, recebido numeric, a_receber numeric,
               parcelas_abertas integer, proximo_vencimento date, pax_no_plano integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not exp_tem_acesso() then raise exception 'Sem acesso às Expedições.'; end if;
  return query
  with ligacoes as (
    select p.id as pax_id, fp.id as plano_id, fp.valor_total
      from passageiros p
      join rel_viagens v on v.expedicoes_id = p.expedicao_id
      join fin_planos fp on fp.viagem_id = v.id
     where p.expedicao_id = p_exp and p.cliente_id is not null
       and (fp.cliente_id = p.cliente_id
            or exists (select 1 from rel_viagem_passageiros rvp where rvp.viagem_id = v.id and rvp.cliente_id = p.cliente_id))
  ), somas as (
    select pa.plano_id,
           coalesce(sum(coalesce(pa.pago_valor, pa.valor)) filter (where pa.status = 'pago'), 0) as recebido,
           coalesce(sum(pa.valor) filter (where pa.status = 'a_receber'), 0) as a_receber,
           count(*) filter (where pa.status = 'a_receber')::int as abertas,
           min(pa.vencimento) filter (where pa.status = 'a_receber') as prox
      from fin_parcelas pa
     where pa.plano_id in (select l.plano_id from ligacoes l)
     group by pa.plano_id
  )
  select distinct on (l.pax_id) l.pax_id, l.plano_id, l.valor_total,
         coalesce(s.recebido, 0), coalesce(s.a_receber, 0), coalesce(s.abertas, 0), s.prox,
         (select count(distinct l2.pax_id)::int from ligacoes l2 where l2.plano_id = l.plano_id)
    from ligacoes l left join somas s on s.plano_id = l.plano_id
   order by l.pax_id, l.valor_total desc nulls last;
end $$;

-- ── 6. Baixa automática dos requisitos ──────────────────────────────────────
create or replace function public._exp_requisitos_baixa(p_pax uuid, p_respeitar_reprovado boolean default false)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  p passageiros%rowtype;
  v_ret date;
  v_novo status_requisito;
  n integer := 0; k integer;
begin
  select * into p from passageiros where id = p_pax;
  if p.id is null or p.expedicao_id is null or p.status_reserva = 'Cancelado' then return 0; end if;
  select coalesce(data_retorno, data_embarque) into v_ret from expedicoes where id = p.expedicao_id;

  -- Passaporte
  if nullif(btrim(coalesce(p.passaporte, '')), '') is not null and p.validade_passaporte is not null then
    v_novo := case
      when p.validade_passaporte < (coalesce(v_ret, current_date) + interval '6 months')::date then 'Vencido'
      when p.passaporte_arquivo_id is not null then 'Aprovado'
      else 'Enviado' end::status_requisito;
    update passageiro_requisitos r set
      status = v_novo,
      numero = btrim(p.passaporte),
      validade = p.validade_passaporte,
      arquivo_id = coalesce(p.passaporte_arquivo_id, r.arquivo_id),
      verificado_em = case when v_novo = 'Aprovado' then now() else r.verificado_em end
     where r.passageiro_id = p.id and r.tipo = 'Passaporte'
       and r.status <> 'Dispensado'
       and (r.status is distinct from v_novo or r.numero is distinct from btrim(p.passaporte) or r.validade is distinct from p.validade_passaporte)
       and not (r.status = 'Aprovado' and v_novo = 'Enviado')            -- aprovado à mão sem anexo: não rebaixa
       and not (p_respeitar_reprovado and r.status = 'Reprovado');
    get diagnostics k = row_count; n := n + k;
  end if;

  -- Aéreo internacional: localizador chegou
  if nullif(btrim(coalesce(p.localizador, '')), '') is not null then
    update passageiro_requisitos r set status = 'Aprovado', numero = btrim(p.localizador), verificado_em = now()
     where r.passageiro_id = p.id and r.tipo = 'Aéreo Internacional'
       and r.status in ('Pendente', 'Enviado', 'Em análise')
       and not (p_respeitar_reprovado and r.status = 'Reprovado');
    get diagnostics k = row_count; n := n + k;
  end if;

  -- Aéreo doméstico: depende de voo_nacional_necessario
  update passageiro_requisitos r set status = case when p.voo_nacional_necessario then 'Pendente' else 'Dispensado' end::status_requisito
   where r.passageiro_id = p.id and r.tipo = 'Aéreo Doméstico'
     and ((not coalesce(p.voo_nacional_necessario, false) and r.status = 'Pendente')
       or (coalesce(p.voo_nacional_necessario, false) and r.status = 'Dispensado'));
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

create or replace function public._exp_trg_pax_requisitos_baixa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- Reprovado pela equipe só é reavaliado quando chega dado NOVO de passaporte/voo;
  -- mudar status da reserva ou de expedição não desfaz a reprovação.
  perform _exp_requisitos_baixa(new.id, tg_op = 'UPDATE' and
    (new.passaporte, new.validade_passaporte, new.passaporte_arquivo_id, new.localizador)
      is not distinct from (old.passaporte, old.validade_passaporte, old.passaporte_arquivo_id, old.localizador));
  return null;
exception when others then
  raise warning 'baixa automática: passageiro % não atualizou os requisitos: %', new.id, sqlerrm;
  return null;
end $$;

-- O nome ordena DEPOIS de trg_passageiros_requisitos (que cria os requisitos),
-- então no INSERT os requisitos já existem quando a baixa roda.
drop trigger if exists trg_passageiros_requisitos_baixa on public.passageiros;
create trigger trg_passageiros_requisitos_baixa
  after insert or update of passaporte, validade_passaporte, passaporte_arquivo_id, localizador, voo_nacional_necessario, expedicao_id, status_reserva
  on public.passageiros
  for each row execute function public._exp_trg_pax_requisitos_baixa();

-- ── 7. Requisitos de quem não tem + baixa retroativa ────────────────────────
create or replace function public._exp_gerar_requisitos_faltantes()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_pax int := 0; v_req int := 0; v_baixa int := 0; k int;
begin
  for r in
    select p.id, p.cpf from passageiros p
     where p.expedicao_id is not null and p.status_reserva <> 'Cancelado'
       and not exists (select 1 from passageiro_requisitos pr where pr.passageiro_id = p.id)
  loop
    k := _exp_instanciar_requisitos(r.id);
    if k > 0 then
      v_pax := v_pax + 1; v_req := v_req + k;
      perform _exp_espalhar_vacina(r.cpf, null);
      v_baixa := v_baixa + _exp_requisitos_baixa(r.id, true);
    end if;
  end loop;
  return jsonb_build_object('passageiros', v_pax, 'requisitos', v_req, 'baixas', v_baixa);
end $$;

create or replace function public.exp_gerar_requisitos_faltantes()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exp_eh_admin() then raise exception 'Só admin das Expedições gera os requisitos de todo mundo.'; end if;
  return _exp_gerar_requisitos_faltantes();
end $$;

create or replace function public._exp_requisitos_dar_baixa_todos()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; n int := 0;
begin
  for r in select id from passageiros where expedicao_id is not null and status_reserva <> 'Cancelado' loop
    n := n + _exp_requisitos_baixa(r.id, true);
  end loop;
  return n;
end $$;

create or replace function public.exp_requisitos_dar_baixa_todos()
returns integer language plpgsql security definer set search_path to 'public' as $$
begin
  if not exp_eh_admin() then raise exception 'Só admin das Expedições roda a baixa na base inteira.'; end if;
  return _exp_requisitos_dar_baixa_todos();
end $$;

-- ── 8. Cadastro único: extras do passageiro → rel_clientes.dados_expedicoes ──
create or replace function public._exp_trg_pax_cad_extras()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_extra jsonb;
  v_end text;
  v_guarda text := current_setting('cad.sync', true);
begin
  if coalesce(v_guarda, 'off') = 'on' then return null; end if;
  if new.cliente_id is null then return null; end if;
  v_end := nullif(concat_ws(' - ',
             nullif(concat_ws(', ', nullif(btrim(new.endereco_rua), ''), nullif(btrim(new.endereco_numero), ''), nullif(btrim(new.endereco_complemento), '')), ''),
             nullif(btrim(new.endereco_bairro), ''),
             nullif(concat_ws(' / ', nullif(btrim(new.endereco_cidade), ''), nullif(btrim(new.endereco_estado), '')), ''),
             case when nullif(btrim(new.endereco_cep), '') is not null then 'CEP ' || btrim(new.endereco_cep) end), '');
  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'contato_emergencia', case when coalesce(nullif(btrim(new.contato_emergencia_nome), ''), nullif(btrim(new.contato_emergencia_fone), '')) is not null
      then jsonb_strip_nulls(jsonb_build_object('nome', nullif(btrim(new.contato_emergencia_nome), ''),
             'fone', nullif(btrim(new.contato_emergencia_fone), ''), 'vinculo', nullif(btrim(new.contato_emergencia_vinculo), ''))) end,
    'endereco', v_end,
    'endereco_partes', case when v_end is not null then jsonb_strip_nulls(jsonb_build_object(
      'cep', nullif(btrim(new.endereco_cep), ''), 'rua', nullif(btrim(new.endereco_rua), ''), 'numero', nullif(btrim(new.endereco_numero), ''),
      'complemento', nullif(btrim(new.endereco_complemento), ''), 'bairro', nullif(btrim(new.endereco_bairro), ''),
      'cidade', nullif(btrim(new.endereco_cidade), ''), 'estado', nullif(btrim(new.endereco_estado), ''))) end,
    'restricoes_alimentares', nullif(btrim(new.restricoes_alimentares), '')));
  if v_extra = '{}'::jsonb then return null; end if;
  perform set_config('cad.sync', 'on', true);
  update rel_clientes
     set dados_expedicoes = coalesce(dados_expedicoes, '{}'::jsonb) || v_extra
                            || jsonb_build_object('atualizado_em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   where id = new.cliente_id
     and (coalesce(dados_expedicoes, '{}'::jsonb) || v_extra) is distinct from coalesce(dados_expedicoes, '{}'::jsonb);
  perform set_config('cad.sync', coalesce(v_guarda, 'off'), true);
  return null;
exception when others then
  perform set_config('cad.sync', coalesce(v_guarda, 'off'), true);
  raise warning 'cadastro único (extras): passageiro % não sincronizou: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_passageiros_cad_extras on public.passageiros;
create trigger trg_passageiros_cad_extras
  after insert or update of cliente_id, contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo,
    endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado,
    restricoes_alimentares
  on public.passageiros
  for each row execute function public._exp_trg_pax_cad_extras();

-- ── 9. Inscrição de quem já é passageiro: aprovação automática (desligada) ──
-- Liga com:  insert into ops_config (chave, valor) values ('inscricao_auto_aprovar', 'true')
--            on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- A permissão de aprovar ganha uma porta só pra este gatilho (GUC local da transação,
-- que o PostgREST não deixa o cliente mudar).
create or replace function public.exp_pode_decidir_inscricao()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(current_setting('exp.inscricao_auto', true), 'off') = 'on'
      or (exp_tem_acesso() and (
            not is_readonly()
            or coalesce((select papel::text = 'relacionamento' from usuarios where id = auth.uid()), qs_do_setor('relacionamento'))
          ));
$$;

create or replace function public._exp_trg_inscricao_auto()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_cpf text := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
begin
  if new.status is distinct from 'pendente' then return null; end if;
  if coalesce((select valor = 'true'::jsonb from ops_config where chave = 'inscricao_auto_aprovar'), false) is not true then return null; end if;
  -- Só quem já é passageiro desta expedição (comprador conhecido). Pessoa nova = fila.
  if not exists (select 1 from passageiros p
                  where p.expedicao_id = new.expedicao_id and p.status_reserva <> 'Cancelado'
                    and regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = v_cpf) then
    return null;
  end if;
  begin
    perform set_config('exp.inscricao_auto', 'on', true);
    perform exp_inscricao_aprovar(new.id, '[]'::jsonb);
    perform set_config('exp.inscricao_auto', 'off', true);
  exception when others then
    perform set_config('exp.inscricao_auto', 'off', true);
    raise warning 'inscrição % ficou pra aprovação manual: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_inscricao_auto on public.inscricoes_pendentes;
create trigger trg_inscricao_auto
  after insert or update of dados, status, passaporte_arquivo_id on public.inscricoes_pendentes
  for each row execute function public._exp_trg_inscricao_auto();

-- ── Permissões ──────────────────────────────────────────────────────────────
revoke all on function public._exp_trg_pax_valores() from public, anon, authenticated;
revoke all on function public._exp_trg_pax_valores_log() from public, anon, authenticated;
revoke all on function public._exp_requisitos_baixa(uuid, boolean) from public, anon, authenticated;
revoke all on function public._exp_trg_pax_requisitos_baixa() from public, anon, authenticated;
revoke all on function public._exp_gerar_requisitos_faltantes() from public, anon, authenticated;
revoke all on function public._exp_requisitos_dar_baixa_todos() from public, anon, authenticated;
revoke all on function public._exp_trg_pax_cad_extras() from public, anon, authenticated;
revoke all on function public._exp_trg_inscricao_auto() from public, anon, authenticated;
revoke all on function public.exp_pax_salvar_valores(uuid, jsonb) from public, anon;
revoke all on function public.exp_valores_financeiro(uuid) from public, anon;
revoke all on function public.exp_gerar_requisitos_faltantes() from public, anon;
revoke all on function public.exp_requisitos_dar_baixa_todos() from public, anon;
grant execute on function public.exp_pax_salvar_valores(uuid, jsonb) to authenticated;
grant execute on function public.exp_valores_financeiro(uuid) to authenticated;
grant execute on function public.exp_gerar_requisitos_faltantes() to authenticated;
grant execute on function public.exp_requisitos_dar_baixa_todos() to authenticated;
grant select on public.exp_valor_historico to authenticated;

commit;

-- =============================================================================
-- ROLLBACK (rodar à mão, nesta ordem)
-- =============================================================================
-- begin;
-- drop trigger if exists trg_inscricao_auto on public.inscricoes_pendentes;
-- drop function if exists public._exp_trg_inscricao_auto();
-- create or replace function public.exp_pode_decidir_inscricao() returns boolean language sql stable security definer
--   set search_path to 'public' as $$ select exp_tem_acesso() and (not is_readonly()
--   or coalesce((select papel::text = 'relacionamento' from usuarios where id = auth.uid()), qs_do_setor('relacionamento'))); $$;
-- drop trigger if exists trg_passageiros_cad_extras on public.passageiros;
-- drop function if exists public._exp_trg_pax_cad_extras();
-- drop trigger if exists trg_passageiros_requisitos_baixa on public.passageiros;
-- drop function if exists public._exp_trg_pax_requisitos_baixa();
-- drop function if exists public.exp_requisitos_dar_baixa_todos();
-- drop function if exists public._exp_requisitos_dar_baixa_todos();
-- drop function if exists public.exp_gerar_requisitos_faltantes();
-- drop function if exists public._exp_gerar_requisitos_faltantes();
-- drop function if exists public._exp_requisitos_baixa(uuid, boolean);
-- drop function if exists public.exp_valores_financeiro(uuid);
-- drop function if exists public.exp_pax_salvar_valores(uuid, jsonb);
-- drop trigger if exists trg_passageiros_valores_log on public.passageiros;
-- drop trigger if exists tg_passageiros_valores on public.passageiros;
-- drop function if exists public._exp_trg_pax_valores_log();
-- drop function if exists public._exp_trg_pax_valores();
-- drop table if exists public.exp_valor_historico;
-- alter table public.passageiros drop constraint if exists passageiros_valores_nao_negativos_chk;
-- alter table public.passageiros drop constraint if exists passageiros_condicao_pagamento_chk;
-- alter table public.passageiros drop column if exists valor_atualizado_por_nome, drop column if exists valor_atualizado_por,
--   drop column if exists valor_atualizado_em, drop column if exists condicao_obs, drop column if exists condicao_pagamento;
-- alter table public.expedicoes drop column if exists preco_sem_aereo_brl;
-- commit;
-- (Requisitos que já levaram baixa automática ficam como estão; o histórico de
--  quem mudou some junto com a tabela.)
