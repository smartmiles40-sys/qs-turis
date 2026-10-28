-- 0213 — CADASTRO ÚNICO DO CLIENTE, EDITÁVEL POR TODOS OS SETORES (Bruno, 28/10/2026)
-- "Deixar muito bem alinhado o cadastro do cliente, ainda mais entre Relacionamento e
-- Operações. A mesma informação que um tem o outro também tem que ter."
-- E no Closer: "card do cliente fácil e simples de preencher: nome, DN, passaporte,
-- validade, e-mail, CPF, endereço e se tem outra pessoa que vai viajar junto — se o SDR
-- também conseguir cadastrar, melhor."
--
-- O que esta migration faz (tudo idempotente, pode rodar de novo):
--   1. rel_clientes ganha ENDEREÇO (mesmas colunas de passageiros: endereco_cep…estado)
--      e `origem` ('comercial' = ficha nascida no SDR/Closer, antes de existir venda).
--   2. cad_acompanhantes: quem viaja junto com quem (cônjuge, filho, pai/mãe, irmão,
--      amigo, outro). Cada acompanhante é uma ficha rel_clientes própria. Um par só
--      (A↔B vale nos dois sentidos; o vínculo é lido do ponto de vista de quem consulta).
--   3. qs_leads.cliente_id: o lead do comercial aponta pra pessoa (ficha) — o SDR e o
--      closer preenchem o cadastro ANTES de existir venda.
--   4. Operações passa a EDITAR a ficha (antes só lia — 0173). Rel e Ops editam igual;
--      em conflito vale a última gravação. Toda mudança já fica em rel_auditoria
--      (trigger rel_audita: quem/quando/antes/depois) — a tabela nova também é auditada,
--      e o Ops passa a ler o histórico da ficha.
--   5. Sincronia ficha ↔ passageiro estendida pro ENDEREÇO (campo a campo, como CPF etc.)
--      e pro ACOMPANHANTE (texto livre do passageiro ↔ ligação entre fichas). As funções
--      da 0172 foram reescritas a partir da definição VIGENTE no banco (pg_get_functiondef
--      em 28/10) — só ACRESCENTA, o comportamento antigo é o mesmo.
--   6. RPCs pro comercial (SECURITY DEFINER, com checagem): o SDR/closer não ganha acesso
--      à base inteira de clientes; só à pessoa ligada a um lead que ele já enxerga (e aos
--      acompanhantes dela).
--         cad_pessoa_do_lead(lead, criar)     acha (ligada → telefone → e-mail) ou cria
--         cad_buscar_ou_criar(cpf, tel, email, nome, criar)   CPF → telefone → e-mail
--         cad_ligar_lead(lead, cliente)
--         cad_ler_pessoa(id) / cad_salvar_pessoa(id, campos jsonb)
--         cad_ligar_acompanhante(cliente, acompanhante, vinculo) / cad_desligar_acompanhante
--   7. Backfill: endereço da ficha a partir do passageiro mais recente (só quando a ficha
--      não tem endereço nenhum) e acompanhantes a partir do texto dos passageiros (quando o
--      nome bate com outro passageiro da MESMA expedição).
-- Rollback comentado no fim.

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────
alter table public.rel_clientes
  add column if not exists endereco_cep text,
  add column if not exists endereco_rua text,
  add column if not exists endereco_numero text,
  add column if not exists endereco_complemento text,
  add column if not exists endereco_bairro text,
  add column if not exists endereco_cidade text,
  add column if not exists endereco_estado text,
  add column if not exists origem text;
comment on column public.rel_clientes.origem is
  '0213: de onde a ficha nasceu. ''comercial'' = criada pelo SDR/Closer a partir do lead (pode ainda não ter comprado). null = Relacionamento/Operações/expedição.';

alter table public.qs_leads add column if not exists cliente_id uuid references public.rel_clientes(id) on delete set null;
create index if not exists qs_leads_cliente_idx on public.qs_leads (cliente_id) where cliente_id is not null;
comment on column public.qs_leads.cliente_id is '0213: a pessoa (ficha rel_clientes) deste lead. Preenchida por cad_pessoa_do_lead / cad_ligar_lead.';

-- ── 2. Acompanhantes ─────────────────────────────────────────────────────────
create table if not exists public.cad_acompanhantes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.rel_clientes(id) on delete cascade,
  acompanhante_id uuid not null references public.rel_clientes(id) on delete cascade,
  -- do ponto de vista de cliente_id: "acompanhante_id é <vinculo> de cliente_id"
  vinculo text not null default 'outro' check (vinculo in ('conjuge', 'filho', 'pai_mae', 'irmao', 'amigo', 'outro')),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (cliente_id <> acompanhante_id)
);
-- um par só, valha a ordem que for (A↔B)
create unique index if not exists cad_acompanhantes_par_uq
  on public.cad_acompanhantes (least(cliente_id, acompanhante_id), greatest(cliente_id, acompanhante_id));
