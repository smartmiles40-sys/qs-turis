# Parte C: sub-abas da expedição (Grupos, Rooming, Checklist, Documentos/Drive, Links, ExpedAmigo/Portal, Roteiro do Líder)

Fonte: `/tmp/sx` (Next.js 15 App Router). Caminhos abaixo são relativos à raiz do repo. "SA" = Server Action.
Todas as telas ficam em `app/(app)/expedicoes/[id]/<aba>/`. Abas da barra (`ExpedicaoTabsNav.tsx:7-14`): Visão Geral, Passageiros, **Rooming**, **Checklist**, **Documentos**, **Links**, **ExpedAmigo** (`portal`), **Roteiro do Líder** (`roteiro-lider`). **`grupos/` NÃO aparece na barra**: é rota órfã, só se chega pela URL.

## 0. Coisas que valem para todas as abas

- **Cliente Supabase no servidor**: `getServerClient()` (`lib/supabase/typed.ts:18`) = cliente SSR com o JWT do usuário (RLS vale). Exceção: com `NEXT_PUBLIC_DEV_AUTH_BYPASS` e Supabase real, cai em service role. Várias actions usam `createServiceRoleClient()` direto (ignora RLS): upload/delete/download de arquivo, fotos do portal, voucher de hospedagem, passeio opcional, roteiro do líder, liberar ExpedAmigo. **No rebuild (supabase-js direto no browser) essas operações precisam de políticas de RLS/Storage novas ou de Edge Function.**
- **Modo mock**: `DEV_USE_MOCK_DATA` (`lib/dev-mode.ts:30`, env `NEXT_PUBLIC_DEV_USE_MOCK_DATA`). Cada action tem um ramo mock em memória. Ignorar no rebuild.
- **Permissão**: `useSomenteLeitura()` (`components/layout/PermissoesContext.tsx:44`), verdadeiro para os papéis `relacionamento` e `leitura` (`lib/auth/permissoes.ts`). Ele esconde os botões de escrita. `ConfirmDeleteButton` (`components/ui/ConfirmDeleteButton.tsx:51`) retorna `null` para somente-leitura e chama `router.refresh()` quando dá certo.
- **RLS no banco**: as políticas base são permissivas, `authenticated` pode tudo (`0001:353-380`, e o mesmo padrão nas tabelas novas). A migration `0046_rls_read_only.sql` adiciona políticas **RESTRICTIVE** de insert/update/delete `not public.is_readonly()` em: expedicoes, passageiros, custos, pagamentos, checklist_itens, documentos, quartos, passageiro_quarto, links_expedicao, roteiro_dias, expedicao_voos, expedicao_passeios, expedicao_info, expedicao_avisos, roteiro_dia_fotos, passeios_opcionais, passeio_opcional_compras, fornecedores, cambios, requisitos_destino, passageiro_requisitos, grupos_expedicao, roteiro_lider_dias, inscricoes_pendentes, arquivos. `is_readonly()` = `usuarios.papel in ('relacionamento','leitura')` para `auth.uid()`. **Ficaram de fora do 0046: `extensoes` e `passageiro_extensao`**, que seguem graváveis por qualquer usuário autenticado.
- **audit_log**: o trigger `audit_change()` (`0001:303-340`) só existe em `expedicoes, passageiros, custos, pagamentos`. Nesta parte, só as escritas em `passageiros` (conexão `conexao_viagem_id`, `quarto_id` legado, `liberado_expedamigo`) geram auditoria. Quartos, checklist, links, portal e arquivos **não** são auditados.
- **updated_at**: os triggers `set_updated_at` estão em todas as tabelas citadas.
- **Realtime**: hook `useRealtimeRefresh` (`lib/hooks/useRealtimeRefresh.ts`), que escuta `postgres_changes` e chama `router.refresh()` com debounce de 300ms. No rebuild, refazer a query em vez de dar refresh. Tabelas na publicação `supabase_realtime` (`0006_realtime.sql`): expedicoes, passageiros, quartos, custos, pagamentos, checklist_itens, fornecedores, cambios, documentos, arquivos, usuarios, grupos_expedicao; mais links_expedicao (`0008`) e requisitos_destino/passageiro_requisitos (`0013`). **`passageiro_quarto` NÃO está na publicação**: a assinatura dela no Rooming nunca dispara (ver 2.4).
- `ExpedicaoRealtimeSync.tsx:18-26` (layout de toda a expedição) também assina expedicoes, passageiros, quartos, checklist_itens, passageiro_requisitos, arquivos, links_expedicao e documentos.
- **Revalidação**: as SAs chamam `revalidatePath(...)`. No SPA isso vira invalidação de cache (ex.: react-query).
- **Env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (actions com admin), `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_USE_MOCK_DATA`. **Nenhuma aba desta parte fala com o Bitrix.** `checklist_itens.bitrix_task_id` existe, mas sempre é gravado `null`.
- `formatDate`/`daysUntil` (`lib/utils.ts:65`): `daysUntil = differenceInDays(parseISO(d), new Date())` (date-fns, trunca para baixo; prazo de hoje à tarde dá 0 ou −0).

---

## 1. Grupos (`grupos/`, ~280 linhas)

Arquivos: `grupos/page.tsx` (14), `grupos/GruposPageCliente.tsx` (188), `grupos/actions.ts` (77), `lib/data/grupos.ts` (18), `lib/dev-grupos-egito.ts` (94).

### 1.1 O que mostra
- Leitura: `listGruposExpedicao(id)` = `grupos_expedicao.select('*').eq('expedicao_id', id).order('ordem')` (`lib/data/grupos.ts:7-18`).
- Cabeçalho "Grupos" com a descrição "Crie subgrupos (G1, G2, G3…) com datas próprias dentro desta expedição."
- Grade de cards (1/2/3 colunas). Cada card tem: `nome` (EditableCell, texto), `data_embarque` (date), `data_retorno` (date), `pax_planejados` (number), `observacoes` (texto) e uma lixeira.
- Estado vazio: ícone Users, "Nenhum grupo ainda" e "Útil quando a mesma expedição tem várias saídas com datas diferentes."
- Sem realtime, sem filtro, sem contador.

### 1.2 Ações
| Ação | Escrita | Validação |
|---|---|---|
| Adicionar (input "Nome do grupo (ex: G1)" + botão ou Enter) | `criarGrupo` (`actions.ts:18-46`): `insert grupos_expedicao {expedicao_id, nome, data_embarque:null, data_retorno:null, pax_planejados:0, observacoes:null}`. `ordem` não é enviado (default 0) | zod: `nome: z.string().min(1).max(60)`, `pax_planejados: int ≥0 default 0`. No cliente, nome vazio dá o toast "Dá um nome pro grupo (ex: G1, G2…)" |
| Editar campo | `atualizarGrupoCampo(grupoId, expId, campo, valor)` (`:49-66`): `update {[campo]: valor}`. Allowlist `["nome","data_embarque","data_retorno","pax_planejados","observacoes","ordem"]` | `pax_planejados`: null vira 0 |
| Remover | `confirm("Remover grupo "X"? Passageiros vinculados ficarão sem grupo.")` e depois `deletarGrupo` = `delete` | O FK `passageiros.grupo_id ... on delete set null` |
- Revalida `/expedicoes/{id}` e `/expedicoes/{id}/grupos`.
- O EditableCell aparece mesmo para somente-leitura (não há gate no cliente; o RLS 0046 barra no banco).

### 1.3 Banco (`0003_grupos_expedicao.sql`)
`grupos_expedicao(id uuid pk, expedicao_id uuid not null fk cascade, nome text not null, data_embarque date, data_retorno date, pax_planejados int not null default 0, observacoes text, ordem int not null default 0, created_at, updated_at)`, `unique(expedicao_id, nome)`, `check (data_retorno is null or data_embarque is null or data_retorno >= data_embarque)`. Também cria `passageiros.grupo_id uuid fk on delete set null`.

### 1.4 Regras de negócio que dependem de grupos
- **A divisão em grupos é opt-in**: só vale se existir um grupo com nome **exatamente "G1"** e outro **exatamente "G2"** (`RoomingBoard.tsx:191-194`, mesma regra da aba Passageiros). Nesse caso, Rooming, Passageiros e a Área do Líder mostram G1/G2.
- O grupo de um pax é `passageiros.grupo_id` → nome do grupo, se for "G1" ou "G2". Se não houver, entra o **fallback legado do Egito**.
- `lib/dev-grupos-egito.ts` (provisório e hardcoded, assumido no comentário): só vale se `normalize(destino).includes("egito")`. Ele casa o nome normalizado (sem acento, minúsculas, espaços colapsados) por `includes` com os fragmentos abaixo, **do mais longo para o mais curto**:
  - G1: `luis antonio, veronica, livia andrade, isabella gomes, renzo, alana, simone, mirian, roberta lessa, ana julia, lorena, fabiana, matteus, shirley, tania, liduina, lucia regina, isabela zilah, elias, lucineide, ivan, patricia segala, sandra cristina, haroldo`
  - G2: `livia de araujo, augusto, karla regiane, gimmy, alexandre, lilian, fernanda, andre luiz, paulo cesar, carmem, cecilia, lara moreira, luziana, ticiana, antonio mardonio, josefa, gisele, ana caroline, ana priscyla, joaquim, ana paula, beatriz rodrigues galvao, nayara`
  - Usado em `RoomingBoard.tsx:203`, `passageiros/PassageirosTabela.tsx:122` e `app/lider/actions.ts:225`. **Recomendação: no rebuild, migrar isso para `passageiros.grupo_id` (um UPDATE único) e não portar a lista.**
- Portal: um voo pode ter `grupo_id`. O seletor aparece no editor se houver ≥2 grupos (qualquer nome). Ver 6.

---

## 2. Rooming (`rooming/`, ~2.050 linhas + actions)

Arquivos: `page.tsx` (34), `RoomingBoard.tsx` (1366), `NovoQuartoDrawer.tsx` (129), `EditarQuartoDrawer.tsx` (148), `DuplicarHotelDrawer.tsx` (96), `QuartosAutomaticosDrawer.tsx` (149), `ConexaoViagemDrawer.tsx` (139), `lib/rooming/acompanhante.ts` (59). SAs em `app/(app)/expedicoes/actions.ts` (linhas 932-1122, 1539-1579, 1817-2268).

### 2.1 Carga (`page.tsx:11-19`, `lib/data/expedicoes.ts`)
Em paralelo:
- `listPassageiros`: `passageiros.select('*').eq(expedicao_id)` (**sem paginação**, teto de 1000 do PostgREST).
- `listQuartos`: `quartos.select('*').eq(expedicao_id)`.
- `listAlocacoes`: primeiro os ids dos quartos da expedição, depois `passageiro_quarto.select('*').in('quarto_id', ids)`.
- `getExpedicao`: só usa `destino`.
- `listGruposExpedicao`: `{id,nome}`.
- `listExtensoes`: `extensoes` order ordem, created_at → `{id,nome}`.
- `listContratacoesExtensao`: ids das extensões, depois `passageiro_extensao.select('passageiro_id, extensao_id').in('extensao_id', ...)`.

