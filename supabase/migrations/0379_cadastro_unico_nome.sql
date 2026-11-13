-- 0379_cadastro_unico_nome.sql
-- -----------------------------------------------------------------------------
-- PONTE PESSOA (4/4): O NOME TAMBÉM É DO CADASTRO ÚNICO (13/11/2026).
--
-- POR QUÊ
--   cad_trg_passageiro / cad_trg_ficha (cadastro único, 0213+) sincronizam CPF,
--   passaporte, validade, nascimento, e-mail, telefone e endereço entre a ficha
--   (rel_clientes) e as idas (passageiros) — mas não o NOME. Corrigiu o nome na
--   expedição, a ficha do Rel continuava com o antigo (e vice-versa).
--
-- O QUE FAZ (mesmo padrão dos outros campos, sem inventar regra nova)
--   • cad_valor_ficha / cad_valor_pax: campo 'nome' (cad_txt de rel_clientes.nome
--     / passageiros.nome_completo).
--   • cad_gravar_campo 'nome': grava na ficha e nas idas da pessoa. Nas idas,
--     igual ao passaporte, SÓ nas que ainda não voltaram (cad__ida_vigente):
--     o nome de uma viagem já feita é histórico (bilhete/seguro emitidos).
--   • cad_trg_ficha / cad_trg_passageiro: 'nome' entra na lista; os gatilhos
--     cad_ficha_upd / cad_passageiro_upd passam a escutar nome / nome_completo.
--   • cad_conciliar (ida NOVA ligada a uma ficha): se um lado está vazio, copia;
--     se os dois têm nome e são DIFERENTES, abre divergência em "Arrumar
--     cadastros" (cad_divergencias, campo 'nome') — como os outros campos.
--     "Diferente" ignora caixa/acento/pontuação (cad_nome): "JOSÉ silva" =
--     "Jose Silva" não vira divergência.
--   • cad_divergencias.campo aceita 'nome'.
--
-- NÚMEROS (13/11): 981 idas ligadas a ficha; 107 com nome diferente (cad_nome),
--   41 delas em idas vigentes. Nada é reescrito agora: só idas NOVAS geram
--   divergência, e só edição NOVA de nome propaga.
--
-- FRONT: src/clientes/cadastroUnico.ts ganhou o rótulo "Nome" (funciona com ou
--   sem esta migration).
--
-- COMO CONFERIR
--   select pg_get_triggerdef(oid) from pg_trigger where tgname in ('cad_ficha_upd', 'cad_passageiro_upd');
--   select cad_valor_ficha(c, 'nome') from rel_clientes c limit 1;
--   select * from cad_divergencias where campo = 'nome' and resolvido_em is null;
--
-- COMO VOLTAR
--   Recriar as 6 funções sem o ramo 'nome' (pg_get_functiondef vigente em 13/11
--   = este arquivo sem 'nome'), recriar os gatilhos sem nome/nome_completo, e
--   (depois de resolver/apagar as divergências 'nome') voltar o CHECK.
-- Idempotente.
-- -----------------------------------------------------------------------------

-- ── CHECK da fila ───────────────────────────────────────────────────────────
alter table public.cad_divergencias drop constraint if exists cad_divergencias_campo_check;
alter table public.cad_divergencias add constraint cad_divergencias_campo_check
  check (campo = any (array['pessoa', 'cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone', 'nome']));

-- ── Valores comparáveis ─────────────────────────────────────────────────────
create or replace function public.cad_valor_ficha(c rel_clientes, campo text)
returns text
language sql
immutable
as $function$
  select case campo when 'cpf' then cad_cpf(c.cpf) when 'passaporte' then cad_pass(c.passaporte)
    when 'passaporte_validade' then c.passaporte_validade::text when 'nascimento' then c.nascimento::text
    when 'email' then cad_email(c.email) when 'telefone' then cad_tel(c.telefone)
    when 'nome' then cad_txt(c.nome)
    when 'endereco_cep' then cad_cep(c.endereco_cep) when 'endereco_rua' then cad_txt(c.endereco_rua)
    when 'endereco_numero' then cad_txt(c.endereco_numero) when 'endereco_complemento' then cad_txt(c.endereco_complemento)
    when 'endereco_bairro' then cad_txt(c.endereco_bairro) when 'endereco_cidade' then cad_txt(c.endereco_cidade)
    when 'endereco_estado' then cad_uf(c.endereco_estado) end $function$;

