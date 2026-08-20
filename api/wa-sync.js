// api/wa-sync.js
// -----------------------------------------------------------------------------
// Rota serverless (Vercel): GET /api/wa-sync?leadId=<uuid>
//
// Puxa o histórico da conversa daquele lead do Chatwoot pra dentro do QS. Serve
// pra duas coisas: (1) a primeira vez que alguém abre um lead — o webhook só
// grava o que acontece DEPOIS que ele foi ligado, então o passado precisa vir
// por aqui; (2) rede de segurança, se um webhook se perder.
//
// Idempotente: reingerir a mesma mensagem não duplica (chave é o id do Chatwoot).
//
// SEGURANÇA: não basta estar logado — o servidor confere que o lead é DESTE
// usuário antes de devolver qualquer coisa. Lead de outro SDR responde 403.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import {
  assertCanAccessLead, getSupabaseUserId, cwConfigured, cw,
  toE164BR, findContact, escolherConversaDoLead, ingestMessage,
  conversasDeWhatsAppDoContato, conversaOndeOClienteFala,
} from './_wa.js';
import { resolverFoto, preencherFotosEmLote } from './_waFoto.js';

async function gravarThread(leadId, patch) {
  await rest('qs_wa_threads?on_conflict=lead_id', {
    method: 'POST',
    body: [{ lead_id: leadId, ...patch }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/**
 * Grava o estado da conversa. Se a coluna `avatar_url` ainda não existir (a
 * migration 0026 é opcional), o PostgREST recusa a linha INTEIRA — e aí se
 * perderiam também a caixa, o id da conversa e o synced_at. Por isso, ao falhar
 * com a foto, tenta de novo sem ela em vez de desistir de tudo.
 */
async function saveThreadMeta(leadId, patch) {
  try {
    await gravarThread(leadId, patch);
  } catch (e) {
    if ('avatar_url' in patch) {
      const { avatar_url: _ignorado, ...semFoto } = patch;
      try {
        await gravarThread(leadId, semFoto);
        console.warn('[wa-sync] avatar_url ignorado — aplique a migration 0026 pra ver as fotos');
        return;
      } catch (e2) {
        console.warn('[wa-sync] saveThreadMeta:', e2?.message);
        return;
      }
    }
    console.warn('[wa-sync] saveThreadMeta:', e?.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Use GET' });
  }

  const userId = await getSupabaseUserId(req.headers['authorization']);
  if (!userId) return res.status(401).json({ error: 'Não autorizado' });

  // ── Modo LOTE: preencher as fotos que faltam ──────────────────────────────
  // Vive aqui, e não numa rota nova, porque o projeto já roda no limite prático
  // de funções da Vercel. Só gestor/admin: é uma rodada de consultas ao
  // WhatsApp, não algo pra qualquer um disparar a qualquer hora.
  if (req.query?.fotos) {
    const users = await rest(`qs_users?select=role,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`);
    const u = Array.isArray(users) && users[0];
    if (!u || u.is_active === false || (u.role !== 'admin' && u.role !== 'gestor')) {
      return res.status(403).json({ error: 'Só gestor ou admin pode preencher as fotos.' });
    }
    const r = await preencherFotosEmLote(Number(req.query.fotos));
    return res.status(r.ok ? 200 : 503).json(r);
  }

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
  // Por que existe: o áudio mora no Chatwoot, que NÃO manda cabeçalho de CORS.
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

  let auth;
  try {
    auth = await assertCanAccessLead(userId, leadId);
  } catch (e) {
    console.error('[wa-sync] checagem de acesso:', e?.message);
    return res.status(500).json({ error: 'Falha ao validar o lead' });
  }
  if (!auth.ok) {
    const status = auth.reason === 'lead-de-outro-sdr' ? 403 : 404;
    return res.status(status).json({ error: 'Sem acesso a este lead', motivo: auth.reason });
  }

  if (!cwConfigured()) {
    console.warn('[wa-sync] CHATWOOT_AGENT_TOKEN ausente — configure na Vercel');
    return res.status(200).json({ configured: false, conversationId: null, importadas: 0 });
  }

  const phone = toE164BR(auth.lead.phone);
  if (!phone) return res.status(200).json({ conversationId: null, importadas: 0, motivo: 'lead-sem-telefone' });

  try {
    const contact = await findContact(phone);
    if (!contact) {
      await saveThreadMeta(leadId, { synced_at: new Date().toISOString() });
      return res.status(200).json({ conversationId: null, importadas: 0, motivo: 'sem-contato-no-chatwoot' });
    }

    // A conversa que vale é a do cliente — não a "mais ativa" do Chatwoot.
    // Era AQUI que o ponteiro da thread voltava pro número morto (17/08): o
    // upsert lá embaixo grava conv/caixa por cima, então escolher errado aqui
    // desfazia o roteamento certo segundos depois.
    const conv = await escolherConversaDoLead(leadId, contact.id);
    if (!conv) {
      await saveThreadMeta(leadId, { cw_contact_id: contact.id, synced_at: new Date().toISOString() });
      return res.status(200).json({ conversationId: null, contactId: contact.id, importadas: 0, motivo: 'sem-conversa' });
    }

    // ── TODAS as conversas do cliente, não só a "dele" ─────────────────────
    //
    // Auditoria de 20/08: puxar só a conversa escolhida cria um ponto cego que
    // se alimenta sozinho. A escolha usa a última mensagem do cliente QUE O QS
    // JÁ TEM — então, se a mensagem do outro número nunca entrou, o QS escolhe
    // a conversa velha, sincroniza a velha, e a nova segue invisível. Abrir o
    // lead, que é o conserto que a gente ensina pro time, não consertava nada.
    //
    // O teto de 5 é o orçamento de tempo da Vercel (10s pra função inteira):
    // são 5 idas ao Chatwoot no pior caso, e um cliente com mais de 5 conversas
    // de WhatsApp não existe na prática — as mais recentes vêm primeiro.
    const todas = await conversasDeWhatsAppDoContato(contact.id);
    const aSincronizar = (todas.length ? todas : [conv]).slice(0, 5);
    // A escolhida entra sempre, mesmo que o Chatwoot não a tenha listado.
    if (!aSincronizar.some((c) => Number(c.id) === Number(conv.id))) aSincronizar.push(conv);

    let importadas = 0;
    let lidas = 0;
    for (const c of aSincronizar) {
      let list = [];
      try {
        const data = await cw(`/conversations/${c.id}/messages`);
        list = Array.isArray(data?.payload) ? data.payload : [];
      } catch (e) {
        // Uma conversa que falhou não pode levar as outras junto.
        console.warn(`[wa-sync] conversa ${c.id} não respondeu:`, e?.message);
        continue;
      }
      lidas += list.length;
      for (const m of list) {
        const novo = await ingestMessage({
          leadId,
          conversationId: c.id,
          message: m,
          contactId: contact.id,
          canReply: typeof c.can_reply === 'boolean' ? c.can_reply : null,
          inboxId: c.inbox_id ?? null,
        });
        if (novo) importadas++;
      }
    }

    // O PONTEIRO SE DECIDE DEPOIS DE TUDO ENTRAR, não antes.
    //
    // A conversa foi escolhida lá em cima com o que o QS SABIA na hora. Agora
    // ele sabe mais: acabaram de entrar as mensagens de todas as conversas. Se
    // a mensagem mais recente do cliente está em outra, é ela que vale — senão
    // o `saveThreadMeta` abaixo gravaria a escolha velha por cima do conserto
    // que o próprio ingest acabou de fazer (`conversaSegueOCliente`).
    let alvo = conv;
    try {
      const doCliente = await conversaOndeOClienteFala(leadId);
      const achada = doCliente != null
        ? aSincronizar.find((c) => Number(c.id) === Number(doCliente))
        : null;
      if (achada) alvo = achada;
    } catch (e) {
      console.warn('[wa-sync] não consegui reconferir o ponteiro (fica o escolhido):', e?.message);
    }

    // Foto: o thumbnail do Chatwoot quando existe (já hospedado e estável) e,
    // quando não existe — o caso de ~92% dos contatos —, a Evolution, com a
    // imagem rehospedada no nosso Storage. Best-effort: sem foto, o avatar cai
    // nas iniciais coloridas e o sync das mensagens segue igual.
    let foto = contact.thumbnail || null;
    try {
      const nova = await resolverFoto({
        leadId,
        phone: auth.lead.phone,
        inboxId: alvo.inbox_id ?? null,
        thumbnailChatwoot: contact.thumbnail || null,
      });
      if (nova) foto = nova;
    } catch (e) {
      console.warn('[wa-sync] foto de perfil:', e?.message);
    }

    await saveThreadMeta(leadId, {
      cw_conversation_id: alvo.id,
      cw_contact_id: contact.id,
      cw_inbox_id: alvo.inbox_id ?? null,
      // Coluna da migration 0026. Se ela não existir, o PostgREST recusa a
      // linha inteira — por isso saveThreadMeta engole o erro e o resto segue.
      avatar_url: foto,
      can_reply: typeof alvo.can_reply === 'boolean' ? alvo.can_reply : null,
      synced_at: new Date().toISOString(),
    });

    return res.status(200).json({
      conversationId: alvo.id,
      contactId: contact.id,
      canReply: alvo.can_reply ?? null,
      conversas: aSincronizar.length,
      lidas,
      importadas,
    });
  } catch (e) {
    console.error('[wa-sync]', e?.message);
    return res.status(500).json({ error: 'Falha ao sincronizar com o Chatwoot' });
  }
}
