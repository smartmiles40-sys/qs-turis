-- 0376_ponte_lead_ficha.sql
-- -----------------------------------------------------------------------------
-- PONTE PESSOA (1/4): O LEAD SE LIGA SOZINHO À FICHA ÚNICA (13/11/2026).
--
-- POR QUÊ
--   rel_clientes é a ficha única da pessoa. passageiros e qs_venda_pessoas já
--   apontam pra ela por cliente_id, mas qs_leads.cliente_id (coluna da 0213)
--   estava preenchido em 1 de 5.956 leads: só ligava por clique
--   (CadastroDoLead) ou por cad_pessoa_do_lead. Sem essa ligação nenhum outro
--   setor consegue "ver a pessoa" a partir do lead, nem o lead a partir da ficha.
--
-- O QUE FAZ
--   1. cad_ficha_unica_contato(telefone, email) → a ficha viva (não mesclada,
--      não arquivada) que casa com o telefone (rel_fone_chave: com/sem 55, com/
--      sem 9º dígito) OU com o e-mail (sem diferença de caixa) — SÓ quando é
--      exatamente UMA. Duas ou mais = ambíguo = devolve null (não liga).
--      Ambíguo NÃO vai pra cad_divergencias: a fila de "Arrumar cadastros"
--      exige passageiro_id (NOT NULL, é divergência ficha × expedição), não
--      cabe lead ali. Ambíguo continua no clique (CadastroDoLead).
--   2. Gatilho BEFORE em qs_leads (insert; update de phone/email com
--      cliente_id nulo): preenche cliente_id. Desligar à mão (cliente_id → null
--      sem mexer em telefone/e-mail) é respeitado: não religa.
--   3. Gatilho AFTER em rel_clientes (ficha nasce, muda telefone/e-mail ou sai
--      do arquivo): liga os leads SEM cliente_id que agora têm ficha única.
--      Ficha mesclada: os leads dela passam pra ficha que ficou
--      (rel_juntar_repontar não cobria qs_leads).
--   4. "Ponte" (qs.ponte = on, local à transação): quando a ficha liga leads,
--      o update em qs_leads (a) não mexe em updated_at (dashboards e "parado
--      há X dias" usam), e (b) não é barrado por qs_bloqueia_espectador quando
--      quem salvou a ficha é do Relacionamento/Ops — desde que a ÚNICA coisa
--      que mude no lead seja cliente_id / opt-out de WhatsApp. Sem a ponte,
--      tudo continua exatamente como era.
--
-- FRONT: nada depende disto. Com ou sem a migration as telas funcionam (o
--   CadastroDoLead continua ligando por clique).
--
-- BACKFILL: não roda aqui. Ver scripts/ponte/backfill_lead_cliente.sql
--   (simulação em 13/11: 190 leads ligariam em 130 fichas; 13 ambíguos).
--
-- COMO CONFERIR
--   select cad_ficha_unica_contato('11 91234-5678', null);          -- uuid ou null
--   select tgname from pg_trigger where tgname in ('trg_qs_leads_zz_ponte','trg_rel_clientes_ponte_leads');
--   -- lead novo com telefone de uma ficha única nasce ligado:
--   select id, cliente_id from qs_leads order by created_at desc limit 5;
--
-- COMO VOLTAR
--   drop trigger if exists trg_qs_leads_zz_ponte on qs_leads;
--   drop trigger if exists trg_rel_clientes_ponte_leads on rel_clientes;
--   drop function if exists cad_trg_lead_ficha(); drop function if exists cad_trg_ficha_leads();
--   drop function if exists cad_ficha_unica_contato(text, text);
--   -- qs_bloqueia_espectador: o bloco "PONTE" no topo é inerte sem qs.ponte=on;
--   -- pra tirar, recrie a função sem ele (versão anterior = 0126/0036).
--   drop index if exists qs_leads_email_norm_idx;
-- Idempotente.
-- -----------------------------------------------------------------------------

-- Índice pra achar lead por e-mail (o de telefone já existe: qs_leads_tel_chave_idx).
create index if not exists qs_leads_email_norm_idx
  on public.qs_leads (lower(btrim(email)))
  where email is not null;

-- ── (1) A ficha única de um telefone/e-mail ─────────────────────────────────
create or replace function public.cad_ficha_unica_contato(p_telefone text, p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with k as (
    select case when length(rel_fone_chave(p_telefone)) >= 10 then rel_fone_chave(p_telefone) end as fone,
           cad_email(p_email) as mail
  ), cand as (
    select c.id from rel_clientes c, k
     where k.fone is not null and c.mesclado_em_id is null and c.arquivado_em is null
       and rel_fone_chave(c.telefone) = k.fone
    union
    select c.id from rel_clientes c, k
     where k.mail is not null and c.mesclado_em_id is null and c.arquivado_em is null
       and c.email = k.mail
  )
  select case when count(*) = 1 then min(id::text)::uuid end from cand;
$fn$;

comment on function public.cad_ficha_unica_contato(text, text) is
  'Ficha viva (rel_clientes) que casa com o telefone (rel_fone_chave) OU e-mail — só se for exatamente uma; senão null. (0376)';

revoke all on function public.cad_ficha_unica_contato(text, text) from public, anon, authenticated;

-- ── (2) Ponte: o espectador deixa passar SÓ a ligação/opt-out vindos da ponte ─
-- Mesma função da 0036/0126 (vigente em 13/11), com um bloco no topo.
create or replace function public.qs_bloqueia_espectador()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  papel text;
  areas text[];
begin
  -- PONTE (0376): ficha/opt-out propagados por gatilho. Só em qs_leads, só
  -- UPDATE, só com qs.ponte=on (não dá pra ligar pelo PostgREST) e só se o
  -- que muda é cliente_id / opt-out de WhatsApp.
  if tg_table_name = 'qs_leads' and tg_op = 'UPDATE'
     and coalesce(current_setting('qs.ponte', true), '') = 'on'
     and (to_jsonb(new) - array['cliente_id', 'optout_whatsapp_em', 'optout_whatsapp_texto', 'updated_at'])
       = (to_jsonb(old) - array['cliente_id', 'optout_whatsapp_em', 'optout_whatsapp_texto', 'updated_at']) then
    return new;
  end if;

  select role, setores into papel, areas from qs_users where id = auth.uid() and is_active;
  if papel = 'marketing' then
    raise exception 'Perfil Marketing é somente leitura: esta ação não é permitida.'
      using errcode = '42501';
  end if;
  if papel in ('relacionamento', 'financeiro', 'operacional')
     or (papel = 'gestor' and not ('comercial' = any(coalesce(areas, '{}')))) then
    raise exception 'Perfil de outra área (Relacionamento, Financeiro ou Operações) não altera dados do Comercial.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- ── (3) Lado do lead ────────────────────────────────────────────────────────
-- Roda DEPOIS de trg_qs_leads_updated (ordem alfabética: "zz"), por isso
-- consegue devolver o updated_at antigo quando o update veio da ponte.
create or replace function public.cad_trg_lead_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('qs.ponte', true), '') = 'on' then
    new.updated_at := old.updated_at;
  end if;
  if new.cliente_id is null
     and (tg_op = 'INSERT' or new.phone is distinct from old.phone or new.email is distinct from old.email) then
    begin
      new.cliente_id := cad_ficha_unica_contato(new.phone, new.email);
    exception when others then
      raise warning 'ponte lead→ficha: lead % não ligou: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $fn$;

drop trigger if exists trg_qs_leads_zz_ponte on public.qs_leads;
create trigger trg_qs_leads_zz_ponte
  before insert or update of phone, email, cliente_id, optout_whatsapp_em, optout_whatsapp_texto
  on public.qs_leads
  for each row execute function public.cad_trg_lead_ficha();

-- ── (4) Lado da ficha ───────────────────────────────────────────────────────
create or replace function public.cad_trg_ficha_leads()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare antes text := current_setting('qs.ponte', true); k text;
begin
  begin
    perform set_config('qs.ponte', 'on', true);
    if new.mesclado_em_id is not null then
      if tg_op = 'UPDATE' and old.mesclado_em_id is null then
        update qs_leads set cliente_id = cad_ficha_viva(new.mesclado_em_id) where cliente_id = new.id;
      end if;
    elsif new.arquivado_em is null
      and (tg_op = 'INSERT'
           or new.telefone is distinct from old.telefone
           or new.email is distinct from old.email
           or old.arquivado_em is not null) then
      k := case when length(rel_fone_chave(new.telefone)) >= 10 then rel_fone_chave(new.telefone) end;
      update qs_leads l set cliente_id = x.f
        from (select l2.id, cad_ficha_unica_contato(l2.phone, l2.email) as f
                from qs_leads l2
               where l2.cliente_id is null
                 and ((k is not null and l2.phone is not null
                       and qs_tel_chave(l2.phone) = qs_tel_chave(new.telefone)
                       and rel_fone_chave(l2.phone) = k)
                   or (new.email is not null and l2.email is not null
                       and lower(btrim(l2.email)) = new.email))) x
       where l.id = x.id and x.f is not null and l.cliente_id is null;
    end if;
    perform set_config('qs.ponte', coalesce(antes, ''), true);
  exception when others then
    raise warning 'ponte ficha→leads: ficha % não ligou leads: %', new.id, sqlerrm;
  end;
  return null;
end $fn$;

drop trigger if exists trg_rel_clientes_ponte_leads on public.rel_clientes;
create trigger trg_rel_clientes_ponte_leads
  after insert or update of telefone, email, mesclado_em_id, arquivado_em
  on public.rel_clientes
  for each row execute function public.cad_trg_ficha_leads();
