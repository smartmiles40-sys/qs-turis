// api/wa-config.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-config
//
// Devolve, numa chamada só, as listas que o painel de atendimento precisa
// ao abrir:
//   • respostas — as respostas prontas do Chatwoot (/atalho)
//   • inboxes   — os NÚMEROS que existem de verdade, pro SDR escolher por qual
//                 falar. Vem do Chatwoot (não da configuração) porque só existe
//                 caixa quando o número está conectado: assim o número oficial
//                 aparece sozinho no seletor no dia em que entrar no ar.
//   • modelos   — os templates APROVADOS na Meta (número oficial). O Chatwoot
//                 já sincroniza os templates de cada caixa Channel::Whatsapp;
//                 aqui só filtramos os aprovados e entregamos o corpo + as
//                 variáveis. É com eles que se abre conversa nova ou se fala
//                 fora da janela de 24h — texto livre a Meta recusa.
//
// Por que uma rota só em vez de duas: o plano da Vercel limita o projeto a 12
// funções, e nós estamos no teto. Fundir as duas consultas — que o front fazia
// lado a lado de qualquer jeito — devolve a folga e ainda corta uma ida ao
// servidor. Se um dia precisar de mais rotas, o caminho é consolidar as wa-*
// num despachante único (ou subir o plano), não espremer mais.
//
// Nenhuma das duas é crítica: falhou, devolve lista vazia. Sem atalhos e sem
// seletor o SDR ainda conversa normalmente.
// -----------------------------------------------------------------------------

import {
  getSupabaseUserId, cwConfigured, cw, defaultInboxId,
  caixaDoUsuario, lerCaixas, canalEhApiOficial,
} from './_wa.js';
import { listarModelos, criarModelo, excluirModelo } from './_meta.js';
import {
  evoConfigured, listarInstancias, conectarInstancia, estadoInstancia,
  desconectarInstancia, reiniciarInstancia,
} from './_evolution.js';
import { rest } from './_supabaseAdmin.js';

/** Só admin/gestor mexe nos modelos: eles vão pra análise da Meta em nome da
 *  empresa, e modelo reprovado sujando a conta afeta o número inteiro. */
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

// ── PAINEL DAS LINHAS (0056) ────────────────────────────────────────────────
//
// Junta, numa resposta só, as duas listas que nunca conversavam entre si:
// as CAIXAS do Chatwoot (por onde a mensagem sai) e as INSTÂNCIAS da Evolution
// (o WhatsApp que de fato está — ou não está — conectado). Cruzar as duas é o
// que responde a pergunta que ninguém conseguia responder sem SSH no VPS:
// "o número dos closers está no ar, e o QS sabe usar ele?".
//
// Os três defeitos que este cruzamento revela sozinho:
//   • instância no ar sem caixa no Chatwoot  → o número funciona, mas o QS não
//     recebe nem envia por ele (mensagem do cliente cai no vazio);
//   • caixa sem instância mapeada            → o QS envia e a checagem de
//     "número caído" olha o número errado, deixando passar envio que vai morrer;
//   • instância `close`                      → é este o estado do 1935 hoje.
async function montarLinhas() {
  const [caixasCw, instancias, mapa] = await Promise.all([
    listarCaixasDoChatwoot(),
    evoConfigured() ? listarInstancias().catch((e) => {
      console.warn('[wa-config] Evolution não respondeu:', e?.message);
      return null;
    }) : Promise.resolve(null),
    lerCaixas(true),
  ]);

  const porNome = new Map((instancias || []).map((i) => [i.nome, i]));
  const usadas = new Set();

  const caixas = caixasCw.map((c) => {
    const oficial = canalEhApiOficial(c.canal);
    const nomeInst = mapa.instancias?.[String(c.id)] || null;
    const inst = nomeInst ? porNome.get(nomeInst) : null;
    if (nomeInst) usadas.add(nomeInst);
    return {
      ...c,
      tipo: oficial ? 'oficial' : 'comum',
      // A caixa oficial não passa pela Evolution: quem responde por ela é a
      // Meta, e "sem instância" ali é o certo, não um defeito.
      instancia: oficial ? null : nomeInst,
      instanciaExiste: oficial ? null : Boolean(inst),
      status: oficial ? 'oficial' : (inst?.status ?? (nomeInst ? 'desconhecido' : 'sem-instancia')),
      numeroConectado: inst?.numero ?? null,
    };
  });

  return {
    caixas,
    instancias: (instancias || []).map((i) => ({
      ...i,
      // Instância que ninguém apontou pra uma caixa: candidata a ser justamente
      // o número que se quer ligar agora.
      caixa: Number(
        Object.entries(mapa.instancias || {}).find(([, nome]) => nome === i.nome)?.[0] ?? NaN
      ) || null,
      orfa: !usadas.has(i.nome),
    })),
    mapa,
    evolucao: evoConfigured(),
    // null (em vez de []) diz "não consegui perguntar", que é diferente de
    // "não há nenhuma" — a tela precisa distinguir pra não gritar lobo.
    evolucaoRespondeu: instancias !== null,
  };
}

