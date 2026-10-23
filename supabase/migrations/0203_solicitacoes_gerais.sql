-- 0203 — SOLICITAÇÕES PRA TUDO, NÃO SÓ COTAÇÃO (Bruno 23/10/2026: "tudo está voltado
-- para cotação, mas eu queria que fosse para o geral — ex.: alteração de assento ou
-- cotação de passagem. Existem x possibilidades de solicitação").
--
--   • tipos ganham `grupo` (o seletor do pedido mostra por grupo: Cotação · Aéreo já
--     emitido · Emissão e reservas · Documentos · Outros)
--   • novo formulário 'servico' (src/solicitacoes/servico.ts): cada tipo pede só os
--     campos dele (assento → localizador, trechos, preferência, quem paga…)
--   • Operações ganha os tipos do pós-venda aéreo e a cotação vira 3 (pacote, passagem,
--     hospedagem) — todas com o mesmo desfecho de cotação (fechou/não seguiu)
--   • qs_sol_criar exige o formulário também no 'servico'
-- Os 10 pedidos que já existem não mudam (o formulário deles é vazio → a tela mostra o
-- texto como antes). Gestor continua editando nome/prazo/ativo em "Tipos e prazos".

alter table qs_solicitacao_tipos add column if not exists grupo text;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'qs_solicitacao_tipos'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%formulario%' loop
    execute format('alter table qs_solicitacao_tipos drop constraint %I', c.conname);
  end loop;
end $$;
alter table qs_solicitacao_tipos add constraint qs_solicitacao_tipos_formulario_check
  check (formulario = any (array['cotacao', 'pagamento', 'servico']));

-- ── Operações ──
update qs_solicitacao_tipos set rotulo = 'Cotação de pacote / roteiro', grupo = 'Cotação', ordem = 10 where id = 'ops_cotacao';

insert into qs_solicitacao_tipos (id, setor, rotulo, grupo, formulario, prazo_horas, prazo_alta_horas, prazo_urgente_horas, desfecho_dias, ordem, ativo) values
  ('ops_cot_aereo', 'operacional', 'Cotação de passagem aérea', 'Cotação', 'cotacao', 8, 4, 2, 7, 11, true),
  ('ops_cot_hotel', 'operacional', 'Cotação de hospedagem',     'Cotação', 'cotacao', 8, 4, 2, 7, 12, true),
  ('ops_assento',    'operacional', 'Marcação / alteração de assento',        'Aéreo (passagem já emitida)', 'servico', 8, 4, 2, null, 20, true),
  ('ops_remarcacao', 'operacional', 'Remarcação de voo (data ou horário)',    'Aéreo (passagem já emitida)', 'servico', 8, 4, 2, null, 21, true),
  ('ops_bagagem',    'operacional', 'Bagagem extra',                          'Aéreo (passagem já emitida)', 'servico', 8, 4, 2, null, 22, true),
  ('ops_nome',       'operacional', 'Correção de nome / dados na passagem',   'Aéreo (passagem já emitida)', 'servico', 4, 2, 1, null, 23, true),
  ('ops_checkin',    'operacional', 'Check-in / cartão de embarque',          'Aéreo (passagem já emitida)', 'servico', 4, 2, 1, null, 24, true)
on conflict (id) do nothing;

update qs_solicitacao_tipos set grupo = 'Emissão e reservas', formulario = 'servico', ordem = 30 where id = 'ops_emissao';
update qs_solicitacao_tipos set grupo = 'Emissão e reservas', formulario = 'servico', ordem = 31,
       rotulo = 'Alteração de hotel, passeio ou serviço' where id = 'ops_alteracao';
update qs_solicitacao_tipos set grupo = 'Emissão e reservas', formulario = 'servico', ordem = 32 where id = 'ops_cancelamento';
update qs_solicitacao_tipos set grupo = 'Documentos', formulario = 'servico', ordem = 40 where id = 'ops_documentos';
update qs_solicitacao_tipos set grupo = 'Outros', ordem = 90 where id = 'ops_fornecedor';
update qs_solicitacao_tipos set grupo = 'Outros', ordem = 99 where id like '%\_outro' escape '\';

-- ── criar: formulário obrigatório na cotação e no serviço ──
create or replace function public.qs_sol_criar(p_de text, p_para text, p_tipo text, p_titulo text, p_descricao text, p_prioridade text DEFAULT 'normal'::text, p_prazo timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cliente uuid DEFAULT NULL::uuid, p_viagem uuid DEFAULT NULL::uuid, p_lead uuid DEFAULT NULL::uuid, p_conversa uuid DEFAULT NULL::uuid, p_sobre text DEFAULT NULL::text, p_formulario jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_horas int; v_form text; v_prazo timestamptz; v_sobre text := nullif(trim(coalesce(p_sobre, '')), '');
begin
  if not qs_do_setor(p_de) then raise exception 'Você não é desse setor.'; end if;
  if p_de = p_para then raise exception 'Escolha outro setor (o pedido é pra outro setor).'; end if;
  if nullif(trim(coalesce(p_titulo, '')), '') is null then raise exception 'Escreva o que você precisa.'; end if;
  select formulario into v_form from qs_solicitacao_tipos where id = p_tipo and setor = p_para and ativo;
  if not found then raise exception 'Tipo de pedido inválido pra esse setor.'; end if;
  v_horas := qs_sol_horas(p_tipo, p_prioridade);
  if v_form in ('cotacao', 'servico') and (p_formulario is null or jsonb_typeof(p_formulario) <> 'object') then
    raise exception 'Preencha o formulário do pedido.';
  end if;
  v_prazo := coalesce(p_prazo, qs_somar_minutos_uteis(now(), v_horas * 60));

  if p_viagem is not null then p_cliente := coalesce(p_cliente, (select cliente_id from rel_viagens where id = p_viagem)); end if;
  if p_conversa is not null then p_cliente := coalesce(p_cliente, (select cliente_id from rel_wa_conversas where id = p_conversa)); end if;
  if p_lead is not null and p_cliente is null then p_cliente := qs_sol_cliente_do_lead(p_lead); end if;

  v_sobre := coalesce(v_sobre, qs_sol_sobre(p_cliente, p_viagem));
  if v_sobre is null and p_lead is not null then
    select coalesce(full_name, trim(concat_ws(' ', first_name, last_name))) into v_sobre from qs_leads where id = p_lead;
  end if;
  if v_sobre is null and p_conversa is not null then
    select coalesce(c.nome_contato, c.telefone) into v_sobre from rel_wa_conversas c where c.id = p_conversa;
  end if;

  insert into qs_solicitacoes (de_setor, para_setor, tipo_id, titulo, descricao, prioridade, prazo, prazo_manual,
                               cliente_id, viagem_id, lead_id, conversa_id, sobre_nome, criado_por, atualizado_por, formulario)
  values (p_de, p_para, p_tipo, trim(p_titulo), coalesce(trim(p_descricao), ''), coalesce(p_prioridade, 'normal'), v_prazo, p_prazo is not null,
          p_cliente, p_viagem, p_lead, p_conversa, v_sobre, auth.uid(), auth.uid(), p_formulario)
  returning id into v_id;
  insert into qs_solicitacao_eventos (solicitacao_id, tipo, para, texto, autor_nome)
    values (v_id, 'criada', p_para, nullif(trim(coalesce(p_descricao, '')), ''), qs_eu_nome());
  insert into qs_solicitacao_vistos (solicitacao_id, user_id) values (v_id, auth.uid())
    on conflict (solicitacao_id, user_id) do update set visto_em = now();
  return v_id;
end $function$;
