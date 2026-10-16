// scripts/leitura-claude/preparar.mjs
// -----------------------------------------------------------------------------
// LEITURA FEITA PELO CLAUDE (16/10/2026) — sem gastar OpenAI.
// Passo 1: junta tudo de uma viagem numa pasta pra ser lido à mão:
//   <pasta>/<viagemId>/info.json  — venda, passageiros (com passaporte), campos de
//                                   viagem do Bitrix, comentários do Bitrix, trechos
//                                   que já existem e a lista de arquivos
//   <pasta>/<viagemId>/<docId>.<ext> — cada bilhete/voucher/seguro (sem prints
//                                   nem comprovantes, os mesmos que a IA leria)
//
// Uso: node scripts/leitura-claude/preparar.mjs <pasta> <viagemId> [viagemId…]
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

for (const l of fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const { _regras } = await import('../../api/rel-viagem-ia.js');
const SB = process.env.SUPABASE_URL.replace(/\/+$/, '');
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SK, Authorization: `Bearer ${SK}` };
const get = async (p) => { const r = await fetch(`${SB}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`); return r.json(); };

const TIPOS = ['bilhete', 'seguro', 'voucher', 'contrato', 'outro'];
const SEM_PRINTS = 'or=(descricao.is.null,and(descricao.not.ilike.*print*,descricao.not.ilike.*checagem*,descricao.not.ilike.*confirma*,descricao.not.ilike.*comprovante*))';
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const [pasta, ...ids] = process.argv.slice(2);
if (!pasta || !ids.length) { console.error('uso: preparar.mjs <pasta> <viagemId…>'); process.exit(1); }

for (const id of ids) {
  const dir = path.join(pasta, id);
  fs.mkdirSync(dir, { recursive: true });
  const [v] = await get(`rel_viagens?select=id,titulo,destino,expedicao,tipo,data_venda,data_embarque,data_retorno,qtd_passageiros,observacoes,necessidades,bitrix_deal_id,cliente_id,bitrix_dados&id=eq.${id}`);
  if (!v) { console.log(`${id}: não achei`); continue; }
  const [pass, docs, ligados, trechos, comentarios] = await Promise.all([
    get(`rel_viagem_passageiros?select=cliente_id,rel_clientes(nome,cpf,nascimento,passaporte,passaporte_validade,telefone)&viagem_id=eq.${id}`).catch(() => get(`rel_viagem_passageiros?select=cliente_id,rel_clientes(nome,passaporte,passaporte_validade)&viagem_id=eq.${id}`)),
    get(`rel_documentos?select=id,tipo,descricao,arquivo_path,arquivo_nome,mime,tamanho,enviado_em&viagem_id=eq.${id}&tipo=in.(${TIPOS.join(',')})&status=neq.recusado&${SEM_PRINTS}&order=enviado_em.desc&limit=12`),
    get(`rel_viagem_deals?select=bitrix_deal_id,funil,bitrix_dados&viagem_id=eq.${id}`).catch(() => []),
    get(`rel_viagem_trechos?select=tipo,origem,destino,partida_em,chegada_em,companhia,numero,localizador,fonte&viagem_id=eq.${id}&order=partida_em`),
    [],
  ]);
  const clientes = (pass || []).map((p) => p.cliente_id);
  const coms = await get(`rel_bitrix_comentarios?select=criado_em,entidade,texto&or=(viagem_id.eq.${id}${clientes.length ? `,cliente_id.in.(${clientes.join(',')})` : ''})&order=criado_em&limit=200`).catch(() => []);
  const textoBitrix = _regras.textoDoBitrix([{ rotulo: 'venda', dados: v.bitrix_dados }, ...(ligados || []).map((l) => ({ rotulo: l.funil || `card ${l.bitrix_deal_id}`, dados: l.bitrix_dados }))]);
  const arquivos = [];
  for (const d of docs || []) {
    const ext = EXT[String(d.mime || '').split(';')[0]] || (d.arquivo_nome?.split('.').pop() || 'bin').toLowerCase();
    const destino = path.join(dir, `${d.id}.${ext}`);
    if (!fs.existsSync(destino)) {
      const r = await fetch(`${SB}/storage/v1/object/rel-documentos/${d.arquivo_path}`, { headers: H });
      if (!r.ok) { arquivos.push({ documento_id: d.id, erro: `download ${r.status}`, tipo: d.tipo, nome: d.arquivo_nome }); continue; }
      fs.writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
    }
    arquivos.push({ documento_id: d.id, arquivo: destino, tipo_cadastro: d.tipo, nome: d.arquivo_nome, descricao: d.descricao, mime: d.mime });
  }
  const { bitrix_dados: _omit, ...venda } = v;
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({
    venda,
    passageiros: (pass || []).map((p) => ({ cliente_id: p.cliente_id, ...(p.rel_clientes || {}) })),
    texto_bitrix: textoBitrix || null,
    comentarios_bitrix: coms.map((c) => `[${String(c.criado_em || '').slice(0, 10)} ${c.entidade}] ${c.texto}`),
    trechos_existentes: trechos,
    arquivos,
  }, null, 2));
  console.log(`${id}: ${arquivos.length} arquivo(s), ${coms.length} comentário(s), bitrix ${textoBitrix ? 'sim' : 'não'} → ${dir}`);
}
