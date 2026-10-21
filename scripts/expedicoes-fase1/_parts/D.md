# Parte D — Telas internas GLOBAIS (fora do escopo de uma expedição)

Repo analisado: `/tmp/sx` (Next.js 16 App Router + Supabase). Tudo abaixo é leitura, nada foi alterado.
Convenção: `arquivo:linha`. "SR" = service role (`createServiceRoleClient`, ignora RLS). "Sessão" = `getServerClient()` (JWT do usuário, RLS ativa).

Telas cobertas: `/passageiros`, `/clientes`, `/fornecedores`, `/inscricoes`, `/acessos-expedamigo`, `/avisos`, `/configuracoes`, `/cambios` (excluída, só mapeamento de dependências). Mais: dev/mock mode, inventário de service role, site gate, regras de negócio dos docs.

---

## 0. Contexto transversal (vale para todas as telas)

### 0.1 Layout `app/(app)/layout.tsx` (46 linhas)
- `getCurrentUser()` (`lib/supabase/auth.ts:18`): sem usuário vai para `/login`; `usuarios.senha_provisoria = true` vai para `/primeiro-acesso`.
- **1º login cria a linha em `usuarios`** com `papel='leitura'`, `senha_provisoria=true` (`lib/supabase/auth.ts:42-53`), INSERT com a sessão do próprio usuário (depende de `auth_all_insert` em `usuarios`). No SPA isso precisa virar trigger `on auth.users insert` ou RPC.
- Carrega em TODA página: `listExpedicoesComAgregados()`, `listFornecedores()`, `passageiros select * limit 200` (para a CommandPalette), `getContagemAlertas()` (badge Avisos), `contarInscricoesPendentes()` (badge Inscrições, `count exact head` em `inscricoes_pendentes` com `status='pendente'`).
- Sidebar (`components/layout/Sidebar.tsx:23-35`), ordem: Início `/dashboard`, Avisos, Passageiros, Clientes & compras, Inscrições, Expedições, Pacotes, Fornecedores, Câmbios, Acessos ExpedAmigo, Configurações. Nenhum item tem gate por papel (todas as telas aparecem para todos os papéis).

### 0.2 Permissões (`lib/auth/permissoes.ts`, 53 linhas)
- `ehSomenteLeitura(papel)` = `relacionamento` ou `leitura`.
- `podeEditar(papel)` = papel definido e não somente-leitura (admin, operacional, comercial, financeiro).
- `podeDecidirInscricao(papel)` = `podeEditar` OU `relacionamento`.
- No cliente: `useSomenteLeitura()` / `usePodeDecidirInscricao()` (`components/layout/PermissoesContext.tsx`) escondem botões.
- RLS 0046 (`db/migrations/0046_rls_read_only.sql`): função `is_readonly()` (security definer, **fail-open** se não achar linha) + policies RESTRICTIVE de insert/update/delete para 25 tabelas (inclui `passageiros`, `fornecedores`, `cambios`, `inscricoes_pendentes`, `passageiro_requisitos`, `arquivos`). **`usuarios` NÃO está na lista.** SELECT liberado para todo autenticado.
- Base RLS (0001:347-372): `auth_all_select/insert/update/delete` permissivas (`using (true)`) em `usuarios, fornecedores, cambios, expedicoes, quartos, passageiros, custos, pagamentos, checklist_itens, documentos, audit_log`.
- ⚠️ **Risco crítico p/ SPA:** como `usuarios` tem `auth_all_update using(true)` e não está na trava 0046, qualquer autenticado pode fazer `update usuarios set papel='admin' where id=auth.uid()` direto via PostgREST. No Next isso fica escondido atrás de server actions; no SPA com supabase-js fica exposto. É obrigatório criar policy restrita (só o próprio usuário altera `nome/avatar_url/senha_provisoria`; `papel` só via função/Edge admin).

### 0.3 Audit log
- Trigger `audit_change()` (0001:296-334, security definer) em `expedicoes, passageiros, custos, pagamentos` grava `audit_log(tabela, registro_id, usuario_id=auth.uid(), acao, dados_antes, dados_depois)`. Escrita com SR grava `usuario_id = null`. Nenhuma tela desta parte lê `audit_log`. Fornecedores/inscrições não têm trigger de audit (o log de inscrições é a tabela própria `inscricoes_decisoes`).

### 0.4 Realtime
- Hook `lib/hooks/useRealtimeRefresh.ts`: `postgres_changes` → debounce 300 ms → `router.refresh()`. Desligado em mock.
- Nesta parte só **Fornecedores** (`table: fornecedores`) e **Câmbios** (`table: cambios`) assinam. Passageiros, Clientes, Inscrições, Acessos, Avisos, Configurações **não** têm realtime (Passageiros/Avisos usam `dynamic = "force-dynamic"`).
- Publication (0006): `expedicoes, passageiros, quartos, custos, pagamentos, checklist_itens, fornecedores, cambios, documentos, arquivos, usuarios, grupos_expedicao` (+ links_expedicao 0008, tabelas de prontidão 0012/0013). `inscricoes_pendentes` e `expedamigo_acessos` NÃO estão na publication.

### 0.5 Arquivos (storage) usados pelas telas globais
- Bucket privado `arquivos-expedicoes`. Não há policy de `storage.objects` no repo: hoje só SR acessa.
- Toda imagem/arquivo nestas telas usa `/api/arquivos/<id>/download?inline=1` (`app/api/arquivos/[id]/download/route.ts`): checa login, lê `arquivos.storage_path` com SR, `createSignedUrl(path, 300, inline ? {} : {download: nome})` e responde 302. No SPA: storage policy para `authenticated` + `createSignedUrl` no cliente, ou Edge Function.
- Upload: `POST /api/arquivos/upload` (form-data `file, expedicao_id (obrigatório), passageiro_id?, categoria, descricao`), exige `podeEditar` (403 para somente-leitura), máx `MAX_UPLOAD_BYTES = 15 MB` (`lib/constants.ts:248`), MIME em `MIME_ARQUIVO_PERMITIDOS` (pdf, jpeg, png, webp, gif, Office…), SR para o storage + insert em `arquivos`.

---

## 1. `/passageiros`: base consolidada de pessoas ("Clube de viajantes")

Arquivos: `app/(app)/passageiros/page.tsx` (31), `PassageirosGlobalTabela.tsx` (1042), `ViajanteCard.tsx` (91), `SenhaExpedamigoPessoa.tsx` (69), `lib/data/pessoas.ts` (175), `lib/fidelidade.ts` (76), actions em `app/(app)/expedicoes/actions.ts` (3001), `app/(app)/expedicoes/[id]/passageiros/expedamigo-actions.ts` (171), `ImportarPassageirosDrawer.tsx` (254), `lib/csv/passageiros-import.ts` (274).

### 1.1 Carga de dados (`page.tsx:10-16`, `force-dynamic`)
Em paralelo:
1. `listPessoas()` (`lib/data/pessoas.ts:356`): `passageiros select *` + `expedicoes select *` (sessão), **sem paginação** (⚠️ PostgREST corta em 1000 linhas, em silêncio; outras funções do repo já usam `fetchAllRows` por esse motivo). Depois agrega no servidor.
2. `listExpedicoesComAgregados()`: só usa `{codigo, nome}` para o import CSV global.
3. `listArquivosDePassageiros()` (`lib/data/arquivos.ts:20`): `arquivos select * where passageiro_id is not null order created_at desc`, também sem paginação.
4. `getCurrentUser()`: `isAdmin = papel === 'admin'`.

**Não existe tabela `pessoas`.** Uma pessoa é uma agregação de linhas `passageiros` (uma por expedição + eventuais avulsas com `expedicao_id null`).

### 1.2 Agregação (`lib/data/pessoas.ts`)
- `chaveIdentidade(p)` (`:252`), ordem de precedência:
  1. `cpf:<só dígitos>` se tiver ≥ 11 dígitos;
  2. `bx:<bitrix_contact_id>`;
  3. `email:<trim lower>`;
  4. `nome:<trim lower>`.
- Ordena por `created_at asc`. A 1ª linha cria a pessoa; as seguintes sobrescrevem cada campo com o **mais recente não-nulo** (`maisRecente = novo ?? atual`). `nome_completo` usa `p.nome_completo || atual`.
- Campos de `PessoaAgregada` (`:223-249`): `chave, nome_completo, cpf, passaporte, validade_passaporte, passaporte_arquivo_id, data_nascimento, email, telefone, contato_emergencia_nome, contato_emergencia_fone, restricoes_alimentares, condicoes_medicas, saude (jsonb), perfil_viajante (jsonb, o mais recente), foto_arquivo_id, idsPassageiros[], expedicaoIdAncora, passageiroIdAncora, totalExpedicoes, expedicoes[]`.
- `expedicoes[]`: `{expedicao_id, passageiro_id, nome, destino, data_embarque, status_reserva, tipo}`, ordenadas por `data_embarque desc`.
- `totalExpedicoes` = quantidade de itens com `status_reserva !== 'Cancelado'`. Linhas avulsas não entram em `expedicoes[]`.
- Âncora = `expedicoes[0]` (embarque mais recente). Novos documentos são anexados nessa linha.
- Lista final ordenada por `nome_completo` com `localeCompare(..., 'pt-BR')`.

### 1.3 UI: cabeçalho, contadores, visões
- Busca global (`:99-110`): substring case-insensitive em `nome_completo + cpf + email + passaporte`. Placeholder "Buscar por nome, CPF, e-mail…". O link "Limpar filtros" aparece quando há busca ou algum filtro de coluna.
- Texto de resumo: `N pessoa(s) · M participação(ões) em expedições` (M = soma de `totalExpedicoes`).
- StatPills (`:292-299`, só quando há pessoas): `pessoas na base` (total), `já viajaram` (`totalExpedicoes > 0`), `participações` (soma), `sem CPF` (`!cpf`). Os contadores ignoram filtros.
- Alternância de visão `clube` (padrão, cards) e `lista` (tabela). Fica só em state, não persiste.
- Colunas (`COLUNAS`, `:66-75`), cada uma com ordenação e filtro de texto no estilo "AutoFiltro do Excel":
  | key | label | tipo | sortVal | texto do filtro |
  |---|---|---|---|---|
  | nome | Nome | text | nome_completo | nome_completo |
  | cpf | CPF | text | cpf | cpf |
  | idade | Idade | num | idade ou -1 | idade |
  | passaporte | Passaporte | text | | |
  | validade | Validade | text | ISO | dd/mm/aaaa (formatDate) |
  | email | E-mail | text | | |
  | telefone | Telefone | text | | |
  | expedicoes | Expedições | num | totalExpedicoes | |
