-- =============================================================================
-- 0037 — Desgruda os telefones que vieram do Bitrix com dois números num campo
-- =============================================================================
-- O Bitrix manda telefone como LISTA. O normalizador antigo do QS fazia
-- `replace(/\D/g,'')` na string inteira e GRUDAVA os números:
--
--     " 5519993152056,  551993152056"  →  55199931520565 51993152056
--     "5547999689893554799689893"      (dois números, 25 dígitos)
--
-- Consequência silenciosa e cara: a chave do telefone dava null, o webhook do
-- WhatsApp não achava o lead e a mensagem era DESCARTADA. Medido em produção:
-- 57 leads assim — todo WhatsApp deles sumia sem erro nenhum em lugar nenhum.
--
-- O código já foi corrigido nos dois lados (leitura e gravação). Esta migration
-- arruma o que já está gravado, pra exportação, Bitrix e telefone exibido
-- pararem de carregar o monstro.
--
-- CONSERVADORA: só mexe em quem NÃO está num formato válido. Telefone já limpo
-- não é tocado. Idempotente.
-- =============================================================================

do $$
declare
  n int;
begin
  -- `\d{10,13}` é guloso: pega o PRIMEIRO número plausível e para. Em
  -- "5547999689893554799689893" isso devolve os 13 primeiros — o número certo.
  update qs_leads
     set phone = (regexp_match(phone, '\d{10,13}'))[1],
         updated_at = now()
   where phone is not null
     and phone !~ '^\d{10,15}$'      -- já limpo? não mexe
     and phone ~ '\d{10}';           -- tem pelo menos um número plausível dentro

  get diagnostics n = row_count;
  raise notice '[0037] telefones desgrudados: %', n;
end $$;

-- O que sobrou fora do padrão (número estrangeiro, dado incompleto). Não é erro:
-- o casamento por chave internacional cobre esses casos desde o conserto do
-- código. Fica a consulta pra conferência:
--
-- select id, full_name, phone from qs_leads
--  where phone is not null and phone !~ '^\d{10,15}$';
