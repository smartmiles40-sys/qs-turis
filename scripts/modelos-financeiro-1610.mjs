// scripts/modelos-financeiro-1610.mjs
// -----------------------------------------------------------------------------
// Modelos do FINANCEIRO (Giovana) pedidos pelo Bruno em 16/10/2026 — enviados
// pra aprovação da Meta no número do Relacionamento (o Financeiro fala por ele).
// Cada [campo] do texto virou {{n}}; o que é cada {{n}} vai pra
// qs_wa_modelo_campos (a tela de envio mostra e exige o preenchimento).
// Prefixo fin_ = só aparece pro Financeiro.
//
// Uso: node scripts/modelos-financeiro-1610.mjs [--status]
// -----------------------------------------------------------------------------
import fs from 'node:fs';

for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const { criarModelo, credenciaisDaMeta } = await import('../api/_meta.js');
const { rest } = await import('../api/_supabaseAdmin.js');
const PHONE_REL = '1137920506076262';

const MODELOS = [
  {
    nome: 'fin_boas_vindas_pagamento',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nAqui é a Giovana, do financeiro da Se Tu For, Eu Vou. Que alegria ter você com a gente na expedição {{2}}!\n\nEstou passando para organizarmos juntos(as) o pagamento da sua viagem, no valor total de R$ {{3}}. Como você prefere pagar?\n\n• Pix à vista\n• Cartão de crédito por link, em até {{4}}x\n• Entrada + parcelas mensais, com quitação até {{5}}\n\nMe conta o que fica mais confortável pra você, e eu já preparo tudo por aqui.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Destino da expedição (ex.: Japão e China)', 3: 'Valor total (ex.: 38.996,00)', 4: 'Número máximo de parcelas no cartão (ex.: 12)', 5: 'Data limite para quitar (ex.: 10/12/2026)' },
    exemplos: ['Maria', 'Japão e China', '38.996,00', '12', '10/12/2026'],
  },
  {
    nome: 'fin_contrato_reenviado',
    corpo: 'Olá, {{1}}! Tudo bem? 😊\n\nReenviamos o link do seu contrato por e-mail. Quando tiver um tempinho, você consegue assinar? Qualquer dificuldade, é só nos avisar que te ajudamos por aqui! 🙏',
    campos: { 1: 'Primeiro nome do cliente' },
    exemplos: ['Maria'],
  },
  {
    nome: 'fin_confirmar_link_pagamento',
    corpo: 'Olá, {{1}}! Tudo bem? 😊\nEu sou a Giovana e faço parte do financeiro aqui da Se Tu For, Eu Vou!\nPassando para confirmar se você recebeu o link para pagamento da sua viagem {{2}}. Qualquer dúvida sobre o valor ou a forma de pagamento, é só me chamar!\n\nAguardo seu retorno. 🙏',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Destino com "para" (ex.: para o Japão)' },
    exemplos: ['Maria', 'para o Japão'],
  },
  {
    nome: 'fin_quitacao_confirmar_pagamento',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nPassando aqui pra saber se você recebeu minhas mensagens sobre a quitação da sua viagem para {{2}} e se conseguiu realizar o pagamento pelo link.\n\nSe tiver qualquer dúvida ou dificuldade com o link, me conta que eu te ajudo a resolver por aqui mesmo.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Destino da viagem (ex.: o Japão)' },
    exemplos: ['Maria', 'o Japão'],
  },
  {
    nome: 'fin_quitacao_antes_embarque',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nFaltam poucos dias para a expedição {{2}}, que emoção! Estou passando para deixarmos o último detalhe financeiro resolvido: ainda consta R$ {{3}} para a quitação.\n\nPara você embarcar tranquilo(a), o ideal é concluirmos até {{4}}. Te deixo o link aqui:\n{{5}}\n\nSe tiver qualquer dificuldade, me conta hoje que eu resolvo com você.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Destino da expedição (ex.: Japão e China)', 3: 'Valor que falta (ex.: 4.500,00)', 4: 'Data limite (ex.: 20/10)', 5: 'Link de pagamento' },
    exemplos: ['Maria', 'Japão e China', '4.500,00', '20/10', 'https://pay.setuforeuvouviagens.com.br/link'],
  },
  {
    nome: 'fin_parcelas_antecipadas_link',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nRestam {{2}} parcelas: {{3}}.\n\nComo a quitação é concluída antes do embarque, as parcelas de {{4}} ficam antecipadas para até o início da viagem.\n\nPra facilitar, a parcela de {{5}} segue normalmente na cobrança recorrente, do jeitinho que já está. E para essas parcelas antecipadas, eu te envio um link único, que você pode parcelar em {{6}}x no cartão. Pode ser assim?',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Quantas parcelas restam (ex.: 3)', 3: 'Meses das parcelas (ex.: outubro, novembro e dezembro)', 4: 'Meses antecipados (ex.: novembro e dezembro)', 5: 'Mês que segue no recorrente (ex.: outubro)', 6: 'Em quantas vezes o link pode ser parcelado (ex.: 2)' },
    exemplos: ['Maria', '3', 'outubro, novembro e dezembro', 'novembro e dezembro', 'outubro', '2'],
  },
  {
    nome: 'fin_quitacao_valor_residual',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nAqui é a Giovana, do financeiro da Se Tu For, Eu Vou. Sua viagem está chegando e estou passando para deixarmos tudo certinho antes do embarque.\n\nO valor residual para a quitação da viagem é de R$ {{2}}. Como você prefere fazer esse pagamento? Pode ser via Pix ou por link no cartão de crédito, e assim que você me falar eu já te envio tudo por aqui.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Valor residual (ex.: 2.300,00)' },
    exemplos: ['Maria', '2.300,00'],
  },
  {
    nome: 'fin_antecipacao_parcelas_meses',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nAqui é a Giovana, do financeiro da Se Tu For, Eu Vou. Sua expedição para {{2}} está chegando, e a gente fica muito feliz de fazer parte desse momento com você!\n\nConforme alinhado com o time comercial, a quitação da viagem é concluída antes do embarque. Por isso, a(s) parcela(s) de {{3}} serão antecipadas para que tudo fique certinho até a data da expedição.\n\nPosso te enviar o link para pagamento até {{4}}? Qualquer dúvida, é só me chamar que te ajudo.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Destino da expedição, com artigo (ex.: o Japão e a China)', 3: 'Mês(es) antecipado(s) (ex.: novembro e dezembro)', 4: 'Até quando você manda o link (ex.: sexta-feira, 24/10)' },
    exemplos: ['Maria', 'o Japão e a China', 'novembro e dezembro', 'sexta-feira, 24/10'],
  },
  {
    nome: 'fin_parcela_em_aberto_retomada',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nRetomando aqui a mensagem sobre a parcela de {{2}}, de R$ {{3}}, que segue em aberto.\n\nQuero muito te ajudar a deixar tudo organizado para a expedição {{4}}. Consegue me dizer até quando prefere fazer o pagamento? Se for melhor, posso te enviar o link de novo ou outra forma de pagamento.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Mês da parcela (ex.: outubro)', 3: 'Valor da parcela (ex.: 1.250,00)', 4: 'Destino da expedição (ex.: Japão e China)' },
    exemplos: ['Maria', 'outubro', '1.250,00', 'Japão e China'],
  },
  {
    nome: 'fin_parcela_pendente_link',
    corpo: 'Oi, {{1}}! Tudo bem? 😊\n\nPassando pra lembrar que a parcela de {{2}} da sua expedição {{3}}, no valor de R$ {{4}}, está pendente.\n\nO link de pagamento é este:\n{{5}}\n\nSe precisar de qualquer ajuda, é só me chamar.',
    campos: { 1: 'Primeiro nome do cliente', 2: 'Mês da parcela (ex.: outubro)', 3: 'Destino da expedição (ex.: Japão e China)', 4: 'Valor da parcela (ex.: 1.250,00)', 5: 'Link de pagamento' },
    exemplos: ['Maria', 'outubro', 'Japão e China', '1.250,00', 'https://pay.setuforeuvouviagens.com.br/link'],
  },
];

