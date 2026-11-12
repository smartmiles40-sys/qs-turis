// api/_closerBitrixPlano.js
// -----------------------------------------------------------------------------
// PIPELINE DO CLOSER → BITRIX: a DECISÃO, sem rede (03/11/2026).
//
// O api/closer.js lê o card (crm.deal.get) e as colunas do funil
// (crm.status.list) e pergunta aqui o que fazer. Separado pra dar pra testar e
// pra existir o modo "conferir" (lista o que seria enviado, sem enviar).
//
// MAPEAMENTO etapa do QS → coluna do Bitrix. Pelo NOME da coluna, não pelo id
// (o id é opaco e muda por funil). Conferido em 03/11 contra o portal
// (GET /api/bitrix-etapas), funil 0 "Comercial 1 - Se tu for eu vou":
//
//   aguardando_reuniao  → EXECUTING   "Reunião de Vendas"   (não existe coluna
//                         "Aguardando reunião": é pra onde a reunião marcada
//                         leva o card — qs_settings.bitrix_reuniao)
//   reagendamento       → UC_ANBZSL   "Reagendamento"
//   em_cotacao          → UC_3I8BDW   "Em cotação"
//   em_negociacao       → UC_YGG9JY   "Em Negociação"
//   no_show             → UC_3Y96XD   "No-Show"
//   oportunidade_futura → UC_PV9OAM   "Oportunidade futura"
//   aguardando_emissao  → UC_70BW8E   "Em Emissão / Pix Expedição" (venda no Dashboard)
//   venda_realizada     → WON         "Venda realizada"
//   perdido             → LOSE        "Perdidos"
//   venda_cancelada     → UC_NV92A7   "Cancelamento/Desistência"
//
// ONDE O QS MEXE:
//   • card no funil 0 (Comercial 1)  → muda a coluna.
//   • card ainda na Pré-Vendas (25)  → leva pro funil 0 já na coluna certa
//     (a reunião marcada devia ter levado; se não levou, o espelho conserta).
//   • card em QUALQUER OUTRO funil (Relacionamento, Pós-venda, Operações…):
//     o cron NÃO mexe (outro time cuida dele lá). Pela pessoa (botão
//     "Reenviar"), vale a coluna de mesmo nome naquele funil, como antes.
//
// NUNCA PUXA PRA TRÁS SOZINHO: se no Bitrix o card já está em venda (Em
// Emissão, Gerar Pagamento, Envio de contrato, Venda realizada) ou encerrado
// (Perdidos, Cancelamento), o CRON não tira de lá pra uma etapa aberta do QS —
// alguém mexeu à mão no Bitrix e só a pessoa, pelo cartão, decide.
// -----------------------------------------------------------------------------

export const FUNIL_COMERCIAL = '0';
export const FUNIL_PRE_VENDAS = '25';
export const CAMPO_TIPO_VENDA = 'UF_CRM_1743296167520'; // enum "Tipo de venda" — o Bitrix quer o id em STRING

// MOTIVO (revisão 12/11): o cartão perdido/cancelado leva o motivo pro card.
//   • Perdido → "Motivo de perda" (enum do funil 0, lido do catálogo bitrix_fields
//     em 12/11). O closer escreve texto livre; aqui vira a opção mais parecida
//     (sem casar → "Outros"). O texto inteiro vai num comentário (api/_closerEspelho.js).
//   • Venda cancelada → "motivo da desistência" (texto; o mesmo campo que o lado
//     SDR usa na desistência — api/bitrix-sync.js CAMPO.desist_motivo).
export const CAMPO_MOTIVO_PERDA = 'UF_CRM_1744663824797';
export const CAMPO_MOTIVO_DESISTENCIA = 'UF_CRM_1789683835018';
export const OPCAO_MOTIVO_PERDA = {
  outra_agencia: '145', nao_responde: '147', caro: '149', pesquisando: '151', desistiu: '153',
  sem_dinheiro: '155', conta_propria: '157', follow_up: '453', no_show: '745', outros: '159',
};
const REGRAS_MOTIVO = [
  [/no.?show|nao apareceu|nao compareceu|faltou/, 'no_show'],
  [/outra agencia|concorren|fechou com outr|fechou em outr/, 'outra_agencia'],
  [/conta propria|por conta|sozinh|direto (na|no|com)/, 'conta_propria'],
  [/nao respond|sem resposta|sem retorno|sumiu|nao atend|vacuo|nao retorn/, 'nao_responde'],
  [/sem dinheiro|dinheiro|financ|grana|sem condic|desempreg/, 'sem_dinheiro'],
  [/caro|preco|valor alto|acima do orcamento|orcamento/, 'caro'],
  [/pesquis|so cotando|so orcando|curios/, 'pesquisando'],
  [/desist|cancel|nao vai (mais )?viajar|adiou/, 'desistiu'],
  [/follow/, 'follow_up'],
];
/** Texto livre do motivo → id da opção do enum "Motivo de perda" (string, como o Bitrix quer). */
export function opcaoMotivoPerda(texto) {
  const t = semAcento(texto);
  if (!t.trim()) return null;
  for (const [re, chave] of REGRAS_MOTIVO) if (re.test(t)) return OPCAO_MOTIVO_PERDA[chave];
  return OPCAO_MOTIVO_PERDA.outros;
}
const valorDoCampo = (v) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();

