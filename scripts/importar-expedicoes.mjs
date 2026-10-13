// scripts/importar-expedicoes.mjs
// -----------------------------------------------------------------------------
// SISTEMA DE EXPEDIÇÕES → RELACIONAMENTO DO QS (0112, 13/10/2026).
//
// Bruno: "no sistema de expedições já foi feita a contagem de viagens que cada
// cliente fez — puxe de lá pra cruzar todos os clientes". Lá estão as
// expedições desde 2023, com a lista de passageiros e os voos.
//
// Para cada passageiro (Confirmado/Pré-reserva, Pagante/Cortesia — Líder e
// Lead ficam de fora):
//   1. ACHA a ficha no QS: CPF → passaporte → contato do Bitrix → telefone →
//      e-mail → nome igual (só se for único). Não achou: cria. Achou: só
//      completa o que falta (nunca sobrescreve).
//   2. ACHA a viagem: pelo negócio do Bitrix (viagem, ligação ou passageiro) →
//      viagem do cliente com o mesmo lugar e embarque até 7 dias de diferença →
//      viagem daqui que já veio desta expedição. Não achou: cria
//      (origem 'expedicoes'). Garante o cliente como passageiro dela.
//   3. VOOS da expedição viram trechos da viagem (respeitando grupo, extensão
//      e voo de passageiro específico). Hora = a do bilhete, gravada como -03:00.
//
// Pode rodar de novo quando quiser: rel_expedicoes_vinculo + ref_externa dos
// trechos impedem duplicar.
//
// Uso: node scripts/importar-expedicoes.mjs [--simular]
//   lê SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY do .env daqui e
//   NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY do sistema de Expedições
//   (EXPEDICOES_ENV, padrão ../WorkFlows/sistema-expedicoes/.env.local).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIMULAR = process.argv.includes('--simular');

