-- 0361_rel_trechos_da_venda.sql
-- -----------------------------------------------------------------------------
-- VENDA NOVA → TRECHOS DA VIAGEM DO REL, SOZINHO (Bruno, decisão 4, 11/11/2026).
-- Ao CONSOLIDAR a venda (qs_vendas.estado = 'consolidada', com viagem_id), os
-- itens viram trechos em rel_viagem_trechos — o próximo voo, a aba Check-ins e
-- a aba Serviços passam a enxergar a venda sem ninguém digitar de novo.
--
-- ORIGEM PRÓPRIA: fonte = 'venda', venda_id / venda_item_id e
-- ref_externa = 'venda:<item>:<chave>' (o índice único (viagem_id, ref_externa)
-- da 0112 faz o re-consolidar ATUALIZAR em vez de duplicar). Só os trechos de
-- fonte 'venda' são tocados — os da IA, de Expedições, do Bitrix e os à mão
-- ficam como estão.
--
-- O QUE VIRA TRECHO (rel_venda_trechos_desejados):
--   • AÉREO — item "aereo" sempre; "pacote"/"outro" com dados.aereo_incluso =
--     sim (mesma regra de src/venda/iata.ts › precisaDeTrechos). Cada elemento
--     de dados.trechos (formato documentado em src/venda/iata.ts — mesmas
--     chaves de rel_viagem_trechos) vira UM trecho de voo, chave 'voo:<ordem>'.
--     PENDENTE (sem código IATA de 3 letras na origem OU no destino — veio só
--     origem_texto/destino_texto, ex. "Europa") ou sem data: NÃO vira trecho.
--     Motivo: o Bruno quer "SOMENTE os IATAs"; um voo "GRU→Europa" entraria no
--     próximo voo e nos Check-ins como se fosse certo. O consolidar já barra
--     trecho inválido na tela (iata.ts); se escapar, o closer corrige o código
--     na venda e, ao salvar/consolidar de novo, o trecho aparece.
--   • HOTEL (hospedagem): check-in = data_inicio + dados.checkin_hora,
--     check-out = data_fim + dados.checkout_hora; cidade, endereço.
--   • PASSEIO: data_inicio + dados.hora; ponto de encontro = dados.local.
--   • TRANSFER: data_inicio + dados.hora; de → para.
--   • TREM: data_inicio + dados.saida (chegada = data_fim/início + dados.chegada).
--   • SEGURO: tipo novo 'seguro' — começa em data_inicio, termina em data_fim.
--   • CARRO e CRUZEIRO: tipo 'outro' (retirada/devolução, embarque/desembarque).
--   • Expedição, visto e concierge: não viram trecho (expedição tem os voos do
--     grupo cadastrados pelo Operacional).
--   Item cancelado (status = 'cancelado') não vira trecho.
--
-- HORA: a do bilhete/voucher (local). Sem o fuso do lugar no banco, o instante
-- é gravado como se a hora fosse de Brasília (partida_fuso vazio) — a tela
-- mostra exatamente a hora digitada. Sem hora → 00:00 = "sem horário" (mesma
-- regra do resto do Rel). Chegada antes da partida (fuso) → chegada vazia.
--
-- ATUALIZA / REMOVE: re-consolidar ou editar item de venda consolidada
-- re-sincroniza: o que mudou atualiza (menos trecho CORRIGIDO À MÃO no Rel, que
-- fica como o time deixou); o que saiu da venda é APAGADO — ou, se já tem
-- check-in feito / correção manual, fica CANCELADO ("Saiu da venda").
-- VENDA CANCELADA (venda_cancelar → estado 'cancelada'): os trechos de origem
-- venda ficam CANCELADOS (status_manual, motivo "Venda cancelada"; saem do
-- próximo voo e dos Check-ins). Se a venda voltar a ser consolidada, voltam.
--
-- QUANDO: gatilho em qs_vendas (estado consolidada/cancelada, troca de viagem
-- ou re-consolidar) e em qs_venda_itens (item mudou numa venda consolidada).
-- Sem reescrever venda_consolidar / venda_cancelar (0357). Falha aqui vira
-- WARNING no log e nunca barra a venda.
--
-- No próximo voo / Check-ins: fonte 'venda' é voo de verdade (≠ 'bitrix'), e a
-- venda com aéreo tem serviço aéreo/pacote — vale como as demais (0359).
--
-- Idempotente. Volta no fim (comentado). Inclui a sincronização das vendas já
-- consolidadas (hoje: nenhuma).
-- -----------------------------------------------------------------------------

