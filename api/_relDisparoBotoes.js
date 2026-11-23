// api/_relDisparoBotoes.js
// -----------------------------------------------------------------------------
// "CLICOU NO BOTÃO → PRÓXIMA MENSAGEM" do disparo do Relacionamento (0408).
//
// O cliente toca num botão de resposta rápida de um modelo que saiu de um
// disparo do Rel. A Meta manda uma mensagem `button` com context.id = o wamid
// do disparo. Aqui:
//   1. marca o clique no envio (clicou_em + botao) — o funil mostra "clicaram";
//   2. faz o que a campanha mandou pra AQUELE botão (envio_extra.respostas):
//      responder com um texto (a janela de 24 h acabou de abrir), pôr/tirar
//      etiqueta e avisar o atendente no sino.
//
// Chamado por api/_relEntrada.js só pra mensagem NOVA (não repete no reenvio da
// Meta). Nunca lança: um erro aqui não pode perder a mensagem do cliente.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { enviarTexto } from './_meta.js';
import { respostaDoBotao, personalizarResposta, listaDeEtiquetas } from './_relDisparoRegras.js';

/**
 * 0411: recibo (entregue/lido/falhou) de um disparo do Rel que saiu pelo número
 * de um SDR. Esses envios não viram bolha em nenhum chat do QS, então o
 * conciliar() não os acha: o webhook do Comercial chama isto direto.
 */
export async function reciboDeDisparo(st) {
  const s = String(st?.status || '').toLowerCase();
  const id = st?.id ? String(st.id) : '';
  if (!id || !['delivered', 'read', 'failed'].includes(s)) return false;
  const agora = new Date().toISOString();
  const w = `qs_disparo_envios?wamid=eq.${encodeURIComponent(id)}&simulado=eq.false`;
  const patch = (filtro, body) => rest(`${w}&${filtro}`, { method: 'PATCH', prefer: 'return=minimal', body }).then(() => true, () => false);
  if (s === 'delivered') return patch('status=eq.enviado', { status: 'entregue', entregue_em: agora });
  if (s === 'read') return patch('status=in.(enviado,entregue)', { status: 'lido', lido_em: agora });
  return patch('status=in.(enviado,entregue)', { status: 'erro', motivo: 'a Meta não entregou (falhou)' });
}

/** O texto do botão tocado, ou null se a mensagem não é clique de botão. */
export function botaoClicado(m) {
  if (m?.type === 'button') return String(m.button?.text || m.button?.payload || '').trim() || null;
  if (m?.type === 'interactive' && m.interactive?.type === 'button_reply') return String(m.interactive.button_reply?.title || '').trim() || null;
  return null;
}

async function etiquetar(clienteId, etiquetas, tirar) {
  const lista = listaDeEtiquetas(etiquetas);
  if (!clienteId || !lista.length) return;
  if (tirar) {
    await rest(`rel_cliente_etiquetas?cliente_id=eq.${clienteId}&etiqueta=in.(${lista.map((t) => `"${t.replace(/"/g, '')}"`).join(',')})`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => null);
    return;
  }
  await rest('rel_cliente_etiquetas?on_conflict=cliente_id,etiqueta', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: lista.map((etiqueta) => ({ cliente_id: clienteId, etiqueta, origem: 'botao' })),
  }).catch((e) => console.warn('[rel-botoes] etiqueta não gravada:', e?.message));
}