### 2.2 Tabelas
- `quartos` (`0001:137`, `0054`): `id, expedicao_id fk cascade, numero text not null, tipo tipo_quarto not null, hotel_cidade text, check_in date, check_out date, status text not null default 'Reservado', observacoes text, extensao_id uuid fk extensoes on delete set null, created_at, updated_at`. Enum `tipo_quarto = ('Single','Duplo','Twin','Triplo','Compartilhado','Líder')`. Atenção: o app grava `status:'ativo'`, e o drawer de edição oferece `["ativo","cancelado"]`. O default do banco, `'Reservado'`, nunca é usado pelo app. **O status não tem efeito nenhum** (quarto "cancelado" continua no board, conta capacidade e entra no export).
- `passageiro_quarto` (`0016`): `id, passageiro_id fk passageiros cascade, quarto_id fk quartos cascade, created_at, unique(passageiro_id, quarto_id)`. Políticas: `auth_all_select/insert/delete` para **`anon, authenticated`** (anon pode inserir e apagar alocações: **furo de segurança**). Não há política de UPDATE. Está no 0046 (restrictive só para authenticated).
- Legado: `passageiros.quarto_id uuid fk quartos on delete set null` (0001). O board não usa mais (é M2M), mas excluirQuarto/excluirTrecho ainda limpam o campo.
- `passageiros.conexao_viagem_id uuid` (`0019`), com índice. Não é FK: é um token compartilhado.
- `passageiros.acompanhante_nome text`, `acompanhante_divide_quarto text` (null | "Quarto" | "Cama" | "Não") (`0027`).
- `extensoes(id, expedicao_id, nome, descricao, ordem, hospedagem_voucher_arquivo_id)` e `passageiro_extensao(passageiro_id, extensao_id, unique)` (`0052`, `0054`).

### 2.3 Constantes (`lib/constants.ts:122-140`)
```ts
TIPO_QUARTO = ["Single","Duplo","Twin","Triplo","Compartilhado","Líder"]
CAPACIDADE_QUARTO = { Single:1, Twin:2, Duplo:2, Triplo:3, Compartilhado:4, Líder:2 }  // fallback ?? 1
CORES_CONEXAO = ["#2563eb","#16a34a","#db2777","#d97706","#7c3aed","#0891b2","#ca8a04","#e11d48"]  // RoomingBoard.tsx:64
```

### 2.4 Modelo "trecho/hotel"
- **Trecho = agrupamento por (hotel_cidade, check_in, check_out, extensao_id)**. Não existe tabela de hotel: o "hotel" é derivado dos quartos.
- Chave no board (`RoomingBoard.tsx:72-75`): `${hotel.trim().replace(/\s+/g," ")}|${check_in.slice(0,10)}|${check_out.slice(0,10)}|${extensao_id ?? ""}`.
- No servidor há **duas versões diferentes**:
  - `trechoKeyQuarto` (`actions.ts:946`), usada em criarQuarto e renumeração, faz só `trim()` e **não colapsa espaços internos**.
  - `trechoKey` (`actions.ts:1960`), usada em alocar*, colapsa.
  - O rebuild deve usar uma função única (a que colapsa).
- Trechos ordenados por `check_in` (string; null/'' primeiro).
- **Hotel de extensão** (`extensao_id` não nulo): só os pax que contrataram aquela extensão (`passageiro_extensao`) são "relevantes" para o trecho (`paxRelevantesDoTrecho`, `:360-364`). Hotel sem extensão vale para todos os pax ativos.
- **Pax ativos** = `status_reserva !== "Cancelado"` (`:224-227`).
- **Regra**: cada pax tem no máximo 1 quarto por trecho (garantida pelas actions, que apagam a alocação anterior no mesmo trecho). Um pax pode estar em vários trechos (vários hotéis na viagem).
- Realtime (`:213-219`): `quartos` filtrado por expedição, `passageiros` filtrado por expedição, `passageiro_quarto` sem filtro. A última **não dispara** porque a tabela não está na publicação. No rebuild: adicionar `passageiro_quarto` à publicação, ou depender de refetch após cada mutação.

### 2.5 Layout da tela (`:708-1299`)
1. **Cabeçalho**: "Rooming list" + LiveBadge. Subtítulo: `{trechos} hotel(éis) · {quartos} quartos · {paxAtivos} passageiros · arraste para alocar`. Botões:
   - "Exportar Excel": desabilitado se `!completo`, com title "Aloque todos em todos os hotéis para liberar a exportação".
   - Para editores: "Criar quartos automáticos" (abre o drawer sem prefill) e "Novo quarto".
2. **Faixa de obrigatoriedade** (se houver trechos):
   - Verde: "Todos os passageiros estão alocados em todos os hotéis. Exportação liberada. ✅"
   - Vermelha, se houver conexão separada: "Quem viaja junto não pode ficar em quartos separados. Junte antes de exportar:" + lista `{hotel}: {primeiros nomes com " + "} em quartos diferentes`.
   - Âmbar, se faltar alocar: "Faltam alocar {N} no total. A exportação fica bloqueada até todos terem quarto em cada hotel:" + lista `{hotel}: {n} sem quarto`.
3. **Seção recolhível "Viajam juntas — ficam no mesmo quarto"** (fechada por padrão), com badge = nº de conexões e botão "Nova conexão".
   - Lista: bolinha da cor, nomes juntados com " · ", badge com o tamanho, "Editar" (abre o drawer com os membros) e "Desfazer" (ConfirmDelete: "Desfazer esta conexão?" / "As pessoas deixam de ser tratadas como grupo de quarto. As alocações atuais de quarto não mudam.").
   - Vazia: "Marque pessoas que viajam juntas (casal, família)… o sistema **impede** deixá-las em quartos separados."
4. **Seção recolhível "Acompanhantes indicados — informado na inscrição"**: só aparece se algum pax ativo tem `acompanhante_nome`. Por pax: "**{primeiro nome}** quer viajar com **{acompanhante_nome}**" + badge `acompanhante_divide_quarto`.
   - Se já conectados: "✓ vinculados".
   - Se somente-leitura: nomes dos candidatos.
   - Senão: **um `<select>` por nome indicado**. A opção vazia é "Escolher passageiro…" (um nome) ou "— ignorar —" (vários). As opções são todos os pax ativos menos ele, ordenados `localeCompare pt-BR`, e o candidato automático recebe o sufixo " (sugerido)". Botão "Vincular" / "Vincular (n)" chama `conectarPassageiros(expId, [pax, ...escolhidos])`.
   - **Parse do texto** (`nomesAcompanhante`, `:87-93` = `lib/rooming/acompanhante.ts:18-24`): remove `\([^)]*\)`, faz split por `/\s*,\s*|\s*;\s*|\s+e\s+|\s*&\s*|\s*\/\s*/i` e descarta pedaços com ≤1 caractere.
   - **Palpite**: o nome normalizado é igual a outro nome, contém o outro ou está contido nele. Só sugere se houver exatamente 1 candidato.
   - "jaConectados" = o pax tem `conexao_viagem_id` e existe outro ativo com o mesmo token.
5. **Estado vazio** (sem quartos): EmptyState "Monte o rooming por hotel" / "Crie os quartos (com hotel e datas de check-in/out) e depois arraste os passageiros para distribuí-los. O jeito rápido é gerar vários de uma vez." + ação "Criar quartos automáticos".
6. **Uma seção por trecho** (expandida por padrão; o estado de recolhido é local):
   - Header: chevron, ícone de prédio, `hotel_cidade ?? "Hotel"`, `check_in → check_out` (ou "?"), "· N quarto(s)" quando recolhido, badge de grupo (G1/G2/"G1+G2") e badge da extensão (nome).
   - Botões do editor: lápis (renomear inline: input + Salvar/Cancelar, Enter/Esc), calendário (redatar inline: 2 dates, `min` do check-out = check-in).
   - Badge `{alocados}/{relevantes} alocados` (verde se 0 faltando, senão âmbar).
   - "Adicionar quarto": abre o drawer automático com prefill de hotel/datas/extensão e quantidade 1.
   - "Duplicar hotel".
   - "Excluir hotel": ConfirmDelete `Excluir a reserva de "{hotel}"?` / `Serão excluídos os {n} quarto(s) deste hotel e todas as alocações de passageiros neles. Esta ação não pode ser desfeita.`
   - **Status das conexões neste hotel** (se houver conexões): bolinha + primeiros nomes + "juntos · Quarto N" (verde), "a alocar" ou "separados" (vermelho) + link "Juntar no Quarto {âncora}".
   - **Grade**: à esquerda, a dropzone "Sem quarto" (id `sem::{trechoKey}`, badge com a contagem, vazia mostra "Todos alocados neste hotel 👌"). À direita (2 colunas), os quartos.
   - Cada quarto é uma dropzone (id = `quarto.id`) com "Quarto {numero}", badge tipo, badge G1/G2, badge `{ocup}/{cap}` (verde cheio / âmbar parcial / cinza vazio), lápis (editar), copiar (duplicar só este quarto) e excluir (ConfirmDelete; se ocupado: "Há N passageiro(s) alocado(s). Eles serão desvinculados deste quarto.").
   - Vazio: "Arraste passageiros aqui".
   - **Ordem dos quartos**: prioridade de grupo (G1=0, G2=1, nenhum=2) e depois `numero` com `localeCompare('pt-BR',{numeric:true})`.
7. **PaxCard**: grip (se editor), bolinha da cor da conexão (title "Viaja com: …"), Avatar, nome, `tipo`, badge G1/G2.

### 2.6 Drag-and-drop (@dnd-kit/core 6.3)
- `DndContext` com `PointerSensor`, `activationConstraint: {distance: 5}`. **Só PointerSensor**: não há KeyboardSensor nem acessibilidade de teclado.
- Draggable id = `${trechoKey}::${paxId}`. Desabilitado para somente-leitura. O transform usa `CSS.Translate`; sem DragOverlay.
- `onDragEnd` (`:499-517`): `paxId = active.id.split("::")[1]`.
  - Se `over.id` começa com `sem::`: acha o trecho. Se o pax está numa conexão com >1 membro, chama `desalocarConexao(membros, trecho)` (tira **todos** os membros dos quartos daquele trecho, um `desalocarPassageiro` por membro, em sequência). Senão, `desalocar(pax, quartoAtualNoTrecho)`.
  - Senão (over = quarto): `alocar(paxId, quartoId)`.
- Atenção: o draggable carrega o `trechoKey` de origem, mas `alocar` **não confere** se o quarto de destino é do mesmo trecho. Arrastar um pax da coluna de um hotel para o quarto de outro hotel funciona e aloca no hotel de destino. Também **não confere se o pax é relevante para um hotel de extensão** (dá para alocar quem não contratou).
- **`alocar` (`:432-465`)**:
  - `membros = membrosConexaoByPax.get(pax) ?? [pax]` (conexão = bloco).
  - `cap = CAPACIDADE[quarto.tipo] ?? 1`.
  - `ocupFixos` = ocupantes atuais do quarto que não são membros.
  - Se `ocupFixos + membros.length > cap`: toast "A conexão não cabe junta" ("São N pessoas que viajam juntas e o quarto (tipo) comporta cap. Use um quarto maior ou desfaça a conexão.") ou "Quarto cheio" ("{tipo} comporta no máximo {cap} pessoa(s).").
  - Atualização **otimista**: remove as alocações dos membros em quartos do mesmo trecho e adiciona alocações temporárias `tmp-…`.
  - Chama `alocarConexaoNoQuarto` (se >1 membro) ou `alocarPassageiro`. Em erro, faz rollback e toast "Erro ao alocar". Depois `router.refresh()`.
