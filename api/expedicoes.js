// api/expedicoes.js
// -----------------------------------------------------------------------------
// Integrações das EXPEDIÇÕES (Operações) que moravam no portal antigo
// (sistema-expedicoes, Next.js → app/api/**). UM arquivo, várias ações por
// ?acao= (pra não gastar uma função da Vercel por rota).
//
// Quem chama cada ação:
//   GET  ?acao=atualizar-status   → Vercel Cron diário (Authorization: Bearer CRON_SECRET).
//                                   Avança status pela data (função exp_atualizar_status, 0190).
//   POST ?acao=atualizar-status   → alguém de Operações pela tela (token da sessão).
//   POST ?acao=sincronizar-bitrix → botão "Atualizar do Bitrix" da aba Passageiros
//                                   (token da sessão; só quem edita as Expedições).
//                                   Chama o n8n (EXP_N8N_SYNC_URL) com o código da expedição;
//                                   o n8n puxa os deals e devolve aqui em ?acao=sync-contato.
//   POST ?acao=expedicao-sync     → n8n (header x-webhook-secret = EXP_WEBHOOK_SECRET).
//                                   Cria/atualiza a expedição vinda do Bitrix; nova ganha checklist.
//   POST ?acao=sync-contato       → n8n: contato CRU do Bitrix + código + deal → passageiro.
//   POST ?acao=passageiro-sync    → n8n: passageiro já "achatado" → passageiro.
//   POST ?acao=importar-compras   → n8n: negócios ganhos → compras_bitrix (tela Clientes & compras).
//   POST ?acao=onboarding-diario  → n8n (cron dele): lista quem comprou e ainda não recebeu
//                                   o acesso ao portal do viajante, com link e mensagem prontos.
//   GET  ?acao=health             → "estou vivo" (sem dados).
//
// Diferenças de propósito em relação ao antigo (bugs que não foram copiados):
//   - expedicao-sync, numa expedição que já existe, SÓ PREENCHE O QUE ESTÁ VAZIO
//     (nome/destino/datas/preço curados pelo time não são sobrescritos pelo Bitrix);
//     NÃO zera pax_planejados/preço quando o Bitrix não manda;
//     e o checklist da expedição nova é gerado de verdade (no antigo a RLS barrava).
//   - os requisitos de prontidão do passageiro novo nascem sozinhos (trigger do banco, 0166).
//   - nenhum valor vindo de fora entra cru num filtro do PostgREST (tudo encodeURIComponent).
//
// Envs: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET (já existem no QS) +
//       EXP_WEBHOOK_SECRET (o mesmo segredo que o n8n já manda pro portal antigo),
//       EXP_N8N_SYNC_URL + EXP_N8N_SYNC_SECRET (botão "Atualizar do Bitrix"),
//       EXP_PORTAL_URL (opcional: onde estão os portais /a/ e /amigo; padrão o app antigo).
// -----------------------------------------------------------------------------
import { createHmac, randomBytes } from 'node:crypto';
import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { montarChecklistPadrao } from './_expChecklist.js';

