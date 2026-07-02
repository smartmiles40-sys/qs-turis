# Configurar o Supabase (banco de leads)

O app espera ~18 tabelas `qs_*`. O schema está versionado em
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) e os dados
iniciais em [`supabase/seed.sql`](../supabase/seed.sql).

## Passo a passo (painel do Supabase — mais simples)

1. **Crie o projeto** em https://supabase.com → *New project*.
   > A conta `smartmiles40-sys` já está no limite de **2 projetos grátis**. Para criar
   > este terceiro você precisa: pausar/excluir um projeto não usado, **OU** criar em
   > outra conta/organização, **OU** subir um projeto para o plano pago.
2. Aguarde inicializar (~2 min).
3. Vá em **SQL Editor** → cole o conteúdo de `supabase/migrations/0001_init.sql` → **Run**.
4. Rode também `supabase/seed.sql` (cria admin, canais, motivos de perda, produtos).
5. Vá em **Project Settings → API** e copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / publishable key** → `VITE_SUPABASE_ANON_KEY`
6. Crie o arquivo `.env` na raiz (copie de `.env.example`) e cole os dois valores.
7. `npm run dev` → login com **admin@qsturis.com / admin123** (troque a senha depois).

## Alternativa via CLI

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push          # aplica migrations/0001_init.sql
# depois rode o seed pelo SQL Editor ou psql
```

## Segurança — leia isto

O modelo de autenticação atual é **caseiro** (tabela `qs_users`, senha em texto puro).
A migration habilita **RLS** em todas as tabelas, mas com política **permissiva para a
chave anônima** — ou seja, hoje a segurança é de *nível de aplicação* (qualquer um com a
anon key + o app consegue ler/gravar). Isso mantém o app 100% funcional como foi escrito.

**Recomendação (próxima etapa, fora desta sprint):** migrar para **Supabase Auth** e
trocar as políticas por regras baseadas em `auth.uid()` e no `role` do usuário. Aí a anon
key deixa de dar acesso total aos leads (importante para LGPD). Enquanto isso:

- O backdoor de senha (senha-mestra hardcoded) **foi removido**.
- O botão "Pular login" agora só aparece em **desenvolvimento**.
- Não exponha a **service_role key** no front — só a anon/publishable.

## O que cada grupo de tabelas guarda

| Domínio | Tabelas |
|---|---|
| Usuários / acesso | `qs_users` |
| Leads | `qs_leads`, `qs_contacts`, `qs_lead_custom_values`, `qs_custom_fields` |
| Prospecção | `qs_cadences`, `qs_cadence_days`, `qs_cadence_activities`, `qs_cadence_owners`, `qs_tasks` |
| Conversão | `qs_meetings`, `qs_handovers`, `qs_goals`, `qs_loss_reasons` |
| Config | `qs_channel_config`, `qs_products` |
| Notas / WhatsApp | `qs_notes`, `qs_whatsapp_messages` |
