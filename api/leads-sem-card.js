// api/leads-sem-card.js
// -----------------------------------------------------------------------------
// CONSERTA O PASSADO: lead que TEM reunião e NÃO tem número de card no QS.
//
//   GET  /api/leads-sem-card                 → só LISTA (não escreve nada)
//   POST /api/leads-sem-card?aplicar=1       → grava o vínculo onde tem certeza
//   header x-lead-secret: <LEAD_INBOUND_SECRET>
//
// POR QUE EXISTE. Quem agendou por um formulário de live entre 08/09 e 10/09 tem
// o card criado do outro lado (o /api/save-lead do stfv-forms) e o QS nunca ficou
// sabendo o número dele: `qs_leads.bitrix_id` nulo em 17 das 18 reuniões. Sem
// esse número, o /api/bitrix-sync responde `skipped_no_bitrix_id` e desfecho,
// no-show, reunião realizada, SAL e movimento de coluna nunca voltam pro card.
//
// Daqui pra frente o crachá do agendamento resolve isso na hora (api/_vinculo.js).
// Este endereço é pra quem já passou — e continua útil quando o crachá falhar.
//
// COMO ELE DECIDE, e por que é conservador: casar lead com card pelo telefone é
// palpite, e palpite errado aqui gruda o histórico de uma pessoa no card de
// outra. Então só grava quando as TRÊS coisas valem:
//
//   1. o telefone acha UM contato no Bitrix (crm.duplicate.findbycomm);
//   2. esse contato tem negócio, e o negócio ou está no funil comercial na coluna
//      de reunião (o formato que o formulário cria) ou nasceu perto da reunião;
//   3. nenhum outro lead do QS já está com aquele número.
//
// Qualquer dúvida sai na lista como `motivo`, pra decidir a mão. Não escrever é
// sempre a saída segura: o estado de hoje é exatamente o que já existe.
// -----------------------------------------------------------------------------
import { rest, insert, segredoConfere } from './_supabaseAdmin.js';
import { procurarNegocioPorTelefone, bitrixConfigurado } from './_bitrixLead.js';

