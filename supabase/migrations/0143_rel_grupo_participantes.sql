-- 0143_rel_grupo_participantes.sql
-- -----------------------------------------------------------------------------
-- PARTICIPANTES DOS GRUPOS (16/10/2026). Bruno: "quando clicar no nome da
-- pessoa, ter todos os grupos que ela participa em comum, igual no WhatsApp".
-- A Evolution devolve cada participante com o @lid E o telefone (phoneNumber);
-- guardamos os dois. Atualiza no "Atualizar lista", a cada 6h (cron) e quando
-- alguém entra/sai (evento GROUP_PARTICIPANTS_UPDATE).
-- -----------------------------------------------------------------------------

create table if not exists rel_wa_grupo_participantes (
  grupo_jid     text not null references rel_wa_grupos(jid) on delete cascade,
  participante  text not null,          -- id no WhatsApp (…@lid ou …@s.whatsapp.net)
  telefone      text,                   -- só dígitos, como o WhatsApp devolve (com DDI)
  admin         text,                   -- admin | superadmin | null
  atualizado_em timestamptz not null default now(),
  primary key (grupo_jid, participante)
);
create index if not exists rel_wa_grupo_part_tel_idx on rel_wa_grupo_participantes (telefone);

alter table rel_wa_grupo_participantes enable row level security;
revoke all on rel_wa_grupo_participantes from anon, authenticated;
grant select on rel_wa_grupo_participantes to authenticated;
drop policy if exists rel_wa_grupo_part_ler on rel_wa_grupo_participantes;
create policy rel_wa_grupo_part_ler on rel_wa_grupo_participantes for select to authenticated using (rel_tem_acesso());
