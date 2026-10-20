-- 0151_rel_cruzar_base.sql
-- -----------------------------------------------------------------------------
-- Ficha do cliente: cruzar TODA a base pra chegar numa base real (Bruno 20/10).
--
-- 1) rel_cruzar_base(p_aplicar)  — o cruzamento AUTOMÁTICO, só do que é seguro:
--      • completa campo VAZIO da ficha (CPF, nascimento, e-mail, telefone,
--        passaporte, validade) com o que está no contato do Bitrix do próprio
--        cliente ou nas vendas em que ele é o comprador — só quando todas as
--        fontes concordam e ninguém mais (vivo) tem aquele valor;
--      • liga conversa do WhatsApp, atendimento do Financeiro, chamado e venda
--        sem cliente quando UM cliente só bate (telefone completo/chave do 9º
--        dígito, CPF válido, e-mail exato).
--    Nunca sobrescreve, nunca apaga, nunca junta ficha. Tudo vai pro
--    rel_cruzamentos (com a "rodada") e dá pra desfazer com
--    rel_desfazer_cruzamento(rodada). p_aplicar = false só conta.
-- 2) rel_fila_cadastros()        — o que sobrou pro time (tela "Arrumar cadastros").
-- 3) rel_vincular_cadastro(...)  — o time liga conversa/venda/atendimento à ficha.
-- 4) rel_ligacoes_do_cliente(id) — o que a ficha não enxergava: lead de origem no
--    Comercial, grupos do WhatsApp, atendimentos do Financeiro, viagens como
--    passageiro.
-- Sem pg_cron neste projeto: roda na hora (botão na tela) e quando aplicado.
-- -----------------------------------------------------------------------------

-- ── Apoio ───────────────────────────────────────────────────────────────────

create or replace function public.rel_cpf_valido(p text)
returns boolean language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

-- Campo do Bitrix que vem como lista em texto ('["a","b"]') ou valor solto.
create or replace function public.rel_bitrix_lista(p text)
returns text[] language plpgsql immutable set search_path = public as $$
begin
  if p is null or btrim(p) in ('', '-', '[]', '.') then return '{}'; end if;
  if btrim(p) like '[%' then
    return coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(p::jsonb) x where btrim(x) not in ('', '-', '.')), '{}');
  end if;
  return array[btrim(p)];
exception when others then
  return array[btrim(p)];
end $$;

-- Data "1982-08-18T03:00:00+04:00" / "18/08/1982" → date (ou null se não der).
create or replace function public.rel_data_bitrix(p text)
returns date language plpgsql immutable set search_path = public as $$
declare d date;
begin
  if p ~ '^\d{4}-\d{2}-\d{2}' then d := substr(p, 1, 10)::date;
  elsif p ~ '^\d{2}/\d{2}/\d{4}' then d := to_date(substr(p, 1, 10), 'DD/MM/YYYY');
  else return null; end if;
  if d < date '1900-01-01' or d > date '2100-01-01' then return null; end if;
  return d;
exception when others then return null;
end $$;

-- ── Registro de tudo que o cruzamento mudou ─────────────────────────────────

create table if not exists public.rel_cruzamentos (
  id bigserial primary key,
  rodada uuid not null,
  em timestamptz not null default now(),
  por uuid default auth.uid(),
  tabela text not null,           -- rel_clientes | rel_wa_conversas | rel_viagens | fin_atendimentos | rel_chamados
  registro_id uuid not null,
  campo text not null,
  antes text,
  depois text,
  fonte text not null,            -- de onde veio (bitrix_contato, venda, telefone, cpf_venda, manual…)
  desfeito_em timestamptz
);
create index if not exists rel_cruzamentos_rodada on public.rel_cruzamentos (rodada);
create index if not exists rel_cruzamentos_registro on public.rel_cruzamentos (registro_id);

alter table public.rel_cruzamentos enable row level security;
drop policy if exists rel_cruzamentos_ler on public.rel_cruzamentos;
create policy rel_cruzamentos_ler on public.rel_cruzamentos for select using (public.rel_tem_acesso());

-- ── 1) O cruzamento automático ──────────────────────────────────────────────

