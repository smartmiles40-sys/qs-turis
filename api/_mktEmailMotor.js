// api/_mktEmailMotor.js
// -----------------------------------------------------------------------------
// E-MAIL MARKETING (0245) — o motor, acordado pelo cron do QS (vercel.json,
// GET /api/mkt-email a cada 5 min, Bearer CRON_SECRET). Cada rodada:
//   1. campanha agendada que venceu → 'enviando' + monta a fila (no banco)
//   2. automações: quem chegou na vez ganha o(s) próximo(s) e-mail(s) na fila
//   3. destrava órfãs ('enviando' há 15 min)
//   4. drena a fila dentro do orçamento, no ritmo do Resend
//   5. fecha campanha sem pendência
//   6. 1x por dia (SP): recalcula o score da base (janela de 90 dias)
//
// Para DE PROPÓSITO (fila intacta) sem: chave do Resend, chave HMAC, remetente
// ou QS_URL_PUBLICA. Melhor parado que queimando a campanha.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { rest } from './_supabaseAdmin.js';
import { lerConfig, enviarEmail, EmailError } from './_mktEmailResend.js';
import { montarEmail } from './_mktEmailMontar.js';
import {
  decidirAposErro, criarOrcamento, planejarExecucao, precisaRecalcularScore, MAX_TENTATIVAS,
} from './_mktEmailRegras.js';

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const novoToken = () => randomBytes(24).toString('base64url');
const agoraIso = () => new Date().toISOString();
const patch = (caminho, body) => rest(caminho, { method: 'PATCH', body, prefer: 'return=minimal' });

// ── 1. Agendadas → fila ────────────────────────────────────────────────────
async function promover(res) {
  const vencidas = await rest(
    `mkt_email_campanhas?select=id,nome&status=eq.agendada&agendada_para=lte.${encodeURIComponent(agoraIso())}&order=agendada_para.asc&limit=10`,
  ).catch(() => []);
  for (const c of vencidas || []) {
    const ganhas = await rest(`mkt_email_campanhas?id=eq.${c.id}&status=eq.agendada`, {
      method: 'PATCH', body: { status: 'enviando', erro: null }, prefer: 'return=representation',
    }).catch(() => []);
    if (!ganhas?.length) continue; // outro cron levou
    try {
      await rest('rpc/mkt_email_montar_fila', { method: 'POST', body: { p_campanha: c.id }, timeoutMs: 30_000 });
      const m = (await rest('rpc/mkt_email_metricas', { method: 'POST', body: { p_campanha: c.id } }))?.[0];
      if (!m?.total) {
        await patch(`mkt_email_campanhas?id=eq.${c.id}`, { status: 'erro', erro: 'Ninguém com e-mail ativo no público escolhido.' });
        res.avisos.push(`[${c.nome}] público vazio`);
      } else res.promovidas += 1;
    } catch (e) {
      await patch(`mkt_email_campanhas?id=eq.${c.id}`, { status: 'erro', erro: String(e?.message || e).slice(0, 500) }).catch(() => {});
      res.avisos.push(`[${c.nome}] ${e?.message || e}`);
    }
  }
}

// ── 2. Automações ──────────────────────────────────────────────────────────
async function avancarAutomacoes(res) {
  const vez = await rest(
    `mkt_email_auto_execucoes?select=id,passo,automacao_id,contato_id,automacao:mkt_email_automacoes(ativo,passos),contato:mkt_contatos(email,nome,optout_email_em)` +
    `&status=eq.ativa&proximo_em=lte.${encodeURIComponent(agoraIso())}&order=proximo_em.asc&limit=100`,
  ).catch(() => []);
  for (const x of vez || []) {
    const filtro = `mkt_email_auto_execucoes?id=eq.${x.id}&status=eq.ativa&passo=eq.${x.passo}`;
    if (!x.automacao?.ativo) {
      // Desligada: a pessoa espera (reavalia em 1 h), não perde o lugar.
      await patch(filtro, { proximo_em: new Date(Date.now() + 3_600_000).toISOString() }).catch(() => {});
      continue;
    }
    const email = String(x.contato?.email || '').trim().toLowerCase();
    if (!email || x.contato?.optout_email_em) {
      await patch(filtro, { status: 'cancelada', erro: email ? 'descadastrado' : 'sem e-mail' }).catch(() => {});
      continue;
    }
    const plano = planejarExecucao(Array.isArray(x.automacao.passos) ? x.automacao.passos : [], x.passo, Date.now());
    try {
      if (plano.emails.length) {
        await rest('mkt_email_envios?on_conflict=execucao_id,passo', {
          method: 'POST',
          prefer: 'resolution=ignore-duplicates,return=minimal',
          body: plano.emails.map((e) => ({
            execucao_id: x.id, automacao_id: x.automacao_id, passo: e.passo, modelo_id: e.modelo_id,
            contato_id: x.contato_id, email, nome: x.contato?.nome || null, token: novoToken(),
          })),
        });
        res.automacao += plano.emails.length;
      }
      await patch(filtro, plano.concluida
        ? { status: 'concluida', passo: plano.proximoPasso }
        : { passo: plano.proximoPasso, proximo_em: new Date(plano.proximoEm).toISOString() });
    } catch (e) {
      await patch(filtro, { status: 'erro', erro: String(e?.message || e).slice(0, 500) }).catch(() => {});
    }
  }
}

