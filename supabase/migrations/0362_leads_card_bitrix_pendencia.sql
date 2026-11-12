-- 0362_leads_card_bitrix_pendencia.sql
-- -----------------------------------------------------------------------------
-- TODO LEAD DO QS TEM QUE NASCER NO BITRIX (Bruno, 12/11/2026):
--   "QS = ferramenta, Bitrix = banco de dados. Todo card criado no QS TEM que
--    nascer no Bitrix e ficar amarrado. Falha = pendência visível + nova tentativa."
--
-- Antes: quando a criação do negócio falhava, o erro ia só pro log e o lead
-- ficava sem bitrix_id pra sempre, sem ninguém saber. Três portas (CSV, cadastro
-- "só no QS" e o resgate &duplicar=1) nem tentavam.
--
-- Esta migration só cria o ESTADO DO ESPELHO no lead. Quem cria o negócio é o
-- servidor (api/_leadCardBitrix.js): na hora, quando dá, ou pela rotina de nova
-- tentativa (api/leads-sem-card.js?acao=retentar, cron da Vercel), que só envia
-- com LEADS_BITRIX_RETENTATIVA_LIGADA=1.
--
--   bitrix_card_status    'ok' | 'pendente' | 'falhou' | null
--                          null = lead antigo, nunca avaliado (a rotina trata
--                          aberto sem bitrix_id e status null como pendente;
--                          perdido fica de fora por padrão).
--   bitrix_card_erro       último motivo da falha, em português (até 300 chars)
--   bitrix_card_tentativas quantas tentativas o servidor já fez
--   bitrix_card_proxima    não tentar de novo antes disto (recuo)
--   bitrix_card_trava      "estou trabalhando neste lead" até este instante —
--                          impede o cron e o botão "Tentar agora" de criarem
--                          DOIS negócios pro mesmo lead ao mesmo tempo.
--
-- Nome com "_card_" de propósito: qs_leads já tem bitrix_status_synced (a
-- etapa que o lead mandou pro Bitrix), que é outra coisa.
--
-- GATILHO (vale pra TODA porta, inclusive as que gravam direto do navegador —
-- CSV, cadastro manual, modal das Tarefas):
--   • INSERT sem bitrix_id → 'pendente', próxima tentativa em 10 min (dá tempo
--     do webhook do Bitrix adotar o card quando o negócio nasceu do outro lado,
--     ex.: formulário de live).
--   • bitrix_id preenchido (INSERT ou UPDATE) → 'ok' e limpa erro/recuo/trava.
--   • bitrix_id apagado num UPDATE (vínculo mudou de card, api/lead-bitrix.js)
--     → volta a null: o card antigo NÃO entra sozinho na fila (criar negócio
--     novo pra ele duplicaria o cliente no funil).
--
-- SEM CARGA EM MASSA: as linhas que já existem não são tocadas (um UPDATE em
-- ~1.500 leads mexeria no updated_at e na auditoria de todos). A rotina enxerga
-- os antigos pelo filtro (sem bitrix_id + aberto + status null).
--
-- Idempotente. Rodar de novo não muda nada.
-- -----------------------------------------------------------------------------

alter table public.qs_leads add column if not exists bitrix_card_status text;
alter table public.qs_leads add column if not exists bitrix_card_erro text;
alter table public.qs_leads add column if not exists bitrix_card_tentativas integer not null default 0;
alter table public.qs_leads add column if not exists bitrix_card_proxima timestamptz;
alter table public.qs_leads add column if not exists bitrix_card_trava timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.qs_leads'::regclass and conname = 'qs_leads_bitrix_card_status_check'
  ) then
    alter table public.qs_leads
      add constraint qs_leads_bitrix_card_status_check
      check (bitrix_card_status is null or bitrix_card_status in ('ok', 'pendente', 'falhou'));
  end if;
end $$;

comment on column public.qs_leads.bitrix_card_status is
  'Espelho do card no Bitrix (0362): ok | pendente | falhou | null (antigo, nunca avaliado).';
comment on column public.qs_leads.bitrix_card_erro is
  'Último motivo de falha ao criar/vincular o negócio no Bitrix (0362).';
comment on column public.qs_leads.bitrix_card_tentativas is
  'Tentativas do servidor de criar/vincular o negócio no Bitrix (0362).';
comment on column public.qs_leads.bitrix_card_proxima is
  'Próxima tentativa permitida (recuo) da rotina de card no Bitrix (0362).';
comment on column public.qs_leads.bitrix_card_trava is
  'Trava curta: um processo está criando o card deste lead até este instante (0362).';

-- Fila da rotina: só os leads sem card, pela próxima tentativa.
create index if not exists qs_leads_bitrix_card_fila_idx
  on public.qs_leads (bitrix_card_proxima nulls first)
  where bitrix_id is null;

create or replace function public.qs_leads_bitrix_card_estado()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(coalesce(new.bitrix_id, '')), '') is not null then
    -- Tem card: está amarrado.
    if tg_op = 'INSERT'
       or nullif(btrim(coalesce(old.bitrix_id, '')), '') is distinct from nullif(btrim(new.bitrix_id), '')
       or new.bitrix_card_status is distinct from 'ok' then
      new.bitrix_card_status := 'ok';
      new.bitrix_card_erro := null;
      new.bitrix_card_proxima := null;
      new.bitrix_card_trava := null;
    end if;
  elsif tg_op = 'INSERT' then
    -- Nasceu sem card: pendência até o servidor criar ou vincular.
    if new.bitrix_card_status is null or new.bitrix_card_status = 'ok' then
      new.bitrix_card_status := 'pendente';
    end if;
    if new.bitrix_card_proxima is null then
      new.bitrix_card_proxima := now() + interval '10 minutes';
    end if;
  elsif nullif(btrim(coalesce(old.bitrix_id, '')), '') is not null then
    -- Perdeu o card (o vínculo foi pra outro lead): não entra sozinho na fila.
    new.bitrix_card_status := null;
    new.bitrix_card_proxima := null;
    new.bitrix_card_trava := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_qs_leads_bitrix_card on public.qs_leads;
create trigger trg_qs_leads_bitrix_card
  before insert or update of bitrix_id, bitrix_card_status on public.qs_leads
  for each row execute function public.qs_leads_bitrix_card_estado();
