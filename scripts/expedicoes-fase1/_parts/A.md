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