// ── 3. Órfãs ───────────────────────────────────────────────────────────────
async function destravarOrfas() {
  const corte = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
  const base = `mkt_email_envios?status=eq.enviando&atualizado_em=lt.${corte}`;
  await patch(`${base}&provider_id=not.is.null`, { status: 'enviado', enviado_em: agoraIso() }).catch(() => {});
  await patch(`${base}&provider_id=is.null&tentativas=lt.${MAX_TENTATIVAS}`, { status: 'pendente' }).catch(() => {});
  await patch(`${base}&provider_id=is.null&tentativas=gte.${MAX_TENTATIVAS}`, { status: 'falha', erro: 'Envio não concluído após várias tentativas.' }).catch(() => {});
}

// ── 4. Drenar ──────────────────────────────────────────────────────────────
function motivoParado(cfg) {
  if (!cfg.resendKey) return 'Resend não conectado (Marketing › E-mail › Conexão): fila parada, nada se perde.';
  if (!cfg.hmac) return 'Sem a chave HMAC no Vault (a 0245 foi aplicada?): fila parada.';
  if (!cfg.url) return 'QS_URL_PUBLICA não definida (https://…): fila parada — ela vai embutida em cada e-mail.';
  if (!cfg.remetente_email) return 'Remetente padrão não definido em Conexão: fila parada.';
  return null;
}

async function conteudoDe(item, caches) {
  if (item.campanha_id) {
    if (!caches.camp.has(item.campanha_id)) {
      const c = (await rest(`mkt_email_campanhas?select=id,status,assunto,preheader,html,remetente_nome,remetente_email,responder_para&id=eq.${item.campanha_id}&limit=1`))?.[0];
      caches.camp.set(item.campanha_id, c || null);
    }
    return caches.camp.get(item.campanha_id);
  }
  if (!caches.mod.has(item.modelo_id)) {
    const m = item.modelo_id
      ? (await rest(`mkt_email_modelos?select=id,assunto,preheader,html&id=eq.${item.modelo_id}&limit=1`))?.[0]
      : null;
    caches.mod.set(item.modelo_id, m || null);
  }
  return caches.mod.get(item.modelo_id);
}

async function devolver(itens) {
  for (const it of itens) {
    await patch(`mkt_email_envios?id=eq.${it.id}&status=eq.enviando`, { status: 'pendente', tentativas: Math.max(0, it.tentativas - 1) }).catch(() => {});
  }
}

