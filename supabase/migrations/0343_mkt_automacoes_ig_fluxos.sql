-- 0343_mkt_automacoes_ig_fluxos.sql
-- NÃO APLICADA (09/11/2026). Só arquivo — aplicar só com o ok do Bruno.
-- ORDEM: depois da 0244 (mkt_fluxos, mkt_ig_*). Idempotente (pode rodar 2x).
-- Rollback comentado no fim.
--
-- AUTOMAÇÕES DO MARKETING — o que faltava do ManyChat:
--
--   1. INSTAGRAM NO MESMO EDITOR DE FLUXOS do WhatsApp. O fluxo ganha um canal
--      (mkt_fluxos.canal); os gatilhos do Instagram viram tipos de gatilho
--      (ig_comentario, ig_dm_palavra, ig_story_resposta, ig_story_mencao,
--      ig_boas_vindas, ig_ref) e a execução passa a poder morar numa conversa do
--      Instagram (mkt_fluxo_execucoes.ig_conversa_id). A "resposta privada" ao
--      comentário (uma mensagem só, em até 7 dias) fica guardada na própria
--      execução (ig_privada) — é ela que deixa a 1ª DM sair sem a janela de 24 h.
--      As regras simples antigas (mkt_ig_automacoes) continuam funcionando e
--      podem ser convertidas em fluxo pela tela.
--   2. RENOVAÇÃO DO TOKEN do Instagram: quando foi renovado / tentado por último.
--   3. LINKS E QR DE ENTRADA: os gatilhos link_ref (wa.me) e ig_ref (ig.me) ganham
--      contagem de cliques (o redirecionamento /e/<código> passa pelo QS) e um
--      nome. "Conversas iniciadas" = disparos do gatilho (já existia).
--   4. RELATÓRIO POR FLUXO: evento 'acao' (tag/campo definido = conversão) e a
--      função mkt_auto_relatorio (iniciados, concluídos, onde param, cliques por
--      botão, conversões) — tudo contado no banco, sem trazer linhas pra tela.
--
-- Segurança: nada novo para anon. Tabela nova (mkt_entrada_cliques) só o
-- servidor escreve; a tela lê com mkt_auto_acesso(). Funções do motor: só
-- service_role (revoke de public, anon, authenticated).
-- =============================================================================

do $$
begin
  if to_regclass('public.mkt_fluxos') is null or to_regclass('public.mkt_ig_conversas') is null then
    raise exception '0343: rode a 0244 (automações do Marketing) antes desta.';
  end if;
end $$;

-- ── 1. O canal do fluxo ─────────────────────────────────────────────────────
alter table public.mkt_fluxos add column if not exists canal text not null default 'whatsapp';
alter table public.mkt_fluxos drop constraint if exists mkt_fluxos_canal_check;
alter table public.mkt_fluxos add constraint mkt_fluxos_canal_check check (canal in ('whatsapp', 'instagram'));
create index if not exists mkt_fluxos_canal_idx on public.mkt_fluxos (canal, status);

-- ── 2. Gatilhos do Instagram + links de entrada ────────────────────────────
alter table public.mkt_fluxo_gatilhos drop constraint if exists mkt_fluxo_gatilhos_tipo_check;
alter table public.mkt_fluxo_gatilhos add constraint mkt_fluxo_gatilhos_tipo_check check (tipo in (
  'palavra_chave', 'boas_vindas', 'padrao', 'link_ref', 'anuncio', 'tag_adicionada', 'webhook',
  'ig_comentario',      -- {"palavras":[],"qualquer_palavra":false,"posts":[],"respostas_publicas":[]}
  'ig_dm_palavra',      -- {"palavras":[],"modo":"contem|exata|comeca"}
  'ig_story_resposta',  -- {"palavras":[]}  (vazio = qualquer resposta)
  'ig_story_mencao',    -- {}
  'ig_boas_vindas',     -- {}  1ª DM de quem nunca falou com a conta
  'ig_ref'              -- ig.me/m/<conta>?ref=<codigo>: {"codigo":"live-peru","nome":"..."}
));
-- Cliques no link de entrada (o redirecionamento do QS conta).
alter table public.mkt_fluxo_gatilhos add column if not exists cliques integer not null default 0;
-- Um código de entrada é único entre WhatsApp e Instagram: /e/<código> sabe pra onde ir.
create unique index if not exists mkt_fluxo_gatilhos_entrada_uidx
  on public.mkt_fluxo_gatilhos ((lower(config ->> 'codigo'))) where tipo in ('link_ref', 'ig_ref');

