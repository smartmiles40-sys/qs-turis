-- 0124_relacionamento_ajustes.sql
-- -----------------------------------------------------------------------------
-- Ajustes da revisão de bugs de 14/10/2026 (0121–0123):
--   1. rel_wa_reagir trava a linha (FOR UPDATE): reação do cliente e do time
--      chegando juntas não apaga uma à outra (era ler-mudar-gravar no jsonb).
--   2. rel_agenda_v mascara também o TIPO do compromisso particular de outra
--      pessoa ("pessoal" já contava demais) — vira 'outro'.
--   3. rel_agenda_v é só leitura: tira INSERT/UPDATE/DELETE que vieram do
--      privilégio padrão (inofensivo por ter join, mas não precisa existir).
-- -----------------------------------------------------------------------------

create or replace function rel_wa_reagir(p_wamid text, p_de text, p_nome text, p_emoji text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_lista jsonb;
begin
  select id, reacoes into v_id, v_lista from rel_wa_mensagens where wamid = p_wamid limit 1 for update;
  if v_id is null then return false; end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into v_lista
    from jsonb_array_elements(coalesce(v_lista, '[]'::jsonb)) r where r ->> 'de' is distinct from p_de;
  if coalesce(p_emoji, '') <> '' then
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('de', p_de, 'nome', p_nome, 'emoji', p_emoji, 'em', now()));
  end if;
  update rel_wa_mensagens set reacoes = v_lista where id = v_id;
  return true;
end $$;
revoke all on function rel_wa_reagir(text, text, text, text) from public, anon, authenticated;

create or replace view rel_agenda_v as
select a.id,
       a.dono_id,
       u.name as dono_nome,
       a.inicio,
       a.fim,
       a.dia_inteiro,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then 'outro'::text else a.tipo end as tipo,
       a.privado,
       (a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar()) as mascarado,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then 'Ocupado'::text else a.titulo end as titulo,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::text else a.descricao end as descricao,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::uuid else a.cliente_id end as cliente_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::text else cl.nome end as cliente_nome,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::uuid else a.viagem_id end as viagem_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::uuid else a.conversa_id end as conversa_id,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::text else a.local end as local,
       case when a.privado and a.dono_id <> auth.uid() and not rel_pode_configurar() then null::text else a.link end as link,
       a.criado_em,
       a.atualizado_em
  from rel_agenda a
  join qs_users u on u.id = a.dono_id
  left join rel_clientes cl on cl.id = a.cliente_id
 where rel_tem_acesso();

revoke insert, update, delete, truncate, references, trigger on rel_agenda_v from anon, authenticated;
grant select on rel_agenda_v to authenticated;
