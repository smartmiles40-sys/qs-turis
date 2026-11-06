// api/_bitrixSaidaRegras.js
// -----------------------------------------------------------------------------
// As REGRAS da saída QS → Bitrix que antes moravam nos nós Code do n8n
// (n8n/qs-bitrix-completo.workflow.json: "Montar ganho" e "Montar reunião").
//
// Só funções puras — nada de rede, nada de env. Quem chama o Bitrix é o
// api/_bitrixSaida.js; aqui fica o que dá pra testar sem internet
// (tests/bitrix/saida.test.ts). Portado em 03/11, no corte do n8n, mantendo a
// lógica do workflow linha a linha: mesmo texto de comentário, mesmos campos,
// mesma ordem de casamento de nomes.
// -----------------------------------------------------------------------------

// ─── GANHO ───────────────────────────────────────────────────────────────────
//
// No n8n, o "Config Ganho" tinha STAGE_GANHO VAZIO: o ganho só comentava na
// timeline e gravava o valor. Era de propósito — mover pra coluna errada é pior
// do que não mover, e ninguém decidiu ainda qual é a coluna de ganho. O mesmo
// vale aqui: com ETAPA_GANHO vazia, o card não muda de coluna.
// Quando decidirem, é UMA linha (ex.: 'WON' no funil 0 — confira o funil do card).
export const ETAPA_GANHO = '';

/**
 * Monta o que o ganho escreve no card. `null` = sem negócio, nada a fazer.
 * Devolve { id, fields, mexeNoCard, comentario }.
 */
export function montarGanho({ bitrixId, closedValue, fullName } = {}, etapaGanho = ETAPA_GANHO) {
  if (!bitrixId) return null;
  const temValor = closedValue !== null && closedValue !== undefined && closedValue !== '' && Number(closedValue) > 0;

  const fields = {};
  if (etapaGanho) fields.STAGE_ID = String(etapaGanho);
  // OPPORTUNITY é o campo nativo de valor do negócio no Bitrix.
  if (temValor) fields.OPPORTUNITY = Number(closedValue);

  return {
    id: Number(bitrixId),
    mexeNoCard: Object.keys(fields).length > 0,
    fields,
    comentario: '🏆 Lead marcado como GANHO no QS.' +
      (temValor ? '\nValor fechado: R$ ' + Number(closedValue).toLocaleString('pt-BR') : '\nValor fechado: não informado') +
      (fullName ? '\nLead: ' + fullName : ''),
  };
}

// ─── REUNIÃO ─────────────────────────────────────────────────────────────────

export function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Casa o nome que veio do QS com o rótulo da opção no Bitrix.
 *
 * Não dá pra casar só pelo primeiro nome: a lista "Quem fez o agendamento?"
 * tem "Victor Hugo - SDR" E "Victor Maldonado - Closer". Por primeiro nome, o
 * agendamento do Victor Hugo poderia ser creditado ao Victor Maldonado. Por
 * isso o primeiro nome só vale quando há UM candidato único.
 *
 * `lista` = [{ id, value }] das opções daquele apelido.
 */
export function acharOpcao(lista, nome) {
  lista = lista || [];
  const alvo = normalizar(nome);
  if (!alvo || !lista.length) return null;

  // 1) igual
  let hit = lista.find((o) => normalizar(o.value) === alvo);
  if (hit) return hit.id;

  // 2) o rótulo começa com o nome do QS ('Talita Carvalho' -> 'Talita Carvalho - Closer')
  hit = lista.find((o) => normalizar(o.value).indexOf(alvo + ' ') === 0);
  if (hit) return hit.id;

  // 3) o nome do QS começa com o rótulo ('Yanca Manuella Ruivo' -> 'Yanca Manuella')
  hit = lista.find((o) => {
    const v = normalizar(o.value);
    return v.length > 3 && alvo.indexOf(v + ' ') === 0;
  });
  if (hit) return hit.id;

  // 4) todas as palavras do nome do QS aparecem no rótulo
  const partes = alvo.split(' ').filter((x) => x.length > 2);
  if (partes.length > 1) {
    const todos = lista.filter((o) => {
      const v = normalizar(o.value);
      return partes.every((x) => v.indexOf(x) >= 0);
    });
    if (todos.length === 1) return todos[0].id;
  }

  // 5) primeiro nome — SÓ se for único; senão é melhor não preencher do que
  //    creditar a pessoa errada (o comentário na timeline avisa o que faltou).
  const primeiro = alvo.split(' ')[0];
  const candidatos = lista.filter((o) => normalizar(o.value).split(' ')[0] === primeiro);
  return candidatos.length === 1 ? candidatos[0].id : null;
}

