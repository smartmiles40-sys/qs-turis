-- 0324_bitrix_alias_produto_tipo.sql
-- -----------------------------------------------------------------------------
-- 06/11: Bruno criou no Bitrix o campo lista "Produto" (Expedição/Aéreo/Pacote/
-- Outros). O catálogo (bitrix_fields) só o enxerga no próximo /api/bitrix-catalogo
-- (cron 06h10). Para não depender de alguém lembrar de cadastrar o apelido depois,
-- este gatilho dá o alias `produto_tipo` ao campo assim que ele entrar no catálogo
-- (lista, rótulo exatamente "Produto", e só se ninguém tiver o alias ainda).
-- O "Produto (Descritivo da Reunião)" (texto, alias produto_reuniao) não é afetado.
-- -----------------------------------------------------------------------------

create or replace function public.bitrix_fields_alias_produto()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.alias is null
     and new.user_type_id = 'enumeration'
     and lower(btrim(coalesce(new.label, ''))) = 'produto'
     and not exists (select 1 from bitrix_fields where alias = 'produto_tipo' and field_name <> new.field_name) then
    new.alias := 'produto_tipo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bitrix_fields_alias_produto on public.bitrix_fields;
create trigger trg_bitrix_fields_alias_produto
  before insert or update on public.bitrix_fields
  for each row execute function public.bitrix_fields_alias_produto();

-- Se o campo já estiver no catálogo, aplica agora.
update public.bitrix_fields set alias = 'produto_tipo'
 where alias is null and user_type_id = 'enumeration' and lower(btrim(coalesce(label, ''))) = 'produto'
   and not exists (select 1 from public.bitrix_fields where alias = 'produto_tipo');