create or replace function public.rel_cruzar_base(p_aplicar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_rodada uuid := gen_random_uuid();
  v_res jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null and not rel_tem_acesso() then
    raise exception 'Sem acesso ao Relacionamento.';
  end if;

  -- Propostas de valor por (cliente, campo), de todas as fontes.
  create temp table _prop (cliente_id uuid, campo text, valor text, fonte text) on commit drop;

  -- a) contato do Bitrix do próprio cliente
  insert into _prop
  select c.id, 'cpf', regexp_replace(x, '\D', '', 'g'), 'bitrix_contato'
    from rel_clientes c,
         lateral unnest(array[c.bitrix_dados->>'CPF 2 [UF_CRM_1752691408782]', c.bitrix_dados->>'CPF [UF_CRM_1749757426655]']) x
   where c.mesclado_em_id is null and c.arquivado_em is null and c.cpf is null and rel_cpf_valido(x);

  insert into _prop
  select c.id, 'nascimento', rel_data_bitrix(c.bitrix_dados->>'Data de nascimento [BIRTHDATE]')::text, 'bitrix_contato'
    from rel_clientes c
   where c.mesclado_em_id is null and c.arquivado_em is null and c.nascimento is null
     and rel_data_bitrix(c.bitrix_dados->>'Data de nascimento [BIRTHDATE]') < current_date;

  insert into _prop
  select c.id, 'email', lower(x), 'bitrix_contato'
    from rel_clientes c, lateral unnest(rel_bitrix_lista(c.bitrix_dados->>'E-mail [EMAIL]')) x
   where c.mesclado_em_id is null and c.arquivado_em is null and c.email is null
     and x ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';

  insert into _prop
  select c.id, 'telefone', regexp_replace(x, '\D', '', 'g'), 'bitrix_contato'
    from rel_clientes c, lateral unnest(rel_bitrix_lista(c.bitrix_dados->>'Telefone [PHONE]')) x
   where c.mesclado_em_id is null and c.arquivado_em is null and c.telefone is null
     and length(regexp_replace(x, '\D', '', 'g')) between 10 and 13;

  insert into _prop
  select c.id, 'passaporte', upper(regexp_replace(c.bitrix_dados->>'NÚMERO DE PASSAPORTE [UF_CRM_1752523114589]', '[^A-Za-z0-9]', '', 'g')), 'bitrix_contato'
    from rel_clientes c
   where c.mesclado_em_id is null and c.arquivado_em is null and c.passaporte is null
     and length(regexp_replace(coalesce(c.bitrix_dados->>'NÚMERO DE PASSAPORTE [UF_CRM_1752523114589]', ''), '[^A-Za-z0-9]', '', 'g')) between 6 and 12;

  insert into _prop
  select c.id, 'passaporte_validade', rel_data_bitrix(c.bitrix_dados->>'VENC PASSAPORTE [UF_CRM_1752523126895]')::text, 'bitrix_contato'
    from rel_clientes c
   where c.mesclado_em_id is null and c.arquivado_em is null and c.passaporte_validade is null
     and rel_data_bitrix(c.bitrix_dados->>'VENC PASSAPORTE [UF_CRM_1752523126895]') is not null;

  -- b) vendas em que ele é o comprador (campos do negócio no Bitrix)
  insert into _prop
  select v.cliente_id, 'cpf', regexp_replace(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]', '\D', '', 'g'), 'venda'
    from rel_viagens v join rel_clientes c on c.id = v.cliente_id
   where c.mesclado_em_id is null and c.arquivado_em is null and c.cpf is null and v.mesclada_em_id is null
     and rel_cpf_valido(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]');

  insert into _prop
  select v.cliente_id, 'nascimento', rel_data_bitrix(v.bitrix_dados->>'Data de Nascimento [UF_CRM_1756148121396]')::text, 'venda'
    from rel_viagens v join rel_clientes c on c.id = v.cliente_id
   where c.mesclado_em_id is null and c.arquivado_em is null and c.nascimento is null and v.mesclada_em_id is null
     and rel_data_bitrix(v.bitrix_dados->>'Data de Nascimento [UF_CRM_1756148121396]') < current_date;

  insert into _prop
  select v.cliente_id, 'email', lower(btrim(x)), 'venda'
    from rel_viagens v join rel_clientes c on c.id = v.cliente_id,
         lateral unnest(array[v.bitrix_dados->>'E-mail do cliente [UF_CRM_1762288786624]', v.bitrix_dados->>'E-mail [UF_CRM_1756145690413]']) x
   where c.mesclado_em_id is null and c.arquivado_em is null and c.email is null and v.mesclada_em_id is null
     and btrim(x) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';

  -- Normaliza como o gatilho da ficha faz (telefone com 55, e-mail minúsculo).
  -- E-mail da VENDA às vezes é de quem preencheu (filha, marido, a agência):
  -- só vale se o primeiro nome do cliente estiver no e-mail.
  delete from _prop p using rel_clientes c
   where p.fonte = 'venda' and p.campo = 'email' and c.id = p.cliente_id
     and not (length(split_part(rel_nome_chave(c.nome), ' ', 1)) >= 3
              and length(split_part(p.valor, '@', 1)) >= 6
              and position(split_part(rel_nome_chave(c.nome), ' ', 1) in replace(rel_nome_chave(split_part(p.valor, '@', 1)), ' ', '')) > 0);

  update _prop set valor = '55' || valor where campo = 'telefone' and length(valor) in (10, 11);
  -- Fora: e-mail/telefone da agência e valor que aparece em várias pessoas
  -- (número do escritório no contato, e-mail de reservas…).
  delete from _prop where campo = 'email' and valor ~* '(setuforeuvou|setufor|tahitiviagens)';
  delete from _prop p using (
    select campo, case when campo = 'telefone' then rel_fone_chave(valor) else valor end k
      from _prop where campo in ('email', 'telefone')
     group by 1, 2 having count(distinct cliente_id) > 1
  ) r where p.campo = r.campo and (case when p.campo = 'telefone' then rel_fone_chave(p.valor) else p.valor end) = r.k;
  delete from _prop p where p.campo = 'telefone' and exists (
    select 1 from rel_clientes o, lateral unnest(rel_bitrix_lista(o.bitrix_dados->>'Telefone [PHONE]')) t
     where o.id <> p.cliente_id and o.mesclado_em_id is null and rel_fone_chave(regexp_replace(t, '\D', '', 'g')) = rel_fone_chave(p.valor)
     group by rel_fone_chave(regexp_replace(t, '\D', '', 'g')) having count(distinct o.id) >= 2);

  -- Decide: um valor só por (cliente, campo) e ninguém vivo já com ele.
  create temp table _ok on commit drop as
  select cliente_id, campo, min(valor) valor, string_agg(distinct fonte, '+') fonte
    from _prop group by cliente_id, campo having count(distinct valor) = 1;
  delete from _ok o where o.campo in ('cpf', 'passaporte', 'email') and (
       exists (select 1 from _ok x where x.campo = o.campo and x.valor = o.valor and x.cliente_id <> o.cliente_id)
    or exists (select 1 from rel_clientes c where c.id <> o.cliente_id and c.mesclado_em_id is null
                 and ((o.campo = 'cpf' and c.cpf = o.valor) or (o.campo = 'passaporte' and c.passaporte = o.valor)
                   or (o.campo = 'email' and c.email = o.valor))));
  delete from _ok o where o.campo = 'telefone' and (
       exists (select 1 from _ok x where x.campo = 'telefone' and rel_fone_chave(x.valor) = rel_fone_chave(o.valor) and x.cliente_id <> o.cliente_id)
    or exists (select 1 from rel_clientes c where c.id <> o.cliente_id and c.mesclado_em_id is null and c.arquivado_em is null
                 and rel_fone_chave(c.telefone) = rel_fone_chave(o.valor)));

  select jsonb_object_agg(campo, q) into v_res from (select campo, count(*) q from _ok group by campo) t;
  v_res := jsonb_build_object('rodada', v_rodada, 'aplicado', p_aplicar, 'campos', coalesce(v_res, '{}'::jsonb));

  if p_aplicar then
    insert into rel_cruzamentos (rodada, tabela, registro_id, campo, antes, depois, fonte)
    select v_rodada, 'rel_clientes', cliente_id, campo, null, valor, fonte from _ok;
    update rel_clientes c set cpf = o.valor from _ok o where o.cliente_id = c.id and o.campo = 'cpf' and c.cpf is null;
    update rel_clientes c set nascimento = o.valor::date from _ok o where o.cliente_id = c.id and o.campo = 'nascimento' and c.nascimento is null;
    update rel_clientes c set email = o.valor from _ok o where o.cliente_id = c.id and o.campo = 'email' and c.email is null;
    update rel_clientes c set telefone = o.valor from _ok o where o.cliente_id = c.id and o.campo = 'telefone' and c.telefone is null;
    update rel_clientes c set passaporte = o.valor from _ok o where o.cliente_id = c.id and o.campo = 'passaporte' and c.passaporte is null;
    update rel_clientes c set passaporte_validade = o.valor::date from _ok o where o.cliente_id = c.id and o.campo = 'passaporte_validade' and c.passaporte_validade is null;
  end if;

  -- c) conversas do WhatsApp sem ficha → pelo telefone (1 cliente só)
  create temp table _lig (tabela text, registro_id uuid, cliente_id uuid, fonte text) on commit drop;
  insert into _lig
  select 'rel_wa_conversas', w.id, rel_cliente_do_telefone(w.telefone), 'telefone'
    from rel_wa_conversas w where w.cliente_id is null and rel_cliente_do_telefone(w.telefone) is not null;

  -- d) atendimentos do Financeiro → pela conversa ou pelo telefone
  insert into _lig
  select 'fin_atendimentos', f.id, coalesce(w.cliente_id, rel_cliente_do_telefone(f.telefone)),
         case when w.cliente_id is not null then 'conversa' else 'telefone' end
    from fin_atendimentos f left join rel_wa_conversas w on w.id = f.conversa_id
   where f.cliente_id is null and coalesce(w.cliente_id, rel_cliente_do_telefone(f.telefone)) is not null;

  -- e) chamados → pela conversa
  insert into _lig
  select 'rel_chamados', ch.id, w.cliente_id, 'conversa'
    from rel_chamados ch join rel_wa_conversas w on w.id = ch.conversa_id
   where ch.cliente_id is null and w.cliente_id is not null;

  -- f) vendas sem comprador → CPF válido ou e-mail do negócio batendo com 1 ficha
  insert into _lig
  select 'rel_viagens', v.id, m.id, m.fonte
    from rel_viagens v
    cross join lateral (
      select c.id, 'cpf_venda'::text fonte from rel_clientes c
       where c.mesclado_em_id is null and c.arquivado_em is null and rel_cpf_valido(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]')
         and c.cpf = regexp_replace(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]', '\D', '', 'g')
      union all
      select c.id, 'email_venda' from rel_clientes c
       where c.mesclado_em_id is null and c.arquivado_em is null and c.email is not null
         and c.email = lower(btrim(v.bitrix_dados->>'E-mail do cliente [UF_CRM_1762288786624]'))
         and c.email !~* '(setuforeuvou|setufor|tahitiviagens)'
    ) m
   where v.cliente_id is null and v.mesclada_em_id is null
     and (select count(distinct z.id) from (
           select c.id from rel_clientes c where c.mesclado_em_id is null and c.arquivado_em is null and rel_cpf_valido(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]')
              and c.cpf = regexp_replace(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]', '\D', '', 'g')
           union select c.id from rel_clientes c where c.mesclado_em_id is null and c.arquivado_em is null and c.email is not null
              and c.email = lower(btrim(v.bitrix_dados->>'E-mail do cliente [UF_CRM_1762288786624]'))
              and c.email !~* '(setuforeuvou|setufor|tahitiviagens)') z) = 1;
  delete from _lig a using _lig b where a.tabela = b.tabela and a.registro_id = b.registro_id and a.ctid > b.ctid;

  select v_res || jsonb_build_object('ligacoes', coalesce(jsonb_object_agg(tabela, q), '{}'::jsonb)) into v_res
    from (select tabela, count(*) q from _lig group by tabela) t;

  if p_aplicar then
    insert into rel_cruzamentos (rodada, tabela, registro_id, campo, antes, depois, fonte)
    select v_rodada, tabela, registro_id, 'cliente_id', null, cliente_id::text, fonte from _lig;
    update rel_wa_conversas x set cliente_id = l.cliente_id from _lig l where l.tabela = 'rel_wa_conversas' and l.registro_id = x.id and x.cliente_id is null;
    update fin_atendimentos x set cliente_id = l.cliente_id from _lig l where l.tabela = 'fin_atendimentos' and l.registro_id = x.id and x.cliente_id is null;
    update rel_chamados x set cliente_id = l.cliente_id from _lig l where l.tabela = 'rel_chamados' and l.registro_id = x.id and x.cliente_id is null;
    update rel_viagens x set cliente_id = l.cliente_id from _lig l where l.tabela = 'rel_viagens' and l.registro_id = x.id and x.cliente_id is null;
  end if;

  drop table if exists _prop; drop table if exists _ok; drop table if exists _lig;
  return v_res;
