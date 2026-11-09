-- supabase/migrations/0351_familia_da_venda.sql
-- -----------------------------------------------------------------------------
-- A FAMÍLIA DA VENDA (Bruno, 09/11/2026)
--   "Quando sobe uma venda e a pessoa tem família, não tem lugar fácil de ver
--    que é uma família; não se cria outro card da família." → o cartão do QS
--    vira uma PASTA com todos que vão.
--   "O card da família tem que ficar no Bitrix também! Assim fazemos
--    double-check de todas as pessoas que vão e não esquecemos ninguém."
--   "A informação das pessoas precisa chegar no Operacional."
--
-- RODA DEPOIS da 0338/0339/0350 (aplicadas em produção em 09/11; a venda_subir
-- vigente é a da 0350 sem os comentários — conferido: cad_acompanhantes_de,
-- cad_vinculo_inverso e data_nascimento no corpo).
--
--   A) qs_venda_pessoas — QUEM VAI em cada venda, pra QUALQUER tipo de item
--      (não só expedição). Uma linha por pessoa (venda_id, cliente_id único):
--      comprador (o titular, deal PAI no Bitrix), vínculo com o comprador
--      (mesmos códigos de cad_acompanhantes), menor de idade na data da viagem
--      + responsável (pai/mãe assina pelo menor — Fase 3 do contrato), valor
--      DAQUELA pessoa, aéreo incluso, a linha de `passageiros` (expedição), o
--      deal FILHO no Bitrix (id, contato, situação) e a situação do contrato
--      dela (contrato_status/contrato_id ficam vazios até a Fase 3).
--      Os dados da pessoa (nome, CPF, nascimento, telefone, e-mail) moram na
--      ficha única (rel_clientes) — aqui não se copia nada.
--      Pessoa que SAI da venda não é apagada: ganha removida_em (e, se já tinha
--      card filho no Bitrix, bitrix_status = 'removida' — o espelho avisa no
--      Bitrix e NÃO apaga o card).
--      RLS: lê quem lê a venda (a policy de qs_vendas vale pela subconsulta).
--      Escrita só pelas funções (security definer) e pelo service_role (api).
--
--   B) venda_subir(p) — a VERSÃO DO ARQUIVO 0350 (todas as mudanças B1..B4
--      mantidas) + 0351:
--      C1) antes de resolver as pessoas, quem já está na venda é reconhecido
--          pela chave/nome (_venda_viajantes_com_ficha) — reabrir a venda de um
--          viajante só com nome não cria ficha duplicada;
--      C2) `viajantes` passa a valer pra item que NÃO é expedição também (o
--          front manda com `item` = índice do item). A expedição continua
--          olhando só os dela (o laço da expedição filtra pelo índice);
--      C3) no fim, _venda_pessoas_sincronizar grava qs_venda_pessoas a partir
--          dos viajantes (+ o comprador, sempre). Mudou alguém da família →
--          o cartão do closer fica bitrix_status = 'pendente' (o espelho/cron
--          cria/atualiza os cards filhos). Falha aqui NÃO derruba a venda:
--          vira aviso no retorno (familia_erro).
--
--   C) venda_familia(negocios[]) — a pasta pro quadro e pro cartão do closer
--      (o closer não lê rel_clientes de quem viaja junto): pessoas com ficha,
--      idade, faltas, valor, Bitrix e contrato.
--
--   D) ops_vendas_para_revisar — + `pessoas` por venda (todas, com dados,
--      valor, menor/responsável, faltas, Bitrix) e, por pessoa e item de
--      expedição, onde ela está: na expedição (passageiros), NA FILA do espelho
--      do sistema antigo (exp_venda_pax_pendentes — ops_config.exp_espelho
--      ligado) ou FALTANDO. + `espelho_ligado`. O resto do retorno é igual à 0338.
--
-- Não chama Bitrix (quem fala com o Bitrix é o api/closer.js).
--
-- Volta:
--   1) venda_subir: rodar de novo o bloco "create or replace function
--      venda_subir(p jsonb)" da 0350;
--   2) ops_vendas_para_revisar: rodar de novo o bloco 5 da 0338;
--   3) drop function if exists venda_familia(uuid[]), _venda_pessoas_sincronizar(uuid, uuid, jsonb, jsonb, jsonb, date),
--        _venda_viajantes_com_ficha(uuid, jsonb);
--      drop table if exists qs_venda_pessoas;   -- (perde os ids dos cards filhos no Bitrix: anote antes)
-- -----------------------------------------------------------------------------

-- ═════════════════════════════════════════════════════════════════════════════
-- A) qs_venda_pessoas
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists qs_venda_pessoas (
  id                     uuid primary key default gen_random_uuid(),
  venda_id               uuid not null references qs_vendas(id) on delete cascade,
  cliente_id             uuid not null references rel_clientes(id),
  comprador              boolean not null default false,
  -- chave do viajante na tela (src/venda/vendaRegras.ts) — reconhece a pessoa ao reabrir.
  chave                  text,
  vinculo                text check (vinculo is null or vinculo in ('conjuge','filho','pai_mae','irmao','amigo','outro')),
  -- Menor de idade na data da viagem (1ª data dos itens; sem data, o dia da venda). null = sem nascimento.
  menor                  boolean,
  -- Quem assina pelo menor (padrão: o comprador).
  responsavel_cliente_id uuid references rel_clientes(id) on delete set null,
  -- O valor DESTA pessoa (soma do que ela tem nos itens). null = não separado (fica no titular).
  valor                  numeric(12,2) check (valor is null or valor >= 0),
  aereo_incluso          boolean,
  -- Em quais itens (qs_venda_itens.ordem) a pessoa está. Vazio = em todos.
  itens                  int[] not null default '{}',
  passageiro_id          uuid references passageiros(id) on delete set null,
  -- Bitrix: o card FILHO da pessoa (o comprador é o card PAI, o do lead — não fica aqui).
  bitrix_deal_id         text,
  bitrix_contato_id      text,
  bitrix_status          text not null default 'nao_se_aplica'
                         check (bitrix_status in ('nao_se_aplica','pendente','ok','erro','removida','removida_avisada')),
  bitrix_erro            text,
  bitrix_em              timestamptz,
  -- Fase 3 (contrato por pessoa): fica vazio até lá.
  contrato_status        text check (contrato_status is null or contrato_status in ('pendente','gerando','enviado','visualizado','assinado','cancelado','erro')),
  contrato_id            uuid references qs_contratos(id) on delete set null,
  removida_em            timestamptz,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  unique (venda_id, cliente_id)
);
comment on table qs_venda_pessoas is
  'Quem vai em cada venda (0351): titular (comprador) + família/acompanhantes, com valor de cada um, vínculo, menor/responsável, card filho no Bitrix (UF_CRM_1790891281841 = deal pai) e situação do contrato por pessoa. Dados pessoais na ficha (rel_clientes). Escrita: venda_subir e api/closer.js (service_role).';

