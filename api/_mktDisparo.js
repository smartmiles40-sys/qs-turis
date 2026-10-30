// api/_mktDisparo.js
// -----------------------------------------------------------------------------
// MARKETING NO MOTOR DO DISPARO (0242, 30/10/2026).
//
// O motor é o da 0217 (api/_disparo.js): fila, ritmo, janela, simulação e o
// ÚNICO ponto que fala com a Meta (enviarTemplate, hoje desligado). Aqui mora só
// o que é do Marketing:
//
//   lerNumeroMkt()        → o número NOVO do Marketing (qs_settings.mkt_disparo_numero)
//   montarPublicoMkt()    → base de contatos, leads ou clientes — tudo pelo
//                           número do Marketing, NUNCA pelo dos SDRs/Rel
//   rodarRecorrencias()   → toda segunda 9h etc.: cria a campanha 'agendada'
//   acordarAgendadas()    → na hora marcada, monta a fila (qualquer setor)
//   rodarSequencias()     → passo 1 no dia 0, passo 2 no dia 3…
//   acaoMarketing()       → as ações mkt_* da rota api/disparos.js
//
// REGRA DO BRUNO: massa SEMPRE pela API oficial da Meta, com modelo aprovado.
// Grupo é por chip, em outra frente. Sem número do Marketing = não envia.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { waKey } from './_wa.js';
import { numerosIgnorados } from './_waNascimento.js';
import { proibidos } from './_numeroReserva.js';
import { foneDestino, montarFila, MOTIVOS } from './_disparo.js';
import { proximaOcorrencia, dataDoPasso, diaMesSP } from './_mktRegras.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FONTES_PUBLICO = ['contatos', 'leads', 'clientes'];

export const MOTIVOS_MKT = {
  mkt_optout: 'pediu PARAR ao número do Marketing',
  mkt_recente: 'recebeu disparo do Marketing há pouco tempo',
  sem_numero_mkt: 'o Marketing ainda não tem número',
};

// ── O número do Marketing ───────────────────────────────────────────────────

/** { phone_number_id, numero, rotulo } ou null (sem número = não envia). */
export async function lerNumeroMkt() {
  const v = (await rest('qs_settings?select=value&key=eq.mkt_disparo_numero&limit=1').catch(() => null))?.[0]?.value;
  const id = String(v?.phone_number_id || '').trim();
  return /^\d{6,30}$/.test(id) ? { phone_number_id: id, numero: v.numero || null, rotulo: v.rotulo || 'Marketing' } : null;
}

// ── Público ─────────────────────────────────────────────────────────────────

/**
 * Quem a campanha do Marketing atinge. Mesmo formato de montarPublico() da
 * 0217: { recebem, excluidos: {motivo: n}, porSdr: [], numeroOk }.
 *   publico.fonte = 'contatos' (padrão) → mkt_disparo_publico (listas, tags…)
 *                 = 'leads'    → qs_disparo_publico (os filtros do Comercial)
 *                 = 'clientes' → qs_disparo_publico_rel (os filtros do Rel)
 * `ignorarRecente`: a sequência não respeita o "recebeu há N dias" (o passo 2
 * do dia 3 É a continuação), mas respeita PARAR sempre.
 */
