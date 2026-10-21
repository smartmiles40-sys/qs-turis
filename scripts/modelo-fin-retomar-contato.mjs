// scripts/modelo-fin-retomar-contato.mjs
// Modelo do Financeiro pedido pelo Bruno em 19/10/2026 (texto dele, sem campos).
// Uso: node scripts/modelo-fin-retomar-contato.mjs [--status]
import fs from 'node:fs';

for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const { criarModelo, listarModelos } = await import('../api/_meta.js');
const PHONE_REL = '1137920506076262';
const NOME = 'fin_retomar_contato';

const atual = (await listarModelos(PHONE_REL)).modelos?.find((m) => m.nome === NOME);
if (atual || process.argv.includes('--status')) {
  console.log(atual ? `${NOME}: ${atual.status} ${atual.categoria}${atual.motivo ? ` | ${atual.motivo}` : ''}` : `${NOME}: não existe`);
  process.exit(0);
}
const r = await criarModelo({
  nome: NOME, categoria: 'UTILITY', idioma: 'pt_BR',
  corpo: 'Olá, tudo bem?\n\nEstou aqui para retomar seu contato!',
  phoneId: PHONE_REL,
});
console.log(NOME, r.ok ? `enviado (${r.status})` : `ERRO ${r.erro}: ${r.mensagem || ''}`);
