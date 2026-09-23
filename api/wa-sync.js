// api/wa-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-sync?leadId=<uuid>&(briefing=1|audio=<id>)
//
//   briefing — o resumo do lead pro CLOSER (notas, tarefas, reuniões, conversa)
//   audio    — entrega o arquivo de um áudio pro navegador transcrever
//
// Até 22/09 o modo padrão (sem briefing/audio) puxava o histórico da conversa
// do Chatwoot. O Chatwoot saiu do QS em 23/09: o histórico agora entra só pelo
// webhook da Meta (wa-calls → _metaEntrada), então o modo padrão responde
// "nada a importar" e o front segue funcionando.
//
// SEGURANÇA: não basta estar logado — o servidor confere que o lead é DESTE
// usuário antes de devolver qualquer coisa. Lead de outro SDR responde 403.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { assertCanAccessLead, getSupabaseUserId } from './_wa.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  // Fotos de perfil vinham do Chatwoot/Evolution; a Meta não entrega foto de
  // cliente. O botão antigo recebe "nada preenchido" em vez de erro.
  if (req.query?.fotos) return res.status(200).json({ ok: true, preenchidas: 0, motivo: 'sem-fonte-de-foto' });

  const leadId = String(req.query?.leadId || '').trim();
  if (!leadId) return res.status(400).json({ error: 'leadId obrigatório' });

  // ── Modo BRIEFING: o resumo do lead pro CLOSER ────────────────────────────
  // As duas reclamações dos closers (18/08) têm a mesma raiz: a RLS de
  // qs_notes/qs_tasks/qs_leads só libera gestor ou dono — então o closer abria
  // o card e via VAZIO, mesmo com tudo preenchido no banco. Este modo entrega o
  // contexto pelo servidor, que valida o papel via assertCanAccessLead (closer
  // liberado desde 18/08) e lê com a chave de serviço. É o que faz o closer
  // não precisar perguntar de novo o que o SDR já perguntou.
  if (req.query?.briefing) {
    let quem;
    try {
      quem = await assertCanAccessLead(userId, leadId);
    } catch {
      return res.status(500).json({ error: 'Falha ao validar o lead' });
    }
    if (!quem.ok) return res.status(quem.reason === 'lead-de-outro-sdr' ? 403 : 404).json({ error: 'Sem acesso' });

    try {
      const [notas, tarefas, reunioes, dono, conversa] = await Promise.all([
        rest(`qs_notes?lead_id=eq.${encodeURIComponent(leadId)}&select=body,tags,created_at&order=created_at.desc&limit=12`),
        rest(`qs_tasks?lead_id=eq.${encodeURIComponent(leadId)}&status=eq.concluida&select=channel_type,contact_result,completed_at,notes&order=completed_at.desc.nullslast&limit=10`),
        rest(`qs_meetings?lead_id=eq.${encodeURIComponent(leadId)}&select=title,scheduled_at,status,meeting_owner,sal&order=scheduled_at.desc&limit=5`),
        quem.lead.owner_id
          ? rest(`qs_users?id=eq.${encodeURIComponent(quem.lead.owner_id)}&select=name,role&limit=1`)
          : Promise.resolve([]),
        // O QUE FOI FALADO de verdade. As notas contam o que o SDR resolveu
        // registrar; a conversa é o que o CLIENTE disse — é ali que está o
        // destino, a data, quantas pessoas, o orçamento. Sem isto o closer
        // reabre a mesma entrevista, que é justamente a reclamação dele.
        rest(`qs_wa_messages?lead_id=eq.${encodeURIComponent(leadId)}&deleted_at=is.null&select=content,direction,transcricao,sent_at&order=sent_at.desc&limit=40`),
      ]);
      return res.status(200).json({
        lead: {
          nome: quem.lead.full_name ?? null,
          telefone: quem.lead.phone ?? null,
          email: quem.lead.email ?? null,
          fonte: quem.lead.segment ?? null,
          temperatura: quem.lead.lead_score ?? null,
          status: quem.lead.status ?? null,
          dono: Array.isArray(dono) && dono[0] ? dono[0].name : null,
          papelDono: Array.isArray(dono) && dono[0] ? dono[0].role : null,
        },
        notas: Array.isArray(notas) ? notas : [],
        tarefas: Array.isArray(tarefas) ? tarefas : [],
        reunioes: Array.isArray(reunioes) ? reunioes : [],
        // Do mais antigo pro mais novo (a busca vem invertida pra pegar as
        // ÚLTIMAS), já sem as vazias — anexo sem legenda não conta história.
        conversa: (Array.isArray(conversa) ? conversa : [])
          .reverse()
          .map((m) => ({
            // A assinatura "*Yanca*\n" que o robô põe na frente é ruído aqui —
            // quem escreveu já está na etiqueta da linha.
            texto: (m.content || m.transcricao || '').replace(/^\*{1,2}[^*\n]{1,40}\*{1,2}\s*\n?/, '').trim(),
            deQuem: m.direction === 'out' ? 'nos' : 'cliente',
            quando: m.sent_at,
          }))
          .filter((m) => m.texto),
      });
    } catch (e) {
      console.warn('[wa-sync] briefing:', e?.message);
      return res.status(500).json({ error: 'Não consegui montar o resumo' });
    }
  }

  // ── Modo ÁUDIO: entrega o arquivo pro navegador ───────────────────────────
  // Por que existe: o áudio mora num bucket que NÃO manda cabeçalho de CORS.
  // A tag <audio> toca (mídia não precisa de CORS), mas ler os BYTES por script
  // é bloqueado pelo navegador — e a transcrição, que roda na máquina do SDR,
  // precisa exatamente dos bytes. Buscar aqui no servidor resolve: servidor com
  // servidor não tem CORS, e devolvemos o arquivo já liberado.
  //
  // Vive nesta rota (e não numa nova) pela mesma razão do modo `?fotos=`: o
  // projeto está no teto prático de funções da Vercel.
  if (req.query?.audio) {
    let permissao;
    try {
      permissao = await assertCanAccessLead(userId, leadId);
    } catch {
      return res.status(500).json({ error: 'Falha ao validar o lead' });
    }
    if (!permissao.ok) return res.status(permissao.reason === 'lead-de-outro-sdr' ? 403 : 404).json({ error: 'Sem acesso' });

    const msgId = String(req.query.audio);
    let linha;
    try {
      const rows = await rest(
        `qs_wa_messages?select=attachments&id=eq.${encodeURIComponent(msgId)}` +
        `&lead_id=eq.${encodeURIComponent(leadId)}&limit=1`
      );
      linha = Array.isArray(rows) && rows[0];
    } catch (e) {
      console.warn('[wa-sync] áudio: consulta falhou:', e?.message);
    }
    const anexo = (linha?.attachments || []).find((a) => String(a.type || '').includes('audio'));
    if (!anexo?.url) return res.status(404).json({ error: 'Esta mensagem não tem áudio' });

    try {
      const r = await fetch(anexo.url, { redirect: 'follow' });
      if (!r.ok) return res.status(502).json({ error: 'Não consegui baixar o áudio' });
      const bytes = Buffer.from(await r.arrayBuffer());
      res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/ogg');
      res.setHeader('Content-Length', String(bytes.length));
      // O arquivo não muda: vale guardar no navegador.
      res.setHeader('Cache-Control', 'private, max-age=86400');
      // `res.end`, e NÃO `res.send`: o helper da Vercel serializa objeto como
      // JSON, e um Buffer é objeto — o navegador receberia texto no lugar do
      // áudio e a decodificação falharia com "formato inválido". `end` escreve
      // os bytes crus, que é o que queremos.
      res.status(200);
      return res.end(bytes);
    } catch (e) {
      console.warn('[wa-sync] áudio:', e?.message);
      return res.status(502).json({ error: 'Não consegui baixar o áudio' });
    }
  }

  return res.status(200).json({ configured: true, conversationId: null, importadas: 0 });
}
