// api/_expEspelho.js
// -----------------------------------------------------------------------------
// ESPELHO AO VIVO: Sistema de Expedições ANTIGO (bnbpsuenlokhljrkvlke) → QS.
// Chamado por GET /api/expedicoes?acao=espelho (cron a cada 5 min, 0317).
//
// O antigo segue sendo a fonte enquanto o time valida as telas do QS. Aqui:
//   · lê o antigo SÓ com GET (PostgREST + Storage); NUNCA escreve nele;
//   · por tabela, puxa o que mudou desde o cursor (updated_at, ou created_at nas
//     que só recebem inserções), em páginas com desempate pela chave;
//   · aplica no QS pela RPC exp_espelho_aplicar (service_role), que liga
//     exp.espelho → os gatilhos de efeito colateral ficam quietos (ver 0317);
//   · manda SÓ as colunas que o antigo tem: as colunas que só o QS tem ficam intactas;
//   · copia os arquivos novos do Storage (30 por rodada);
//   · 1x por hora compara os ids e apaga no QS o que sumiu do antigo
//     (só linhas que vieram do antigo; nunca as criadas direto no QS).
//
// Envs: EXP_ESPELHO_LIGADO=1 (sem ela não faz nada), EXPEDICOES_SECRET_KEY
// (sb_secret_... do antigo: só no header apikey), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Além da env, a flag do banco (ops_config 'exp_espelho'.ligado) tem que estar true.
// -----------------------------------------------------------------------------

export const ORIGEM_URL = 'https://bnbpsuenlokhljrkvlke.supabase.co';
export const BUCKET = 'arquivos-expedicoes';
const SOBREPOSICAO_S = 120;          // relê os últimos 2 min (transação que gravou atrasada)
const ARQUIVOS_POR_RODADA = 30;
const LIMPEZA_A_CADA_MS = 60 * 60 * 1000;
const PRAZO_PADRAO_MS = 45_000;       // a função tem maxDuration 60 s

// Ordem = pais antes de filhos. modo: 'updated_at' | 'created_at' (só inserem) | 'inteira'.
// adiar: colunas que apontam pra uma tabela que vem DEPOIS (ou pra ela mesma) —
// entram num 2º passo, depois de garantir que a linha apontada existe no QS.
// usuarios: colunas com id de usuário (o id muda no QS, pelo e-mail).
// geradas: colunas GENERATED (não se escreve nelas).
export const TABELAS = [
  { nome: 'usuarios', modo: 'updated_at', usuarios: ['id'], apagar: false },
  { nome: 'fornecedores', modo: 'updated_at' },
  { nome: 'requisitos_destino', modo: 'updated_at' },
  { nome: 'cambios', modo: 'inteira', pk: 'moeda', apagar: false },
  { nome: 'compras_bitrix', modo: 'updated_at' },
  { nome: 'acesso_senhas', modo: 'updated_at', pk: 'cpf' },
  { nome: 'expedicoes', modo: 'updated_at', usuarios: ['responsavel_operacional_id', 'responsavel_comercial_id'],
    adiar: { hospedagem_voucher_arquivo_id: 'arquivos' } },
  { nome: 'grupos_expedicao', modo: 'updated_at' },
  { nome: 'extensoes', modo: 'updated_at', adiar: { hospedagem_voucher_arquivo_id: 'arquivos' } },
  { nome: 'quartos', modo: 'updated_at' },
  { nome: 'roteiro_dias', modo: 'updated_at' },
  { nome: 'roteiro_lider_dias', modo: 'updated_at' },
  { nome: 'passageiros', modo: 'updated_at', geradas: ['saldo_brl'],
    adiar: { foto_arquivo_id: 'arquivos', passaporte_arquivo_id: 'arquivos' } },
  { nome: 'arquivos', modo: 'updated_at', usuarios: ['uploaded_by'] },
  { nome: 'documentos', modo: 'updated_at' },
  { nome: 'passageiro_quarto', modo: 'inteira' },
  { nome: 'passageiro_extensao', modo: 'inteira' },
  { nome: 'passageiro_requisitos', modo: 'updated_at', usuarios: ['responsavel_id', 'verificado_por'] },
  { nome: 'checklist_itens', modo: 'updated_at', usuarios: ['responsavel_id'],
    adiar: { parent_id: 'checklist_itens', dependencia_id: 'checklist_itens' } },
  { nome: 'custos', modo: 'updated_at', usuarios: ['pago_por'], geradas: ['valor_planejado_brl'] },
  { nome: 'pagamentos', modo: 'updated_at', geradas: ['saldo'] },
  { nome: 'expedicao_avisos', modo: 'updated_at' },
  { nome: 'expedicao_info', modo: 'updated_at' },
  { nome: 'expedicao_passeios', modo: 'updated_at' },
  { nome: 'expedicao_voos', modo: 'updated_at' },
  { nome: 'links_expedicao', modo: 'updated_at' },
  { nome: 'passeios_opcionais', modo: 'updated_at' },
  { nome: 'passeio_opcional_compras', modo: 'inteira' },
  { nome: 'roteiro_dia_fotos', modo: 'updated_at' },
  { nome: 'inscricoes_pendentes', modo: 'updated_at' },
  { nome: 'inscricoes_decisoes', modo: 'created_at', usuarios: ['decidido_por'], apagar: false },
  { nome: 'acesso_links', modo: 'inteira' },
  { nome: 'expedamigo_acessos', modo: 'created_at', apagar: false },
  { nome: 'audit_log', modo: 'created_at', usuarios: ['usuario_id'], apagar: false, lote: 250 },
].map((t) => ({ pk: 'id', apagar: true, lote: 1000, usuarios: [], geradas: [], adiar: {}, ...t }));

