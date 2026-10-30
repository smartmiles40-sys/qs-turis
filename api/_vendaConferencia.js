// api/_vendaConferencia.js
// -----------------------------------------------------------------------------
// ANÁLISE PÓS-VENDA — o motor DETERMINÍSTICO (Bruno 30/10/2026): "a IA pega o
// pacote apresentado ao cliente (a proposta) e cruza com tudo o que foi
// EMITIDO (vouchers, bilhetes, reservas) e dá um EXTRATO do que falta emitir;
// e analisa o RISCO da venda".
//
// Este arquivo NÃO chama IA nem banco: recebe os três lados já carregados e
// devolve o extrato + os riscos por regra. É a BASE da análise — sem a chave
// da OpenAI a análise roda só com isto ("modo regras"). A IA (api/venda-analise.js)
// só COMPLEMENTA os riscos e o texto. Testado offline em scripts/teste-conferencia.mjs.
//
//   conferirVenda({ apresentado, proposta, vendido, emitido, pessoas, viajantes,
//                   pagamento, total_venda, hoje }) →
//     { status, base, contagens, linhas[], riscos[], risco_nivel, faltam[], resumo, inicio, fim }
//
// Lados:
//   • APRESENTADO = itens da opção APROVADA da proposta (qs_proposta_itens).
//     Sem proposta, a base é o próprio VENDIDO (e isso vira risco).
//   • VENDIDO     = qs_venda_itens da venda (ou o rascunho da tela).
//   • EMITIDO     = evidências: trechos emitidos (rel_viagem_trechos), itens da
//     venda com status 'emitido' ou com localizador/apólice, documentos da
//     viagem (rel_documentos voucher/bilhete/seguro) e o que a IA leu do
//     voucher na própria tela. Cada evidência cobre UM item só.
//
// Situação de cada linha:  ok | falta | divergente | extra (emitido fora do apresentado)
// Status da venda (prioridade): risco_alto > divergencia > faltam_emissoes > tudo_emitido
// -----------------------------------------------------------------------------
import { compararNomes, nomeLimpo, paisDoIata } from './_vendaVoucher.js';

