## Parte B — Aba PASSAGEIROS da expedição + perfil do passageiro

> Escopo: `app/(app)/expedicoes/[id]/passageiros/**` (20 arquivos, 4.299 linhas), as server actions de `app/(app)/expedicoes/actions.ts` que essas telas usam, `lib/prontidao/*`, `lib/csv/passageiros-import.ts`, `lib/cpf.ts`, `lib/fidelidade.ts`, `lib/saude.ts`, `lib/rooming/acompanhante.ts`, `lib/data/pessoas.ts`, `lib/data/compras.ts`, `lib/bitrix/*`, `lib/expedamigo/*`, `lib/acesso-senha.ts`, `components/arquivos/PassaporteAnexo.tsx`, `lib/comprimir-imagem.ts`, rotas `app/api/bitrix/{passageiro-sync,sync-contato,importar-compras}`, `app/api/expedamigo/onboarding-diario`, e (por dependência) `app/api/arquivos/*`.
> Todos os caminhos são relativos a `/tmp/sx`. `L123` = linha.

### B.0 Tamanho dos arquivos (wc -l)

| Arquivo | Linhas |
|---|---|
| `passageiros/page.tsx` | 53 |
| `passageiros/PassageirosTabela.tsx` | 842 |
| `passageiros/ProntidaoPaxDrawer.tsx` (contém `ProntidaoConteudo`, `ContratoDrawer`, `RequisitoDrawer`) | 885 |
| `passageiros/EditarPassageiroDrawer.tsx` | 596 |
| `passageiros/NovoPassageiroDrawer.tsx` | 163 |
| `passageiros/AdicionarExistenteDrawer.tsx` | 119 |
| `passageiros/ImportarPassageirosDrawer.tsx` (modo expedição **e** global) | 254 |
| `passageiros/MudarExpedicao.tsx` + `mudar-expedicao-actions.ts` | 89 + 20 |
| `passageiros/ExpedamigoPainel.tsx` + `expedamigo-actions.ts` | 115 + 171 |
| `passageiros/ExtensoesCompra.tsx` + `extensoes-actions.ts` | 78 + 101 |
| `passageiros/PasseiosOpcionaisCompra.tsx` + `passeios-opcionais-actions.ts` | 82 + 119 |
| `passageiros/FidelidadeBadge.tsx` | 37 |
| `passageiros/SaudeCampos.tsx` | 213 |
| `passageiros/grupo-actions.ts` | 133 |
| `passageiros/bitrix-sync-actions.ts` | 47 |
| `passageiros/[paxId]/page.tsx` | 182 |
| `expedicoes/actions.ts` (arquivo inteiro; ~1.300 linhas são desta parte) | 3001 |
| `lib/prontidao/regras.ts` / `requisitos-destino.ts` / `template.ts` / `vacina-sync.ts` | 357 / 174 / 69 / 71 |
| `lib/csv/passageiros-import.ts` | 274 |
| `lib/cpf.ts` / `lib/fidelidade.ts` / `lib/saude.ts` / `lib/rooming/acompanhante.ts` | 44 / 76 / 52 / 59 |
| `lib/data/pessoas.ts` / `lib/data/compras.ts` | 175 / 162 |
| `lib/bitrix/upsert-passageiro.ts` (+ `mapping` 33, `outbound` 96, `stage-mapping` 41, `types` 39, `validators` 28) | 238 |
| `lib/expedamigo/onboarding.ts` / `first-access-token.ts` / `lib/acesso-senha.ts` | 45 / 45 / 56 |
| `components/arquivos/PassaporteAnexo.tsx` / `lib/comprimir-imagem.ts` | 92 / 70 |
| `app/api/bitrix/passageiro-sync` / `sync-contato` / `importar-compras` / `app/api/expedamigo/onboarding-diario` | 38 / 114 / 95 / 112 |

---

### B.1 Modelo de dados (o que esta parte lê/escreve)

#### B.1.1 Conceito central: `passageiros` = RESERVA (pessoa × expedição); "pessoa" é virtual

- **Não existe tabela `pessoas`.** Cada linha de `passageiros` é o vínculo de uma pessoa com UMA expedição (ou `expedicao_id = null` = "avulso", migration 0014). A mesma pessoa aparece em N linhas.
- **Identidade da pessoa** = `chaveIdentidade(p)` (`lib/data/pessoas.ts` L247-254), verbatim:
  ```ts
  export function chaveIdentidade(p: PassageiroRow): string {
    const cpf = p.cpf?.replace(/\D/g, "");
    if (cpf && cpf.length >= 11) return `cpf:${cpf}`;
    if (p.bitrix_contact_id) return `bx:${p.bitrix_contact_id}`;
    if (p.email) return `email:${p.email.trim().toLowerCase()}`;
    return `nome:${p.nome_completo.trim().toLowerCase()}`;
  }
  ```
- **"Retroalimentação" (propagação)**: campos PESSOAIS editados em qualquer linha são copiados para TODAS as linhas da mesma identidade (`propagarDadosPessoais`, actions.ts L348-384). Lista verbatim `CAMPOS_PESSOAIS` (actions.ts L305-335):
  `nome_completo, cpf, passaporte, validade_passaporte, passaporte_arquivo_id, foto_arquivo_id, data_nascimento, email, telefone, contato_emergencia_nome, contato_emergencia_fone, contato_emergencia_vinculo, restricoes_alimentares, condicoes_medicas, saude, endereco_cep, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, ja_viajou_internacional, paises_visitados`.
  Ficam POR RESERVA (não propagam): `tipo, status_reserva, observacoes, companhia_aerea, localizador, voo_nacional_necessario, contrato_assinado, checkin_online_feito, perfil_viajante, acompanhante_*, pref_*, grupo_id, conexao_viagem_id, quarto_id, liberado_expedamigo, valor_*`.
  - Implementação: busca TODAS as linhas de `passageiros` paginando 1000 em 1000 (`fetchAllRows`, `lib/data/expedicoes.ts` L81-95, ordem por `id`), calcula a chave da linha `refId`, filtra irmãos em memória e faz `update(patch).in("id", irmaos)`. ⚠️ Mudar CPF/e-mail/nome muda a própria chave: a propagação usa a chave **antiga** da linha ref (lida antes do update no caso do campo inline; no lote, `atualizarPassageiroLote` faz o update da linha ANTES e então propaga com a chave NOVA — irmãos com a chave antiga deixam de casar).
  - **SPA**: recomenda-se uma RPC `propagar_dados_pessoais(ref_id uuid, patch jsonb)` em SQL (security invoker) replicando `chaveIdentidade` — evita baixar a tabela inteira no browser.

#### B.1.2 Tabela `passageiros` (colunas consolidadas das migrations)

| Coluna | Tipo / default | Origem |
|---|---|---|
| `id` | uuid pk `gen_random_uuid()` | 0001 |
| `expedicao_id` | uuid FK expedicoes **on delete cascade**, **nullable** (avulso) | 0001 / 0014 |
| `bitrix_contact_id` | text | 0001 |
| `bitrix_deal_id` | text **unique** | 0001 |
| `nome_completo` | text not null | 0001 |
| `tipo` | enum `tipo_passageiro` ('Pagante','Cortesia','Líder') default 'Pagante' | 0001 |
| `cpf` | text (gravado ora com máscara, ora só dígitos) | 0001 |
| `passaporte`, `email`, `telefone`, `companhia_aerea`, `localizador`, `observacoes` | text | 0001 |
| `data_nascimento`, `validade_passaporte` | date | 0001 |
| `status_reserva` | enum ('Lead','Pré-reserva','Confirmado','Cancelado') default 'Lead' | 0001 |
| `voo_nacional_necessario` | bool not null default false | 0001 |
| `quarto_id` | uuid FK quartos on delete set null — **LEGADO**, substituído por `passageiro_quarto` (0016) | 0001 |
| `grupo_id` | uuid FK grupos_expedicao on delete set null | 0003 |
| `valor_contratado_brl`, `valor_pago_brl` | numeric(14,2) not null default 0 | 0010 |
| `saldo_brl` | numeric(14,2) **GENERATED ALWAYS** `(valor_contratado_brl - valor_pago_brl) stored` — nunca enviar no insert/update | 0010 |
| `status_financeiro` | text not null default 'Em aberto' | 0010 |
| `contato_emergencia_nome`, `contato_emergencia_fone`, `restricoes_alimentares`, `condicoes_medicas` | text | 0010 |
| `contrato_assinado`, `checkin_online_feito` | bool not null default false | 0010 |
| `saude` | jsonb (ver B.9) | 0018 |
| `conexao_viagem_id` | uuid (token "viajam juntos", sem tabela) | 0019 |
| `passaporte_arquivo_id` | uuid FK arquivos on delete set null — anexo do passaporte **1 por pessoa** | 0026 |
| `pendente_aprovacao` | bool not null default false; `inscricao_origem` text (ex.: "Formulário público") | 0027 |
| `endereco_cep/rua/numero/complemento/bairro/cidade/estado` | text | 0027 |
| `pref_marcar_assento` bool, `pref_upgrade_classe` text, `ja_viajou_internacional` bool, `paises_visitados` text | | 0027 |
| `acompanhante_nome`, `acompanhante_divide_quarto` ("Quarto"/"Cama"/"Não") | text | 0027 |
| `contato_emergencia_vinculo` | text | 0028 |
| `perfil_viajante` | jsonb `{profissao, instagram, camiseta, musica, descricao_grupo, anima_expedicao, significado, confirmou_veracidade}` | 0038 |
| `foto_arquivo_id` | uuid FK arquivos on delete set null | 0038 |
| `acompanhante_vinculo`, `acompanhante_dividir_com` | text | 0039 |
| `liberado_expedamigo` | bool not null default false | 0040 |
| `created_at`, `updated_at` | timestamptz | 0001 |

Índices/constraints relevantes:
- `ux_passageiros_expedicao_cpf` **unique** `(expedicao_id, regexp_replace(cpf,'\D','','g')) where cpf is not null and expedicao_id is not null` (0015) — mesmo CPF não pode repetir na expedição (o banco garante; a app também checa).
- `ux_passageiros_avulso_cpf` unique `(regexp_replace(cpf,'\D','','g')) where cpf is not null and expedicao_id is null` — no máximo 1 avulso por CPF.
- `idx_passageiros_pendente` parcial; `idx_passageiros_grupo`, `idx_passageiros_conexao_viagem`, `idx_passageiros_avulsos`.
- Triggers: `trg_passageiros_updated_at` (set_updated_at) e **`trg_passageiros_audit`** → `audit_change()` (security definer) grava em `audit_log` TODO insert/update/delete com `usuario_id = auth.uid()`, `dados_antes/dados_depois = to_jsonb(row)` (0001 L305-345). Também `custos`, `pagamentos`, `expedicoes`, `passageiro_requisitos` (0010) têm trigger de audit. ⇒ **o SPA ganha auditoria de graça** (trigger), sem código.
- RLS: `auth_all_select/insert/update/delete` para `authenticated` (0001) + `ro_block_insert/update/delete` RESTRICTIVE `not is_readonly()` (0046) — papéis `relacionamento` e `leitura` só leem. `is_readonly()` é fail-open (sem linha em `usuarios` ⇒ pode escrever).
- Realtime: `passageiros` e `arquivos` na publication (0006); `passageiro_requisitos`/`requisitos_destino` (0012/0013) com `replica identity full`.

#### B.1.3 `passageiro_requisitos` (instâncias da prontidão) — 0010
`id, passageiro_id (FK passageiros on delete cascade), tipo tipo_requisito, descricao text not null, status status_requisito default 'Pendente', obrigatoriedade ('Obrigatório'|'Condicional'|'Recomendado') default 'Obrigatório', bloqueia_embarque bool default true, validade date, numero text, arquivo_id (FK arquivos on delete set null), responsavel_id (FK usuarios), verificado_em timestamptz, verificado_por (FK usuarios), observacoes, created_at, updated_at`, **unique (passageiro_id, tipo)**.
- enum `tipo_requisito`: `'Passaporte','RG','Visto','Vacina','Seguro','Aéreo Internacional','Aéreo Doméstico','Contrato','Autorização de Menor','Pagamento','Dados Pessoais'` + `'Documento Pessoal'` (0017, obsoleto/removido pela 0026) + `'Voo Interno'` (0020, before 'Contrato') + `'Ingresso Machu Picchu'`, `'Ingresso Trem Machu Picchu'` (0025).
- enum `status_requisito`: `'Pendente','Em análise','Enviado','Aprovado','Vencido','Dispensado','Reprovado'`.
- Função SQL **`prontidao_marcar_vencidos()`** (0012): marca `status='Vencido'` em todo requisito com `validade < expedicoes.data_retorno` e status ∉ (Vencido, Dispensado, Reprovado); agendada via pg_cron `'0 6 * * *'` (job `prontidao-marcar-vencidos`) se pg_cron existir. Manter no banco.
- `verificado_por` **nunca é gravado pela app** (só `verificado_em`).

