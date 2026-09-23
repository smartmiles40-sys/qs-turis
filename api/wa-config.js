// api/wa-config.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET/POST /api/wa-config
//
// GET devolve, numa chamada só, o que o painel de atendimento precisa ao abrir:
//   • respostas — as respostas prontas (/atalho), cadastradas no próprio QS
//                 (qs_settings.wa_respostas)
//   • inboxes   — o número por onde a conversa sai: desde 23/09/2026, só o
//                 OFICIAL (Chatwoot e Evolution saíram do QS)
//   • modelos   — os modelos APROVADOS na Meta, lidos direto da Cloud API. É com
//                 eles que se abre conversa nova ou se fala fora da janela de
//                 24h — texto livre a Meta recusa.
//
// E concentra, pelo mesmo motivo de sempre (o teto de funções da Vercel), o
// portal de modelos, as respostas prontas (admin) e as ligações pela Meta.
// -----------------------------------------------------------------------------

import { getSupabaseUserId } from './_wa.js';
import { listarModelos, criarModelo, excluirModelo,
         lerConfigChamadas, ativarChamadas, pedirPermissaoDeLigacao,
         diagnosticoChamadas, iniciarLigacao, encerrarLigacao,
         credenciaisDaMeta, modelosAprovados, apontarWebhookProQs } from './_meta.js';
import { caixaOficial } from './_waSaida.js';
import { conectarNumero, desconectarNumero, listarConexoes, salvarConfigCadastro } from './_metaConexao.js';
import { rest } from './_supabaseAdmin.js';
import { sincronizarPermissao, gravarPermissao, lerPermissaoLocal, permissaoVale } from './_permissaoLigacao.js';

/** Só admin/gestor mexe nos modelos e nas respostas prontas. */
async function ehAdmin(userId) {
  const u = await perfil(userId);
  return !!u && u.is_active !== false && (u.role === 'admin' || u.role === 'gestor');
}

async function perfil(userId) {
  try {
    const u = await rest(`qs_users?select=id,name,role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`);
    return (Array.isArray(u) && u[0]) || null;
  } catch { return null; }
}

// ── RESPOSTAS PRONTAS (/atalho) ─────────────────────────────────────────────
// Moravam no Chatwoot. Agora são uma lista em qs_settings.wa_respostas:
// [{ atalho, texto }]. Atalho sem espaço, até 40 caracteres; texto até 4000.

const CHAVE_RESPOSTAS = 'wa_respostas';

function limparRespostas(lista) {
  const vistos = new Set();
  const out = [];
  for (const r of Array.isArray(lista) ? lista : []) {
    const atalho = String(r?.atalho || '').trim().replace(/^\//, '').replace(/\s+/g, '-').slice(0, 40);
    const texto = String(r?.texto || '').trim().slice(0, 4000);
    if (!atalho || !texto || vistos.has(atalho.toLowerCase())) continue;
    vistos.add(atalho.toLowerCase());
    out.push({ atalho, texto });
  }
  return out.slice(0, 300);
}

async function lerRespostas() {
  try {
    const r = await rest(`qs_settings?select=value&key=eq.${CHAVE_RESPOSTAS}&limit=1`);
    if (Array.isArray(r) && r.length) return limparRespostas(r[0].value);
  } catch (e) {
    console.warn('[wa-config] respostas prontas:', e?.message);
    return [];
  }
  // Nunca cadastradas: primeira abertura depois da saída do Chatwoot.
  return importarRespostasDoChatwoot();
}

async function salvarRespostas(lista) {
  const limpas = limparRespostas(lista);
  await rest('qs_settings', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: { key: CHAVE_RESPOSTAS, value: limpas, updated_at: new Date().toISOString() },
  });
  return limpas;
}

/**
 * ⚠️ PONTE DE UMA VEZ SÓ (23/09/2026) — pode ser apagada quando qs_settings já
 * tiver `wa_respostas`. Copia as respostas prontas que existiam no Chatwoot
 * antes de ele sair, usando as variáveis que ainda estão na Vercel. Sem elas
 * (ou com o Chatwoot fora do ar), começa com a lista vazia — e grava a lista,
 * pra não tentar de novo a cada abertura.
 */
