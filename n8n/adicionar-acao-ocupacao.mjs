// n8n/adicionar-acao-ocupacao.mjs
// ---------------------------------------------------------------------------
// Acrescenta a ação `ocupacao` (freeBusy do Google) ao workflow da agenda.
//
// POR QUE UM SCRIPT E NÃO UM JSON NOVO À MÃO: o workflow tem 15 nós, conexões
// nomeadas e a credencial do Google amarrada por id. Reescrevê-lo à mão é o
// jeito mais rápido de perder a credencial ou trocar um fio de lugar sem
// perceber. Aqui só se ACRESCENTA — nada existente é reescrito, e o script
// recusa rodar duas vezes.
//
//   node n8n/adicionar-acao-ocupacao.mjs
//   -> escreve n8n/qs-agenda-meet.COM-OCUPACAO.workflow.json
//
// Depois: importar esse arquivo no n8n (Import from File), conferir que a
// credencial "Google Calendar account" continua ligada nos 4 nós HTTP, e
// ativar. O QS já sabe chamar — enquanto o workflow antigo estiver no ar, ele
// responde "acao invalida" e o QS segue com a agenda só do banco.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const origem = path.join(aqui, 'qs-agenda-meet.workflow.json');
const destino = path.join(aqui, 'qs-agenda-meet.COM-OCUPACAO.workflow.json');

const w = JSON.parse(fs.readFileSync(origem, 'utf8'));
const no = (nome) => w.nodes.find((n) => n.name === nome);

if (no('Consultar freeBusy no Google')) {
  console.error('Este workflow JA tem a acao ocupacao. Nada a fazer.');
  process.exit(1);
}

// ── (1) A validação aceita a ação nova ─────────────────────────────────────
// `ocupacao` não tem meeting_id nem evento: ela pergunta, não escreve.
const validar = no('Validar entrada1');
const antes = validar.parameters.jsCode;

const trocas = [
  [
    "if (!b.meeting_id) erros.push('meeting_id ausente');\nif (!['criar', 'reagendar', 'cancelar'].includes(acao)) erros.push('acao invalida: ' + acao);",
    `// 'ocupacao' NAO escreve nada: ela so pergunta ao Google quem esta ocupado.
// Por isso e a unica que nao exige meeting_id.
if (acao !== 'ocupacao' && !b.meeting_id) erros.push('meeting_id ausente');
if (!['criar', 'reagendar', 'cancelar', 'ocupacao'].includes(acao)) erros.push('acao invalida: ' + acao);

if (acao === 'ocupacao') {
  if (!b.de) erros.push('de ausente');
  if (!b.ate) erros.push('ate ausente');
  if (b.de && b.ate && new Date(b.ate) <= new Date(b.de)) erros.push('ate menor ou igual a de');
  if (!Array.isArray(b.emails) || !b.emails.length) erros.push('emails ausente');
}`,
  ],
  [
    "  convidados,\n  convidados_descartados: descartados\n} }];",
    `  convidados,
  convidados_descartados: descartados,
  // Campos da acao 'ocupacao'. E-mail malformado e descartado aqui pelo mesmo
  // motivo dos convidados: um endereco torto faz o freeBusy inteiro voltar 400.
  de: b.de || null,
  ate: b.ate || null,
  emails: (Array.isArray(b.emails) ? b.emails : [])
    .map((e) => String(e || '').trim())
    .filter((e) => EMAIL.test(e))
} }];`,
  ],
];

for (const [de, para] of trocas) {
  if (!antes.includes(de)) {
    console.error('NAO ACHEI no Validar entrada1:\n' + de.slice(0, 120));
    process.exit(1);
  }
}
validar.parameters.jsCode = trocas.reduce((s, [de, para]) => s.replace(de, para), antes);

// ── (2) O switch ganha a saída nova ────────────────────────────────────────
// Entra ANTES do fallback, então o fallback continua sendo o último output.
const roteador = no('Rotear acao1');
const modelo = roteador.parameters.rules.values[0];
roteador.parameters.rules.values.push({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [
      {
        id: 'r-ocupacao',
        leftValue: '={{ $json.acao }}',
        rightValue: 'ocupacao',
        operator: { type: 'string', operation: 'equals' },
      },
    ],
    combinator: 'and',
  },
  renameOutput: true,
  outputKey: 'ocupacao',
});
void modelo;

