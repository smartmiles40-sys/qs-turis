# SPEC — Sistema de Expedições (app antigo) — funcionalidades INTERNAS

> Fonte: repo `sistema-expedicoes` (checkout em `/tmp/sx`, último commit `941ec63` "feat(roteiro): dias sempre em ordem cronologica…").
> Escopo: `app/(app)/**` + server actions + `lib/**` + `app/api/**` chamadas pelas telas internas.
> Fora do escopo (ficam no app antigo): `app/amigo`, `app/lider`, `app/inscricao`, `app/a`, `app/acesso`, e a tela `cambios` (dependências de câmbio estão listadas na Parte D).
> Gerado em 21/10/2026. Leitura apenas — nada foi alterado no repo.

## 0. Visão geral técnica

- **Stack antigo**: Next.js 16.2.9 (App Router, Server Components + Server Actions), React 19.2, Tailwind v4, TanStack Table v8, @dnd-kit (core 6.3 / sortable 10), react-hook-form + zod 4, sonner (toasts), cmdk (command palette), date-fns pt-BR, recharts, **exceljs 4.4** (XLSX), **@react-pdf/renderer 4.5** (PDF).
- **~25 mil linhas** no escopo interno (contagem `wc -l` de `app/(app)`, `app/api`, `lib`, `components`). Maiores arquivos:
  `expedicoes/actions.ts` 3001 · `rooming/RoomingBoard.tsx` 1366 · `portal/PortalEditor.tsx` 1295 · `passageiros/PassageirosGlobalTabela.tsx` 1042 · `passageiros/ProntidaoPaxDrawer.tsx` 885 · `passageiros/PassageirosTabela.tsx` 842 · `lib/mock-data.ts` 831 · `checklist/ChecklistTabela.tsx` 814 · `lib/data/expedicoes.ts` 748 · `passageiros/EditarPassageiroDrawer.tsx` 596 · `ExpedicoesPageCliente.tsx` 513 · `lib/inscricao/core.ts` 479 · `inscricoes/InscricoesPendentes.tsx` 433 · `inscricoes/actions.ts` 426.
- **Padrão de escrita**: quase todas as mutações são Server Actions (`"use server"`) que usam o client Supabase com cookie do usuário (RLS) **ou** `createServiceRoleClient()` (bypassa RLS), depois `revalidatePath(...)`. No SPA isso vira chamada supabase-js direta (RLS) + invalidação de cache (react-query) — exceto as que usam service role (ver abaixo).
- **Crons** (`vercel.json`): `/api/cambios/sync` às `0 6 * * *` (fora do escopo) e `/api/expedicoes/atualizar-status` às `0 3 * * *` (UTC).
- **Gate de senha do site** (`middleware.ts`): se `SITE_PASSWORD` existir, toda rota fora de `LIBERADAS` exige cookie `SITE_AUTH_COOKIE`; senão redireciona p/ `/acesso?next=`. Liberadas: `/acesso`, `/inscricao`, `/amigo`, `/a/`, `/api/health`, `/api/logout`, `/api/bitrix`, `/api/cambios`, `/api/expedamigo`, `/api/expedicoes/atualizar-status`. (No SPA novo isso é irrelevante — o login do QS substitui.)

### 0.1 Variáveis de ambiente usadas (grep `process.env.*`)
| Var | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/supabase/admin.ts` (service role) |
| `N8N_BITRIX_OUTBOUND_URL` | `lib/bitrix/outbound.ts` (app → n8n → Bitrix) |
| `N8N_SYNC_URL`, `N8N_SYNC_SECRET` | disparo de sync Bitrix via n8n / auth de webhooks |
| `WEBHOOK_SECRET` | auth `x-webhook-secret` de rotas `/api/bitrix/*` e `/api/expedamigo/*` |
| `CRON_SECRET` | auth do cron `atualizar-status` |
| `NEXT_PUBLIC_SITE_URL` | montar links (portal /amigo, /a/<codigo>, inscrição) |
| `SITE_PASSWORD` | gate do middleware |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_USE_MOCK_DATA` | modo dev com `lib/mock-data.ts` (não portar) |

### 0.2 RISCO Nº 1 — pontos que hoje bypassam RLS (service role)
O SPA não pode usar service role. Cada item abaixo precisa virar **RPC `security definer`**, **Edge Function**, ou ganhar **policy RLS** equivalente:

| Arquivo | O que faz com service role |
|---|---|
| `app/(app)/configuracoes/actions.ts` | gestão de usuários (auth.admin: resetar senha, mudar papel) → Edge Function obrigatória |
| `app/(app)/expedicoes/[id]/passageiros/bitrix-sync-actions.ts` | sync de passageiro com Bitrix |
| `…/passageiros/expedamigo-actions.ts` | criar/resetar acesso do portal ExpedAmigo (senha/hash, token 1º acesso) |
| `…/passageiros/extensoes-actions.ts`, `passeios-opcionais-actions.ts` | compras de extensão/passeio |
| `…/passageiros/grupo-actions.ts` | grupos/acompanhantes |
| `…/portal/actions.ts` | conteúdo do portal do viajante |
| `…/roteiro-lider/actions.ts` | roteiro/docs do líder |
| `app/(app)/inscricoes/actions.ts`, `decisoes.ts`, `lib/inscricao/core.ts`, `lib/inscricao/token.ts` | aprovar/recusar inscrições públicas |
| `lib/data/compras.ts`, `lib/bitrix/upsert-passageiro.ts`, `lib/expedamigo/first-access-token.ts` | leitura de compras / upsert vindo do Bitrix / token |
| `app/api/arquivos/upload`, `[id]`, `[id]/download` | Storage (upload, delete, URL assinada) |
| `app/api/clientes/export` | export XLSX de clientes |
| `app/api/bitrix/*`, `app/api/expedamigo/onboarding-diario`, `app/api/expedicoes/atualizar-status`, `app/api/cambios/sync` | webhooks/crons (podem continuar no app antigo ou virar Edge Functions/pg_cron) |

### 0.3 Realtime (hook `lib/hooks/useRealtimeRefresh.ts`)
Telas que assinam: `ExpedicoesPageCliente` (lista), `ExpedicaoRealtimeSync` (todas as abas de `[id]`), `PassageirosTabela`, `RoomingBoard`, `ChecklistTabela`, `LinksGrid`, `components/arquivos/Drive.tsx`, `FornecedoresTabela` (e `CambiosTabela`, fora). Detalhe de tabelas/filtros na Parte A. O hook só faz `router.refresh()` (re-render do server component) com debounce — no SPA basta `queryClient.invalidateQueries`. O selo `components/ui/LiveBadge.tsx` mostra o status da conexão.

### 0.4 PDFs / planilhas existentes
**Nenhuma tela interna gera PDF.** `@react-pdf/renderer` só é usado em `app/amigo/ViagemPDF.tsx` (portal do viajante, fora do escopo).
- `RoomingBoard.tsx` — **rooming.xlsx** via exceljs no navegador (uma aba por hotel) — layout na Parte C §2.
- `PassageirosGlobalTabela.tsx` — **.xlsx** via exceljs no navegador — colunas na Parte D §1.
- `app/api/clientes/export/route.ts` — **.xlsx** de clientes gerado no servidor (service role) — colunas na Parte D §2.
- Aba Passageiros da expedição — export **CSV** (com bug: usa o `quarto_id` antigo) — Parte B.

### 0.5 Índice
- **Parte A** — Shell/nav/papéis, Dashboard, Lista de expedições, Pacotes, Visão geral da expedição, constantes, cron de status, Bitrix outbound.
- **Parte B** — Aba Passageiros da expedição, detalhe do pax, prontidão, importação CSV, saldo/custos/pagamentos, ExpedAmigo, extensões/passeios, Bitrix de passageiro.
- **Parte C** — Grupos, Rooming, Checklist, Documentos (Drive/arquivos), Links, Portal (editor), Roteiro do líder.
- **Parte D** — Passageiros global, Clientes, Fornecedores, Inscrições, Acessos ExpedAmigo, Avisos, Configurações, dependências de câmbio, modo mock, docs do repo.
- **Parte E** — Componentes a portar, arquivos de constantes, riscos e ordem sugerida.



---

# Parte A — Shell, Auth/Papéis, Dashboard, Lista de Expedições/Pacotes, Visão Geral da Expedição, Cron + Bitrix

Fonte: `/tmp/sx` (Next.js 15 App Router, Server Components + Server Actions, supabase-js via `@supabase/ssr`).
Todos os caminhos abaixo são relativos à raiz do repo. "L" = linha.

> **Modelo de execução atual (importante pra SPA):** em produção, TODA leitura e quase toda escrita roda no servidor
> com o client de sessão do usuário (`lib/supabase/typed.ts` → `getServerClient()` = `createServerClient` com cookies,
> chave ANON + JWT do usuário) ⇒ **RLS já é aplicada**. Só usam service role: cron `atualizar-status`, webhook
> `/api/bitrix/*`, aprovar/recusar inscrição, mudar papel (admin). Ou seja, migrar as telas desta parte para
> supabase-js no browser **não muda a superfície de permissão** — com 2 exceções a corrigir (ver §10 Riscos).

---

## 1. App shell

### 1.1 `app/(app)/layout.tsx` (46 L) — Server Component que envolve todas as rotas internas
- `getCurrentUser()` → se `null` → `redirect("/login")` (L22-23). Se `user.senha_provisoria` → `redirect("/primeiro-acesso")` (L25).
- Carrega em paralelo (L27-33), **em toda navegação**:
  - `listExpedicoesComAgregados()` (só `tipo='expedicao'`; pesado — ver §5) → para o CommandPalette.
  - `listFornecedores()` → `fornecedores select * order nome` (`lib/data/fornecedores.ts` L6-11).
  - `listAllPassageiros()` → `passageiros select * limit 200` (L14-19) — palette mostra só 30.
  - `getContagemAlertas()` → `{total, criticos}` (badge do item "Avisos") — roda o motor de prontidão para TODOS os passageiros (§5.6).
  - `contarInscricoesPendentes()` → `inscricoes_pendentes select id count exact head where status='pendente'` (`app/(app)/inscricoes/actions.ts` L221-227) — badge do item "Inscrições".
- Renderiza `<AppShell user alertCount inscricoesCount>{children}<CommandPalette/><GlobalShortcuts/></AppShell>`.
- `app/page.tsx`: `/` → `redirect("/dashboard")`.

### 1.2 `components/layout/AppShell.tsx` (62 L)
- `somenteLeitura = papel === "relacionamento" || papel === "leitura"` (L24).
- `podeDecidirInscricao = !somenteLeitura || papel === "relacionamento"` (L26).
- Layout: Sidebar fixa 244px (drawer no mobile, estado `mobileOpen`), Header 48px, faixa amarela de "Modo leitura" quando somenteLeitura (L40-48):
  - texto: `Modo leitura — você vê tudo do sistema.` + (relacionamento) `" Pode aprovar e recusar inscrições, mas não editar o resto."` / (leitura) `" Edições ficam desativadas."`
- Envolve `children` em `<PermissoesProvider somenteLeitura podeDecidirInscricao>`.
- `PointerEventsGuard` (18 L) — workaround Radix de `pointer-events:none` preso no body (só UX).

### 1.3 `components/layout/Sidebar.tsx` (125 L) — itens VERBATIM (L23-35)
```ts
const NAV = [
  { href: "/dashboard", label: "Início", icon: LayoutDashboard },
  { href: "/avisos", label: "Avisos", icon: Bell },
  { href: "/passageiros", label: "Passageiros", icon: Users },
  { href: "/clientes", label: "Clientes & compras", icon: ShoppingBag },
  { href: "/inscricoes", label: "Inscrições", icon: UserPlus },
  { href: "/expedicoes", label: "Expedições", icon: Map },
  { href: "/pacotes", label: "Pacotes", icon: Package },
  { href: "/fornecedores", label: "Fornecedores", icon: Building2 },
  { href: "/cambios", label: "Câmbios", icon: Coins },
  { href: "/acessos-expedamigo", label: "Acessos ExpedAmigo", icon: ScrollText },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];
```
- **Não há visibilidade por papel**: todos os papéis veem todos os itens (relacionamento/leitura "veem tudo"). Restrições são só de escrita.
- Ativo: `pathname.startsWith(item.href)` (L85). Badges: `/avisos` vermelho com `alertCount` (>99 → "99+"); `/inscricoes` lime com `inscricoesCount`.
- Logo + subtítulo "Sistema Operacional"; rodapé com `UserMenu`.

### 1.4 `components/layout/Header.tsx` (57 L)
- Botão hambúrguer (mobile), `Breadcrumb`, botão "Buscar ⌘K" (dispara `KeyboardEvent('keydown',{key:'k',metaKey:true})` em `window`), sino decorativo **sem ação** (bolinha vermelha fixa), botão "Sair" → `POST /api/logout` (faz `supabase.auth.signOut()`) e `window.location.href="/login"`.
- `Breadcrumb.tsx` (48 L): "Início" → **/expedicoes** (sic), segmentos mapeados por `SEGMENT_LABELS = { expedicoes:"Expedições", fornecedores:"Fornecedores", cambios:"Câmbios", configuracoes:"Configurações", passageiros:"Passageiros", checklist:"Checklist", documentos:"Documentos", rooming:"Rooming" }`; segmento desconhecido com length>8 vira "Detalhe".