async function avisar({ conversaId, nome, campanha, botao, envioId, outroNumero = false }) {
  const conv = conversaId ? (await rest(`rel_wa_conversas?select=atendente_id&id=eq.${conversaId}&limit=1`).catch(() => null))?.[0] : null;
  let quem = conv?.atendente_id ? [conv.atendente_id] : [];
  if (!quem.length) {
    const g = (await rest('qs_users?select=id&is_active=eq.true&role=eq.gestor&setores=cs.{relacionamento}').catch(() => [])) || [];
    quem = g.map((x) => x.id);
  }
  for (const id of quem) {
    await rest('qs_avisos?on_conflict=user_id,chave', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: {
        user_id: id, tipo: 'tarefa', area: 'relacionamento',
        titulo: `${String(nome || 'Cliente').split(/\s+/)[0]} tocou em "${botao}"`.slice(0, 200),
        texto: `Disparo "${campanha}". Responda pelo WhatsApp ${outroNumero ? 'do número que disparou (SDR/Marketing)' : 'do Relacionamento'}.`.slice(0, 400),
        link: '#rel/whatsapp', origem: 'rel_disparo_botao', origem_id: envioId, chave: `rel-botao:${envioId}`,
      },
    }).catch(() => null);
  }
}

/**
 * Mensagem nova do cliente no número do Rel. Se for clique num botão de um
 * disparo do Rel, registra e responde. Devolve o que fez (pros logs/testes).
 */
export async function tratarCliqueDeDisparo({ m, phoneId, telefone, conversaId, outroNumero = false }) {
  try {
    const botao = botaoClicado(m);
    const ctx = m?.context?.id ? String(m.context.id) : null;
    if (!botao || !ctx) return null;
    const envio = (await rest(`qs_disparo_envios?select=id,campanha_id,cliente_id,viagem_id,nome,clicou_em&wamid=eq.${encodeURIComponent(ctx)}&limit=1`).catch(() => null))?.[0];
    if (!envio) return null;
    const c = (await rest(`qs_disparo_campanhas?select=id,nome,setor,envio_extra&id=eq.${envio.campanha_id}&limit=1`).catch(() => null))?.[0];
    if (!c || c.setor !== 'relacionamento') return null;

    if (!envio.clicou_em) {
      await rest(`qs_disparo_envios?id=eq.${envio.id}&clicou_em=is.null`, {
        method: 'PATCH', prefer: 'return=minimal', body: { clicou_em: new Date().toISOString(), botao: botao.slice(0, 80) },
      }).catch(() => null);
    }

    const cfg = respostaDoBotao(c.envio_extra?.respostas, botao);
    if (!cfg) return { envio: envio.id, botao, acao: 'só registrou' };
    const feito = [];
    if (cfg.etiqueta) { await etiquetar(envio.cliente_id, [cfg.etiqueta], false); feito.push('etiqueta'); }
    if (cfg.tirar_etiqueta) { await etiquetar(envio.cliente_id, [cfg.tirar_etiqueta], true); feito.push('tirou etiqueta'); }
    // 0411: pelo número de SDR/Marketing só sai template — sem resposta em texto.
    if (cfg.texto && !envio.clicou_em && !outroNumero) {
      // Só no 1º clique: tocar 3 vezes não manda 3 respostas.
      let destino = null;
      if (envio.viagem_id) {
        const v = (await rest(`rel_viagens?select=destino,titulo&id=eq.${envio.viagem_id}&limit=1`).catch(() => null))?.[0];
        destino = v?.destino || v?.titulo || null;
      }
      const texto = personalizarResposta(cfg.texto, { nome: envio.nome, destino });
      if (texto) {
        const r = await enviarTexto({ para: telefone, texto, phoneId, responderA: m.id || null });
        if (r?.wamid) {
          const { gravarRel } = await import('./_relEntrada.js');
          await gravarRel({ phoneId, telefone, wamid: r.wamid, direcao: 'out', origem: 'automatica', texto, autorNome: `Resposta do botão "${botao}"`.slice(0, 80), status: 'sent' });
          feito.push('respondeu');
        } else {
          console.warn('[rel-botoes] resposta não saiu:', r?.erro, r?.detalhe);
        }
      }
    }
    if (cfg.avisar && !envio.clicou_em) { await avisar({ conversaId, nome: envio.nome, campanha: c.nome, botao, envioId: envio.id, outroNumero }); feito.push('avisou'); }
    return { envio: envio.id, botao, feito };
  } catch (e) {
    console.warn('[rel-botoes] falhou:', e?.message);
    return null;
  }
}
