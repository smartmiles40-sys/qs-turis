// Saída QS → Bitrix sem n8n (api/_bitrixSaidaRegras.js): montagem do ganho, da
// reunião e do catálogo, sem rede. Os casos espelham o que os nós Code do
// n8n/qs-bitrix-completo.workflow.json faziam.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../api/_bitrixSaidaRegras.js";

const CATALOGO = R.montarCatalogo(
  [
    { alias: "email_cliente", field_name: "UF_EMAIL" },
    { alias: "data_agendamento", field_name: "UF_DATA" },
    { alias: "datahora_meet", field_name: "UF_MEET" },
    { alias: "link_meet", field_name: "UF_LINK" },
    { alias: "produto_reuniao", field_name: "UF_PROD" },
    { alias: "sdr_agendou", field_name: "UF_SDR" },
    { alias: "resp_reuniao", field_name: "UF_RESP" },
    { alias: null, field_name: "UF_SEM_APELIDO" },
  ],
  [
    { alias: "sdr_agendou", option_id: "10", value: "Victor Hugo - SDR" },
    { alias: "sdr_agendou", option_id: "11", value: "Yanca Manuella" },
    { alias: "resp_reuniao", option_id: "20", value: "Victor Maldonado - Closer" },
    { alias: "resp_reuniao", option_id: "21", value: "Talita Carvalho - Closer" },
  ]
);

test("ganho: sem valor só comenta; não muda coluna (STAGE_GANHO vazio como no n8n)", () => {
  const g = R.montarGanho({ bitrixId: "123", closedValue: null, fullName: "Ana" });
  assert.equal(g.id, 123);
  assert.equal(g.mexeNoCard, false);
  assert.deepEqual(g.fields, {});
  assert.equal(g.comentario, "🏆 Lead marcado como GANHO no QS.\nValor fechado: não informado\nLead: Ana");
  assert.equal(R.ETAPA_GANHO, "");
});

test("ganho: valor positivo vira OPPORTUNITY; zero/vazio não", () => {
  const g = R.montarGanho({ bitrixId: 9, closedValue: "35000" });
  assert.deepEqual(g.fields, { OPPORTUNITY: 35000 });
  assert.equal(g.mexeNoCard, true);
  assert.match(g.comentario, /Valor fechado: R\$ 35\.000/);
  assert.equal(R.montarGanho({ bitrixId: 9, closedValue: 0 }).mexeNoCard, false);
  assert.equal(R.montarGanho({ bitrixId: 9, closedValue: "" }).mexeNoCard, false);
  assert.equal(R.montarGanho({ bitrixId: null, closedValue: 10 }), null);
});

test("ganho: com etapa configurada, STAGE_ID vai junto", () => {
  const g = R.montarGanho({ bitrixId: 1, closedValue: 10 }, "WON");
  assert.deepEqual(g.fields, { STAGE_ID: "WON", OPPORTUNITY: 10 });
});

test("brt: UTC vira -03:00 fixo; soData aceita data pura", () => {
  assert.equal(R.brt("2026-11-03T13:30:00Z"), "2026-11-03T10:30:00-03:00");
  assert.equal(R.brt("2026-11-03T01:00:00Z"), "2026-11-02T22:00:00-03:00");
  assert.equal(R.brt(null), null);
  assert.equal(R.brt("lixo"), null);
  assert.equal(R.soData("2026-11-03"), "2026-11-03");
  assert.equal(R.soData("2026-11-03T01:00:00Z"), "2026-11-02");
  assert.equal(R.soData(null), null);
});

test("acharOpcao: nunca credita a pessoa errada pelo primeiro nome", () => {
  const sdr = CATALOGO.opcoes.sdr_agendou;
  const resp = CATALOGO.opcoes.resp_reuniao;
  assert.equal(R.acharOpcao(sdr, "Victor Hugo"), 10);                  // rótulo começa com o nome
  assert.equal(R.acharOpcao(sdr, "Yanca Manuella Ruivo"), 11);         // nome começa com o rótulo
  assert.equal(R.acharOpcao(resp, "Talita Carvalho"), 21);
  assert.equal(R.acharOpcao(resp, "talíta  CARVALHO"), 21);            // acento/caixa/espaço
  assert.equal(R.acharOpcao(resp, "Victor Silva"), 20);                // único Victor nesta lista
  assert.equal(R.acharOpcao([...sdr, ...resp], "Victor Silva"), null); // dois Victor: não chuta
  assert.equal(R.acharOpcao(sdr, ""), null);
  assert.equal(R.acharOpcao(undefined, "Ana"), null);
});