create index if not exists cad_acompanhantes_acomp_idx on public.cad_acompanhantes (acompanhante_id);
comment on table public.cad_acompanhantes is '0213: quem viaja junto com quem. Cada um tem a própria ficha; o par vale nos dois sentidos.';

alter table public.cad_acompanhantes enable row level security;
drop policy if exists app_cliente_barreira on public.cad_acompanhantes;
create policy app_cliente_barreira on public.cad_acompanhantes as restrictive for all to authenticated
  using (not (select app_eh_cliente())) with check (not (select app_eh_cliente()));
drop policy if exists cad_acomp_ler on public.cad_acompanhantes;
create policy cad_acomp_ler on public.cad_acompanhantes for select to authenticated
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()) or (select fin_tem_acesso()));
drop policy if exists cad_acomp_escrever on public.cad_acompanhantes;
create policy cad_acomp_escrever on public.cad_acompanhantes for all to authenticated
  using ((select rel_tem_acesso()) or (select ops_tem_acesso()))
  with check ((select rel_tem_acesso()) or (select ops_tem_acesso()));

drop trigger if exists trg_cad_acompanhantes_audita on public.cad_acompanhantes;
create trigger trg_cad_acompanhantes_audita after insert or update or delete on public.cad_acompanhantes
  for each row execute function public.rel_audita();

-- ── 3. Operações EDITA a ficha (policies novas, permissivas; as do Rel ficam iguais) ──
drop policy if exists rel_clientes_ops_criar on public.rel_clientes;
create policy rel_clientes_ops_criar on public.rel_clientes for insert to authenticated
  with check ((select ops_tem_acesso()));
drop policy if exists rel_clientes_ops_editar on public.rel_clientes;
create policy rel_clientes_ops_editar on public.rel_clientes for update to authenticated
  using ((select ops_tem_acesso())) with check ((select ops_tem_acesso()));
-- histórico da ficha (aba "Histórico") também pro Operações — só da ficha e dos acompanhantes
drop policy if exists rel_auditoria_ops_ler on public.rel_auditoria;
create policy rel_auditoria_ops_ler on public.rel_auditoria for select to authenticated
  using ((select ops_tem_acesso()) and tabela in ('rel_clientes', 'cad_acompanhantes'));