### 1.5 `components/layout/UserMenu.tsx` (83 L)
- Avatar + nome + rótulo de papel. Tabela local (L9-15) **não inclui relacionamento** (cai no valor cru):
  `{ admin:"Admin", operacional:"Operacional", comercial:"Comercial", financeiro:"Financeiro", leitura:"Leitura" }`.
  (Divergente de `PAPEL_LABEL` em constants, onde operacional = "Operação" — usar o de constants na SPA.)
- Itens: e-mail; toggle tema (Modo escuro/claro via `ThemeProvider`, localStorage); "Sair" (igual Header).

### 1.6 `components/layout/CommandPalette.tsx` (186 L) — `cmdk` em Radix Dialog
- Abre/fecha com **⌘/Ctrl+K** e **⌘/Ctrl+P** (L33). `?` fora de input dispara `CustomEvent("show-keymap")`.
- Grupos:
  - Navegação: Expedições (hint `g e`), Fornecedores (`g f`), Câmbios, Configurações.
  - Ações: "Nova expedição" → `router.push('/expedicoes')` e 200ms depois dispara keydown `n` (abre drawer); "Mostrar atalhos".
  - Expedições: todas (`value = "expedicao {codigo} {nome} {destino}"`) → `/expedicoes/{id}`. (Pacotes NÃO aparecem — layout passa só `tipo='expedicao'`.)
  - Passageiros: primeiros 30 dos 200 (`value="pax {nome_completo} {cpf} {email}"`) → `/expedicoes/{expedicao_id}/passageiros` (bug: avulso com expedicao_id null gera `/expedicoes/null/...`).
  - Fornecedores: primeiros 20 → `/fornecedores`.
- Placeholder: "Buscar expedição, passageiro, fornecedor..."; vazio: "Nenhum resultado."

### 1.7 `components/layout/GlobalShortcuts.tsx` (94 L)
- Ignora quando foco em INPUT/TEXTAREA/contentEditable ou com meta/ctrl/alt.
- Sequência `g` + `e` (≤1500ms) → `/expedicoes`; `g` + `f` → `/fornecedores`.
- Modal "Atalhos do teclado" (evento `show-keymap`), lista VERBATIM:
```ts
[{keys:"/",descricao:"Focar busca"},{keys:"n",descricao:"Nova expedição (na lista)"},{keys:"↑ ↓",descricao:"Navegar linhas"},
 {keys:"Enter",descricao:"Abrir item selecionado / salvar célula"},{keys:"Esc",descricao:"Cancelar edição"},{keys:"Tab",descricao:"Próxima célula"},
 {keys:"⌘ K",descricao:"Command palette"},{keys:"g e",descricao:"Ir para Expedições"},{keys:"g f",descricao:"Ir para Fornecedores"},{keys:"?",descricao:"Mostrar atalhos"}]
```
  Rodapé: "Atalhos não funcionam em campos de texto."

### 1.8 `components/layout/PermissoesContext.tsx` (56 L)
- Contexto `{somenteLeitura, podeDecidirInscricao}` (default `{false, true}`); hooks `useSomenteLeitura()`, `usePodeEditar()`, `usePodeDecidirInscricao()`.
- Comentário explícito: "isso é só UX — o enforcement real é servidor (RLS + guardas)".
- Consumidores relevantes nesta parte: `EditableCell`, `EditableSelectCell`, `ConfirmDeleteButton` (somem/viram texto em read-only), `ExpedicoesPageCliente` (esconde "Nova", editar, reorder, atalho `n`).

---

## 2. Autenticação, papéis e permissões

### 2.1 Papéis (`usuarios.papel`, enum Postgres `papel_usuario`)
- 0001: `('admin','operacional','comercial','financeiro','leitura')`; 0045: `alter type papel_usuario add value 'relacionamento'`.
- TS: `PapelUsuario = "admin" | "operacional" | "comercial" | "financeiro" | "relacionamento" | "leitura"` (`types/database.ts` L15).
- `lib/constants.ts` L142-163:
```ts
export const PAPEL_USUARIO = ["admin","operacional","comercial","financeiro","relacionamento","leitura"] as const;
export const PAPEL_LABEL = { admin:"Admin", operacional:"Operação", comercial:"Comercial", financeiro:"Financeiro", relacionamento:"Relacionamento", leitura:"Leitura" };
export const PAPEIS_ATRIBUIVEIS: PapelUsuario[] = ["admin", "operacional", "relacionamento"];
```

| Papel | Lê | Escreve (sistema operacional) | Decide inscrições | Admin (mudar papéis) | Aparece como resp. Op | Aparece como resp. Com |
|---|---|---|---|---|---|---|
| admin | tudo | sim | sim | **sim** (`configuracoes/actions.ts` L25,L62: `eu.papel==='admin'`, não pode mudar o próprio) | sim | sim |
| operacional | tudo | sim | sim | não | sim | não |
| comercial | tudo | sim | sim | não | não | sim |
| financeiro | tudo | sim | sim | não | não | não |
| relacionamento | tudo | **não** | **sim** (exceção) | não | não | não |
| leitura | tudo | **não** | não | não | não | não |

- Sem distinção de dados por papel (ninguém tem visão restrita de linhas). Diferença entre admin/operacional/comercial/financeiro é **só** a filtragem dos selects de responsável e o acesso à tela de papéis.

### 2.2 `lib/auth/permissoes.ts` (53 L)
```ts
ehSomenteLeitura(papel) = papel === "relacionamento" || papel === "leitura"
podeEditar(papel)       = !!papel && !ehSomenteLeitura(papel)
podeDecidirInscricao(p) = podeEditar(p) || p === "relacionamento"
class ErroPermissao  // msg padrão "Seu perfil é somente leitura — ação não permitida."
assertPodeEditar() / assertPodeDecidirInscricao() // "Sem permissão para decidir inscrições."
```
- **As ações de expedição desta parte NÃO chamam `assertPodeEditar`** — dependem só da RLS (sessão do usuário).

### 2.3 `is_readonly()` + RLS (`db/migrations/0046_rls_read_only.sql`)
```sql
create or replace function public.is_readonly() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel::text in ('relacionamento','leitura') from public.usuarios where id = auth.uid()), false);
$$;
```
- Fail-OPEN (sem linha em `usuarios` → false → pode escrever).
- Para cada tabela em `['expedicoes','passageiros','custos','pagamentos','checklist_itens','documentos','quartos','passageiro_quarto','links_expedicao','roteiro_dias','expedicao_voos','expedicao_passeios','expedicao_info','expedicao_avisos','roteiro_dia_fotos','passeios_opcionais','passeio_opcional_compras','fornecedores','cambios','requisitos_destino','passageiro_requisitos','grupos_expedicao','roteiro_lider_dias','inscricoes_pendentes','arquivos']` cria policies **RESTRICTIVE** `ro_block_insert/update/delete` `to authenticated` com `not public.is_readonly()`. SELECT liberado.
- Policies base (0001 L361-378, repetido em 0010 L185-192 para tabelas de prontidão): `auth_all_select/insert/update/delete ... to authenticated using (true)` — **inclusive em `usuarios` e `audit_log`**. `usuarios` NÃO está na lista do 0046.
- `audit_log`: escrito por trigger `audit_change()` (security definer) em `expedicoes, passageiros, custos, pagamentos` (insert/update/delete, `dados_antes/depois` jsonb, `usuario_id = auth.uid()`). Nenhuma action escreve em audit_log manualmente.
- 0036 removeu todas as policies `anon_read_dev` → hoje só `authenticated` lê.

### 2.4 `lib/supabase/auth.ts` (60 L) — `getCurrentUser()`
- `supabase.auth.getUser()`; se não houver → null.
- `usuarios select id,email,nome,papel,avatar_url,senha_provisoria where id=auth.uid() maybeSingle`.
- **Se não existir linha** (L42-53): faz `insert into usuarios { id, email, nome: user_metadata.name ?? prefixo do email ?? "Usuário", papel:"leitura", avatar_url:null, senha_provisoria:true }` — i.e. auto-provisiona como **leitura** e força troca de senha. A SPA precisa reproduzir isso (ou mover para trigger `on auth.users insert`).
- Dev: `DEV_AUTH_BYPASS` retorna `MOCK_USER` (admin) — travado em false em produção (`lib/dev-mode.ts`).

### 2.5 Telas de login
- `app/(auth)/login/page.tsx` (62 L): escolha "Operacional" → `/login/operacional`; "Área do Líder" → `/lider` (portal por CPF, fora desta parte).
- `app/(auth)/login/operacional/page.tsx` (44 L) + `LoginForm.tsx` (62 L) + `actions.ts` (29 L):
  - zod: `{ email: z.string().email("E-mail inválido"), senha: z.string().min(1,"Informe a senha") }`.
  - `supabase.auth.signInWithPassword`. Erro genérico: "E-mail ou senha inválidos." / parse: "Informe um e-mail e uma senha válidos.".
  - Sucesso → `window.location.assign("/dashboard")`. Sem cadastro aberto (contas criadas pelo admin no Supabase Auth).
- `app/primeiro-acesso/page.tsx` (42 L): sem user → /login; `!senha_provisoria` → /dashboard; mostra `NovaSenhaForm` (`components/auth/NovaSenhaForm.tsx`, 85 L): senha ≥ 8, confirmação igual (validação client), botão "Salvar e entrar".
- `app/conta/actions.ts` (42 L) `atualizarSenhaConta(novaSenha)`:
  - zod `z.string().min(8,"A senha precisa ter ao menos 8 caracteres").max(72,"Senha muito longa")`.
  - `auth.getUser()` (sem → "Sessão expirada. Faça login novamente.") → `auth.updateUser({password})` (erro → "Não foi possível salvar a senha. Escolha uma senha diferente da atual.") → `usuarios.update({senha_provisoria:false}).eq('id', user.id)`.
- `app/auth/callback/route.ts`: `exchangeCodeForSession(code)` → redirect `next ?? /dashboard`; falha → `/login?error=auth-callback-failed` (usado por link de recuperação).
- `/api/logout` POST → `auth.signOut()`.

### 2.6 `middleware.ts` (41 L) — gate de senha única do site (`SITE_PASSWORD`)
- `lib/site-auth.ts`: cookie `se_acesso` = `sha256("se-acesso:v1:" + SITE_PASSWORD)` (hex). Sem `SITE_PASSWORD` → gate desligado.
- Rotas liberadas (L6-17): `/acesso`, `/inscricao`, `/amigo`, `/a/`, `/api/health`, `/api/logout`, `/api/bitrix`, `/api/cambios`, `/api/expedamigo`, `/api/expedicoes/atualizar-status` (+ `/_next`).
- Demais: se cookie ≠ esperado → redirect `/acesso?next=<path>`.
- `app/acesso/actions.ts` `entrar(formData)`: compara token; erro → `/acesso?erro=1&next=…`; ok → cookie httpOnly, secure em prod, sameSite lax, 30 dias; só aceita `next` iniciando com `/` e não `//`.
- Para SPA: é uma 2ª camada antes do login Supabase. Num SPA estático não existe middleware — decidir se mantém (ex.: Vercel Edge Middleware / password protection) ou descarta (a segurança real é o login + RLS).

