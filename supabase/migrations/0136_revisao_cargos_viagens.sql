-- 0136_revisao_cargos_viagens.sql
-- -----------------------------------------------------------------------------
-- Ajustes da revisão de 14/10/2026 (aplicados em partes: 0136a + execute_sql,
-- porque o MCP recusava o SQL inteiro com "Invalid or expired requestState").
--
-- 1. Cargo vale SÓ pras permissões do setor dele. Quem tem cargo do Financeiro
--    e também atende no Relacionamento segue o padrão do Relacionamento (antes
--    perdia tudo que não estava marcado no cargo).
--    qs_pode_de(usuario, p) é a mesma regra pro servidor (service_role), usada
--    pelo api/rel-disparos.js pra barrar disparo de quem não tem a permissão.
-- 2. Agenda: "ver a agenda do time" pelo cargo NÃO abre os compromissos
--    particulares dos outros (a gestora segue vendo, como antes).
-- 3. Juntar viagens: pesquisa repetida do mesmo cliente não derruba a junção;
--    tarefas puladas também passam; data do Pós-Venda some quando a viagem que
--    fica já tem o voo de verdade (±1 dia).
-- 4. Voos do Pós-Venda: data que mudou/saiu do card apaga o trecho antigo; e a
--    data some quando chega o voo de verdade (±1 dia).
-- -----------------------------------------------------------------------------

-- 1 ───────────────────────────────────────────────────────────────────────────
create or replace function qs_pode_de(p_user uuid, p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when u.role = 'admin' then true
      when u.role = 'gestor' and split_part(p, '.', 1) = any(coalesce(u.setores, '{}')) then true
      when c.id is not null and c.setor = split_part(p, '.', 1) then p = any(c.permissoes)
      else coalesce((select d.padrao from qs_permissoes_padrao() d where d.chave = p), false)
    end
    from qs_users u
    left join qs_cargos c on c.id = u.cargo_id and c.ativo
    where u.id = p_user and u.is_active
  ), false);
$$;
revoke all on function qs_pode_de(uuid, text) from public, anon, authenticated;
grant execute on function qs_pode_de(uuid, text) to service_role;

create or replace function qs_pode(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select qs_pode_de(auth.uid(), p);
$$;
grant execute on function qs_pode(text) to authenticated;

-- 2 ───────────────────────────────────────────────────────────────────────────
alter policy rel_agenda_ler on rel_agenda using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or (qs_pode('relacionamento.agenda_time') and not privado)));
alter policy rel_agenda_mudar on rel_agenda
  using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or (qs_pode('relacionamento.agenda_time') and not privado)))
  with check (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or (qs_pode('relacionamento.agenda_time') and not privado)));
alter policy rel_agenda_apagar on rel_agenda using (rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or (qs_pode('relacionamento.agenda_time') and not privado)));

-- 3 ───────────────────────────────────────────────────────────────────────────
do $$ declare d text := pg_get_functiondef('public.rel_viagens_juntar(uuid,uuid)'::regprocedure); n text;
begin
  if position('q0.cliente_id' in d) > 0 then return; end if;  -- já aplicada
  n := replace(d, 'update rel_pesquisas       set viagem_id = p_manter where viagem_id = p_remover;',
    'update rel_pesquisas q0 set viagem_id = p_manter where q0.viagem_id = p_remover and not exists (select 1 from rel_pesquisas q where q.viagem_id = p_manter and q.cliente_id = q0.cliente_id);');
  n := replace(n, 'and k.viagem_id = p_manter and k.referencia = x.referencia and k.feita_em is null;',
    'and k.viagem_id = p_manter and k.referencia = x.referencia and k.feita_em is null;
  update rel_viagem_tarefas k set pulada = x.pulada, pulada_motivo = x.pulada_motivo from rel_viagem_tarefas x
   where x.viagem_id = p_remover and x.pulada and x.feita_em is null
     and k.viagem_id = p_manter and k.referencia = x.referencia and k.feita_em is null and not coalesce(k.pulada, false);');
  n := replace(n, 'update rel_viagem_deals    set viagem_id = p_manter where viagem_id = p_remover;',
    'update rel_viagem_deals    set viagem_id = p_manter where viagem_id = p_remover;
  delete from rel_viagem_trechos b where b.viagem_id = p_manter and b.ref_externa like ''bx-pv:%''
     and exists (select 1 from rel_viagem_trechos x where x.viagem_id = p_manter and coalesce(x.ref_externa, '''') not like ''bx-pv:%''
       and abs((x.partida_em at time zone ''America/Sao_Paulo'')::date - (b.partida_em at time zone ''America/Sao_Paulo'')::date) <= 1);');
  execute n;
end $$;

-- 4 ───────────────────────────────────────────────────────────────────────────
do $$ declare d text := pg_get_functiondef('public.rel_trechos_do_posvenda(uuid)'::regprocedure); n text;
begin
  if position('limpos as' in d) > 0 then return; end if;  -- já aplicada
  n := replace(d, '  ), novos as (',
'  ), limpos as (
    -- Data que mudou ou saiu do card: o trecho antigo do Pós-Venda sai.
    delete from rel_viagem_trechos b
     where b.ref_externa like ''bx-pv:%''
       and b.viagem_id in (select viagem_id from fontes)
       and not exists (select 1 from u where u.viagem_id = b.viagem_id and ''bx-pv:'' || u.k || '':'' || u.dia::text = b.ref_externa)
    returning 1
  ), novos as (');
  n := replace(n, E'begin\n  with fontes as (',
E'begin\n  -- Já tem o voo de verdade (Expedições/manual) a ±1 dia: a data do Pós-Venda sai.\n  delete from rel_viagem_trechos b\n   where b.ref_externa like ''bx-pv:%'' and (p_viagem is null or b.viagem_id = p_viagem)\n     and exists (select 1 from rel_viagem_trechos x where x.viagem_id = b.viagem_id and coalesce(x.ref_externa, '''') not like ''bx-pv:%''\n       and abs((x.partida_em at time zone ''America/Sao_Paulo'')::date - (b.partida_em at time zone ''America/Sao_Paulo'')::date) <= 1);\n  with fontes as (');
  execute n;
end $$;