create or replace function public.cad_valor_pax(p passageiros, campo text)
returns text
language sql
immutable
as $function$
  select case campo when 'cpf' then cad_cpf(p.cpf) when 'passaporte' then cad_pass(p.passaporte)
    when 'passaporte_validade' then p.validade_passaporte::text when 'nascimento' then p.data_nascimento::text
    when 'email' then cad_email(p.email) when 'telefone' then cad_tel(p.telefone)
    when 'nome' then cad_txt(p.nome_completo)
    when 'endereco_cep' then cad_cep(p.endereco_cep) when 'endereco_rua' then cad_txt(p.endereco_rua)
    when 'endereco_numero' then cad_txt(p.endereco_numero) when 'endereco_complemento' then cad_txt(p.endereco_complemento)
    when 'endereco_bairro' then cad_txt(p.endereco_bairro) when 'endereco_cidade' then cad_txt(p.endereco_cidade)
    when 'endereco_estado' then cad_uf(p.endereco_estado) end $function$;

-- ── Gravar ──────────────────────────────────────────────────────────────────
create or replace function public.cad_gravar_campo(p_cliente uuid, p_campo text, p_valor text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform set_config('cad.sync', 'on', true);
  if p_campo = 'cpf' then
    update rel_clientes set cpf = cad_cpf(p_valor) where id = p_cliente and cpf is distinct from cad_cpf(p_valor);
    update passageiros set cpf = cad_cpf_fmt(p_valor) where cliente_id = p_cliente and cad_cpf(cpf) is distinct from cad_cpf(p_valor);
  elsif p_campo = 'passaporte' then
    update rel_clientes set passaporte = cad_pass(p_valor) where id = p_cliente and passaporte is distinct from cad_pass(p_valor);
    update passageiros set passaporte = cad_pass(p_valor)
     where cliente_id = p_cliente and cad_pass(passaporte) is distinct from cad_pass(p_valor)
       and cad__ida_vigente(expedicao_id);
  elsif p_campo = 'passaporte_validade' then
    update rel_clientes set passaporte_validade = nullif(btrim(p_valor), '')::date where id = p_cliente and passaporte_validade is distinct from nullif(btrim(p_valor), '')::date;
    update passageiros set validade_passaporte = nullif(btrim(p_valor), '')::date
     where cliente_id = p_cliente and validade_passaporte is distinct from nullif(btrim(p_valor), '')::date
       and cad__ida_vigente(expedicao_id);
  elsif p_campo = 'nascimento' then
    update rel_clientes set nascimento = nullif(btrim(p_valor), '')::date where id = p_cliente and nascimento is distinct from nullif(btrim(p_valor), '')::date;
    update passageiros set data_nascimento = nullif(btrim(p_valor), '')::date where cliente_id = p_cliente and data_nascimento is distinct from nullif(btrim(p_valor), '')::date;
  elsif p_campo = 'email' then
    update rel_clientes set email = cad_email(p_valor) where id = p_cliente and lower(email) is distinct from cad_email(p_valor);
    update passageiros set email = cad_email(p_valor) where cliente_id = p_cliente and cad_email(email) is distinct from cad_email(p_valor);
  elsif p_campo = 'telefone' then
    update rel_clientes set telefone = cad_tel(p_valor) where id = p_cliente and telefone is distinct from cad_tel(p_valor);
    update passageiros set telefone = cad_tel(p_valor) where cliente_id = p_cliente and cad_tel(telefone) is distinct from cad_tel(p_valor);
  elsif p_campo = 'nome' then
    -- 0379. Nome vazio nunca apaga (rel_clientes.nome é NOT NULL). Nas idas, só as vigentes (como passaporte).
    if cad_txt(p_valor) is not null then
      update rel_clientes set nome = cad_txt(p_valor) where id = p_cliente and nome is distinct from cad_txt(p_valor);
      update passageiros set nome_completo = cad_txt(p_valor)
       where cliente_id = p_cliente and cad_txt(nome_completo) is distinct from cad_txt(p_valor)
         and cad__ida_vigente(expedicao_id);
    end if;
  elsif p_campo = any(cad_campos_endereco()) then
    execute format('update rel_clientes set %1$I = $1 where id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
    execute format('update passageiros set %1$I = $1 where cliente_id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
  end if;
  perform set_config('cad.sync', 'off', true);
end $function$;

-- ── Conciliar (ida nova) ────────────────────────────────────────────────────
create or replace function public.cad_conciliar(p_pax uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare p passageiros; c rel_clientes; f text; vp text; vc text; tem_p boolean; tem_c boolean;
begin
  select * into p from passageiros where id = p_pax;
  if p.cliente_id is null then return; end if;
  select * into c from rel_clientes where id = p.cliente_id;
  foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone', 'nome'] loop
    vp := cad_valor_pax(p, f); vc := cad_valor_ficha(c, f);
    if vp is null and vc is null then continue; end if;
    if vp is not distinct from vc then continue; end if;
    -- 0379: nome igual a menos de caixa/acento/pontuação não é divergência.
    if f = 'nome' and cad_nome(vp) is not distinct from cad_nome(vc) then continue; end if;
    if vc is null or vp is null then
      begin
        perform cad_gravar_campo(c.id, f, coalesce(vp, vc));
      exception when unique_violation then
        perform set_config('cad.sync', 'off', true);
        insert into cad_divergencias (cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao)
        values (c.id, p.id, f, vc, vp) on conflict (passageiro_id, campo) where resolvido_em is null do nothing;
      end;
    else
      insert into cad_divergencias (cliente_id, passageiro_id, campo, valor_ficha, valor_expedicao)
      values (c.id, p.id, f, vc, vp)
      on conflict (passageiro_id, campo) where resolvido_em is null
      do update set valor_ficha = excluded.valor_ficha, valor_expedicao = excluded.valor_expedicao;
    end if;
  end loop;
  select bool_or(cad_valor_pax(p, x) is not null), bool_or(cad_valor_ficha(c, x) is not null)
    into tem_p, tem_c from unnest(cad_campos_endereco()) x;
  if tem_p and not tem_c then
    foreach f in array cad_campos_endereco() loop
      vp := cad_valor_pax(p, f);
      if vp is not null then perform cad_gravar_campo(c.id, f, vp); end if;
    end loop;
  elsif tem_c and not tem_p then
    perform set_config('cad.sync', 'on', true);
    update passageiros set endereco_cep = cad_cep(c.endereco_cep), endereco_rua = cad_txt(c.endereco_rua),
           endereco_numero = cad_txt(c.endereco_numero), endereco_complemento = cad_txt(c.endereco_complemento),
           endereco_bairro = cad_txt(c.endereco_bairro), endereco_cidade = cad_txt(c.endereco_cidade),
           endereco_estado = cad_uf(c.endereco_estado)
     where id = p.id;
    perform set_config('cad.sync', 'off', true);
  end if;
end $function$;

-- ── Gatilho da ficha ────────────────────────────────────────────────────────
create or replace function public.cad_trg_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f text; vn text; vo text;
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone', 'nome'] || cad_campos_endereco() loop
      vn := cad_valor_ficha(new, f); vo := cad_valor_ficha(old, f);
      if vn is not null and vn is distinct from vo then
        perform cad_gravar_campo(new.id, f, vn);
        update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = 'editado'
         where cliente_id = new.id and cad_divergencias.campo = f and resolvido_em is null;
      end if;
    end loop;
    if new.mesclado_em_id is not null and old.mesclado_em_id is null then
      perform set_config('cad.sync', 'on', true);
      update passageiros set cliente_id = cad_ficha_viva(new.mesclado_em_id) where cliente_id = new.id;
      update cad_divergencias set cliente_id = cad_ficha_viva(new.mesclado_em_id) where cliente_id = new.id and resolvido_em is null;
      perform cad_mover_acompanhantes(new.id, cad_ficha_viva(new.mesclado_em_id));
      perform set_config('cad.sync', 'off', true);
    end if;
  exception when others then
    raise warning 'cadastro único: ficha % não sincronizou: %', new.id, sqlerrm;
  end;
  return null;
end $function$;

-- ── Gatilho da ida ──────────────────────────────────────────────────────────
create or replace function public.cad_trg_passageiro()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare f text; vn text; vo text; v uuid;
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    if new.cliente_id is null then
      v := cad_ligar_passageiro(new.id, true);
      if v is not null then perform cad_sincronizar_acompanhante(new.id); end if;
      return null;
    end if;
    if tg_op = 'UPDATE' then
      foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone', 'nome'] || cad_campos_endereco() loop
        vn := cad_valor_pax(new, f); vo := cad_valor_pax(old, f);
        if vn is not null and vn is distinct from vo then
          perform cad_gravar_campo(new.cliente_id, f, vn);
          update cad_divergencias set resolvido_em = now(), resolvido_por = auth.uid(), escolha = 'editado'
           where cliente_id = new.cliente_id and cad_divergencias.campo = f and resolvido_em is null;
        end if;
      end loop;
      if new.acompanhante_nome is distinct from old.acompanhante_nome or new.cliente_id is distinct from old.cliente_id then
        perform cad_sincronizar_acompanhante(new.id);
      end if;
    else
      perform cad_conciliar(new.id);
      perform cad_sincronizar_acompanhante(new.id);
    end if;
  exception when others then
    raise warning 'cadastro único: passageiro % não sincronizou: %', new.id, sqlerrm;
  end;
  return null;
end $function$;

-- ── Os gatilhos passam a escutar o nome ─────────────────────────────────────
drop trigger if exists cad_ficha_upd on public.rel_clientes;
create trigger cad_ficha_upd
  after update of cpf, passaporte, passaporte_validade, nascimento, email, telefone, mesclado_em_id, nome
  on public.rel_clientes
  for each row execute function public.cad_trg_ficha();

drop trigger if exists cad_passageiro_upd on public.passageiros;
create trigger cad_passageiro_upd
  after update of cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, cliente_id, nome_completo
  on public.passageiros
  for each row execute function public.cad_trg_passageiro();
