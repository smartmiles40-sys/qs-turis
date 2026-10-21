// Fase 1 — copia os arquivos (Storage) do Sistema de Expedições pro QS.
// Buckets: arquivos-expedicoes (privado) e pasta_public (público). Mesmos caminhos.
//
//   node scripts/expedicoes-fase1/copiar-arquivos.mjs   → copia só o que falta (ou mudou de tamanho)
//
// Pode rodar quantas vezes quiser: à noite ele só leva os arquivos novos desde o ensaio.
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
const BUCKETS = ["arquivos-expedicoes", "pasta_public"];
const PARALELO = 6;

const cab = (k, extra = {}) => ({ apikey: k, ...(k.startsWith("sb_") ? {} : { Authorization: `Bearer ${k}` }), ...extra });
const cod = (p) => p.split("/").map(encodeURIComponent).join("/");

async function req(alvo, caminho, opts = {}) {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(alvo.url + caminho, { ...opts, headers: cab(alvo.chave, opts.headers) });
    if (r.ok) return r;
    const txt = await r.text();
    if (tentativa >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${opts.method ?? "GET"} ${caminho} → ${r.status} ${txt.slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 2000 * tentativa));
  }
}

/** Lista recursiva: Map caminho → tamanho. */
async function listar(alvo, bucket, prefixo = "", saida = new Map()) {
  for (let offset = 0; ; offset += 1000) {
    const r = await req(alvo, `/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: prefixo, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const itens = await r.json();
    for (const it of itens) {
      const p = prefixo ? `${prefixo}/${it.name}` : it.name;
      if (it.id === null) await listar(alvo, bucket, p, saida); // pasta
      else saida.set(p, Number(it.metadata?.size ?? -1));
    }
    if (itens.length < 1000) return saida;
  }
}

let copiados = 0, bytes = 0, erros = 0;
for (const bucket of BUCKETS) {
  const [orig, dest] = await Promise.all([listar(ORIGEM, bucket), listar(DESTINO, bucket)]);
  const falta = [...orig].filter(([p, t]) => dest.get(p) !== t);
  console.log(`${bucket}: ${orig.size} no antigo, ${dest.size} no QS, ${falta.length} a copiar`);
  let i = 0;
  await Promise.all(Array.from({ length: PARALELO }, async () => {
    while (i < falta.length) {
      const [p, tam] = falta[i++];
      try {
        const r = await req(ORIGEM, `/storage/v1/object/${bucket}/${cod(p)}`);
        const tipo = r.headers.get("content-type") ?? "application/octet-stream";
        const corpo = Buffer.from(await r.arrayBuffer());
        await req(DESTINO, `/storage/v1/object/${bucket}/${cod(p)}`, {
          method: "POST", headers: { "Content-Type": tipo, "x-upsert": "true", "cache-control": "3600" }, body: corpo,
        });
        copiados++; bytes += corpo.length;
        if (copiados % 100 === 0) console.log(`  … ${copiados} arquivos, ${(bytes / 1048576).toFixed(0)} MB`);
      } catch (e) {
        erros++; console.error(`  ERRO ${bucket}/${p} (${tam} bytes): ${e.message}`);
      }
    }
  }));
}
console.log(`\nCopiados ${copiados} arquivos (${(bytes / 1048576).toFixed(1)} MB). Erros: ${erros}.`);

// Conferência final
for (const bucket of BUCKETS) {
  const [orig, dest] = await Promise.all([listar(ORIGEM, bucket), listar(DESTINO, bucket)]);
  const faltando = [...orig].filter(([p, t]) => dest.get(p) !== t).length;
  console.log(`${faltando === 0 ? "ok" : "≠ "} ${bucket}: antigo ${orig.size} · QS ${dest.size} · faltando ${faltando}`);
}
