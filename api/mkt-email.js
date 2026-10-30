// api/mkt-email.js
// -----------------------------------------------------------------------------
// MARKETING › E-MAIL (0245, 30/10/2026) — porta única do e-mail marketing.
//
//   GET  (Vercel Cron, Bearer CRON_SECRET, a cada 5 min) → motor (_mktEmailMotor)
//   POST { acao, ... } (logado, admin / marketing / gestor com setor marketing):
//     status                         → config sem segredos + o que falta
//     conectar { chave }             → confere no Resend e guarda no Vault (só admin/marketing)
//     desconectar
//     dominio { nome }               → usa/cadastra o domínio, devolve os registros DNS
//     verificar_dominio              → pede ao Resend conferir o DNS agora
//     criar_webhook                  → cria o webhook no Resend (guarda o segredo)
//     segredo_webhook { segredo }    → caminho manual: colar o whsec_
//     salvar_config { ... }          → remetente, rodapé, ritmo, pesos do score
//     previa { publico }             → quantos recebem
//     teste { campanhaId | modeloId, para } → manda UM e-mail de teste agora
//     agendar { campanhaId, quando? } → rascunho → agendada (sem quando = já)
//     pausar | retomar | cancelar | voltar_rascunho { campanhaId }
//     recalcular_score
//
// Ler (listas, campanhas, envios, métricas) a tela faz direto no banco (RLS 0245).
// Modelos, segmentos, automações e campanhas em rascunho também (RLS + CHECK).
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { getSupabaseUserId } from './_wa.js';
import {
  lerConfig, gravarConfig, guardarSegredo, apagarSegredo, chaveComFormatoOk, listarDominios, lerDominio,
  criarDominio, pedirVerificacao, criarWebhook, enviarEmail, EmailError, esquecerConfig,
} from './_mktEmailResend.js';
import { montarEmail } from './_mktEmailMontar.js';
import { rodar } from './_mktEmailMotor.js';
import { UUID, limparPublico, limparPesos, emailValido, remetenteDoDominio } from './_mktEmailRegras.js';

function temAcesso(u) {
  if (!u?.is_active) return false;
  const s = Array.isArray(u.setores) ? u.setores : [];
  return u.role === 'admin' || u.role === 'marketing' || s.includes('marketing');
}