-- Cada clique (pra ver por dia). Só o servidor grava.
create table if not exists public.mkt_entrada_cliques (
  id         bigserial primary key,
  gatilho_id uuid not null references public.mkt_fluxo_gatilhos(id) on delete cascade,
  origem     text,          -- 'qr' | 'link' (o ?q=1 que o QR leva)
  criado_em  timestamptz not null default now()
);
create index if not exists mkt_entrada_cliques_gatilho_idx on public.mkt_entrada_cliques (gatilho_id, criado_em desc);

-- ── 3. A execução numa conversa do Instagram ───────────────────────────────
alter table public.mkt_fluxo_execucoes alter column conversa_id drop not null;
alter table public.mkt_fluxo_execucoes add column if not exists ig_conversa_id uuid references public.mkt_ig_conversas(id) on delete cascade;
-- {"comment_id":"...","em":"<quando comentou>","usada":false} — a resposta privada (1 mensagem, 7 dias).
alter table public.mkt_fluxo_execucoes add column if not exists ig_privada jsonb;
alter table public.mkt_fluxo_execucoes drop constraint if exists mkt_fluxo_execucoes_uma_conversa;
alter table public.mkt_fluxo_execucoes add constraint mkt_fluxo_execucoes_uma_conversa
  check (num_nonnulls(conversa_id, ig_conversa_id) = 1);
create index if not exists mkt_fluxo_execucoes_ig_conversa_idx
  on public.mkt_fluxo_execucoes (ig_conversa_id) where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo');

-- Conversão no relatório: cada tag/campo/lista que um fluxo aplicou.
alter table public.mkt_fluxo_eventos drop constraint if exists mkt_fluxo_eventos_tipo_check;
alter table public.mkt_fluxo_eventos add constraint mkt_fluxo_eventos_tipo_check
  check (tipo in ('entrou', 'enviou', 'saida', 'erro', 'acao'));
create index if not exists mkt_fluxo_eventos_execucao_idx on public.mkt_fluxo_eventos (execucao_id);

-- ── 4. A conversa do Instagram no motor ─────────────────────────────────────
alter table public.mkt_ig_conversas add column if not exists contato_id uuid references public.mkt_contatos(id) on delete set null;
alter table public.mkt_ig_conversas add column if not exists processando_ate timestamptz;
alter table public.mkt_ig_conversas add column if not exists precisa_humano_em timestamptz;
-- PARAR no Instagram (o optout_whatsapp_em do contato é só do WhatsApp).
alter table public.mkt_ig_conversas add column if not exists optout_em timestamptz;
create index if not exists mkt_ig_conversas_contato_idx on public.mkt_ig_conversas (contato_id);

alter table public.mkt_ig_mensagens add column if not exists fluxo_id uuid references public.mkt_fluxos(id) on delete set null;
alter table public.mkt_ig_mensagens add column if not exists no_id text;
alter table public.mkt_ig_mensagens drop constraint if exists mkt_ig_mensagens_origem_check;
alter table public.mkt_ig_mensagens add constraint mkt_ig_mensagens_origem_check
  check (origem in ('cliente', 'manual', 'automacao', 'eco', 'fluxo', 'teste'));

-- Qual gatilho de fluxo respondeu o comentário (anti-repetição: 1 DM por pessoa/post/gatilho).
alter table public.mkt_ig_comentarios add column if not exists gatilho_id uuid references public.mkt_fluxo_gatilhos(id) on delete set null;
create index if not exists mkt_ig_comentarios_repeticao_idx on public.mkt_ig_comentarios (from_id, gatilho_id, media_id) where respondido_dm_em is not null;

-- ── 5. Token do Instagram: renovação ────────────────────────────────────────
alter table public.mkt_ig_contas add column if not exists token_renovado_em timestamptz;
alter table public.mkt_ig_contas add column if not exists token_tentativa_em timestamptz;
grant select (token_renovado_em, token_tentativa_em) on public.mkt_ig_contas to authenticated;