async function drenar(cfg, orcamento, res) {
  const parado = motivoParado(cfg);
  if (parado) { res.avisos.push(parado); return; }
  const intervalo = Math.ceil(1000 / Math.max(1, Number(cfg.por_segundo) || 4));
  const caches = { camp: new Map(), mod: new Map() };
  const CUSTO = 1500;

  while (orcamento.cabe(CUSTO * 3)) {
    const lote = await rest('rpc/mkt_email_reivindicar', { method: 'POST', body: { p_limite: 20 } }).catch((e) => {
      res.avisos.push(`fila: ${e.message}`); return [];
    });
    if (!lote?.length) return;

    const ids = [...new Set(lote.map((l) => l.contato_id).filter(Boolean))];
    const campos = new Map();
    if (ids.length) {
      const cs = await rest(`mkt_contatos?select=id,campos&id=in.(${ids.join(',')})`).catch(() => []);
      for (const c of cs || []) campos.set(c.id, c.campos || {});
    }

    for (let i = 0; i < lote.length; i++) {
      const item = lote[i];
      if (!orcamento.cabe(CUSTO)) { await devolver(lote.slice(i)); return; }
      const conteudo = await conteudoDe(item, caches).catch(() => null);
      if (!conteudo || !conteudo.html) {
        await patch(`mkt_email_envios?id=eq.${item.id}`, { status: 'falha', erro: 'Conteúdo (campanha/modelo) não encontrado ou vazio.' });
        res.falhas += 1;
        continue;
      }
      const montado = montarEmail(
        { html: conteudo.html, assunto: conteudo.assunto || '', preheader: conteudo.preheader },
        { nome: item.nome, email: item.email, campos: campos.get(item.contato_id) || {} },
        { base: cfg.url, segredo: cfg.hmac, token: item.token, rodapeTexto: cfg.rodape_texto, rodapeEndereco: cfg.rodape_endereco },
      );
      try {
        const id = await enviarEmail(cfg.resendKey, {
          para: item.email,
          de: conteudo.remetente_email || cfg.remetente_email,
          deNome: conteudo.remetente_nome || cfg.remetente_nome,
          responderPara: conteudo.responder_para || cfg.responder_para,
          assunto: montado.assunto,
          html: montado.html,
          texto: montado.texto,
          urlDescadastro: montado.urlDescadastro,
        });
        await patch(`mkt_email_envios?id=eq.${item.id}`, { status: 'enviado', provider_id: id, enviado_em: agoraIso(), erro: null });
        res.enviados += 1;
      } catch (e) {
        const erro = e instanceof EmailError ? e : new EmailError(String(e?.message || e));
        const d = decidirAposErro(erro, item.tentativas);
        await patch(`mkt_email_envios?id=eq.${item.id}`, { status: d.status, tentativas: d.tentativas, erro: erro.message.slice(0, 500) }).catch(() => {});
        if (d.status === 'falha') res.falhas += 1;
        if (d.pausarMs) {
          // 429: o resto do lote volta pra fila SEM gastar tentativa.
          res.avisos.push(`Resend pediu ${Math.round(d.pausarMs / 1000)} s de pausa.`);
          if (orcamento.cabe(d.pausarMs + CUSTO)) { await dormir(d.pausarMs); continue; }
          await devolver(lote.slice(i + 1));
          return;
        }
      }
      await dormir(intervalo);
    }
  }
}

// ── 5. Fechar ──────────────────────────────────────────────────────────────
async function fechar(res) {
  const voando = await rest('mkt_email_campanhas?select=id&status=eq.enviando&limit=50').catch(() => []);
  if (!voando?.length) return;
  const metricas = await rest('rpc/mkt_email_metricas', { method: 'POST', body: { p_campanha: null } }).catch(() => []);
  const por = new Map((metricas || []).map((m) => [m.campanha_id, m]));
  for (const c of voando) {
    const m = por.get(c.id);
    if (!m || m.pendentes > 0) continue;
    await patch(`mkt_email_campanhas?id=eq.${c.id}&status=eq.enviando`, {
      status: m.enviados > 0 ? 'enviada' : 'erro',
      concluida_em: agoraIso(),
      ...(m.enviados > 0 ? {} : { erro: 'Nenhum e-mail saiu (veja os erros por destinatário).' }),
    }).catch(() => {});
    res.fechadas += 1;
  }
}

// ── Rodada ─────────────────────────────────────────────────────────────────
export async function rodar({ orcamentoMs = 45_000 } = {}) {
  const orcamento = criarOrcamento(orcamentoMs);
  const res = { promovidas: 0, automacao: 0, enviados: 0, falhas: 0, fechadas: 0, score: null, avisos: [] };
  const cfg = await lerConfig({ fresca: true });

  await promover(res);
  await avancarAutomacoes(res);
  await destravarOrfas();
  await drenar(cfg, orcamento, res);
  await fechar(res);

  if (precisaRecalcularScore(cfg.score_recalculado_em)) {
    res.score = await rest('rpc/mkt_score_recalcular', { method: 'POST', body: { p_contato: null }, timeoutMs: 30_000 })
      .catch((e) => { res.avisos.push(`score: ${e.message}`); return null; });
  }
  return res;
}