end $$;

-- Desfaz uma rodada: só volta o que ainda está igual ao que o cruzamento pôs.
create or replace function public.rel_desfazer_cruzamento(p_rodada uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; k int;
begin
  if auth.uid() is not null and not (rel_tem_acesso() and qs_pode('relacionamento.juntar_clientes')) then
    raise exception 'Só quem pode juntar fichas desfaz um cruzamento.';
  end if;
  for r in select * from rel_cruzamentos where rodada = p_rodada and desfeito_em is null loop
    execute format('update %I set %I = null where id = $1 and %I::text = $2', r.tabela, r.campo, r.campo)
      using r.registro_id, r.depois;
    get diagnostics k = row_count;
    n := n + k;
    update rel_cruzamentos set desfeito_em = now() where id = r.id;
  end loop;
  return n;
end $$;

-- ── 2) A fila do time ───────────────────────────────────────────────────────

create or replace function public.rel_fila_cadastros()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;

  with vivos as (
    select c.*, rel_nome_chave(c.nome) nk from rel_clientes c where c.mesclado_em_id is null and c.arquivado_em is null
  ),
  -- Mesmo primeiro + último nome e um dos dois SEM telefone (fichas vindas do
  -- sistema de Expedições que não acharam o contato do Bitrix).
  parecidos as (
    select a.id a_id, a.nome a_nome, b.id b_id, b.nome b_nome, array['mesmo nome e sobrenome', 'uma das fichas sem telefone'] motivos
      from vivos a join vivos b on a.id < b.id
     where split_part(a.nk, ' ', 1) = split_part(b.nk, ' ', 1)
       and regexp_replace(a.nk, '^.* ', '') = regexp_replace(b.nk, '^.* ', '')
       and a.nk like '% %' and b.nk like '% %'
       and (a.telefone is null or b.telefone is null)
       and not (a.cpf is not null and b.cpf is not null and a.cpf <> b.cpf)
       and not coalesce(a.titular_id = b.id or b.titular_id = a.id or a.titular_id = b.titular_id, false)
       and not exists (select 1 from rel_nao_duplicados n where n.a = a.id and n.b = b.id)
       and not exists (select 1 from rel_duplicados_sugeridos d where d.a_id = a.id and d.b_id = b.id)
  ),
  cpf_div as (
    select distinct on (c.id) c.id, c.nome, c.cpf, regexp_replace(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]', '\D', '', 'g') cpf_venda,
           v.id viagem_id, v.titulo
      from vivos c join rel_viagens v on v.cliente_id = c.id and v.mesclada_em_id is null
     where c.cpf is not null and rel_cpf_valido(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]')
       and regexp_replace(v.bitrix_dados->>'CPF do cliente [UF_CRM_1762288761917]', '\D', '', 'g') <> c.cpf
     order by c.id, v.data_venda desc nulls last
  ),
  viagens as (
    select v.id, v.titulo, v.destino, v.data_embarque, v.data_venda, v.valor, v.bitrix_deal_id, v.status,
           (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome)), '[]'::jsonb)
              from rel_viagem_passageiros p join vivos c on c.id = p.cliente_id where p.viagem_id = v.id) sugestoes
      from rel_viagens v where v.cliente_id is null and v.mesclada_em_id is null
  ),
  conversas as (
    select w.id, w.telefone, w.nome_contato, w.setor, w.atualizado_em, w.ultima_mensagem,
           (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome)), '[]'::jsonb) from (
              select c.id, c.nome from vivos c where w.nome_contato is not null and length(rel_nome_chave(w.nome_contato)) >= 5
                 and (c.nk = rel_nome_chave(w.nome_contato)
                      or (rel_nome_chave(w.nome_contato) like '% %' and split_part(c.nk, ' ', 1) = split_part(rel_nome_chave(w.nome_contato), ' ', 1)
                          and regexp_replace(c.nk, '^.* ', '') = regexp_replace(rel_nome_chave(w.nome_contato), '^.* ', '')))
               limit 5) c) sugestoes
      from rel_wa_conversas w where w.cliente_id is null
  ),
  fin as (
    select f.id, f.numero, f.nome, f.telefone, f.motivo, f.status, f.criado_em
      from fin_atendimentos f where f.cliente_id is null
  ),
  embarques as (
    select c.id, min(v.data_embarque) prox
      from vivos c
      join rel_viagens v on v.mesclada_em_id is null and v.status = 'ativa' and v.data_embarque >= current_date
       and (v.cliente_id = c.id or exists (select 1 from rel_viagem_passageiros p where p.viagem_id = v.id and p.cliente_id = c.id))
     group by c.id
  ),
  incompletos as (
    select c.id, c.nome, e.prox proximo_embarque,
           array_remove(array[
             case when c.telefone is null then 'telefone' end,
             case when c.cpf is null then 'cpf' end,
             case when c.nascimento is null then 'nascimento' end,
             case when c.email is null then 'email' end,
             case when c.passaporte is null then 'passaporte' end,
             case when c.passaporte is not null and c.passaporte_validade is null then 'passaporte_validade' end], null) faltando
      from vivos c left join embarques e on e.id = c.id
     where c.telefone is null or c.cpf is null or c.nascimento is null or c.email is null or c.passaporte is null
        or (c.passaporte is not null and c.passaporte_validade is null)
  )
  select jsonb_build_object(
    'parecidos', (select coalesce(jsonb_agg(to_jsonb(p) order by p.a_nome), '[]'::jsonb) from parecidos p),
    'cpf_divergente', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nome), '[]'::jsonb) from cpf_div x),
    'viagens', (select coalesce(jsonb_agg(to_jsonb(x) order by x.data_embarque nulls last), '[]'::jsonb) from viagens x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizado_em desc), '[]'::jsonb) from conversas x),
    'financeiro', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from fin x),
    'incompletos_total', (select count(*) from incompletos),
    'incompletos_viajando', (select count(*) from incompletos where proximo_embarque is not null),
    'incompletos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.proximo_embarque nulls last, cardinality(x.faltando) desc, x.nome), '[]'::jsonb)
                      from (select * from incompletos order by proximo_embarque nulls last, cardinality(faltando) desc, nome limit 300) x),
    'ultima_rodada', (select jsonb_build_object('rodada', rodada, 'em', max(em), 'mudancas', count(*))
                        from rel_cruzamentos where fonte <> 'manual' and desfeito_em is null
                       group by rodada order by max(em) desc limit 1)
  ) into v;
  return v;
