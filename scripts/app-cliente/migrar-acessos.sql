-- ═══════════════════════════════════════════════════════════════════════════════
-- Migrar os LOGINS DA EQUIPE do Sistema de Expedições (bnbpsuenlokhljrkvlke) pro QS
-- (eabfjomrnucymduqnbci), preservando a SENHA de cada um.
--
-- PREPARADO em 27/10/2026. NADA disto foi rodado. Leia docs/APP-CLIENTE.md (seção 1).
--
-- O que este script NÃO faz (e não precisa):
--   • Clientes (ExpedAmigo /amigo, Área do Líder /lider, /a/, /inscricao) NÃO usam o
--     Supabase Auth. Eles entram com CPF + senha da tabela `acesso_senhas`, que já viaja
--     junto com os dados (copiar-dados.mjs). A senha deles continua valendo sem nada extra.
--   • Não cria qs_users: quem só usava o app antigo continua sem entrar no QS (a tela de
--     login do QS diz "sem acesso"). O acesso às Expedições vem da linha em `usuarios`.
--
-- Números em 27/10 (só leitura): 11 logins no antigo, todos e-mail+senha (bcrypt $2a$),
-- nenhum MFA, nenhum OAuth/SSO.
--   • 5 já existem no QS pelo e-mail (antonio.carlos, beatriz.galvao, marianevalentim,
--     pietra.moreira, tainaravasconcelos) → ficam com a conta e a senha DO QS.
--   • 4 serão copiados com o MESMO id e a MESMA senha: carolina_taketomi, contato@,
--     larissa.souza, glaucia.sousa (esta está bloqueada até 2029 no antigo e continua).
--   • 2 pulados por padrão: brunooliveira062006@gmail.com (nunca confirmou nem entrou) e
--     camila.nicacio (confirmada, nunca entrou, sem papel em `usuarios`).
--   • 0 ids do antigo ocupados no QS por outra pessoa.
--
-- Como rodar (Supabase → SQL Editor):
--   PARTE A no projeto ANTIGO → copia o JSON que sair.
--   PARTE B no projeto do QS → cola o JSON no lugar indicado. Roda 1x com simular = true
--     (só mostra a lista do que faria). Confere. Troca pra false e roda de novo.
--   PARTE C (rollback) no QS se precisar desfazer.
-- Idempotente: rodar a PARTE B de novo não duplica (quem já está no QS é pulado).
-- ═══════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────────
-- PARTE A — rodar no projeto ANTIGO (bnbpsuenlokhljrkvlke). Só leitura.
-- Resultado: uma linha, uma coluna `pacote` (JSON). Copie o valor inteiro.
-- ───────────────────────────────────────────────────────────────────────────────
/*
select jsonb_build_object(
  'gerado_em', now(),
  'users', (
    select jsonb_agg(
             (to_jsonb(u) - 'confirmed_at')            -- coluna gerada, não se insere
             || jsonb_build_object('_papel', us.papel::text))
      from auth.users u
      left join public.usuarios us on us.id = u.id
  ),
  'identities', (
    select jsonb_agg(to_jsonb(i) - 'email')            -- coluna gerada
      from auth.identities i
  )
) as pacote;
*/


-- ───────────────────────────────────────────────────────────────────────────────
-- PARTE B — rodar no projeto do QS (eabfjomrnucymduqnbci).
-- ───────────────────────────────────────────────────────────────────────────────
begin;

create temp table _mig_cfg on commit drop as
select
  true  as simular,            -- ← true: só lista. false: grava.
  false as incluir_sem_papel;  -- ← true: copia também quem não tem linha em `usuarios` (ex.: camila.nicacio)

create temp table _mig_in (pacote jsonb) on commit drop;
insert into _mig_in values ($pacote$
COLE_AQUI_O_JSON_DA_PARTE_A
$pacote$::jsonb);

