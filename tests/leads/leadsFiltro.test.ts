// Tela Leads paginada no servidor (04/11): os filtros que rodavam no navegador
// viraram filtros do PostgREST. Aqui conferimos que a tradução dá o MESMO
// resultado da regra antiga, caso a caso.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarFiltrosLeads, aplicarFiltrosLeads, expressaoBusca, regexDigitos, padraoContem, aspasPostgrest,
  TEMP_REGEX, type FiltrosLeads, type TemperaturaFiltro,
} from "../../src/lib/qs/leadsFiltro.ts";
import { normalizeTemperature } from "../../src/lib/leadScore.ts";
import { SEM_FONTE } from "../../src/controle-comercial/filtroUrl.ts";

const VAZIO: FiltrosLeads = {
  busca: "", source: "", status: "", cadenceId: "", ownerId: "", fonte: "", lossReasonId: "", temp: "", somenteDoDono: null,
};
const f = (extra: Partial<FiltrosLeads>): FiltrosLeads => ({ ...VAZIO, ...extra });

test("sem filtro nenhum = nenhuma operação (lista completa, só a RLS)", () => {
  assert.deepEqual(montarFiltrosLeads(VAZIO), []);
  assert.deepEqual(montarFiltrosLeads(f({ busca: "   " })), []);
});

test("filtros simples viram eq na coluna certa; recorte do SDR vem primeiro", () => {
  const ops = montarFiltrosLeads(f({
    somenteDoDono: "u-sdr", source: "import", status: "perdido", cadenceId: "c1", ownerId: "u2", lossReasonId: "m1", fonte: "[Japão] - Tráfego",
  }));
  assert.deepEqual(ops, [
    { op: "eq", coluna: "owner_id", valor: "u-sdr" },
    { op: "eq", coluna: "source", valor: "import" },
    { op: "eq", coluna: "status", valor: "perdido" },
    { op: "eq", coluna: "cadence_id", valor: "c1" },
    { op: "eq", coluna: "owner_id", valor: "u2" },
    { op: "eq", coluna: "loss_reason_id", valor: "m1" },
    { op: "eq", coluna: "segment", valor: "[Japão] - Tráfego" },
  ]);
});

test("busca procura em nome, empresa, e-mail e ID Bitrix; telefone só com 4+ dígitos", () => {
  assert.equal(
    expressaoBusca("Maria"),
    'full_name.ilike."%maria%",company_name.ilike."%maria%",email.ilike."%maria%",bitrix_id.ilike."%maria%"',
  );
  const comFone = expressaoBusca("(85) 9966")!;
  assert.match(comFone, /phone\.match\."8\[\^0-9\]\*5\[\^0-9\]\*9\[\^0-9\]\*9\[\^0-9\]\*6\[\^0-9\]\*6"$/);
  assert.ok(!expressaoBusca("85 9")!.includes("phone"), "3 dígitos não buscam telefone (regra antiga)");
});

test("texto do usuário não vira sintaxe: vírgula, parêntese, aspas, % e _", () => {
  assert.equal(padraoContem("50%_x\\"), "%50\\%\\_x\\\\%");
  assert.equal(aspasPostgrest('a"b\\c'), '"a\\"b\\\\c"');
  const e = expressaoBusca("silva, (joão)")!;
  assert.ok(e.startsWith('full_name.ilike."%silva, (joão)%"'));
});

test("regex de telefone acha EXATAMENTE o que o includes() nos dígitos achava", () => {
  const fones = ["5585996604595", "+55 43 99630-5550", "55 11 96414-1224", "(85) 9 9660-4595", "8599660", "", "1234"];
  const buscas = ["9966", "4399630", "11964", "5585", "96604595", "4595", "6304", "1234"];
  for (const b of buscas) {
    const re = new RegExp(regexDigitos(b));
    for (const fone of fones) {
      assert.equal(re.test(fone), fone.replace(/\D/g, "").includes(b), `${b} em ${fone}`);
    }
  }
});

test("temperatura no banco = normalizeTemperature do navegador (inclusive a prioridade)", () => {
  const rotulos = ["Quente", "quente", "Morno", "Frio", "hot", "WARM", "cold", "Média", "media", "Alta", "baixa",
    "low", "high", "medium", "quente/frio", "morno frio", "xyz", "", "Muito frio"];
  // Avalia as operações como o Postgres faria (~* = regex sem caixa; null nunca casa).
  const casa = (rotulo: string | null, temp: TemperaturaFiltro) =>
    montarFiltrosLeads(f({ temp })).every((o) => {
      if (rotulo == null) return false;
      if (o.op === "filter") return new RegExp(o.valor, "i").test(rotulo);
      if (o.op === "not") return !new RegExp(o.valor, "i").test(rotulo);
      return true;
    });
  for (const r of [...rotulos, null]) {
    for (const temp of Object.keys(TEMP_REGEX) as TemperaturaFiltro[]) {
      assert.equal(casa(r, temp), normalizeTemperature(r) === temp, `${r} × ${temp}`);
    }
  }
});

test("sem fonte = segment nulo ou vazio; junto com a busca vira and(or(),or())", () => {
  assert.deepEqual(montarFiltrosLeads(f({ fonte: SEM_FONTE })), [{ op: "or", expr: 'segment.is.null,segment.eq.""' }]);
  const ops = montarFiltrosLeads(f({ fonte: SEM_FONTE, busca: "ana" }));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "or");
  const expr = (ops[0] as { expr: string }).expr;
  assert.ok(expr.startsWith("and(or(full_name.ilike."));
  assert.ok(expr.endsWith(',or(segment.is.null,segment.eq.""))'));
});

test("aplicarFiltrosLeads chama o builder na ordem e devolve o mesmo builder", () => {
  const chamadas: string[] = [];
  const builder = {
    eq(c: string, v: string) { chamadas.push(`eq ${c} ${v}`); return builder; },
    or(e: string) { chamadas.push(`or ${e}`); return builder; },
    filter(c: string, o: string, v: string) { chamadas.push(`filter ${c} ${o} ${v}`); return builder; },
    not(c: string, o: string, v: string) { chamadas.push(`not ${c} ${o} ${v}`); return builder; },
  };
  const r = aplicarFiltrosLeads(builder, f({ status: "ganho", temp: "frio" }));
  assert.equal(r, builder);
  assert.deepEqual(chamadas, [
    "eq status ganho",
    `filter lead_score imatch ${TEMP_REGEX.frio}`,
    `not lead_score imatch ${TEMP_REGEX.quente}`,
    `not lead_score imatch ${TEMP_REGEX.morno}`,
  ]);
});
