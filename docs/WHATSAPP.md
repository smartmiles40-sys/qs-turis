# WhatsApp no QS Turis — o que dá pra fazer e como está montado

Pesquisa feita em **julho/2026** com fontes oficiais da Meta. Resumo da pergunta do Bruno:
_"dá pra cadastrar um número de WhatsApp e LIGAR dentro do sistema, sem número físico,
deixando o WhatsApp embutido e só aparecendo o ícone de ligação?"_

## Resposta curta

- **Mandar mensagem pelo sistema:** ✅ já funciona (via ChatApp, que você já usa). Está
  plugado na UI agora (botão de WhatsApp no lead, no painel de tarefas, etc.).
- **Ligar de verdade DENTRO do sistema (voz no navegador):** ✅ é **possível**, mas **não
  é grátis nem imediato** — exige a *WhatsApp Business Calling API* + um número registrado +
  verificação da Meta + construir um "softphone" WebRTC. É um projeto à parte (ver abaixo).
- **Não ter número nenhum:** ❌ **impossível**. Sempre existe um número registrado na conta
  WhatsApp Business (WABA). A boa notícia: **não precisa de chip/celular físico** — pode ser
  um número virtual/fixo, ele só precisa receber **um** código de verificação (SMS ou ligação)
  uma vez.
- **Embutir o WhatsApp Web num iframe dentro do sistema:** ❌ **bloqueado** pela Meta
  (header `Content-Security-Policy: frame-ancestors` só permite `*.whatsapp.com`) **e** proibido
  pelos Termos de Uso. Bibliotecas tipo `whatsapp-web.js`/Baileys automatizam o WhatsApp Web,
  **violam o ToS e arriscam banir o número** — não vamos por aí.

## O que está implementado agora (funciona hoje, custo zero)

Componente `src/components/sdr/whatsapp/WhatsAppModal.tsx` + `src/lib/whatsapp.ts`:

1. **Enviar pelo ChatApp** → abre o **cabinet do ChatApp em nova aba** e copia a mensagem
   para a área de transferência (é só colar na conversa do lead). Usamos a aba em vez da
   API do ChatApp porque **o token da API expira** — abrir o cabinet é o caminho estável.
   A URL é configurável por `VITE_CHATAPP_URL` no `.env`.
2. **WhatsApp** → link `wa.me` com a mensagem pré-preenchida (abre o app/WhatsApp Web do
   atendente). Alternativa rápida, sempre funciona.
3. **Ligar** → **abre a conversa** do lead; o botão de chamada do WhatsApp fica a 1 toque.
   Não existe link público que disque sozinho (`wa.me` só abre chat, nunca liga).

Cada interação é registrada em `qs_whatsapp_messages` (quem, quando, canal).

> A rota `/api/chatapp-send` e as variáveis `CHATAPP_*` (envio via API) ficaram sem uso por
> causa do token que expira. Os arquivos seguem no repo caso o ChatApp passe a oferecer
> token persistente no futuro.

## Se um dia quiser a ligação NATIVA dentro do sistema (roadmap)

Requisitos reais da *WhatsApp Business Calling API* (GA desde jul/2025, **funciona no
Brasil**, inbound e outbound):

1. **WABA** (conta WhatsApp Business) com **verificação de negócio** aprovada pela Meta.
2. **Um número registrado** na WABA (virtual serve; sem chip). Para outbound você precisa de
   limite de mensagens ≥ 2.000/24h e ativar "Calling" no WhatsApp Manager.
3. **Um BSP** que empacote isso. A Meta **não** entrega um "telefone" pronto nem SDK de
   navegador — ela só faz a sinalização (WebRTC/SIP); o cliente de voz é você que constrói.
   - Caminho mais curto para "atendente falando pelo navegador": **Twilio** (WhatsApp →
     Programmable Voice → *Voice JavaScript SDK*/Flex).
   - Alternativas empacotadas em PT-BR: **Zenvia** ou **Gupshup** (o atendente fala dentro
     da plataforma deles).
   - **ChatApp (atual) NÃO faz voz** — só mensagens.
4. **Custo:** chamada **recebida** (cliente liga) é grátis; chamada **feita** pela empresa é
   paga por minuto (tarifa varia por país/volume) e só cobra quando o cliente atende.

Resumindo o trade-off: a ligação nativa embutida é real e viável no Brasil, mas significa
WABA + verificação Meta + contratar um BSP (Twilio/Zenvia/Gupshup) + desenvolver o softphone.
Enquanto isso não acontece, o fluxo atual (mensagem pelo sistema + "ligar" abrindo o WhatsApp)
resolve o dia a dia sem custo e sem burocracia.

## Fontes principais
- Meta — Cloud API Calling: https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
- Meta — Requisitos de número: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers
- Meta — Click to chat (wa.me só abre chat): https://faq.whatsapp.com/5913398998672934/
- Twilio — WhatsApp Business Calling (GA): https://www.twilio.com/en-us/changelog/whatsapp_business_calling_available
- Integração WebRTC (bring-your-own-VoIP): https://webrtc.ventures/2025/11/how-to-integrate-the-whatsapp-business-calling-api-with-webrtc-to-enable-customer-voice-calls/