export const NOMES_BITRIX = {
  aguardando_reuniao: [/aguardando\s+reuni/, /reuniao\s+de\s+venda/],
  reagendamento: [/reagend/],
  em_cotacao: [/em\s+cotac/, /cotac/],
  em_negociacao: [/negocia/],
  no_show: [/no.?show/],
  oportunidade_futura: [/oportunidade\s+futura/],
  // Gerar Pagamento / Envio de contrato vêm depois da venda: na volta (Bitrix →
  // QS) contam como venda; na ida, a coluna de venda é a 1ª que casar (Em Emissão).
  aguardando_emissao: [/aguardando\s+emiss/, /em\s+emiss/, /gerar\s+pagamento/, /envio\s+de\s+contrato/],
  venda_cancelada: [/venda\s+cancelada/, /cancelad/, /desist/],
  perdido: [/perdid/],
  venda_realizada: [/venda\s+realizada/],
};

export const NOME_ETAPA = {
  aguardando_reuniao: 'Aguardando reunião', reagendamento: 'Reagendamento', em_cotacao: 'Em cotação',
  em_negociacao: 'Em negociação', no_show: 'No-show', oportunidade_futura: 'Oportunidade futura',
  aguardando_emissao: 'Aguardando emissão', venda_cancelada: 'Venda cancelada', perdido: 'Perdido',
  venda_realizada: 'Venda realizada',
};

export const ETAPAS_DE_VENDA = ['aguardando_emissao', 'venda_realizada'];
export const ETAPAS_ENCERRADAS = ['venda_cancelada', 'perdido'];
const ETAPAS_FECHADAS = ['venda_realizada', 'venda_cancelada', 'perdido', 'aguardando_emissao'];

export const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** A coluna do Bitrix pra uma etapa do QS (null se o funil não tem). */
export function colunaParaEtapa(lista, etapa) {
  for (const re of NOMES_BITRIX[etapa] || []) {
    const achou = (lista || []).find((e) => re.test(semAcento(e?.NAME)));
    if (achou) return String(achou.STATUS_ID);
  }
  const id = (e) => String(e?.STATUS_ID || '');
  if (etapa === 'venda_realizada') { const w = (lista || []).find((e) => /(^|:)WON$/.test(id(e))); if (w) return id(w); }
  if (etapa === 'perdido') { const l = (lista || []).find((e) => /(^|:)LOSE$/.test(id(e))); if (l) return id(l); }
  // Funil 0: a coluna da reunião é a EXECUTING, mesmo se alguém renomear.
  if (etapa === 'aguardando_reuniao') { const x = (lista || []).find((e) => id(e) === 'EXECUTING'); if (x) return 'EXECUTING'; }
  return null;
}

/** O caminho de volta: coluna do Bitrix → etapa do QS. */
export function etapaParaColuna(lista, statusId) {
  const col = (lista || []).find((e) => String(e?.STATUS_ID) === String(statusId));
  const nome = col?.NAME || String(statusId);
  const n = semAcento(col?.NAME);
  // WON/LOSE primeiro: no Relacionamento o LOSE se chama "Cotação Enviada".
  if (/(^|:)WON$/.test(String(statusId))) return { etapa: 'venda_realizada', nome };
  if (/(^|:)LOSE$/.test(String(statusId))) return { etapa: 'perdido', nome };
  for (const [etapa, res] of Object.entries(NOMES_BITRIX)) if (n && res.some((re) => re.test(n))) return { etapa, nome };
  return { etapa: null, nome };
}

