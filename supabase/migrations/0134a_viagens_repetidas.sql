-- 0134a_viagens_repetidas.sql
-- -----------------------------------------------------------------------------
-- CONFERIR VIAGENS REPETIDAS (14/10/2026).
--
-- O cruzamento com o sistema de Expedições (13/10) marcou 19 viagens com
-- "CONFERIR: possível viagem repetida" — o cliente já tinha vendas SEM DATA
-- vindas do Bitrix, que podem ser a mesma expedição. A tela "Conferir
-- repetidas" mostra a marcada ao lado das candidatas e a gestora decide:
--
--   rel_viagens_juntar(manter, remover)  → é a mesma viagem: tudo que era da
--     "remover" (passageiros, trechos, documentos, chamados, envios, pesquisas,
--     agenda, arquivos, ligações do Bitrix, vínculo do Expedições) passa pra
--     "manter"; a "remover" fica CANCELADA com mesclada_em_id (nunca apagada).
--     O negócio do Bitrix dela vira uma LIGAÇÃO (rel_viagem_deals) da que fica
--     — assim o sync do Bitrix não recria nem reativa a viagem juntada.
--   rel_viagens_diferentes(viagem)        → não é repetida: tira a marca.
--
-- Só gestora do Relacionamento ou admin (rel_pode_configurar). Tudo vai pra
-- rel_auditoria.
-- -----------------------------------------------------------------------------

alter table rel_viagens add column if not exists mesclada_em_id      uuid references rel_viagens(id) on delete set null;
alter table rel_viagens add column if not exists repetida_conferida_em  timestamptz;
alter table rel_viagens add column if not exists repetida_conferida_por uuid references qs_users(id) on delete set null;
create index if not exists rel_viagens_mesclada_idx on rel_viagens (mesclada_em_id) where mesclada_em_id is not null;

-- Tira a linha "CONFERIR: possível viagem repetida…" das observações.
create or replace function rel_sem_marca_repetida(t text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(coalesce(t, ''), 'CONFERIR: possível viagem repetida[^\n]*\n?', '', 'g')), '');
$$;

