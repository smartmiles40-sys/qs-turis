// scripts/importar-documentos-expedicoes.mjs
// -----------------------------------------------------------------------------
// DOCUMENTOS DO SISTEMA DE EXPEDIÇÕES → FICHA DO CLIENTE NO QS (0118, 13/10/2026).
// Bruno: "puxe todas as documentações dos clientes que estão na plataforma de
// expedições, pra termos o máximo possível preenchido".
//
// Para cada arquivo de PASSAGEIRO lá (arquivos.passageiro_id preenchido):
//   • acha a ficha e a viagem pelo rel_expedicoes_vinculo (feito pelo
//     importar-expedicoes.mjs — rode ele antes);
//   • baixa do bucket privado "arquivos-expedicoes" e sobe no "rel-documentos";
//   • cria o rel_documentos com o tipo certo:
//       passaporte_arquivo_id do passageiro → passaporte · foto_arquivo_id → foto
//       requisito com esse arquivo → o tipo do requisito (Passaporte, Seguro,
//       Vacina, Visto, Aéreo/Voo Interno → bilhete)
//       senão pela categoria: Aéreos/Bilhetes/Cartão de embarque → bilhete,
//       Seguros → seguro, Vouchers/Hospedagem → voucher, Documentos pessoais →
//       pelo nome do arquivo (rg/cnh, vacina, visto…; senão passaporte), Outros → outro.
//   • requisito de passaporte com número/validade completa a ficha (só o que falta).
// Arquivo da expedição inteira (sem passageiro: roteiro etc.) fica de fora.
// ref_externa 'exp-arq:<id>' impede duplicar. Uso:
//   node scripts/importar-documentos-expedicoes.mjs [--simular]
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIMULAR = process.argv.includes('--simular');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^"|"$/g, '')]));
const q = ler(path.join(raiz, '.env'));
const e = ler(process.env.EXPEDICOES_ENV || path.join(raiz, '..', 'WorkFlows', 'sistema-expedicoes', '.env.local'));
const QS = q.SUPABASE_URL.replace(/\/+$/, ''), QK = q.SUPABASE_SERVICE_ROLE_KEY;
const EX = e.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ''), EK = q.EXPEDICOES_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY;
const hQ = { apikey: QK, Authorization: `Bearer ${QK}` };
const hE = { apikey: EK, ...(String(EK).startsWith('sb_') ? {} : { Authorization: `Bearer ${EK}` }) };