/**
 * O QS grava em UTC. Mandar assim faz a reunião aparecer 3h adiantada no card.
 * O Brasil não tem mais horário de verão desde 2019, então -03:00 é fixo.
 */
export function brt(iso) {
  if (iso === null || iso === undefined || iso === '') return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const b = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return b.getUTCFullYear() + '-' + p(b.getUTCMonth() + 1) + '-' + p(b.getUTCDate()) +
         'T' + p(b.getUTCHours()) + ':' + p(b.getUTCMinutes()) + ':' + p(b.getUTCSeconds()) + '-03:00';
}

export function soData(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const b = brt(s);
  return b ? b.slice(0, 10) : null;
}

/**
 * Transforma as linhas do catálogo (bitrix_fields e v_opcoes_por_alias) no
 * formato que o montador usa: mapa apelido → UF_CRM_* e opções por apelido.
 */
export function montarCatalogo(linhasCampos, linhasOpcoes) {
  const mapa = {};
  for (const r of linhasCampos || []) {
    if (r && r.alias && r.field_name) mapa[r.alias] = r.field_name;
  }
  const opcoes = {};
  for (const r of linhasOpcoes || []) {
    if (!r || !r.alias) continue;
    (opcoes[r.alias] = opcoes[r.alias] || []).push({ id: Number(r.option_id), value: String(r.value == null ? '' : r.value) });
  }
  return { mapa, opcoes };
}

/**
 * Monta o crm.deal.update da reunião + o comentário da timeline.
 *
 * `body` = o payload que o QS sempre mandou pro webhook `qs-reuniao`
 * (bitrix_id, meeting_id, scheduled_at, scheduled_by, meeting_owner,
 * client_email, booking_date, meeting_link, duration_min, produto…).
 *
 * Devolve { ok: true, dealId, meetingId, fields, pulados, comentario } ou
 * { ok: false, erro } nos dois casos em que o n8n parava a execução.
 *
 * Etapa: o n8n tinha STAGE_REUNIAO vazio — a reunião NÃO mexe na coluna por
 * aqui. Quem move o card quando a reunião é marcada é o
 * moverNegocioParaReuniao (qs_settings.bitrix_reuniao), e o desfecho é o
 * reuniao-campos, com as guardas de "nunca puxar pra trás".
 */
export const ROTULO_PRODUTO = { expedicao: 'Expedição', aereo: 'Aéreo', pacote: 'Pacote', outros: 'Outros' };

// 06/11: o Bruno escolheu usar o campo que já existe, "Tipo de venda"
// (UF_CRM_1743296167520), em vez de criar um "Produto". Os nomes lá são outros,
// então cada produto tenta primeiro o nome do Tipo de venda e depois o nosso.
export const OPCOES_PRODUTO = {
  expedicao: ['Expedições', 'Expedição'],
  aereo: ['Passagens aéreas', 'Aéreo'],
  pacote: ['Pacotes de Viagens', 'Pacote'],
  outros: ['Outros'],
};

