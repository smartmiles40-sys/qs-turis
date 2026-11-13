-- 0386_ponte_pax_viagem_rel.sql
-- -----------------------------------------------------------------------------
-- PONTE PÓS-VENDA (2/5) — PASSAGEIRO DE EXPEDIÇÕES → VIAGEM DO REL (13/11/2026).
-- Depende da 0385 (_ponte_* e ponte_trechos_expedicao_sincronizar).
--
-- POR QUÊ: passageiro novo em Expedições não aparecia no Rel (a ligação
-- passageiro → viagem só existiu na importação de 13/10). Auditoria de 13/11:
-- 190 passageiros ativos sem viagem (119 em expedições futuras). E cancelar o
-- passageiro no Operacional não avisava ninguém (closer, Financeiro, Rel).
--
-- MODELO (o mesmo da importação, scripts/importar-expedicoes.mjs):
--   • uma viagem do Rel por cliente e expedição (rel_viagens.expedicoes_id +
--     cliente_id ou rel_viagem_passageiros); viagens do Bitrix já casadas com a
--     expedição são REUSADAS (não duplica);
--   • rel_expedicoes_vinculo (passageiro_id → viagem_id) é a ligação oficial;
--   • rel_viagem_passageiros garante a pessoa na viagem.
--
-- O QUE FAZ (gatilho AFTER INSERT/UPDATE de cliente_id, status_reserva,
-- expedicao_id, grupo_id, tipo em passageiros; roda também no espelho):
--   Passageiro ATIVO (Confirmado/Pré-reserva, Pagante/Cortesia, com cliente):
--     acha a viagem nesta ordem — vínculo que já existe → viagem desta
--     expedição do cliente (dono ou passageiro) → negócio do Bitrix do
--     passageiro → viagem do cliente (Bitrix) de expedição/pacote ainda sem
--     expedição ligada, com embarque até 7 dias da expedição/grupo (o "perto"
--     da importação) → viagem da venda do QS (passageiros.venda_id) → cria uma
--     (origem 'expedicoes', como a importação). Garante o vínculo, a pessoa na
--     viagem, datas vazias preenchidas e os voos (0385). Viagem que a PRÓPRIA
--     ponte tinha cancelado volta a 'ativa'; cancelada por gente fica como está
--     (evento "conferir").
--   Passageiro CANCELADO: nada é apagado.
--     – viagem nascida de Expedições sem mais ninguém ativo → status 'cancelada';
--     – viagem com outros passageiros, ou do Bitrix/venda → fica, com evento;
--     – voos de Expedições da viagem sem ninguém ativo → trechos cancelados (0385);
--     – AVISOS (item 5): evento no cartão do closer (qs_closer_negocio_eventos)
--       e "[Aviso QS …]" no plano do Financeiro. O valor da venda e as parcelas
--       NÃO mudam (mesma regra do _pax_valor_na_venda_trg: quem ajusta o item é
--       o closer no Subir venda). Cancelamento que veio do próprio QS
--       (_venda_pax_cancelar / venda_cancelar, que já avisam) não duplica aviso.
--   Passageiro que trocou de expedição: a viagem antiga é tratada como
--   cancelamento (sem avisos de dinheiro) e ele é ligado à nova.
--   Líder e Lead ficam de fora (igual à importação).
--
-- Rastro: rel_viagem_eventos ("Ponte Expedições: …"), qs_closer_negocio_eventos,
-- fin_planos.observacao.
-- Laço: nada aqui grava em passageiros. O cancelamento da viagem marca
-- ponte.origem = 'pax' para o gatilho de viagem cancelada (0388) não avisar de novo.
--
-- COMO CONFERIR:
--   -- inscreva/confirme um passageiro numa expedição futura e veja:
--   select * from rel_expedicoes_vinculo where passageiro_id = '<pax>';
--   select * from rel_viagem_eventos where motivo like 'Ponte Expedições%' order by em desc limit 20;
--   -- backfill (simulação): scripts/ponte/backfill-passageiros.sql
--
-- COMO VOLTAR:
--   /** Passageiro APAGADO no Operacional: a viagem perde o passageiro (sem apagar nada) e closer/Financeiro são avisados. */
create or replace function _ponte_trg_pax_rel_apagado()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_exp text;
begin
  select coalesce(v.mesclada_em_id, v.id) into v_id
    from rel_expedicoes_vinculo x join rel_viagens v on v.id = x.viagem_id where x.passageiro_id = old.id;
  select nome into v_exp from expedicoes where id = old.expedicao_id;
  if v_id is not null then
    perform _ponte_viagem_perdeu_pax(v_id, old.id, coalesce(nullif(trim(old.nome_completo), ''), 'Passageiro'), coalesce(v_exp, ''), 'foi removido(a)');
  end if;
  if old.status_reserva::text in ('Confirmado', 'Pré-reserva') then
    perform _ponte_avisar_pax_saiu(old, v_id, v_exp, 'removeu');
  end if;
  return null;