async function buscarRespostas() {
  try {
    const data = await cw('/canned_responses');
    const list = Array.isArray(data) ? data : (data?.payload || []);
    return list
      .map((c) => ({ atalho: String(c.short_code || ''), texto: String(c.content || '') }))
      .filter((c) => c.atalho && c.texto);
  } catch (e) {
    console.warn('[wa-config] canned_responses:', e?.message);
    return [];
  }
}

/** Só as caixas (sem os modelos) — o painel de linhas não precisa de template. */
async function listarCaixasDoChatwoot() {
  const r = await buscarInboxes();
  return r.inboxes;
}

async function buscarInboxes() {
  try {
    const data = await cw('/inboxes');
    const list = Array.isArray(data?.payload) ? data.payload : [];
    const inboxes = list
      // Com a lista de caixas de WhatsApp configurada, ela manda. Sem ela,
      // devolvemos todas — melhor oferecer demais que travar o envio.
      // Só canais de WHATSAPP entram no seletor — a env virou atalho, não
      // requisito (mesma regra do inboxAceita): caixa de e-mail/site nunca deve
      // aparecer como "número pra falar", e a oficial nunca deve sumir por
      // alguém ter esquecido de somar o id na env.
      .filter((i) => /whatsapp|::api$/i.test(String(i.channel_type || '')))
      .map((i) => ({
        id: Number(i.id),
        nome: String(i.name || `Caixa ${i.id}`),
        canal: String(i.channel_type || ''),
        // O número em si, quando o Chatwoot sabe (as caixas da API oficial
        // trazem; as da Evolution vêm sem, e aí vale o nome da caixa). É o que
        // deixa o SDR ver "11 4863-6051" em vez de decorar nome de caixa.
        telefone: i.phone_number ? String(i.phone_number) : null,
      }));
    return { inboxes, modelos: extrairModelos(list) };
  } catch (e) {
    console.warn('[wa-config] inboxes:', e?.message);
    return { inboxes: [], modelos: [] };
  }
}

/**
 * Os templates que a Meta aprovou, já mastigados pro front: corpo com os
 * {{buracos}}, lista de variáveis na ordem, cabeçalho/rodapé quando são texto.
 * Só entram os APROVADOS — rascunho e rejeitado não podem ser enviados.
 */
