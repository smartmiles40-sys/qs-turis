-- 0360_rel_checkin_espelho_expedicoes.sql
-- -----------------------------------------------------------------------------
-- CHECK-IN NOS DOIS SENTIDOS: Expedições ↔ Relacionamento (Bruno, 11/11/2026):
--   "juntar o check-in: 'check-in online feito' do sistema de Expedições ↔
--    checkin_feito_em dos trechos do Rel, nos dois sentidos, sem laço infinito
--    e com histórico" + mostrar na aba Check-ins quem marcou e de onde.
--
-- O VÍNCULO: rel_expedicoes_vinculo (passageiro de Expedições → viagem do Rel,
-- 0112; 831 dos 988 passageiros têm vínculo). Expedições tem UM booleano por
-- passageiro (passageiros.checkin_online_feito); o Rel tem um por trecho de
-- voo. A ponte:
--
--   Expedições → Rel  (passageiros.checkin_online_feito muda)
--     • virou TRUE: marca o check-in do PRÓXIMO deslocamento da viagem — o 1º
--       voo futuro (com bilhete) ainda sem check-in e os que saem até 24h
--       depois dele (as conexões). Origem = 'expedicoes'.
--     • virou FALSE (desmarcado na tela de Expedições): desmarca os voos
--       futuros que FORAM marcados por Expedições — se nenhum outro passageiro
--       da mesma viagem (casal/família) ainda estiver com check-in feito.
--     • ESPELHO LIGADO (exp.espelho = 'on', o app antigo ainda é a fonte): só o
--       TRUE passa. O espelho regrava a linha inteira do antigo quando ela muda
--       lá — um FALSE vindo dele é só o antigo sem saber do Rel, e não pode
--       apagar check-in feito aqui.
--   Rel → Expedições  (rel_viagem_trechos.checkin_feito_em muda num voo)
--     • checkin_online_feito dos passageiros vinculados à viagem = existe algum
--       voo da viagem (não cancelado) com check-in feito.
--     • Com o espelho ligado o valor é gravado no QS (as telas de Expedições do
--       QS mostram), mas o app antigo não fica sabendo — e se a linha mudar lá,
--       o espelho volta o QS pro valor do antigo (o Rel continua marcado). Na
--       TROCA (desligar o espelho) rode uma vez:
--           select rel_checkin_ressincronizar();
--
-- SEM LAÇO: cada lado liga set_config('rel.checkin_sync', 'expedicoes'|'rel',
-- true) antes de gravar no outro e desliga depois; o gatilho do outro lado sai
-- na hora quando a marca está ligada.
--
-- HISTÓRICO:
--   • Rel: rel_viagem_trechos.checkin_origem ('rel' | 'expedicoes') + cada
--     marcação vinda de Expedições vira linha em rel_viagem_correcoes
--     (acao 'trecho_checkin', motivo "Check-in marcado no sistema de
--     Expedições (nome)"). A marcação feita no Rel já grava lá pela RPC
--     rel_trecho_checkin (0227).
--   • Expedições: o audit_log de passageiros (trg_passageiros_audit) registra a
--     mudança feita pelo Rel, com o usuário.
--   • rel_trechos_v ganha checkin_origem e checkin_feito_por_nome (aba Check-ins).
--
-- Trecho corrigido à mão: rel_trecho_respeita_correcao (0227) barra o
-- automático (service_role, ex. o espelho) — a ponte liga
-- rel.correcao_manual = '1' só no update dela, como rel_trecho_aplicar faz.
--
-- DEPENDE DA 0359 (rel_venda_tem_aereo, rel_voo_na_janela e as colunas da
-- rel_trechos_v): aplicar a 0359 ANTES. Idempotente. Volta no fim (comentado).
-- -----------------------------------------------------------------------------

-- 1. de onde veio o check-in ---------------------------------------------------
alter table rel_viagem_trechos add column if not exists checkin_origem text;
alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_checkin_origem_check;
alter table rel_viagem_trechos add constraint rel_viagem_trechos_checkin_origem_check
  check (checkin_origem is null or checkin_origem in ('rel', 'expedicoes'));

-- marcação que já existia (feita no Rel; hoje são 0)
update rel_viagem_trechos set checkin_origem = 'rel'
 where checkin_feito_em is not null and checkin_origem is null;

-- BEFORE UPDATE: carimba a origem. Nome com "zz" pra rodar DEPOIS do
-- rel_trecho_respeita_correcao_upd (gatilhos BEFORE rodam em ordem alfabética),
-- que pode desfazer o check-in do automático em trecho corrigido.
create or replace function rel_trg_trecho_checkin_origem()
returns trigger language plpgsql as $$
begin
  if new.checkin_feito_em is distinct from old.checkin_feito_em then
    new.checkin_origem := case
      when new.checkin_feito_em is null then null
      when coalesce(current_setting('rel.checkin_sync', true), '') = 'expedicoes' then 'expedicoes'
      else 'rel' end;
  end if;
  return new;
end;
$$;
drop trigger if exists rel_trecho_zz_checkin_origem on rel_viagem_trechos;
create trigger rel_trecho_zz_checkin_origem before update of checkin_feito_em on rel_viagem_trechos
  for each row execute function rel_trg_trecho_checkin_origem();

-- 2. Rel → Expedições ----------------------------------------------------------
create or replace function rel_trg_checkin_para_expedicoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_feito boolean;
begin
  if coalesce(current_setting('rel.checkin_sync', true), '') <> '' then return null; end if;   -- veio da ponte
  if new.tipo not in ('voo_internacional', 'voo_interno') then return null; end if;
  if new.checkin_feito_em is not distinct from old.checkin_feito_em then return null; end if;
  if not exists (select 1 from rel_expedicoes_vinculo where viagem_id = new.viagem_id) then return null; end if;
  select exists (select 1 from rel_viagem_trechos x
                  where x.viagem_id = new.viagem_id and x.tipo in ('voo_internacional', 'voo_interno')
                    and x.checkin_feito_em is not null and x.status_manual is distinct from 'cancelado')
    into v_feito;
  -- falha na ponte nunca impede o check-in do Rel: vira aviso no log
  begin
    perform set_config('rel.checkin_sync', 'rel', true);
    update passageiros p set checkin_online_feito = v_feito
      from rel_expedicoes_vinculo l
     where l.viagem_id = new.viagem_id and p.id = l.passageiro_id
       and p.checkin_online_feito is distinct from v_feito;
    perform set_config('rel.checkin_sync', '', true);
  exception when others then
    perform set_config('rel.checkin_sync', '', true);
    raise warning 'rel_trg_checkin_para_expedicoes (viagem %): %', new.viagem_id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists rel_trecho_checkin_para_expedicoes on rel_viagem_trechos;
create trigger rel_trecho_checkin_para_expedicoes after update of checkin_feito_em on rel_viagem_trechos
  for each row execute function rel_trg_checkin_para_expedicoes();

-- 3. Expedições → Rel ----------------------------------------------------------
create or replace function rel_trg_checkin_de_expedicoes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_espelho boolean := coalesce(current_setting('exp.espelho', true), '') = 'on';
  v_viagem uuid;
  v_p0 timestamptz;
  t rel_viagem_trechos;
  v_antes jsonb;
begin
  if coalesce(current_setting('rel.checkin_sync', true), '') <> '' then return null; end if;   -- veio da ponte
  if new.checkin_online_feito is not distinct from old.checkin_online_feito then return null; end if;
  if v_espelho and not coalesce(new.checkin_online_feito, false) then return null; end if;   -- FALSE do antigo não apaga

  for v_viagem in select l.viagem_id from rel_expedicoes_vinculo l where l.passageiro_id = new.id and l.viagem_id is not null loop
   -- falha na ponte nunca impede a gravação em Expedições (nem a rodada do espelho)
   begin
    perform set_config('rel.checkin_sync', 'expedicoes', true);
    perform set_config('rel.correcao_manual', '1', true);
    if coalesce(new.checkin_online_feito, false) then
      -- o próximo deslocamento: 1º voo futuro (com bilhete) sem check-in + conexões até 24h depois
      select min(x.partida_em) into v_p0 from rel_viagem_trechos x
       where x.viagem_id = v_viagem and x.tipo in ('voo_internacional', 'voo_interno')
         and x.status_manual is null and x.checkin_feito_em is null and x.partida_em > now()
         and x.fonte is distinct from 'bitrix';
      if v_p0 is not null then
        for t in select * from rel_viagem_trechos x
                  where x.viagem_id = v_viagem and x.tipo in ('voo_internacional', 'voo_interno')
                    and x.status_manual is null and x.checkin_feito_em is null and x.fonte is distinct from 'bitrix'
                    and x.partida_em between v_p0 and v_p0 + interval '24 hours'
                  for update loop
          v_antes := rel_trecho_restauravel(t);
          update rel_viagem_trechos set checkin_feito_em = now(), checkin_feito_por = auth.uid() where id = t.id;
          insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
          values (v_viagem, t.id, 'trecho_checkin', v_antes,
                  v_antes || jsonb_build_object('checkin_feito_em', now(), 'checkin_feito_por', auth.uid()),
                  'Check-in marcado no sistema de Expedições' || coalesce(' (' || new.nome_completo || ')', '')
                    || case when v_espelho then ' — via espelho do app antigo' else '' end,
                  auth.uid());
        end loop;
      end if;
    elsif not exists (select 1 from rel_expedicoes_vinculo l2 join passageiros p2 on p2.id = l2.passageiro_id
                       where l2.viagem_id = v_viagem and p2.id <> new.id and p2.checkin_online_feito) then
      for t in select * from rel_viagem_trechos x
                where x.viagem_id = v_viagem and x.checkin_origem = 'expedicoes'
                  and x.checkin_feito_em is not null and x.partida_em > now()
                for update loop
        v_antes := rel_trecho_restauravel(t);
        update rel_viagem_trechos set checkin_feito_em = null, checkin_feito_por = null where id = t.id;
        insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
        values (v_viagem, t.id, 'trecho_checkin', v_antes,
                v_antes || jsonb_build_object('checkin_feito_em', null, 'checkin_feito_por', null),
                'Check-in desmarcado no sistema de Expedições' || coalesce(' (' || new.nome_completo || ')', ''),
                auth.uid());
      end loop;
    end if;
    perform set_config('rel.correcao_manual', '', true);
    perform set_config('rel.checkin_sync', '', true);
   exception when others then
    perform set_config('rel.correcao_manual', '', true);
    perform set_config('rel.checkin_sync', '', true);
    raise warning 'rel_trg_checkin_de_expedicoes (passageiro %, viagem %): %', new.id, v_viagem, sqlerrm;
   end;
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_passageiros_checkin_para_rel on passageiros;
create trigger trg_passageiros_checkin_para_rel after update of checkin_online_feito on passageiros
  for each row execute function rel_trg_checkin_de_expedicoes();

-- 4. Na troca do espelho: o QS de Expedições recebe o que o Rel já sabe -------
-- (só SQL / service_role; não fica exposto pra tela). Só liga (nunca desliga).
create or replace function rel_checkin_ressincronizar()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('rel.checkin_sync', 'rel', true);
  with alvo as (
    select l.passageiro_id,
           bool_or(x.checkin_feito_em is not null and x.status_manual is distinct from 'cancelado') as feito
      from rel_expedicoes_vinculo l
      join rel_viagem_trechos x on x.viagem_id = l.viagem_id and x.tipo in ('voo_internacional', 'voo_interno')
     group by l.passageiro_id)
  update passageiros p set checkin_online_feito = true
    from alvo a
   where a.passageiro_id = p.id and a.feito and not p.checkin_online_feito;
  get diagnostics n = row_count;
  perform set_config('rel.checkin_sync', '', true);
  return n;
end;
$$;
revoke all on function rel_checkin_ressincronizar() from public, anon, authenticated;
revoke all on function rel_trg_checkin_para_expedicoes() from public, anon, authenticated;
revoke all on function rel_trg_checkin_de_expedicoes() from public, anon, authenticated;

-- 5. A view mostra quem marcou e de onde (definição da 0359 + 2 colunas no fim) -
create or replace view rel_trechos_v with (security_invoker = true) as
 SELECT t.id,
    t.viagem_id,
    t.tipo,
    t.descricao,
    t.origem,
    t.destino,
    t.partida_em,
    t.chegada_em,
    t.companhia,
    t.numero,
    t.localizador,
    t.checkin_abre_em,
    t.checkin_feito_em,
    t.checkin_feito_por,
    t.criado_por,
    t.criado_em,
    t.ref_externa,
    t.fonte,
    t.ia_confianca,
    t.documento_id,
    t.origem_codigo,
    t.destino_codigo,
    t.partida_fuso,
    t.chegada_fuso,
    t.terminal_partida,
    t.terminal_chegada,
    t.classe,
    t.bagagem,
    t.assento,
    t.numero_bilhete,
    t.passageiros,
    t.ponto_encontro,
    t.contato,
    t.endereco,
    t.observacoes,
    COALESCE(t.checkin_abre_em,
        CASE
            WHEN (t.tipo = ANY (ARRAY['voo_internacional'::text, 'voo_interno'::text])) THEN (t.partida_em - '48:00:00'::interval)
            WHEN (t.tipo = 'trem'::text) THEN (t.partida_em - '24:00:00'::interval)
            ELSE NULL::timestamp with time zone
        END) AS checkin_em,
    v.tipo AS viagem_tipo,
    v.titulo AS viagem_titulo,
    v.destino AS viagem_destino,
    v.expedicao,
    v.status AS viagem_status,
    t.status_manual,
    t.status_manual_motivo,
    t.status_manual_por,
    t.status_manual_em,
    t.corrigido_em,
    t.corrigido_por,
    -- 0359
    a.aereo AS viagem_aereo_vendido,
    ((t.tipo = ANY (ARRAY['voo_internacional'::text, 'voo_interno'::text]))
      AND (t.status_manual IS DISTINCT FROM 'cancelado'::text)
      AND rel_voo_na_janela(t.partida_em, v.data_embarque, v.data_retorno)
      AND ((t.fonte IS DISTINCT FROM 'bitrix'::text)
           OR (a.aereo AND NOT EXISTS (
                 SELECT 1 FROM rel_viagem_trechos x
                  WHERE x.viagem_id = t.viagem_id AND x.tipo ~~ 'voo%'::text
                    AND x.fonte IS DISTINCT FROM 'bitrix'::text
                    AND x.status_manual IS DISTINCT FROM 'cancelado'::text
                    AND rel_voo_na_janela(x.partida_em, v.data_embarque, v.data_retorno))))) AS conta_como_voo,
    -- 0360: quem marcou o check-in e de onde
    t.checkin_origem,
    (SELECT u.name FROM qs_users u WHERE u.id = t.checkin_feito_por) AS checkin_feito_por_nome
   FROM (rel_viagem_trechos t
     JOIN rel_viagens v ON ((v.id = t.viagem_id)))
     CROSS JOIN LATERAL (SELECT rel_venda_tem_aereo(COALESCE(v.servico_manual, rel_servico_auto(v.tipo, v.bitrix_dados)), v.bitrix_dados) AS aereo) a;

-- Conferência depois de aplicar (só leitura):
--   select checkin_origem, count(*) from rel_viagem_trechos where checkin_feito_em is not null group by 1;
--   select tgname from pg_trigger where tgname in ('rel_trecho_zz_checkin_origem', 'rel_trecho_checkin_para_expedicoes', 'trg_passageiros_checkin_para_rel');

-- Volta:
--   drop trigger if exists trg_passageiros_checkin_para_rel on passageiros;
--   drop trigger if exists rel_trecho_checkin_para_expedicoes on rel_viagem_trechos;
--   drop trigger if exists rel_trecho_zz_checkin_origem on rel_viagem_trechos;
--   drop function if exists rel_checkin_ressincronizar();
--   drop function if exists rel_trg_checkin_de_expedicoes();
--   drop function if exists rel_trg_checkin_para_expedicoes();
--   drop function if exists rel_trg_trecho_checkin_origem();
--   rel_trechos_v: `drop view rel_trechos_v;` e recriar pela 0359 (CREATE OR
--   REPLACE não tira coluna); depois
--   alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_checkin_origem_check;
--   alter table rel_viagem_trechos drop column if exists checkin_origem;
