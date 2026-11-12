// Alarmes de pendência do Bitrix (api/qs-alertas.js, revisão 12/11): closer atrasado e pessoas sem contato.
import { test } from "node:test";
import assert from "node:assert/strict";
import { regraCloserAtrasado, regraPessoasSemContato } from "../api/qs-alertas.js";

test("closer: nenhum atrasado → sem alerta; algum → alto, dizendo se o reenvio está ligado", () => {
  assert.equal(regraCloserAtrasado(0), null);
  const a = regraCloserAtrasado(129);
  assert.equal(a?.id, "closer_bitrix_atrasado");
  assert.equal(a?.nivel, "alto");
  assert.match(a?.texto ?? "", /129 cartão/);
  assert.match(a?.texto ?? "", /DESLIGADO/);
  assert.doesNotMatch(regraCloserAtrasado(3, { automatico: true })?.texto ?? "", /DESLIGADO/);
});

test("pessoas sem contato no Bitrix → aviso baixo", () => {
  assert.equal(regraPessoasSemContato(0), null);
  const a = regraPessoasSemContato(134);
  assert.equal(a?.id, "pessoas_sem_bitrix");
  assert.equal(a?.nivel, "baixo");
  assert.match(a?.texto ?? "", /134 pessoa/);
});
