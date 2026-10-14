-- 0135_cargos_permissoes.sql
-- -----------------------------------------------------------------------------
-- OS CARGOS PASSAM A VALER (14/10/2026). Até a 0122 as permissões do cargo só
-- ficavam registradas; agora o banco confere.
--
-- (Aplicada em 3 partes: 0135a funções + padrão dos cargos, 0135b policies,
--  0135c rel_juntar_clientes.)
--
-- A REGRA — qs_pode('area.permissao'):
--   1. admin ............................ SEMPRE pode.
--   2. gestor(a) com o setor da área .... SEMPRE pode (a área = o que vem antes
--      do ponto: "relacionamento.modelos" → gestor do Relacionamento).
--      → gestor/admin NUNCA perde nada por causa de cargo.
--   3. quem TEM cargo (ativo) ........... pode só o que está marcado no cargo.
--   4. quem NÃO tem cargo ............... o padrão de hoje (coluna `padrao` de
--      qs_permissoes_padrao) — ninguém sem cargo muda de comportamento.
-- Ou seja: o cargo ADICIONA poderes de gestora a um atendente (ex.: editar
-- respostas prontas) e pode TIRAR de um atendente o que hoje todo mundo faz
-- (ex.: campanhas). Os cargos que já existiam ganham o padrão do setor, pra
-- quem já tem cargo não perder nada na hora.
--
-- O acesso à ÁREA continua sendo rel_tem_acesso()/fin_tem_acesso(): a
-- permissão do cargo nunca abre área nenhuma, só refina dentro dela.
-- -----------------------------------------------------------------------------

-- ── 0135a ──
create or replace function qs_permissoes_padrao()
returns table (chave text, padrao boolean)
language sql immutable set search_path = public as $$
  values
    ('relacionamento.modelos',             false),  -- respostas prontas (hoje: só gestora)
    ('relacionamento.disparos',            true),   -- campanhas e automações
    ('relacionamento.juntar_clientes',     true),   -- juntar fichas duplicadas
    ('relacionamento.editar_viagens',      true),   -- criar/editar/apagar viagens
    ('relacionamento.agenda_time',         false),  -- mexer na agenda dos outros (hoje: só gestora)
    ('relacionamento.kpis',                true),   -- ver os KPIs (só tela)
    ('relacionamento.conferir_documentos', true),   -- conferir documentos (só tela)
    ('financeiro.status_atividades',       true),   -- mudar status dos atendimentos (só tela)
    ('financeiro.ver_valores',             true),   -- ver valores das viagens (só tela)
    ('financeiro.modelos',                 false)   -- respostas prontas do Financeiro (hoje: só gestor)
$$;
grant execute on function qs_permissoes_padrao() to authenticated;

create or replace function qs_pode(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
      when u.role = 'admin' then true
      when u.role = 'gestor' and split_part(p, '.', 1) = any(coalesce(u.setores, '{}')) then true
      when c.id is not null then p = any(c.permissoes)
      else coalesce((select d.padrao from qs_permissoes_padrao() d where d.chave = p), false)
    end
    from qs_users u
    left join qs_cargos c on c.id = u.cargo_id and c.ativo
    where u.id = auth.uid() and u.is_active
  ), false);
$$;
grant execute on function qs_pode(text) to authenticated;

-- O que EU posso (a tela esconde botões com isto).
create or replace function qs_minhas_permissoes()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d.chave order by d.chave), '{}') from qs_permissoes_padrao() d where qs_pode(d.chave);
$$;
grant execute on function qs_minhas_permissoes() to authenticated;

-- Cargos que já existiam: o padrão do setor (quem já tem cargo não perde nada).
update qs_cargos c set permissoes = (
  select coalesce(array_agg(d.chave), '{}') from qs_permissoes_padrao() d
   where d.padrao and split_part(d.chave, '.', 1) = c.setor
) where c.permissoes = '{}';
-- A gestora, se tiver o cargo sem ser gestor no papel, edita as respostas e a agenda.
update qs_cargos set permissoes = array(select distinct unnest(permissoes || array['relacionamento.modelos', 'relacionamento.agenda_time']))
 where lower(nome) = 'gestora de relacionamento';

