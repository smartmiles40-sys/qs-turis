-- 0069_primeiro_contato_gatilho.sql
-- ---------------------------------------------------------------------------
-- COMO USAR: Supabase (projeto eabfjomrnucymduqnbci) -> SQL Editor -> New
--    query -> cole este arquivo INTEIRO -> Run. Pode rodar mais de uma vez.
--
-- Depende da 0067 (que criou `qs_primeiro_contato`).
--
-- -- O QUE MUDA --------------------------------------------------------------
--
-- A mensagem automatica de primeiro contato passa a ser disparada pelo PROPRIO
-- QS, no instante em que o lead nasce (`/api/lead-inbound`), em vez de esperar
-- uma automacao do Bitrix chamar um workflow do n8n que chama o QS.
--
-- Duas coisas precisam existir no banco pra isso ficar de pe:
--
--   1. DEDUPE POR TELEFONE, e nao so por lead.
--   2. O GATILHO na configuracao da tela, pra dar pra voltar atras sem deploy.
-- ---------------------------------------------------------------------------


-- -- (1) DEDUPE POR TELEFONE --------------------------------------------------
--
-- A 0067 deduplicou por `lead_id` (chave primaria), e isso bastava enquanto o
-- gatilho era o Bitrix: o mesmo negocio repetindo o webhook batia no mesmo
-- lead. Com o disparo no nascimento do lead aparece um caso que a chave
-- primaria NAO cobre: a mesma PESSOA num card novo.
--
-- Acontece de verdade — e o `?duplicar=1` das cargas de lista (o modo resgate),
-- que cria card proprio de propósito pra quem ja existe. Sem esta trava, quem
-- ja tinha assistido o video ganharia um "oi, prazer" de novo. Duas boas-vindas
-- seguidas do mesmo numero e como se ganha um bloqueio no WhatsApp.
--
-- O indice e PARCIAL (`where telefone is not null`) porque linha antiga da 0067
-- pode ter telefone nulo, e nulo nao deve competir com nulo.
--
-- O DO/EXCEPTION existe por um motivo pratico: este arquivo e colado inteiro no
-- SQL Editor. Se ja houver duas linhas com o mesmo telefone, um `create unique
-- index` cru aborta a transacao e a parte (2) — que e o que liga o recurso —
-- nao roda, deixando o banco pela metade sem ninguem entender por que. Assim o
-- resto aplica e a duplicata aparece como AVISO, pra ser limpa e o arquivo
-- rodado de novo.
do $$
begin
  create unique index if not exists uq_qs_primeiro_contato_telefone
    on public.qs_primeiro_contato (telefone)
    where telefone is not null;

  comment on index public.uq_qs_primeiro_contato_telefone is
    'A mesma PESSOA nunca recebe o video duas vezes, mesmo em cards diferentes (carga de lista com duplicar=1).';
exception when others then
  -- O caso esperado e 23505 (telefone repetido). Qualquer outro tambem vira
  -- aviso pelo mesmo motivo: derrubar a transacao aqui deixaria a parte (2)
  -- sem rodar, e o AVISO com SQLERRM diz exatamente o que aconteceu.
  raise warning
    'Indice unico de telefone NAO criado (%). Provavelmente ha telefones repetidos em '
    'qs_primeiro_contato: rode a consulta do rodape, apague as linhas sobrando e cole o '
    'arquivo de novo. Ate la o dedupe continua sendo so por lead_id (o da 0067).', sqlerrm;
end $$;


-- -- (2) O GATILHO ------------------------------------------------------------
--
--   'lead_novo' -> o QS dispara sozinho quando o card nasce (o padrao, 31/08)
--   'externo'   -> so quando o Bitrix/n8n chamar POST /api/primeiro-contato
--
-- Fica na MESMA chave do resto da configuracao (`primeiro_contato_auto`) porque
-- e a mesma decisao: quem abre a tela pra trocar a mensagem tem que ver, no
-- mesmo lugar, quando ela sai.
--
-- Existir 'externo' e o que permitiu trocar o gatilho sem apagar o antigo: se o
-- disparo automatico der problema com trafego ligado, voltar pro Bitrix e um
-- clique na tela, nao um deploy.
--
-- `||` com o valor atual a esquerda so acrescenta a chave que falta: quem ja
-- configurou modelo, video, variaveis e teto nao perde nada. E o `where not
-- ... ? 'gatilho'` garante que rodar de novo nao desfaz uma escolha por
-- 'externo' feita na tela.
update qs_settings
   set value = value || '{"gatilho": "lead_novo"}'::jsonb
 where key = 'primeiro_contato_auto'
   and not (value ? 'gatilho');

-- Se a 0067 nunca rodou, a linha nasce aqui — desligada, como la.
insert into qs_settings(key, value)
values ('primeiro_contato_auto', '{"ativo": false, "teto_dia": 200, "gatilho": "lead_novo"}'::jsonb)
on conflict (key) do nothing;


-- -- CONFERENCIA DEPOIS DE COLAR ----------------------------------------------
--
-- O gatilho ficou gravado?
--   select value from qs_settings where key = 'primeiro_contato_auto';
--
-- O indice de telefone existe?
--   select indexname from pg_indexes
--    where tablename = 'qs_primeiro_contato' and indexname = 'uq_qs_primeiro_contato_telefone';
--
-- Deu o AVISO de telefone repetido? Estes sao os repetidos:
--   select telefone, count(*), array_agg(lead_id)
--     from qs_primeiro_contato where telefone is not null
--    group by telefone having count(*) > 1;
--
-- Quem recebeu hoje, e o que falhou:
--   select status, count(*) from qs_primeiro_contato
--    where criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
--    group by status;
