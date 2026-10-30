// scripts/migrar-sendflow.mjs
// -----------------------------------------------------------------------------
// Traz os dados do SendFlow (banco qsuyqxmnfysiplbwxxrx) pra área de Marketing
// do QS (0243 grupos + 0245 e-mail). NADA é enviado — só leitura de lá e
// gravação aqui.
//
// O que existe no SendFlow (conferido em 30/10/2026) e pra onde vai:
//   • connections (1 chip Evolution) → mkt_grupos_conexao, com envio DESLIGADO
//   • groups (24)                    → mkt_grupos (jid é a chave)
//     ativo=false lá vira a tag "Desligado no SendFlow" (aqui não há "ativo")
//   • group_tags / group_tag_links   → mkt_grupos_tags / mkt_grupos_tag_links
//   • cadencias (16)                 → mkt_grupos_cadencias (mesmo id)
//   • campaigns (258, todas de grupo) → mkt_grupos_campanhas (mesmo id)
//       enviada  → concluida (fila já "montada": o conteúdo fica travado)
//       agendada → PAUSADA de propósito: o SendFlow continua mandando até o
//                  desligar; se viesse "agendada", ligar o envio do QS
//                  mandaria a mesma mensagem duas vezes no grupo.
//       rascunho → rascunho
//   • campaign_recipients (435)      → mkt_grupos_envios
//   • mídia das campanhas            → copiada pro bucket mkt-grupos/sendflow/
//     (o link antigo morre quando o projeto do SendFlow for apagado)
//   • email_templates (3)            → mkt_email_modelos, refeitos em BLOCOS
//     (o editor do QS é por blocos; HTML cru abriria vazio)
// Fica de fora: contatos/listas/campanhas de e-mail (vazios lá), o único
// fluxo ("Novo fluxo", rascunho com 1 bloco), Instagram (sem conta conectada)
// e os segredos (Meta, Resend) — esses se cadastram de novo no QS.
//
// Pode rodar de novo (e é assim que se faz a virada): o que já existe no QS
// não é sobrescrito, EXCETO campanha que continua pausada e intocada desde a
// migração — essa é atualizada com o estado novo do SendFlow (ex.: foi
// enviada lá nesse meio-tempo → vira concluída aqui, com os envios).
//
// Uso:  node --import ./tests/registrar-ts.mjs scripts/migrar-sendflow.mjs            (só confere)
//       node --import ./tests/registrar-ts.mjs scripts/migrar-sendflow.mjs --aplicar  (grava)
// Precisa: .env do qs-turis (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) e o
//          .env.local do SendFlow (~/sendflow, ou SENDFLOW_ENV=<caminho>).
// -----------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderEmail } from '../src/mkt/email/lib/blocos.ts';