if (process.argv.includes('--status')) {
  const cr = await credenciaisDaMeta(PHONE_REL);
  const r = await fetch(`https://graph.facebook.com/v21.0/${cr.waba}/message_templates?fields=name,status,category,rejected_reason&limit=250`, { headers: { Authorization: `Bearer ${cr.token}` } });
  const j = await r.json();
  const nomes = new Set(MODELOS.map((m) => m.nome));
  for (const t of (j.data || []).filter((x) => nomes.has(x.name))) console.log(t.status.padEnd(9), t.category.padEnd(10), t.name, t.rejected_reason && t.rejected_reason !== 'NONE' ? `| ${t.rejected_reason}` : '');
  process.exit(0);
}

for (const m of MODELOS) {
  const r = await criarModelo({ nome: m.nome, categoria: 'UTILITY', idioma: 'pt_BR', corpo: m.corpo, exemplos: m.exemplos, phoneId: PHONE_REL });
  console.log(m.nome.padEnd(34), r.ok ? `enviado (${r.status})` : `ERRO ${r.erro}: ${r.mensagem || ''}`);
  await rest('qs_wa_modelo_campos?on_conflict=nome', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { nome: m.nome, campos: Object.fromEntries(Object.entries(m.campos).map(([k, v]) => [String(k), v])) },
  }).catch((e) => console.log('   campos:', e.message));
}
