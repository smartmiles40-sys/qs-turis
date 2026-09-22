-- supabase/migrations/0086_pulso_do_webhook_da_meta.sql
-- O PULSO do webhook da Meta — o conserto do ponto cego nº 1 do QS.
--
-- O QUE ACONTECEU, E POR ISSO ISTO EXISTE:
--
-- O número oficial (+55 11 4863-6051) não grava uma mensagem desde 02/09/2026.
-- Vinte dias. Ninguém percebeu, e nada no sistema tinha como perceber, porque o
-- vigia só sabe perguntar à Evolution se a instância está `open`. A caixa oficial
-- e o próprio webhook nunca foram observados por nada.
--
-- E o pior: as três causas possíveis são INDISTINGUÍVEIS de fora.
--
--   1. a Meta parou de chamar (app dessubscrito, URL trocada, webhook desativado
--      por excesso de erro);
--   2. a Meta chama e o QS recusa — `META_CALLS_APP_SECRET` diferente do app
--      secret real, e toda entrega leva 401;
--   3. a Meta chama, o QS aceita, e o evento é ignorado por não casar com nenhum
--      formato conhecido.
--
-- Do lado de fora as três parecem a mesma coisa: silêncio. Este pulso separa as
-- três, porque conta CADA batida na porta, inclusive as que são recusadas.
--
-- Por que contador e não uma linha por evento: são centenas por dia e o que
-- importa é "chegou alguma coisa hoje?" e "está sendo recusada?". Uma linha por
-- dia responde as duas e não cria tabela nova para varrer depois.

create or replace function public.qs_wa_meta_pulso(p_resultado text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- O dia do RELÓGIO DE SÃO PAULO. Usar UTC faria o contador virar às 21h e
  -- "nada chegou hoje" apareceria toda noite, sozinho.
  hoje text := ((now() at time zone 'America/Sao_Paulo')::date)::text;
  atual jsonb;
  chave text := coalesce(nullif(btrim(p_resultado), ''), 'desconhecido');
begin
  select value into atual from public.qs_settings where key = 'wa_meta_pulso';

  -- Virou o dia: zera os contadores mas PRESERVA os carimbos. É o carimbo que
  -- responde "há quantos dias isto está mudo?", e zerá-lo junto apagaria
  -- justamente a informação que motivou este arquivo.
  if atual is null or (atual ->> 'dia') is distinct from hoje then
    atual := jsonb_build_object('dia', hoje)
             || coalesce(
                  jsonb_build_object(
                    'ultimo_em', atual -> 'ultimo_em',
                    'ultimo_valido_em', atual -> 'ultimo_valido_em',
                    'ultimo_resultado', atual -> 'ultimo_resultado'
                  ),
                  '{}'::jsonb
                );
  end if;

  atual := jsonb_set(
    atual,
    array[chave],
    to_jsonb(coalesce((atual ->> chave)::int, 0) + 1),
    true
  );
  atual := jsonb_set(atual, '{ultimo_em}', to_jsonb(now()), true);
  atual := jsonb_set(atual, '{ultimo_resultado}', to_jsonb(chave), true);

  -- `ultimo_valido_em` só avança quando a Meta foi de fato ACEITA (assinatura
  -- conferida). É esse carimbo que o vigia observa: um webhook que só recebe
  -- 401 está "recebendo" e mesmo assim não entrega nada — e sem esta distinção
  -- o alerta ficaria em silêncio exatamente no caso 2 lá de cima.
  if chave in ('gravado', 'ignorado', 'recibo', 'handshake') then
    atual := jsonb_set(atual, '{ultimo_valido_em}', to_jsonb(now()), true);
  end if;

  insert into public.qs_settings (key, value)
  values ('wa_meta_pulso', atual)
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$fn$;

-- Ver 0013 do SendFlow e a lição do dashboard em 17/09: no Supabase, `revoke
-- from public` NÃO basta — ele concede EXECUTE direto a anon e authenticated.
-- Aqui não há risco de quebrar integração: a função nasce agora e só o webhook
-- (service_role) a chama.
revoke all on function public.qs_wa_meta_pulso(text) from public;
revoke all on function public.qs_wa_meta_pulso(text) from anon, authenticated;
grant execute on function public.qs_wa_meta_pulso(text) to service_role;

-- Semente: a linha passa a existir já com o que sabemos hoje — que a última
-- mensagem da caixa oficial foi em 02/09. Sem isso, o vigia veria "nunca
-- recebeu" e não teria como dizer há quanto tempo.
insert into public.qs_settings (key, value)
values (
  'wa_meta_pulso',
  jsonb_build_object(
    'dia', ((now() at time zone 'America/Sao_Paulo')::date)::text,
    'observacao', 'Semente da 0086. A caixa oficial (inbox 3) nao grava mensagem desde 02/09/2026.'
  )
)
on conflict (key) do nothing;