async function quem(req) {
  const id = await getSupabaseUserId(req.headers['authorization']);
  if (!id || !UUID.test(id)) return null;
  return (await rest(`qs_users?select=id,name,role,setores,is_active&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
}

async function lerCampanha(id) {
  if (!UUID.test(String(id || ''))) return null;
  return (await rest(`mkt_email_campanhas?select=*&id=eq.${id}&limit=1`).catch(() => null))?.[0] || null;
}

const mudar = (id, de, body) =>
  rest(`mkt_email_campanhas?id=eq.${id}&status=in.(${de.join(',')})`, { method: 'PATCH', body, prefer: 'return=representation' });

function statusPublico(cfg) {
  const faltando = [];
  if (!cfg.resendKey) faltando.push('Conectar o Resend (chave da API)');
  if (!cfg.dominio) faltando.push('Escolher o domínio de envio');
  else if (cfg.dominio_status !== 'verified') faltando.push('Publicar os registros DNS e verificar o domínio');
  if (!cfg.webhookSecret) faltando.push('Criar o webhook (entregue / bounce / spam)');
  if (!cfg.remetente_email) faltando.push('Definir o e-mail do remetente');
  if (!cfg.url) faltando.push('Definir QS_URL_PUBLICA na Vercel (definitiva)');
  if (!cfg.hmac) faltando.push('Aplicar a migration 0245 (gera a chave HMAC)');
  return {
    conectado: Boolean(cfg.resendKey),
    webhook: Boolean(cfg.webhookSecret),
    hmac: Boolean(cfg.hmac),
    url: cfg.url,
    urlWebhook: cfg.url ? `${cfg.url}/api/mkt-email-publico?r=webhook` : null,
    config: {
      remetente_nome: cfg.remetente_nome, remetente_email: cfg.remetente_email, responder_para: cfg.responder_para,
      rodape_texto: cfg.rodape_texto, rodape_endereco: cfg.rodape_endereco, por_segundo: cfg.por_segundo,
      dominio: cfg.dominio, dominio_id: cfg.dominio_id, dominio_status: cfg.dominio_status,
      dominio_registros: cfg.dominio_registros, webhook_id: cfg.webhook_id,
      score_pesos: cfg.score_pesos, score_janela_dias: cfg.score_janela_dias, score_recalculado_em: cfg.score_recalculado_em,
    },
    faltando,
  };
}

async function guardarDominio(d) {
  await gravarConfig({
    dominio: d.name, dominio_id: d.id, dominio_status: d.status || null,
    dominio_registros: Array.isArray(d.records) ? d.records : null,
  });
}

async function corpoJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  // ── Cron ──
  if (req.method === 'GET') {
    const segredo = String(process.env.CRON_SECRET || '').trim();
    const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!segredo || veio !== segredo) return res.status(401).json({ error: 'Não autorizado' });
    try {
      return res.status(200).json({ ok: true, ...(await rodar({ orcamentoMs: 45_000 })) });
    } catch (e) {
      console.error('[mkt-email] cron', e);
      return res.status(500).json({ error: e.message });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const u = await quem(req);
  if (!u) return res.status(401).json({ error: 'Entre de novo.' });
  if (!temAcesso(u)) return res.status(403).json({ error: 'Sem acesso ao e-mail marketing.' });

  const b = await corpoJson(req);
  const acao = String(b.acao || '');
  try {
    const cfg = await lerConfig({ fresca: true });

    switch (acao) {
      case 'status':
        return res.json(statusPublico(cfg));

      // ── Conexão (só admin e o papel marketing) ──
      case 'conectar': {
        if (!['admin', 'marketing'].includes(u.role)) return res.status(403).json({ error: 'Só admin ou Marketing conectam o Resend.' });
        const chave = String(b.chave || '').trim();
        if (!chaveComFormatoOk(chave)) return res.status(400).json({ error: 'A chave do Resend começa com re_ e não tem espaços.' });
        const dominios = await listarDominios(chave); // confere ANTES de guardar
        await guardarSegredo('resend_api_key', chave);
        await gravarConfig({ resend_conectado_em: new Date().toISOString() });
        return res.json({ ok: true, dominios: dominios.map((d) => ({ id: d.id, name: d.name, status: d.status })) });
      }
      case 'desconectar': {
        if (!['admin', 'marketing'].includes(u.role)) return res.status(403).json({ error: 'Só admin ou Marketing.' });
        await apagarSegredo('resend_api_key');
        await apagarSegredo('resend_webhook_secret');
        await gravarConfig({ resend_conectado_em: null, webhook_id: null });
        return res.json({ ok: true });
      }
      case 'dominio': {
        if (!cfg.resendKey) return res.status(400).json({ error: 'Conecte o Resend primeiro.' });
        const nome = String(b.nome || '').trim().toLowerCase();
        if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(nome)) return res.status(400).json({ error: 'Digite só o domínio (ex.: mail.setuforeuvouviagens.com.br).' });
        const existentes = await listarDominios(cfg.resendKey);
        const achado = existentes.find((d) => String(d.name).toLowerCase() === nome);
        const d = achado ? await lerDominio(cfg.resendKey, achado.id) : await criarDominio(cfg.resendKey, nome);
        await guardarDominio(d);
        return res.json({ ok: true, dominio: d });
      }
      case 'verificar_dominio': {
        if (!cfg.resendKey || !cfg.dominio_id) return res.status(400).json({ error: 'Escolha o domínio primeiro.' });
        await pedirVerificacao(cfg.resendKey, cfg.dominio_id).catch(() => null);
        const d = await lerDominio(cfg.resendKey, cfg.dominio_id);
        await guardarDominio(d);
        return res.json({ ok: true, dominio: d });
      }
      case 'criar_webhook': {
        if (!cfg.resendKey) return res.status(400).json({ error: 'Conecte o Resend primeiro.' });
        if (!cfg.url) return res.status(400).json({ error: 'Defina QS_URL_PUBLICA (https) na Vercel antes.' });
        const r = await criarWebhook(cfg.resendKey, `${cfg.url}/api/mkt-email-publico?r=webhook`);
        if (r?.id) await gravarConfig({ webhook_id: r.id });
        if (!r?.signing_secret) {
          return res.status(502).json({ error: 'O Resend criou o webhook mas não devolveu o segredo. Copie o "Signing secret" no painel do Resend e cole aqui.' });
        }
        await guardarSegredo('resend_webhook_secret', r.signing_secret);
        return res.json({ ok: true });
      }
      case 'segredo_webhook': {
        const s = String(b.segredo || '').trim();
        if (!/^whsec_[A-Za-z0-9+/=]{16,}$/.test(s)) return res.status(400).json({ error: 'O segredo do webhook do Resend começa com whsec_.' });
        await guardarSegredo('resend_webhook_secret', s);
        return res.json({ ok: true });
      }
      case 'salvar_config': {
        const c = b.config || {};
        const campos = {};
        if ('remetente_nome' in c) campos.remetente_nome = String(c.remetente_nome || '').trim().slice(0, 80) || 'Se Tu For, Eu Vou! Viagens';
        if ('remetente_email' in c) {
          const e = String(c.remetente_email || '').trim().toLowerCase();
          if (e && !emailValido(e)) return res.status(400).json({ error: 'E-mail do remetente inválido.' });
          if (e && cfg.dominio && !remetenteDoDominio(e, cfg.dominio)) return res.status(400).json({ error: `O remetente precisa ser @${cfg.dominio} (o domínio verificado).` });
          campos.remetente_email = e || null;
        }
        if ('responder_para' in c) {
          const e = String(c.responder_para || '').trim().toLowerCase();
          if (e && !emailValido(e)) return res.status(400).json({ error: 'E-mail de resposta inválido.' });
          campos.responder_para = e || null;
        }
        if ('rodape_texto' in c) campos.rodape_texto = String(c.rodape_texto || '').slice(0, 500);
        if ('rodape_endereco' in c) campos.rodape_endereco = String(c.rodape_endereco || '').slice(0, 500);
        if ('por_segundo' in c) {
          const n = Number(c.por_segundo);
          if (!Number.isInteger(n) || n < 1 || n > 50) return res.status(400).json({ error: 'Ritmo entre 1 e 50 e-mails por segundo.' });
          campos.por_segundo = n;
        }
        if ('score_pesos' in c) {
          const r = limparPesos(c.score_pesos);
          if (r.erro) return res.status(400).json({ error: r.erro });
          campos.score_pesos = r.pesos;
        }
        if ('score_janela_dias' in c) {
          const n = Number(c.score_janela_dias);
          if (!Number.isInteger(n) || n < 7 || n > 365) return res.status(400).json({ error: 'Janela do score entre 7 e 365 dias.' });
          campos.score_janela_dias = n;
        }
        if (Object.keys(campos).length) await gravarConfig(campos);
        esquecerConfig();
        return res.json(statusPublico(await lerConfig({ fresca: true })));
      }

      // ── Campanhas ──
      case 'previa': {
        const p = limparPublico(b.publico);
        if (p.erro) return res.status(400).json({ error: p.erro });
        const r = await rest('rpc/mkt_email_publico_previa', { method: 'POST', body: { p_publico: p.publico } });
        return res.json(r);
      }
      case 'teste': {
        const para = String(b.para || '').trim().toLowerCase();
        if (!emailValido(para)) return res.status(400).json({ error: 'Digite um e-mail válido para o teste.' });
        if (!cfg.resendKey) return res.status(400).json({ error: 'Conecte o Resend primeiro.' });
        if (!cfg.hmac || !cfg.url) return res.status(400).json({ error: 'Falta a chave HMAC (0245) ou QS_URL_PUBLICA.' });
        let fonte = null;
        if (b.campanhaId) fonte = await lerCampanha(b.campanhaId);
        else if (UUID.test(String(b.modeloId || ''))) fonte = (await rest(`mkt_email_modelos?select=*&id=eq.${b.modeloId}&limit=1`))?.[0];
        if (!fonte?.html) return res.status(400).json({ error: 'Salve o conteúdo antes de testar.' });
        const de = fonte.remetente_email || cfg.remetente_email;
        if (!de) return res.status(400).json({ error: 'Defina o remetente em Conexão.' });
        // token "teste-…": as rotas públicas não contam abertura/clique nem descadastram.
        const token = `teste-${Date.now().toString(36)}`;
        const m = montarEmail(
          { html: fonte.html, assunto: `[TESTE] ${fonte.assunto || ''}`, preheader: fonte.preheader },
          { nome: u.name || 'Teste', email: para, campos: {} },
          { base: cfg.url, segredo: cfg.hmac, token, rodapeTexto: cfg.rodape_texto, rodapeEndereco: cfg.rodape_endereco },
        );
        const id = await enviarEmail(cfg.resendKey, {
          para, de, deNome: fonte.remetente_nome || cfg.remetente_nome, responderPara: fonte.responder_para || cfg.responder_para,
          assunto: m.assunto, html: m.html, texto: m.texto, urlDescadastro: m.urlDescadastro,
        });
        return res.json({ ok: true, id });
      }
      case 'agendar': {
        const c = await lerCampanha(b.campanhaId);
        if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
        if (c.status !== 'rascunho') return res.status(409).json({ error: 'Só rascunho pode ser agendado.' });
        const faltas = [];
        if (!String(c.assunto || '').trim()) faltas.push('assunto');
        if (!String(c.html || '').trim()) faltas.push('conteúdo');
        const p = limparPublico(c.publico);
        if (p.erro) faltas.push('público');
        const de = c.remetente_email || cfg.remetente_email;
        if (!de) faltas.push('remetente');
        else if (cfg.dominio && !remetenteDoDominio(de, cfg.dominio)) faltas.push(`remetente @${cfg.dominio}`);
        if (faltas.length) return res.status(400).json({ error: `Falta: ${faltas.join(', ')}.` });
        let quando = new Date();
        if (b.quando) {
          quando = new Date(b.quando);
          if (Number.isNaN(quando.getTime())) return res.status(400).json({ error: 'Data inválida.' });
          if (quando.getTime() > Date.now() + 180 * 86_400_000) return res.status(400).json({ error: 'No máximo 180 dias à frente.' });
        }
        const prev = await rest('rpc/mkt_email_publico_previa', { method: 'POST', body: { p_publico: p.publico } });
        if (!prev?.total) return res.status(400).json({ error: 'Ninguém com e-mail ativo neste público.' });
        const r = await mudar(c.id, ['rascunho'], { status: 'agendada', agendada_para: quando.toISOString(), publico: p.publico, erro: null });
        if (!r?.length) return res.status(409).json({ error: 'A campanha mudou de estado. Recarregue.' });
        return res.json({ ok: true, total: prev.total, avisos: statusPublico(cfg).faltando });
      }
      case 'voltar_rascunho': {
        const r = await mudar(b.campanhaId, ['agendada'], { status: 'rascunho', agendada_para: null });
        return r?.length ? res.json({ ok: true }) : res.status(409).json({ error: 'Só campanha agendada (ainda não iniciada) volta a rascunho.' });
      }
      case 'pausar': {
        const r = await mudar(b.campanhaId, ['enviando'], { status: 'pausada' });
        return r?.length ? res.json({ ok: true }) : res.status(409).json({ error: 'Só campanha enviando pode pausar.' });
      }
      case 'retomar': {
        const r = await mudar(b.campanhaId, ['pausada'], { status: 'enviando' });
        return r?.length ? res.json({ ok: true }) : res.status(409).json({ error: 'Só campanha pausada pode retomar.' });
      }
      case 'cancelar': {
        if (!UUID.test(String(b.campanhaId || ''))) return res.status(400).json({ error: 'Campanha inválida.' });
        const r = await mudar(b.campanhaId, ['agendada', 'enviando', 'pausada'], { status: 'cancelada', concluida_em: new Date().toISOString() });
        if (!r?.length) return res.status(409).json({ error: 'Nada para cancelar.' });
        await rest(`mkt_email_envios?campanha_id=eq.${b.campanhaId}&status=eq.pendente`, {
          method: 'PATCH', body: { status: 'cancelado' }, prefer: 'return=minimal',
        });
        return res.json({ ok: true });
      }
      case 'recalcular_score': {
        const n = await rest('rpc/mkt_score_recalcular', { method: 'POST', body: { p_contato: null }, timeoutMs: 30_000 });
        return res.json({ ok: true, alterados: n });
      }
      default:
        return res.status(400).json({ error: 'Ação desconhecida.' });
    }
  } catch (e) {
    const status = e instanceof EmailError ? (e.status >= 400 && e.status < 500 ? 400 : 502) : (e.status === 400 ? 400 : 500);
    console.error('[mkt-email]', acao, e?.message);
    return res.status(status).json({ error: e?.details?.message || e.message || 'Falhou.' });
  }
}
