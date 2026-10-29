# Mapa do módulo Expedições (antes do redesign)

Levantamento feito em 29/10/2026 lendo o código do worktree `qs-turis-redesign`. Serve de guia para reorganizar as 10 abas do detalhe em 6, conforme `docs/ref-expedicoes/qs-redesign-expedicoes.md`, seção 3. A regra da spec é que **nenhuma ação existente pode sumir**.

Todos os caminhos são relativos a `src/expedicoes/`, salvo quando indicado. "RLS" é sempre a da migration 0160: só quem não é "só leitura" (`is_readonly()`) grava.

---

## 1. Rotas

### 1.1 Quem monta a área

- **Operações** (`src/ops/OpsApp.tsx`) é quem edita. O prefixo é `ops`. `TELAS` inclui `...TELAS_EXP`. Quando `ehExp(rota.tela)`, renderiza `<ExpedicoesArea tela={rota.tela} caminho={rota.id} ir={(tela, id) => ir({ tela, id })} />`. O menu vem de `grupoExpedicoes(contExp)` (`menu.ts`), com os itens Expedições, Pacotes, Inscrições, Avisos e Fornecedores. Os badges vêm de `useContagensExp.ts`.
- **Relacionamento** (`src/rel/RelApp.tsx`) abre em modo leitura (o banco decide via `is_readonly()`), mas pode decidir inscrições. Monta `<ExpedicoesArea setorRelacionamento tela={REL_EXP[rota.tela]} …/>`. O mapa `REL_EXP` (linha 72) é `exp-expedicoes→expedicoes`, `exp-pacotes→pacotes`, `exp-passageiros→passageiros`, `exp-inscricoes→inscricoes`, `exp-avisos→avisos`. O `ir` do Rel só navega para telas desse mapa. Uma chamada para outra tela (ex.: `clientes`) é **ignorada sem aviso**.
- `ExpedicoesArea.tsx`: com `tela` igual a `expedicoes` ou `pacotes`, renderiza `ExpedicaoDetalhe` se houver `caminho` (com `key = 1º segmento`). Sem `caminho`, renderiza `ExpedicoesLista tipo="expedicao"|"pacote"`. As outras telas vêm de `PAGINAS` (lazy).

### 1.2 Formato do endereço

```
#ops/<tela>/<id-codificado>
   onde <id> = "<expId>[/<aba>[/<sub...>]]"
#rel/exp-expedicoes/<id-codificado>   (mesma coisa no Relacionamento)
```

- `hashDaArea` (`src/area/CascaDeArea.tsx`) monta `#${prefixo}/${tela}/${encodeURIComponent(id)}`. Por isso a **barra vira `%2F`**: o endereço real fica `#ops/expedicoes/<expId>%2Fpassageiros%2Fpax%2F<paxId>`.
- `lerHashDaArea` corta o hash em `?`, faz `split("/")` e pega só `[area, tela, id]`, aplicando `decodeURIComponent(id)`. **Armadilha**: um link digitado à mão com barras reais (`#ops/expedicoes/<id>/passageiros`) perde tudo depois do `<id>` e abre a Visão Geral. Só o formato com `%2F` funciona. O Rel tem o mesmo comportamento (`hashDe`, linha 115, e `lerRota`, linha 102).
- Pacotes usam a tela `pacotes` (`#ops/pacotes/<id>…`). A tabela é a mesma, com `expedicoes.tipo='pacote'`.

### 1.3 `ir()` (`contexto.tsx`)

- `ExpCtx.ir(tela: TelaExp, id?: string)` é repassado pelo app hospedeiro. Exemplo: `ir("expedicoes", \`${exp.id}/passageiros/pax/${paxId}\`)`.
- No Ops, `ir` faz `window.location.hash = hashDaArea(...)`, `setRota` e `scrollTo(0,0)`. Cada troca de aba ou sub-endereço **remonta a área e entra no histórico do navegador**, porque usa `location.hash` e não `replaceState`.
- `TELAS_EXP = ["exp-inicio","avisos","expedicoes","pacotes","passageiros","clientes","inscricoes","fornecedores","acessos-amigo","exp-config"]`.
  - `passageiros`, `clientes` e `acessos-amigo` continuam acessíveis por endereço, mas saíram do menu (23/10). Viraram abas da ficha do cliente (`menu.ts`).
  - `exp-config` aparece no grupo "Gestão" do Ops.
- O contexto também expõe:
  - `somenteLeitura`, vindo de `rpc("is_readonly")`;
  - `podeDecidirInscricao`;
  - `usuarios` e `recarregarUsuarios`;
  - `avisar(texto, tom)`, que é o toast.
- O provider assina realtime em `expedicoes`, `passageiros`, `passageiro_requisitos` e `usuarios`, mas só para **derrubar o cache** (`lib/cache.ts` → `esquecer`). Não recarrega nada.

### 1.4 Sub-endereços por aba

`ExpedicaoDetalhe` faz `const [id, abaBruta = "", ...sub] = caminho.split("/")` e passa `sub` para a aba (`PropsAba = { exp, sub, onMudou }`). Uma aba inválida, ou oculta em pacote, cai na Visão Geral.

| Aba (id) | `sub` entendido | Onde |
|---|---|---|
| `""` (Visão Geral) | nenhum. Os links internos levam a `passageiros/prontidao/<paxId>` e `passageiros` | `detalhe/VisaoGeral.tsx` |
| `passageiros` | `["pax", id]`: gaveta do pax (`EditarPassageiro`). `["pax", id, "perfil"]`: página completa (`PerfilPax`). `["prontidao", id]`: gaveta de prontidão (`GavetaProntidao`). Se o pax não pertence mais à expedição, mostra a frase "não está mais nesta expedição" | `passageiros/PainelPassageiros.tsx` (`const [modo, alvoId, extra] = sub`) |
| todas as outras | nenhum (ignoram `sub`) | — |

Links de fora que chegam ao detalhe:
- Ficha do cliente (`OpsApp` e `RelApp`, `onAbrirExpedicao`): `"<exp>/passageiros/pax/<pax>"`.
- `FilaDivergencias`: o mesmo formato.
- `EditarPassageiro`, ao mover de expedição: `ir(tela, \`${nova}/passageiros/pax/${pax}\`)`.

### 1.5 `src/lib/hashQuery.ts` (disponível, ainda **não** usado nas Expedições)

- `hashSemQuery()`, `paramsDoHash()`, `lerParamDoHash(nome)` e `gravarParamNoHash(nome, valor)`.
- A gravação usa `history.replaceState`: não dispara `hashchange`, não remonta a tela e não enche o histórico.
- `lerHashDaArea` e `lerRota` do Rel já ignoram o `?…`, então `?aba=logistica` pode conviver com a rota atual.
- Já é usado em `src/rel/clientes/ClienteFicha.tsx` e `src/solicitacoes/SolicitacoesPage.tsx`, que servem de modelo.
- Hoje a aba das Expedições vai como **segmento de caminho** (`<id>/rooming`) e não como `?aba=`. A spec pede `?aba=` com redirect das antigas. Os links salvos no formato `<id>%2F<aba>` precisam continuar resolvendo.

---

## 2. Detalhe (`detalhe/ExpedicaoDetalhe.tsx`)

### 2.1 Cabeçalho

- Fundo em degradê `linear-gradient(135deg, #1F2937, #B45309)`, que a spec manda remover.
- Mostra:
  - o link "← Expedições"/"← Pacotes", que chama `ir(telaLista)`;
  - `exp.nome` com `PilulaStatus status`;
  - a linha `codigo · destino · data_embarque → data_retorno`;
  - a linha `Op: responsavel_op_nome · Com: responsavel_com_nome`;
  - a contagem de dias até o embarque (`daysUntil`), ou "✈ Embarcou";
  - o botão **Editar**, só fora do modo leitura, que abre `EditarExpedicao` (`lista/FormExpedicao.tsx`).
- Três `Indicador` com `Anel`, que a spec manda tirar do topo:
  - **Ocupação**: `pax_confirmados/pax_planejados`;
  - **Checklist**: `checklist_pct`. Em pacote, mostra **Passageiros** (`prontidao_total`);
  - **Prontidão**: `prontidao_aptos/prontidao_total`.
- **De onde vêm os números**: `lib/agregados.ts → expedicaoComAgregados(id)`. Lê em paralelo:
  - `lerExpedicao`;
  - `paxEReqs`, que chama `lerPaxProntidao` (colunas leves de `passageiros`) e depois `lerReqProntidao` (de `passageiro_requisitos`);
  - `lerChecklistMin` (`checklist_itens`: id, expedicao_id, parent_id, status);
  - `listarUsuarios`.