-- ── 0135b ──
-- Respostas prontas: gestor como antes + quem o cargo libera.
drop policy if exists rel_wa_resp_criar on rel_wa_respostas;
drop policy if exists rel_wa_resp_mudar on rel_wa_respostas;
drop policy if exists rel_wa_resp_apagar on rel_wa_respostas;
create policy rel_wa_resp_criar on rel_wa_respostas for insert to authenticated with check (
  rel_pode_configurar() or fin_pode_configurar()
  or (rel_tem_acesso() and qs_pode('relacionamento.modelos'))
  or (fin_tem_acesso() and qs_pode('financeiro.modelos')));
create policy rel_wa_resp_mudar on rel_wa_respostas for update to authenticated using (
  rel_pode_configurar() or fin_pode_configurar()
  or (rel_tem_acesso() and qs_pode('relacionamento.modelos'))
  or (fin_tem_acesso() and qs_pode('financeiro.modelos'))
) with check (
  rel_pode_configurar() or fin_pode_configurar()
  or (rel_tem_acesso() and qs_pode('relacionamento.modelos'))
  or (fin_tem_acesso() and qs_pode('financeiro.modelos')));
create policy rel_wa_resp_apagar on rel_wa_respostas for delete to authenticated using (
  rel_pode_configurar() or fin_pode_configurar()
  or (rel_tem_acesso() and qs_pode('relacionamento.modelos'))
  or (fin_tem_acesso() and qs_pode('financeiro.modelos')));

-- Agenda: a sua sempre; a dos outros = gestora ou cargo que libera.
drop policy if exists rel_agenda_ler on rel_agenda;
drop policy if exists rel_agenda_criar on rel_agenda;
drop policy if exists rel_agenda_mudar on rel_agenda;
drop policy if exists rel_agenda_apagar on rel_agenda;
create policy rel_agenda_ler on rel_agenda for select to authenticated using (
  rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or qs_pode('relacionamento.agenda_time')));
create policy rel_agenda_criar on rel_agenda for insert to authenticated with check (
  rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or qs_pode('relacionamento.agenda_time')));
create policy rel_agenda_mudar on rel_agenda for update to authenticated using (
  rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or qs_pode('relacionamento.agenda_time'))
) with check (
  rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or qs_pode('relacionamento.agenda_time')));
create policy rel_agenda_apagar on rel_agenda for delete to authenticated using (
  rel_tem_acesso() and (dono_id = auth.uid() or rel_pode_configurar() or qs_pode('relacionamento.agenda_time')));

-- Campanhas e automações: ler continua livre na área; escrever, conforme o cargo.
drop policy if exists rel_campanhas_criar on rel_campanhas;
drop policy if exists rel_campanhas_mudar on rel_campanhas;
drop policy if exists rel_campanhas_apagar on rel_campanhas;
create policy rel_campanhas_criar on rel_campanhas for insert to authenticated with check (rel_tem_acesso() and qs_pode('relacionamento.disparos'));
create policy rel_campanhas_mudar on rel_campanhas for update to authenticated
  using (rel_tem_acesso() and qs_pode('relacionamento.disparos')) with check (rel_tem_acesso() and qs_pode('relacionamento.disparos'));
create policy rel_campanhas_apagar on rel_campanhas for delete to authenticated using (rel_tem_acesso() and qs_pode('relacionamento.disparos'));
drop policy if exists rel_automacoes_criar on rel_automacoes;
drop policy if exists rel_automacoes_mudar on rel_automacoes;
drop policy if exists rel_automacoes_apagar on rel_automacoes;
create policy rel_automacoes_criar on rel_automacoes for insert to authenticated with check (rel_tem_acesso() and qs_pode('relacionamento.disparos'));
create policy rel_automacoes_mudar on rel_automacoes for update to authenticated
  using (rel_tem_acesso() and qs_pode('relacionamento.disparos')) with check (rel_tem_acesso() and qs_pode('relacionamento.disparos'));