export const TABELA = Object.fromEntries(TABELAS.map((t) => [t.nome, t]));

// ── Funções puras (testadas em tests/expedicoes/espelho.test.ts) ────────────

const enc = encodeURIComponent;
/** Valor dentro de um filtro lógico do PostgREST: entre aspas, com " e \ escapados. */
const aspas = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Campo de ordem/cursor da tabela (null nas que vêm inteiras). */
export function campoCursor(cfg) {
  return cfg.modo === 'inteira' ? null : cfg.modo;
}

/**
 * Filtro de "depois do cursor" com desempate pela chave:
 *   campo > ts  OU  (campo = ts E pk > id).
 * Sem id (cursor recuado pela sobreposição): campo >= ts.
 */
export function filtroCursor(campo, pk, cursor) {
  if (!cursor || !cursor.ts) return '';
  if (!cursor.id) return `${campo}=gte.${enc(cursor.ts)}`;
  return `or=${enc(`(${campo}.gt.${aspas(cursor.ts)},and(${campo}.eq.${aspas(cursor.ts)},${pk}.gt.${aspas(cursor.id)}))`)}`;
}

/** Caminho (depois de /rest/v1/) de uma página do antigo. */
export function caminhoPagina(cfg, cursor, lote = cfg.lote) {
  const campo = campoCursor(cfg);
  const partes = [`select=*`];
  if (campo) {
    partes.push(`order=${campo}.asc,${cfg.pk}.asc`);
    const f = filtroCursor(campo, cfg.pk, cursor);
    if (f) partes.push(f);
  } else {
    partes.push(`order=${cfg.pk}.asc`);
    if (cursor?.id) partes.push(`${cfg.pk}=gt.${enc(cursor.id)}`);
  }
  partes.push(`limit=${lote}`);
  return `${cfg.nome}?${partes.join('&')}`;
}

/** Cursor depois de uma página: a última linha (ordem campo, pk). */
export function proximoCursor(linhas, campo, pk) {
  if (!linhas.length) return null;
  const u = linhas[linhas.length - 1];
  return { ts: u[campo] ?? null, id: u[pk] == null ? null : String(u[pk]) };
}

/** Início da leitura: o cursor salvo recuado SOBREPOSICAO_S (sem id → >=). Seco: sem recuo. */
export function inicioLeitura(salvo, { seco = false, sobreposicaoS = SOBREPOSICAO_S } = {}) {
  if (!salvo || !salvo.ts) return null;
  if (seco) return { ts: salvo.ts, id: salvo.id || null };
  const ms = Date.parse(salvo.ts);
  if (Number.isNaN(ms)) return { ts: salvo.ts, id: salvo.id || null };
  return { ts: new Date(ms - sobreposicaoS * 1000).toISOString(), id: null };
}

