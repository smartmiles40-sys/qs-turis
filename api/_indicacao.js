// api/_indicacao.js
// -----------------------------------------------------------------------------
// INDICAÇÕES DA BLACK (Bruno, 18/11/2026).
//
// A cliente (INDICADORA) abre /indique/, informa nome + WhatsApp dela e de até
// 5 pessoas (os INDICADOS). Este módulo:
//   1. grava UMA linha por indicado em qs_indicacoes ANTES de qualquer coisa —
//      se o Bitrix ou o QS falharem depois, a indicação (e o direito ao
//      presente) não se perde;
//   2. cria o lead de cada indicado pelo MESMO caminho de qualquer lead do QS
//      (createInboundLead): dono pela carteira/rodízio, Cadência SDR, negócio
//      no Bitrix com o responsável certo. Decisão do Bruno: indicado que já foi
//      lead antigo ganha card NOVO (o dedupe do QS só junta o que entrou nas
//      últimas 24h — ex.: duas indicadoras mandando a mesma pessoa no dia);
//   3. escreve quem indicou na ficha (nota no QS) e no negócio (comentário na
//      timeline do Bitrix), pro SDR abrir a conversa com "a Fulana indicou você"
//      e pro comercial saber a quem mandar a mala quando fechar.
//
// Chamado pelo /api/lead-site quando o corpo traz `indicados` — a rota pública
// já tem CORS por allowlist, campo-armadilha e teto por IP.
//
// Os indicados são processados UM DE CADA VEZ, de propósito: o Bitrix limita
// chamadas por segundo, e o disparo pra base inteira concentra envios nos
// primeiros minutos. Se o Bitrix recusar, o lead entra mesmo assim e fica
// pendente — a rotina de nova tentativa cria o card depois.
// -----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';
import { rest, insert } from './_supabaseAdmin.js';
import { normPhone, createInboundLead } from './_leads.js';
import { waKey } from './_wa.js';
import { comentarNoNegocio } from './_bitrixLead.js';
import { texto } from './lead.js';

export const MAX_INDICADOS = 5;
const CAMPANHA = 'black-2026';
const FONTE = '[Indicação Black] - Orgânico';

function telValido(t) {
  return !!t && t.length >= 10 && t.length <= 13;
}

/**
 * Valida e limpa o corpo do formulário. Devolve { erro } ou
 * { indicadora: {nome, tel}, indicados: [{nome, tel}], descartados: n }.
 * Exportada pra teste.
 */
export function lerIndicacao(body) {
  const nomeInd = texto(body?.nome, 120);
  const telInd = normPhone(body?.telefone);
  if (!nomeInd) return { erro: 'Informe o seu nome' };
  if (!telValido(telInd)) return { erro: 'Seu WhatsApp parece incompleto (DDD + número)' };

  const chaveInd = waKey(telInd);
  const vistos = new Set();
  const indicados = [];
  let descartados = 0;
  const brutos = Array.isArray(body?.indicados) ? body.indicados.slice(0, MAX_INDICADOS * 2) : [];
  for (const r of brutos) {
    const nome = texto(r?.nome, 120);
    const tel = normPhone(r?.telefone);
    if (!nome && !tel) continue;                       // linha em branco
    if (!nome || !telValido(tel)) { descartados++; continue; }
    const chave = waKey(tel);
    if (chave === chaveInd) { descartados++; continue; } // indicou a si mesma
    if (vistos.has(chave)) { descartados++; continue; }   // mesmo número 2x no envio
    vistos.add(chave);
    indicados.push({ nome, tel });
    if (indicados.length >= MAX_INDICADOS) break;
  }
  if (!indicados.length) return { erro: 'Informe pelo menos uma indicação com nome e WhatsApp válidos' };
  return { indicadora: { nome: nomeInd, tel: telInd }, indicados, descartados };
}

/** Processa um envio já validado. Nunca levanta exceção por um indicado só. */
export async function registrarIndicacao({ indicadora, indicados }) {
  const envioId = randomUUID();

  // 1) A INDICAÇÃO PRIMEIRO. Se isto falhar, o envio falha (a cliente vê o erro
  //    e tenta de novo) — melhor do que criar lead sem saber quem indicou.
  const linhas = await insert('qs_indicacoes', indicados.map((i) => ({
    campanha: CAMPANHA,
    indicadora_nome: indicadora.nome,
    indicadora_tel: indicadora.tel,
    indicado_nome: i.nome,
    indicado_tel: i.tel,
    envio_id: envioId,
  })));
  const ids = (Array.isArray(linhas) ? linhas : []).map((l) => l.id);

  let criados = 0;
  for (let k = 0; k < indicados.length; k++) {
    const i = indicados[k];
    const indicacaoId = ids[k];
    try {
      const { lead, deduped } = await createInboundLead({
        full_name: i.nome,
        phone: i.tel,
        segment: FONTE,
        source: 'integracao',
        // UTMs vão pro negócio do Bitrix (campos que o Dashboard lê).
        utm_source: 'indicacao',
        utm_medium: 'whatsapp',
        utm_campaign: 'black-indicacoes',
      });
      if (!lead?.id) continue;
      criados++;

      if (indicacaoId) {
        await rest(`qs_indicacoes?id=eq.${indicacaoId}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { lead_id: lead.id, lead_ja_existia: !!deduped },
        }).catch((e) => console.warn('[indicacao] vínculo lead↔indicação:', e?.message));
      }

      const aviso =
        `🎁 INDICAÇÃO BLACK — indicado(a) por ${indicadora.nome} (${indicadora.tel}).\n` +
        `Na primeira mensagem, cite o nome de quem indicou: "A ${indicadora.nome.split(' ')[0]} indicou você…".\n` +
        'Se fechar venda, a indicadora ganha a mala com mimos — avise a gestão.';

      await insert('qs_notes', {
        lead_id: lead.id, author_id: null, body: aviso, tags: ['indicacao', 'black'],
      }, { returning: false }).catch((e) => console.warn('[indicacao] nota:', e?.message));

      // O negócio é criado dentro do createInboundLead; o id volta no lead.
      if (lead.bitrix_id) await comentarNoNegocio(lead.bitrix_id, aviso);
    } catch (e) {
      // A linha em qs_indicacoes fica com lead_id vazio: aparece no relatório
      // como "sem lead" e dá pra criar à mão. Nada se perde.
      console.error('[indicacao] lead do indicado falhou:', e?.message || e);
    }
  }
  console.log(`[indicacao] envio ${envioId}: ${indicados.length} indicados, ${criados} leads`);
  return { envioId, recebidos: indicados.length, criados };
}