#### B.1.4 `requisitos_destino` (catálogo em tabela) — 0010/0011
Existe e foi semeada (0011), mas **o app NÃO lê essa tabela** (só o mock). A fonte de verdade efetiva é o TS `lib/prontidao/requisitos-destino.ts` (B.4.1). A view SQL `vw_prontidao_passageiro` (0010) também existe mas **não é usada** e tem regra diferente (considera saldo financeiro). ⇒ No SPA: ou portar o catálogo TS para o front (mais simples, paridade exata), ou migrar o catálogo para `requisitos_destino` e ressemear com os valores TS (a semente 0011 está DESATUALIZADA: tem `Pagamento`, não tem `Voo Interno`/Ingressos/Tailândia, descrições diferentes).

#### B.1.5 Demais tabelas tocadas
- **`arquivos`** (0005): `id, expedicao_id (NOT NULL, FK cascade), passageiro_id (FK cascade), categoria categoria_arquivo, nome, descricao, mime, tamanho_bytes, storage_path unique, uploaded_by (nunca gravado), created_at, updated_at`. Enum `categoria_arquivo`: `'Aéreos','Documentos pessoais','Contrato'(0035),'Bilhetes','Vistos','Seguros','Hospedagem','Vouchers','Cartão de embarque'(0051),'Outros'`. Bucket Storage **`arquivos-expedicoes`** (privado). ⚠️ Arquivo exige `expedicao_id` NOT NULL — por isso todo upload de pessoa precisa de uma expedição "âncora".
- **`passageiro_quarto`** (0016): `id, passageiro_id (cascade), quarto_id (cascade), unique(passageiro_id, quarto_id)`. ⚠️ policies `auth_all_*` foram criadas `to anon, authenticated` (0016) e a 0036 só removeu `anon_read_dev` ⇒ **anon pode ler/inserir/deletar alocações**. Corrigir no SPA.
- **`grupos_expedicao`** (0003): `id, expedicao_id (cascade), nome, data_embarque, data_retorno, pax_planejados int default 0, observacoes, ordem int default 0, unique(expedicao_id,nome)`.
- **`extensoes`** (0052): `id, expedicao_id, nome, descricao, ordem`. **`passageiro_extensao`**: `id, passageiro_id (cascade), extensao_id (cascade), unique(passageiro_id, extensao_id)` — presença da linha = contratou.
- **`passeios_opcionais`** (0044): `id, expedicao_id, roteiro_dia_id (FK roteiro_dias cascade), titulo, descricao, foto_arquivo_id, whatsapp_url, ordem`. **`passeio_opcional_compras`**: `id, passageiro_id, passeio_opcional_id, unique(...)` — presença = comprou.
- **`acesso_senhas`** (0031/0040): `cpf text pk (11 dígitos), senha_hash text NULL, senha_provisoria text (legível!), created_at, updated_at`. RLS ligada **sem policies** ⇒ só service role.
- **`acesso_links`** (0058): `id, codigo unique, passageiro_id (cascade), expira_em, created_at`. RLS sem policies ⇒ só service role.
- **`compras_bitrix`** (0048/0056): `id, bitrix_deal_id unique, bitrix_contact_id, cpf (só dígitos), nome_contato, titulo, produto (0056), data_compra date, valor numeric, moeda default 'BRL', funil, etapa, created_at, updated_at`. RLS: select para authenticated; escrita só service role.
- **`custos`** (0001): `valor_planejado_brl` **GENERATED** `(valor_planejado * coalesce(cambio_aplicado,1))`; `valor_realizado_brl` coluna COMUM (app calcula). **`pagamentos`**: `saldo` **GENERATED** `(valor_total - entrada)`. Ver B.7.5 (actions órfãs).
- **`audit_log`**: além do trigger, `upsertPassageiroBitrix` insere manualmente linhas com `origem='bitrix-webhook'`.

---

### B.2 Tela principal — `/expedicoes/[id]/passageiros`

#### B.2.1 `page.tsx` (53 linhas, Server Component)
Carrega em paralelo (L17-28): `listPassageiros(id)` (`passageiros where expedicao_id=id`, sem paginação), `listQuartos(id)`, `listAlocacoes(id)` (quartos da expedição → `passageiro_quarto in quarto_ids`), `getExpedicao(id)`, `listArquivosExpedicao(id)` (`arquivos where expedicao_id order created_at desc`), `getProntidaoExpedicao(id)` (B.4.4), `listUsuarios()` (`usuarios *`), `listPessoas()` (**todas** as linhas de `passageiros` + todas as expedições — B.10.1), `listGruposExpedicao(id)` (`grupos_expedicao order ordem`), `getCurrentUser()`. 404 se expedição não existe. Calcula `posicoesFidelidade = construirPosicoesFidelidade(pessoas, id)` (B.10.2). `isAdmin = user.papel === "admin"`.

#### B.2.2 `PassageirosTabela.tsx` (842 linhas, client)

**Barra superior (L571-649)**
- Busca `"Buscar pax..."`: filtra por `nome_completo + cpf + passaporte` (lowercase, `includes`).
- FilterPills **Status** (`Todos` + `STATUS_RESERVA` = Lead / Pré-reserva / Confirmado / Cancelado) e **Tipo** (`Todos` + Pagante / Cortesia / Líder). Clicar no ativo desmarca.
- Admin e sem grupos: botão **"Adicionar divisão por grupos"** → `ativarDivisaoGrupos` (B.8.1). Admin com grupos: `ConfirmDeleteButton` **"Remover divisão"** (texto do confirm: "Apaga os grupos G1/G2 desta expedição e desmarca o grupo de todos os passageiros. A coluna Grupo some. Não afeta os quartos já montados.") → `removerDivisaoGrupos`.
- Direita: `LiveBadge` (status realtime); se editor: **"Atualizar do Bitrix"** (spinner) → `sincronizarExpedicaoBitrix` (B.11.1) com toast "Sincronização iniciada — Os passageiros vão aparecer/atualizar em instantes."; **"Exportar"** (todos); se editor: **"Importar"**, **"Adicionar existente"**, **"Adicionar"** (brand).
- `somenteLeitura = useSomenteLeitura()` (papéis `relacionamento`/`leitura`) esconde todos os botões de escrita.

**KPIs (StatPills, L651-676, só se há pax)** — contam sobre TODOS os passageiros (sem filtro):
`Total` · `Confirmados` (status Confirmado) · `Pré-reserva` · `Leads` | `Aptos` / `Atenção` / `Bloqueados` (de `prontidao[]`, que exclui Cancelados) | botão-pílula **"Formulário pendente: N"** (N = pax com `!preencheuFormulario`) que liga/desliga o filtro `soPendentes` (mostra X quando ativo).

**Regra `preencheuFormulario(p)` (L790-799, verbatim)**:
```ts
const pv = p.perfil_viajante;
const temPerfil = !!pv && typeof pv === "object" && (
  pv.confirmou_veracidade === true ||
  [pv.profissao, pv.descricao_grupo, pv.anima_expedicao, pv.significado, pv.instagram, pv.camiseta, pv.musica]
    .some((v) => v && String(v).trim() !== "")
);
return temPerfil || p.inscricao_origem === "Formulário público";
```

**Empty state** (0 pax): ícone Users, "Nenhum passageiro ainda", "Adicione manualmente, importe de uma planilha (CSV) ou puxe alguém que já está na base da agência.", ação "Adicionar passageiro" (só editor).

**Duas seções (cards)**: **Líderes** (`tipo === "Líder"`, ícone Crown, badge contagem, legenda "não contam na ocupação"; só aparece se existe algum Líder na expedição) e **ExpedAmigos** (todos os demais, legenda "passageiros"). Vazio filtrado: "Nenhum líder no filtro atual." / "Nenhum passageiro no filtro atual."

**Colunas (cabeçalhos clicáveis ordenam asc↔desc, `ThOrd`)**:
| Coluna | Conteúdo | Edição |
|---|---|---|
| ID | `#NNN` = índice por `created_at` asc (1-based, padStart 3) — numeração de cadastro estável | — |
| Nome | Avatar (foto = `/api/arquivos/{foto_arquivo_id}/download?inline=1`) + nome (botão abre **EditarPassageiroDrawer**) + `FidelidadeBadge` + pílula 🎂 `dd/MM` se `aniversarioNaViagem` (tooltip com data completa e idade) | — |
| Tipo | Badge (Líder=lista, Cortesia=auto, Pagante=vinculado) | — |
| Grupo (só se `usaGrupos`) | admin: `<select>` —/G1/G2 → `definirGrupoRapido`; demais: pílula G1 (azul) / G2 (roxa) / outro (laranja) / "—" | admin |
| CPF | `EditableCell` → `atualizarPassageiroCampo(id,"cpf",v)` (**sem validação de CPF** inline; vazio ⇒ null) | inline |
| Passaporte | `EditableCell` → `atualizarPassageiroCampo(id,"passaporte",v)` | inline |
| Validade | data dd/MM/yyyy ou "—"; vermelho + "⚠ < 6m do embarque" se `daysUntil(validade) - daysUntil(data_embarque) < 180` | — |
| Quarto | ver abaixo | select |
| Status | Badge (Lead=lista, Pré-reserva=atencao, Confirmado=vinculado, Cancelado=critico) | — |
| Prontidão | Badge Apto/Atenção/Bloqueado (`COR_PRONTIDAO`) — clique abre **ProntidaoPaxDrawer**; "—" se pax Cancelado (sem prontidão) | — |
| Formulário | "✓ Preencheu" (verde) / "Pendente" (cinza). Cabeçalho é toggle do filtro `soPendentes` | — |

Rodapé: "Clique numa célula azul pra editar. Enter salva, Esc cancela, Tab vai pra próxima." (`EditableCell`: Enter salva, Esc reverte, Tab salva e avança; string vazia ⇒ `null`).

**Coluna Quarto (L348-415)** — fonte de verdade = `passageiro_quarto` (o legado `quarto_id` NÃO é atualizado pelo rooming):
- `trechos` = agrupa `quartos` por chave `hotel_cidade.trim()|check_in[0..10]|check_out[0..10]`, ordenados por `check_in`; `primeiroTrecho = trechos[0]`.
- Editável se `!somenteLeitura && primeiroTrecho tem quartos`: `<select>` "— sem quarto —" + quartos do 1º trecho ordenados por `numero` (numeric pt-BR), rótulo `Quarto {numero} ({tipo}) · {ocupação}/{capacidade}` com `CAPACIDADE_QUARTO = { Single:1, Twin:2, Duplo:2, Triplo:3, Compartilhado:4, Líder:2 }` (default 1). Mudar → `alocarPassageiro(pax, quarto, exp)` (remove alocações do pax em quartos do MESMO trecho e insere `passageiro_quarto`) ou, se vazio, `desalocarPassageiro(pax, quartoAtual, exp)` (delete). ⚠️ Não valida capacidade (pode lotar acima). Trecho = `hotel_cidade|check_in|check_out|extensao_id` no servidor (actions.ts L1959) — o cliente usa a chave SEM `extensao_id`.
- Abaixo: "com {companheiros}" (outros pax nos mesmos quartos, todos os trechos), "+N em outro hotel", e linha de conferência do acompanhante indicado (`conferirAcompanhante`, B.10.4): "✓ indicou: X" (verde) / "⚠ indicou: X" (laranja, tooltip "O acompanhante indicado NÃO está neste quarto") / neutro.
- Não editável: "Quarto {n} +k" com tooltip `{hotel}: Quarto n (tipo) · …`; sem quarto: "Indicou: X" ou "Viaja sozinho".