export async function montarPublicoMkt({ publico, ritmo, ignorarRecente = false }) {
  const numero = await lerNumeroMkt();
  const fonte = FONTES_PUBLICO.includes(publico?.fonte) ? publico.fonte : 'contatos';
  const dias = ritmo?.intervalo_dias ?? 7;
  const p = { ...(publico || {}), intervalo_dias: dias };
  const bloq = proibidos();
  const time = await numerosIgnorados().catch(() => new Set());
  const bloqMkt = new Map();
  for (const b of (await rest('rpc/mkt_disparo_bloqueios', { method: 'POST', body: { p_dias: dias }, timeoutMs: 20_000 })) || []) {
    const k = waKey(b.telefone);
    if (!k) continue;
    if (b.motivo === 'mkt_recente' && ignorarRecente) continue;
    // opt-out vence "recente"
    if (!bloqMkt.has(k) || b.motivo === 'mkt_optout') bloqMkt.set(k, b.motivo);
  }

  const excluidos = {};
  const recebem = [];
  const vistos = new Set();
  const fora = (m) => { excluidos[m] = (excluidos[m] || 0) + 1; };
  const phoneId = numero?.phone_number_id || null;

  let linhas = [];
  if (fonte === 'contatos') linhas = await rest('rpc/mkt_disparo_publico', { method: 'POST', body: { p_publico: p }, timeoutMs: 25_000 });
  else if (fonte === 'leads') linhas = await rest('rpc/qs_disparo_publico', { method: 'POST', body: { p_publico: p }, timeoutMs: 25_000 });
  else linhas = await rest('rpc/qs_disparo_publico_rel', { method: 'POST', body: { p_publico: p }, timeoutMs: 25_000 });

  for (const a of linhas || []) {
    const tel = foneDestino(a.telefone);
    if (!tel) { fora('invalido'); continue; }
    if (bloq.has(tel)) { fora('proibido'); continue; }
    const k = waKey(tel);
    if (time.has(k)) { fora('time'); continue; }
    if (a.optout) { fora('optout'); continue; }
    const b = bloqMkt.get(k);
    if (b) { fora(b); continue; }
    if (fonte === 'leads' && a.status === 'ganho') { fora('ganho'); continue; }
    // Conversa aberta com o SDR/Rel nas últimas 24 h: quem está atendendo fala direto.
    if (a.conversa_24h) { fora('conversa'); continue; }
    if (a.disparo_recente && !ignorarRecente) { fora('recente'); continue; }
    if (vistos.has(k)) { fora('repetido'); continue; }
    vistos.add(k);
    recebem.push({
      contato_id: a.contato_id || null, lead_id: a.lead_id || null, cliente_id: a.cliente_id || null,
      viagem_id: a.viagem_id || null, destino: a.destino || null, segment: a.segment || null,
      campos: a.campos || null, nome: a.nome || '', telefone: tel, sdr_id: null, phone_number_id: phoneId,
    });
  }
  return { recebem, excluidos, porSdr: [], numeroOk: Boolean(phoneId) };
}

export const motivoMkt = (k) => MOTIVOS_MKT[k] || MOTIVOS[k] || k;

// ── Agendadas, recorrências e sequências (cron de 5 em 5 min) ───────────────

/**
 * Campanhas 'agendada' cuja hora chegou: monta a fila e passa a 'enviando'.
 * Hoje só o Marketing agenda; a função serve a qualquer setor.
 */
export async function acordarAgendadas({ cfg, montarPublico }) {
  const agora = new Date().toISOString();
  const devidas = await rest(`qs_disparo_campanhas?select=*&status=eq.agendada&agendada_para=lte.${encodeURIComponent(agora)}&order=agendada_para.asc&limit=10`);
  const feitas = [];
  for (const c of devidas || []) {
    try {
      const pub = await montarPublico({ setor: c.setor, publico: c.publico, ritmo: cfg.ritmo });
      if (!pub.numeroOk) {
        await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.agendada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: agora, ultimo_erro: 'Na hora marcada, o setor não tinha número conectado. Configure e retome.' } });
        continue;
      }
      const r = await montarFila({ campanha: c, recebem: pub.recebem, de: 'agendada' });
      feitas.push({ campanha: c.nome, total: r.total });
    } catch (e) {
      await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.agendada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', pausada_em: agora, ultimo_erro: String(e?.message || 'falhou').slice(0, 300) } }).catch(() => null);
    }
  }
  return feitas;
}

