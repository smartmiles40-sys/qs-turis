# Webfone WebRTC (VoxFree) — ligação de voz dentro do navegador

Ligação real **no navegador**, via JsSIP sobre WSS: o SDR clica "Ligar" no lead e
fala pelo microfone, sem instalar softphone e sem passar pelo WhatsApp. Substitui
o click-to-dial (BravoTech/SIP) no canal **"Ligação"** — mas só entra no lugar dele
quando o ramal do SDR estiver provisionado (senão cai no softphone de sempre).

Diferente da **Wavoip** (canal "Ligação WhatsApp"), que continua igual.

## Como está montado (código)

| Peça | Arquivo |
|---|---|
| Integração JsSIP (registro, chamada, mudo, log, estado) | `src/lib/webphone.ts` |
| UI flutuante da chamada (chamando/tocando/em ligação, cronômetro) | `src/components/sdr/telefone/WebphoneWidget.tsx` (montada no `SdrLayout`) |
| Credenciais por SDR (RLS por dono) | tabela `qs_sip_lines` — `supabase/migrations/0013_sip_lines.sql` |
| Config compartilhada (WSS/domínio/prefixo) | `qs_settings` (chaves `sip_ws_url`, `sip_ws_domain`, `sip_ws_prefix`) |
| Tela de configuração (admin) | Config → **Webfone WebRTC (VoxFree)** |
| Botão "Ligar" | `TasksPanel` (canal "Ligação") e `LeadsPage` — preferem o webfone se houver ramal |

## Segurança da senha SIP

No WebRTC o navegador **precisa** ter a senha do ramal pra registrar — não tem como
evitar. Por isso cada credencial vive em `qs_sip_lines` com **RLS por dono**: o SDR
lê só a linha dele (`auth.uid() = user_id`); admin/gestor gerencia todas. A senha
nunca vai pro bundle nem fica legível por outro SDR. Config não-secreta (WSS/domínio)
fica em `qs_settings`.

## Passo a passo (setup)

**1. Aplicar a migration** (SQL Editor do Supabase, projeto `eabfjomrnucymduqnbci`):
cole `supabase/migrations/0013_sip_lines.sql` e rode. Cria a tabela `qs_sip_lines`
com RLS. Idempotente.

**2. Config compartilhada** — Config → **Webfone WebRTC (VoxFree)** → "Servidor":
- URL do WebSocket (WSS): `wss://box49.voxfree.com:5080`
- Domínio / Registrar: `box49.voxfree.com`
- Prefixo de rota: deixe **vazio** (ajuste só se o VoxFree pedir um prefixo de saída)
- Salvar servidor.

**3. Ramal por SDR** — na mesma tela, seção "Ramais por SDR": para cada SDR preencha
o **ramal (auth user)** e a **senha SIP** e salve. Ex. de ramal: `2272_2001`
(a senha é a que o VoxFree entregou para aquele ramal — nunca comitada aqui).

**4. Testar** — logado como esse SDR, abra um lead e clique **Ligar** no canal
"Ligação". O navegador vai pedir permissão do **microfone** (aceite). O widget
aparece no canto: "Conectando" → "Chamando" → "Em ligação" (com cronômetro).

### Alternativa rápida (bootstrap por SQL)

Em vez dos passos 2 e 3 pela tela, dá pra colar isto no SQL Editor (troque o e-mail
pelo do seu login no QS):

```sql
-- config compartilhada
insert into qs_settings(key, value) values
  ('sip_ws_url',    '"wss://box49.voxfree.com:5080"'::jsonb),
  ('sip_ws_domain', '"box49.voxfree.com"'::jsonb),
  ('sip_ws_prefix', '""'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- o SEU ramal (o user_id vem do qs_users pelo e-mail de login).
-- Troque RAMAL e SENHA pelos dados que o VoxFree entregou (NÃO comite este SQL preenchido).
insert into qs_sip_lines(user_id, auth_user, password, display_name, active)
select id, 'SEU-RAMAL', 'SUA-SENHA-SIP', name, true
  from qs_users where email = 'SEU-EMAIL-DE-LOGIN'
on conflict (user_id) do update
  set auth_user = excluded.auth_user, password = excluded.password,
      active = true, updated_at = now();
```

## Pendências / o que pode faltar

- **TURN**: o VoxFree não mandou servidor TURN. Na maioria das redes funciona sem
  (o `box49` público faz o relay do áudio — foi por isso que funcionou no
  `tryit.jssip.net`). Se em alguma rede a chamada **conectar mas o áudio ficar mudo**,
  peça o `turn:` + usuário/senha ao VoxFree e a gente adiciona em `pcConfig.iceServers`
  no `webphone.ts`.
- **Formato de discagem**: hoje o alvo é `sip:<prefixo><numero-E.164>@box49.voxfree.com`.
  Se o VoxFree exigir outro formato (sem 55, com 0 na frente, etc.), ajuste o
  **prefixo** na config ou avise pra adaptar a normalização.
- **Ramais dos outros SDRs**: só recebi o `2272_2001`. Os demais (2002/2003) precisam
  do ramal + senha de cada um pra preencher na tela.
- **Recepção de chamadas** (inbound) não está ligada — hoje é só saída (o SDR liga).
