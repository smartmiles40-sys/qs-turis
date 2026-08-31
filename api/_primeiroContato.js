// api/_primeiroContato.js
// -----------------------------------------------------------------------------
// A MENSAGEM AUTOMATICA DE PRIMEIRO CONTATO — a regra, sem a porta HTTP.
//
// Este arquivo nasceu de `api/primeiro-contato.js` por um motivo so: o disparo
// precisava acontecer em DOIS lugares.
//
//   1. quando o Bitrix/n8n manda (POST /api/primeiro-contato) — como era
//   2. quando o LEAD NASCE no proprio QS (api/lead-inbound.js) — o novo
//
// Enquanto a regra morava dentro do handler, o caminho (2) so existia
// remontando um POST pra propria Vercel: mais uma chamada de rede, mais um
// segredo pra conferir e mais um erro pra acontecer calado no meio. Agora e
// chamada de funcao, no mesmo processo que acabou de criar o lead.
//
// -- ESTA FUNCAO NAO LEVANTA EXCECAO ------------------------------------------
//
// Quem chama do `lead-inbound` esta no meio de criar um lead PAGO. Falhar aqui
// nao pode derrubar aquilo: lead de trafego perdido nao tem desfazer. Entao
// todo caminho — configuracao ilegivel, Meta fora, Supabase fora — sai por
// `return` com `motivo`, nunca por `throw`. A porta HTTP traduz o motivo em
// status; o `lead-inbound` so registra no log.
//
// -- POR QUE O ENVIO NAO PASSA PELO CHATWOOT ----------------------------------
//
// O resto do QS manda WhatsApp pelo Chatwoot de proposito, pra mensagem cair na
// conversa e aparecer na tela do SDR. Este disparo e a excecao, por duas razoes
// que so valem pra ele:
//
//   1. O video NAO precisa aparecer pra equipe (Bruno, 28/08). E disparo, nao
//      conversa. A conversa comeca quando o lead responde — e a resposta entra
//      pelo caminho normal, via wa-webhook.
//   2. O Chatwoot NAO entrega template com cabecalho de midia: a issue #13159
//      mostra que ele monta payload invalido pra Meta e a mensagem fica presa
//      em "sending", sem erro.
//
// De quebra isso libera o `media_id`: o video sobe UMA vez e vale 30 dias, em
// vez de a Meta baixar 5,7 MB do bucket a cada lead.
//
// -- ORDEM DAS TRAVAS, E POR QUE ESSA -----------------------------------------
//
// O dedupe e RESERVADO ANTES do envio, nao depois. Se viesse depois, uma falha
// de rede no meio deixaria o lead sem registro e o proximo retry mandaria de
// novo. Reservar antes troca "mandou duas vezes" (que vira bloqueio no
// WhatsApp) por "pode nao ter mandado" (que fica registrado como falhou).
// -----------------------------------------------------------------------------

import { enviarTemplate, subirMidiaPorUrl } from './_meta.js';
import { rest, insert } from './_supabaseAdmin.js';

export const CHAVE_CONFIG = 'primeiro_contato_auto';
const TETO_PADRAO = 200;
/** Dias antes de re-subir a midia. A Meta guarda por 30; 25 da folga. */
const MIDIA_VALIDA_DIAS = 25;

/**
 * Normaliza para E.164 BR de celular. Mesma regra do `Code` que rodava no n8n,
 * trazida pra ca de proposito: validacao que mora no encanamento e validacao
 * que ninguem le — foi exatamente assim que o disparo antigo saia com o
 * telefone vazio sem ninguem notar.
 */
export function normalizarCelular(bruto) {
  const candidatos = String(bruto || '')
    .split(/[,;/|]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);

  for (const c of candidatos) {
    let d = c;
    if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
    if (!d.startsWith('55')) continue;
    const ddd = d.slice(2, 4);
    let num = d.slice(4);
    // Celular antigo de 8 digitos ganha o 9 que a Meta exige.
    if (num.length === 8 && /^[6-9]/.test(num)) num = '9' + num;
    // Fixo nao recebe WhatsApp. Barrar aqui e melhor que a Meta recusar depois.
    if (num.length !== 9 || num[0] !== '9') continue;
    return '55' + ddd + num;
  }
  return null;
}

