// api/_relPessoaBitrix.js
// -----------------------------------------------------------------------------
// TODA PESSOA DO QS TEM CONTATO NO BITRIX (revisão 12/11/2026).
//
// "QS = ferramenta, Bitrix = banco de dados. Todo card criado no QS TEM que
// nascer no Bitrix e ficar amarrado. Falha = pendência visível + nova
// tentativa." (Bruno). Medido em 12/11: 134 pessoas de rel_clientes (todas
// criadas desde 13/10) sem contato no Bitrix — nenhum caminho criava.
//
// COMO FUNCIONA
//   • A migration 0366 mantém a fila em rel_clientes_bitrix (uma linha por
//     pessoa): gatilho em rel_clientes → 'pendente' quando a pessoa nasce sem
//     contato ou quando nome/telefone/e-mail/CPF mudam e ela ainda não tem
//     contato; 'ok' quando bitrix_contato_id é preenchido. A fila mora FORA de
//     rel_clientes de propósito: cada tentativa gravada lá viraria uma linha de
//     auditoria (rel_audita) e mexeria no atualizado_em da ficha.
//   • Esta rotina, pra cada pessoa da fila, PERGUNTA ANTES DE CRIAR:
//       1. CPF (campo CPF do contato) — único por pessoa: achou um, liga;
//       2. telefone (todas as variantes, crm.duplicate.findbycomm) e
//       3. e-mail — só ligam se o NOME do contato bate com o da pessoa (família
//          divide telefone/e-mail: o filho não pode cair no contato da mãe).
//     Mais de um candidato → 'falhou' (ambíguo; alguém escolhe na ficha).
//     Nada achado → crm.contact.add. Sem CPF, telefone nem e-mail → 'sem_dados'
//     (criar só com o nome duplicaria; volta pra fila quando o cadastro mudar).
//     Busca que FALHOU (Bitrix fora) ≠ "não existe": vira 'falhou', nunca cria.
//   • Grava rel_clientes.bitrix_contato_id (só se ainda estiver vazio) → o
//     gatilho marca 'ok'.
//
// QUEM CHAMA (api/rel-bitrix-comentarios.js — sem função nova na Vercel):
//   • o cron dele (a cada 3 min) roda uma rodada curta SE
//     REL_PESSOA_BITRIX_LIGADO=1 (desligado por padrão);
//   • GET ?acao=pessoas-conferir[&pular=N] (CRON_SECRET) → SIMULAÇÃO: o que
//     faria com cada pessoa da fila, só lendo o Bitrix;
//   • POST { acao:'pessoa-enviar', clienteId } (usuário logado) → "Enviar agora"
//     da ficha; com automatico:true (depois de salvar) respeita o interruptor.
//
// ATUALIZAR O CONTATO QUE JÁ EXISTE (0393, 13/11/2026)
//   Antes a rotina só criava/ligava (contact.list/add) — mudar o telefone na
//   ficha nunca chegava ao Bitrix. Agora, quando nome/telefone/e-mail de uma
//   ficha QUE JÁ TEM contato muda, o gatilho da 0393 põe a linha da fila em
//   status 'atualizar' com os campos que mudaram (campos text[]). A rotina lê o
//   contato (crm.contact.get) e manda crm.contact.update SÓ com o que mudou e
//   ainda difere do Bitrix (planejarAtualizacao). Regras:
//     • nunca apaga: valor vazio no QS não vai pro Bitrix;
//     • telefone/e-mail entram como item NOVO da lista (o Bitrix guarda vários);
//       se o Bitrix já tem aquele número/e-mail, nada a fazer;
//     • nome: se o contato usa "nome do meio" e o nome novo não tem como
//       preencher, não mexe (avisa no erro) — melhor não mexer do que embaralhar.
//   Mesmo interruptor (REL_PESSOA_BITRIX_LIGADO) e a mesma simulação.
// -----------------------------------------------------------------------------

