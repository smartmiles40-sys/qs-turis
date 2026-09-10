// api/_vinculo.js
// -----------------------------------------------------------------------------
// O CRACHÁ DO AGENDAMENTO: um bilhete assinado que diz "este agendamento é deste
// lead", e que pode passar pela mão do navegador sem virar uma porta.
//
// POR QUE EXISTE. Quem agenda pelo formulário de live tem o card criado do outro
// lado (o `/api/save-lead` do stfv-forms), e o QS nunca ficava sabendo o número
// dele: `qs_leads.bitrix_id` ficava nulo. Medido em 09/09: 17 das 18 reuniões
// nascidas ali estão assim — e sem esse número TODO o resto do funil morre em
// silêncio (`/api/bitrix-sync` responde `skipped_no_bitrix_id`). Desfecho,
// no-show, reunião realizada, SAL, produto e movimento de coluna: nada volta pro
// card.
//
// POR QUE NÃO É SÓ O `lead_id`. Id de lead vindo do navegador é o defeito que já
// custou caro aqui: qualquer um poderia declarar que o negócio X pertence ao
// lead alheio Y (ver o cabeçalho de `_bitrixLead.js` e a nota do laço que
// sobrescrevia o card). O crachá resolve porque quem ASSINA é o servidor: o
// navegador carrega o bilhete, não escreve nele. Mexer em um byte invalida.
//
// O QUE ELE NÃO PROTEGE. Quem tem o próprio crachá em mãos pode grudar um número
// de negócio errado NO PRÓPRIO LEAD. É o limite aceito: o estrago fica no lead de
// quem fez, o vínculo é registrado em nota nas duas pontas, e nenhum lead de
// terceiro é alcançável.
//
// Segredo: LEAD_INBOUND_SECRET, o mesmo que já autentica `/api/lead-inbound` e
// `/api/bitrix-etapas`. Sem ele configurado, `assinar` devolve null e o caminho
// todo simplesmente não acontece — em vez de assinar com segredo vazio, que é
// pior do que não assinar.
// -----------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from 'node:crypto';

/** 6 horas. Tempo de sobra pra fase 2 do formulário (que é imediata) e curto o
 *  suficiente pra um bilhete vazado não valer nada amanhã. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function segredo() {
  const s = process.env.LEAD_INBOUND_SECRET;
  return typeof s === 'string' && s.length >= 16 ? s : null;
}

function firma(corpo) {
  return b64(createHmac('sha256', segredo()).update(corpo).digest());
}

/**
 * Assina "este agendamento é do lead L (reunião M)". Devolve o crachá ou null.
 */
export function assinarVinculo({ leadId, meetingId = null, agora = Date.now() }) {
  if (!segredo() || !leadId) return null;
  const corpo = b64(JSON.stringify({ l: String(leadId), m: meetingId ? String(meetingId) : null, e: agora + VALIDADE_MS }));
  return `v1.${corpo}.${firma(corpo)}`;
}

/**
 * Confere o crachá. Devolve `{ leadId, meetingId }` ou null — null é sempre
 * "não confio", nunca "deu erro": quem chama trata os dois do mesmo jeito.
 */
export function verificarVinculo(token, agora = Date.now()) {
  if (!segredo() || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== 'v1') return null;

  const [, corpo, assinatura] = partes;
  try {
    const esperada = Buffer.from(firma(corpo));
    const recebida = Buffer.from(assinatura);
    // Comparação em tempo constante, e o tamanho é conferido antes: o
    // timingSafeEqual lança quando os buffers têm tamanhos diferentes.
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!dados?.l || !Number.isFinite(dados.e) || dados.e < agora) return null;
    return { leadId: String(dados.l), meetingId: dados.m ? String(dados.m) : null };
  } catch {
    return null;
  }
}
