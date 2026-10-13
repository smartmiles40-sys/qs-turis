// api/_relBitrixArquivos.js
// -----------------------------------------------------------------------------
// ARQUIVOS DOS CARDS DO BITRIX → DOCUMENTOS DO CLIENTE (0110, 13/10/2026).
// Bruno: "puxe os bilhetes dos voos que estão dentro do card de cada cliente".
//
// Duas metades, pra caber no tempo da rodada:
//   1. enfileirarArquivos(): na importação do negócio, todo campo do tipo
//      ARQUIVO preenchido vira uma linha em rel_bitrix_arquivos (pendente).
//      O file_id do Bitrix é a chave: o mesmo arquivo nunca entra duas vezes.
//   2. baixarArquivos(): no fim da rodada, com o tempo que sobrar, baixa alguns
//      pendentes, sobe no bucket PRIVADO rel-documentos e cria o rel_documentos
//      (tipo pelo nome do campo: "Bilhete", "Voucher", "Seguro"...).
//
// Download: o link "downloadUrl" do card exige sessão do Bitrix, não serve pro
// webhook. O crm.item.get devolve o "urlMachine" de cada arquivo, que é o link
// feito pra integração.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { bx } from './_bitrixLead.js';

const BUCKET = 'rel-documentos';
const MAX_BYTES = 20 * 1024 * 1024;   // limite do bucket
const MAX_TENTATIVAS = 3;

/** Tipo do documento pelo nome do campo no Bitrix. */
export function tipoPeloRotulo(rotulo) {
  const r = String(rotulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/bilhete|passage|e-?ticket|ticket|voo|aere|emissao|localizador/.test(r)) return 'bilhete';
  if (/voucher|hotel|hosped/.test(r)) return 'voucher';
  if (/seguro/.test(r)) return 'seguro';
  if (/passaporte/.test(r)) return 'passaporte';
  if (/visto|eta\b|evisa/.test(r)) return 'visto';
  if (/vacina/.test(r)) return 'vacina';
  if (/contrato/.test(r)) return 'contrato';
  if (/comprovante|pagamento|recibo|nota fiscal|\bnf\b|pix|boleto/.test(r)) return 'comprovante';
  if (/\brg\b|cnh|identidade|documento pessoal/.test(r)) return 'rg_cnh';
  return 'outro';
}

/** Os arquivos de um valor de campo (um ou vários). */
function arquivosDoValor(v) {
  const lista = Array.isArray(v) ? v : [v];
  return lista.filter((x) => x && typeof x === 'object' && (x.id || x.ID)).map((x) => String(x.id ?? x.ID));
}

/**
 * Enfileira os arquivos do negócio. `defs` = crm.deal.fields.
 * Sem cliente o arquivo fica 'ignorado' (rel_documentos exige o dono).
 */
export async function enfileirarArquivos(deal, defs, { viagemId, clienteId }) {
  const linhas = [];
  for (const [campo, def] of Object.entries(defs || {})) {
    if (def?.type !== 'file' || deal?.[campo] == null) continue;
    const rotulo = String(def.formLabel || def.listLabel || def.title || campo);
    for (const fileId of arquivosDoValor(deal[campo])) {
      linhas.push({
        file_id: fileId, deal_id: String(deal.ID), campo, rotulo, tipo: tipoPeloRotulo(rotulo),
        viagem_id: viagemId || null, cliente_id: clienteId || null,
        status: clienteId ? 'pendente' : 'ignorado', erro: clienteId ? null : 'negócio sem cliente',
      });
    }
  }
  if (!linhas.length) return 0;
  // ignore-duplicates: arquivo já na fila (ou já baixado) fica como está.
  await rest('rel_bitrix_arquivos?on_conflict=file_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: linhas,
  });
  return linhas.length;
}

const chaveCampo = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