import { variantesDeTelefone } from './_bitrixLead.js';

export const CAMPO_CONTATO_CPF = 'UF_CRM_1749757426655'; // CPF — contato (o mesmo de api/_closerBitrixFamilia.js)
export const MAX_TENTATIVAS_AUTO = 24;                   // depois disso só o botão "Enviar agora"
const UMA_HORA = 60 * 60_000;

const limpa = (v) => String(v ?? '').trim();
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const semAcento = (t) => limpa(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
const cpfFormatado = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpa(e));

/** O que dá pra procurar desta pessoa. */
export function chavesDaPessoa(p) {
  const cpf = soDigitos(p?.cpf);
  const fone = soDigitos(p?.telefone);
  return {
    cpf: cpf.length === 11 ? cpf : null,
    telefone: fone.length >= 10 ? fone : null,
    email: emailValido(p?.email) ? limpa(p.email).toLowerCase() : null,
  };
}

/** "Maria  da Silva" × contato {NAME, SECOND_NAME, LAST_NAME}: 1º nome igual e (último igual ou um dos dois só tem um nome). */
export function nomeBate(nomePessoa, contato) {
  const a = semAcento(nomePessoa).split(' ').filter(Boolean);
  const b = semAcento([contato?.NAME, contato?.SECOND_NAME, contato?.LAST_NAME].filter(Boolean).join(' ')).split(' ').filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a[0] !== b[0]) return false;
  if (a.length === 1 || b.length === 1) return true;
  return a[a.length - 1] === b[b.length - 1];
}

/** O contato como nasce no Bitrix (mesmo formato do card de família: NAME com o nome inteiro). */
export function montarContatoDaPessoa(p) {
  const { cpf, telefone, email } = chavesDaPessoa(p);
  const nasc = /^\d{4}-\d{2}-\d{2}/.test(String(p?.nascimento || '')) ? String(p.nascimento).slice(0, 10) : null;
  return {
    NAME: limpa(p?.nome) || 'Cliente',
    OPENED: 'Y',
    ...(telefone ? { PHONE: [{ VALUE: telefone, VALUE_TYPE: 'MOBILE' }] } : {}),
    ...(email ? { EMAIL: [{ VALUE: email, VALUE_TYPE: 'HOME' }] } : {}),
    ...(nasc ? { BIRTHDATE: nasc } : {}),
    ...(cpf ? { [CAMPO_CONTATO_CPF]: cpf } : {}),
    COMMENTS: 'Contato criado pelo QS a partir do cadastro da pessoa (Relacionamento). A fonte dos dados é o QS.',
  };
}

/**
 * A DECISÃO, sem rede.
 *   achados = { cpf: [ids], telefone: [{ID,NAME,…}], email: [{ID,NAME,…}] }
 * Devolve { acao: 'vincular', contatoId, por } | { acao: 'criar', fields }
 *       | { acao: 'sem_dados', motivo } | { acao: 'ambiguo', motivo }.
 */
export function planejarContato(pessoa, achados = {}) {
  const chaves = chavesDaPessoa(pessoa);
  if (!chaves.cpf && !chaves.telefone && !chaves.email) {
    return { acao: 'sem_dados', motivo: 'Sem CPF, telefone nem e-mail: complete o cadastro para o QS criar o contato no Bitrix sem duplicar.' };
  }
  const unicos = (lista) => [...new Set((lista || []).map((x) => String(x?.ID ?? x)).filter((x) => /^\d+$/.test(x)))];
  const porCpf = unicos(achados.cpf);
  if (porCpf.length === 1) return { acao: 'vincular', contatoId: porCpf[0], por: 'cpf' };
  if (porCpf.length > 1) return { acao: 'ambiguo', motivo: `Mais de um contato no Bitrix com este CPF (IDs ${porCpf.join(', ')}). Escolha o certo na ficha (campo "ID do Bitrix").` };
  for (const por of ['telefone', 'email']) {
    const bate = unicos((achados[por] || []).filter((c) => nomeBate(pessoa?.nome, c)));
    if (bate.length === 1) return { acao: 'vincular', contatoId: bate[0], por };
    if (bate.length > 1) return { acao: 'ambiguo', motivo: `Mais de um contato no Bitrix com este ${por === 'email' ? 'e-mail' : 'telefone'} e o mesmo nome (IDs ${bate.join(', ')}). Escolha o certo na ficha (campo "ID do Bitrix").` };
  }
  return { acao: 'criar', fields: montarContatoDaPessoa(pessoa) };
}

