-- Cole no SQL Editor. Mostra TODAS as policies de qs_leads (inclusive as
-- restritivas, que se somam com AND) e os gatilhos da tabela.
select pol.polname                                                          as policy,
       case pol.polpermissive when true then 'permissiva' else 'RESTRICTIVE' end as tipo,
       case pol.polcmd when 'r' then 'select' when 'a' then 'insert'
            when 'w' then 'update' when 'd' then 'delete' else 'ALL' end     as comando,
       pg_get_expr(pol.polqual,      pol.polrelid)                           as usando,
       pg_get_expr(pol.polwithcheck, pol.polrelid)                           as checando
  from pg_policy pol
 where pol.polrelid = 'qs_leads'::regclass
 order by pol.polpermissive, pol.polname;

select tgname as gatilho, pg_get_triggerdef(oid) as definicao
  from pg_trigger
 where tgrelid = 'qs_leads'::regclass and not tgisinternal;
