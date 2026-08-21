// scripts/gloria-fichas.mjs
// -----------------------------------------------------------------------------
// A BASE DE CONHECIMENTO DA GLÓRIA, TIRADA DA FONTE — NÃO DO SITE.
//
// POR QUE ESTE ARQUIVO EXISTE
//
// O plano original era a Glória ler o site: baixar cada LP, tirar as tags e
// gravar o texto. Isso não funciona, e o jeito como não funciona é traiçoeiro:
// as LPs são React/Vite, o HTML que o servidor entrega é uma casca vazia e o
// conteúdo só aparece depois que o navegador roda o JavaScript. Medido em
// 21/08 nas 11 páginas do sitemap: TODAS devolvem ~40 caracteres de texto.
// Nenhum preço, nenhuma data, nenhum roteiro.
//
// O workflow de carga marcaria as 11 como "página curta demais" e a Glória
// entraria em produção sabendo exatamente nada — respondendo "vou confirmar
// com o time" para toda pergunta de valor, data ou roteiro.
//
// A fonte de verdade das LPs não é o HTML: é o `src/data/expedicao.ts` de cada
// uma. Datas, faixa de investimento, incluso, não incluso, roteiro dia a dia e
// FAQ estão todos lá, estruturados. É de lá que este script monta as fichas.
//
// O CAMINHO
//
//   Setur Unificado (LPs)  ->  este script  ->  gloria_fontes (banco do QS)
//                                                     |
//                                           workflow "Glória — carregar a base"
//                                                     |
//                                           gloria_documents (com embedding)
//
// Uma ficha por SEÇÃO (resumo, investimento, incluso, roteiro, FAQ...), e não
// uma por página inteira. Dois motivos:
//
//   • O pedaço que a busca devolve chega SOZINHO no prompt. Uma seção fechada
//     ("Islândia 2027 — investimento: de R$ 40.000 a R$ 44.000") se explica; um
//     pedaço cortado no meio ("...a partir de R$ 40.000") não diz de qual
//     expedição está falando, e é assim que a IA responde o preço da viagem
//     errada com toda a confiança do mundo.
//   • Toda seção começa repetindo o nome e o ano da expedição, de propósito,
//     pelo mesmo motivo.
//
// COMO USAR
//
//   node scripts/gloria-fichas.mjs                  simula: mostra o que geraria
//   node scripts/gloria-fichas.mjs --ver=islandia   imprime uma ficha inteira
//   node scripts/gloria-fichas.mjs --apply          grava em gloria_fontes
//
// Depois de gravar, rode o workflow "Glória — carregar a base de conhecimento"
// no n8n: é ele que transforma isto em embedding (a chave da OpenAI mora lá).
//
// RODE DE NOVO toda vez que mudar preço, data ou roteiro numa LP.
//
// Precisa do .env do QS (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) e do repo
// das LPs ao lado. Caminho padrão: ../Setur Unificado, ou --setur=CAMINHO.
// -----------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = process.argv.slice(2);
const APLICAR = ARGS.includes('--apply');
const VER = (ARGS.find((a) => a.startsWith('--ver=')) || '').split('=')[1] || '';
const SETUR = path.resolve(
  (ARGS.find((a) => a.startsWith('--setur=')) || '').split('=')[1] ||
  process.env.SETUR_DIR ||
  path.join(RAIZ, '..', 'Setur Unificado'),
);

const SITE = 'https://setuforeuvouviagens.com.br';

// ── .env do QS ───────────────────────────────────────────────────────────────
const env = (() => {
  const arquivo = path.join(RAIZ, '.env');
  if (!existsSync(arquivo)) return process.env;
  const saida = { ...process.env };
  for (const linha of readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const i = linha.indexOf('=');
    if (i < 1 || linha.trim().startsWith('#')) continue;
    saida[linha.slice(0, i).trim()] ||= linha.slice(i + 1).trim();
  }
  return saida;
})();

// ── Ler um arquivo .ts de dados como se fosse um módulo ──────────────────────
//
// Os arquivos das LPs são TypeScript e importam coisas do front (ícones do
// lucide, `import.meta.env.BASE_URL`). Aqui nada disso importa: o esbuild
// converte o TS, o BASE_URL vira '/', e qualquer import externo devolve um
// objeto de mentira. O que interessa são os dados.
const importeDeMentira = new Proxy({}, { get: (_alvo, k) => (k === '__esModule' ? false : String(k)) });