- Em seguida, `montar()` calcula:
  - `pax_confirmados`: `status_reserva='Confirmado' && tipo!=='Líder'`. Cancelados ficam fora;
  - `docs_pendentes`: quem não tem passaporte;
  - `prontidao_total` e `prontidao_aptos`: via `avaliarProntidao`. Líder e cortesia contam;
  - `checklist_pct`: processos de topo (`!parent_id`) concluídos ÷ total;
  - os nomes dos responsáveis.
- **Realtime** (`ui.tsx → useAoVivo`):
  - `expedicoes id=eq`, `passageiros expedicao_id=eq` e `checklist_itens expedicao_id=eq`, com espera de 600 ms;
  - `passageiro_requisitos`, sem filtro (não tem `expedicao_id`), com espera de 2500 ms.
  - Toda mudança chama `esquecer(tabela)` do cache e depois o callback.
- **Abas**: `ABAS` tem 10 itens. Em pacote, `OCULTAS_PACOTE = {rooming, checklist, roteiro-lider, grupos}`. A troca é `ir(telaLista, t ? \`${exp.id}/${t}\` : exp.id)`. Cada aba é lazy (`detalhe/abas/Aba*.tsx`) e recebe `onMudou = carregar`, que recarrega o cabeçalho.

### 2.2 Editar expedição (`lista/FormExpedicao.tsx → EditarExpedicao`)

- Campos: nome, destino, data_embarque, data_retorno, status, pax_planejados, pax_cortesia, preco_venda_brl ("Preço (R$)"), responsavel_operacional_id, responsavel_comercial_id e observacoes.
- Grava com `supabase.from("expedicoes").update(...)`.
- Se o status virar "Concluída", chama `aoConcluir(id)`, que dá `update passageiros set status_reserva='Confirmado'` em todos os não cancelados.
- **Não edita**: `preco_sem_aereo_brl` (fica na aba Valores), `codigo`, `tipo`, `viagem_grupo`, `grupo_rotulo`, `bitrix_pipeline_id` e `hospedagem_voucher_arquivo_id` (fica na aba ExpedAmigo).

---

## 3. As 10 abas

Legenda das ações: **[W tabela]** grava, **[RPC nome]** chama função, **[ST]** usa o Storage (bucket `arquivos-expedicoes`), **[EXP]** exporta.

### 3.1 Visão Geral (`detalhe/VisaoGeral.tsx`)

- **Dados**:
  - `checklist_itens` (id, prazo, status, tarefa, etapa), menos em pacote;
  - `prontidaoLeveDaExpedicao(exp)` (`lib/agregados.ts`): `passageiros` leves mais `passageiro_requisitos`, com `avaliarProntidao`;
  - `listPessoas()` (`lib/pessoas.ts`, cacheado), que lê todos os `passageiros` mais `listarExpedicoes()` e serve para "Nª expedição" (`construirPosicoesFidelidade`).
- **Sem realtime próprio**: recarrega quando o `exp` muda, ou seja, quando o cabeçalho recarrega.
- **Cartões**:
  1. "Próximos prazos (7 dias)", só em expedição: itens do checklist com prazo entre 0 e 7 dias, não concluídos.
  2. "Prontidão de embarque": Aptos / Atenção / Bloqueados. Os botões levam a `…/passageiros`.
  3. "Documentos pendentes": os 5 primeiros com checagem `atencao|bloqueio`. O clique leva a `…/passageiros/prontidao/<paxId>`.
  4. "Resumo": passageiros (confirmados), prontidão, checklist concluídos/total e `exp.observacoes`.
  5. "Momentos especiais": marcos de fidelidade (3ª, 5ª e 10ª, `lib/fidelidade.ts MARCOS_FIDELIDADE`), aniversariantes do mês (`aniversarioNoMesDaExpedicao`) e estreantes (posição 1).
- **Ações que gravam**: nenhuma. Só navega.

### 3.2 Passageiros (`detalhe/abas/AbaPassageiros.tsx` → `passageiros/PainelPassageiros.tsx`)

Arquivos: `passageiros/dados.ts`, `Criar.tsx`, `EditarPassageiro.tsx`, `PerfilPax.tsx`, `Prontidao.tsx`, `blocos.tsx`, `SaudeCampos.tsx`, `pecas.tsx`, `exportar.ts`, mais `lib/prontidao/*`, `lib/csv/passageiros-import.ts` e `lib/fidelidade.ts`.

**Dados** (`dados.ts → carregarAba(expId)` devolve `DadosAba`):
- `passageiros`, `arquivos`, `quartos` e `grupos_expedicao` por `expedicao_id`;
- `passageiro_requisitos` por `passageiro_id`;
- `passageiro_quarto` por `quarto_id`;
- os `arquivos` de outra expedição que são referenciados (foto/passaporte/requisito);
- URLs assinadas das fotos (`storage.createSignedUrls`, 1 h);
- além disso, `listPessoas()` (Nª expedição) e `souAdmin()` (`rpc exp_eh_admin`).

**Realtime**:
- `passageiros`, `arquivos`, `grupos_expedicao` e `quartos` filtrados por expedição, com espera de 400 ms;
- `passageiro_requisitos` e `passageiro_quarto` sem filtro, com espera de 2 s.