-- ── 4. Normalizadores do endereço ────────────────────────────────────────────
create or replace function public.cad_txt(t text) returns text language sql immutable as
$$ select nullif(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g'), '') $$;
create or replace function public.cad_cep(t text) returns text language sql immutable as
$$ select case when length(cad_dig(t)) = 8 then substr(cad_dig(t), 1, 5) || '-' || substr(cad_dig(t), 6) else cad_txt(t) end $$;
create or replace function public.cad_uf(t text) returns text language sql immutable as
$$ select upper(cad_txt(t)) $$;
create or replace function public.cad_campos_endereco() returns text[] language sql immutable as
$$ select array['endereco_cep', 'endereco_rua', 'endereco_numero', 'endereco_complemento', 'endereco_bairro', 'endereco_cidade', 'endereco_estado'] $$;

-- Vínculo: chave ↔ rótulo ↔ texto livre do passageiro
create or replace function public.cad_vinculo_rotulo(v text) returns text language sql immutable as $$
  select case v when 'conjuge' then 'Cônjuge' when 'filho' then 'Filho(a)' when 'pai_mae' then 'Pai/Mãe'
    when 'irmao' then 'Irmão(ã)' when 'amigo' then 'Amigo(a)' else 'Outro' end $$;
create or replace function public.cad_vinculo_inverso(v text) returns text language sql immutable as $$
  select case v when 'filho' then 'pai_mae' when 'pai_mae' then 'filho' else coalesce(v, 'outro') end $$;
-- "Cônjuge", "Esposo; cunhada", "Amigas", "Mãe"… → chave (o primeiro que reconhecer)
create or replace function public.cad_vinculo_de_texto(t text) returns text language sql immutable as $$
  select case
    when cad_nome(t) is null then 'outro'
    when cad_nome(t) ~ '(conj|espos|marid|namor|companheir)' then 'conjuge'
    when cad_nome(t) ~ 'filh' then 'filho'
    when cad_nome(t) ~ '(^| )(pai|mae)( |$)' then 'pai_mae'
    when cad_nome(t) ~ 'irm' then 'irmao'
    when cad_nome(t) ~ '(amig|amog)' then 'amigo'
    else 'outro' end $$;

-- ── 5. Sincronia ficha ↔ passageiro (0172 + endereço) ────────────────────────
-- (definições VIGENTES de 28/10 + os casos de endereço no fim de cada CASE)
create or replace function public.cad_valor_ficha(c rel_clientes, campo text)
 returns text language sql immutable as $function$
  select case campo when 'cpf' then cad_cpf(c.cpf) when 'passaporte' then cad_pass(c.passaporte)
    when 'passaporte_validade' then c.passaporte_validade::text when 'nascimento' then c.nascimento::text
    when 'email' then cad_email(c.email) when 'telefone' then cad_tel(c.telefone)
    when 'endereco_cep' then cad_cep(c.endereco_cep) when 'endereco_rua' then cad_txt(c.endereco_rua)
    when 'endereco_numero' then cad_txt(c.endereco_numero) when 'endereco_complemento' then cad_txt(c.endereco_complemento)
    when 'endereco_bairro' then cad_txt(c.endereco_bairro) when 'endereco_cidade' then cad_txt(c.endereco_cidade)
    when 'endereco_estado' then cad_uf(c.endereco_estado) end $function$;

create or replace function public.cad_valor_pax(p passageiros, campo text)
 returns text language sql immutable as $function$
  select case campo when 'cpf' then cad_cpf(p.cpf) when 'passaporte' then cad_pass(p.passaporte)
    when 'passaporte_validade' then p.validade_passaporte::text when 'nascimento' then p.data_nascimento::text
    when 'email' then cad_email(p.email) when 'telefone' then cad_tel(p.telefone)
    when 'endereco_cep' then cad_cep(p.endereco_cep) when 'endereco_rua' then cad_txt(p.endereco_rua)
    when 'endereco_numero' then cad_txt(p.endereco_numero) when 'endereco_complemento' then cad_txt(p.endereco_complemento)
    when 'endereco_bairro' then cad_txt(p.endereco_bairro) when 'endereco_cidade' then cad_txt(p.endereco_cidade)
    when 'endereco_estado' then cad_uf(p.endereco_estado) end $function$;

create or replace function public.cad_gravar_campo(p_cliente uuid, p_campo text, p_valor text)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform set_config('cad.sync', 'on', true);
  if p_campo = 'cpf' then
    update rel_clientes set cpf = cad_cpf(p_valor) where id = p_cliente and cpf is distinct from cad_cpf(p_valor);
    update passageiros set cpf = cad_cpf_fmt(p_valor) where cliente_id = p_cliente and cad_cpf(cpf) is distinct from cad_cpf(p_valor);
  elsif p_campo = 'passaporte' then
    update rel_clientes set passaporte = cad_pass(p_valor) where id = p_cliente and passaporte is distinct from cad_pass(p_valor);
    update passageiros set passaporte = cad_pass(p_valor) where cliente_id = p_cliente and cad_pass(passaporte) is distinct from cad_pass(p_valor);
  elsif p_campo = 'passaporte_validade' then
    update rel_clientes set passaporte_validade = p_valor::date where id = p_cliente and passaporte_validade is distinct from p_valor::date;
    update passageiros set validade_passaporte = p_valor::date where cliente_id = p_cliente and validade_passaporte is distinct from p_valor::date;
  elsif p_campo = 'nascimento' then
    update rel_clientes set nascimento = p_valor::date where id = p_cliente and nascimento is distinct from p_valor::date;
    update passageiros set data_nascimento = p_valor::date where cliente_id = p_cliente and data_nascimento is distinct from p_valor::date;
  elsif p_campo = 'email' then
    update rel_clientes set email = cad_email(p_valor) where id = p_cliente and lower(email) is distinct from cad_email(p_valor);
    update passageiros set email = cad_email(p_valor) where cliente_id = p_cliente and cad_email(email) is distinct from cad_email(p_valor);
  elsif p_campo = 'telefone' then
    update rel_clientes set telefone = cad_tel(p_valor) where id = p_cliente and telefone is distinct from cad_tel(p_valor);
    update passageiros set telefone = cad_tel(p_valor) where cliente_id = p_cliente and cad_tel(telefone) is distinct from cad_tel(p_valor);
  elsif p_campo = any(cad_campos_endereco()) then
    -- 0213: endereço — mesmas colunas nas duas tabelas; o valor já chega normalizado
    execute format('update rel_clientes set %1$I = $1 where id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
    execute format('update passageiros set %1$I = $1 where cliente_id = $2 and %1$I is distinct from $1', p_campo) using p_valor, p_cliente;
  end if;
  perform set_config('cad.sync', 'off', true);
end $function$;

-- Conciliar (passageiro novo ligado à ficha). Documentos: igual à 0172 (divergência
-- quando os dois têm valor diferente). Endereço (0213): é um BLOCO — se só um lado tem
-- endereço, copia pro outro; se os dois têm e diferem, não abre divergência (a próxima
-- edição de qualquer lado vale pra todos).
create or replace function public.cad_conciliar(p_pax uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare p passageiros; c rel_clientes; f text; vp text; vc text; tem_p boolean; tem_c boolean;
begin
  select * into p from passageiros where id = p_pax;
  if p.cliente_id is null then return; end if;
  select * into c from rel_clientes where id = p.cliente_id;
  foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] loop
    vp := cad_valor_pax(p, f); vc := cad_valor_ficha(c, f);
    if vp is null and vc is null then continue; end if;
    if vp is not distinct from vc then continue; end if;
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
  -- 0213: endereço em bloco
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

-- ── 6. Acompanhantes: ficha ↔ passageiro ─────────────────────────────────────
-- Os acompanhantes de uma pessoa, nos dois sentidos, com o vínculo do ponto de vista dela.
create or replace function public.cad_acompanhantes_de(p uuid)
 returns table (acompanhante_id uuid, vinculo text)
 language sql stable security definer set search_path to 'public' as $$
  select a.acompanhante_id, a.vinculo from cad_acompanhantes a where a.cliente_id = p
  union
  select a.cliente_id, cad_vinculo_inverso(a.vinculo) from cad_acompanhantes a where a.acompanhante_id = p
$$;

-- Ficha → passageiro: nas idas desta pessoa com "acompanhante" em branco, se um acompanhante
-- dela está na MESMA expedição, preenche nome e vínculo. Nunca sobrescreve o que já foi digitado.
create or replace function public.cad_preencher_acompanhante_pax(p_cliente uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare ant text := coalesce(current_setting('cad.sync', true), 'off');
begin
  if p_cliente is null then return; end if;
  perform set_config('cad.sync', 'on', true);
  update passageiros p
     set acompanhante_nome = o.nome_completo,
         acompanhante_vinculo = coalesce(nullif(trim(p.acompanhante_vinculo), ''), cad_vinculo_rotulo(a.vinculo))
    from cad_acompanhantes_de(p_cliente) a
    join passageiros o on o.cliente_id = a.acompanhante_id
   where p.cliente_id = p_cliente and o.expedicao_id = p.expedicao_id and o.id <> p.id
     and o.status_reserva::text <> 'Cancelado'
     and nullif(trim(p.acompanhante_nome), '') is null;
  perform set_config('cad.sync', ant, true);
end $function$;

-- Passageiro → ficha: o texto "acompanhante" do passageiro vira ligação entre as fichas
-- quando bate com o nome de outro passageiro da mesma expedição (nome igual; ou, se não
-- houver, o único cujo nome começa com o que foi digitado). Depois preenche os brancos.
create or replace function public.cad_sincronizar_acompanhante(p_pax uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
declare p passageiros; alvo uuid; n int; r record;
begin
  select * into p from passageiros where id = p_pax;
  if not found or p.cliente_id is null then return; end if;
  if cad_nome(p.acompanhante_nome) is not null then
    select count(distinct cad_ficha_viva(x.cliente_id)), min(cad_ficha_viva(x.cliente_id)::text)::uuid into n, alvo
      from passageiros x
     where x.expedicao_id = p.expedicao_id and x.id <> p.id and x.cliente_id is not null
       and cad_nome(x.nome_completo) = cad_nome(p.acompanhante_nome);
    if n <> 1 then
      select count(distinct cad_ficha_viva(x.cliente_id)), min(cad_ficha_viva(x.cliente_id)::text)::uuid into n, alvo
        from passageiros x
       where x.expedicao_id = p.expedicao_id and x.id <> p.id and x.cliente_id is not null
         and cad_nome(x.nome_completo) like cad_nome(p.acompanhante_nome) || ' %';
    end if;
    if n = 1 and alvo is not null and alvo <> cad_ficha_viva(p.cliente_id) then
      insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo)
      values (cad_ficha_viva(p.cliente_id), alvo, cad_vinculo_de_texto(p.acompanhante_vinculo))
      on conflict do nothing;
    end if;
  end if;
  perform cad_preencher_acompanhante_pax(p.cliente_id);
  for r in select acompanhante_id from cad_acompanhantes_de(p.cliente_id) loop
    perform cad_preencher_acompanhante_pax(r.acompanhante_id);
  end loop;
end $function$;

-- Ligação nova entre fichas → preenche os passageiros dos dois lados.
create or replace function public.cad_trg_acompanhante()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    perform cad_preencher_acompanhante_pax(new.cliente_id);
    perform cad_preencher_acompanhante_pax(new.acompanhante_id);
  exception when others then
    raise warning 'cadastro único: acompanhante % não sincronizou: %', new.id, sqlerrm;
  end;
  return null;
end $function$;
drop trigger if exists cad_acompanhante_ins on public.cad_acompanhantes;
create trigger cad_acompanhante_ins after insert on public.cad_acompanhantes
  for each row execute function public.cad_trg_acompanhante();

-- Ficha juntada (mesclada) leva acompanhantes e leads pra ficha que ficou.
create or replace function public.cad_mover_acompanhantes(p_de uuid, p_para uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_de is null or p_para is null or p_de = p_para then return; end if;
  delete from cad_acompanhantes where (cliente_id = p_de and acompanhante_id = p_para) or (cliente_id = p_para and acompanhante_id = p_de);
  delete from cad_acompanhantes a
   where (a.cliente_id = p_de or a.acompanhante_id = p_de)
     and exists (select 1 from cad_acompanhantes_de(p_para) b
                  where b.acompanhante_id = case when a.cliente_id = p_de then a.acompanhante_id else a.cliente_id end);
  update cad_acompanhantes set cliente_id = p_para where cliente_id = p_de;
  update cad_acompanhantes set acompanhante_id = p_para where acompanhante_id = p_de;
  update qs_leads set cliente_id = p_para where cliente_id = p_de;
end $function$;

-- Trigger da ficha (0172) + endereço no laço + juntar leva acompanhantes/leads.
create or replace function public.cad_trg_ficha()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare f text; vn text; vo text;
begin
  if coalesce(current_setting('cad.sync', true), 'off') = 'on' then return null; end if;
  begin
    foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] || cad_campos_endereco() loop
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

-- Trigger do passageiro (0172) + endereço no laço + acompanhante.
create or replace function public.cad_trg_passageiro()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
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
      foreach f in array array['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'email', 'telefone'] || cad_campos_endereco() loop
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

-- ── 7. Quem pode mexer na pessoa ─────────────────────────────────────────────
-- Lead que o usuário enxerga (mesma regra da policy leads_select de qs_leads).
create or replace function public.cad_lead_visivel(p_lead uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from qs_leads l
     where l.id = p_lead
       and (qs_is_manager() or qs_is_closer() or l.owner_id = auth.uid()
            or exists (select 1 from qs_meetings m where m.lead_id = l.id and m.owner_id = auth.uid())))
$$;

-- Editar: Relacionamento, Operações (0213), ou o comercial que enxerga um lead ligado a
-- esta pessoa ou a alguém que viaja com ela.
create or replace function public.cad_pode_editar(p uuid)
 returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
declare v uuid := cad_ficha_viva(p);
begin
  if v is null then return false; end if;
  if rel_tem_acesso() or ops_tem_acesso() then return true; end if;
  return exists (
    select 1 from qs_leads l
     where l.cliente_id in (select v union select acompanhante_id from cad_acompanhantes_de(v))
       and cad_lead_visivel(l.id));
end $function$;

create or replace function public.cad_pode_ver(p uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $$
  select fin_tem_acesso() or cad_pode_editar(p)
$$;

-- ── 8. RPCs ──────────────────────────────────────────────────────────────────
-- A ficha + acompanhantes, num jsonb só (o componente CadastroPessoa lê daqui).
create or replace function public.cad_ler_pessoa(p uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v uuid := cad_ficha_viva(p); c rel_clientes; acomp jsonb;
begin
  if not cad_pode_ver(v) then raise exception 'Sem acesso a este cadastro.' using errcode = '42501'; end if;
  select * into c from rel_clientes where id = v;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'nome', x.nome, 'vinculo', a.vinculo, 'cpf', x.cpf, 'nascimento', x.nascimento,
           'passaporte', x.passaporte, 'passaporte_validade', x.passaporte_validade, 'email', x.email, 'telefone', x.telefone)
         order by x.nome), '[]'::jsonb)
    into acomp
    from cad_acompanhantes_de(v) a join rel_clientes x on x.id = a.acompanhante_id and x.mesclado_em_id is null;
  return jsonb_build_object(
    'id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'nascimento', c.nascimento, 'passaporte', c.passaporte,
    'passaporte_validade', c.passaporte_validade, 'email', c.email, 'telefone', c.telefone,
    'endereco_cep', c.endereco_cep, 'endereco_rua', c.endereco_rua, 'endereco_numero', c.endereco_numero,
    'endereco_complemento', c.endereco_complemento, 'endereco_bairro', c.endereco_bairro,
    'endereco_cidade', c.endereco_cidade, 'endereco_estado', c.endereco_estado,
    'origem', c.origem, 'atualizado_em', c.atualizado_em, 'atualizado_por', c.atualizado_por,
    'mesclado_de', case when v <> p then p end,
    'pode_editar', cad_pode_editar(v),
    'acompanhantes', acomp);
end $function$;

-- Salva só as chaves presentes em p_campos ("" = apagar). Nome vazio é ignorado.
-- Mudou CPF/passaporte/endereço…? O trigger da ficha leva pros passageiros; rel_audita
-- guarda antes/depois com quem e quando.
create or replace function public.cad_salvar_pessoa(p uuid, p_campos jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v uuid := cad_ficha_viva(p); k text;
begin
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(coalesce(p_campos, '{}'::jsonb)) loop
    if not (k = any(array['nome', 'cpf', 'nascimento', 'passaporte', 'passaporte_validade', 'email', 'telefone'] || cad_campos_endereco())) then
      raise exception 'Campo desconhecido: %', k using errcode = '22023';
    end if;
  end loop;
  if cad_txt(p_campos->>'cpf') is not null and cad_cpf(p_campos->>'cpf') is null then raise exception 'CPF inválido — confira os números.' using errcode = '22023'; end if;
  if cad_txt(p_campos->>'passaporte') is not null and cad_pass(p_campos->>'passaporte') is null then raise exception 'Passaporte inválido (5 a 12 letras e números).' using errcode = '22023'; end if;
  if cad_txt(p_campos->>'email') is not null and cad_email(p_campos->>'email') is null then raise exception 'E-mail inválido.' using errcode = '22023'; end if;
  if cad_txt(p_campos->>'telefone') is not null and cad_tel(p_campos->>'telefone') is null then raise exception 'Telefone inválido — use DDD + número.' using errcode = '22023'; end if;
  begin
    update rel_clientes set
      nome = coalesce(case when p_campos ? 'nome' then cad_txt(p_campos->>'nome') end, nome),
      cpf = case when p_campos ? 'cpf' then cad_cpf(p_campos->>'cpf') else cpf end,
      nascimento = case when p_campos ? 'nascimento' then nullif(trim(p_campos->>'nascimento'), '')::date else nascimento end,
      passaporte = case when p_campos ? 'passaporte' then cad_pass(p_campos->>'passaporte') else passaporte end,
      passaporte_validade = case when p_campos ? 'passaporte_validade' then nullif(trim(p_campos->>'passaporte_validade'), '')::date else passaporte_validade end,
      email = case when p_campos ? 'email' then cad_email(p_campos->>'email') else email end,
      telefone = case when p_campos ? 'telefone' then cad_tel(p_campos->>'telefone') else telefone end,
      endereco_cep = case when p_campos ? 'endereco_cep' then cad_cep(p_campos->>'endereco_cep') else endereco_cep end,
      endereco_rua = case when p_campos ? 'endereco_rua' then cad_txt(p_campos->>'endereco_rua') else endereco_rua end,
      endereco_numero = case when p_campos ? 'endereco_numero' then cad_txt(p_campos->>'endereco_numero') else endereco_numero end,
      endereco_complemento = case when p_campos ? 'endereco_complemento' then cad_txt(p_campos->>'endereco_complemento') else endereco_complemento end,
      endereco_bairro = case when p_campos ? 'endereco_bairro' then cad_txt(p_campos->>'endereco_bairro') else endereco_bairro end,
      endereco_cidade = case when p_campos ? 'endereco_cidade' then cad_txt(p_campos->>'endereco_cidade') else endereco_cidade end,
      endereco_estado = case when p_campos ? 'endereco_estado' then cad_uf(p_campos->>'endereco_estado') else endereco_estado end
    where id = v;
  exception when unique_violation then
    if sqlerrm ~* 'cpf' then raise exception 'Já existe outra ficha com este CPF — pode ser a mesma pessoa repetida (avise o Relacionamento).' using errcode = '23505';
    elsif sqlerrm ~* 'passaporte' then raise exception 'Já existe outra ficha com este passaporte — pode ser a mesma pessoa repetida (avise o Relacionamento).' using errcode = '23505';
    else raise exception 'Já existe outra ficha com estes dados.' using errcode = '23505'; end if;
  end;
  return cad_ler_pessoa(v);
end $function$;

-- Acha a pessoa por CPF → telefone → e-mail; não achou e p_criar → cria.
-- p_so_criar = true ("não é a mesma pessoa"): só o CPF é procurado (é único); cria outra ficha.
-- Telefone/e-mail só valem se forem de UMA ficha só, com o mesmo primeiro nome (família
-- divide celular) e sem CPF diferente do informado. Devolve só id/nome/motivo.
create or replace function public.cad_buscar_ou_criar(p_cpf text default null, p_telefone text default null,
  p_email text default null, p_nome text default null, p_criar boolean default true, p_so_criar boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v uuid; n int; nm text; motivo text; cpf_n text := cad_cpf(p_cpf); fone_k text := rel_fone_chave(p_telefone);
        mail_n text := cad_email(p_email); pnome text := split_part(coalesce(cad_nome(p_nome), ''), ' ', 1);
begin
  if not qs_is_active_user() then raise exception 'Sem acesso.' using errcode = '42501'; end if;
  if cpf_n is not null then
    select id into v from rel_clientes where mesclado_em_id is null and cpf = cpf_n limit 1;
    if v is not null then motivo := 'mesmo CPF'; end if;
  end if;
  if v is null and not p_so_criar and fone_k is not null then
    select count(*), min(id::text)::uuid into n, v from rel_clientes c
     where c.mesclado_em_id is null and c.arquivado_em is null and rel_fone_chave(c.telefone) = fone_k
       and (cpf_n is null or c.cpf is null or c.cpf = cpf_n)
       and (pnome = '' or split_part(coalesce(cad_nome(c.nome), ''), ' ', 1) = pnome);
    if n = 1 then motivo := 'mesmo telefone'; else v := null; end if;
  end if;
  if v is null and not p_so_criar and mail_n is not null then
    select count(*), min(id::text)::uuid into n, v from rel_clientes c
     where c.mesclado_em_id is null and c.arquivado_em is null and lower(c.email) = mail_n
       and (cpf_n is null or c.cpf is null or c.cpf = cpf_n)
       and (pnome = '' or split_part(coalesce(cad_nome(c.nome), ''), ' ', 1) = pnome);
    if n = 1 then motivo := 'mesmo e-mail'; else v := null; end if;
  end if;
  if v is not null then
    select nome into nm from rel_clientes where id = v;
    return jsonb_build_object('id', v, 'nome', nm, 'criado', false, 'motivo', motivo);
  end if;
  if not p_criar then return null; end if;
  if cad_txt(p_nome) is null or length(cad_txt(p_nome)) < 2 then raise exception 'Informe o nome completo.' using errcode = '22023'; end if;
  insert into rel_clientes (nome, cpf, telefone, email, origem, observacoes)
  values (cad_txt(p_nome), cpf_n, cad_tel(p_telefone), mail_n,
          case when rel_tem_acesso() or ops_tem_acesso() then null else 'comercial' end,
          'Criada pelo cadastro do cliente (0213).')
  returning id into v;
  return jsonb_build_object('id', v, 'nome', cad_txt(p_nome), 'criado', true, 'motivo', null);
end $function$;

-- Liga (ou desliga, com p_cliente null) o lead à pessoa.
create or replace function public.cad_ligar_lead(p_lead uuid, p_cliente uuid)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not (cad_lead_visivel(p_lead) or rel_tem_acesso() or ops_tem_acesso()) then
    raise exception 'Sem acesso a este lead.' using errcode = '42501';
  end if;
  update qs_leads set cliente_id = cad_ficha_viva(p_cliente)
   where id = p_lead and cliente_id is distinct from cad_ficha_viva(p_cliente);
end $function$;

-- A pessoa do lead. Já ligada → devolve. Senão procura por telefone → e-mail (mesmas
-- regras do cad_buscar_ou_criar) e devolve como SUGESTÃO (não liga sozinho: família
-- divide celular). p_criar = true: liga a sugestão ou cria a ficha com nome/telefone/
-- e-mail do lead — garante um cliente_id (é o que a tela de "subir venda" usa).
-- Retorno: { cliente_id, sugestao: {id, nome, motivo} | null, lead: {nome, telefone, email} }
create or replace function public.cad_pessoa_do_lead(p_lead uuid, p_criar boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare l qs_leads; v uuid; nome_lead text; achado jsonb;
begin
  if not (cad_lead_visivel(p_lead) or rel_tem_acesso() or ops_tem_acesso()) then
    raise exception 'Sem acesso a este lead.' using errcode = '42501';
  end if;
  select * into l from qs_leads where id = p_lead;
  if not found then raise exception 'Lead não encontrado.' using errcode = 'P0002'; end if;
  nome_lead := coalesce(cad_txt(l.full_name), cad_txt(concat_ws(' ', l.first_name, l.last_name)));
  if l.cliente_id is not null then
    v := cad_ficha_viva(l.cliente_id);
    if v is distinct from l.cliente_id then update qs_leads set cliente_id = v where id = p_lead; end if;
    return jsonb_build_object('cliente_id', v, 'sugestao', null,
      'lead', jsonb_build_object('nome', nome_lead, 'telefone', l.phone, 'email', l.email));
  end if;
  achado := cad_buscar_ou_criar(null, l.phone, l.email, nome_lead, false);
  if p_criar then
    if achado is null then achado := cad_buscar_ou_criar(null, l.phone, l.email, coalesce(nome_lead, 'Sem nome'), true); end if;
    v := (achado->>'id')::uuid;
    update qs_leads set cliente_id = v where id = p_lead;
    return jsonb_build_object('cliente_id', v, 'sugestao', null,
      'lead', jsonb_build_object('nome', nome_lead, 'telefone', l.phone, 'email', l.email));
  end if;
  return jsonb_build_object('cliente_id', null, 'sugestao', achado,
    'lead', jsonb_build_object('nome', nome_lead, 'telefone', l.phone, 'email', l.email));
end $function$;

create or replace function public.cad_ligar_acompanhante(p_cliente uuid, p_acompanhante uuid, p_vinculo text default 'outro')
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v uuid := cad_ficha_viva(p_cliente); a uuid := cad_ficha_viva(p_acompanhante);
        vin text := coalesce(nullif(p_vinculo, ''), 'outro');
begin
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  if a is null or a = v then raise exception 'Escolha outra pessoa como acompanhante.' using errcode = '22023'; end if;
  if vin not in ('conjuge', 'filho', 'pai_mae', 'irmao', 'amigo', 'outro') then raise exception 'Vínculo desconhecido: %', vin using errcode = '22023'; end if;
  update cad_acompanhantes set vinculo = vin where cliente_id = v and acompanhante_id = a and vinculo <> vin;
  update cad_acompanhantes set vinculo = cad_vinculo_inverso(vin) where cliente_id = a and acompanhante_id = v and vinculo <> cad_vinculo_inverso(vin);
  insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo) values (v, a, vin) on conflict do nothing;
  return cad_ler_pessoa(v);
end $function$;

create or replace function public.cad_desligar_acompanhante(p_cliente uuid, p_acompanhante uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v uuid := cad_ficha_viva(p_cliente); a uuid := cad_ficha_viva(p_acompanhante);
begin
  if not cad_pode_editar(v) then raise exception 'Sem permissão pra editar este cadastro.' using errcode = '42501'; end if;
  delete from cad_acompanhantes where (cliente_id = v and acompanhante_id = a) or (cliente_id = a and acompanhante_id = v);
  return cad_ler_pessoa(v);
end $function$;

-- ── 9. Permissões das funções novas ──────────────────────────────────────────
-- Nada aberto pra anon (lição da revisão de 23/10). Internas: só o banco chama.
revoke all on function public.cad_acompanhantes_de(uuid) from public, anon, authenticated;
revoke all on function public.cad_preencher_acompanhante_pax(uuid) from public, anon, authenticated;
revoke all on function public.cad_sincronizar_acompanhante(uuid) from public, anon, authenticated;
revoke all on function public.cad_mover_acompanhantes(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cad_trg_acompanhante() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'cad_lead_visivel(uuid)', 'cad_pode_editar(uuid)', 'cad_pode_ver(uuid)', 'cad_ler_pessoa(uuid)',
    'cad_salvar_pessoa(uuid, jsonb)', 'cad_buscar_ou_criar(text, text, text, text, boolean, boolean)', 'cad_ligar_lead(uuid, uuid)',
    'cad_pessoa_do_lead(uuid, boolean)', 'cad_ligar_acompanhante(uuid, uuid, text)', 'cad_desligar_acompanhante(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── 10. Backfill ─────────────────────────────────────────────────────────────
-- 10a. Endereço da ficha = o do passageiro mais recente com endereço, só onde a ficha não
--      tem nenhum. cad.sync = on: enche a ficha sem reescrever as outras idas. (Num DO só
--      pra valer mesmo se alguém colar no SQL Editor fora de transação.)
do $$
begin
perform set_config('cad.sync', 'on', true);
update rel_clientes c
   set endereco_cep = cad_cep(x.endereco_cep), endereco_rua = cad_txt(x.endereco_rua), endereco_numero = cad_txt(x.endereco_numero),
       endereco_complemento = cad_txt(x.endereco_complemento), endereco_bairro = cad_txt(x.endereco_bairro),
       endereco_cidade = cad_txt(x.endereco_cidade), endereco_estado = cad_uf(x.endereco_estado)
  from (
    select distinct on (p.cliente_id) p.*
      from passageiros p
     where p.cliente_id is not null
       and coalesce(cad_txt(p.endereco_cep), cad_txt(p.endereco_rua), cad_txt(p.endereco_cidade)) is not null
     order by p.cliente_id, p.updated_at desc nulls last
  ) x
 where x.cliente_id = c.id
   and coalesce(c.endereco_cep, c.endereco_rua, c.endereco_numero, c.endereco_complemento, c.endereco_bairro, c.endereco_cidade, c.endereco_estado) is null;
perform set_config('cad.sync', 'off', true);
end $$;

-- 10b. Acompanhantes a partir do texto dos passageiros (só liga fichas; preenche brancos).
do $$
declare r record;
begin
  for r in select id from passageiros where cliente_id is not null and cad_nome(acompanhante_nome) is not null loop
    begin
      perform cad_sincronizar_acompanhante(r.id);
    exception when others then
      raise warning '0213 backfill acompanhante %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- ── ROLLBACK (manual, se precisar) ───────────────────────────────────────────
-- Volta as funções da 0172 rodando de novo as definições da 0172 (cad_valor_ficha,
-- cad_valor_pax, cad_gravar_campo, cad_conciliar, cad_trg_ficha, cad_trg_passageiro) e:
-- drop function if exists public.cad_desligar_acompanhante(uuid, uuid), public.cad_ligar_acompanhante(uuid, uuid, text),
--   public.cad_pessoa_do_lead(uuid, boolean), public.cad_ligar_lead(uuid, uuid),
--   public.cad_buscar_ou_criar(text, text, text, text, boolean, boolean), public.cad_salvar_pessoa(uuid, jsonb),
--   public.cad_ler_pessoa(uuid), public.cad_pode_ver(uuid), public.cad_pode_editar(uuid), public.cad_lead_visivel(uuid);
-- drop trigger if exists cad_acompanhante_ins on public.cad_acompanhantes;
-- drop trigger if exists trg_cad_acompanhantes_audita on public.cad_acompanhantes;
-- (depois de restaurar as funções da 0172:)
-- drop function if exists public.cad_trg_acompanhante(), public.cad_mover_acompanhantes(uuid, uuid),
--   public.cad_sincronizar_acompanhante(uuid), public.cad_preencher_acompanhante_pax(uuid), public.cad_acompanhantes_de(uuid),
--   public.cad_vinculo_de_texto(text), public.cad_vinculo_inverso(text), public.cad_vinculo_rotulo(text),
--   public.cad_campos_endereco(), public.cad_uf(text), public.cad_cep(text), public.cad_txt(text);
-- drop table if exists public.cad_acompanhantes;
-- drop policy if exists rel_clientes_ops_criar on public.rel_clientes;
-- drop policy if exists rel_clientes_ops_editar on public.rel_clientes;
-- drop policy if exists rel_auditoria_ops_ler on public.rel_auditoria;
-- alter table public.qs_leads drop column if exists cliente_id;
-- alter table public.rel_clientes drop column if exists origem, drop column if exists endereco_cep,
--   drop column if exists endereco_rua, drop column if exists endereco_numero, drop column if exists endereco_complemento,
--   drop column if exists endereco_bairro, drop column if exists endereco_cidade, drop column if exists endereco_estado;
