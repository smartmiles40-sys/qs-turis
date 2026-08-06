# Ligar a reunião do QS no card do Bitrix — hoje

Dois workflows, uma migration e um deploy. ~40 minutos.

O que muda: quando alguém agendar uma reunião no QS (pelo Ganho, pela Agenda ou
pela página de Reuniões), o negócio no Bitrix recebe os campos preenchidos, um
comentário na timeline e — se você decidir a etapa — a mudança de coluna.

---

## O que NÃO estamos fazendo (e por quê)

O material original criava o evento no Google dentro do workflow novo. **O QS já
faz isso** pelo `/api/agenda-meet`, que está no ar e validado. Manter os dois
geraria dois eventos e dois convites para o mesmo cliente.

Também não criamos a tabela `agendamentos`: a `qs_meetings` já é a fonte da
verdade e já tem as colunas `bitrix_synced` / `bitrix_error` para registrar o
resultado. Uma tabela a menos para desencontrar.

---

## Passo 1 — Escopo do webhook do Bitrix

É o mesmo que travou a automação da primeira atividade. Confira antes de tudo.

Bitrix24 → Aplicativos → Webhooks → seu webhook **de entrada** → marque `crm`.
Depois teste no navegador:

```
https://SEUPORTAL.bitrix24.com.br/rest/23/SEU_TOKEN/scope.json
```

Se voltar `[""]`, o escopo não pegou — recrie o webhook. Sem `crm`, nada abaixo
funciona.

---

## Passo 2 — Migration

Cole `supabase/migrations/0042_catalogo_bitrix.sql` no SQL Editor do Supabase
(projeto `eabfjomrnucymduqnbci`). Cria o catálogo de campos e a visão de opções.

---

## Passo 3 — Credenciais no n8n

Duas, e provavelmente as duas já existem.

| Nome | Tipo | Conteúdo |
|---|---|---|
| `Supabase QS (service_role)` | Supabase API | Host = URL do projeto · Service Role Secret = a chave |
| `QS Sync (x-qs-sync-secret)` | Header Auth | Name = `x-qs-sync-secret` · Value = o mesmo `N8N_SYNC_SECRET` da Vercel |

> **Confira o header antes de criar.** Os webhooks que já rodam (`qs-perdido`,
> `qs-nota`, `qs-primeiro-contato`) usam `x-qs-sync-secret`. Se eles estiverem
> **sem** autenticação, tire a credencial do nó de webhook nos dois workflows
> novos — senão você toma `403` em tudo. O `x-qs-agenda-secret` é outro segredo,
> da agenda do Google; não confunda.

---

## Passo 4 — Importar o sync do catálogo

`n8n/qs-sync-catalogo-bitrix.workflow.json` → **Import from File**.

1. Nó **Config**: preencha `BITRIX_BASE` (com o token) e confira `SUPABASE_URL`
2. Nos nós marcados `SUBSTITUA`, escolha as credenciais no dropdown
3. **Test workflow** — roda na hora
4. Confira no Supabase:

```sql
select field_name, label, user_type_id from public.bitrix_fields order by label;
select count(*) from public.bitrix_field_options;
```

Se a resposta trouxer `aviso`, o portal tem mais de 50 campos e a leitura veio
cortada — me avise que eu pagino.

5. **Ative** o workflow (cron diário às 6h + webhook manual)

---

## Passo 5 — Apontar os apelidos (uma vez na vida)

Olhe a lista de campos do passo anterior, ache os seis pelo rótulo e rode:

```sql
update public.bitrix_fields set alias = 'sdr_agendou'      where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'email_cliente'    where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'data_agendamento' where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'resp_reuniao'     where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'datahora_meet'    where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'produto_reuniao'  where field_name = 'UF_CRM_...';
```

Opcionais — se existirem, o workflow preenche; se não, ignora sem reclamar:

```sql
update public.bitrix_fields set alias = 'link_meet'       where field_name = 'UF_CRM_...';
update public.bitrix_fields set alias = 'duracao_reuniao' where field_name = 'UF_CRM_...';
```