**Ordenação (L225-265)** — valor por coluna:
`id`→índice; `nome`→lower; `tipo`; `grupo`→G1=0,G2=1,outro=2; `cpf`→dígitos; `passaporte`→lower; `validade`→ISO ou `"9999-99-99"` (sem validade vai pro fim); `quarto`→`Number(numero)` do 1º quarto ou +∞; `status`→índice em STATUS_RESERVA; `prontidao`→`{Apto:0, Atenção:1, Bloqueado:2}`, sem prontidão=4. Desempate sempre pelo índice de cadastro. Sem sort manual: se `usaGrupos` ordena por grupo (G1→G2→sem) e depois cadastro.

**Agrupamento por grupo** (L74-79, L515-538): `usaGrupos = existe grupo "G1" E grupo "G2"` em `grupos_expedicao`. `agrupado = usaGrupos && (sort?.col==="grupo" || !sort)`. Quando agrupado e há >1 grupo distinto na seção, insere linhas-divisoras: "Grupo 1 (G1)" / "Grupo 2 (G2)" / "Sem grupo definido" + "· N pessoa(s)".
- `grupoLabel(p)`: nome do grupo via `grupo_id`; **fallback hardcoded Egito**: se `destino` contém "egito" usa `grupoEgito(nome)` de `lib/dev-grupos-egito.ts` (mapa de ~50 fragmentos de nome → G1/G2; marcado "⚠️ LOCAL / PROVISÓRIO"). **Não portar** — no SPA usar só `grupo_id`.

**Exportar CSV (L547-569)**: header `Nome,Tipo,CPF,Passaporte,Validade,Nascimento,Email,Telefone,Status,Quarto`, linhas = `ordenados` (filtros aplicados), aspas em todos os campos (`"` → `""`), separador `,`, BOM `﻿`, arquivo `passageiros-{expedicaoId}.csv`. ⚠️ "Quarto" usa o LEGADO `quarto_id` (geralmente vazio) — bug; no SPA usar `passageiro_quarto`.

**Deep link**: `?editar=<paxId>` abre o EditarPassageiroDrawer e limpa o param (`router.replace`) — usado por `/avisos`.

**Realtime (L140-145)**: `useRealtimeRefresh` assina `passageiros` (filter `expedicao_id=eq.{id}`) e `arquivos` (filter `expedicao_id=eq.{id}`), debounce 300 ms → `router.refresh()`. O layout da expedição (`ExpedicaoRealtimeSync.tsx`) assina adicionalmente `expedicoes`, `quartos`, `checklist_itens`, **`passageiro_requisitos` (sem filtro)**, `links_expedicao`, `documentos`. ⚠️ `passageiro_quarto` e `grupos_expedicao` NÃO são assinados (mudança de quarto/grupo feita por outro usuário não atualiza ao vivo). SPA: canal único com esses filtros + invalidar queries.

**Drawers montados**: Novo, Importar (modo "expedicao", recebe `cpfsExistentes` = dígitos dos CPFs da expedição), AdicionarExistente, EditarPassageiro, ProntidaoPax.

---

### B.3 Drawers de criação / importação

#### B.3.1 `NovoPassageiroDrawer.tsx` (163 linhas)
- Campos: Nome completo* · Tipo (default Pagante) · Status (default **Lead**) · CPF (placeholder 000.000.000-00) · Data de nascimento (date) · Telefone · Passaporte · Validade do passaporte (date) · Email · Observações (textarea).
- zod (L30-41): `nome_completo: min(2,"Nome completo obrigatório")`, `tipo enum`, `status_reserva enum`, `cpf: optional().refine(v => !v || cpfValido(v), "CPF inválido")`, `email: email("Email inválido").optional().or(literal(""))`, demais `optional()`.
- Submit → **`criarPassageiro({expedicao_id, ...})`** (actions.ts L652-749):
  1. Revalida com zod idêntico (+ `status_reserva.default("Lead")`).
  2. **Dedup**: se `cpfDigitos(cpf)` (11 dígitos) existe em `passageiros where expedicao_id` ⇒ erro "Já existe um passageiro com este CPF nesta expedição." (o índice único 0015 também barraria).
  3. Insert `passageiros {expedicao_id, nome_completo, tipo, status_reserva, cpf||null, passaporte||null, validade_passaporte||null, data_nascimento||null, email||null, telefone||null, observacoes||null}`.
  4. **Efeito colateral**: `gerarRequisitosPadrao(expedicao_id)` (B.4.3) — instancia requisitos para TODOS os pax da expedição que ainda não têm nenhum (inclusive este).
  5. `revalidatePath` `/expedicoes/{id}` e `/expedicoes/{id}/passageiros`. Toast "Passageiro adicionado".
- ⚠️ NÃO propaga dados pessoais de outras linhas da mesma pessoa nem checa se a pessoa já existe em outra expedição (cria identidade paralela se o CPF for diferente/ausente).
- Sem checagem de papel na action (só RLS 0046).

#### B.3.2 `AdicionarExistenteDrawer.tsx` (119 linhas)
- Lista `pessoas` (PessoaAgregada — B.10.1) excluindo quem tem CPF já na expedição (`cpfsExistentes`); busca em `nome + cpf + email` (lowercase); **máx. 50 resultados**; mostra nome, CPF (mono) ou "sem CPF", ✈ `totalExpedicoes`. Vazio: "Nenhuma pessoa encontrada (ou já está nesta expedição)." / "Comece a digitar para buscar." (mas sem termo a lista mostra as 50 primeiras em ordem alfabética).
- "Adicionar" → **`adicionarPassageiroExistente(expedicaoId, p.idsPassageiros[0])`** (actions.ts L858-930): lê a linha ref; erro "Essa pessoa já está nesta expedição" se alguma linha da expedição tem a mesma `chaveIdentidade`; insere nova linha com **todos os CAMPOS_PESSOAIS copiados da ref** (`?? null`) + `expedicao_id`, `tipo:"Pagante"`, `status_reserva:"Lead"` (financeiro/quarto/grupo/contrato zerados pelos defaults); `gerarRequisitosPadrao`; revalida exp, passageiros e `/passageiros`. O drawer fica aberto (adicionar vários). Toast "{nome} adicionado(a) à expedição".
- ⚠️ A ref é `idsPassageiros[0]` = linha MAIS ANTIGA (ordenação por created_at), não a mais recente — se a propagação falhou em algum momento, copia dado velho.
- ⚠️ Se a pessoa é um avulso (expedicao_id null), a linha avulsa permanece (não é "consumida").

#### B.3.3 `ImportarPassageirosDrawer.tsx` (254 linhas) — modos `expedicao` e `global`
- Entrada: arquivo `.csv,.txt,text/csv` (`file.text()`) **ou** textarea "Ou cole o conteúdo do CSV" (parse a cada tecla).
- "Baixar modelo" (CSV com BOM, `;`):
  - expedição (`modelo-passageiros.csv`): `nome_completo;data_nascimento;cpf;passaporte;validade_passaporte;email;telefone;tipo;status_reserva;valor_contratado;valor_pago` + 2 exemplos (Maria Souza … Confirmado;18900;9450 / João Lima … Pré-reserva;18900;0).
  - global (`modelo-passageiros-global.csv`): prefixo `expedicao_codigo;` (ex.: `PERU-AGO2026`, `PATAG-NOV2026`).
- Parse: `parsePassageirosCSV(texto, { exigirObrigatorios: false, statusPadrao: "Confirmado" })` — **sem status no CSV ⇒ Confirmado** (B.5).
- Classificação por linha (erro > duplicado > ok): erros do parser; no global, código ausente ("código da expedição ausente") ou não encontrado em `expedicoes` ("expedição "X" não encontrada"); duplicado se CPF (11 dígitos) já está na expedição (`cpfsExistentes`) ou repetido no lote (chave `codigo|cpf` no global) — motivo "CPF já existe nesta expedição". Linhas sem CPF nunca são duplicadas.
- Prévia: badges "N válido(s)" / "N duplicado(s)" / "N com erro"; tabela (max-h 320px) `# · [Expedição] · Nome · CPF · Nasc. · Contratado · Situação(Importar/Duplicado/Erro, tooltip = motivo)`; nota "Linhas duplicadas ou com erro serão ignoradas…". `erroGeral` em caixa vermelha.
- Botão "Importar N válido(s)" → `importarPassageiros({expedicao_id, linhas})` ou `importarPassageirosGlobal({linhas})`. Toast "N passageiro(s) importado(s) · k ignorado(s) · j sem expedição".
- **`importarPassageiros`** (actions.ts L2697-2874): zod `importRowSchema` (`nome_completo min(2)`, `tipo enum`, `status_reserva enum`, `cpf/passaporte/validade/nascimento/email/telefone/observacoes nullable`, `valor_contratado_brl/valor_pago_brl nonnegative nullable`); `linhas min(1,"Nenhuma linha para importar").max(1000)`. Revalida dedup no servidor contra CPFs da expedição (ignora = `ignorados++`). Insert em lote com `valor_contratado_brl`, `valor_pago_brl` e **`status_financeiro = statusFinanceiroDe(contratado, pago, tipo)`** (verbatim L2717-2721):
  ```ts
  if (tipo !== "Pagante" && contratado === 0) return "Cortesia";
  if (contratado > 0 && pago >= contratado) return "Quitado";
  return "Em aberto";
  ```
  Depois `gerarRequisitosPadrao(expedicao_id)`. Insert único: se UMA linha violar o índice único (ex.: CPF com máscara diferente que escapou da checagem), o lote inteiro falha.
- **`importarPassageirosGlobal`** (L2876-3001): `linhas max(2000)`, `expedicao_codigo min(1)`; resolve `expedicoes.codigo in (...)`; códigos desconhecidos ⇒ `semExpedicao++`; dedup por expedição; insert em lote; `gerarRequisitosPadrao` para cada expedição com inserção. (Usado pela tela global `/passageiros` — modo global deste mesmo drawer.)
- ⚠️ Importação não faz dedup por identidade (só CPF), não propaga dados pessoais, aceita CPF inválido (só exige 11 dígitos).

---

### B.4 Prontidão de embarque (regras, catálogo, cálculo)

#### B.4.1 Catálogo por destino — `lib/prontidao/requisitos-destino.ts` (VERBATIM)
```ts
const P = MESES_VALIDADE_PASSAPORTE_PADRAO; // = 6 (lib/constants.ts L213)

const BASE_INTERNACIONAL: RequisitoDestinoTemplate[] = [
  { tipo: "Passaporte", descricao: `Passaporte válido (≥ ${P} meses após o retorno) + foto/PDF anexado`, obrigatoriedade: "Obrigatório", bloqueia_embarque: true, meses_validade_minima: P, papel_responsavel: "operacional" },
  { tipo: "Dados Pessoais", descricao: "Cadastro completo (CPF, nascimento, contato)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
  { tipo: "Contrato", descricao: "Contrato assinado", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "comercial" },
  { tipo: "Seguro", descricao: "Seguro viagem emitido cobrindo todo o período", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "comercial" },
  { tipo: "Aéreo Internacional", descricao: "Bilhete internacional emitido (localizador)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
];

const VACINA_FEBRE_AMARELA = { tipo: "Vacina", descricao: "Certificado Internacional de Vacinação (febre amarela)", obrigatoriedade: "Condicional", bloqueia_embarque: true, papel_responsavel: "operacional", observacoes: "Exigível conforme regiões visitadas / país de origem." };
const VOO_DOMESTICO = { tipo: "Aéreo Doméstico", descricao: "Trecho doméstico no destino emitido", obrigatoriedade: "Condicional", bloqueia_embarque: false, papel_responsavel: "operacional" };
const VOO_INTERNO   = { tipo: "Voo Interno", descricao: "Voo interno (trecho aéreo) emitido", obrigatoriedade: "Condicional", bloqueia_embarque: false, papel_responsavel: "operacional" };

export const REQUISITOS_POR_DESTINO = {
  Peru: [ ...BASE_INTERNACIONAL,
    { ...VACINA_FEBRE_AMARELA, observacoes: "Recomendada para selva/Machu Picchu; conferir exigência." },
    VOO_DOMESTICO, VOO_INTERNO,
    { tipo: "Ingresso Machu Picchu", descricao: "Ingresso de Machu Picchu (anexo)", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
    { tipo: "Ingresso Trem Machu Picchu", descricao: "Ingresso de trem para Machu Picchu — ida e volta (anexos)", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" } ],
  Argentina: [ ...BASE_INTERNACIONAL,
    { tipo: "RG", descricao: "RG válido (≤ 10 anos) — alternativa ao passaporte no Mercosul", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional" },
    VOO_DOMESTICO, VOO_INTERNO ],
  Chile: [ ...BASE_INTERNACIONAL, { /* mesmo RG da Argentina */ }, VOO_DOMESTICO, VOO_INTERNO ],
  Japão: [ ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Visto de turismo (confirmar isenção vigente para BR)", obrigatoriedade: "Condicional", bloqueia_embarque: true, papel_responsavel: "operacional", observacoes: "Verificar regra de isenção atual antes de instanciar como obrigatório." },
    VOO_DOMESTICO, VOO_INTERNO ],
  Egito: [ ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Visto do Egito (e-visa ou on arrival)", obrigatoriedade: "Obrigatório", bloqueia_embarque: true, papel_responsavel: "operacional" },
    VACINA_FEBRE_AMARELA, VOO_DOMESTICO, VOO_INTERNO ],
  Tailândia: [ ...BASE_INTERNACIONAL,
    { ...VACINA_FEBRE_AMARELA, observacoes: "Febre amarela exigível conforme país de origem/regiões — conferir." },
    VOO_DOMESTICO, VOO_INTERNO ],
  Itália: [ ...BASE_INTERNACIONAL,
    { tipo: "Visto", descricao: "Autorização ETIAS (quando exigível) — Schengen", obrigatoriedade: "Recomendado", bloqueia_embarque: false, papel_responsavel: "operacional", observacoes: "ETIAS para isentos de visto; confirmar data de entrada em vigor." } ],
};
export const DESTINOS_CADASTRADOS = Object.keys(REQUISITOS_POR_DESTINO);
export function requisitosDoDestino(destino) { return REQUISITOS_POR_DESTINO[destino] ?? BASE_INTERNACIONAL; }
```
- Casamento por **igualdade exata** com `expedicoes.destino` (com acento: "Japão", "Tailândia", "Itália"). Destino desconhecido ⇒ BASE_INTERNACIONAL.
- A ORDEM do array define a ordem das linhas no drawer.