/** Lê do Bitrix os candidatos (só leitura). Erro do Bitrix LANÇA — "não consegui perguntar" não é "não existe". */
export async function buscarAchados(pessoa, { bx }) {
  const { cpf, telefone, email } = chavesDaPessoa(pessoa);
  const achados = { cpf: [], telefone: [], email: [] };
  const sel = ['ID', 'NAME', 'SECOND_NAME', 'LAST_NAME'];
  if (cpf) {
    achados.cpf = (await bx('crm.contact.list', { filter: { [CAMPO_CONTATO_CPF]: [cpf, cpfFormatado(cpf)] }, select: sel }, 8_000)) || [];
  }
  const porComm = async (type, values) => {
    const dup = await bx('crm.duplicate.findbycomm', { entity_type: 'CONTACT', type, values }, 8_000);
    const ids = Array.isArray(dup?.CONTACT) ? dup.CONTACT.map(String).slice(0, 20) : [];
    if (!ids.length) return [];
    return (await bx('crm.contact.list', { filter: { ID: ids }, select: sel }, 8_000)) || [];
  };
  if (telefone) achados.telefone = await porComm('PHONE', variantesDeTelefone(telefone));
  if (email) achados.email = await porComm('EMAIL', [email]);
  return achados;
}

const COLS_PESSOA = 'id,nome,telefone,email,cpf,nascimento,bitrix_contato_id,mesclado_em_id,arquivado_em';

// ── 0393: atualizar o contato que já existe ─────────────────────────────────

export const CAMPOS_ATUALIZAVEIS = ['nome', 'telefone', 'email'];

/** Dois telefones são o mesmo número (com/sem 55, com/sem o 9)? */
export function mesmoTelefone(a, b) {
  const da = soDigitos(a), db = soDigitos(b);
  if (!da || !db) return false;
  if (da === db) return true;
  return variantesDeTelefone(da).includes(db) || variantesDeTelefone(db).includes(da);
}

const valoresMulti = (lista) => (Array.isArray(lista) ? lista : []).map((x) => limpa(x?.VALUE)).filter(Boolean);

/**
 * A DECISÃO da atualização, sem rede.
 *   pessoa  = a ficha do QS agora
 *   contato = o contato como está no Bitrix (crm.contact.get)
 *   campos  = o que mudou no QS (da fila); vazio/nulo = confere os três
 * Devolve { fields, mudou: [...], ignorados: [{ campo, motivo }] }.
 * fields vazio = nada a mandar (o Bitrix já está igual ou o QS está vazio).
 */