- `desalocar` também é otimista, com rollback.

### 2.7 Valores calculados
- `conexoes`: agrupa os pax ativos por `conexao_viagem_id` e fica só com grupos de **≥2**. A cor é `CORES_CONEXAO[i % 8]`, pela ordem de iteração do Map (instável entre renders se a ordem dos pax mudar).
- `conexaoNoTrecho(membros, trecho)`: conta membros por quarto. `quartoAncora` = quarto com mais membros. `juntos = semQuarto===0 && porQuarto.size===1`.
- `conexoesSeparadas` = (trecho, conexão) com `porQuarto.size > 1`. Membro sem quarto **não** conta como separado.
- `pendencias` = por trecho, quantos pax relevantes estão sem quarto. `totalFaltam` = soma.
- **`completo = trechos.length>0 && totalFaltam===0 && paxAtivos.length>0 && conexoesSeparadas.length===0`**. Isso libera o Excel.
- `temGrupos` = `usaGrupos` e algum pax ativo com grupo resolvido.
- `grupoDoTrecho` = conjunto dos grupos dos alocados: nenhum → null; 1 → aquele; 2 → "misto".
- `grupoDoQuarto`: qualquer pax G1 faz o quarto ser "G1"; senão, algum G2 faz ser "G2"; senão null.
- Com `temGrupos`, os trechos são reordenados por prioridade (G1=0, G2=1, misto=2, null=3) e depois check_in. Antes do primeiro trecho de cada prioridade não nula entra um cabeçalho "Grupo 1" / "Grupo 2" / "Ambos os grupos".

### 2.8 Server actions (todas em `app/(app)/expedicoes/actions.ts`)
| Action | Linhas | O que faz no banco | Validação / regras |
|---|---|---|---|
| `criarQuarto(input)` | 932-1047 | Lê `quartos(hotel_cidade,check_in,check_out)` da expedição e calcula o número provisório = (qtd no mesmo trecho)+1. `insert quartos {expedicao_id, numero, tipo, hotel_cidade, check_in, check_out, extensao_id, observacoes, status:'ativo'}`. Depois `renumerarQuartosSupabase` | zod `novoQuartoSchema`: `expedicao_id min1`, `numero optional (ignorado)`, `tipo enum TIPO_QUARTO`, os demais `string optional nullable`. `""` vira null |
| `criarQuartosAutomaticos(input)` | 1049-1121 | Conta os existentes com `.eq(hotel_cidade).eq(check_in).eq(check_out)` (**ignora extensao_id**). Insere em lote N linhas `{numero: base+i+1, tipo, hotel_cidade, check_in, check_out, status:'ativo', extensao_id}`. Depois renumera. Retorna `{criados}` | zod: `hotel_cidade min1 "Informe o hotel/cidade"`, `check_in min1 "Informe o check-in"`, `check_out min1 "Informe o check-out"`, `tipo enum`, `quantidade int min1 "Mínimo 1 quarto" max100 "Máximo 100 por vez"`. Drawer: `z.coerce.number()...max(100,"Máximo 100")`, default `Duplo`, quantidade 5 (ou 1 com prefill) |
| `renumerarQuartosSupabase` (privada) | 954-977 | Por trecho, ordena por `created_at` e depois `id` e grava `numero = String(i+1)` só onde mudou (N updates paralelos) | **Num lote insert todos ficam com o mesmo created_at**, então o desempate é o uuid aleatório: a ordem dos números dentro do lote é arbitrária. O número **nunca** é editável à mão |
| `atualizarQuarto(id, expId, input)` | 1539-1574 | `update quartos {tipo?, hotel_cidade?, check_in?, check_out?, status?, observacoes?}`. **Descarta `numero`. Não renumera**: mudar hotel/datas de um quarto o move para outro trecho com o número antigo, gerando duplicata ou buraco até a próxima renumeração | zod `editarQuartoSchema` (todos opcionais; `status: z.string()`). Drawer: `status min1`, opções `["ativo","cancelado"]`, salva só se `isDirty`. **O drawer não tem campo de extensão** |
| `excluirQuarto(id, expId)` | 1817-1847 | `update passageiros set quarto_id=null where quarto_id=id`; `delete passageiro_quarto where quarto_id=id`; `delete quartos where id`; renumera | — |
| `excluirTrechoRooming(expId, quartoIds[])` | 1853-1886 | Igual a excluirQuarto, em lote (`.in`); `delete quartos where expedicao_id and id in`. **Não renumera** (não precisa: o trecho some) | ids vazios dão "Nenhum quarto para excluir." |
| `renomearHotelRooming(expId, quartoIds, nome)` | 1892-1919 | `update quartos set hotel_cidade = nome.trim().replace(/\s+/g," ") where expedicao_id and id in` | nome vazio: "Informe o nome do hotel." Se o novo nome colidir com outro trecho de mesmas datas, os dois **se fundem** (efeito colateral) |
| `redatarHotelRooming(expId, ids, ci, co)` | 1925-1956 | `update quartos set check_in, check_out` (slice 0..10, ""→null) | `co < ci` dá "O check-out não pode ser antes do check-in." (validado também no cliente) |
| `alocarPassageiro(pax, quarto, expId)` | 1969-2005 | Lê o quarto alvo e todos os quartos da expedição; calcula os ids do mesmo trecho; `delete passageiro_quarto where passageiro_id and quarto_id in idsTrecho`; `insert {passageiro_id, quarto_id}` | **Sem checagem de capacidade no servidor** (só no cliente). Não é transacional |
| `desalocarPassageiro(pax, quarto, expId)` | 2010-2027 | `delete passageiro_quarto where passageiro_id and quarto_id` | — |
| `duplicarHotelRooming(expId, ids, {hotel_cidade, check_in, check_out})` | 2032-2105 | Para cada quarto de origem: `insert quartos {expedicao_id, numero: q.numero (copia), tipo, hotel_cidade novo, datas novas, status, observacoes}`; lê as alocações da origem e `insert passageiro_quarto` com o novo quarto. Retorna `{criados}`. **Não copia `extensao_id`. Não renumera** (pode colidir números se o destino já existir) | zod: `hotel_cidade z.string().trim().min(1,"Informe o hotel de destino")`. No drawer o botão fica desabilitado sem hotel. Título "Duplicar quarto" (1 id) / "Duplicar hotel". Toast "Quarto duplicado com os mesmos passageiros" / "Hotel duplicado — N quarto(s) com os mesmos passageiros" |
| `conectarPassageiros(expId, ids)` | 2113-2148 | `select passageiros(id, conexao_viagem_id) where expedicao_id and id in ids`. `tokens` = distintos não nulos. `token = tokens.length===1 ? tokens[0] : crypto.randomUUID()`. `update passageiros set conexao_viagem_id=token where id in ids`; se havia tokens, também `update ... where expedicao_id and conexao_viagem_id in tokens` (**merge**: absorve as conexões antigas inteiras) | `<2` ids dá "Selecione ao menos 2 pessoas."; `<2` encontrados dá "Passageiros inválidos." Revalida rooming + passageiros. **audit_log** registra (trigger em passageiros) |
| `removerDaConexao(pax, expId)` | 2154-2185 | Lê o token, faz `update set null where id=pax`. Se sobrarem <2 com o token, `update set null where token` (dissolve) | — |
| `desfazerConexao(expId, conexaoId)` | 2191-2209 | `update passageiros set conexao_viagem_id=null where expedicao_id and conexao_viagem_id=conexaoId`. **Não mexe nas alocações** | — |
| `alocarConexaoNoQuarto(ids, quarto, expId)` | 2215-2262 | Lê o alvo (`hotel_cidade, check_in, check_out, tipo`, **sem `extensao_id`**). `cap = CAPACIDADE[tipo]`. Se `ids.length > cap`: "O quarto ({tipo}) comporta {cap}; a conexão tem {n}." Lê os quartos (`id, hotel, ci, co`, também sem extensao). `delete passageiro_quarto where passageiro_id in ids and quarto_id in idsTrecho`; `insert` N linhas | **Bug**: como `extensao_id` não é selecionado, a chave do trecho ignora extensão, e um hotel de extensão com mesmo nome/datas do principal é tratado como o mesmo trecho. O servidor confere só `ids.length ≤ cap`, sem contar os ocupantes atuais |

**ConexaoViagemDrawer** (`ConexaoViagemDrawer.tsx:56-81`): lista de checkboxes com busca (`nome.toLowerCase().includes`), mostrando "{n} selecionada(s)".
- Criar exige ≥2 ("Selecione ao menos 2 pessoas que viajam juntas.").
- Editar: primeiro chama `removerDaConexao` para cada desmarcado (sequencial); depois, se restarem ≥2 selecionados, `conectarPassageiros(selecionados)`.
- Toasts "Conexão criada" / "Conexão atualizada".

### 2.9 Conferência do acompanhante (`lib/rooming/acompanhante.ts`)
`conferirAcompanhante(indicadoRaw, companheiros[])` retorna `"sem_indicacao" | "bate" | "nao_bate"`.
- Tokens = nome normalizado (NFD, sem diacríticos, minúsculas, espaços colapsados), split por espaço, só tokens com ≥2 caracteres e fora das STOPWORDS `["de","da","do","das","dos","e","di","del","la","van","von"]`.
- Para cada nome indicado: `necessario = min(2, tokens.length)`. "bate" se algum companheiro tiver pelo menos `necessario` tokens em comum.
- Usado no Excel (coluna 9) e na Área do Líder.

### 2.10 Export Excel (exceljs 4.4, carregado com `import("exceljs")` no cliente, `:543-678`)
- Bloqueado se `!completo`. A mensagem do toast "Rooming incompleto" diz "Há pessoas que viajam juntas em quartos diferentes. Junte-as antes de exportar." ou "Aloque todos os passageiros em todos os hotéis antes de exportar."
- `wb.creator = "Sistema de Expedições"`. Arquivo **`rooming.xlsx`**, baixado por Blob + `<a download>`. Toast "Rooming exportado (.xlsx)".
- **Uma aba por trecho**, na ordem dos trechos (check-in). Nome da aba: `hotel_cidade` sem `: \ / ? * [ ]`, trim, cortado em 28 caracteres (fallback "Hotel"). Se repetir (case-insensitive), vira `"{nome} 2"`, `"{nome} 3"`… cortado em 31.
- Largura das colunas A..I: `16,16,34,12,18,16,18,18,34`.
- **A1:I1** mesclado: `Rooming — {hotel}` + `" (Extensão: {nome})"` se for hotel de extensão. Negrito 14.
- **A2:I2** mesclado: `Check-in: {dd/mm/aaaa|—}    •    Check-out: {…}`. Itálico, cor `FF64748B`.
- **Linha 4** = cabeçalho: `["Quarto","Tipo do quarto","Passageiro","Tipo","Data de nascimento","Nº passaporte","Venc. passaporte","CPF","Acompanhante indicado (confere?)"]`. Negrito branco, fundo `FF2563EB`, borda fina `FFE2E8F0`, altura 18.
- A partir da linha 5, quartos ordenados (por grupo, se `temGrupos`, e depois número natural). Com `temGrupos`, antes de cada bloco entra uma faixa mesclada A:I com "Grupo 1 (G1)" / "Grupo 2 (G2)" / "Grupo misto" / "Sem grupo definido", em negrito `FF1E293B` sobre fundo `FFDBEAFE`.
- Uma linha por ocupante. Quarto vazio vira uma linha "(vazio)" em itálico `FF94A3B8`.
  - Col A `Quarto {numero}` e col B `tipo`: só na 1ª linha do quarto, em negrito.
  - C `nome_completo`, D `p.tipo`, E `data_nascimento`, F `passaporte`, G `validade_passaporte`, H `cpf`.
  - A borda inferior da última linha do quarto é **dupla** `FF334155` (separador).
