-- 0073_carteira_de_leads.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- -- O QUE E ISTO -----------------------------------------------------------
--
-- A CARTEIRA: o vinculo permanente entre um CLIENTE e o SDR dele.
--
-- Hoje o dono de um lead e sorteado no rodizio a cada entrada. Quando a mesma
-- pessoa volta — e ela volta muito: 583 cards sem `bitrix_id` tem um card irmao
-- do mesmo telefone — ela cai com outro SDR, que comeca do zero uma conversa
-- que ja tinha historia. Ninguem e dono de ninguem, e por isso ninguem responde
-- pela qualidade do relacionamento.
--
-- A carteira inverte isso: quem ja e seu, continua seu.
--
-- -- A CHAVE E O TELEFONE, NAO O lead_id -------------------------------------
--
-- Essa e a decisao central, e ela nasce do problema: o `lead_id` muda toda vez
-- que a pessoa entra de novo (card novo, id novo). Uma carteira chaveada por
-- lead nao amarraria nada — quebraria exatamente no caso que ela existe pra
-- resolver.
--
-- A chave e `qs_wa_key(telefone)`, a mesma da 0057, que ignora o +55, o DDI
-- grudado e o nono digito. Sao as tres formas do MESMO numero aparecer
-- diferente entre Bitrix, Chatwoot e formulario da LP — casar por string crua
-- recriaria o duplicado que estamos tentando matar.
--
-- -- TRANSFERENCIA TEMPORARIA E UM CAMPO, NAO OUTRA CARTEIRA -----------------
--
-- Alguem adoece e a carteira precisa ser coberta por uma semana. Se isso fosse
-- feito trocando o `sdr_id`, alguem teria que LEMBRAR de desfazer — e ninguem
-- lembra. Entao o titular nao muda: entram `substituto_id` e `substituto_ate`,
-- e a cobertura CAI SOZINHA no vencimento. Voltar da doenca nao depende de
-- ninguem executar nada.
-- ---------------------------------------------------------------------------


-- -- (1) A TABELA -------------------------------------------------------------
create table if not exists public.qs_carteira (
  chave_telefone   text primary key,
  sdr_id           uuid not null references qs_users(id) on delete cascade,
  desde            timestamptz not null default now(),
  -- Como este cliente virou desta carteira. Serve pra auditoria e pra saber o
  -- que a redistribuicao pode mexer sem passar por cima de decisao humana.
  motivo           text not null default 'primeiro-contato'
                   check (motivo in ('primeiro-contato','transferencia','redistribuicao','manual','carga-inicial')),
  -- Cobertura temporaria (doenca, ferias). O titular NAO muda.
  substituto_id    uuid references qs_users(id) on delete set null,
  substituto_ate   date,
  substituto_nota  text,
  atualizado_em    timestamptz not null default now()
);

comment on table public.qs_carteira is
  'Um cliente (por telefone normalizado) pertence a UM SDR. Quem ja e seu continua seu, mesmo voltando com outro card e outro bitrix_id.';
comment on column public.qs_carteira.chave_telefone is
  'qs_wa_key(telefone): ignora +55 e o nono digito. NAO usar lead_id — ele muda a cada card novo, que e o proprio problema que a carteira resolve.';
comment on column public.qs_carteira.substituto_ate is
  'Ultimo dia da cobertura. Vencido, o titular volta SOZINHO — cobertura que depende de alguem lembrar de desfazer nao volta nunca.';

create index if not exists idx_qs_carteira_sdr on public.qs_carteira (sdr_id);
create index if not exists idx_qs_carteira_substituto on public.qs_carteira (substituto_id)
  where substituto_id is not null;


