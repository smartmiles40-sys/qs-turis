# Contrato: laudos médicos (`cad_laudos_medicos`)

30/10/2026 · migration `supabase/migrations/0225_saude_laudos_medicos.sql` (**não aplicada**). Quem escreve: tela
**Saúde · médico** (`#ops/saude`, `src/expedicoes/paginas/Saude.tsx`). Quem lê também: a **ficha do cliente**
(outro agente), pela coluna `cliente_id`.

## Tabela `public.cad_laudos_medicos`: 1 linha por passageiro (viagem)

| coluna | tipo | o que é |
|---|---|---|
| `id` | uuid | chave |
| `cliente_id` | uuid → `rel_clientes.id` | **a ficha do cliente**. Vem de `passageiros.cliente_id` quando o laudo é salvo. Pode ser null se o passageiro ainda não está ligado a uma ficha (hoje são 2 dos 350 das viagens futuras) |
| `passageiro_id` | uuid → `passageiros.id` | a participação na viagem. **Único**: no máximo 1 laudo por passageiro |
| `expedicao_id` | uuid → `expedicoes.id` | a viagem (expedição ou pacote) |
| `status` | text | `a_fazer` · `em_andamento` · `emitido` · `dispensado` |
| `apto` | text, null | `sim` · `nao` · `ressalvas`. É obrigatório pra emitir |
| `ressalvas` | text, null | obrigatório quando `apto = 'ressalvas'` |
| `parecer` | text, null | parecer e curadoria do médico (texto livre) |
| `arquivo_path` | text, null | caminho do PDF no bucket **privado** `laudos-medicos` (`<cliente_id ou pax-<id>>/<passageiro_id>/<uuid>-<nome>.pdf`) |
| `arquivo_nome`, `arquivo_mime`, `arquivo_bytes` | | metadados do PDF |
| `emitido_em`, `emitido_por`, `emitido_por_nome` | | carimbo de quando o status virou `emitido`. Sai se o status voltar |
| `criado_em/por`, `atualizado_em/por` | | auditoria |

## Tabela `public.cad_laudo_notas`: acompanhamento (só acrescenta)

`id`, `laudo_id` (→ laudo, cascade), `texto`, `autor_id`, `autor_nome`, `criado_em`.

## Como a ficha do cliente lê

```ts
// laudos do cliente, mais recente primeiro
const { data } = await supabase.from("cad_laudos_medicos")
  .select("id,status,apto,ressalvas,parecer,arquivo_path,arquivo_nome,emitido_em,emitido_por_nome,expedicao_id,atualizado_em")
  .eq("cliente_id", clienteId).order("atualizado_em", { ascending: false });
// nome da viagem: expedicoes(id,nome,data_embarque) por expedicao_id
// abrir o PDF (5 min):
const { data: u } = await supabase.storage.from("laudos-medicos").createSignedUrl(arquivo_path, 300);
// anotações:
await supabase.from("cad_laudo_notas").select("texto,autor_nome,criado_em").eq("laudo_id", id).order("criado_em", { ascending: false });
```

- **Mostrar como "laudo válido" só `status = 'emitido'`.** Os outros são trabalho em curso do médico.
- Selo sugerido: `apto` sim = verde "Apto", ressalvas = âmbar "Apto com ressalvas" (+ texto), nao = vermelho "Não apto".
- Sem a 0225 a tabela não existe: o `select` dá erro. A ficha deve **esconder o bloco** nesse caso, sem mostrar erro.
- RLS: o `select` só devolve linhas para quem passa em `exp_pode_ver_saude()`. Para quem não passa, volta **vazio** (não é
  erro). A ficha não precisa checar permissão: lista vazia = esconde.

## Escrita: só pelas funções (não há policy de insert/update/delete)

| função | faz |
|---|---|
| `cad_laudo_salvar(p_passageiro, p_status, p_apto, p_ressalvas, p_parecer, p_arquivo jsonb)` | cria ou atualiza o laudo do passageiro. `null` = não mexe no campo. `p_apto = ''` limpa. `p_arquivo = {"path","nome","mime","bytes"}` (PDF já subido) |
| `cad_laudo_nota(p_laudo, p_texto)` | acrescenta anotação com autor e data |
| `cad_laudo_apagar_arquivo(p_laudo)` | tira o PDF do laudo e devolve o caminho (o front apaga do bucket) |

A ficha **só lê**. Se um dia quiser editar, que chame as mesmas funções.

## Quem vê: `exp_pode_ver_saude()`

`ops_tem_acesso()` (Operações e admin) **ou** `rel_pode_configurar()` (gestão do Relacionamento) **ou** `exp_eh_medico()` (papel
`medico` em `qs_users.papeis`) **ou** admin do app antigo (`usuarios.papel = 'admin'`). Vale para as duas tabelas e para o
bucket `laudos-medicos`.

## Pontos em aberto (decisão do Bruno)

1. **Quem é o médico no sistema.** Hoje não existe usuário médico. Pra ele entrar: criar o login, uma linha em `qs_users`
   com `setores = {operacional}` (é a porta de Operações que tem o menu "Saúde · médico") e `papeis = {medico}`
   (`qs_sol_definir_papeis`, pela gestão de Ops). Efeito colateral: com o setor operacional ele também **edita** as
   Expedições. Se não quiser isso, falta uma porta própria (ou um modo só-saúde) para o médico.
2. **`passageiros.saude` continua legível por quem tem `exp_tem_acesso()`**, o que inclui o **Financeiro** e o
   Relacionamento inteiro (policy da 0160). Fechar isso é LGPD, mas quebra telas de outros setores que leem `passageiros` com
   `select *`. Precisa de uma decisão e de uma migration própria (view sem a coluna, ou mover `saude` para outra tabela).
3. Laudo é por **viagem** (passageiro). Se o médico quiser 1 laudo que vale para várias viagens, dá pra copiar o PDF ou criar
   uma linha só com `cliente_id` (a constraint aceita), mas a tela ainda não faz isso.