/** urlMachine do arquivo, pelo crm.item.get (cache por negócio na rodada). */
async function linkDoArquivo(dealId, campo, fileId, cache) {
  if (!cache.has(dealId)) {
    let item = null;
    try { item = (await bx('crm.item.get', { entityTypeId: 2, id: Number(dealId) }, 12_000))?.item || null; }
    catch (e) { console.warn('[rel-arquivos] crm.item.get', dealId, e?.message); }
    cache.set(dealId, item);
  }
  const item = cache.get(dealId);
  if (!item) return null;
  const alvo = chaveCampo(campo);
  const k = Object.keys(item).find((x) => chaveCampo(x) === alvo);
  const lista = k ? (Array.isArray(item[k]) ? item[k] : [item[k]]) : [];
  const f = lista.find((x) => x && String(x.id) === String(fileId));
  return f?.urlMachine || f?.url || null;
}

function nomeSeguro(s) {
  return String(s || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'arquivo';
}
function nomeDoCabecalho(cd) {
  const m = String(cd || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return m?.[1] || null; }
}

async function marcar(fileId, patch) {
  await rest(`rel_bitrix_arquivos?file_id=eq.${encodeURIComponent(fileId)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
}

/** Baixa pendentes enquanto houver tempo. Devolve quantos viraram documento. */
export async function baixarArquivos(temTempo, lote = 15) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !chave) return { baixados: 0, falhas: 0 };
  const fila = await rest(`rel_bitrix_arquivos?select=*&status=in.(pendente,erro)&tentativas=lt.${MAX_TENTATIVAS}&cliente_id=not.is.null&order=criado_em.asc&limit=${lote}`).catch(() => []);
  const cache = new Map();
  let baixados = 0, falhas = 0;
  for (const a of fila || []) {
    if (!temTempo()) break;
    try {
      const url = await linkDoArquivo(a.deal_id, a.campo, a.file_id, cache);
      if (!url) throw new Error('o Bitrix não devolveu o link do arquivo');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9_000);
      let r;
      try { r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' }); } finally { clearTimeout(t); }
      const mime = String(r.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
      if (!r.ok || mime === 'application/json' || mime === 'text/html') {
        const txt = (await r.text().catch(() => '')).slice(0, 160);
        throw new Error(`download HTTP ${r.status} ${mime} ${txt}`);
      }
      const bytes = Buffer.from(await r.arrayBuffer());
      if (!bytes.length) throw new Error('arquivo vazio');
      if (bytes.length > MAX_BYTES) {
        await marcar(a.file_id, { status: 'ignorado', erro: `maior que 20 MB (${Math.round(bytes.length / 1048576)} MB)`, tentativas: a.tentativas + 1 });
        continue;
      }
      const nome = nomeDoCabecalho(r.headers.get('content-disposition')) || `${a.rotulo || 'arquivo'}-${a.file_id}`;
      const caminho = `${a.cliente_id}/bitrix-${a.deal_id}-${a.file_id}-${nomeSeguro(nome)}`;
      const up = await fetch(`${base}/storage/v1/object/${BUCKET}/${caminho}`, {
        method: 'POST',
        headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': mime, 'x-upsert': 'true' },
        body: bytes,
      });
      if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`);
      const doc = await rest('rel_documentos?on_conflict=bitrix_arquivo_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          cliente_id: a.cliente_id, viagem_id: a.viagem_id, tipo: a.tipo,
          descricao: `${a.rotulo} (Bitrix, negócio #${a.deal_id})`,
          arquivo_path: caminho, arquivo_nome: nome, mime, tamanho: bytes.length,
          status: 'recebido', enviado_por: 'time', bitrix_arquivo_id: a.file_id,
        },
      });
      await marcar(a.file_id, { status: 'ok', erro: null, tentativas: a.tentativas + 1, documento_id: doc?.[0]?.id || null, baixado_em: new Date().toISOString() });
      baixados++;
    } catch (e) {
      falhas++;
      console.warn(`[rel-arquivos] ${a.file_id} (negócio ${a.deal_id}):`, e?.message);
      await marcar(a.file_id, { status: 'erro', erro: String(e?.message || 'falhou').slice(0, 300), tentativas: a.tentativas + 1 }).catch(() => {});
    }
  }
  return { baixados, falhas };
}