/**
 * A configuracao da tela (Configuracoes -> Mensagem Automatica).
 * Lanca quando nao consegue ler — "nao li" e diferente de "esta desligada", e
 * confundir os dois faria o disparo morrer em silencio num dia de Supabase
 * lento. Quem chama trata.
 */
export async function lerConfig() {
  const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE_CONFIG}&limit=1`);
  return rows?.[0]?.value || {};
}

/**
 * O gatilho escolhido na tela: 'lead_novo' (o QS dispara sozinho quando o card
 * nasce) ou 'externo' (so quando o Bitrix/n8n mandar).
 *
 * O padrao e 'lead_novo' porque e o que o Bruno pediu em 31/08 e porque a
 * alternativa — cair em 'externo' quando a chave falta — desligaria o disparo
 * automatico em silencio num lugar onde ninguem ia procurar.
 */
export function gatilhoDe(cfg) {
  return cfg?.gatilho === 'externo' ? 'externo' : 'lead_novo';
}

/** Quantos JA sairam hoje, no fuso de Sao Paulo (o do time, nao o do UTC). */
async function enviadosHoje() {
  const agora = new Date();
  const emSP = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const meiaNoite = new Date(emSP); meiaNoite.setHours(0, 0, 0, 0);
  const desde = new Date(agora.getTime() - (emSP.getTime() - meiaNoite.getTime())).toISOString();
  try {
    const r = await rest(
      `qs_primeiro_contato?select=lead_id&status=eq.enviado` +
      `&criado_em=gte.${encodeURIComponent(desde)}&limit=2000`
    );
    return Array.isArray(r) ? r.length : 0;
  } catch (e) {
    // Na duvida, o numero que TRAVA. Teto que falha aberto nao e teto.
    console.warn('[primeiro-contato] nao consegui contar os de hoje:', e?.message);
    return Number.MAX_SAFE_INTEGER;
  }
}

/** Grava o desfecho na linha ja reservada. Best-effort: nunca derruba o envio. */
async function fecharRegistro(leadId, patch) {
  try {
    await rest(`qs_primeiro_contato?lead_id=eq.${encodeURIComponent(leadId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { ...patch, atualizado_em: new Date().toISOString() },
    });
  } catch (e) {
    console.warn('[primeiro-contato] registro nao fechou:', e?.message);
  }
}

/**
 * Devolve a midia pronta pro envio: `{ id }` quando ha upload valido, `{ url }`
 * como plano B. Grava o id novo na configuracao pro proximo disparo.
 */
