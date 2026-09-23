-- =============================================================================
-- 0089 — DISTRIBUIDOR TAMBÉM PRA QUEM SÓ CLICA NO BOTÃO (sem formulário)
-- -----------------------------------------------------------------------------
-- Bruno, 23/09/2026: "trocar o link de redirecionamento em TODAS as páginas".
-- Pacotes e portal não têm formulário: o botão de WhatsApp abre direto. Sem
-- telefone não existe bilhete (não há o que casar com o card), mas dá pra
-- manter a MESMA roda das LPs ('fila:forms') e registrar o clique — assim a
-- divisão entre os SDRs continua igual e dá pra contar quem recebeu o quê.
--
-- sdr_reservas passa a aceitar linha sem telefone (clique). O trigger dos
-- leads só procura bilhete pela chave do telefone, então linha sem chave nunca
-- casa com card nenhum — que é exatamente o certo.
-- =============================================================================

alter table sdr_reservas alter column telefone drop not null;
alter table sdr_reservas alter column chave    drop not null;

create or replace function public.sdr_da_vez(
  p_origem text default null,
  p_fila   text default 'forms'
)
returns table (reserva_id uuid, sdr_id uuid, sdr_nome text, numero text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_fila text := coalesce(nullif(btrim(lower(p_fila)), ''), 'forms');
  v_sdr  uuid;
  v_num  text;
  v_nome text;
  v_id   uuid;
begin
  v_sdr := qs_proximo_sdr('fila:' || v_fila, qs_sdrs_no_rodizio());
  if v_sdr is null then
    return;                                        -- ninguém no rodízio -> fallback
  end if;

  select p.numero, coalesce(u.name, p.sdr_nome)
    into v_num, v_nome
    from sdr_pool p
    left join qs_users u on u.id = p.sdr_id
   where p.sdr_id = v_sdr and p.status = 'ativo'
   limit 1;

  insert into sdr_reservas (telefone, chave, sdr_id, numero, fila, origem)
       values (null, null, v_sdr, v_num, v_fila,
               coalesce(nullif(btrim(coalesce(p_origem, '')), ''), 'clique'))
    returning sdr_reservas.id into v_id;

  reserva_id := v_id;
  sdr_id     := v_sdr;
  sdr_nome   := v_nome;
  numero     := v_num;
  return next;
end;
$fn$;

revoke all on function public.sdr_da_vez(text, text) from public, anon, authenticated;
grant execute on function public.sdr_da_vez(text, text) to service_role;