create index if not exists qs_venda_pessoas_cliente on qs_venda_pessoas (cliente_id);
create index if not exists qs_venda_pessoas_bitrix on qs_venda_pessoas (bitrix_status) where bitrix_status in ('pendente','erro','removida');

alter table qs_venda_pessoas enable row level security;
drop policy if exists qs_venda_pessoas_ler on qs_venda_pessoas;
-- Mesma visão de qs_vendas: a subconsulta roda com a RLS de qs_vendas (qs_vendas_ler).
create policy qs_venda_pessoas_ler on qs_venda_pessoas for select to authenticated
  using (exists (select 1 from qs_vendas v where v.id = venda_id));
revoke all on qs_venda_pessoas from anon;
grant select on qs_venda_pessoas to authenticated;
grant all on qs_venda_pessoas to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) Ajudantes da venda_subir
-- ═════════════════════════════════════════════════════════════════════════════

-- C1: viajante sem ficha (só nome) que JÁ está nesta venda → mesma ficha.
create or replace function _venda_viajantes_com_ficha(p_venda uuid, p_viaj jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  vj  jsonb;
  out jsonb := '[]'::jsonb;
  v_c uuid;
begin
  if p_venda is null or jsonb_typeof(p_viaj) <> 'array' then return p_viaj; end if;
  for vj in select * from jsonb_array_elements(p_viaj) loop
    if not coalesce((vj ->> 'comprador')::boolean, false) and nullif(vj ->> 'cliente_id', '') is null then
      select vp.cliente_id into v_c from qs_venda_pessoas vp
        join rel_clientes c on c.id = vp.cliente_id
       where vp.venda_id = p_venda and not vp.comprador
         and ((nullif(vj ->> 'chave', '') is not null and vp.chave = vj ->> 'chave')
              or lower(regexp_replace(trim(c.nome), '\s+', ' ', 'g')) = lower(regexp_replace(trim(coalesce(vj ->> 'nome', '')), '\s+', ' ', 'g')))
       order by (vp.chave = vj ->> 'chave') desc nulls last, vp.removida_em nulls first
       limit 1;
      if v_c is not null then vj := vj || jsonb_build_object('cliente_id', v_c); end if;
      v_c := null;
    end if;
    out := out || jsonb_build_array(vj);
  end loop;
  return out;
end $$;
revoke all on function _venda_viajantes_com_ficha(uuid, jsonb) from public, anon, authenticated;

-- C3: grava quem vai. Devolve quantas linhas mudaram (inclusive quem saiu).
--   p_chaves: chave do viajante → cliente_id já resolvido (laço da expedição)
--   p_mapa:   chave do viajante → passageiros.id (laço da expedição)
--   p_ref:    data da viagem (menor de idade é contado nela)
create or replace function _venda_pessoas_sincronizar(p_venda uuid, p_cli uuid, p_viaj jsonb, p_chaves jsonb, p_mapa jsonb, p_ref date)
returns int language plpgsql security definer set search_path = public as $$
declare
  vj      jsonb;
  rec     record;
  r       jsonb;
  k       text;
  v_acc   jsonb := '{}'::jsonb;
  v_pcli  uuid;
  v_vin   text;
  v_nasc  date;
  v_menor boolean;
  v_resp  uuid;
  v_val   numeric;
  v_ant   qs_venda_pessoas;
  v_mud   int := 0;
  v_n     int;
  v_comp  boolean;
begin
  if p_venda is null or p_cli is null then return 0; end if;
  if jsonb_typeof(p_viaj) <> 'array' then p_viaj := '[]'::jsonb; end if;
  p_chaves := coalesce(p_chaves, '{}'::jsonb);
  p_mapa := coalesce(p_mapa, '{}'::jsonb);

  -- 1) Junta por pessoa (a mesma pessoa pode estar em mais de um item).
  for vj in select * from jsonb_array_elements(p_viaj) loop
    if coalesce((vj ->> 'comprador')::boolean, false) then
      v_pcli := p_cli;
    elsif nullif(vj ->> 'chave', '') is not null and p_chaves ? (vj ->> 'chave') then
      v_pcli := (p_chaves ->> (vj ->> 'chave'))::uuid;
    else
      -- Item que não é expedição: resolve aqui (mesma regra do laço da expedição, 0350 B1/B2).
      continue when nullif(trim(coalesce(vj ->> 'nome', '')), '') is null and nullif(vj ->> 'cliente_id', '') is null;
      v_pcli := venda_cliente_resolver(jsonb_build_object('id', vj ->> 'cliente_id', 'nome', vj ->> 'nome',
                  'telefone', vj ->> 'telefone', 'email', vj ->> 'email', 'cpf', vj ->> 'cpf',
                  'nascimento', vj ->> 'nascimento'));
      v_vin := nullif(trim(coalesce(vj ->> 'vinculo', '')), '');
      if v_vin in ('conjuge','filho','pai_mae','irmao','amigo','outro') and v_pcli is not null and v_pcli <> p_cli then
        update cad_acompanhantes set vinculo = v_vin
         where cliente_id = p_cli and acompanhante_id = v_pcli and vinculo <> v_vin;
        update cad_acompanhantes set vinculo = cad_vinculo_inverso(v_vin)
         where cliente_id = v_pcli and acompanhante_id = p_cli and vinculo <> cad_vinculo_inverso(v_vin);
        insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo)
        values (p_cli, v_pcli, v_vin)
        on conflict do nothing;
      end if;
    end if;
    continue when v_pcli is null;
    if nullif(vj ->> 'chave', '') is not null then
      p_chaves := p_chaves || jsonb_build_object(vj ->> 'chave', v_pcli);
    end if;
    k := v_pcli::text;
    r := coalesce(v_acc -> k, jsonb_build_object('cliente_id', v_pcli, 'comprador', v_pcli = p_cli, 'itens', '[]'::jsonb));
    if r ->> 'chave' is null and nullif(vj ->> 'chave', '') is not null then r := r || jsonb_build_object('chave', vj ->> 'chave'); end if;
    if v_pcli <> p_cli and nullif(trim(coalesce(vj ->> 'vinculo', '')), '') in ('conjuge','filho','pai_mae','irmao','amigo','outro') then
      r := r || jsonb_build_object('vinculo', trim(vj ->> 'vinculo'));
    end if;
    if jsonb_typeof(vj -> 'aereo_incluso') = 'boolean' then r := r || jsonb_build_object('aereo_incluso', vj -> 'aereo_incluso'); end if;
    if nullif(vj ->> 'chave', '') is not null and nullif(p_mapa ->> (vj ->> 'chave'), '') is not null then
      r := r || jsonb_build_object('passageiro_id', p_mapa ->> (vj ->> 'chave'));
    end if;
    if nullif(vj ->> 'responsavel_chave', '') is not null then r := r || jsonb_build_object('responsavel_chave', vj ->> 'responsavel_chave'); end if;
    if nullif(vj ->> 'valor_contratado', '') is not null then
      r := r || jsonb_build_object('valor', coalesce(nullif(r ->> 'valor', '')::numeric, 0) + (vj ->> 'valor_contratado')::numeric);
    end if;
    if nullif(vj ->> 'item', '') is not null then
      r := jsonb_set(r, '{itens}', (r -> 'itens') || to_jsonb((vj ->> 'item')::int));
    end if;
    v_acc := v_acc || jsonb_build_object(k, r);
  end loop;

  -- O comprador sempre está na pasta (é o titular / card pai).
  if not v_acc ? p_cli::text then
    v_acc := v_acc || jsonb_build_object(p_cli::text, jsonb_build_object('cliente_id', p_cli, 'comprador', true, 'itens', '[]'::jsonb));
  end if;

  -- 2) Grava cada pessoa.
  for rec in select key, value from jsonb_each(v_acc) loop
    v_pcli := rec.key::uuid;
    r := rec.value;
    v_comp := v_pcli = p_cli;
    select nascimento into v_nasc from rel_clientes where id = v_pcli;
    v_menor := case when v_nasc is null then null else v_nasc > (p_ref - interval '18 years')::date end;
    v_resp := null;
    if v_menor and not v_comp then
      v_resp := coalesce(nullif(p_chaves ->> coalesce(r ->> 'responsavel_chave', ''), '')::uuid, p_cli);
      if v_resp = v_pcli then v_resp := p_cli; end if;
    end if;
    v_val := nullif(r ->> 'valor', '')::numeric;
    select * into v_ant from qs_venda_pessoas where venda_id = p_venda and cliente_id = v_pcli;
    if not found then
      insert into qs_venda_pessoas (venda_id, cliente_id, comprador, chave, vinculo, menor, responsavel_cliente_id, valor,
                                    aereo_incluso, itens, passageiro_id, bitrix_status)
      values (p_venda, v_pcli, v_comp, r ->> 'chave', case when v_comp then null else r ->> 'vinculo' end, v_menor, v_resp, v_val,
              (r ->> 'aereo_incluso')::boolean,
              coalesce((select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(r -> 'itens') x), '{}'),
              nullif(r ->> 'passageiro_id', '')::uuid,
              case when v_comp then 'nao_se_aplica' else 'pendente' end);
      v_mud := v_mud + 1;
    else
      if v_ant.comprador is distinct from v_comp or v_ant.valor is distinct from v_val
         or v_ant.vinculo is distinct from (case when v_comp then null else r ->> 'vinculo' end)
         or v_ant.removida_em is not null or v_ant.menor is distinct from v_menor then
        v_mud := v_mud + 1;
        update qs_venda_pessoas set bitrix_status = case
                 when v_comp then 'nao_se_aplica'
                 else 'pendente' end
         where id = v_ant.id;
      end if;
      update qs_venda_pessoas set
        comprador = v_comp,
        chave = coalesce(r ->> 'chave', chave),
        vinculo = case when v_comp then null else coalesce(r ->> 'vinculo', vinculo) end,
        menor = v_menor,
        responsavel_cliente_id = v_resp,
        valor = v_val,
        aereo_incluso = coalesce((r ->> 'aereo_incluso')::boolean, aereo_incluso),
        itens = coalesce((select array_agg(distinct x::int order by x::int) from jsonb_array_elements_text(r -> 'itens') x), '{}'),
        passageiro_id = coalesce(nullif(r ->> 'passageiro_id', '')::uuid, passageiro_id),
        removida_em = null,
        atualizado_em = now()
       where id = v_ant.id;
    end if;
  end loop;

  -- 3) Quem saiu da venda: NÃO apaga (o card filho no Bitrix fica; o espelho avisa).
  update qs_venda_pessoas set
    removida_em = now(),
    bitrix_status = case when bitrix_deal_id is not null then 'removida' else 'nao_se_aplica' end,
    atualizado_em = now()
   where venda_id = p_venda and removida_em is null and not (v_acc ? cliente_id::text);
  get diagnostics v_n = row_count;
  return v_mud + v_n;
