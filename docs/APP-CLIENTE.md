# App do cliente — o antigo "Sistema de Expedições" vira o app da viagem

27/10/2026 · frente App do Cliente · **plano + arquivos prontos, NADA executado em produção.**

**A decisão:** o QS é o sistema da equipe. O app antigo (`sistema-expedicoes`, Next.js na Vercel) vira o app que o
cliente usa pra acompanhar a viagem (estilo Itineo), lendo os dados do QS. Vale pra qualquer viagem: pacote,
aéreo, seguro, hospedagem ou expedição.

---

## 1. Os acessos: como trocar

### Resposta curta
**Os clientes não precisam migrar login nenhum.** O ExpedAmigo (`/amigo`), a Área do Líder (`/lider`), o link
de 1º acesso (`/a/<código>`) e a `/inscricao` **não usam o login do Supabase**. Eles conferem CPF + senha numa
tabela comum, `acesso_senhas`. Essa tabela já é uma das 34 que o `copiar-dados.mjs` leva pro QS. A senha é
calculada pelo código do app, com uma regra fixa que não depende do projeto: `sha256("expedamigo:senha:v1:<cpf>:<senha>")`.
Então, quando o app passa a ler o QS, **a mesma senha continua valendo**.

**O que precisa migrar são só os logins da EQUIPE** que entram na parte interna do app antigo
(`/login`, e-mail + senha do Supabase Auth). Hoje são 11 logins. 5 já têm conta no QS e 4 não têm.
O script `scripts/app-cliente/migrar-acessos.sql` copia esses 4 **com a mesma senha**.

### Números (só leitura, 27/10)
| | antigo (`bnbpsuenlokhljrkvlke`) | QS (`eabfjomrnucymduqnbci`) |
|---|---|---|
| Logins (auth.users) | 11, todos e-mail+senha (bcrypt `$2a$`), 0 MFA, 0 OAuth/SSO | 21 |
| Senhas de cliente (`acesso_senhas`) | 147 (136 já trocaram a senha, 11 ainda com a provisória) | 143 (cópia de ensaio de 21/10) |
| Senhas mudadas desde o ensaio | 22 | — (a recópia da noite traz) |
| Passageiros | 936 (468 liberados no ExpedAmigo) | 930 (922 ligados a uma ficha) |
| Acessos ao portal | 3.627 registros, o último hoje (27/10, 12h53) | — |
| Senhas de cliente que batem com uma ficha (`rel_clientes`) pelo CPF | — | 138 de 143 |

**Os 11 logins da equipe:**
| e-mail | papel no antigo | no QS | o que acontece |
|---|---|---|---|
| antonio.carlos@ | admin | já existe (operacional) | fica a conta do QS e vale a **senha do QS** |
| beatriz.galvao@ | admin | já existe (gestor) | idem |
| marianevalentim@ | admin | já existe (relacionamento) | idem |
| pietra.moreira@ | admin | já existe (operacional) | idem |
| tainaravasconcelos@ | admin | já existe (gestor) | idem |
| carolina_taketomi@yahoo.com.br | admin | não existe | **copiado com o mesmo id e a mesma senha** |
| contato@setuforeuvou.com | admin | não existe | **copiado** |
| larissa.souza@ | operacional | não existe | **copiado** |
| glaucia.sousa@ | leitura (bloqueada até 2029) | não existe | **copiado**, continua bloqueada |
| camila.nicacio@ | sem papel, nunca entrou | não existe | pulado (dá pra incluir) |
| brunooliveira062006@gmail.com | sem papel, nunca confirmou | não existe | pulado |

Conflitos de id: **0**. Os 4 copiados já estão em `usuarios` do QS com o id antigo (memória 21/10), então
com o mesmo id tudo se liga sozinho.

### Por que a senha continua valendo
- **Equipe:** o Supabase Auth guarda só o hash bcrypt (`encrypted_password`, `$2a$10$…`). O bcrypt carrega o
  próprio sal dentro do hash e não usa nenhuma chave do projeto. Copiado pro outro projeto, ele confere a mesma
  senha. O script copia o hash, o id, a confirmação de e-mail e o bloqueio. Não copia tokens pendentes
  (recuperação, confirmação, troca de e-mail), nem sessões, nem a data do último login.
- **Clientes:** hash SHA-256 com o CPF como sal e um "tempero" fixo no código (`lib/acesso-senha.ts`). Também
  não depende do projeto. Só precisa que a tabela `acesso_senhas` seja copiada, e ela é.