-- -- (2) QUEM ATENDE ESTE CLIENTE HOJE ----------------------------------------
--
-- Uma funcao so, usada pelo app e pelo `lead-inbound`. Regra: o substituto vale
-- ENQUANTO a data nao passou; fora disso e o titular. Substituto inativo nao
-- vale — cobrir com quem saiu da empresa seria pior que nao cobrir.
create or replace function public.qs_carteira_dono(p_chave text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select case
           when c.substituto_id is not null
            and c.substituto_ate is not null
            and c.substituto_ate >= (now() at time zone 'America/Sao_Paulo')::date
            and exists (select 1 from qs_users u where u.id = c.substituto_id and u.is_active)
           then c.substituto_id
           else c.sdr_id
         end
    from qs_carteira c
   where c.chave_telefone = p_chave;
$$;

comment on function public.qs_carteira_dono(text) is
  'Quem atende este cliente HOJE: o substituto dentro do prazo, senao o titular.';

-- Versao que aceita o telefone cru — e a que o servidor chama, pra normalizacao
-- morar num lugar so. Devolve NULL quando nao ha carteira (cai no rodizio).
create or replace function public.qs_carteira_do_telefone(p_telefone text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select qs_carteira_dono(qs_wa_key(p_telefone));
$$;


-- Registra (sem sobrescrever) que este telefone e deste SDR. O SERVIDOR CHAMA
-- ESTA, e nao monta a chave do lado dele: existe um `waKey` em JavaScript
-- (api/_wa.js) que NAO e identico ao `qs_wa_key` — ele tem um caminho a mais
-- pra numero internacional. Duas implementacoes da mesma chave e uma promessa
-- de divergencia silenciosa: a carteira seria gravada com uma chave e
-- consultada com outra, e ninguem descobriria ate um cliente estrangeiro voltar
-- pro SDR errado. A chave mora AQUI, e so aqui.
--
-- `on conflict do nothing`: quem JA tem carteira nao e sobrescrito. Lead novo
-- nunca rouba cliente de outro SDR.
create or replace function public.qs_carteira_registrar(
  p_telefone text, p_sdr uuid, p_motivo text default 'primeiro-contato'
) returns text
language plpgsql security definer
set search_path = public
as $$
declare k text;
begin
  k := qs_wa_key(p_telefone);
  if k is null or p_sdr is null then return null; end if;
  insert into qs_carteira (chave_telefone, sdr_id, motivo)
  values (k, p_sdr, coalesce(p_motivo, 'primeiro-contato'))
  on conflict (chave_telefone) do nothing;
  return k;
end $$;


-- -- (3) CARGA INICIAL --------------------------------------------------------
--
-- A carteira nasce do que JA EXISTE: cada telefone vai pro dono do card mais
-- RECENTE dele. Mais recente, e nao o primeiro, porque transferencia feita a mao
-- ao longo dos meses e uma decisao que ja foi tomada — comecar pelo primeiro
-- desfaria todas de uma vez.
--
-- `on conflict do nothing` deixa o arquivo repetivel: rodar de novo nao
-- sobrescreve carteira que ja foi ajustada na tela.
insert into public.qs_carteira (chave_telefone, sdr_id, desde, motivo)
select distinct on (qs_wa_key(l.phone))
       qs_wa_key(l.phone), l.owner_id, l.created_at, 'carga-inicial'
  from qs_leads l
  join qs_users u on u.id = l.owner_id
 where l.phone is not null
   and qs_wa_key(l.phone) is not null
   and u.is_active
   and u.role in ('sdr','closer','gestor','admin')
 order by qs_wa_key(l.phone), l.created_at desc
on conflict (chave_telefone) do nothing;


-- -- (4) QUEM PODE VER ---------------------------------------------------------
alter table public.qs_carteira enable row level security;

-- O SDR ve a carteira DELE (e a que ele esta cobrindo). A gestao ve tudo.
drop policy if exists carteira_select on public.qs_carteira;
create policy carteira_select on public.qs_carteira
  for select to authenticated
  using (qs_is_manager() or sdr_id = auth.uid() or substituto_id = auth.uid());

-- Escrever na carteira e MEXER NA CARTEIRA DOS OUTROS: transferir tira de um e
-- da pra outro. Isso e decisao de gestao. O servidor (service_role) ignora RLS
-- e continua podendo gravar no `lead-inbound`.
drop policy if exists carteira_write on public.qs_carteira;
create policy carteira_write on public.qs_carteira
  for all to authenticated
  using (qs_is_manager()) with check (qs_is_manager());


-- -- (5) CARTEIRA ORFA: SDR DESATIVADO -----------------------------------------
--
-- Quando o SDR sai, a carteira dele NAO e redistribuida sozinha (Bruno, 01/09):
-- "deve pedir para o gestor que confirme isso". Redistribuicao automatica no
-- desligamento e o tipo de coisa que acontece no domingo e ninguem entende na
-- segunda.
--
-- Entao a view so MOSTRA o que esta orfao. Quem divide e a tela de gestao,
-- chamando qs_carteira_redistribuir.
create or replace view public.qs_carteira_orfas as
  select c.chave_telefone, c.sdr_id, u.name as sdr_nome, c.desde, c.motivo
    from qs_carteira c
    join qs_users u on u.id = c.sdr_id
   where u.is_active = false;

comment on view public.qs_carteira_orfas is
  'Carteiras cujo titular esta desativado. Esperando a gestao confirmar a divisao — nunca redistribuidas sozinhas.';

-- Divide as carteiras de UM titular igualmente entre os SDRs ativos.
-- Devolve quantas foram movidas. So gestao executa.
create or replace function public.qs_carteira_redistribuir(p_sdr uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  destinos uuid[];
  movidas  integer := 0;
begin
  if not qs_is_manager() then
    raise exception 'Só administrador ou gestor redistribui carteira';
  end if;

  select array_agg(id order by id) into destinos
    from qs_users where is_active and role = 'sdr' and id <> p_sdr;

  if destinos is null or array_length(destinos, 1) = 0 then
    raise exception 'Não há SDR ativo para receber a carteira';
  end if;

  -- Rodizio estavel: ordena por chave e distribui em volta. Divisao igual sem
  -- aleatoriedade — rodar duas vezes da o mesmo resultado, o que importa quando
  -- alguem precisa conferir depois o que aconteceu.
  with alvo as (
    select chave_telefone,
           destinos[1 + (row_number() over (order by chave_telefone) - 1)
                        % array_length(destinos, 1)] as novo
      from qs_carteira where sdr_id = p_sdr
  )
  update qs_carteira c
     set sdr_id = a.novo,
         motivo = 'redistribuicao',
         substituto_id = null, substituto_ate = null, substituto_nota = null,
         atualizado_em = now()
    from alvo a
   where c.chave_telefone = a.chave_telefone;

  get diagnostics movidas = row_count;
  return movidas;
end $$;


-- -- CONFERENCIA DEPOIS DE COLAR ----------------------------------------------
--
-- Tamanho da carteira de cada um:
--   select u.name, count(*) from qs_carteira c join qs_users u on u.id=c.sdr_id
--    group by u.name order by 2 desc;
--
-- Sobrou telefone sem carteira? (esperado: leads sem dono ou com numero torto)
--   select count(*) from qs_leads l
--    where l.phone is not null and qs_wa_key(l.phone) is not null
--      and not exists (select 1 from qs_carteira c where c.chave_telefone = qs_wa_key(l.phone));
--
-- Tem carteira orfa esperando a gestao?
--   select sdr_nome, count(*) from qs_carteira_orfas group by 1;