#### B.4.2 Conjuntos de regra — `lib/prontidao/regras.ts` (VERBATIM)
```ts
REQUISITOS_DE_COLUNA = new Set(["Contrato", "Dados Pessoais"]);          // derivados de colunas, nunca instância
DISPENSAVEIS_LIDER  = new Set(["Contrato"]);                             // Líder: N/A
REQUISITOS_COM_ANEXO_OBRIGATORIO = new Set(["Passaporte","Ingresso Machu Picchu","Ingresso Trem Machu Picchu",
  "Aéreo Internacional","Aéreo Doméstico","Voo Interno","Seguro","Vacina"]);
ANEXO_OPCIONAL = new Set(["Ingresso Machu Picchu","Ingresso Trem Machu Picchu"]);
type Semaforo = "ok" | "atencao" | "bloqueio" | "na";
SEVERIDADE_SEMAFORO = { na: 0, ok: 1, atencao: 2, bloqueio: 3 };
```

#### B.4.3 Instanciação — `construirRequisitosPadrao` (template.ts) + `gerarRequisitosPadrao` (actions.ts L2464-2548)
- `construirRequisitosPadrao({passageiro, destino})`: para cada template do destino **exceto** `Contrato` e `Dados Pessoais` cria linha com `status="Pendente"`, `validade/arquivo/responsavel/verificado = null`, `observacoes = template.observacoes ?? null`, `descricao/obrigatoriedade/bloqueia_embarque` do template. Pré-preenchimentos:
  - `Aéreo Internacional`: `numero = passageiro.localizador`; `status = localizador ? "Aprovado" : "Pendente"`.
  - `Aéreo Doméstico`: `status = voo_nacional_necessario ? "Pendente" : "Dispensado"`.
- `gerarRequisitosPadrao(expedicaoId)`: lê `expedicoes.destino`; pax da expedição com `status_reserva <> 'Cancelado'`; descarta quem já tem QUALQUER linha em `passageiro_requisitos` (idempotente por PAX, não por tipo — pax antigo não ganha tipo novo do catálogo; para isso existe `criarRequisitoInstancia`); insert em lote; depois, para cada CPF dos novos, `espalharCertificadoVacina(supabase, cpf)` (B.4.6). Revalida `/expedicoes/{id}/passageiros`, `/expedicoes/{id}`, `/avisos`. Retorna `{ok, total}`.
- Chamado por: `criarPassageiro`, `adicionarPassageiroExistente`, `mudarExpedicaoPassageiro`, `importarPassageiros(Global)`, `upsertPassageiroBitrix` (criação), botão "Gerar requisitos de {destino}" no drawer.
- ⚠️ Em `upsertPassageiroBitrix` (rota webhook, sem sessão) `gerarRequisitosPadrao` usa `getServerClient()` = client de cookie **sem usuário ⇒ role anon** ⇒ RLS bloqueia o insert e o erro é ignorado. Pax vindos do Bitrix ficam sem requisitos até alguém clicar em "Gerar requisitos" (ou o drawer criar instância on-demand). No SPA, fazer isso num trigger SQL `after insert on passageiros` ou numa RPC.

#### B.4.4 Cálculo — `avaliarProntidao` (regras.ts L228-357) e `getProntidaoExpedicao`
`getProntidaoExpedicao(expId)` (`lib/data/expedicoes.ts` L437-499): pax da expedição **excluindo Cancelados**; requisitos `passageiro_requisitos in pax_ids` (⚠️ sem paginação — corta em 1000 linhas ≈ 125+ pax com 8 requisitos); para cada pax `avaliarProntidao({passageiro, expedicao, destino: exp.destino, requisitos})`. Retorna `{passageiro, requisitos, resultado}`.

Algoritmo (uma checagem por template do destino, na ordem do catálogo):
0. **Expedição `status === "Concluída"`** ⇒ todas as checagens `semaforo "na"`, `detalhe "Expedição concluída"`, resultado **Apto** (curto-circuito).
1. **Líder + tipo ∈ DISPENSAVEIS_LIDER (Contrato)** ⇒ `na`, "Não necessário (líder)".
2. **Passaporte (híbrido)**: instância com status `Dispensado` ⇒ `ok` "Dispensado". Senão `semValidade = checarPassaporte(...)` e `semAnexo = passaporte_arquivo_id ? "ok" : (bloqueia ? "bloqueio" : "atencao")`; semáforo = PIOR dos dois; detalhe = `"{msgValidade} · {documento anexado | falta anexar o passaporte}"`.
   ```ts
   function checarPassaporte(p, exp, bloqueia) {
     if (!p.passaporte || !p.validade_passaporte) return bloqueia ? "bloqueio" : "atencao";
     if (antesDe(p.validade_passaporte, exp.data_retorno)) return "bloqueio";            // vence antes do retorno
     const limite = addMonths(exp.data_retorno, 6).toISOString();
     if (antesDe(p.validade_passaporte, limite)) return "atencao";                       // < 6 meses após retorno
     return "ok";
   }
   ```
   Mensagens: "Sem passaporte cadastrado" / "Vence em AAAA-MM-DD (antes do retorno)" / "Vence em AAAA-MM-DD — dentro de 6 meses do retorno" / "Válido até AAAA-MM-DD".
   O anexo vem de **`passageiros.passaporte_arquivo_id`** (1 por pessoa), NÃO de `passageiro_requisitos.arquivo_id`.
3. **ANEXO_OPCIONAL (Ingressos MP/trem)**: sem instância ⇒ `na`; Dispensado ⇒ `ok`; Reprovado ⇒ `atencao`; com `arquivo_id` ⇒ `ok`; senão `na`. `bloqueia_embarque` forçado false. Detalhes "Anexado" / "Reprovado — reenviar" / "Anexo opcional".
4. **De coluna**:
   - Contrato: `contrato_assinado ? "ok" : "na"` (NÃO bloqueia nem alerta). Detalhe "Assinado" / "Contrato não assinado".
   - Dados Pessoais: `cpf && data_nascimento && nome_completo` ⇒ `ok` ("Cadastro completo"), senão `bloqueio` se template bloqueia (sim) — "Faltam dados (CPF/nascimento)". (Telefone/e-mail NÃO são checados apesar da descrição.)
5. **Instância genérica** (Seguro, Aéreo Internacional, Aéreo Doméstico, Voo Interno, Vacina, Visto, RG…): sem instância ⇒ `bloqueia ? "bloqueio" : "atencao"` (detalhe "Ainda não iniciado" ou "Falta anexar o documento"). Com instância:
   - se tipo ∈ REQUISITOS_COM_ANEXO_OBRIGATORIO ⇒ `checarDocumentoAnexo`:
     ```ts
     if (r.status === "Dispensado") return "ok";
     if (r.status === "Reprovado" || r.status === "Vencido") return r.bloqueia_embarque ? "bloqueio" : "atencao";
     if (r.arquivo_id) return "ok";
     return r.bloqueia_embarque ? "bloqueio" : "atencao";
     ```
     (status "Aprovado" SEM arquivo NÃO conta como ok! Detalhes: "Dispensado" / "Documento reprovado — reenviar" / "Documento anexado" / "Falta anexar o documento".)
   - senão (Visto, RG, …) ⇒ `checarInstancia`:
     ```ts
     const validadeOk = !r.validade || !antesDe(r.validade, exp.data_retorno);
     const resolvido = (r.status === "Aprovado" || r.status === "Dispensado") && validadeOk;
     if (resolvido) return "ok";
     if (r.status === "Vencido" || !validadeOk || r.status === "Reprovado") return r.bloqueia_embarque ? "bloqueio" : "atencao";
     if (r.obrigatoriedade === "Recomendado") return "atencao";
     return r.bloqueia_embarque ? "bloqueio" : "atencao";
     ```
     Detalhe: ok ⇒ `"{status} (val. AAAA-MM-DD)"`; Vencido ⇒ "Vencido em …"; senão o status.
   - `descricao/obrigatoriedade/bloqueia_embarque` exibidos vêm da INSTÂNCIA quando existe (pode divergir do template).
6. **Consolidação**: `bloqueios = #bloqueio`, `atencoes = #atencao`; `prontidao = bloqueios>0 ? "Bloqueado" : atencoes>0 ? "Atenção" : "Apto"`. `na` é neutro.
- **Não há "%"** de prontidão por passageiro — só o status. O "%" existe só no agregado da expedição: `prontidao_aptos / prontidao_total` (pax não cancelados) em `agregarExpedicoes` (`lib/data/expedicoes.ts` L114-160).
- Cores: `COR_PRONTIDAO = { Apto: "vinculado"(verde), Atenção: "atencao"(laranja), Bloqueado: "critico"(vermelho) }`; pontos do drawer `ok=verde, atencao=laranja, bloqueio=vermelho, na=cinza`.
- Datas: `antesDe` usa `parseISO(...).getTime()`; comparação date-only em fuso local.

#### B.4.5 Edição de requisito — `atualizarRequisitoCampo` / `criarRequisitoInstancia`
- `atualizarRequisitoCampo(requisitoId, expedicaoId, campo, valor)` (actions.ts L2550-2621): allowlist `CAMPOS_REQUISITO_EDITAVEIS = status, validade, numero, obrigatoriedade, bloqueia_embarque, arquivo_id, responsavel_id, observacoes`; status deve ∈ STATUS_REQUISITO; se status ∈ `{Aprovado, Reprovado, Dispensado}` grava também `verificado_em = now()`. Update 1 campo por chamada. Se `campo === "arquivo_id"` e valor não vazio e o tipo do requisito é `Vacina` ⇒ `espalharCertificadoVacina(supabase, cpf_do_pax, valor)`. Revalida passageiros/expedição/avisos.
- `criarRequisitoInstancia(passageiroId, expedicaoId, destino, tipo)` (L2629-2691): pega template do destino (erro "Requisito "X" não previsto para {destino}." se não houver); se já existe (passageiro_id,tipo) devolve; senão insere `{passageiro_id, tipo, descricao, status:"Pendente", obrigatoriedade, bloqueia_embarque, observacoes}` (⚠️ sem os pré-preenchimentos do template.ts) e devolve a linha.
- Nenhuma dessas actions checa papel (dependem do RLS 0046).