- **Coluna I**: só se o pax tem `acompanhante_nome`.
  - "bate": `✓ {acompanhante}` em verde `FF16A34A`.
  - "nao_bate": `⚠ DIVERGE — indicou {acompanhante}` em negrito `FF92400E` sobre fundo `FFFEF3C7`.
  - "sem_indicacao": vazio.
- Ordem dos ocupantes = ordem das linhas de `passageiro_quarto` (sem sort explícito).
- **Não existe export PDF no Rooming.** O `@react-pdf/renderer` é usado só em `app/amigo/ViagemPDF.tsx` (portal do cliente, fora do escopo). Exceljs também aparece em `passageiros/PassageirosGlobalTabela.tsx` e `api/clientes/export` (outras partes).

---

## 3. Checklist (`checklist/`, ~975 linhas + actions + template)

Arquivos: `page.tsx` (25), `ChecklistTabela.tsx` (814), `NovoChecklistDrawer.tsx` (136), `lib/processos/template.ts` (165), `lib/constants.ts:70-120`.

### 3.1 Carga
`listChecklist`: `checklist_itens.select('*').eq(expedicao_id)` (**sem ordem**; a ordem é calculada no cliente). Também `listUsuarios`: `usuarios.select('*')`. E `getExpedicao` → `data_embarque`.

### 3.2 Banco
`checklist_itens` (`0001:226`, `0009`): `id, expedicao_id fk cascade, etapa etapa_checklist not null, tarefa text not null, responsavel_id fk usuarios set null, status status_checklist not null default 'Pendente', prazo date, prioridade prioridade not null default 'Média', dependencia_id fk self set null, parent_id fk self **on delete cascade**, ordem int not null default 0, evidencia_url, bitrix_task_id, observacoes, created_at, updated_at`. Índices `(expedicao_id, etapa, ordem)`, `parent_id`, `status`. Na publicação realtime.

Enums:
- `etapa_checklist = ('Após o fechamento','12 a 6 meses','6 a 2 meses','2 meses a 15 dias','Na semana','Pós-viagem')`
- `status_checklist = ('Pendente','Em andamento','Atenção','Concluído','Bloqueado')`
- `prioridade = ('Baixa','Média','Alta','Crítica')`

### 3.3 Fases (VERBATIM, `lib/constants.ts:86-109`)
```ts
FASES_CHECKLIST = [
  { etapa: "Após o fechamento", descricao: "Logo após fechar a venda",        diasMin: 365,       diasMax: Infinity, diasReferencia: 300 },
  { etapa: "12 a 6 meses",      descricao: "12 a 6 meses antes do embarque",  diasMin: 180,       diasMax: 365,      diasReferencia: 240 },
  { etapa: "6 a 2 meses",       descricao: "6 a 2 meses antes do embarque",   diasMin: 60,        diasMax: 180,      diasReferencia: 120 },
  { etapa: "2 meses a 15 dias", descricao: "2 meses a 15 dias antes",         diasMin: 15,        diasMax: 60,       diasReferencia: 35 },
  { etapa: "Na semana",         descricao: "Na semana da expedição",          diasMin: 0,         diasMax: 15,       diasReferencia: 5 },
  { etapa: "Pós-viagem",        descricao: "Depois do retorno",               diasMin: -Infinity, diasMax: 0,        diasReferencia: -7 },
];
// faseAtualChecklist(d) = fase com d > diasMin && d <= diasMax  (d = daysUntil(data_embarque))
```

### 3.4 Template padrão (VERBATIM, `lib/processos/template.ts:26-77`)
São 23 processos (a fonte é o ClickUp "Processos - Expedição"). Todos com `papel: "operacional"`; nenhum usa `offsetDias`.
```ts
// ─── Após o fechamento ───
{ etapa:"Após o fechamento", tarefa:"Atualizar Planilha de Controle da Expedição", papel:"operacional", prioridade:"Média" },
// ─── 12 a 6 meses ───
{ etapa:"12 a 6 meses", tarefa:"Criar alerta do voo principal e fazer emissão", prioridade:"Crítica",
  subtarefas:["Criar alerta de preço do voo principal","Acompanhar variação de tarifa","Definir melhor data de emissão","Emitir bilhetes do voo principal","Conferir localizadores"] },
{ etapa:"12 a 6 meses", tarefa:"Monitorar e reservar hotéis", prioridade:"Alta",
  subtarefas:["Levantar opções de hotel por cidade","Comparar tarifas e política de cancelamento","Fazer pré-reserva","Confirmar reserva","Salvar confirmação"] },
{ etapa:"12 a 6 meses", tarefa:"Falar com fornecedores para reservar passeios", prioridade:"Alta",
  subtarefas:["Listar passeios do roteiro","Cotar com fornecedores/DMC","Reservar passeios","Confirmar disponibilidade"] },
{ etapa:"12 a 6 meses", tarefa:"Comprar voos internos", prioridade:"Alta",
  subtarefas:["Mapear trechos internos do roteiro","Emitir voos internos"] },
{ etapa:"12 a 6 meses", tarefa:"Alimentar Planilha Controle de Expedições", prioridade:"Média",
  subtarefas:["Lançar custos reservados","Atualizar status de cada item"] },
{ etapa:"12 a 6 meses", tarefa:"Checar hospedagens mais baratas", prioridade:"Média",
  subtarefas:["Revisar tarifas atuais","Comparar alternativas","Trocar se houver economia"] },
// ─── 6 a 2 meses ───
{ etapa:"6 a 2 meses", tarefa:"Conferir se todos os voos estão confirmados", prioridade:"Crítica",
  subtarefas:["Conferir voo principal","Conferir voos internos","Validar localizadores","Conferir bagagem incluída","Conferir assentos"] },
{ etapa:"6 a 2 meses", tarefa:"Salvar nova confirmação de hospedagem", prioridade:"Alta",
  subtarefas:["Solicitar reconfirmação aos hotéis","Salvar vouchers atualizados"] },
{ etapa:"6 a 2 meses", tarefa:"Confirmar passeios e horários dos transfers", prioridade:"Alta",
  subtarefas:["Confirmar horários de transfer com DMC"] },
{ etapa:"6 a 2 meses", tarefa:"Travel Design", prioridade:"Média",
  subtarefas:["Montar roteiro visual day-by-day","Revisar com o time"] },
{ etapa:"6 a 2 meses", tarefa:"Confirmar com clientes documentação", prioridade:"Alta",
  subtarefas:["Conferir validade de passaportes","Conferir necessidade de visto"] },
{ etapa:"6 a 2 meses", tarefa:"Caixa Brinde e Logomarca", prioridade:"Baixa",
  subtarefas:["Definir itens da caixa de brinde","Aprovar arte da logomarca","Solicitar produção","Conferir recebimento","Separar por passageiro"] },
// ─── 2 meses a 15 dias ───
{ etapa:"2 meses a 15 dias", tarefa:"Conferir se todos os voos estão confirmados", prioridade:"Crítica",
  subtarefas:["Reconferir voo principal","Reconferir voos internos","Validar localizadores","Conferir alterações de malha","Conferir assentos"] },
{ etapa:"2 meses a 15 dias", tarefa:"Verificar última possibilidade de troca de hospedagens", prioridade:"Média",
  subtarefas:["Revisar tarifas finais","Trocar se houver ganho real","Atualizar vouchers"] },
{ etapa:"2 meses a 15 dias", tarefa:"Confirmar passeios e horários dos Transfers", prioridade:"Alta",
  subtarefas:["Reconfirmar horários com DMC"] },
{ etapa:"2 meses a 15 dias", tarefa:"Receber Travel Design", prioridade:"Média",
  subtarefas:["Receber arte final do Travel Design","Revisar conteúdo"] },
{ etapa:"2 meses a 15 dias", tarefa:"Colocar todas as informações no app", prioridade:"Alta" },
{ etapa:"2 meses a 15 dias", tarefa:"Checar restrições alimentares para voo e preferência de assentos pagos", prioridade:"Média" },
// ─── Na semana ───
{ etapa:"Na semana", tarefa:"Imprimir todas as reservas de passagens pra Luis", prioridade:"Alta",
  subtarefas:["Imprimir bilhetes aéreos"] },
{ etapa:"Na semana", tarefa:"Imprimir todas as hospedagens por pessoa", prioridade:"Alta",
  subtarefas:["Imprimir vouchers de hospedagem por passageiro"] },
{ etapa:"Na semana", tarefa:"Imprimir os vouchers dos passeios para líderes", prioridade:"Alta" },
{ etapa:"Na semana", tarefa:"Reunião de apresentação da Expedição", prioridade:"Crítica" },
```
Totais: 23 pais + 57 subtarefas = **80 linhas**. Não há processos em "Pós-viagem".

**Algoritmo `construirChecklistPadrao`** (`template.ts:103-165`):
- Para cada processo, na ordem acima:
  - `ordemFase` = contador por etapa (1, 2, 3…).
  - `baseOffset = proc.offsetDias ?? fase.diasReferencia ?? 30`.
  - `offset = baseOffset − (ordemFase−1)*2`: dentro da fase, cada processo seguinte vence 2 dias **mais perto** do embarque.
  - `prazo = data_embarque − offset dias` (`new Date(dataEmbarque)` + `setDate` + `toISOString().slice(0,10)`, sujeito a deslocamento de fuso: em UTC−3, `new Date("2026-10-01")` é meia-noite UTC, então o `setDate` local pode errar 1 dia; replicar com aritmética de data pura).
  - Pai: `{etapa, tarefa, responsavel_id: responsavelPorPapel[papel] || null, status:"Pendente", prazo, prioridade, parent_id:null, ordem: ordemFase}`.
  - Subtarefas: mesmo prazo, prioridade e responsável do pai, `parent_id` = pai, `ordem = i+1`.
- Exemplo: na fase "12 a 6 meses" os pais vencem em embarque−240, −238, −236, −234, −232, −230.