export function montarReuniao(body, { mapa = {}, opcoes = {} } = {}, { etapaReuniao = '' } = {}) {
  body = body || {};
  const fields = {};
  const pulados = [];

  // opcional = campo que talvez nem exista no Bitrix ainda; não vira alerta.
  function set(alias, valor, opcional) {
    const campo = mapa[alias];
    if (!campo) { if (!opcional) pulados.push(alias + ' (alias não cadastrado)'); return; }
    if (valor === null || valor === undefined || valor === '') { if (!opcional) pulados.push(alias + ' (o QS não tem esse dado)'); return; }
    fields[campo] = valor;
  }

  set('email_cliente', body.client_email);
  set('data_agendamento', soData(body.booking_date));
  set('datahora_meet', brt(body.scheduled_at));
  set('produto_reuniao', body.produto || null, true);
  set('link_meet', body.meeting_link || null, true);
  set('duracao_reuniao', body.duration_min || null, true);

  for (const [alias, nome] of [['sdr_agendou', body.scheduled_by], ['resp_reuniao', body.meeting_owner]]) {
    if (!mapa[alias]) { pulados.push(alias + ' (alias não cadastrado)'); continue; }
    const id = acharOpcao(opcoes[alias], nome);
    if (id) fields[mapa[alias]] = id;
    else pulados.push(alias + ' (nome "' + (nome || '—') + '" não bate com nenhuma opção)');
  }

  // Temperatura do SDR (05/11): lista Quente/Morno/Frio no card. Opcional —
  // enquanto o alias `temperatura_sdr` não estiver no de-para, não vira alerta.
  if (mapa.temperatura_sdr && body.temperatura_sdr) {
    const id = acharOpcao(opcoes.temperatura_sdr, body.temperatura_sdr);
    if (id) fields[mapa.temperatura_sdr] = id;
    else pulados.push('temperatura_sdr (nome "' + body.temperatura_sdr + '" não bate com nenhuma opção)');
  }

  // Produto do Agendou (0321, spec 06/11) → "Tipo de venda" do negócio (alias
  // produto_tipo). Opcional como a temperatura. Quem garante que não sobrescreve
  // o que o closer escolheu é o enviarReuniaoDireto (só grava com o campo vazio).
  if (mapa.produto_tipo && body.produto_tipo) {
    const rotulo = ROTULO_PRODUTO[body.produto_tipo] || body.produto_tipo;
    let id = null;
    for (const nome of OPCOES_PRODUTO[body.produto_tipo] || [rotulo]) {
      id = acharOpcao(opcoes.produto_tipo, nome);
      if (id) break;
    }
    if (id) fields[mapa.produto_tipo] = id;
    else pulados.push('produto_tipo (nome "' + rotulo + '" não bate com nenhuma opção)');
  }

  if (etapaReuniao) fields.STAGE_ID = String(etapaReuniao);

  if (!body.bitrix_id) return { ok: false, erro: 'payload sem bitrix_id' };
  if (!Object.keys(fields).length) return { ok: false, erro: 'nada para gravar — nenhum alias preenchido em bitrix_fields' };

  const quando = brt(body.scheduled_at);
  const legivel = quando ? quando.slice(8, 10) + '/' + quando.slice(5, 7) + ' às ' + quando.slice(11, 16) : 'data não informada';

  return {
    ok: true,
    dealId: Number(body.bitrix_id),
    meetingId: body.meeting_id || null,
    fields,
    pulados,
    comentario: '📅 Reunião agendada pelo QS para ' + legivel +
      (body.meeting_owner ? ' com ' + body.meeting_owner : '') + '.' +
      (body.meeting_link ? '\nMeet: ' + body.meeting_link : '\n(sem link do Meet ainda)') +
      (body.scheduled_by ? '\nAgendada por: ' + body.scheduled_by : '') +
      (pulados.length ? '\n⚠️ Não preenchidos: ' + pulados.join('; ') : ''),
  };
}