---

## 3. `lib/constants.ts` (267 L) — VERBATIM
```ts
export const MARGEM_MINIMA = 0.20;
export const MARGEM_IDEAL = 0.30;
export const PROVISAO_EXTRA_PADRAO = 0.05;

export const STATUS_EXPEDICAO = ["Planejamento","Vendas Abertas","Em andamento","Concluída","Cancelada"] as const;
export const STATUS_RESERVA = ["Lead","Pré-reserva","Confirmado","Cancelado"] as const;
export const TIPO_PASSAGEIRO = ["Pagante","Cortesia","Líder"] as const;
export const TIPO_FORNECEDOR = ["DMC","Hotel","Guia","Aéreo","Receptivo","Seguro","Outros"] as const;
export const CATEGORIA_CUSTO = ["Hotelaria","Aéreo","Terrestre","Ingressos","Guias","Seguro","Taxas","Brindes","Outros"] as const;
export const STATUS_CUSTO = ["A programar","Programado","Pago","Parcial","Vencido"] as const;
export const STATUS_PAGAMENTO = ["Pendente","Programado","Pago","Parcial","Vencido","Cancelado"] as const;

// Fases do checklist = SOP real da agência (ClickUp "Processos - Expedição").
export const ETAPA_CHECKLIST = ["Após o fechamento","12 a 6 meses","6 a 2 meses","2 meses a 15 dias","Na semana","Pós-viagem"] as const;

export const FASES_CHECKLIST = [
  { etapa: "Após o fechamento", descricao: "Logo após fechar a venda", diasMin: 365, diasMax: Infinity, diasReferencia: 300 },
  { etapa: "12 a 6 meses", descricao: "12 a 6 meses antes do embarque", diasMin: 180, diasMax: 365, diasReferencia: 240 },
  { etapa: "6 a 2 meses", descricao: "6 a 2 meses antes do embarque", diasMin: 60, diasMax: 180, diasReferencia: 120 },
  { etapa: "2 meses a 15 dias", descricao: "2 meses a 15 dias antes", diasMin: 15, diasMax: 60, diasReferencia: 35 },
  { etapa: "Na semana", descricao: "Na semana da expedição", diasMin: 0, diasMax: 15, diasReferencia: 5 },
  { etapa: "Pós-viagem", descricao: "Depois do retorno", diasMin: -Infinity, diasMax: 0, diasReferencia: -7 },
];
// diasMin exclusivo, diasMax inclusivo
export function faseAtualChecklist(diasAteEmbarque: number | null): EtapaChecklist | null {
  if (diasAteEmbarque == null) return null;
  return FASES_CHECKLIST.find((f) => diasAteEmbarque > f.diasMin && diasAteEmbarque <= f.diasMax)?.etapa ?? null;
}

export const STATUS_CHECKLIST = ["Pendente","Em andamento","Atenção","Concluído","Bloqueado"] as const;
export const PRIORIDADE = ["Baixa","Média","Alta","Crítica"] as const;
export const TIPO_QUARTO = ["Single","Duplo","Twin","Triplo","Compartilhado","Líder"] as const;
export const CAPACIDADE_QUARTO = { Single: 1, Twin: 2, Duplo: 2, Triplo: 3, Compartilhado: 4, Líder: 2 };

export const PAPEL_USUARIO = ["admin","operacional","comercial","financeiro","relacionamento","leitura"] as const;
export const PAPEL_LABEL = { admin:"Admin", operacional:"Operação", comercial:"Comercial", financeiro:"Financeiro", relacionamento:"Relacionamento", leitura:"Leitura" };
export const PAPEIS_ATRIBUIVEIS = ["admin", "operacional", "relacionamento"];

export const MOEDAS = ["BRL","USD","EUR","PEN","GBP","JPY","ARS","CLP"] as const;
export const STATUS_FORNECEDOR = ["Ativo","Pausado","Bloqueado"] as const;
export const STATUS_VISTO = ["Não necessário","A solicitar","Em análise","Aprovado","Negado"] as const;
export const STATUS_SEGURO = ["Pendente","Solicitado","Emitido"] as const;

export const TIPO_REQUISITO = ["Passaporte","RG","Visto","Vacina","Seguro","Aéreo Internacional","Aéreo Doméstico","Voo Interno","Contrato",
  "Autorização de Menor","Pagamento","Dados Pessoais","Ingresso Machu Picchu","Ingresso Trem Machu Picchu"] as const;
export const OBRIGATORIEDADE = ["Obrigatório","Condicional","Recomendado"] as const;
export const STATUS_REQUISITO = ["Pendente","Em análise","Enviado","Aprovado","Vencido","Dispensado","Reprovado"] as const;
export const PRONTIDAO = ["Apto","Atenção","Bloqueado"] as const;
export const MESES_VALIDADE_PASSAPORTE_PADRAO = 6;
export const COR_PRONTIDAO = { Apto: "vinculado", Atenção: "atencao", Bloqueado: "critico" };

export const CATEGORIA_ARQUIVO = ["Aéreos","Documentos pessoais","Contrato","Bilhetes","Vistos","Seguros","Hospedagem","Vouchers","Cartão de embarque","Outros"] as const;
export const MARCADOR_DOC_LIDER = "Documento do líder";
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MIME_ARQUIVO_PERMITIDOS = ["application/pdf","image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/csv"] as const;
```
Observação: o enum Postgres `etapa_checklist` de 0001 era `('Pós-venda','Pré-viagem','Operação','Pós-viagem')`; 0009 migrou para as 6 fases acima (ver Parte do checklist).

### 3.1 Cores/variants de status de expedição (UI, VERBATIM)
- `components/tables/ExpedicoesTable.tsx` L29-43:
```ts
STATUS_VARIANT = { Planejamento:"lista", "Vendas Abertas":"vinculado", "Em andamento":"atencao", Concluída:"auto", Cancelada:"critico" };
STATUS_DOT     = { Planejamento:"bg-lista-500", "Vendas Abertas":"bg-vinculado-500", "Em andamento":"bg-atencao-500", Concluída:"bg-auto-500", Cancelada:"bg-critico-500" };
```
- `ExpedicaoCard.tsx` L6-12 e `ExpedicaoHeader.tsx` L8-14 (pill sobre gradiente):
```ts
STATUS_PILL = { Planejamento:"bg-white/15 text-white", "Vendas Abertas":"bg-[var(--brand-lime)] text-[var(--brand-dark)]",
  "Em andamento":"bg-[var(--brand-lime)] text-[var(--brand-dark)]", Concluída:"bg-white/15 text-white/80", Cancelada:"bg-critico-600 text-white" };
```
- Tokens semânticos (app/globals.css): `editavel` (azul, editável), `vinculado` (verde, ok), `atencao` (laranja), `critico` (vermelho), `lista` (roxo/lista), `auto` (cinza). Marca: `--brand-dark`, `--brand-lime`, `--brand-lime-deep`, `.bg-brand-gradient`.

---

## 4. `lib/utils.ts` (165 L) — funções usadas em regra de negócio
- `formatBRL(v, frac=2)` → `Intl pt-BR currency BRL`, null/NaN → "—".
- `formatMoney(v, moeda)` → idem com moeda (fallback `"${moeda} ${v.toFixed(2)}"`).
- `formatPercent(v, frac=1)` → `${(v*100).toFixed(frac)}%` (v é fração 0..1).
- `formatDate(d, "dd/MM/yyyy")` (date-fns `parseISO`, locale ptBR), `formatDateTime` ("dd/MM/yyyy HH:mm"), `relativeDate` (formatDistanceToNow).
- **`daysUntil(date)` = `differenceInDays(parseISO(date), new Date())`** — compara meia-noite local da data com AGORA ⇒ trunca: no próprio dia do embarque dá 0, na véspera às 10h dá 0 também (diferença <24h). Esta é a base de todos os "Xd", "embarca hoje", filtros de período, alertas e fase atual. Reproduzir exatamente (date-fns) para paridade.
- `mascaraTelefone`, `slugify`.
- `aniversarioNaViagem(nasc, emb, ret)` → `{data:"YYYY-MM-DD", idade}` se MM-DD cai entre embarque e retorno (inclusive, em qualquer ano do intervalo).
- `mesesDaExpedicao(emb, ret)` → meses 1-12 atravessados (máx 24 iterações).
- `aniversarioNoMesDaExpedicao(nasc, emb, ret)` → aniversário em qualquer MÊS atravessado: `{data, dia, mes, idade, naViagem}`.
- **`generateExpedicaoCodigo(destino, dataEmbarque)`** (L149-156):
```ts
const meses = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
const d = parseISO(dataEmbarque); const slug = destino.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
return `${slug}-${meses[d.getMonth()]}${d.getFullYear()}`;   // ex.: "PERU-AGO2026", "JAPO-OUT2026" (acentos removidos à força: "JAPÃO"→"JAPO")
```

---

## 5. `lib/data/expedicoes.ts` (748 L) — queries e valores computados

### 5.1 `listExpedicoesComAgregados(tipo='expedicao')` (L59-73)
- `expedicoes select * order ordem asc nullsLast, data_embarque asc` — **busca TODAS** e filtra `tipo` no JS (`(e.tipo ?? 'expedicao') === tipo`). SPA: usar `.eq('tipo', tipo)`.
- → `agregarExpedicoes()`.

### 5.2 `fetchAllRows<T>(pagina)` (L81-93) — pagina de 1000 em 1000 com `.order('id').range()` até página < 1000.

### 5.3 `agregarExpedicoes(supabase, rows)` (L101-164) — calcula `ExpedicaoComAgregados`
Queries (paralelas):
1. `passageiros select * in expedicao_id ids order id` (paginado).
2. `passageiro_requisitos select * order id` (paginado, **SEM filtro — tabela inteira**).
3. `checklist_itens select expedicao_id,parent_id,status in expedicao_id ids order id` (paginado).
4. `usuarios select id,nome`.

Por expedição `e`:
```ts
paxDaExp = pax.filter(p => p.expedicao_id === e.id && p.status_reserva !== "Cancelado");
pax_confirmados = paxDaExp.filter(p => p.status_reserva === "Confirmado" && p.tipo !== "Líder").length;   // líder fora da ocupação
docs_pendentes  = paxDaExp.filter(p => !p.passaporte).length;
prontidao_total = paxDaExp.length;                                   // inclui líderes e cortesias
prontidao_aptos = paxDaExp.filter(p => avaliarProntidao({passageiro:p, expedicao:e, destino:e.destino, requisitos: reqPorPax.get(p.id) ?? []}).prontidao === "Apto").length;
processos = checklist.filter(c => c.expedicao_id === e.id && !c.parent_id);   // só processos-pai
checklist_pct = processos.length ? processos.filter(c => c.status === "Concluído").length / processos.length : 0;
responsavel_op_nome / responsavel_com_nome = nome do usuario pelo id (ou null)
```
Tipo resultante (`types/database.ts` L720-730): `ExpedicaoRow & { pax_confirmados, docs_pendentes, checklist_pct (0..1), prontidao_aptos, prontidao_total, responsavel_op_nome, responsavel_com_nome }`.
- `avaliarProntidao` está em `lib/prontidao/regras.ts` (357 L) + `requisitos-destino.ts` (174 L) — motor de semáforo (Apto/Atenção/Bloqueado) — **precisa ser portado 1:1** (pura TS, sem DB; coberto em outra parte). Curto-circuita para Apto quando expedição Concluída.
- **Recomendação SPA:** mover estes agregados para uma VIEW/RPC SQL (`vw_prontidao_passageiro` já existe na migration 0010 com a mesma lógica — conferir paridade) ou portar o motor para o browser; trazer `passageiro_requisitos` inteiro no browser não escala.