### Como funciona cada portal do app antigo (código lido em `origin/master`, 98d5359 de 26/10)
| porta | como entra | o que muda na troca |
|---|---|---|
| `/login` (equipe) | Supabase Auth, e-mail + senha (`signInWithPassword`), sessão em cookie | todos saem e entram de novo; vale a senha do QS (ou a antiga, pra quem foi copiado) |
| `/amigo` (ExpedAmigo) | CPF + senha conferidos no servidor com a chave service_role; o navegador guarda CPF+senha no `localStorage` e reconfere a cada visita | **nada**: o cliente nem percebe, desde que `acesso_senhas` esteja copiada |
| `/lider` | igual ao `/amigo` (mesma tabela), mais a lista fixa de CPFs master no código | nada |
| `/a/<código>` | procura o código em `acesso_links` e gera um token novo na hora | nada (a tabela é copiada e o token nasce já com a chave nova) |
| `/amigo/acesso?t=…` (link longo) | token HMAC assinado com a `SUPABASE_SERVICE_ROLE_KEY` | links longos já enviados **deixam de valer** (a chave muda). O onboarding manda o link curto `/a/`, então o impacto é pequeno |
| `/inscricao?t=…` | token HMAC (mesma chave), vale 30 min | quem estiver no meio do formulário na hora da troca precisa reabrir pelo portal |
| `/acesso` (senha do site) | `SITE_PASSWORD` em cookie | nada |

### Riscos da troca dos acessos
1. **Sessões da equipe caem.** O JWT de cada projeto é assinado com um segredo diferente. Todo mundo da equipe
   precisa entrar de novo no app antigo. Clientes não são afetados (o portal deles não usa sessão do Supabase).
2. **Links longos `/amigo/acesso?t=` e `/inscricao?t=` assinados com a chave antiga deixam de valer.** Os curtos
   `/a/` continuam. Se precisar, dá pra criar uma variável `PORTAL_TOKEN_SECRET` com a chave antiga (exige uma
   mudança pequena no código, não feita).
3. **E-mails:** os copiados já vão confirmados, então não sai nenhum e-mail de confirmação. "Esqueci a senha"
   passa a sair pelo SMTP e pelos modelos do QS, com o link do QS (conferir Site URL / Redirect URLs no
   Auth do QS se o app antigo usar esse fluxo: hoje ele só usa senha).
4. **Os 4 copiados ganham login no QS também** (mesmo projeto). Sem linha em `qs_users`, a tela do QS mostra
   "sem acesso". Mas várias policies antigas do QS liberam `authenticated` com `true` (`qs_meetings`, `qs_users`,
   `qs_settings`…): pela API, eles conseguiriam ler essas tabelas. Para 4 pessoas da casa, o risco é baixo.
   Para clientes, isso seria inaceitável, e por isso existe a parte 4 da migration 0210 (seção 3).
5. **Os 5 que já têm QS** passam a usar a senha do QS no app antigo. Avisar antes.

---

## 2. Arquitetura do app do cliente

### Telas (mobile-first, PWA instalável, que o `/amigo` já é)
1. **Minhas viagens:** cartões "próxima / em andamento / passadas", com contagem regressiva.
2. **Minha viagem** (uma viagem):
   - Topo: destino, datas, quem vai, "faltam N dias".
   - **Roteiro dia a dia:** dias da expedição ou, pra viagens avulsas, a linha do tempo montada com os itens e os trechos.
   - **Voos:** trecho, número, horário com fuso, localizador, terminal, bagagem, assento, "check-in abre em…".
   - **Hospedagem**, **passeios**, **transfers**, **trem**, **carro**, **cruzeiro**, **seguro**: um cartão por item
     da venda, com o voucher pra baixar.
   - **Documentos:** passaporte, vistos, vacinas, seguro, vouchers e bilhetes, com a validade.
   - **Checklist** (fase 2): o que falta (passaporte válido, visto, vacina, formulário de inscrição).
   - **Avisos** e **informações importantes** (o que já existe por expedição).
   - **Contatos:** agência, plantão, guia/líder, seguro (telefone de emergência).
3. **Conta:** trocar senha, dados pessoais.

