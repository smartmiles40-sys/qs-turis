-- supabase/migrations/0366_rel_pessoa_contato_bitrix.sql
-- -----------------------------------------------------------------------------
-- TODA PESSOA DO QS COM CONTATO NO BITRIX — a FILA (revisão 12/11/2026).
--
-- Medido em 12/11: 134 pessoas de rel_clientes (todas criadas desde 13/10) sem
-- bitrix_contato_id — nenhum caminho do QS criava o contato. A rotina que
-- procura/cria mora em api/_relPessoaBitrix.js (chamada pelo cron de
-- api/rel-bitrix-comentarios.js, com o interruptor REL_PESSOA_BITRIX_LIGADO).
--
-- rel_clientes_bitrix: UMA linha por pessoa que precisa (ou precisou) de contato.
--   status: pendente | ok | falhou | sem_dados
--   erro, tentativas, tentativa_em, pendente_em (desde quando espera),
--   resultado (criado | vinculado_cpf | vinculado_telefone | vinculado_email), contato_id.
-- Fica FORA de rel_clientes de propósito: cada tentativa gravada na ficha viraria
-- uma linha em rel_auditoria (trg_rel_clientes_audita) e mexeria no atualizado_em.
--
-- Gatilho em rel_clientes (depois do normaliza, que arruma telefone/CPF/e-mail):
--   • tem bitrix_contato_id → 'ok';
--   • mesclada/arquivada → sai da fila;
--   • nasceu sem contato, ou mudou nome/telefone/e-mail/CPF ainda sem contato,
--     ou perdeu o contato → 'pendente' (zera as tentativas).
-- Leitura: quem lê a ficha lê a linha (RLS pela própria rel_clientes). Escrita:
-- só o servidor (service_role) e o gatilho.
--
-- Carga inicial: as pessoas vivas sem contato entram como 'pendente' (INSERT só
-- na fila — não toca rel_clientes, não gera auditoria).
-- Idempotente. Volta: drop trigger trg_rel_clientes_pendencia_bitrix on rel_clientes;
-- drop function rel_clientes_pendencia_bitrix(); drop table rel_clientes_bitrix.
-- -----------------------------------------------------------------------------

create table if not exists public.rel_clientes_bitrix (
  cliente_id   uuid primary key references public.rel_clientes(id) on delete cascade,
  status       text not null default 'pendente' check (status in ('pendente', 'ok', 'falhou', 'sem_dados')),
  erro         text,
  tentativas   int not null default 0,
  tentativa_em timestamptz,
  pendente_em  timestamptz default now(),
  resultado    text,
  contato_id   text,
  atualizado_em timestamptz not null default now()
);
create index if not exists rel_clientes_bitrix_fila on public.rel_clientes_bitrix (status, pendente_em);

comment on table public.rel_clientes_bitrix is
  '0366: fila "pessoa → contato no Bitrix" (api/_relPessoaBitrix.js). Uma linha por pessoa; status pendente/ok/falhou/sem_dados.';

alter table public.rel_clientes_bitrix enable row level security;
drop policy if exists rel_clientes_bitrix_ler on public.rel_clientes_bitrix;
create policy rel_clientes_bitrix_ler on public.rel_clientes_bitrix
  for select to authenticated
  using (exists (select 1 from public.rel_clientes c where c.id = cliente_id));
revoke insert, update, delete on public.rel_clientes_bitrix from anon, authenticated;
grant select on public.rel_clientes_bitrix to authenticated;

create or replace function public.rel_clientes_pendencia_bitrix()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tem_contato boolean := nullif(trim(coalesce(new.bitrix_contato_id, '')), '') is not null;
begin
  if tg_op = 'UPDATE'
     and new.bitrix_contato_id is not distinct from old.bitrix_contato_id
     and new.nome is not distinct from old.nome
     and new.telefone is not distinct from old.telefone
     and new.email is not distinct from old.email
     and new.cpf is not distinct from old.cpf
     and new.mesclado_em_id is not distinct from old.mesclado_em_id
     and new.arquivado_em is not distinct from old.arquivado_em then
    return null;
  end if;

  if new.mesclado_em_id is not null or new.arquivado_em is not null then
    delete from rel_clientes_bitrix where cliente_id = new.id and status <> 'ok';
    return null;
  end if;

  if tem_contato then
    insert into rel_clientes_bitrix (cliente_id, status, erro, pendente_em, contato_id, atualizado_em)
    values (new.id, 'ok', null, null, new.bitrix_contato_id, now())
    on conflict (cliente_id) do update
      set status = 'ok', erro = null, pendente_em = null,
          contato_id = excluded.contato_id, atualizado_em = now();
    return null;
  end if;

  insert into rel_clientes_bitrix (cliente_id, status, erro, tentativas, pendente_em, atualizado_em)
  values (new.id, 'pendente', null, 0, now(), now())
  on conflict (cliente_id) do update
    set status = 'pendente', erro = null, tentativas = 0,
        -- já esperava (pendente/falhou/sem_dados) → mantém o "desde".
        pendente_em = case when rel_clientes_bitrix.status = 'ok' or rel_clientes_bitrix.pendente_em is null
                           then now() else rel_clientes_bitrix.pendente_em end,
        atualizado_em = now();
  return null;
exception when others then
  -- A fila nunca pode impedir de salvar a ficha.
  raise warning '[0366] fila do Bitrix não atualizada (pessoa %): %', new.id, sqlerrm;
  return null;
end $$;

-- AFTER (o normaliza é BEFORE): vê telefone/CPF/e-mail já arrumados.
drop trigger if exists trg_rel_clientes_pendencia_bitrix on public.rel_clientes;
create trigger trg_rel_clientes_pendencia_bitrix
  after insert or update of nome, telefone, email, cpf, bitrix_contato_id, mesclado_em_id, arquivado_em
  on public.rel_clientes
  for each row execute function public.rel_clientes_pendencia_bitrix();

-- Carga inicial: quem está vivo e sem contato entra na fila (não mexe em rel_clientes).
insert into public.rel_clientes_bitrix (cliente_id, status, pendente_em)
select c.id, 'pendente', c.criado_em
  from public.rel_clientes c
 where nullif(trim(coalesce(c.bitrix_contato_id, '')), '') is null
   and c.mesclado_em_id is null and c.arquivado_em is null
on conflict (cliente_id) do nothing;
