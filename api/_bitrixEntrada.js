// api/_bitrixEntrada.js
// -----------------------------------------------------------------------------
// O QUE O BITRIX MANDA, LIDO DO JEITO QUE O BITRIX MANDA (corte do n8n, 03/11).
//
// Até 03/11 toda chamada do Bitrix pro QS passava pelo n8n: um robô ou webhook
// de saída chamava `n8n-mowr.../webhook/<path>`, um nó "Normalizar" lia os
// campos e só então o n8n chamava o QS. Aqui mora a parte "Normalizar" — o
// resto (criar lead, dedupe, primeiro contato) continua sendo a lógica que já
// existia em `_leads.js`, `lead-inbound.js` e `_primeiroContato.js`.
//
// TRÊS JEITOS DE O BITRIX FALAR, e os três chegam aqui:
//
//   • robô "Webhook" da automação: os dados vêm na QUERY STRING da URL que a
//     gente escreveu no robô (`&Telefone={{Contato: Telefone}}`), e o corpo,
//     form-urlencoded, traz só os metadados dele: `document_id[]=crm`,
//     `document_id[]=CCrmDocumentDeal`, `document_id[]=DEAL_123`, `auth[...]`.
//   • webhook de SAÍDA (eventos ONCRMDEALADD, ONCRMACTIVITYUPDATE...): corpo
//     form-urlencoded com `event`, `data[FIELDS][ID]`, `auth[application_token]`.
//   • JSON comum (formulário, curl, teste).
//
// NOME DE CAMPO SEM DIFERENCIAR MAIÚSCULA — já aconteceu: o Bitrix mandava
// `&Telefone=` e o n8n lia `telefone`; o lead chegava sem número. Aqui toda
// chave vira minúscula, sem acento e sem pontuação antes de ser procurada:
// `Telefone`, `TELEFONE` e `telefone` são a mesma coisa; `E-mail` e `email`
// também; `data[FIELDS][ID]` vira `datafieldsid`.
//
// Tudo aqui é função pura (exceto o que recebe `bx` por parâmetro), pra poder
// testar sem rede — tests/bitrix-entrada/*.test.ts.
// -----------------------------------------------------------------------------

/** `E-mail` → `email`, `data[FIELDS][ID]` → `datafieldsid`, `Pontuação` → `pontuacao`. */
export function chave(k) {
  return String(k ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Corpo como veio. A Vercel já entrega objeto quando o Content-Type é JSON ou
 * form-urlencoded; quando não reconhece o tipo, chega string (ou Buffer). Aí a
 * gente tenta JSON e, não sendo, lê como form-urlencoded.
 */
export function lerCorpo(body) {
  if (body == null) return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    const s = body.trim();
    if (!s) return {};
    if (s.startsWith('{') || s.startsWith('[')) {
      try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : {}; } catch { /* cai no form */ }
    }
    const out = {};
    for (const [k, v] of new URLSearchParams(s)) {
      if (k in out) out[k] = [].concat(out[k], v);
      else out[k] = v;
    }
    return out;
  }
  return typeof body === 'object' ? body : {};
}

/** Valor de template que o Bitrix não substituiu (`{{Contato: Telefone}}`) não é dado. */
function ehVazio(v) {
  const s = String(v ?? '').trim();
  return !s || /^\{\{.*\}\}$/.test(s);
}

/**
 * Achata query + corpo num mapa { chaveNormalizada: valor }. A QUERY VENCE: é
 * onde o robô do Bitrix põe o que interessa, e o corpo dele é só metadado.
 * Objeto aninhado (`data: { FIELDS: { ID } }`) e chave achatada
 * (`"data[FIELDS][ID]"`) dão a mesma chave. Lista vira `chave0`, `chave1`... e a
 * própria `chave` fica com o primeiro valor não vazio.
 */
