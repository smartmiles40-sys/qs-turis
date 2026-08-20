-- 0057_descarte_que_ja_tem_dono.sql
-- =============================================================================
-- "O DONO APARECEU?" — achar, no banco, o descarte que hoje já tem lead.
--
-- POR QUE EXISTE (auditoria de 20/08/2026). Quando a mensagem chega antes de o
-- lead existir (a CORRIDA: o cliente responde no mesmo minuto em que o Bitrix
-- cria o negócio), o webhook registra um descarte `sem-lead-correspondente` e
-- segue. O resgate existe — mas roda pendurado na CRIAÇÃO do lead pelo webhook
-- de entrada. Lead que nasce por outro caminho (sincronização do Bitrix,
-- cadastro na mão dentro do QS) não dispara nada, e o descarte fica pendente
-- para sempre. Medido: 12 descartes pendentes cujo lead JÁ EXISTE hoje.
--
-- POR QUE NO BANCO, E NÃO EM JS. A varredura ingênua ("pega os 15 pendentes
-- mais recentes e pergunta se tem lead") passa fome: hoje há 222 pendentes e a
-- maioria é gente que realmente não é lead — eles ocupariam as 15 vagas em toda
-- rodada, para sempre, e os resgatáveis nunca seriam alcançados. Aqui a
-- pergunta é feita de uma vez, sobre a tabela inteira, e só volta o que dá para
-- resgatar. Sem fila, sem fome, uma consulta.
--
-- `qs_wa_key` é a MESMA regra do `waKey` do api/_wa.js: DDD + 8 dígitos finais,
-- sem o 55 e sem o nono dígito. É ela que faz o número que chega sem o 9
-- ("558596604595") casar com o lead que tem o 9 ("5585996604595") — os dois
-- viram `8596604595`. As duas implementações precisam andar juntas: mudou uma,
-- muda a outra.
--
-- CONFERIDO em 20/08 contra 14 números reais: 13 dos 14 dão a MESMA chave nas
-- duas. A única diferença é telefone GRUDADO ("55479996898935547996898 93",
-- dois números colados sem separador, que o Bitrix manda de vez em quando): o
-- JS separa e devolve o primeiro, o SQL devolve null. Deixado assim de
-- propósito — errar pro lado de "não resgata" é seguro, errar pro lado de
-- casar o lead errado não é. Hoje isso não custa nada: nenhum lead da base tem
-- telefone com mais de 13 dígitos.
-- =============================================================================

create or replace function public.qs_wa_key(raw text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $$
declare d text; ddd text; resto text;
begin
  d := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
  if length(d) >= 12 and left(d, 2) = '55' then d := substr(d, 3); end if;
  if length(d) < 10 then return null; end if;
  ddd := left(d, 2);
  resto := substr(d, 3);
  if length(resto) = 9 and left(resto, 1) = '9' then resto := substr(resto, 2); end if;
  if length(resto) <> 8 then return null; end if;
  return ddd || resto;
end $$;

comment on function public.qs_wa_key(text) is
  'Chave canonica de telefone: DDD + 8 digitos finais, sem 55 e sem o nono digito. '
  'Espelha o waKey de api/_wa.js — mudar uma exige mudar a outra. Migration 0057.';

-- SECURITY DEFINER porque o vigia chama isto com a chave de serviço, mas a
-- função não expõe nada além do que ele já lê: id do descarte e id do lead.
create or replace function public.qs_wa_descartes_com_dono(p_limite int default 30)
returns table (descarte_id bigint, lead_id uuid, phone text)
language sql
security definer
set search_path to 'public'
as $$
  select distinct on (l.id)
         d.id as descarte_id, l.id as lead_id, d.phone
    from qs_wa_descartadas d
    join qs_leads l on qs_wa_key(l.phone) = qs_wa_key(d.phone)
   where d.motivo = 'sem-lead-correspondente'
     and d.situacao = 'pendente'
     and qs_wa_key(d.phone) is not null
   -- distinct on (l.id): um telefone pode ter várias linhas de descarte, e
   -- resgatar UMA vez já traz a conversa inteira daquele lead. Sem isto, o mesmo
   -- lead seria resgatado cinco vezes e o teto se esgotaria em duas pessoas.
   order by l.id, d.created_at asc
   limit p_limite;
$$;

comment on function public.qs_wa_descartes_com_dono(int) is
  'Descartes ainda pendentes cujo telefone JA casa com um lead — o resgate que '
  'ficou para tras. Um por lead. Usado pela varredura do vigia. Migration 0057.';

revoke all on function public.qs_wa_descartes_com_dono(int) from public, anon, authenticated;

-- =============================================================================
-- Conferência depois de aplicar:
--   select * from qs_wa_descartes_com_dono(50);
-- Esperado em 20/08: as 12 linhas de leads que nasceram depois da mensagem.
-- =============================================================================
