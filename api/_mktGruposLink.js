// api/_mktGruposLink.js
// -----------------------------------------------------------------------------
// LINK INTELIGENTE DE GRUPO (0342) — a parte do SERVIDOR que fala com a
// Evolution: contar membros e criar o próximo grupo quando todos lotam.
// Roda no cron que já existe (GET /api/mkt-grupos, a cada minuto) com
// intervalo PRÓPRIO por grupo (contado_em), pra não estourar a Evolution:
//   • grupo de link "quente" (clique nos últimos 15 min): conta a cada 2 min;
//   • os outros: a cada MKT_GRUPOS_LINK_CONTAGEM_MIN (padrão 5) min;
//   • no máximo 8 grupos por rodada, 1 chamada leve (group/participants) por grupo.
// Criar grupo sozinho exige DUAS chaves: o link em "criar o próximo grupo" E
// MKT_GRUPOS_LINK_AUTO=1 na Vercel. Isto NÃO envia mensagem a ninguém.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { conexaoTravada, evoMkt } from './_mktGruposEvo.js';
import { criarGrupo, lerConvite } from './_mktGruposGestao.js';
import { gruposParaContar, precisaCriarProximo, criacaoLivre, nomeNumerado } from './_mktGruposLinkRegras.js';

const enc = encodeURIComponent;
const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Igual ao SQL: left(encode(sha256(jid),'hex'),12). Vai no cookie no lugar do jid. */
export const refDoGrupo = (jid) => createHash('sha256').update(String(jid), 'utf8').digest('hex').slice(0, 12);

export const criarAutoLigado = () => String(process.env.MKT_GRUPOS_LINK_AUTO || '').trim() === '1';

/** Os grupos dos links ativos, com os números (uma consulta por tabela). */
export async function lerLinksAtivos() {
  const links = await rest('mkt_grupos_links?select=*&ativo=eq.true&limit=200').catch(() => []);
  if (!links?.length) return { links: [], itens: [] };
  const ids = links.map((l) => l.id);
  const lg = await rest(`mkt_grupos_link_grupos?select=*&link_id=in.(${ids.join(',')})&limit=5000`).catch(() => []);
  const jids = [...new Set((lg || []).map((x) => x.grupo_jid))];
  const grupos = jids.length
    ? await rest(`mkt_grupos?select=jid,nome,participantes,link_convite,link_em,saiu_em,contado_em&jid=in.(${jids.map((j) => `"${j}"`).join(',')})`).catch(() => [])
    : [];
  const porJid = new Map((grupos || []).map((g) => [g.jid, g]));
  const itens = (lg || []).map((x) => {
    const g = porJid.get(x.grupo_jid) || {};
    return { ...x, membros: g.participantes ?? 0, link_convite: g.link_convite || null, link_em: g.link_em || null, saiu_em: g.saiu_em || null, contado_em: g.contado_em || null, nome: g.nome || null };
  });
  return { links, itens };
}

/**
 * Uma rodada: conta membros (com intervalo próprio) e, se configurado, cria o
 * próximo grupo. Não lança: devolve um resumo pro log do cron.
 */
export async function rodadaLinks({ prazoMs = 12_000, agora = new Date() } = {}) {
  const inicio = Date.now();
  const resto = () => prazoMs - (Date.now() - inicio);
  const { links, itens } = await lerLinksAtivos();
  if (!links.length) return { links: 0 };
  let c;
  try { c = await conexaoTravada(); } catch (e) { return { links: links.length, parado: e.message }; }
  if (c.estado && c.estado !== 'open') return { links: links.length, parado: `Chip ${c.estado}.` };

  const quentes = new Set(links.filter((l) => l.ultimo_clique_em && agora.getTime() - Date.parse(l.ultimo_clique_em) < 15 * 60_000).map((l) => l.id));
  const minutos = Math.max(2, Number(process.env.MKT_GRUPOS_LINK_CONTAGEM_MIN) || 5);
  const alvo = gruposParaContar(itens.filter((i) => i.ativo !== false).map((i) => ({ ...i, quente: quentes.has(i.link_id) })), { agora, minutos, minutosQuente: 2, limite: 8 });

  let contados = 0; let falhas = 0; let convites = 0;
  for (const g of alvo) {
    if (resto() < 4_000) break;
    try {
      const r = await evoMkt('group/participants', { sufixo: `?groupJid=${enc(g.grupo_jid)}`, timeoutMs: 8_000, conexao: c });
      const n = Array.isArray(r?.participants) ? r.participants.length : null;
      if (n !== null) {
        await rest('rpc/mkt_grupos_link_contagem', { method: 'POST', body: { p_grupo: g.grupo_jid, p_membros: n } });
        contados += 1;
      }
      // convite sem renovar há 6 h (ou sem convite): relê — se alguém trocou no celular, o link do QS não quebra
      if (!g.link_convite || !g.link_em || agora.getTime() - Date.parse(g.link_em) > 6 * 3600_000) {
        const link = await lerConvite(g.grupo_jid, { evo: (rota, o) => evoMkt(rota, { ...o, conexao: c, timeoutMs: 8_000 }) }).catch(() => null);
        if (link) {
          await rest(`mkt_grupos?jid=eq.${enc(g.grupo_jid)}`, { method: 'PATCH', prefer: 'return=minimal', body: { link_convite: link, link_em: new Date().toISOString() } });
          convites += 1;
        }
      }
    } catch (e) {
      falhas += 1;
      console.error('[mkt-grupos-link] contagem:', g.grupo_jid, e?.message);
      if (e?.trava) return { links: links.length, parado: e.message, contados };
    }
    await dormir(800);
  }

  let criados = 0;
  if (criarAutoLigado()) {
    const { links: l2, itens: i2 } = contados ? await lerLinksAtivos() : { links, itens };
    for (const link of l2) {
      if (resto() < 8_000) break;
      const grupos = i2.filter((i) => i.link_id === link.id);
      if (!precisaCriarProximo(link, grupos)) continue;
      const r = await criarProximoGrupo(link, grupos, { conexao: c, automatico: true }).catch((e) => ({ erro: e.message }));
      if (r?.jid) criados += 1;
    }
  }
  return { links: links.length, contados, convites, falhas, criados };
}