### De onde vem cada dado (tudo no QS)
| No app | Tabela no QS | Observação |
|---|---|---|
| Quem é o cliente | `rel_clientes` (ficha única, 0172) | CPF de `acesso_senhas` → `rel_clientes.cpf` (138/143 batem) |
| Lista de viagens | `rel_viagens` (1.854; 535 ainda não terminaram) | comprador `cliente_id` ou passageiro em `rel_viagem_passageiros` |
| Quem vai | `rel_viagem_passageiros` + `rel_clientes.nome` | |
| Voos / hotel / passeio / transfer / trem | `rel_viagem_trechos` (2.724) | já tem fuso, terminal, bagagem, assento, check-in |
| Itens vendidos por tipo (aéreo, pacote, seguro, hospedagem, passeio, carro, cruzeiro, concierge, expedição) | `qs_venda_itens` (**0207, ainda não existe**) | ligados à viagem pela 0208; **nunca** mostrar `valor`, `custo`, `fornecedor` |
| Documentos e vouchers | `rel_documentos` (9.745) + bucket `rel-documentos` | o app gera a URL assinada no servidor |
| Expedição: roteiro, voos do grupo, avisos, info, links | `roteiro_dias`, `expedicao_voos`, `expedicao_avisos`, `expedicao_info`, `links_expedicao` | via `rel_viagens.expedicoes_id` (805 viagens já ligadas) |
| Expedição: quarto, ingressos, seguro e voucher por passageiro | `passageiros`, `quartos`, `arquivos` (bucket `arquivos-expedicoes`) | é o que o `/amigo` já mostra hoje |

### Segurança
- **Fase 0/1 (como hoje):** o cliente entra com CPF + senha (`acesso_senhas`). O servidor do app usa a
  service_role e chama as funções da 0210 passando `p_cliente`, a ficha achada pelo CPF.
- **Fase 2 (opcional):** o cliente ganha login próprio no Supabase Auth do QS. O vínculo fica em
  `app_cliente_acessos (auth_user_id ↔ cliente_id)` e as mesmas funções descobrem o cliente sozinhas por
  `auth.uid()`. Equipe (quem tem `qs_users`) nunca é tratada como cliente.
- **O cliente nunca lê tabela direto.** Só pelas funções `app_cliente_minhas_viagens()`,
  `app_cliente_viagem(id)` e `app_cliente_documento_path(id)`. Elas devolvem só campos escolhidos: sem custo,
  margem, observação interna, Bitrix ou IA. RLS não esconde colunas, por isso a escolha foi por funções.
- **Barreira:** a 0210 põe em TODAS as tabelas uma policy *restritiva* `app_cliente_barreira`, que dá falso só
  para quem é cliente. Para a equipe nada muda. Ela fecha as policies antigas com `true` (`qs_meetings`,
  `qs_users`, `qs_settings`, `qs_cadence_*`, `gloria_*`, inserts de `qs_leads`/`qs_notes`/`qs_tasks`/
  `qs_whatsapp_messages`). **Tabela criada depois da 0210 não ganha a barreira sozinha.** Enquanto
  existir login de cliente, cada migration nova precisa repetir a policy (ou rodar o bloco de novo).
- **Melhoria recomendada no portal atual:** o `/amigo` guarda CPF + **senha em texto** no `localStorage`.
  Trocar por um cookie httpOnly assinado (sessão de 30 dias). Isso não bloqueia nada.

### Plano de virada (cada fase tem volta)
**Fase 0: o app antigo passa a ler o QS** (a "noite da troca"; checklist abaixo)
- Trocar 3 variáveis no projeto da Vercel do app antigo: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Depois, Redeploy.
- Antes: logins da equipe (migrar-acessos.sql) e recópia dos dados.
- **Volta:** repor as 3 variáveis antigas e fazer Redeploy. O banco antigo fica intacto e só perde o que foi
  feito depois da troca. Se voltar após dias de uso, o que foi feito no QS precisa ser copiado de volta à mão.
- Efeito colateral bom: os webhooks `/api/bitrix/*` e os crons (`/api/cambios/sync`,
  `/api/expedicoes/atualizar-status`) do app antigo passam a gravar no QS, e o time passa a usar as telas de
  Expedições do QS.

**Fase 1: portais de expedição funcionando no QS** (sem código novo)
- `/amigo`, `/lider`, `/a/`, `/inscricao` testados com dados do QS.
- Desligar as telas internas do app antigo (a equipe usa o QS). Isso é uma mudança no `middleware.ts`.
- Aplicar a 0210 (só funções e barreira; nada muda pra equipe).