async function rest(base, h, p, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: { ...h, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) { const err = new Error(`${method} ${p.split('?')[0]} → ${r.status} ${t.slice(0, 200)}`); err.status = r.status; throw err; }
  return t ? JSON.parse(t) : null;
}
async function tudo(base, h, t, sel, filtro = '') {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const r = await rest(base, h, `${t}?select=${sel}${filtro}&order=id.asc&offset=${i}&limit=1000`);
    out.push(...r);
    if (r.length < 1000) return out;
  }
}

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function tipoPorNome(nome) {
  const n = sem(nome);
  if (/\brg\b|cnh|identidade|carteira/.test(n)) return 'rg_cnh';
  if (/vacina|febre|amarela|cive/.test(n)) return 'vacina';
  if (/visto|visa\b|\beta\b|evisa/.test(n)) return 'visto';
  if (/seguro|apolice/.test(n)) return 'seguro';
  if (/bilhete|passagem|e-?ticket|voo|boarding|embarque/.test(n)) return 'bilhete';
  if (/voucher|hotel/.test(n)) return 'voucher';
  if (/foto|selfie/.test(n)) return 'foto';
  return null;
}
const TIPO_REQ = { 'Passaporte': 'passaporte', 'Seguro': 'seguro', 'Vacina': 'vacina', 'Visto': 'visto', 'Aéreo Internacional': 'bilhete', 'Aéreo Doméstico': 'bilhete', 'Voo Interno': 'bilhete' };
const TIPO_CAT = { 'Aéreos': 'bilhete', 'Bilhetes': 'bilhete', 'Cartão de embarque': 'bilhete', 'Seguros': 'seguro', 'Vouchers': 'voucher', 'Hospedagem': 'voucher', 'Outros': 'outro' };
const nomeSeguro = (s) => String(s || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'arquivo';
const dig = (v) => String(v ?? '').replace(/\D/g, '');
const passaporteValido = (v) => { const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{5,12}$/.test(p) ? p : null; };

console.log('Lendo…');
const arquivos = await tudo(EX, hE, 'arquivos', 'id,expedicao_id,passageiro_id,categoria,nome,descricao,mime,tamanho_bytes,storage_path', '&passageiro_id=not.is.null');
const pax = await tudo(EX, hE, 'passageiros', 'id,passaporte_arquivo_id,foto_arquivo_id');
const reqs = await tudo(EX, hE, 'passageiro_requisitos', 'id,passageiro_id,tipo,arquivo_id,numero,validade,status');
const vinc = await tudo(QS, hQ, 'rel_expedicoes_vinculo', 'passageiro_id,cliente_id,viagem_id', '').catch(async () =>
  rest(QS, hQ, 'rel_expedicoes_vinculo?select=passageiro_id,cliente_id,viagem_id&limit=5000'));
const ja = new Set((await tudo(QS, hQ, 'rel_documentos', 'id,ref_externa', '&ref_externa=not.is.null')).map((d) => d.ref_externa));

const vPorPax = new Map(vinc.map((v) => [v.passageiro_id, v]));
const papel = new Map();
pax.forEach((p) => { if (p.passaporte_arquivo_id) papel.set(p.passaporte_arquivo_id, 'passaporte'); if (p.foto_arquivo_id) papel.set(p.foto_arquivo_id, 'foto'); });
reqs.forEach((r) => { if (r.arquivo_id && TIPO_REQ[r.tipo] && !papel.has(r.arquivo_id)) papel.set(r.arquivo_id, TIPO_REQ[r.tipo]); });
const validadePorArquivo = new Map(reqs.filter((r) => r.arquivo_id && r.validade).map((r) => [r.arquivo_id, r.validade]));

const conta = { arquivos: arquivos.length, ja_tinha: 0, sem_ficha: 0, copiados: 0, mb: 0, por_tipo: {}, erros: 0, fichas_completadas: 0 };

async function copiar(a, v, tipo) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60_000);
  let r;
  try { r = await fetch(`${EX}/storage/v1/object/arquivos-expedicoes/${a.storage_path.split('/').map(encodeURIComponent).join('/')}`, { headers: hE, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
  if (!r.ok) throw new Error(`download ${r.status} ${(await r.text()).slice(0, 120)}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error(`maior que 20 MB (${Math.round(bytes.length / 1048576)} MB)`);
  const mime = a.mime || r.headers.get('content-type') || 'application/octet-stream';
  const caminho = `${v.cliente_id}/expedicoes-${a.id}-${nomeSeguro(a.nome)}`;
  const up = await fetch(`${QS}/storage/v1/object/rel-documentos/${caminho}`, {
    method: 'POST', headers: { ...hQ, 'Content-Type': mime, 'x-upsert': 'true' }, body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`);
  await rest(QS, hQ, 'rel_documentos?on_conflict=ref_externa', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: {
      cliente_id: v.cliente_id, viagem_id: v.viagem_id || null, tipo,
      descricao: [a.categoria, a.descricao].filter(Boolean).join(' · ') + ' (sistema de Expedições)',
      arquivo_path: caminho, arquivo_nome: a.nome || null, mime, tamanho: bytes.length,
      validade: validadePorArquivo.get(a.id) || null,
      status: 'recebido', enviado_por: 'time', ref_externa: `exp-arq:${a.id}`,
    },
  });
  conta.mb += bytes.length / 1048576;
}

const fila = [];
for (const a of arquivos) {
  if (ja.has(`exp-arq:${a.id}`)) { conta.ja_tinha++; continue; }
  const v = vPorPax.get(a.passageiro_id);
  if (!v?.cliente_id) { conta.sem_ficha++; continue; }
  const tipo = papel.get(a.id)
    || (a.categoria === 'Documentos pessoais' ? (tipoPorNome(a.nome) || 'passaporte') : null)
    || TIPO_CAT[a.categoria] || tipoPorNome(a.nome) || 'outro';
  conta.por_tipo[tipo] = (conta.por_tipo[tipo] || 0) + 1;
  fila.push({ a, v, tipo });
}

// 4 de cada vez
if (!SIMULAR) {
  let i = 0;
  async function trabalhador() {
    while (i < fila.length) {
      const { a, v, tipo } = fila[i++];
      try { await copiar(a, v, tipo); conta.copiados++; if (conta.copiados % 50 === 0) console.log(`  ${conta.copiados}/${fila.length}…`); }
      catch (err) { conta.erros++; console.warn(`  ! ${a.id} (${a.categoria}): ${err.message}`); }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
}

// Requisito de passaporte com número/validade → completa a ficha (só o que falta)
const fichas = new Map();
for (const r of reqs.filter((x) => x.tipo === 'Passaporte' && (x.numero || x.validade))) {
  const v = vPorPax.get(r.passageiro_id);
  if (!v?.cliente_id) continue;
  const f = fichas.get(v.cliente_id) || {};
  if (!f.passaporte && passaporteValido(r.numero)) f.passaporte = passaporteValido(r.numero);
  if (!f.passaporte_validade && r.validade) f.passaporte_validade = r.validade;
  fichas.set(v.cliente_id, f);
}
if (fichas.size && !SIMULAR) {
  const ids = [...fichas.keys()];
  const atuais = [];
  for (let k = 0; k < ids.length; k += 100) atuais.push(...await rest(QS, hQ, `rel_clientes?select=id,passaporte,passaporte_validade&id=in.(${ids.slice(k, k + 100).join(',')})`));
  for (const c of atuais) {
    const d = fichas.get(c.id); const patch = {};
    if (!c.passaporte && d.passaporte) patch.passaporte = d.passaporte;
    if (!c.passaporte_validade && d.passaporte_validade) patch.passaporte_validade = d.passaporte_validade;
    if (!Object.keys(patch).length) continue;
    try { await rest(QS, hQ, `rel_clientes?id=eq.${c.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); conta.fichas_completadas++; }
    catch (err) {
      if (err.status === 409 && patch.passaporte) { delete patch.passaporte; if (Object.keys(patch).length) { await rest(QS, hQ, `rel_clientes?id=eq.${c.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); conta.fichas_completadas++; } }
      else { conta.erros++; console.warn(`  ! ficha ${c.id}: ${err.message}`); }
    }
  }
}

conta.mb = Math.round(conta.mb);
conta.a_copiar = fila.length;
console.log(SIMULAR ? '\nSIMULAÇÃO (nada gravado):' : '\nPronto:', JSON.stringify(conta, null, 2));