function lerModulo(arquivo) {
  let fonte;
  try {
    fonte = readFileSync(arquivo, 'utf8');
  } catch {
    return null;
  }

  const tenta = (texto) => {
    const js = transformSync(texto, {
      loader: 'ts',
      format: 'cjs',
      define: { 'import.meta.env.BASE_URL': '"/"' },
    }).code;
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', js)(mod, mod.exports, () => importeDeMentira);
    return mod.exports;
  };

  try {
    return tenta(fonte);
  } catch (e) {
    // Arquivo com marca de conflito de merge ou meio editado: em vez de
    // derrubar a carga inteira por causa de uma LP, cai na última versão
    // COMMITADA — que é a que está no ar. Avisa, porque a cópia local ficou
    // para trás e alguém precisa resolver isso.
    try {
      const rel = path.relative(SETUR, arquivo).split(path.sep).join('/');
      const commitado = execFileSync('git', ['show', `HEAD:${rel}`], {
        cwd: SETUR, encoding: 'utf8', maxBuffer: 8 << 20,
      });
      console.warn(`  [!] ${rel} nao compila na copia local (${String(e.message).split('\n')[0]}).`);
      console.warn('      Usei a versao do ultimo commit. Resolva o arquivo local depois.');
      return tenta(commitado);
    } catch {
      console.warn(`  [!] nao consegui ler ${arquivo}: ${e.message}`);
      return null;
    }
  }
}

// ── Formatação ───────────────────────────────────────────────────────────────
const dinheiro = (n) =>
  typeof n === 'number' ? 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : String(n || '');
const limpo = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
const lista = (itens) => (itens || []).filter(Boolean).map((i) => `• ${limpo(i)}`).join('\n');

/** Uma seção = uma linha em gloria_fontes = (quase sempre) um pedaço na busca. */
function secao(fichas, { slug, url, titulo, nome, chave, corpo }) {
  if (!limpo(corpo)) return;
  fichas.push({
    slug,
    secao: chave,
    titulo,
    url,
    // O nome e o ano abrindo TODA seção: o pedaço precisa se explicar sozinho.
    conteudo: `${nome} — ${titulo}\n\n${String(corpo).trim()}`,
  });
}