### 5.4 Leituras simples (todas `select *` com sessão do usuário)
| Função | Query |
|---|---|
| `getExpedicao(id)` L166 | `expedicoes eq id maybeSingle` |
| `getExpedicaoComAgregados(id)` L175 | getExpedicao + agregarExpedicoes([e]) (ainda traz `passageiro_requisitos` inteiro) |
| `listPassageiros(expId)` L185 | `passageiros eq expedicao_id` (sem paginação; ok <1000) |
| `getPassageiro(id)` L192 | `passageiros eq id` |
| `listCustos` L199 / `listPagamentos` L206 | `custos eq expedicao_id`; pagamentos via `custos.id in (...)` |
| `listChecklist` L220 | `checklist_itens eq expedicao_id` |
| `listDocumentos` L227 | `documentos in passageiro_id (pax da expedição)` |
| `listQuartos` L241 / `listAlocacoes` L249 | `quartos eq expedicao_id`; `passageiro_quarto in quarto_id` |
| `listUsuarios` L262 | `usuarios select *` |
| `listLinks` L269 | `links_expedicao eq expedicao_id order ordem, created_at` (42P01 → []) |
| `listPortal(tabela)` L297 | genérico `eq expedicao_id order ordem, created_at` p/ `expedicao_voos, expedicao_passeios, expedicao_info, expedicao_avisos, passeios_opcionais, extensoes, roteiro_lider_dias` |
| `listRoteiro` L333 | `roteiro_dias order data nullsLast, dia, ordem`; comparador `ordenarRoteiro` (L325) |
| `listContratacoesExtensao` L371 | `extensoes` → `passageiro_extensao` |
| `listRoteiroFotos` L391 | `roteiro_dia_fotos order ordem, created_at` |
| `listRequisitosPassageiro` L416 | `passageiro_requisitos eq passageiro_id` |

### 5.5 `getProntidaoExpedicao(expId)` (L437-484) → `ProntidaoPassageiro[] = {passageiro, resultado, requisitos}`
- `listPassageiros` + `passageiro_requisitos in passageiro_id`; exclui `Cancelado`; cortesias e líderes CONTAM.

### 5.6 Resumos cross-expedição (dashboard e badge)
- `getResumoProntidao()` (L501-547): `expedicoes select * order data_embarque`; filtra `tipo='expedicao'` e status ∉ {Concluída, Cancelada}; **N+1**: chama `getProntidaoExpedicao` por expedição. Retorna `{id,nome,data_embarque,status,diasAteEmbarque,total,aptos,atencao,bloqueados,topBloqueador}` onde `topBloqueador` = tipo de requisito com mais checagens `semaforo==='bloqueio'`.
- `getProntidaoTodas()` (L572-627): 3 queries (expedicoes, passageiros paginado, passageiro_requisitos paginado), filtra `tipo='expedicao'`, ignora Cancelado e avulsos (`expedicao_id` null).
- `getAlertasOperacionais` (L634-672, `react.cache` por request): para expedições ativas (≠Concluída/Cancelada) com `dias = daysUntil(data_embarque) >= 0`, para cada checagem → `avaliarAlerta(tipo, semaforo, dias)`; item `{expedicao_id, expedicao_nome, data_embarque, dias_ate_embarque, passageiro_id, passageiro_nome, tipo, severidade, rotulo: regraDoTipo(tipo)?.rotulo ?? tipo, detalhe}`. Ordena: menos dias primeiro; empate → crítico antes de atenção.
- `getContagemAlertas()` (L675-681): `{ total, criticos }`.
- `getResumoProcessos()` (L729-745): `expedicoes select *` + `checklist_itens select expedicao_id,status,prazo,parent_id` (**sem paginação → corta em 1000 linhas silenciosamente**; com 23 pais + ~50 filhos por expedição isso estoura com ~14 expedições). Filtra `tipo='expedicao'`. `montarResumo` (L701-727) só itens-pai: `concluidos` (status Concluído), `atrasados` (não concluído e `daysUntil(prazo) < 0`), `proximos7d` (não concluído e 0 ≤ d ≤ 7), `faseAtual = faseAtualChecklist(daysUntil(data_embarque))`.

### 5.7 `lib/alertas/regras.ts` (62 L) — VERBATIM
```ts
export type SeveridadeAlerta = "critico" | "atencao";
export const ALERTA_REGRAS: RegraAlerta[] = [
  { tipo: "Passaporte", janelaDias: Infinity, rotulo: "Passaporte ausente ou vence em ≤6 meses do retorno" },
  { tipo: "Visto", janelaDias: 60, rotulo: "Visto pendente" },
  { tipo: "Dados Pessoais", janelaDias: 60, rotulo: "Cadastro incompleto" },
  { tipo: "Aéreo Internacional", janelaDias: 60, rotulo: "Bilhete internacional não emitido" },
  { tipo: "Vacina", janelaDias: 45, rotulo: "Vacina / certificado pendente" },
  { tipo: "Seguro", janelaDias: 45, rotulo: "Seguro viagem pendente" },
  { tipo: "Aéreo Doméstico", janelaDias: 30, rotulo: "Trecho doméstico pendente" },
  { tipo: "RG", janelaDias: 30, rotulo: "RG pendente" },
  { tipo: "Contrato", janelaDias: 90, rotulo: "Contrato não assinado" },
  { tipo: "Autorização de Menor", janelaDias: 60, rotulo: "Autorização de menor pendente" },
];
export function avaliarAlerta(tipo, semaforo, diasAteEmbarque): SeveridadeAlerta | null {
  if (semaforo === "ok" || semaforo === "na") return null;
  if (diasAteEmbarque == null || diasAteEmbarque < 0) return null; // só futuras
  const regra = REGRA_POR_TIPO.get(tipo); if (!regra) return null;     // Voo Interno, Pagamento, Ingressos → nunca alertam
  if (diasAteEmbarque > regra.janelaDias) return null;
  return semaforo === "bloqueio" ? "critico" : "atencao";
}
```
(`Semaforo = "ok" | "atencao" | "bloqueio" | "na"` em `lib/prontidao/regras.ts` L79.)

### 5.8 Pessoas/fidelidade usados pelo dashboard e visão geral
- `listPessoas()` (`lib/data/pessoas.ts` L165-175): `passageiros select *` + `expedicoes select *` **sem paginação (corta em 1000 passageiros)** → `agregar()` agrupa por `chaveIdentidade`: `cpf:<11+ dígitos>` → `bx:<bitrix_contact_id>` → `email:<lower>` → `nome:<lower>`; dados pessoais = mais recente não-nulo (ordem `created_at` asc); `totalExpedicoes` = vínculos não cancelados.
- `lib/fidelidade.ts`: `MARCOS_FIDELIDADE = [3, 5, 10]`; `ehMarco(pos)`; `ordinalFem(n) = "${n}ª"`; `construirPosicoesFidelidade(pessoas, expId)` → `{passageiro_id: posição}` (ordem cronológica por `data_embarque`, desempate `expedicao_id`, só não canceladas); `nivelFidelidade(n)`: tiers `n>=10 "Lenda"`, `>=5 "Aventureiro"`, `>=3 "Explorador"`, `>=1 "Viajante"`, senão `"Estreante"`.

---

## 6. Dashboard — `app/(app)/dashboard/page.tsx` (286 L)
**Propósito:** página inicial "Início — Resumo geral — clique em qualquer item para abrir." Somente leitura (nenhuma ação de escrita). Sem realtime próprio (só re-render por navegação).

Dados (L21-26): `listExpedicoesComAgregados()` (só expedições), `getResumoProntidao()`, `getResumoProcessos()`, `listPessoas()`.
`ATIVA = s => s !== "Concluída" && s !== "Cancelada"`; `hoje = new Date().toISOString().slice(0,10)` (UTC!).

**KPIs (4 cards clicáveis, L87-92):**
| Card | Valor | Link |
|---|---|---|
| Expedições ativas | `ativas.length` | /expedicoes |
| Passageiros confirmados | `Σ ativas.pax_confirmados` | /passageiros |
| Prontos (`${totalAptos}/${totalPront}`) | `round(totalAptos/totalPront*100)%` (0 se total 0) — de `resumoProntidao` | /expedicoes |
| Prazos atrasados | `Σ resumoProcessos(ATIVA).atrasados` | /expedicoes |

**Seção "Próximas expedições"** ("Ver tudo" → /expedicoes): ativas com `data_embarque.slice(0,10) >= hoje`, ordenadas asc, top 6. Card: destino (uppercase), badge dias (`dias<=15 critico`, `<=45 atencao`, senão `lista`; 0 → "hoje"), nome, data, chips `"{pax_confirmados} pax"`, `"{aptos}/{total} prontos"`, `"{round(checklist_pct*100)}% checklist"` → `/expedicoes/{id}`. Vazio: "Nenhuma expedição futura."

**"Prontidão & alertas":** MiniStats Aptos/Atenção/Bloqueados (somas). Lista: `resumoProntidao` com `bloqueados>0 || atencao>0`, ordena `bloqueados desc, atencao desc`, top 6, texto `"Principal: {topBloqueador}"` ou "Requisitos pendentes", badges critico/atencao → `/expedicoes/{id}/passageiros`. Vazio: "Sem pendências de prontidão. 🎉"

**"Prazos & checklist":** `resumoProcessos` ATIVA com `atrasados>0 || proximos7d>0`, ordena `atrasados desc, proximos7d desc`, top 6; subtítulo = `faseAtual`; badges `"{n} atrasado(s)"` (critico) e `"{n} em 7d"` (atencao) → `/expedicoes/{id}/checklist`. Vazio: "Nenhum prazo atrasado ou próximo."

**"Momentos especiais"** (L56-77): para cada pessoa, vínculos não cancelados ordenados cronologicamente; para cada vínculo cuja expedição é ativa e futura (`data_embarque >= hoje`): posição `idx+1`; se `ehMarco(pos)` → marco `{nome, exp, pos}` (texto `"{pos}ª expedição · {exp}"`); se `aniversarioNaViagem(...)` → aniversariante (texto `"🎂 {dd/MM/yyyy} · {exp}"`). Marcos ordenados por pos desc; aniversários por data asc. Links → `/expedicoes/{expId}`. Vazio: "Marcos de fidelidade e aniversários das próximas viagens aparecem aqui."

---

## 7. Lista de Expedições / Pacotes

### 7.1 Rotas
- `app/(app)/expedicoes/page.tsx` (17 L): `dynamic="force-dynamic"`, title "Expedições"; `listExpedicoesComAgregados()` + `listUsuarios()` → `<ExpedicoesPageCliente expedicoes usuarios />`.
- `app/(app)/pacotes/page.tsx` (15 L): mesmo componente com `listExpedicoesComAgregados("pacote")` e `tipo="pacote"`, title "Pacotes".
- `app/(app)/expedicoes/loading.tsx` (45 L): skeleton (cabeçalho, 4 chips de filtro, seção de ano com 6 linhas).

### 7.2 Distinção expedição × pacote (`db/migrations/0060_expedicao_tipo.sql`)
```sql
alter table expedicoes add column if not exists tipo text not null default 'expedicao';
alter table expedicoes add constraint expedicoes_tipo_chk check (tipo in ('expedicao', 'pacote'));
create index if not exists idx_expedicoes_tipo on expedicoes(tipo);
```
Pacote = viagem personalizada que reaproveita 100% de `expedicoes`. Diferenças de comportamento:
| Onde | Expedição | Pacote |
|---|---|---|
| Rótulos lista (`ExpedicoesPageCliente` L45-47) | `{titulo:"Expedições", sing:"expedição", plur:"expedições", novo:"Nova Expedição"}` | `{titulo:"Pacotes", sing:"pacote", plur:"pacotes", novo:"Novo pacote"}` |
| Código gerado | `generateExpedicaoCodigo` → `PERU-AGO2026` | `PAC-${base}-${rand4}` (rand = `Math.random().toString(36).slice(2,6).toUpperCase()`) |
| Checklist SOP 23 processos | gerado na criação | **não** |
| Abas no detalhe | todas | sem `rooming`, `checklist`, `roteiro-lider` |
| Visão geral | card "Próximos prazos" + linha Checklist | escondidos |
| Dashboard/avisos/prontidão/processos | entra | **fora** (filtros `tipo='expedicao'`) |
| CommandPalette | listada | não listada |
| Delete confirm text | "...passageiros, custos, pagamentos e checklist..." | "...passageiros, custos e pagamentos..." |
| Webhook Bitrix | sempre cria `tipo='expedicao'` (default) | — |

