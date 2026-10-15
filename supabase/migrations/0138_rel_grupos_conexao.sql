-- 0138_rel_grupos_conexao.sql
-- Quedas e voltas da ligação dos grupos (Evolution, 0137) — pra medir se ela
-- aguenta no número do Relacionamento (COEX) antes de puxar o histórico completo.
-- Escreve: api/rel-grupos.js (evento CONNECTION_UPDATE). Lê: Relacionamento.
create table if not exists rel_wa_grupos_conexao (
  id bigserial primary key,
  estado text not null,
  motivo text,
  em timestamptz not null default now()
);
alter table rel_wa_grupos_conexao enable row level security;
revoke all on rel_wa_grupos_conexao from anon, authenticated;
grant select on rel_wa_grupos_conexao to authenticated;
drop policy if exists rel_wa_grupos_conexao_ler on rel_wa_grupos_conexao;
create policy rel_wa_grupos_conexao_ler on rel_wa_grupos_conexao
  for select to authenticated using (rel_tem_acesso());