**Fase 2: app de viagem pra todos os tipos**
- Depende da 0207 (`qs_venda_itens`) e da 0208 (itens ligados à viagem).
- Tela "Minha viagem" (esqueleto no branch `app-viagem` do app antigo, com dados de exemplo) passa a chamar
  `app_cliente_minhas_viagens` / `app_cliente_viagem`.
- Acesso pra cliente que não é de expedição: hoje só existe senha pra passageiro de expedição. Criar a senha
  provisória pela ficha (aba ExpedAmigo da ficha) e mandar o link `/a/`. Isso exige guardar o `cliente_id`
  no `acesso_links`: hoje ele só tem `passageiro_id`.
- **Volta:** é só não divulgar a tela nova. Os portais antigos continuam.

### Checklist da noite da troca (consolidado)
Pré-requisitos (de dia):
- [ ] Bruno dá o ok e marca o horário (~30 min sem ninguém mexer nas Expedições, no antigo nem no QS).
- [ ] Avisar o time: os 5 que já têm QS entram com a **senha do QS**; todos vão precisar entrar de novo.
- [ ] Separar as chaves do QS (URL, anon, service_role) e anotar as 3 variáveis atuais da Vercel do app antigo (pra voltar).
- [ ] Lembrar que as **Expedições do QS estão congeladas desde 21/10**. Tudo que foi feito nelas no QS depois disso **será apagado** pela recópia. Confirmar com o time que ninguém usou.

Na noite (nesta ordem):
1. [ ] `scripts/app-cliente/migrar-acessos.sql`: parte A no antigo; parte B no QS com `simular = true` → conferir (4 COPIAR) → `simular = false`.
2. [ ] `scripts/app-cliente/noite-guardar-vinculos.sql` no QS (guarda 922 ligações passageiro→ficha e 107 divergências).
3. [ ] `scripts/expedicoes-fase1/04_noite_antes.sql` no QS.
4. [ ] `node scripts/expedicoes-fase1/copiar-dados.mjs --limpar` (no repo do QS; termina conferindo 34/34).
       Atenção: apaga `passageiros.cliente_id` e, em cascata, `cad_divergencias`. O passo 6 devolve os dois.
5. [ ] `05_noite_depois.sql` + `02_fks.sql` no QS (se uma FK falhar, há dado órfão novo: corrigir antes).
6. [ ] `scripts/app-cliente/noite-restaurar-vinculos.sql` no QS (devolve as ligações e liga os passageiros novos pela regra da 0172b).
7. [ ] `node scripts/expedicoes-fase1/copiar-arquivos.mjs` (só os arquivos novos).
8. [ ] Vercel → projeto do app antigo → trocar as 3 variáveis → Redeploy.
9. [ ] Testar: login da equipe (um dos 4 copiados com a senha antiga e um dos 5 com a senha do QS);
       abrir uma expedição e baixar um arquivo; rooming; `/amigo` com um CPF real; `/lider` com um master; um link `/a/`
       recente; `/inscricao` pelo portal.
10. [ ] No QS: Ops → Expedições mostra os dados de hoje; a ficha de um cliente mostra a aba ExpedAmigo.

Depois:
- [ ] Rodar `exp_gerar_requisitos` (143 passageiros sem requisitos, pendência de 21/10).
- [ ] Envs do QS que faltam pras integrações de Expedições: `EXP_WEBHOOK_SECRET`, `EXP_N8N_BITRIX_OUTBOUND_URL`, domínio dos links `/a/` (`PORTAL_ANTIGO_URL`).
- [ ] `scripts/importar-expedicoes.mjs` lê o banco antigo: passar a ler o QS.
- [ ] Depois de 1–2 semanas sem volta: apagar `_noite_*`, tirar `EXPEDICOES_SECRET_KEY` do `.env` e pausar o projeto antigo no Supabase (não apagar).

### Arquivos desta frente
- `supabase/migrations/0210_app_cliente.sql`: vínculo login↔ficha, funções de leitura do cliente, storage, barreira (só escrita).
- `scripts/app-cliente/migrar-acessos.sql`: logins da equipe com a senha preservada (simulação + rollback).
- `scripts/app-cliente/noite-guardar-vinculos.sql` / `noite-restaurar-vinculos.sql`: protegem o cadastro único na recópia.
- App antigo, branch local `app-viagem` (worktree `WorkFlows/sistema-expedicoes-app-viagem`): esqueleto da tela "Minha viagem".
