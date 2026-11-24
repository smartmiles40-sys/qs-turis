// 24/11 (Bruno): emissão futura (trem-bala abre 3 meses antes) + cadência das expedições.
// Rodar: node --import ./tests/registrar-ts.mjs --test tests/rotina/emissaoRotina.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { REGRAS_PADRAO, estadoEmissao, regraPara, sugerirDatas, textoDoItem } from "../../src/lib/emissao.ts";
import { estadoDaExpedicao } from "../../src/rel/lib/etapasExpedicao.ts";

test("trem-bala: regra pela palavra, abre 90 dias antes, até 7 dias antes", () => {
  const r = regraPara(REGRAS_PADRAO, "trem", textoDoItem("Shinkansen Tóquio → Kyoto", {}));
  assert.equal(r?.id, "trem_bala");
  assert.deepEqual(sugerirDatas(r, "2027-03-30"), { emitir_de: "2026-12-30", emitir_ate: "2027-03-23" });
});

test("trem sem palavra cai na regra do tipo; passeio sem regra não sugere nada", () => {
  assert.equal(regraPara(REGRAS_PADRAO, "trem", "Ônibus Lima → Cusco")?.id, "trem");
  assert.equal(regraPara(REGRAS_PADRAO, "passeio", "Tour Monte Fuji"), null);
  assert.deepEqual(sugerirDatas(null, "2027-01-01"), { emitir_de: null, emitir_ate: null });
});

test("estado da emissão: aguardando → aberta → urgente → vencida", () => {
  const it = { data_inicio: "2027-03-30", dados: { emitir_de: "2026-12-30", emitir_ate: "2027-03-23" } };
  assert.equal(estadoEmissao(it, "2026-11-24").situacao, "aguardando");
  assert.equal(estadoEmissao(it, "2026-12-30").situacao, "aberta");
  assert.equal(estadoEmissao(it, "2027-03-18").situacao, "urgente");
  assert.equal(estadoEmissao(it, "2027-03-24").situacao, "vencida");
  // sem datas próprias: o prazo é a data de uso
  assert.equal(estadoEmissao({ data_inicio: "2026-11-28", dados: {} }, "2026-11-24").situacao, "urgente");
});

test("expedição: cadência por grupo, nada atrasado de antes da rotina", () => {
  const exp = { data_embarque: "2027-02-13", data_retorno: "2027-02-23" };
  // 24/11: Documentos (D-90 = 15/11) aberta, prazo D-75 = 30/11
  const a = estadoDaExpedicao(exp, [], "2026-11-24");
  assert.equal(a.atual?.id, "documentos");
  assert.equal(a.atual?.situacao, "a_fazer");
  // concluída Documentos, a próxima é a Revisão (abre D-60)
  const b = estadoDaExpedicao(exp, [{ expedicao_id: "x", etapa: "documentos", concluida_em: "2026-11-24T12:00:00Z", concluida_por: null, checklist: [], houve_alteracao: null, alteracao: null, obs: null }], "2026-11-24");
  assert.equal(b.atual?.id, "revisao");
  assert.equal(b.atual?.situacao, "aguardando");
  // grupo já viajando: etapas de antes ficam zeradas, a atual é Em viagem
  const c = estadoDaExpedicao({ data_embarque: "2026-11-17", data_retorno: "2026-12-02" }, [], "2026-11-24");
  assert.equal(c.atual?.id, "em_viagem");
});