- Idade (`:46-51`): `floor(-daysUntil(nascimento)/365.25)`.
- Pipeline: busca global → filtros por coluna (combinam com AND, substring) → ordenação. Padrão `nome asc`. Texto usa `localeCompare pt-BR sensitivity base`; número usa subtração.
- `ColunaFiltro` (`:624-674`): popover com botões "A → Z / Z → A" (num: "Menor → maior / Maior → menor"), input "Filtrar <label>…" e "Limpar filtro". Na visão clube os mesmos popovers aparecem numa barra "Filtrar / ordenar:".
- Card `ViajanteCard`: avatar (foto via `/api/arquivos/<foto_arquivo_id>/download?inline=1`), nome, tier, número de viagens, barra de progresso até o próximo marco ("Próximo marco: Nª viagem / faltam X"), selos ★ 3ª/5ª/10ª. Com ≥ 10 viagens mostra "Lenda — 10+ viagens com a gente 🏆". Rodapé com CPF e telefone. Clique abre o drawer.
- Fidelidade (`lib/fidelidade.ts:31-42`), verbatim: `MARCOS_FIDELIDADE = [3, 5, 10]`; tier: `n >= 10 ? "Lenda" : n >= 5 ? "Aventureiro" : n >= 3 ? "Explorador" : n >= 1 ? "Viajante" : "Estreante"`; `progresso = (n - anterior)/(proximo - anterior)`.
- Tabela: linha clicável abre o drawer de perfil. Coluna Expedições: botão com badge (desabilitado se 0) que abre `ExpedicoesDePessoaDrawer`.
- Estados vazios: base vazia → EmptyState "Seu clube de viajantes começa aqui" (clube) / "Sua base de pessoas começa aqui" (lista), com ação "Novo passageiro" se não for somente-leitura. Filtro sem resultado → "Nenhum resultado para a busca."
- Botões do topo: "Novo passageiro" e "Importar CSV" (escondidos se somente-leitura); "Exportar" sempre visível (desabilitado se base vazia).

### 1.4 Ações

**A) Novo passageiro (avulso)**: `NovoPassageiroDrawer` (`:454-571`) chama `criarPassageiroAvulso` (`expedicoes/actions.ts:751-856`).
- Zod do cliente: `nome_completo min(2) "Mínimo 2 caracteres"`, `email email() ou ""`, demais campos opcionais (cpf, data_nascimento, passaporte, validade_passaporte, telefone).
- Zod do servidor: `nome_completo min(2, "Nome completo obrigatório")`, `email email() | "" | null`, `observacoes` opcional.
- Se veio CPF: `cpfValido()` (senão "CPF inválido"). Dedup global por dígitos do CPF lendo **todas** as linhas com cpf (paginado via `fetchAllRows`). Se já existir: "Já existe um passageiro com este CPF no sistema."
- INSERT `passageiros` (sessão): `{expedicao_id: null, nome_completo, tipo:'Pagante', status_reserva:'Lead', cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, observacoes}`.
- Índices únicos (0015): `ux_passageiros_expedicao_cpf (expedicao_id, digits(cpf))` e `ux_passageiros_avulso_cpf (digits(cpf)) where expedicao_id is null`.
- Efeitos: `revalidatePath('/passageiros')`; toast "Passageiro cadastrado na base — Sem expedição — aloque a uma quando quiser."; `router.refresh()`. O audit trigger dispara.

**B) Editar perfil**: `PessoaDrawer` (`:676-1007`), abas Passageiro / Saúde / Expedições.
- Formulário (zod `perfilSchema` `:676-689`): nome min 2, email válido ou "", demais strings opcionais, `saude: record<string,string>`.
- Salvar (habilitado só com `isDirty`) chama `atualizarDadosPessoais(refId = idsPassageiros[0], dados)` (`actions.ts:468`). Strings vazias viram `null`; chaves vazias de `saude` são removidas.
- Servidor: `dadosPessoaisSchema` (`:449-462`) → `propagarDadosPessoais(refId, dados)` (`:348-384`):
  - filtra o patch por `CAMPOS_PESSOAIS` (`:305-336`), verbatim: `nome_completo, cpf, passaporte, validade_passaporte, passaporte_arquivo_id, foto_arquivo_id, data_nascimento, email, telefone, contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo, restricoes_alimentares, condicoes_medicas, saude, endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, ja_viajou_internacional, paises_visitados`. `perfil_viajante` NÃO propaga (fica por reserva).
  - lê TODAS as linhas de `passageiros` (paginado), acha os "irmãos" pela mesma `chaveIdentidade` e faz `UPDATE passageiros SET <patch> WHERE id IN (irmãos)` com a sessão.
  - ⚠️ `saude` é **substituída** (não mesclada) em todas as linhas.
  - ⚠️ Mudar o CPF muda a chave. A propagação usa a chave da linha de referência ANTES do update, então todas as linhas da pessoa recebem o novo CPF.
- Efeitos: `revalidarPessoa` (`:386-396`) em `/expedicoes/<id>/passageiros`, `/expedicoes/<id>`, `/passageiros`, `/avisos`. Toast "Dados atualizados em N expedições" (se `totalExpedicoes > 1`) ou "Dados atualizados".
- Sem `refId` (não acontece na prática): "Pessoa sem vínculo de expedição".

**C) Documentos** (aba Passageiro): só quando existe âncora.
- `PassaporteAnexo` (componente compartilhado `components/arquivos/PassaporteAnexo`): sobe via `/api/arquivos/upload` e chama `atualizarAnexoPassaporte(passageiroId, arquivoId)` (`actions.ts:401`), que propaga `passaporte_arquivo_id` para todas as linhas da pessoa.
- `Drive` com `CATEGORIA_ARQUIVO` exceto "Documentos pessoais" (o passaporte tem item próprio). Lista os arquivos de todas as linhas da pessoa (`arquivos.passageiro_id ∈ idsPassageiros`).
- Sem âncora: "Vincule a pessoa a uma expedição para anexar documentos."

**D) Perfil & conexões** (somente leitura, `:885-911`): foto + `perfil_viajante.{profissao, descricao_grupo, anima_expedicao, significado, instagram, camiseta, musica}`. O bloco some se tudo estiver vazio.

**E) Senha ExpedAmigo** (só admin, `SenhaExpedamigoPessoa.tsx`): ver §5.4.
- No mount chama `estadoSenhaCpf(cpf)` (SR em `acesso_senhas`).
- Estados: `temHash` → "O viajante já criou a própria senha" + botão "Resetar senha". `senha_provisoria` → mostra "Login: <CPF mascarado> / Senha: <prov>" + "Copiar login e senha" + "Nova". Nenhum dos dois → "Libere o ExpedAmigo na página do passageiro (dentro da expedição) para gerar a senha."
- `gerarNovaSenhaCpf(cpf)` (`expedamigo-actions.ts:126`): exige admin e CPF com 11 dígitos. Faz `upsert acesso_senhas {cpf, senha_provisoria: gerarSenhaAleatoria(), senha_hash: null} onConflict cpf` e `revalidatePath('/passageiros')`.
- Texto copiado (`ExpedamigoPainel.tsx:15`): `Login: <000.000.000-00>\nSenha: <senha>`.

**F) Aba Saúde**: `SaudeCampos` (componente da expedição) recebe `expedicaoId/passageiroId` da âncora. É salvo junto do formulário (campo `saude`).

**G) Aba Expedições / drawer de expedições**: links para `/expedicoes/<id>/passageiros`, com badge de status (`Confirmado→vinculado, Pré-reserva→atencao, Lead→auto, Cancelado→critico`). Mostra o tipo quando ≠ Pagante.

**H) Excluir passageiro**: `ConfirmDeleteButton` chama `excluirPessoa(refId)` (`actions.ts:1763-1815`).
- Lê todas as linhas (paginado) e acha os irmãos pela chave.
- `DELETE passageiro_requisitos WHERE passageiro_id IN ids` e depois `DELETE passageiros WHERE id IN ids` (sessão).
- Arquivos continuam no storage. Outras FKs (quarto, acesso_links on delete cascade) dependem das constraints do banco.
- Texto de confirmação: com expedições, "Esta pessoa está em N expedição(ões). Excluir remove TODOS os registros dela do sistema, inclusive dessas expedições. Esta…"; senão, "Remove o passageiro da base operacional. Esta ação não pode ser desfeita."
- revalidate `/passageiros`, cada expedição afetada e `/avisos`.

**I) Importar CSV (modo global)**: `ImportarPassageirosDrawer modo="global"` chama `importarPassageirosGlobal` (`actions.ts:2878-3001`).
- Parser no cliente `parsePassageirosCSV(texto, {exigirObrigatorios:false, statusPadrao:"Confirmado"})`. Delimitador `;` ou `,` (o que mais aparecer na 1ª linha), remove BOM, respeita aspas, datas ISO ou dd/mm/aaaa, números no formato BR.
- Aliases de cabeçalho (`lib/csv/passageiros-import.ts:70-84`), comparados sem acento e em minúsculas:
  - nome_completo: nome completo, nome, passageiro, nome do passageiro
  - data_nascimento: data de nascimento, data nascimento, nascimento, dt nascimento, nasc
  - cpf: cpf
  - passaporte: passaporte, passport, numero passaporte, num passaporte, n passaporte
  - validade_passaporte: validade passaporte, validade do passaporte, validade, vencimento passaporte, passaporte validade
  - email: email, e mail
  - telefone: telefone, celular, whatsapp, fone, tel, contato
  - tipo: tipo, tipo passageiro
  - status_reserva: status reserva, status, situacao, reserva
  - observacoes: observacoes, obs, observacao, notas
  - valor_contratado_brl: valor contratado, contratado, valor total, total, valor
  - valor_pago_brl: valor pago, pago, entrada, valor pago brl
  - expedicao_codigo: expedicao codigo, expedicao, expedicao cod, cod expedicao, codigo expedicao, codigo da expedicao, codigo