end $$;
revoke all on function _venda_pessoas_sincronizar(uuid, uuid, jsonb, jsonb, jsonb, date) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- B) venda_subir — ARQUIVO 0350 (B1..B4) + 0351 C1..C3 (marcados no corpo)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function venda_subir(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_origem  text := coalesce(nullif(p ->> 'origem', ''), 'rel');
  v_neg     uuid := nullif(p ->> 'negocio_id', '')::uuid;
  v_viagem  uuid := nullif(p ->> 'viagem_id', '')::uuid;
  n         qs_closer_negocios;
  v_cli     uuid;
  v_venda   uuid;
  v_itens   jsonb := coalesce(p -> 'itens', '[]'::jsonb);
  v_viaj    jsonb := coalesce(p -> 'viajantes', '[]'::jsonb);
  v_pag     jsonb := case when jsonb_typeof(p -> 'pagamento') = 'object' then p -> 'pagamento' else '{}'::jsonb end;
  v_cesp    boolean := coalesce((p ->> 'condicao_especial')::boolean, false);
  v_cobs    text := nullif(trim(coalesce(p ->> 'condicao_obs', '')), '');
  v_total   numeric;
  it        jsonb;
  vj        jsonb;
  i         int := 0;
  v_item_id uuid;
  v_exp     uuid;
  e         expedicoes;
  v_vagas   int;
  v_novos   int;
  v_pcli    uuid;
  v_pax     uuid;
  v_mapa    jsonb := '{}'::jsonb;
  v_npax    int := 0;
  v_par     uuid;
  v_outro   passageiros;
  v_nomes   jsonb;
  v_vin     text;   -- 0350 B2
  v_chaves  jsonb := '{}'::jsonb;   -- 0351: chave do viajante → ficha (todas as expedições)
  v_ref     date;                   -- 0351: data da viagem (menor de idade)
  v_famerr  text;                   -- 0351: a pasta da família falhou (a venda segue)
  v_mud     int := 0;
begin
  if v_origem not in ('closer','rel','ops') then raise exception 'origem-invalida'; end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then raise exception 'itens-invalidos'; end if;
  if jsonb_typeof(v_viaj) <> 'array' then v_viaj := '[]'::jsonb; end if;

  if v_neg is not null then
    select * into n from qs_closer_negocios where id = v_neg for update;
    if not found then raise exception 'negocio-nao-encontrado'; end if;
    if not closer_pode_mexer(n.closer_id) then raise exception 'sem-permissao'; end if;
  elsif v_origem = 'closer' then
    raise exception 'negocio-obrigatorio';
  elsif not (rel_tem_acesso() or ops_tem_acesso() or qs_is_manager()) then
    raise exception 'sem-permissao';
  end if;

  select coalesce(sum(nullif(x ->> 'valor', '')::numeric), 0) into v_total from jsonb_array_elements(v_itens) x;
  if v_total <= 0 then raise exception 'valor-total-obrigatorio'; end if;

  if v_viagem is not null and nullif(p #>> '{cliente,id}', '') is null and nullif(p #>> '{cliente,nome}', '') is null then
    select cliente_id into v_cli from rel_viagens where id = v_viagem;
  end if;
  if v_cli is null then
    if jsonb_typeof(p -> 'cliente') <> 'object' then raise exception 'pessoa-sem-nome'; end if;
    v_cli := venda_cliente_resolver(p -> 'cliente');
  end if;
  if v_viagem is null and v_neg is not null then v_viagem := n.viagem_id; end if;

  if v_neg is not null then select id into v_venda from qs_vendas where negocio_id = v_neg; end if;
  if v_venda is null then
    insert into qs_vendas (origem, negocio_id, viagem_id, cliente_id, valor_total, pagamento, condicao_especial, condicao_obs, observacoes)
    values (v_origem, v_neg, v_viagem, v_cli, v_total, v_pag, v_cesp, v_cobs, nullif(trim(coalesce(p ->> 'observacoes', '')), ''))
    returning id into v_venda;
  else
    update qs_vendas set cliente_id = v_cli, viagem_id = coalesce(v_viagem, viagem_id), valor_total = v_total,
           pagamento = v_pag, condicao_especial = v_cesp, condicao_obs = v_cobs,
           observacoes = nullif(trim(coalesce(p ->> 'observacoes', '')), ''), atualizado_em = now()
     where id = v_venda;
  end if;

  -- 0351 C1: quem já está nesta venda (só com nome) é reconhecido — não duplica ficha ao reabrir.
  v_viaj := _venda_viajantes_com_ficha(v_venda, v_viaj);

  if v_neg is not null then
    perform closer_venda_itens_salvar(v_neg, v_itens);
    perform set_config('qs.venda_itens_rpc', 'on', true);
    update qs_venda_itens set venda_id = v_venda, cliente_id = coalesce(cliente_id, v_cli)
     where negocio_id = v_neg;
  else
    perform set_config('qs.venda_itens_rpc', 'on', true);
    for it in select * from jsonb_array_elements(v_itens) loop
      i := i + 1;
      if nullif(trim(it ->> 'nome'), '') is null then raise exception 'item-sem-nome'; end if;
      if nullif(it ->> 'data_inicio', '') is not null and nullif(it ->> 'data_fim', '') is not null
         and (it ->> 'data_fim')::date < (it ->> 'data_inicio')::date then raise exception 'volta-antes-da-ida'; end if;
      if coalesce(nullif(it ->> 'valor', '')::numeric, 0) < 0 then raise exception 'valor-invalido'; end if;
      insert into qs_venda_itens (negocio_id, viagem_id, cliente_id, venda_id, tipo, nome, data_inicio, data_fim, dados,
                                  passageiros, valor, custo, fornecedor, ordem, criado_por)
      values (null, v_viagem, v_cli, v_venda, it ->> 'tipo', left(trim(it ->> 'nome'), 300),
              nullif(it ->> 'data_inicio', '')::date, nullif(it ->> 'data_fim', '')::date,
              case when jsonb_typeof(it -> 'dados') = 'object' then it -> 'dados' else '{}'::jsonb end,
              case when jsonb_typeof(it -> 'passageiros') = 'array' then it -> 'passageiros' else '[]'::jsonb end,
              nullif(it ->> 'valor', '')::numeric, nullif(it ->> 'custo', '')::numeric,
              nullif(trim(coalesce(it ->> 'fornecedor', '')), ''), i, auth.uid());
    end loop;
  end if;

  i := 0;
  for it in select * from jsonb_array_elements(v_itens) loop
    i := i + 1;
    continue when it ->> 'tipo' <> 'expedicao';
    v_exp := nullif(it #>> '{dados,expedicao_id}', '')::uuid;
    if v_exp is null then raise exception 'expedicao-obrigatoria'; end if;
    select * into e from expedicoes where id = v_exp for update;
    if not found then raise exception 'expedicao-nao-encontrada'; end if;
    if v_neg is not null then
      select id into v_item_id from qs_venda_itens where negocio_id = v_neg and ordem = i;
    else
      select id into v_item_id from qs_venda_itens where venda_id = v_venda and ordem = i;
    end if;

    if not exists (select 1 from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i) then
      v_viaj := v_viaj || jsonb_build_array(jsonb_build_object('chave', 'comprador-' || i, 'item', i, 'comprador', true,
                  'valor_contratado', it ->> 'valor', 'valor_pago', 0));
    end if;

    v_novos := 0;
    v_nomes := '{}'::jsonb;
    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      if nullif(vj ->> 'chave', '') is null then raise exception 'viajante-sem-chave'; end if;
      if coalesce((vj ->> 'comprador')::boolean, false) then v_pcli := v_cli;
      else
        -- 0350 B1: + nascimento (o resolver só completa o que a ficha não tem)
        v_pcli := venda_cliente_resolver(jsonb_build_object('id', vj ->> 'cliente_id', 'nome', vj ->> 'nome',
                    'telefone', vj ->> 'telefone', 'email', vj ->> 'email', 'cpf', vj ->> 'cpf',
                    'nascimento', vj ->> 'nascimento'));
        -- 0350 B2: vínculo com o comprador → cad_acompanhantes (o mesmo da ficha)
        v_vin := nullif(trim(coalesce(vj ->> 'vinculo', '')), '');
        if v_vin in ('conjuge','filho','pai_mae','irmao','amigo','outro') and v_pcli is not null and v_pcli <> v_cli then
          update cad_acompanhantes set vinculo = v_vin
           where cliente_id = v_cli and acompanhante_id = v_pcli and vinculo <> v_vin;
          update cad_acompanhantes set vinculo = cad_vinculo_inverso(v_vin)
           where cliente_id = v_pcli and acompanhante_id = v_cli and vinculo <> cad_vinculo_inverso(v_vin);
          insert into cad_acompanhantes (cliente_id, acompanhante_id, vinculo)
          values (v_cli, v_pcli, v_vin)
          on conflict do nothing;   -- cad_acompanhantes_par_uq: o par (em qualquer sentido) já existe
        end if;
      end if;
      v_nomes := v_nomes || jsonb_build_object(vj ->> 'chave', v_pcli);
      v_chaves := v_chaves || jsonb_build_object(vj ->> 'chave', v_pcli);   -- 0351
      if not exists (select 1 from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado') then
        v_novos := v_novos + 1;
      end if;
    end loop;
    v_vagas := greatest(coalesce(e.pax_planejados, 0) - exp_ocupados(v_exp), 0);
    if v_novos > v_vagas then
      raise exception 'sem-vaga:%:%', e.codigo, v_vagas;
    end if;

    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pcli := (v_nomes ->> (vj ->> 'chave'))::uuid;
      select id into v_pax from passageiros where expedicao_id = v_exp and cliente_id = v_pcli and status_reserva <> 'Cancelado'
       order by created_at limit 1;
      if v_pax is null then
        insert into passageiros (expedicao_id, cliente_id, nome_completo, tipo, status_reserva, telefone, email, cpf,
                                 data_nascimento,   -- 0350 B3
                                 valor_contratado_brl, valor_pago_brl, inscricao_origem, venda_id, venda_item_id,
                                 aereo_incluso, quarto_desejado, acompanhante_dividir_com, condicao_pagamento,
                                 condicao_obs, pagamento, observacoes)
        select v_exp, c.id, c.nome, 'Pagante'::tipo_passageiro, 'Pré-reserva'::status_reserva, c.telefone, c.email, c.cpf,
               c.nascimento,
               nullif(vj ->> 'valor_contratado', '')::numeric, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0),
               'QS — venda (' || v_origem || ')', v_venda, v_item_id,
               (vj ->> 'aereo_incluso')::boolean, nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''),
               nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''),
               case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
               case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, v_pag,
               nullif(trim(coalesce(p ->> 'observacoes', '')), '')
          from rel_clientes c where c.id = v_pcli
        returning id into v_pax;
      else
        update passageiros set
          valor_contratado_brl = coalesce(nullif(vj ->> 'valor_contratado', '')::numeric, valor_contratado_brl),
          valor_pago_brl = greatest(valor_pago_brl, coalesce(nullif(vj ->> 'valor_pago', '')::numeric, 0)),
          venda_id = v_venda, venda_item_id = v_item_id,
          aereo_incluso = coalesce((vj ->> 'aereo_incluso')::boolean, aereo_incluso),
          quarto_desejado = coalesce(nullif(trim(coalesce(vj ->> 'quarto_desejado', '')), ''), quarto_desejado),
          acompanhante_dividir_com = coalesce(nullif(trim(coalesce(vj ->> 'divide_com_nome', '')), ''), acompanhante_dividir_com),
          -- 0350 B3: completa o nascimento pela ficha (nunca sobrescreve)
          data_nascimento = coalesce(data_nascimento, (select c.nascimento from rel_clientes c where c.id = v_pcli)),
          condicao_pagamento = case when v_cesp then 'especial' when (vj ->> 'aereo_incluso')::boolean is false then 'sem_aereo' else 'padrao' end,
          condicao_obs = case when v_cesp then coalesce(nullif(btrim(coalesce(v_cobs, '')), ''), 'Condição especial — ver a venda') end, pagamento = v_pag
         where id = v_pax;
      end if;
      v_mapa := v_mapa || jsonb_build_object(vj ->> 'chave', v_pax);
      v_npax := v_npax + 1;
    end loop;

    for vj in select * from jsonb_array_elements(v_viaj) x where coalesce(nullif(x ->> 'item', '')::int, i) = i loop
      v_pax := (v_mapa ->> (vj ->> 'chave'))::uuid;
      continue when v_pax is null;
      if nullif(vj ->> 'divide_com_chave', '') is not null and v_mapa ? (vj ->> 'divide_com_chave') then
        select coalesce(a.quarto_par_id, b.quarto_par_id, gen_random_uuid()) into v_par
          from passageiros a, passageiros b where a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid;
        update passageiros set quarto_par_id = v_par
         where id in (v_pax, (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
        update passageiros a set acompanhante_dividir_com = b.nome_completo
          from passageiros b
         where (a.id = v_pax and b.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid)
            or (b.id = v_pax and a.id = (v_mapa ->> (vj ->> 'divide_com_chave'))::uuid);
      elsif nullif(vj ->> 'divide_com_passageiro_id', '') is not null then
        select * into v_outro from passageiros
         where id = (vj ->> 'divide_com_passageiro_id')::uuid and expedicao_id = v_exp and status_reserva <> 'Cancelado';
        if not found then raise exception 'par-de-quarto-invalido'; end if;
        v_par := coalesce(v_outro.quarto_par_id, gen_random_uuid());
        update passageiros set quarto_par_id = v_par where id in (v_pax, v_outro.id);
        update passageiros set acompanhante_dividir_com = v_outro.nome_completo where id = v_pax;
        update passageiros set acompanhante_dividir_com = (select nome_completo from passageiros where id = v_pax) where id = v_outro.id;
        if v_outro.venda_id is not null and v_outro.venda_id <> v_venda then
          update qs_vendas set ligada_venda_id = v_outro.venda_id where id = v_venda and ligada_venda_id is null;
          update qs_vendas set ligada_venda_id = v_venda where id = v_outro.venda_id and ligada_venda_id is null;
        end if;
      end if;
    end loop;

    -- 0350 B4: o item guarda quem viaja COM os detalhes (o front restaura daqui;
    -- o closer não lê `passageiros`). Sem linhas (espelho desviou o insert),
    -- mantém o json que o front mandou em vez de zerar.
    if exists (select 1 from passageiros px where px.venda_item_id = v_item_id and px.status_reserva <> 'Cancelado') then
      update qs_venda_itens set passageiros = (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'cliente_id', px.cliente_id, 'nome', px.nome_completo, 'passageiro_id', px.id,
                 'comprador', coalesce(px.cliente_id = v_cli, false),
                 'telefone', px.telefone, 'cpf', px.cpf, 'email', px.email, 'nascimento', px.data_nascimento,
                 'valor_contratado', px.valor_contratado_brl, 'valor_pago', px.valor_pago_brl,
                 'aereo_incluso', px.aereo_incluso, 'quarto_desejado', px.quarto_desejado,
                 'quarto_par_id', px.quarto_par_id, 'divide_nome', px.acompanhante_dividir_com,
                 'vinculo', (select a.vinculo from cad_acompanhantes_de(v_cli) a where a.acompanhante_id = px.cliente_id limit 1))
               order by coalesce(px.cliente_id = v_cli, false) desc, px.created_at), '[]'::jsonb)
          from passageiros px where px.venda_item_id = v_item_id and px.status_reserva <> 'Cancelado')
       where id = v_item_id;
    end if;
  end loop;

  -- 0351 C3: a PASTA da família (qs_venda_pessoas) — todos os itens, não só expedição.
  -- Falhou? A venda segue gravada; o aviso volta pra tela (familia_erro).
  select min(nullif(x ->> 'data_inicio', '')::date) into v_ref from jsonb_array_elements(v_itens) x;
  v_ref := coalesce(v_ref, (now() at time zone 'America/Sao_Paulo')::date);
  begin
    v_mud := _venda_pessoas_sincronizar(v_venda, v_cli, v_viaj, v_chaves, v_mapa, v_ref);
    -- Mudou alguém da família → o espelho do cartão leva os cards filhos (e o valor do pai) pro Bitrix.
    if v_mud > 0 and v_neg is not null then
      update qs_closer_negocios set bitrix_status = 'pendente', bitrix_erro = null
       where id = v_neg and arquivado_em is null
         and exists (select 1 from qs_leads l where l.id = lead_id and nullif(trim(l.bitrix_id), '') is not null)
         and exists (select 1 from qs_venda_pessoas vp where vp.venda_id = v_venda and not vp.comprador);
    end if;
  exception when others then
    v_famerr := sqlerrm;
    raise warning '0351 família da venda %: %', v_venda, sqlerrm;
  end;

  perform set_config('qs.venda_itens_rpc', 'off', true);
  return jsonb_build_object('ok', true, 'venda_id', v_venda, 'cliente_id', v_cli,
                            'itens', jsonb_array_length(v_itens), 'passageiros', v_npax, 'total', v_total,
                            'pessoas', (select count(*) from qs_venda_pessoas where venda_id = v_venda and removida_em is null),
                            'familia_erro', v_famerr);