create policy rel_automacoes_apagar on rel_automacoes for delete to authenticated using (rel_tem_acesso() and qs_pode('relacionamento.disparos'));

-- Viagens: ler como antes (Rel + Fin); escrever, conforme o cargo. A importação
-- do Bitrix/Expedições roda com a chave de serviço e não passa por aqui.
drop policy if exists rel_viagens_criar on rel_viagens;
drop policy if exists rel_viagens_mudar on rel_viagens;
drop policy if exists rel_viagens_apagar on rel_viagens;
create policy rel_viagens_criar on rel_viagens for insert to authenticated with check (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens'));
create policy rel_viagens_mudar on rel_viagens for update to authenticated
  using (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens')) with check (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens'));
create policy rel_viagens_apagar on rel_viagens for delete to authenticated using (rel_tem_acesso() and qs_pode('relacionamento.editar_viagens'));

-- ── 0135c ── rel_juntar_clientes: igual à vigente + a trava do cargo.
create or replace function public.rel_juntar_clientes(p_manter uuid, p_remover uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  m rel_clientes;
  r rel_clientes;
begin
  if not rel_tem_acesso() then
    raise exception 'Sem acesso ao Relacionamento.' using errcode = '42501';
  end if;
  if not qs_pode('relacionamento.juntar_clientes') then
    raise exception 'Seu cargo não junta fichas — peça pra gestora.' using errcode = '42501';
  end if;
  if p_manter = p_remover then
    raise exception 'Escolha duas fichas diferentes.';
  end if;
  select * into m from rel_clientes where id = p_manter for update;
  select * into r from rel_clientes where id = p_remover for update;
  if m.id is null or r.id is null then raise exception 'Ficha não encontrada.'; end if;
  if m.mesclado_em_id is not null or r.mesclado_em_id is not null then
    raise exception 'Uma das fichas já foi juntada a outra.';
  end if;
  if m.cpf is not null and r.cpf is not null and m.cpf <> r.cpf then
    raise exception 'As fichas têm CPFs diferentes — não são a mesma pessoa.';
  end if;

  update rel_clientes set mesclado_em_id = p_manter, titular_id = null where id = p_remover;

  update rel_clientes set titular_id = p_manter
   where titular_id = p_remover and id <> p_manter and mesclado_em_id is null;
  if m.titular_id = p_remover then
    update rel_clientes set titular_id = null where id = p_manter;
    m.titular_id := null;
  end if;

  update rel_clientes set
    cpf                   = coalesce(m.cpf, r.cpf),
    passaporte            = coalesce(m.passaporte, r.passaporte),
    passaporte_validade   = coalesce(m.passaporte_validade, r.passaporte_validade),
    nascimento            = coalesce(m.nascimento, r.nascimento),
    telefone              = coalesce(m.telefone, r.telefone),
    email                 = coalesce(m.email, r.email),
    bitrix_contato_id     = coalesce(m.bitrix_contato_id, r.bitrix_contato_id),
    lgpd_consentimento_em = coalesce(m.lgpd_consentimento_em, r.lgpd_consentimento_em),
    titular_id            = coalesce(m.titular_id, case when r.titular_id <> p_manter then r.titular_id end),
    parentesco            = case when m.titular_id is not null then m.parentesco
                                 when r.titular_id is not null and r.titular_id <> p_manter then r.parentesco end,
    observacoes           = nullif(concat_ws(E'\n\n', m.observacoes, r.observacoes), '')
   where id = p_manter;

  insert into rel_auditoria (tabela, registro_id, acao, antes, depois)
  values ('rel_clientes', p_manter, 'JUNTAR', to_jsonb(r), jsonb_build_object('juntado_em', p_manter));
end;
$function$;