test("reunião: monta campos do catálogo, comentário e pulados (igual ao Montar reunião)", () => {
  const m = R.montarReuniao({
    bitrix_id: "555",
    meeting_id: "m-1",
    client_email: "a@b.com",
    booking_date: "2026-11-03",
    scheduled_at: "2026-11-05T17:00:00Z",
    meeting_link: "https://meet.google.com/abc",
    scheduled_by: "Victor Hugo",
    meeting_owner: "Talita Carvalho",
  }, CATALOGO);
  assert.equal(m.ok, true);
  assert.equal(m.dealId, 555);
  assert.equal(m.meetingId, "m-1");
  assert.deepEqual(m.fields, {
    UF_EMAIL: "a@b.com",
    UF_DATA: "2026-11-03",
    UF_MEET: "2026-11-05T14:00:00-03:00",
    UF_LINK: "https://meet.google.com/abc",
    UF_SDR: 10,
    UF_RESP: 21,
  });
  assert.deepEqual(m.pulados, []);
  assert.equal(m.comentario,
    "📅 Reunião agendada pelo QS para 05/11 às 14:00 com Talita Carvalho.\nMeet: https://meet.google.com/abc\nAgendada por: Victor Hugo");
  assert.equal("STAGE_ID" in m.fields, false); // STAGE_REUNIAO vazio no n8n
});

test("reunião: o que falta vira aviso; opcional ausente não", () => {
  const m = R.montarReuniao({ bitrix_id: 1, scheduled_at: "2026-11-05T17:00:00Z", scheduled_by: "Fulano" }, CATALOGO);
  assert.equal(m.ok, true);
  assert.deepEqual(m.pulados, [
    "email_cliente (o QS não tem esse dado)",
    "data_agendamento (o QS não tem esse dado)",
    'sdr_agendou (nome "Fulano" não bate com nenhuma opção)',
    'resp_reuniao (nome "—" não bate com nenhuma opção)',
  ]);
  assert.match(m.comentario, /\(sem link do Meet ainda\)/);
  assert.match(m.comentario, /⚠️ Não preenchidos: email_cliente/);
  // duracao_reuniao não está no catálogo e é opcional: não aparece
  assert.equal(m.pulados.some((p: string) => p.startsWith("duracao_reuniao")), false);
});

test("reunião: sem bitrix_id ou sem nada pra gravar para (era o throw do n8n)", () => {
  assert.deepEqual(R.montarReuniao({ client_email: "a@b.com" }, CATALOGO), { ok: false, erro: "payload sem bitrix_id" });
  const vazio = R.montarReuniao({ bitrix_id: 1 }, { mapa: {}, opcoes: {} });
  assert.equal(vazio.ok, false);
  assert.match(vazio.erro, /nada para gravar/);
});

test("marca de sincronizada: pulados viram 'gravado, mas sem'", () => {
  assert.deepEqual(R.marcaDeSincronizada([], "T"), { bitrix_synced: true, bitrix_synced_at: "T", bitrix_error: null });
  assert.equal(R.marcaDeSincronizada(["a", "b"], "T").bitrix_error, "gravado, mas sem: a; b");
});

test("catálogo: rótulo do deal.fields, opções das listas, sem tocar no alias", () => {
  const { campos, opcoes, semRotulo } = R.montarLinhasCatalogo(
    [
      { FIELD_NAME: "UF_A", USER_TYPE_ID: "enumeration", MANDATORY: "Y", LIST: [{ ID: "7", VALUE: "Sim", SORT: "10" }] },
      { FIELD_NAME: "UF_B", USER_TYPE_ID: "string", EDIT_FORM_LABEL: { br: "Rótulo BR" } },
      { FIELD_NAME: "UF_C", USER_TYPE_ID: "date" },
    ],
    { UF_A: { formLabel: "Reunião realizada?" }, UF_C: { title: "UF_C" } },
    "RUN"
  );
  assert.deepEqual(campos[0], { field_name: "UF_A", user_type_id: "enumeration", label: "Reunião realizada?", mandatory: true, synced_at: "RUN" });
  assert.equal(campos[1].label, "Rótulo BR");
  assert.equal(campos[2].label, "UF_C");
  assert.equal(semRotulo, 1);
  assert.equal(campos.some((c: Record<string, unknown>) => "alias" in c), false);
  assert.deepEqual(opcoes, [{ field_name: "UF_A", option_id: 7, value: "Sim", sort: 10, active: true, synced_at: "RUN" }]);
});