### 3.5 Ações
| Ação | Detalhe |
|---|---|
| **Gerar checklist padrão** (só no estado vazio) | `gerarChecklistPadrao(expId)` (`actions.ts:1330-1413`): (1) lê `expedicoes.data_embarque` (sem expedição: "Expedição não encontrada"); (2) se já houver itens, "Esta expedição já tem checklist. Apague os itens antes de regerar."; (3) `usuarios.select('id, papel')` e `primeiroPorPapel` = o primeiro usuário de cada papel, na ordem retornada pelo banco (**não determinístico**); (4) insere os pais em lote com `{expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, ordem}` e `.select('id')`, mapeando o id temporário para o real pelo índice; (5) insere os filhos com `parent_id` real. Não é transacional (falha no passo 5 deixa só os pais). Toast `Checklist criado · {total} itens`. Se `data_embarque` for null, quebra (`new Date(null)` = 1970). A UI só avisa "Defina a data de embarque da expedição para prazos precisos." |
| **Nova tarefa / Tarefa avulsa** (drawer) | Campos: Tarefa (min 2, "Mínimo 2 caracteres"), Etapa (default **"6 a 2 meses"**), Prioridade (default "Média"), Prazo (date), Responsável (opção `_none` "— sem responsável —" + usuários), Observações. `criarChecklistItem` (`:1243-1316`): zod `tarefa min(2,"Tarefa obrigatória")`, `etapa enum`, `prioridade enum default Média`, `parent_id optional` (a UI nunca manda: **não dá para criar subtarefa pela UI**). `ordem` = count de irmãos (mesmo `parent_id`, ou top-level `parent_id is null` da mesma etapa) + 1. Insert com `status:'Pendente', dependencia_id:null, evidencia_url:null, bitrix_task_id:null`. Revalida checklist + visão geral |
| **Editar campo** | `atualizarChecklistCampo(itemId, campo, valor)` (`:615-650`): allowlist `etapa, tarefa, responsavel_id, status, prazo, prioridade, observacoes`; `status` precisa estar em STATUS_CHECKLIST ("Status inválido"). `update checklist_itens`. Revalida `/expedicoes` (layout) e `/dashboard` (alimenta agregados da lista de expedições e o card de processos do dashboard). Na UI só são editáveis **status** (checkbox Concluído↔Pendente ou EditableSelect) e **observacoes** (EditableCell). Etapa, tarefa, responsável, prazo e prioridade são só leitura na tabela |
| **Excluir** | ConfirmDelete `Excluir "{tarefa}"?` / com filhos: `Isto remove também {n} subtarefa(s).` `excluirChecklistItem` (`:2431-2456`): `update set dependencia_id=null where dependencia_id=id`, depois `delete`. As subtarefas caem pelo FK `parent_id on delete cascade` |

Realtime: `checklist_itens` filtrado por `expedicao_id`.

### 3.6 Telas
- **Vazio** (`ChecklistVazio`): ícone Sparkles, "Nenhum processo cadastrado", "Gere o checklist padrão com os **23 processos operacionais** da expedição, organizados nas 5 fases de antecedência. Os prazos são calculados automaticamente a partir da data de embarque." Botões "Gerar checklist padrão" e "Tarefa avulsa".
- **Cabeçalho**: "Checklist de processos" + LiveBadge. `{concluídos top-level}/{top-level} processos concluídos · fase atual: {fase}`. Toggle **Timeline | Gráfico | Kanban** (estado local, default Timeline) e "Nova tarefa".
- **Triagem "Precisa de atenção"** (`ChecklistTriagem`, considera **todos** os itens, incluindo subtarefas, não concluídos):
  - atrasados = `daysUntil(prazo) < 0`, do mais atrasado ao menos atrasado;
  - vencendo = `0..3` dias;
  - bloqueados = status "Bloqueado".
  - Pills com as contagens. Lista com até 6 urgentes (atrasados + vencendo), mostrando tarefa, badge etapa, avatar do responsável e "{n}d de atraso" / "vence hoje" / "vence em {n}d", mais "+ N outro(s) na lista abaixo".
  - Sem alertas: faixa verde "Tudo em dia — nenhum processo atrasado ou vencendo nos próximos dias. 🎉"
- **FaseTimeline**: chips só das fases que têm itens top-level. Mostram `{done}/{total}`. Estilos: fase atual (borda editável + "agora"), completa (verde + check), passada (cinza) e futura.
- **Timeline (tabela)**: colunas `[chevron+checkbox] | Processo | Responsável | Prazo | Dias | Prioridade | Status | Observações | [excluir]`.
  - Agrupado por etapa na ordem de ETAPA_CHECKLIST, só etapas com itens. A linha de grupo tem etapa + "fase atual" + descrição + `done/total` + barra de progresso %.
  - Pais ordenados por `ordem`. As subtarefas expandem pelo chevron (estado local) e aparecem recuadas, ordenadas por `ordem`. O pai mostra o badge `{subDone}/{n}`.
  - Linha vencida (prazo < hoje e não concluída) com fundo vermelho.
  - "Dias": `{−d}d atraso` em vermelho; `<7` em âmbar; senão `{d}d`.
  - Concluído aparece riscado.
- **Gráfico**: uma coluna por etapa (todas as 6, inclusive vazias "Nada aqui"), com a atual em destaque "AGORA". Cards com os top-level da fase (ordem, depois prazo): tarefa, prazo (vermelho se atrasado), avatar e status editável. Legenda de cores por status.
- **Kanban** (só top-level, **somente leitura**, sem drag): colunas `Pendente[Pendente] | Em andamento[Em andamento] | Atenção[Atenção, Bloqueado] | Concluído[Concluído]`. O card mostra tarefa, badge etapa, prazo e responsável.
- Cores: STATUS_VARIANT `{Pendente:auto, Em andamento:lista, Atenção:atencao, Concluído:vinculado, Bloqueado:critico}`; PRIORIDADE_VARIANT `{Baixa:auto, Média:lista, Alta:atencao, Crítica:critico}`.

---

## 4. Documentos / Drive (`documentos/page.tsx` 146, `components/arquivos/Drive.tsx` 323, `lib/data/arquivos.ts` 44, rotas API 134+45+52)

### 4.1 Tabela `arquivos` (`0005`, `0035`, `0051`)
`arquivos(id uuid pk, expedicao_id uuid not null fk cascade, passageiro_id uuid fk passageiros **cascade** (null = arquivo da expedição), categoria categoria_arquivo not null default 'Outros', nome text not null (nome original), descricao text, mime text, tamanho_bytes bigint, storage_path text not null unique, uploaded_by uuid fk usuarios set null (**nunca preenchido pelo app**), created_at, updated_at)`.
- RLS: authenticated pode tudo + restrictive 0046. Está no realtime.
- Enum `categoria_arquivo`: `'Aéreos','Documentos pessoais','Contrato','Bilhetes','Vistos','Seguros','Hospedagem','Vouchers','Outros','Cartão de embarque'`.
- Ordem no app (`CATEGORIA_ARQUIVO`, `lib/constants.ts:225`): `["Aéreos","Documentos pessoais","Contrato","Bilhetes","Vistos","Seguros","Hospedagem","Vouchers","Cartão de embarque","Outros"]`.
- **`descricao` é usada como marcador semântico** (contrato com o portal/líder):
  - `"Documento do líder"` (`MARCADOR_DOC_LIDER`);
  - `"Foto roteiro"`, `"Foto passeio opcional"`, `"Voucher hospedagem"`, `"Voucher"`, `"Voucher da hospedagem"`, `"PDF 1"`, `"PDF 2"` (o rótulo do VoucherAnexo);
  - para `Bilhetes` do pax: prefixos `"Ingresso Machu Picchu"` / `"Ingresso Trem Machu Picchu"` (lidos por `app/amigo/actions.ts:571-583`).

### 4.2 Storage
- Bucket **`arquivos-expedicoes`** (privado). **Nenhuma migration cria o bucket nem políticas em `storage.objects`**: todo acesso é por service role no servidor. **O rebuild com supabase-js no browser precisa de políticas de Storage** (ou de Edge Functions de upload/download).
- Path (`upload/route.ts:96-102`):
  - Arquivo de expedição: `{expedicao_id}/{safeName(categoria)}/{uuid}-{safeName(nome)}`.
  - Arquivo de pax: `{expedicao_id}/passageiros/{passageiro_id}/{safeName(categoria)}/{uuid}-{safeName(nome)}`.
  - `safeName` = NFD, sem acento, `[^a-zA-Z0-9._-]` vira `_`, até 120 caracteres. Ex.: "Aéreos" vira "Aereos" e "Cartão de embarque" vira "Cartao_de_embarque".
- **Limites**: `MAX_UPLOAD_BYTES = 15*1024*1024` (15 MB, retorna 413 "arquivo excede o limite de 15 MB"). Arquivo vazio dá 400. MIME na allowlist `MIME_ARQUIVO_PERMITIDOS`, senão 415 "tipo de arquivo não permitido: {type}":
  `application/pdf, image/jpeg, image/png, image/webp, image/gif, image/heic, image/heif, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv`.
  A categoria fora da lista dá 400 "categoria inválida".

### 4.3 Rotas
- **POST `/api/arquivos/upload`** (multipart: `file`, `expedicao_id` (obrigatório), `passageiro_id?`, `categoria` (default "Outros"), `descricao?`).
  - Auth: `getCurrentUser()` (401) e `podeEditar(papel)` (403 "Seu perfil é somente leitura.").
  - Service role: `storage.upload(path, buffer, {contentType: file.type || "application/octet-stream", upsert:false})`, depois `insert arquivos {expedicao_id, passageiro_id, categoria, nome: file.name, descricao, mime, tamanho_bytes, storage_path}`.
  - Se o insert falhar, remove o blob (compensação).
  - Retorna `{ok:true, id}`. Não valida que o pax pertence à expedição.
- **DELETE `/api/arquivos/[id]`**: auth + podeEditar. Lê `storage_path`, `storage.remove([path])` e depois `delete arquivos`. 404 se não existir. Os FKs que apontam para `arquivos` (`roteiro_dia_fotos.arquivo_id` cascade; `expedicao_voos/passeios/info.arquivo_id*`, `passeios_opcionais.foto_arquivo_id`, `expedicoes/extensoes.hospedagem_voucher_arquivo_id` com set null) se resolvem sozinhos.
- **GET `/api/arquivos/[id]/download[?inline=1]`**: auth (qualquer logado). `createSignedUrl(path, 300 s, inline ? {} : {download: nome})` e depois **302 redirect**. O preview de imagem do Drive usa a URL sem `inline` (funciona em `<img>`).

### 4.4 Tela Documentos (`documentos/page.tsx`)
- Carga: passageiros, `documentos` (por pax da expedição), expedição (`notFound` se não existir), `listArquivosExpedicao` (`arquivos where expedicao_id order created_at desc`), filtrado para `passageiro_id === null`.
- **Card "Drive da expedição"**: "Arquivos compartilhados (não vinculados a um passageiro). Pra anexar algo de um pax específico, abre o perfil dele em Passageiros." Contém `<Drive expedicaoId arquivos/>`.
  - **Atenção**: aparecem aqui também os arquivos-sistema do portal (fotos do roteiro, vouchers, PDFs, docs do líder), porque todos têm `passageiro_id null`. Apagá-los aqui quebra o portal (os FKs set null limpam a referência).
- **Tabela "Status de documentos por passageiro"** ({n} passageiros), **somente leitura**. Colunas: `Pax | Passaporte (mono; "Falta" vermelho) | Validade (vermelho se alerta) | Visto (Sim/Não por documentos.visto_necessario) | Status Visto | Seguro (badge: Emitido verde/Solicitado âmbar/outro) | Apólice (link "Ver" de documentos.apolice_url, ou link "Anexar no perfil" → /expedicoes/{id}/passageiros/{paxId}) | Voos nac. (passageiros.voo_nacional_necessario) | Status geral`.
  - Vazia: "Sem passageiros nessa expedição."
  - **Inclui pax cancelados** (sem filtro).