function lerEnv(arq) {
  const o = {};
  for (const l of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) o[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return o;
}
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const qsEnv = lerEnv(path.join(raiz, '.env'));
const exEnv = lerEnv(process.env.EXPEDICOES_ENV || path.join(raiz, '..', 'WorkFlows', 'sistema-expedicoes', '.env.local'));
// A chave service_role antiga (legada) foi desligada no projeto Expedições em 18/06/2026:
// use a chave secreta nova (sb_secret_...) em EXPEDICOES_SECRET_KEY no .env daqui.
if (qsEnv.EXPEDICOES_SECRET_KEY) exEnv.SUPABASE_SERVICE_ROLE_KEY = qsEnv.EXPEDICOES_SECRET_KEY;

function cliente(url, chave) {
  const base = String(url).replace(/\/+$/, '') + '/rest/v1/';
  // Chave nova (sb_secret_...) vai só no apikey; a legada (JWT) também no Authorization.
  const h = { apikey: chave, 'Content-Type': 'application/json', ...(String(chave).startsWith('sb_') ? {} : { Authorization: `Bearer ${chave}` }) };
  return async function rest(p, { method = 'GET', body, prefer } = {}) {
    const r = await fetch(base + p, { method, headers: { ...h, ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (!r.ok) { const e = new Error(`${method} ${p.split('?')[0]} → ${r.status} ${t.slice(0, 200)}`); e.status = r.status; throw e; }
    return t ? JSON.parse(t) : null;
  };
}
const qs = cliente(qsEnv.SUPABASE_URL, qsEnv.SUPABASE_SERVICE_ROLE_KEY);
const ex = cliente(exEnv.NEXT_PUBLIC_SUPABASE_URL, exEnv.SUPABASE_SERVICE_ROLE_KEY);

/** Lê tudo, paginando (teto de 1000 do PostgREST), com desempate por id. */
async function tudo(rest, tabela, select, filtro = '') {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const r = await rest(`${tabela}?select=${select}${filtro}&order=id.asc&offset=${i}&limit=1000`);
    out.push(...r);
    if (r.length < 1000) return out;
  }
}

// ── normalização (igual ao gatilho do QS) ───────────────────────────────────
const dig = (v) => String(v ?? '').replace(/\D/g, '');
const vazio = (v) => v == null || String(v).trim() === '';
function cpfValido(v) {
  const d = dig(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  const calc = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]) ? d : null;
}
const passaporteValido = (v) => { const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{5,12}$/.test(p) ? p : null; };
function telefone(v) { let d = dig(v); if (d.length === 10 || d.length === 11) d = '55' + d; return d.length >= 10 && d.length <= 15 ? d : null; }
const email = (v) => { const e = String(v ?? '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null; };
const nomeChave = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const lugar = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function mesmoLugar(a, b) {
  const x = lugar(a), y = lugar(b);
  if (!x || !y) return true;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const px = new Set(x.split(' ').filter((w) => w.length > 3)), py = y.split(' ').filter((w) => w.length > 3);
  return py.some((w) => px.has(w));
}
const ms = (d) => (d ? new Date(d).getTime() : NaN);
const perto = (a, b, dias = 7) => Number.isFinite(ms(a)) && Number.isFinite(ms(b)) && Math.abs(ms(a) - ms(b)) <= dias * 86_400_000;

/** "22/08 01:20" | "19/09/2026 01:05" | "29/09/2026 17:35h" → ISO -03:00 (ano da expedição). */
function quando(txt, embarque) {
  const m = String(txt || '').match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})[:h](\d{2})/);
  if (!m) return null;
  const [, d, mo, a, h, mi] = m;
  let ano = a ? Number(a.length === 2 ? '20' + a : a) : Number(String(embarque || '').slice(0, 4));
  if (!a && embarque) {
    // viagem de dezembro com voo em janeiro
    const mesEmb = Number(String(embarque).slice(5, 7));
    if (Number(mo) < mesEmb - 6) ano += 1;
  }
  if (!ano) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${ano}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00-03:00`;
}

// ── QS: estado atual em memória (poucos milhares de linhas) ─────────────────
console.log('Lendo o QS…');
const fichas = await tudo(qs, 'rel_clientes', 'id,nome,cpf,passaporte,passaporte_validade,nascimento,telefone,email,bitrix_contato_id,dados_expedicoes', '&mesclado_em_id=is.null');
const viagens = await tudo(qs, 'rel_viagens', 'id,cliente_id,titulo,destino,expedicao,tipo,data_embarque,data_retorno,bitrix_deal_id,status,expedicoes_id');
const passag = await tudo(qs, 'rel_viagem_passageiros', 'id,viagem_id,cliente_id,bitrix_deal_id');
const ligados = await tudo(qs, 'rel_viagem_deals', 'bitrix_deal_id,viagem_id').catch(() => []);
const vinculos = new Map((await qs('rel_expedicoes_vinculo?select=passageiro_id,cliente_id,viagem_id&limit=5000')).map((v) => [v.passageiro_id, v]));

const idx = { cpf: new Map(), pass: new Map(), bitrix: new Map(), tel: new Map(), email: new Map(), nome: new Map() };
function indexar(f) {
  if (f.cpf) idx.cpf.set(f.cpf, f);
  if (f.passaporte) idx.pass.set(f.passaporte, f);
  if (f.bitrix_contato_id) idx.bitrix.set(String(f.bitrix_contato_id), f);
  if (f.telefone) idx.tel.set(f.telefone, f);
  if (f.email) idx.email.set(f.email, f);
  const n = nomeChave(f.nome);
  if (n) idx.nome.set(n, idx.nome.has(n) ? 'repetido' : f);
}
fichas.forEach(indexar);
const viagemPorId = new Map(viagens.map((v) => [v.id, v]));
const viagemPorDeal = new Map();
viagens.forEach((v) => v.bitrix_deal_id && viagemPorDeal.set(String(v.bitrix_deal_id), v));
ligados.forEach((l) => viagemPorId.has(l.viagem_id) && viagemPorDeal.set(String(l.bitrix_deal_id), viagemPorId.get(l.viagem_id)));
passag.forEach((p) => p.bitrix_deal_id && viagemPorId.has(p.viagem_id) && !viagemPorDeal.has(String(p.bitrix_deal_id)) && viagemPorDeal.set(String(p.bitrix_deal_id), viagemPorId.get(p.viagem_id)));
const viagensDoCliente = new Map();
const addVC = (cid, v) => { if (!cid || !v) return; if (!viagensDoCliente.has(cid)) viagensDoCliente.set(cid, new Set()); viagensDoCliente.get(cid).add(v.id); };
viagens.forEach((v) => addVC(v.cliente_id, v));
passag.forEach((p) => addVC(p.cliente_id, viagemPorId.get(p.viagem_id)));
const jaPassageiro = new Set(passag.map((p) => `${p.viagem_id}|${p.cliente_id}`));

// ── Expedições ──────────────────────────────────────────────────────────────
console.log('Lendo o sistema de Expedições…');
const exps = await tudo(ex, 'expedicoes', 'id,nome,destino,tipo,status,data_embarque,data_retorno,preco_venda_brl');
const grupos = await tudo(ex, 'grupos_expedicao', 'id,expedicao_id,nome,data_embarque,data_retorno');
const pax = await tudo(ex, 'passageiros', '*');
const voos = await tudo(ex, 'expedicao_voos', '*');
const pxExt = await tudo(ex, 'passageiro_extensao', 'id,passageiro_id,extensao_id');
const expPorId = new Map(exps.map((e) => [e.id, e]));
const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
const extsDoPax = new Map();
pxExt.forEach((x) => { if (!extsDoPax.has(x.passageiro_id)) extsDoPax.set(x.passageiro_id, new Set()); extsDoPax.get(x.passageiro_id).add(x.extensao_id); });

const ENTRA_STATUS = new Set(['Confirmado', 'Pré-reserva']);
const ENTRA_TIPO = new Set(['Pagante', 'Cortesia']);
const conta = { passageiros: 0, pulados: 0, fichas_achadas: 0, fichas_criadas: 0, fichas_completadas: 0, viagens_achadas: 0, viagens_criadas: 0, passageiros_ligados: 0, trechos: 0, erros: 0 };
const como = {};
const diag = {};
const usadas = new Set(); // viagens sem data já casadas com uma expedição nesta rodada

async function acharOuCriarFicha(p) {
  const d = {
    nome: String(p.nome_completo || '').replace(/\s+/g, ' ').trim() || null,
    cpf: cpfValido(p.cpf), passaporte: passaporteValido(p.passaporte),
    passaporte_validade: p.validade_passaporte || null, nascimento: p.data_nascimento || null,
    telefone: telefone(p.telefone), email: email(p.email),
    bitrix_contato_id: dig(p.bitrix_contact_id) && dig(p.bitrix_contact_id) !== '0' ? dig(p.bitrix_contact_id) : null,
  };
  const extras = Object.fromEntries(Object.entries({
    endereco: [p.endereco_rua, p.endereco_numero, p.endereco_complemento, p.endereco_bairro, p.endereco_cidade, p.endereco_estado, p.endereco_cep].filter(Boolean).join(', ') || null,
    contato_emergencia: [p.contato_emergencia_nome, p.contato_emergencia_vinculo, p.contato_emergencia_fone].filter(Boolean).join(' · ') || null,
    restricoes_alimentares: p.restricoes_alimentares, condicoes_medicas: p.condicoes_medicas, saude: p.saude,
    perfil_viajante: p.perfil_viajante, paises_visitados: p.paises_visitados, ja_viajou_internacional: p.ja_viajou_internacional,
    pref_assento: p.pref_marcar_assento, pref_upgrade: p.pref_upgrade_classe,
    acompanhante: [p.acompanhante_nome, p.acompanhante_vinculo].filter(Boolean).join(' · ') || null,
  }).filter(([, v]) => !vazio(v) && !(typeof v === 'object' && !Object.keys(v || {}).length)));

  let f = null, achou = null;
  if (d.cpf && idx.cpf.get(d.cpf)) { f = idx.cpf.get(d.cpf); achou = 'cpf'; }
  else if (d.passaporte && idx.pass.get(d.passaporte)) { f = idx.pass.get(d.passaporte); achou = 'passaporte'; }
  else if (d.bitrix_contato_id && idx.bitrix.get(d.bitrix_contato_id)) { f = idx.bitrix.get(d.bitrix_contato_id); achou = 'bitrix'; }
  else if (d.telefone && idx.tel.get(d.telefone) && nomeChave(idx.tel.get(d.telefone).nome).split(' ')[0] === nomeChave(d.nome).split(' ')[0]) { f = idx.tel.get(d.telefone); achou = 'telefone'; }
  else if (d.email && idx.email.get(d.email) && nomeChave(idx.email.get(d.email).nome).split(' ')[0] === nomeChave(d.nome).split(' ')[0]) { f = idx.email.get(d.email); achou = 'email'; }
  else if (d.nome && idx.nome.get(nomeChave(d.nome)) && idx.nome.get(nomeChave(d.nome)) !== 'repetido' && nomeChave(d.nome).split(' ').length >= 2) { f = idx.nome.get(nomeChave(d.nome)); achou = 'nome'; }

  if (f) {
    conta.fichas_achadas++;
    const patch = {};
    for (const k of ['cpf', 'passaporte', 'passaporte_validade', 'nascimento', 'telefone', 'email', 'bitrix_contato_id']) if (vazio(f[k]) && !vazio(d[k])) patch[k] = d[k];
    if (Object.keys(extras).length) patch.dados_expedicoes = { ...(f.dados_expedicoes || {}), ...extras, atualizado_em: new Date().toISOString() };
    if (Object.keys(patch).length && !SIMULAR) {
      try { await qs(`rel_clientes?id=eq.${f.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); }
      catch (e) {
        if (e.status !== 409) throw e;
        delete patch.cpf; delete patch.passaporte; delete patch.bitrix_contato_id;
        if (Object.keys(patch).length) await qs(`rel_clientes?id=eq.${f.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      }
      Object.assign(f, patch); indexar(f); conta.fichas_completadas++;
    }
    return { ficha: f, como: achou };
  }
  if (!d.nome && !d.cpf && !d.telefone) return { ficha: null, como: 'sem-dados' };
  const novo = { ...d, nome: d.nome || 'Cliente das Expedições', observacoes: 'Ficha criada a partir do sistema de Expedições.', dados_expedicoes: Object.keys(extras).length ? extras : null };
  if (SIMULAR) { const fake = { id: `sim-${p.id}`, ...novo }; indexar(fake); conta.fichas_criadas++; return { ficha: fake, como: 'criada' }; }
  try {
    const r = await qs('rel_clientes', { method: 'POST', body: novo, prefer: 'return=representation' });
    indexar(r[0]); conta.fichas_criadas++;
    return { ficha: r[0], como: 'criada' };
  } catch (e) {
    if (e.status !== 409) throw e;
    // colidiu em CPF/passaporte/bitrix com ficha que não estava no índice (criada agora pelo cron)
    const busca = d.cpf ? `cpf=eq.${d.cpf}` : d.passaporte ? `passaporte=eq.${d.passaporte}` : `bitrix_contato_id=eq.${d.bitrix_contato_id}`;
    const r = await qs(`rel_clientes?select=*&${busca}&mesclado_em_id=is.null&limit=1`);
    if (r[0]) { indexar(r[0]); conta.fichas_achadas++; return { ficha: r[0], como: 'conflito' }; }
    throw e;
  }
}

async function acharOuCriarViagem(p, e, fichaId) {
  const g = p.grupo_id ? grupoPorId.get(p.grupo_id) : null;
  const embarque = g?.data_embarque || e.data_embarque;
  const retorno = g?.data_retorno || e.data_retorno;
  const vinc = vinculos.get(p.id);
  if (vinc?.viagem_id && viagemPorId.has(vinc.viagem_id)) return viagemPorId.get(vinc.viagem_id);
  const deal = dig(p.bitrix_deal_id);
  if (deal && viagemPorDeal.has(deal)) return viagemPorDeal.get(deal);
  const minhas = [...(viagensDoCliente.get(fichaId) || [])].map((id) => viagemPorId.get(id)).filter((v) => v && v.status === 'ativa');
  const casa = minhas.filter((v) => (v.expedicoes_id === e.id) || (perto(v.data_embarque, embarque) && mesmoLugar(v.expedicao || v.destino || v.titulo, e.nome + ' ' + e.destino)));
  if (casa.length) return casa.sort((a, b) => Math.abs(ms(a.data_embarque) - ms(embarque)) - Math.abs(ms(b.data_embarque) - ms(embarque)))[0];
  // Viagem do Bitrix SEM data de embarque (400 delas): casa se o lugar bate de
  // verdade (os dois lados com destino); ou, numa expedição que ainda vai
  // acontecer, a ÚNICA venda genérica do cliente ("Expedições — #id", sem
  // destino nem data). Nos dois casos a viagem ganha as datas e o destino daqui.
  const lugarExp = `${e.destino || ''} ${e.nome || ''}`;
  const semData = minhas.filter((v) => !v.data_embarque && !usadas.has(v.id));
  const porLugar = semData.filter((v) => lugar(v.expedicao || v.destino) && mesmoLugar(v.expedicao || v.destino, lugarExp));
  const genericas = semData.filter((v) => !v.destino && !v.expedicao);
  const futura = ['Vendas Abertas', 'Em andamento', 'Planejamento'].includes(e.status);
  const alvo = porLugar[0] || (futura && genericas.length === 1 ? genericas[0] : null);
  if (alvo) {
    usadas.add(alvo.id);
    conta[porLugar[0] ? 'sem_data_por_lugar' : 'sem_data_generica'] = (conta[porLugar[0] ? 'sem_data_por_lugar' : 'sem_data_generica'] || 0) + 1;
    const patch = {};
    if (!alvo.data_embarque && embarque) patch.data_embarque = embarque;
    if (!alvo.data_retorno && retorno && (!embarque || retorno >= embarque)) patch.data_retorno = retorno;
    if (!alvo.destino && e.destino) patch.destino = e.destino;
    if (!alvo.expedicao) patch.expedicao = e.nome;
    if (!alvo.titulo || /— #\d+$/.test(alvo.titulo)) patch.titulo = (e.nome + (g?.nome ? ` — ${g.nome}` : '')).slice(0, 200);
    if (alvo.tipo !== 'expedicao' && alvo.tipo !== 'pacote') patch.tipo = e.tipo === 'pacote' ? 'pacote' : 'expedicao';
    if (Object.keys(patch).length && !SIMULAR) await qs(`rel_viagens?id=eq.${alvo.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    Object.assign(alvo, patch);
    return alvo;
  }
  // Viagem daqui que já veio desta expedição pro mesmo titular de família (acompanhante)? → passageiro nela
  const body = {
    titulo: (e.nome + (g?.nome ? ` — ${g.nome}` : '')).slice(0, 200), destino: e.destino || null, expedicao: e.nome,
    tipo: e.tipo === 'pacote' ? 'pacote' : 'expedicao', data_embarque: embarque || null,
    data_retorno: retorno && embarque && retorno < embarque ? null : retorno || null,
    valor: Number(p.valor_contratado_brl) > 0 ? Number(p.valor_contratado_brl) : null, qtd_passageiros: 1,
    cliente_id: fichaId, origem: 'expedicoes', status: 'ativa', expedicoes_id: e.id,
    bitrix_deal_id: deal && !viagemPorDeal.has(deal) ? deal : null,
    observacoes: [p.observacoes, p.status_reserva === 'Pré-reserva' ? 'Pré-reserva no sistema de Expedições.' : null].filter(Boolean).join('\n') || null,
  };
  if (SIMULAR) {
    if (process.env.DIAG) { const k = e.nome; diag[k] = diag[k] || { criar: 0, cliente_tem_viagens: 0, ex: null }; diag[k].criar++; if (minhas.length) { diag[k].cliente_tem_viagens++; diag[k].ex = diag[k].ex || minhas.map((m) => `${m.expedicao || m.destino || m.titulo} ${m.data_embarque}`).join(' | ').slice(0, 160); } }
    const v = { id: `simv-${p.id}`, ...body }; viagemPorId.set(v.id, v); addVC(fichaId, v); conta.viagens_criadas++; return v;
  }
  let r;
  try { r = await qs('rel_viagens', { method: 'POST', body, prefer: 'return=representation' }); }
  catch (err) {
    if (err.status !== 409 || !body.bitrix_deal_id) throw err;
    body.bitrix_deal_id = null;
    r = await qs('rel_viagens', { method: 'POST', body, prefer: 'return=representation' });
  }
  const v = r[0]; viagemPorId.set(v.id, v); addVC(fichaId, v); if (deal) viagemPorDeal.set(deal, v);
  conta.viagens_criadas++;
  return v;
}

function voosDoPax(p) {
  const exts = extsDoPax.get(p.id) || new Set();
  return voos.filter((v) => v.expedicao_id === p.expedicao_id
    && (!v.passageiro_id || v.passageiro_id === p.id)
    && (!v.grupo_id || v.grupo_id === p.grupo_id)
    && (!v.extensao_id || exts.has(v.extensao_id))
    && (!v.apenas_sem_extensao || exts.size === 0));
}

for (const p of pax) {
  const e = expPorId.get(p.expedicao_id);
  if (!e || !ENTRA_STATUS.has(p.status_reserva) || !ENTRA_TIPO.has(p.tipo)) { conta.pulados++; continue; }
  conta.passageiros++;
  try {
    const { ficha, como: c } = await acharOuCriarFicha(p);
    como[c] = (como[c] || 0) + 1;
    if (!ficha) continue;
    const v = await acharOuCriarViagem(p, e, ficha.id);
    if (v.cliente_id !== ficha.id && !jaPassageiro.has(`${v.id}|${ficha.id}`)) {
      if (!SIMULAR) await qs('rel_viagem_passageiros?on_conflict=viagem_id,cliente_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { viagem_id: v.id, cliente_id: ficha.id } });
      jaPassageiro.add(`${v.id}|${ficha.id}`); addVC(ficha.id, v); conta.passageiros_ligados++;
    } else if (viagemPorId.get(v.id) && !v.expedicoes_id) {
      conta.viagens_achadas++;
    }
    if (!v.expedicoes_id && !SIMULAR) {
      await qs(`rel_viagens?id=eq.${v.id}`, { method: 'PATCH', body: { expedicoes_id: e.id }, prefer: 'return=minimal' });
      v.expedicoes_id = e.id;
    }
    // voos → trechos
    const linhas = voosDoPax(p).map((vo) => {
      const partida = quando(vo.partida, e.data_embarque);
      if (!partida) return null;
      let chegada = quando(vo.chegada, e.data_embarque);
      if (chegada && chegada < partida) chegada = null;
      return {
        viagem_id: v.id, ref_externa: `exp-voo:${vo.id}`,
        tipo: /intern/i.test(vo.trecho || '') ? 'voo_interno' : 'voo_internacional',
        descricao: vo.trecho || null, origem: vo.origem || null, destino: vo.destino || null,
        partida_em: partida, chegada_em: chegada, companhia: vo.companhia || null, numero: vo.numero_voo || null,
        localizador: vo.localizador || p.localizador || null,
      };
    }).filter(Boolean);
    if (linhas.length && !SIMULAR) {
      await qs('rel_viagem_trechos?on_conflict=viagem_id,ref_externa', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: linhas });
    }
    conta.trechos += linhas.length;
    if (!SIMULAR) {
      await qs('rel_expedicoes_vinculo?on_conflict=passageiro_id', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { passageiro_id: p.id, expedicao_id: e.id, cliente_id: ficha.id, viagem_id: v.id, como: c, atualizado_em: new Date().toISOString() },
      });
    }
  } catch (err) {
    conta.erros++;
    console.warn(`  ! passageiro ${p.id} (${e?.nome}): ${err.message}`);
  }
}

console.log(SIMULAR ? '\nSIMULAÇÃO (nada gravado):' : '\nPronto:');
console.log(JSON.stringify({ ...conta, ficha_achada_por: como }, null, 2));
if (process.env.DIAG) console.log(JSON.stringify(diag, null, 1));