- Modelo baixável `modelo-passageiros-global.csv` (BOM + `;`): `expedicao_codigo;nome_completo;data_nascimento;cpf;passaporte;validade_passaporte;email;telefone;tipo;status_reserva;valor_contratado;valor_pago`, com exemplos `PERU-AGO2026` e `PATAG-NOV2026`.
- Pré-visualização classifica cada linha: erro (erros do parser / "código da expedição ausente" / `expedição "X" não encontrada`) > duplicado (CPF já visto no lote para a mesma expedição; no modo global a chave é `codigo|cpf`) > ok. Só as linhas ok são enviadas.
- Servidor: `globalRowSchema = importRowSchema + expedicao_codigo min(1)`, lote `min(1) max(2000)`. `importRowSchema`: `nome_completo min(2)`, `tipo ∈ TIPO_PASSAGEIRO`, `status_reserva ∈ STATUS_RESERVA`, cpf livre (aceita inválido), valores `nonnegative`.
  - Resolve `expedicoes.codigo → id`. Linha sem expedição conta em `semExpedicao`.
  - Dedup por expedição usando os CPFs existentes (`passageiros select expedicao_id,cpf where expedicao_id in (...)`, sem paginação) + os do próprio lote. Duplicado conta em `ignorados`.
  - INSERT em lote único em `passageiros` (sessão) com `expedicao_id, nome_completo, tipo, status_reserva, cpf, passaporte, data_nascimento, validade_passaporte, email, telefone, observacoes, valor_contratado_brl, valor_pago_brl, status_financeiro`. `statusFinanceiroDe` (`:2717`): não-Pagante com contratado 0 → "Cortesia"; contratado > 0 e pago ≥ contratado → "Quitado"; senão "Em aberto". (Colunas financeiras são "dormentes".)
  - Depois, para cada expedição com inserção: `gerarRequisitosPadrao(expId)` (insere `passageiro_requisitos` a partir do template TS `construirRequisitosPadrao`, idempotente por passageiro, e roda `espalharCertificadoVacina`).
  - revalidate `/passageiros`, `/dashboard`. Toast "N passageiro(s) importado(s) · X ignorado(s) · Y sem expedição".
  - ⚠️ O import global NÃO deduplica contra a base avulsa nem entre expedições (por design). Se o índice único estourar, o insert inteiro falha.

**J) Exportar (.xlsx), 100% no cliente** (`:131-220`): `await import("exceljs")`. Exporta a lista **filtrada/ordenada** (`ordenadas`).
- Workbook `creator "Sistema de Expedições"`, aba "Passageiros". Colunas (header / key / largura):
  Nome completo/nome/30 · CPF/cpf/16 · Nascimento/nasc/12 · Idade/idade/7 · Passaporte/passaporte/14 · Validade passaporte/validade/16 · E-mail/email/28 · Telefone/telefone/16 · Contato emergência/emnome/22 · Fone emergência/emfone/16 · Restrições alimentares/rest/24 · Condições médicas/med/24 · Nº expedições/qtd/12 · Já participou/passadas/44 · Vai participar/futuras/44.
- Header em negrito branco com fundo `FF09282B`. Linha 1 congelada. `wrapText` em passadas, futuras, rest e med.
- Passadas/futuras: só não canceladas, separadas por `data_embarque < hoje` (ISO). Formato de cada item: `"<nome> — <dd/mm/aaaa | sem data> (<status>)"`, um por linha (`\n`).
- Arquivo `passageiros-YYYY-MM-DD.xlsx`. Toast "N passageiro(s) exportado(s) (.xlsx)". Nada vazio → "Nada para exportar".
- **Confirmado: `/passageiros` NÃO usa @react-pdf.** `@react-pdf/renderer` só aparece em `app/amigo/ViagemPDF.tsx` (portal público). `exceljs` aparece em 3 lugares: aqui (cliente), `RoomingBoard.tsx:552` (cliente, escopo de expedição) e `app/api/clientes/export/route.ts` (servidor).

### 1.5 Somente leitura
`useSomenteLeitura()` esconde Novo, Importar, Excluir e Salvar. A RLS 0046 bloqueia na base.

### 1.6 Notas para o SPA
- Agregação: replicar `chaveIdentidade` + `agregar` no cliente com paginação real (ou criar uma VIEW/RPC `pessoas_agregadas`).
- `propagarDadosPessoais` precisa virar RPC Postgres (`security invoker`, para respeitar RLS) que recebe `ref_id` e o patch, calcula a identidade em SQL (`regexp_replace(cpf,'\D','','g')` / `bitrix_contact_id` / `lower(email)` / `lower(nome)`) e atualiza todos os irmãos numa transação. Hoje são duas idas e a lista completa é carregada.
- `excluirPessoa` deve virar RPC transacional pelo mesmo motivo.
- `estadoSenhaCpf` / `gerarNovaSenhaCpf` usam SR em `acesso_senhas` (tabela sem policy): precisam de Edge Function ou RPC `security definer` com checagem `papel = 'admin'`.

---

## 2. `/clientes`: Clientes & compras (base Bitrix)

Arquivos: `app/(app)/clientes/page.tsx` (13), `ClientesTabela.tsx` (310), `lib/data/compras.ts` (162), `app/api/clientes/export/route.ts` (162). Tabela `compras_bitrix` (0048 + coluna `produto` em 0056).

### 2.1 Dados
- `compras_bitrix`: `id uuid, bitrix_deal_id text unique not null, bitrix_contact_id, cpf (só dígitos), nome_contato, titulo, produto, data_compra date, valor numeric, moeda default 'BRL', funil, etapa, created_at, updated_at`. RLS: SELECT para authenticated. Escrita só SR (n8n → `POST /api/bitrix/importar-compras`, fora do escopo).
- `listClientesCompras()` (`compras.ts:112`) lê com **SR** (desnecessário, a RLS já libera a leitura), paginado de 1000 em 1000 por `data_compra desc`. Mock → `[]`.
- `limparComprasBitrix` (`:69-92`):
  1. descarta `valor` nulo ou 0;
  2. deduplica por número do negócio `/#\s*(\d+)/` no `titulo`. No grupo, fica a linha canônica (`bitrix_deal_id === número`); se não houver, a de maior valor e, em empate, a mais recente. Linhas sem "#" ficam como estão.
- Identidade (`:49-53`): `cpf:<cpf>` → `bx:<contact>` → `nome:<nome normalizado sem acento/lower>`. ⚠️ Diferente de `/passageiros`: aqui o CPF é comparado cru, sem extrair dígitos.
- Agregado `ClienteCompras`: `totalCompras, totalGasto (soma de valor, moedas misturadas), ticketMedio = total/qtde, moedas[], funis[], primeiraCompra, ultimaCompra, compras[] (data desc)`. Lista ordenada por `totalGasto desc, totalCompras desc`.
- `nomeCompra(c)` = `produto?.trim() || titulo?.trim() || "Negócio sem título"`.
- `comprasDaPessoa(cpf, contactId)` (`:151`) existe para o perfil global, mas **não é usada** em nenhuma tela desta parte.

### 2.2 UI
- Título "Clientes & compras", subtítulo "Quem já comprou (Bitrix)…". Busca em `nome + cpf + nomeCompra de cada compra`. Placeholder "Buscar por nome, CPF ou viagem…".
- Filtro de recorrência (`:52-58`), verbatim: `todos (min 0)`, `"1 compra" (min 1, max 1)`, `"Recorrentes (2+)" (min 2)`, `"Fiéis (5+)" (min 5)`, `"VIP (10+)" (min 10)`.
- Ordenação clicando no cabeçalho (`COLS`): Cliente (nome), Compras, Total gasto, Ticket médio, 1ª compra, Última compra. Padrão `total desc`. Trocar de coluna começa em desc para números e asc para nome.
- Colunas: `#` (posição), Cliente (avatar, nome, badge "VIP" se ≥ 10 compras, CPF abaixo), Compras, Total gasto (asterisco `*` se houver moeda ≠ BRL), Ticket médio, 1ª compra, Última compra.
- StatPills (calculados sobre a lista filtrada): `clientes` / `no filtro`, `compras`, `faturado (soma)` (BRL).
- Nota de rodapé "* Cliente tem compras em outra moeda; o total soma os valores como estão."
- Vazio: "Nenhuma compra importada ainda — Assim que o n8n enviar as vendas do Bitrix pra cá…". Filtro sem resultado: "Nenhum cliente com esses filtros."
- Drawer do cliente: CPF ou "sem CPF", resumo (Total gasto, Ticket médio, 1ª compra, Última), badges de funis, "Histórico de viagens (N)" com nomeCompra, data, funil e valor.
- Sem ações de escrita. Sem realtime.

### 2.3 Exportar Excel: `GET /api/clientes/export` (link `<a href>`)
- Exige usuário logado (401). Usa **SR** para ler `expedicoes (id,nome)` e `passageiros (cpf,email,telefone,expedicao_id,status_reserva)` paginados.
- Enriquecimento por CPF (11 dígitos): primeiro e-mail/telefone não nulos + nomes das expedições não canceladas.
- Workbook `creator "Se Tu For, Eu Vou"`. Header branco negrito tamanho 11, fundo `FF1F4E79`, altura 20, linha 1 congelada.
- **Aba "Clientes"** (autoFilter A1:K1, linhas pares com zebra `FFF2F2F2`):
  Nome (34) · CPF (16, máscara 000.000.000-00) · Telefone (18) · E-mail (30) · Nº de compras (14) · Total gasto (R$) (18, `#,##0.00`, arredondado a 2 casas) · Ticket médio (R$) (18, `#,##0.00`) · 1ª compra (13, dd/mm/aaaa) · Última compra (14) · Funis (34, separados por " | ") · Expedições no sistema (50, separadas por " | ").