end;
$$;
revoke all on function venda_subir(jsonb) from public, anon;
grant execute on function venda_subir(jsonb) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- C) venda_familia(negocios[]) — a PASTA no quadro e no cartão do closer
-- ═════════════════════════════════════════════════════════════════════════════
-- Uma linha por cartão que tem venda: { negocio_id, venda_id, valor_total, data_ref,
-- pessoas: [...] } (todas, inclusive quem saiu — removida_em diz). Só os cartões
-- que quem chama pode mexer (closer dono / gestão) ou, pra quem lê vendas
-- (Rel/Ops/Fin — mesma visão da policy de qs_vendas), todos.
create or replace function venda_familia(p_negocios uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_amplo boolean;
begin
  if auth.uid() is null then raise exception 'sem-permissao'; end if;
  if p_negocios is null or cardinality(p_negocios) = 0 then return '[]'::jsonb; end if;
  if cardinality(p_negocios) > 500 then raise exception 'lista-grande-demais'; end if;
  v_amplo := qs_is_manager() or rel_tem_acesso() or ops_tem_acesso() or fin_tem_acesso();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'negocio_id', v.negocio_id, 'venda_id', v.id, 'valor_total', v.valor_total, 'data_ref', ref.d,
             'pessoas', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', vp.id, 'cliente_id', vp.cliente_id, 'comprador', vp.comprador, 'vinculo', vp.vinculo,
                        'nome', c.nome, 'cpf', c.cpf, 'nascimento', c.nascimento, 'telefone', c.telefone, 'email', c.email,
                        'idade', case when c.nascimento is null then null else extract(year from age(ref.d, c.nascimento))::int end,
                        'menor', vp.menor, 'responsavel_cliente_id', vp.responsavel_cliente_id, 'responsavel_nome', cr.nome,
                        'valor', vp.valor, 'aereo_incluso', vp.aereo_incluso, 'itens', to_jsonb(vp.itens),
                        'passageiro_id', vp.passageiro_id,
                        'bitrix_deal_id', vp.bitrix_deal_id, 'bitrix_status', vp.bitrix_status, 'bitrix_erro', vp.bitrix_erro,
                        'bitrix_em', vp.bitrix_em, 'contrato_status', vp.contrato_status, 'contrato_id', vp.contrato_id,
                        'removida_em', vp.removida_em)
                      order by vp.comprador desc, vp.removida_em nulls first, vp.criado_em)
                 from qs_venda_pessoas vp
                 join rel_clientes c on c.id = vp.cliente_id
                 left join rel_clientes cr on cr.id = vp.responsavel_cliente_id
                where vp.venda_id = v.id), '[]'::jsonb))
           order by v.criado_em)
      from qs_vendas v
      join qs_closer_negocios n on n.id = v.negocio_id
      cross join lateral (
        select coalesce((select min(i.data_inicio) from qs_venda_itens i where i.venda_id = v.id and i.status <> 'cancelado'),
                        (v.criado_em at time zone 'America/Sao_Paulo')::date) as d) ref
     where v.negocio_id = any(p_negocios)
       and (v_amplo or closer_pode_mexer(n.closer_id))), '[]'::jsonb);