// ── Ficha de uma EXPEDIÇÃO ───────────────────────────────────────────────────
function fichaExpedicao(slug, mod, saidas) {
  const e = mod.expedicao || {};
  const url = `${SITE}/${slug}`;
  const nome = `Expedição ${e.nome}${e.ano ? ' ' + e.ano : ''}`;
  const fichas = [];

  // Mesmo destino com mais de uma saída no catálogo (Japão & China tem duas).
  const outras = saidas.filter((s) => s.periodo && !String(e.dataRange || '').includes(String(s.periodo).split(' ')[0]));

  secao(fichas, { slug, url, nome, chave: 'resumo', titulo: 'resumo', corpo: [
    `Datas: ${e.dataRange || 'a confirmar com o time'}.`,
    e.duracaoExtenso || e.duracao ? `Duração: ${e.duracaoExtenso || e.duracao}.` : '',
    e.saida ? `Saída / encontro: ${e.saida}.` : '',
    Array.isArray(e.cidades) && e.cidades.length ? `Cidades e regiões: ${e.cidades.join(', ')}.` : '',
    e.faixaInvestimento
      ? `Investimento por pessoa: de ${dinheiro(e.faixaInvestimento.min)} a ${dinheiro(e.faixaInvestimento.max)}.`
      : '',
    e.slogan ? `Em uma frase: ${limpo(e.slogan)}` : '',
    e.mapaTrajetoTexto
      ? `Trajeto: ${limpo(e.mapaTrajetoTexto)}${e.mapaDistancia ? ` (${limpo(e.mapaDistancia)})` : ''}.`
      : '',
    `Página oficial: ${url}`,
    outras.length
      ? `Outras saídas deste destino no catálogo: ${outras.map((s) => `${s.periodo}/${s.ano} (${s.status})`).join('; ')}.`
      : '',
  ].filter(Boolean).join('\n') });

  secao(fichas, { slug, url, nome, chave: 'investimento', titulo: 'investimento', corpo: [
    e.faixaInvestimento
      ? `A faixa de investimento é de ${dinheiro(e.faixaInvestimento.min)} a ${dinheiro(e.faixaInvestimento.max)} ` +
        'por pessoa. O valor exato depende da data da reserva, da acomodação escolhida e das condições vigentes — ' +
        'quem fecha o valor é o time comercial.'
      : '',
    mod.gastosPessoais
      ? '\nAlém do pacote, os gastos pessoais estimados durante a viagem ficam entre ' +
        `${dinheiro(mod.gastosPessoais.min)} e ${dinheiro(mod.gastosPessoais.max)} por pessoa. Cobrem:\n` +
        lista(mod.gastosPessoais.inclui)
      : '',
  ].filter(Boolean).join('\n') });

  secao(fichas, { slug, url, nome, chave: 'incluso', titulo: 'o que está incluso', corpo:
    lista((mod.incluso || []).map((i) => (i.title ? `${i.title}: ${limpo(i.desc)}` : i))) +
    (Array.isArray(mod.opcoesItens) && mod.opcoesItens.length
      ? `\n\nResumo do que a expedição entrega:\n${lista(mod.opcoesItens)}`
      : '') });

  secao(fichas, { slug, url, nome, chave: 'nao-incluso', titulo: 'o que NÃO está incluso', corpo:
    lista(mod.naoIncluso) });

  secao(fichas, { slug, url, nome, chave: 'roteiro', titulo: 'roteiro dia a dia', corpo:
    (mod.roteiro || []).map((d) => {
      const cabecalho = `Dia ${d.dia}${d.data ? ` (${d.data})` : ''} — ${limpo(d.cidade)}: ${limpo(d.titulo)}`;
      const atividades = (d.atividades || []).map((a) => `  · ${limpo(a)}`).join('\n');
      return cabecalho + (atividades ? '\n' + atividades : '') + (d.logistica ? `\n  Logística: ${limpo(d.logistica)}` : '');
    }).join('\n') });

  secao(fichas, { slug, url, nome, chave: 'faq', titulo: 'perguntas frequentes', corpo:
    (mod.faq || []).map((q) => `P: ${limpo(q.q)}\nR: ${limpo(q.a)}`).join('\n\n') });

  if (mod.porQue) {
    secao(fichas, { slug, url, nome, chave: 'por-que-com-a-agencia', titulo: 'por que ir com a agência', corpo:
      `O que pesa em fazer este destino por conta própria:\n${lista(mod.porQue.sozinho)}\n\n` +
      `O que muda indo com a Se Tu For, Eu Vou:\n${lista(mod.porQue.conosco)}` });
  }

  if (e.tudoResolvidoDescricao) {
    secao(fichas, { slug, url, nome, chave: 'contexto-do-destino', titulo: 'contexto do destino', corpo:
      `${limpo(e.tudoResolvidoDescricao)} ${limpo(e.tudoResolvidoDestaque)}` +
      (e.roteiroDescricao ? `\n\n${limpo(e.roteiroDescricao)}` : '') +
      (e.mapaDescricao ? `\n\nA rota: ${limpo(e.mapaDescricao)}` : '') });
  }

  return fichas;
}

// ── Ficha de um PACOTE ───────────────────────────────────────────────────────
// Pacote tem outro formato de dados: valor único em vez de faixa, formas de
// pagamento, e NENHUMA data no arquivo. A ficha diz isso com todas as letras —
// data que a IA não tem é data que ela não pode inventar.
function fichaPacote(slug, mod, doPortal) {
  const e = mod.expedicao || {};
  const url = `${SITE}/${slug}`;
  const nome = `Pacote ${e.nome}`;
  const fichas = [];
  const inv = mod.investimento;

  secao(fichas, { slug, url, nome, chave: 'resumo', titulo: 'resumo', corpo: [
    e.local ? `Onde: ${e.local}.` : '',
    doPortal?.duracao ? `Duração: ${doPortal.duracao}.` : (e.duracaoLegenda ? limpo(e.duracaoLegenda) : ''),
    inv ? `Investimento: ${limpo(inv.prefixo)} ${inv.moeda} ${inv.valor} ${limpo(inv.unidade)}.` : '',
    'Datas: este é um roteiro com saídas em datas marcadas. A data disponível é confirmada pelo time comercial.',
    e.slogan ? `Em uma frase: ${limpo(e.slogan)}` : '',
    doPortal?.resumo ? limpo(doPortal.resumo) : '',
    `Página oficial: ${url}`,
  ].filter(Boolean).join('\n') });

  secao(fichas, { slug, url, nome, chave: 'investimento', titulo: 'investimento e pagamento', corpo: [
    inv ? `${limpo(inv.prefixo)} ${inv.moeda} ${inv.valor} ${limpo(inv.unidade)}. ${limpo(inv.nota)}` : '',
    Array.isArray(mod.pagamentos) && mod.pagamentos.length
      ? `\nFormas de pagamento:\n${lista(mod.pagamentos.map((p) => `${p.titulo}: ${limpo(p.detalhe)}`))}`
      : '',
  ].filter(Boolean).join('\n') });

  secao(fichas, { slug, url, nome, chave: 'incluso', titulo: 'o que está incluso', corpo:
    lista((mod.incluso || []).map((i) => (i.title ? `${i.title}: ${limpo(i.desc)}` : i))) });

  secao(fichas, { slug, url, nome, chave: 'nao-incluso', titulo: 'o que NÃO está incluso', corpo:
    lista(mod.naoIncluso) });

  secao(fichas, { slug, url, nome, chave: 'roteiro', titulo: 'roteiro dia a dia', corpo:
    (mod.roteiro || []).map((d) => {
      const cabecalho = `Dia ${d.dia} — ${limpo(d.cidade)}: ${limpo(d.titulo)}`;
      const atividades = (d.atividades || []).map((a) => `  · ${limpo(a)}`).join('\n');
      return cabecalho + (atividades ? '\n' + atividades : '');
    }).join('\n') });

  return fichas;
}

