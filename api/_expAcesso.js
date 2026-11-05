// api/_expAcesso.js
// -----------------------------------------------------------------------------
// LINK MÁGICO do ExpedAmigo (portal do viajante) gerado pelo SERVIDOR do QS.
// Porte do app antigo (sistema-expedicoes f6326c6 + e3816fa, 04/11/2026):
//   lib/expedamigo/link-acesso.ts  → criarLinkAcesso (acesso_links, /a/<codigo>, 30 dias)
//   expedamigo-actions.ts          → liberar / gerar link / RESETAR (zera a senha) por linha ou CPF
//   novas-vendas/actions.ts        → prepararWhatsappVenda (libera + link + wa.me)
// O formato é o MESMO que o portal antigo consome: linha em `acesso_links`
// (codigo 10 letras sem ambíguas, passageiro_id, expira_em) e URL <portal>/a/<codigo>.
// A mensagem/wa.me são montadas no navegador (src/expedicoes/expedamigo/acessoAmigo.ts),
// com os dados que esta função devolve.
//
// MODO VALIDAÇÃO (EXP_ESPELHO_LIGADO=1): enquanto o espelho copia o banco ANTIGO → QS,
// o portal ainda lê o banco antigo — um código gravado só no QS não existe lá e o
// link cairia em "link inválido". Então, com a env ligada, NADA é gravado: devolve 423.
//
// Arquivo com "_" não vira função da Vercel: quem chama é api/expedicoes.js
// (?acao=amigo-link e ?acao=amigo-status).
// -----------------------------------------------------------------------------
import { randomBytes } from 'node:crypto';
import { rest, insert } from './_supabaseAdmin.js';

const PORTAL_PADRAO = 'https://sistema-expedicoes.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
const DIA = 86_400_000;
const soDig = (v) => String(v ?? '').replace(/\D/g, '');
const fmtCpf = (d) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

export const espelhoLigado = () => String(process.env.EXP_ESPELHO_LIGADO || '').trim() === '1';
export const basePortal = () => String(process.env.EXP_PORTAL_URL || PORTAL_PADRAO).trim().replace(/\/+$/, '') || PORTAL_PADRAO;

/** Código curto sem viés de módulo (descarta bytes ≥ 248 = 8×31). */
export function codigoCurto(n = 10) {
  const lim = 256 - (256 % ALFABETO.length);
  let s = '';
  while (s.length < n) {
    for (const b of randomBytes(32)) {
      if (s.length >= n) break;
      if (b < lim) s += ALFABETO[b % ALFABETO.length];
    }
  }
  return s;
}

