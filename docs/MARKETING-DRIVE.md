# Drive do Marketing dentro do QS (0241)

Todos os vídeos e conteúdos gravados ficam num **Drive compartilhado do Google chamado "Marketing"**.
O QS acessa esse Drive por uma **conta de serviço** (um "robô" do Google). Ninguém do time precisa
logar no Google: quem é do Marketing (ou admin) entra no QS → área Marketing → **Drive** e navega,
busca, assiste, sobe arquivo e cria pasta dali mesmo.

- Tela: `src/mkt/drive/DrivePage.tsx` · seletor para os cards: `src/mkt/drive/DrivePicker.tsx`
- Servidor: `api/mkt-drive.js` (+ `api/_mktDriveGoogle.js`, `api/_mktDriveSync.js`)
- Banco: `supabase/migrations/0241_mkt_drive.sql` (índice `mkt_drive_arquivos` + `mkt_drive_estado`)

---

## Passo a passo (uma vez só) — ~20 minutos

> Precisa de uma conta Google **Workspace** (a do domínio da agência). Drive compartilhado
> não existe em conta @gmail.com comum.

### 1. Criar o Drive compartilhado "Marketing"
1. Abra <https://drive.google.com> com a conta da agência.
2. Menu da esquerda → **Drives compartilhados** → **+ Novo** → nome: `Marketing`.
3. Abra o Drive criado. A URL fica assim:
   `https://drive.google.com/drive/folders/0ABCdEfGhIjKlUk9PVA`
   O trecho depois de `/folders/` (`0ABCdEfGhIjKlUk9PVA`) é o **MKT_DRIVE_ID**. Guarde.
4. (Opcional) Crie as pastas-base: `Brutos`, `Editados`, `Reels`, `Tráfego`, `Fotos`, uma por expedição…
   Dá pra criar pelo QS depois também.

### 2. Projeto no Google Cloud + Drive API
1. Abra <https://console.cloud.google.com> com a mesma conta.
2. No topo, seletor de projeto → **Novo projeto** → nome `QS Marketing` → Criar (ou use um projeto que já exista).
3. Com o projeto selecionado: **APIs e serviços → Biblioteca** → procure **Google Drive API** → **Ativar**.

### 3. Criar a conta de serviço e a chave JSON
1. **APIs e serviços → Credenciais → + Criar credenciais → Conta de serviço**.
2. Nome: `qs-drive` → Criar e continuar → (papel do projeto: pode pular) → Concluir.
3. Clique na conta criada → aba **Chaves** → **Adicionar chave → Criar nova chave → JSON** → Criar.
   Baixa um arquivo `.json`. **Esse arquivo é uma senha**: não mande por WhatsApp, não suba no Git.
4. Anote o e-mail da conta, algo como `qs-drive@qs-marketing.iam.gserviceaccount.com`.

> Se aparecer "A criação de chaves de conta de serviço está desativada" é uma política da
> organização (`iam.disableServiceAccountKeyCreation`). Um administrador do Workspace libera em
> **IAM e administrador → Políticas da organização** para este projeto.

### 4. Dar acesso da conta de serviço ao Drive "Marketing"
1. Volte no Drive compartilhado `Marketing` → clique no nome dele no topo → **Gerenciar membros**.
2. Cole o e-mail da conta de serviço (`qs-drive@...iam.gserviceaccount.com`).
3. Papel: **Gerente de conteúdo** (cria, edita, move e manda pra lixeira; não apaga o Drive nem mexe em membros).
4. Desmarque "Notificar" (é um robô) → **Compartilhar**.

> Se o Workspace bloquear compartilhar com fora do domínio, libere a conta de serviço em
> admin.google.com → Apps → Google Workspace → Drive e Documentos → Configurações de compartilhamento.

### 5. Colar as variáveis na Vercel (projeto do QS)
Vercel → projeto do QS → **Settings → Environment Variables** (marque *Production* e *Preview*):

| Variável | O que colar |
|---|---|
| `GOOGLE_SA_JSON` | o conteúdo **inteiro** do arquivo `.json` baixado (pode colar como está, com as chaves `{ }`) |
| `MKT_DRIVE_ID` | o id do passo 1.3 |

Alternativa ao `GOOGLE_SA_JSON` (se preferir separar):

| Variável | O que colar |
|---|---|
| `GOOGLE_SA_EMAIL` | o `client_email` do JSON |
| `GOOGLE_SA_KEY` | o `private_key` do JSON (de `-----BEGIN PRIVATE KEY-----` até `-----END PRIVATE KEY-----`; pode ficar com os `\n`) |

Opcional:

| Variável | Pra quê |
|---|---|
| `MKT_DRIVE_ORIGENS` | outros endereços de onde o QS é aberto, separados por vírgula (ex.: `https://qs.setuforeuvouviagens.com.br`). O próprio domínio do deploy já é aceito sozinho. |

`CRON_SECRET` já existe no projeto (os outros crons usam) — o do Drive usa o mesmo.

Depois de salvar: **Deployments → … → Redeploy** (variável nova só vale em deploy novo).

