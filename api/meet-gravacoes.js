// api/meet-gravacoes.js
// -----------------------------------------------------------------------------
// CRON: GRAVAÇÃO + TRANSCRIÇÃO DO MEET → CARD DO QS (0314, 05/11/2026).
//
//   GET (Vercel Cron, a cada 15 min, Bearer CRON_SECRET)
//       → reuniões REALIZADAS dos últimos 3 dias, terminadas há > 20 min, ainda
//         sem gravação achada: lê o evento do Google Agenda, pega o vídeo e o
//         Doc da transcrição (ou Anotações do Gemini), baixa o texto e grava.
//   GET ?desde=2026-08-01   → carga das antigas (mesmo Bearer).
//   GET ?seco=1             → só lê o Google e mostra o que acharia; não grava
//                             nada no QS nem no Bitrix.
//   GET ?refazer=1          → ignora a espera entre tentativas e o teto (depois
//                             de liberar o acesso ao Drive, por exemplo).
//   GET ?id=<uuid>          → só uma reunião (teste).
//   GET ?limite=30          → quantas por chamada (padrão 12, máx. 30) — pra carga.
//
// Bitrix: DESLIGADO por padrão. Com MEET_GRAVACAO_BITRIX_LIGADO=1, cada reunião
// achada vira um comentário na timeline do negócio (links + texto até 50 mil
// caracteres) e marca bitrix_gravacao_em; falhou → tenta na rodada seguinte.
//
// A lógica (o que escolher, quando tentar, o comentário) está em
// api/_meetGravacoes.js, testada em tests/meet/*.test.ts.
// -----------------------------------------------------------------------------

import { rest, segredoConfere } from './_supabaseAdmin.js';
import { pulso } from './_rotinaPulso.js';
import { googleConfigurado, motivoNaoConfigurado } from './_google.js';
import { comentarNoNegocio, bitrixConfigurado } from './_bitrixLead.js';
import {
  decidirTentativa, escolherAnexos, statusDepois, cortarTexto, fimDaReuniao, codigoDoMeet,
  montarComentarioBitrix, dealIdDoLead, lerEvento, lerTextoDoDoc, buscarNoDrivePorCodigo,
  MAX_TENTATIVAS,
} from './_meetGravacoes.js';

const JANELA_DIAS = 3;
const LIMITE_POR_RODADA = 12;
const LIMITE_BITRIX = 10;
const PRAZO_MS = 45_000;           // maxDuration da rota é 60 s
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAMPOS = [
  'id', 'lead_id', 'title', 'lead_name', 'scheduled_at', 'ends_at', 'duration_min', 'status', 'meeting_link',
  'calendar_event_id', 'gravacao_url', 'transcricao_url', 'transcricao_tipo', 'gravacao_status',
  'gravacao_tentativas', 'gravacao_buscada_em', 'bitrix_gravacao_em',
].join(',');

const bitrixLigado = () => String(process.env.MEET_GRAVACAO_BITRIX_LIGADO || '').trim() === '1';

async function candidatas({ desdeIso, id, refazer }) {
  const corte = new Date(Date.now() - 20 * 60_000).toISOString();
  let q = `qs_meetings?select=${CAMPOS},lead:qs_leads(bitrix_id)&status=eq.realizada`;
  if (id) q += `&id=eq.${id}`;
  else {
    q += `&scheduled_at=gte.${encodeURIComponent(desdeIso)}&scheduled_at=lte.${encodeURIComponent(corte)}` +
      '&or=(gravacao_status.is.null,gravacao_status.in.(pendente,erro))';
    if (!refazer) q += `&gravacao_tentativas=lt.${MAX_TENTATIVAS}`;
  }
  q += '&order=scheduled_at.desc,id.desc&limit=300';
  const rows = await rest(q);
  return Array.isArray(rows) ? rows : [];
}