/** O cursor só anda pra frente (a sobreposição relê linhas antigas). */
export function maiorCursor(a, b) {
  if (!a || !a.ts) return b || null;
  if (!b || !b.ts) return a;
  const ta = Date.parse(a.ts), tb = Date.parse(b.ts);
  if (ta !== tb) return tb > ta ? b : a;
  // mesmo milissegundo: compara o texto (microssegundos) e depois o id
  if (a.ts !== b.ts) return String(b.ts) > String(a.ts) ? b : a;
  return String(b.id ?? '') > String(a.id ?? '') ? b : a;
}

/** Colunas a mandar: as chaves que vieram do antigo, menos geradas e menos as excluídas. */
export function colunasDaOrigem(linhas, { geradas = [], excluir = [] } = {}) {
  const fora = new Set([...geradas, ...excluir]);
  const cols = new Set();
  for (const l of linhas) for (const k of Object.keys(l)) if (!fora.has(k)) cols.add(k);
  return [...cols];
}

/** Tira colunas geradas (o PostgREST do antigo devolve, mas não se escreve nelas). */
export function semGeradas(linhas, geradas = []) {
  if (!geradas.length) return linhas;
  return linhas.map((l) => {
    const c = { ...l };
    for (const g of geradas) delete c[g];
    return c;
  });
}

/** Troca ids de usuário do antigo pelos do QS (mapa antigo→QS). Sem par: mantém. */
export function remaparUsuarios(linhas, colunas, mapa) {
  if (!colunas?.length || !mapa?.size) return linhas;
  return linhas.map((l) => {
    let c = l;
    for (const col of colunas) {
      const v = l[col];
      if (v && mapa.has(v) && mapa.get(v) !== v) {
        if (c === l) c = { ...l };
        c[col] = mapa.get(v);
      }
    }
    return c;
  });
}

/** Só a chave + as colunas adiadas (2º passo). */
export function soColunas(linhas, colunas) {
  return linhas.map((l) => Object.fromEntries(colunas.filter((c) => c in l).map((c) => [c, l[c]])));
}

/** Ids distintos (não nulos) referenciados pelas colunas. */
export function idsReferenciados(linhas, colunas) {
  const s = new Set();
  for (const l of linhas) for (const c of colunas) if (l[c] != null && l[c] !== '') s.add(String(l[c]));
  return [...s];
}

/** O que sumiu do antigo: vindos-do-antigo (QS) que não estão mais no antigo. */
export function idsParaApagar(vistosNoQs, idsNoAntigo) {
  const ainda = new Set(idsNoAntigo.map(String));
  return vistosNoQs.map(String).filter((id) => !ainda.has(id));
}

/**
 * Trava de segurança: se o antigo "sumiu" com muita coisa de uma vez (leitura
 * vazia, chave errada, tabela truncada), não apaga — devolve o motivo.
 */
export function apagarDemais(qtdApagar, qtdVistos, { minimo = 20, fracao = 0.2 } = {}) {
  if (qtdApagar <= minimo) return null;
  if (qtdApagar > Math.max(minimo, Math.floor(qtdVistos * fracao))) {
    return `apagaria ${qtdApagar} de ${qtdVistos} — parado por segurança, conferir à mão`;
  }
  return null;
}

/** Hora da limpeza de apagados? */
export function horaDeLimpar(ultimaLimpezaIso, agoraMs, aCadaMs = LIMPEZA_A_CADA_MS) {
  if (!ultimaLimpezaIso) return true;
  const t = Date.parse(ultimaLimpezaIso);
  return Number.isNaN(t) || agoraMs - t >= aCadaMs;
}

/** Remove linhas repetidas pela chave (a última vence). */
export function semRepetidas(linhas, pk) {
  const m = new Map();
  for (const l of linhas) m.set(String(l[pk]), l);
  return [...m.values()];
}