- **Status geral** (`:28-36`):
  ```
  embarqueDias = daysUntil(data_embarque) ?? 0
  se !passaporte → "Crítico"
  se daysUntil(validade_passaporte) − embarqueDias < 180 → "Crítico"   (passaporte vence < 180 dias após o embarque)
  se documentos.seguro_status !== "Emitido" → "Pendente"
  se visto_necessario && status_visto !== "Aprovado" → "Pendente"
  senão "OK"
  ```
  Tabela `documentos` (0001): `passageiro_id, visto_necessario bool, status_visto text default 'Não necessário', seguro_status text default 'Pendente', apolice_url, observacoes`.

### 4.5 Componente Drive (reusado no perfil do pax)
- Props: `expedicaoId`, `passageiroId?`, `arquivos`, `categorias?` (default todas), `pastaInicial?`.
- Chips de pasta: "Todos" ({total}) e uma por categoria com ícone e contagem.
- Dropzone (drag de arquivos do SO) e botão "Selecionar arquivos" (multiple). O upload é **sequencial**, um POST por arquivo, com `categoria = pastaAtiva === "Todos" ? "Outros" : pastaAtiva`. Toast de erro por arquivo e, no fim, sempre "N arquivo(s) enviado(s)" (mesmo com falhas).
- Lista: ícone da categoria, nome (clicável → lightbox se `mime image/*`), `categoria · tamanho (B/KB/MB/GB 1 casa) · data pt-BR`, olho (imagem), baixar (`/api/arquivos/{id}/download`, `download=nome`) e apagar (`confirm("Apagar "X"?")` + DELETE).
- **Os botões de upload e apagar NÃO têm gate de somenteLeitura no cliente** (a API devolve 403).
- Vazio: "Nenhum arquivo ainda." / "Nenhum arquivo em {pasta}."
- Realtime: `arquivos` filtrado por `expedicao_id`. Se for o Drive de um pax, só refaz quando `payload.new/old.passageiro_id === passageiroId`.

---

## 5. Links (`links/`, ~340 linhas)

Arquivos: `page.tsx` (12), `LinksGrid.tsx` (198), `LinkDrawer.tsx` (129). SAs `actions.ts:2333-2425`.

### 5.1 Banco (`0008`)
`links_expedicao(id, expedicao_id fk cascade, label text not null, url text not null, ordem int not null default 0, created_at, updated_at)`. Índices `(expedicao_id)` e `(expedicao_id, ordem)`. Realtime com `replica identity full`. A política `anon_read_dev` foi removida pela 0036. **O portal do cliente lê essa tabela** (seção 6.6).

### 5.2 Tela
- `listLinks`: `order ordem asc, created_at asc` (se a tabela não existir, retorna `[]`).
- Cabeçalho "Links da expedição" + LiveBadge. Contador: "Nenhum link ainda — adicione o primeiro." ou "N link(s) cadastrado(s)". Botão "Novo link".
- Grade 1/2/3 colunas. Cada card é um `<a target=_blank rel="noopener noreferrer">` com ícone, label, ícone ExternalLink no hover e `prettyUrl` (host+path+search sem "/" final, em mono).
- Ações no hover: **Copiar** (`navigator.clipboard.writeText(url)`, toast "URL copiada" / "Não foi possível copiar"), Editar e Excluir.
- **Ícone por regex** em `${label} ${url}`.toLowerCase() (`LinksGrid.tsx:33-42`, na ordem):
  1. `/docs\.google\.com\/spreadsheets|sheet|planilha|excel|airtable/` → planilha
  2. `/docs\.google\.com\/presentation|slides|presentation|apresenta|canva|figma/` → apresentação
  3. `/drive\.google|dropbox|onedrive|pasta|folder/` → pasta
  4. `/youtube|vimeo|video/` → vídeo
  5. `/whatsapp|wa\.me|chat\.whatsapp|telegram|t\.me/` → chat
  6. `/landing|^lp|setuforeu|site|domain/` → globo
  7. senão → link
- Vazio: "Nenhum link cadastrado" / "Cole aqui apresentação, landing page, planilha financeira, drive, grupo do WhatsApp — qualquer URL relevante pra essa expedição." + "Adicionar primeiro link".
- **Não há reordenação na UI** (`ordem` é aceito pelo `atualizarLink`, mas nada o envia).

### 5.3 Ações
- **Drawer** (criar/editar): Nome (`min1 "Nome obrigatório" max80`) e URL (`z.string().url("URL inválida (use https://...)")`).
  - Ao criar, chips de sugestão: `["Apresentação","Landing page","Planilha financeira","Roteiro / Day-by-day","Pasta no Drive","Grupo do WhatsApp","Vídeo de divulgação"]`.
  - Editar só salva se `isDirty`.
- `criarLink`: zod `label min1 max80`, `url url`. `ordem = count(links da expedição)` (base 0). Insert com `label.trim()`, `url.trim()`.
- `atualizarLink(id, expId, {label?, url?, ordem? int≥0})`: update.
- `excluirLink`: delete.
- Revalida `/expedicoes/{id}/links`.
- Realtime: `links_expedicao` filtrado por expedição.

---

## 6. ExpedAmigo / Portal (`portal/`, ~1.600 linhas)

Arquivos: `page.tsx` (61), `PortalEditor.tsx` (1295), `portal/actions.ts` (239), `lib/portal-voos.ts` (33). Mais `passageiros/expedamigo-actions.ts` (`liberarExpedamigoTodos`). O editor alimenta `/amigo` (portal do cliente, que fica no app antigo). **Por isso as colunas e convenções abaixo são contrato.**

### 6.1 Carga (`page.tsx`)
- `listRoteiro`: `roteiro_dias order data asc nulls last, dia asc, ordem asc`.
- `listVoosExpedicao`, `listPasseios`, `listInfoDestino`, `listAvisos`, `listPasseiosOpcionais`, `listExtensoes`: todos `listPortal` = `select * eq expedicao_id order ordem, created_at`. Erro `42P01` retorna `[]`.
- `listRoteiroFotos`.
- `listGruposExpedicao`.
- `getCurrentUser()`: `isAdmin = papel === "admin"`.
- `expedicoes.hospedagem_voucher_arquivo_id`.
- Somente-leitura: só mostra o aviso "Modo leitura — a edição do conteúdo do ExpedAmigo fica disponível apenas para perfis de edição (admin/operação)." (`PortalEditor.tsx:102-120`).
- **Sem realtime.**

### 6.2 Tabelas e colunas (contrato com `/amigo`)
| Tabela | Colunas (migrations) | Campos do editor |
|---|---|---|
| `roteiro_dias` (0021, 0052, 0053) | `id, expedicao_id, dia int not null default 1, data date, titulo text not null, descricao, cidade, refeicoes, hospedagem, ordem, extensao_id fk extensoes set null, apenas_sem_extensao bool not null default false` | Inline (6.4) |
| `expedicao_voos` (0021, 0024, 0052, 0053, 0055, 0057) | `id, expedicao_id, trecho text not null default 'Ida', companhia, numero_voo, origem, destino, partida text, chegada text, localizador, observacoes, ordem, arquivo_id fk arquivos set null, extensao_id, apenas_sem_extensao, grupo_id fk grupos_expedicao set null, passageiro_id fk passageiros cascade` | trecho* ("Ida / Volta / Interno"), companhia, numero_voo, origem ("São Paulo (GRU)"), destino ("Lima (LIM)"), partida ("12/08 23:50"), chegada ("13/08 03:10"), localizador, observacoes; `grupo_id` (select "Voo de qual grupo?": "Todos os grupos" + "Só {nome}", só se ≥2 grupos); `extensao_id` ("Faz parte de", só se houver extensões); voucher `arquivo_id` |
| `expedicao_passeios` (0021, 0024) | `id, expedicao_id, nome text not null, data date, horario text, local text, incluso bool not null default true, observacoes, ordem, arquivo_id` | nome*, data, horario ("06:00"), local, observacoes; voucher `arquivo_id`. **`incluso` não é editável** (fica true) |
| `expedicao_info` (0021, 0033, 0034) | `id, expedicao_id, titulo not null, conteudo not null, ordem, arquivo_id, arquivo_label, arquivo_id_2, arquivo_label_2` | titulo* ("Moeda e câmbio"), conteudo*; "PDF 1" (`arquivo_id` + `arquivo_label`) e "PDF 2" (`arquivo_id_2` + `arquivo_label_2`), categoria do upload "Outros" |
| `expedicao_avisos` (0022) | `id, expedicao_id, tipo text not null default 'Aviso', titulo not null, conteudo not null, ordem` | tipo select `["Aviso","Boa prática","Dica"]`, titulo*, conteudo* |
| `roteiro_dia_fotos` (0022) | `id, expedicao_id, roteiro_dia_id fk cascade, arquivo_id fk arquivos cascade, legenda, ordem` | Upload no dia (legenda sempre null) |
| `passeios_opcionais` (0044, 0049) | `id, expedicao_id, roteiro_dia_id fk cascade, titulo, descricao, foto_arquivo_id fk arquivos set null, whatsapp_url, ordem, tipo text not null default 'opcional'` (`'opcional'` \| `'adicional'`) | Card inline (6.4), **no máximo 3 por dia** (limite só na UI) |
| `passeio_opcional_compras` (0044) | `passageiro_id, passeio_opcional_id, unique` | Marcado no perfil do pax (outra parte); lido pelo portal |
| `extensoes` (0052, 0054) | `id, expedicao_id, nome not null, descricao, ordem, hospedagem_voucher_arquivo_id` | nome* ("Extensão Mar Vermelho — +3 dias"), descricao ("aparece no topo da extensão no portal"); voucher "Voucher da hospedagem" (`hospedagem_voucher_arquivo_id`) |
| `expedicoes.hospedagem_voucher_arquivo_id` (0030) | fk arquivos set null | Card "Voucher da hospedagem" |
| `links_expedicao` | ver 5 | aba Links |
| `quartos` + `passageiro_quarto` | ver 2 | portal mostra "seus quartos" |

RLS de todas: authenticated pode tudo + restrictive 0046 (exceto `extensoes`/`passageiro_extensao`).

### 6.3 Actions do portal (`portal/actions.ts`)
- Todas começam com `negarSeLeitura()` (`getCurrentUser` + `podeEditar`).
- **CRUD genérico**, com a tabela vinda do cliente e checada contra a allowlist `TABELAS = ["roteiro_dias","expedicao_voos","expedicao_passeios","expedicao_info","expedicao_avisos","passeios_opcionais","extensoes"]`:
  - `criarItemPortal(tabela, expId, valores)`: `ordem = count(*) where expedicao_id` (base 0, **por expedição, não por dia**), depois `insert {expedicao_id, ordem, ...valores}` com cliente do usuário (RLS).
  - `atualizarItemPortal(tabela, id, expId, valores)`: `update valores where id`.
  - `excluirItemPortal(tabela, id, expId)`: delete. Para `roteiro_dias`, cascateia fotos (só as linhas: **os blobs e as linhas de `arquivos` ficam órfãos**) e passeios opcionais (a foto também fica órfã).
  - **Não há validação de colunas/tipos**: o cliente manda qualquer chave. O rebuild deve tipar.
