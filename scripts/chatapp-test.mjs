// scripts/chatapp-test.mjs
// -----------------------------------------------------------------------------
// Runner LOCAL pra "ver o resultado" sem subir nada na Vercel.
// Ele usa o MESMO código de api/_chatapp.js, então o que passar aqui, passa lá.
//
// Uso:
//   node scripts/chatapp-test.mjs                          -> diagnóstico + ping
//   node scripts/chatapp-test.mjs --to 5511999998888 --text "Olá do QS Turis"
//
// Carrega variáveis de: .env e (se existir) .env.chatapp.local  na raiz do projeto.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --- mini carregador de .env (sem dependências) ---
function loadEnv(file) {
  const p = resolve(ROOT, file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv('.env');
loadEnv('.env.chatapp.local');

// Importa DEPOIS de carregar o env (o módulo lê process.env).
const { getAccessToken, sendMessageToLead, resolveChatId, BASE_URL } = await import('../api/_chatapp.js');

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const to = getArg('to');
const text = getArg('text') || 'Mensagem de teste do QS Turis ✅';

const mask = (v) => (v ? v.slice(0, 3) + '***' : '(vazio)');
const need = ['CHATAPP_EMAIL', 'CHATAPP_PASSWORD', 'CHATAPP_APP_ID', 'CHATAPP_LICENSE_ID'];
const hasCreds = need.every((k) => process.env[k]);

console.log('== ChatApp • diagnóstico ==');
console.log('BASE_URL         :', BASE_URL);
console.log('CHATAPP_EMAIL    :', mask(process.env.CHATAPP_EMAIL));
console.log('CHATAPP_APP_ID   :', process.env.CHATAPP_APP_ID || '(vazio)');
console.log('CHATAPP_LICENSE_ID:', process.env.CHATAPP_LICENSE_ID || '(vazio)');
console.log('CHATAPP_MESSENGER:', process.env.CHATAPP_MESSENGER || 'grWhatsApp (default)');
console.log('Credenciais completas?', hasCreds ? 'SIM' : 'NÃO');
console.log('');

// 1) Conectividade crua (funciona mesmo sem credenciais)
console.log('== 1) Ping de conectividade (POST /v1/tokens) ==');
try {
  const r = await fetch(`${BASE_URL}/v1/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ping@example.com', password: 'x', appId: '1' }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`HTTP ${r.status} ->`, JSON.stringify(j));
  console.log('OK: a API respondeu (envelope { success, error } confirmado).');
} catch (e) {
  console.log('FALHOU o ping:', e.message);
}
console.log('');

if (!hasCreds) {
  console.log('== 2) Fluxo real: PULADO ==');
  console.log('Preencha .env.chatapp.local (veja .env.chatapp.example) com as');
  console.log('credenciais reais pra autenticar e enviar de verdade.');
  process.exit(0);
}

// 2) Autenticação real
console.log('== 2) Autenticação (POST /v1/tokens) ==');
try {
  const token = await getAccessToken();
  console.log('OK. accessToken:', token.slice(0, 8) + '…');
} catch (e) {
  console.log('FALHOU:', e.code || '', e.message);
  process.exit(1);
}
console.log('');

// 3) Envio real (só se passar --to)
if (!to) {
  console.log('== 3) Envio: PULADO (rode com --to <telefone> pra enviar) ==');
  process.exit(0);
}
console.log(`== 3) Enviando para ${to} ==`);
try {
  const chatId = await resolveChatId(to);
  console.log('chatId resolvido:', chatId);
  const out = await sendMessageToLead({ chatId, text });
  console.log('ENVIADO ✅:', JSON.stringify(out.result));
} catch (e) {
  console.log('FALHOU:', e.code || '', e.message);
  process.exit(1);
}
