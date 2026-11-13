-- supabase/migrations/0393_rel_pessoa_bitrix_atualizar.sql
-- -----------------------------------------------------------------------------
-- PONTE PEDIDOS (4/5): FICHA MUDOU → O CONTATO DO BITRIX ACOMPANHA (13/11/2026).
--
-- POR QUÊ
--   A fila da 0366 (rel_clientes_bitrix) só cuidava de quem NÃO tem contato:
--   a rotina (api/_relPessoaBitrix.js) faz contact.list/contact.add e pronto.
--   Mudar telefone, e-mail ou nome numa ficha que já tem contato nunca chegava
--   ao Bitrix — e a diretriz é "Bitrix = banco de dados".
--   (Também medido em 13/11: 134 pendentes, 0 resolvidos, 0 tentativas — o
--   interruptor REL_PESSOA_BITRIX_LIGADO está desligado na Vercel.)
--
-- O QUE FAZ
--   1. rel_clientes_bitrix ganha o status 'atualizar' e a coluna campos (text[]:
--      'nome' | 'telefone' | 'email' que mudaram e ainda não foram pro Bitrix).
--   2. O gatilho da 0366 (rel_clientes_pendencia_bitrix) passa a, numa ficha que
--      JÁ TEM contato (e o contato não mudou), marcar 'atualizar' somando os
--      campos que mudaram. Tudo o mais é igual à 0366 (criação, mesclada etc.).
--      Se a linha já estava 'atualizar', junta os campos (não perde nada).
--   3. A rotina manda crm.contact.update só com o que difere do Bitrix, nunca
--      com valor vazio (ver api/_relPessoaBitrix.js → planejarAtualizacao) e
--      volta a linha pra 'ok'. Falha: continua 'atualizar' com o erro e tenta
--      de novo depois de 1 h (até 24 vezes; depois só "Enviar agora").
--   O alerta da gestão (pessoas_sem_bitrix) continua contando só quem está sem
--   contato (pendente/falhou/sem_dados) — 'atualizar' não entra.
--
-- PRA FUNCIONAR EM PRODUÇÃO: REL_PESSOA_BITRIX_LIGADO=1 na Vercel. Antes,
--   simule: GET /api/rel-bitrix-comentarios?acao=pessoas-conferir (CRON_SECRET).
--
-- COMO CONFERIR
--   select status, count(*) from rel_clientes_bitrix group by 1;
--   -- mude o telefone de uma ficha com bitrix_contato_id e:
--   select status, campos from rel_clientes_bitrix where cliente_id = '<id>';  -- atualizar {telefone}
--
-- COMO VOLTAR
--   Recriar rel_clientes_pendencia_bitrix() da 0366 (copiar a função de lá);
--   update rel_clientes_bitrix set status = 'ok', campos = null where status = 'atualizar';
--   alter table rel_clientes_bitrix drop constraint rel_clientes_bitrix_status_check;
--   alter table rel_clientes_bitrix add constraint rel_clientes_bitrix_status_check
--     check (status in ('pendente', 'ok', 'falhou', 'sem_dados'));
--   alter table rel_clientes_bitrix drop column if exists campos;
-- Idempotente.
-- -----------------------------------------------------------------------------

alter table public.rel_clientes_bitrix add column if not exists campos text[];
comment on column public.rel_clientes_bitrix.campos is
  '0393: com status atualizar — o que mudou na ficha (nome/telefone/email) e ainda não foi pro contato do Bitrix.';

alter table public.rel_clientes_bitrix drop constraint if exists rel_clientes_bitrix_status_check;
alter table public.rel_clientes_bitrix add constraint rel_clientes_bitrix_status_check
  check (status in ('pendente', 'ok', 'falhou', 'sem_dados', 'atualizar'));

create or replace function public.rel_clientes_pendencia_bitrix()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tem_contato boolean := nullif(trim(coalesce(new.bitrix_contato_id, '')), '') is not null;
  mudou text[] := '{}';
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

  -- 0393: já tem contato (o mesmo de antes) e mudou nome/telefone/e-mail → atualizar.
  if tem_contato and tg_op = 'UPDATE' and new.bitrix_contato_id is not distinct from old.bitrix_contato_id then
    if new.nome is distinct from old.nome and nullif(trim(coalesce(new.nome, '')), '') is not null then mudou := mudou || 'nome'; end if;
    if new.telefone is distinct from old.telefone and nullif(trim(coalesce(new.telefone, '')), '') is not null then mudou := mudou || 'telefone'; end if;
    if new.email is distinct from old.email and nullif(trim(coalesce(new.email, '')), '') is not null then mudou := mudou || 'email'; end if;
    if cardinality(mudou) = 0 then
      -- só o CPF mudou, ou o campo foi apagado (apagar não vai pro Bitrix): nada a fazer
      return null;
    end if;
    insert into rel_clientes_bitrix (cliente_id, status, erro, tentativas, pendente_em, contato_id, campos, atualizado_em)
    values (new.id, 'atualizar', null, 0, now(), new.bitrix_contato_id, mudou, now())
    on conflict (cliente_id) do update
      set status = 'atualizar', erro = null, tentativas = 0,
          campos = (select array_agg(distinct x order by x)
                      from unnest(case when rel_clientes_bitrix.status = 'atualizar' then coalesce(rel_clientes_bitrix.campos, '{}') else '{}' end || excluded.campos) x),
          pendente_em = case when rel_clientes_bitrix.status = 'atualizar' and rel_clientes_bitrix.pendente_em is not null
                             then rel_clientes_bitrix.pendente_em else now() end,
          contato_id = excluded.contato_id, atualizado_em = now();
    return null;
  end if;

  if tem_contato then
    insert into rel_clientes_bitrix (cliente_id, status, erro, pendente_em, contato_id, campos, atualizado_em)
    values (new.id, 'ok', null, null, new.bitrix_contato_id, null, now())
    on conflict (cliente_id) do update
      set status = 'ok', erro = null, pendente_em = null, campos = null,
          contato_id = excluded.contato_id, atualizado_em = now();
    return null;
  end if;

  insert into rel_clientes_bitrix (cliente_id, status, erro, tentativas, pendente_em, atualizado_em)
  values (new.id, 'pendente', null, 0, now(), now())
  on conflict (cliente_id) do update
    set status = 'pendente', erro = null, tentativas = 0, campos = null,
        -- já esperava (pendente/falhou/sem_dados) → mantém o "desde".
        pendente_em = case when rel_clientes_bitrix.status in ('ok', 'atualizar') or rel_clientes_bitrix.pendente_em is null
                           then now() else rel_clientes_bitrix.pendente_em end,
        atualizado_em = now();
  return null;
exception when others then
  -- A fila nunca pode impedir de salvar a ficha.
  raise warning '[0366/0393] fila do Bitrix não atualizada (pessoa %): %', new.id, sqlerrm;
  return null;
end $$;
-- O gatilho (trg_rel_clientes_pendencia_bitrix, da 0366) continua o mesmo: só a função mudou.