### 7.3 `ExpedicoesPageCliente.tsx` (513 L) — o que mostra
- Cabeçalho: título + `LiveBadge(realtimeStatus)`; subtítulo `"{filtradas} de {total} {sing|plur}"` + `" · N filtro(s) ativo(s)"`.
- Busca (input, atalho `/`): placeholder "Buscar (código, nome, destino)... [/]"; match `includes` case-insensitive em `"${codigo} ${nome} ${destino}"`.
- Toggle de visão: **cards** (default) | **tabela** (estado local, não persiste).
- Botão "Nova Expedição"/"Novo pacote" (kbd `n`) — escondido se somenteLeitura.
- **Filtros** (`FilterPopover`, todos client-side, L69-93):
  - Status (multi, `STATUS_EXPEDICAO`).
  - Destino (multi, lista distinta ordenada dos destinos presentes; só aparece se houver).
  - Período (single) `PERIODOS = [{todos,"Todas"},{"30","Próx. 30d"},{"60","Próx. 60d"},{"90","Próx. 90d"},{"ano","Este ano"}]`: 30/60/90 → `0 <= daysUntil(data_embarque) <= N`; "ano" → `new Date(data_embarque).getFullYear() === anoAtual` (UTC parse; risco de fuso em 01/jan).
  - Resp. Op (single): "Todos" + usuários com papel `operacional` ou `admin`; preview = primeiro nome.
  - "Limpar filtros" quando `ativaCount>0` (`ativaCount = |status| + |destino| + (periodo≠todos) + (respOp?1:0)`; busca não conta).
- **Agrupamento por ano** (L105-129): chave = `new Date(data_embarque).getFullYear()` ou "sem-data". Dentro do grupo: ativas primeiro, Concluída/Cancelada no fim (sort estável preserva ordem manual `ordem`). Ordem das seções: ano ≥ atual (asc) → anos passados (desc) → "Sem data". Header de seção sticky: ano grande, `"{n} {sing|plur}"`, chips por status com contagem.
- **Destaque "Próxima"** (L132-142): entre as filtradas, a ativa com menor `daysUntil >= 0`.
- **Atalhos da página** (L145-169): `/` foca busca; `n` abre drawer (se pode editar); ↑/↓ muda `selecionada` (índice global sobre `filtradas`); Enter abre `/expedicoes/{id}`. (Nota: a seleção só é passada para a tabela mas `ExpedicoesTable` ignora a prop `selecionada` — sem highlight visual.)
- **Empty states:** sem nenhum registro → `EmptyState` (Compass) título "Nenhuma expedição ainda"/"Nenhum pacote ainda", descrição (expedição) "Crie sua primeira viagem em grupo para começar a organizar passageiros, prazos, rooming e prontidão — tudo num lugar só." / (pacote) "Crie seu primeiro pacote personalizado para organizar passageiros, roteiro, voos, hospedagem e vouchers — com acesso ao Portal do Viajante.", botão "Criar primeira expedição"/"Criar primeiro pacote" (oculto em read-only). Com filtros zerando → "Nenhuma expedição/Nenhum pacote com os filtros atuais."
- Clique no card/linha → `/expedicoes/{id}` (pacotes também usam a rota `/expedicoes/[id]`).
- Realtime: `useRealtimeRefresh({ subscriptions: [{ table: "expedicoes" }] })` (L58-60) — qualquer INSERT/UPDATE/DELETE em `expedicoes` → `router.refresh()` (debounce 300ms).

### 7.4 `ExpedicaoCard.tsx` (115 L)
- Topo gradiente: pill status (`STATUS_PILL`), contador (`dias===0 → "embarca hoje"`, `>0 → "{d}d"`, `<0 → "✈ Embarcou"`), "★ Próxima" se destaque (+ `ring-2 ring-[var(--brand-lime-deep)]`), nome (2 linhas), destino.
- Corpo: anel Ocupação `ocup = pax_planejados>0 ? pax_confirmados/pax_planejados : 0` + `"{conf}/{plan} pax"`; anel Prontidão `aptos/total` (cor: cinza se total 0; verde se 100%; laranja senão) + `"{aptos}/{total} aptos"`; rodapé `"{embarque} → {retorno}"` e `codigo` mono.
- Botão lápis (hover em desktop) → abre `EditarExpedicaoDrawer` — omitido em read-only.

### 7.5 `components/tables/ExpedicoesTable.tsx` (301 L) — visão tabela por grupo de ano
- Colunas VERBATIM: `["" (drag), "Nome", "Destino", "Embarque", "Retorno", "Status", "Pax", "Checklist", "Prontidão", "" (ações)]`.
- Embarque: data + `"em {d}d"` (laranja se `d<30`, só se `d>=0`). Status: `EditableSelectCell` com badge `STATUS_VARIANT`, heading "Mudar status", salva `atualizarExpedicaoCampo(id,"status",v)` + `router.refresh()`. Pax: `**conf**/plan`. Checklist: barra + `formatPercent(checklist_pct,0)`. Prontidão: `aptos/total` (verde se todos, laranja senão; "—" se total 0). Linha destaque "★ PRÓXIMA".
- Ações: lápis (onEdit) + `ConfirmDeleteButton` → `excluirExpedicao(id)`; título `Excluir "{nome}"?`; sucesso "Expedição excluída"/"Pacote excluído"; após OK → `router.refresh()`.
- **Drag & drop** (`@dnd-kit`, `PointerSensor distance 5`, `verticalListSortingStrategy`): reordena localmente e chama `onReorder(ids do grupo)`; o pai monta a **ordem global** concatenando todos os grupos (substituindo o grupo arrastado) e chama `reordenarExpedicoes(ordemGlobal)`; erro → toast "Erro ao salvar nova ordem"; ok → refresh. Drag só existe na visão tabela. Handle aparece mesmo em read-only (sem persistir).
- Vazio interno: "Nenhuma expedição encontrada com os filtros atuais."
- Observação: a ordem `ordem` é global entre expedições e pacotes do mesmo tipo listado (só os ids visíveis/filtrados são renumerados de 0..n-1 → filtrar e arrastar renumera só o subconjunto e pode colidir com `ordem` de itens ocultos).

### 7.6 `NovaExpedicaoDrawer.tsx` (225 L) — criar
- Form (react-hook-form + zod, L32-40):
```ts
nome: z.string().min(3, "Mínimo 3 caracteres"), destino: z.string().min(2, "Obrigatório"),
data_embarque: z.string().min(1, "Obrigatório"), data_retorno: z.string().min(1, "Obrigatório"),
responsavel_operacional_id: z.string().optional(), responsavel_comercial_id: z.string().optional(),
pax_planejados: z.number().int().min(1, "Mínimo 1")   // default 20
```
- Destino: input com `<datalist>` de `DESTINOS_CADASTRADOS = Object.keys(REQUISITOS_POR_DESTINO)` = Peru, Argentina, Chile, Japão, Egito, Tailândia, Itália (`lib/prontidao/requisitos-destino.ts` L72-131); texto de ajuda "Cadastrados aparecem como sugestão (com condicionais próprias); outros destinos caem nos requisitos internacionais padrão."
- Preview do código no header (`PAC-{base}-••••` para pacote).
- Selects: Resp. Operacional (papel operacional|admin), Resp. Comercial (papel comercial|admin), opção `_none` "— sem responsável —".
- Nota: expedição → "O checklist padrão (23 processos operacionais das 5 fases, com prazos calculados a partir do embarque) é gerado automaticamente."; pacote → "Pacote personalizado: sem checklist de grupo...".
- **Sem validação data_retorno ≥ data_embarque no client** — só o CHECK do banco (`check (data_retorno >= data_embarque)`, 0001 L130) devolve erro cru do Postgres.
- Submit → `criarExpedicao({...data, codigo, tipo})`; ok → toast "Expedição criada" (desc `"{codigo} · checklist padrão gerado"`) / "Pacote criado" (desc codigo), reset, fecha, `router.push('/expedicoes/{id}')`; erro → toast "Erro ao criar". Código duplicado (`codigo unique`) → erro do banco (ex.: duas expedições pro mesmo destino/mês).

### 7.7 `EditarExpedicaoDrawer.tsx` (272 L) — editar em lote
- zod (L31-43):
```ts
nome: min(3), destino: min(2), data_embarque: min(1), data_retorno: min(1),
status: z.enum(["Planejamento","Vendas Abertas","Em andamento","Concluída","Cancelada"]),
pax_planejados: int min(0), pax_cortesia: int min(0), preco_venda_brl: number min(0),
observacoes: string nullable optional, responsavel_operacional_id/comercial_id: string optional
```
- Campos: Nome, Destino (sem datalist), Embarque, Retorno, Status (select), Pax planejados, Cortesias, Preço (R$, step 0.01), Resp. Op, Resp. Com, Observações (textarea 3 linhas). Header mostra `codigo` (não editável). **Não edita `tipo`, `codigo`, `dmc_principal_id`, `viagem_grupo`, `grupo_rotulo`.**
- Botão "Salvar alterações" desabilitado se `!isDirty`. Envia `atualizarExpedicaoLote(id, {...data, observacoes: trim || null, resp_*: ?? null})`; ok → toast "Expedição atualizada" (mesmo p/ pacote), fecha, refresh.

---

## 8. Server actions (`app/(app)/expedicoes/actions.ts`, 3001 L) — as desta parte
Todas `"use server"`, client = `getServerClient()` (sessão do usuário ⇒ RLS; read-only bloqueado pelo 0046 com erro "new row violates row-level security policy" / 0 linhas afetadas). **Nenhuma** chama `assertPodeEditar`, nenhuma escreve em `audit_log` manualmente (trigger faz), **nenhuma fala com o Bitrix** (o `atualizarExpedicaoCampo` NÃO escreve no Bitrix — o botão "Sync Bitrix" do header é decorativo).

### 8.1 `criarExpedicao(input)` (L35-115)
- zod servidor:
```ts
codigo: z.string().min(1), nome: z.string().min(3), destino: z.string().min(2),
data_embarque: z.string().min(1), data_retorno: z.string().min(1), pax_planejados: z.number().int().min(1),
preco_venda_brl: z.number().min(0).optional(), responsavel_operacional_id: z.string().optional(),
responsavel_comercial_id: z.string().optional(), tipo: z.enum(["expedicao","pacote"]).optional().default("expedicao")
```
- Erro de validação → `issues.map(message).join(", ")`.
- `insert into expedicoes {codigo, nome, destino, data_embarque, data_retorno, responsavel_operacional_id ?? null, responsavel_comercial_id ?? null, pax_planejados, preco_venda_brl ?? 0, status:"Planejamento", tipo} returning id`.
- Se `tipo !== "pacote"` → `gerarChecklistPadrao(novoId)` (resultado ignorado; falha não reverte a expedição).
- `revalidatePath("/expedicoes")`, `revalidatePath("/pacotes")`. Retorna `{ok:true,id}`.
- Trigger: `audit_log` insert.

### 8.2 `gerarChecklistPadrao(expedicaoId)` (L1330-1413) — chamado na criação e pelo webhook
1. `expedicoes select data_embarque eq id maybeSingle`.
2. `checklist_itens count exact head eq expedicao_id` → se >0: erro "Esta expedição já tem checklist. Apague os itens antes de regerar."
3. `usuarios select id,papel` → `primeiroPorPapel` (primeiro usuário encontrado de cada papel, ordem indefinida do banco).
4. `construirChecklistPadrao` (`lib/processos/template.ts`, 165 L): 23 processos-pai (todos `papel:"operacional"`) + subtarefas; `responsavel_id` = primeiro usuário operacional; `status "Pendente"`; prazo = `data_embarque − offset`, `offset = (offsetDias ?? fase.diasReferencia) − (ordemNaFase−1)*2`; filhos herdam prazo do pai, `ordem = i+1`.
5. Insere pais (`expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, ordem`) `.select('id')` (assume ordem de retorno = ordem de inserção) → insere filhos com `parent_id` real.
6. `revalidatePath(/expedicoes/{id}/checklist)`, `(/expedicoes/{id})`.
- **Não é atômico** (2 inserts); falha no 2º deixa só pais. Na SPA: virar RPC SQL `gerar_checklist_padrao(expedicao_id)` (transacional) ou manter template em TS e inserir em 2 passos igual.
- Lista dos 23 processos/subtarefas: `lib/processos/template.ts` L26-77 (copiar verbatim — detalhado na parte do Checklist).