export function achatar(...fontes) {
  const mapa = {};
  const por = (k, v) => {
    if (ehVazio(v)) return;
    if (!(k in mapa)) mapa[k] = String(v).trim();
  };
  const andar = (obj, prefixo, prof) => {
    if (prof > 5 || obj == null) return;
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => {
        if (v && typeof v === 'object') andar(v, prefixo + i, prof + 1);
        else { por(prefixo + i, v); por(prefixo, v); }
      });
      return;
    }
    if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) andar(v, prefixo + chave(k), prof + 1);
      return;
    }
    por(prefixo, obj);
  };
  for (const f of fontes) andar(f, '', 0);
  return mapa;
}

/** Primeiro valor não vazio entre os nomes (já comparados sem maiúscula/acento). */
export function pegar(mapa, ...nomes) {
  for (const n of nomes) {
    const v = mapa[chave(n)];
    if (!ehVazio(v)) return String(v).trim();
  }
  return null;
}

/**
 * Id do negócio. Ordem: o campo que a gente mandou no robô (`ID`, `bitrix_id`),
 * o do evento de saída (`data[FIELDS][ID]`) e, por último, o `document_id[]`
 * que todo robô manda (`DEAL_123`). Só aceita número: "DEAL_123" vira "123",
 * "LEAD_9" é de outra entidade e não serve.
 */