-- Plano: uma linha por login do antigo, com o que vai acontecer.
create temp table _mig_plano on commit drop as
with u as (
  select x as j,
         (x->>'id')::uuid as id_antigo,
         lower(x->>'email') as email,
         x->>'_papel' as papel,
         (x->>'email_confirmed_at') is not null as confirmado,
         (x->>'last_sign_in_at') is not null as ja_entrou,
         nullif(x->>'banned_until', '')::timestamptz as bloqueado_ate
    from _mig_in, jsonb_array_elements(pacote->'users') x
)
select u.*,
       qe.id as id_qs_mesmo_email,
       qi.email as email_dono_do_id_no_qs,
       case
         when qe.id is not null and qe.id = u.id_antigo
           then 'pular: já copiado antes (mesmo id e e-mail no QS)'
         when qe.id is not null
           then 'pular: já tem login no QS (id ' || qe.id || ') — vale a senha DO QS'
         when qi.id is not null
           then 'PARAR: o id antigo já é de outra pessoa no QS (' || qi.email || ') — revisar à mão'
         when not u.confirmado and not u.ja_entrou
           then 'pular: nunca confirmou o e-mail nem entrou'
         when u.papel is null and not (select incluir_sem_papel from _mig_cfg)
           then 'pular: sem papel em usuarios (ligue incluir_sem_papel se quiser)'
         else 'COPIAR: mesmo id, mesma senha'
           || case when u.bloqueado_ate > now() then ' (continua bloqueado até ' || u.bloqueado_ate::date || ')' else '' end
       end as acao
  from u
  left join auth.users qe on lower(qe.email) = u.email
  left join auth.users qi on qi.id = u.id_antigo and lower(qi.email) <> u.email;

-- O que vai acontecer (é isto que aparece no SQL Editor).
select email, papel, id_antigo, acao from _mig_plano order by acao, email;

do $$
declare
  n_users int := 0;
  n_ident int := 0;
  inst uuid := coalesce((select instance_id from auth.users limit 1), '00000000-0000-0000-0000-000000000000');
begin
  if (select simular from _mig_cfg) then
    raise notice 'SIMULAÇÃO: nada foi gravado. Confira a lista e rode de novo com simular = false.';
    return;
  end if;
  if exists (select 1 from _mig_plano where acao like 'PARAR%') then
    raise exception 'Há ids em conflito (linhas PARAR). Nada foi gravado.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at,
    recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at,
    last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token,
    phone_change_sent_at, email_change_token_current, email_change_confirm_status,
    banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
  )
  select
    inst, p.id_antigo, coalesce(j->>'aud', 'authenticated'), coalesce(j->>'role', 'authenticated'),
    p.email,
    j->>'encrypted_password',                              -- hash bcrypt: a MESMA senha continua valendo
    (j->>'email_confirmed_at')::timestamptz,
    (j->>'invited_at')::timestamptz,
    '', null,                                              -- tokens pendentes NÃO viajam
    '', null, '', '', null,
    null,                                                  -- último login: começa do zero no QS
    coalesce(j->'raw_app_meta_data', '{}'::jsonb)
      || jsonb_build_object('migrado_de', 'expedicoes', 'migrado_em', now()),
    coalesce(j->'raw_user_meta_data', '{}'::jsonb),
    null,
    (j->>'created_at')::timestamptz, now(),
    nullif(j->>'phone', ''), (j->>'phone_confirmed_at')::timestamptz, '', '',
    null, '', coalesce((j->>'email_change_confirm_status')::smallint, 0),
    (j->>'banned_until')::timestamptz, '', null, false, null, coalesce((j->>'is_anonymous')::boolean, false)
  from _mig_plano p
  where p.acao like 'COPIAR%'
  on conflict (id) do nothing;
  get diagnostics n_users = row_count;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id)
  select i->>'provider_id', (i->>'user_id')::uuid, i->'identity_data', i->>'provider',
         null, (i->>'created_at')::timestamptz, now(), (i->>'id')::uuid
    from _mig_in, jsonb_array_elements(pacote->'identities') i
   where (i->>'user_id')::uuid in (select id_antigo from _mig_plano where acao like 'COPIAR%')
  on conflict do nothing;
  get diagnostics n_ident = row_count;

  raise notice 'Gravado: % logins e % identidades.', n_users, n_ident;
end $$;

-- Conferência (depois de gravar): cada copiado tem login E linha em usuarios com o mesmo id.
select p.email, p.acao,
       (select count(*) from auth.users u where u.id = p.id_antigo) as tem_login,
       (select count(*) from auth.identities i where i.user_id = p.id_antigo) as identidades,
       (select count(*) from public.usuarios us where us.id = p.id_antigo) as tem_usuarios
  from _mig_plano p
 where p.acao like 'COPIAR%'
 order by p.email;

commit;


-- ───────────────────────────────────────────────────────────────────────────────
-- PARTE C — ROLLBACK (no QS). Apaga SÓ os logins criados por este script.
-- As identidades saem junto (on delete cascade). A tabela `usuarios` não é tocada.
-- ───────────────────────────────────────────────────────────────────────────────
/*
select id, email, last_sign_in_at from auth.users where raw_app_meta_data->>'migrado_de' = 'expedicoes';
-- conferiu? então:
delete from auth.users where raw_app_meta_data->>'migrado_de' = 'expedicoes';
*/