export function planejarAtualizacao(pessoa, contato, campos) {
  const quer = (Array.isArray(campos) && campos.length ? campos : CAMPOS_ATUALIZAVEIS).filter((c) => CAMPOS_ATUALIZAVEIS.includes(c));
  const fields = {};
  const mudou = [];
  const ignorados = [];
  const c = contato || {};

  if (quer.includes('nome')) {
    const novo = limpa(pessoa?.nome).replace(/\s+/g, ' ');
    const atual = [c.NAME, c.SECOND_NAME, c.LAST_NAME].map(limpa).filter(Boolean).join(' ');
    if (!novo) ignorados.push({ campo: 'nome', motivo: 'nome vazio no QS (não apaga o do Bitrix)' });
    else if (semAcento(novo) === semAcento(atual)) { /* já igual */ }
    else {
      const partes = novo.split(' ');
      const usaMeio = !!limpa(c.SECOND_NAME);
      const usaSobrenome = !!limpa(c.LAST_NAME);
      if (!usaMeio && !usaSobrenome) { fields.NAME = novo; mudou.push('nome'); }
      else if (partes.length < 2) ignorados.push({ campo: 'nome', motivo: 'o nome novo tem uma palavra só e o contato tem sobrenome no Bitrix — não mexi' });
      else if (usaMeio && partes.length < 3) ignorados.push({ campo: 'nome', motivo: 'o contato tem nome do meio no Bitrix e o nome novo não — não mexi' });
      else if (usaMeio) {
        fields.NAME = partes[0]; fields.SECOND_NAME = partes.slice(1, -1).join(' '); fields.LAST_NAME = partes[partes.length - 1]; mudou.push('nome');
      } else {
        fields.NAME = partes.slice(0, -1).join(' '); fields.LAST_NAME = partes[partes.length - 1]; mudou.push('nome');
      }
    }
  }

  if (quer.includes('telefone')) {
    const { telefone } = chavesDaPessoa(pessoa);
    if (!telefone) ignorados.push({ campo: 'telefone', motivo: 'telefone vazio/curto no QS (não apaga o do Bitrix)' });
    else if (!valoresMulti(c.PHONE).some((v) => mesmoTelefone(v, telefone))) {
      fields.PHONE = [{ VALUE: telefone, VALUE_TYPE: 'MOBILE' }]; mudou.push('telefone');
    }
  }

  if (quer.includes('email')) {
    const { email } = chavesDaPessoa(pessoa);
    if (!email) ignorados.push({ campo: 'email', motivo: 'e-mail vazio/inválido no QS (não apaga o do Bitrix)' });
    else if (!valoresMulti(c.EMAIL).some((v) => v.toLowerCase() === email)) {
      fields.EMAIL = [{ VALUE: email, VALUE_TYPE: 'HOME' }]; mudou.push('email');
    }
  }
  return { fields, mudou, ignorados };
}

/**
 * Atualiza o contato de UMA pessoa (status 'atualizar' na fila). seco=true → só diz o que faria.
 * Devolve { clienteId, nome, acao: 'atualizar'|'nada'|'erro', contatoId, mudou?, ignorados?, status, motivo? }.
 * Falha (Bitrix fora/recusou) → continua 'atualizar' com o erro; a rodada tenta de novo depois de 1 h.
 */