// ── (3) A pergunta ao Google ───────────────────────────────────────────────
// freeBusy, e nao a listagem de eventos: devolve so intervalos ocupado/livre,
// sem titulo, sem convidado, sem descricao. A agenda pessoal de quem trabalha
// aqui nao precisa passar pelo nosso servidor pra gente saber que as 15h tem
// alguem ocupado.
const httpModelo = no('Criar evento no Google');
w.nodes.push({
  parameters: {
    method: 'POST',
    url: 'https://www.googleapis.com/calendar/v3/freeBusy',
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleCalendarOAuth2Api',
    sendBody: true,
    specifyBody: 'json',
    jsonBody:
      '={{ JSON.stringify({ timeMin: $json.de, timeMax: $json.ate, timeZone: $json.timezone, items: $json.emails.map(function (e) { return { id: e }; }) }) }}',
    options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 10000 },
  },
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: httpModelo.typeVersion,
  position: [6096, 3400],
  id: 'qs-freebusy-http',
  name: 'Consultar freeBusy no Google',
  credentials: httpModelo.credentials,
});

// ── (4) A resposta pro QS ──────────────────────────────────────────────────
w.nodes.push({
  parameters: {
    jsCode: `// Traduz a resposta do freeBusy pro formato que o QS espera.
//
// FALHA ABERTA POR AGENDA, de proposito: se o Google recusar UMA agenda (o
// closer nao compartilhou o livre/ocupado com a conta da operacao, por
// exemplo), aquela pessoa sai da resposta em vez de derrubar a consulta
// inteira. Tratar "nao sei" como "ocupado o dia todo" esvaziaria a grade e
// mataria o agendamento; tratar como "livre" so devolve o comportamento que
// existia antes desta acao. O motivo vai em \`avisos\` pra aparecer no log do QS.
const r = $input.first().json;
const d = $('Validar entrada1').first().json;
const status = r.statusCode;

if (status < 200 || status >= 300) {
  const e = r.body && r.body.error;
  return [{ json: {
    ok: false,
    acao: 'ocupacao',
    codigo: status,
    erro: (e && (e.message || e.status)) || ('HTTP ' + status)
  } }];
}

const calendarios = (r.body && r.body.calendars) || {};
const ocupado = {};
const avisos = [];

for (const email of d.emails) {
  const c = calendarios[email];
  if (!c) { avisos.push(email + ': o Google nao devolveu esta agenda'); continue; }
  if (Array.isArray(c.errors) && c.errors.length) {
    avisos.push(email + ': ' + c.errors.map(function (x) { return x.reason; }).join(', '));
    continue;
  }
  ocupado[email] = (c.busy || []).map(function (b) {
    return { inicio: b.start, fim: b.end };
  });
}

return [{ json: {
  ok: true,
  acao: 'ocupacao',
  de: d.de,
  ate: d.ate,
  ocupado,
  avisos
} }];`,
  },
  type: 'n8n-nodes-base.code',
  typeVersion: no('Responder cancelamento1').typeVersion,
  position: [6272, 3400],
  id: 'qs-freebusy-resposta',
  name: 'Responder ocupacao',
});

// ── (5) Os fios ────────────────────────────────────────────────────────────
// O switch agora tem 5 saidas: criar, reagendar, cancelar, ocupacao, fallback.
// A do fallback estava em 3 e passa pra 4 — se isso ficar errado, payload
// invalido cai no freeBusy e vice-versa.
const c = w.connections['Rotear acao1'].main;
const fallback = c.pop();
c.push([{ node: 'Consultar freeBusy no Google', type: 'main', index: 0 }]);
c.push(fallback);

w.connections['Consultar freeBusy no Google'] = {
  main: [[{ node: 'Responder ocupacao', type: 'main', index: 0 }]],
};

fs.writeFileSync(destino, JSON.stringify(w, null, 2));

// ── Conferencia ────────────────────────────────────────────────────────────
const saidas = w.connections['Rotear acao1'].main.map((s) => s[0].node);
console.log('escrito:', path.basename(destino));
console.log('nos:', w.nodes.length, '(eram', w.nodes.length - 2 + ')');
console.log('saidas do switch, em ordem:');
saidas.forEach((n, i) => console.log('  ' + i + ' ->', n));
console.log('a ultima TEM que ser "Responder payload invalido1":',
  saidas[saidas.length - 1] === 'Responder payload invalido1' ? 'OK' : 'ERRADO');