/**
 * Cria o próximo grupo do link pelo modelo e põe no fim da fila. Trava no banco
 * (criando_em) pra dois crons/cliques não criarem dois grupos.
 */
export async function criarProximoGrupo(link, grupos, { conexao, automatico = false } = {}) {
  if (!String(link.modelo_nome || '').trim() || !(link.modelo_admins || []).length) {
    throw new Error('Preencha o modelo do grupo (nome e pelo menos um admin) no link.');
  }
  if (automatico && Number(link.criados_auto || 0) >= Number(link.limite_auto ?? 10)) throw new Error('Chegou ao teto de grupos criados sozinhos.');
  const agora = new Date();
  // pega a trava só se estiver livre (PATCH condicional devolve a linha se pegou)
  const antes = link.criando_em ? `criando_em=lt.${enc(new Date(agora.getTime() - 5 * 60_000).toISOString())}` : 'criando_em=is.null';
  if (!criacaoLivre(link.criando_em, agora)) throw new Error('Já tem um grupo sendo criado para este link. Espere um minuto.');
  const pegou = await rest(`mkt_grupos_links?id=eq.${link.id}&${antes}`, { method: 'PATCH', prefer: 'return=representation', body: { criando_em: agora.toISOString() } });
  if (!pegou?.length) throw new Error('Já tem um grupo sendo criado para este link. Espere um minuto.');

  try {
    const n = (grupos || []).length + 1;
    const evo = conexao ? (rota, o) => evoMkt(rota, { ...o, conexao }) : evoMkt;
    const g = await criarGrupo({
      nome: nomeNumerado(link.modelo_nome, n), descricao: link.modelo_descricao || '', fotoUrl: link.modelo_foto_url || '',
      admins: link.modelo_admins, soAdminsEnviam: link.modelo_so_admins_enviam, soAdminsEditam: link.modelo_so_admins_editam,
    }, { evo });
    const agoraIso = new Date().toISOString();
    await rest('mkt_grupos?on_conflict=jid', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        jid: g.jid, nome: g.nome, descricao: g.descricao, foto_url: g.foto_url, participantes: g.participantes,
        so_admins_enviam: g.so_admins_enviam, so_admins_editam: g.so_admins_editam, eu_admin: true,
        link_convite: g.convite, link_em: g.convite ? agoraIso : null, instancia: (conexao || {}).instancia || null,
        sincronizado_em: agoraIso, contado_em: agoraIso, saiu_em: null,
      },
    });
    const ordem = Math.max(0, ...(grupos || []).map((x) => Number(x.ordem) || 0)) + 1;
    await rest('mkt_grupos_link_grupos?on_conflict=link_id,grupo_jid', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { link_id: link.id, grupo_jid: g.jid, ordem, criado_auto: true },
    });
    await rest(`mkt_grupos_links?id=eq.${link.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { criando_em: null, ultimo_erro: g.avisos.length ? g.avisos.join(' · ').slice(0, 500) : null, criados_auto: Number(link.criados_auto || 0) + (automatico ? 1 : 0) },
    });
    console.log(`[mkt-grupos-link] grupo criado para /g/${link.slug}: ${g.jid}${g.avisos.length ? ` (avisos: ${g.avisos.join('; ')})` : ''}`);
    return g;
  } catch (e) {
    // Falhou. A Evolution pode ter criado o grupo mesmo assim (ex.: demorou e
    // cortamos): no AUTOMÁTICO a tentativa conta no teto e a trava fica (5 min),
    // pra um erro repetido não virar um grupo novo por minuto. No manual, solta.
    // (Grupo criado que não foi gravado aparece no "Puxar grupos do WhatsApp".)
    await rest(`mkt_grupos_links?id=eq.${link.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: automatico
        ? { ultimo_erro: String(e?.message || e).slice(0, 500), criados_auto: Number(link.criados_auto || 0) + 1 }
        : { criando_em: null, ultimo_erro: String(e?.message || e).slice(0, 500) },
    }).catch(() => null);
    throw e;
  }
}