**Tela**:
- KPIs: Total, Confirmados, Pré-reserva, Leads, Aptos, Atenção, Bloqueados e "Formulário pendente: N".
- **Tabela "👑 Líderes"** separada ("não contam na ocupação") e tabela "ExpedAmigos".
- Colunas: ID (#seq por `created_at`), Nome (foto, `SeloFidelidade`, `SeloSemFicha`, 🎂), Tipo, Grupo (só se houver G1/G2), CPF, Passaporte, Validade, Quarto, Status, Prontidão e Formulário.
- Ordenação clicando no cabeçalho.
- Busca por nome, CPF e passaporte.
- Pílulas de `STATUS_RESERVA` e de `TIPO_PASSAGEIRO`, e o filtro "Formulário pendente".

**Ações** (todas escondidas em modo leitura, salvo Exportar):

| Ação | Grava em |
|---|---|
| Editar CPF / Passaporte / Validade na célula (`CelulaEditavel`) | [RPC `exp_atualizar_passageiro`] (`p_id`, `p_patch`). Os campos pessoais propagam para todas as reservas da pessoa |
| Trocar Tipo / Status na célula (`CelulaEscolha`) | [RPC `exp_atualizar_passageiro`] |
| Quarto do 1º trecho (select) | `alocarNoTrecho`: [W `passageiro_quarto`] delete do trecho + insert (direto, sem RPC) |
| Grupo G1/G2 por linha (só admin) | `definirGrupoDoPax`: [W `passageiros.grupo_id`] |
| "Adicionar divisão por grupos" / "Remover divisão" (admin, não em pacote) | [RPC `exp_ativar_divisao`] / [RPC `exp_remover_divisao`] |
| "↻ Atualizar do Bitrix" | `POST /api/expedicoes?acao=sincronizar-bitrix` (`chamarRotaExpedicoes`): o servidor cria e atualiza `passageiros` |
| "Exportar" | [EXP] `.xlsx` via exceljs (`exportar.ts → exportarPassageiros`) |
| "Importar" (CSV: arquivo ou colado, com "Baixar modelo") | `parsePassageirosCSV` + [RPC `exp_importar_passageiros`] |
| "Adicionar existente" (base de pessoas) | [RPC `exp_adicionar_existente`] |
| "Adicionar" (novo) | `criarPassageiro`: [W `passageiros` insert]. A unicidade de CPF por expedição vem do índice `ux_passageiros_expedicao_cpf` |
| Clicar no nome | abre a gaveta `…/pax/<id>` |
| Clicar no selo de prontidão | abre `…/prontidao/<id>` |

**Gaveta do pax** (`EditarPassageiro.tsx`), com as abas Passageiro | Prontidão | Saúde | Cliente:

| Ação | Grava em |
|---|---|
| "Salvar alterações": nome, tipo, status, cpf, telefone, passaporte, validade, nascimento, email, observações, emergência, endereço, `saude` (jsonb) | [RPC `exp_atualizar_passageiro`]. Se mudou o certificado de vacina, também [RPC `exp_espalhar_vacina`] |
| Bloco Valores (`valores/PainelValores.tsx → BlocoValoresPax`) | [RPC `exp_pax_salvar_valores`] |
| Anexar/remover passaporte (`blocos.tsx → PassaporteAnexo`) | [ST] + [W `arquivos`] (categoria "Documentos pessoais", descrição "Passaporte — prontidão") + [RPC `exp_atualizar_passageiro`] `passaporte_arquivo_id` |
| Drive do pax (`drive/Drive.tsx` com `passageiroId`, pastas `PASTAS_PAX` = todas menos "Documentos pessoais") | [ST] + [W `arquivos`]: upload (inclusive arrastando), renomear/mover pasta, apagar e baixar |
| Passeios opcionais / Extensões (checkbox) | [W `passeio_opcional_compras`] / [W `passageiro_extensao`] (upsert/delete) |
| "Liberar ExpedAmigo" / "Bloquear" (admin) | [W `passageiros.liberado_expedamigo`]. Se não houver senha: [RPC `exp_pessoa_senha_estado`] e [RPC `exp_pessoa_senha_nova`] (`paginas/_globais/pessoaAcoes.ts`) |
| "Mudar de expedição" | [RPC `exp_mover_passageiro`] |
| "Remover desta expedição" | [RPC `exp_remover_passageiro`], que devolve `"apagado"` ou `"avulso"` |
| Aba Cliente (`src/clientes/BlocoFichaCliente.tsx`) | componente externo da ficha única (0172/0173). As escritas ficam nele (não foi mapeado aqui) |
| "Abrir página completa" | `…/pax/<id>/perfil` (`PerfilPax.tsx`: só leitura, mais Liberar ExpedAmigo e o Drive) |

**Prontidão** (`Prontidao.tsx`, usada na gaveta e na aba Prontidão):

| Ação | Grava em |
|---|---|
| "Gerar requisitos de <destino>" (quando o pax não tem nenhum) | [RPC `exp_gerar_requisitos`] (`p_expedicao`) |
| Clicar numa exigência sem instância | `criarInstancia`: [W `passageiro_requisitos` insert] |
| Gaveta do requisito → Salvar (status, validade, número/localizador, responsável, observações; "É necessário?" → Dispensado; "Aéreo comprado com a gente?" vai para observações) | `salvarRequisito`: [W `passageiro_requisitos` update]. Se o status for Aprovado, Reprovado ou Dispensado, carimba `verificado_em` |
| Anexar ou apagar evidência (passaporte, aéreos, seguro, vacina, ingressos) | [ST] + [W `arquivos`] + `arquivo_id` do requisito (ou `passageiros.passaporte_arquivo_id`). Vacina também [RPC `exp_espalhar_vacina`] |
| Gaveta Contrato: checkbox "Contrato assinado" + Drive na pasta "Contrato" | [RPC `exp_atualizar_passageiro`] `contrato_assinado` + [ST]/[W `arquivos`] |

**Respostas pedidas pela spec**:
- **Requisitos e prontidão por passageiro**:
  - estão em `passageiro_requisitos` (`PassageiroRequisitoRow`: tipo, descricao, status, obrigatoriedade, bloqueia_embarque, validade, numero, arquivo_id, responsavel_id, verificado_em, verificado_por, observacoes);
  - a regra fica em `lib/prontidao/regras.ts → avaliarProntidao({passageiro, expedicao, destino, requisitos})`, que devolve `{prontidao: Apto|Atenção|Bloqueado, checagens[]}` com semáforo `ok|atencao|bloqueio|na`;
  - o catálogo por destino é `lib/prontidao/requisitos-destino.ts`;
  - "Contrato" e "Dados Pessoais" são derivados de colunas (`REQUISITOS_DE_COLUNA`). Passaporte é híbrido: validade/número na coluna mais o anexo `passaporte_arquivo_id`;
  - a migration 0220 dá **baixa automática** no banco (`_exp_requisitos_baixa`) para Passaporte, Aéreo Internacional e Aéreo Doméstico.
- **Formulário**: `dados.ts → preencheuFormulario(p)` dá `true` quando `perfil_viajante.confirmou_veracidade` está marcado, ou quando há algum campo do perfil preenchido (profissao, descricao_grupo, anima_expedicao, significado, instagram, camiseta, musica), ou quando `inscricao_origem === "Formulário público"`.
- **Seguro / apólice**: não existe coluna de apólice no passageiro. Hoje o seguro por passageiro é o **requisito `tipo="Seguro"`** em `passageiro_requisitos`:
  - "Seguro contratado?" com Não grava `status="Dispensado"`;
  - o anexo da apólice fica na categoria `"Seguros"`, com `arquivo_id` apontando para `arquivos`;
  - quando há anexo, o status vira "Aprovado"; sem anexo, "Pendente".
  - Para o seguro, a gaveta **não mostra** o campo número/validade (só o genérico mostra).
  - Existe também a tabela legada `documentos` (`DocumentoRow`: `seguro_status`, `apolice_url`, `visto_necessario`, `status_visto`), que **só é lida** na aba Documentos. Nenhum código do QS grava nela.
- **"Nª expedição"**: `lib/fidelidade.ts → construirPosicoesFidelidade(pessoas, expId)`. Ordena as participações não canceladas da pessoa por `data_embarque` e devolve a posição por `passageiro_id`. As pessoas vêm de `lib/pessoas.ts → listPessoas()` (identidade por `chaveIdentidade`: cpf / bitrix_contact_id / email / nome). O selo é `pecas.tsx → SeloFidelidade`, que só aparece de 2 em diante.
- **Mensagem de cobrança**: **não existe** disparo nas Expedições. Os dois pontos mais próximos são:
  - `paginas/AcessosAmigo.tsx`, que monta a mensagem de boas-vindas para **copiar** ("Nada é enviado daqui");
  - as campanhas do Relacionamento (`src/rel/disparos/DisparosPage.tsx` + `src/rel/lib/disparos.ts`, tabelas `rel_campanhas` e `rel_envios`), com o público `tipo:"viagem"` e o filtro texto `expedicao` ("Expedição (contém)"), destino e período de embarque. Esse público **não filtra por pendência** (formulário/seguro).
- **Passaporte "vence cedo"**: há regras divergentes no código.
  - `regras.ts → checarPassaporte` marca **atenção** se a validade for menor que `data_retorno + 6 meses` (`MESES_VALIDADE_PASSAPORTE_PADRAO`);
  - `PainelPassageiros.tsx` (célula Validade) e `AbaDocumentos.tsx` usam **embarque + 180 dias**;
  - a spec pede "6 meses após a volta", que coincide com `regras.ts`.

### 3.3 Valores (`detalhe/abas/AbaValores.tsx` → `valores/PainelValores.tsx`)

Arquivos: `valores/dados.ts`, mais a migration `supabase/migrations/0220_ops_valores_e_preenchimento_cliente.sql`. O cabeçalho do arquivo diz "NADA aqui foi executado"; a memória do projeto registra 0220 como aplicada em 28/10. A tela tem fallback: sem as colunas novas, lê só as antigas, mostra um banner e desliga a edição (`migracao=false`).

**Colunas**:
- `passageiros`:
  - `valor_contratado_brl` e `valor_pago_brl`;
  - `saldo_brl`, gerado (contratado − pago);
  - `status_financeiro`, calculado por trigger: `Sem valor` / `Em aberto` / `Parcial` / `Quitado`;
  - colunas da 0220: `condicao_pagamento` (`padrao|sem_aereo|expedamigo|especial`, default `padrao`), `condicao_obs` (obrigatória se a condição for especial), `valor_atualizado_em`, `valor_atualizado_por` e `valor_atualizado_por_nome`.
- `expedicoes`: `preco_venda_brl` (com aéreo) e `preco_sem_aereo_brl` (0220).
- `exp_valor_historico` (0220): uma linha por mudança (campo, antes, depois, usuario_nome, criado_em).

**Dados** (`carregarValores`):
- `passageiros` (colunas de valor);
- [RPC `exp_valores_financeiro`] (`p_exp`): plano em `fin_planos`/`fin_parcelas` por passageiro (recebido, a receber, próximo vencimento);
- `exp_valor_historico` (as 60 mais recentes).
- Realtime: `passageiros expedicao_id=eq`, 500 ms.

**Tela**:
- Cartões Vendido, Recebido e A receber;
- "Preço com aéreo" e "Preço sem aéreo" editáveis;
- pílulas de filtro Todos / Sem valor / Em aberto / Parcial / Quitado, com contagem;
- busca;
- tabela com Cliente, Condição, Contratado, Pago, Saldo, Status, Financeiro e Última mudança;
- histórico recolhível.

**Ações**:

| Ação | Grava em |
|---|---|
| Editar "Preço com aéreo" / "Preço sem aéreo" | `salvarPrecoReferencia`: [W `expedicoes.preco_venda_brl` / `preco_sem_aereo_brl`] |
| Condição (select) / texto da condição especial | [RPC `exp_pax_salvar_valores`] (`p_pax`, `p_patch`) |
| Contratado / Pago (célula) | [RPC `exp_pax_salvar_valores`] |
| "usar R$ X" (preço sugerido pela condição, `precoSugerido`) | [RPC `exp_pax_salvar_valores`] `valor_contratado_brl` |
| "usar recebido como pago" (quando há plano no Financeiro) | [RPC `exp_pax_salvar_valores`] `valor_pago_brl` |
| Ver histórico | só leitura |

**Como saber "passageiro sem valor"**:
- pela coluna: `status_financeiro = 'Sem valor'`;
- ou pela regra pura `valores/dados.ts → statusFin(contratado, pago) === "Sem valor"`, isto é, `valor_contratado_brl <= 0` e `valor_pago_brl <= 0`. A tela usa a regra pura;
- os totais vêm de `totais(pax)` (`porStatus["Sem valor"]`), que **exclui só os cancelados**;
- **Líder e Cortesia contam como "Sem valor"**. Não existe tratamento "Isento" hoje;
- **Não existe** botão "aplicar preço padrão a todos": só o "usar R$ X" por linha.

### 3.4 Rooming (`detalhe/abas/AbaRooming.tsx` → `rooming/RoomingBoard.tsx`)

Arquivos: `rooming/dados.ts`, `calculos.ts`, `Gavetas.tsx`, `exportar.ts` e `lib/rooming/acompanhante.ts`. Oculta em pacote.

**Tabelas**:
- `quartos`: `QuartoRow` com id, expedicao_id, numero, tipo (`Single|Duplo|Twin|Triplo|Compartilhado|Líder`, capacidade em `CAPACIDADE_QUARTO`), **hotel_cidade, check_in, check_out**, status (`ativo`/`cancelado`), observacoes e extensao_id;
- `passageiro_quarto` (`AlocacaoQuartoRow`): passageiro_id e quarto_id;
- `extensoes` e `passageiro_extensao` (quem contratou a extensão);
- `grupos_expedicao` (G1/G2);
- `passageiros`, incluindo `conexao_viagem_id`, `acompanhante_nome` e `acompanhante_divide_quarto`.

**Hotéis com datas**: sim, mas **por quarto**. Não existe tabela de hotel. Um "hotel/trecho" é o agrupamento por `hotel_cidade + check_in + check_out + extensao_id` (`rooming/calculos.ts → chaveTrecho`; também `passageiros/dados.ts → trechosDe`). `calcularRooming` devolve:
- `trechos`;
- `pendencias` (faltam por trecho), `totalFaltam` e `semQuarto(t)`;
- `conexoes` e `conexoesSeparadas`;
- `acompanhantes` (indicados, com o candidato sugerido);
- `completo`.

A contagem "x/y alocados" por hotel sai de `paxRelevantes(t)` − `semQuarto(t)`.

**Dados**: `carregarRooming(expId)`. Realtime:
- `quartos`, `passageiros`, `extensoes` e `grupos_expedicao` filtrados por expedição, com espera de 500 ms;
- `passageiro_quarto` e `passageiro_extensao` sem filtro, com espera de 2 s.

**Ações** (todas pelas RPCs da 0168):

| Ação | RPC |
|---|---|
| Arrastar pax para quarto (dnd-kit; a conexão vai junta; checa capacidade e extensão) | `exp_rooming_alocar` (`p_pax[]`, `p_quarto`) |
| Arrastar para "sem quarto" | `exp_rooming_desalocar` |
| "Juntar" conexão separada | `exp_rooming_alocar` |
| "Criar quartos automáticos" / "Novo quarto" / "Adicionar quarto" (no hotel) | `exp_rooming_criar_quartos` |
| Editar quarto (tipo, hotel, datas, extensão, status, observações) | `exp_rooming_atualizar_quarto` |
| Excluir quarto / "Excluir hotel" | `exp_rooming_excluir_quartos` |
| Renomear hotel | `exp_rooming_renomear_hotel` |
| Editar datas do hotel (check-in/out) | `exp_rooming_redatar_hotel` |
| Renumerar 1..n | `exp_rooming_renumerar_hotel` |
| Duplicar hotel / quarto (com os mesmos pax) para outro hotel | `exp_rooming_duplicar` |
| "Nova conexão" / editar conexão ("viajam juntas") / "Vincular" acompanhante indicado | `exp_rooming_conexao` (grava `passageiros.conexao_viagem_id`) |
| "Desfazer" conexão | `exp_rooming_desfazer_conexao` |
| "Exportar Excel" (bloqueado se o rooming não estiver completo) | [EXP] `rooming/exportar.ts → exportarRoomingExcel` |
| Recolher/expandir hotel, painéis "Conexões" e "Acompanhantes" | só UI |

Observação: a coluna Quarto de Passageiros também grava `passageiro_quarto`, mas direto (delete/insert, `alocarNoTrecho`), sem RPC.

### 3.5 Checklist (`detalhe/abas/AbaChecklist.tsx`)

Arquivos: `checklist/dados.ts`, `Visoes.tsx` (Triagem, ChipsFases, Tabela, Grafico, Kanban), `GavetaTarefa.tsx` e `lib/processos/template.ts`. Oculta em pacote.

- **Tabela**: `checklist_itens` (`ChecklistItemRow`: etapa, tarefa, responsavel_id, status `Pendente|Em andamento|Atenção|Concluído|Bloqueado`, prazo, prioridade `Baixa|Média|Alta|Crítica`, dependencia_id, parent_id para subtarefa, ordem, evidencia_url, bitrix_task_id, observacoes).
- As fases ficam em `lib/constants.ts → ETAPA_CHECKLIST`/`FASES_CHECKLIST`. A fase atual vem de `faseAtualChecklist(daysUntil(embarque))`.
- **Realtime**: `checklist_itens expedicao_id=eq`, 300 ms.
- **Ações**:

| Ação | Grava em |
|---|---|
| "✦ Gerar checklist padrão" (vazio) | [RPC `exp_gerar_checklist`] (23 processos + subtarefas) |
| "+ Nova tarefa" / "+ Tarefa avulsa" / "＋" subtarefa | `criarTarefa`: [W `checklist_itens` insert] |
| "✎ Editar" (gaveta) | `salvarVarios`: [W update]. Troca de fase: [RPC `exp_checklist_mover_etapa`] |
| Editar na célula: tarefa, prazo, prioridade, status, observações, responsável | `salvarCampo`: [W update] |
| Arrastar ⠿ (Timeline) para reordenar dentro da fase / do pai | [RPC `exp_reordenar_checklist`] |
| Status no Gráfico | `salvarCampo` |
| Excluir tarefa (subtarefas em cascata) | [W delete] |
| Visões Timeline / Gráfico / Kanban | só UI. O Kanban é só leitura (sem arrastar) |

- Ao **criar** uma expedição (não pacote), `NovaExpedicao` já gera o checklist dentro de [RPC `exp_criar_expedicao`].

### 3.6 Documentos (`detalhe/abas/AbaDocumentos.tsx`)

- **Bloco 1: "Drive da expedição"**, `drive/Drive.tsx` com `expedicaoId` e sem passageiro. Lista `arquivos` com `expedicao_id=X` e `passageiro_id is null`. Realtime em `arquivos expedicao_id=eq`.
- **Categorias** (`lib/constants.ts → CATEGORIA_ARQUIVO`, enum `categoria_arquivo` da 0160): **Aéreos, Documentos pessoais, Contrato, Bilhetes, Vistos, Seguros, Hospedagem, Vouchers, Cartão de embarque, Outros**. São as mesmas 10 da spec 3.7.
- Arquivos "de sistema" ficam marcados por `descricao` (`drive/arquivos.ts`):
  - `arquivoProtegido`: "Documento do líder" (`MARCADOR_DOC_LIDER`) e ingressos de Machu Picchu não podem ser apagados pelo Drive;
  - `usadoNoPortal`: "Foto roteiro", "Foto passeio opcional", "Voucher hospedagem", "Voucher", "Voucher da hospedagem", "PDF 1" e "PDF 2", que mostram um aviso ao apagar.
  - Esses arquivos de sistema caem em "Outros" ou "Vouchers", o que **infla a pasta "Outros"**.
- **Ações do Drive**:

| Ação | Grava em |
|---|---|
| Enviar (botão ou arrastar; vai para a pasta aberta, ou "Outros" se a pasta for "Todos"; até 15 MB; MIME permitidos; imagem comprimida) | [ST upload] + [W `arquivos` insert] |
| Renomear / mover de pasta | [W `arquivos` update `nome`, `categoria`] |
| Apagar | [W `arquivos` delete] + [ST remove] |
| Ver (imagem em modal; PDF em nova aba) / Baixar | URL assinada (`linkDoArquivo`) |
| Busca por nome/descrição; chips de pasta com contagem | só UI |

- **Bloco 2: "Status de documentos por passageiro"**, só leitura.
  - Lê `passageiros` e a tabela legada **`documentos`** (`visto_necessario`, `status_visto`, `seguro_status`, `apolice_url`). Realtime em `passageiros` (filtrado) e `documentos` (sem filtro), 800 ms.
  - Status geral: sem passaporte ou validade menor que embarque + 180 d → Crítico; `seguro_status !== "Emitido"` ou visto pendente → Pendente; caso contrário, OK.
  - "Anexar no perfil" e o nome do pax levam a `ir("expedicoes", …/passageiros/pax/<id>)`. **Bug**: a tela está fixa em `"expedicoes"`, então num pacote o link aponta para a tela errada.
  - Essa tabela usa `documentos` e **não** `passageiro_requisitos`, por isso pode divergir da Prontidão.

### 3.7 Links (`detalhe/abas/AbaLinks.tsx`)

- Arquivos: `links/dados.ts` e `links/Componentes.tsx`.
- **Tabela**: `links_expedicao` (label, url, ordem). Realtime filtrado, 300 ms. O portal `/amigo` lê os mesmos links.
- **Ações**:

| Ação | Grava em |
|---|---|
| "+ Novo link" / "+ Adicionar primeiro link" (com sugestões de rótulo) | [W `links_expedicao` insert] |
| Editar | [W update] |
| Excluir | [W delete] |
| Arrastar para reordenar (dnd-kit) | [RPC `exp_reordenar_links`] |
| Copiar URL | clipboard |

### 3.8 Divisões, id `grupos` (`detalhe/abas/AbaGrupos.tsx`)

- Arquivos: `divisoes/dados.ts` e `divisoes/Componentes.tsx`. Oculta em pacote.
- **Dados**: `grupos_expedicao` (nome, data_embarque, data_retorno, pax_planejados, observacoes, ordem), `listarPassageirosDe` e `expedicao_voos` (contagem por `grupo_id`).
- **Realtime**: `grupos_expedicao`, `passageiros` e `expedicao_voos`, todos filtrados.
- **Ações**:

| Ação | Grava em |
|---|---|
| "+ Adicionar" grupo | [W `grupos_expedicao` insert] |
| Editar nome / embarque / retorno / pax planejados / observações (célula) | [W `grupos_expedicao` update] |
| Remover grupo | [W delete] |
| Arrastar cartões para reordenar | [RPC `exp_reordenar_grupos`] |
| "Adicionar divisão por grupos" / "Remover divisão" (admin) | [RPC `exp_ativar_divisao`] / [RPC `exp_remover_divisao`] (apaga só G1 e G2) |
| Membros: select do grupo por passageiro; checkbox "Mostrar cancelados" | `definirGrupoDoPax`: [W `passageiros.grupo_id`] |

### 3.9 ExpedAmigo, id `portal` (`detalhe/abas/AbaPortal.tsx`)

- Arquivos: `portal/dados.ts`, `Secao.tsx`, `RoteiroInline.tsx`, `Anexos.tsx`, `LiberarTodos.tsx` e `lib/portal-voos.ts`.
- Em modo leitura, só mostra um aviso (nem carrega).
- **Sem realtime**: recarrega depois de cada ação.
- **Dados** (`carregarPortal`): `roteiro_dias`, `expedicao_voos`, `expedicao_passeios`, `expedicao_info`, `expedicao_avisos`, `roteiro_dia_fotos`, `passeios_opcionais`, `extensoes`, `grupos_expedicao`, `arquivos` e `expedicoes.hospedagem_voucher_arquivo_id`. Além disso, `rpc exp_eh_admin`.
- **Seções e ações** (`criarItem`/`atualizarItem`/`excluirItem` filtram as colunas por tabela em `COLUNAS`):

| Seção | Ações | Grava em |
|---|---|---|
| **Liberar para todos** (só admin) | botão; mostra as senhas provisórias | [RPC `exp_liberar_expedamigo_todos`] (0170) |
| **Voucher da hospedagem** | anexar / remover | [ST]/[W `arquivos`] + `definirVoucherHospedagem`: [W `expedicoes.hospedagem_voucher_arquivo_id`] |
| **Extensões da viagem** | adicionar, editar (nome, descrição), excluir, voucher de hospedagem da extensão | [W `extensoes`] + [ST]/[W `arquivos`] (`hospedagem_voucher_arquivo_id`) |
| **Roteiro dia a dia** (`RoteiroInline`) | "Adicionar dia", editar inline (dia, data, título, descrição, cidade, refeições, hospedagem, segmento de extensão), **duplicar dia**, excluir dia (leva as fotos junto), enviar e remover fotos, até 3 passeios opcionais por dia (título, descrição, tipo opcional/adicional, WhatsApp, foto) | [W `roteiro_dias`], [W `roteiro_dia_fotos`], [W `passeios_opcionais`], [ST]/[W `arquivos`] ("Foto roteiro" / "Foto passeio opcional") |
| **Voos de grupo** | adicionar, editar (trecho, companhia, nº, localizador, origem, destino, partida, chegada, observações, grupo, segmento), excluir, voucher | [W `expedicao_voos`] + [ST]/[W `arquivos`] |
| **Passeios e ingressos** | adicionar, editar (nome, data, horário, local, observações), excluir, voucher | [W `expedicao_passeios`] + [ST]/[W `arquivos`] |
| **Informações do destino** | adicionar, editar (título, conteúdo), excluir, PDF 1 e PDF 2 com rótulo | [W `expedicao_info`] + [ST]/[W `arquivos`] |
| **Avisos e boas práticas** | adicionar, editar (tipo Aviso/Boa prática/Dica, título, conteúdo), excluir | [W `expedicao_avisos`] |

- O "Liberar" **individual** fica na gaveta do pax (§3.2).
- Os **Documentos do líder** **não** estão aqui: estão na aba Roteiro do Líder (§3.10).
- Atenção para os dois roteiros:
  - **`roteiro_dias`** é o roteiro do portal do viajante (tem `titulo`, `cidade`, `hospedagem`);
  - **`roteiro_lider_dias`** é o roteiro do líder (§3.10).
  - São tabelas diferentes e sem ligação entre si.

### 3.10 Roteiro do Líder (`detalhe/abas/AbaRoteiroLider.tsx` + `roteiro-lider/DocsLider.tsx`)

Oculta em pacote. É lido pela Área do Líder (`/lider`, no app antigo) por `ordem` e depois por `dia`.

**Modelo do dia**: tabela `roteiro_lider_dias` (migration 0160, linhas 475–493; tipo `RoteiroLiderDiaRow` em `lib/database.ts`).

| Coluna | Tipo | Na tela |
|---|---|---|
| `id` | uuid | — |
| `expedicao_id` | uuid (FK, cascade) | — |
| `dia` | integer, default 1, not null | "Dia" (badge DIA N) |
| `data` | date | "Data" |
| `fase` | text | "Fase / região" (ex.: TÓQUIO) |
| `local` | text | "Local" (cidade) |
| `programacao` | text | "Programação" (texto principal; **não há coluna `titulo`**) |
| `lideres_ativos` | text (nomes separados por "·") | "Líderes ativos" |
| `pax` | text (aceita "18 → 25") | "Pax" |
| `observacoes` | text | "Observações" (salva, mas **não aparece** na lista) |
| `alerta_nivel` | text livre; a UI oferece `""`, `Crítico`, `Atenção`, `Verificar` | "Nível" (🔴🟠🟡) |
| `alerta_texto` | text | "Descrição do alerta" |
| `alerta_acao` | text | "Ação necessária" (este é o campo "Ação" da spec) |
| `alerta_responsavel` | text livre | "Responsável" (ex.: "Operações + DMC"). É o mais próximo de "setor responsável" |
| `ordem` | integer, default 0 | ordem de exibição |
| `created_at`, `updated_at` | timestamptz | — |

- **Status/baixa da ação: NÃO EXISTE.** Não há `resolvida_em`, `resolvida_por` nem qualquer status (busquei "resolvid" em `src/expedicoes` e nas migrations: nada referente a esta tabela).
- O alerta é só nível + texto + ação + responsável. Salvar com nível vazio **apaga** texto, ação e responsável (`FormDia.salvar`, `semAlerta`).
- Não existe tag "OK" nem "Hoje": seriam derivadas (dia de hoje = `data === hoje`).

**Dados**: `supabase.from("roteiro_lider_dias").select("*").eq("expedicao_id").order(ordem, dia, created_at)`. **Sem realtime**.

**Ações**:

| Ação | Grava em |
|---|---|
| "Adicionar dia" (gaveta `FormDia`; dia sugerido = maior + 1; ordem = maior + 1) | [W `roteiro_lider_dias` insert] |
| Editar (✎) | [W update] |
| ▲ / ▼ (reordenar) | [W update `ordem`], linha a linha (regrava 0..n-1; sem RPC) |
| Excluir dia | [W delete] |

**DocsLider** (topo da aba, "Documentos da Área do Líder"):
- Lê `arquivos` com `passageiro_id is null` e `descricao = "Documento do líder"`. Realtime em `arquivos`.
- Ações:
  - "Adicionar PDF": [ST] + [W `arquivos`] com categoria "Outros" e descrição `MARCADOR_DOC_LIDER`;
  - "Ver";
  - remover: [W delete] + [ST remove].

---

## 4. Lista (`lista/ExpedicoesLista.tsx` + `lista/FormExpedicao.tsx`)

> **Desde 29/10 (redesign):** `#ops/expedicoes` abre a **Central** (`lista/central/`, seção 7). `ExpedicoesLista` continua servindo só os **Pacotes** (`#ops/pacotes`). O que segue descreve a lista antiga; a seção 7.1 diz onde cada ação dela ficou.

- **Dados**: `listarExpedicoes(tipo)` (`lib/banco.ts`, cacheado, `order ordem, data_embarque`) → `agregarExpedicoes` (os mesmos números do cabeçalho). Realtime: `expedicoes`, 300 ms.
- **Agrupamento** por ano de embarque: anos futuros em ordem crescente primeiro, depois os passados em ordem decrescente, e "Sem data" no fim. Dentro do ano, as ativas vêm antes das concluídas/canceladas. Cada ano mostra uma contagem por status.
- **Ações e controles**:

| Ação | Detalhe / grava em |
|---|---|
| "+ Nova expedição" / "+ Novo pacote" e atalho **`n`** (fora de input, não em modo leitura) | `NovaExpedicao`: código gerado (`generateExpedicaoCodigo(destino, embarque)`; pacote = `PAC-<base>-<sufixo>`) → [RPC `exp_criar_expedicao`] (`p_exp`, `p_itens` = checklist padrão; pacote vai sem itens). Campos: nome, destino (com sugestões), embarque, retorno, pax planejados, resp. op., resp. com. Depois de criar, abre o detalhe |
| Busca e atalho **`/`** (`ui.tsx → Busca`) | código, nome e destino |
| Filtros | Status (multi), Destino (multi), Período (Todas / 30 / 60 / 90 dias / Este ano), Resp. Op e "Limpar filtros" |
| Visão **Cards** / **Tabela** | só UI (não persiste) |
| **★ Próxima** | a ativa (não Concluída nem Cancelada) com o menor `daysUntil(embarque) >= 0` dentro do filtro. Recebe borda (card) ou fundo (linha) |
| Editar (lápis no card ou ✎ na tabela) | `EditarExpedicao` (§2.2) |
| Mudar status na tabela (`CelulaEscolha`) | `salvarCampoExpedicao`: [W `expedicoes.status`]. Se for "Concluída", `aoConcluir` |
| Excluir (só na tabela) | [W `expedicoes` delete]. Segundo a confirmação, passageiros, custos, pagamentos e checklist vão em cascata |
| Arrastar ⠿ para reordenar (só tabela, dentro do ano) | [RPC `exp_reordenar`] (`p_ids` = ordem global) |
| Clicar no card ou na linha | `ir(tela, id)` |

- **Card**: degradê, status, dias, ★, nome, destino, anel de ocupação (`pax_confirmados/pax_planejados`), anel de aptos, datas e código.
- **Colunas da tabela**: ⠿, Nome+código, Destino, Embarque ("em Nd", laranja se < 30), Retorno, Status, Pax, Checklist (barra; "—" em pacote), Prontidão, ações.

**Campos de `expedicoes`** (`lib/database.ts → ExpedicaoRow`):

| Grupo | Campos |
|---|---|
| Identificação | `id`, `codigo`, `nome`, `destino`, `tipo?` (`expedicao`/`pacote`, 0060) |
| Datas | `data_embarque`, `data_retorno` |
| Responsáveis | `responsavel_operacional_id`, `responsavel_comercial_id`, `dmc_principal_id` |
| Status e vagas | `status`, `pax_planejados`, `pax_cortesia` |
| Preços | `preco_venda_brl`, `preco_sem_aereo_brl?` (0220) |
| Integrações e arquivos | `bitrix_pipeline_id`, `hospedagem_voucher_arquivo_id?` (0030) |
| Outros | `observacoes`, `ordem`, `viagem_grupo?` (0029), `grupo_rotulo?`, `created_at`, `updated_at` |

**Status possíveis** (`lib/constants.ts → STATUS_EXPEDICAO`): `Planejamento`, `Vendas Abertas`, `Em andamento`, `Concluída` e `Cancelada`. Não existe status de "fase" (Vendas, Preparação, Embarque, Em viagem, Pós-viagem).

---

## 5. Aba antiga → nova aba (spec 3.2) → ações que precisam ir junto

| Aba antiga (id) | Nova aba | Ações / peças que não podem sumir |
|---|---|---|
| Visão Geral (`""`) | **Visão geral** | prazos de 7 dias, prontidão (Aptos/Atenção/Bloqueados → Passageiros), top 5 de documentos pendentes (→ `passageiros/prontidao/<id>`), resumo + observações, momentos especiais |
| Passageiros (`passageiros`) | **Passageiros** | edição inline (CPF, passaporte, validade, tipo, status, quarto, G1/G2), ativar/remover divisão, Atualizar do Bitrix, Exportar xlsx, Importar CSV, Adicionar existente, Adicionar, filtros (status, tipo, formulário pendente), busca, ordenação, seção de Líderes; gaveta do pax completa (salvar, valores, passaporte, Drive do pax, passeios/extensões, liberar ExpedAmigo + senha, mudar de expedição, remover, Saúde, Cliente, página "perfil"); prontidão (gerar requisitos, gaveta do requisito, anexos, contrato). Endereços `pax/<id>`, `pax/<id>/perfil` e `prontidao/<id>` |
| Documentos (`documentos`), **bloco 2** (status por pax) | **Passageiros** (spec: "status de documentos por passageiro") | só leitura; lê a tabela legada `documentos` (visto, seguro, apólice). Decidir se continua lendo `documentos` ou passa para `passageiro_requisitos` |
| Valores (`valores`) | **Financeiro** | preço com aéreo / sem aéreo, condição + texto especial, contratado, pago, "usar R$ X", "usar recebido como pago", filtros Sem valor/Em aberto/Parcial/Quitado, busca, histórico; badge "!" = existe `statusFin(...)==="Sem valor"` entre os não cancelados |
| Rooming (`rooming`) | **Logística**, seção Hospedagem | todo o quadro dnd (alocar, desalocar, juntar, criar automático/novo/adicionar, editar quarto, excluir quarto/hotel, renomear, redatar, renumerar, duplicar, conexões, vincular acompanhante, desfazer, Exportar Excel) |
| Roteiro do Líder (`roteiro-lider`), lista de dias | **Logística**, seção Roteiro do líder | adicionar, editar, ▲▼, excluir dia; formulário completo com alerta |
| Roteiro do Líder, **DocsLider** | **Portal** (spec: "Documentos da área do líder") | adicionar PDF, ver, remover (marcador `Documento do líder`) |
| Divisões (`grupos`) | **Logística**, seção recolhível | criar, editar inline, remover, reordenar, ativar/remover divisão, membros por grupo |
| Checklist (`checklist`) | **Logística**, seção recolhível | gerar padrão, nova tarefa/subtarefa/avulsa, editar (gaveta + células), mover fase, arrastar, excluir, visões Timeline/Gráfico/Kanban, triagem, chips de fase |
| Documentos (`documentos`), **bloco 1** (Drive) | **Arquivos** | upload (botão e arrastar), pastas com contagem, busca, ver, baixar, renomear/mover, apagar (com as proteções de sistema/portal) |
| Links (`links`) | **Arquivos** (seção) | novo, editar, excluir, reordenar arrastando, copiar |
| ExpedAmigo (`portal`) | **Portal** | liberar para todos (admin), voucher da hospedagem, extensões (+ voucher), roteiro dia a dia (dias, fotos, passeios opcionais, duplicar), voos de grupo, passeios e ingressos, informações do destino (PDF 1/2), avisos |

Ocultas em pacote hoje: rooming, checklist, roteiro-lider e grupos. Em pacote, Logística ficaria vazia (ou só com Rooming, se ele for liberado para pacote, o que hoje não acontece). Redirects pedidos pela spec, no formato `?aba=`: `rooming|checklist|roteiro-lider|grupos → logistica`; `valores → financeiro`; `documentos|links → arquivos`; `portal → portal`; `passageiros → passageiros`.

---

## 6. Lacunas de dados (spec × banco/código)

| A spec pede | Existe hoje | Mais próximo / observação |
|---|---|---|
| **Baixa da ação do roteiro** (`Dar baixa`, "Sem baixa para dia já passado") | **Não** | `roteiro_lider_dias` tem só `alerta_nivel/texto/acao/responsavel`. Precisa de schema novo (proposta da spec: `resolvida_em timestamptz`, `resolvida_por uuid`). "Ação aberta" hoje só pode ser `alerta_nivel is not null` |
| Tag de severidade OK / Verificar / Atenção / Crítico / Hoje no roteiro | Parcial | `alerta_nivel` ∈ {Crítico, Atenção, Verificar} (text livre). "OK" = sem alerta; "Hoje" = `data` igual a hoje (derivado) |
| Título do dia | Parcial | O roteiro do líder **não tem `titulo`** (usa `programacao`). O roteiro do portal (`roteiro_dias`) tem `titulo`, `cidade` e `hospedagem`, mas é outra tabela, sem ligação |
| Fuso em relação a Brasília | **Não** | Nada guarda fuso. Só `roteiro_lider_dias.local` / `roteiro_dias.cidade` (texto) |
| Líderes em campo | Parcial | `roteiro_lider_dias.lideres_ativos` (texto por dia) ou `passageiros.tipo='Líder'` |
| Hotel atual com check-out; barras de hotel na "viagem inteira" | Parcial | Não há tabela de hotel. As datas ficam em **`quartos.check_in/check_out`** (por quarto); o hotel é o agrupamento `hotel_cidade+check_in+check_out+extensao_id` (`rooming/calculos.ts → chaveTrecho`, `passageiros/dados.ts → trechosDe`). Hotel sem nenhum quarto criado não existe no banco. Há também `roteiro_dias.hospedagem` (texto livre) |
| "x/y alocados" por hotel | Sim (derivado) | `calcularRooming(...).pendencias` / `paxRelevantes(t)` / `semQuarto(t)` |
| Apólice de seguro por passageiro (Saúde "apólices anexadas/total"; coluna Seguro; "Cobrar apólice") | **Não há coluna** | Requisito `passageiro_requisitos.tipo='Seguro'`: `arquivo_id` (arquivo na categoria "Seguros") + status (Aprovado/Pendente/Dispensado). Sem número da apólice na UI (a coluna `numero` existe, mas a gaveta do seguro não mostra). Legado: `documentos.apolice_url/seguro_status`, que nada no QS grava |
| Visto por passageiro | Parcial | Requisito `tipo='Visto'` (só se o destino exigir, conforme `requisitos-destino.ts`) e o legado `documentos.visto_necessario/status_visto` |
| Coluna Pagamento ("Isento" para líder) | Parcial | `passageiros.status_financeiro` / `statusFin()`. **Não há "Isento"**: líder e cortesia aparecem como "Sem valor" e entram na contagem. Há também `TipoRequisito "Pagamento"` no enum, sem uso visto nas telas |
| Banner "Nenhum dos N tem valor" + `Definir preço padrão` (aplicar a todos) | **Não** | Só "usar R$ X" por linha (`precoSugerido`). Uma ação em lote seria nova: N chamadas a `exp_pax_salvar_valores` ou uma RPC nova |
| StatCard "Preço por pessoa (com e sem aéreo)" | Sim | `expedicoes.preco_venda_brl` e `preco_sem_aereo_brl` |
| Ritmo de vendas (últimos 30 dias) | **Não** | Não há histórico de mudança de `status_reserva`. Proxies: `passageiros.created_at`; `exp_valor_historico` (mudanças de valor, com `criado_em`); tabela `audit_log` (`AuditLogRow` no tipo; segundo a 0220, grava `usuario_id` nulo para usuários só do QS; não verifiquei os triggers) |
| Fases Vendas / Preparação / Embarque / Em viagem / Pós-viagem e "Dia N de M" | **Não** como campo | Derivar de `status` + `data_embarque/data_retorno` + hoje. `faseAtualChecklist()` dá as fases do checklist (outra escala) |
| Chip do grupo no cabeçalho | Parcial | `expedicoes.grupo_rotulo` / `viagem_grupo` (0029). Ambíguo: pode ser isso ou o G1/G2 de `grupos_expedicao` |
| Botão `Portal do líder` | **Não** no QS | A Área do Líder (`/lider`) continua no app antigo. Não há URL dela no código do QS |
| "Cobrar formulário (N)" / "Cobrar apólice (N)" | **Não** | Nenhum disparo nas Expedições. O mais próximo são as campanhas do Rel (`src/rel/lib/disparos.ts`, público `viagem` por texto da expedição) e a mensagem copiável de `paginas/AcessosAmigo.tsx`. A spec manda deixar o botão com TODO |
| Badge de pendências na aba Passageiros | Derivável | Contagem de `avaliarProntidao(...).prontidao !== "Apto"`, ou de checagens `atencao/bloqueio`, mais `!preencheuFormulario` |
| Badge "nº de arquivos" na aba Arquivos | Derivável | `count(arquivos where expedicao_id=X and passageiro_id is null)` (o que o Drive da expedição lista). Decidir se conta também os do pax |
| Regra do passaporte "6 meses após a volta" | Divergente | `regras.ts` usa retorno + 6 meses (bate com a spec). `PainelPassageiros` e `AbaDocumentos` usam embarque + 180 dias |
| `?aba=` na URL | Mecanismo existe | `src/lib/hashQuery.ts` (não usado nas Expedições; hoje a aba é segmento de caminho) |

Outras observações úteis para o redesign:
- O Roteiro do Líder e o Portal **não têm realtime**.
- `ir()` usa `location.hash`, então cada troca de aba vira uma entrada no histórico do navegador.
- `AbaDocumentos` aponta "expedicoes" fixo, o que é um bug em pacote.

---

## 7. Central de Expedições (redesign 29/10 — spec §2)

`ExpedicoesArea.tsx`: `tela === "expedicoes"` sem caminho → `lista/central/CentralExpedicoes.tsx`; `pacotes` → `ExpedicoesLista` (antiga).

| Arquivo | O que faz |
|---|---|
| `lib/fase.ts` | `getFase`, `infoFase`, `diasEntre`, `dataSP` (America/Sao_Paulo, só a data), `LIMITES_FASE` (30/120 — único lugar), `ORDEM_FASES`, `META_FASE` (rótulos e tokens `--fase-*`) |
| `lib/nomeExpedicao.ts` | `parseExpedicaoNome(raw)` → `{ base, grupo }`; `nomeDaExpedicao(exp)` (o `grupo_rotulo` do banco vence o nome); `juntarGrupos` |
| `lib/alertas/expedicoes.ts` | Regras do "Precisa de atenção" (puras), `REGRAS_ATENCAO` (limiares), agrupamento das irmãs, ordenação. Irmão de `lib/alertas/regras.ts` (avisos por passageiro) |
| `lib/alertas/dadosAlertas.ts` | Leituras extras dos alertas: passageiros sem valor (`valor_contratado_brl`/`valor_pago_brl`, sem líder/cortesia/cancelado) e ações de `roteiro_lider_dias` (`alerta_nivel`) — só das expedições em viagem/embarque/preparação |
| `lib/agregados.ts` | + `seguro_sem_apolice` (requisito Seguro não dispensado sem `arquivo_id`) |
| `styles/tokens.css` | + `--fase-viagem/embarque/preparacao/vendendo/concluida` (+ `-bg`/`-fg`), claro e `.dark` |
| `lista/central/linhas.ts` | Modelo da linha (fase, nome base, ocupação, aptos), CSV, ordenação da Tabela |
| `lista/central/VisaoFases.tsx` · `VisaoLinha.tsx` · `VisaoTabela.tsx` | As três visões |
| `lista/central/central.css` | Estilos da Central (só tokens) |

**URL** (query no hash, `lib/hashQuery.ts`): `visao=linha|tabela` (padrão Por fase), `q`, `destino`, `resp`, `status`, `periodo`, `ord=col:dir`. Ex.: `#ops/expedicoes?visao=tabela&destino=Peru`. Recolhido das seções: `localStorage["qs:exp:central:recolhidas"]` (padrão: Concluídas recolhida).

**Regras de alerta** (spec §2.2) e o que cada uma usa:

| Regra | Severidade | Dado | Abre |
|---|---|---|---|
| Embarque e aptos < 50% | Crítico | `prontidao_aptos/total` (agregados) | `<id>/passageiros` |
| Preparação, aptos < 20%, < 60 dias | Atenção | idem | `<id>/passageiros` |
| Ação crítica do Roteiro do Líder nos próximos 3 dias | Atenção | `roteiro_lider_dias.alerta_nivel='Crítico'` + `data` (título = `alerta_acao` › `alerta_texto` › `programacao`) | `<id>/roteiro-lider` |
| Ação do roteiro de dia passado sem baixa | Atenção | **desligada**: não existe baixa no banco (`baixada: null`) — ver `PROPOSTA-SCHEMA-EXPEDICOES.md` | `<id>/roteiro-lider` |
| Em viagem/embarque com passageiros sem valor | Atenção | `dadosAlertas.ts` | `<id>/valores` |
| Em viagem/embarque com seguro sem apólice | Atenção | `seguro_sem_apolice` (anexo do requisito Seguro = apólice) | `<id>/passageiros` |
| Vendendo, ocupação < 30%, < 365 dias | Info | `pax_confirmados/pax_planejados` | `<id>` |

Irmãs (mesmo `viagem_grupo`, senão mesmo nome base, **e** mesma data de embarque) viram um alerta só, com números somados ("Tailândia G1 e G2 embarcam em 15 dias com 0 de 44 passageiros aptos"). O selo conta só Crítico + Atenção. Os links usam o endereço ANTIGO de aba (`ir("expedicoes", "<id>/<aba>")`) — **o cockpit novo precisa manter esses redirects** (`passageiros`, `valores`, `roteiro-lider`).

Decisões: canceladas ficam fora das fases, da Linha do tempo e dos indicadores (aparecem só na Tabela, com chip "Cancelada"); a seção Concluídas mostra só os últimos 12 meses (as mais antigas ficam na Tabela, com aviso no cabeçalho da seção); "passageiros fora do Brasil" = não cancelados (líderes contam); o card de alertas não obedece aos filtros (é consolidado).

### 7.1 Central: onde ficou cada ação da lista antiga

| Ação antiga | Na Central |
|---|---|
| "+ Nova expedição" e atalho `n` | Botão `Nova expedição` no cabeçalho + atalho `n` (mesmo `NovaExpedicao`) |
| Busca e atalho `/` | Busca da barra (código, nome, destino) + `/` |
| Filtros Status, Destino, Período, Resp. Op, "Limpar filtros" | Barra: Destino, Resp. operacional, Status, Período e `Limpar` — todos na URL. (Destino e Status viraram seleção única em vez de múltipla) |
| Visão Cards / Tabela | Por fase (substitui os cards) / Linha do tempo / Tabela |
| Editar (lápis) | `⋯` da linha (Por fase) › Editar; lápis na Tabela (mesmo `EditarExpedicao`) |
| Mudar status direto na tabela | Célula Status da Tabela (mesma `CelulaEscolha`) e `⋯` › Status |
| Excluir (com confirmação) | `⋯` › Excluir… e lixeira da Tabela (mesmo texto de confirmação; `delete` em `expedicoes`) |
| Arrastar pra reordenar (`exp_reordenar`) | Tabela ordenada por **#** (Ordem manual), sem busca/filtro: alça ⠿. Os ids visíveis mantêm as posições globais na nova sequência |
| ★ Próxima | Chip "★ Próxima" no nome (Por fase e Tabela) |
| Contagem por status por ano | Substituída pelos 5 indicadores por fase (o status continua visível/editável na Tabela) |
| Realtime em `expedicoes` | Mantido (300 ms) + `roteiro_lider_dias` (3 s) |
| — (novo) | `Exportar`: CSV (";" + BOM, abre no Excel) das linhas visíveis |

## 8. Cockpit da Expedição (redesign 29/10 — spec §3, §4.1, §4.2)

As 10 abas viraram 6: **Visão geral · Passageiros · Logística · Financeiro · Arquivos · Portal** (Logística some em pacote). A aba vai na query: `#ops/expedicoes/<id>?aba=logistica&secao=rooming`. Todo endereço antigo (`<id>%2Frooming`, `<id>/valores`, `?aba=rooming`) é reescrito pro novo (`lib/cockpit/rota.ts`, testado). As gavetas de Passageiros seguem no caminho (`<id>/passageiros/pax/<pid>`, `…/prontidao/<pid>`).

Lógica pura (testada em `tests/expedicoes/cockpit.test.ts`): `lib/cockpit/rota.ts`, `viagem.ts` (faixa da viagem, roteiro, ações da operação), `matriz.ts` (matriz de passageiros, placar, §4.2), `saude.ts` (4 cartões), `lib/passaporte.ts` (regra ÚNICA de validade: 6 meses depois da volta — usada na prontidão, na planilha, na matriz e no status de documentos), `lib/checklistResumo.ts` (§4.1: o mesmo número em todo lugar = todas as tarefas da expedição).

| Aba antiga | Onde ficou |
|---|---|
| Visão Geral | Visão geral: bloco por fase (Hoje+Próximos dias / Contagem / Vendas / Concluída), A viagem inteira, Saúde, Ações da operação; embaixo prazos 7 dias, documentos pendentes, resumo+observações, momentos especiais. Os 3 anéis do cabeçalho viraram os cartões de Saúde |
| Passageiros | Passageiros: Matriz (padrão) ↔ Planilha (tudo de antes: editar célula, filtros, G1/G2, quarto, Bitrix, exportar, importar, adicionar, gavetas). KPIs pós-embarque = pendências administrativas |
| Valores | Financeiro: mesmo painel + faixa "sem valor" com **Definir preço padrão** (confirma e grava pela RPC `exp_pax_salvar_valores`, só com clique) + 4 StatCards |
| Rooming | Logística › Hospedagem e rooming: hotéis "x/y alocados", Exportar Excel, "Abrir rooming" = o mesmo quadro de arrastar |
| Checklist | Logística › Checklist (igual) |
| Documentos | Arquivos (Drive com grade de pastas + aviso de "Outros") e Passageiros › "Status de documentos por passageiro" (`passageiros/StatusDocumentosPax.tsx`, link corrigido pra pacote) |
| Links | Arquivos › Links |
| Divisões | Logística › Divisões (igual) |
| ExpedAmigo | Portal: lista de status no topo + Liberar para todos (admin) + todos os editores de antes |
| Roteiro do Líder | Logística › Roteiro do líder (mesmo editor, tag por dia, hoje destacado); Documentos do líder → Portal |

Desligados de propósito (sem gravar nada): **Cobrar todos / Cobrar formulário / Cobrar apólice** (não existe disparo nas Expedições), **Dar baixa** (precisa da migration do `PROPOSTA-SCHEMA-EXPEDICOES.md` §1), **Portal do líder** no cabeçalho (sem URL da Área do Líder neste app).

## Testes (lib pura)

O projeto não tem vitest/jest e o Node da máquina é o 20 (sem `--experimental-strip-types`). Os testes usam `node:test` + `node:assert` e um gancho que transpila `.ts` com o `typescript` do `node_modules` (`tests/ts-loader.mjs`, ligado por `tests/registrar-ts.mjs`). Nada foi instalado.

```bash
node --import ./tests/registrar-ts.mjs --test tests/expedicoes/*.test.ts
```

(No Node 22.6+ dá pra trocar o gancho por `--experimental-strip-types`.) A lógica testada (`lib/fase.ts`, `lib/nomeExpedicao.ts`, `lib/alertas/expedicoes.ts`) não usa alias `@/` e importa com extensão `.ts`, pra rodar no Node puro. Os testes ficam fora de `src/` (o `tsc -b` não os checa; `node:test` não está nos `types` do app).