export function idDoNegocio(mapa) {
  const explicito = pegar(mapa, 'bitrix_id', 'id_bitrix', 'ID', 'deal_id', 'data[FIELDS][ID]');
  if (explicito) {
    const m = /^(?:DEAL_)?(\d+)$/i.exec(explicito);
    if (m) return m[1];
  }
  for (const [k, v] of Object.entries(mapa)) {
    if (!k.startsWith('documentid')) continue;
    const m = /^DEAL_(\d+)$/i.exec(String(v).trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * Telefone da lista de resgate, como o nó "Padronizar o lead" do n8n fazia:
 * 55 + DDD + número, porque é por ele que o QS descobre quem já está na base.
 * Número que não fecha 12/13 dígitos volta null (o n8n mandava vazio).
 */
export function telefoneResgate(v) {
  const primeiro = String(v ?? '').split(/[,;/|\n\r]+/).map((p) => p.replace(/\D/g, '')).find(Boolean) || '';
  let d = primeiro.replace(/^0+/, '');
  if (!d) return null;
  if (!d.startsWith('55')) d = '55' + d;
  return d.length === 12 || d.length === 13 ? d : null;
}

/**
 * O lead no formato do /api/lead-inbound. Junta as três versões do nó
 * "Normalizar" que existiam no n8n (qs-bitrix-completo, qs-inbound-leads e o
 * do resgate) — todas liam os mesmos campos, só com maiúscula diferente.
 *
 * `opts.resgate` liga os padrões da lista de resgate: Fonte "Resgate" quando
 * não vier nenhuma, e telefone padronizado com 55.
 */
export function leadDoBitrix(mapa, opts = {}) {
  const nome = pegar(mapa, 'full_name', 'Nome', 'name', 'nome_completo', 'cliente');
  const sobrenome = pegar(mapa, 'last_name', 'Sobrenome');
  const primeiro = pegar(mapa, 'first_name');
  let full_name = nome || primeiro || null;
  if (full_name && sobrenome && !full_name.toLowerCase().includes(sobrenome.toLowerCase())) {
    full_name = `${full_name} ${sobrenome}`;
  }

  const foneCru = pegar(mapa, 'phone', 'Telefone', 'whatsapp', 'celular', 'fone');
  const phone = opts.resgate ? telefoneResgate(foneCru) : foneCru;

  const lead = {
    full_name,
    phone,
    email: pegar(mapa, 'email', 'E-mail', 'e_mail'),
    // Fonte aparece no card — é como o SDR sabe de onde a pessoa veio.
    segment: pegar(mapa, 'segment', 'Fonte', 'segmento', 'origem') ?? (opts.resgate ? 'Resgate' : null),
    // Temperatura: o Bitrix chama de LeadScoring ("Quente", "Morno", "Frio").
    lead_score: pegar(mapa, 'lead_score', 'Temperatura', 'Pontuacao', 'LeadScoring', 'Score'),
    city: pegar(mapa, 'city', 'cidade'),
    state: pegar(mapa, 'state', 'estado', 'uf'),
    company_name: pegar(mapa, 'company_name', 'empresa', 'company'),
    estimated_value: pegar(mapa, 'estimated_value', 'valor', 'OPPORTUNITY'),
    bitrix_id: idDoNegocio(mapa),
    // `source` tem CHECK no banco; _leads.js já troca valor estranho por
    // 'integracao'. Mandamos o mesmo que os workflows mandavam.
    source: opts.resgate ? 'resgate' : 'integracao',
    // UTM (0265): se o robô do Bitrix mandar na URL (&utm_campaign={{UTM_CAMPAIGN}}…),
    // o QS grava no lead pra casar com a campanha da Meta (Tráfego › Meta Ads).
    utm_source: pegar(mapa, 'utm_source', 'UTM_SOURCE'),
    utm_medium: pegar(mapa, 'utm_medium', 'UTM_MEDIUM'),
    utm_campaign: pegar(mapa, 'utm_campaign', 'UTM_CAMPAIGN'),
    utm_content: pegar(mapa, 'utm_content', 'UTM_CONTENT'),
    utm_term: pegar(mapa, 'utm_term', 'UTM_TERM'),
  };
  for (const k of Object.keys(lead)) if (lead[k] == null || lead[k] === '') delete lead[k];
  return lead;
}

/** Tem com o que achar/criar a pessoa? (mesma regra do lead-inbound). */
export function temIdentificador(lead) {
  return Boolean(lead.full_name || lead.phone || lead.email);
}

/**
 * O que o evento ONCRMDEALADD (ou um robô que só manda `document_id`) não traz:
 * os dados da pessoa. Faz o que o workflow `bitrix-to-qs` fazia — crm.deal.get
 * e crm.contact.get — e devolve os campos no mesmo formato de `leadDoBitrix`.
 * Só LÊ do Bitrix. `bx` vem por parâmetro (o de _bitrixLead.js em produção, um
 * falso nos testes).
 */
export async function completarPeloNegocio(dealId, bx) {
  const deal = await bx('crm.deal.get', { id: Number(dealId) });
  if (!deal) return null;
  let contato = null;
  if (deal.CONTACT_ID && String(deal.CONTACT_ID) !== '0') {
    try { contato = await bx('crm.contact.get', { id: Number(deal.CONTACT_ID) }); } catch { contato = null; }
  }
  const nome = [contato?.NAME, contato?.LAST_NAME].filter(Boolean).join(' ').trim();
  const extra = {
    full_name: nome || deal.TITLE || undefined,
    phone: contato?.PHONE?.[0]?.VALUE || undefined,
    email: contato?.EMAIL?.[0]?.VALUE || undefined,
    estimated_value: deal.OPPORTUNITY ? String(deal.OPPORTUNITY) : undefined,
    // Campos padrão de UTM do negócio no Bitrix (0265).
    utm_source: deal.UTM_SOURCE || undefined,
    utm_medium: deal.UTM_MEDIUM || undefined,
    utm_campaign: deal.UTM_CAMPAIGN || undefined,
    utm_content: deal.UTM_CONTENT || undefined,
    utm_term: deal.UTM_TERM || undefined,
  };
  for (const k of Object.keys(extra)) if (extra[k] == null || extra[k] === '') delete extra[k];
  return { deal, campos: extra };
}

// ── ATIVIDADE CONCLUÍDA NO BITRIX → CARD ANDA (era o bitrix-atividade-concluida) ─
//
// Rede de segurança do "1º contato move o card": se a SDR conclui a primeira
// atividade DENTRO do Bitrix, o negócio sai de "Novo Lead" pra "Follow-up 1".
// Mesmas regras do workflow (nó Config do qs-bitrix-completo):

export const ATIVIDADE_CFG = Object.freeze({
  STAGE_DE: 'C25:PREPAYMENT_INVOIC',   // "Novo Lead - Aguardando resposta"
  STAGE_PARA: 'C25:UC_271QUB',         // "Follow-up 1"
  // Atividade criada por robô (canal aberto/WhatsApp, formulário, e-mail,
  // notificação). Sem isto a mensagem do PRÓPRIO lead moveria o card.
  PROVIDERS_IGNORADOS: ['IMOPENLINES_SESSION', 'CRM_WEBFORM', 'CRM_EMAIL', 'CRM_NOTIFICATION'],
  SO_TIPOS: [],          // vazio = qualquer tipo (1 reunião, 2 ligação, 3 tarefa, 4 e-mail)
  SO_RESPONSAVEIS: [],   // vazio = qualquer responsável
});

/** Id da atividade no evento de saída (ONCRMACTIVITYADD/UPDATE). */
export function idDaAtividade(mapa) {
  const v = pegar(mapa, 'data[FIELDS][ID]', 'activity_id', 'FIELDS[ID]', 'ID');
  return v && /^\d+$/.test(v) ? v : null;
}

/** A atividade conta? Devolve o motivo quando não. Mesmas travas do nó "So atividade concluida do funil". */
export function atividadeConta(r, cfg = ATIVIDADE_CFG) {
  if (!r) return { conta: false, motivo: 'atividade_nao_encontrada' };
  if (String(r.OWNER_TYPE_ID) !== '2') return { conta: false, motivo: 'nao_e_de_negocio' };
  const concluida = String(r.COMPLETED).toUpperCase() === 'Y' || r.COMPLETED === true || String(r.STATUS) === '2';
  if (!concluida) return { conta: false, motivo: 'nao_concluida' };
  if (cfg.SO_TIPOS.length && !cfg.SO_TIPOS.includes(String(r.TYPE_ID))) return { conta: false, motivo: 'tipo_fora_do_filtro' };
  if (cfg.PROVIDERS_IGNORADOS.includes(String(r.PROVIDER_ID || ''))) return { conta: false, motivo: 'atividade_de_robo' };
  if (cfg.SO_RESPONSAVEIS.length && !cfg.SO_RESPONSAVEIS.includes(String(r.RESPONSIBLE_ID || ''))) {
    return { conta: false, motivo: 'responsavel_fora_do_filtro' };
  }
  return { conta: true };
}

/**
 * Lê a atividade, confere as travas, lê o negócio e — só se ele AINDA estiver
 * em "Novo Lead" — move pra "Follow-up 1" e comenta na timeline. Concluir a 2ª,
 * 3ª, 10ª atividade não faz nada, porque o negócio já saiu de lá.
 */
export async function processarAtividade(activityId, bx, cfg = ATIVIDADE_CFG) {
  const atv = await bx('crm.activity.get', { id: Number(activityId) });
  const c = atividadeConta(atv, cfg);
  if (!c.conta) return { movido: false, motivo: c.motivo };

  const deal = await bx('crm.deal.get', { id: Number(atv.OWNER_ID) });
  if (!deal) return { movido: false, motivo: 'negocio_nao_encontrado' };
  const atual = String(deal.STAGE_ID || '');
  if (atual !== cfg.STAGE_DE) return { movido: false, motivo: 'fora_de_novo_lead', etapa: atual };

  await bx('crm.deal.update', {
    id: Number(deal.ID), fields: { STAGE_ID: cfg.STAGE_PARA }, params: { REGISTER_SONET_EVENT: 'Y' },
  });
  try {
    await bx('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: Number(deal.ID), ENTITY_TYPE: 'deal',
        COMMENT: `[robô] Movido de Novo lead para Follow-up 1 — primeira atividade concluída: ${atv.SUBJECT || '-'}`,
      },
    });
  } catch { /* o card já andou; comentário é enfeite */ }
  return { movido: true, deal_id: String(deal.ID), de: atual, para: cfg.STAGE_PARA, activity_id: String(atv.ID ?? activityId) };
}
