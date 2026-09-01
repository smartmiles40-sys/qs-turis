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
import { listarModelos, criarModelo, excluirModelo,
         lerConfigChamadas, ativarChamadas, pedirPermissaoDeLigacao,
         diagnosticoChamadas, iniciarLigacao, encerrarLigacao,
         lerPermissaoDeLigacao } from './_meta.js';
import {
  evoConfigured, listarInstancias, conectarInstancia, estadoInstancia,
  desconectarInstancia, reiniciarInstancia,
} from './_evolution.js';
import { rest } from './_supabaseAdmin.js';
import { sincronizarPermissao, gravarPermissao, lerPermissaoLocal, permissaoVale } from './_permissaoLigacao.js';

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
      const headerFormato = String(header?.format || 'TEXT').toUpperCase();
      // ATÉ 28/08 os de mídia eram descartados aqui, com este motivo: "exigem
      // anexar um arquivo no envio, e oferecer pra depois falhar é pior que não
      // oferecer". Continua verdade — a diferença é que agora existe quem saiba
      // mandar (o disparo de primeiro contato pede a URL do vídeo na tela).
      //
      // Então em vez de esconder, MARCA. Cada tela decide: a da Glória só usa
      // TEXT, porque a abordagem dela não tem onde pedir um link de mídia.
      modelos.push({
        inboxId: Number(i.id),
        nome: String(t.name || ''),
        idioma: String(t.language || 'pt_BR'),
        categoria: String(t.category || ''),
        cabecalho: header?.text || null,
        headerFormato,
        // true = o envio PRECISA de uma URL de mídia junto, senão a Meta recusa.
        precisaMidia: headerFormato === 'IMAGE' || headerFormato === 'VIDEO' || headerFormato === 'DOCUMENT',
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

  // TODO POST SE ANUNCIA. A pergunta que custou a noite de 01/09 foi sempre a
  // mesma — "o clique virou requisição ou morreu no navegador?" — e o log não
  // respondia: sem POST e POST-que-falhou-calado têm a mesma aparência (nenhuma).
  // POST aqui é raro (dezenas por dia), então a linha é barata e decisiva.
  if (req.method === 'POST') console.log(`[wa-config] POST acao=${body.acao || '(sem acao)'}`);

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
    if (!cwConfigured()) {
      return res.status(503).json({ error: 'O número oficial não está configurado no atendimento.' });
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
    // ── CHAMADAS (Cloud API Calling) ────────────────────────────────────
    // Trilho separado do de mensagem. Vive aqui, e nao numa rota nova, pela
    // mesma razao do resto do arquivo.
    if (body.acao === 'calling-ativar') {
      const r = await ativarChamadas();
      if (r.erro) return res.status(400).json({ error: r.detalhe || r.erro, motivo: r.erro, codigo: r.codigo });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Ação inválida.' });
  }

  // Diagnostico COMPLETO: numero, bloco calling inteiro, apps assinados na
  // WABA e — a pergunta que trava tudo — quais CAMPOS o app de chamadas assina.
  // Junto vao os ultimos eventos recebidos, pra tela responder "chegou algo?"
  // sem ninguem abrir o Supabase.
  if (req.query?.calling === 'diag') {
    if (!(await ehAdmin(userId))) return res.status(403).json({ error: 'Só administrador ou gestor.' });
    const d = await diagnosticoChamadas();
    if (d.erro) return res.status(503).json({ error: 'Não achei o número oficial no atendimento.', motivo: d.erro });
    let eventos = [];
    try {
      eventos = await rest('qs_wa_calls?select=recebido_em,evento,direcao,de,para&order=recebido_em.desc&limit=5');
    } catch (e) { console.warn('[wa-config] eventos de chamada:', e?.message); }
    return res.status(200).json({ ...d, eventos: Array.isArray(eventos) ? eventos : [] });
  }

  // Diagnostico de chamadas: diz se o numero esta MESMO com calling ligado.
  if (req.query?.calling === '1') {
    if (!(await ehAdmin(userId))) return res.status(403).json({ error: 'Só administrador ou gestor.' });
    const r = await lerConfigChamadas();
    if (r.erro) return res.status(503).json({ error: r.detalhe || r.erro, motivo: r.erro });
    return res.status(200).json(r);
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