- **Aba "Compras (detalhado)"** (autoFilter A1:J1): Nome (`nome_contato`) · CPF · Produto (expedição) (`nomeCompra`) · Data · Valor (`#,##0.00`) · Moeda · Funil · Etapa · Título (Bitrix) · Deal ID. Ordenada por nome normalizado asc e depois data desc.
- Arquivo `Clientes_e_Compras_YYYY-MM-DD.xlsx`, `Cache-Control: no-store`.
- SPA: dá para gerar com exceljs no cliente usando a sessão (RLS libera SELECT em `compras_bitrix`, `passageiros` e `expedicoes` para authenticated). Não precisa de SR.

---

## 3. `/fornecedores`

Arquivos: `page.tsx` (23), `FornecedoresTabela.tsx` (219), `FornecedorDrawer.tsx` (196), `actions.ts` (141), `lib/data/fornecedores.ts` (11).

### 3.1 Dados
- Tabela `fornecedores` (0001:85-102): `id, nome not null, tipo tipo_fornecedor not null, contato_nome, contato_email, contato_whatsapp, destino_cidade, servicos text[] (não usado na UI), moeda_padrao default 'BRL', politica_pagamento, status status_fornecedor default 'Ativo', observacoes, created_at, updated_at` (trigger updated_at).
- Enums: `tipo_fornecedor = DMC, Hotel, Guia, Aéreo, Receptivo, Seguro, Outros`; `status_fornecedor = Ativo, Pausado, Bloqueado`.
- `MOEDAS` (`lib/constants.ts:165`) = `["BRL","USD","EUR","PEN","GBP","JPY","ARS","CLP"]`.
- `listFornecedores()`: `select * order nome` (sessão). Também é carregado no layout para a CommandPalette.
- ⚠️ **Bug: a coluna "Histórico" usa mock em produção.** `page.tsx:9-14` conta `mockCustos` por `fornecedor_id`, então em produção mostra o número dos dados fictícios (ou 0). A intenção é contar `custos` por `fornecedor_id` ("N expedição(ões)", embora na prática conte custos). No SPA: `custos select fornecedor_id` agrupado, ou contar `distinct expedicao_id`.

### 3.2 UI
- Cabeçalho "Fornecedores" + `LiveBadge` do realtime. Texto "X de Y".
- Busca em `nome + contato_nome + destino_cidade` (placeholder "Buscar...").
- Chips de tipo: Todos + cada `TIPO_FORNECEDOR` (clicar no ativo desmarca).
- Colunas: Nome · Tipo (badge) · Cidade / Destino · Contato (nome + e-mail pequeno) · WhatsApp · Moeda (mono) · Status (badge `Ativo→vinculado, Pausado→atencao, Bloqueado→critico`) · Histórico ("N expedição(ões)") · ações (editar, excluir) só para quem edita.
- Sem ordenação na UI (vem por nome).
- Vazio: "Nenhum fornecedor ainda — Hotéis, DMCs, transportes e guias dos destinos…" com ação "Novo fornecedor". Filtro sem resultado: "Nenhum resultado."
- Realtime: `useRealtimeRefresh({subscriptions:[{table:'fornecedores'}]})`.

### 3.3 Ações (sessão; RLS 0046 bloqueia somente-leitura)
- Drawer (`FornecedorDrawer.tsx`). Zod do cliente: `nome min(2) "Nome obrigatório"`, `tipo enum` (7), `contato_email email() ou ""`, `moeda_padrao min(2)`, `status enum` (3), demais opcionais. Padrão ao criar: `tipo DMC, moeda BRL, status Ativo`. Campos: Nome, Tipo, Status, Cidade/Destino, Moeda padrão, Contato (Nome, E-mail, WhatsApp), Política de pagamento, Observações.
- `criarFornecedor` (`actions.ts:65`): zod do servidor igual + `moeda_padrao default BRL`, `status default Ativo`. `normalizar` faz trim e transforma vazio em null. INSERT. `revalidatePath('/fornecedores')`. Toast "Fornecedor criado".
- `atualizarFornecedor(id, partial)`: `schema.partial()`. Strings com trim; vazias viram null, exceto `nome, tipo, moeda_padrao, status`. UPDATE. Toast "Fornecedor atualizado".
- `excluirFornecedor(id)`: `count custos where fornecedor_id = id` (head). Se > 0 → erro "Fornecedor usado em N custo(s). Remova ou substitua antes.". Senão DELETE. A FK `custos.fornecedor_id` e `pagamentos.fornecedor_id` é `on delete set null` (o bloqueio é só da app). `expedicoes.dmc_principal_id` também é `set null`.
- Sem audit trigger nesta tabela.

---

## 4. `/inscricoes`: fila de aprovação das inscrições públicas

Arquivos: `page.tsx` (24), `InscricoesPendentes.tsx` (433), `DecisoesLog.tsx` (113), `decisoes.ts` (83), `actions.ts` (426), `lib/inscricao/core.ts` (479), `lib/inscricao/token.ts` (44), `lib/bitrix/outbound.ts`. Lado público (não reconstruir; só o contrato): `app/inscricao/actions.ts`.

### 4.1 Contrato de dados escrito pelo formulário público (`app/inscricao/actions.ts:enviarInscricao`, todo com SR)
Tabela `inscricoes_pendentes` (0037 + 0038 + 0041 + 0042):
| coluna | tipo | origem |
|---|---|---|
| id | uuid | |
| expedicao_id | uuid not null FK expedicoes on delete cascade | `d.expedicao_id` |
| cpf | text not null (11 dígitos) | `soDigitosCpf` |
| data_nascimento | date | `d.data_nascimento.slice(0,10)` |
| nome_completo | text | `d.nome_completo || null` |
| dados | jsonb not null | objeto completo validado por `dadosSchema` |
| passaporte_arquivo_id | uuid FK arquivos set null | upload de staging |
| foto_arquivo_id | uuid FK arquivos set null (0038) | upload de staging |
| origem | text default 'Formulário público' | |
| status | text not null default 'pendente', check in ('pendente','recusada') (0041) | sempre 'pendente' no (re)envio |
| recusada_em | timestamptz | null no envio |
| motivo_recusa | text (0042) | null no envio |
| recusa_arquivo_id | uuid FK arquivos (0042) | null no envio |
| created_at / updated_at | | trigger |
- `unique (expedicao_id, cpf)`: o reenvio faz upsert e **substitui** a pendência (inclusive revive uma recusada como pendente).
- RLS: SELECT e ALL para authenticated (`using true`), mais a trava 0046 para somente-leitura.
- Chaves do jsonb `dados` (`core.ts:104-142`): `expedicao_id, cpf, data_nascimento, nome_completo, email, telefone, passaporte, validade_passaporte, possui_passaporte (bool|null), endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo, pref_marcar_assento (bool|null), pref_upgrade_classe (string|null), ja_viajou_internacional (bool|null), paises_visitados, acompanhante_nome, acompanhante_divide_quarto (string|null), acompanhante_vinculo, acompanhante_dividir_com, saude (record<string,string>; pode conter vacina_febre_amarela_arquivo_id), profissao, instagram, camiseta, musica, descricao_grupo, anima_expedicao, significado, confirmou_veracidade (bool)`. Strings vêm "" quando vazias.
- Anexos de staging: arquivo em `arquivos-expedicoes/<expedicao_id>/inscricoes/<uuid>/<categoria>/<uuid>-<nome>` + linha em `arquivos` com `passageiro_id = null`. Categorias e descrições: passaporte "Documentos pessoais" / "Passaporte — prontidão"; foto "Outros" / "Foto do viajante"; certificado "Documentos pessoais" / "Certificado Internacional de Vacinação — Febre Amarela" (id guardado em `dados.saude.vacina_febre_amarela_arquivo_id`).
- Efeito colateral do envio, antes da aprovação (`salvarPerfilGlobalInscricao`, `core.ts:285-361`, best-effort): pessoa existente → preenche só os campos **vazios** de `CAMPOS_PESSOAIS_CARRY` em todas as linhas dela (saúde: o valor atual vence); `perfil_viajante` só na linha da expedição inscrita e só se estiver vazio. Pessoa nova → INSERT de `passageiros` **avulso** (`expedicao_id null, status_reserva 'Lead', pendente_aprovacao true, tipo 'Pagante', inscricao_origem 'Formulário público'`, + campos do form). Ou seja, **o formulário público já escreve em `passageiros`** antes da aprovação.
- Validações do lado público (para referência): CPF válido; nascimento divergente do conhecido → "Os dados não conferem com a nossa base…"; passaporte obrigatório se ainda não houver anexo e `possui_passaporte !== false`; arquivos ≤ 15 MB e MIME permitido; `essenciaisFaltando` (nome, e-mail válido, telefone, CEP, logradouro, número, cidade, estado, contato de emergência nome/telefone/vínculo); `confirmou_veracidade` obrigatório.
- `lib/inscricao/token.ts`: token HMAC-SHA256 `base64url(payload).assinatura`, payload `{c: cpf, x: expedicaoId, e: expiraMs}`, TTL 30 min. **Segredo = `SUPABASE_SERVICE_ROLE_KEY` || `N8N_SYNC_SECRET` || "expedamigo-token-dev"**. Usado pelo portal `/amigo` para abrir `/inscricao?t=` pulando o portão de nascimento. Não é usado pela fila interna.

### 4.2 Carga da tela (`page.tsx`)
- `listInscricoesPendentes()` e `listInscricoesRecusadas()` (`actions.ts:191-219`): sessão. `inscricoes_pendentes select * eq status` + `expedicoes select *` (sem filtro). `montar()` (`:134-188`) achata jsonb + colunas em `InscricaoPendente`. `status_reserva` exibido: "Recusada" ou "Aguardando aprovação". `restricoes_alimentares/condicoes_medicas` são sempre null (o form não envia mais). Ordenação: `(recusada_em ?? created_at) desc`.
- Admin também carrega `listDecisoesInscricao(300)` (SR; a RLS já permitiria leitura para authenticated).

