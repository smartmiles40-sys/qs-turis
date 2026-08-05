-- DIAGNOSTICO-RLS-LEADS.sql
-- ---------------------------------------------------------------------------
-- UMA consulta só, de propósito: o SQL Editor do Supabase mostra apenas o
-- resultado da ÚLTIMA instrução, então duas consultas separadas escondem a
-- primeira — foi o que aconteceu na primeira tentativa.
--
-- O que procurar: qualquer linha com tipo = "*** RESTRICTIVE ***". Policies
-- permissivas se somam com OR (uma liberando já basta); as restritivas se
-- somam com AND — uma sozinha barra tudo, mesmo com as outras liberando.
-- ---------------------------------------------------------------------------

select 'POLICY'                                                              as objeto,
       pol.polname                                                           as nome,
       case pol.polpermissive when true then 'permissiva' else '*** RESTRICTIVE ***' end as tipo,
       case pol.polcmd when 'r' then 'select' when 'a' then 'insert'
            when 'w' then 'update' when 'd' then 'delete' else 'ALL' end     as comando,
       coalesce(pg_get_expr(pol.polqual,      pol.polrelid), '—')            as usando,
       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '—')            as checando
  from pg_policy pol
 where pol.polrelid = 'qs_leads'::regclass

union all

select 'TRIGGER',
       tgname,
       '—',
       '—',
       pg_get_triggerdef(oid),
       '—'
  from pg_trigger
 where tgrelid = 'qs_leads'::regclass
   and not tgisinternal

order by 1 desc, 3, 2;
