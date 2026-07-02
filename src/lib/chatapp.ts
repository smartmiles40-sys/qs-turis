// src/lib/chatapp.ts
// -----------------------------------------------------------------------------
// Wrapper do FRONT pra disparar mensagem a um lead.
// Ele NÃO fala com o ChatApp direto — chama a rota serverless /api/chatapp-send,
// que é quem guarda o token com segurança. Use isto no botão "Enviar mensagem".
// -----------------------------------------------------------------------------

export type SendLeadMessageInput = {
  /** Telefone do lead (com DDI/DDD, ex.: "5511999998888"). Pode ter máscara. */
  phone?: string;
  /** Alternativa ao phone: o chatId já resolvido (ex.: "5511...@c.us"). */
  chatId?: string;
  /** Texto da mensagem. */
  text: string;
};

export type SendLeadMessageResult =
  | { success: true; data: { chatId: string; result: unknown } }
  | { success: false; error: string; code?: string };

export async function sendLeadMessage(input: SendLeadMessageInput): Promise<SendLeadMessageResult> {
  const res = await fetch('/api/chatapp-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await res.json()) as SendLeadMessageResult;
}

/*
Exemplo de uso num componente (ex.: botão na ficha do lead):

  import { sendLeadMessage } from './lib/chatapp';

  async function handleSend() {
    const r = await sendLeadMessage({ phone: lead.telefone, text: 'Olá! ...' });
    if (r.success) alert('Mensagem enviada!');
    else alert('Erro: ' + r.error);
  }
*/