export async function atualizarContato(pessoa, { bx, rest, seco = false, linha = null }) {
  const contatoId = limpa(pessoa.bitrix_contato_id);
  const base = { clienteId: pessoa.id, nome: pessoa.nome, contatoId: contatoId || null };
  if (pessoa.mesclado_em_id || pessoa.arquivado_em) return { ...base, acao: 'nada', status: 'fora', motivo: 'Ficha mesclada ou arquivada.' };
  if (!/^\d+$/.test(contatoId)) return { ...base, acao: 'nada', status: 'sem_contato', motivo: 'A ficha não tem contato no Bitrix (vai pela criação).' };
  const tentativa = { tentativa_em: new Date().toISOString(), tentativas: Number(linha?.tentativas || 0) + 1 };
  let contato;
  try {
    contato = await bx('crm.contact.get', { id: contatoId }, 8_000);
    if (!contato || typeof contato !== 'object') throw new Error(`contato ${contatoId} não encontrado no Bitrix`);
  } catch (e) {
    const motivo = `Não consegui ler o contato ${contatoId} no Bitrix (${String(e?.message || 'erro').slice(0, 200)}). Nada foi alterado.`;
    if (!seco) await marcar(rest, pessoa.id, { status: 'atualizar', erro: motivo, ...tentativa }).catch(() => null);
    return { ...base, acao: 'erro', status: 'atualizar', motivo };
  }
  const plano = planejarAtualizacao(pessoa, contato, linha?.campos);
  const temAlgo = Object.keys(plano.fields).length > 0;
  const aviso = plano.ignorados.length ? plano.ignorados.map((i) => `${i.campo}: ${i.motivo}`).join('; ') : null;
  if (seco) return { ...base, acao: temAlgo ? 'atualizar' : 'nada', mudou: plano.mudou, ignorados: plano.ignorados, status: 'simulado' };
  try {
    if (temAlgo) {
      await bx('crm.contact.update', { id: contatoId, fields: plano.fields, params: { REGISTER_SONET_EVENT: 'N' } }, 8_000);
    }
    await marcar(rest, pessoa.id, {
      status: 'ok', erro: aviso, campos: null, contato_id: contatoId, ...tentativa,
      resultado: temAlgo ? `atualizado_${plano.mudou.join('_')}` : 'atualizado_sem_mudanca',
    });
    return { ...base, acao: temAlgo ? 'atualizar' : 'nada', mudou: plano.mudou, ignorados: plano.ignorados, status: 'ok' };
  } catch (e) {
    const motivo = `O Bitrix recusou atualizar o contato ${contatoId}: ${String(e?.message || 'erro').slice(0, 200)}`;
    await marcar(rest, pessoa.id, { status: 'atualizar', erro: motivo, ...tentativa }).catch(() => null);
    return { ...base, acao: 'erro', status: 'atualizar', motivo };
  }
}

/** Marca o resultado na fila (rel_clientes_bitrix). */
async function marcar(rest, clienteId, campos) {
  await rest(`rel_clientes_bitrix?cliente_id=eq.${clienteId}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...campos, atualizado_em: new Date().toISOString() } });
}

/**
 * Garante o contato de UMA pessoa. seco=true → só diz o que faria.
 *   linha = linha da fila ({ tentativas }) — opcional
 * Devolve { clienteId, nome, acao, contatoId?, por?, motivo?, status }.
 */
export async function garantirContato(pessoa, { bx, rest, seco = false, linha = null }) {
  const base = { clienteId: pessoa.id, nome: pessoa.nome };
  if (pessoa.mesclado_em_id || pessoa.arquivado_em) return { ...base, acao: 'nada', status: 'fora', motivo: 'Ficha mesclada ou arquivada.' };
  if (limpa(pessoa.bitrix_contato_id)) return { ...base, acao: 'nada', status: 'ok', contatoId: limpa(pessoa.bitrix_contato_id), motivo: 'Já tem contato.' };
  const tentativa = { tentativa_em: new Date().toISOString(), tentativas: Number(linha?.tentativas || 0) + 1 };
  let plano;
  try {
    plano = planejarContato(pessoa, await buscarAchados(pessoa, { bx }));
  } catch (e) {
    const motivo = `Não consegui consultar o Bitrix (${String(e?.message || 'erro').slice(0, 200)}). Nada foi criado.`;
    if (!seco) await marcar(rest, pessoa.id, { status: 'falhou', erro: motivo, ...tentativa }).catch(() => null);
    return { ...base, acao: 'erro', status: 'falhou', motivo };
  }
  if (seco) return { ...base, ...plano, fields: undefined, status: 'simulado' };

  if (plano.acao === 'sem_dados') {
    await marcar(rest, pessoa.id, { status: 'sem_dados', erro: plano.motivo, ...tentativa });
    return { ...base, ...plano, status: 'sem_dados' };
  }
  if (plano.acao === 'ambiguo') {
    await marcar(rest, pessoa.id, { status: 'falhou', erro: plano.motivo, ...tentativa });
    return { ...base, ...plano, status: 'falhou' };
  }
  let contatoId = plano.contatoId || null;
  try {
    if (plano.acao === 'criar') {
      const id = await bx('crm.contact.add', { fields: plano.fields, params: { REGISTER_SONET_EVENT: 'N' } }, 8_000);
      contatoId = id ? String(id) : null;
      if (!contatoId) throw new Error('o Bitrix não devolveu o id do contato');
    }
    // Só preenche se ainda estiver vazio (alguém pode ter ligado à mão no meio). O gatilho da 0366 marca 'ok'.
    await rest(`rel_clientes?id=eq.${pessoa.id}&bitrix_contato_id=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { bitrix_contato_id: contatoId } });
    await marcar(rest, pessoa.id, { status: 'ok', erro: null, resultado: plano.acao === 'criar' ? 'criado' : `vinculado_${plano.por}`, contato_id: contatoId, ...tentativa });
    return { ...base, acao: plano.acao, por: plano.por || null, contatoId, status: 'ok' };
  } catch (e) {
    const motivo = `${plano.acao === 'criar' ? 'O Bitrix recusou criar o contato' : 'Falhou ao ligar o contato'}${contatoId ? ` (contato ${contatoId} já existe no Bitrix — ligue na ficha)` : ''}: ${String(e?.message || 'erro').slice(0, 200)}`;
    await marcar(rest, pessoa.id, { status: 'falhou', erro: motivo, ...tentativa, ...(contatoId ? { contato_id: contatoId } : {}) }).catch(() => null);
    return { ...base, acao: 'erro', status: 'falhou', contatoId, motivo };
  }
}