const PORTAL_PADRAO = 'https://sistema-expedicoes.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enc = (v) => encodeURIComponent(String(v));
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
const texto = (v) => (vazio(v) ? null : String(v).trim());
const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** Data do Bitrix (ISO "2029-07-04T..." ou "DD/MM/AAAA") → "AAAA-MM-DD". */
function toISO(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})[/.](\d{2})[/.](\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Estágio do deal no Bitrix → status da reserva (lib/bitrix/stage-mapping.ts do antigo).
const ESTAGIO = {
  NEW: 'Lead', LEAD: 'Lead', PREPARATION: 'Lead', 1: 'Lead',
  PROPOSAL: 'Pré-reserva', NEGOTIATION: 'Pré-reserva', PRE_RESERVA: 'Pré-reserva', 2: 'Pré-reserva', 3: 'Pré-reserva',
  WON: 'Confirmado', SIGNED: 'Confirmado', CONFIRMED: 'Confirmado', 4: 'Confirmado',
  LOST: 'Cancelado', CANCELED: 'Cancelado', CANCELLED: 'Cancelado', REJECTED: 'Cancelado', 5: 'Cancelado',
};
const statusDoEstagio = (id) => (vazio(id) ? 'Lead' : ESTAGIO[String(id).toUpperCase().trim()] || 'Lead');

/** Nome normalizado pra casar (sem acento, minúsculo, espaços colapsados). */
const normNome = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ── Autorização ─────────────────────────────────────────────────────────────

function webhookOk(req) {
  const esperado = String(process.env.EXP_WEBHOOK_SECRET || '').trim();
  return !!esperado && segredoConfere(String(req.headers['x-webhook-secret'] || '').trim(), esperado);
}

function cronOk(req) {
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return !!segredo && segredoConfere(veio, segredo);
}

/** Pergunta ao banco, com o token de quem clicou, se ele pode editar as Expedições. */
async function usuarioPodeEditar(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const chave = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/exp_pode_editar`, {
      method: 'POST',
      headers: { apikey: chave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}

// ── Status pela data (cron) ─────────────────────────────────────────────────

async function atualizarStatus(res) {
  const r = await rest('rpc/exp_atualizar_status', { method: 'POST', body: {} });
  console.log(`[expedicoes] atualizar-status: ${JSON.stringify(r)}`);
  return res.status(200).json({ ok: true, ...r });
}

// ── Botão "Atualizar do Bitrix" ─────────────────────────────────────────────

async function sincronizarBitrix(req, res) {
  const expId = req.body?.expedicao_id;
  if (!UUID.test(String(expId || ''))) return res.status(400).json({ ok: false, error: 'Expedição inválida.' });
  const url = process.env.EXP_N8N_SYNC_URL;
  if (!url) return res.status(503).json({ ok: false, error: 'Integração não configurada (falta EXP_N8N_SYNC_URL na Vercel).' });
  const exp = (await rest(`expedicoes?select=codigo&id=eq.${expId}&limit=1`))?.[0];
  if (!exp?.codigo) return res.status(404).json({ ok: false, error: 'Expedição sem código.' });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': process.env.EXP_N8N_SYNC_SECRET || '' },
      body: JSON.stringify({ expedicao_codigo: exp.codigo }),
      signal: ctrl.signal,
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: `O n8n respondeu ${r.status}.` });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.name === 'AbortError' ? 'O n8n não respondeu a tempo.' : 'Falha ao contatar o n8n.' });
  } finally { clearTimeout(t); }
}

// ── Expedição vinda do Bitrix ───────────────────────────────────────────────

async function expedicaoSync(req, res) {
  const b = req.body || {};
  const obrig = ['bitrix_pipeline_id', 'codigo', 'nome', 'destino', 'data_embarque', 'data_retorno'];
  const falta = obrig.filter((k) => vazio(b[k]));
  if (falta.length) return res.status(400).json({ ok: false, error: `Faltam campos: ${falta.join(', ')}` });
  const embarque = toISO(b.data_embarque), retorno = toISO(b.data_retorno);
  if (!embarque || !retorno) return res.status(400).json({ ok: false, error: 'Datas inválidas.' });
  if (retorno < embarque) return res.status(400).json({ ok: false, error: 'Retorno antes do embarque.' });

  const dados = {
    codigo: String(b.codigo).trim(), nome: String(b.nome).trim(), destino: String(b.destino).trim(),
    data_embarque: embarque, data_retorno: retorno, bitrix_pipeline_id: String(b.bitrix_pipeline_id).trim(),
  };
  // Só grava número se veio (no antigo vinha 0 e apagava o que o time tinha posto).
  const pax = Number(b.pax_planejados), preco = Number(b.preco_venda_brl);
  if (!vazio(b.pax_planejados) && Number.isInteger(pax) && pax >= 0) dados.pax_planejados = pax;
  if (!vazio(b.preco_venda_brl) && Number.isFinite(preco) && preco >= 0) dados.preco_venda_brl = preco;

  const COLS_EXP = 'id,codigo,nome,destino,data_embarque,data_retorno,bitrix_pipeline_id,pax_planejados,preco_venda_brl';
  const porPipeline = await rest(`expedicoes?select=${COLS_EXP}&bitrix_pipeline_id=eq.${enc(dados.bitrix_pipeline_id)}&limit=1`);
  const existente = porPipeline?.[0] || (await rest(`expedicoes?select=${COLS_EXP}&codigo=eq.${enc(dados.codigo)}&limit=1`))?.[0];

  if (existente) {
    // Expedição que já existe: SÓ PREENCHE O QUE ESTÁ VAZIO (mesma regra do passageiro).
    // O time de Operações cura nome ("— G1/G2"), destino, datas e preço no QS; o
    // antigo sobrescrevia tudo com o que vinha do Bitrix. O código nunca muda aqui
    // (é a chave que o n8n e o sync dos passageiros usam).
    const patch = {};
    for (const [k, v] of Object.entries(dados)) {
      if (k === 'codigo') continue;
      if (vazio(existente[k]) || (k === 'pax_planejados' && Number(existente[k]) === 0)) patch[k] = v;
    }
    if (Object.keys(patch).length) await rest(`expedicoes?id=eq.${existente.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    return res.status(200).json({ ok: true, expedicao_id: existente.id, action: 'updated', campos: Object.keys(patch) });
  }

  const [nova] = await insert('expedicoes', [{ ...dados, status: 'Planejamento', tipo: 'expedicao' }]);
  // Checklist padrão (23 processos). Responsável: o primeiro usuário operacional por nome.
  let checklist = 0;
  try {
    const op = (await rest('usuarios?select=id&papel=eq.operacional&order=nome.asc&limit=1'))?.[0]?.id || null;
    checklist = await rest('rpc/exp_gerar_checklist', { method: 'POST', body: { p_expedicao: nova.id, p_itens: montarChecklistPadrao(embarque, op) } });
  } catch (e) { console.warn('[expedicoes] checklist da expedição nova falhou:', e?.message); }
  return res.status(200).json({ ok: true, expedicao_id: nova.id, action: 'created', checklist });
}

// ── Passageiro vindo do Bitrix ──────────────────────────────────────────────

const COLS = 'id,expedicao_id,nome_completo,cpf,passaporte,validade_passaporte,data_nascimento,email,telefone,observacoes,bitrix_contact_id,bitrix_deal_id,endereco_cep,endereco_rua';

/**
 * Cria/atualiza o passageiro (lib/bitrix/upsert-passageiro.ts do antigo).
 * Casa por: 1) bitrix_deal_id (global); na expedição: 2) CPF, 3) contato, 4) nome + nascimento.
 * Já existe → "SÓ PREENCHE O QUE ESTÁ VAZIO" (nunca sobrescreve edição do time; status não muda).
 * Novo → insere completo; os requisitos de prontidão nascem pelo trigger do banco.
 */
async function upsertPassageiro(d, extra = {}) {
  const exp = (await rest(`expedicoes?select=id&codigo=eq.${enc(d.expedicao_codigo)}&limit=1`))?.[0];
  if (!exp) return { status: 404, body: { ok: false, error: `Expedição ${d.expedicao_codigo} não encontrada` } };

  const campos = {
    nome_completo: d.nome_completo, cpf: d.cpf, passaporte: d.passaporte, validade_passaporte: d.validade_passaporte,
    data_nascimento: d.data_nascimento, email: d.email, telefone: d.telefone, observacoes: d.observacoes,
    bitrix_contact_id: d.bitrix_contact_id, bitrix_deal_id: d.bitrix_deal_id,
    endereco_cep: extra.endereco_cep ?? null, endereco_rua: extra.endereco_rua ?? null,
  };
  const atualizar = async (ex) => {
    const patch = {};
    for (const [k, v] of Object.entries(campos)) if (!vazio(v) && vazio(ex[k])) patch[k] = v;
    if (Object.keys(patch).length) await rest(`passageiros?id=eq.${ex.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    return { status: 200, body: { ok: true, passageiro_id: ex.id, action: 'updated', nome: d.nome_completo } };
  };
  const acharNaExpedicao = async () => {
    const cpf = soDig(d.cpf);
    const contato = vazio(d.bitrix_contact_id) ? null : String(d.bitrix_contact_id).trim();
    const nome = normNome(d.nome_completo), nasc = String(d.data_nascimento || '').slice(0, 10);
    if (!cpf && !contato && !(nome && nasc)) return null;
    const lista = (await rest(`passageiros?select=${COLS}&expedicao_id=eq.${exp.id}`)) || [];
    return (cpf && lista.find((r) => soDig(r.cpf) === cpf))
      || (contato && lista.find((r) => String(r.bitrix_contact_id ?? '').trim() === contato))
      || (nome && nasc && lista.find((r) => normNome(r.nome_completo) === nome && String(r.data_nascimento || '').slice(0, 10) === nasc))
      || null;
  };

  if (!vazio(d.bitrix_deal_id)) {
    const porDeal = (await rest(`passageiros?select=${COLS}&bitrix_deal_id=eq.${enc(d.bitrix_deal_id)}&limit=1`))?.[0];
    if (porDeal) return atualizar(porDeal);
  }
  const naExp = await acharNaExpedicao();
  if (naExp) return atualizar(naExp);

  const registro = {
    expedicao_id: exp.id, ...campos,
    status_reserva: statusDoEstagio(d.estagio_deal),
    voo_nacional_necessario: d.voo_nacional_necessario === true,
  };
  try {
    const [novo] = await insert('passageiros', [registro]);
    return { status: 200, body: { ok: true, passageiro_id: novo.id, action: 'created', nome: d.nome_completo } };
  } catch (e) {
    // Corrida (o n8n manda o mesmo deal 2x ao mesmo tempo) / CPF repetido na
    // expedição: alguém já entrou → só preenche o vazio.
    const conflito = (!vazio(d.bitrix_deal_id)
      && (await rest(`passageiros?select=${COLS}&bitrix_deal_id=eq.${enc(d.bitrix_deal_id)}&limit=1`))?.[0])
      || await acharNaExpedicao();
    if (conflito) return atualizar(conflito);
    throw e;
  }
}

/** Valida o payload "achatado" (passageiroSyncSchema do antigo) e normaliza. */
function lerPassageiro(b) {
  const falta = ['bitrix_deal_id', 'expedicao_codigo', 'estagio_deal', 'nome_completo'].filter((k) => vazio(b?.[k]));
  if (falta.length) return { erro: `Faltam campos: ${falta.join(', ')}` };
  if (!vazio(b.email) && !emailValido(b.email)) return { erro: 'E-mail inválido.' };
  return {
    d: {
      bitrix_deal_id: String(b.bitrix_deal_id).trim(),
      bitrix_contact_id: vazio(b.bitrix_contact_id) ? null : String(b.bitrix_contact_id).trim(),
      expedicao_codigo: String(b.expedicao_codigo).trim(),
      estagio_deal: String(b.estagio_deal).trim(),
      nome_completo: String(b.nome_completo).trim(),
      email: texto(b.email), telefone: texto(b.telefone), cpf: texto(b.cpf), passaporte: texto(b.passaporte),
      validade_passaporte: toISO(b.validade_passaporte), data_nascimento: toISO(b.data_nascimento),
      voo_nacional_necessario: b.voo_nacional_necessario === true, observacoes: texto(b.observacoes),
    },
  };
}

async function passageiroSync(req, res) {
  const { d, erro } = lerPassageiro(req.body || {});
  if (erro) return res.status(400).json({ ok: false, error: erro });
  const r = await upsertPassageiro(d);
  return res.status(r.status).json(r.body);
}

// Campos custom do CONTATO no Bitrix (docs/N8N_INTEGRATION.md do antigo).
const F_CPF = 'UF_CRM_1752691408782', F_CPF_ALT = 'UF_CRM_1749757426655';
const F_PASS = 'UF_CRM_1752523114589', F_PASS_ALT = 'UF_CRM_1783969513247';
const F_VENC = 'UF_CRM_1752523126895';
const multi = (v) => (Array.isArray(v) && v.length ? (v[0]?.VALUE ?? null) : null);

/** Endereço do deal "<texto>|<lat>;<lng>|<id>" → CEP + resto como rua. */
function parseEndereco(raw) {
  const s0 = String(raw ?? '').split('|')[0].trim();
  if (!s0) return { cep: null, rua: null };
  const m = s0.match(/(\d{5}-?\d{3})/);
  const rua = s0.replace(/[-,\s]*cep[:\s]*\d{5}-?\d{3}\s*$/i, '').replace(/[-,\s]+$/, '').trim() || null;
  return { cep: m ? m[1] : null, rua };
}

async function syncContato(req, res) {
  const b = req.body || {};
  const c = b.contato && typeof b.contato === 'object' ? b.contato : {};
  const nome = [c.NAME, c.SECOND_NAME, c.LAST_NAME].filter(Boolean).map(String).join(' ').trim();
  // CPF: "CPF 2" (texto); se curto, o "CPF" numérico com zeros à esquerda.
  let cpf = soDig(c[F_CPF]);
  if (cpf.length < 11) { const alt = soDig(c[F_CPF_ALT]); if (alt) cpf = alt.padStart(11, '0'); }
  const email = multi(c.EMAIL);
  const { d, erro } = lerPassageiro({
    expedicao_codigo: b.expedicao_codigo,
    bitrix_deal_id: b.bitrix_deal_id != null ? String(b.bitrix_deal_id) : '',
    bitrix_contact_id: c.ID != null ? String(c.ID) : null,
    estagio_deal: 'WON',
    nome_completo: nome || 'Sem nome',
    cpf: cpf || null,
    passaporte: c[F_PASS] || c[F_PASS_ALT] || null,
    validade_passaporte: toISO(c[F_VENC]),
    data_nascimento: toISO(c.BIRTHDATE),
    email: email && emailValido(email) ? email : null,
    telefone: multi(c.PHONE),
  });
  if (erro) return res.status(400).json({ ok: false, error: erro });
  const end = parseEndereco(b.endereco);
  const r = await upsertPassageiro(d, { endereco_cep: end.cep, endereco_rua: end.rua });
  return res.status(r.status).json(r.body);
}

// ── Compras do Bitrix (Clientes & compras) ──────────────────────────────────

async function importarCompras(req, res) {
  const raw = req.body;
  const lista = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray(raw.compras) ? raw.compras : raw ? [raw] : [];
  if (!lista.length) return res.status(400).json({ ok: false, error: 'Nenhuma compra no corpo.' });
  if (lista.length > 1000) return res.status(400).json({ ok: false, error: 'Máximo de 1000 compras por chamada.' });
  // Por deal (o último vence): o mesmo deal 2x no lote fazia o upsert inteiro
  // falhar ("ON CONFLICT ... cannot affect row a second time").
  const porDeal = new Map();
  for (const c of lista) {
    if (!c || vazio(c.bitrix_deal_id)) return res.status(400).json({ ok: false, error: 'Toda compra precisa de bitrix_deal_id.' });
    const v = c.valor == null || c.valor === '' ? null : Number(String(c.valor).replace(',', '.'));
    porDeal.set(String(c.bitrix_deal_id).trim(), {
      bitrix_deal_id: String(c.bitrix_deal_id).trim(),
      bitrix_contact_id: c.bitrix_contact_id == null ? null : String(c.bitrix_contact_id),
      cpf: soDig(c.cpf) || null,
      nome_contato: texto(c.nome_contato), titulo: texto(c.titulo), produto: texto(c.produto),
      data_compra: toISO(c.data_compra),
      valor: v != null && Number.isFinite(v) ? v : null,
      moeda: texto(c.moeda) || 'BRL', funil: texto(c.funil), etapa: texto(c.etapa),
    });
  }
  const linhas = [...porDeal.values()];
  await rest('compras_bitrix?on_conflict=bitrix_deal_id', {
    method: 'POST', body: linhas, prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return res.status(200).json({ ok: true, gravadas: linhas.length });
}

// ── Onboarding diário do ExpedAmigo (portal do viajante) ────────────────────

const MENSAGEM_ONBOARDING = `Oiii {nome}! Que alegria ter você na {rotulo_viagem} {expedição} 💚

Aqui é o time de Relacionamento da Se Tu For — a partir de agora somos nós que vamos cuidar de você em cada detalhe até o embarque (e durante a viagem também).

Já liberamos o seu acesso ao *Portal do Viajante* 🎉 É nele que você acompanha tudo da sua viagem em um só lugar: o *roteiro dia a dia*, seus *voos*, a *hospedagem*, vouchers, informações do destino e avisos importantes.

👉 {link}

É só clicar no link pra criar sua senha e entrar.

📝 Importante: ao abrir o *roteiro dia a dia* no portal, vai aparecer um *formulário de inscrição* pra você preencher — é onde a gente te conhece melhor e já organiza sua documentação com antecedência, pra tudo fluir tranquilo lá na frente.

E o próximo passo é um *encontro rápido de boas-vindas*: online, leve, uns 20 minutinhos. Ali o nosso time se apresenta, te conta como funciona o acompanhamento daqui pra frente e alinha os próximos passos da sua {termo_viagem}.

Conta pra gente: qual o melhor dia e horário pra você nos próximos 7 dias, de segunda a sexta? 💚`;

function mensagemOnboarding({ nome, expedicao, link, tipo }) {
  const pacote = tipo === 'pacote';
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || nome || '';
  return MENSAGEM_ONBOARDING
    .replaceAll('{nome}', primeiro)
    .replaceAll('{rotulo_viagem}', pacote ? 'sua viagem' : 'Expedição')
    .replaceAll('{termo_viagem}', pacote ? 'viagem' : 'expedição')
    .replaceAll('{expedição}', expedicao)
    .replaceAll('{link}', link);
}

/** Token de 1º acesso (mesmo formato do antigo: o portal /amigo valida com a service key do QS). */
function tokenAcesso(passageiroId) {
  const b64 = Buffer.from(JSON.stringify({ p: passageiroId, e: Date.now() + 30 * 86400000 })).toString('base64url');
  const sig = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY || '').update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function codigoCurto(n = 10) {
  const alfa = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += alfa[b[i] % alfa.length];
  return s;
}

/** Link curto /a/<codigo> (acesso_links, 30 dias); cai no link longo se não gravar. */
async function linkCurto(passageiroId, base) {
  const expira_em = new Date(Date.now() + 30 * 86400000).toISOString();
  for (let i = 0; i < 4; i++) {
    const codigo = codigoCurto();
    try {
      await insert('acesso_links', [{ codigo, passageiro_id: passageiroId, expira_em }], { returning: false });
      return `${base}/a/${codigo}`;
    } catch (e) {
      if (!/duplicate|unique/i.test(String(e?.message || ''))) break;
    }
  }
  return `${base}/amigo/acesso?t=${tokenAcesso(passageiroId)}`;
}

async function onboardingDiario(req, res) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const dryRun = b.dryRun === true;
  const base = String(process.env.EXP_PORTAL_URL || PORTAL_PADRAO).replace(/\/$/, '');
  let q = `expedicoes?select=id,codigo,nome,tipo&status=neq.Cancelada&data_embarque=gte.${hojeBrasilia()}`;
  if (!vazio(b.expedicao_codigo)) q += `&codigo=eq.${enc(String(b.expedicao_codigo).trim())}`;
  const exps = (await rest(q)) || [];
  if (!exps.length) return res.status(200).json({ ok: true, dryRun, total: 0, enviar: [], pendencias: [] });
  const porId = new Map(exps.map((e) => [e.id, e]));
  const pax = (await rest(`passageiros?select=id,nome_completo,cpf,telefone,expedicao_id&expedicao_id=in.(${exps.map((e) => e.id).join(',')})&status_reserva=eq.Confirmado&or=(liberado_expedamigo.is.null,liberado_expedamigo.eq.false)`)) || [];

  const enviar = [], pendencias = [];
  for (const p of pax) {
    if (/ACESSO TESTE/i.test(p.nome_completo)) continue;
    const exp = porId.get(p.expedicao_id);
    if (!exp) continue;
    const link = dryRun ? `${base}/amigo/acesso?t=${tokenAcesso(p.id)}` : await linkCurto(p.id, base);
    const item = {
      passageiro_id: p.id, nome: p.nome_completo, telefone: p.telefone, cpf: p.cpf,
      expedicao_codigo: exp.codigo, expedicao_nome: exp.nome, link,
      mensagem: mensagemOnboarding({ nome: p.nome_completo, expedicao: exp.nome, link, tipo: exp.tipo }),
    };
    if (soDig(p.telefone).length >= 10) enviar.push(item);
    else pendencias.push({ ...item, motivo: 'sem telefone' });
  }
  // Idempotência: marca como liberado quem VAI receber (não reenvia amanhã).
  if (!dryRun && enviar.length) {
    await rest(`passageiros?id=in.(${enviar.map((i) => i.passageiro_id).join(',')})`, {
      method: 'PATCH', body: { liberado_expedamigo: true }, prefer: 'return=minimal',
    });
  }
  return res.status(200).json({ ok: true, dryRun, total: enviar.length + pendencias.length, enviar, pendencias });
}

// ── Rota ────────────────────────────────────────────────────────────────────

const WEBHOOKS = {
  'expedicao-sync': expedicaoSync,
  'sync-contato': syncContato,
  'passageiro-sync': passageiroSync,
  'importar-compras': importarCompras,
  'onboarding-diario': onboardingDiario,
};

export default async function handler(req, res) {
  const acao = String(req.query?.acao || '');
  try {
    if (acao === 'health') return res.status(200).json({ ok: true, service: 'qs-expedicoes', time: new Date().toISOString() });

    if (acao === 'atualizar-status') {
      if (req.method === 'GET') {
        if (!cronOk(req)) return res.status(401).json({ ok: false, error: 'Não autorizado' });
        return await atualizarStatus(res);
      }
      if (req.method === 'POST') {
        if (!(await usuarioPodeEditar(req))) return res.status(403).json({ ok: false, error: 'Sem permissão.' });
        return await atualizarStatus(res);
      }
      return res.status(405).json({ ok: false, error: 'Método não permitido' });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método não permitido' });

    if (acao === 'sincronizar-bitrix') {
      if (!(await usuarioPodeEditar(req))) return res.status(403).json({ ok: false, error: 'Seu perfil é somente leitura nas Expedições.' });
      return await sincronizarBitrix(req, res);
    }

    const fn = WEBHOOKS[acao];
    if (!fn) return res.status(404).json({ ok: false, error: 'Ação desconhecida' });
    if (!webhookOk(req)) return res.status(401).json({ ok: false, error: 'Não autorizado' });
    return await fn(req, res);
  } catch (e) {
    console.error(`[expedicoes] ${acao} falhou:`, e?.message, e?.details ? JSON.stringify(e.details) : '');
    return res.status(500).json({ ok: false, error: e?.message || 'Erro interno' });
  }
}