// ── A ficha da agência (o que não é de nenhuma expedição) ────────────────────
function fichaAgencia(home, catalogo) {
  const url = `${SITE}/`;
  const nome = 'Se Tu For, Eu Vou! Viagens e Expedições';
  const fichas = [];
  const sobre = home?.sobreNos;

  secao(fichas, { slug: 'agencia', url, nome, chave: 'sobre', titulo: 'sobre a agência', corpo: [
    sobre?.paragrafo ? limpo(sobre.paragrafo) : '',
    sobre?.frase ? `Como a gente resume: "${limpo(sobre.frase)}"` : '',
    'Expedições são viagens em grupo pequeno, com tudo resolvido: roteiro, hospedagem, traslados e um líder ' +
    'brasileiro acompanhando do início ao fim.',
    'Pacotes são roteiros prontos, com data marcada — é escolher e embarcar.',
    `Instagram: ${(home?.redesSociais || []).find((r) => /instagram/i.test(r.label))?.href || '@setuforeuvouviagens'}`,
  ].filter(Boolean).join('\n') });

  const ativas = catalogo.filter((c) => c.status === 'ativa');
  const esgotadas = catalogo.filter((c) => c.status === 'esgotada');

  secao(fichas, { slug: 'agencia', url, nome, chave: 'catalogo', titulo: 'expedições e pacotes com vagas abertas', corpo:
    'Estas são as saídas com vagas abertas hoje:\n' +
    lista(ativas.map((c) =>
      `${c.destino} — ${c.periodo}/${c.ano}${c.dias ? ` · ${c.dias} dias` : ''}` +
      `${String(c.link || '').startsWith('/') ? ` · ${SITE}${c.link}` : ''}`)) +
    (esgotadas.length
      ? '\n\nJá saíram e estão ESGOTADAS (não ofereça estas datas; se o lead perguntar, diga que a turma fechou ' +
        'e ofereça a saída aberta do mesmo destino):\n' +
        lista(esgotadas.map((c) => `${c.destino} — ${c.periodo}/${c.ano}`))
      : '') });

  return fichas;
}

