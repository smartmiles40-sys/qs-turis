// api/_waAlerta.js
// -----------------------------------------------------------------------------
// O miolo do monitor: compara o estado das instâncias da Evolution com o que
// vimos da última vez e decide o que merece um aviso no WhatsApp.
//
// Por que existe: em 06/08 o número dos Closers (o mesmo que está nos CTAs das
// LPs) ficou deslogado e ninguém percebeu — lead mandando mensagem pra um
// número morto. Nada no sistema gritava.
//
// A REGRA que evita spam: avisa na TRANSIÇÃO (estava no ar → caiu), não a cada
// verificação. Enquanto segue caído, repete no máximo de 6 em 6 horas, senão o
// monitor viraria ele mesmo o incômodo e o Bruno silenciaria a conversa — que é
// exatamente como um alerta morre.
//
// O estado mora em qs_settings.wa_monitor_estado (jsonb) porque a função
// serverless não guarda nada entre execuções.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { listarInstancias, noAr, sendText, evoConfigured, EVO_BASE } from './_evolution.js';
import { conferirRecebimento, textoDoAlerta } from './_waConferencia.js';

const CHAVE = 'wa_monitor_estado';
const REPETIR_MS = 6 * 60 * 60 * 1000;

/** Pra quem o alerta vai: WA_ALERTA_NUMEROS="5511999999999,5511888888888". */
export function destinos() {
  return String(process.env.WA_ALERTA_NUMEROS || '')
    .split(',')
    .map((n) => n.replace(/\D/g, ''))
    .filter((n) => n.length >= 12);
}

function agoraSP(iso) {
  // O pt-BR devolve "06/08, 12:00"; a vírgula no meio da frase atrapalha a
  // leitura ("voltou às 06/08, 12:00").
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(', ', ' ');
}

