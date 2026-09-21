# WhatsApp do SDR dentro do QS (21/09/2026)

Cada SDR tem um chip da empresa. Desde 03/09 o time trabalhava pelo WhatsApp Web,
fora do QS. Agora cada um **conecta o próprio número lendo o QR dentro do QS** e
as mensagens saem e chegam por aqui.

## Quem vê o quê

| Quem | Vê |
|---|---|
| SDR | só as conversas que passaram pelo **número dele** |
| Closer, gestor, admin | tudo |
| Outro SDR | nada do número dos colegas — nem se o lead for dele |

A regra mora no banco (RLS da migration `0082`), não na tela.

## Como o SDR conecta (1 minuto)

1. Aba **WhatsApp** → botão **Meu WhatsApp** (canto de cima).
2. **Conectar meu WhatsApp** → aparece o QR.
3. No celular com o chip da empresa: WhatsApp → Configurações → **Aparelhos
   conectados** → Conectar um aparelho → aponta pro QR.
4. A tela muda sozinha pra "conectado". Pronto: o campo de escrever volta nas
   conversas e tudo sai pelo número dele.
5. (Uma vez) **Importar conversas antigas** — traz o que foi falado com **leads**
   pelo WhatsApp Web nos últimos 45 dias. Pode repetir; nada duplica.

O celular e o WhatsApp Web continuam funcionando: o QS é mais um aparelho conectado.

## Como funciona por dentro

```
SDR escreve no QS → /api/wa-send → Evolution (instância do SDR) → WhatsApp do cliente
Cliente responde  → Evolution → /api/wa-evolution-webhook → qs_wa_messages (linha_user_id = SDR)
```

- **Sem Chatwoot** nos números dos SDRs. Foi o caminho Chatwoot→QS que morreu em
  02/09 sem ninguém perceber.
- A instância é criada pelo próprio QS (`qs-<nome>-<id>`), já com o webhook
  apontado pra cá. Ninguém precisa abrir o Manager da Evolution.
- Mensagem mandada **pelo celular** também entra no QS e fecha a atividade.
- Quem escreve pro número do SDR e não é lead: o QS pergunta ao Bitrix (regra de
  sempre) e cria o lead **como sendo desse SDR**. Se o Bitrix estiver fora, vai
  pra triagem ("N sem lead"), que o próprio SDR pode tratar.
- **Ligação continua pelo celular**: número conectado por QR não faz chamada de
  voz. Só a mensagem voltou pro QS.
- Modelo (template da Meta) e o número oficial continuam iguais: é só escolher o
  número oficial no topo da conversa.

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/0082_whatsapp_do_sdr.sql` | `qs_wa_linhas`, `linha_user_id`, RLS, `qs_wa_ingest_linha`, bucket `wa-midia` |
| `api/wa-linha.js` | conectar / estado / desconectar / importar histórico |
| `api/_waLinha.js` | Evolution: instância, leitura da mensagem (`@lid`), mídia |
| `api/_waLinhaEntrada.js` | gravar o que chega (ao vivo e histórico) |
| `api/_waLinhaEnvio.js` | enviar texto e arquivo pelo número do SDR |
| `api/_waNascimento.js` | "quem não é lead escreveu" — compartilhado com o webhook do Chatwoot |
| `src/components/sdr/wa/MeuWhatsApp.tsx` | a tela do QR |
| `src/lib/qs/waLinha.ts` | estado da linha, compartilhado pelo app |

## Riscos conhecidos

- **Bloqueio do chip**: conexão por QR não é a API oficial. Disparo em massa
  pra quem nunca falou com o número pode fazer o WhatsApp banir o chip. O envio
  continua sendo sempre um clique do SDR.
- **Prévia na lista**: se um lead de um SDR conversar pelo número de OUTRO SDR, o
  dono do lead vê a conversa na lista (com a prévia da última mensagem), mas não
  abre as mensagens. Caso raro (lead trocou de dono).