/** Uma pessoa pelo id (botão "Enviar agora"). */
export async function enviarPessoa(clienteId, { bx, rest }) {
  const pessoa = (await rest(`rel_clientes?select=${COLS_PESSOA}&id=eq.${clienteId}&limit=1`))?.[0];
  if (!pessoa) return { status: 404, body: { error: 'Pessoa não encontrada.' } };
  const linha = (await rest(`rel_clientes_bitrix?select=tentativas,status&cliente_id=eq.${clienteId}&limit=1`).catch(() => null))?.[0] || null;
  // 0393: já tem contato e a ficha mudou → atualiza (lê os campos só aqui: sem a 0393 a coluna não existe).
  if (linha?.status === 'atualizar' && limpa(pessoa.bitrix_contato_id)) {
    const comCampos = (await rest(`rel_clientes_bitrix?select=tentativas,status,campos&cliente_id=eq.${clienteId}&limit=1`).catch(() => null))?.[0] || linha;
    const r = await atualizarContato(pessoa, { bx, rest, linha: comCampos });
    return { status: 200, body: { ok: r.status === 'ok', ...r } };
  }
  // Sem linha na fila (banco sem a 0366 aplicada ou pessoa antiga): cria a linha antes, pra marcar o resultado.
  if (!linha) {
    await rest('rel_clientes_bitrix?on_conflict=cliente_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { cliente_id: clienteId, status: 'pendente' } });
  }
  const r = await garantirContato(pessoa, { bx, rest, linha });
  return { status: 200, body: { ok: r.status === 'ok', ...r } };
}

/**
 * A fila. seco → pendente + falhou + sem_dados, paginada (pular), sem escrever.
 * real → pendentes e os 'falhou' com a última tentativa há mais de 1 h (até MAX_TENTATIVAS_AUTO).
 */
export async function rodadaPessoas({ bx, rest, seco = false, limite = 10, pular = 0, orcamentoMs = 10_000 }) {
  const de = Math.max(0, Math.floor(Number(pular) || 0));
  const sel = `select=cliente_id,status,tentativas,tentativa_em,pendente_em,cliente:rel_clientes!inner(${COLS_PESSOA})`;
  let fila;
  if (seco) {
    fila = (await rest(`rel_clientes_bitrix?${sel}&status=in.(pendente,falhou,sem_dados)&order=pendente_em.asc.nullslast,cliente_id.asc&limit=${limite}&offset=${de}`)) || [];
  } else {
    const pend = (await rest(`rel_clientes_bitrix?${sel}&status=eq.pendente&order=pendente_em.asc.nullslast&limit=${limite}`)) || [];
    const resta = limite - pend.length;
    const hora = new Date(Date.now() - UMA_HORA).toISOString();
    const falhas = resta > 0 ? ((await rest(`rel_clientes_bitrix?${sel}&status=eq.falhou&tentativas=lt.${MAX_TENTATIVAS_AUTO}&tentativa_em=lt.${hora}&order=tentativa_em.asc&limit=${resta}`).catch(() => null)) || []) : [];
    fila = [...pend, ...falhas];
  }
  // 0393: as fichas com contato que mudaram (status 'atualizar'). Sem a 0393 não há
  // linha nesse status (e a coluna campos não existe) — a consulta falha calada.
  const restaAtualizar = limite - fila.length;
  const selAtu = `select=cliente_id,status,tentativas,tentativa_em,pendente_em,campos,cliente:rel_clientes!inner(${COLS_PESSOA})`;
  const horaAtu = new Date(Date.now() - UMA_HORA).toISOString();
  const atualizar = restaAtualizar > 0
    ? ((await rest(seco
      ? `rel_clientes_bitrix?${selAtu}&status=eq.atualizar&order=pendente_em.asc.nullslast,cliente_id.asc&limit=${restaAtualizar}`
      : `rel_clientes_bitrix?${selAtu}&status=eq.atualizar&tentativas=lt.${MAX_TENTATIVAS_AUTO}&or=(tentativa_em.is.null,tentativa_em.lt.${horaAtu})&order=pendente_em.asc.nullslast&limit=${restaAtualizar}`,
    ).catch(() => null)) || [])
    : [];
  const total = seco
    ? ((await rest('rel_clientes_bitrix?select=cliente_id&status=in.(pendente,falhou,sem_dados,atualizar)&limit=5000').catch(() => null))
      || (await rest('rel_clientes_bitrix?select=cliente_id&status=in.(pendente,falhou,sem_dados)&limit=5000').catch(() => null)) || null)?.length ?? null
    : null;
  const inicio = Date.now();
  const itens = [];
  let naoFeitos = 0;
  for (const l of fila) {
    if (Date.now() - inicio > orcamentoMs) { naoFeitos++; continue; }
    const r = await garantirContato(l.cliente, { bx, rest, seco, linha: l }).catch((e) => ({ clienteId: l.cliente_id, acao: 'erro', status: 'falhou', motivo: String(e?.message || 'falhou').slice(0, 200) }));
    itens.push({ ...r, statusFila: l.status });
  }
  for (const l of atualizar) {
    if (Date.now() - inicio > orcamentoMs) { naoFeitos++; continue; }
    const r = await atualizarContato(l.cliente, { bx, rest, seco, linha: l }).catch((e) => ({ clienteId: l.cliente_id, acao: 'erro', status: 'atualizar', motivo: String(e?.message || 'falhou').slice(0, 200) }));
    itens.push({ ...r, statusFila: l.status });
  }
  const proximo = seco && (naoFeitos || fila.length === limite) ? de + itens.length : null;
  const conta = (f) => itens.filter(f).length;
  return {
    seco, total, pulados: de, proximo, naoFeitos,
    resumo: {
      vistos: itens.length,
      vincularia: conta((i) => i.acao === 'vincular'), criaria: conta((i) => i.acao === 'criar'),
      semDados: conta((i) => i.acao === 'sem_dados'), ambiguos: conta((i) => i.acao === 'ambiguo'),
      erros: conta((i) => i.acao === 'erro'), ok: conta((i) => i.status === 'ok'),
      atualizaria: conta((i) => i.statusFila === 'atualizar' && i.acao === 'atualizar'),
    },
    itens,
  };
}