### 8.3 `atualizarExpedicaoLote(id, input)` (L133-202)
- zod servidor `editarLoteSchema`: todos opcionais — `nome min3, destino min2, data_embarque min1, data_retorno min1, pax_planejados int≥0, pax_cortesia int≥0, preco_venda_brl ≥0, status enum(5), observacoes string|null, responsavel_operacional_id string|null, responsavel_comercial_id string|null`.
- `update expedicoes set <dados> where id`.
- **Regra:** se `status === "Concluída"` → `confirmarPassageirosDaExpedicao(id)` = `update passageiros set status_reserva='Confirmado' where expedicao_id=id and status_reserva <> 'Cancelado'` (L157-173; erro ignorado). (Comentário: prontidão vira Apto automaticamente porque `avaliarProntidao` curto-circuita em expedição Concluída.)
- Note: dispara mesmo que já estivesse Concluída (drawer sempre manda status).
- revalidate `/expedicoes`, `/expedicoes/{id}`.

### 8.4 `reordenarExpedicoes(ids[])` (L204-226)
- N updates paralelos `update expedicoes set ordem = i where id = ids[i]` (sem transação). Primeiro erro → `{ok:false}`. revalidate `/expedicoes` (não `/pacotes`).
- SPA: preferir RPC `reordenar_expedicoes(ids uuid[])` com `unnest ... with ordinality` (1 round-trip, atômico).

### 8.5 `atualizarExpedicaoCampo(id, campo, valor)` (L117-131, L228-260)
- Whitelist VERBATIM: `["nome","destino","data_embarque","data_retorno","status","pax_planejados","pax_cortesia","preco_venda_brl","observacoes","responsavel_operacional_id","responsavel_comercial_id","dmc_principal_id","ordem"]`; fora → `Campo "${campo}" não é editável`.
- **Sem validação de tipo/valor** (status arbitrário só barra no enum do Postgres).
- `update expedicoes set {[campo]: valor} where id`. Se `campo==="status" && valor==="Concluída"` → `confirmarPassageirosDaExpedicao`.
- revalidate `/expedicoes`, `/dashboard`, `/expedicoes/{id}`.
- Usado na lista (status inline). **Não toca Bitrix.**

### 8.6 `excluirExpedicao(id)` (L1580-1614)
- `delete from expedicoes where id`. Cascata pelo FK `on delete cascade`: `quartos`, `passageiros` (→ `documentos`, `passageiro_requisitos`, `passageiro_quarto`…), `custos` (→ `pagamentos`), `checklist_itens`, `links_expedicao`, tabelas do portal etc. (conferir FKs de `arquivos` — storage files NÃO são apagados do bucket).
- **Apaga passageiros junto** (diferente de `excluirPassageiro`, que preserva a pessoa como avulso) — histórico de fidelidade da pessoa some.
- revalidate `/expedicoes`, `/dashboard` (não `/pacotes`). Trigger audit grava delete da expedição e de cada passageiro/custo/pagamento em cascata.

---

## 9. Detalhe da expedição — overview `/expedicoes/[id]`

### 9.1 `layout.tsx` (26 L)
- `getExpedicaoComAgregados(id)`; não achou → `notFound()`.
- Renderiza `<ExpedicaoRealtimeSync/>`, `<ExpedicaoHeader/>`, `<ExpedicaoTabsNav tipo/>`, conteúdo com scroll.

### 9.2 `ExpedicaoHeader.tsx` (147 L)
- Hero gradiente: ← voltar (/expedicoes — mesmo para pacote), nome (h1), pill status, `codigo` mono, destino, `"{embarque} → {retorno}"`; avatares do resp. Op (`title "Op: {nome}"`) e Com (`"Com: {nome}"`); contador: `dias>=0` → número grande + `"embarca hoje" | "dia p/ embarcar" | "dias p/ embarcar"`; senão "✈ Embarcou" (ou "—" se sem data).
- Faixa de 3 `RingStat`: **Ocupação** (`pax_confirmados/pax_planejados`, "confirmados"), **Checklist** (`formatPercent(checklist_pct,0)`, "concluído" — mostrado também em pacote, onde é 0%), **Prontidão** (`aptos/total`, "aptos p/ embarque", cor como no card).
- Botão **"Sync Bitrix"** sem `onClick` — **morto** (não replicar ou implementar de verdade).

### 9.3 `ExpedicaoTabsNav.tsx` (56 L) — abas VERBATIM
```ts
const TABS = [
  { slug: "", label: "Visão Geral" }, { slug: "passageiros", label: "Passageiros" }, { slug: "rooming", label: "Rooming" },
  { slug: "checklist", label: "Checklist" }, { slug: "documentos", label: "Documentos" }, { slug: "links", label: "Links" },
  { slug: "portal", label: "ExpedAmigo" }, { slug: "roteiro-lider", label: "Roteiro do Líder" },
];
const OCULTAS_PACOTE = new Set(["rooming", "checklist", "roteiro-lider"]);
```
Ativa: `pathname.endsWith("/"+slug)` ou `pathname === base`. (Pastas existentes: checklist, documentos, grupos, links, passageiros, portal, rooming, roteiro-lider — `grupos` não tem aba.)

### 9.4 `ExpedicaoRealtimeSync.tsx` (30 L) — debounce 400ms → `router.refresh()`
Subscriptions VERBATIM:
```ts
{ table: "expedicoes" },                                         // sem filtro
{ table: "passageiros", filter: `expedicao_id=eq.${expedicaoId}` },
{ table: "quartos", filter: `expedicao_id=eq.${expedicaoId}` },
{ table: "checklist_itens", filter: `expedicao_id=eq.${expedicaoId}` },
{ table: "passageiro_requisitos" },                              // sem filtro (não tem expedicao_id)
{ table: "arquivos", filter: `expedicao_id=eq.${expedicaoId}` },
{ table: "links_expedicao", filter: `expedicao_id=eq.${expedicaoId}` },
{ table: "documentos" },                                         // sem filtro
```
SPA: em vez de `router.refresh()`, invalidar as queries (ex.: TanStack Query `invalidateQueries(['expedicao', id])`).

### 9.5 `page.tsx` — Visão Geral (248 L)
Dados: `listPassageiros(id)`, `listChecklist(id)`, `getProntidaoExpedicao(id)`, `getExpedicao(id)`, `listUsuarios()`, `listArquivosExpedicao(id)` (`arquivos eq expedicao_id order created_at desc`), `listPessoas()` (todas — só p/ fidelidade).
Cards (grid 2 colunas):
1. **Próximos prazos (7 dias)** — só expedição: itens do checklist (pais E filhos) com `0 <= daysUntil(prazo) <= 7` e status ≠ Concluído, ordenados por prazo; linha `tarefa`, `"{etapa} · {prazo}"`, badge (`d<=1 critico`, `d<=3 atencao`, senão `lista`; 0 → "Hoje"). Vazio "Nenhum prazo próximo." (Não inclui atrasados.)
2. **Prontidão de embarque** — Aptos/Atenção/Bloqueados de `getProntidaoExpedicao`. Vazio "Sem passageiros ainda."
3. **Documentos pendentes (top 5)** — `DocumentosPendentesCard` (§9.6).
4. **Resumo** — "Passageiros: `{pax.length} ({confirmados} confirmados)`" (aqui conta TODOS, inclusive cancelados e líderes — difere do header), "Prontidão: `{aptos}/{prontidao.length} aptos`", "Checklist: `{concluídos}/{checklist.length} concluídos`" (pais+filhos; difere do % do header que usa só pais) — checklist oculto em pacote.
5. **Momentos especiais** (col-span 2) — `construirPosicoesFidelidade(pessoas,id)` sobre pax não cancelados:
   - Marcos (pos ∈ {3,5,10}, desc): `"{pos}ª expedição com a gente 🎉"`.
   - Aniversariantes do mês (`aniversarioNoMesDaExpedicao`, asc por data): `"🎂 {dd/MM/yyyy}{ — faz N anos}{ · 🎉 durante a viagem}"`.
   - Estreantes (pos === 1): "Primeira viagem com a gente 👋".
   - Vazio: "Nada em destaque por enquanto — marcos de fidelidade, aniversários e estreantes aparecem aqui."
- `[id]/loading.tsx` (28 L): skeleton de tabela (header e abas permanecem).

### 9.6 `DocumentosPendentesCard.tsx` (112 L, client)
- Pendências derivadas do motor de prontidão (não da tabela `documentos`): checagens com `semaforo` `atencao` ou `bloqueio`.
- Ordem: quem tem bloqueio primeiro, depois nome (`localeCompare pt-BR`); top 5. Linha: nome (link-style), tipos `join(" · ")`, badge com nº de faltas (critico se há bloqueio). Vazio: "✓ Tudo OK."
- Clique → abre `ProntidaoPaxDrawer` (`[id]/passageiros/ProntidaoPaxDrawer.tsx`, parte de Passageiros) — onde ocorrem as escritas (status de requisito, anexos). O drawer é derivado por id da lista atual para refletir refresh.

---

## 10. Integrações: cron, Bitrix, segredos

### 10.1 Cron `app/api/expedicoes/atualizar-status/route.ts` (96 L) — `vercel.json`: `{"path":"/api/expedicoes/atualizar-status","schedule":"0 3 * * *"}` (03:00 UTC = 00:00 BRT). (Também `/api/cambios/sync` às `0 6 * * *`.)
- Auth: GET exige `Authorization: Bearer ${CRON_SECRET}` (`isValidCronBearer`, timing-safe); POST exige usuário logado (qualquer papel, inclusive leitura!). Liberado no middleware.
- `hojeISO = new Date().toISOString().slice(0,10)` (UTC).
- Service role:
  - r1: `update expedicoes set status='Em andamento' where status in ('Planejamento','Vendas Abertas') and data_embarque <= hoje and data_retorno >= hoje`.
  - r2: `update expedicoes set status='Concluída' where status <> 'Cancelada' and status <> 'Concluída' and data_retorno < hoje`.
- Resposta `{ok, hoje, em_andamento: n, concluidas: n}`.
- **Não chama `confirmarPassageirosDaExpedicao`** ao concluir (diferente da UI) — passageiros de expedições auto-concluídas não são confirmados (mas prontidão curto-circuita para Apto de qualquer jeito). Trigger audit registra com `usuario_id` null.
- Nota: aplica-se também a pacotes (sem filtro de tipo).
- SPA: manter como Vercel cron/Edge Function ou mover para `pg_cron` (SQL puro, recomendado: `select cron.schedule('0 3 * * *', $$ update ... $$)`).

### 10.2 Webhook `POST /api/bitrix/expedicao-sync` (111 L) — Bitrix → n8n → sistema
- Auth: header `x-webhook-secret` == `WEBHOOK_SECRET` (timing-safe). JSON inválido → 400.
- zod `expedicaoSyncSchema` (`lib/bitrix/validators.ts`):
```ts
bitrix_pipeline_id: z.string().min(1), codigo: z.string().min(1), nome: z.string().min(1), destino: z.string().min(1),
data_embarque: z.string().min(1), data_retorno: z.string().min(1),
pax_planejados: z.number().int().nonnegative().optional(), preco_venda_brl: z.number().nonnegative().optional()
```
- Service role: procura existente `or(bitrix_pipeline_id.eq.X, codigo.eq.Y).maybeSingle()` (string interpolada sem escape — vírgula/parêntese no valor quebra o filtro; >1 match → erro silencioso tratado como "não existe").
- `upsert {codigo, nome, destino, data_embarque, data_retorno, pax_planejados ?? 0, preco_venda_brl ?? 0, bitrix_pipeline_id} onConflict codigo` → **sobrescreve `pax_planejados`/`preco_venda_brl` com 0 se não vierem**; não mexe em status/responsáveis/tipo.
- Se `action === "created"` → `gerarChecklistPadrao(id)` — **BUG**: essa função usa `getServerClient()` (cookie/sessão), que num webhook sem cookie é `anon` ⇒ RLS bloqueia (`select` retorna null → "Expedição não encontrada"); checklist **não é gerado** para expedições criadas via Bitrix em produção.
- Resposta `{ok, expedicao_id, action}`.
- Outros webhooks em `/api/bitrix/*` (passageiro-sync, sync-contato, importar-compras) — fora desta parte; `lib/bitrix/upsert-passageiro.ts` (238 L) usa `mapBitrixStage`.

