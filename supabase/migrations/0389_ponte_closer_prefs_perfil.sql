-- 0389_ponte_closer_prefs_perfil.sql
-- -----------------------------------------------------------------------------
-- PONTE PÓS-VENDA (5/5) — PREFERÊNCIAS DA FICHA DO CLOSER → CADASTRO DA PESSOA.
-- Depende da 0385 só por estilo (não chama nada dela).
--
-- POR QUÊ: closer_consolidar (0176:163-175; vigente em 13/11) joga alergias e
-- restrições da ficha como TEXTO em rel_viagens.necessidades ("[Ficha do
-- closer] …"). O cadastro estruturado da pessoa (rel_clientes.perfil —
-- restricoes_alimentares e saude, o mesmo que cad_salvar_perfil grava e que vai
-- para os passageiros de expedições futuras) continuava vazio.
--
-- O QUE FAZ: gatilho AFTER UPDATE OF consolidada_em em qs_closer_negocios
-- (closer_consolidar grava consolidada_em = now() no fim). Lê
-- ficha.preferencias e a pessoa da viagem (rel_viagens.cliente_id; ficha
-- mesclada segue para a viva) e grava no perfil SÓ O QUE ESTÁ VAZIO:
--   • preferencias.restricoes → perfil.restricoes_alimentares;
--   • preferencias.alergias   → perfil.saude.alergia_alimentar = 'Sim' e
--     alergia_alimentar_qual = "<texto> (informado pelo closer na venda)",
--     só se a pessoa não respondeu nada sobre alergia alimentar.
--     ATENÇÃO (decisão para o Bruno): o campo da ficha do closer é "Alergias"
--     livre — pode ser alergia a remédio. Fica escrito de onde veio.
--   • não mexe em gostos/ocasião/outras (continuam só em necessidades).
--   Rastro: perfil.atualizado_em/atualizado_por (igual ao cad_salvar_perfil) e
--   evento no cartão do closer dizendo o que foi copiado.
--
-- Por que gatilho e não reescrever closer_consolidar: a função é grande e
-- mexida por outras frentes; o gatilho não muda nada do que ela faz e não
-- derruba a consolidação (erro vira warning).
-- Laço: grava rel_clientes.perfil (e o evento do cartão); não volta a
-- qs_closer_negocios.
--
-- COMO CONFERIR: consolide um cartão com "Restrições: sem glúten" para uma pessoa
-- sem restrição no cadastro e veja:
--   select perfil -> 'restricoes_alimentares', perfil -> 'saude' from rel_clientes where id = '<cliente>';
--   select texto from qs_closer_negocio_eventos where negocio_id = '<cartão>' order by criado_em desc limit 3;
--
-- COMO VOLTAR:
--   drop trigger if exists zz_ponte_closer_prefs_perfil on qs_closer_negocios;
-- -----------------------------------------------------------------------------

create or replace function _ponte_closer_prefs_perfil(p_negocio uuid)
returns text[] language plpgsql security definer set search_path = public as $$
declare
  n        qs_closer_negocios;
  v_cli    uuid;
  v_perfil jsonb;
  v_saude  jsonb;
  v_rest   text;
  v_alerg  text;
  v_poe    jsonb := '{}'::jsonb;
  v_fez    text[] := '{}';
begin
  select * into n from qs_closer_negocios where id = p_negocio;
  if not found or jsonb_typeof(n.ficha -> 'preferencias') is distinct from 'object' then return v_fez; end if;
  v_rest  := nullif(trim(n.ficha -> 'preferencias' ->> 'restricoes'), '');
  v_alerg := nullif(trim(n.ficha -> 'preferencias' ->> 'alergias'), '');
  if v_rest is null and v_alerg is null then return v_fez; end if;

  select coalesce(c.mesclado_em_id, c.id) into v_cli
    from rel_viagens v join rel_clientes c on c.id = v.cliente_id where v.id = n.viagem_id;
  if v_cli is null then return v_fez; end if;

  select coalesce(perfil, '{}'::jsonb) into v_perfil from rel_clientes where id = v_cli for update;
  if jsonb_typeof(v_perfil) <> 'object' then v_perfil := '{}'::jsonb; end if;
  v_saude := case when jsonb_typeof(v_perfil -> 'saude') = 'object' then v_perfil -> 'saude' else '{}'::jsonb end;

  if v_rest is not null and nullif(trim(coalesce(v_perfil ->> 'restricoes_alimentares', '')), '') is null then
    v_poe := v_poe || jsonb_build_object('restricoes_alimentares', left(v_rest, 2000));
    v_fez := v_fez || 'restrições alimentares'::text;
  end if;
  if v_alerg is not null
     and nullif(trim(coalesce(v_saude ->> 'alergia_alimentar', '')), '') is null
     and nullif(trim(coalesce(v_saude ->> 'alergia_alimentar_qual', '')), '') is null then
    v_saude := v_saude || jsonb_build_object('alergia_alimentar', 'Sim',
                 'alergia_alimentar_qual', left(v_alerg || ' (informado pelo closer na venda)', 2000));
    v_poe := v_poe || jsonb_build_object('saude', v_saude);
    v_fez := v_fez || 'alergia'::text;
  end if;
  if cardinality(v_fez) = 0 then return v_fez; end if;

  update rel_clientes
     set perfil = coalesce(perfil, '{}'::jsonb) || v_poe
                  || jsonb_build_object('atualizado_em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                        'atualizado_por', auth.uid())
   where id = v_cli;

  insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
  values (n.id, 'editado',
          'Preferências da ficha copiadas para o cadastro da pessoa (só o que estava vazio): ' || array_to_string(v_fez, ', ') || '.',
          (select id from qs_users where id = auth.uid()));
  return v_fez;
end $$;

create or replace function _ponte_trg_closer_prefs_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform _ponte_closer_prefs_perfil(new.id);
  return null;
exception when others then
  raise warning 'ponte: preferências do cartão % → cadastro: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists zz_ponte_closer_prefs_perfil on qs_closer_negocios;
create trigger zz_ponte_closer_prefs_perfil after update of consolidada_em on qs_closer_negocios
  for each row when (new.consolidada_em is not null and new.consolidada_em is distinct from old.consolidada_em)
  execute function _ponte_trg_closer_prefs_perfil();

revoke all on function _ponte_closer_prefs_perfil(uuid) from public, anon, authenticated;
revoke all on function _ponte_trg_closer_prefs_perfil() from public, anon, authenticated;