-- ── 6. Funções do motor (só service_role) ───────────────────────────────────
create or replace function public.mkt_ig_tomar_conversa(p_conversa uuid, p_segundos int default 25)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  update public.mkt_ig_conversas
     set processando_ate = now() + make_interval(secs => greatest(1, least(p_segundos, 120)))
   where id = p_conversa and (processando_ate is null or processando_ate < now())
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function public.mkt_ig_soltar_conversa(p_conversa uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_ig_conversas set processando_ate = null where id = p_conversa;
$$;

-- Entrada nova no Instagram: abre a janela e soma a não lida sem ler-somar-gravar.
create or replace function public.mkt_ig_registrar_entrada(p_conversa uuid, p_quando timestamptz, p_previa text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.mkt_ig_conversas
     set ultima_entrada_em  = greatest(coalesce(ultima_entrada_em, p_quando), p_quando),
         ultima_mensagem_em = greatest(coalesce(ultima_mensagem_em, p_quando), p_quando),
         ultima_previa      = left(coalesce(p_previa, ''), 140),
         nao_lidas          = nao_lidas + 1
   where id = p_conversa;
$$;

-- Clique no link de entrada: conta e devolve pra onde ir (o servidor monta o endereço).
create or replace function public.mkt_entrada_clique(p_codigo text, p_origem text default 'link')
returns table (gatilho_id uuid, tipo text, codigo text, texto text, ativo boolean)
language plpgsql
security definer
set search_path = public
as $$
declare g public.mkt_fluxo_gatilhos%rowtype;
begin
  select * into g from public.mkt_fluxo_gatilhos x
   where x.tipo in ('link_ref', 'ig_ref') and lower(x.config ->> 'codigo') = lower(p_codigo)
   limit 1;
  if g.id is null then return; end if;
  if p_origem is not null then
    update public.mkt_fluxo_gatilhos set cliques = cliques + 1 where id = g.id;
    insert into public.mkt_entrada_cliques (gatilho_id, origem) values (g.id, left(p_origem, 10));
  end if;
  return query select g.id, g.tipo, g.config ->> 'codigo', g.config ->> 'texto', g.ativo;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.mkt_ig_tomar_conversa(uuid, int)',
    'public.mkt_ig_soltar_conversa(uuid)',
    'public.mkt_ig_registrar_entrada(uuid, timestamptz, text)',
    'public.mkt_entrada_clique(text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 7. Relatório por fluxo (a tela chama; sem acesso = vazio) ───────────────
-- p_desde: só execuções/eventos a partir de quando (null = desde sempre).
create or replace function public.mkt_auto_relatorio(p_fluxo uuid, p_desde timestamptz default null)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with ex as (
    select e.* from public.mkt_fluxo_execucoes e
     where e.fluxo_id = p_fluxo and not e.teste
       and (p_desde is null or e.iniciada_em >= p_desde)
  ), ev as (
    select v.* from public.mkt_fluxo_eventos v
      join ex on ex.id = v.execucao_id
  )
  select case when not public.mkt_auto_acesso() then '{}'::jsonb else jsonb_build_object(
    'iniciados',  (select count(*) from ex),
    'concluidos', (select count(*) from ex where estado = 'concluida'),
    'andamento',  (select count(*) from ex where estado in ('rodando', 'aguardando_resposta', 'aguardando_tempo')),
    'cancelados', (select count(*) from ex where estado = 'cancelada'),
    'erros',      (select count(*) from ex where estado = 'erro'),
    'whatsapp',   (select count(*) from ex where conversa_id is not null),
    'instagram',  (select count(*) from ex where ig_conversa_id is not null),
    -- Onde está / onde parou quem não concluiu: o bloco e o estado.
    'parados', coalesce((select jsonb_agg(jsonb_build_object('no_id', no_atual, 'estado', estado, 'total', n) order by n desc)
                  from (select no_atual, estado, count(*) n from ex where estado <> 'concluida' group by 1, 2) t), '[]'::jsonb),
    -- Por bloco: quantos entraram, enviaram, saíram por qual saída (= cliques por botão), erros.
    'blocos', coalesce((select jsonb_agg(jsonb_build_object('no_id', no_id, 'tipo', tipo, 'saida', saida, 'total', n))
                  from (select no_id, tipo, coalesce(saida, '') saida, count(*) n from ev where tipo in ('entrou', 'enviou', 'saida', 'erro') group by 1, 2, 3) t), '[]'::jsonb),
    -- Conversões: tag/campo/lista que o fluxo aplicou ("tag:quente", "campo:destino").
    'conversoes', coalesce((select jsonb_agg(jsonb_build_object('detalhe', detalhe, 'pessoas', n) order by n desc)
                  from (select detalhe, count(distinct execucao_id) n from ev where tipo = 'acao' group by 1) t), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.mkt_auto_relatorio(uuid, timestamptz) from public, anon;
grant execute on function public.mkt_auto_relatorio(uuid, timestamptz) to authenticated, service_role;

-- ── 8. RLS da tabela nova ───────────────────────────────────────────────────
alter table public.mkt_entrada_cliques enable row level security;
revoke all on public.mkt_entrada_cliques from anon, public;
revoke insert, update, delete, truncate on public.mkt_entrada_cliques from authenticated;
grant select on public.mkt_entrada_cliques to authenticated;
drop policy if exists mkt_entrada_cliques_mkt_ler on public.mkt_entrada_cliques;
create policy mkt_entrada_cliques_mkt_ler on public.mkt_entrada_cliques
  for select to authenticated using (public.mkt_auto_acesso());
-- (as colunas novas das tabelas da 0244 herdam a RLS que já existe nelas)

-- ── CONFERÊNCIA (depois de aplicar) ─────────────────────────────────────────
--   select canal, count(*) from mkt_fluxos group by 1;                 -- tudo 'whatsapp'
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'mkt_fluxo_gatilhos_tipo_check';
--   select has_function_privilege('anon', 'public.mkt_entrada_clique(text, text)', 'execute');   -- false
--   select has_function_privilege('authenticated', 'public.mkt_ig_tomar_conversa(uuid, int)', 'execute'); -- false
--
-- ---------------------------------------------------------------------------
-- ROLLBACK (à mão, nesta ordem). Antes: apagar os fluxos do Instagram e as
-- execuções em conversas do Instagram, senão a trava antiga não volta.
--   delete from mkt_fluxo_execucoes where ig_conversa_id is not null;
--   delete from mkt_fluxos where canal = 'instagram';
--   delete from mkt_fluxo_gatilhos where tipo like 'ig\_%';
--   delete from mkt_fluxo_eventos where tipo = 'acao';
--   drop function if exists public.mkt_auto_relatorio(uuid, timestamptz), public.mkt_entrada_clique(text, text),
--     public.mkt_ig_registrar_entrada(uuid, timestamptz, text), public.mkt_ig_soltar_conversa(uuid),
--     public.mkt_ig_tomar_conversa(uuid, int);
--   drop table if exists public.mkt_entrada_cliques;
--   drop index if exists mkt_fluxo_gatilhos_entrada_uidx;
--   alter table public.mkt_fluxo_execucoes drop constraint if exists mkt_fluxo_execucoes_uma_conversa,
--     drop column if exists ig_privada, drop column if exists ig_conversa_id, alter column conversa_id set not null;
--   alter table public.mkt_fluxo_gatilhos drop column if exists cliques;
--   alter table public.mkt_fluxo_gatilhos drop constraint mkt_fluxo_gatilhos_tipo_check, add constraint mkt_fluxo_gatilhos_tipo_check
--     check (tipo in ('palavra_chave','boas_vindas','padrao','link_ref','anuncio','tag_adicionada','webhook'));
--   alter table public.mkt_fluxo_eventos drop constraint mkt_fluxo_eventos_tipo_check, add constraint mkt_fluxo_eventos_tipo_check
--     check (tipo in ('entrou','enviou','saida','erro'));
--   alter table public.mkt_ig_mensagens drop column if exists fluxo_id, drop column if exists no_id;
--   alter table public.mkt_ig_mensagens drop constraint mkt_ig_mensagens_origem_check, add constraint mkt_ig_mensagens_origem_check
--     check (origem in ('cliente','manual','automacao','eco'));
--   alter table public.mkt_ig_conversas drop column if exists contato_id, drop column if exists processando_ate,
--     drop column if exists precisa_humano_em, drop column if exists optout_em;
--   alter table public.mkt_ig_comentarios drop column if exists gatilho_id;
--   alter table public.mkt_ig_contas drop column if exists token_renovado_em, drop column if exists token_tentativa_em;
--   alter table public.mkt_fluxos drop constraint if exists mkt_fluxos_canal_check, drop column if exists canal;
-- ---------------------------------------------------------------------------