async function prepararMidia(cfg) {
  if (!cfg.midia?.url) return null;

  const idade = cfg.midia.subido_em
    ? (Date.now() - new Date(cfg.midia.subido_em).getTime()) / 86400000
    : Infinity;
  if (cfg.midia.media_id && idade < MIDIA_VALIDA_DIAS) return { id: cfg.midia.media_id };

  const up = await subirMidiaPorUrl(cfg.midia.url);
  if (up.erro) {
    // Nao e fatal: da pra mandar por link. Perde a economia, nao o lead.
    console.warn(`[primeiro-contato] upload da midia falhou (${up.erro}); indo por link`);
    return { url: cfg.midia.url };
  }

  try {
    await rest(`qs_settings?key=eq.${CHAVE_CONFIG}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: {
        value: {
          ...cfg,
          midia: { ...cfg.midia, media_id: up.id, subido_em: new Date().toISOString() },
        },
      },
    });
  } catch (e) {
    // Se nao gravou, o pior que acontece e subir de novo no proximo disparo.
    console.warn('[primeiro-contato] media_id nao gravado:', e?.message);
  }
  return { id: up.id };
}

/**
 * Traduz os apelidos escolhidos na tela. A lista PRECISA bater com a do card e
 * com a da tela: apelido que so existe de um lado vira variavel vazia, e
 * variavel vazia a Meta recusa o template inteiro.
 */
export function montarParams(mapa, lead) {
  const nome = String(lead?.full_name || lead?.first_name || '').trim();
  const primeiro = (lead?.first_name || nome.split(/\s+/)[0] || '').trim();
  const apelidos = {
    nome: nome || primeiro,
    primeiro_nome: primeiro,
    expedicao: String(lead?.segment || '').trim(),
    empresa: 'Se Tu For, Eu Vou',
  };
  const saida = {};
  for (const [chave, bruto] of Object.entries(mapa)) {
    const v = String(bruto ?? '');
    const ref = v.match(/^\s*\{\{\s*([a-z_]+)\s*\}\}\s*$/i);
    saida[chave] = ref ? String(apelidos[ref[1].toLowerCase()] ?? '').trim() : v;
  }
  return saida;
}

/**
 * DISPARA (ou explica por que nao disparou).
 *
 * @param {object}  p
 * @param {object}  p.lead      o lead JA existente no QS (precisa de id)
 * @param {string} [p.telefone] E.164 pronto; quando falta, sai do `lead.phone`
 * @param {string} [p.origem]   de onde veio o gatilho ('bitrix', 'lead-novo'...)
 * @param {object} [p.cfg]      a configuracao ja lida (evita reler)
 *
 * @returns {Promise<{ok:boolean, motivo?:string}>} nunca lanca.
 *
 * Motivos possiveis, todos DITOS (nenhum silencio):
 *   sem_config · desligado · sem_template · telefone_invalido · lead_inexistente
 *   reserva_falhou · ja_enviado · teto_do_dia · envio_falhou · erro
 */
export async function dispararPrimeiroContato({ lead, telefone, origem = 'api', cfg = null }) {
  try {
    if (!lead?.id) return { ok: false, motivo: 'lead_inexistente' };

    // ── A configuracao da tela ──────────────────────────────────────────────
    let conf = cfg;
    if (!conf) {
      try {
        conf = await lerConfig();
      } catch (e) {
        console.error('[primeiro-contato] nao li a configuracao:', e?.message);
        return { ok: false, motivo: 'sem_config', detalhe: 'Nao consegui ler a configuracao.' };
      }
    }
    if (conf?.ativo !== true) {
      return { ok: false, motivo: 'desligado', detalhe: 'Ligue em Configuracoes -> Mensagem Automatica.' };
    }
    if (!conf.template?.nome) {
      return { ok: false, motivo: 'sem_template', detalhe: 'Escolha o modelo aprovado na tela.' };
    }

    // ── O telefone ──────────────────────────────────────────────────────────
    const fone = telefone || normalizarCelular(lead.phone);
    if (!fone) {
      return {
        ok: false, motivo: 'telefone_invalido',
        detalhe: 'Telefone nao e um celular brasileiro valido (fixo ou numero incompleto nao recebe WhatsApp).',
      };
    }

    // ── DEDUPE: reserva ANTES de enviar (ver cabecalho) ─────────────────────
    // Sao DUAS travas, e a segunda so existe desde a 0069: a chave primaria
    // (o mesmo lead) e o indice unico do TELEFONE (a mesma pessoa em outro
    // card). Sem a segunda, uma carga de lista com `duplicar=1` mandaria o
    // video de boas-vindas de novo pra quem ja tinha recebido, num card novo.
    // `ON CONFLICT DO NOTHING` cobre as duas: linha nao criada = ja passou por
    // aqui, e o retorno vazio e o sinal.
    let reservou = false;
    try {
      const r = await rest('qs_primeiro_contato', {
        method: 'POST',
        prefer: 'return=representation,resolution=ignore-duplicates',
        body: {
          lead_id: lead.id, telefone: fone, template: conf.template.nome,
          status: 'pendente', origem: String(origem).slice(0, 40),
        },
      });
      reservou = Array.isArray(r) && r.length > 0;
    } catch (e) {
      console.error('[primeiro-contato] reserva falhou:', e?.message);
      return { ok: false, motivo: 'reserva_falhou', detalhe: 'Nao consegui reservar o disparo.' };
    }
    if (!reservou) return { ok: false, motivo: 'ja_enviado', lead_id: lead.id };

    // ── O teto do dia ───────────────────────────────────────────────────────
    const teto = Number(conf.teto_dia ?? TETO_PADRAO);
    const hoje = await enviadosHoje();
    if (Number.isFinite(teto) && teto > 0 && hoje >= teto) {
      await fecharRegistro(lead.id, { status: 'bloqueado', motivo: `teto_do_dia (${hoje}/${teto})` });
      return { ok: false, motivo: 'teto_do_dia', hoje, teto, lead_id: lead.id };
    }

    // ── A midia: sobe uma vez, reusa por 30 dias ────────────────────────────
    const midia = await prepararMidia(conf);
    const formatoMidia = String(conf.midia?.tipo || 'video').toUpperCase();

    // ── O ENVIO, DIRETO NA CLOUD API (ver cabecalho) ────────────────────────
    const params = montarParams(conf.template.params || {}, lead);
    const r = await enviarTemplate({
      para: fone,
      nome: conf.template.nome,
      idioma: conf.template.idioma || 'pt_BR',
      params,
      midia,
      formatoMidia,
    });

    if (r.erro) {
      const humano = {
        'sem-caixa-oficial': 'Nao achei o numero oficial no atendimento.',
        'sem-phone-number-id': 'A caixa oficial esta sem phone_number_id no Chatwoot.',
        'meta-recusou': `A Meta recusou: ${r.detalhe || 'sem detalhe'}`,
      }[r.erro] || r.erro;
      console.error(`[primeiro-contato] envio falhou lead=${lead.id} :: ${humano}`);
      await fecharRegistro(lead.id, { status: 'falhou', motivo: String(humano).slice(0, 300) });
      return { ok: false, motivo: 'envio_falhou', erro: r.erro, detalhe: humano, codigo: r.codigo };
    }

    // ── DAQUI PRA BAIXO A MENSAGEM JA SAIU ──────────────────────────────────
    // Nada abaixo pode virar "nao consegui enviar": o cliente ja recebeu, e um
    // erro aqui faria alguem reenviar.
    await fecharRegistro(lead.id, {
      status: 'enviado',
      motivo: r.wamid ? `wamid: ${r.wamid}` : null,
    });

    // O video nao entra na thread (decisao de 28/08), mas o CARD precisa contar
    // que ele saiu — senao o SDR abre um lead que respondeu "quanto custa?" sem
    // saber o que a pessoa viu antes.
    try {
      await insert('qs_notes', {
        lead_id: lead.id,
        author_id: null,
        body: `📹 Video de apresentacao enviado automaticamente (primeiro contato).\nModelo: ${conf.template.nome}`,
        tags: ['primeiro-contato', 'automatico'],
      }, { returning: false });
    } catch (e) {
      console.warn('[primeiro-contato] nota nao criada:', e?.message);
    }

    return {
      ok: true, lead_id: lead.id, telefone: fone,
      template: conf.template.nome,
      midia: midia?.id ? 'media_id' : (midia?.url ? 'link' : 'sem_midia'),
      wamid: r.wamid,
      enviados_hoje: hoje + 1, teto,
    };
  } catch (err) {
    // A rede de seguranca da promessa do cabecalho: daqui nao sai excecao.
    console.error('[primeiro-contato] erro inesperado:', err?.message || err);
    return { ok: false, motivo: 'erro', detalhe: err?.message || String(err) };
  }
}