const txt = (v) => (v == null ? '' : String(v).trim());
const dataOk = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(txt(s)); return m && !Number.isNaN(Date.parse(`${m[1]}T12:00:00Z`)) ? m[1] : ''; };
const BR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const semAcento = (s) => txt(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const iata = (s) => { const m = /\b([A-Z]{3})\b/.exec(txt(s).toUpperCase()); return m ? m[1] : ''; };
const num = (v) => { const n = typeof v === 'string' ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
const brl = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const unicos = (a) => [...new Set(a.filter(Boolean))];

export const ROTULO_TIPO = {
  aereo: 'Aéreo', hospedagem: 'Hospedagem', transfer: 'Transfer', trem: 'Trem', passeio: 'Passeio', seguro: 'Seguro',
  carro: 'Carro', cruzeiro: 'Cruzeiro', visto: 'Visto', pacote: 'Pacote', expedicao: 'Expedição', concierge: 'Concierge', outro: 'Outro',
};
export const STATUS_VENDA = {
  em_analise: 'Em análise', tudo_emitido: 'Tudo emitido ✓', faltam_emissoes: 'Faltam emissões', divergencia: 'Divergência', risco_alto: 'Risco alto',
};
const PESO = { baixo: 1, medio: 2, alto: 3 };

// Documento da viagem (rel_documentos.tipo) → que tipo de item ele pode comprovar.
const DOC_COBRE = {
  bilhete: ['aereo'],
  seguro: ['seguro'],
  voucher: ['hospedagem', 'transfer', 'passeio', 'trem', 'carro', 'cruzeiro', 'pacote', 'concierge', 'outro'],
  visto: ['visto'],
};
// Item que não se "emite": não entra no extrato (visto é do cliente; concierge é serviço interno).
const NAO_EMITE = new Set(['concierge']);

// ── Trechos ─────────────────────────────────────────────────────────────────
/** "GRU → NRT 12/03/2026 10:00–14:00 JL 45" (linhaVoo do voucher) → trechos. */
export function trechosDoTexto(voos) {
  const out = [];
  for (const l of txt(voos).split('\n')) {
    const m = /([A-Z]{3})\s*(?:→|->|-|>)\s*([A-Z]{3})(?:\D+?(\d{2})\/(\d{2})(?:\/(\d{4}))?)?/.exec(l.toUpperCase());
    if (!m) continue;
    out.push({ origem: m[1], destino: m[2], data: m[3] && m[5] ? `${m[5]}-${m[4]}-${m[3]}` : '', voo: (/\b([A-Z0-9]{2}\s?\d{2,4})\b/.exec(l.slice(m.index + m[0].length)) || [])[1] || '' });
  }
  return out;
}

/** Trechos de um item de aéreo (proposta: detalhes.trechos; venda/voucher: dados.trechos ou o texto de "voos"). */
export function trechosDoItem(i) {
  const d = i?.detalhes || i?.dados || {};
  let lista = Array.isArray(d.trechos) ? d.trechos : [];
  if (!lista.length && typeof d.trechos === 'string') { try { lista = JSON.parse(d.trechos); } catch { lista = []; } }
  if (!lista.length && d.voos) lista = trechosDoTexto(d.voos);
  return lista.map((t) => ({
    origem: iata(t.origem) || iata(t.origem_codigo), destino: iata(t.destino) || iata(t.destino_codigo),
    data: dataOk(t.data) || dataOk(t.partida_em),
    saida: txt(t.saida || t.hora_saida), chegada: txt(t.chegada || t.hora_chegada), chegada_data: dataOk(t.chegada_data),
    partida_em: t.partida_em || null, chegada_em: t.chegada_em || null,
    voo: txt(t.voo || t.numero).toUpperCase(), cia: txt(t.cia || t.companhia),
    localizador: txt(t.localizador || d.localizador).toUpperCase(),
    passageiros: Array.isArray(t.passageiros) ? t.passageiros.map(nomeLimpo).filter(Boolean) : null,
    sentido: t.sentido || '',
  })).filter((t) => t.origem || t.destino);
}

const ehInterno = (t) => { const a = paisDoIata(t.origem), b = paisDoIata(t.destino); return Boolean(a && b && a === b); };
const ehInternacional = (t) => { const a = paisDoIata(t.origem), b = paisDoIata(t.destino); return Boolean((a && a !== 'br') || (b && b !== 'br')); };

// ── Normalização das evidências de emissão ──────────────────────────────────
/**
 * Junta tudo que comprova emissão numa lista só:
 *   { fonte, tipo, nome, data_inicio, data_fim, localizador, trecho?, passageiros[], doc_tipo?, rotulo }
 * Aéreo vira UMA evidência por trecho.
 */
export function evidencias(emitido = []) {
  const out = [];
  for (const e of emitido || []) {
    if (!e) continue;
    const fonte = e.fonte || 'venda';
    if (fonte === 'documento') {
      const cobre = DOC_COBRE[e.doc_tipo] || [];
      if (cobre.length) out.push({ fonte, tipos: cobre, nome: txt(e.nome) || txt(e.arquivo_nome) || e.doc_tipo, data_inicio: '', data_fim: '', localizador: '', passageiros: [], doc_tipo: e.doc_tipo, ref: e.ref || null });
      continue;
    }
    const tipo = e.tipo || 'outro';
    if (tipo === 'aereo') {
      const ts = e.trecho ? trechosDoItem({ dados: { trechos: [e.trecho] } }) : trechosDoItem(e);
      if (ts.length) {
        for (const t of ts) out.push({ fonte, tipos: ['aereo'], nome: `${t.origem} → ${t.destino}`, data_inicio: t.data, data_fim: t.chegada_data || t.data, localizador: t.localizador || txt(e.localizador).toUpperCase(), trecho: t, passageiros: t.passageiros || (e.passageiros || []).map((p) => nomeLimpo(p?.nome ?? p)).filter(Boolean), ref: e.ref || null });
        continue;
      }
    }
    out.push({
      fonte, tipos: [tipo], nome: txt(e.nome), data_inicio: dataOk(e.data_inicio), data_fim: dataOk(e.data_fim),
      localizador: txt(e.localizador || e.dados?.localizador || e.dados?.apolice || e.dados?.numero_bilhete).toUpperCase(),
      passageiros: (e.passageiros || []).map((p) => nomeLimpo(p?.nome ?? p)).filter(Boolean),
      expedicao_status: e.status_reserva || null, ref: e.ref || null,
    });
  }
  return out;
}

/** Item da venda conta como emitido? (status 'emitido' ou já tem localizador / apólice / bilhete). */
export function itemVendidoEmitido(i) {
  const d = i?.dados || {};
  return i?.status === 'emitido' || Boolean(txt(d.localizador) || txt(d.apolice) || txt(d.numero_bilhete) || txt(d.voucher));
}

// ── Casar um item com as evidências ─────────────────────────────────────────
function semelhancaNome(a, b) {
  const ta = new Set(semAcento(a).split(/[^a-z0-9]+/).filter((x) => x.length > 2));
  const tb = semAcento(b).split(/[^a-z0-9]+/).filter((x) => x.length > 2);
  if (!ta.size || !tb.length) return 0;
  return tb.filter((x) => ta.has(x)).length / Math.min(ta.size, tb.length);
}

function pontuar(item, ev) {
  let p = 1;
  if (item.data_inicio && ev.data_inicio) {
    const d = Math.abs(diasEntre(item.data_inicio, ev.data_inicio));
    if (d === 0) p += 3; else if (d <= 3) p += 1; else p -= 2;
  }
  if (item.data_fim && ev.data_fim && item.data_fim === ev.data_fim) p += 2;
  p += 2 * semelhancaNome(item.nome, ev.nome);
  if (ev.fonte === 'documento') p -= 0.5; // estruturado ganha do arquivo solto
  return p;
}

function casarTrecho(t, evs, usadas) {
  const livres = evs.map((e, n) => ({ e, n })).filter(({ e, n }) => !usadas.has(n) && e.trecho);
  const mesmaRota = livres.filter(({ e }) => e.trecho.origem === t.origem && e.trecho.destino === t.destino);
  const exata = mesmaRota.find(({ e }) => !t.data || !e.trecho.data || e.trecho.data === t.data);
  if (exata) return { ...exata, motivos: [] };
  const perto = mesmaRota.filter(({ e }) => t.data && e.trecho.data && Math.abs(diasEntre(t.data, e.trecho.data)) <= 7)
    .sort((a, b) => Math.abs(diasEntre(t.data, a.e.trecho.data)) - Math.abs(diasEntre(t.data, b.e.trecho.data)))[0];
  if (perto) return { ...perto, motivos: [`data diferente: apresentado ${BR(t.data)}, emitido ${BR(perto.e.trecho.data)}`] };
  // Mesmo dia saindo (ou chegando) do mesmo aeroporto, com a outra ponta diferente → rota trocada.
  const rota = livres.find(({ e }) => t.data && e.trecho.data === t.data && (e.trecho.origem === t.origem || e.trecho.destino === t.destino));
  if (rota) return { ...rota, motivos: [`rota diferente: apresentado ${t.origem} → ${t.destino}, emitido ${rota.e.trecho.origem} → ${rota.e.trecho.destino}`] };
  // Bilhete em PDF (documento sem trecho) cobre um trecho, mas sem conferir rota/data.
  const doc = evs.map((e, n) => ({ e, n })).find(({ e, n }) => !usadas.has(n) && e.fonte === 'documento' && e.tipos.includes('aereo'));
  if (doc) return { ...doc, motivos: [], fraca: true };
  return null;
}

function casarItem(item, evs, usadas) {
  const cand = evs.map((e, n) => ({ e, n })).filter(({ e, n }) => !usadas.has(n) && !e.trecho && e.tipos.includes(item.tipo));
  if (!cand.length) return null;
  const melhor = cand.map((c) => ({ ...c, p: pontuar(item, c.e) })).sort((a, b) => b.p - a.p)[0];
  const e = melhor.e;
  const motivos = [];
  if (item.data_inicio && e.data_inicio && item.data_inicio !== e.data_inicio) motivos.push(`início diferente: apresentado ${BR(item.data_inicio)}, emitido ${BR(e.data_inicio)}`);
  if (item.data_fim && e.data_fim && item.data_fim !== e.data_fim) motivos.push(`fim diferente: apresentado ${BR(item.data_fim)}, emitido ${BR(e.data_fim)}`);
  if (item.tipo === 'hospedagem' && item.nome && e.nome && e.fonte !== 'documento' && semelhancaNome(item.nome, e.nome) === 0 && !/hospedagem/i.test(item.nome)) {
    motivos.push(`hotel diferente: apresentado "${item.nome}", emitido "${e.nome}"`);
  }
  return { ...melhor, motivos, fraca: e.fonte === 'documento' };
}

// ── Itens da base (apresentado ou vendido) ──────────────────────────────────
function normalizarItem(i, origem) {
  return {
    origem, tipo: i.tipo || 'outro', nome: txt(i.nome) || ROTULO_TIPO[i.tipo] || 'Item',
    data_inicio: dataOk(i.data_inicio), data_fim: dataOk(i.data_fim),
    quantidade: num(i.quantidade), valor: num(i.valor_total ?? i.valor), custo: num(i.custo), incluso: Boolean(i.incluso),
    passageiros: (i.passageiros || []).map((p) => nomeLimpo(p?.nome ?? p)).filter(Boolean),
    trechos: i.tipo === 'aereo' ? trechosDoItem(i) : [],
    status: i.status || null, dados: i.dados || i.detalhes || {}, id: i.id || null,
  };
}

/**
 * O cruzamento. Todos os campos são opcionais.
 * @param {{
 *   proposta?: { numero?: number, opcao?: string, total?: number|null, adultos?: number, criancas?: number, bebes?: number } | null,
 *   apresentado?: object[], vendido?: object[], emitido?: object[],
 *   pessoas?: { nome: string, passaporte_validade?: string|null }[],
 *   viajantes?: { nome: string, valor_contratado?: number|null, valor_pago?: number|null }[],
 *   pagamento?: { forma?: string, condicao?: string, entrada?: number|null, entrada_data?: string|null, parcelas?: number|null },
 *   total_venda?: number|null, hoje?: string, viagem?: { data_inicio?: string, data_fim?: string }
 * }} ctx
 */
export function conferirVenda(ctx = {}) {
  const hoje = dataOk(ctx.hoje) || new Date().toISOString().slice(0, 10);
  const temProposta = Boolean(ctx.proposta && (ctx.apresentado || []).length);
  const vendido = (ctx.vendido || []).map((i) => normalizarItem(i, 'venda'));
  const base = temProposta ? (ctx.apresentado || []).map((i) => normalizarItem(i, 'proposta')) : vendido;

  // Evidências: o que veio de fora + os itens vendidos que já estão emitidos.
  const evs = evidencias([
    ...(ctx.emitido || []),
    ...(ctx.vendido || []).filter(itemVendidoEmitido).map((i) => ({ ...i, fonte: 'venda', ref: i.id || null })),
  ]);
  // Sem proposta, o item vendido emitido é a própria evidência dele (não conta duas vezes).
  const usadas = new Set();

  const pax = ctx.proposta ? (Number(ctx.proposta.adultos) || 0) + (Number(ctx.proposta.criancas) || 0) + (Number(ctx.proposta.bebes) || 0) : 0;
  const paxEsperado = pax || (ctx.viajantes || []).length || Math.max(0, ...vendido.map((i) => i.passageiros.length)) || 0;

  const linhas = [];
  const add = (l) => linhas.push({ chave: `l${linhas.length + 1}`, ...l });
  const resumoEv = (e) => e && ({ nome: e.nome, fonte: e.fonte, localizador: e.localizador || '', data_inicio: e.data_inicio || '', data_fim: e.data_fim || '', doc_tipo: e.doc_tipo || '' });

  for (const it of base) {
    if (NAO_EMITE.has(it.tipo)) continue;
    if (it.tipo === 'expedicao') {
      // A "emissão" da expedição é a vaga: passageiros na expedição (o aéreo do grupo é do Ops).
      const n = evs.findIndex((e, k) => !usadas.has(k) && e.tipos.includes('expedicao'));
      const vend = vendido.find((v) => v.tipo === 'expedicao');
      if (n >= 0) { usadas.add(n); add({ tipo: 'expedicao', nome: it.nome, situacao: 'ok', apresentado: { nome: it.nome, data_inicio: it.data_inicio, data_fim: it.data_fim }, emitido: resumoEv(evs[n]), motivos: [], nota: evs[n].expedicao_status === 'Pré-reserva' ? 'vaga em pré-reserva — o Operacional confirma' : '' }); }
      else if (vend || (ctx.viajantes || []).length) add({ tipo: 'expedicao', nome: it.nome, situacao: 'ok', apresentado: { nome: it.nome, data_inicio: it.data_inicio, data_fim: it.data_fim }, emitido: null, motivos: [], nota: 'a vaga é reservada ao confirmar a venda (pré-reserva)' });
      else add({ tipo: 'expedicao', nome: it.nome, situacao: 'falta', apresentado: { nome: it.nome }, emitido: null, motivos: ['expedição apresentada e não vendida'] });
      continue;
    }
    if (it.tipo === 'aereo' && it.trechos.length) {
      for (const t of it.trechos) {
        const nomeT = `${t.origem || '?'} → ${t.destino || '?'}${t.voo ? ` (${t.voo})` : ''}`;
        const interno = ehInterno(t); // mesmo país nas duas pontas (nacional no Brasil ou interno no destino)
        const c = casarTrecho(t, evs, usadas);
        const ap = { nome: nomeT, data_inicio: t.data, data_fim: t.chegada_data || t.data, voo_interno: interno };
        if (!c) { add({ tipo: 'aereo', nome: nomeT, situacao: 'falta', apresentado: ap, emitido: null, motivos: [], voo_interno: interno }); continue; }
        usadas.add(c.n);
        const motivos = [...c.motivos];
        const ps = c.e.passageiros || [];
        if (!c.fraca && paxEsperado && ps.length && ps.length < paxEsperado) motivos.push(`bilhete com ${ps.length} de ${paxEsperado} passageiro(s)`);
        if (!c.fraca && !c.e.localizador) motivos.push('emitido sem localizador');
        add({ tipo: 'aereo', nome: nomeT, situacao: motivos.length ? 'divergente' : 'ok', apresentado: ap, emitido: resumoEv(c.e), motivos, voo_interno: interno, nota: c.fraca ? 'comprovado só pelo arquivo do bilhete — rota e data não conferidas' : '' });
      }
      continue;
    }
    const c = casarItem(it, evs, usadas);
    const ap = { nome: it.nome, data_inicio: it.data_inicio, data_fim: it.data_fim, quantidade: it.quantidade };
    if (!c) { add({ tipo: it.tipo, nome: it.nome, situacao: 'falta', apresentado: ap, emitido: null, motivos: [] }); continue; }
    usadas.add(c.n);
    const motivos = [...c.motivos];
    if (!c.fraca && it.quantidade && it.quantidade > 1 && c.e.passageiros.length && c.e.passageiros.length < it.quantidade && ['seguro', 'passeio', 'transfer', 'trem'].includes(it.tipo)) {
      motivos.push(`quantidade: apresentado ${it.quantidade}, emitido pra ${c.e.passageiros.length}`);
    }
    add({ tipo: it.tipo, nome: it.nome, situacao: motivos.length ? 'divergente' : 'ok', apresentado: ap, emitido: resumoEv(c.e), motivos, nota: c.fraca ? `comprovado pelo arquivo "${c.e.nome}" — datas não conferidas` : '' });
  }

  // Emitido que não estava na base (estruturado; documento solto não vira "extra").
  evs.forEach((e, n) => {
    if (usadas.has(n) || e.fonte === 'documento' || e.tipos.includes('expedicao')) return;
    // Item vendido emitido sem proposta já é a própria base (casou acima); só sobra se não casou.
    add({ tipo: e.tipos[0], nome: e.nome || ROTULO_TIPO[e.tipos[0]], situacao: 'extra', apresentado: null, emitido: resumoEv(e), motivos: [temProposta ? 'emitido mas não estava na proposta aprovada' : 'emitido mas não está nos itens da venda'] });
  });

  // Proposta × venda: o que foi apresentado e não entrou na venda, e vice-versa (por tipo).
  if (temProposta && vendido.length) {
    const tiposVend = new Set(vendido.map((v) => v.tipo));
    const tiposProp = new Set(base.map((b) => b.tipo));
    for (const l of linhas) if (l.apresentado && !tiposVend.has(l.tipo) && l.tipo !== 'expedicao') l.motivos.push('estava na proposta e não entrou nos itens da venda');
    for (const v of vendido) if (!tiposProp.has(v.tipo) && !NAO_EMITE.has(v.tipo)) {
      add({ tipo: v.tipo, nome: v.nome, situacao: 'divergente', apresentado: null, emitido: null, motivos: ['vendido mas não estava na proposta aprovada'] });
    }
    for (const l of linhas) if (l.situacao === 'ok' && l.motivos.length) l.situacao = 'divergente';
  }

  // ── Datas da viagem ──
  const datas = [
    ...base.flatMap((i) => [i.data_inicio, i.data_fim, ...i.trechos.map((t) => t.data)]),
    ...evs.flatMap((e) => [e.data_inicio, e.data_fim]),
    dataOk(ctx.viagem?.data_inicio), dataOk(ctx.viagem?.data_fim),
  ].filter(Boolean).sort();
  const inicio = dataOk(ctx.viagem?.data_inicio) || datas[0] || '';
  const fim = dataOk(ctx.viagem?.data_fim) || datas.at(-1) || '';

  const riscos = riscosPorRegra({ ctx, base, vendido, evs, linhas, temProposta, inicio, fim, hoje, paxEsperado });

  const contagens = { ok: 0, falta: 0, divergente: 0, extra: 0 };
  for (const l of linhas) contagens[l.situacao]++;
  contagens.total = linhas.length;
  const risco_nivel = riscos.reduce((m, r) => (PESO[r.nivel] > PESO[m] ? r.nivel : m), 'baixo');
  const status = statusDaVenda(contagens, riscos);
  const faltam = linhas.filter((l) => l.situacao === 'falta').map((l) => `${ROTULO_TIPO[l.tipo] || l.tipo}: ${l.nome}${l.apresentado?.data_inicio ? ` (${BR(l.apresentado.data_inicio)})` : ''}${l.voo_interno ? ' — voo interno' : ''}`);
  return {
    status, base: temProposta ? 'proposta' : 'venda', contagens, linhas, riscos, risco_nivel, faltam,
    divergencias: linhas.filter((l) => l.situacao === 'divergente' || l.situacao === 'extra').map((l) => `${ROTULO_TIPO[l.tipo] || l.tipo}: ${l.nome} — ${l.motivos.join('; ')}`),
    inicio, fim, resumo: resumoTexto(status, contagens, riscos, temProposta),
  };
}

/** risco_alto > divergencia > faltam_emissoes > tudo_emitido. */
export function statusDaVenda(contagens, riscos = []) {
  if (riscos.some((r) => r.nivel === 'alto')) return 'risco_alto';
  if ((contagens.divergente || 0) + (contagens.extra || 0) > 0) return 'divergencia';
  if ((contagens.falta || 0) > 0) return 'faltam_emissoes';
  return 'tudo_emitido';
}

function resumoTexto(status, c, riscos, temProposta) {
  const partes = [];
  if (!c.total) partes.push('Nada pra conferir (venda sem itens emitíveis).');
  else if (c.falta === 0 && c.divergente === 0 && c.extra === 0) partes.push(`Tudo emitido: ${c.ok} de ${c.total} item(ns) conferido(s)${temProposta ? ' contra a proposta' : ''}.`);
  else {
    if (c.falta) partes.push(`Falta emitir ${c.falta} de ${c.total}.`);
    if (c.divergente) partes.push(`${c.divergente} divergente(s).`);
    if (c.extra) partes.push(`${c.extra} emitido(s) fora do ${temProposta ? 'apresentado' : 'vendido'}.`);
  }
  const altos = riscos.filter((r) => r.nivel === 'alto').length;
  if (altos) partes.push(`${altos} risco(s) alto(s).`);
  if (status === 'tudo_emitido' && !riscos.length) partes.push('Sem riscos apontados.');
  return partes.join(' ');
}

// ── Riscos por regra ───────────────────────────────────────────────────────
function riscosPorRegra({ ctx, base, vendido, evs, linhas, temProposta, inicio, fim, hoje, paxEsperado }) {
  const R = [];
  const r = (nivel, categoria, motivo) => R.push({ nivel, categoria, motivo, fonte: 'regra' });
  const trechosTodos = [...base.flatMap((i) => i.trechos), ...evs.filter((e) => e.trecho).map((e) => e.trecho)];
  const internacional = trechosTodos.some(ehInternacional) || base.some((i) => i.tipo === 'expedicao');
  const faltas = linhas.filter((l) => l.situacao === 'falta');

  // 1. Sem proposta.
  if (!temProposta) {
    const temPacote = vendido.some((i) => i.tipo === 'pacote');
    const soExpedicao = vendido.length > 0 && vendido.every((i) => i.tipo === 'expedicao' || NAO_EMITE.has(i.tipo));
    if (temPacote) r('alto', 'sem_proposta', 'Pacote vendido sem proposta montada no QS: não dá pra conferir o que foi apresentado ao cliente.');
    else if (vendido.length && !soExpedicao) r('medio', 'sem_proposta', 'Venda sem proposta aprovada no QS: a conferência usou os itens da venda como base.');
  }

  // 2. Voo interno sem bilhete.
  for (const l of faltas.filter((x) => x.tipo === 'aereo' && x.voo_interno)) r('alto', 'voo_interno', `Voo interno ${l.nome} sem bilhete emitido.`);

  // 3. Embarque perto com coisa faltando.
  if (inicio && faltas.length) {
    const d = diasEntre(hoje, inicio);
    if (d <= 15) r('alto', 'prazo', `Embarque em ${d < 0 ? 'data já passada' : `${d} dia(s)`} (${BR(inicio)}) e ainda falta emitir ${faltas.length} item(ns).`);
    else if (d <= 45) r('medio', 'prazo', `Embarque em ${d} dias (${BR(inicio)}) com ${faltas.length} item(ns) por emitir.`);
  }

  // 4. Passaporte.
  const volta = fim || inicio;
  const pessoas = (ctx.pessoas || []).filter((p) => txt(p?.nome));
  if (internacional && volta) {
    for (const p of pessoas) {
      const v = dataOk(p.passaporte_validade);
      if (!v) { r('medio', 'passaporte', `Sem validade do passaporte de ${nomeLimpo(p.nome)} no cadastro (viagem internacional).`); continue; }
      if (v < volta) r('alto', 'passaporte', `Passaporte de ${nomeLimpo(p.nome)} vence ${BR(v)}, ANTES da volta (${BR(volta)}).`);
      else if (v < somaDias(volta, 183)) r('alto', 'passaporte', `Passaporte de ${nomeLimpo(p.nome)} vence ${BR(v)}: menos de 6 meses depois da volta (${BR(volta)}).`);
    }
  }

  // 5. Nome no emitido × cadastro.
  if (pessoas.length) {
    const vistos = new Set();
    for (const e of evs) for (const nome of e.passageiros || []) {
      if (vistos.has(nome)) continue; vistos.add(nome);
      const res = pessoas.map((p) => compararNomes(p.nome, nome));
      if (res.includes('igual')) continue;
      const parc = pessoas[res.indexOf('parcial')];
      if (parc) r('medio', 'nome', `Nome emitido "${nome}" diferente do cadastro "${nomeLimpo(parc.nome)}" — confira com o documento.`);
      else r('alto', 'nome', `"${nome}" está no que foi emitido, mas não bate com ninguém do cadastro da venda.`);
    }
  }

  // 6. Conexão curta (trechos emitidos com horário; senão os apresentados).
  const comHora = evs.filter((e) => e.trecho).map((e) => e.trecho);
  const lista = (comHora.length ? comHora : base.flatMap((i) => i.trechos)).map((t) => ({ ...t, ...instantes(t) })).filter((t) => t.sai != null).sort((a, b) => a.sai - b.sai);
  for (let k = 1; k < lista.length; k++) {
    const a = lista[k - 1], b = lista[k];
    if (!a.destino || a.destino !== b.origem || a.chega == null) continue;
    const min = Math.round((b.sai - a.chega) / 60_000);
    if (min < 0 || min > 24 * 60) continue;
    const intl = paisDoIata(a.origem) !== paisDoIata(b.destino);
    if (min < 45) r('alto', 'conexao', `Conexão de ${min} min em ${b.origem} (${a.voo || 'voo'} → ${b.voo || 'voo'}).`);
    else if (min < (intl ? 90 : 60)) r('medio', 'conexao', `Conexão curta de ${min} min em ${b.origem} (${a.voo || 'voo'} → ${b.voo || 'voo'}).`);
  }

  // 7. Pagamento.
  const pg = ctx.pagamento || {};
  if (ctx.pagamento && !txt(pg.forma)) r('medio', 'pagamento', 'Forma de pagamento não registrada.');
  if (pg.condicao === 'entrada' && (!num(pg.entrada) || !dataOk(pg.entrada_data))) r('medio', 'pagamento', 'Entrada sem valor ou sem data.');
  if (pg.condicao === 'entrada' && dataOk(pg.entrada_data) && dataOk(pg.entrada_data) < hoje) r('baixo', 'pagamento', `Entrada prevista pra ${BR(dataOk(pg.entrada_data))}: confirme se caiu.`);
  const vj = (ctx.viajantes || []).filter((v) => num(v.valor_contratado));
  const deve = vj.reduce((s, v) => s + Math.max(0, (num(v.valor_contratado) || 0) - (num(v.valor_pago) || 0)), 0);
  if (vj.length && deve > 0.009) {
    const d = inicio ? diasEntre(hoje, inicio) : 999;
    r(d <= 30 ? 'alto' : 'baixo', 'pagamento', `Pagamento pendente na expedição: falta receber ${brl(deve)}${d <= 30 ? ` e o embarque é em ${d} dia(s)` : ''}.`);
  }

  // 8. Margem (só onde há custo).
  const comCusto = [...(temProposta ? base : vendido)].filter((i) => i.custo != null && i.valor != null && !i.incluso && i.valor > 0);
  const venda = comCusto.reduce((s, i) => s + i.valor, 0), custo = comCusto.reduce((s, i) => s + i.custo, 0);
  if (comCusto.length && venda > 0) {
    const m = (venda - custo) / venda;
    if (m < 0) r('alto', 'margem', `Margem negativa: custo ${brl(custo)} acima da venda ${brl(venda)}.`);
    else if (m < 0.08) r('medio', 'margem', `Margem baixa: ${(m * 100).toFixed(1).replace('.', ',')}% nos itens com custo.`);
  }

  // 9. Valor vendido × proposta.
  const tv = num(ctx.total_venda), tp = num(ctx.proposta?.total);
  if (temProposta && tv != null && tp != null && tp > 0 && Math.abs(tv - tp) > Math.max(1, tp * 0.01)) {
    r(tv < tp ? 'medio' : 'baixo', 'valor', `Valor da venda (${brl(tv)}) diferente do total da proposta aprovada (${brl(tp)}).`);
  }

  // 10. Seguro: internacional sem seguro / seguro que não cobre as datas.
  const seguros = [...base, ...evs.map((e) => ({ tipo: e.tipos[0], data_inicio: e.data_inicio, data_fim: e.data_fim }))].filter((i) => i.tipo === 'seguro');
  if (internacional && !seguros.length && !base.some((i) => i.tipo === 'expedicao')) r('medio', 'seguro', 'Viagem internacional sem seguro viagem na venda.');
  for (const s of seguros) {
    if (inicio && s.data_inicio && s.data_inicio > inicio) { r('medio', 'seguro', `Seguro começa ${BR(s.data_inicio)}, depois do embarque (${BR(inicio)}).`); break; }
    if (fim && s.data_fim && s.data_fim < fim) { r('medio', 'seguro', `Seguro termina ${BR(s.data_fim)}, antes da volta (${BR(fim)}).`); break; }
  }

  // 11. Passageiros: venda pra N e emitido pra menos (já está nas linhas; aqui só o resumo).
  if (paxEsperado > 1 && pessoas.length && pessoas.length < paxEsperado) r('baixo', 'cadastro', `Venda pra ${paxEsperado} pessoa(s) e só ${pessoas.length} com cadastro completo.`);

  // Sem repetir o mesmo motivo.
  const vistos = new Set();
  return R.filter((x) => (vistos.has(x.motivo) ? false : vistos.add(x.motivo)))
    .sort((a, b) => PESO[b.nivel] - PESO[a.nivel]);
}

/** Instantes (ms) de saída/chegada de um trecho: timestamptz do Rel ou data+hora local. */
function instantes(t) {
  const p = (iso, data, hora) => {
    if (iso) { const x = Date.parse(iso); if (!Number.isNaN(x)) return x; }
    const h = /^(\d{1,2}):(\d{2})/.exec(txt(hora));
    return data && h ? Date.parse(`${data}T${h[1].padStart(2, '0')}:${h[2]}:00Z`) : null;
  };
  let chega = p(t.chegada_em, t.chegada_data || t.data, t.chegada);
  const sai = p(t.partida_em, t.data, t.saida);
  if (!t.chegada_em && chega != null && sai != null && chega < sai && !t.chegada_data) chega += 86_400_000;
  return { sai, chega };
}

/** Junta riscos da IA (já validados pelo esquema) com os da regra, sem repetir categoria+motivo parecido. */
export function juntarRiscos(regras, ia) {
  const out = [...regras];
  for (const x of ia || []) {
    if (!x || !PESO[x.nivel] || !txt(x.motivo)) continue;
    const parecido = out.some((r) => r.categoria === x.categoria && semelhancaNome(r.motivo, x.motivo) > 0.6);
    if (!parecido) out.push({ nivel: x.nivel, categoria: txt(x.categoria) || 'outro', motivo: txt(x.motivo).slice(0, 300), fonte: 'ia' });
  }
  return out.sort((a, b) => PESO[b.nivel] - PESO[a.nivel]);
}

/** Recalcula status/nível depois de juntar os riscos da IA. */
export function fecharAnalise(base, riscosIa, iaInfo) {
  const riscos = juntarRiscos(base.riscos, riscosIa);
  const risco_nivel = riscos.reduce((m, r) => (PESO[r.nivel] > PESO[m] ? r.nivel : m), 'baixo');
  return { ...base, riscos, risco_nivel, status: statusDaVenda(base.contagens, riscos), ia: iaInfo };
}

// ── Esquema da resposta da IA (structured outputs, strict) ──────────────────
const S = { type: 'string' };
export const RISCOS_IA = {
  type: 'object', additionalProperties: false, required: ['riscos', 'texto'],
  properties: {
    riscos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['nivel', 'categoria', 'motivo'],
        properties: {
          nivel: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
          categoria: { type: 'string', enum: ['passaporte', 'conexao', 'nome', 'pagamento', 'voo_interno', 'sem_proposta', 'margem', 'prazo', 'seguro', 'documento', 'roteiro', 'valor', 'outro'] },
          motivo: { ...S, description: 'uma frase curta, em português, citando o item/pessoa' },
        },
      },
    },
    texto: { ...S, description: 'parecer de 2 a 4 frases pra quem vai emitir: o que olhar primeiro' },
  },
};