create or replace function rel_viagens_juntar(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m rel_viagens%rowtype;
  r rel_viagens%rowtype;
  v_antes jsonb;
begin
  if not rel_pode_configurar() then
    raise exception 'Só a gestora do Relacionamento (ou admin) junta viagens.';
  end if;
  if p_manter is null or p_remover is null or p_manter = p_remover then
    raise exception 'Escolha duas viagens diferentes.';
  end if;
  select * into m from rel_viagens where id = p_manter for update;
  select * into r from rel_viagens where id = p_remover for update;
  if m.id is null or r.id is null then raise exception 'Viagem não encontrada.'; end if;
  if m.mesclada_em_id is not null then raise exception 'A viagem que fica já foi juntada com outra.'; end if;
  if r.mesclada_em_id is not null then raise exception 'Essa viagem já foi juntada.'; end if;
  if m.cliente_id is distinct from r.cliente_id
     and not exists (select 1 from rel_viagem_passageiros where viagem_id = p_manter and cliente_id = r.cliente_id) then
    raise exception 'As duas viagens são de clientes diferentes.';
  end if;
  v_antes := jsonb_build_object('manter', to_jsonb(m), 'remover', to_jsonb(r));

  -- Passageiros: quem ainda não está na que fica passa pra ela.
  update rel_viagem_passageiros p set viagem_id = p_manter
   where p.viagem_id = p_remover
     and not exists (select 1 from rel_viagem_passageiros q where q.viagem_id = p_manter and q.cliente_id = p.cliente_id);

  -- Trechos: passa, menos o que a que fica já tem (mesmo dia + mesmo voo, ou mesma ref).
  update rel_viagem_trechos t set viagem_id = p_manter
   where t.viagem_id = p_remover
     and not exists (
       select 1 from rel_viagem_trechos k
        where k.viagem_id = p_manter
          and ((k.ref_externa is not null and k.ref_externa = t.ref_externa)
               or ((k.partida_em at time zone 'America/Sao_Paulo')::date = (t.partida_em at time zone 'America/Sao_Paulo')::date
                   and coalesce(k.numero, '') = coalesce(t.numero, ''))));

  -- Jornada: tarefa feita na que sai marca a mesma tarefa na que fica.
  update rel_viagem_tarefas k set feita_em = x.feita_em, feita_por = x.feita_por
    from rel_viagem_tarefas x
   where x.viagem_id = p_remover and x.feita_em is not null
     and k.viagem_id = p_manter and k.referencia = x.referencia and k.feita_em is null;

  update rel_documentos      set viagem_id = p_manter where viagem_id = p_remover;
  update rel_doc_pedidos     set viagem_id = p_manter where viagem_id = p_remover;
  update rel_chamados        set viagem_id = p_manter where viagem_id = p_remover;
  update rel_envios          set viagem_id = p_manter where viagem_id = p_remover;
  update rel_pesquisas       set viagem_id = p_manter where viagem_id = p_remover;
  update rel_recompras       set viagem_id = p_manter where viagem_id = p_remover;
  update rel_agenda          set viagem_id = p_manter where viagem_id = p_remover;
  update rel_bitrix_arquivos set viagem_id = p_manter where viagem_id = p_remover;
  update rel_expedicoes_vinculo set viagem_id = p_manter where viagem_id = p_remover;
  update rel_viagem_deals    set viagem_id = p_manter where viagem_id = p_remover;

  -- O negócio do Bitrix da que sai vira LIGAÇÃO da que fica.
  if r.bitrix_deal_id is not null then
    update rel_viagens set bitrix_deal_id = null where id = p_remover;
    insert into rel_viagem_deals (bitrix_deal_id, viagem_id, funil, motivo, bitrix_dados, bitrix_lido_em, conferido_em, conferido_por)
    values (r.bitrix_deal_id, p_manter, r.bitrix_funil, 'juntada na conferência de viagens repetidas', r.bitrix_dados, r.bitrix_lido_em, now(), auth.uid())
    on conflict (bitrix_deal_id) do update set viagem_id = excluded.viagem_id, motivo = excluded.motivo,
      conferido_em = excluded.conferido_em, conferido_por = excluded.conferido_por;
  end if;

  -- O que a que fica não tinha, herda (nunca sobrescreve).
  update rel_viagens set
    valor           = coalesce(valor, r.valor),
    data_venda      = coalesce(data_venda, r.data_venda),
    data_retorno    = coalesce(data_retorno, r.data_retorno),
    qtd_passageiros = coalesce(qtd_passageiros, r.qtd_passageiros),
    necessidades    = coalesce(necessidades, r.necessidades),
    expedicoes_id   = coalesce(expedicoes_id, r.expedicoes_id),
    responsavel_id  = coalesce(responsavel_id, r.responsavel_id),
    observacoes     = rel_sem_marca_repetida(observacoes),
    repetida_conferida_em = now(), repetida_conferida_por = auth.uid()
  where id = p_manter;

  update rel_viagens set
    status = 'cancelada', mesclada_em_id = p_manter,
    expedicoes_id = case when m.expedicoes_id is null then null else expedicoes_id end,
    observacoes = concat_ws(E'\n', rel_sem_marca_repetida(observacoes), format('JUNTADA na viagem "%s" (conferência de repetidas, %s).', m.titulo, to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'))),
    repetida_conferida_em = now(), repetida_conferida_por = auth.uid()
  where id = p_remover;

  insert into rel_auditoria (tabela, registro_id, acao, antes, depois, por)
  values ('rel_viagens', p_manter, 'juntar_viagens', v_antes,
          jsonb_build_object('manteve', p_manter, 'juntou', p_remover), auth.uid());
end;
$$;
revoke all on function rel_viagens_juntar(uuid, uuid) from public, anon;
grant execute on function rel_viagens_juntar(uuid, uuid) to authenticated;

create or replace function rel_viagens_diferentes(p_viagem uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_antes text;
begin
  if not rel_pode_configurar() then
    raise exception 'Só a gestora do Relacionamento (ou admin) confere viagens repetidas.';
  end if;
  select observacoes into v_antes from rel_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada.'; end if;
  update rel_viagens set observacoes = rel_sem_marca_repetida(observacoes),
         repetida_conferida_em = now(), repetida_conferida_por = auth.uid()
   where id = p_viagem;
  insert into rel_auditoria (tabela, registro_id, acao, antes, depois, por)
  values ('rel_viagens', p_viagem, 'viagem_nao_repetida', jsonb_build_object('observacoes', v_antes),
          jsonb_build_object('observacoes', rel_sem_marca_repetida(v_antes)), auth.uid());
end;
$$;
revoke all on function rel_viagens_diferentes(uuid) from public, anon;
grant execute on function rel_viagens_diferentes(uuid) to authenticated;