/**
 * A reunião leva o card da PRÉ-VENDAS pro funil do closer?
 *
 * 04/11: o corte do n8n (03/11, no ar às 19h24) tirou isso sem ninguém ver. O
 * webhook `qs-reuniao` que rodava no n8n movia o card pra Comercial 1 ›
 * "Reunião de Vendas" (a cópia do workflow no repositório estava com
 * STAGE_REUNIAO vazio, diferente da que rodava). Medido no espelho do
 * Dashboard: até 19h12 de 03/11 todo agendamento ia pro Comercial 1; depois
 * das 19h24, 53599, 53825, 52959 e 54295 ficaram em "Novo Lead" com reunião
 * marcada.
 *
 * Só sai quem AINDA está no funil 25. O mesmo evento é mandado de novo no
 * reagendamento, e aí o card costuma já estar em "Em Negociação": movê-lo
 * seria puxar pra trás. Destino é o MESMO do autoagendamento
 * (qs_settings.bitrix_reuniao), pra os dois caminhos não divergirem.
 */
export const FUNIL_PRE_VENDAS = '25';

export function deveLevarParaReuniao(deal, destino) {
  if (!deal) return { mover: false, motivo: 'bitrix-inacessivel' };
  if (!destino || destino.categoria == null || !destino.etapa) return { mover: false, motivo: 'sem-destino-configurado' };
  const categoria = String(deal.CATEGORY_ID ?? '');
  if (categoria !== FUNIL_PRE_VENDAS) return { mover: false, motivo: `fora-da-pre-vendas (funil ${categoria || '?'})` };
  if (String(deal.CATEGORY_ID) === String(destino.categoria) && String(deal.STAGE_ID) === String(destino.etapa)) {
    return { mover: false, motivo: 'ja-esta-la' };
  }
  return { mover: true, motivo: null };
}

/** O que vai em qs_meetings depois que o card foi gravado (igual ao n8n). */
export function marcaDeSincronizada(pulados, agoraIso = new Date().toISOString()) {
  return {
    bitrix_synced: true,
    bitrix_synced_at: agoraIso,
    bitrix_error: pulados && pulados.length ? ('gravado, mas sem: ' + pulados.join('; ')).slice(0, 900) : null,
  };
}

// ─── CATÁLOGO DE CAMPOS (antes: n8n/qs-sync-catalogo-bitrix.workflow.json) ──

/**
 * crm.deal.userfield.list + crm.deal.fields → linhas de bitrix_fields e
 * bitrix_field_options. NUNCA devolve `alias`: o apelido é preenchido à mão
 * e o upsert (merge-duplicates) só toca as colunas que vão no corpo.
 */
export function montarLinhasCatalogo(lista, dicionario, runTs) {
  // Rótulos, do crm.deal.fields: formLabel/listLabel. O 'title' repete o nome técnico.
  const rotulos = {};
  const dic = dicionario || {};
  for (const k of Object.keys(dic)) {
    const d = dic[k] || {};
    const r = d.formLabel || d.listLabel || d.title || '';
    if (r && r !== k) rotulos[k] = String(r);
  }

  const campos = [];
  const opcoes = [];
  for (const f of lista || []) {
    if (!f || !f.FIELD_NAME) continue;
    let label = rotulos[f.FIELD_NAME];
    if (!label) {
      label = f.EDIT_FORM_LABEL || f.LIST_COLUMN_LABEL || f.FIELD_NAME;
      if (label && typeof label === 'object') {
        label = label.br || label.pt || label.en || Object.values(label)[0] || f.FIELD_NAME;
      }
    }
    campos.push({
      field_name: f.FIELD_NAME,
      user_type_id: f.USER_TYPE_ID,
      label: String(label || f.FIELD_NAME),
      mandatory: f.MANDATORY === 'Y',
      synced_at: runTs,
    });
    for (const item of f.LIST || []) {
      opcoes.push({
        field_name: f.FIELD_NAME,
        option_id: Number(item.ID),
        value: item.VALUE,
        sort: Number(item.SORT) || 500,
        active: true,
        synced_at: runTs,
      });
    }
  }
  return { campos, opcoes, semRotulo: campos.filter((c) => c.label === c.field_name).length };
}
