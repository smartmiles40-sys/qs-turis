// Fase 1 — copia as 34 tabelas do Sistema de Expedições (bnbpsuenlokhljrkvlke) pro QS.
//
//   node scripts/expedicoes-fase1/copiar-dados.mjs            → copia (destino precisa estar vazio)
//   node scripts/expedicoes-fase1/copiar-dados.mjs --limpar   → apaga o destino antes e recopia
//   node scripts/expedicoes-fase1/copiar-dados.mjs --conferir → só compara as contagens
//
// Na troca à noite: rodar 04_noite_antes.sql (solta FKs e desliga gatilhos), este script com
// --limpar, depois 05_noite_depois.sql (religa tudo). Assim a auditoria não registra a cópia.
//
// Usuários: os do app antigo que já têm login no QS (mesmo e-mail) ganham o id do QS em
// usuarios.id e em todas as colunas que apontam pra eles. Os sem login ficam com o id antigo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(raiz, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")]; }),
);
const ORIGEM = { url: "https://bnbpsuenlokhljrkvlke.supabase.co", chave: env.EXPEDICOES_SECRET_KEY };
const DESTINO = { url: env.SUPABASE_URL, chave: env.SUPABASE_SERVICE_ROLE_KEY };
if (!ORIGEM.chave || !DESTINO.url || !DESTINO.chave) throw new Error("Faltam chaves no .env");

// tabela → chave primária (pra paginar e pra apagar)
const TABELAS = {
  usuarios: "id", fornecedores: "id", expedicoes: "id", grupos_expedicao: "id", extensoes: "id",
  arquivos: "id", passageiros: "id", quartos: "id", passageiro_quarto: "id", passageiro_extensao: "id",
  passageiro_requisitos: "id", documentos: "id", requisitos_destino: "id", checklist_itens: "id",
  custos: "id", pagamentos: "id", cambios: "moeda", roteiro_dias: "id", roteiro_dia_fotos: "id",
  roteiro_lider_dias: "id", passeios_opcionais: "id", passeio_opcional_compras: "id",
  expedicao_avisos: "id", expedicao_info: "id", expedicao_passeios: "id", expedicao_voos: "id",
  links_expedicao: "id", inscricoes_pendentes: "id", inscricoes_decisoes: "id", compras_bitrix: "id",
  expedamigo_acessos: "id", acesso_links: "id", acesso_senhas: "cpf", audit_log: "id",
};
const GERADAS = { custos: ["valor_planejado_brl"], pagamentos: ["saldo"], passageiros: ["saldo_brl"] };
const COLS_USUARIO = {
  usuarios: ["id"], arquivos: ["uploaded_by"], audit_log: ["usuario_id"], checklist_itens: ["responsavel_id"],
  custos: ["pago_por"], expedicoes: ["responsavel_operacional_id", "responsavel_comercial_id"],
  inscricoes_decisoes: ["decidido_por"], passageiro_requisitos: ["responsavel_id", "verificado_por"],
};

const cab = (k, extra = {}) => ({ apikey: k, ...(k.startsWith("sb_") ? {} : { Authorization: `Bearer ${k}` }), ...extra });

async function req(alvo, caminho, opts = {}) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(alvo.url + caminho, { ...opts, headers: cab(alvo.chave, opts.headers) });
    if (r.ok) return r;
    const txt = await r.text();
    if (tentativa >= 3 || r.status < 500) throw new Error(`${opts.method ?? "GET"} ${caminho} → ${r.status} ${txt.slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
  }
}

async function lerTudo(alvo, tabela, pk) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const r = await req(alvo, `/rest/v1/${tabela}?select=*&order=${pk}.asc`, { headers: { Range: `${de}-${de + 999}`, "Range-Unit": "items" } });
    const lote = await r.json();
    linhas.push(...lote);
    if (lote.length < 1000) return linhas;
  }
}

async function contar(alvo, tabela) {
  const r = await req(alvo, `/rest/v1/${tabela}?select=*`, { method: "HEAD", headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") ?? "*/0").split("/")[1]);
}

async function mapaUsuarios() {
  const antigos = await lerTudo(ORIGEM, "usuarios", "id");
  const r = await req(DESTINO, "/auth/v1/admin/users?per_page=1000");
  const { users } = await r.json();
  const porEmail = new Map(users.map((u) => [String(u.email ?? "").toLowerCase(), u.id]));
  const mapa = new Map();
  const sem = [];
  for (const u of antigos) {
    const novo = porEmail.get(u.email.toLowerCase());
    if (novo) mapa.set(u.id, novo); else sem.push(`${u.email} (${u.papel})`);
  }
  return { mapa, sem };
}

async function conferir() {
  let tudoIgual = true;
  for (const t of Object.keys(TABELAS)) {
    const [a, b] = await Promise.all([contar(ORIGEM, t), contar(DESTINO, t)]);
    if (a !== b) tudoIgual = false;
    console.log(`${a === b ? "ok " : "≠  "} ${t.padEnd(26)} antigo ${String(a).padStart(6)}   QS ${String(b).padStart(6)}`);
  }
  console.log(tudoIgual ? "\nTUDO IGUAL." : "\nHÁ DIFERENÇAS (acima).");
  return tudoIgual;
}

const args = process.argv.slice(2);
if (args.includes("--conferir")) {
  await conferir();
} else {
  const { mapa, sem } = await mapaUsuarios();
  console.log(`Usuários: ${mapa.size} com login no QS (id remapeado); sem login: ${sem.join(", ") || "nenhum"}`);

  if (args.includes("--limpar")) {
    for (const [t, pk] of Object.entries(TABELAS).reverse()) {
      await req(DESTINO, `/rest/v1/${t}?${pk}=not.is.null`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    }
    console.log("Destino limpo.");
  }

  for (const [t, pk] of Object.entries(TABELAS)) {
    const linhas = await lerTudo(ORIGEM, t, pk);
    for (const l of linhas) {
      for (const c of GERADAS[t] ?? []) delete l[c];
      for (const c of COLS_USUARIO[t] ?? []) if (l[c] && mapa.has(l[c])) l[c] = mapa.get(l[c]);
    }
    for (let i = 0; i < linhas.length; i += 500) {
      await req(DESTINO, `/rest/v1/${t}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(linhas.slice(i, i + 500)),
      });
    }
    console.log(`${t.padEnd(26)} ${linhas.length}`);
  }
  console.log("\nConferindo…");
  await conferir();
}