end $$;

-- ── 3) O time liga a ficha à mão ────────────────────────────────────────────

create or replace function public.rel_vincular_cadastro(p_tipo text, p_id uuid, p_cliente uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tab text; k int;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  v_tab := case p_tipo when 'conversa' then 'rel_wa_conversas' when 'viagem' then 'rel_viagens'
                       when 'financeiro' then 'fin_atendimentos' when 'chamado' then 'rel_chamados' end;
  if v_tab is null then raise exception 'Tipo desconhecido: %', p_tipo; end if;
  if not exists (select 1 from rel_clientes where id = p_cliente and mesclado_em_id is null and arquivado_em is null) then
    raise exception 'Essa ficha não está ativa (foi juntada ou arquivada).';
  end if;
  execute format('update %I set cliente_id = $1 where id = $2 and cliente_id is null', v_tab) using p_cliente, p_id;
  get diagnostics k = row_count;
  if k = 0 then raise exception 'Esse item já tem cliente (alguém ligou antes). Recarregue a fila.'; end if;
  insert into rel_cruzamentos (rodada, tabela, registro_id, campo, antes, depois, fonte)
  values (gen_random_uuid(), v_tab, p_id, 'cliente_id', null, p_cliente::text, 'manual');
end $$;

-- ── 4) O que a ficha não enxergava ──────────────────────────────────────────