async function importarRespostasDoChatwoot() {
  let lista = [];
  const base = String(process.env.CHATWOOT_BASE_URL || 'https://chat.setuforeuvouviagens.com.br').replace(/\/+$/, '');
  const conta = String(process.env.CHATWOOT_ACCOUNT_ID || '1').trim();
  const token = String(process.env.CHATWOOT_AGENT_TOKEN || '').trim();
  if (token) {
    try {
      const r = await fetch(`${base}/api/v1/accounts/${conta}/canned_responses`, {
        headers: { api_access_token: token }, signal: AbortSignal.timeout(8000),
      });
      const d = await r.json().catch(() => null);
      const bruto = Array.isArray(d) ? d : (d?.payload || []);
      lista = bruto.map((c) => ({ atalho: c.short_code, texto: c.content }));
      console.log(`[wa-config] ${lista.length} respostas prontas copiadas do Chatwoot`);
    } catch (e) {
      console.warn('[wa-config] não consegui copiar as respostas do Chatwoot:', e?.message);
    }
  }
  try {
    return await salvarRespostas(lista);
  } catch (e) {
    console.warn('[wa-config] não consegui gravar as respostas prontas:', e?.message);
    return limparRespostas(lista);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // TODO POST SE ANUNCIA. A pergunta que custou a noite de 01/09 foi sempre a
  // mesma — "o clique virou requisição ou morreu no navegador?" — e o log não
  // respondia. POST aqui é raro (dezenas por dia), então a linha é barata.
  if (req.method === 'POST') console.log(`[wa-config] POST acao=${body.acao || '(sem acao)'}`);

  // ── RESPOSTAS PRONTAS: salvar (admin/gestor) ──────────────────────────────
  if (body.acao === 'respostas-salvar') {
    if (!(await ehAdmin(userId))) {
      return res.status(403).json({ error: 'Só administrador ou gestor edita as respostas prontas.' });
    }
    try {
      return res.status(200).json({ ok: true, respostas: await salvarRespostas(body.respostas) });
    } catch (e) {
      console.error('[wa-config] salvar respostas:', e?.message);
      return res.status(500).json({ error: 'Não consegui salvar as respostas prontas.' });
    }
  }

  // ── LIGAR PRO CLIENTE (Cloud API Calling) ─────────────────────────────────
  //
  // BLOCO PRÓPRIO, E ANTES DO PORTAL DE MODELOS — e o "antes" é a correção.
  // O portal de modelos abre com `req.method === 'POST'`, ou seja, TODO POST
  // desta rota caía nele, e a primeira linha dele é a trava de admin/gestor.
  // Resultado: a SDR clicava "Ligar" e tomava 403 dizendo
  // "Só administrador ou gestor gerencia os modelos" — uma frase sobre modelo
  // de mensagem, num botão de telefone. Ligar pro lead é o trabalho dela.
  //
  // O que continua sendo só de admin/gestor é o `calling-ativar`, que mexe na
  // configuração do NÚMERO inteiro na Meta: esse ficou lá embaixo, de propósito.
  //
  // A trava daqui é a que faz sentido pra esta ação: usuário que existe e está
  // ativo. Quem pode ver o lead pode ligar pra ele — a RLS já respondeu essa
  // pergunta antes do telefone tocar.
  const acoesDeChamada = new Set([
    'calling-ligar', 'calling-desligar', 'calling-permissao', 'calling-permissao-status',
    'calling-permissao-lote',
  ]);
  if (acoesDeChamada.has(String(body.acao || ''))) {
    const eu = await perfil(userId);
    if (!eu || eu.is_active === false) {
      return res.status(403).json({ error: 'Seu usuário está inativo — fale com o gestor.' });
    }
    if (!(await credenciaisDaMeta())) {
      return res.status(503).json({ error: 'O número oficial não está configurado (META_CALLS_TOKEN / META_PHONE_NUMBER_ID).' });
    }

    // O SDP vem do navegador (só ele tem microfone). O servidor é o carteiro:
    // leva o offer, devolve o `wacid`, e o áudio começa quando o webhook
    // `connect` trouxer o answer — que chega pelo wa-calls, não por aqui.
    if (body.acao === 'calling-ligar') {
      // A CONFERÊNCIA ANTES DA DISCAGEM. O `?conferir=0` existe pro caso de a
      // Graph API estar lenta e a pessoa preferir tentar direto — mas o padrão
      // é conferir, porque tomar 138006 depois de liberar o microfone é o
      // desperdício que essa consulta compra barato.
      if (body.conferir !== false) {
        const p = await sincronizarPermissao(body.telefone, body.leadId ?? null);
        // Erro da Meta NÃO barra: instabilidade da Graph API não pode virar
        // "ninguém liga hoje". Segue e deixa a própria discagem responder.
        if (!p?.erro && p.liberado === false) {
          // ── DUAS CAUSAS, UMA RECUSA ──────────────────────────────────────
          // `can_perform_action: false` no `start_call` significa "não pode
          // ligar agora", e isso acontece por dois motivos MUITO diferentes:
          //   • não há permissão            → o conserto é PEDIR;
          //   • há permissão, mas o teto de 5 chamadas atendidas em 24h com
          //     essa pessoa estourou       → o conserto é ESPERAR.
          //
          // Tratar os dois como falta de permissão fazia a tela mandar o SDR
          // pedir autorização a quem JÁ autorizou — e cada pedido desses queima
          // o limite de 1 por 24h, então o erro não era só de texto: gastava a
          // única bala que a pessoa tinha pro dia seguinte.
          const temPermissao = p.vale === true;
          if (temPermissao) {
            const lim = p.limiteLigar;
            return res.status(400).json({
              error: 'Essa pessoa autorizou, mas o limite de ligações das últimas 24 horas com ela já foi atingido'
                + (lim?.max_allowed ? ` (${lim.current_usage ?? lim.max_allowed} de ${lim.max_allowed}).` : '.')
                + ' Tente de novo mais tarde.',
              motivo: 'limite-de-chamadas',
              // Sem 138006 de propósito: é esse código que faz a tela virar o
              // botão pra "Pedir permissão", e aqui pedir seria o erro.
              permissao: { status: p.status, expiraEm: p.expiraEm, limite: lim },
            });
          }
          console.warn(`[wa-config] ligacao barrada por falta de permissao: …${String(body.telefone || '').slice(-4)} (status ${p.status}, pode pedir: ${p.podePedir})`);
          return res.status(400).json({
            error: 'Essa pessoa ainda não autorizou receber ligação da empresa. Mande o pedido de permissão pela conversa (ela precisa ter escrito nas últimas 24h).',
            motivo: 'sem-permissao',
            codigo: 138006,
            permissao: { status: p.status, expiraEm: p.expiraEm, podePedir: p.podePedir },
          });
        }
      }
      const r = await iniciarLigacao({ para: body.telefone, sdp: body.sdp, marcador: body.marcador });
      if (r.erro) {
        // 138006 é o único erro que tem conserto na tela: falta permissão.
        const dica = r.codigo === 138006
          ? ' — essa pessoa ainda não autorizou receber ligação da empresa. Mande o pedido de permissão pela conversa (ela precisa ter escrito nas últimas 24h).'
          : '';
        console.warn(`[wa-config] calling-ligar recusado: ${eu.name || userId} → ${String(body.telefone || '').slice(-4)} (${r.erro}${r.codigo ? ' ' + r.codigo : ''})`);
        return res.status(400).json({ error: (r.detalhe || r.erro) + dica, motivo: r.erro, codigo: r.codigo });
      }
      console.log(`[wa-config] ligacao iniciada por ${eu.name || userId}: ${r.callId}`);
      return res.status(200).json({ ok: true, callId: r.callId });
    }
    if (body.acao === 'calling-desligar') {
      const r = await encerrarLigacao(body.callId);
      if (r.erro) return res.status(400).json({ error: r.detalhe || r.erro, motivo: r.erro, codigo: r.codigo });
      return res.status(200).json({ ok: true });
    }
    if (body.acao === 'calling-permissao') {
      // Pedido de permissao pra ligar. NAO e template — e mensagem interativa,
      // e exige conversa ABERTA (a pessoa escreveu nas ultimas 24h).
      const r = await pedirPermissaoDeLigacao(body.telefone, body.texto);

      // ── 138017: "ja pode ligar pra essa pessoa" ──────────────────────────
      // NAO E ERRO — e a melhor noticia possivel, chegando com cara de falha.
      // A Meta recusa PEDIR uma permissao que ja existe, e o QS ficava repetindo
      // "a mensagem nao chega" sem entender que nao havia o que pedir.
      //
      // Aproveita pra APRENDER: pergunta o estado real e grava. O buraco era
      // esse — a permissao existia na Meta desde 31/08 e nunca existiu na nossa
      // tabela, porque a tabela so nasceu hoje e ninguem foi conferir o passado.
      if (r.codigo === 138017) {
        const p = await sincronizarPermissao(body.telefone, body.leadId ?? null);
        console.log(`[wa-config] 138017 — …${String(body.telefone || '').slice(-4)} JA tem permissao (status ${p?.status ?? '?'}); tabela atualizada`);
        return res.status(200).json({
          ok: true,
          jaTinha: true,
          mensagem: 'Essa pessoa já autorizou receber ligação — pode ligar direto.',
          permissao: p?.erro ? null : { status: p.status, expiraEm: p.expiraEm },
        });
      }

      if (r.erro) {
        // SEM ISTO A RECUSA ERA INVISÍVEL NO SERVIDOR. Só o navegador de quem
        // clicou via a mensagem — então "tentei e não foi" não tinha como ser
        // investigado depois, e a resposta mais provável (janela de 24h fechada)
        // é exatamente a que a pessoa não consegue diagnosticar sozinha.
        console.warn(`[wa-config] pedido de permissao recusado: ${eu.name || userId} → …${String(body.telefone || '').slice(-4)} (${r.erro}${r.codigo ? ' cod ' + r.codigo : ''}) ${r.detalhe || ''}`);
        return res.status(400).json({ error: r.detalhe || r.erro, motivo: r.erro, codigo: r.codigo });
      }
      console.log(`[wa-config] pedido de permissao enviado por ${eu.name || userId} → …${String(body.telefone || '').slice(-4)}`);
      // Marca que o pedido SAIU. Sem isso a tela não distingue "nunca pedimos"
      // de "pedimos e a pessoa não respondeu" — e é a diferença entre insistir
      // e queimar o limite de 1 pedido por 24h.
      await gravarPermissao(body.telefone, {
        lead_id: body.leadId ?? null, pedido_em: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, wamid: r.wamid });
    }
    // ── QUEM DA FILA PODE RECEBER LIGACAO ────────────────────────────────
    // A fila esconde a atividade de "Ligar no WhatsApp" de quem nao autorizou —
    // e pra decidir isso precisa SABER, o que a tabela sozinha nao resolve: ela
    // nasceu em 01/09 e quem autorizou antes disso nao tem linha nenhuma.
    //
    // TETO DE 25 e em PARALELO: sequencial estouraria o tempo da funcao, e sem
    // teto uma fila grande viraria centenas de idas a Graph API por
    // carregamento. Quem chama manda so os que ainda nao conhece — o resultado
    // fica gravado, entao cada telefone e perguntado UMA vez, nao toda vez.
    if (body.acao === 'calling-permissao-lote') {
      const lista = Array.isArray(body.telefones) ? body.telefones.slice(0, 25) : [];
      if (!lista.length) return res.status(200).json({ permissoes: {} });
      const pares = await Promise.all(lista.map(async (tel) => {
        try {
          const p = await sincronizarPermissao(tel, null);
          if (p?.erro) return null;
          return [String(tel).replace(/\D/g, ''), { status: p.status, expiraEm: p.expiraEm }];
        } catch { return null; }
      }));
      const mapa = Object.fromEntries(pares.filter(Boolean));
      console.log(`[wa-config] permissao em lote: ${Object.keys(mapa).length}/${lista.length} respondidos`);
      return res.status(200).json({ permissoes: mapa });
    }
    if (body.acao === 'calling-permissao-status') {
      const r = await sincronizarPermissao(body.telefone, body.leadId ?? null);
      if (r.erro) {
        // Este 400 era o último da rota a sair calado — e foi justamente ele que
        // apareceu no log de 01/09 como "400 sem motivo nenhum".
        console.warn(`[wa-config] permissao-status falhou: …${String(body.telefone || '').slice(-4)} (${r.erro}${r.codigo ? ' cod ' + r.codigo : ''}) ${r.detalhe || ''}`);
        // A Meta não respondeu — devolve o que o banco já sabia, dizendo que é
        // memória e não a verdade de agora. Melhor que uma tela em branco.
        const local = await lerPermissaoLocal(body.telefone);
        if (!local) return res.status(400).json({ error: r.detalhe || r.erro, motivo: r.erro, codigo: r.codigo });
        return res.status(200).json({
          status: local.status, expiraEm: local.expira_em, vale: permissaoVale(local),
          liberado: permissaoVale(local), fonte: local.fonte, desatualizado: true,
        });
      }
      return res.status(200).json(r);
    }
  }

  // ── PORTAL DE MODELOS (só admin/gestor) ───────────────────────────────────
  const querModelos = req.method === 'POST' || req.query?.modelos === 'todos';
  if (querModelos) {
    if (!(await ehAdmin(userId))) {
      return res.status(403).json({ error: 'Só administrador ou gestor gerencia os modelos.' });
    }

    if (req.method === 'GET') {
      const r = await listarModelos();
      if (r.erro) return res.status(503).json({ error: textoDeConfig(r.erro) || 'Não consegui ler os modelos na Meta.', motivo: r.erro });
      return res.status(200).json({ modelos: r.modelos });
    }

    if (body.acao === 'excluir') {
      const r = await excluirModelo(String(body.nome || ''));
      if (r.erro) return res.status(faltaConfig(r.erro) ? 503 : 400).json({ error: r.mensagem || textoDeConfig(r.erro) || 'Não consegui excluir.' });
      return res.status(200).json({ ok: true });
    }
    if (body.acao === 'criar') {
      const r = await criarModelo({
        nome: body.nome, categoria: body.categoria, idioma: body.idioma,
        corpo: body.corpo, cabecalho: body.cabecalho, rodape: body.rodape,
      });
      if (r.erro) return res.status(faltaConfig(r.erro) ? 503 : 400).json({ error: r.mensagem || textoDeConfig(r.erro) || 'Não consegui criar o modelo.' });
      return res.status(200).json({ ok: true, id: r.id, status: r.status });
    }
    if (body.acao === 'calling-ativar') {
      const r = await ativarChamadas();
      if (r.erro) return res.status(400).json({ error: r.detalhe || r.erro, motivo: r.erro, codigo: r.codigo });
      return res.status(200).json({ ok: true });
    }
    // ── PAINEL DE CONEXÃO (Cadastro Incorporado) ────────────────────────────
    if (body.acao === 'meta-conectar') {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const r = await conectarNumero({
        code: String(body.code || ''), wabaId: String(body.wabaId || ''), phoneId: String(body.phoneId || ''),
        modo: body.modo, pin: body.pin, userId: body.userId || null, rotulo: body.rotulo || null,
        por: userId, urlBase: `https://${host}`,
      });
      if (r.erro) {
        console.warn(`[wa-config] meta-conectar falhou: ${r.erro}`);
        return res.status(400).json({ error: r.erro });
      }
      console.log(`[wa-config] número conectado pelo painel: ${r.numero} (${body.modo || 'cloud'})`);
      return res.status(200).json(r);
    }
    if (body.acao === 'meta-desconectar') {
      const r = await desconectarNumero(body.phoneId);
      if (r.erro) return res.status(400).json({ error: r.erro });
      console.log(`[wa-config] número desconectado pelo painel: ${body.phoneId}`);
      return res.status(200).json(r);
    }
    if (body.acao === 'meta-cadastro-salvar') {
      const r = await salvarConfigCadastro({ configId: body.configId });
      if (r.erro) return res.status(400).json({ error: r.erro });
      return res.status(200).json(r);
    }

    // Aponta o webhook da Meta pro QS (mensagens + ligações). Ver _meta.js.
    if (body.acao === 'webhook-apontar') {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      if (!host) return res.status(400).json({ error: 'Não sei o endereço do QS.' });
      const r = await apontarWebhookProQs(`https://${host}`);
      if (r.erro) {
        console.warn(`[wa-config] webhook-apontar falhou (${r.erro}${r.etapa ? ' em ' + r.etapa : ''}): ${r.detalhe || ''}`);
        const texto = r.erro === 'sem-dados-do-app'
          ? 'Faltam META_CALLS_APP_ID, META_CALLS_APP_SECRET ou META_CALLS_VERIFY_TOKEN na Vercel.'
          : (textoDeConfig(r.erro) || `A Meta recusou${r.etapa ? ' (' + r.etapa + ')' : ''}: ${r.detalhe || r.erro}`);
        return res.status(400).json({ error: texto, motivo: r.erro, codigo: r.codigo });
      }
      console.log(`[wa-config] webhook da Meta apontado para ${r.callbackUrl}`);
      return res.status(200).json(r);
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  // O painel de conexão: números, saúde da entrada e a configuração do botão.
  if (req.query?.conexoes != null) {
    if (!(await ehAdmin(userId))) return res.status(403).json({ error: 'Só administrador ou gestor.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(await listarConexoes());
  }

  // Diagnóstico COMPLETO das chamadas: número, bloco calling, apps assinados.
  if (req.query?.calling === 'diag') {
    if (!(await ehAdmin(userId))) return res.status(403).json({ error: 'Só administrador ou gestor.' });
    const d = await diagnosticoChamadas();
    if (d.erro) return res.status(503).json({ error: textoDeConfig(d.erro) || 'Não achei o número oficial.', motivo: d.erro });
    let eventos = [];
    try {
      eventos = await rest('qs_wa_calls?select=recebido_em,evento,direcao,de,para&order=recebido_em.desc&limit=5');
    } catch (e) { console.warn('[wa-config] eventos de chamada:', e?.message); }
    return res.status(200).json({ ...d, eventos: Array.isArray(eventos) ? eventos : [] });
  }

  if (req.query?.calling === '1') {
    if (!(await ehAdmin(userId))) return res.status(403).json({ error: 'Só administrador ou gestor.' });
    const r = await lerConfigChamadas();
    if (r.erro) return res.status(503).json({ error: r.detalhe || r.erro, motivo: r.erro });
    return res.status(200).json(r);
  }

  // ── O PAINEL DO CHAT ──────────────────────────────────────────────────────
  const [respostas, modelos, caixa, eu] = await Promise.all([
    lerRespostas(), modelosAprovados(), caixaOficial(), perfil(userId),
  ]);
  const oficial = caixa != null
    ? [{ id: Number(caixa), nome: 'Número oficial', canal: 'Channel::Whatsapp', telefone: null }]
    : [];

  res.setHeader('Cache-Control', 'private, max-age=180');
  return res.status(200).json({
    respostas,
    inboxes: oficial,
    // `inboxId` em cada modelo: a tela antiga ainda filtra por ele.
    modelos: modelos.map((m) => ({ ...m, inboxId: caixa != null ? Number(caixa) : null })),
    padrao: caixa != null ? Number(caixa) : null,
    minhaLinha: caixa != null ? Number(caixa) : null,
    papel: eu?.role ?? null,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Os erros que significam "falta variável de ambiente", não "o pedido está errado". */
function faltaConfig(erro) {
  return erro === 'sem-caixa-oficial' || erro === 'sem-waba-id' || erro === 'sem-phone-number-id';
}

/** A frase que diz QUAL variável falta — sem isso o 503 vira adivinhação. */
function textoDeConfig(erro) {
  return {
    'sem-caixa-oficial': 'Sem credenciais da Meta. Preencha META_CALLS_TOKEN e META_PHONE_NUMBER_ID na Vercel.',
    'sem-waba-id': 'Não achei a conta do WhatsApp Business. Preencha META_WABA_ID na Vercel.',
    'sem-phone-number-id': 'Falta META_PHONE_NUMBER_ID — é o id do número oficial na Meta.',
  }[erro] || null;
}