export const emPreVenda = (n) => Boolean(n?.pre_venda_em) && !n.consolidada_em && !ETAPAS_FECHADAS.includes(n.etapa);
/** A etapa que o Bitrix deve mostrar: a do cartão ou, em pré-venda, a de venda. */
export const etapaNoBitrix = (n) => (emPreVenda(n) ? 'aguardando_emissao' : n.etapa);

const nomeDaColuna = (lista, id) => (lista || []).find((e) => String(e?.STATUS_ID) === String(id))?.NAME || String(id || '—');

/**
 * O que o espelho faria com este cartão. Não chama rede.
 *   n           = linha de qs_closer_negocios
 *   deal        = crm.deal.get
 *   lista       = colunas do funil em que o card está
 *   listaComercial = colunas do funil 0 (só precisa se o card estiver na Pré-Vendas)
 *   porPessoa   = true quando alguém clicou (pode mais que o cron)
 *   valorFilhos = 0351: soma do que foi pros cards filhos da família (o pai leva o resto)
 *   vendaCancelada = qs_vendas.estado 'cancelada' (11/11): o cron PODE tirar o card da
 *                 coluna de venda (foi o próprio QS que pôs lá com a reserva/pré-venda)
 *   responsavel = id do usuário NO BITRIX que deve ser o responsável (12/11: só vem
 *                 quando o responsável do cartão foi trocado no QS e ainda não subiu)
 * Devolve { ok, fields, etapaAlvo, preVenda, valor, valorVenda, valorFilhos, de, para, motivo }.
 *   ok=false → não envia; `motivo` explica (vira o bitrix_erro do cartão).
 *   fields vazio → já está igual, nada a enviar.
 */