function extrairModelos(inboxList) {
  const modelos = [];
  for (const i of inboxList) {
    if (!String(i.channel_type || '').includes('Channel::Whatsapp')) continue;
    for (const t of (Array.isArray(i.message_templates) ? i.message_templates : [])) {
      if (String(t.status || '').toLowerCase() !== 'approved') continue;
      const comp = Array.isArray(t.components) ? t.components : [];
      const corpo = comp.find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
      if (!corpo) continue;
      const header = comp.find((c) => String(c.type).toUpperCase() === 'HEADER');
      // Só oferecemos template de cabeçalho TEXTO: os de mídia exigem anexar um
      // arquivo no envio, e oferecer pra depois falhar é pior que não oferecer.
      if (header && String(header.format || 'TEXT').toUpperCase() !== 'TEXT') continue;
      modelos.push({
        inboxId: Number(i.id),
        nome: String(t.name || ''),
        idioma: String(t.language || 'pt_BR'),
        categoria: String(t.category || ''),
        cabecalho: header?.text || null,
        corpo,
        rodape: comp.find((c) => String(c.type).toUpperCase() === 'FOOTER')?.text || null,
        variaveis: [...corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]),
      });
    }
  }
  return modelos;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});

  // ── PAINEL DAS LINHAS (só admin/gestor) ───────────────────────────────────
  // Mora nesta rota, e não numa nova, pela mesma razão do resto do arquivo: o
  // projeto está no teto prático de funções da Vercel.
  //
  // A trava de papel aqui não é burocracia: quem enxerga o QR CODE de um número
  // pode PAREAR AQUELE WHATSAPP no próprio celular e ler toda a conversa do
  // comercial. É o segredo mais forte desta rota inteira — mais que o token do
  // Chatwoot, porque não deixa rastro no QS.
  const acoesDeLinha = new Set(['conectar', 'desconectar', 'reiniciar', 'estado']);
  const querLinhas = req.query?.linhas != null || acoesDeLinha.has(String(body.acao || ''));
  if (querLinhas) {
    if (!(await ehAdmin(userId))) {
      return res.status(403).json({ error: 'Só administrador ou gestor configura os números.' });
    }

    if (req.method === 'GET') {
      // Sem cache: esta tela existe pra responder "está no ar AGORA?".
      res.setHeader('Cache-Control', 'no-store');
      if (!cwConfigured()) return res.status(503).json({ error: 'Atendimento não configurado.' });
      return res.status(200).json(await montarLinhas());
    }

    const instancia = String(body.instancia || '').trim();
    if (!instancia) return res.status(400).json({ error: 'Diga qual número (instância).' });
    if (!evoConfigured()) {
      return res.status(503).json({ error: 'A Evolution não está configurada (EVOLUTION_URL / EVOLUTION_APIKEY).' });
    }

    try {
      if (body.acao === 'estado') {
        return res.status(200).json({ ok: true, estado: await estadoInstancia(instancia) });
      }
      if (body.acao === 'conectar') {
        const r = await conectarInstancia(instancia);
        // Sem QR e sem estar conectada = a Evolution respondeu, mas não com o
        // que pedimos. Devolver 200 com base64 nulo faria a tela girar pra
        // sempre esperando uma imagem.
        if (!r.jaConectada && !r.base64) {
          return res.status(502).json({
            error: 'A Evolution não devolveu o QR. Tente "Reiniciar o número" e peça o QR de novo.',
            motivo: 'sem-qr',
          });
        }
        return res.status(200).json({ ok: true, ...r });
      }
      if (body.acao === 'desconectar') {
        await desconectarInstancia(instancia);
        return res.status(200).json({ ok: true, estado: 'close' });
      }
      if (body.acao === 'reiniciar') {
        await reiniciarInstancia(instancia);
        return res.status(200).json({ ok: true, estado: await estadoInstancia(instancia) });
      }
    } catch (e) {
      console.error('[wa-config] linha', body.acao, instancia, e?.status || '', e?.message);
      if (e?.status === 404) {
        return res.status(404).json({ error: `A Evolution não conhece o número "${instancia}".` });
      }
      return res.status(502).json({ error: e?.message || 'A Evolution não respondeu.' });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  // ── PORTAL DE MODELOS (só admin/gestor) ───────────────────────────────────
  // Vive nesta rota, e não numa nova, pela mesma razão do resto do arquivo: o
  // projeto está no teto prático de funções da Vercel.
  const querModelos = req.method === 'POST' || req.query?.modelos === 'todos';
  if (querModelos) {
    if (!(await ehAdmin(userId))) {
      return res.status(403).json({ error: 'Só administrador ou gestor gerencia os modelos.' });
    }
    if (!cwConfigured()) return res.status(503).json({ error: 'Atendimento não configurado.' });

    if (req.method === 'GET') {
      const r = await listarModelos();
      if (r.erro) return res.status(503).json({ error: 'Não achei o número oficial no atendimento.', motivo: r.erro });
      return res.status(200).json({ modelos: r.modelos });
    }

    if (body.acao === 'excluir') {
      const r = await excluirModelo(String(body.nome || ''));
      if (r.erro) return res.status(r.erro === 'sem-caixa-oficial' ? 503 : 400).json({ error: r.mensagem || 'Não consegui excluir.' });
      return res.status(200).json({ ok: true });
    }
    if (body.acao === 'criar') {
      const r = await criarModelo({
        nome: body.nome, categoria: body.categoria, idioma: body.idioma,
        corpo: body.corpo, cabecalho: body.cabecalho, rodape: body.rodape,
      });
      if (r.erro) return res.status(r.erro === 'sem-caixa-oficial' ? 503 : 400).json({ error: r.mensagem || 'Não consegui criar o modelo.' });
      return res.status(200).json({ ok: true, id: r.id, status: r.status });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  if (!cwConfigured()) {
    return res.status(200).json({ respostas: [], inboxes: [], modelos: [], padrao: null });
  }

  const [respostas, caixas, eu] = await Promise.all([
    buscarRespostas(), buscarInboxes(), perfil(userId),
  ]);

  // O NÚMERO PADRÃO AGORA É DE CADA UM (0056). Era um só pra empresa inteira,
  // vindo da env — por isso o closer não tinha número no QS e caía no celular.
  // Sem mapa configurado, `caixaDoUsuario` devolve null e cai no de sempre.
  const minha = await caixaDoUsuario(eu);

  // Cache PRIVADO: a resposta agora depende de quem perguntou. Sem o `private`
  // (que já estava aqui) um proxy poderia servir a linha do closer pra SDR.
  res.setHeader('Cache-Control', 'private, max-age=180');
  return res.status(200).json({
    respostas,
    inboxes: caixas.inboxes,
    modelos: caixas.modelos,
    padrao: minha ?? defaultInboxId(),
    // Separado do `padrao` de propósito: o front usa isto pra dizer "seu
    // número" no seletor, sem confundir com a caixa da conversa aberta.
    minhaLinha: minha,
    papel: eu?.role ?? null,
  });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