/** "3h20" — quanto tempo faz, em linguagem de gente. */
function faz(desdeIso, atéIso) {
  const ms = new Date(atéIso) - new Date(desdeIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

async function lerEstado() {
  try {
    const rows = await rest(`qs_settings?select=value&key=eq.${CHAVE}&limit=1`);
    const v = rows?.[0]?.value;
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    console.warn('[wa-monitor] não consegui ler o estado anterior:', e?.message);
    return {};
  }
}

async function salvarEstado(valor) {
  await rest('qs_settings', {
    method: 'POST',
    body: { key: CHAVE, value: valor, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/**
 * Compara o retrato de agora com o anterior e devolve os avisos a mandar.
 * Não manda nada — só decide. Fica testável e o caller escolhe o que fazer.
 */
export function decidir(anterior, atual, quando) {
  const antes = anterior?.instancias || {};
  const avisos = [];
  const novoEstado = {};

  for (const inst of atual) {
    const prev = antes[inst.nome];
    const up = noAr(inst.status);
    const eraUp = prev ? noAr(prev.status) : null;
    const desde = prev && prev.status === inst.status ? prev.desde : quando;

    let ultimoAviso = prev?.ultimoAviso || null;
    const rotulo = inst.numero ? `*${inst.nome}* (${inst.numero})` : `*${inst.nome}*`;

    if (eraUp === true && !up) {
      avisos.push({
        tipo: 'queda',
        instancia: inst.nome,
        texto:
          `🔴 *WhatsApp caiu*\n\n${rotulo} saiu do ar às ${agoraSP(quando)}.\n` +
          `Status: \`${inst.status}\`\n\n` +
          `Enquanto isso, mensagem que chegar nesse número não entra no QS.\n` +
          `Reconecte pelo Evolution Manager: ${EVO_BASE}`,
      });
      ultimoAviso = quando;
    } else if (eraUp === false && up) {
      const tempo = prev?.desde ? faz(prev.desde, quando) : null;
      avisos.push({
        tipo: 'volta',
        instancia: inst.nome,
        texto:
          `🟢 *WhatsApp reconectado*\n\n${rotulo} voltou às ${agoraSP(quando)}` +
          (tempo ? ` — ficou ${tempo} fora.` : '.'),
      });
      ultimoAviso = null;
    } else if (!up && (!ultimoAviso || quando - new Date(ultimoAviso) > REPETIR_MS)) {
      // Primeira vez que vemos essa instância (já caída) ou lembrete periódico.
      const tempo = desde ? faz(desde, quando) : null;
      avisos.push({
        tipo: eraUp === null ? 'queda' : 'lembrete',
        instancia: inst.nome,
        texto:
          `🔴 *WhatsApp segue fora*\n\n${rotulo} está \`${inst.status}\`` +
          (tempo ? ` há ${tempo}` : '') + `.\n\nReconecte: ${EVO_BASE}`,
      });
      ultimoAviso = quando;
    }

    novoEstado[inst.nome] = { status: inst.status, desde, ultimoAviso };
  }

  // Instância que sumiu do servidor. Aconteceu de verdade com o número dos SDRs
  // (4441): a instância deixou de existir e o inbox do Chatwoot ficou órfão —
  // silencioso e pior que uma queda, porque nem status ruim havia pra ver.
  for (const nome of Object.keys(antes)) {
    if (atual.some((i) => i.nome === nome)) continue;
    avisos.push({
      tipo: 'sumiu',
      instancia: nome,
      texto:
        `⚠️ *Instância sumiu*\n\n*${nome}* não existe mais no servidor da ` +
        `Evolution (às ${agoraSP(quando)}).\n\nSe foi sem querer, é preciso ` +
        `recriar a instância E religar no Chatwoot — só escanear o QR não basta.`,
    });
  }

  return { avisos, novoEstado: { instancias: novoEstado, verificadoEm: new Date(quando).toISOString() } };
}

/**
 * Manda os avisos por WhatsApp usando QUALQUER instância que ainda esteja no ar.
 * Se nenhuma estiver, não há por onde falar — devolve entregue:false e quem
 * chamou decide (o wa-monitor responde 503 pra o próprio agendador reclamar).
 */
export async function entregar(avisos, instancias) {
  const numeros = destinos();
  if (!avisos.length) return { entregue: true, enviados: 0 };
  if (!numeros.length) {
    console.warn('[wa-monitor] WA_ALERTA_NUMEROS vazio — nada a notificar');
    return { entregue: false, enviados: 0, motivo: 'sem-destinatario' };
  }

  const emissor = instancias.find((i) => noAr(i.status));
  if (!emissor) {
    console.error('[wa-monitor] nenhuma instância no ar — impossível avisar por WhatsApp');
    return { entregue: false, enviados: 0, motivo: 'sem-instancia-no-ar' };
  }

  let enviados = 0;
  for (const aviso of avisos) {
    for (const numero of numeros) {
      try {
        await sendText(emissor.nome, numero, aviso.texto);
        enviados += 1;
      } catch (e) {
        console.error(`[wa-monitor] falha ao avisar ${numero}:`, e?.message);
      }
    }
  }
  return { entregue: enviados > 0, enviados, via: emissor.nome };
}

/**
 * Uma verificação completa: lê o servidor, compara, avisa, guarda.
 * Devolve o resumo pra rota responder (e pro agendador enxergar no log).
 */
export async function verificar() {
  if (!evoConfigured()) {
    const err = new Error('EVOLUTION_URL / EVOLUTION_APIKEY não configurados');
    err.code = 'CONFIG';
    throw err;
  }

  const quando = Date.now();
  const instancias = await listarInstancias();
  const anterior = await lerEstado();
  const { avisos, novoEstado } = decidir(anterior, instancias, quando);

  // MENSAGEM QUE NÃO CHEGOU NO QS — a outra metade do "está tudo funcionando?".
  // Número no ar não garante nada: em 10/08 o WhatsApp estava perfeito e 25
  // mensagens ficaram só no Chatwoot. Best-effort: a conferência nunca pode
  // derrubar o monitor dos números, que é o trabalho principal dele.
  let conferencia = null;
  try {
    conferencia = await conferirRecebimento();
    if (conferencia.faltando.length) {
      avisos.push({
        tipo: 'mensagem-nao-recebida',
        instancia: 'QS',
        texto: textoDoAlerta(conferencia.faltando),
      });
    }
  } catch (e) {
    console.warn('[wa-monitor] conferência de recebimento falhou:', e?.message);
  }

  const envio = await entregar(avisos, instancias);

  // Grava mesmo se o envio falhou: o estado é o retrato do servidor, não do
  // aviso. `ultimoAviso` só some se a entrega funcionou — assim um alerta que
  // não saiu é tentado de novo na próxima rodada em vez de ficar marcado como
  // avisado.
  if (!envio.entregue) {
    for (const aviso of avisos) {
      const linha = novoEstado.instancias[aviso.instancia];
      if (linha) linha.ultimoAviso = anterior?.instancias?.[aviso.instancia]?.ultimoAviso || null;
    }
  }
  await salvarEstado(novoEstado);

  return {
    instancias: instancias.map((i) => ({ nome: i.nome, status: i.status, numero: i.numero })),
    avisos: avisos.map((a) => ({ tipo: a.tipo, instancia: a.instancia })),
    // O placar da conferência sai no corpo da resposta: é como o Bruno confere
    // "chegou tudo?" abrindo a URL do monitor, sem depender de receber alerta.
    recebimento: conferencia
      ? { conferidas: conferencia.conferidas, faltando: conferencia.faltando.length, detalhe: conferencia.faltando.slice(0, 5) }
      : { erro: 'nao-conferido' },
    ...envio,
  };
}

/**
 * A mesma verificação, mas só se já passou tempo bastante desde a última.
 *
 * POR QUE EXISTE: até 19/08 o vigia dependia de UM agendador externo
 * (UptimeRobot) batendo na rota. Ele parou de disparar em 17/08 às 15:13 e
 * ninguém percebeu por dois dias — um vigia morto é pior que nenhum, porque o
 * silêncio parece "está tudo bem". Agora o próprio movimento do QS aciona o
 * vigia: cada mensagem que chega do Chatwoot passa por aqui, e uma em cada
 * ~50 (a primeira depois da trava vencer) faz a ronda.
 *
 * A trava mora no banco (`verificadoEm`), não em memória: função serverless
 * não guarda nada entre execuções e há várias rodando ao mesmo tempo.
 *
 * NUNCA lança. Quem chama é um webhook cuja obrigação é responder 200 ao
 * Chatwoot — vigia com defeito não pode derrubar a entrada de mensagem.
 */
export async function verificarSeVencido(maxIdadeMs = 10 * 60 * 1000) {
  try {
    if (!evoConfigured()) return { pulou: true, motivo: 'sem-config' };

    const estado = await lerEstado();
    const ultimo = estado?.verificadoEm ? new Date(estado.verificadoEm).getTime() : 0;
    const idade = Date.now() - ultimo;
    if (Number.isFinite(idade) && idade < maxIdadeMs) {
      return { pulou: true, motivo: 'recente', idadeMs: idade };
    }

    // Marca a vez ANTES de trabalhar. Duas mensagens que cheguem no mesmo
    // segundo não podem virar duas rondas — a segunda vê o carimbo novo e sai.
    await salvarEstado({ ...estado, verificadoEm: new Date().toISOString() });

    const resumo = await verificar();
    return { pulou: false, ...resumo };
  } catch (e) {
    // Evolution fora do ar cai aqui — e é EXATAMENTE o caso que não pode
    // passar em silêncio. Registra pro QS conseguir mostrar na tela.
    console.error('[vigia] ronda falhou:', e?.message);
    try {
      const estado = await lerEstado();
      await salvarEstado({
        ...estado,
        falha: { em: new Date().toISOString(), motivo: String(e?.message || 'erro') },
      });
    } catch { /* banco fora também: não há mais o que fazer aqui */ }
    return { pulou: false, erro: String(e?.message || 'erro') };
  }
}

/**
 * Há quanto tempo o vigia não roda, e o que ele viu por último.
 * É o que a tela do QS mostra — o silêncio precisa ser visível.
 */
export async function saudeDoVigia() {
  const estado = await lerEstado();
  const ultimo = estado?.verificadoEm ? new Date(estado.verificadoEm).getTime() : null;
  const instancias = Object.entries(estado?.instancias || {}).map(([nome, v]) => ({
    nome, status: v?.status || null, noAr: noAr(v?.status), desde: v?.desde || null,
  }));
  return {
    verificadoEm: estado?.verificadoEm || null,
    paradoHaMs: ultimo ? Date.now() - ultimo : null,
    falha: estado?.falha || null,
    instancias,
    caidas: instancias.filter((i) => !i.noAr).map((i) => i.nome),
  };
}