/** Quanto tempo entre o card e a reunião ainda conta como "o mesmo evento". */
const JANELA_MS = 48 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const secret = process.env.LEAD_INBOUND_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: 'LEAD_INBOUND_SECRET não configurado' });
  if (!segredoConfere(req.headers['x-lead-secret'], secret)) {
    return res.status(401).json({ ok: false, error: 'Não autorizado' });
  }
  if (!bitrixConfigurado()) {
    return res.status(503).json({ ok: false, error: 'BITRIX_WEBHOOK_BASE não configurado' });
  }

  // Escrever exige POST **e** ?aplicar=1. Dois gestos de propósito: GET nunca
  // muda nada, e um POST distraído também não.
  const aplicar = req.method === 'POST' && (req.query?.aplicar === '1' || req.query?.aplicar === 'true');
  const limite = Math.min(Number(req.query?.limite || 40), 100);

  let reunioes = [];
  try {
    reunioes = await rest(
      'qs_meetings?select=id,lead_id,lead_name,scheduled_at,created_at,origem,' +
      'qs_leads!inner(id,full_name,phone,bitrix_id,segment)' +
      '&qs_leads.bitrix_id=is.null&status=in.(agendada,confirmada,realizada)' +
      `&order=created_at.desc&limit=${limite}`
    );
  } catch (e) {
    console.error('[sem-card] leitura falhou:', e?.message);
    return res.status(502).json({ ok: false, error: 'não deu pra ler as reuniões' });
  }

  const saida = [];
  for (const m of Array.isArray(reunioes) ? reunioes : []) {
    const lead = m.qs_leads;
    const linha = {
      lead_id: lead?.id, nome: lead?.full_name, telefone: lead?.phone,
      reuniao: m.scheduled_at, origem: m.origem, segment: lead?.segment,
      bitrix_id: null, decisao: 'nao-mexi', motivo: '',
    };

    if (!lead?.phone) {
      linha.motivo = 'lead sem telefone: não há por onde procurar';
      saida.push(linha);
      continue;
    }

    const achado = await procurarNegocioPorTelefone(lead.phone, 6000);
    if (achado.indisponivel) {
      linha.motivo = `não consegui perguntar ao Bitrix (${achado.motivo})`;
      saida.push(linha);
      continue;
    }
    if (!achado.achou || !achado.dealId) {
      linha.motivo = achado.achou
        ? 'contato existe no Bitrix, mas sem negócio nenhum'
        : 'telefone não existe no Bitrix';
      saida.push(linha);
      continue;
    }

    const deal = achado.deal || {};
    linha.bitrix_id = achado.dealId;

    // O formato que o formulário cria: funil comercial, coluna de reunião.
    const naColunaDeReuniao = String(deal.CATEGORY_ID ?? '') === '0' && deal.STAGE_ID === 'EXECUTING';
    const criadoEm = deal.DATE_CREATE ? new Date(deal.DATE_CREATE).getTime() : NaN;
    const pertoDaReuniao = Number.isFinite(criadoEm)
      && Math.abs(criadoEm - new Date(m.created_at).getTime()) <= JANELA_MS;

    if (!naColunaDeReuniao && !pertoDaReuniao) {
      linha.decisao = 'duvida';
      linha.motivo = `negócio ${achado.dealId} não parece ser deste agendamento `
        + `(funil ${deal.CATEGORY_ID}/${deal.STAGE_ID}, criado ${deal.DATE_CREATE || '?'})`;
      saida.push(linha);
      continue;
    }

    // Alguém já está com esse número? Então não é órfão — e mover o vínculo aqui,
    // em lote, tiraria o histórico de um card que talvez esteja certo.
    let ocupado = null;
    try {
      const donos = await rest(
        `qs_leads?select=id,full_name&bitrix_id=eq.${encodeURIComponent(achado.dealId)}&limit=1`
      );
      ocupado = (Array.isArray(donos) && donos[0]) || null;
    } catch { /* na dúvida, não grava */ ocupado = { id: '?', full_name: '(não deu pra conferir)' }; }

    if (ocupado) {
      linha.decisao = 'duvida';
      linha.motivo = `o negócio ${achado.dealId} já está no lead "${ocupado.full_name}" (${ocupado.id})`;
      saida.push(linha);
      continue;
    }

    if (!aplicar) {
      linha.decisao = 'gravaria';
      linha.motivo = naColunaDeReuniao ? 'está na coluna de reunião do funil comercial' : 'criado junto com a reunião';
      saida.push(linha);
      continue;
    }

    try {
      await rest(`qs_leads?id=eq.${encodeURIComponent(lead.id)}`, {
        method: 'PATCH', prefer: 'return=minimal', body: { bitrix_id: achado.dealId },
      });
      linha.decisao = 'gravei';
      // Rastro no card: daqui a três semanas ninguém lembra que o vínculo entrou
      // por um conserto em lote.
      await insert('qs_notes', {
        lead_id: lead.id, author_id: null,
        body: `🔗 O negócio ${achado.dealId} do Bitrix passou a apontar para este card `
            + `em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, `
            + 'num conserto em lote dos agendamentos que nasceram no formulário de live.',
        tags: ['bitrix', 'vinculo'],
      }, { returning: false }).catch(() => {});
    } catch (e) {
      linha.decisao = 'falhou';
      linha.motivo = e?.message || 'não deu pra gravar';
    }
    saida.push(linha);
  }

  const conta = (d) => saida.filter((x) => x.decisao === d).length;
  return res.status(200).json({
    ok: true,
    aplicar,
    total: saida.length,
    resumo: { gravei: conta('gravei'), gravaria: conta('gravaria'), duvida: conta('duvida'), nao_mexi: conta('nao-mexi'), falhou: conta('falhou') },
    leads: saida,
  });
}