### 6. Aplicar a migration
Rodar `supabase/migrations/0241_mkt_drive.sql` no SQL Editor do Supabase (é **aditiva**: só cria
tabela/função nova). O rollback está comentado no fim do arquivo.

### 7. Conferir
1. Entre no QS com um usuário do Marketing (ou admin) → Marketing → **Drive**.
2. Deve aparecer "Índice atualizado agora" no canto (a 1ª abertura já indexa o Drive).
3. Crie uma pasta `Teste`, suba um vídeo pequeno, abra ele e dê play, ponha uma tag, mande pra lixeira.
4. No Google Drive, a pasta e o vídeo (na lixeira) têm que aparecer lá também.

Se a tela mostrar "O Drive do Marketing ainda não está ligado" → falta variável (a mensagem diz qual).
"O Google recusou a conta de serviço" → JSON colado errado / chave revogada.
"Não achei esse arquivo no Drive" logo na raiz → a conta de serviço não é membro do Drive (passo 4).

---

## Como funciona (pra quem for mexer)

**Permissão.** `api/mkt-drive.js` confere o usuário do QS (token do Supabase) e só deixa passar
`role in (admin, marketing)` ou quem tem o setor `marketing`. Antes de mexer em qualquer arquivo, o
servidor pergunta ao Google se ele é **do Drive `MKT_DRIVE_ID`** — a conta de serviço não toca em
outro Drive mesmo que alguém compartilhe algo com ela. Nada é apagado de vez: "Lixeira" é a lixeira
do Google (restaura por 30 dias no próprio Drive).

**Navegar** é sempre ao vivo no Drive (`files.list` com `corpora=drive`, `supportsAllDrives`, paginado
por `pageToken`). **Buscar** usa o índice local `mkt_drive_arquivos` (rápido, e tem o que o Drive não
tem: tags do QS, expedição/destino, observação, quem subiu). Se o índice não achar, a tela oferece
"buscar direto no Drive" (por nome).

**Índice / sincronização.** `api/_mktDriveSync.js`: na 1ª vez guarda o `startPageToken` e varre o
Drive inteiro (páginas de 1000, pode levar mais de uma chamada — o cursor fica em `mkt_drive_estado`);
depois só lê a **changes API** a partir do último `pageToken`. Roda: ao abrir a tela (se a última foi
há mais de 15 min), no botão "Atualizar" e por **cron de hora em hora** (`/api/mkt-drive?cron=1`, min 17).
A sincronização nunca sobrescreve tags/destino/observação.

**Subir arquivo.** O servidor abre uma **sessão resumable** no Google (`uploadType=resumable`)
mandando o header `Origin` do QS e devolve a URL da sessão; o navegador faz o `PUT` **direto no
Google** com barra de progresso — vídeo de GB não passa pela função da Vercel. Se a conexão cair,
pergunta ao Google quanto chegou (`Content-Range: bytes */total`) e continua dali.
**Plano B:** se o navegador for barrado por CORS nesse PUT direto, a tela passa a mandar o arquivo
em pedaços de 4 MB por `PUT /api/mkt-drive?acao=pedaco`, e o servidor repassa pra mesma sessão
(mais lento, mas sobe). No fim, `concluir_envio` confere o arquivo no Google e registra no índice
quem subiu.

**Assistir.** `<video>` não manda header de login, então o servidor devolve links **assinados**
(HMAC, valem 2 h): `?acao=midia` repassa o vídeo em pedaços de 4 MB (o limite de resposta da Vercel é
~4,5 MB; o player pede o resto sozinho, com `Range`) e `?acao=miniatura` repassa a miniatura do Drive.
Documento do Google (Docs/Planilhas/Apresentações) e vídeo em formato que o navegador não toca (MKV,
AVI) abrem pela **visualização do Google** (`/file/d/<id>/preview`) — essa só funciona pra quem está
logado no navegador com uma conta que é membro do Drive compartilhado; senão o Google pede acesso.
Sempre há o botão "Abrir no Google Drive".

> Custo: assistir vídeo pelo QS passa os bytes pela Vercel (banda da Vercel). Pra revisão rápida tudo
> bem; pra maratonar material bruto, melhor abrir no Google Drive.

**DrivePicker** (para o quadro de conteúdo):

```tsx
import { DrivePicker, type ArquivoDrive } from "@/mkt/drive/DrivePicker";

<DrivePicker aberto={aberto} onFechar={() => setAberto(false)} multiplo
  onEscolher={(arquivos: ArquivoDrive[]) => anexar(arquivos)} />
```

`ArquivoDrive = { id, nome, mimeType, webViewLink, thumbnailLink?, tamanho? }`. O `thumbnailLink`
é um link assinado do QS (vale ~2 h) — no card, guarde `id` + `webViewLink`.

## Testes

```
node --import ./tests/registrar-ts.mjs --test tests/mkt-drive/*.test.ts
```

Cobrem a assinatura do JWT (confere com a chave pública), a troca de token (fetch falso), a
montagem da busca `q` (com escape contra injeção), paginação, faixa de bytes do player, link
assinado, origem permitida do upload, trava da URL do plano B (sem SSRF), tags e formatação.
**Nenhum teste chama o Google de verdade.**