// ── Montagem ─────────────────────────────────────────────────────────────────
function montar() {
  if (!existsSync(SETUR)) {
    console.error(`Nao achei o repo das LPs em ${SETUR}`);
    console.error('Use --setur=CAMINHO ou SETUR_DIR=...');
    process.exit(1);
  }
  console.log(`LPs em: ${SETUR}\n`);

  const home = lerModulo(path.join(SETUR, 'portal/src/data/home.ts')) || {};
  const catalogo = (lerModulo(path.join(SETUR, 'portal/src/data/expedicoes.ts')) || {}).expedicoes || [];

  const fichas = [...fichaAgencia(home, catalogo)];

  // O que está à venda vem do CATÁLOGO DO PORTAL, não do sitemap.xml — o
  // sitemap está desatualizado (não lista /japao, /china, /italia nem
  // /cancun-xcaret, todas no ar e linkadas na home).
  const porSlug = new Map();
  for (const c of catalogo) {
    if (c.status !== 'ativa' || !String(c.link || '').startsWith('/')) continue;
    const slug = c.link.slice(1).replace(/\/.*$/, '');
    if (!porSlug.has(slug)) porSlug.set(slug, []);
    porSlug.get(slug).push(c);
  }

  for (const [slug, saidas] of porSlug) {
    const arquivo = path.join(SETUR, 'expedicoes', slug, 'src/data/expedicao.ts');
    if (!existsSync(arquivo)) { console.warn(`  [!] sem dados para /${slug}`); continue; }
    const mod = lerModulo(arquivo);
    if (!mod?.expedicao) { console.warn(`  [!] /${slug} nao trouxe dados`); continue; }
    fichas.push(...fichaExpedicao(slug, mod, saidas));
  }

  for (const pacote of home.pacotes || []) {
    if (pacote.placeholder || !String(pacote.link || '').startsWith('/')) continue;
    const slug = pacote.link.slice(1);
    const arquivo = path.join(SETUR, 'pacotes', slug, 'src/data/expedicao.ts');
    if (!existsSync(arquivo)) { console.warn(`  [!] sem dados para o pacote /${slug}`); continue; }
    const mod = lerModulo(arquivo);
    if (!mod?.expedicao) { console.warn(`  [!] pacote /${slug} nao trouxe dados`); continue; }
    fichas.push(...fichaPacote(slug, mod, pacote));
  }

  return fichas;
}

async function gravar(fichas) {
  const url = env.SUPABASE_URL;
  const chave = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.error('\nFaltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  const cabecalho = { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' };

  // Upsert por (slug, secao): rodar de novo ATUALIZA a ficha em vez de empilhar
  // uma segunda cópia — que é como a IA passaria a ver o preço velho e o novo
  // com a mesma confiança.
  const r = await fetch(`${url}/rest/v1/gloria_fontes?on_conflict=slug,secao`, {
    method: 'POST',
    headers: { ...cabecalho, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(fichas.map((f) => ({ ...f, ativo: true, atualizada_em: new Date().toISOString() }))),
  });
  if (!r.ok) {
    const texto = await r.text();
    if (/gloria_fontes/.test(texto) && /does not exist|schema cache/i.test(texto)) {
      console.error('\nA tabela gloria_fontes nao existe ainda.');
      console.error('Cole supabase/migrations/0059_gloria_pronta.sql no SQL Editor do Supabase e rode de novo.');
      process.exit(1);
    }
    console.error(`\nFalhou (${r.status}): ${texto}`);
    process.exit(1);
  }

  // Ficha que sumiu da fonte (expedição esgotada, pacote tirado do ar) é
  // DESLIGADA, não apagada: some da base da IA e continua no histórico.
  const chaves = new Set(fichas.map((f) => `${f.slug}|${f.secao}`));
  const atuais = await fetch(`${url}/rest/v1/gloria_fontes?select=id,slug,secao,ativo`, { headers: cabecalho })
    .then((x) => x.json());
  for (const linha of (atuais || []).filter((a) => a.ativo && !chaves.has(`${a.slug}|${a.secao}`))) {
    await fetch(`${url}/rest/v1/gloria_fontes?id=eq.${linha.id}`, {
      method: 'PATCH',
      headers: { ...cabecalho, Prefer: 'return=minimal' },
      body: JSON.stringify({ ativo: false }),
    });
    console.log(`  desligada: ${linha.slug}/${linha.secao}`);
  }

  console.log(`\nOK: ${fichas.length} secoes gravadas em gloria_fontes.`);
  console.log('Agora rode o workflow "Gloria — carregar a base de conhecimento" no n8n.');
}

const fichas = montar();

const contagem = new Map();
for (const f of fichas) {
  const atual = contagem.get(f.slug) || { secoes: 0, chars: 0 };
  contagem.set(f.slug, { secoes: atual.secoes + 1, chars: atual.chars + f.conteudo.length });
}
console.log(`${fichas.length} secoes, ${contagem.size} paginas:\n`);
for (const [slug, n] of [...contagem].sort()) {
  console.log(`  ${slug.padEnd(20)} ${String(n.secoes).padStart(2)} secoes  ${String(n.chars).padStart(6)} caracteres`);
}

if (VER) {
  console.log(`\n${'-'.repeat(72)}`);
  for (const f of fichas.filter((x) => x.slug === VER)) console.log(`\n${f.conteudo}\n${'-'.repeat(72)}`);
}

if (APLICAR) {
  await gravar(fichas);
} else {
  console.log('\nSimulacao. Nada foi gravado. Rode com --apply para gravar em gloria_fontes.');
  console.log('Para ler uma ficha inteira antes: --ver=islandia');
}