### 4.3 UI
- Cabeçalho "Inscrições pendentes" + badge com a contagem. Vazio: "Nenhuma inscrição pendente no momento."
- Grade de 2 colunas de `CardInscricao`: nome, `CPF · created_at · Aguardando aprovação`, badge "Passaporte" (verde, tem anexo) ou "Sem anexo" (atenção), caixa com a expedição (nome, destino, embarque).
- **Alerta de saúde:** se alguma `PERGUNTAS_SAUDE` (exceto `vacina_febre_amarela`) estiver respondida com "Sim" → "Respostas de saúde marcadas com "Sim" — **verificar com a Carol** antes de aprovar." (regra de negócio, nome fixo no texto).
- "Ver todos os dados" expande `Detalhe`. Grupos: Dados pessoais; Endereço; Passaporte (número, validade, link "Ver passaporte" ou "sem anexo"); Contato de emergência; Preferências de voo (Marcar assento Sim/Não, Upgrade de classe); Experiência de viagem; Acompanhante(s) (nome, vínculo, dividir quarto/cama, dividir com); Perfil & conexões (+ "Ver foto"); Saúde (cada pergunta com resposta e detalhes `detalheCampo/detalhe2Campo` juntos com " · ", + link "Ver certificado" de febre amarela). Linhas vazias ficam ocultas.
- Ações por card: "Aprovar" e "Recusar" (se `podeDecidir`), link externo `/expedicoes/<id>/passageiros`.
- Seção recolhível "Recusadas (N)": cards com "Recusada (data)", caixa "Motivo da recusa" + "Ver anexo do motivo". Ações "Restaurar" e "Excluir" (escondidas para somente-leitura; o `relacionamento` NÃO restaura nem exclui).
- `DecisoesLog` (só admin): recolhível, busca em `nome, cpf, decidido_por_nome, expedicao_nome, label da ação`. Colunas: Quando (data e hora) · Ação (badge `aprovada→vinculado "Aprovada"`, `recusada→critico "Recusada"`, `restaurada→lista "Restaurada"`, `excluida→auto "Excluída"`) · Passageiro · CPF · Expedição · Quem decidiu · Motivo (line-clamp 2). Vazio: "Nenhuma decisão registrada ainda."
- Sem realtime (atualiza com `router.refresh()` após cada ação).

### 4.4 Aprovar: `aprovarInscricao(id)` (`actions.ts:229-309`)
1. Guarda `podeDecidirInscricao` → "Sem permissão para aprovar inscrições."
2. Lê a pendência (SR). Não existe → "Inscrição não encontrada."
3. `materializarInscricao` (`core.ts:377-479`, SR):
   - `acharLinhasPorCpf(cpf)`: ⚠️ `passageiros select * where cpf not null`, **sem paginação** (corta em 1000), filtrada por dígitos.
   - Escolhe `existente` = linha desta expedição, senão a linha avulsa (`expedicao_id null`), senão nenhuma.
   - `jaOnboarded` = existe linha em `acesso_senhas` para o CPF.
   - **Existente:** `patchAtualizar` sobrescreve com o form (todos os campos de `novosCampos`, exceto `tipo/inscricao_origem/cpf`; `saude` mesclada com o form vencendo) + `pendente_aprovacao=false` + `expedicao_id` (converte avulsa em reserva) + `status_reserva: 'Lead' → 'Pré-reserva'` + `passaporte_arquivo_id/foto_arquivo_id` se vieram + `liberado_expedamigo=true` se `jaOnboarded`. UPDATE.
   - **Nova:** INSERT com `novosCampos` (nome, cpf, nascimento, email, telefone, passaporte, validade, contato de emergência ×3, endereço ×7, pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, paises_visitados, acompanhante_* ×4, saude, `perfil_viajante {profissao, instagram, camiseta, musica, descricao_grupo, anima_expedicao, significado, confirmou_veracidade}`, `tipo 'Pagante'`, `inscricao_origem 'Formulário público'`) + `expedicao_id, status_reserva 'Pré-reserva', pendente_aprovacao false, anexos, liberado_expedamigo = jaOnboarded` + backfill do perfil agregado só nos campos vazios.
   - Propaga `CAMPOS_PROPAGAR` (`core.ts:50-56`: nome_completo, email, telefone, passaporte, validade_passaporte, endereco_* ×7, contato_emergencia_* ×3, ja_viajou_internacional, paises_visitados) para as outras linhas da pessoa. Saúde e anexos NÃO propagam aqui.
   - Vincula anexos: `UPDATE arquivos SET passageiro_id = pax WHERE id IN (passaporte, foto, certificado)`.
   - `gerarRequisitosPadrao(expedicao_id)`. ⚠️ Roda com a **sessão** (`getServerClient`), não com SR. Quando quem aprova é `relacionamento`, a RLS 0046 bloqueia o INSERT em `passageiro_requisitos`, o erro é engolido e o passageiro fica sem requisitos de prontidão.
   - `espalharCertificadoVacina(sb, cpf, certId)` (SR): preenche o slot "Vacina" vazio de todas as linhas da pessoa (respeita Dispensado/Reprovado) e marca "Enviado".
4. DELETE da pendência (SR).
5. `registrarDecisaoInscricao({acao:'aprovada', usuarioId, usuarioNome})` → INSERT `inscricoes_decisoes` (SR, best-effort).
6. **Bitrix (via n8n):** monta `PassageiroOutbound` (`actions.ts:43-81`):
   `{evento:"inscricao_aprovada", bitrix_deal_id, bitrix_contact_id, expedicao_codigo, expedicao_nome, expedicoes_anteriores, nome_completo, cpf, email, telefone, data_nascimento, passaporte, validade_passaporte, status_reserva, observacoes, endereco:{cep,rua,numero,complemento,bairro,cidade,estado}, contato_emergencia_nome, contato_emergencia_vinculo, contato_emergencia_fone, pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, paises_visitados, saude, passaporte_arquivo_url, passaporte_arquivo_nome}`. O acompanhante NÃO é enviado.
   - `expedicoes_anteriores` = número de expedições distintas não canceladas da pessoa (por CPF), excluindo a atual (paginado, SR).
   - Passaporte: `createSignedUrl(storage_path, 3600)` (SR) para o n8n baixar e anexar no Bitrix.
   - `enviarPassageiroParaBitrix` (`lib/bitrix/outbound.ts:69`): `POST N8N_BITRIX_OUTBOUND_URL`, header `x-webhook-secret: WEBHOOK_SECRET`. Sem a URL não envia. Erros só vão para o log (nunca desfazem a aprovação).
7. revalidate `/inscricoes`, `/passageiros`, `/expedicoes/<id>`, `/expedicoes/<id>/passageiros`, `/avisos`. Toast "<nome> aprovado(a)".
- Não é transacional: se cair no meio, pode sobrar passageiro gravado com a pendência ainda existente (reaprovar é idempotente porque reaproveita a linha da expedição).

### 4.5 Recusar: `recusarInscricao(id, motivo, recusaArquivoId?)` (`:317-356`)
- Guarda `podeDecidirInscricao`. Motivo obrigatório (trim) → "Informe o motivo da recusa."
- O cliente primeiro sobe o anexo opcional por `POST /api/arquivos/upload` (`file, expedicao_id, categoria "Outros", descricao "Motivo da recusa — inscrição"`; aceita `image/*,application/pdf`). ⚠️ Essa rota exige `podeEditar`, então o **`relacionamento` recebe 403 ao anexar** (só consegue recusar sem anexo).
- UPDATE (SR) `status='recusada', recusada_em=now, motivo_recusa, recusa_arquivo_id`. Nada é apagado.
- Log `acao:'recusada'` com motivo. Toast "Inscrição movida para Recusadas". UI: Dialog com textarea (placeholder "Ex.: passaporte vencido, vaga preenchida, dados inconsistentes…") e botão "Confirmar recusa" (desabilitado sem motivo).

### 4.6 Restaurar: `restaurarInscricao(id)`
- Guarda `podeEditar` (o relacionamento NÃO pode). UPDATE (SR) `status='pendente', recusada_em=null` (⚠️ motivo e anexo permanecem). Log `restaurada`.

### 4.7 Excluir definitivo: `excluirInscricaoDefinitivo(id)`
- Guarda `podeEditar`. `confirm()` nativo: "Excluir DEFINITIVAMENTE a inscrição de X? Isso apaga os dados e anexos — não dá pra desfazer."
- Para cada id em `[passaporte_arquivo_id, foto_arquivo_id, recusa_arquivo_id, dados.saude.vacina_febre_amarela_arquivo_id]`: `storage.remove([storage_path])` + DELETE em `arquivos` (SR). Depois DELETE da pendência. Log `excluida`.
- ⚠️ A linha avulsa criada em `passageiros` no envio (`salvarPerfilGlobalInscricao`) **não é removida**.

### 4.8 O que precisa ir para Edge Function no SPA
- `aprovarInscricao` inteiro: SR + signed URL + POST para o n8n com `WEBHOOK_SECRET` + escrita multi-tabela. Recomendo uma Edge Function `aprovar-inscricao` (checa papel via JWT → `usuarios.papel`, roda SR, idealmente numa RPC transacional para a parte de banco). Isso também corrige o bug do relacionamento sem requisitos.
- `recusar/restaurar/excluir`: dá para fazer com a sessão (RLS 0037 permite, a 0046 bloqueia somente-leitura). Porém a recusa pelo `relacionamento` cai no bloqueio da 0046 (é read-only), então precisa de RPC `security definer` com checagem `podeDecidirInscricao`, ou Edge Function. Excluir arquivos do storage exige policy de storage ou SR.
- `inscricoes_decisoes`: escrita hoje só por SR (não há policy de insert). Opções: trigger em `inscricoes_pendentes`, ou policy de insert para authenticated com `decidido_por = auth.uid()`.

---

## 5. `/acessos-expedamigo` + senhas e links de 1º acesso

Arquivos: `page.tsx` (55), `AcessosTabela.tsx` (150), `lib/acesso-senha.ts` (56), `lib/expedamigo/first-access-token.ts` (45), `lib/expedamigo/onboarding.ts` (45), `app/a/[codigo]/route.ts` (37), `app/api/expedamigo/onboarding-diario/route.ts` (112), migrations 0031, 0040, 0043, 0050, 0058, 0059.

