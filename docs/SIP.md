# Ligação por SIP (2ª forma de contato) — QS Turis

Pesquisa/decisão de **julho/2026**. Complementa `docs/WHATSAPP.md` e a integração do
**Webfone (Wavoip)**.

## Resumo

A Wavoip oferece **dois** jeitos de fazer/receber a mesma chamada de voz do WhatsApp:

1. **Webfone (Wavoip)** — roda **dentro do CRM**, no navegador. Conecta por um **token**
   de dispositivo. Já está integrado (Configurações → Webfone). É o caminho principal.
2. **SIP** — conecta por um **tronco SIP** (`sipv2.wavoip.com`) com **usuário + senha**.
   Serve para **softphone de computador** (MicroSIP, Zoiper) ou central (FreePBX).

> ⚠️ **Por que o SIP não roda dentro do navegador?** O navegador só fala SIP por
> **WebSocket seguro (WSS)** + WebRTC. A Wavoip **não expõe WSS** (só UDP/TCP para
> PBX/softphone — confirmado na doc e testando as portas). Então, para o SIP, quem
> disca é um **softphone instalado no PC**. O CRM entra como "click-to-dial": o botão
> **"Ligar (SIP)"** no lead abre o softphone já com o número (link `sip:`), igual ao `tel:`.

## Credenciais

Ficam em **Configurações → Telefone (SIP)** (guardadas no banco, campo mascarado). Peça
ao painel da Wavoip / ao Bruno:

| Campo      | Valor                     |
| ---------- | ------------------------- |
| Servidor   | `sipv2.wavoip.com`        |
| Usuário    | _(usuário SIP)_           |
| Senha      | _(senha SIP)_             |

O **CallerID** deve ser o número de WhatsApp conectado no dispositivo (senão dá 404 na
autenticação). Alternativa: usar o **token do dispositivo** como usuário = senha = CallerID.

## Instalar o softphone (Windows — MicroSIP)

1. Baixe o **MicroSIP** (portable ou instalador): https://www.microsip.org/
2. Abra → **Menu (≡) → Add Account** e preencha:
   - **Account name:** Wavoip
   - **SIP Server / Domain:** `sipv2.wavoip.com`
   - **Username:** _(usuário SIP)_
   - **Login / Auth ID:** _(mesmo usuário)_
   - **Password:** _(senha SIP)_
   - **Display name:** seu nome / o número conectado
   - **Transport:** UDP (ou TCP, se a Wavoip pedir)
3. Salve. No rodapé deve aparecer **"Online"/registrado**. Se der erro de registro,
   confira usuário/senha e o transporte.
4. Teste discando um número (com DDI, ex. `5511999998888`).

> **Zoiper** (Windows/Mac/Android/iOS): _Settings → Accounts → Add → SIP_, mesmos campos
> (Domain = `sipv2.wavoip.com`, user, senha). Útil se o SDR quiser atender pelo celular.

## Ligar a partir do CRM (click-to-dial)

1. Instale e registre o softphone (acima).
2. Deixe o softphone ser o **app padrão para links `sip:`** (o MicroSIP registra sozinho;
   no Windows dá pra confirmar em _Aplicativos padrão → Escolher padrões por protocolo_).
3. No CRM, ligue o botão em **Configurações → Telefone (SIP) → "Mostrar botão Ligar (SIP)"**.
4. No lead (modal de WhatsApp), clique **"Ligar (SIP / telefone)"** → o navegador entrega o
   número ao softphone, que disca. A ligação é registrada em `qs_whatsapp_messages` (kind `call`).

## Como está no código

- `src/lib/sip.ts` — `dialViaSip(phone)` monta `sip:<e164>@<host>` e abre o handler do SO;
  `isSipEnabled()` / `getSipHost()` leem de `qs_settings` (`sip_enabled`, `sip_host`, `sip_user`, `sip_password`).
- `WhatsAppModal.tsx` — botão "Ligar (SIP / telefone)" (aparece só com `sip_enabled = true`).
- `SettingsPage.tsx` — seção **Telefone (SIP)** (toggle + servidor + usuário/senha de referência).

## Quer o SIP DENTRO do navegador mesmo?

Só é possível se a Wavoip fornecer um **endpoint WSS** (WebSocket) para o tronco. Se
conseguir esse endereço com o suporte deles (algo como `wss://.../ws`), dá para trocar o
click-to-dial por um softphone WebRTC embutido (JsSIP/SIP.js) e ligar sem instalar nada.
Hoje esse endpoint não existe/não é documentado.
