-- =============================================================================
-- 0029 — Fecha a escalada de privilégio pelo handover
-- -----------------------------------------------------------------------------
-- A 0025 fez uma coisa certa: quem passa o lead adiante continua enxergando a
-- conversa ("agendei, foi pro closer, mas sigo junto se der imprevisto"). Só que
-- ela apoiou essa permissão numa tabela cuja escrita estava aberta:
--
--     create policy ho_insert on qs_handovers for insert to authenticated
--       with check (true);            -- 0007_rls_papeis.sql:134
--
-- Com `with check (true)`, QUALQUER usuário logado insere uma linha dizendo
-- "eu passei este lead adiante" — para um lead que nunca foi dele. E, como
-- `qs_owns_lead` consulta essa tabela, a linha forjada vira acesso de leitura E
-- de escrita à conversa de WhatsApp do cliente de outro SDR (a mesma regra é
-- espelhada no servidor, em api/_wa.js).
--
-- Duas travas, porque uma só não basta:
--   (1) só dá pra registrar um handover em nome PRÓPRIO e de um lead que já é seu;
--   (2) mesmo com a linha, o acesso vale só pro handover MAIS RECENTE do lead —
--       quem passou o lead há três donos atrás não fica com acesso vitalício.
--
-- Idempotente. Cole no SQL Editor do Supabase e rode.
-- =============================================================================

-- ── (1) Não dá mais pra forjar handover ─────────────────────────────────────
-- `from_user_id = auth.uid()`  → não registro passagem em nome de outro
-- `qs_owns_lead(lead_id)`      → não registro passagem de lead que não é meu
-- O gestor segue livre (qs_owns_lead já devolve true pra ele).
drop policy if exists ho_insert on qs_handovers;
create policy ho_insert on qs_handovers for insert to authenticated
  with check (
    from_user_id = auth.uid()
    and qs_owns_lead(lead_id)
  );

-- Faltava política de UPDATE/DELETE: sem elas o Postgres nega por padrão, que é
-- o que queremos. Declaradas explicitamente pra ninguém "descobrir" isso depois
-- e abrir por engano.
drop policy if exists ho_update on qs_handovers;
create policy ho_update on qs_handovers for update to authenticated
  using (qs_is_manager()) with check (qs_is_manager());

drop policy if exists ho_delete on qs_handovers;
create policy ho_delete on qs_handovers for delete to authenticated
  using (qs_is_manager());

-- ── (2) O acesso herdado morre quando o lead passa adiante de novo ──────────
-- Antes: QUALQUER handover histórico com from_user_id = eu dava acesso pra
-- sempre. Agora vale só o último — que é exatamente o "eu acabei de passar,
-- sigo junto" que a 0025 quis permitir.
create or replace function qs_owns_lead(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select qs_is_manager()
    or exists (
      select 1 from qs_leads l
      where l.id = p_lead and (l.owner_id = auth.uid() or l.owner_id is null)
    )
    or exists (
      select 1
        from (
          select h.from_user_id
            from qs_handovers h
           where h.lead_id = p_lead
           order by h.created_at desc
           limit 1
        ) ultimo
       where ultimo.from_user_id = auth.uid()
    );
$$;

grant execute on function qs_owns_lead(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- CONFERÊNCIA
--
--   -- deve devolver a expressão nova, com from_user_id = auth.uid()
--   select pg_get_expr(polwithcheck, polrelid)
--     from pg_policy where polname = 'ho_insert';
--
--   -- leads com mais de um handover: só o último concede acesso agora
--   select lead_id, count(*) from qs_handovers group by lead_id having count(*) > 1;
--
-- Rollback (volta ao comportamento antigo, inseguro):
--   drop policy if exists ho_insert on qs_handovers;
--   create policy ho_insert on qs_handovers for insert to authenticated with check (true);
-- =============================================================================