### 5.1 Tela (só leitura)
- Dados (sessão): `expedamigo_acessos select * order created_at desc limit 1000`; `expedicoes select *`; `passageiros select cpf,nome_completo where cpf not null` (⚠️ sem paginação). O nome sai da 1ª linha de passageiro com o mesmo CPF em dígitos.
- Tabela `expedamigo_acessos` (0043): `id, cpf text not null, evento text check in ('login','download_pdf','viagem_aberta','download_voucher','primeiro_acesso')` (0050 e 0059 ampliaram), `expedicao_id FK set null, created_at`. RLS: SELECT e ALL para authenticated. Sem IP nem dispositivo (LGPD).
- UI: título "Acessos ao ExpedAmigo", descrição "Registro de quem criou o acesso (1º acesso pelo link), entrou no portal, abriu uma viagem e baixou arquivos. Só CPF, evento e data/hora (sem IP/dispositivo)."
- Busca em `nome + cpf + expedicao_nome`. Chips de evento (Todos + 5).
- `EVENTOS` (verbatim): `primeiro_acesso "1º acesso" vinculado KeyRound`, `login "Login" lista LogIn`, `viagem_aberta "Abriu viagem" atencao BookOpen`, `download_pdf "Baixou PDF" vinculado FileDown`, `download_voucher "Baixou voucher" vinculado Ticket`.
- StatPills: Total + um por evento (sobre os 1000 carregados, ignorando filtros).
- Colunas: Data / hora (`toLocaleString pt-BR dd/mm/aaaa hh:mm`) · Pessoa (nome ou "—", CPF formatado) · Evento (badge com ícone) · Expedição.
- Vazio: "Nenhum acesso registrado ainda". Filtro sem resultado: "Nenhum acesso no filtro atual." Sem realtime. Sem ações.

### 5.2 Senhas por CPF (portal ExpedAmigo + Área do Líder)
- Tabela `acesso_senhas` (0031/0040): `cpf text PK, senha_hash text null, senha_provisoria text null (legível), created_at, updated_at`. **RLS ligada e SEM policies**: só SR acessa.
- `hashSenhaAcesso(cpf, senha)` = `sha256Hex("expedamigo:senha:v1:" + cpf + ":" + senha)` (WebCrypto). O SPA não precisa disso (o portal é público e está fora do escopo), mas a Edge Function que resetar/verificar senha precisa usar o mesmo formato.
- `gerarSenhaAleatoria()` (`lib/acesso-senha.ts:57`): 8 caracteres do alfabeto `"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"` com `crypto.getRandomValues`.
- `senhaNovaValida`: mínimo de 6 caracteres. `conferemSenhaInicial` (data de nascimento) é legado: a senha por nascimento foi removida na 0040.
- Ações internas (todas admin-only, SR), em `expedamigo-actions.ts`:
  - `liberarExpedamigo(paxId, expId)`: `passageiros.liberado_expedamigo=true`. Se o CPF tiver 11 dígitos e não existir hash nem provisória, cria a provisória. Retorna a senha ou `jaTemSenha`. (Escopo de expedição.)
  - `liberarExpedamigoTodos(expId)`: mesmo fluxo para todos os não cancelados. Retorna a lista `{nome,cpf,senha}`. (Escopo de expedição.)
  - `bloquearExpedamigo` → `liberado_expedamigo=false`.
  - `gerarNovaSenhaCpf(cpf)` → upsert com provisória nova e `senha_hash=null` (a pessoa volta ao 1º acesso). Usado em `/passageiros`.
  - `estadoExpedamigoPax`, `estadoSenhaCpf`: leitura de hash e provisória.
- Regra (CLAUDE.md §Portal e `core.ts:429-432`): a 1ª liberação é o onboarding da pessoa. Depois disso, novas expedições aprovadas entram auto-liberadas (`jaOnboarded` = existe linha em `acesso_senhas`).

### 5.3 Link de 1º acesso `/a/<codigo>` e texto do WhatsApp
- Tabela `acesso_links` (0058): `id, codigo text unique, passageiro_id FK passageiros on delete cascade, expira_em timestamptz, created_at`. RLS sem policies (só SR).
- Gerado **só** pelo cron `POST /api/expedamigo/onboarding-diario` (n8n; header `x-webhook-secret == WEBHOOK_SECRET`; body `{dryRun?, expedicao_codigo?}`):
  - seleciona expedições com `status != 'Cancelada'` e `data_embarque >= hoje` (filtro opcional por código);
  - pega passageiros com `status_reserva='Confirmado'` e `liberado_expedamigo != true`; ignora nomes que batem com `/ACESSO TESTE/i`;
  - código de 10 caracteres do alfabeto `"abcdefghjkmnpqrstuvwxyz23456789"` (até 4 tentativas em colisão; senão cai no link longo), validade 30 dias, link `${NEXT_PUBLIC_SITE_URL}/a/<codigo>`. No `dryRun` usa o link longo `/amigo/acesso?t=<token>` e não grava nada;
  - telefone com ≥ 10 dígitos vai para `enviar`; sem telefone vai para `pendencias` (motivo "sem telefone");
  - sem dryRun: `UPDATE passageiros SET liberado_expedamigo=true WHERE id IN enviar` (idempotência);
  - resposta `{ok, dryRun, total, enviar:[{passageiro_id,nome,telefone,cpf,expedicao_codigo,expedicao_nome,link,mensagem}], pendencias:[...]}`. O n8n é quem envia o WhatsApp.
- `GET /a/<codigo>` (público, liberado no middleware): busca `acesso_links` (SR). Inválido ou expirado → redirect `/amigo?e=link`. Senão `assinarTokenAcesso(passageiro_id)` → redirect `/amigo/acesso?t=<token>`.
- Token de 1º acesso (`first-access-token.ts`): HMAC-SHA256, payload `{p: passageiroId, e: expira}`, TTL 30 dias, **mesmo segredo `SUPABASE_SERVICE_ROLE_KEY` || `N8N_SYNC_SECRET` || "expedamigo-acesso-dev"**. ⚠️ Se a service role key for rotacionada, todos os links e tokens emitidos ficam inválidos. Na migração para Edge Function é preciso usar o mesmo segredo, senão os links já enviados quebram.
- Texto do WhatsApp (`lib/expedamigo/onboarding.ts:9-24`), verbatim:
```
Oiii {nome}! Que alegria ter você na {rotulo_viagem} {expedição} 💚

Aqui é o time de Relacionamento da Se Tu For — a partir de agora somos nós que vamos cuidar de você em cada detalhe até o embarque (e durante a viagem também).

Já liberamos o seu acesso ao *Portal do Viajante* 🎉 É nele que você acompanha tudo da sua viagem em um só lugar: o *roteiro dia a dia*, seus *voos*, a *hospedagem*, vouchers, informações do destino e avisos importantes.

👉 {link}

É só clicar no link pra criar sua senha e entrar.

📝 Importante: ao abrir o *roteiro dia a dia* no portal, vai aparecer um *formulário de inscrição* pra você preencher — é onde a gente te conhece melhor e já organiza sua documentação com antecedência, pra tudo fluir tranquilo lá na frente.

E o próximo passo é um *encontro rápido de boas-vindas*: online, leve, uns 20 minutinhos. Ali o nosso time se apresenta, te conta como funciona o acompanhamento daqui pra frente e alinha os próximos passos da sua {termo_viagem}.

Conta pra gente: qual o melhor dia e horário pra você nos próximos 7 dias, de segunda a sexta? 💚
```
  Substituições: `{nome}` = primeiro nome; `{rotulo_viagem}` = "sua viagem" (pacote) ou "Expedição"; `{termo_viagem}` = "viagem" ou "expedição"; `{expedição}` e `{expedicao}` = nome da expedição; `{link}`. Suporta `templateOverride` (não usado).
- **Nenhuma tela interna gera link curto nem botão de WhatsApp.** O que existe na UI interna é "Copiar login e senha" (texto `Login: <cpf>\nSenha: <senha>`). Os únicos `wa.me` no app interno são campos de URL de passeio opcional (`PortalEditor.tsx:796`).

### 5.4 SPA
- A tela de acessos é leitura direta com a sessão (a RLS libera). Precisa paginar.
- Tudo que toca `acesso_senhas` e `acesso_links` exige Edge Function (ou RPC `security definer` com checagem de admin). O cron de onboarding e o `/a/<codigo>` continuam sendo endpoints de servidor (Edge Functions públicas com validação de segredo).

---

## 6. `/avisos`: avisos operacionais

Arquivos: `page.tsx` (22, `force-dynamic`), `AvisosLista.tsx` (126), `lib/data/expedicoes.ts:553-683`, `lib/alertas/regras.ts` (62), motor `lib/prontidao/regras.ts` (`avaliarProntidao`, parte de prontidão, documentado em outra seção).

### 6.1 Cálculo (`getAlertasOperacionais`, envolvido em React `cache()`)
- `getProntidaoTodas()`: `expedicoes select *` + `passageiros select *` (paginado) + `passageiro_requisitos select *` (paginado), com a sessão.
- Filtros: só `expedicoes.tipo = 'expedicao'` (pacotes ficam de fora); passageiros não cancelados com `expedicao_id`; expedições com `status ∉ {Concluída, Cancelada}`; `dias = daysUntil(data_embarque)` precisa ser ≥ 0.
- Para cada checagem de `avaliarProntidao({passageiro, expedicao, destino, requisitos})`, `avaliarAlerta(tipo, semaforo, dias)`:
  - `semaforo ∈ {ok, na}` → sem aviso; sem regra para o tipo → sem aviso; `dias > janelaDias` → sem aviso;
  - `semaforo === 'bloqueio'` → **critico**; senão **atencao**.