-- 1. colunas e valores novos ----------------------------------------------------
alter table rel_viagem_trechos add column if not exists venda_id uuid;
alter table rel_viagem_trechos add column if not exists venda_item_id uuid;
create index if not exists rel_viagem_trechos_venda_idx on rel_viagem_trechos (venda_id) where venda_id is not null;

alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_fonte_check;
alter table rel_viagem_trechos add constraint rel_viagem_trechos_fonte_check
  check (fonte in ('manual', 'expedicoes', 'bitrix', 'ia', 'venda'));
alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_tipo_check;
alter table rel_viagem_trechos add constraint rel_viagem_trechos_tipo_check
  check (tipo in ('voo_internacional', 'voo_interno', 'trem', 'transfer', 'hospedagem', 'passeio', 'seguro', 'outro'));

-- 2. data + hora (texto) → instante; data inválida = null ------------------------
create or replace function _rel_venda_ts(p_data text, p_hora text)
returns timestamptz language sql stable set search_path = public as $$
  select case when coalesce(p_data, '') ~ '^\d{4}-\d{2}-\d{2}' then
    (left(p_data, 10) || ' ' ||
     case when coalesce(p_hora, '') ~ '^\d{1,2}:\d{2}' then substring(p_hora from '^\d{1,2}:\d{2}') else '00:00' end
    )::timestamp at time zone 'America/Sao_Paulo' end;
$$;

-- 3. o que a venda quer na viagem (só leitura) ------------------------------------
create or replace function rel_venda_trechos_desejados(p_venda uuid)
returns table (
  ref_externa text, venda_item_id uuid, tipo text, descricao text, origem text, destino text,
  origem_codigo text, destino_codigo text, partida_em timestamptz, chegada_em timestamptz,
  companhia text, numero text, localizador text, classe text, bagagem text, assento text,
  endereco text, ponto_encontro text, observacoes text)