#### B.4.6 Vacina universal — `espalharCertificadoVacina(sb, cpf, certIdPreferido?)` (vacina-sync.ts)
1. CPF com 11 dígitos, senão nada. 2. Busca `passageiros.id where cpf in [digitos, "000.000.000-00" formatado]`. 3. Lê requisitos `tipo='Vacina'` dessas linhas. 4. `certId = preferido ?? primeiro arquivo_id já presente ?? arquivos where passageiro_id in ids and descricao ilike '%Febre Amarela%' limit 1`. 5. Para cada slot Vacina SEM arquivo e status ∉ {Dispensado, Reprovado}: `update {arquivo_id: certId, status: status==="Aprovado" ? "Aprovado" : "Enviado"}`. Nunca sobrescreve.
- ⚠️ Não cobre CPFs gravados em outros formatos (ex.: com espaços).

---

### B.5 CSV — `lib/csv/passageiros-import.ts`

- **Delimitador**: conta `;` vs `,` na 1ª linha; `;` vence se maior. BOM removido. Parser respeita aspas duplas, `""` escapado, campos multilinha; ignora linhas totalmente vazias.
- **Cabeçalho** normalizado (NFD sem acento, minúsculo, `_`/`-` → espaço, espaços colapsados) e casado por **igualdade** com aliases (VERBATIM):
  ```ts
  nome_completo: ["nome completo", "nome", "passageiro", "nome do passageiro"],
  data_nascimento: ["data de nascimento", "data nascimento", "nascimento", "dt nascimento", "nasc"],
  cpf: ["cpf"],
  passaporte: ["passaporte", "passport", "numero passaporte", "num passaporte", "n passaporte"],
  validade_passaporte: ["validade passaporte", "validade do passaporte", "validade", "vencimento passaporte", "passaporte validade"],
  email: ["email", "e mail"],
  telefone: ["telefone", "celular", "whatsapp", "fone", "tel", "contato"],
  tipo: ["tipo", "tipo passageiro"],
  status_reserva: ["status reserva", "status", "situacao", "reserva"],
  observacoes: ["observacoes", "obs", "observacao", "notas"],
  valor_contratado_brl: ["valor contratado", "contratado", "valor total", "total", "valor"],
  valor_pago_brl: ["valor pago", "pago", "entrada", "valor pago brl"],
  expedicao_codigo: ["expedicao codigo", "expedicao", "expedicao cod", "cod expedicao", "codigo expedicao", "codigo da expedicao", "codigo"],
  ```
  Sem coluna de nome ⇒ `erroGeral: 'Não encontrei a coluna de nome. O cabeçalho precisa ter "nome completo" (ou "nome").'`. Arquivo vazio ⇒ "Arquivo vazio.". Colunas não reconhecidas são ignoradas; se duas colunas casam o mesmo campo, vale a primeira (`indexOf`).