create or replace function public.rel_ligacoes_do_cliente(p_cliente uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c rel_clientes; v jsonb;
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.'; end if;
  select * into c from rel_clientes where id = p_cliente;
  if not found then return null; end if;

  select jsonb_build_object(
    -- Lead que virou este cliente: pela venda (mesmo negócio do Bitrix), pelo
    -- telefone (chave do 9º dígito) ou pelo e-mail. O mais antigo primeiro.
    'leads', (select coalesce(jsonb_agg(x order by x->>'criado_em'), '[]'::jsonb) from (
       select distinct on (l.id) jsonb_build_object('id', l.id, 'nome', coalesce(nullif(l.full_name, ''), btrim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''))),
              'status', l.status, 'fonte', l.source, 'criado_em', coalesce(l.arrived_at, l.created_at), 'fechado_em', l.closed_at,
              'dono', (select u.name from qs_users u where u.id = l.owner_id),
              'por', case when exists (select 1 from rel_viagens v where v.cliente_id = c.id and v.bitrix_deal_id = l.bitrix_id) then 'venda'
                          when rel_fone_chave(l.phone) = rel_fone_chave(c.telefone) then 'telefone' else 'e-mail' end) x
         from qs_leads l
        where (l.bitrix_id is not null and exists (select 1 from rel_viagens v where v.cliente_id = c.id and v.bitrix_deal_id = l.bitrix_id))
           or (c.telefone is not null and rel_fone_chave(l.phone) = rel_fone_chave(c.telefone))
           or (c.email is not null and lower(l.email) = c.email)
        limit 10) t),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object('jid', g.jid, 'nome', g.nome, 'ultima_msg_em', g.ultima_msg_em) order by g.ultima_msg_em desc nulls last), '[]'::jsonb)
                 from rel_wa_grupos g
                where g.saiu_em is null and c.telefone is not null
                  and exists (select 1 from rel_wa_grupo_participantes p where p.grupo_jid = g.jid and rel_fone_chave(p.telefone) = rel_fone_chave(c.telefone))),
    'financeiro', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'numero', f.numero, 'motivo', f.motivo, 'status', f.status, 'criado_em', f.criado_em) order by f.criado_em desc), '[]'::jsonb)
                     from fin_atendimentos f where f.cliente_id = c.id),
    'passageiro_em', (select count(*) from rel_viagem_passageiros p join rel_viagens v on v.id = p.viagem_id
                       where p.cliente_id = c.id and v.mesclada_em_id is null and v.cliente_id is distinct from c.id),
    'comprador_em', (select count(*) from rel_viagens v where v.cliente_id = c.id and v.mesclada_em_id is null),
    'conversas', (select count(*) from rel_wa_conversas w where w.cliente_id = c.id),
    'cruzamentos', (select coalesce(jsonb_agg(jsonb_build_object('campo', x.campo, 'fonte', x.fonte, 'em', x.em) order by x.em desc), '[]'::jsonb)
                      from rel_cruzamentos x where x.tabela = 'rel_clientes' and x.registro_id = c.id and x.desfeito_em is null)
  ) into v;
  return v;
end $$;

revoke all on function public.rel_cruzar_base(boolean) from public, anon;
revoke all on function public.rel_desfazer_cruzamento(uuid) from public, anon;
revoke all on function public.rel_fila_cadastros() from public, anon;
revoke all on function public.rel_vincular_cadastro(text, uuid, uuid) from public, anon;
revoke all on function public.rel_ligacoes_do_cliente(uuid) from public, anon;
grant execute on function public.rel_cruzar_base(boolean) to authenticated, service_role;
grant execute on function public.rel_desfazer_cruzamento(uuid) to authenticated, service_role;
grant execute on function public.rel_fila_cadastros() to authenticated;
grant execute on function public.rel_vincular_cadastro(text, uuid, uuid) to authenticated;
grant execute on function public.rel_ligacoes_do_cliente(uuid) to authenticated;
grant execute on function public.rel_cpf_valido(text) to authenticated;
