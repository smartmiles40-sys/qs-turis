-- 0113_relacionamento_conversa_sem_sla.sql
-- -----------------------------------------------------------------------------
-- EXCEÇÕES DO PRAZO DE RESPOSTA (Bruno, 13/10/2026: "temos grupos que não devem
-- contar pro SLA — uma etiqueta pra tirar das contas, pro contador não
-- alucinar"). Conversa marcada "não conta no prazo":
--   • nunca fica "esperando resposta" (sem relógio, fora do contador);
--   • resposta nela não gera linha em rel_wa_sla (KPIs limpos);
--   • ao marcar, as medições antigas dela saem dos KPIs também.
-- Grupo de WhatsApp (id com mais de 15 dígitos, ex.: 1203…) já nasce marcado.
-- -----------------------------------------------------------------------------

alter table rel_wa_conversas add column if not exists sem_sla        boolean not null default false;
alter table rel_wa_conversas add column if not exists sem_sla_motivo text;
alter table rel_wa_conversas add column if not exists sem_sla_por    uuid references qs_users(id) on delete set null;
alter table rel_wa_conversas add column if not exists sem_sla_em     timestamptz;

-- Grupos que já estão aí
update rel_wa_conversas
   set sem_sla = true, sem_sla_motivo = 'grupo', sem_sla_em = now(), aguardando_desde = null
 where length(telefone) > 15 and not sem_sla;

-- ── Entrada/saída de mensagem respeita a etiqueta ───────────────────────────
create or replace function rel_wa_ingest(p_phone_id text, p_telefone text, p_nome text, p_wamid text, p_direcao text, p_origem text, p_texto text, p_anexos jsonb DEFAULT '[]'::jsonb, p_enviada_em timestamp with time zone DEFAULT now(), p_autor uuid DEFAULT NULL::uuid, p_autor_nome text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_resp text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  fone  text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  conv  rel_wa_conversas;
  nova  boolean;
  meta  int;
begin
  if fone = '' or coalesce(p_wamid, '') = '' then return jsonb_build_object('ok', false); end if;

  insert into rel_wa_conversas (phone_number_id, telefone, nome_contato, cliente_id, estado, sem_sla, sem_sla_motivo, sem_sla_em)
  values (p_phone_id, fone, nullif(p_nome, ''), rel_cliente_do_telefone(fone),
          case when p_direcao = 'in' then 'aberta' else 'aguardando_cliente' end,
          length(fone) > 15, case when length(fone) > 15 then 'grupo' end, case when length(fone) > 15 then now() end)
  on conflict (phone_number_id, telefone) do update
     set nome_contato = coalesce(nullif(excluded.nome_contato, ''), rel_wa_conversas.nome_contato),
         cliente_id   = coalesce(rel_wa_conversas.cliente_id, excluded.cliente_id)
  returning * into conv;

  insert into rel_wa_mensagens (conversa_id, wamid, direcao, origem, texto, anexos, autor_id, autor_nome, status, respondendo_a, enviada_em)
  values (conv.id, p_wamid, p_direcao, p_origem, coalesce(p_texto, ''), coalesce(p_anexos, '[]'),
          p_autor, p_autor_nome, p_status, p_resp, coalesce(p_enviada_em, now()))
  on conflict (wamid) do nothing;
  nova := found;
  if not nova then return jsonb_build_object('ok', true, 'nova', false, 'conversa', conv.id); end if;

  if p_origem = 'historico' then
    update rel_wa_conversas set
      ultima_entrada_em = case when p_direcao = 'in' then greatest(ultima_entrada_em, p_enviada_em) else ultima_entrada_em end,
      ultima_saida_em   = case when p_direcao = 'out' then greatest(ultima_saida_em, p_enviada_em) else ultima_saida_em end,
      atualizado_em     = greatest(atualizado_em, p_enviada_em)
     where id = conv.id;
    return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
  end if;

  if p_direcao = 'in' then
    update rel_wa_conversas set
      estado            = 'aberta',
      -- "não conta no prazo": nunca fica esperando
      aguardando_desde  = case when sem_sla then null else coalesce(aguardando_desde, p_enviada_em) end,
      ultima_entrada_em = p_enviada_em,
      ultima_mensagem   = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      nao_lidas         = nao_lidas + 1,
      atualizado_em     = now()
     where id = conv.id;
  else
    if conv.aguardando_desde is not null and p_origem <> 'automatica' and not conv.sem_sla then
      select coalesce((valor ->> 'resposta_min')::int, 30) into meta from rel_config where chave = 'sla';
      insert into rel_wa_sla (conversa_id, atendente_id, esperou_desde, respondido_em, minutos_uteis, meta_min)
      values (conv.id, coalesce(p_autor, conv.atendente_id), conv.aguardando_desde, p_enviada_em,
              rel_minutos_uteis(conv.aguardando_desde, p_enviada_em), coalesce(meta, 30));
    end if;
    update rel_wa_conversas set
      estado           = case when p_origem = 'automatica' then estado else 'aguardando_cliente' end,
      aguardando_desde = case when p_origem = 'automatica' then aguardando_desde else null end,
      nao_lidas        = case when p_origem = 'automatica' then nao_lidas else 0 end,
      atendente_id     = coalesce(atendente_id, p_autor),
      ultima_saida_em  = p_enviada_em,
      ultima_mensagem  = left(coalesce(nullif(p_texto, ''), '📎 Anexo'), 200),
      auto_resposta_em = case when p_origem = 'automatica' then now() else auto_resposta_em end,
      atualizado_em    = now()
     where id = conv.id;
  end if;
  return jsonb_build_object('ok', true, 'nova', true, 'conversa', conv.id);
end;
$function$;

-- ── Marcar / desmarcar pela tela ────────────────────────────────────────────
create or replace function rel_conversa_sem_sla(p_conversa uuid, p_sem boolean, p_motivo text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not rel_tem_acesso() then raise exception 'Sem acesso ao Relacionamento.' using errcode = '42501'; end if;
  if p_sem then
    update rel_wa_conversas
       set sem_sla = true, sem_sla_motivo = coalesce(nullif(trim(p_motivo), ''), 'outro'),
           sem_sla_por = auth.uid(), sem_sla_em = now(), aguardando_desde = null
     where id = p_conversa;
    -- o que já foi medido nessa conversa sai dos KPIs
    delete from rel_wa_sla where conversa_id = p_conversa;
  else
    update rel_wa_conversas
       set sem_sla = false, sem_sla_motivo = null, sem_sla_por = auth.uid(), sem_sla_em = now()
     where id = p_conversa;
  end if;
end;
$$;
revoke all on function rel_conversa_sem_sla(uuid, boolean, text) from public, anon;
grant execute on function rel_conversa_sem_sla(uuid, boolean, text) to authenticated;

-- A fila (view) usa c.*: as colunas novas mudam a ordem, então recria do zero.
drop view if exists rel_wa_fila;
create view rel_wa_fila
with (security_invoker = true) as
select c.*,
       cl.nome                                   as cliente_nome,
       u.name                                    as atendente_nome,
       rel_minutos_uteis(c.aguardando_desde, now()) as minutos_esperando,
       coalesce((select (valor ->> 'resposta_min')::int from rel_config where chave = 'sla'), 30) as meta_min,
       (c.ultima_entrada_em is not null and c.ultima_entrada_em > now() - interval '24 hours') as janela_aberta
  from rel_wa_conversas c
  left join rel_clientes cl on cl.id = c.cliente_id
  left join qs_users u      on u.id  = c.atendente_id;
grant select on rel_wa_fila to authenticated;
