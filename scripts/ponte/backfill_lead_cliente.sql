-- scripts/ponte/backfill_lead_cliente.sql
-- -----------------------------------------------------------------------------
-- BACKFILL DA PONTE PESSOA (depois das migrations 0376–0379).
--
-- NÃO roda sozinho. Ordem:
--   1. Rode o bloco 1 (SIMULAÇÃO, só SELECT) e confira os números.
--   2. Se estiver ok, rode o bloco 2 (UPDATE) — está comentado de propósito.
--   3. Blocos 3 e 4 são opcionais (conversas do Rel e opt-out atrasado).
--
-- Regra = a mesma do gatilho da 0376 (cad_ficha_unica_contato): o lead SEM
-- cliente_id é ligado à ficha viva (não mesclada, não arquivada) que casa pelo
-- telefone (rel_fone_chave) OU e-mail — só se for exatamente UMA ficha.
--
-- Simulação feita em 13/11/2026 (antes das migrations):
--   5.956 leads · 1 já ligado · 190 ligariam (130 fichas; máx. 7 leads numa
--   ficha) · 13 ambíguos (não ligam) · 67 só por telefone, 5 só por e-mail,
--   118 pelos dois.
-- -----------------------------------------------------------------------------

-- ── 1. SIMULAÇÃO (só leitura) ───────────────────────────────────────────────
-- Funciona antes OU depois das migrations (não usa função nova).
with f as materialized (
  select id, rel_fone_chave(telefone) k, lower(email) e
    from rel_clientes
   where mesclado_em_id is null and arquivado_em is null
), l as materialized (
  select id,
         case when length(rel_fone_chave(phone)) >= 10 then rel_fone_chave(phone) end k,
         cad_email(email) e
    from qs_leads
   where cliente_id is null
), c as (
  select l.id lead_id, f.id ficha_id, 'tel' por from l join f on f.k = l.k where l.k is not null
  union all
  select l.id, f.id, 'mail' from l join f on f.e = l.e where l.e is not null
), g as (
  select lead_id, count(distinct ficha_id) n, min(ficha_id::text)::uuid ficha_id,
         bool_or(por = 'tel') t, bool_or(por = 'mail') m
    from c group by lead_id
)
select
  (select count(*) from qs_leads)                              as leads_total,
  (select count(*) from qs_leads where cliente_id is not null) as ja_ligados,
  count(*) filter (where n = 1)                                as ligaria,
  count(*) filter (where n > 1)                                as ambiguos,
  count(distinct ficha_id) filter (where n = 1)                as fichas_distintas,
  count(*) filter (where n = 1 and t and not m)                as so_telefone,
  count(*) filter (where n = 1 and m and not t)                as so_email,
  count(*) filter (where n = 1 and t and m)                    as telefone_e_email
from g;

-- (opcional) ver os ambíguos, pra ligar à mão no CadastroDoLead:
-- with f as materialized (select id, nome, rel_fone_chave(telefone) k, lower(email) e from rel_clientes
--                          where mesclado_em_id is null and arquivado_em is null),
--      l as materialized (select id, coalesce(full_name, first_name) nome, phone, email,
--                                case when length(rel_fone_chave(phone)) >= 10 then rel_fone_chave(phone) end k,
--                                cad_email(email) e from qs_leads where cliente_id is null)
-- select l.id lead, l.nome, l.phone, l.email, array_agg(distinct f.nome) fichas
--   from l join f on (l.k is not null and f.k = l.k) or (l.e is not null and f.e = l.e)
--  group by 1, 2, 3, 4 having count(distinct f.id) > 1;


-- ── 2. UPDATE (precisa da 0376 aplicada) ────────────────────────────────────
-- qs.ponte=on: não mexe em updated_at dos leads e passa pelo bloqueio de área.
-- begin;
--   select set_config('qs.ponte', 'on', true);
--   update qs_leads l
--      set cliente_id = x.f
--     from (select id, cad_ficha_unica_contato(phone, email) f
--             from qs_leads where cliente_id is null) x
--    where l.id = x.id and x.f is not null and l.cliente_id is null;
--   -- conferir: deve dar ~190 (o número do bloco 1) + 1
--   select count(*) from qs_leads where cliente_id is not null;
-- commit;   -- ou rollback; se o número não bater


-- ── 3. (opcional) Conversas do Rel sem ficha (precisa da 0378) ──────────────
-- Em 13/11: 51 conversas sem ficha, 1 ligaria.
-- select count(*) from rel_wa_conversas where cliente_id is null and rel_cliente_do_telefone(telefone) is not null;
-- update rel_wa_conversas set cliente_id = rel_cliente_do_telefone(telefone)
--  where cliente_id is null and rel_cliente_do_telefone(telefone) is not null;


-- ── 4. (opcional) Opt-out que já estava fora de sincronia (precisa da 0378) ──
-- Em 13/11: 4 leads de fichas que saíram no Rel continuam liberados; 0 no
-- sentido contrário. Rode DEPOIS do bloco 2 (assim os leads recém-ligados
-- também recebem). Usa o mesmo carimbo da ficha.
-- simulação:
-- select count(distinct l.id) from rel_clientes c join qs_leads l
--     on l.cliente_id = c.id
--     or (l.cliente_id is null and qs_tel_chave(l.phone) = qs_tel_chave(c.telefone) and cad_tel(l.phone) = cad_tel(c.telefone))
--  where c.optout_em is not null and c.mesclado_em_id is null and l.optout_whatsapp_em is null;
-- aplicar (cada ficha com opt-out repropaga pela função da 0378):
-- begin;
--   select cad_optout_propagar(c.id, c.telefone, c.optout_em, null, 'Saiu do WhatsApp pelo Relacionamento.')
--     from rel_clientes c where c.optout_em is not null and c.mesclado_em_id is null;
--   select cad_optout_propagar(l.cliente_id, l.phone, l.optout_whatsapp_em, null, 'Saiu do WhatsApp pelo Comercial.')
--     from qs_leads l where l.optout_whatsapp_em is not null;
-- commit;
