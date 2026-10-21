-- 0166 · Prontidão de embarque das Expedições no QS (21/10/2026).
-- No app antigo os requisitos do destino (passageiro_requisitos) só nasciam quando a
-- TELA chamava gerarRequisitosPadrao — pax vindo do Bitrix (webhook sem sessão) ou de
-- outro caminho ficava sem requisito nenhum. Aqui:
--  1) exp_catalogo_requisitos(destino): o catálogo por destino, IGUAL ao
--     src/expedicoes/lib/prontidao/requisitos-destino.ts (fonte de verdade — se mudar
--     um, mude o outro). A tabela requisitos_destino (semente velha) segue sem uso.
--  2) Trigger em passageiros: ao inserir (ou mudar de expedição / sair de Cancelado)
--     cria os requisitos que faltam do destino, com os mesmos pré-preenchimentos do
--     template.ts (localizador ⇒ Aéreo Internacional aprovado; sem voo nacional ⇒
--     Aéreo Doméstico dispensado). Idempotente POR TIPO (on conflict do nothing).
--  3) exp_gerar_requisitos(expedicao): botão "Gerar requisitos de <destino>".
--  4) Certificado de febre amarela é da PESSOA: espalha pro slot "Vacina" de todas as
--     reservas dela (mesma regra do lib/prontidao/vacina-sync.ts; nunca sobrescreve).
-- Só aditivo: funções + trigger. Não grava dado ao aplicar.

create or replace function public.exp_catalogo_requisitos(p_destino text)
returns table(ordem int, tipo tipo_requisito, descricao text, obrigatoriedade obrigatoriedade, bloqueia_embarque boolean, observacoes text)
language sql immutable set search_path to 'public' as $function$
  with base(ordem, tipo, descricao, obrig, bloq, obs) as (values
    (1, 'Passaporte', 'Passaporte válido (≥ 6 meses após o retorno) + foto/PDF anexado', 'Obrigatório', true, null::text),
    (2, 'Dados Pessoais', 'Cadastro completo (CPF, nascimento, contato)', 'Obrigatório', true, null),
    (3, 'Contrato', 'Contrato assinado', 'Obrigatório', true, null),
    (4, 'Seguro', 'Seguro viagem emitido cobrindo todo o período', 'Obrigatório', true, null),
    (5, 'Aéreo Internacional', 'Bilhete internacional emitido (localizador)', 'Obrigatório', true, null)
  ),
  extra(dest, ordem, tipo, descricao, obrig, bloq, obs) as (values
    ('Peru', 6, 'Vacina', 'Certificado Internacional de Vacinação (febre amarela)', 'Condicional', true, 'Recomendada para selva/Machu Picchu; conferir exigência.'::text),
    ('Peru', 7, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Peru', 8, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Peru', 9, 'Ingresso Machu Picchu', 'Ingresso de Machu Picchu (anexo)', 'Recomendado', false, null),
    ('Peru', 10, 'Ingresso Trem Machu Picchu', 'Ingresso de trem para Machu Picchu — ida e volta (anexos)', 'Recomendado', false, null),
    ('Argentina', 6, 'RG', 'RG válido (≤ 10 anos) — alternativa ao passaporte no Mercosul', 'Recomendado', false, null),
    ('Argentina', 7, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Argentina', 8, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Chile', 6, 'RG', 'RG válido (≤ 10 anos) — alternativa ao passaporte no Mercosul', 'Recomendado', false, null),
    ('Chile', 7, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Chile', 8, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Japão', 6, 'Visto', 'Visto de turismo (confirmar isenção vigente para BR)', 'Condicional', true, 'Verificar regra de isenção atual antes de instanciar como obrigatório.'),
    ('Japão', 7, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Japão', 8, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Egito', 6, 'Visto', 'Visto do Egito (e-visa ou on arrival)', 'Obrigatório', true, null),
    ('Egito', 7, 'Vacina', 'Certificado Internacional de Vacinação (febre amarela)', 'Condicional', true, 'Exigível conforme regiões visitadas / país de origem.'),
    ('Egito', 8, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Egito', 9, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Tailândia', 6, 'Vacina', 'Certificado Internacional de Vacinação (febre amarela)', 'Condicional', true, 'Febre amarela exigível conforme país de origem/regiões — conferir.'),
    ('Tailândia', 7, 'Aéreo Doméstico', 'Trecho doméstico no destino emitido', 'Condicional', false, null),
    ('Tailândia', 8, 'Voo Interno', 'Voo interno (trecho aéreo) emitido', 'Condicional', false, null),
    ('Itália', 6, 'Visto', 'Autorização ETIAS (quando exigível) — Schengen', 'Recomendado', false, 'ETIAS para isentos de visto; confirmar data de entrada em vigor.')
  )
  select x.ordem, x.tipo::tipo_requisito, x.descricao, x.obrig::obrigatoriedade, x.bloq, x.obs
    from (select ordem, tipo, descricao, obrig, bloq, obs from base
          union all
          select ordem, tipo, descricao, obrig, bloq, obs from extra where dest = p_destino) x
   order by x.ordem;
$function$;