/** Lista em pedaços. */
export function pedacos(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

/** Caminho do Storage codificado por segmento. */
export const codCaminho = (p) => String(p).split('/').map(encodeURIComponent).join('/');

// ── Rede ────────────────────────────────────────────────────────────────────

const cabecalhos = (chave, extra = {}) => ({
  apikey: chave,
  // chave nova (sb_secret_/sb_publishable_) vai SÓ no apikey; JWT antigo vai também no Bearer
  ...(String(chave).startsWith('sb_') ? {} : { Authorization: `Bearer ${chave}` }),
  ...extra,
});

function alvos(env = process.env) {
  const origemChave = String(env.EXPEDICOES_SECRET_KEY || '').trim();
  const qsUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const qsChave = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return {
    origem: { url: ORIGEM_URL, chave: origemChave, soLeitura: true },
    qs: { url: qsUrl, chave: qsChave, soLeitura: false },
  };
}

/** fetch com prazo e 2 novas tentativas em 5xx/429. No antigo, só GET. */
async function pedir(alvo, caminho, { method = 'GET', headers = {}, body, timeoutMs = 25_000, cru = false, fetchImpl = fetch } = {}) {
  if (alvo.soLeitura && method !== 'GET') throw new Error(`Bloqueado: o espelho nunca escreve no antigo (${method} ${caminho})`);
  for (let tentativa = 1; ; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetchImpl(alvo.url + caminho, {
        method, headers: cabecalhos(alvo.chave, headers), body, signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (tentativa >= 3) throw new Error(`${method} ${caminho.slice(0, 120)} → ${e?.name === 'AbortError' ? 'sem resposta' : e?.message}`);
      continue;
    }
    clearTimeout(timer);
    if (r.ok) {
      if (cru) return r;
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    }
    const txt = await r.text().catch(() => '');
    if (tentativa >= 3 || (r.status < 500 && r.status !== 429)) {
      throw new Error(`${method} ${caminho.slice(0, 120)} → ${r.status} ${txt.slice(0, 300)}`);
    }
    await new Promise((ok) => setTimeout(ok, 800 * tentativa));
  }
}

const rpc = (ctx, nome, args) => pedir(ctx.qs, `/rest/v1/rpc/${nome}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), fetchImpl: ctx.fetchImpl,
});

/** Lê do antigo todas as linhas com chave em `ids` (em pedaços). */
async function lerPorIds(ctx, cfg, ids) {
  const out = [];
  for (const p of pedacos(ids, 100)) {
    const lista = p.map((v) => aspas(v)).join(',');
    out.push(...await pedir(ctx.origem, `/rest/v1/${cfg.nome}?select=*&${cfg.pk}=in.${enc(`(${lista})`)}`, { fetchImpl: ctx.fetchImpl }));
  }
  return out;
}

/** Quais desses ids já existem no QS. */
async function existentesNoQs(ctx, tabela, pk, ids) {
  const s = new Set();
  for (const p of pedacos(ids, 100)) {
    const lista = p.map((v) => aspas(v)).join(',');
    const r = await pedir(ctx.qs, `/rest/v1/${tabela}?select=${pk}&${pk}=in.${enc(`(${lista})`)}`, { fetchImpl: ctx.fetchImpl });
    for (const l of r || []) s.add(String(l[pk]));
  }
  return s;
}

/** Todos os valores de uma coluna (paginado por ela mesma; teto de 1000 do PostgREST). */
async function todosOsIds(ctx, alvo, caminhoBase, col) {
  const out = [];
  let depois = null;
  for (;;) {
    const filtro = depois == null ? '' : `&${col}=gt.${enc(depois)}`;
    const r = await pedir(alvo, `/rest/v1/${caminhoBase}${caminhoBase.includes('?') ? '&' : '?'}select=${col}&order=${col}.asc&limit=1000${filtro}`, { fetchImpl: ctx.fetchImpl });
    for (const l of r) out.push(String(l[col]));
    if (r.length < 1000) return out;
    depois = r[r.length - 1][col];
  }
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

/** Prepara linhas do antigo pro QS: tira geradas e troca ids de usuário. */
function preparar(ctx, cfg, linhas) {
  return remaparUsuarios(semGeradas(linhas, cfg.geradas), cfg.usuarios, ctx.mapaUsuarios);
}

/**
 * Upsert de um lote no QS. Colunas adiadas vão num 2º passo, depois de garantir
 * que a linha apontada existe no QS (busca no antigo e aplica antes, se faltar).
 */
async function aplicarLote(ctx, cfg, linhasCruas, profundidade = 0) {
  if (!linhasCruas.length) return 0;
  const linhas = semRepetidas(preparar(ctx, cfg, linhasCruas), cfg.pk);
  const adiadas = Object.keys(cfg.adiar);
  const cols = colunasDaOrigem(linhas, { excluir: adiadas });
  let aplicadas = 0;
  for (const p of pedacos(linhas, cfg.lote)) {
    const r = await rpc(ctx, 'exp_espelho_aplicar', { p_tabela: cfg.nome, p_linhas: p, p_colunas: cols });
    aplicadas += Number(r?.aplicadas || 0);
    ctx.res.arquivos_na_fila += Number(r?.arquivos_na_fila || 0);
  }
  if (!adiadas.length) return aplicadas;

  // 2º passo: garante as linhas apontadas e grava as colunas adiadas.
  try {
    const porTabela = {};
    for (const [col, ref] of Object.entries(cfg.adiar)) (porTabela[ref] ||= []).push(col);
    for (const [ref, colsRef] of Object.entries(porTabela)) {
      const cfgRef = TABELA[ref];
      const ids = idsReferenciados(linhas, colsRef);
      if (!ids.length) continue;
      const tem = await existentesNoQs(ctx, ref, cfgRef.pk, ids);
      const faltam = ids.filter((id) => !tem.has(id));
      if (!faltam.length) continue;
      if (profundidade >= 3) throw new Error(`${ref}: referências encadeadas demais`);
      const vindas = await lerPorIds(ctx, cfgRef, faltam);
      await aplicarLote(ctx, cfgRef, vindas, profundidade + 1);
    }
    const colsAdiadas = [cfg.pk, ...adiadas];
    for (const p of pedacos(soColunas(linhas, colsAdiadas), cfg.lote)) {
      await rpc(ctx, 'exp_espelho_aplicar', { p_tabela: cfg.nome, p_linhas: p, p_colunas: colsAdiadas });
    }
  } catch (e) {
    // Não trava o cursor (senão um arquivo problemático pararia a tabela pra sempre):
    // a coluna adiada fica velha até a linha mudar de novo no antigo.
    ctx.res.avisos.push(`${cfg.nome}: colunas ${adiadas.join(', ')} não completaram: ${e.message}`);
  }
  return aplicadas;
}

async function salvarEstado(ctx, tabela, campos) {
  if (ctx.seco) return;
  await pedir(ctx.qs, '/rest/v1/exp_espelho_estado?on_conflict=tabela', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ tabela, ...campos }]),
    fetchImpl: ctx.fetchImpl,
  });
}

/** Tabela por cursor: páginas até acabar ou o prazo apertar. Devolve true se terminou. */
async function puxarIncremental(ctx, cfg, r) {
  const campo = campoCursor(cfg);
  const salvo = ctx.estado[cfg.nome];
  const salvoCursor = salvo?.cursor_ts ? { ts: salvo.cursor_ts, id: salvo.cursor_id } : null;
  let leitura = inicioLeitura(salvoCursor, { seco: ctx.seco });
  let guardado = salvoCursor;
  let total = Number(salvo?.linhas_total || 0);
  for (;;) {
    if (ctx.semTempo()) return false;
    const linhas = await pedir(ctx.origem, `/rest/v1/${caminhoPagina(cfg, leitura)}`, { fetchImpl: ctx.fetchImpl });
    r.lidas += linhas.length;
    if (linhas.length) {
      if (!ctx.seco) r.aplicadas += await aplicarLote(ctx, cfg, linhas);
      leitura = proximoCursor(linhas, campo, cfg.pk);
      guardado = maiorCursor(guardado, leitura);
      total += linhas.length;
      await salvarEstado(ctx, cfg.nome, {
        cursor_ts: guardado?.ts ?? null, cursor_id: guardado?.id ?? null, linhas_total: total,
        ultima_leva_em: new Date().toISOString(), ultimo_erro: null,
      });
    }
    if (linhas.length < cfg.lote) return true;
  }
}

/** Tabela pequena sem updated_at: lê inteira, aplica e já apaga o que sumiu. */
async function puxarInteira(ctx, cfg, r) {
  const todas = [];
  let cursor = null;
  for (;;) {
    if (ctx.semTempo()) return false;
    const linhas = await pedir(ctx.origem, `/rest/v1/${caminhoPagina(cfg, cursor)}`, { fetchImpl: ctx.fetchImpl });
    todas.push(...linhas);
    if (linhas.length < cfg.lote) break;
    cursor = { id: String(linhas[linhas.length - 1][cfg.pk]) };
  }
  r.lidas += todas.length;
  if (!ctx.seco) {
    r.aplicadas += await aplicarLote(ctx, cfg, todas);
    await salvarEstado(ctx, cfg.nome, { linhas_total: todas.length, ultima_leva_em: new Date().toISOString(), ultimo_erro: null });
  }
  // Rooming (passageiro_quarto) muda apagando/criando: limpeza a cada rodada, não de hora em hora.
  if (cfg.apagar) await apagarSumidos(ctx, cfg, r, todas.map((l) => String(l[cfg.pk])));
  return true;
}

/** Apaga no QS o que veio do antigo e não está mais lá. */
async function apagarSumidos(ctx, cfg, r, idsNoAntigo) {
  const ids = idsNoAntigo ?? await todosOsIds(ctx, ctx.origem, cfg.nome, cfg.pk);
  const vistos = await todosOsIds(ctx, ctx.qs, `exp_espelho_ids?tabela=eq.${enc(cfg.nome)}`, 'id');
  const apagar = idsParaApagar(vistos, ids);
  if (!apagar.length) return;
  const trava = apagarDemais(apagar.length, vistos.length);
  if (trava) { r.avisos = [...(r.avisos || []), trava]; return; }
  r.apagar = (r.apagar || 0) + apagar.length;
  if (ctx.seco) return;
  for (const p of pedacos(apagar, 200)) {
    const res = await rpc(ctx, 'exp_espelho_apagar', { p_tabela: cfg.nome, p_ids: p });
    r.apagadas = (r.apagadas || 0) + Number(res?.apagadas || 0);
    for (const f of res?.falhas || []) ctx.res.avisos.push(`${cfg.nome} ${f.id} não saiu do QS: ${f.erro}`);
  }
}

/** Copia do Storage do antigo pro QS os arquivos na fila (até ARQUIVOS_POR_RODADA). */
async function copiarArquivos(ctx) {
  const pend = await pedir(ctx.qs,
    `/rest/v1/exp_espelho_storage?select=caminho,bucket,tentativas&copiado_em=is.null&tentativas=lt.5&order=criado_em.asc&limit=${ARQUIVOS_POR_RODADA}`,
    { fetchImpl: ctx.fetchImpl });
  const out = { pendentes_lidos: pend.length, copiados: 0, erros: 0 };
  if (ctx.seco) return out;
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < pend.length && !ctx.semTempo()) {
      const a = pend[i++];
      const caminho = `/storage/v1/object/${a.bucket}/${codCaminho(a.caminho)}`;
      const marca = `/rest/v1/exp_espelho_storage?caminho=eq.${enc(a.caminho)}`;
      try {
        const r = await pedir(ctx.origem, caminho, { cru: true, timeoutMs: 20_000, fetchImpl: ctx.fetchImpl });
        const tipo = r.headers.get('content-type') || 'application/octet-stream';
        const corpo = Buffer.from(await r.arrayBuffer());
        await pedir(ctx.qs, caminho, {
          method: 'POST', headers: { 'Content-Type': tipo, 'x-upsert': 'true', 'cache-control': '3600' },
          body: corpo, timeoutMs: 20_000, cru: true, fetchImpl: ctx.fetchImpl,
        });
        await pedir(ctx.qs, marca, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ copiado_em: new Date().toISOString(), erro: null }), fetchImpl: ctx.fetchImpl,
        });
        out.copiados++;
      } catch (e) {
        out.erros++;
        await pedir(ctx.qs, marca, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ tentativas: Number(a.tentativas || 0) + 1, erro: String(e.message).slice(0, 500) }),
          fetchImpl: ctx.fetchImpl,
        }).catch(() => {});
      }
    }
  }));
  return out;
}

/** Mapa usuário do antigo → usuário do QS (pelo e-mail). */
async function montarMapaUsuarios(ctx) {
  const antigos = await pedir(ctx.origem, '/rest/v1/usuarios?select=id,email&limit=1000', { fetchImpl: ctx.fetchImpl });
  const emails = antigos.map((u) => String(u.email || '').toLowerCase()).filter(Boolean);
  const pares = emails.length ? await rpc(ctx, 'exp_espelho_mapa_usuarios', { p_emails: emails }) : [];
  const porEmail = new Map((pares || []).filter((p) => p.id).map((p) => [p.email, p.id]));
  const mapa = new Map();
  for (const u of antigos) {
    const qs = porEmail.get(String(u.email || '').toLowerCase());
    if (qs) mapa.set(u.id, qs);
  }
  return mapa;
}

// ── Rodada ──────────────────────────────────────────────────────────────────

/**
 * Uma rodada do espelho. `seco` = só conta (lidas desde o cursor, a apagar,
 * arquivos na fila), sem escrever nada em lugar nenhum.
 */
export async function rodarEspelho({ seco = false, limpar = false, prazoMs = PRAZO_PADRAO_MS, env = process.env, fetchImpl = fetch } = {}) {
  const inicio = Date.now();
  if (String(env.EXP_ESPELHO_LIGADO || '').trim() !== '1') {
    return { ok: true, desligado: true, motivo: 'EXP_ESPELHO_LIGADO não é 1 — nada feito.' };
  }
  const { origem, qs } = alvos(env);
  if (!origem.chave) return { ok: false, error: 'Falta EXPEDICOES_SECRET_KEY.' };
  if (!qs.url || !qs.chave) return { ok: false, error: 'Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' };

  const res = { ok: true, seco, tabelas: {}, avisos: [], arquivos_na_fila: 0 };
  const ctx = { origem, qs, seco, fetchImpl, res, estado: {}, mapaUsuarios: new Map(),
    semTempo: () => Date.now() - inicio > prazoMs };

  const flag = await pedir(qs, '/rest/v1/ops_config?select=valor&chave=eq.exp_espelho', { fetchImpl });
  const valor = flag?.[0]?.valor || {};
  if (valor.ligado !== true) {
    return { ok: true, desligado: true, motivo: "ops_config 'exp_espelho'.ligado não é true — nada feito." };
  }

  const estado = await pedir(qs, '/rest/v1/exp_espelho_estado?select=*', { fetchImpl });
  ctx.estado = Object.fromEntries((estado || []).map((e) => [e.tabela, e]));
  ctx.mapaUsuarios = await montarMapaUsuarios(ctx);

  // 1. Linhas
  let completo = true;
  for (const cfg of TABELAS) {
    if (ctx.semTempo()) { completo = false; res.parou_em = cfg.nome; break; }
    const r = { lidas: 0, aplicadas: 0 };
    res.tabelas[cfg.nome] = r;
    try {
      const terminou = cfg.modo === 'inteira' ? await puxarInteira(ctx, cfg, r) : await puxarIncremental(ctx, cfg, r);
      if (!terminou) { completo = false; res.parou_em = cfg.nome; break; }
    } catch (e) {
      completo = false;
      r.erro = e.message;
      await salvarEstado(ctx, cfg.nome, { ultimo_erro: String(e.message).slice(0, 1000), ultimo_erro_em: new Date().toISOString() })
        .catch(() => {});
    }
  }

  // 2. Arquivos do Storage
  if (!ctx.semTempo()) {
    try { res.arquivos = await copiarArquivos(ctx); } catch (e) { res.arquivos = { erro: e.message }; }
  }

  // 3. Apagados (de hora em hora, só com a rodada completa e sem erro)
  const agora = Date.now();
  if (completo && (limpar || horaDeLimpar(valor.limpeza_em, agora))) {
    let limpou = true;
    for (const cfg of [...TABELAS].reverse()) {
      if (!cfg.apagar || cfg.modo === 'inteira') continue;
      if (ctx.semTempo()) { limpou = false; break; }
      const r = res.tabelas[cfg.nome];
      try { await apagarSumidos(ctx, cfg, r); } catch (e) { limpou = false; r.erro_limpeza = e.message; }
    }
    res.limpeza = limpou ? 'feita' : 'incompleta';
    if (limpou && !seco) await rpc(ctx, 'exp_espelho_registrar', { p_info: { limpeza_em: new Date().toISOString() } }).catch(() => {});
  }

  const algumErro = Object.values(res.tabelas).some((t) => t.erro);
  res.completo = completo && !algumErro;
  if (!seco) {
    const info = { rodada_em: new Date().toISOString(), rodada_ok: res.completo };
    if (res.completo) info.sincronizado_em = info.rodada_em;
    await rpc(ctx, 'exp_espelho_registrar', { p_info: info }).catch(() => {});
  }
  res.ms = Date.now() - inicio;
  return res;
}