- `ALERTA_REGRAS` (verbatim, `lib/alertas/regras.ts:26-39`):
  | tipo | janelaDias | rótulo |
  |---|---|---|
  | Passaporte | Infinity | Passaporte ausente ou vence em ≤6 meses do retorno |
  | Visto | 60 | Visto pendente |
  | Dados Pessoais | 60 | Cadastro incompleto |
  | Aéreo Internacional | 60 | Bilhete internacional não emitido |
  | Vacina | 45 | Vacina / certificado pendente |
  | Seguro | 45 | Seguro viagem pendente |
  | Aéreo Doméstico | 30 | Trecho doméstico pendente |
  | RG | 30 | RG pendente |
  | Contrato | 90 | Contrato não assinado |
  | Autorização de Menor | 60 | Autorização de menor pendente |
- Ordenação: `dias_ate_embarque asc` e, no empate, crítico antes de atenção.
- Item: `{expedicao_id, expedicao_nome, data_embarque, dias_ate_embarque, passageiro_id, passageiro_nome, tipo, severidade, rotulo, detalhe}`.
- O mesmo cálculo alimenta o badge do menu (`getContagemAlertas` → `{total, criticos}`; o AppShell usa `total`).

### 6.2 UI
- Filtros em botões: `Todos (N)`, `Críticos (N)`, `Atenção (N)`. Busca em `passageiro_nome + expedicao_nome + rotulo`.
- Agrupado por expedição na ordem que chega. Cabeçalho do grupo: link para `/expedicoes/<id>/passageiros`, "embarque dd/mm/aaaa · faltam N dia(s)", badge "N aviso(s)" (crítico se `dias <= 30`, senão atenção).
- Item: bolinha colorida, nome do passageiro, `rotulo — detalhe`, badge com o `tipo`. Link `/expedicoes/<id>/passageiros?editar=<passageiro_id>` (abre o drawer do passageiro na expedição).
- Vazio total: "Tudo dentro do prazo — Nenhum aviso no momento — passaportes, vistos, documentos e prazos das expedições estão em dia. 🎉". Filtro sem resultado: "Nenhum aviso para o filtro/busca atual."
- Sem ações. Sem realtime (recalcula a cada request e a cada `revalidatePath('/avisos')` disparado pelas mutações de passageiro e inscrição).
- SPA: o cálculo precisa rodar no cliente (portar `avaliarProntidao` + `ALERTA_REGRAS`) ou numa view/RPC SQL. São 3 queries paginadas. O badge global obriga a carregar tudo em toda navegação: convém cachear (React Query) ou materializar.

---

## 7. `/configuracoes`: usuários e papéis

Arquivos: `page.tsx` (135), `actions.ts` (78), `MudarPapelSelect.tsx` (56), `ResetarSenhaBtn.tsx` (92).

### 7.1 Tela
- `listUsuarios()` (`lib/data/expedicoes.ts:262`): `usuarios select *` (sessão), sem ordenação.
- Card "Usuários (N)": avatar, nome, e-mail, badge `PAPEL_LABEL` (`admin "Admin", operacional "Operação", comercial "Comercial", financeiro "Financeiro", relacionamento "Relacionamento", leitura "Leitura"`). Quem não é admin vê o aviso "Apenas admins podem promover/demover usuários." e não tem ações.
- Card "Constantes do negócio" (somente leitura, hardcoded em `lib/constants.ts:1-3`): `MARGEM_MINIMA = 0.20` ("Abaixo disso a expedição é marcada em vermelho."), `MARGEM_IDEAL = 0.30` ("Meta. Verde a partir desse valor."), `PROVISAO_EXTRA_PADRAO = 0.05` ("Reserva sobre custos planejados.").
- Card "Templates de checklist": placeholder estático ("A implementar"): América do Sul (sem visto) 10 itens, Europa (Schengen) 14, Ásia (visto on-arrival) 12.
- Card "Integrações": estático, Bitrix24 CRM / n8n webhooks / Banco Central (câmbios) todos com "Configurar".
- **Não existe "criar usuário" nem "convidar".** Usuários são criados no Supabase Auth (dashboard) e a linha em `usuarios` nasce no 1º login (papel `leitura`, `senha_provisoria true`).

### 7.2 Ações (admin, SR)
- `alterarPapelUsuario(usuarioId, papel)` (`actions.ts:57-78`): exige `eu.papel === 'admin'`; `papel ∈ PAPEIS_ATRIBUIVEIS = ["admin","operacional","relacionamento"]` (senão "Papel inválido."); não pode alterar o próprio (anti-lockout, "Você não pode alterar o próprio papel."). UPDATE `usuarios.papel` (SR). `revalidatePath('/configuracoes')`.
  - UI: `<select>` que salva no `onChange`. Na própria conta mostra "(você)". Se o papel atual for legado (comercial/financeiro/leitura), ele é incluído como opção para não ser trocado sem querer. Toast "Papel alterado para X".
- `resetarSenhaUsuario(usuarioId)` (`:21-50`): exige admin. Senha `Setur@<4 dígitos aleatórios 1000-9999>` (`Math.random`, ⚠️ fraca). `admin.auth.admin.updateUserById(id, {password})` (**exige SR / Admin API**). `UPDATE usuarios SET senha_provisoria=true`. Devolve a senha.
  - UI: botão "Resetar senha" → confirmação inline "Resetar a senha de <primeiro nome>?" → mostra a senha em mono com botão copiar ("Repasse ao usuário — ele troca no 1º acesso") e "Fechar".
- Fluxo de 1º acesso do operacional: layout redireciona para `/primeiro-acesso`; `app/conta/actions.ts:39` faz `update usuarios set senha_provisoria=false` depois de trocar a senha.

### 7.3 O que tem que ir para Edge Function no SPA
- **`resetarSenhaUsuario`**: obrigatoriamente Edge Function (`auth.admin.updateUserById` só com service role). Gerar a senha com CSPRNG.
- **`alterarPapelUsuario`**: Edge Function ou RPC `security definer` (`set_papel(usuario_id, papel)` checando `papel = 'admin'` do chamador, `papel ∈ atribuíveis`, `usuario_id != auth.uid()`). Junto, **fechar a RLS de `usuarios`** (hoje qualquer autenticado pode dar UPDATE em qualquer linha, inclusive `papel`).
- Criação da linha `usuarios` no 1º login: trigger em `auth.users` (recomendado) no lugar do INSERT pelo cliente.
- Recomendável também uma Edge Function "convidar usuário" (`auth.admin.inviteUserByEmail` / `createUser`), que hoje não existe.

---

## 8. `/cambios`: EXCLUÍDO do rebuild (mapa de dependências)

Arquivos: `page.tsx` (14), `CambiosTabela.tsx` (95, realtime em `cambios`, botão "Atualizar agora"), `actions.ts` (24, `sincronizarCambios` com guarda `podeEditar`), `lib/cambio/fetch.ts` (34: `GET https://open.er-api.com/v6/latest/BRL`, moedas `USD, EUR, GBP, JPY, ARS, CLP, PEN`, taxa = `1/rate`, BRL=1), `lib/cambio/sync.ts` (55: upsert `cambios` on conflict `moeda`), `lib/data/cambios.ts` (17), `app/api/cambios/sync/route.ts` (41: GET com `Authorization: Bearer CRON_SECRET` usa SR; POST com usuário logado). Cron Vercel `0 6 * * *` (`vercel.json`). Tabela `cambios (moeda text PK, taxa_brl numeric(14,6) > 0, atualizado_em)`.

**Todos os pontos fora de `/cambios` que leem câmbio** (`grep -i cambio` em app/, lib/, components/):
1. `app/(app)/expedicoes/actions.ts:25` importa `getTaxaBrl`.
   - `criarCusto` (`:1139-1170`): `cambio = d.cambio_aplicado ?? (d.moeda === 'BRL' ? 1 : await getTaxaBrl(d.moeda))`. `getTaxaBrl` (`lib/data/cambios.ts:12`) lê `cambios` inteira e devolve `taxa_brl` da moeda, **ou 1.0 se não existir**. Grava `custos.cambio_aplicado` e `valor_planejado_brl = valor_planejado * cambio`. **Esta é a única leitura real da tabela `cambios` fora da tela.** Se a tabela deixar de ser atualizada, custos novos em moeda estrangeira sem câmbio informado usam a taxa velha ou 1.0.
   - `atualizarCustoLote` (`:1431-1481`): usa só `custos.cambio_aplicado` (coluna do custo, não a tabela `cambios`) para recalcular `valor_planejado_brl/valor_realizado_brl`.
   - `CAMPOS…EDITAVEIS` inclui `"cambio_aplicado"` (`:566`).
2. `components/layout/Sidebar.tsx:32` (item "Câmbios"), `components/layout/CommandPalette.tsx:81` (atalho `/cambios`), `components/layout/Breadcrumb.tsx:9` (rótulo). Removê-los no SPA.
3. `middleware.ts:14` libera `/api/cambios` do gate de senha do site.
4. RLS 0046 lista `cambios` na trava de escrita; a publication de realtime inclui `cambios`.
5. Falsos positivos: `app/amigo/page.tsx:847` e `app/amigo/ViagemPDF.tsx:260` (só escolhem o ícone 💵 se o título contém "câmbio"). `lib/mock-data.ts:172-181` (mockCambios: USD 5.20, EUR 5.60, PEN 1.40, GBP 6.55, JPY 0.035, ARS 0.005, CLP 0.0055, BRL 1.0).
- Dashboard: `revalidatePath('/dashboard')` após o sync, mas o dashboard **não** lê `cambios` (nenhum import).
- Decisão para o SPA: em `criarCusto`, ou o usuário informa `cambio_aplicado` sempre, ou o SPA lê `cambios` (só leitura, RLS ok) mantendo o fallback 1.0. O cron pode continuar fora do SPA (Edge Function agendada) se quiserem manter a tabela viva.

---

## 9. Dev/mock mode (`lib/dev-mode.ts`, 49 linhas)

