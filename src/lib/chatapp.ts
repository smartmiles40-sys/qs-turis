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
  // Autoriza como usuário logado do QS (a rota valida o JWT no Supabase Auth).
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { supabase } = await import('./supabase');
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers['Authorization'] = `Bearer ${data.session.access_token}`;
  } catch { /* sem sessão — a rota decide */ }

  try {
    const res = await fetch('/api/chatapp-send', {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
    return (await res.json()) as SendLeadMessageResult;
  } catch {
    return { success: false, error: 'Falha de rede ao chamar /api/chatapp-send' };
  }
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