> `produto_reuniao` fica vazio por enquanto: **o QS não tem campo de produto**.
> Se quiser esse dado, precisamos decidir de onde ele sai (campo novo no modal
> ou nome da cadência).

Confira as opções que o QS vai poder casar:

```sql
select alias, option_id, value from public.v_opcoes_por_alias order by alias, sort;
```

Os rótulos de `sdr_agendou` e `resp_reuniao` precisam bater com os nomes dos
usuários no QS. O workflow tenta o nome inteiro e depois o primeiro nome — se
o Bitrix tem "Talita" e o QS tem "Talita Carvalho", casa.

---

## Passo 6 — Importar o workflow da reunião

⚠️ **Antes de importar:** já existe um workflow desativado usando o caminho
`qs-reuniao`. Dois workflows não podem dividir o mesmo caminho — **apague ou
renomeie o antigo**, senão a ativação falha.

`n8n/qs-reuniao-bitrix.workflow.json` → **Import from File**.

1. Nó **Config**: `BITRIX_BASE`, `SUPABASE_URL` e **`STAGE_REUNIAO`**
   - Deixe `STAGE_REUNIAO` **vazio** se ainda não decidiu a coluna: o workflow
     preenche os campos e **não mexe na etapa**. É de propósito — mover para a
     coluna errada é pior do que não mover.
   - Quando decidir, preencha com o ID (ex.: `C25:UC_XXXXX`).
2. Escolha as credenciais nos nós `SUBSTITUA`
3. **Ative**

---

## Passo 7 — Deploy do QS

O código que acompanha isto já está commitado. Só falta o push, que a Vercel
deploya sozinha.

O que mudou no QS: o evento de reunião passou a levar o `meeting_id` (para o
n8n gravar o resultado de volta na reunião certa) e, quando a sala do Meet é
criada, **um segundo aviso sai com o link**. Isso é necessário porque a reunião
é gravada antes de a sala existir — sem o segundo aviso, o card ficaria com o
campo do link vazio para sempre.

---

## Teste de aceite

1. No QS, agende uma reunião de teste com um lead que **tenha `bitrix_id`**
   (lead que veio do Bitrix; lead cadastrado à mão não sincroniza — é por design)
2. No Bitrix, abra o negócio e confira:
   - os campos preenchidos
   - o comentário na timeline com o link do Meet
   - a etapa (só se você preencheu `STAGE_REUNIAO`)
3. No Supabase:

```sql
select scheduled_at, bitrix_synced, bitrix_error
  from qs_meetings order by created_at desc limit 5;
```

`bitrix_synced = true` e `bitrix_error = null` é o resultado bom. Se
`bitrix_error` trouxer "gravado, mas sem: ...", o resto foi, e a mensagem diz
exatamente qual apelido faltou.

---

## Se der errado

| O que aparece | Onde olhar |
|---|---|
| `403` no n8n | O header não bate. Compare com os webhooks que já funcionam (passo 3) |
| `404` no n8n | Workflow inativo, ou o antigo `qs-reuniao` ainda ocupando o caminho |
| Erro "alias não cadastrado" | Faltou o `update` do passo 5 |
| Nome não bate com nenhuma opção | O rótulo no Bitrix está diferente do nome no QS — ajuste um dos dois |
| Reunião 3h adiantada no card | Não deveria acontecer: o workflow já converte para `-03:00`. Se acontecer, me mande o valor gravado |
| Nada chega, sem erro | O lead não tem `bitrix_id` — confira em `qs_leads` |

---

## Depois disto

- **Ganho** (`qs-ganho`) segue desligado. Mesmo desenho, mas antes vale ligar a
  captura do valor fechado: hoje só 1 de 116 leads ganhos tem valor.
- **Reconciliação** (reprocessar o que falhou) fica para depois de vermos isto
  rodando. Com o `bitrix_error` gravado na reunião, já dá para ver o que falhou
  sem automação nenhuma.