export const INSTRUCAO_IA =
  'Você revisa vendas de uma agência de viagens brasileira DEPOIS que a venda foi lançada. Recebe a conferência já ' +
  'feita por regras (o que está ok, o que falta emitir, o que diverge) e os riscos que as regras acharam. Seu papel: ' +
  'apontar riscos ADICIONAIS que as regras não pegaram (ex.: roteiro com noite sem hotel, transfer sem voo no mesmo dia, ' +
  'visto exigido pelo destino, criança sem documento, bagagem incompatível entre trechos, conexão com troca de aeroporto, ' +
  'nome com abreviação que a cia aérea não aceita). NÃO repita os riscos já listados. NÃO invente dados que não estão ' +
  'no material. Níveis: alto = pode impedir a viagem ou gerar prejuízo; medio = precisa de ação antes do embarque; ' +
  'baixo = atenção. Se não houver nada a acrescentar, devolva riscos vazio. Escreva em português do Brasil.';

/** O material que vai pra IA (sem CPF, número de passaporte, telefone ou e-mail). */
export function materialParaIa(ctx, conf) {
  const limpa = (i) => ({ tipo: i.tipo, nome: i.nome, data_inicio: i.data_inicio || null, data_fim: i.data_fim || null, trechos: trechosDoItem(i).map(({ passageiros: _p, ...t }) => t), quantidade: i.quantidade ?? null });
  return {
    hoje: ctx.hoje, inicio: conf.inicio, fim: conf.fim,
    proposta: ctx.proposta ? { numero: ctx.proposta.numero ?? null, opcao: ctx.proposta.opcao ?? null, total: ctx.proposta.total ?? null, pessoas: (Number(ctx.proposta.adultos) || 0) + (Number(ctx.proposta.criancas) || 0) + (Number(ctx.proposta.bebes) || 0) } : null,
    apresentado: (ctx.apresentado || []).map(limpa),
    vendido: (ctx.vendido || []).map(limpa),
    pessoas: (ctx.pessoas || []).map((p) => ({ nome: nomeLimpo(p.nome), passaporte_validade: dataOk(p.passaporte_validade) || null })),
    pagamento: ctx.pagamento ? { forma: ctx.pagamento.forma || null, condicao: ctx.pagamento.condicao || null, parcelas: ctx.pagamento.parcelas ?? null } : null,
    extrato: conf.linhas.map((l) => ({ tipo: l.tipo, nome: l.nome, situacao: l.situacao, motivos: l.motivos, nota: l.nota || '' })),
    riscos_das_regras: conf.riscos.map((x) => `${x.nivel}: ${x.motivo}`),
  };
}

/** Texto do extrato pra solicitação do Rel / histórico. */
export function textoDoExtrato(conf) {
  const L = [];
  if (conf.faltam.length) { L.push('FALTA EMITIR:'); for (const f of conf.faltam) L.push(`• ${f}`); }
  if (conf.divergencias.length) { L.push('', 'DIVERGENTE:'); for (const d of conf.divergencias) L.push(`• ${d}`); }
  const altos = conf.riscos.filter((r) => r.nivel !== 'baixo');
  if (altos.length) { L.push('', 'RISCOS:'); for (const r of altos) L.push(`• [${r.nivel}] ${r.motivo}`); }
  if (!L.length) L.push('Tudo emitido ✓');
  return L.join('\n').trim();
}

export const _interno = { unicos };