exception when others then
  raise warning 'ponte: passageiro % apagado → Rel: %', old.id, sqlerrm;
  return null;
end $$;

drop trigger if exists zz_ponte_pax_rel_del on passageiros;
create trigger zz_ponte_pax_rel_del after delete on passageiros
  for each row execute function _ponte_trg_pax_rel_apagado();

drop trigger if exists zz_ponte_pax_rel_ins on passageiros;
--   drop trigger if exists zz_ponte_pax_rel_upd on passageiros;
--   drop trigger if exists zz_ponte_pax_rel_del on passageiros;
-- -----------------------------------------------------------------------------

/** O passageiro saiu desta viagem (cancelou ou trocou de expedição): marca, sem apagar. */
create or replace function _ponte_viagem_perdeu_pax(p_viagem uuid, p_pax uuid, p_nome text, p_exp_nome text, p_porque text)
returns text language plpgsql security definer set search_path = public as $$
declare v rel_viagens; v_outros boolean; v_ret text := 'mantida';
begin
  select * into v from rel_viagens where id = p_viagem;
  if not found then return null; end if;
  v_outros := exists (select 1 from rel_expedicoes_vinculo x join passageiros pa on pa.id = x.passageiro_id
                       where x.viagem_id = p_viagem and pa.id <> p_pax and pa.expedicao_id = x.expedicao_id
                         and _ponte_pax_entra(pa));
  if not v_outros and v.status = 'ativa' and v.origem = 'expedicoes' then
    perform set_config('ponte.origem', 'pax', true);
    update rel_viagens set status = 'cancelada' where id = p_viagem;
    perform set_config('ponte.origem', '', true);
    perform _ponte_evento_viagem(p_viagem, 'item', 'ativa', 'cancelada',
      'Ponte Expedições: ' || p_nome || ' ' || p_porque || ' na expedição ' || p_exp_nome
      || ' — viagem cancelada (nada apagado; volta sozinha se reconfirmar).');
    v_ret := 'cancelada';
  elsif v.status = 'ativa' then
    perform _ponte_evento_viagem(p_viagem, 'item', null, null,
      'Ponte Expedições: ' || p_nome || ' ' || p_porque || ' na expedição ' || p_exp_nome || '. A viagem continua ('
      || case when v_outros then 'tem outros passageiros ativos' else 'veio do ' || coalesce(v.origem, '?') end || ') — conferir.');
  end if;
  perform ponte_trechos_expedicao_sincronizar(p_viagem);
  return v_ret;
end $$;

/** Passageiro saiu (cancelado ou removido no Operacional): avisa o cartão do closer e o plano do Financeiro.
    Só aviso — valor da venda e parcelas NÃO mudam. */