- `adicionarFotoRoteiro(expId, diaId, arquivoId, legenda)`: **service role**. `ordem = count where roteiro_dia_id`, depois insert.
- `excluirFotoRoteiro(fotoId, arquivoId, expId)`: service role. Delete da foto, remoção do blob no Storage e delete da linha de `arquivos` (best-effort).
- `excluirPasseioOpcional(id, fotoArquivoId, expId)`: service role. Delete do passeio e, se houver foto, remove blob + linha.
- `definirVoucherHospedagem(expId, arquivoId|null)`: service role. `update expedicoes set hospedagem_voucher_arquivo_id`.
- Revalida `/expedicoes/{id}/portal`.

### 6.4 Comportamento do editor
- **Cabeçalho**: "Portal do ExpedAmigo" / "O que você preencher aqui aparece para o passageiro em `/amigo`."
- **LiberarTodosCard** (só `isAdmin`):
  - Botão "Liberar para todos", que pede confirmação inline ("Confirmar?" Sim/Cancelar).
  - `liberarExpedamigoTodos(expId)` (`expedamigo-actions.ts:63-111`, **exige admin, service role**):
    - Pax da expedição com `status_reserva !== "Cancelado"`. `update passageiros set liberado_expedamigo=true where expedicao_id and status_reserva<>'Cancelado'` (auditado).
    - Para cada CPF único de 11 dígitos: lê `acesso_senhas(cpf, senha_hash, senha_provisoria)`. Se já tem `senha_hash`, conta como "já tinha". Se tem `senha_provisoria`, reaproveita. Senão gera `gerarSenhaAleatoria()` (8 caracteres do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789`, `crypto.getRandomValues`, `lib/acesso-senha.ts:52`) e faz `upsert acesso_senhas {cpf, senha_provisoria, senha_hash:null} onConflict cpf`.
    - `acesso_senhas` **não tem políticas RLS**: só service role. No rebuild, precisa de **Edge Function**.
  - Resultado: "{total} liberados · {n} já tinham senha própria · {n} com senha provisória". Tabela Passageiro / CPF (formatado) / Senha provisória.
  - "Copiar lista": linhas `{nome} — CPF {000.000.000-00} — senha {senha}` separadas por `\n`.
  - Rodapé: "Repasse a senha provisória para cada viajante — no 1º acesso ele troca por uma própria."
- **VoucherHospedagem**: "Um arquivo só, vale para todos os passageiros (mesmo hotel)."
  - Upload (`accept image/*,application/pdf`) por `/api/arquivos/upload` com `categoria "Vouchers"`, `descricao "Voucher hospedagem"`, sem pax. Depois `definirVoucherHospedagem(id)`.
  - Anexado: "✓ Voucher anexado", "Ver" (`download?inline=1`) e "Remover" (primeiro `definirVoucherHospedagem(null)`, depois `DELETE /api/arquivos/{id}`).
- **Secao genérica** (Extensões, Voos de grupo, Passeios e ingressos, Informações do destino, Avisos e boas práticas):
  - Lista com `resumo` e ações no hover: lápis e ConfirmDelete "Excluir este item?". "Adicionar" abre o **ItemDrawer**. Vazio: "Nada cadastrado ainda."
  - ItemDrawer: título `{Adicionar|Editar} — {titulo}`, subtítulo "Estas informações ficam visíveis para o passageiro."
    - Valida os obrigatórios (`Preencha: {label}`).
    - Normaliza: `""` vira null; number vira Number; checkbox vira bool; select de avisos começa em `opcoes[0]`.
    - **Sentinela de segmento**: no select `extensao_id`, o valor `"__base__"` grava `extensao_id=null, apenas_sem_extensao=true`; qualquer outro valor grava `apenas_sem_extensao=false`.
    - O bloco `extra` (anexos) só funciona depois de salvo ("Salve o voo primeiro para anexar o voucher.").
- **Ordem de exibição**:
  - Voos: `ordenarVoosCronologico` (`lib/portal-voos.ts`). `parseDataVooMs` aplica `/(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/` sobre `partida`; ano com 2 dígitos vira 2000+. Voos com data vêm primeiro (por timestamp, depois `ordem`); os sem data vão para o fim por `ordem`, depois `created_at`. O placeholder "12/08 23:50" (sem ano) **não casa** a regex, então cai na ordem de cadastro.
  - Demais seções: `ordem, created_at`. Não há reordenação manual.
- **Resumos**:
  - Voo: `{trecho}: {origem} → {destino}` + "· voucher ✓" + badge do grupo + badge de segmento. Segunda linha: `companhia · numero_voo · partida` ou "sem detalhes".
  - Passeio: "nome · voucher ✓". Segunda linha: `data · horario · local`.
  - Info: título + "· PDF ✓".
  - Aviso: badge tipo + título.
  - Extensão: nome + "· hospedagem ✓".
- **Os voos individuais (`passageiro_id` não nulo) aparecem misturados na lista "Voos de grupo"** do editor (não há filtro). São criados em outra tela (perfil do pax).
- **Seletor "Faz parte de"** (`paresExtensao`): `[{"" : "Grupo principal (todos veem)"}, {"__base__": "Só quem NÃO fez extensão (ex.: último dia / volta do grupo)"}, ...extensões{id: nome}]`. Rótulo curto: o nome da extensão, ou "Só quem não estende".
- **RoteiroInline** ("Roteiro dia a dia — Clique num dia pra editar aqui mesmo — salva sozinho ao sair do campo."):
  - **"Adicionar dia"**: `dia = max(dia)+1`; `data` = maior data existente + 1 dia (normaliza `slice(0,10)+"T00:00:00"`, e `toISOString()` pode deslocar o fuso); `titulo = "Dia {n}"`; o resto null; `apenas_sem_extensao:false`. O dia novo abre expandido.
  - **Duplicar dia** (ícone copiar): copia `data, titulo, cidade, refeicoes, hospedagem, descricao, extensao_id, apenas_sem_extensao`, com `dia = max+1`. **Não copia fotos nem passeios.**
  - Linha do dia: badge `D{dia}`, título, badge de segmento, `data · cidade · N foto(s) · N passeio(s) opcional(is)`, indicador "salvando"/"salvo" (some em 1,3 s), copiar, excluir (ConfirmDelete "Excluir este dia?") e chevron.
  - Expandido: Dia (numeric; vazio ou inválido grava 1), Data, Título, Cidade, Refeições ("Café, Almoço"), Hospedagem, "Faz parte de" (só se houver extensões; muda na hora com `mudarExtensao`) e Descrição.
  - **Salvamento por campo no `onBlur`**, só se mudou: `""` vira null (o título vazio vira null, mas a coluna é `not null`, então o update falha com toast de erro).
  - **FotosRoteiro**: "Enviar fotos" (`accept image/*`, multiple). Para cada arquivo: upload com `categoria "Outros"`, `descricao "Foto roteiro"`, depois `adicionarFotoRoteiro`. Grade 3 colunas com `<img src=/api/arquivos/{id}/download?inline=1>` e remover (×) por `excluirFotoRoteiro`. Vazio: "Nenhuma foto ainda."
  - **PasseiosOpcionaisDia**: "Adicionar passeio" (desabilitado com ≥3, rótulo "Máx. 3") cria `{roteiro_dia_id, titulo:null, descricao:null, foto_arquivo_id:null, whatsapp_url:null, tipo:"opcional"}`. Texto: "Ofertas para o dia livre. Aparecem no portal do passageiro; quando ele compra, você marca no perfil dele e o passeio entra “confirmado” no lugar do dia livre."
  - **PasseioOpcionalCard**:
    - Foto 16×16: upload com `descricao "Foto passeio opcional"`, depois update `foto_arquivo_id`. Remover: primeiro update null, depois DELETE do arquivo.
    - Título ("Título (ex.: Balonismo na Capadócia)") e descritivo, salvos no blur (trim; `""` vira null).
    - Select tipo: `opcional` = "Opcional — substitui o dia inteiro"; `adicional` = "Adicional — não substitui o dia" (com aviso "É oferecido no portal com o WhatsApp; quando adquirido, aparece como “adquirido” **sem** substituir o dia no roteiro.").
    - WhatsApp ("Link do WhatsApp (https://wa.me/55…)", **sem validação de URL**). Lixeira **sem confirmação**, via `excluirPasseioOpcional`.
- **VoucherAnexo** (voos, passeios, info PDF1/PDF2, extensões):
  - "{rotulo} (1 arquivo)". Upload (`image/*,application/pdf`) com `categoria` (default "Vouchers"; "Outros" no info) e `descricao = rotulo`. Depois `atualizarItemPortal(tabela, itemId, {[campo]: arquivoId})`.
  - Anexado: "✓ Anexado", "Ver", "Remover" (update null + DELETE).
  - Com `labelCampo` (info), um input "Nome do link (ex.: "Baixar visto")" salva no blur `arquivo_label` / `arquivo_label_2`.
  - Texto: "Imagem ou PDF — fica disponível para o passageiro baixar."
  - Trocar o arquivo exige Remover e depois Anexar (substituir direto deixaria o antigo órfão, mas a UI não permite).

### 6.5 Upload de anexos do portal (resumo do contrato)
Todo anexo do portal é uma linha em `arquivos` com `passageiro_id = null`, `expedicao_id` = a expedição, no bucket `arquivos-expedicoes`, path `{exp}/{Categoria}/{uuid}-{nome}`. A referência fica em:

| Uso | Categoria | descricao | Coluna |
|---|---|---|---|
| Foto de dia | Outros | "Foto roteiro" | `roteiro_dia_fotos.arquivo_id` |
| Foto de passeio opcional | Outros | "Foto passeio opcional" | `passeios_opcionais.foto_arquivo_id` |
| Voucher de voo/passeio | Vouchers | "Voucher" | `expedicao_voos.arquivo_id` / `expedicao_passeios.arquivo_id` |
| PDFs de info | Outros | "PDF 1"/"PDF 2" | `expedicao_info.arquivo_id(_2)` |
| Hospedagem da extensão | Vouchers | "Voucher da hospedagem" | `extensoes.hospedagem_voucher_arquivo_id` |
| Hospedagem geral | Vouchers | "Voucher hospedagem" | `expedicoes.hospedagem_voucher_arquivo_id` |

### 6.6 Como `/amigo` consome (confirmado em `app/amigo/actions.ts:320-620`; não é spec de UI)
- Usa **service role**. Lê tudo das expedições da pessoa (`fetchAllRows` paginado): links_expedicao, quartos, passageiro_quarto (dos ids do pax), roteiro_dias, expedicao_voos, expedicao_passeios, expedicao_info, expedicao_avisos, roteiro_dia_fotos, passeios_opcionais, passeio_opcional_compras, extensoes, passageiro_extensao e `arquivos` por pax nas categorias `Bilhetes`, `Seguros`, `Cartão de embarque`, `Vouchers`.
- Gera **signed URLs de 7 dias** (`createSignedUrls(lote de 100, 604800)`) só para expedições futuras.
- **Regras de visibilidade que o rebuild precisa manter ao gravar**:
  - `veSegmento(extensao_id, apenas_sem_extensao)`: se `extensao_id` não é null, só quem contratou aquela extensão vê. Se `apenas_sem_extensao=true`, só quem **não** contratou nenhuma extensão vê. Senão, todos veem. Vale para roteiro_dias e voos.
  - `veGrupo(grupo_id)`: null, todos veem; senão só `passageiros.grupo_id === grupo_id` (admin vê tudo).
  - **Voo individual** (`passageiro_id`): se o pax tem algum voo próprio na expedição, vê **só os dele** e ignora os de grupo. Quem não tem vê os de grupo (aplicando segmento e grupo).
  - Roteiro ordenado por `data (null = 9999-12-31)`, `dia`, `ordem` (a "Data" manda na ordem). Fotos por `ordem, created_at`. Passeios opcionais por `ordem, created_at`, com `comprou` (de `passeio_opcional_compras`) e `tipo ?? "opcional"`.
  - Voos por `ordenarVoosCronologico`. Passeios, info, avisos, links e extensões por `ordem, created_at`.
  - Info: `pdfs = [{arquivo_id, arquivo_label}, {arquivo_id_2, arquivo_label_2}]`, com rótulo padrão "Baixar PDF".
  - Hospedagem: `expedicoes.hospedagem_voucher_url`. Na UI do amigo o voucher geral é escondido se alguma extensão contratada tem voucher próprio (`page.tsx:602`).
  - Quartos do pax: `{numero, tipo, hotel_cidade, check_in, check_out}` ordenados por check_in.
  - Ingressos: `arquivos` do pax com categoria `Bilhetes` e `descricao` começando com "Ingresso Machu Picchu" / "Ingresso Trem Machu Picchu"; os demais Bilhetes viram `ingressos_gerais` com rótulo = descricao.
  - `expedicoes.tipo` (`'pacote'` ou expedição, migration 0060) muda o texto.
  - Alerta "inscrição incompleta": `perfil_viajante` vazio.
  - O PDF do cliente (`app/amigo/ViagemPDF.tsx`, @react-pdf) usa esses mesmos dados.

---

## 7. Roteiro do Líder (`roteiro-lider/`, ~400 linhas)

Arquivos: `page.tsx` (26), `RoteiroLiderEditor.tsx` (206), `DocsLiderPanel.tsx` (115), `actions.ts` (54), `lib/lider/offline.ts` (140, contrato do cliente /lider).

### 7.1 Banco (`0029_roteiro_lider.sql`)
- `roteiro_lider_dias(id, expedicao_id fk cascade, dia int not null default 1, data date, fase text, local text, programacao text, lideres_ativos text (nomes separados por " · "), pax text (aceita "18 → 25"), observacoes, alerta_nivel text (null|'Crítico'|'Atenção'|'Verificar', **sem CHECK**), alerta_texto, alerta_acao, alerta_responsavel, ordem int, created_at, updated_at)`.
- Índice `(expedicao_id, ordem)`. RLS: authenticated pode tudo + 0046. Fora do realtime.
- Também cria `expedicoes.viagem_grupo text` (rótulo compartilhado entre expedições irmãs, ex.: "Japão & China 2026 Out/Nov") e `expedicoes.grupo_rotulo text` ("G1"/"G2"). /lider junta os roteiros das irmãs pelo `viagem_grupo` (Mapa de Líderes). **Esses campos não são editados nesta aba.**

### 7.2 Tela
- Carga: `listRoteiroLider` (`listPortal`: `order ordem, created_at`) + `listArquivosExpedicao` filtrado `passageiro_id == null && descricao === "Documento do líder"`.
- **DocsLiderPanel** "Documentos da Área do Líder": "PDFs da expedição para os líderes (ex.: manual do líder). Aparecem na seção “Documentos da expedição” do portal do líder e ficam disponíveis offline."
  - Lista com nome, "Ver" (`download?inline=1`) e "Remover" (`confirm("Remover "X" da Área do Líder?")` + DELETE `/api/arquivos/{id}`).
  - "Adicionar PDF" (`accept application/pdf,image/*`): upload com `categoria "Outros"`, `descricao "Documento do líder"`, sem pax. Toast "Documento adicionado — Já aparece na Área do Líder."
  - Vazio: "Nenhum documento ainda."
  - **Sem gate de somente-leitura no cliente** (a API devolve 403).
- **RoteiroLiderEditor** "Roteiro do Líder — Resumo operacional dia a dia — o que a equipe traduz pro líder. Aparece na Área do Líder."
  - Lista na ordem `ordem` (= ordem de inserção; **não ordena por `dia` nem `data`**). Cada linha: bloco "DIA {n}", `fase` (caixa alta pequena), `programacao ?? "—"`, depois `data · local · 👤 lideres_ativos · {pax} pax · {emoji} {nivel}`. Editar/excluir aparecem no hover (excluir com `window.confirm("Excluir o Dia N?")`).
  - Vazio: "Nenhum dia cadastrado ainda. Clique em “Adicionar dia”."
  - **Drawer** (painel fixo à direita, custom):
    - Campos: Dia (numeric, placeholder "1"), Data, "Fase / região" ("TÓQUIO"), Programação (textarea), Local ("Cidade"), Pax ("24"), "Líderes ativos · separe por ·" ("Everton · Jacqueline · Beatriz"), Observações.
    - Bloco "Alerta operacional (opcional)": Nível com `NIVEIS = ["", "Crítico", "Atenção", "Verificar"]` e `EMOJI = {"Crítico":"🔴","Atenção":"🟠","Verificar":"🟡"}` (a opção vazia é "— sem alerta —"). Com nível escolhido aparecem "Descrição do alerta", "Ação necessária" e "Responsável" ("Operações + DMC").
    - Validação: falha só se `programacao` **e** `dia` estiverem vazios ("Preencha ao menos o dia e a programação").
    - Normalização: `trim`, `""` vira null; `dia` vazio ou inválido vira 1. Trocar o nível para vazio **não limpa** texto/ação/responsável (ficam gravados).
- Actions (`roteiro-lider/actions.ts`, **service role** + `negarSeLeitura`):
  - `criarDiaLider(expId, valores)`: `ordem = count where expedicao_id`, depois insert.
  - `atualizarDiaLider(id, expId, valores)`.
  - `excluirDiaLider(id, expId)`.
  - Revalida `/expedicoes/{id}/roteiro-lider`.

### 7.3 Contrato com /lider (só dados)
- `app/lider/actions.ts` (service role) lê `roteiro_lider_dias` inteira (paginada) e ordena por **`ordem` e depois `dia`** (`:311`). Junta as irmãs por `viagem_grupo` em `grupos: {rotulo: grupo_rotulo, dias}[]`.
- Documentos da expedição = `arquivos` com `passageiro_id null` e `descricao === "Documento do líder"` → `LiderArquivo {id, nome, mime, categoria, tamanho}`. Arquivos de pax entram em `passageiros[].arquivos` e nas checagens de prontidão.
- O líder também recebe dados do Rooming (`quartos_alocados {hotel, numero, tipo}`, `companheiros_quarto`, `acompanhante_nome`) e o grupo G1/G2 (`grupo_id` ou o fallback do Egito).
- **Offline** (`lib/lider/offline.ts`), roda no dispositivo do líder. IndexedDB `lider-offline` v2 com as stores `expedicoes` (chave `expId`, valor `ExpedicaoSalva {expId, cpf, senha (texto puro!), nome, master, expedicao: LiderExpedicao, savedAt}`) e `docs` (chave `arquivo_id`, valor `{blob, mime, nome}`). A v1 tinha a store `snapshot`, apagada no upgrade.
  - `coletarArquivosExpedicao` deduplica os ids de `documentos` + `passageiros[].arquivos` + `checagens[].arquivos`.
  - `tamanhoOfflineExpedicao` soma `tamanho` (= `arquivos.tamanho_bytes`).
  - **O rebuild tem de manter `arquivos.tamanho_bytes` e `mime` preenchidos e o formato de `LiderExpedicao` (`app/lider/actions.ts:81-131`)**, se o /lider continuar no app antigo.

---

## 8. Riscos e pontos de atenção para o rebuild

1. **Service role espalhado**: upload, download e delete de arquivo, fotos e passeios do portal, voucher de hospedagem, roteiro do líder e liberar ExpedAmigo. No SPA: políticas de Storage para o bucket `arquivos-expedicoes` (hoje inexistentes) e RLS. `acesso_senhas` (sem política) exige Edge Function.
2. **Furo de RLS**: `passageiro_quarto` permite INSERT/DELETE para `anon`. `extensoes` e `passageiro_extensao` estão fora da trava de somente-leitura da 0046.
3. **Realtime do rooming incompleto**: `passageiro_quarto` não está na publicação.
4. **Rooming não transacional**: alocar é delete + insert sem transação. A capacidade só é checada no cliente (`alocarPassageiro` não confere). A chave de trecho tem 3 implementações divergentes (board colapsa espaços; `trechoKeyQuarto` não colapsa; `alocarConexaoNoQuarto` ignora `extensao_id`). Recomenda-se uma RPC Postgres `alocar_no_quarto(pax_ids[], quarto_id)` com checagem de capacidade e trecho.
5. **Renumeração**: o número é derivado (por trecho, por `created_at`). Inserts em lote empatam no `created_at`. Duplicar e editar quarto não renumeram. Melhor numerar com `row_number()` em view ou RPC.
6. **Status de quarto sem efeito** (`ativo`/`cancelado` vs. default `'Reservado'`). O drawer de edição não tem extensão. Duplicar não copia `extensao_id`.
7. **Checklist**: geração não transacional (pais e filhos em 2 inserts). `data_embarque` null gera prazos de 1970. A escolha do responsável padrão é não determinística. Prazos com bug de fuso (`new Date("YYYY-MM-DD")` + `setDate` local).
8. **Portal**: CRUD genérico sem validação de colunas. A sentinela `__base__` precisa ser preservada (vira `apenas_sem_extensao=true`). Excluir um dia deixa órfãos `arquivos` e blobs de fotos e passeios. Os voos individuais aparecem na lista de voos de grupo. Título vazio no inline falha por `not null`.
9. **Marcadores em `arquivos.descricao`** ("Documento do líder", "Ingresso Machu Picchu"…) são contrato com /amigo e /lider. O Drive da aba Documentos mostra e deixa apagar esses arquivos-sistema.
10. **Hardcodes**: a lista de nomes G1/G2 do Egito (dados pessoais no código), "Imprimir … pra Luis" no template e o limite de 3 passeios opcionais, que só existe na UI.

## 9. Contagem aproximada de linhas
| Área | Linhas |
|---|---|
| Grupos (page+cliente+actions+lib) | 14+188+77+18+94 = ~390 |
| Rooming (UI) + acompanhante | 34+1366+129+148+96+149+139+59 = ~2.120 |
| Rooming (SAs em actions.ts) | ~620 (932-1122, 1539-1579, 1817-2268) |
| Checklist (UI+template+SAs) | 25+814+136+165 + ~220 = ~1.360 |
| Documentos/Drive + API | 146+323+44+134+45+52 = ~744 |
| Links (UI+SAs) | 12+198+129 + ~95 = ~434 |
| Portal (UI+actions+voos) + liberarTodos | 61+1295+239+33 + ~50 = ~1.680 |
| Roteiro do Líder + offline | 26+206+115+54+140 = ~541 |