- `DEV_AUTH_BYPASS` = não-produção E (`NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true'` OU sem `NEXT_PUBLIC_SUPABASE_URL`). `getCurrentUser()` devolve `MOCK_USER` (admin "Bruno Oliveira", id `00000000-…-0001`).
- `DEV_USE_MOCK_DATA` = não-produção E (`NEXT_PUBLIC_DEV_USE_MOCK_DATA` explícito, ou cai no valor de `DEV_AUTH_BYPASS`).
- Em `NODE_ENV === 'production'` as duas são **forçadas a false** (fail-closed).
- `bypass=true` + `mock=false`: `getServerClient()` devolve **service role** (`lib/supabase/typed.ts:18-21`), então a RLS some em dev.
- Mock: arrays em `lib/mock-data.ts` (831 linhas) presos em `globalThis` (`persist`) para sobreviver ao HMR. Tem fixtures de usuarios, fornecedores, cambios, expedicoes, passageiros (gerados de CSV), quartos, custos, pagamentos, checklist, requisitos etc.; `mockInscricoesPendentes` e `mockExpedamigoAcessos` vazios. `PASSAGEIRO_INSCRICAO_DEFAULTS` (`:311-328`) = defaults null das colunas de inscrição.
- `lib/data/arquivos-mock.ts` (101): store em disco `.dev-uploads/` (`index.json` + `<id>.blob`) usado pelas rotas `/api/arquivos/*` e pelo staging da inscrição.
- Comportamentos que mudam em mock (para não copiar sem querer): clientes vazio; realtime desligado; export e decisões em memória; `estadoSenhaCpf` devolve admin sem senha; senhas geradas não persistem; fornecedores "Histórico" (bug: usa mock até em produção).
- **SPA:** nada disso precisa ser portado. Recomendo apenas um `.env` de staging, nunca um bypass de auth.

---

## 10. Inventário de bypass de RLS (service role) — telas internas + APIs

Tudo abaixo o SPA NÃO pode fazer com supabase-js no navegador.

| Local | O que faz com SR | Proposta SPA |
|---|---|---|
| `app/(app)/configuracoes/actions.ts:37,73` | `auth.admin.updateUserById` (reset de senha) + `usuarios.senha_provisoria`; UPDATE `usuarios.papel` | **Edge Function** (reset obrigatório); papel via RPC definer/Edge + fechar RLS `usuarios` |
| `app/(app)/inscricoes/actions.ts` (8×) | ler pendência, materializar em `passageiros`, apagar pendência, `arquivos` + storage (signed URL, remove), `expedicoes`, contar anteriores | **Edge Function** `aprovar-inscricao`; recusar via RPC definer (o relacionamento é read-only na RLS); excluir via Edge (storage) |
| `app/(app)/inscricoes/decisoes.ts` (2×) | INSERT/SELECT `inscricoes_decisoes` | SELECT já liberado pela RLS; INSERT via trigger ou policy |
| `lib/inscricao/core.ts` (3×) | `passageiros`, `acesso_senhas`, `arquivos` | dentro da Edge Function de aprovação |
| `lib/data/compras.ts` (2×) | SELECT `compras_bitrix` | sessão (a RLS já libera) |
| `app/api/clientes/export/route.ts` | SELECT `expedicoes`, `passageiros` | sessão + exceljs no cliente |
| `app/(app)/expedicoes/[id]/passageiros/expedamigo-actions.ts` (6×) | `acesso_senhas` (sem policy), `passageiros.liberado_expedamigo` | **Edge Function** admin-only (usada também em `/passageiros`) |
| `.../passageiros/bitrix-sync-actions.ts` | sync com Bitrix | Edge (escopo de expedição) |
| `.../passageiros/extensoes-actions.ts` (2×), `grupo-actions.ts` (3×), `passeios-opcionais-actions.ts` (2×) | leitura/escrita de extensões, grupos, compras de passeio | avaliar RLS (escopo de expedição, outra parte) |
| `.../[id]/portal/actions.ts` (4×), `.../roteiro-lider/actions.ts` | fotos do roteiro, passeios, voucher, dias do líder | avaliar (outra parte) |
| `app/api/arquivos/{upload,[id],[id]/download}` | storage + `arquivos` | storage policies + signed URL no cliente, ou Edge |
| `app/api/bitrix/expedicao-sync`, `importar-compras`, `lib/bitrix/upsert-passageiro.ts` | webhooks do n8n | Edge Functions (secret) |
| `app/api/cambios/sync` | upsert `cambios` (cron) | excluído / Edge agendada |
| `app/api/expedamigo/onboarding-diario`, `app/a/[codigo]` | `acesso_links`, `passageiros`, token | Edge Functions públicas (mesmo segredo HMAC) |
| `app/api/expedicoes/atualizar-status` | cron de status | Edge agendada (outra parte) |
| Público (fora do escopo): `app/inscricao/actions.ts`, `app/amigo/actions.ts`, `app/lider/actions.ts` | tudo com SR | permanecem servidor |
| `lib/supabase/typed.ts` | SR em dev bypass | não portar |

Env vars envolvidas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (também é o **segredo HMAC** dos tokens de inscrição e de 1º acesso), `N8N_SYNC_SECRET` (fallback HMAC), `N8N_BITRIX_OUTBOUND_URL`, `WEBHOOK_SECRET` (header `x-webhook-secret` do outbound e do onboarding), `CRON_SECRET` (cron de câmbios/status), `NEXT_PUBLIC_SITE_URL` (links absolutos; padrão `https://sistema-expedicoes.vercel.app`, `lib/site.ts`), `SITE_PASSWORD` (gate), `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_USE_MOCK_DATA`.

---

## 11. Gate de senha do site (`lib/site-auth.ts` 34, `middleware.ts` 41)
- Com `SITE_PASSWORD` setada, todo o site exige o cookie `se_acesso = sha256Hex("se-acesso:v1:" + SITE_PASSWORD)`, senão redireciona para `/acesso?next=<path>`. Sem a env, o gate fica desligado.
- Rotas liberadas: `/acesso, /inscricao, /amigo, /a/, /api/health, /api/logout, /api/bitrix, /api/cambios, /api/expedamigo, /api/expedicoes/atualizar-status`.
- É uma camada **adicional** ao login Supabase das telas internas. No SPA, se quiserem manter, vira uma tela pré-login com checagem numa Edge Function (não dá para validar a senha no cliente sem expor o hash). Provavelmente dá para descartar, já que o login real está ativo.

---

## 12. Regras de negócio só nos docs (CLAUDE.md, HANDOFF.md, docs/)
- **Não existe tabela pessoas.** A identidade é CPF → Bitrix → e-mail → nome. Dados pessoais propagam entre expedições; dados de reserva não. `perfil_viajante` é por expedição (a inscrição é refeita a cada expedição); `foto_arquivo_id` propaga (CLAUDE.md §Perfil global e §Inscrição).
- Passageiro avulso (`expedicao_id null`) não entra em prontidão nem em listas de expedição (0014).
- **Pagamento de passageiro foi removido.** Só existe pagamento de fornecedor. As colunas `valor_contratado_brl/valor_pago_brl/saldo_brl/status_financeiro` estão dormentes (o import ainda grava). Saldo não bloqueia embarque (CLAUDE.md §Pagamento, HANDOFF §Notas).
- Requisitos de prontidão vêm do **template TS** (`lib/prontidao/`), não da tabela `requisitos_destino` (que é só catálogo). São gerados ao incluir passageiro, no import CSV, no webhook do Bitrix e na aprovação.
- Papéis em uso: admin, operacional, relacionamento (comercial/financeiro/leitura são legado). O relacionamento lê tudo e só aprova/recusa inscrições.
- Inscrição: a recusa nunca apaga (só a exclusão definitiva). O reenvio revive. O badge conta só pendentes. O log de decisões é só para admin.
- Imagens do form público são comprimidas no navegador (máx 2000 px, JPEG) por causa do `bodySizeLimit` de 32 MB (relevante se o SPA reimplementar algum upload grande).
- ExpedAmigo: 1ª senha aleatória e legível até a troca (LGPD_CHECKLIST item 2 pede trocar por link com token, já feito parcialmente com o onboarding por link). O log de acesso não guarda IP. "1ª execução [do onboarding] pega TODO o backlog de Confirmados-não-liberados — baseline antes de ligar."
- Expedições "fechadas" (ex.: `JAPCOR-2026-09`) não entram no broadcast de admin do portal. Masters da Área do Líder por CPF (`app/lider/actions.ts`, mapa `MASTERS`). Ambos fora do escopo interno.
- LGPD_CHECKLIST: existe exclusão definitiva de inscrição recusada; faltam política de retenção e descarte, canal do titular e base legal para dados de saúde.
- HANDOFF: o realtime é por refresh (~300 ms), sem co-edição. Visibilidade de receita/margem por papel ainda está "a decidir" (hoje todos veem).
- Convenção: zod em todo input externo; pt-BR; edição inline > drawer > modal.

---

## 13. Bugs e armadilhas encontrados (para não replicar)
1. `usuarios` com UPDATE liberado para qualquer autenticado: escalada de papel no SPA (§0.2).
2. `listPessoas`, `listArquivosDePassageiros`, `acharLinhasPorCpf`, query de passageiros em `/acessos-expedamigo` e `listPorStatus` sem paginação: corte silencioso em 1000 linhas. Afeta dedup, materialização e perfil.
3. `/fornecedores` "Histórico" calculado a partir de `mockCustos` em produção.
4. Aprovação por `relacionamento`: `gerarRequisitosPadrao` roda com a sessão e a RLS 0046 bloqueia, então o passageiro fica sem requisitos (erro engolido).
5. Recusa com anexo pelo `relacionamento`: `/api/arquivos/upload` devolve 403 (`podeEditar`).
6. `restaurarInscricao` não limpa `motivo_recusa/recusa_arquivo_id`. `excluirInscricaoDefinitivo` não remove o passageiro avulso criado no envio.
7. Aprovação não é transacional (várias escritas SR em sequência).
8. `atualizarDadosPessoais` substitui `saude` inteira em todas as expedições (não mescla).
9. `resetarSenhaUsuario` gera senha com `Math.random` e só 9.000 combinações.
10. Os tokens HMAC usam a service role key como segredo: rotacionar a chave invalida links e tokens.
11. Identidade de clientes (`compras.ts`) compara o CPF cru; a de passageiros compara só dígitos. Clientes e passageiros podem não casar se o CPF vier formatado.