create or replace function _ponte_avisar_pax_saiu(p passageiros, p_viagem uuid, p_exp_nome text, p_verbo text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_venda qs_vendas; v_neg uuid; v_txt text; v_pl uuid;
begin
  if p.venda_id is not null then select * into v_venda from qs_vendas where id = p.venda_id; end if;
  if v_venda.estado = 'cancelada' then return false; end if;   -- venda_cancelar já avisou
  v_neg := coalesce(v_venda.negocio_id, (select closer_negocio_id from rel_viagens where id = p_viagem));
  v_txt := 'O Operacional ' || p_verbo || ' ' || coalesce(nullif(trim(p.nome_completo), ''), 'um passageiro')
           || ' na expedição ' || coalesce(p_exp_nome, '')
           || case when coalesce(p.valor_contratado_brl, 0) > 0 then ' (valor ' || _brl_txt(p.valor_contratado_brl) || ')' else '' end
           || '. O valor da venda e as parcelas NÃO mudaram — se for o caso, ajuste o item no Subir venda e combine o reembolso com o Financeiro.';
  if v_neg is not null then
    begin
      insert into qs_closer_negocio_eventos (negocio_id, tipo, texto, autor_id)
      values (v_neg, 'editado', v_txt, (select id from qs_users where id = auth.uid()));
    exception when others then raise warning 'ponte: aviso no cartão % não gravou: %', v_neg, sqlerrm;
    end;
  end if;
  for v_pl in select * from _ponte_planos(p.venda_id, v_neg, case when p.venda_id is null and v_neg is null then p_viagem end) loop
    perform _ponte_aviso_plano(v_pl, v_txt);
  end loop;
  return true;
end $$;

/** Liga o passageiro à viagem do Rel (ou trata o cancelamento). p_do_qs: o cancelamento veio do QS (não repete aviso). */
create or replace function ponte_pax_para_rel(p_pax uuid, p_do_qs boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p        passageiros;
  e        expedicoes;
  g        grupos_expedicao;
  x        rel_expedicoes_vinculo;
  v        rel_viagens;
  v_id     uuid;
  v_como   text;
  v_deal   text;
  v_nome   text;
  v_emb    date;
  v_ret    date;
  v_novo   boolean := false;
  v_ligou  boolean := false;
  v_res    text;
  k        int;
  v_trocou boolean := false;
  v_exp_antes text;
  v_emb_antes date;
  v_ret_antes date;
begin
  select * into p from passageiros where id = p_pax;
  if not found or p.cliente_id is null or p.tipo::text = 'Líder' or p.status_reserva::text = 'Lead' then return null; end if;
  select * into e from expedicoes where id = p.expedicao_id;
  if not found then return null; end if;
  select * into x from rel_expedicoes_vinculo where passageiro_id = p.id;
  v_nome := coalesce(nullif(trim(p.nome_completo), ''), 'Passageiro');

  -- Trocou de expedição (ex.: Tailândia G1 → G2). Se a viagem antiga era só dele, ela ACOMPANHA
  -- (troca expedicoes_id; datas e voos se ajustam logo abaixo). Se tem outros, perde o passageiro
  -- (sem aviso de dinheiro) e ele é ligado/criado na nova.
  if x.passageiro_id is not null and x.expedicao_id is distinct from p.expedicao_id and x.viagem_id is not null then
    select coalesce(mesclada_em_id, id) into v_id from rel_viagens where id = x.viagem_id;
    select nome, data_embarque, data_retorno into v_exp_antes, v_emb_antes, v_ret_antes from expedicoes where id = x.expedicao_id;
    if _ponte_pax_entra(p) and v_id is not null
       and exists (select 1 from rel_viagens where id = v_id and status = 'ativa' and (expedicoes_id is null or expedicoes_id = x.expedicao_id))
       and not exists (select 1 from rel_expedicoes_vinculo o join passageiros pa on pa.id = o.passageiro_id
                        where o.viagem_id = v_id and pa.id <> p.id and o.expedicao_id = x.expedicao_id
                          and pa.expedicao_id = o.expedicao_id and _ponte_pax_entra(pa)) then
      update rel_viagens set
        expedicoes_id = p.expedicao_id,
        expedicao     = e.nome,
        titulo        = case when origem = 'expedicoes' and v_exp_antes is not null and titulo like v_exp_antes || '%'
                             then left(e.nome || substr(titulo, length(v_exp_antes) + 1), 200) else titulo end
       where id = v_id;
      perform _ponte_evento_viagem(v_id, 'item', v_exp_antes, e.nome,
        'Ponte Expedições: ' || v_nome || ' mudou da expedição ' || coalesce(v_exp_antes, '?') || ' para ' || coalesce(e.nome, '?')
        || ' — a viagem acompanha (datas e voos se ajustam).');
      v_trocou := true;
      x.viagem_id := v_id;
    else
      perform _ponte_viagem_perdeu_pax(v_id, p.id, v_nome, coalesce(v_exp_antes, 'anterior'),
        'saiu (foi para ' || coalesce(e.nome, 'outra') || ')');
      x.viagem_id := null;
    end if;
    v_id := null;
  end if;

  -- ── CANCELADO ──
  if p.status_reserva::text = 'Cancelado' then
    if x.viagem_id is not null then
      select coalesce(mesclada_em_id, id) into v_id from rel_viagens where id = x.viagem_id;
      v_res := _ponte_viagem_perdeu_pax(v_id, p.id, v_nome, coalesce(e.nome, ''), 'foi cancelado(a)');
    end if;
    if p_do_qs then
      return jsonb_build_object('cancelado', true, 'viagem', v_res, 'avisos', false);
    end if;
    return jsonb_build_object('cancelado', true, 'viagem', v_res,
                              'avisos', _ponte_avisar_pax_saiu(p, v_id, e.nome, 'cancelou'));
  end if;

  if not _ponte_pax_entra(p) then return null; end if;

  -- ── ATIVO: acha a viagem ──
  if p.grupo_id is not null then select * into g from grupos_expedicao where id = p.grupo_id; end if;
  v_emb := coalesce(g.data_embarque, e.data_embarque);
  v_ret := coalesce(g.data_retorno, e.data_retorno);
  if v_emb is not null and v_ret is not null and v_ret < v_emb then v_ret := null; end if;

  if x.viagem_id is not null then
    select coalesce(mesclada_em_id, id) into v_id from rel_viagens where id = x.viagem_id;
    if v_id is not null and exists (select 1 from rel_viagens where id = v_id and expedicoes_id is distinct from p.expedicao_id and expedicoes_id is not null) then
      v_id := null;
    end if;
    v_como := coalesce(x.como, 'vinculo');
  end if;
  if v_id is null then
    select vg.id into v_id from rel_viagens vg
     where vg.expedicoes_id = p.expedicao_id and vg.mesclada_em_id is null and vg.status <> 'arquivada'
       and (vg.cliente_id = p.cliente_id
            or exists (select 1 from rel_viagem_passageiros rp where rp.viagem_id = vg.id and rp.cliente_id = p.cliente_id))
     order by (vg.status = 'ativa') desc, (vg.cliente_id = p.cliente_id) desc, vg.criado_em
     limit 1;
    v_como := 'ponte:viagem-da-expedicao';
  end if;
  v_deal := nullif(nullif(regexp_replace(coalesce(p.bitrix_deal_id, ''), '\D', '', 'g'), ''), '0');
  if v_id is null and v_deal is not null then
    select coalesce(vg.mesclada_em_id, vg.id) into v_id from rel_viagens vg where vg.bitrix_deal_id = v_deal limit 1;
    if v_id is null then select d.viagem_id into v_id from rel_viagem_deals d where d.bitrix_deal_id = v_deal limit 1; end if;
    if v_id is null then select rp.viagem_id into v_id from rel_viagem_passageiros rp where rp.bitrix_deal_id = v_deal limit 1; end if;
    if v_id is not null and exists (select 1 from rel_viagens where id = v_id and expedicoes_id is not null and expedicoes_id <> p.expedicao_id) then
      v_id := null;
    end if;
    v_como := 'ponte:bitrix';
  end if;
  -- viagem do cliente (Bitrix) ainda sem expedição ligada, de expedição/pacote, embarque até 7 dias
  -- (o "perto" da importação) — evita duplicar a venda que veio do Bitrix
  if v_id is null and v_emb is not null then
    select vg.id into v_id from rel_viagens vg
     where vg.expedicoes_id is null and vg.mesclada_em_id is null and vg.status = 'ativa'
       and vg.tipo in ('expedicao', 'pacote') and abs(vg.data_embarque - v_emb) <= 7
       and (vg.cliente_id = p.cliente_id
            or exists (select 1 from rel_viagem_passageiros rp where rp.viagem_id = vg.id and rp.cliente_id = p.cliente_id))
     order by abs(vg.data_embarque - v_emb), vg.criado_em
     limit 1;
    v_como := 'ponte:perto';
  end if;
  if v_id is null and p.venda_id is not null then
    select coalesce(rv.mesclada_em_id, rv.id) into v_id
      from qs_vendas q join rel_viagens rv on rv.id = q.viagem_id
     where q.id = p.venda_id and q.estado <> 'cancelada'
       and (rv.expedicoes_id is null or rv.expedicoes_id = p.expedicao_id);
    v_como := 'ponte:venda';
  end if;

  if v_id is null then
    insert into rel_viagens (titulo, destino, expedicao, tipo, data_embarque, data_retorno, valor, qtd_passageiros,
                             cliente_id, origem, status, expedicoes_id, bitrix_deal_id, observacoes)
    values (left(coalesce(nullif(trim(e.nome), ''), 'Expedição') || case when g.nome is not null then ' — ' || g.nome else '' end, 200),
            nullif(e.destino, ''), e.nome, case when e.tipo = 'pacote' then 'pacote' else 'expedicao' end,
            v_emb, v_ret, case when coalesce(p.valor_contratado_brl, 0) > 0 then p.valor_contratado_brl end, 1,
            p.cliente_id, 'expedicoes', 'ativa', p.expedicao_id,
            case when v_deal is not null and not exists (select 1 from rel_viagens where bitrix_deal_id = v_deal) then v_deal end,
            concat_ws(E'\n', 'Criada pela ponte Expedições → Rel em ' || _ponte_hoje_txt() || '.',
                      case when p.status_reserva::text = 'Pré-reserva' then 'Pré-reserva no sistema de Expedições.' end))
    returning id into v_id;
    v_novo := true;
    v_como := 'ponte:criada';
  end if;

  select * into v from rel_viagens where id = v_id;
  -- viagem que a PRÓPRIA ponte cancelou volta; cancelada por gente, não
  if v.status = 'cancelada' then
    if (select ev.motivo like 'Ponte Expedições:%' and ev.para = 'cancelada'
          from rel_viagem_eventos ev where ev.viagem_id = v_id and ev.para in ('cancelada', 'ativa')
         order by ev.em desc, ev.id desc limit 1) then
      perform set_config('ponte.origem', 'pax', true);
      update rel_viagens set status = 'ativa' where id = v_id;
      perform set_config('ponte.origem', '', true);
      perform _ponte_evento_viagem(v_id, 'item', 'cancelada', 'ativa',
        'Ponte Expedições: ' || v_nome || ' voltou a ' || p.status_reserva::text || ' na expedição ' || coalesce(e.nome, '') || ' — viagem reativada.');
    else
      perform _ponte_evento_viagem(v_id, 'item', null, null,
        'Ponte Expedições: ' || v_nome || ' está ' || p.status_reserva::text || ' na expedição ' || coalesce(e.nome, '')
        || ', mas esta viagem está cancelada no Rel — conferir.');
    end if;
  end if;
  -- completa o que falta (nunca sobrescreve; igual à importação)
  if v.expedicoes_id is null or (v.data_embarque is null and v_emb is not null) or (v.expedicao is null) then
    update rel_viagens set
      expedicoes_id = coalesce(expedicoes_id, p.expedicao_id),
      expedicao     = coalesce(expedicao, e.nome),
      data_embarque = coalesce(data_embarque, v_emb),
      data_retorno  = case when data_retorno is null and v_ret is not null and v_ret >= coalesce(data_embarque, v_emb) then v_ret else data_retorno end
     where id = v_id;
  end if;

  insert into rel_viagem_passageiros (viagem_id, cliente_id) values (v_id, p.cliente_id)
  on conflict (viagem_id, cliente_id) do nothing;

  insert into rel_expedicoes_vinculo as rv (passageiro_id, expedicao_id, cliente_id, viagem_id, como)
  values (p.id, p.expedicao_id, p.cliente_id, v_id, v_como)
  on conflict (passageiro_id) do update set
    expedicao_id = excluded.expedicao_id, cliente_id = excluded.cliente_id, viagem_id = excluded.viagem_id,
    como = case when rv.viagem_id is distinct from excluded.viagem_id then excluded.como else rv.como end,
    atualizado_em = now()
  where (rv.expedicao_id, rv.cliente_id, rv.viagem_id) is distinct from (excluded.expedicao_id, excluded.cliente_id, excluded.viagem_id);
  get diagnostics k = row_count;
  v_ligou := k > 0;

  if v_novo or v_ligou then
    perform _ponte_evento_viagem(v_id, 'item', null, null,
      'Ponte Expedições: ' || v_nome || ' (' || p.status_reserva::text || ') entrou pela expedição ' || coalesce(e.nome, '')
      || case when v_novo then ' — viagem criada.' else ' — ligado a esta viagem.' end);
  end if;
  if v_trocou then
    perform ponte_viagem_datas_da_expedicao(v_id, v_emb_antes, v_ret_antes, false,
      'Ponte Expedições: ' || v_nome || ' mudou de expedição — datas acompanham.');
  end if;
  perform ponte_trechos_expedicao_sincronizar(v_id);
  return jsonb_build_object('viagem_id', v_id, 'criada', v_novo, 'ligou', v_ligou, 'como', v_como, 'trocou_expedicao', v_trocou);
end $$;

create or replace function _ponte_trg_pax_rel()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_do_qs boolean := false; v_marca text;
begin
  if tg_op = 'UPDATE' and new.status_reserva::text = 'Cancelado' and old.status_reserva::text <> 'Cancelado' then
    -- _venda_pax_cancelar (venda cancelada / pessoa tirada da venda) grava "[QS dd/mm/aaaa] …" na mesma
    -- atualização e já avisa o closer e o Financeiro: aqui não repete.
    v_marca := '[QS ' || _ponte_hoje_txt() || '] ';
    v_do_qs := position(v_marca in coalesce(new.observacoes, '')) > 0 and position(v_marca in coalesce(old.observacoes, '')) = 0;
  end if;
  perform ponte_pax_para_rel(new.id, v_do_qs);
  return null;
exception when others then
  raise warning 'ponte: passageiro % → Rel: %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists zz_ponte_pax_rel_ins on passageiros;
create trigger zz_ponte_pax_rel_ins after insert on passageiros
  for each row execute function _ponte_trg_pax_rel();
drop trigger if exists zz_ponte_pax_rel_upd on passageiros;
create trigger zz_ponte_pax_rel_upd after update of cliente_id, status_reserva, expedicao_id, grupo_id, tipo on passageiros
  for each row when ((old.cliente_id, old.status_reserva, old.expedicao_id, old.grupo_id, old.tipo)
                     is distinct from (new.cliente_id, new.status_reserva, new.expedicao_id, new.grupo_id, new.tipo))
  execute function _ponte_trg_pax_rel();

revoke all on function _ponte_viagem_perdeu_pax(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function ponte_pax_para_rel(uuid, boolean) from public, anon, authenticated;
revoke all on function _ponte_trg_pax_rel() from public, anon, authenticated;
revoke all on function _ponte_trg_pax_rel_apagado() from public, anon, authenticated;
revoke all on function _ponte_avisar_pax_saiu(passageiros, uuid, text, text) from public, anon, authenticated;
