-- 0310_rel_trecho_conferido.sql
-- -----------------------------------------------------------------------------
-- REVISÃO MANUAL DOS VOOS (03/11/2026, Bruno): "é um sistema e eles têm que
-- fazer a revisão manual". Cada voo ganha "Conferi ✓" — quem conferiu e quando —
-- gravado como uma ação nova no histórico de correções da 0227
-- (rel_viagem_correcoes, acao = 'trecho_conferido'). Sem coluna nova: o estado
-- "conferido" é a última conferência valendo do trecho (src/rel/lib/conferencia.ts);
-- uma correção do trecho (trecho_editado) feita DEPOIS anula a conferência.
--
-- Por que precisa de migration: a tabela não tem policy de insert (só grava pelas
-- funções security definer da 0227), e o desfazer da 0227 restaura o "antes" no
-- trecho — numa conferência o "antes" é só {conferido: …}, então o desfazer
-- precisa pular o trecho nesse caso (senão apagaria os campos do voo).
--
-- Depende da 0227 (APLICADA). Só cria/troca funções — nada de dado muda.
-- Volta: ver o fim do arquivo.
-- -----------------------------------------------------------------------------

-- conferir (true) ou tirar a conferência (false) de um trecho
create or replace function rel_trecho_conferir(p_trecho uuid, p_conferido boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare t rel_viagem_trechos; cid uuid; ultimo boolean;
begin
  perform rel_correcao_checar(null, false);
  select * into t from rel_viagem_trechos where id = p_trecho;
  if not found then raise exception 'Trecho não encontrado.'; end if;
  select coalesce((c.depois->>'conferido')::boolean, false) into ultimo
    from rel_viagem_correcoes c
   where c.trecho_id = p_trecho and c.acao = 'trecho_conferido' and c.desfeita_em is null
   order by c.feito_em desc limit 1;
  insert into rel_viagem_correcoes (viagem_id, trecho_id, acao, antes, depois, motivo, feito_por)
  values (t.viagem_id, p_trecho, 'trecho_conferido',
          jsonb_build_object('conferido', coalesce(ultimo, false)),
          jsonb_build_object('conferido', coalesce(p_conferido, true)),
          case when coalesce(p_conferido, true) then 'conferido à mão' else 'conferência retirada' end,
          auth.uid())
  returning id into cid;
  return cid;
end;
$$;

-- desfazer (0227) + o caso da conferência: só marca como desfeita, não mexe no trecho
create or replace function rel_desfazer_correcao(p_correcao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c rel_viagem_correcoes;
begin
  perform rel_correcao_checar(null, false);
  select * into c from rel_viagem_correcoes where id = p_correcao for update;
  if not found then raise exception 'Correção não encontrada.'; end if;
  if c.desfeita_em is not null then raise exception 'Essa correção já foi desfeita.'; end if;
  if c.acao = 'trecho_conferido' then
    update rel_viagem_correcoes set desfeita_em = now(), desfeita_por = auth.uid() where id = c.id;
    return;
  end if;
  -- a conferência não conta como "correção mais nova" do trecho (não restaura nada)
  if exists (select 1 from rel_viagem_correcoes o
              where o.id <> c.id and o.desfeita_em is null and o.feito_em > c.feito_em
                and o.acao <> 'trecho_conferido'
                and o.viagem_id = c.viagem_id
                and ((c.trecho_id is null and o.trecho_id is null) or o.trecho_id = c.trecho_id)) then
    raise exception 'Tem correção mais nova neste mesmo item — desfaça a mais recente primeiro.';
  end if;
  if c.trecho_id is not null then
    if not exists (select 1 from rel_viagem_trechos where id = c.trecho_id) then raise exception 'O trecho não existe mais.'; end if;
    perform rel_trecho_aplicar(c.trecho_id, c.antes);
  else
    perform rel_viagem_aplicar(c.viagem_id, c.antes);
  end if;
  update rel_viagem_correcoes set desfeita_em = now(), desfeita_por = auth.uid() where id = c.id;
end;
$$;

revoke all on function rel_trecho_conferir(uuid, boolean) from public, anon;
grant execute on function rel_trecho_conferir(uuid, boolean) to authenticated;
revoke all on function rel_desfazer_correcao(uuid) from public, anon;
grant execute on function rel_desfazer_correcao(uuid) to authenticated;

-- Volta:
--   drop function if exists rel_trecho_conferir(uuid, boolean);
--   e recriar rel_desfazer_correcao como na 0227 (sem os dois trechos 'trecho_conferido').