function lerEnv(arquivo) {
  const out = {};
  for (const l of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return out;
}

const QS_ENV = lerEnv(new URL('../.env', import.meta.url));
const SF_ENV = lerEnv(process.env.SENDFLOW_ENV || path.join(os.homedir(), 'sendflow', '.env.local'));
const QS = { url: (process.env.SUPABASE_URL || QS_ENV.SUPABASE_URL).replace(/\/+$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY || QS_ENV.SUPABASE_SERVICE_ROLE_KEY };
const SF = { url: String(SF_ENV.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''), key: SF_ENV.SUPABASE_SERVICE_ROLE_KEY };
const APLICAR = process.argv.includes('--aplicar');

if (!QS.url.includes('eabfjomrnucymduqnbci')) throw new Error(`O destino não é o banco do QS: ${QS.url}`);
if (!SF.url.includes('qsuyqxmnfysiplbwxxrx')) throw new Error(`A origem não é o banco do SendFlow: ${SF.url}`);
if (!QS.key || !SF.key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY no .env do QS ou no .env.local do SendFlow.');

const MARCA = 'Migrada do SendFlow';
const AVISO_PAUSADA = `${MARCA} — pausada de propósito: o SendFlow ainda manda esta. Retome só depois de desligar o SendFlow.`;
const TAG_DESLIGADO = { nome: 'Desligado no SendFlow', cor: '#9CA3AF' };
const BUCKET_SF = 'campanhas-midia';
const BUCKET_QS = 'mkt-grupos';

// ---------------------------------------------------------------- PostgREST
async function rest(db, caminho, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${db.url}/rest/v1/${caminho}`, {
    method,
    headers: {
      apikey: db.key, Authorization: `Bearer ${db.key}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${method} ${caminho.split('?')[0]} → ${r.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

/** Lê a tabela inteira em páginas de 1000 (o PostgREST corta calado no teto). */
async function lerTudo(db, tabela, select = '*', ordem = 'id') {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const pag = await rest(db, `${tabela}?select=${select}&order=${ordem}.asc&limit=1000&offset=${de}`);
    tudo.push(...pag);
    if (pag.length < 1000) return tudo;
  }
}

/** Grava em lotes de 200; em modo conferência só conta (MIGRAR_DUMP=<arquivo> guarda as linhas pra inspeção). */
const despejo = {};
async function gravar(tabela, linhas, { conflito, ignorar = true } = {}) {
  (despejo[tabela] ??= []).push(...linhas);
  if (!APLICAR || !linhas.length) return;
  for (let i = 0; i < linhas.length; i += 200) {
    await rest(QS, `${tabela}${conflito ? `?on_conflict=${conflito}` : ''}`, {
      method: 'POST', body: linhas.slice(i, i + 200),
      prefer: `resolution=${ignorar ? 'ignore' : 'merge'}-duplicates,return=minimal`,
    });
  }
}

const relatorio = [];
const anotar = (oque, n, obs = '') => relatorio.push({ oque, n, obs });

// ---------------------------------------------------------------- 1. ler o SendFlow
console.log(`\n${APLICAR ? 'GRAVANDO no QS' : 'SÓ CONFERINDO (nada é gravado — use --aplicar)'}\n`);
const [conexoes, grupos, tags, tagLinks, cadencias, campanhas, recips, modelos, fluxos, contatos] = await Promise.all([
  lerTudo(SF, 'connections'),
  lerTudo(SF, 'groups'),
  lerTudo(SF, 'group_tags'),
  lerTudo(SF, 'group_tag_links', '*', 'group_id'),
  lerTudo(SF, 'cadencias'),
  lerTudo(SF, 'campaigns'),
  lerTudo(SF, 'campaign_recipients'),
  lerTudo(SF, 'email_templates'),
  lerTudo(SF, 'fluxos'),
  lerTudo(SF, 'contacts', 'id'),
]);
console.log(`SendFlow: ${conexoes.length} conexão, ${grupos.length} grupos, ${cadencias.length} cadências, ${campanhas.length} campanhas, ${recips.length} envios, ${modelos.length} modelos de e-mail, ${contatos.length} contatos.`);

// ---------------------------------------------------------------- 2. conexão (envio desligado)
const chip = conexoes.find((c) => c.provider === 'evolution' && c.ativo) || conexoes.find((c) => c.provider === 'evolution');
const conexaoQs = (await rest(QS, 'mkt_grupos_conexao?select=instancia&id=eq.1'))[0];
if (!chip) {
  anotar('Conexão do chip', 0, 'o SendFlow não tem chip Evolution');
} else if (conexaoQs) {
  const igual = conexaoQs.instancia.toLowerCase() === chip.instance_name.toLowerCase();
  anotar('Conexão do chip', 0, igual ? 'já estava no QS' : `o QS já usa outra instância (${conexaoQs.instancia}) — não mexi`);
} else {
  const motivo = await rest(QS, 'rpc/mkt_grupos_motivo_bloqueio', { method: 'POST', body: { p_instancia: chip.instance_name, p_numero: chip.numero } });
  if (motivo) throw new Error(`A trava do Marketing recusa o chip do SendFlow: ${motivo}`);
  const min = Math.max(5, chip.delay_min_seg || 20);
  await gravar('mkt_grupos_conexao', [{
    id: 1, instancia: chip.instance_name, numero: chip.numero, envio_ligado: false,
    intervalo_min_seg: min, intervalo_max_seg: Math.max(min, chip.delay_max_seg || 45),
    janela_inicio: '08:00', janela_fim: '21:00', estado: 'desconhecido',
  }], { conflito: 'id' });
  anotar('Conexão do chip', 1, `${chip.instance_name} (${chip.numero}) — envio DESLIGADO`);
}
const instancia = chip?.instance_name ?? null;

// ---------------------------------------------------------------- 3. mídias
const prefixoSf = `${SF.url}/storage/v1/object/public/${BUCKET_SF}/`;
const novaUrl = new Map();
const urls = [...new Set(campanhas.map((c) => c.midia_url).filter(Boolean))];
let copiadas = 0, jaTinha = 0;
for (const u of urls) {
  if (!u.startsWith(prefixoSf)) { novaUrl.set(u, u); continue; } // link de fora: fica como está
  const caminho = `sendflow/${u.slice(prefixoSf.length)}`;
  const destino = `${QS.url}/storage/v1/object/public/${BUCKET_QS}/${caminho}`;
  novaUrl.set(u, destino);
  if ((await fetch(destino, { method: 'HEAD' })).ok) { jaTinha++; continue; }
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Mídia do SendFlow não abriu (${r.status}): ${u}`);
  if (APLICAR) {
    const up = await fetch(`${QS.url}/storage/v1/object/${BUCKET_QS}/${caminho}`, {
      method: 'POST',
      headers: { apikey: QS.key, Authorization: `Bearer ${QS.key}`, 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'x-upsert': 'true' },
      body: Buffer.from(await r.arrayBuffer()),
    });
    if (!up.ok) throw new Error(`Upload da mídia falhou (${up.status}): ${caminho} — ${(await up.text()).slice(0, 200)}`);
  } else {
    await r.body?.cancel();
  }
  copiadas++;
}
anotar('Mídias', copiadas, `${jaTinha} já estavam no QS`);

// ---------------------------------------------------------------- 4. grupos + tags
const jaGrupos = new Set((await lerTudo(QS, 'mkt_grupos', 'jid', 'jid')).map((g) => g.jid));
const gruposNovos = grupos.filter((g) => !jaGrupos.has(g.group_id)).map((g) => ({
  jid: g.group_id, nome: g.nome, participantes: g.participantes, foto_url: g.foto_url,
  instancia, sincronizado_em: g.sincronizado_em, criado_em: g.criado_em,
}));
await gravar('mkt_grupos', gruposNovos, { conflito: 'jid' });
anotar('Grupos', gruposNovos.length, `${grupos.length - gruposNovos.length} já existiam`);

// tag por NOME (o QS tem índice único no nome): reaproveita a que já existir
const tagsQs = await lerTudo(QS, 'mkt_grupos_tags', 'id,nome');
const idDaTag = new Map(tagsQs.map((t) => [t.nome.trim().toLowerCase(), t.id]));
const desligados = grupos.filter((g) => g.ativo === false);
const tagsOrigem = [...tags, ...(desligados.length ? [{ id: null, ...TAG_DESLIGADO }] : [])];
const tagsNovas = [];
const tagSfParaQs = new Map();
for (const t of tagsOrigem) {
  const chave = t.nome.trim().toLowerCase();
  if (!idDaTag.has(chave)) {
    const id = t.id || crypto.randomUUID();
    idDaTag.set(chave, id);
    tagsNovas.push({ id, nome: t.nome.trim(), cor: /^#[0-9a-f]{6}$/i.test(t.cor || '') ? t.cor : '#64748b' });
  }
  if (t.id) tagSfParaQs.set(t.id, idDaTag.get(chave));
}
await gravar('mkt_grupos_tags', tagsNovas, { conflito: 'id' });
const jidDoGrupo = new Map(grupos.map((g) => [g.id, g.group_id]));
const links = [
  ...tagLinks.map((l) => ({ tag_id: tagSfParaQs.get(l.tag_id), grupo_jid: jidDoGrupo.get(l.group_id) })),
  ...desligados.map((g) => ({ tag_id: idDaTag.get(TAG_DESLIGADO.nome.toLowerCase()), grupo_jid: g.group_id })),
].filter((l) => l.tag_id && l.grupo_jid);
await gravar('mkt_grupos_tag_links', links, { conflito: 'tag_id,grupo_jid' });
anotar('Tags de grupo', tagsNovas.length, `${links.length} marcações (${desligados.length} grupos desligados no SendFlow)`);

// ---------------------------------------------------------------- 5. cadências
const jaCad = new Set((await lerTudo(QS, 'mkt_grupos_cadencias', 'id')).map((c) => c.id));
const cadNovas = cadencias.filter((c) => !jaCad.has(c.id)).map((c) => ({
  id: c.id, nome: c.nome, descricao: `Do SendFlow · categoria ${c.categoria || '—'}`,
  grupo_jids: (c.group_ids || []).filter((j) => /@g\.us$/.test(j)), tag_ids: [], ativo: true,
  criado_em: c.criado_em, atualizado_em: c.atualizado_em,
}));
await gravar('mkt_grupos_cadencias', cadNovas, { conflito: 'id' });
anotar('Cadências', cadNovas.length, `${cadencias.length - cadNovas.length} já existiam`);

// ---------------------------------------------------------------- 6. campanhas + envios
const STATUS = { enviada: 'concluida', agendada: 'pausada', enviando: 'pausada', pausada: 'pausada', rascunho: 'rascunho', cancelada: 'cancelada', erro: 'erro' };
const campQs = new Map((await lerTudo(QS, 'mkt_grupos_campanhas', 'id,status,fanout_em,avisos')).map((c) => [c.id, c]));
const recipsDa = new Map();
for (const r of recips) (recipsDa.get(r.campaign_id) ?? recipsDa.set(r.campaign_id, []).get(r.campaign_id)).push(r);

const envioDe = (campanhaId, r) => ({
  campanha_id: campanhaId, grupo_jid: r.destino, grupo_nome: r.destino_nome,
  status: r.status === 'falha' ? 'falha' : r.entregue_em || r.lido_em ? 'chegou' : 'enviado',
  tentativas: r.tentativas || 1, instancia, msg_id: r.provider_message_id, erro: r.erro,
  enviado_em: r.enviado_em, chegou_em: r.entregue_em || r.lido_em, criado_em: r.criado_em,
});
const nomeDoArquivo = (u) => { try { return decodeURIComponent(u.split('/').pop()); } catch { return u.split('/').pop(); } };
const campGravar = [];
const envGravar = [];
const pausadas = [];
let intocadas = 0, refeitas = 0;
for (const c of campanhas) {
  const noQs = campQs.get(c.id);
  const migrada = (noQs?.avisos || []).some((a) => a.startsWith(MARCA));
  const podeRefazer = noQs && noQs.status === 'pausada' && !noQs.fanout_em && migrada;
  if (noQs && !podeRefazer) {
    intocadas++;
    // rodada anterior que caiu no meio: o histórico de envios entra de novo (sem duplicar)
    if (migrada) for (const r of recipsDa.get(c.id) || []) envGravar.push(envioDe(c.id, r));
    continue;
  }
  if (noQs) refeitas++;
  const status = STATUS[c.status] ?? 'rascunho';
  const lista = recipsDa.get(c.id) || [];
  const enviados = lista.filter((r) => ['enviado', 'entregue', 'lido', 'respondido'].includes(r.status)).length;
  const falhas = lista.filter((r) => r.status === 'falha').length;
  const quando = c.enviado_em || c.enviar_em;
  const fechada = status === 'concluida' || status === 'cancelada' || status === 'erro';
  const midia = c.midia_url ? novaUrl.get(c.midia_url) ?? c.midia_url : null;
  campGravar.push({
    id: c.id, nome: c.nome, tipo: c.tipo, texto: c.mensagem || '',
    midia_url: midia, midia_nome: midia ? nomeDoArquivo(midia) : null,
    enquete_opcoes: c.enquete_opcoes, enquete_multipla: Boolean(c.enquete_multipla), mencionar_todos: Boolean(c.mencionar_todos),
    tag_ids: [], grupo_jids: (c.group_ids || []).filter((j) => /@g\.us$/.test(j)),
    enviar_em: c.enviar_em, status, cadencia_id: c.cadencia_id,
    fanout_em: fechada && lista.length ? quando : null,
    total: lista.length || c.resultado?.total || 0,
    enviados: lista.length ? enviados : c.resultado?.enviados || 0,
    falhas: lista.length ? falhas : c.resultado?.falhas || 0,
    avisos: [status === 'pausada' ? AVISO_PAUSADA : MARCA],
    iniciado_em: fechada ? quando : null, concluido_em: status === 'concluida' ? quando : null,
    criado_em: c.criado_em,
  });
  if (status === 'pausada') pausadas.push(c);
  for (const r of lista) envGravar.push(envioDe(c.id, r));
}
// campanha refeita: merge (atualiza a pausada); nova: insert
await gravar('mkt_grupos_campanhas', campGravar, { conflito: 'id', ignorar: false });
await gravar('mkt_grupos_envios', envGravar, { conflito: 'campanha_id,grupo_jid' });
const porStatus = Object.entries(campGravar.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {})).map(([k, v]) => `${v} ${k}`).join(', ');
anotar('Campanhas de grupo', campGravar.length, `${porStatus || 'nada novo'}; ${refeitas} pausadas atualizadas; ${intocadas} já mexidas no QS (não toquei)`);
anotar('Envios (histórico)', envGravar.length);

// ---------------------------------------------------------------- 7. modelos de e-mail (em blocos)
const BLOCOS = {
  'Anúncio simples': {
    assunto: 'Novidade: a Se Tu For, Eu Vou! tem um aviso para você',
    blocos: [
      { id: 'sf1', tipo: 'titulo', texto: 'Olá, {{primeiro_nome}}!', nivel: 1 },
      { id: 'sf2', tipo: 'texto', texto: 'Escreva aqui o recado principal. Uma ideia por parágrafo, frases curtas — e-mail se lê no celular, em pé, com pressa.\n\nUm segundo parágrafo, se precisar. Depois disso, o botão.' },
      { id: 'sf3', tipo: 'botao', texto: 'Quero saber mais', url: 'https://exemplo.com.br', cor: '#09282B', alinhar: 'centro' },
      { id: 'sf4', tipo: 'rodape' },
    ],
  },
  'Convite para live': {
    assunto: '{{primeiro_nome}}, sua vaga na live desta semana',
    blocos: [
      { id: 'sf1', tipo: 'texto', texto: '**LIVE AO VIVO**', alinhar: 'centro' },
      { id: 'sf2', tipo: 'titulo', texto: 'Tema da aula aqui', nivel: 1, alinhar: 'centro' },
      { id: 'sf3', tipo: 'texto', texto: 'Oi, {{primeiro_nome}}! Sua vaga está garantida. Anote os detalhes:' },
      { id: 'sf4', tipo: 'texto', texto: '**Quando:** quinta-feira, 19h30\n**Onde:** ao vivo, link abaixo\n**Duração:** cerca de 1 hora' },
      { id: 'sf5', tipo: 'botao', texto: 'Entrar na live', url: 'https://exemplo.com.br/aula', cor: '#09282B', alinhar: 'centro' },
      { id: 'sf6', tipo: 'texto', texto: 'Salve este e-mail — o link é o mesmo no dia.', alinhar: 'centro' },
      { id: 'sf7', tipo: 'rodape' },
    ],
  },
  'Texto puro (o que mais chega na caixa de entrada)': {
    assunto: 'uma pergunta rápida, {{primeiro_nome}}',
    blocos: [
      { id: 'sf1', tipo: 'texto', texto: 'Oi, {{primeiro_nome}},' },
      { id: 'sf2', tipo: 'texto', texto: 'Escreva como se estivesse escrevendo para uma pessoa só. Sem banner, sem "prezado cliente". Uma pergunta ou uma observação específica funciona melhor do que um anúncio.' },
      { id: 'sf3', tipo: 'texto', texto: 'Se quiser mandar para algum lugar, use um [link no meio do texto](https://exemplo.com.br) — ele é rastreado igual ao botão.' },
      { id: 'sf4', tipo: 'texto', texto: 'Abraço,\n**Equipe Se Tu For, Eu Vou!**' },
      { id: 'sf5', tipo: 'rodape' },
    ],
  },
};
const cfg = (await rest(QS, 'mkt_email_config?select=rodape_texto,rodape_endereco&id=eq.1'))[0] || {};
const jaModelos = new Set((await lerTudo(QS, 'mkt_email_modelos', 'id')).map((m) => m.id));
const semBloco = [];
const modelosNovos = modelos.filter((m) => !jaModelos.has(m.id)).flatMap((m) => {
  const b = BLOCOS[m.nome];
  if (!b) { semBloco.push(m.nome); return []; }
  return [{
    id: m.id, nome: m.nome, assunto: b.assunto, preheader: null, blocos: b.blocos,
    html: renderEmail(b.blocos, { rodapeTexto: cfg.rodape_texto, rodapeEndereco: cfg.rodape_endereco }),
    criado_em: m.criado_em,
  }];
});
await gravar('mkt_email_modelos', modelosNovos, { conflito: 'id' });
anotar('Modelos de e-mail', modelosNovos.length, semBloco.length ? `sem conversão (refazer à mão): ${semBloco.join(', ')}` : 'refeitos em blocos');

// ---------------------------------------------------------------- relatório
const fluxosUteis = fluxos.filter((f) => (f.grafo?.nos?.length ?? 0) > 1);
anotar('Fluxos (ManyChat)', 0, fluxosUteis.length ? `ATENÇÃO: ${fluxosUteis.length} fluxo(s) com conteúdo NÃO migrados` : `${fluxos.length} rascunho vazio, ignorado`);
anotar('Contatos', 0, contatos.length ? `ATENÇÃO: ${contatos.length} contatos NÃO migrados` : 'o SendFlow não tem nenhum');

console.log('');
for (const r of relatorio) console.log(`${r.oque.padEnd(22)} ${String(r.n).padStart(4)}  ${r.obs}`);
if (pausadas.length) {
  const fmt = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  console.log(`\nAgendadas no SendFlow → entram PAUSADAS no QS (${pausadas.length}):`);
  for (const c of pausadas.sort((a, b) => String(a.enviar_em).localeCompare(String(b.enviar_em)))) console.log(`  ${fmt(c.enviar_em)}  ${c.nome}`);
}
if (process.env.MIGRAR_DUMP) fs.writeFileSync(process.env.MIGRAR_DUMP, JSON.stringify(despejo));
console.log(`\n${APLICAR ? 'Gravado.' : 'Nada foi gravado. Rode com --aplicar para gravar.'}\n`);