end $$;
revoke all on function venda_familia(uuid[]) from public, anon;
grant execute on function venda_familia(uuid[]) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- D) ops_vendas_para_revisar — a da 0338 + pessoas da venda + onde cada uma está
-- ═════════════════════════════════════════════════════════════════════════════
-- `itens` e o resto do retorno: idênticos à 0338. Novos: `espelho_ligado` e
-- `pessoas` (cada uma com `falta` e, por item de expedição, `situacao`:
-- na_expedicao | na_fila (espelho do sistema antigo segurou o insert/update) | falta).
create or replace function ops_vendas_para_revisar(p_todas boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_espelho boolean;
begin
  if not (ops_tem_acesso() or qs_is_manager()) then raise exception 'sem-permissao'; end if;
  v_espelho := coalesce((select (valor ->> 'ligado')::boolean from ops_config where chave = 'exp_espelho'), false);
  return coalesce((
    select jsonb_agg(x.j order by x.criado_em desc)
      from (
        select v.criado_em, jsonb_build_object(
          'id', v.id, 'origem', v.origem, 'criado_em', v.criado_em, 'atualizado_em', v.atualizado_em,
          'negocio_id', v.negocio_id, 'valor_total', v.valor_total, 'pagamento', v.pagamento,
          'condicao_especial', v.condicao_especial, 'condicao_obs', v.condicao_obs, 'observacoes', v.observacoes,
          'revisado_em', v.revisado_em, 'revisao_obs', v.revisao_obs, 'revisado_por_nome', ur.name,
          'closer_nome', uc.name, 'etapa', n.etapa, 'consolidada_em', n.consolidada_em,
          'espelho_ligado', v_espelho,
          'cliente', jsonb_build_object('id', c.id, 'nome', c.nome, 'cpf', c.cpf, 'nascimento', c.nascimento,
                                        'telefone', c.telefone, 'email', c.email),
          -- 0351: TODAS as pessoas da venda (titular + família), com o que falta e onde estão.
          'pessoas', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', vp.id, 'cliente_id', vp.cliente_id, 'comprador', vp.comprador, 'vinculo', vp.vinculo,
                     'nome', pc.nome, 'cpf', pc.cpf, 'nascimento', pc.nascimento, 'telefone', pc.telefone, 'email', pc.email,
                     'passaporte', pc.passaporte, 'passaporte_validade', pc.passaporte_validade,
                     'idade', case when pc.nascimento is null then null else extract(year from age(ref.d, pc.nascimento))::int end,
                     'menor', vp.menor, 'responsavel_nome', pr.nome,
                     'valor', vp.valor, 'aereo_incluso', vp.aereo_incluso, 'removida_em', vp.removida_em,
                     'bitrix_deal_id', vp.bitrix_deal_id, 'bitrix_status', vp.bitrix_status,
                     'contrato_status', vp.contrato_status,
                     'falta', to_jsonb(array_remove(array[
                        case when pc.cpf is null then 'cpf' end,
                        case when pc.nascimento is null then 'nascimento' end,
                        case when vp.comprador and pc.telefone is null and pc.email is null then 'contato' end], null)),
                     'expedicoes', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'item_id', i.id, 'expedicao_id', nullif(i.dados ->> 'expedicao_id', ''),
                                'expedicao_nome', coalesce(e.nome, i.dados ->> 'expedicao', i.nome),
                                'passageiro_id', px.id, 'status_reserva', px.status_reserva,
                                'na_fila', fila.n > 0,
                                'situacao', case when px.id is not null then 'na_expedicao'
                                                 when fila.n > 0 then 'na_fila'
                                                 else 'falta' end) order by i.ordem)
                         from qs_venda_itens i
                         left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
                         left join lateral (
                           select p.id, p.status_reserva from passageiros p
                            where p.cliente_id = vp.cliente_id and p.status_reserva <> 'Cancelado'
                              and (p.venda_item_id = i.id or p.expedicao_id = nullif(i.dados ->> 'expedicao_id', '')::uuid)
                            order by (p.venda_item_id = i.id) desc, p.created_at limit 1) px on true
                         cross join lateral (
                           select count(*) as n from exp_venda_pax_pendentes q
                            where q.aplicado_em is null and q.linha ->> 'cliente_id' = vp.cliente_id::text
                              and (q.linha ->> 'venda_item_id' = i.id::text or q.linha ->> 'expedicao_id' = i.dados ->> 'expedicao_id')) fila
                        where (i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id))
                          and i.tipo = 'expedicao' and i.status <> 'cancelado'
                          and vp.removida_em is null
                          and (cardinality(vp.itens) = 0 or i.ordem = any(vp.itens))), '[]'::jsonb))
                   order by vp.comprador desc, vp.removida_em nulls first, vp.criado_em)
              from qs_venda_pessoas vp
              join rel_clientes pc on pc.id = vp.cliente_id
              left join rel_clientes pr on pr.id = vp.responsavel_cliente_id
             where vp.venda_id = v.id), '[]'::jsonb),
          'itens', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'id', i.id, 'tipo', i.tipo, 'nome', i.nome, 'data_inicio', i.data_inicio, 'data_fim', i.data_fim,
                     'valor', i.valor, 'custo', i.custo, 'status', i.status, 'fornecedor', i.fornecedor,
                     'expedicao_id', nullif(i.dados ->> 'expedicao_id', ''),
                     'expedicao_tipo', e.tipo,
                     'expedicao_nome', coalesce(e.nome, i.dados ->> 'expedicao'),
                     'viajantes', case when i.tipo = 'expedicao' then coalesce(
                       (select jsonb_agg(jsonb_build_object(
                                 'passageiro_id', p.id, 'nome', p.nome_completo, 'cpf', p.cpf, 'nascimento', p.data_nascimento,
                                 'valor', p.valor_contratado_brl, 'pago', p.valor_pago_brl, 'aereo_incluso', p.aereo_incluso,
                                 'status', p.status_reserva, 'pendente', false) order by p.created_at)
                          from passageiros p where p.venda_item_id = i.id),
                       (select jsonb_agg(jsonb_build_object(
                                 'passageiro_id', null, 'nome', q.linha ->> 'nome_completo', 'cpf', q.linha ->> 'cpf',
                                 'nascimento', q.linha ->> 'data_nascimento',
                                 'valor', nullif(q.linha ->> 'valor_contratado_brl', '')::numeric,
                                 'pago', nullif(q.linha ->> 'valor_pago_brl', '')::numeric,
                                 'aereo_incluso', (q.linha ->> 'aereo_incluso')::boolean,
                                 'status', 'Na fila (validação)', 'pendente', true) order by q.criado_em)
                          from exp_venda_pax_pendentes q
                         where q.aplicado_em is null and q.linha ->> 'venda_item_id' = i.id::text),
                       '[]'::jsonb)
                     else coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'passageiro_id', null, 'nome', coalesce(rc.nome, px ->> 'nome'), 'cpf', rc.cpf, 'nascimento', rc.nascimento,
                                'valor', null, 'pago', null, 'aereo_incluso', null, 'status', null, 'pendente', false) order by o)
                         from jsonb_array_elements(case when jsonb_typeof(i.passageiros) = 'array' then i.passageiros else '[]'::jsonb end)
                              with ordinality t(px, o)
                         left join rel_clientes rc on rc.id = nullif(px ->> 'cliente_id', '')::uuid), '[]'::jsonb)
                     end) order by i.ordem)
              from qs_venda_itens i
              left join expedicoes e on e.id = nullif(i.dados ->> 'expedicao_id', '')::uuid
             where i.venda_id = v.id or (v.negocio_id is not null and i.negocio_id = v.negocio_id)), '[]'::jsonb)
        ) as j
          from qs_vendas v
          left join qs_closer_negocios n on n.id = v.negocio_id
          left join qs_users uc on uc.id = n.closer_id
          left join qs_users ur on ur.id = v.revisado_por
          left join rel_clientes c on c.id = v.cliente_id
          cross join lateral (
            select coalesce((select min(i2.data_inicio) from qs_venda_itens i2 where i2.venda_id = v.id and i2.status <> 'cancelado'),
                            (v.criado_em at time zone 'America/Sao_Paulo')::date) as d) ref
         where v.origem = 'closer'
           and (v.revisado_em is null or (p_todas and v.revisado_em > now() - interval '30 days'))
         order by v.criado_em desc
         limit 300
      ) x), '[]'::jsonb);
end $$;
revoke all on function ops_vendas_para_revisar(boolean) from public, anon;
grant execute on function ops_vendas_para_revisar(boolean) to authenticated;