### 10.3 `lib/bitrix/*`
- `outbound.ts` (96 L): `enviarPassageiroParaBitrix(payload: PassageiroOutbound)` → `POST N8N_BITRIX_OUTBOUND_URL` com header `x-webhook-secret: WEBHOOK_SECRET`; best-effort, nunca lança. Único evento: `"inscricao_aprovada"`; único chamador: `app/(app)/inscricoes/actions.ts` L298 (aprovar inscrição). Campos do payload: bitrix_deal_id, bitrix_contact_id, expedicao_codigo, expedicao_nome, expedicoes_anteriores, nome_completo, cpf, email, telefone, data_nascimento, passaporte, validade_passaporte, status_reserva, observacoes, endereco{cep,rua,numero,complemento,bairro,cidade,estado}, contato_emergencia_{nome,vinculo,fone}, pref_marcar_assento, pref_upgrade_classe, ja_viajou_internacional, paises_visitados, saude (jsonb), passaporte_arquivo_url (signed URL), passaporte_arquivo_nome. **Não há outbound de expedição.**
- `stage-mapping.ts` (41 L) VERBATIM:
```ts
BITRIX_STAGE_MAP = { NEW:"Lead", LEAD:"Lead", PREPARATION:"Lead", "1":"Lead",
  PROPOSAL:"Pré-reserva", NEGOTIATION:"Pré-reserva", PRE_RESERVA:"Pré-reserva", "2":"Pré-reserva", "3":"Pré-reserva",
  WON:"Confirmado", SIGNED:"Confirmado", CONFIRMED:"Confirmado", "4":"Confirmado",
  LOST:"Cancelado", CANCELED:"Cancelado", CANCELLED:"Cancelado", REJECTED:"Cancelado", "5":"Cancelado" };
mapBitrixStage(id) = !id ? "Lead" : BITRIX_STAGE_MAP[String(id).toUpperCase().trim()] ?? "Lead";
```
- `mapping.ts` (33 L): `CAMPOS_CUSTOM_BITRIX = { CPF:"UF_CRM_CPF", PASSAPORTE:"UF_CRM_PASSAPORTE", VALIDADE_PASSAPORTE:"UF_CRM_PASSAPORTE_VALIDADE", DATA_NASCIMENTO:"UF_CRM_DATA_NASCIMENTO", EXPEDICAO_CODIGO:"UF_CRM_EXPEDICAO_CODIGO", VOO_NACIONAL:"UF_CRM_VOO_NACIONAL", OBSERVACOES_OPERACIONAIS:"UF_CRM_OBSERVACOES" }`; `extractCustom` (array → 1º). Só referência (não usado em runtime).
- `types.ts` (39 L): `BitrixPassageiroPayload`, `BitrixExpedicaoPayload`, `SyncResponse`.
- `validators.ts` (28 L): `passageiroSyncSchema` (bitrix_deal_id, bitrix_contact_id?, expedicao_codigo, estagio_deal, nome_completo, email().nullable?, telefone?, cpf?, passaporte?, validade_passaporte?, data_nascimento?, voo_nacional_necessario bool?, observacoes?) + `expedicaoSyncSchema` (acima).
- `lib/security/secrets.ts` (42 L): `timingSafeEqualStr` (sha256 dos dois lados + `timingSafeEqual`), `isValidWebhookSecret` (`WEBHOOK_SECRET`; sem env → false), `isValidCronBearer` (`CRON_SECRET`).