language sql stable security definer set search_path = public as $$
  with itens as (
    select i.* from qs_venda_itens i
     where i.venda_id = p_venda and i.status is distinct from 'cancelado'
  ),
  voos as (
    select 'venda:' || i.id || ':voo:' || coalesce(nullif(t ->> 'ordem', ''), n::text) as ref_externa,
           i.id as venda_item_id,
           case when t ->> 'tipo' in ('voo_internacional', 'voo_interno') then t ->> 'tipo' else 'voo_internacional' end as tipo,
           concat_ws(' — ', case t ->> 'sentido' when 'ida' then 'Ida' when 'volta' then 'Volta' when 'interno' then 'Voo interno' end,
                     case when (t ->> 'conexao')::text = 'true' then 'conexão' end, 'da venda') as descricao,
           nullif(t ->> 'origem', '') as origem, nullif(t ->> 'destino', '') as destino,
           upper(t ->> 'origem_codigo') as origem_codigo, upper(t ->> 'destino_codigo') as destino_codigo,
           _rel_venda_ts(t ->> 'data', t ->> 'hora_saida') as partida_em,
           _rel_venda_ts(coalesce(nullif(t ->> 'chegada_data', ''), t ->> 'data'), t ->> 'hora_chegada') as chegada0,
           nullif(t ->> 'hora_chegada', '') as hora_chegada,
           nullif(t ->> 'companhia', '') as companhia, nullif(t ->> 'numero', '') as numero,
           nullif(t ->> 'localizador', '') as localizador, nullif(t ->> 'classe', '') as classe,
           nullif(t ->> 'bagagem', '') as bagagem
      from itens i
      cross join lateral jsonb_array_elements(case when jsonb_typeof(i.dados -> 'trechos') = 'array' then i.dados -> 'trechos' else '[]'::jsonb end)
                         with ordinality e(t, n)
     where (i.tipo = 'aereo'
            or (i.tipo in ('pacote', 'outro') and lower(coalesce(i.dados ->> 'aereo_incluso', '')) in ('sim', 'true')))
       and coalesce(t ->> 'origem_codigo', '') ~ '^[A-Za-z]{3}$'
       and coalesce(t ->> 'destino_codigo', '') ~ '^[A-Za-z]{3}$'
       and coalesce(t ->> 'data', '') ~ '^\d{4}-\d{2}-\d{2}'
  ),
  servicos as (
    select 'venda:' || i.id || ':' || i.tipo as ref_externa, i.id as venda_item_id,
           case i.tipo when 'hospedagem' then 'hospedagem' when 'passeio' then 'passeio' when 'transfer' then 'transfer'
                       when 'trem' then 'trem' when 'seguro' then 'seguro' else 'outro' end as tipo,
           coalesce(nullif(trim(i.nome), ''), case i.tipo when 'carro' then 'Carro' when 'cruzeiro' then 'Cruzeiro' when 'seguro' then 'Seguro viagem'
                                                      when 'hospedagem' then 'Hospedagem' when 'passeio' then 'Passeio' when 'transfer' then 'Transfer' else 'Trem' end) as descricao,
           nullif(case i.tipo when 'transfer' then i.dados ->> 'de' when 'trem' then i.dados ->> 'de'
                              when 'carro' then i.dados ->> 'retirada_local' when 'cruzeiro' then i.dados ->> 'porto_embarque'
                              when 'hospedagem' then i.dados ->> 'cidade' when 'passeio' then i.dados ->> 'local' end, '') as origem,
           nullif(case i.tipo when 'transfer' then i.dados ->> 'para' when 'trem' then i.dados ->> 'para'
                              when 'carro' then i.dados ->> 'devolucao_local' when 'cruzeiro' then i.dados ->> 'porto_desembarque'
                              when 'hospedagem' then i.dados ->> 'cidade' when 'passeio' then i.dados ->> 'local' end, '') as destino,
           _rel_venda_ts(i.data_inicio::text, case i.tipo when 'hospedagem' then i.dados ->> 'checkin_hora'
                                                          when 'passeio' then i.dados ->> 'hora' when 'transfer' then i.dados ->> 'hora'
                                                          when 'trem' then i.dados ->> 'saida' when 'carro' then i.dados ->> 'retirada_hora' end) as partida_em,
           case when i.tipo in ('hospedagem', 'seguro', 'carro', 'cruzeiro') and i.data_fim is not null then
                  _rel_venda_ts(i.data_fim::text, case i.tipo when 'hospedagem' then i.dados ->> 'checkout_hora' when 'carro' then i.dados ->> 'devolucao_hora' end)
                when i.tipo = 'trem' and nullif(i.dados ->> 'chegada', '') is not null then
                  _rel_venda_ts(coalesce(i.data_fim, i.data_inicio)::text, i.dados ->> 'chegada')
                when i.tipo = 'passeio' and i.data_fim is not null and i.data_fim > i.data_inicio then
                  _rel_venda_ts(i.data_fim::text, null) end as chegada0,
           case i.tipo when 'trem' then nullif(i.dados ->> 'operadora', '') when 'seguro' then nullif(i.dados ->> 'seguradora', '')
                       when 'carro' then nullif(i.dados ->> 'locadora', '') when 'cruzeiro' then nullif(i.dados ->> 'companhia', '') end as companhia,
           case i.tipo when 'trem' then nullif(i.dados ->> 'numero', '') when 'seguro' then nullif(i.dados ->> 'apolice', '') end as numero,
           nullif(i.dados ->> 'localizador', '') as localizador,
           case i.tipo when 'trem' then nullif(i.dados ->> 'classe', '') when 'carro' then nullif(i.dados ->> 'categoria', '')
                       when 'cruzeiro' then nullif(i.dados ->> 'cabine', '') when 'hospedagem' then nullif(i.dados ->> 'quarto', '') end as classe,
           nullif(case i.tipo when 'trem' then i.dados ->> 'assento' end, '') as assento,
           nullif(case i.tipo when 'hospedagem' then i.dados ->> 'endereco' end, '') as endereco,
           nullif(case i.tipo when 'passeio' then i.dados ->> 'local' end, '') as ponto_encontro,
           nullif(concat_ws(' · ', case i.tipo when 'hospedagem' then nullif(i.dados ->> 'regime', '') when 'seguro' then nullif(i.dados ->> 'plano', '')
                                                when 'passeio' then nullif(i.dados ->> 'duracao', '') when 'cruzeiro' then nullif(i.dados ->> 'navio', '') end,
                            nullif(i.fornecedor, '')), '') as observacoes
      from itens i
     where i.tipo in ('hospedagem', 'passeio', 'transfer', 'trem', 'seguro', 'carro', 'cruzeiro')
       and i.data_inicio is not null
  )
  select v.ref_externa, v.venda_item_id, v.tipo, v.descricao, v.origem, v.destino, v.origem_codigo, v.destino_codigo,
         v.partida_em, case when v.chegada0 >= v.partida_em and v.hora_chegada is not null then v.chegada0 end,
         v.companhia, v.numero, v.localizador, v.classe, v.bagagem, null::text, null::text, null::text, null::text
    from voos v where v.partida_em is not null
  union all
  select s.ref_externa, s.venda_item_id, s.tipo, s.descricao, s.origem, s.destino, null, null,
         s.partida_em, case when s.chegada0 >= s.partida_em then s.chegada0 end,
         s.companhia, s.numero, s.localizador, s.classe, null, s.assento, s.endereco, s.ponto_encontro, s.observacoes
    from servicos s where s.partida_em is not null;