/** Uma reunião: lê o Google e (se não for seco) grava. Devolve o resumo. */
async function processarReuniao(m, { seco, ultima, signal }) {
  const agora = Date.now();
  const fim = fimDaReuniao(m);
  const resumo = { id: m.id, lead: m.lead_name, quando: m.scheduled_at };

  let anexos = [];
  let erroGoogle = null;
  let eventoSumiu = false;
  if (m.calendar_event_id) {
    const ev = await lerEvento(m.calendar_event_id, { signal });
    if (ev.ok) anexos = ev.anexos;
    if (!ev.ok || ev.sumiu) { erroGoogle = ev.motivo; eventoSumiu = !!ev.sumiu; }
  }
  let escolha = escolherAnexos(anexos);
  // Reserva: sem anexo no evento (ou sem evento) → procura no Drive pelo código do Meet.
  if (!escolha.video && !escolha.documento) {
    const achados = await buscarNoDrivePorCodigo(codigoDoMeet(m.meeting_link), { signal });
    const reserva = escolherAnexos(achados);
    if (reserva.video || reserva.documento) { escolha = reserva; erroGoogle = null; eventoSumiu = false; }
  }

  let texto = null;
  let cortada = false;
  let erroTexto = null;
  if (escolha.documento?.id) {
    const t = await lerTextoDoDoc(escolha.documento.id, { signal });
    if (t.ok) ({ texto, cortada } = cortarTexto(t.texto));
    else erroTexto = t.erro;
  }

  const status = statusDepois({
    video: escolha.video, documento: escolha.documento, textoOk: !!texto, erroTexto, erroGoogle, eventoSumiu, fim, agora, ultima,
  });
  let erro = erroGoogle || erroTexto || null;
  if (!erro && status === 'sem_gravacao') {
    erro = m.calendar_event_id
      ? 'Nenhuma gravação nem transcrição anexada ao evento do Google Agenda em 48 h — a reunião provavelmente não foi gravada (ou quem gravou não foi a conta organizadora).'
      : 'Reunião sem evento no Google Agenda e nada no Drive com o código do Meet.';
  }

  Object.assign(resumo, {
    status,
    video: escolha.video?.url || null,
    documento: escolha.documento ? { url: escolha.documento.url, tipo: escolha.documento.tipo, titulo: escolha.documento.titulo } : null,
    caracteres: texto ? texto.length : 0,
    cortada,
    erro,
  });
  if (seco) return resumo;

  // Grava. Primeiro o texto (tabela à parte), depois os metadados da reunião.
  if (texto) {
    await rest('qs_meeting_transcricoes?on_conflict=meeting_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        meeting_id: m.id, texto, tipo: escolha.documento.tipo, drive_file_id: escolha.documento.id,
        titulo: escolha.documento.titulo ? String(escolha.documento.titulo).slice(0, 500) : null,
        cortada, atualizada_em: new Date().toISOString(),
      },
    });
  }
  const patch = {
    gravacao_status: status,
    gravacao_buscada_em: new Date().toISOString(),
    gravacao_tentativas: (Number(m.gravacao_tentativas) || 0) + 1,
    gravacao_erro: erro ? String(erro).slice(0, 1000) : null,
  };
  // Link colado à mão manda: só preenche se estiver vazio.
  if (escolha.video?.url && !m.gravacao_url) patch.gravacao_url = escolha.video.url;
  if (escolha.documento?.url) {
    patch.transcricao_url = escolha.documento.url;
    patch.transcricao_tipo = escolha.documento.tipo;
  }
  if (texto) patch.transcricao_chars = texto.length;
  await rest(`qs_meetings?id=eq.${m.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  return resumo;
}

/** Comenta no Bitrix as achadas que ainda não foram (só com a env ligada). */
async function mandarProBitrix({ desdeIso, seco, inicio }) {
  if (!bitrixLigado()) return { ligado: false };
  if (!bitrixConfigurado()) return { ligado: true, erro: 'BITRIX_WEBHOOK_BASE ausente' };
  const rows = await rest(
    `qs_meetings?select=${CAMPOS},lead:qs_leads(bitrix_id)&status=eq.realizada&gravacao_status=eq.achada` +
      `&bitrix_gravacao_em=is.null&scheduled_at=gte.${encodeURIComponent(desdeIso)}` +
      `&order=scheduled_at.desc&limit=${LIMITE_BITRIX}`,
  );
  const feitos = [];
  for (const m of Array.isArray(rows) ? rows : []) {
    if (Date.now() - inicio > PRAZO_MS) break;
    const deal = dealIdDoLead(m.lead);
    if (!deal) { feitos.push({ id: m.id, ok: false, motivo: 'lead sem negócio no Bitrix' }); continue; }
    const tr = await rest(`qs_meeting_transcricoes?select=texto,tipo&meeting_id=eq.${m.id}`).catch(() => []);
    const t = Array.isArray(tr) ? tr[0] : null;
    const comentario = montarComentarioBitrix({
      m, gravacaoUrl: m.gravacao_url, transcricaoUrl: m.transcricao_url, texto: t?.texto, tipo: t?.tipo || m.transcricao_tipo,
    });
    if (seco) { feitos.push({ id: m.id, deal, ok: true, seco: true, tamanho: comentario.length }); continue; }
    const idComentario = await comentarNoNegocio(deal, comentario, 10_000);
    if (idComentario) {
      await rest(`qs_meetings?id=eq.${m.id}`, { method: 'PATCH', body: { bitrix_gravacao_em: new Date().toISOString() }, prefer: 'return=minimal' });
    }
    feitos.push({ id: m.id, deal, ok: !!idComentario });
  }
  return { ligado: true, feitos };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const veio = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!segredo || !segredoConfere(veio, segredo)) return res.status(401).json({ error: 'Não autorizado' });

  if (!googleConfigurado()) {
    // 12/11: pulava calado — o pulso faz o qs-alertas cobrar.
    await pulso('meet-gravacoes', { status: 'pulado', motivo: motivoNaoConfigurado() });
    return res.status(200).json({ ok: false, error: motivoNaoConfigurado() });
  }

  const q = req.query || {};
  const seco = String(q.seco || '') === '1';
  const refazer = String(q.refazer || '') === '1';
  const id = UUID.test(String(q.id || '')) ? String(q.id) : null;
  const desdeParam = String(q.desde || '').trim();
  const desdeIso = /^\d{4}-\d{2}-\d{2}$/.test(desdeParam)
    ? new Date(`${desdeParam}T00:00:00-03:00`).toISOString()
    : new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();

  const inicio = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PRAZO_MS + 8_000);
  try {
    let lista;
    try {
      lista = await candidatas({ desdeIso, id, refazer });
    } catch (e) {
      if (/gravacao_|transcricao_/.test(String(e?.message || ''))) {
        await pulso('meet-gravacoes', { status: 'pulado', motivo: 'Falta aplicar a migration 0314.' });
        return res.status(200).json({ ok: false, error: 'Falta aplicar a migration 0314 (colunas de gravação em qs_meetings).' });
      }
      throw e;
    }

    const agora = Date.now();
    const fila = [];
    let puladas = 0;
    for (const m of lista) {
      const d = decidirTentativa(m, agora, { refazer: refazer || !!id });
      if (d.tentar) fila.push({ m, ultima: d.ultima });
      else puladas++;
    }

    const feitas = [];
    const limite = Math.min(30, Math.max(1, Number(q.limite) || LIMITE_POR_RODADA));
    for (const { m, ultima } of fila.slice(0, limite)) {
      if (Date.now() - inicio > PRAZO_MS) break;
      try {
        feitas.push(await processarReuniao(m, { seco, ultima, signal: ctrl.signal }));
      } catch (e) {
        console.error('[meet-gravacoes]', m.id, e?.message);
        feitas.push({ id: m.id, status: 'falhou', erro: e?.message });
        if (!seco) {
          await rest(`qs_meetings?id=eq.${m.id}`, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: {
              gravacao_status: 'erro',
              gravacao_buscada_em: new Date().toISOString(),
              gravacao_tentativas: (Number(m.gravacao_tentativas) || 0) + 1,
              gravacao_erro: `Falha interna na busca: ${String(e?.message || e).slice(0, 300)}`,
            },
          }).catch(() => {});
        }
      }
    }

    const bitrix = await mandarProBitrix({ desdeIso, seco, inicio }).catch((e) => ({ ligado: true, erro: e?.message }));
    const contagem = feitas.reduce((acc, f) => ({ ...acc, [f.status]: (acc[f.status] || 0) + 1 }), {});
    if (!seco) await pulso('meet-gravacoes');
    return res.status(200).json({
      ok: true, seco, desde: desdeIso, candidatas: lista.length, na_fila: fila.length, puladas,
      processadas: feitas.length, contagem, feitas, bitrix,
    });
  } catch (e) {
    console.error('[meet-gravacoes]', e?.message);
    await pulso('meet-gravacoes', { status: 'erro', motivo: e?.message || 'falhou' });
    return res.status(500).json({ error: e?.message });
  } finally {
    clearTimeout(timer);
  }
}