-- Cria (só os que faltam) os requisitos do destino pra UM passageiro. Interna: sem checagem
-- de papel (quem chama já checou, ou é o trigger da própria inserção). Devolve quantos criou.
create or replace function public._exp_instanciar_requisitos(p_pax uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer := 0;
begin
  insert into passageiro_requisitos (passageiro_id, tipo, descricao, status, obrigatoriedade, bloqueia_embarque, numero, observacoes)
  select p.id, c.tipo, c.descricao,
         (case
            when c.tipo = 'Aéreo Internacional' then case when nullif(trim(p.localizador), '') is not null then 'Aprovado' else 'Pendente' end
            when c.tipo = 'Aéreo Doméstico' then case when p.voo_nacional_necessario then 'Pendente' else 'Dispensado' end
            else 'Pendente' end)::status_requisito,
         c.obrigatoriedade, c.bloqueia_embarque,
         case when c.tipo = 'Aéreo Internacional' then nullif(trim(p.localizador), '') end,
         c.observacoes
    from passageiros p
    join expedicoes e on e.id = p.expedicao_id
    cross join lateral exp_catalogo_requisitos(e.destino) c
   where p.id = p_pax
     and p.status_reserva <> 'Cancelado'
     and c.tipo not in ('Contrato', 'Dados Pessoais')
  on conflict (passageiro_id, tipo) do nothing;
  get diagnostics n = row_count;
  return n;
end $function$;

-- Certificado de febre amarela da pessoa (por CPF) → slots "Vacina" vazios de todas as reservas.
create or replace function public._exp_espalhar_vacina(p_cpf text, p_cert uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_dig text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_ids uuid[];
  v_cert uuid := p_cert;
  n integer := 0;
begin
  if length(v_dig) <> 11 then return 0; end if;
  select array_agg(id) into v_ids from passageiros where regexp_replace(coalesce(cpf, ''), '\D', '', 'g') = v_dig;
  if v_ids is null then return 0; end if;
  if v_cert is null then
    select arquivo_id into v_cert from passageiro_requisitos
     where passageiro_id = any(v_ids) and tipo = 'Vacina' and arquivo_id is not null limit 1;
  end if;
  if v_cert is null then
    select id into v_cert from arquivos
     where passageiro_id = any(v_ids) and descricao ilike '%Febre Amarela%' order by created_at desc limit 1;
  end if;
  if v_cert is null then return 0; end if;
  update passageiro_requisitos
     set arquivo_id = v_cert,
         status = case when status = 'Aprovado' then 'Aprovado'::status_requisito else 'Enviado'::status_requisito end
   where passageiro_id = any(v_ids) and tipo = 'Vacina' and arquivo_id is null
     and status not in ('Dispensado', 'Reprovado');
  get diagnostics n = row_count;
  return n;
end $function$;

create or replace function public._exp_trg_passageiro_requisitos()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.expedicao_id is null or new.status_reserva = 'Cancelado' then return null; end if;
  if tg_op = 'UPDATE'
     and new.expedicao_id is not distinct from old.expedicao_id
     and not (old.status_reserva = 'Cancelado' and new.status_reserva <> 'Cancelado') then
    return null;
  end if;
  if _exp_instanciar_requisitos(new.id) > 0 then
    perform _exp_espalhar_vacina(new.cpf, null);
  end if;
  return null;
end $function$;

drop trigger if exists trg_passageiros_requisitos on public.passageiros;
create trigger trg_passageiros_requisitos
  after insert or update of expedicao_id, status_reserva on public.passageiros
  for each row execute function public._exp_trg_passageiro_requisitos();

-- Botão "Gerar requisitos de <destino>": cria o que faltar pra todos os pax ativos da expedição.
create or replace function public.exp_gerar_requisitos(p_expedicao uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare r record; n integer := 0; k integer;
begin
  if not exp_tem_acesso() or is_readonly() then raise exception 'Seu perfil é só de leitura nas Expedições — essa ação não é permitida.'; end if;
  for r in select id, cpf from passageiros where expedicao_id = p_expedicao and status_reserva <> 'Cancelado' loop
    k := _exp_instanciar_requisitos(r.id);
    if k > 0 then perform _exp_espalhar_vacina(r.cpf, null); end if;
    n := n + k;
  end loop;
  return n;
end $function$;

-- Chamado pela tela depois de anexar o certificado num slot Vacina.
create or replace function public.exp_espalhar_vacina(p_cpf text, p_cert uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exp_tem_acesso() or is_readonly() then raise exception 'Seu perfil é só de leitura nas Expedições — essa ação não é permitida.'; end if;
  return _exp_espalhar_vacina(p_cpf, p_cert);
end $function$;

revoke execute on function public._exp_instanciar_requisitos(uuid), public._exp_espalhar_vacina(text, uuid),
  public._exp_trg_passageiro_requisitos() from public, anon, authenticated;
revoke execute on function public.exp_gerar_requisitos(uuid), public.exp_espalhar_vacina(text, uuid) from public, anon;
grant execute on function public.exp_gerar_requisitos(uuid), public.exp_espalhar_vacina(text, uuid) to authenticated;
grant execute on function public.exp_catalogo_requisitos(text) to authenticated;