// 04/11: a reunião voltou a tirar o card da Pré-Vendas (o n8n fazia até 03/11).
const DESTINO = { categoria: 0, etapa: "EXECUTING" };

test("reunião: card na Pré-Vendas (funil 25) vai pra coluna de reunião", () => {
  assert.deepEqual(R.deveLevarParaReuniao({ CATEGORY_ID: "25", STAGE_ID: "C25:PREPAYMENT_INVOIC" }, DESTINO), { mover: true, motivo: null });
  assert.equal(R.deveLevarParaReuniao({ CATEGORY_ID: 25, STAGE_ID: "C25:UC_271QUB" }, DESTINO).mover, true);
});

test("reunião: reagendamento de card que já está no Comercial 1 NÃO puxa pra trás", () => {
  const d = R.deveLevarParaReuniao({ CATEGORY_ID: "0", STAGE_ID: "PREPARATION" }, DESTINO);
  assert.equal(d.mover, false);
  assert.match(d.motivo, /fora-da-pre-vendas/);
  assert.equal(R.deveLevarParaReuniao({ CATEGORY_ID: "0", STAGE_ID: "EXECUTING" }, DESTINO).mover, false);
});

test("reunião: sem destino configurado ou sem negócio legível, não mexe", () => {
  assert.equal(R.deveLevarParaReuniao({ CATEGORY_ID: "25" }, null).motivo, "sem-destino-configurado");
  assert.equal(R.deveLevarParaReuniao({ CATEGORY_ID: "25" }, { categoria: 0 }).motivo, "sem-destino-configurado");
  assert.equal(R.deveLevarParaReuniao(null, DESTINO).motivo, "bitrix-inacessivel");
});

test("reunião: temperatura do SDR vai pra lista do card só quando o alias existe", () => {
  const base = { bitrix_id: "9", scheduled_at: "2026-11-05T17:00:00Z", temperatura_sdr: "Quente" };
  // Sem o alias no de-para: não grava e não vira alerta.
  const semAlias = R.montarReuniao(base, CATALOGO);
  assert.equal(Object.values(semAlias.fields).includes(31), false);
  assert.equal(semAlias.pulados.some((p: string) => p.startsWith("temperatura_sdr")), false);

  const comAlias = R.montarCatalogo(
    [{ alias: "datahora_meet", field_name: "UF_MEET" }, { alias: "temperatura_sdr", field_name: "UF_TEMP" }],
    [
      { alias: "temperatura_sdr", option_id: "30", value: "Frio" },
      { alias: "temperatura_sdr", option_id: "31", value: "Quente" },
    ],
  );
  const m = R.montarReuniao(base, comAlias);
  assert.equal(m.fields.UF_TEMP, 31);
  const torto = R.montarReuniao({ ...base, temperatura_sdr: "Fervendo" }, comAlias);
  assert.equal("UF_TEMP" in torto.fields, false);
  assert.ok(torto.pulados.some((p: string) => p.startsWith("temperatura_sdr")));
});

test("reunião: Produto (0321) vai pra lista do card só quando o alias existe", () => {
  const base = { bitrix_id: "9", scheduled_at: "2026-11-06T17:00:00Z", produto_tipo: "expedicao" };
  const semAlias = R.montarReuniao(base, CATALOGO);
  assert.equal(semAlias.pulados.some((p: string) => p.startsWith("produto_tipo")), false);

  const comAlias = R.montarCatalogo(
    [{ alias: "datahora_meet", field_name: "UF_MEET" }, { alias: "produto_tipo", field_name: "UF_PROD" }],
    [
      { alias: "produto_tipo", option_id: "40", value: "Expedição" },
      { alias: "produto_tipo", option_id: "41", value: "Aéreo" },
      { alias: "produto_tipo", option_id: "42", value: "Pacote" },
      { alias: "produto_tipo", option_id: "43", value: "Outros" },
    ],
  );
  assert.equal(R.montarReuniao(base, comAlias).fields.UF_PROD, 40);
  assert.equal(R.montarReuniao({ ...base, produto_tipo: "outros" }, comAlias).fields.UF_PROD, 43);
});