$$;
-- definer (lê qs_venda_itens sem RLS): fechada; pela tela use a versão _checado abaixo
revoke all on function rel_venda_trechos_desejados(uuid) from public, anon, authenticated;

-- 4. sincroniza a viagem com a venda -----------------------------------------------
create or replace function rel_venda_trechos_sincronizar(p_venda uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v qs_vendas;
  n integer := 0;
  k integer;
  v_guc text := current_setting('rel.correcao_manual', true);
begin
  select * into v from qs_vendas where id = p_venda;
  if not found then return 0; end if;
  -- quem mexe aqui é a própria venda: a trava rel_trecho_respeita_correcao (service_role não desfaz
  -- status manual) não vale; devolvido no fim
  perform set_config('rel.correcao_manual', '1', true);

  if v.estado = 'cancelada' then
    update rel_viagem_trechos set status_manual = 'cancelado', status_manual_motivo = 'Venda cancelada', status_manual_em = now()
     where venda_id = p_venda and fonte = 'venda' and status_manual is null;
    get diagnostics n = row_count;
    perform set_config('rel.correcao_manual', coalesce(v_guc, ''), true);
    return n;
  end if;
  if v.estado is distinct from 'consolidada' or v.viagem_id is null then
    perform set_config('rel.correcao_manual', coalesce(v_guc, ''), true);
    return 0;
  end if;

  -- cria / atualiza (trecho corrigido à mão no Rel fica como o time deixou)
  insert into rel_viagem_trechos as x (viagem_id, tipo, descricao, origem, destino, origem_codigo, destino_codigo, partida_em, chegada_em,
                                       companhia, numero, localizador, classe, bagagem, assento, endereco, ponto_encontro, observacoes,
                                       ref_externa, fonte, venda_id, venda_item_id, criado_por)
  select v.viagem_id, d.tipo, d.descricao, d.origem, d.destino, d.origem_codigo, d.destino_codigo, d.partida_em, d.chegada_em,
         d.companhia, d.numero, d.localizador, d.classe, d.bagagem, d.assento, d.endereco, d.ponto_encontro, d.observacoes,
         d.ref_externa, 'venda', p_venda, d.venda_item_id, auth.uid()
    from rel_venda_trechos_desejados(p_venda) d
  on conflict (viagem_id, ref_externa) do update set
         tipo = excluded.tipo, descricao = excluded.descricao, origem = excluded.origem, destino = excluded.destino,
         origem_codigo = excluded.origem_codigo, destino_codigo = excluded.destino_codigo,
         partida_em = excluded.partida_em, chegada_em = excluded.chegada_em,
         companhia = excluded.companhia, numero = excluded.numero, localizador = excluded.localizador,
         classe = excluded.classe, bagagem = excluded.bagagem, assento = excluded.assento, endereco = excluded.endereco,
         ponto_encontro = excluded.ponto_encontro, observacoes = excluded.observacoes,
         fonte = 'venda', venda_id = excluded.venda_id, venda_item_id = excluded.venda_item_id,
         -- volta o que a própria venda tinha cancelado
         status_manual = case when x.status_manual_motivo in ('Venda cancelada', 'Saiu da venda') then null else x.status_manual end,
         status_manual_motivo = case when x.status_manual_motivo in ('Venda cancelada', 'Saiu da venda') then null else x.status_manual_motivo end,
         status_manual_em = case when x.status_manual_motivo in ('Venda cancelada', 'Saiu da venda') then null else x.status_manual_em end
   where x.corrigido_em is null and (x.fonte = 'venda' or x.ref_externa like 'venda:%');
  get diagnostics n = row_count;

  -- o que saiu da venda (ou ficou na viagem antiga): apaga; com check-in/correção, cancela
  delete from rel_viagem_trechos x
   where x.venda_id = p_venda and x.fonte = 'venda'
     and x.corrigido_em is null and x.checkin_feito_em is null
     and (x.viagem_id <> v.viagem_id
          or not exists (select 1 from rel_venda_trechos_desejados(p_venda) d where d.ref_externa = x.ref_externa));
  get diagnostics k = row_count;
  n := n + k;
  update rel_viagem_trechos x set status_manual = 'cancelado', status_manual_motivo = 'Saiu da venda', status_manual_em = now()
   where x.venda_id = p_venda and x.fonte = 'venda' and x.status_manual is null
     and (x.viagem_id <> v.viagem_id
          or not exists (select 1 from rel_venda_trechos_desejados(p_venda) d where d.ref_externa = x.ref_externa));
  get diagnostics k = row_count;
  perform set_config('rel.correcao_manual', coalesce(v_guc, ''), true);
  return n + k;
end;
$$;
revoke all on function rel_venda_trechos_sincronizar(uuid) from public, anon, authenticated;

-- rel_venda_trechos_desejados é definer: quem não pode ver a venda não lê os itens por ela.
create or replace function rel_venda_trechos_desejados_checado(p_venda uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (rel_tem_acesso() or ops_tem_acesso()) then raise exception 'Sem acesso.'; end if;
  return query select to_jsonb(d) from rel_venda_trechos_desejados(p_venda) d;
end;
$$;
revoke all on function rel_venda_trechos_desejados_checado(uuid) from public, anon;
grant execute on function rel_venda_trechos_desejados_checado(uuid) to authenticated;

-- 5. gatilhos ------------------------------------------------------------------------
create or replace function rel_trg_venda_trechos()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado in ('consolidada', 'cancelada')
     and (old.estado is distinct from new.estado or old.viagem_id is distinct from new.viagem_id
          or old.atualizado_em is distinct from new.atualizado_em) then
    begin
      perform rel_venda_trechos_sincronizar(new.id);
    exception when others then
      raise warning 'rel_trg_venda_trechos (venda %): %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_qs_vendas_trechos_rel on qs_vendas;
create trigger trg_qs_vendas_trechos_rel after update on qs_vendas
  for each row execute function rel_trg_venda_trechos();

create or replace function rel_trg_venda_item_trechos()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_venda uuid := coalesce(case when tg_op = 'DELETE' then old.venda_id else new.venda_id end, null);
begin
  if v_venda is not null and exists (select 1 from qs_vendas where id = v_venda and estado = 'consolidada') then
    begin
      perform rel_venda_trechos_sincronizar(v_venda);
    exception when others then
      raise warning 'rel_trg_venda_item_trechos (venda %): %', v_venda, sqlerrm;
    end;
  end if;
  -- item que trocou de venda: a antiga também
  if tg_op = 'UPDATE' and old.venda_id is not null and old.venda_id is distinct from new.venda_id
     and exists (select 1 from qs_vendas where id = old.venda_id and estado = 'consolidada') then
    begin
      perform rel_venda_trechos_sincronizar(old.venda_id);
    exception when others then
      raise warning 'rel_trg_venda_item_trechos (venda %): %', old.venda_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_qs_venda_itens_trechos_rel on qs_venda_itens;
create trigger trg_qs_venda_itens_trechos_rel after insert or update or delete on qs_venda_itens
  for each row execute function rel_trg_venda_item_trechos();

revoke all on function rel_trg_venda_trechos() from public, anon, authenticated;
revoke all on function rel_trg_venda_item_trechos() from public, anon, authenticated;

-- 6. as vendas que já estão consolidadas (hoje nenhuma; idempotente) -----------------
select rel_venda_trechos_sincronizar(id) from qs_vendas where estado in ('consolidada', 'cancelada') and viagem_id is not null;

-- Conferência depois de aplicar (só leitura):
--   select fonte, tipo, count(*) from rel_viagem_trechos where fonte = 'venda' group by 1, 2;
--   select * from rel_venda_trechos_desejados_checado('<venda>');

-- Volta:
--   drop trigger if exists trg_qs_venda_itens_trechos_rel on qs_venda_itens;
--   drop trigger if exists trg_qs_vendas_trechos_rel on qs_vendas;
--   drop function if exists rel_trg_venda_item_trechos();
--   drop function if exists rel_trg_venda_trechos();
--   drop function if exists rel_venda_trechos_desejados_checado(uuid);
--   drop function if exists rel_venda_trechos_sincronizar(uuid);
--   drop function if exists rel_venda_trechos_desejados(uuid);
--   drop function if exists _rel_venda_ts(text, text);
--   delete from rel_viagem_trechos where fonte = 'venda';   -- os trechos criados pela venda
--   alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_tipo_check;
--   alter table rel_viagem_trechos add constraint rel_viagem_trechos_tipo_check
--     check (tipo in ('voo_internacional', 'voo_interno', 'trem', 'transfer', 'hospedagem', 'passeio', 'outro'));
--   alter table rel_viagem_trechos drop constraint if exists rel_viagem_trechos_fonte_check;
--   alter table rel_viagem_trechos add constraint rel_viagem_trechos_fonte_check
--     check (fonte in ('manual', 'expedicoes', 'bitrix', 'ia'));
--   drop index if exists rel_viagem_trechos_venda_idx;
--   alter table rel_viagem_trechos drop column if exists venda_item_id, drop column if exists venda_id;