export function planejarEspelho({ n, deal, lista, listaComercial = null, porPessoa = false, valorFilhos = 0, vendaCancelada = false, responsavel = null }) {
  const etapaAlvo = etapaNoBitrix(n);
  const preVenda = emPreVenda(n);
  const funil = String(deal?.CATEGORY_ID ?? '0');
  const atual = String(deal?.STAGE_ID || '');
  const de = { funil, coluna: atual, nome: nomeDaColuna(lista, atual) };
  const base = { etapaAlvo, preVenda, de };

  let alvo = null;
  let colunas = lista;
  let mudaFunil = false;
  if (funil === FUNIL_COMERCIAL) {
    alvo = colunaParaEtapa(lista, etapaAlvo);
  } else if (funil === FUNIL_PRE_VENDAS) {
    colunas = listaComercial || [];
    alvo = colunaParaEtapa(colunas, etapaAlvo);
    mudaFunil = true;
  } else if (porPessoa) {
    alvo = colunaParaEtapa(lista, etapaAlvo);
  } else {
    return { ...base, ok: false, fields: {}, motivo: `No Bitrix este negócio está em outro funil (${funil}, coluna "${de.nome}"). O QS só move sozinho no Comercial 1; se for pra mover, use "Reenviar ao Bitrix".` };
  }

  if (!alvo) {
    return {
      ...base, ok: false, fields: {},
      motivo: preVenda
        ? 'O funil deste negócio não tem coluna de venda ("Em emissão" / "Aguardando emissão"). A pré-venda ficou só no QS.'
        : `O funil deste negócio não tem a coluna "${NOME_ETAPA[n.etapa] || n.etapa}". Crie a coluna com esse nome no Bitrix e reenvie.`,
    };
  }

  // O cron nunca tira do Bitrix um card que alguém já levou pra venda ou
  // encerrou à mão. Só a pessoa, pelo cartão, decide isso.
  if (!porPessoa && !mudaFunil && atual !== alvo) {
    const noBitrix = etapaParaColuna(lista, atual).etapa;
    const bitrixNaVenda = ETAPAS_DE_VENDA.includes(noBitrix);
    const bitrixEncerrado = ETAPAS_ENCERRADAS.includes(noBitrix);
    const qsNaVenda = ETAPAS_DE_VENDA.includes(etapaAlvo);
    const qsEncerrado = ETAPAS_ENCERRADAS.includes(etapaAlvo);
    if (bitrixNaVenda && !qsNaVenda && etapaAlvo !== 'venda_cancelada' && !vendaCancelada) {
      return { ...base, ok: false, fields: {}, motivo: `No Bitrix este negócio já está em "${de.nome}" (venda). O QS não tira de lá sozinho: se a venda é real, registre a venda no cartão; se não, use "Reenviar ao Bitrix".` };
    }
    if (bitrixEncerrado && !qsNaVenda && !qsEncerrado) {
      return { ...base, ok: false, fields: {}, motivo: `No Bitrix este negócio já está em "${de.nome}" (encerrado). O QS não reabre sozinho: se o cliente voltou, use "Reenviar ao Bitrix".` };
    }
  }

  const valorVenda = Number(n.ficha?.valor_total ?? (preVenda ? n.pre_venda_valor : null) ?? n.valor_previsto ?? 0);
  // 0351 (família): cada card = 1 venda com o próprio valor. Com cards filhos, o
  // PAI leva só o que não foi pra eles (total − soma dos filhos), senão o
  // Dashboard conta em dobro. Pode dar 0 (titular sem valor próprio) — e vai 0.
  const filhos = Math.round(Number(valorFilhos || 0) * 100) / 100;
  const valor = filhos > 0 ? Math.max(Math.round((valorVenda - filhos) * 100) / 100, 0) : valorVenda;
  const fields = {};
  if (mudaFunil) fields.CATEGORY_ID = Number(FUNIL_COMERCIAL);
  if (mudaFunil || atual !== alvo) fields.STAGE_ID = alvo;
  if ((valor > 0 || filhos > 0) && Math.abs(Number(deal?.OPPORTUNITY || 0) - valor) > 0.009) {
    fields.OPPORTUNITY = valor;
    fields.CURRENCY_ID = 'BRL';
  }
  // "Tipo de venda" (o Dashboard filtra aéreo por ele): na pré-venda o closer
  // acabou de dizer o que vendeu → grava; pela ficha, só PREENCHE card vazio.
  if (ETAPAS_DE_VENDA.includes(etapaAlvo)) {
    const tipoPre = preVenda ? String(n.pre_venda_tipo_bitrix || '').replace(/\D/g, '') : '';
    const tipoFicha = String(n.ficha?.tipo_bitrix || '').replace(/\D/g, '');
    const v = deal?.[CAMPO_TIPO_VENDA];
    const atualTipo = String(Array.isArray(v) ? v[0] ?? '' : v ?? '');
    if (tipoPre && atualTipo !== tipoPre) fields[CAMPO_TIPO_VENDA] = tipoPre;
    else if (!tipoPre && tipoFicha && !atualTipo) fields[CAMPO_TIPO_VENDA] = tipoFicha;
  }
  // Motivo (12/11): perdido → enum "Motivo de perda"; venda cancelada → texto da desistência.
  const motivo = String(n.motivo_perda || '').trim();
  if (motivo && etapaAlvo === 'perdido') {
    const op = opcaoMotivoPerda(motivo);
    if (op && valorDoCampo(deal?.[CAMPO_MOTIVO_PERDA]) !== op) fields[CAMPO_MOTIVO_PERDA] = op;
  }
  if (motivo && etapaAlvo === 'venda_cancelada') {
    const txt = motivo.slice(0, 250);
    if (valorDoCampo(deal?.[CAMPO_MOTIVO_DESISTENCIA]) !== txt) fields[CAMPO_MOTIVO_DESISTENCIA] = txt;
  }
  // Responsável trocado no QS (closer_negocio_trocar_closer) → o card muda de dono no Bitrix.
  const resp = String(responsavel || '').replace(/\D/g, '');
  if (resp && valorDoCampo(deal?.ASSIGNED_BY_ID) !== resp) fields.ASSIGNED_BY_ID = resp;
  return {
    ...base, ok: true, fields, valor, valorVenda, valorFilhos: filhos,
    para: { funil: mudaFunil ? FUNIL_COMERCIAL : funil, coluna: alvo, nome: nomeDaColuna(colunas, alvo) },
  };
}