### 10.4 Variáveis de ambiente
| Env | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clients browser/server |
| `SUPABASE_SERVICE_ROLE_KEY` | cron, webhooks, aprovar inscrição, mudar papel (`lib/supabase/admin.ts`) |
| `SITE_PASSWORD` | gate do middleware (opcional) |
| `CRON_SECRET` | Bearer do cron |
| `WEBHOOK_SECRET` | `x-webhook-secret` inbound e outbound |
| `N8N_BITRIX_OUTBOUND_URL` | outbound inscrição aprovada |
| `N8N_SYNC_URL`, `N8N_SYNC_SECRET` | `[id]/passageiros/bitrix-sync-actions.ts` (outra parte) |
| `NEXT_PUBLIC_SITE_URL` | links absolutos (outras partes) |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_DEV_USE_MOCK_DATA`, `NODE_ENV` | modos de dev (`lib/dev-mode.ts`; forçados false em prod) |

---

## 11. Componentes de tabela genéricos
- **`EditableCell.tsx`** (131 L): props `value, onSave(v)→{ok,error}, type 'text'|'number'|'date', placeholder '—'`. Read-only → `<span>` texto. Clique → input focado+selecionado. Commit em Enter/blur/Tab; Esc cancela. Parse: number vazio → null, NaN → toast "Valor inválido" e reverte; text/date vazio → null (text não faz trim no valor salvo, só no teste de vazio). Se igual ao original → não salva. Erro → toast "Erro ao salvar" + reverte. Sem otimista: mostra novo valor só após refresh/realtime.
- **`EditableSelectCell.tsx`** (171 L): popover próprio (não Radix), `options {value,label,dotClassName,className}`, `heading`, `renderValue`. Teclado: ↑/↓ circular, Enter escolhe, Esc fecha; clique fora fecha; `stopPropagation` (não abre a linha). Mesmo valor → só fecha. Read-only → só renderiza o valor. Erro → toast "Erro ao salvar".
- **`DataTable.tsx`** (114 L): wrapper TanStack Table v8 com sorting por clique no header (ícone ▲/▼), `globalFilter` = substring case-insensitive sobre TODOS os valores do objeto da linha, `onRowClick`, `emptyMessage` default "Nenhum registro.", `size` como largura. (Não usado pela lista de expedições; usado em outras telas.)
- **`ConfirmDeleteButton.tsx`** (ui): retorna null em read-only; dialog com título/descrição; sucesso → toast + `router.refresh()`; falha → toast "Não foi possível excluir"; exceção → "Erro inesperado".

## 12. `lib/hooks/useRealtimeRefresh.ts` (175 L)
- Um `supabase.channel` por subscription (nome único `rt:{table}:{filter|all}:{idx}:{seq}`), `postgres_changes` em `INSERT|UPDATE|DELETE` (ou `events`), `schema public`, `filter` opcional (só igualdade). Callback `onChange` pode cancelar (retornar false). Debounce default 300ms → `router.refresh()`.
- Status agregado: `idle|connecting|live|error|offline` (error se algum CHANNEL_ERROR/TIMED_OUT/CLOSED; offline quando mock). Exibido por `LiveBadge`.
- Re-inscreve só quando muda a "forma" (`table|filter|events`).
- Usos nesta parte: lista (`expedicoes`), layout do detalhe (8 tabelas, §9.4).

## 13. Realtime — publicação `supabase_realtime` (todas com `REPLICA IDENTITY FULL`)
- `db/REALTIME_SETUP.sql` / 0006 / 0008 / 0012 / 0013: `expedicoes, passageiros, quartos, custos, pagamentos, checklist_itens, fornecedores, cambios, documentos, arquivos, usuarios, grupos_expedicao, links_expedicao, requisitos_destino, passageiro_requisitos`.
- As policies `anon_read_dev` do REALTIME_SETUP foram removidas pela 0036 → realtime só entrega para `authenticated` (RLS aplicada aos eventos). Nenhuma tabela do portal (roteiro, voos, inscricoes_pendentes etc.) está na publicação.

## 14. Tabelas tocadas nesta parte (colunas usadas)
- **usuarios** (0001 + 0032): `id (=auth.users.id) uuid pk, email unique, nome, papel papel_usuario default 'leitura', avatar_url, senha_provisoria bool default true, created_at, updated_at`. RLS: `auth_all_*` (qualquer autenticado lê/insere/atualiza/apaga).
- **expedicoes** (0001 + 0004 + 0029 + 0030 + 0060): `id, codigo unique not null, nome, destino, data_embarque date, data_retorno date (check >= embarque), responsavel_operacional_id → usuarios (set null), responsavel_comercial_id → usuarios, dmc_principal_id → fornecedores, status status_expedicao default 'Planejamento', pax_planejados int default 0, pax_cortesia int default 0, preco_venda_brl numeric(14,2) default 0, bitrix_pipeline_id text, observacoes, ordem int null, viagem_grupo text, grupo_rotulo text, hospedagem_voucher_arquivo_id → arquivos, tipo text default 'expedicao' check in ('expedicao','pacote'), created_at, updated_at`. Triggers: `set_updated_at`, `audit_change`. Índices: status, data_embarque, destino, ordem, tipo.
- **passageiros**: lidos `id, expedicao_id (null=avulso), status_reserva, tipo, passaporte, nome_completo, cpf, email, bitrix_contact_id, data_nascimento, created_at` + todos usados pelo motor de prontidão; escrito `status_reserva` (confirmar ao concluir).
- **passageiro_requisitos**: `*` (motor de prontidão) — `passageiro_id, tipo, status, arquivo_id, validade...`.
- **checklist_itens** (0001 + 0009): `id, expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, parent_id, ordem, dependencia_id, evidencia_url, bitrix_task_id, observacoes`.
- **arquivos**: `select * where expedicao_id` (drawer de prontidão).
- **fornecedores**: `select * order nome` (palette).
- **inscricoes_pendentes**: `count where status='pendente'` (badge).
- **audit_log**: só via trigger (`tabela, registro_id, usuario_id, acao, dados_antes, dados_depois, origem, created_at`).
- Cascata em delete de expedição: quartos, passageiros(+filhos), custos(+pagamentos), checklist_itens, links_expedicao, portal etc.

## 15. Contagem aproximada de linhas (escopo desta parte)
| Arquivo | L |
|---|---|
| app/(app)/layout.tsx | 46 |
| components/layout/* (AppShell 62, Breadcrumb 48, CommandPalette 186, GlobalShortcuts 94, Header 57, PermissoesContext 56, PointerEventsGuard 18, Sidebar 125, ThemeProvider 43, ThemeToggle 29, UserMenu 83) | 801 |
| lib/auth/permissoes.ts / lib/supabase/auth.ts / middleware.ts / lib/site-auth.ts | 53 / 60 / 41 / 34 |
| login (page 62, operacional 44, LoginForm 62, actions 29) + primeiro-acesso 42 + NovaSenhaForm 85 + conta/actions 42 + acesso | ~420 |
| dashboard/page.tsx | 286 |
| lib/alertas/regras.ts | 62 |
| expedicoes: page 17, ExpedicoesPageCliente 513, ExpedicaoCard 115, NovaExpedicaoDrawer 225, EditarExpedicaoDrawer 272, loading 45; pacotes/page 15 | 1 202 |
| components/tables: ExpedicoesTable 301, EditableCell 131, EditableSelectCell 171, DataTable 114 | 717 |
| [id]: layout 26, page 248, ExpedicaoHeader 147, ExpedicaoTabsNav 56, ExpedicaoRealtimeSync 30, DocumentosPendentesCard 112, loading 28 | 647 |
| actions.ts (trechos desta parte ≈ L1-260, L1320-1413, L1580-1614) | ~400 de 3 001 |
| lib/data/expedicoes.ts | 748 |
| lib/constants.ts / lib/utils.ts / lib/hooks/useRealtimeRefresh.ts | 267 / 165 / 175 |
| api/expedicoes/atualizar-status 96, api/bitrix/expedicao-sync 111, lib/bitrix (outbound 96, stage-mapping 41, mapping 33, types 39, validators 28), lib/security/secrets 42 | 486 |
| Dependências obrigatórias de outras partes: lib/prontidao/regras.ts 357 + requisitos-destino 174; lib/processos/template.ts 165; lib/data/pessoas.ts; lib/fidelidade.ts | ~900 |

---

## 16. Riscos / pontos de atenção para a reescrita (detalhe)
1. **`usuarios` sem trava**: policy `auth_all_update` permite que QUALQUER autenticado faça `update usuarios set papel='admin' where id=auth.uid()` direto pelo supabase-js (já possível hoje com a anon key + JWT). No SPA isso fica óbvio — criar policy: update só da própria linha e só de colunas seguras (`senha_provisoria`, `nome`, `avatar_url`), ou bloquear `papel` com trigger; mudança de papel só via RPC `security definer` checando admin.
2. **Auto-provisionamento** de `usuarios` (papel leitura, senha_provisoria true) está no `getCurrentUser` server-side — mover para trigger `after insert on auth.users`.
3. **Agregados pesados**: `listExpedicoesComAgregados` baixa `passageiro_requisitos` inteiro + todos os passageiros e roda o motor de prontidão em TS; o layout faz isso em toda navegação (palette + badge de alertas). No SPA, criar view/RPC SQL (paridade com `vw_prontidao_passageiro` de 0010) ou cache.
4. **Truncamento 1000 linhas** não tratado em `getResumoProcessos` (checklist_itens) e `listPessoas` (passageiros/expedicoes) → KPIs "Prazos atrasados", "Momentos especiais" e fidelidade erram silenciosamente com base grande.
5. **Webhook Bitrix não gera checklist** em produção (usa client de sessão/anon dentro de rota sem cookie) e zera `pax_planejados`/`preco_venda_brl` se omitidos; filtro `.or()` com interpolação crua.
6. **Cron × UI divergem**: cron conclui sem confirmar passageiros; POST do cron aceita qualquer usuário logado (inclusive leitura) via service role — bypassa o read-only.
7. **`daysUntil` com date-fns** (`differenceInDays` vs agora) e `hoje` em UTC (`toISOString`) misturados — paridade exata de "hoje/Xd/atrasado" exige replicar; agrupamento por ano usa `new Date('YYYY-MM-DD').getFullYear()` (UTC→local pode dar ano anterior em 01/jan no fuso -03).
8. **Escritas não atômicas**: `gerarChecklistPadrao` (2 inserts), `reordenarExpedicoes` (N updates; renumera só os ids visíveis → colisões de `ordem`), `criarExpedicao` + checklist (falha do checklist não reverte). Preferir RPCs transacionais.
9. **Sem guarda de app nas actions** de expedição (só RLS); `atualizarExpedicaoCampo` sem validação de valor. "Sync Bitrix" do header é botão morto; `atualizarExpedicaoCampo` NÃO escreve no Bitrix (o único outbound é "inscricao_aprovada").
10. **Delete em cascata apaga passageiros** (e histórico de fidelidade) e não limpa arquivos do Storage; `codigo` unique gerado de destino+mês colide para 2 expedições do mesmo destino/mês (erro cru do Postgres); CHECK `data_retorno >= data_embarque` só no banco.


---

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


---

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


---

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


---


---

# Parte E — Consolidação: componentes, constantes, riscos, ordem sugerida

## E.1 Páginas × complexidade (linhas aproximadas da UI + actions/libs dedicadas)

| Página | Linhas | Complexidade | Observação |
|---|---|---|---|
| Shell/nav/papéis (layout, Sidebar, Header, CommandPalette, atalhos) | ~800 | Baixa | Todos os papéis veem o menu inteiro; trava só por RLS (Parte A §1–2) |
| Dashboard | ~290 + data | Média | KPIs dependem do motor de prontidão e de `checklist_itens` (corte de 1000) |
| Expedições (lista) + Pacotes | ~1.500 | Média | Cards/tabela, reordenar drag, criar/editar drawers; pacote = `tipo='pacote'` (0060) |
| Expedição overview (`[id]`) | ~700 | Média | Header, abas, DocumentosPendentes, realtime |
| `[id]/passageiros` + `[paxId]` | ~5.000 + actions | **Muito alta** | Tabela inline, prontidão, import CSV, ExpedAmigo, extensões/passeios, grupos G1/G2, mudar expedição |
| `[id]/grupos` | ~280 | Baixa | Sem link no menu de abas (só URL) |
| `[id]/rooming` | ~2.050 + actions | **Muito alta** | dnd-kit, hotéis/trechos/extensões, conexões, automático, XLSX |
| `[id]/checklist` | ~975 + template | Alta | Template SOP 23 processos + 57 subtarefas, prazos relativos ao embarque |
| `[id]/documentos` (Drive) | ~700 | Média | Storage `arquivos-expedicoes` via API service role |
| `[id]/links` | ~340 | Baixa | CRUD simples |
| `[id]/portal` (editor ExpedAmigo) | ~1.600 | Alta | Contrato de dados com `/amigo` (manter compatível) |
| `[id]/roteiro-lider` | ~400 | Média | Contrato com `/lider` + offline |
| `/passageiros` (global, "Clube") | ~1.200 | Alta | Pessoa = agrupamento por CPF/bx/email/nome; XLSX; import global |
| `/clientes` | ~470 | Média | XLSX server-side |
| `/fornecedores` | ~580 | Baixa | CRUD; coluna Histórico conta dados fictícios |
| `/inscricoes` | ~1.100 + core 479 | **Alta** | Aprovar = multi-tabela + n8n/Bitrix + signed URL → Edge Function |
| `/acessos-expedamigo` | ~200 + libs | Média | `acesso_senhas`/links sem RLS → Edge Function |
| `/avisos` | ~150 | Baixa (UI) | Recalcula prontidão de tudo a cada load (alimenta badge do menu) |
| `/configuracoes` | ~360 | Média | auth.admin → Edge Function obrigatória |

## E.2 Componentes que valem portar
- `components/tables/EditableCell.tsx`, `EditableSelectCell.tsx`, `DataTable.tsx` — padrão "planilha turbinada" (Tab/Enter salva, Esc cancela).
- `PassageirosTabela.tsx` (842) + `ProntidaoPaxDrawer.tsx` (885) + `EditarPassageiroDrawer.tsx` (596) + `SaudeCampos.tsx` (213).
- `RoomingBoard.tsx` (1366) + drawers de quarto/hotel/conexão.
- `ChecklistTabela.tsx` (814) — árvore processo → subtarefas.
- `components/arquivos/Drive.tsx` (323), `PassaporteAnexo.tsx` (92), `lib/comprimir-imagem.ts` (70).
- `PortalEditor.tsx` (1295).
- `components/layout/CommandPalette.tsx` (cmdk), `GlobalShortcuts.tsx`, `components/ui/*` (Drawer, ConfirmDeleteButton, LiveBadge, ProgressRing, FilterPopover, StatPill).
- Libs puras (portáveis quase sem mudança, com testes vitest): `lib/prontidao/regras.ts` + `requisitos-destino.ts` + `template.ts` + `vacina-sync.ts`, `lib/processos/template.ts`, `lib/csv/passageiros-import.ts` (+test), `lib/cpf.ts` (+test), `lib/fidelidade.ts` (+test), `lib/saude.ts`, `lib/rooming/acompanhante.ts`, `lib/alertas/regras.ts` (+test), `lib/portal-voos.ts`, `lib/utils.ts`, `lib/constants.ts`.

## E.3 Arquivos de constantes / dados fixos no código
- `lib/constants.ts` — status, labels, cores, opções (copiado na Parte A §3).
- `lib/prontidao/requisitos-destino.ts` — **catálogo de requisitos por destino que vale** (a tabela `requisitos_destino` e a view `vw_prontidao_passageiro` estão desatualizadas) — Parte B.
- `lib/prontidao/template.ts`, `lib/prontidao/regras.ts` — Parte B.
- `lib/processos/template.ts` — template SOP do checklist (Parte C §3; contém "Imprimir … pra Luis").
- `lib/saude.ts` — 13 perguntas de saúde (Parte B).
- `lib/fidelidade.ts` — níveis (Parte B).
- `lib/csv/passageiros-import.ts` — aliases de colunas do CSV (Parte B).
- `lib/bitrix/mapping.ts`, `stage-mapping.ts` — campos `UF_CRM_*` e estágios (Partes A/B).
- `lib/dev-grupos-egito.ts` — divisão G1/G2 do Egito por fragmentos de nome (dado pessoal no código → trocar por update em `passageiros.grupo_id`).
- `lib/mock-data.ts`, `lib/data/arquivos-mock.ts` — só modo dev; não portar.

## E.4 Riscos principais (consolidados das 4 partes)
1. **Escalada de privilégio em `usuarios`** — policy `auth_all_update` deixa qualquer autenticado fazer `update usuarios set papel='admin'`; fora da trava `is_readonly()` (0046). Fechar ANTES de expor o SPA (RPC protegida/trigger).
2. **Service role em ~20 pontos** (§0.2) — Storage, senhas/links ExpedAmigo (`acesso_senhas` e links curtos sem nenhuma policy), aprovar/recusar inscrição, reset de senha (auth.admin), compras, portal, roteiro do líder. Precisam de Edge Functions/RPCs `security definer` ou policies novas; bucket `arquivos-expedicoes` não tem storage policies em migration.
3. **Segredos dos tokens** — tokens de inscrição e de 1º acesso são assinados com `SUPABASE_SERVICE_ROLE_KEY`; Edge Functions precisam usar o mesmo segredo, e girar a chave invalida links já enviados.
4. **"Pessoa" não é tabela** — identidade calculada (`cpf:` → `bx:` → `email:` → `nome:`); edição pessoal propaga para todas as linhas `passageiros` da pessoa baixando a tabela inteira. Virar RPC transacional.
5. **Motor de prontidão em TS** roda sobre tudo em várias telas (layout, dashboard, avisos/badge). Decidir: portar o TS idêntico ou mover p/ view/RPC SQL. Regras sutis: seguro/aéreo/vacina só ok com anexo; passaporte vem de `passageiros.passaporte_arquivo_id`; contrato nunca bloqueia; líder dispensa só contrato; expedição Concluída = todos aptos.
6. **Requisitos não gerados** para pax vindos do Bitrix (webhook sem sessão, RLS bloqueia, erro engolido) e para aprovações feitas por `relacionamento`; tipos novos do catálogo nunca chegam a pax antigos. Sugerido: trigger no banco.
7. **Corte silencioso de 1000 linhas** (PostgREST) em `listPessoas`, `getResumoProcessos`, requisitos de `getProntidaoExpedicao`, arquivos de passageiros, busca por CPF na aprovação. Paginar no SPA.
8. **Escritas não atômicas** — criar expedição + checklist, gerar checklist (2 inserts), reordenar (N updates), alocação de quarto (delete+insert, capacidade só no front). Recomendado RPCs.
9. **Realtime incompleto** — `passageiro_quarto` e `grupos_expedicao` fora da publicação; `passageiro_quarto` com policies que aceitam anon; `extensoes`/`passageiro_extensao` fora da trava readonly.
10. **Contratos com apps que ficam no antigo** — `/amigo` lê `"__base__"` → `apenas_sem_extensao=true`, `grupo_id`/`passageiro_id` dos voos, e `arquivos.descricao` como etiqueta ("Documento do líder", "Ingresso Machu Picchu"); `/lider` idem. O Drive novo não deve deixar apagar esses arquivos de sistema.
11. **Bugs a NÃO replicar** — CSV usa `quarto_id` antigo; "Remover divisão" apaga todos os grupos; mudar expedição deixa compras/extensões/arquivos na antiga; `/api/bitrix/expedicao-sync` não gera checklist (RLS) e zera `pax_planejados`/`preco_venda_brl`; cron conclui expedição sem confirmar pax; botão "Sync Bitrix" do header não faz nada; numeração de quartos instável; status de quarto sem efeito; senha de reset fraca (`Setur@`+4 dígitos).
12. **Câmbio (excluído)** — única dependência fora da tela: criar custo em moeda estrangeira lê taxa de `cambios` (fallback 1.0). As actions de custos/pagamentos não são chamadas por nenhuma tela hoje (código morto).

## E.5 Ordem sugerida de rebuild
1. Segurança do banco (usuarios RLS, policies faltantes, storage policies, trigger de usuário novo em `auth.users`, trigger de requisitos).
2. Shell + lista de expedições/pacotes + overview.
3. Passageiros da expedição + prontidão (maior valor e maior risco).
4. Checklist, Links, Documentos (Edge Function de Storage).
5. Rooming.
6. Globais: Passageiros/Clube, Fornecedores, Clientes, Avisos, Dashboard.
7. Inscrições, Acessos ExpedAmigo, Configurações (dependem de Edge Functions).
8. Portal editor + Roteiro do líder (respeitando contrato com `/amigo` e `/lider`).


---

