-- 0142_rel_wa_transcricao_grupos_lidos.sql
-- -----------------------------------------------------------------------------
-- WhatsApp do Relacionamento (16/10/2026, pedidos do Bruno):
--   1. Áudio transcrito: a transcrição roda no NAVEGADOR (Whisper local, sem API
--      paga — decisão do Bruno de 18/08) e fica gravada pra todo mundo.
--   2. Grupos: contador de não lidas e "@" quando alguém marca o número;
--      abrir o grupo zera os dois.
-- -----------------------------------------------------------------------------

alter table rel_wa_mensagens       add column if not exists transcricao text;
alter table rel_wa_grupo_mensagens add column if not exists transcricao text;

/** Grava a transcrição de um áudio (conversa ou grupo). Só quem atende. */
create or replace function rel_wa_salvar_transcricao(p_onde text, p_id uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (rel_tem_acesso() or fin_tem_acesso()) then raise exception 'sem acesso'; end if;
  if p_onde = 'grupo' then
    if not rel_tem_acesso() then raise exception 'sem acesso'; end if;
    update rel_wa_grupo_mensagens set transcricao = left(coalesce(p_texto, ''), 8000) where id = p_id;
  else
    update rel_wa_mensagens set transcricao = left(coalesce(p_texto, ''), 8000) where id = p_id;
  end if;
end $$;
revoke all on function rel_wa_salvar_transcricao(text, uuid, text) from public, anon;
grant execute on function rel_wa_salvar_transcricao(text, uuid, text) to authenticated;

-- ── Grupos: não lidas + menção ──────────────────────────────────────────────
alter table rel_wa_grupos add column if not exists nao_lidas     int not null default 0;
alter table rel_wa_grupos add column if not exists mencionado_em timestamptz;

/** O webhook chama a cada mensagem nova de grupo (service_role). */
create or replace function rel_wa_grupo_nova_msg(p_jid text, p_quando timestamptz, p_previa text, p_de_mim boolean, p_mencionou boolean)
returns void language sql security definer set search_path = public as $$
  update rel_wa_grupos set
    ultima_msg_em = greatest(coalesce(ultima_msg_em, p_quando), p_quando),
    ultima_msg    = case when ultima_msg_em is null or p_quando >= ultima_msg_em then p_previa else ultima_msg end,
    -- respondeu do celular/QS = leu
    nao_lidas     = case when p_de_mim then 0 else nao_lidas + 1 end,
    mencionado_em = case when p_de_mim then null when p_mencionou then p_quando else mencionado_em end,
    atualizado_em = now()
  where jid = p_jid;
$$;
revoke all on function rel_wa_grupo_nova_msg(text, timestamptz, text, boolean, boolean) from public, anon, authenticated;

/** Abriu o grupo no QS: zera não lidas e a menção. */
create or replace function rel_wa_grupo_lido(p_jid text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rel_tem_acesso() then raise exception 'sem acesso'; end if;
  update rel_wa_grupos set nao_lidas = 0, mencionado_em = null where jid = p_jid;
end $$;
revoke all on function rel_wa_grupo_lido(text) from public, anon;
grant execute on function rel_wa_grupo_lido(text) to authenticated;