- **Datas** (`normalizarData`): ISO `^\d{4}-\d{2}-\d{2}` (aceita hora) ou `D/M/AAAA` com separador `/ - .`, ano de 2 dígitos ⇒ `>50 → 19xx` senão `20xx`; mês 1-12 e dia 1-31 (não valida 31/02). Erros "data inválida "X"" / "data não reconhecida "X"".
- **Números** (`parseNumeroBR`): remove `R$` e espaços; com `.` e `,` ⇒ BR (remove pontos, vírgula→ponto); só `,` ⇒ vírgula decimal; negativo ⇒ erro "valor negativo"; NaN ⇒ "valor numérico inválido".
- **Tipo**: casa normalizado com Pagante/Cortesia/Líder, senão **Pagante**. **Status**: casa com STATUS_RESERVA, senão `statusPadrao` (a tela passa **"Confirmado"**).
- **Validações por linha** (`exigirObrigatorios=false` na tela): nome ≥ 2 ("nome ausente ou muito curto"); nascimento/validade inválidos; CPF presente sem 11 dígitos ⇒ "CPF não tem 11 dígitos" (DV não é checado); e-mail regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` ⇒ "e-mail inválido"; valores inválidos. (Com `exigir=true` — não usado — nascimento e CPF válido seriam obrigatórios.)
- `linha` = índice 1-based sem contar cabeçalho.
- `cpfDigitos(cpf)` = só dígitos se tiver exatamente 11, senão `null` (usado em TODO o dedup).

### B.6 CPF — `lib/cpf.ts`
- `soDigitosCpf`, `cpfValido` (11 dígitos, não todos iguais, DV módulo 11: `soma*10 % 11`, 10→0), `formatarCpf` (000.000.000-00), `mascaraCpf` (máscara progressiva de digitação). Usado: Novo passageiro (refine), avulso, ExpedAmigo (login/senha), vacina-sync.

---

### B.7 Drawer do passageiro — `EditarPassageiroDrawer.tsx` (596 linhas)

Abre ao clicar no nome (ou `?editar=`). Largura 600px. Título = nome + FidelidadeBadge; subtítulo "Dados pessoais, prontidão e saúde do passageiro."; link **"Abrir página completa"** → `/expedicoes/{id}/passageiros/{paxId}`. Menu vertical à esquerda: **Passageiro | Prontidão (ponto verde/laranja/vermelho) | Saúde**. As 3 abas compartilham UM form (react-hook-form) — Saúde é salvo pelo mesmo botão.

#### B.7.1 Aba "Passageiro" — formulário
Campos (e reset a partir do pax): Nome completo · Tipo · Status · CPF · Telefone · Passaporte · Validade (date) · Nascimento (date) · Email · [card calculado **"Aniversário na viagem"**: "🎂 Faz aniversário em dd/MM/yyyy (N anos)" ou "Não faz aniversário durante esta viagem."] · Observações · bloco **Endereço** (CEP, Rua/Logradouro, Número, Complemento, Bairro, Cidade, Estado (UF)).
- `companhia_aerea`, `localizador`, `voo_nacional_necessario`, `contrato_assinado`, `checkin_online_feito` estão no schema/reset mas **sem input visível** (vão no submit com o valor original).
- zod (L51-75): `nome_completo min(2,"Mínimo 2 caracteres")`, `tipo/status enums`, `email: email("Email inválido").or(literal("")).optional()`, demais strings opcionais, `saude: record(string,string)`. **CPF NÃO é validado** aqui.
- "Salvar alterações" (desabilitado se `!isDirty`; escondido p/ somente-leitura) → **`atualizarPassageiroLote(paxId, expId, dados)`** com strings `trim() || null` e `saude` sem chaves vazias (actions.ts L414-447):
  - zod `editarPassageiroLoteSchema` (L262-296) aceita também `contato_emergencia_*`, `pref_*`, `ja_viajou_internacional`, `paises_visitados`, `acompanhante_nome`, `acompanhante_divide_quarto`.
  - `update passageiros set <tudo> where id` ⇒ depois `propagarDadosPessoais(paxId, dados)` (só CAMPOS_PESSOAIS) ⇒ `revalidarPessoa(expedições afetadas)` (+ `/passageiros`, `/avisos`) + `/expedicoes/{id}/passageiros/{paxId}`.
  - Toast "Passageiro atualizado", fecha drawer.

`aniversarioNaViagem(nasc, embarque, retorno)` (`lib/utils.ts` L76-95): para cada ano de `embarque..retorno`, candidato `ano-MM-DD`; se `emb <= cand <= ret` retorna `{data, idade: ano - anoNasc}`. (29/02 em ano não bissexto nunca casa.)

#### B.7.2 Aba "Passageiro" — blocos abaixo do form
1. **Documentos do passageiro**: `PassaporteAnexo` (B.7.6) + `Drive` com `arquivos.filter(passageiro_id)` **desta expedição** e categorias = `CATEGORIA_ARQUIVO` sem "Documentos pessoais" (`Aéreos, Contrato, Bilhetes, Vistos, Seguros, Hospedagem, Vouchers, Cartão de embarque, Outros`). Drive: upload múltiplo/drag&drop → `POST /api/arquivos/upload` com categoria = pasta ativa ("Todos" ⇒ "Outros"); apagar (confirm nativo) → `DELETE /api/arquivos/{id}`.
2. **Quarto e acompanhante** (só leitura): "Alocado no Rooming" (lista `hotel · Quarto n (tipo)` + "Divide com: … / sozinho no quarto") ou "Ainda não alocado em nenhum quarto (aba Rooming)."; "Indicado na inscrição": Acompanhante(s), Vínculo, Dividir quarto/cama, Prefere dividir com — ou "🧍 Viaja sozinho — não indicou acompanhante"; conferência "✓ Bate — está no mesmo quarto que o indicado." / "⚠ Não bate — o acompanhante indicado não está neste quarto."
3. **Perfil & conexões** (só leitura; some se vazio e sem foto): foto 96×96 (`foto_arquivo_id`), Profissão, Como se descreve em grupo, O que mais te anima, Significado, Instagram, Camiseta, Música.
4. **Passeios opcionais** (`PasseiosOpcionaisCompra`, B.7.7), **Extensões** (`ExtensoesCompra`, B.7.8), **ExpedAmigo** (`ExpedamigoPainel`, B.7.9 — só admin).

#### B.7.3 Aba "Prontidão"
Título "Prontidão de embarque" + badge; "Clique numa exigência para editar ou anexar."; `ProntidaoConteudo` (B.7.5). Se pax Cancelado: "Sem dados de prontidão para este passageiro."

#### B.7.4 Aba "Saúde" — `SaudeCampos` (B.9)
"Questionário de saúde — compartilhado entre as expedições da pessoa." Alterações marcam o form como dirty; salvas pelo botão principal (propagam: `saude` é CAMPO_PESSOAL).

#### B.7.4b Rodapé
- `MudarExpedicao` (editor) — B.7.10.
- `ConfirmDeleteButton` **"Remover desta expedição"** — título `Remover "{nome}" desta expedição?`, texto "Remove o passageiro apenas desta expedição. A pessoa continua no sistema (na base global e em outras expedições, se houver). Para apagá-la de vez, use o perfil em Passageiros." → **`excluirPassageiro(paxId, expId)`** (actions.ts L1622-1687):
  - Busca TODAS as linhas (paginado) e verifica se há outra linha com a mesma `chaveIdentidade`.
  - **Tem outras** ⇒ `delete from passageiros where id` (cascata apaga `passageiro_requisitos`, `passageiro_quarto`, `arquivos` do pax!, compras de passeio/extensão, `acesso_links`; `expedicao_voos.passageiro_id` cascade).
  - **Última presença** ⇒ apaga `passageiro_requisitos` do pax e faz `update {expedicao_id:null, grupo_id:null, conexao_viagem_id:null, quarto_id:null}` (vira AVULSO; ⚠️ `passageiro_quarto` NÃO é limpo; `arquivos` continuam com o `expedicao_id` antigo).
  - ⚠️ O botão aparece mesmo para somente-leitura (não está dentro de `!somenteLeitura`); RLS barra no servidor.
- "Fechar" e "Salvar alterações".

#### B.7.5 `ProntidaoPaxDrawer` / `ProntidaoConteudo` / `RequisitoDrawer` / `ContratoDrawer` (ProntidaoPaxDrawer.tsx)
- **ProntidaoPaxDrawer** (aberto pelo badge da tabela): título ShieldCheck + nome, "Prontidão de embarque" + badge, corpo `ProntidaoConteudo`, botão Fechar.
- **ProntidaoConteudo** (L173-307): lista `resultado.checagens` — ponto colorido, `tipo` em negrito, `detalhe` truncado, chevron se clicável.
  - Clique (somente editores): se existe instância ⇒ abre `RequisitoDrawer`; se `Contrato` ⇒ `ContratoDrawer`; se não existe instância e não é de coluna e (`semaforo !== "na"` ou tipo ∈ ANEXO_OPCIONAL) ⇒ `criarRequisitoInstancia(...)` e abre o drawer com a linha criada. `Dados Pessoais` não é clicável.
  - Sem nenhuma instância: caixa "Requisitos de {destino} ainda não instanciados para esta expedição." + botão **"Gerar requisitos de {destino}"** → `gerarRequisitosPadrao(expId)` (toast "Requisitos gerados (N itens)").
- **ContratoDrawer** (L312-379): checkbox **"Contrato assinado"** → salva na hora `atualizarPassageiroCampo(pax,"contrato_assinado",bool)` (otimista com rollback; toasts "Contrato marcado como assinado"/"Marcação de contrato removida") + `Drive` só da pasta `["Contrato"]` ("Anexe o PDF/imagem do contrato assinado. Fica na pasta "Contrato" do passageiro.").
- **RequisitoDrawer** (L384-885) — título = `tipo`, subtítulo `"{nome} — {descricao}"`. Modos por tipo:
  | Modo | Tipos | UI |
  |---|---|---|
  | Questionário | Aéreo Internacional, Aéreo Doméstico, Voo Interno, Vacina, Seguro | Pergunta "necessário?" só p/ Doméstico ("É necessário aéreo doméstico?"), Voo Interno ("É necessário o voo interno?"), Vacina ("É necessária a vacina?"), Seguro ("Seguro contratado?") com pílulas **Sim / Não — dispensar**. Se necessário: aéreos têm "Aéreo comprado com a gente?" Sim/Não ("Em qualquer caso, o voucher é obrigatório.") + **anexo MÚLTIPLO** + "Localizador (opcional)" (→ `numero`); Vacina/Seguro têm **anexo ÚNICO** |
  | Só anexo múltiplo | Ingresso Machu Picchu (**máx. 2**), Ingresso Trem Machu Picchu (ilimitado) | lista de anexos + "Anexar mais" |
  | Só anexo único | Passaporte | anexo grava em `passageiros.passaporte_arquivo_id` (propaga para a pessoa) |
  | Genérico | Visto, RG, outros | pílulas de status (todas as 7), Validade (date), Número / Localizador, Observações |
  Todos: select **Responsável** (`usuarios`, "— sem responsável —"), e "Verificado em AAAA-MM-DD [por X]".
  - `ANEXO_CONFIG` (VERBATIM categorias/labels): Passaporte→"Documentos pessoais" "Anexar foto/PDF do passaporte"; Ingresso MP→"Bilhetes" ("Opcional — até 2 arquivos (imagem ou PDF)."); Ingresso Trem→"Bilhetes" ("Opcional — anexe os dois trechos (ida e volta)."); Aéreo Internacional/Doméstico/Voo Interno→"Aéreos" ("Anexar o voucher já deixa … aprovado."); Seguro→"Seguros" ("Anexar a apólice já deixa o seguro aprovado."); Vacina→"Documentos pessoais" ("Anexar o certificado já deixa a vacina aprovada.").
  - **Upload** (cada arquivo): `POST /api/arquivos/upload` multipart `file, expedicao_id, passageiro_id, categoria (do ANEXO_CONFIG), descricao = "{tipo} — prontidão"`; aceita `image/*,application/pdf` (input). Anexo único: em seguida `atualizarAnexoPassaporte(pax, id)` (Passaporte) ou `atualizarRequisitoCampo(req, exp, "arquivo_id", id)` — salvo IMEDIATAMENTE (não espera "Salvar"). Anexo múltiplo: sobe todos; se o requisito ainda não tinha `arquivo_id`, grava o 1º como `arquivo_id` ("tem comprovante").
  - **Separação de anexos múltiplos**: lista = `arquivos where passageiro_id = pax and categoria = cfg.categoria and descricao startsWith(tipo)` (aéreos dividem "Aéreos"; ingressos dividem "Bilhetes").
  - **Remover anexo único**: grava `null` (o arquivo NÃO é apagado do storage). **Apagar anexo múltiplo**: `DELETE /api/arquivos/{id}` (apaga storage + linha) e, se era o `arquivo_id`, aponta para outro da lista ou null.
  - **Ver**: imagem abre lightbox (portal no body, z-300; fallback "Abrir arquivo em nova aba" se o `<img>` falhar); PDF/outros `window.open(...download?inline=1)`.
  - **Salvar** (L572-615): no modo questionário calcula `statusFinal`: não necessário ⇒ `"Dispensado"` + `observacoes` = "Vacina não necessária" / "Seguro não contratado" / "Voo interno não necessário" / "Trecho doméstico não necessário"; necessário ⇒ `arquivoId ? "Aprovado" : "Pendente"` e, nos aéreos, `observacoes = "Comprado com a gente: Sim|Não"` (o estado "comprado" é relido de `observacoes.includes(...)` — sobrescreve qualquer observação anterior). Monta diffs (`status`, `validade` e `numero` exceto Passaporte, `responsavel_id`, `observacoes`) e chama `atualizarRequisitoCampo` **uma vez por campo** (não atômico). Toast "Requisito atualizado".
  - ⚠️ No modo Passaporte, "Salvar" não muda status (só responsável).

#### B.7.6 `components/arquivos/PassaporteAnexo.tsx` (92 linhas)
Bloco "Passaporte": se anexado "✓ Anexado" + link **Ver** (`/api/arquivos/{id}/download?inline=1`, nova aba) + **Remover** (`atualizarAnexoPassaporte(pax, null)`, não apaga o arquivo); senão botão **"Anexar passaporte"** → upload (`categoria "Documentos pessoais"`, `descricao "Passaporte — prontidão"`) → `atualizarAnexoPassaporte(pax, id)` (propaga `passaporte_arquivo_id` a todas as linhas da pessoa; toast "Disponível em todas as expedições do passageiro."). Aceita `image/*,application/pdf`. **Não comprime.**

#### B.7.7 Passeios opcionais — `PasseiosOpcionaisCompra.tsx` + `passeios-opcionais-actions.ts`
- `listPasseiosOpcionaisDoPax(exp, pax)` (service role): `passeios_opcionais where expedicao_id` + `roteiro_dias (id,dia,titulo) where expedicao_id` + `passeio_opcional_compras(passeio_opcional_id) where passageiro_id`; ordena por `dia` e `titulo`. Seção some se não houver passeios.
- UI: "✨ Passeios opcionais" — "Marque o que o passageiro comprou. O passeio marcado aparece "confirmado" no portal dele (no lugar do dia livre)."; checkbox por passeio (`titulo || "Passeio opcional"`, "Dia {n} · {titulo do dia}"), "comprou ✓". Otimista com rollback.
- `marcarCompraPasseioOpcional(pax, passeio, comprou, exp)`: exige `podeEditar(papel)` ("Seu perfil é somente leitura."); `comprou` ⇒ `upsert passeio_opcional_compras {passageiro_id, passeio_opcional_id}` `onConflict "passageiro_id,passeio_opcional_id", ignoreDuplicates`; senão delete. Service role. Revalida `/expedicoes/{id}/passageiros`.

#### B.7.8 Extensões — `ExtensoesCompra.tsx` + `extensoes-actions.ts`
Idêntico ao anterior: `extensoes where expedicao_id` + `passageiro_extensao where passageiro_id`, ordenado por `nome` pt-BR; UI "Extensões da viagem — Marque as extensões que este passageiro contratou. Os dias e voos da extensão só aparecem no portal de quem contratou."; "contratou ✓"; `marcarExtensao` = upsert/delete em `passageiro_extensao` (onConflict `passageiro_id,extensao_id`), guarda `podeEditar`, service role.
- Impacto em outras telas: rooming de extensão e portal filtram por `passageiro_extensao`.

#### B.7.9 ExpedAmigo — `ExpedamigoPainel.tsx` + `expedamigo-actions.ts`
Painel só renderiza para **admin** (`estadoExpedamigoPax` devolve `admin:false` para outros). Todas as actions exigem `papel === "admin"` e usam **service role** (acesso_senhas não tem policies).
- Estado (`estadoExpedamigoPax`): `passageiros.cpf, liberado_expedamigo`; se CPF tem 11 dígitos, `acesso_senhas (senha_hash, senha_provisoria) where cpf = dígitos`.
- UI: "ExpedAmigo (portal do viajante)"; "Liberado — aparece no portal do viajante" + **Bloquear** / "Não liberado — oculto no portal" + **Liberar ExpedAmigo**. Card "Senha do ExpedAmigo": se `senha_hash` ⇒ "O viajante já criou a própria senha." + **Resetar senha** ("Gera uma nova senha provisória e faz a pessoa voltar ao 1º acesso."); se provisória ⇒ mostra `Login: 000.000.000-00` / `Senha: XXXXXXXX` + **Copiar login e senha** (clipboard `"Login: {cpf mascarado}\nSenha: {senha}"`, toast "Login e senha copiados") + **Nova**; senão "A senha é gerada automaticamente ao liberar."
- `liberarExpedamigo(pax, exp)`: `update passageiros set liberado_expedamigo=true`; se CPF 11 dígitos: se já tem hash ⇒ `jaTemSenha`; se tem provisória ⇒ devolve; senão gera `gerarSenhaAleatoria()` e `upsert acesso_senhas {cpf, senha_provisoria, senha_hash:null}` onConflict cpf. Revalida pax/perfil.
- `bloquearExpedamigo`: `liberado_expedamigo=false`. `gerarNovaSenhaCpf(cpf)`: erro "Passageiro sem CPF válido." se ≠ 11 dígitos; upsert nova provisória com `senha_hash null`. `liberarExpedamigoTodos(exp)` (usado no PortalEditor, não aqui): libera todos não-cancelados e devolve `senhas[]`. `estadoSenhaCpf` (perfil global).
- `gerarSenhaAleatoria()` (lib/acesso-senha.ts): 8 chars do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789` via `crypto.getRandomValues`. `hashSenhaAcesso(cpf, senha) = sha256hex("expedamigo:senha:v1:{cpf}:{senha}")` (usado no portal). `senhaNovaValida`: ≥ 6 chars.
- **SPA**: estas 5 actions precisam de backend com service role (Edge Function ou RPC `security definer` checando `papel='admin'`), pois `acesso_senhas` é inacessível via RLS. ⚠️ Senha provisória fica em texto puro no banco.

#### B.7.10 Mudar de expedição — `MudarExpedicao.tsx` + `mudar-expedicao-actions.ts`
- Link "Mudar de expedição" (tooltip "Corrigir a expedição sem perder os dados") → carrega `listExpedicoesResumo()` (user client, `expedicoes * order data_embarque asc`, filtra `tipo === "expedicao"` — pacotes não aparecem) → `<select>` "Mover para…" (exclui a atual; rótulo `nome · dd/MM/yyyy`) + **Mover** + Cancelar.
- **`mudarExpedicaoPassageiro(pax, novaExp)`** (actions.ts L1696-1754): erro "Já está nessa expedição." se igual; carrega todas as linhas (paginado) e bloqueia "Essa pessoa já está na expedição de destino." se a mesma identidade já tem linha lá; `delete passageiro_requisitos where passageiro_id`; `delete passageiro_quarto where passageiro_id`; `update passageiros set expedicao_id=nova, grupo_id=null, conexao_viagem_id=null, quarto_id=null`; `gerarRequisitosPadrao(nova)`. Mantém status, tipo, financeiro, saúde, perfil, `liberado_expedamigo`, compras de passeio/extensão (⚠️ ficam apontando para passeios/extensões da expedição ANTIGA) e os `arquivos` (⚠️ continuam com `expedicao_id` antigo ⇒ somem do Drive da nova). Toast "Passageiro movido de expedição — dados preservados".

#### B.7.11 `FidelidadeBadge.tsx`
`posicao < 2` ⇒ nada; marcos `[3,5,10]` ⇒ Badge lista "★ {N}ª expedição"; senão texto discreto "{N}ª". Tooltip "{N}ª expedição desta pessoa com a agência".

---

### B.8 Grupos G1/G2 — `grupo-actions.ts` (todas exigem `papel === "admin"`, service role)
- **`definirGrupoRapido(pax, exp, "G1"|"G2"|null)`**: acha `grupos_expedicao where expedicao_id and nome=alvo limit 1`; se não existe cria `{expedicao_id, nome, pax_planejados:0, ordem: G1?1:2}`; `update passageiros set grupo_id`. Revalida `/passageiros` e `/grupos`.
- **`ativarDivisaoGrupos(exp)`**: cria G1/G2 que faltarem. Revalida passageiros e rooming.
- **`removerDivisaoGrupos(exp)`**: `update passageiros set grupo_id=null where expedicao_id` e **`delete from grupos_expedicao where expedicao_id`** (apaga TODOS os grupos da expedição, não só G1/G2 — inclusive G3 e grupos com datas próprias da aba Grupos).
- `usaGrupos` exige exatamente nomes "G1" e "G2".

---

### B.9 Saúde — `lib/saude.ts` + `SaudeCampos.tsx`
`PERGUNTAS_SAUDE` (VERBATIM — campo · pergunta · detalhe quando "Sim"):
1. `problema_saude` — "Você possui algum problema de saúde relevante?" → `problema_saude_qual` "Qual seria o problema de saúde?"
2. `medicamento_diario` — "Você toma algum medicamento diariamente?" → `medicamento_diario_qual` "Qual seria o medicamento?" + `medicamento_refrigeracao` "Esses medicamentos precisam de refrigeração ou do transporte de algum equipamento/seringa para aplicação? Se sim, descreva."
3. `alergia_medicamento` — "Possui alergia a medicamento?" → `alergia_medicamento_qual` "Qual medicamento você tem alergia?"
4. `anafilaxia_emergencia` — "Já teve algum episódio de anafilaxia que precisou procurar emergência?"
5. `alergia_alimentar` — "Possui alergia alimentar?" → `alergia_alimentar_qual` "Qual seria o alimento que você tem alergia?"
6. `restricao_alimentar` — "Possui restrição alimentar?" → `restricao_alimentar_qual` "Qual alimento você possui restrição alimentar?"
7. `limitacao_fisica` — "Possui limitação física que possa impactar caminhadas ou deslocamentos?" → `limitacao_fisica_qual` "Qual limitação física?"
8. `cirurgia_importante` — "Já realizou alguma cirurgia importante ou teve que ficar internado nos últimos 12 meses?" → `cirurgia_qual` "Qual o motivo?"
9. `gravidez` — "Está grávida?" → `gravidez_semanas` "De quantas semanas?"
10. `enjoo_transporte` — "Costuma enjoar em avião, barco ou ônibus?"
11. `medo_altura` — "Tem medo intenso de altura, teleférico ou atividades específicas?"
12. `ronca_cpap` — "Tem algo no seu sono que a gente precise considerar na divisão dos quartos? (ronco, CPAP, sono muito leve)" → `ronca_cpap_qual` "Se sim, qual?"
13. `vacina_febre_amarela` — "Você possui o Certificado Internacional de Vacinação contra Febre Amarela?" → anexo (B.9.1)

(Rótulos curtos `curto` também existem: "Problema de saúde", "Medicamento diário", …, "Certificado de Febre Amarela".)
- Valores gravados: `"Sim"` / `"Não"`; clicar no botão já selecionado limpa (`""`, removido no submit). Detalhes só aparecem com "Sim" (mas não são limpos ao trocar para "Não").
- `resumoSaude(saude)`: só itens "Sim" + detalhes juntados por " · "; `alerta = campo !== "vacina_febre_amarela"` (usado na Área do Líder).
- **B.9.1 Certificado de Febre Amarela** (`AnexoCertificado`): só com "Sim" e com expedição/pax âncora; upload (`categoria "Documentos pessoais"`, `descricao "Certificado Internacional de Vacinação — Febre Amarela"`) → grava o id em `saude.vacina_febre_amarela_arquivo_id` (toast "Certificado anexado — clique em Salvar para confirmar"); Ver (lightbox) / Remover (limpa a chave). ⚠️ Esse anexo NÃO alimenta o requisito "Vacina" diretamente — só via `espalharCertificadoVacina` (procura `descricao ilike '%Febre Amarela%'`) quando requisitos são gerados ou outro slot Vacina recebe anexo.

---

### B.10 Agregação de pessoas, fidelidade e acompanhante

#### B.10.1 `listPessoas()` / `agregar` (`lib/data/pessoas.ts`)
- `passageiros select *` + `expedicoes select *` — ⚠️ **sem paginação ⇒ PostgREST corta em 1000 linhas** (fidelidade e "Adicionar existente" ficam incompletos com base > 1000 reservas).
- Ordena por `created_at` asc; agrupa por `chaveIdentidade`; primeiro registro cria; os seguintes sobrescrevem cada campo com o valor mais recente NÃO nulo (`novo ?? atual`); nome = o último não vazio.
- `expedicoes[]` (só linhas com expedição): `{expedicao_id, passageiro_id, nome, destino, data_embarque, status_reserva, tipo}`, ordenadas por `data_embarque` desc; `totalExpedicoes` = não canceladas; âncora = expedição mais recente. Lista final ordenada por nome pt-BR.

#### B.10.2 Fidelidade (`lib/fidelidade.ts`, VERBATIM)
```ts
export const MARCOS_FIDELIDADE = [3, 5, 10] as const;
export function ehMarco(p) { return p != null && MARCOS_FIDELIDADE.includes(p); }
export function nivelFidelidade(totalExpedicoes) {
  const n = Math.max(0, totalExpedicoes);
  const conquistados = marcos.filter((m) => n >= m);
  const proximo = marcos.find((m) => n < m) ?? null;
  const anterior = [0, ...marcos].filter((m) => m <= n).pop() ?? 0;
  const faltam = proximo != null ? proximo - n : 0;
  const progresso = proximo != null ? (n - anterior) / (proximo - anterior) : 1;
  const tier = n >= 10 ? "Lenda" : n >= 5 ? "Aventureiro" : n >= 3 ? "Explorador" : n >= 1 ? "Viajante" : "Estreante";
  return { tier, conquistados, proximo, faltam, progresso };
}
export function ordinalFem(n) { return `${n}ª`; }
// construirPosicoesFidelidade(pessoas, expedicaoId): por pessoa, participações NÃO canceladas
// ordenadas por data_embarque asc (desempate expedicao_id); posição (1-based) da expedição atual,
// chaveada pelo passageiro_id da linha desta expedição. Cancelado nesta expedição ⇒ sem posição.
```
(`nivelFidelidade` é usado no perfil global; na aba só a posição/badge.)

#### B.10.3 Compras Bitrix (`lib/data/compras.ts`) — usado no perfil global, não nesta aba
`limparComprasBitrix`: remove valor nulo/0; dedup por número `#NNN` no título (mantém o com `bitrix_deal_id === NNN`, senão maior valor/mais recente). `listClientesCompras` agrega por `cpf:` → `bx:` → `nome:` normalizado (total, gasto, ticket médio, moedas, funis, 1ª/última compra), ordena por gasto. `comprasDaPessoa(cpf, contactId)` = `or(cpf.eq.X, bitrix_contact_id.eq.Y)`. `nomeCompra = produto || titulo || "Negócio sem título"`. Service role (leitura também liberada a authenticated pela RLS).

#### B.10.4 Acompanhante (`lib/rooming/acompanhante.ts`, regra VERBATIM)
- `nomesAcompanhante(raw)`: remove `(...)`, divide por `,` `;` ` e ` `&` `/`, descarta pedaços ≤ 1 char.
- `tokensNome`: normaliza (sem acento, minúsculo), tokens ≥ 2 letras, sem stopwords `de, da, do, das, dos, e, di, del, la, van, von`.
- `conferirAcompanhante(indicado, companheiros)`: sem nomes ⇒ `"sem_indicacao"`; `"bate"` se algum nome indicado tem `≥ min(2, nº de tokens)` tokens em comum com algum companheiro; senão `"nao_bate"`.

---

### B.11 Integrações externas

#### B.11.1 "Atualizar do Bitrix" — `bitrix-sync-actions.ts`
`sincronizarExpedicaoBitrix(exp)`: exige `podeEditar`; lê `expedicoes.codigo` (service role); `POST {N8N_SYNC_URL}` headers `Content-Type: application/json`, `x-sync-secret: {N8N_SYNC_SECRET}`, body `{"expedicao_codigo": "<codigo>"}`. Erros: "Integração não configurada (N8N_SYNC_URL ausente).", "Expedição sem código.", "O n8n respondeu {status}.". O n8n lê os deals da coluna do pipeline e chama `/api/bitrix/sync-contato` (ou `passageiro-sync`) por deal; a tabela atualiza via realtime. **SPA**: precisa de Edge Function (segredo não pode ir ao browser).

#### B.11.2 `POST /api/bitrix/passageiro-sync` (38 linhas)
Auth `x-webhook-secret == WEBHOOK_SECRET` (comparação constante via SHA-256, `lib/security/secrets.ts`); body = `passageiroSyncSchema` (VERBATIM): `bitrix_deal_id min(1)`, `bitrix_contact_id nullable`, `expedicao_codigo min(1)`, `estagio_deal min(1)`, `nome_completo min(1)`, `email email().nullable()`, `telefone/cpf/passaporte/validade_passaporte/data_nascimento nullable`, `voo_nacional_necessario boolean nullable`, `observacoes nullable`. Chama `upsertPassageiroBitrix`. Respostas `{ok, passageiro_id, action: "created"|"updated"}` / 400 / 401 / 404 / 500. Campos esperados do n8n (docs): `UF_CRM_CPF, UF_CRM_PASSAPORTE, UF_CRM_PASSAPORTE_VALIDADE, UF_CRM_DATA_NASCIMENTO, UF_CRM_EXPEDICAO_CODIGO, UF_CRM_VOO_NACIONAL, UF_CRM_OBSERVACOES` (já achatados pelo n8n; eventos Bitrix `ONCRMDEALADD/ONCRMDEALUPDATE/ONCRMCONTACTUPDATE`).

#### B.11.3 `POST /api/bitrix/sync-contato` (114 linhas) — o caminho realmente usado pelo botão
Body `{expedicao_codigo, bitrix_deal_id, contato: <objeto cru do crm.contact.get>, endereco: <campo "Endereço de entrega" do deal>}`. Tradução (VERBATIM dos códigos):
- Nome = `NAME + SECOND_NAME + LAST_NAME` (ou "Sem nome").
- CPF = dígitos de **`UF_CRM_1752691408782`** ("CPF 2", string); se < 11, usa **`UF_CRM_1749757426655`** ("CPF", double) com `padStart(11,"0")`.
- Passaporte = **`UF_CRM_1752523114589`** || **`UF_CRM_1783969513247`**; validade = **`UF_CRM_1752523126895`** (`toISO`: ISO ou DD/MM/AAAA).
- `BIRTHDATE` → data_nascimento; `EMAIL[0].VALUE` (só se e-mail válido); `PHONE[0].VALUE`; `ID` → bitrix_contact_id.
- `estagio_deal` fixo `"WON"` ⇒ status **Confirmado** na criação.
- Endereço: `"<texto>|<lat>;<lng>|<locId>"` → texto antes de `|`, CEP `\d{5}-?\d{3}` → `endereco_cep`, resto (sem "CEP: …" final) → `endereco_rua`.

#### B.11.4 `upsertPassageiroBitrix(data, extra)` (`lib/bitrix/upsert-passageiro.ts`)
- `status_reserva = mapBitrixStage(estagio_deal)` (`stage-mapping.ts`, VERBATIM): `NEW/LEAD/PREPARATION/"1" → Lead`; `PROPOSAL/NEGOTIATION/PRE_RESERVA/"2"/"3" → Pré-reserva`; `WON/SIGNED/CONFIRMED/"4" → Confirmado`; `LOST/CANCELED/CANCELLED/REJECTED/"5" → Cancelado`; desconhecido/vazio → Lead (uppercase+trim).
- Expedição por `expedicoes.codigo` (404 "Expedição {codigo} não encontrada").
- **Casamento**: (1) `bitrix_deal_id` global; (2) dentro da expedição: CPF dígitos → `bitrix_contact_id` → `normNome(nome)` + `data_nascimento[0..10]`.
- **Existente ⇒ política "só preenche vazio"**: para `nome_completo, cpf, passaporte, validade_passaporte, data_nascimento, email, telefone, observacoes, bitrix_contact_id, bitrix_deal_id, endereco_cep, endereco_rua`, grava só se o valor veio preenchido E o campo está vazio. `status_reserva` NUNCA é atualizado (cancelamento no Bitrix não cancela aqui). Insere `audit_log {tabela:"passageiros", registro_id, acao:"update", dados_depois: patch, origem:"bitrix-webhook"}`. ⚠️ Não propaga para as outras linhas da pessoa.
- **Novo** ⇒ insert com `expedicao_id, bitrix_contact_id, bitrix_deal_id, nome, cpf, passaporte, validade, nascimento, email, telefone, status_reserva, voo_nacional_necessario ?? false, observacoes, endereco_cep, endereco_rua`; conflito (corrida/índice CPF) ⇒ re-casa e faz update; `audit_log` acao "insert"; `gerarRequisitosPadrao(exp)` (⚠️ falha por RLS — B.4.3). Service role no resto.

#### B.11.5 `POST /api/bitrix/importar-compras` (95 linhas)
Auth webhook secret; aceita `{compras:[...]}`, array, ou objeto único; `max(1000)`; campos `bitrix_deal_id (string|number→string)`, `bitrix_contact_id`, `cpf`(→ só dígitos), `nome_contato`, `titulo`, `produto`, `data_compra`(→ISO), `valor` (string com vírgula aceita), `moeda` (default BRL), `funil`, `etapa`; `upsert compras_bitrix onConflict bitrix_deal_id` (service role). Resposta `{ok, gravadas}`.

#### B.11.6 Outbound para o Bitrix (`lib/bitrix/outbound.ts`) — não disparado por esta aba
`enviarPassageiroParaBitrix(payload)` → `POST N8N_BITRIX_OUTBOUND_URL` com header `x-webhook-secret: WEBHOOK_SECRET`; evento `"inscricao_aprovada"` (usado na aprovação de inscrições, Parte de Inscrições); n8n escreve via `crm.deal.update` / `crm.contact.update`. Melhor esforço (nunca lança).

#### B.11.7 `POST /api/expedamigo/onboarding-diario` (112 linhas) — cron do n8n
- Auth `x-webhook-secret` (dispensada em mock). Body opcional `{dryRun?: boolean, expedicao_codigo?: string}`. Base URL = `NEXT_PUBLIC_SITE_URL` ou origin.
- Seleciona expedições `status <> 'Cancelada' and data_embarque >= hoje` (UTC, `toISOString().slice(0,10)`), opcionalmente por código; pax `status_reserva = 'Confirmado' and liberado_expedamigo <> true`; ignora nomes com `/ACESSO TESTE/i`.
- Link: dryRun ⇒ `{base}/amigo/acesso?t={token}`; real ⇒ link curto `{base}/a/{codigo}` gravando `acesso_links {codigo (10 chars do alfabeto "abcdefghjkmnpqrstuvwxyz23456789", randomBytes), passageiro_id, expira_em: now+30d}` com até 4 tentativas em colisão; fallback link longo.
- Token (`first-access-token.ts`): `base64url(JSON{p: passageiroId, e: now+30d}) + "." + HMAC-SHA256(base64, segredo)` com segredo = `SUPABASE_SERVICE_ROLE_KEY || N8N_SYNC_SECRET || "expedamigo-acesso-dev"`; `verificarTokenAcesso` com `timingSafeEqual` e expiração.
- Mensagem (`montarMensagemOnboarding`, template VERBATIM em `lib/expedamigo/onboarding.ts` L9-24): "Oiii {nome}! Que alegria ter você na {rotulo_viagem} {expedição} 💚 …👉 {link}…" com `{nome}` = primeiro nome, `{rotulo_viagem}` = "Expedição" ou "sua viagem" (pacote), `{termo_viagem}` = "expedição"/"viagem".
- Telefone com ≥ 10 dígitos ⇒ `enviar[]` (n8n manda WhatsApp); senão `pendencias[]` com `motivo:"sem telefone"`. Se não dryRun: `update passageiros set liberado_expedamigo=true where id in enviar` (idempotência; pendências NÃO são marcadas). Resposta `{ok, dryRun, total, enviar[], pendencias[]}` com `{passageiro_id, nome, telefone, cpf, expedicao_codigo, expedicao_nome, link, mensagem}`.
- **SPA**: continua no backend (Edge Function / app antigo). Interage com a aba: o painel ExpedAmigo mostra "Liberado" depois do cron.

#### B.11.8 Arquivos — `app/api/arquivos/*` (dependência de toda a aba)
- `POST /api/arquivos/upload`: exige usuário logado + `podeEditar` (401/403); multipart `file, expedicao_id (obrigatório), passageiro_id?, categoria (∈ CATEGORIA_ARQUIVO, default "Outros"), descricao?`; limite **`MAX_UPLOAD_BYTES = 15 MB`** (413); vazio (400); MIME ∈ `application/pdf, image/jpeg, image/png, image/webp, image/gif, image/heic, image/heif, msword, docx, ms-excel, xlsx, text/csv` (415). Caminho no bucket `arquivos-expedicoes`: `{expedicao_id}/passageiros/{passageiro_id}/{categoria sanitizada}/{uuid}-{nome sanitizado}` (ou `{expedicao_id}/{categoria}/…` sem pax); `safeName` = sem acento, `[^a-zA-Z0-9._-]→_`, máx 120. Insert `arquivos {expedicao_id, passageiro_id, categoria, nome (original), descricao, mime, tamanho_bytes, storage_path}` (service role; se o insert falha, remove o blob). Retorna `{ok, id}`.
- `DELETE /api/arquivos/{id}`: editor; remove blob + linha.
- `GET /api/arquivos/{id}/download[?inline=1]`: usuário logado; `createSignedUrl(storage_path, 300s, inline ? {} : {download: nome})` e redireciona 302.
- **SPA**: com supabase-js direto: `storage.from("arquivos-expedicoes").upload(path)` + insert em `arquivos` (precisa de policies de Storage por papel; hoje o bucket só é acessado via service role) e `createSignedUrl` no cliente.
- `lib/comprimir-imagem.ts` (`comprimirImagem(file)`: imagens → JPEG, maior lado ≤ **2000 px**, qualidade **0.82**, mantém original se falhar ou ficar maior) é usado **só** em `app/inscricao/InscricaoForm.tsx` — NÃO nesta aba. Recomendado adotar no SPA para passaporte/vouchers.

### B.12 Perfil completo — `[paxId]/page.tsx` (182 linhas, Server Component, só leitura + anexos)
- Carrega `getPassageiro(paxId)`, `listArquivosPassageiro(paxId)` (todos os arquivos do pax, qualquer expedição), `getExpedicao(id)`; 404 se o pax não pertence à expedição.
- Cabeçalho: voltar → `/expedicoes/{id}/passageiros`, Avatar 44px (foto), nome, badges Status e Tipo.
- `ExpedamigoPainel` (admin).
- Grid 3 cards: **Dados pessoais** (CPF, Passaporte, Validade passaporte, Nascimento, Email, Telefone — "—" em itálico quando vazio), **Aniversário na viagem**, **Observações** (pre-wrap).
- **Perfil & conexões** (se preenchido): Profissão, Como se descreve em grupo, O que mais te anima, Significado da expedição, Instagram, Camiseta, Música preferida.
- **Documentos do passageiro**: `PassaporteAnexo` + `Drive` (categorias sem "Documentos pessoais").
- Sem edição de dados, sem prontidão, sem saúde nesta página.

---

### B.13 Actions de `expedicoes/actions.ts` pedidas que NÃO são chamadas por esta aba

| Action | Onde é usada | Resumo |
|---|---|---|
| `atualizarDadosPessoais(refId, input)` | `/passageiros` (PassageirosGlobalTabela) | zod `dadosPessoaisSchema` (nome min 2 "Mínimo 2 caracteres", e-mail "E-mail inválido" ou "", cpf/passaporte/validade/nascimento/telefone/contato_emergencia_nome/fone/restricoes/condicoes/saude nullable) → só `propagarDadosPessoais` (todas as linhas da pessoa); erro "Passageiro não encontrado" se 0 afetados |
| `criarPassageiroAvulso(input)` | `/passageiros` | `expedicao_id null`, `tipo Pagante`, `status Lead`; CPF opcional mas se informado precisa `cpfValido`; dedup GLOBAL por CPF (paginado) "Já existe um passageiro com este CPF no sistema."; não gera requisitos |
| `excluirPessoa(refId)` | `/passageiros` | apaga `passageiro_requisitos` e TODAS as linhas da identidade (cascatas); arquivos de storage ficam órfãos |
| `atualizarCustoCampo`, `criarCusto`, `criarPagamento`, `atualizarCustoLote`, `atualizarPagamentoLote`, `excluirCusto`, `excluirPagamento` | **NENHUM chamador** (não existe aba Custos/Pagamentos em `app/(app)/expedicoes/[id]/`) — código órfão | Regras para referência: allowlist custo (`categoria, servico, fornecedor_id, cidade, data_servico, moeda, valor_planejado, valor_realizado, cambio_aplicado, status, pago_por, observacoes`); `criarCusto`: categoria ∈ {Hotelaria, Aéreo, Terrestre, Ingressos, Guias, Seguro, Taxas, Brindes, Outros}, `servico min(2,"Descrição obrigatória")`, `valor_planejado ≥ 0`, câmbio = informado ?? (BRL ? 1 : `getTaxaBrl(moeda)` da tabela `cambios`, fallback 1.0), status inicial "A programar"; `atualizarCustoLote` recalcula `valor_realizado_brl = valor_realizado × câmbio` (coluna comum) e nunca envia `valor_planejado_brl` (generated); `criarPagamento`: `custo_id min(1,"Selecione um custo")`, `entrada default 0`, status = `valor_total - entrada === 0 ? "Pago" : "Pendente"`, `saldo` generated (não enviar); `excluirCusto` bloqueia "Existem N pagamento(s) vinculado(s). Exclua-os antes." |
| `importarPassageirosGlobal` | modo global do mesmo drawer, em `/passageiros` | ver B.3.3 |

**Saldo/financeiro do passageiro**: `saldo_brl = valor_contratado_brl - valor_pago_brl` (generated). Só a importação CSV grava `valor_*` e `status_financeiro` (Cortesia/Quitado/Em aberto). Nenhuma tela desta aba mostra ou edita financeiro do pax; a prontidão TS ignora saldo (a view SQL considerava).

---

### B.14 Permissões (resumo para o SPA)
- **RLS (sessão do usuário)** — usada por: criarPassageiro, adicionarPassageiroExistente, atualizarPassageiroLote/Campo, atualizarAnexoPassaporte, excluirPassageiro, mudarExpedicaoPassageiro, gerarRequisitosPadrao, atualizarRequisitoCampo, criarRequisitoInstancia, importarPassageiros(Global), alocar/desalocarPassageiro. Nenhuma checa papel no app; `relacionamento`/`leitura` são barrados pelas policies RESTRICTIVE da 0046.
- **Service role + guarda no app**: grupo-actions (admin), expedamigo-actions (admin), extensoes/passeios (podeEditar), bitrix-sync (podeEditar), upload/delete de arquivos (podeEditar), webhooks (segredo).
- **UI**: `useSomenteLeitura()` esconde botões; `isAdmin` controla seletor/divisão de grupo e o painel ExpedAmigo.

### B.15 Env vars desta parte
`N8N_SYNC_URL`, `N8N_SYNC_SECRET` (botão Atualizar do Bitrix; também fallback do segredo do token), `WEBHOOK_SECRET` (rotas `/api/bitrix/*`, `/api/expedamigo/*`, outbound), `N8N_BITRIX_OUTBOUND_URL` (outbound), `SUPABASE_SERVICE_ROLE_KEY` (service role e segredo HMAC do token de 1º acesso), `NEXT_PUBLIC_SITE_URL` (links do onboarding), `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` (realtime/cliente).

### B.16 Riscos / armadilhas para a paridade
1. **Propagação de dados pessoais** varre a tabela inteira (`fetchAllRows`) a cada edição — portar para RPC SQL; atenção à mudança de chave (editar CPF/e-mail troca a identidade).
2. **Requisitos não criados para pax do Bitrix** (`gerarRequisitosPadrao` com client anon no webhook) e **idempotência por pax** (pax antigo nunca recebe tipo novo do catálogo, só via clique). Solução: trigger/RPC.
3. **Catálogo duplicado e divergente**: TS (`requisitos-destino.ts`) é o efetivo; tabela `requisitos_destino` (0011) e view `vw_prontidao_passageiro` (0010) estão obsoletas e com regras diferentes (saldo, Pagamento).
4. **Truncamentos de 1000**: `listPessoas` (fidelidade, Adicionar existente) e `getProntidaoExpedicao` (requisitos via `.in()`) não paginam.
5. **Prontidão ok exige ARQUIVO** para Seguro/Aéreos/Vacina (status Aprovado sem anexo continua bloqueando); Passaporte lê `passageiros.passaporte_arquivo_id`; Contrato é neutro; Líder dispensa só Contrato; expedição Concluída = todos Aptos.
6. **ExpedAmigo/senhas, sync Bitrix, onboarding, upload/storage** dependem de service role ou segredos ⇒ Edge Functions. `acesso_senhas.senha_provisoria` é texto puro.
7. **Bugs a não replicar** (ou decidir): export CSV usa `quarto_id` legado; `removerDivisaoGrupos` apaga todos os grupos; excluir última presença não limpa `passageiro_quarto`; mover de expedição mantém compras/extensões/arquivos da expedição antiga; grupo Egito hardcoded por nome; botão "Remover desta expedição" visível a somente-leitura; `passageiro_quarto` com policies para `anon`; CPF inline sem validação; seleção de quarto sem checar capacidade.
8. **Realtime incompleto**: `passageiro_quarto` e `grupos_expedicao` não são assinados.
