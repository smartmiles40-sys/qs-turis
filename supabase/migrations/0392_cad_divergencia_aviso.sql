-- supabase/migrations/0392_cad_divergencia_aviso.sql
-- -----------------------------------------------------------------------------
-- PONTE PEDIDOS (3/5): DIVERGÊNCIA DE CADASTRO NASCE COM AVISO (13/11/2026).
--
-- POR QUÊ
--   Auditoria de 13/11: 110 divergências abertas em cad_divergencias (ficha do
--   cliente × passageiro da expedição: telefone, e-mail, passaporte, CPF…), a
--   mais antiga de 23/10, 1 resolvida. Ninguém era avisado: a fila só aparecia
--   pra quem entrava em "Arrumar cadastros". O front ganha o contador no menu
--   de Operações e do Relacionamento; aqui nasce o aviso no sino.
--
-- O QUE FAZ
--   Gatilho AFTER INSERT em cad_divergencias → qs_aviso_criar (tipo 'cadastro')
--   para quem responde pelo cadastro: o(s) GESTOR(ES) de Operações e do
--   Relacionamento (role gestor). Sem gestor nesses setores → quem recebe
--   pedidos de Operações (qs_avisos_recebedores). Link: Operações → "Arrumar
--   cadastros" (#ops/arrumar); gestor só do Rel → #rel/cadastros.
--   Sem enxurrada: no máximo 1 aviso por pessoa (ficha) por dia por gestor
--   (chave cad_div:<cliente>:<dia>) — uma importação que gera 5 divergências
--   da mesma pessoa dá 1 aviso. Erro aqui nunca impede gravar a divergência.
--   Não há backfill: as 110 antigas aparecem no contador do menu, sem aviso.
--
-- COMO CONFERIR
--   select a.titulo, a.texto, a.link, u.name from qs_avisos a join qs_users u on u.id = a.user_id
--    where a.tipo = 'cadastro' order by a.criado_em desc limit 10;
--
-- COMO VOLTAR
--   drop trigger if exists trg_cad_divergencias_aviso on public.cad_divergencias;
--   drop function if exists public.cad_divergencias_aviso();
-- Idempotente.
-- -----------------------------------------------------------------------------

create or replace function public.cad_divergencias_aviso()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  u record;
  v_nome text;
  v_campo text;
  v_n int := 0;
  v_titulo text;
  v_texto text;
begin
  begin
    select nome into v_nome from rel_clientes where id = new.cliente_id;
    v_campo := case new.campo
      when 'pessoa' then 'pessoa (pode ser outra ficha)'
      when 'cpf' then 'CPF'
      when 'passaporte' then 'passaporte'
      when 'passaporte_validade' then 'validade do passaporte'
      when 'nascimento' then 'nascimento'
      when 'email' then 'e-mail'
      when 'telefone' then 'telefone'
      else new.campo end;
    v_titulo := 'Cadastro divergente: ' || coalesce(nullif(trim(v_nome), ''), 'cliente');
    v_texto := 'Ficha × expedição discordam no ' || v_campo
      || case when new.campo = 'pessoa' then '' else
           ' (ficha: ' || coalesce(nullif(trim(new.valor_ficha), ''), 'vazio')
           || ' · expedição: ' || coalesce(nullif(trim(new.valor_expedicao), ''), 'vazio') || ')' end
      || '. Escolha o que vale em Arrumar cadastros.';

    for u in
      select q.id, q.setores from qs_users q
       where q.is_active and q.role = 'gestor'
         and coalesce(q.setores, '{}') && array['operacional', 'relacionamento']
    loop
      v_n := v_n + 1;
      perform qs_aviso_criar(u.id, 'cadastro',
        case when 'operacional' = any(u.setores) then 'operacional' else 'relacionamento' end,
        v_titulo, v_texto,
        case when 'operacional' = any(u.setores) then '#ops/arrumar' else '#rel/cadastros' end,
        'cad_divergencias', new.id::text,
        'cad_div:' || new.cliente_id || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));
    end loop;

    if v_n = 0 then
      for u in select r as id from qs_avisos_recebedores('operacional') r loop
        perform qs_aviso_criar(u.id, 'cadastro', 'operacional', v_titulo, v_texto, '#ops/arrumar',
          'cad_divergencias', new.id::text,
          'cad_div:' || new.cliente_id || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));
      end loop;
    end if;
  exception when others then
    raise warning '[0392] aviso da divergência % não saiu: %', new.id, sqlerrm;
  end;
  return null;
end $function$;

comment on function public.cad_divergencias_aviso() is
  '0392: divergência ficha × expedição nova → aviso no sino do gestor de Operações/Relacionamento (1 por ficha por dia).';
revoke all on function public.cad_divergencias_aviso() from public, anon, authenticated;

drop trigger if exists trg_cad_divergencias_aviso on public.cad_divergencias;
create trigger trg_cad_divergencias_aviso
  after insert on public.cad_divergencias
  for each row execute function public.cad_divergencias_aviso();