/** Pergunta ao banco, COM O TOKEN de quem clicou, o resultado de uma função de permissão. */
async function permissao(req, funcao) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const chave = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await fetch(`${base}/rest/v1/rpc/${funcao}`, {
      method: 'POST',
      headers: { apikey: chave, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}

/** Linha representativa do CPF (prefere liberada e não cancelada — igual ao antigo). */
async function passageiroDoCpf(cpf) {
  const rows = (await rest(`passageiros?select=id,liberado_expedamigo,status_reserva,created_at&cpf=in.(${[cpf, fmtCpf(cpf)].map((c) => `"${c}"`).join(',')})&or=(pendente_aprovacao.is.null,pendente_aprovacao.is.false)`)) || [];
  const ativas = rows.filter((r) => r.status_reserva !== 'Cancelado')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return (ativas.find((r) => r.liberado_expedamigo) || ativas[0] || rows[0])?.id || null;
}

/** Link ainda válido por > 7 dias (reaproveita, igual à exp_amigo_gerar_link da 0164). */
async function linkValido(passageiroId) {
  const corte = new Date(Date.now() + 7 * DIA).toISOString();
  return (await rest(`acesso_links?select=codigo,expira_em&passageiro_id=eq.${passageiroId}&expira_em=gt.${encodeURIComponent(corte)}&order=expira_em.desc&limit=1`))?.[0] || null;
}

/** Grava um código novo em acesso_links (30 dias). Colisão → tenta outro. */
async function novoLink(passageiroId) {
  const expira_em = new Date(Date.now() + 30 * DIA).toISOString();
  for (let i = 0; i < 6; i++) {
    const codigo = codigoCurto(10);
    try {
      await insert('acesso_links', [{ codigo, passageiro_id: passageiroId, expira_em }], { returning: false });
      return { codigo, expira_em };
    } catch (e) {
      if (!/duplicate|unique|23505/i.test(String(e?.message || '') + JSON.stringify(e?.details || ''))) throw e;
    }
  }
  throw new Error('Não consegui gerar um código livre — tente de novo.');
}

/**
 * POST ?acao=amigo-link   corpo: { passageiro_id? , cpf?, resetar?: bool, liberar?: bool (padrão true) }
 * Permissão:
 *   - gerar link (não mexe na senha): admin das Expedições OU quem decide inscrição
 *     (Relacionamento/Operações — no antigo o botão WhatsApp de Novas vendas usava
 *     podeDecidirInscricao);
 *   - resetar (a senha atual cai na hora): só admin (no antigo: "Apenas admin").
 */
export async function gerarLinkAmigo(req, res) {
  if (espelhoLigado()) {
    return res.status(423).json({
      ok: false, modo_validacao: true,
      error: 'Modo validação: o banco antigo ainda é o oficial (espelho ligado). Um link gerado no QS não abriria no portal — gere pelo sistema antigo até a virada.',
    });
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const resetar = b.resetar === true;
  const liberar = b.liberar !== false;

  const ehAdmin = await permissao(req, 'exp_eh_admin');
  if (!ehAdmin) {
    if (resetar) return res.status(403).json({ ok: false, error: 'Só admin das Expedições reseta o acesso ao portal.' });
    if (!(await permissao(req, 'exp_pode_decidir_inscricao'))) return res.status(403).json({ ok: false, error: 'Sem permissão para gerar o link do portal.' });
  }

  let pid = String(b.passageiro_id || '').trim();
  const cpfPedido = soDig(b.cpf);
  if (!pid) {
    if (cpfPedido.length !== 11) return res.status(400).json({ ok: false, error: 'Informe o passageiro ou um CPF válido.' });
    pid = await passageiroDoCpf(cpfPedido);
    if (!pid) return res.status(404).json({ ok: false, error: 'Nenhuma reserva com este CPF.' });
  }
  if (!UUID.test(pid)) return res.status(400).json({ ok: false, error: 'Passageiro inválido.' });

  const pax = (await rest(`passageiros?select=id,nome_completo,cpf,telefone,expedicao_id,liberado_expedamigo,status_reserva&id=eq.${pid}&limit=1`))?.[0];
  if (!pax) return res.status(404).json({ ok: false, error: 'Passageiro não encontrado.' });
  const exp = pax.expedicao_id
    ? (await rest(`expedicoes?select=id,nome,tipo,codigo&id=eq.${pax.expedicao_id}&limit=1`))?.[0] || null
    : null;
  const cpf = soDig(pax.cpf);

  // Reset: a senha atual (hash e provisória legada) deixa de valer AGORA.
  if (resetar && cpf.length === 11) {
    await rest('acesso_senhas?on_conflict=cpf', {
      method: 'POST',
      body: [{ cpf, senha_hash: null, senha_provisoria: null, updated_at: new Date().toISOString() }],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  let jaTemSenha = false;
  if (!resetar && cpf.length === 11) {
    const cred = (await rest(`acesso_senhas?select=senha_hash&cpf=in.(${[cpf, fmtCpf(cpf)].map((c) => `"${c}"`).join(',')})&limit=1`))?.[0];
    jaTemSenha = !!cred?.senha_hash;
  }

  // Liberar o portal desta viagem (sem isso a pessoa cria a senha e não vê nada).
  let liberado = !!pax.liberado_expedamigo;
  if (liberar && !liberado) {
    await rest(`passageiros?id=eq.${pid}`, { method: 'PATCH', body: { liberado_expedamigo: true }, prefer: 'return=minimal' });
    liberado = true;
  }

  // Reset sempre gera código novo; senão reaproveita um que ainda vale > 7 dias.
  const reaproveitado = resetar ? null : await linkValido(pid);
  const { codigo, expira_em } = reaproveitado || (await novoLink(pid));
  const base = basePortal();

  console.log(`[expedicoes] amigo-link: pax=${pid} resetar=${resetar} reaproveitado=${!!reaproveitado}`);
  return res.status(200).json({
    ok: true,
    link: `${base}/a/${codigo}`, codigo, expira_em, reaproveitado: !!reaproveitado,
    resetado: resetar && cpf.length === 11, ja_tem_senha: jaTemSenha, liberado,
    passageiro: { id: pax.id, nome: pax.nome_completo, telefone: pax.telefone, cpf: pax.cpf },
    expedicao: exp ? { id: exp.id, nome: exp.nome, tipo: exp.tipo || 'expedicao' } : null,
  });
}

/** GET ?acao=amigo-status → { espelho, portal } (sem dado nenhum de pessoa). */
export function statusAmigo(res) {
  return res.status(200).json({ ok: true, espelho: espelhoLigado(), portal: basePortal() });
}