/** Cada recorrência vencida vira uma campanha 'agendada' na hora dela. */
export async function rodarRecorrencias() {
  const agora = new Date();
  const devidas = await rest(`mkt_disparo_recorrencias?select=*&ativa=eq.true&proxima_em=lte.${encodeURIComponent(agora.toISOString())}&limit=20`);
  const criadas = [];
  for (const r of devidas || []) {
    // Pega a vez ANTES (duas rodadas juntas não criam duas campanhas).
    const proxima = proximaOcorrencia(r.dias_semana, r.hora, agora);
    const pegou = await rest(`mkt_disparo_recorrencias?id=eq.${r.id}&proxima_em=eq.${encodeURIComponent(r.proxima_em)}`, {
      method: 'PATCH', prefer: 'return=representation', body: { proxima_em: proxima, ultima_em: agora.toISOString(), atualizado_em: agora.toISOString() },
    }).catch(() => null);
    if (!pegou?.[0]) continue;
    const nova = await rest('qs_disparo_campanhas', {
      method: 'POST', prefer: 'return=representation',
      body: {
        setor: 'marketing', nome: `${r.nome} — ${diaMesSP(r.proxima_em)}`,
        modelo_nome: r.modelo_nome, modelo_idioma: r.modelo_idioma, modelo_corpo: null,
        params: r.params || {}, publico: r.publico || {}, status: 'agendada', agendada_para: r.proxima_em,
        recorrencia_id: r.id, criado_por: r.criado_por,
      },
    });
    if (nova?.[0]) {
      await rest(`mkt_disparo_recorrencias?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ultima_campanha_id: nova[0].id } }).catch(() => null);
      criadas.push(nova[0].nome);
    }
  }
  return criadas;
}

async function passosDe(sequenciaId) {
  return (await rest(`mkt_disparo_sequencia_passos?select=*&sequencia_id=eq.${sequenciaId}&order=ordem.asc`)) || [];
}

/**
 * Inscreve gente numa sequência. `linhas` = saída de montarPublicoMkt().recebem.
 * Quem já está nela (mesmo telefone) não entra de novo.
 */
export async function inscrever(sequenciaId, linhas, agora = new Date()) {
  const passos = await passosDe(sequenciaId);
  if (!passos.length) return { inscritos: 0 };
  const p1 = passos[0];
  const quando = dataDoPasso(agora, p1.dia_offset, p1.hora, agora);
  const corpo = linhas.map((a) => ({
    sequencia_id: sequenciaId, contato_id: a.contato_id || null, lead_id: a.lead_id || null,
    cliente_id: a.cliente_id || null, viagem_id: a.viagem_id || null, telefone: a.telefone, nome: a.nome || null,
    inicio_em: agora.toISOString(), proximo_passo: p1.ordem, proximo_em: quando,
  }));
  let n = 0;
  for (let i = 0; i < corpo.length; i += 500) {
    const r = await rest('mkt_disparo_sequencia_inscricoes?on_conflict=sequencia_id,telefone', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: corpo.slice(i, i + 500), timeoutMs: 20_000,
    });
    n += (r || []).length;
    const eventos = (r || []).filter((x) => x.contato_id).map((x) => ({ contato_id: x.contato_id, tipo: 'sequencia_entrou', dados: { sequencia_id: sequenciaId } }));
    if (eventos.length) await rest('mkt_contato_eventos', { method: 'POST', prefer: 'return=minimal', body: eventos }).catch(() => null);
  }
  return { inscritos: n };
}

/**
 * A vez de cada passo: junta as inscrições vencidas por (sequência, passo),
 * põe na fila de uma campanha do dia ("Sequência X · passo 2 · 03/11") e anda
 * a inscrição pro próximo passo (ou conclui). O envio em si é a rodada normal.
 */
export async function rodarSequencias({ cfg }) {
  const agora = new Date();
  const out = { inscritosPorLista: 0, enfileirados: 0 };
  const numero = await lerNumeroMkt();
  const seqs = (await rest('mkt_disparo_sequencias?select=*&ativa=eq.true')) || [];
  if (!seqs.length) return out;

  // (a) Lista-gatilho: quem entrou na lista e ainda não está na sequência.
  for (const s of seqs.filter((x) => x.lista_gatilho_id)) {
    const pub = await montarPublicoMkt({ publico: { fonte: 'contatos', listas: [s.lista_gatilho_id] }, ritmo: cfg.ritmo, ignorarRecente: true });
    if (pub.recebem.length) out.inscritosPorLista += (await inscrever(s.id, pub.recebem, agora)).inscritos;
  }

  // (b) Passos vencidos. Sem número do Marketing a inscrição ESPERA (não queima passo).
  if (!numero) return { ...out, parado: MOTIVOS_MKT.sem_numero_mkt };
  for (const s of seqs) {
    const passos = await passosDe(s.id);
    if (!passos.length) continue;
    const vencidas = await rest(`mkt_disparo_sequencia_inscricoes?select=*&sequencia_id=eq.${s.id}&status=eq.ativa&proximo_em=lte.${encodeURIComponent(agora.toISOString())}&order=proximo_em.asc&limit=500`);
    const porPasso = new Map();
    for (const i of vencidas || []) porPasso.set(i.proximo_passo, [...(porPasso.get(i.proximo_passo) || []), i]);

    for (const [ordem, lista] of porPasso) {
      const passo = passos.find((p) => p.ordem === ordem);
      const seguinte = passos.find((p) => p.ordem > ordem);
      if (!passo) {
        await rest(`mkt_disparo_sequencia_inscricoes?id=in.(${lista.map((i) => i.id).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'concluida', motivo: 'passo não existe mais', atualizado_em: agora.toISOString() } });
        continue;
      }
      // Quem disse PARAR ao Marketing depois de entrar sai aqui (e o envio
      // ainda confere de novo na hora, em enviarUm).
      const bloq = new Map();
      for (const b of (await rest('rpc/mkt_disparo_bloqueios', { method: 'POST', body: { p_dias: 0 } })) || []) if (b.motivo === 'mkt_optout') bloq.set(waKey(b.telefone), true);

      const vao = [];
      const saem = [];
      for (const i of lista) {
        const tel = foneDestino(i.telefone);
        if (!tel || bloq.has(waKey(tel))) saem.push(i); else vao.push({ ...i, telefone: tel });
      }
      if (saem.length) {
        await rest(`mkt_disparo_sequencia_inscricoes?id=in.(${saem.map((i) => i.id).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'saiu', motivo: 'pediu PARAR ou telefone inválido', atualizado_em: agora.toISOString() } });
      }
      if (vao.length) {
        const nome = `${s.nome} · passo ${ordem} · ${diaMesSP(agora)}`;
        let camp = (await rest(`qs_disparo_campanhas?select=*&sequencia_id=eq.${s.id}&sequencia_passo=eq.${ordem}&nome=eq.${encodeURIComponent(nome)}&limit=1`))?.[0];
        if (!camp) {
          camp = (await rest('qs_disparo_campanhas', {
            method: 'POST', prefer: 'return=representation',
            body: {
              setor: 'marketing', nome, modelo_nome: passo.modelo_nome, modelo_idioma: passo.modelo_idioma,
              params: passo.params || {}, publico: { fonte: 'sequencia', sequencia_id: s.id, passo: ordem },
              status: 'rascunho', sequencia_id: s.id, sequencia_passo: ordem, criado_por: s.criado_por,
            },
          }))?.[0];
        }
        if (camp && !['cancelada'].includes(camp.status)) {
          const r = await montarFila({
            campanha: camp, de: camp.status,
            recebem: vao.map((i) => ({
              contato_id: i.contato_id, lead_id: i.lead_id, cliente_id: i.cliente_id, viagem_id: i.viagem_id,
              nome: i.nome || '', telefone: i.telefone, sdr_id: null, phone_number_id: numero.phone_number_id, inscricao_id: i.id,
            })),
          });
          out.enfileirados += r.total;
        }
      }
      // Anda a inscrição (mesmo quem saiu já foi marcado acima).
      for (const i of vao) {
        await rest(`mkt_disparo_sequencia_inscricoes?id=eq.${i.id}&status=eq.ativa`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: seguinte
            ? { proximo_passo: seguinte.ordem, proximo_em: dataDoPasso(i.inicio_em, seguinte.dia_offset, seguinte.hora, agora), atualizado_em: agora.toISOString() }
            : { status: 'concluida', proximo_em: null, motivo: 'recebeu todos os passos', atualizado_em: agora.toISOString() },
        }).catch(() => null);
      }
    }
  }
  return out;
}

// ── Ações da tela (vêm por api/disparos.js, já com permissão conferida) ─────

const hhmm = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null);
const varsDoCorpo = (corpo) => [...new Set([...String(corpo || '').matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]))];

/** O modelo aprovado e as variáveis preenchidas (mesma regra do 'criar'). */
function conferirModelo(cfg, nome, idioma, params, fontes) {
  const modelo = cfg.modelos.find((m) => m.nome === nome && (m.idioma || 'pt_BR') === (idioma || 'pt_BR'));
  if (!modelo || modelo.status !== 'aprovado') return { erro: 'Escolha um modelo APROVADO pela Meta.' };
  const p = params && typeof params === 'object' ? params : {};
  const falta = varsDoCorpo(modelo.corpo).find((k) => !p[k] || !fontes.includes(p[k].fonte) || (['texto', 'campo'].includes(p[k].fonte) && !String(p[k].valor || '').trim()));
  if (falta) return { erro: `Falta dizer de onde vem a variável {{${falta}}}.` };
  return { modelo, params: p };
}

export async function acaoMarketing({ acao, body, u, cfg, fontes }) {
  const agora = new Date();

  if (acao === 'mkt_salvar_numero') {
    if (u.role !== 'admin') return { status: 403, json: { error: 'Só admin define o número do Marketing.' } };
    const id = String(body.phone_number_id || '').trim();
    if (id && !/^\d{6,30}$/.test(id)) return { status: 400, json: { error: 'O Phone number ID é só números (WhatsApp Manager › Telefones).' } };
    if (id) {
      // Nunca o número de um SDR ou do Rel: as mensagens dele iriam pra caixa errada.
      const ja = await rest(`qs_wa_numeros_meta?select=setor,rotulo&phone_number_id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => null);
      if (ja?.[0]) return { status: 409, json: { error: `Esse número já é do ${ja[0].setor} no QS (${ja[0].rotulo || 'sem rótulo'}). O Marketing precisa de um número NOVO.` } };
    }
    const value = id ? { phone_number_id: id, numero: String(body.numero || '').trim() || null, rotulo: 'Marketing', atualizado_por: u.name, atualizado_em: agora.toISOString() } : {};
    await rest('qs_settings?on_conflict=key', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: 'mkt_disparo_numero', value } });
    return { status: 200, json: { ok: true, numero: id ? value : null } };
  }

  if (acao === 'mkt_conferir_numero') {
    // Só LEITURA na Meta: o número está na WABA do QS? (o token do número
    // oficial enxerga todos os números da mesma conta).
    const n = await lerNumeroMkt();
    if (!n) return { status: 400, json: { error: 'Defina o número primeiro.' } };
    const { credenciaisDaMeta, graph } = await import('./_meta.js');
    const cr = await credenciaisDaMeta().catch(() => null);
    if (!cr?.token || !cr?.waba) return { status: 200, json: { ok: false, motivo: 'O QS não tem a credencial do número oficial (WABA) pra conferir.' } };
    try {
      const r = await graph(`/${cr.waba}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,messaging_limit_tier`, { token: cr.token });
      const achado = (r?.data || []).find((x) => String(x.id) === n.phone_number_id);
      if (!achado) return { status: 200, json: { ok: false, motivo: 'Esse Phone number ID não está na WABA do QS.' } };
      return { status: 200, json: { ok: true, numero: achado } };
    } catch (e) {
      return { status: 200, json: { ok: false, motivo: `A Meta respondeu: ${e?.message}` } };
    }
  }

  if (acao === 'agendar') {
    const c = body._campanha;
    if (c.setor !== 'marketing') return { status: 400, json: { error: 'Agendamento é do Marketing.' } };
    if (c.status !== 'rascunho') return { status: 409, json: { error: 'Só rascunho pode ser agendado.' } };
    const quando = new Date(String(body.agendada_para || ''));
    if (Number.isNaN(quando.getTime()) || quando.getTime() < agora.getTime() + 60_000) return { status: 400, json: { error: 'Escolha uma data e hora no futuro.' } };
    await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.rascunho`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'agendada', agendada_para: quando.toISOString(), ultimo_erro: null } });
    return { status: 200, json: { ok: true } };
  }
  if (acao === 'desagendar') {
    const c = body._campanha;
    if (c.status !== 'agendada') return { status: 409, json: { error: 'A campanha não está agendada.' } };
    await rest(`qs_disparo_campanhas?id=eq.${c.id}&status=eq.agendada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'rascunho', agendada_para: null } });
    return { status: 200, json: { ok: true } };
  }

  if (acao === 'mkt_recorrencia_salvar') {
    const r = body.recorrencia || {};
    const nome = String(r.nome || '').trim();
    if (nome.length < 2) return { status: 400, json: { error: 'Dê um nome à recorrência.' } };
    const m = conferirModelo(cfg, r.modelo_nome, r.modelo_idioma, r.params, fontes);
    if (m.erro) return { status: 400, json: { error: m.erro } };
    const dias = [...new Set((r.dias_semana || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    const hora = hhmm(r.hora);
    if (!dias.length || !hora) return { status: 400, json: { error: 'Escolha os dias e a hora.' } };
    const linha = {
      nome, modelo_nome: m.modelo.nome, modelo_idioma: m.modelo.idioma || 'pt_BR', params: m.params,
      publico: r.publico && typeof r.publico === 'object' ? r.publico : {}, dias_semana: dias, hora,
      ativa: r.ativa !== false, proxima_em: r.ativa === false ? null : proximaOcorrencia(dias, hora, agora), atualizado_em: agora.toISOString(),
    };
    const salvo = UUID.test(String(r.id || ''))
      ? await rest(`mkt_disparo_recorrencias?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=representation', body: linha })
      : await rest('mkt_disparo_recorrencias', { method: 'POST', prefer: 'return=representation', body: { ...linha, criado_por: u.id } });
    return { status: 200, json: { ok: true, recorrencia: salvo?.[0] } };
  }
  if (acao === 'mkt_recorrencia_apagar') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, json: { error: 'id inválido' } };
    await rest(`mkt_disparo_recorrencias?id=eq.${body.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { status: 200, json: { ok: true } };
  }

  if (acao === 'mkt_sequencia_salvar') {
    const s = body.sequencia || {};
    const nome = String(s.nome || '').trim();
    if (nome.length < 2) return { status: 400, json: { error: 'Dê um nome à sequência.' } };
    const passos = Array.isArray(s.passos) ? s.passos : [];
    if (!passos.length) return { status: 400, json: { error: 'A sequência precisa de pelo menos um passo.' } };
    const limpos = [];
    let ultimoDia = -1;
    for (const [i, p] of passos.entries()) {
      const m = conferirModelo(cfg, p.modelo_nome, p.modelo_idioma, p.params, fontes);
      if (m.erro) return { status: 400, json: { error: `Passo ${i + 1}: ${m.erro}` } };
      const dia = Math.round(Number(p.dia_offset));
      if (!Number.isFinite(dia) || dia < 0 || dia > 365) return { status: 400, json: { error: `Passo ${i + 1}: o dia vai de 0 a 365.` } };
      if (dia < ultimoDia) return { status: 400, json: { error: `Passo ${i + 1}: os dias precisam estar em ordem (0, 3, 7…).` } };
      ultimoDia = dia;
      const hora = hhmm(p.hora);
      if (!hora) return { status: 400, json: { error: `Passo ${i + 1}: hora inválida.` } };
      limpos.push({ ordem: i + 1, dia_offset: dia, hora, modelo_nome: m.modelo.nome, modelo_idioma: m.modelo.idioma || 'pt_BR', params: m.params });
    }
    const linha = {
      nome, descricao: String(s.descricao || '').trim() || null, parar_se_responder: s.parar_se_responder !== false,
      lista_gatilho_id: UUID.test(String(s.lista_gatilho_id || '')) ? s.lista_gatilho_id : null, atualizado_em: agora.toISOString(),
    };
    let id = UUID.test(String(s.id || '')) ? s.id : null;
    if (id) await rest(`mkt_disparo_sequencias?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: linha });
    else id = (await rest('mkt_disparo_sequencias', { method: 'POST', prefer: 'return=representation', body: { ...linha, criado_por: u.id } }))?.[0]?.id;
    if (!id) return { status: 500, json: { error: 'Não salvou.' } };
    // Passos: troca o conjunto inteiro (inscrição guarda o NÚMERO do próximo passo).
    await rest(`mkt_disparo_sequencia_passos?sequencia_id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    await rest('mkt_disparo_sequencia_passos', { method: 'POST', prefer: 'return=minimal', body: limpos.map((p) => ({ ...p, sequencia_id: id })) });
    return { status: 200, json: { ok: true, id } };
  }
  if (acao === 'mkt_sequencia_ativar') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, json: { error: 'id inválido' } };
    await rest(`mkt_disparo_sequencias?id=eq.${body.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ativa: body.ativa === true, atualizado_em: agora.toISOString() } });
    return { status: 200, json: { ok: true } };
  }
  if (acao === 'mkt_sequencia_apagar') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, json: { error: 'id inválido' } };
    await rest(`mkt_disparo_sequencias?id=eq.${body.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { status: 200, json: { ok: true } };
  }
  if (acao === 'mkt_sequencia_inscrever') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, json: { error: 'id inválido' } };
    const pub = await montarPublicoMkt({ publico: body.publico || {}, ritmo: cfg.ritmo, ignorarRecente: true });
    if (body.soPrevia) return { status: 200, json: { total: pub.recebem.length, excluidos: Object.entries(pub.excluidos).map(([k, n]) => ({ motivo: motivoMkt(k), n })) } };
    const r = await inscrever(body.id, pub.recebem, agora);
    return { status: 200, json: { ok: true, ...r, total: pub.recebem.length } };
  }
  if (acao === 'mkt_inscricao_tirar') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, json: { error: 'id inválido' } };
    await rest(`mkt_disparo_sequencia_inscricoes?id=eq.${body.id}&status=eq.ativa`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'saiu', motivo: `tirado por ${u.name}`, atualizado_em: agora.toISOString() } });
    return { status: 200, json: { ok: true } };
  }

  return null;
}
