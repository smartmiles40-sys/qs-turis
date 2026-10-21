// src/expedicoes/paginas/PassageirosGlobal.tsx
// Passageiros — base consolidada / "Clube de viajantes" (app antigo:
// app/(app)/passageiros/ — PassageirosGlobalTabela, ViajanteCard, lib/data/pessoas.ts,
// lib/fidelidade.ts). Pessoa = todas as linhas `passageiros` com a mesma identidade
// (CPF → Bitrix → e-mail → nome). Visão Clube (cards com nível de fidelidade) ou
// Lista (tabela com filtro/ordem por coluna, estilo Excel). Novo passageiro avulso,
// importar CSV (várias expedições), exportar .xlsx, perfil com edição que vale pra
// todas as expedições, documentos, senha do ExpedAmigo (admin) e excluir.
// Diferença boa: lê a base inteira paginada (o antigo cortava em 1000 passageiros).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao, Campo, Entrada, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Carregando, Gaveta, Selo, useAoVivo } from "../ui";
import { lerPorIds, listarExpedicoes } from "../lib/banco";
import { listPessoas, type PessoaAgregada } from "../lib/pessoas";
import { nivelFidelidade } from "../lib/fidelidade";
import { mascaraCpf } from "../lib/cpf";
import { formatDate } from "../lib/utils";
import type { ArquivoRow, ExpedicaoRow } from "../lib/database";
import { FotoAvatar, Pilula, useLinksDeArquivos } from "./_globais/pecas";
import { exportarPassageirosXlsx, idadeDe } from "./_globais/excel";
import { ListaExpedicoes, PessoaGaveta } from "./_globais/PessoaGaveta";
import { ImportarCsvGlobal } from "./_globais/ImportarCsvGlobal";
import { criarPassageiroAvulso } from "./_globais/pessoaAcoes";

type Coluna = {
  key: string; label: string; tipo: "text" | "num"; centro?: boolean;
  ordem: (p: PessoaAgregada) => string | number; texto: (p: PessoaAgregada) => string;
};
const COLUNAS: Coluna[] = [
  { key: "nome", label: "Nome", tipo: "text", ordem: (p) => p.nome_completo, texto: (p) => p.nome_completo },
  { key: "cpf", label: "CPF", tipo: "text", ordem: (p) => p.cpf ?? "", texto: (p) => p.cpf ?? "" },
  { key: "idade", label: "Idade", tipo: "num", centro: true, ordem: (p) => idadeDe(p.data_nascimento) ?? -1, texto: (p) => { const i = idadeDe(p.data_nascimento); return i != null ? String(i) : ""; } },
  { key: "passaporte", label: "Passaporte", tipo: "text", ordem: (p) => p.passaporte ?? "", texto: (p) => p.passaporte ?? "" },
  { key: "validade", label: "Validade", tipo: "text", ordem: (p) => p.validade_passaporte ?? "", texto: (p) => (p.validade_passaporte ? formatDate(p.validade_passaporte) : "") },
  { key: "email", label: "E-mail", tipo: "text", ordem: (p) => p.email ?? "", texto: (p) => p.email ?? "" },
  { key: "telefone", label: "Telefone", tipo: "text", ordem: (p) => p.telefone ?? "", texto: (p) => p.telefone ?? "" },
  { key: "expedicoes", label: "Expedições", tipo: "num", centro: true, ordem: (p) => p.totalExpedicoes, texto: (p) => String(p.totalExpedicoes) },
];

export default function PassageirosGlobal() {
  const { somenteLeitura, ir, avisar } = useExp();
  const [pessoas, setPessoas] = useState<PessoaAgregada[] | null>(null);
  const [expedicoes, setExpedicoes] = useState<ExpedicaoRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [visao, setVisao] = useState<"clube" | "lista">("clube");
  const [ordemCol, setOrdemCol] = useState("nome");
  const [ordemDir, setOrdemDir] = useState<"asc" | "desc">("asc");
  const [filtrosCol, setFiltrosCol] = useState<Record<string, string>>({});
  const [abertaChave, setAbertaChave] = useState<string | null>(null);
  const [arquivosAberta, setArquivosAberta] = useState<ArquivoRow[]>([]);
  const [expedicoesDe, setExpedicoesDe] = useState<PessoaAgregada | null>(null);
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);
  const [exportando, setExportando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [ps, exps] = await Promise.all([listPessoas(), listarExpedicoes()]);
      setPessoas(ps); setExpedicoes(exps); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros" }], carregar, 1500);

  // A pessoa aberta é procurada pela chave a cada recarga (pega os dados novos depois de salvar).
  const aberta = useMemo(() => (abertaChave ? pessoas?.find((p) => p.chave === abertaChave) ?? null : null), [pessoas, abertaChave]);
  const idsAberta = aberta?.idsPassageiros.join(",") ?? "";
  const carregarArquivos = useCallback(async () => {
    if (!idsAberta) { setArquivosAberta([]); return; }
    try { setArquivosAberta(await lerPorIds<ArquivoRow>("arquivos", "passageiro_id", idsAberta.split(","))); } catch { setArquivosAberta([]); }
  }, [idsAberta]);
  useEffect(() => { void carregarArquivos(); }, [carregarArquivos]);

  const tipoExp = useMemo(() => new Map(expedicoes.map((e) => [e.id, e.tipo])), [expedicoes]);
  const abrirExp = (expId: string, paxId?: string) =>
    ir(tipoExp.get(expId) === "pacote" ? "pacotes" : "expedicoes", paxId ? `${expId}/passageiros/pax/${paxId}` : `${expId}/passageiros`);

  const termo = busca.trim().toLowerCase();
  const algumFiltro = termo.length > 0 || Object.values(filtrosCol).some((v) => v.trim());
  const ordenadas = useMemo(() => {
    let arr = pessoas ?? [];
    if (termo) arr = arr.filter((p) => [p.nome_completo, p.cpf ?? "", p.email ?? "", p.passaporte ?? ""].join(" ").toLowerCase().includes(termo));
    for (const [k, v] of Object.entries(filtrosCol)) {
      const t = v.trim().toLowerCase();
      const c = COLUNAS.find((x) => x.key === k);
      if (t && c) arr = arr.filter((p) => c.texto(p).toLowerCase().includes(t));
    }
    const c = COLUNAS.find((x) => x.key === ordemCol) ?? COLUNAS[0];
    const dir = ordemDir === "desc" ? -1 : 1;
    return [...arr].sort((a, b) => c.tipo === "num"
      ? (Number(c.ordem(a)) - Number(c.ordem(b))) * dir
      : String(c.ordem(a)).localeCompare(String(c.ordem(b)), "pt-BR", { sensitivity: "base" }) * dir);
  }, [pessoas, termo, filtrosCol, ordemCol, ordemDir]);

  const fotos = useLinksDeArquivos((pessoas ?? []).map((p) => p.foto_arquivo_id));
  const lista = pessoas ?? [];
  const participacoes = lista.reduce((s, p) => s + p.totalExpedicoes, 0);

  const exportar = async () => {
    if (ordenadas.length === 0) { avisar("Nada para exportar — nenhum passageiro com os filtros atuais.", "erro"); return; }
    setExportando(true);
    try { await exportarPassageirosXlsx(ordenadas); avisar(`${ordenadas.length} passageiro${ordenadas.length === 1 ? "" : "s"} exportado${ordenadas.length === 1 ? "" : "s"} (.xlsx)`); }
    catch { avisar("Falha ao gerar o arquivo", "erro"); }
    finally { setExportando(false); }
  };

  const filtroProps = (c: Coluna) => ({
    col: c, ordemCol, ordemDir, filtro: filtrosCol[c.key] ?? "",
    onOrdem: (d: "asc" | "desc") => { setOrdemCol(c.key); setOrdemDir(d); },
    onFiltro: (v: string) => setFiltrosCol((s) => ({ ...s, [c.key]: v })),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Passageiros</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Base consolidada de todos os passageiros — dados pessoais e histórico de expedições.
            {pessoas && ` ${lista.length} pessoa${lista.length === 1 ? "" : "s"} · ${participacoes} participaç${participacoes === 1 ? "ão" : "ões"} em expedições.`}
          </p>
        </div>
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--line)" }} role="group" aria-label="Visão">
          {(["clube", "lista"] as const).map((v) => (
            <button key={v} onClick={() => setVisao(v)} aria-pressed={visao === v} className="px-3 py-1.5 text-[12.5px] font-semibold"
              style={{ background: visao === v ? "var(--rel-soft)" : "var(--card)", color: visao === v ? "var(--rel-ink)" : "var(--ink2)" }}>
              {v === "clube" ? "Clube" : "Lista"}
            </button>
          ))}
        </div>
        {!somenteLeitura && <>
          <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo passageiro</Botao>
          <Botao onClick={() => setImportar(true)}>⬆ Importar CSV</Botao>
        </>}
        <Botao onClick={exportar} disabled={exportando || lista.length === 0} title="Exporta os passageiros filtrados (.xlsx) com dados pessoais e expedições">{exportando ? "Exportando…" : "⬇ Exportar"}</Botao>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] max-w-md">
          <input type="search" className="rel-input" placeholder="Buscar por nome, CPF, e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {algumFiltro && <button className="text-[12.5px] hover:underline" style={{ color: "var(--ink3)" }} onClick={() => { setBusca(""); setFiltrosCol({}); }}>Limpar filtros</button>}
      </div>

      {lista.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Pilula rotulo="pessoas na base" valor={lista.length} cor="#2563EB" />
          <Pilula rotulo="já viajaram" valor={lista.filter((p) => p.totalExpedicoes > 0).length} cor="#16A34A" />
          <Pilula rotulo="participações" valor={participacoes} cor="#7C3AED" />
          <Pilula rotulo="sem CPF" valor={lista.filter((p) => !p.cpf).length} cor="#EA580C" />
        </div>
      )}

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!pessoas ? <Carregando /> : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio titulo={visao === "clube" ? "Seu clube de viajantes começa aqui" : "Sua base de pessoas começa aqui"}
            texto={visao === "clube"
              ? "Toda pessoa que viaja com a agência entra no clube, com perfil, saúde e nível de fidelidade. Cadastre a primeira."
              : "Toda pessoa que viaja com a agência fica aqui, com perfil, saúde e histórico de expedições. Cadastre a primeira."}
            acao={!somenteLeitura ? <Botao variante="primario" onClick={() => setNovo(true)}>Novo passageiro</Botao> : undefined} />
        </div>
      ) : visao === "clube" ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}>Filtrar / ordenar:</span>
            {COLUNAS.map((c) => <ColunaFiltro key={c.key} {...filtroProps(c)} />)}
          </div>
          {ordenadas.length === 0 ? <SemResultado /> : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
              {ordenadas.map((p) => <CardViajante key={p.chave} pessoa={p} foto={p.foto_arquivo_id ? fotos[p.foto_arquivo_id] : null} onAbrir={() => setAbertaChave(p.chave)} />)}
            </div>
          )}
        </>
      ) : (
        <div className="rel-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ color: "var(--ink3)" }}>
                {COLUNAS.map((c) => <th key={c.key} className={`px-2 py-1.5 font-semibold ${c.centro ? "text-center" : "text-left"}`}><ColunaFiltro {...filtroProps(c)} /></th>)}
              </tr>
            </thead>
            <tbody>
              {ordenadas.length === 0 ? (
                <tr><td colSpan={COLUNAS.length} className="py-8 text-center" style={{ color: "var(--ink3)" }}>Nenhum resultado para a busca.</td></tr>
              ) : ordenadas.map((p) => {
                const idade = idadeDe(p.data_nascimento);
                return (
                  <tr key={p.chave} onClick={() => setAbertaChave(p.chave)} title="Abrir perfil do passageiro" className="border-t rel-linha cursor-pointer" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 font-semibold" style={{ color: "var(--rel-ink)" }}>
                        <FotoAvatar nome={p.nome_completo} url={p.foto_arquivo_id ? fotos[p.foto_arquivo_id] : null} tamanho={24} />{p.nome_completo}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[12px]" style={{ color: "var(--ink2)" }}>{p.cpf ?? "—"}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{idade ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-[12px]">{p.passaporte ?? <span style={{ color: "var(--ink3)" }}>—</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums" style={{ color: "var(--ink2)" }}>{p.validade_passaporte ? formatDate(p.validade_passaporte) : "—"}</td>
                    <td className="px-3 py-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>{p.email ?? "—"}</td>
                    <td className="px-3 py-1.5 text-[12px] whitespace-nowrap" style={{ color: "var(--ink2)" }}>{p.telefone ?? "—"}</td>
                    <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <button type="button" disabled={p.totalExpedicoes === 0} onClick={() => setExpedicoesDe(p)} title={p.totalExpedicoes > 0 ? "Ver as expedições desta pessoa" : "Sem expedições"} className="disabled:opacity-60 disabled:cursor-default">
                        <Selo tom={p.totalExpedicoes > 0 ? "lista" : "neutro"}>✈ {p.totalExpedicoes}</Selo>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {aberta && (
        <PessoaGaveta key={aberta.chave} pessoa={aberta} arquivos={arquivosAberta} fotoUrl={aberta.foto_arquivo_id ? fotos[aberta.foto_arquivo_id] : null}
          onFechar={() => setAbertaChave(null)} onMudou={() => { void carregar(); void carregarArquivos(); }} abrirExp={abrirExp} />
      )}

      <Gaveta aberta={!!expedicoesDe} titulo={expedicoesDe?.nome_completo ?? ""} onFechar={() => setExpedicoesDe(null)}
        subtitulo={expedicoesDe ? `${expedicoesDe.expedicoes.length} expediç${expedicoesDe.expedicoes.length === 1 ? "ão" : "ões"} — clique para abrir.` : undefined}
        rodape={<Botao onClick={() => setExpedicoesDe(null)}>Fechar</Botao>}>
        {expedicoesDe && <ListaExpedicoes pessoa={expedicoesDe} abrirExp={abrirExp} />}
      </Gaveta>

      <NovoPassageiro aberta={novo} onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void carregar(); }} />
      <ImportarCsvGlobal aberta={importar} expedicoes={expedicoes} onFechar={() => setImportar(false)} onImportou={() => void carregar()} />
    </div>
  );
}

function SemResultado() {
  return <div className="rounded-2xl border border-dashed py-12 text-center text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>Nenhum resultado para a busca.</div>;
}

/** Card de membro do clube: nível, nº de viagens, progresso até o próximo marco (3ª/5ª/10ª) e selos. */
function CardViajante({ pessoa, foto, onAbrir }: { pessoa: PessoaAgregada; foto?: string | null; onAbrir: () => void }) {
  const n = pessoa.totalExpedicoes;
  const { tier, conquistados, proximo, faltam, progresso } = nivelFidelidade(n);
  return (
    <button type="button" onClick={onAbrir} className="rel-card overflow-hidden text-left transition-transform hover:-translate-y-0.5">
      <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: "linear-gradient(135deg, #1F2937, #B45309)" }}>
        <FotoAvatar nome={pessoa.nome_completo} url={foto} tamanho={44} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold leading-tight truncate">{pessoa.nome_completo}</div>
          <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "#FDE68A" }}>{tier}</div>
        </div>
        <div className="text-center flex-shrink-0">
          <div className="text-[24px] font-bold leading-none tabular-nums">{n}</div>
          <div className="text-[9.5px] uppercase tracking-wide opacity-70">{n === 1 ? "viagem" : "viagens"}</div>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2.5">
        {proximo != null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11.5px]">
              <span style={{ color: "var(--ink3)" }}>Próximo marco: <b style={{ color: "var(--ink)" }}>{proximo}ª viagem</b></span>
              <span className="font-bold" style={{ color: "var(--ink)" }}>faltam {faltam}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(progresso * 100)}%`, background: "#B45309" }} />
            </div>
          </div>
        ) : <div className="text-[12.5px] font-bold" style={{ color: "var(--ink)" }}>🏆 Lenda — 10+ viagens com a gente</div>}
        {conquistados.length > 0 ? (
          <div className="flex flex-wrap gap-1">{conquistados.map((m) => <Selo key={m} tom="aviso">★ {m}ª</Selo>)}</div>
        ) : <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>✈ {n === 0 ? "Ainda sem viagens" : "Caminho para o 1º marco"}</div>}
        {(pessoa.cpf || pessoa.telefone) && (
          <div className="flex items-center gap-3 pt-2 border-t text-[11.5px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>
            {pessoa.cpf && <span className="font-mono">{pessoa.cpf}</span>}
            {pessoa.telefone && <span className="truncate">{pessoa.telefone}</span>}
          </div>
        )}
      </div>
    </button>
  );
}

/** Filtro + ordem de uma coluna (estilo AutoFiltro do Excel). */
function ColunaFiltro({ col, ordemCol, ordemDir, onOrdem, filtro, onFiltro }: {
  col: Coluna; ordemCol: string; ordemDir: "asc" | "desc"; onOrdem: (d: "asc" | "desc") => void; filtro: string; onFiltro: (v: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ativo = ordemCol === col.key || filtro.trim().length > 0;
  const botaoOrdem = (d: "asc" | "desc", rot: string) => (
    <button type="button" onClick={() => onOrdem(d)} aria-pressed={ordemCol === col.key && ordemDir === d}
      className="flex-1 rounded-md px-2 py-1 text-[12px] border font-semibold"
      style={ordemCol === col.key && ordemDir === d ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{rot}</button>
  );
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold border"
        style={ativo ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "transparent" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
        {col.label}{ordemCol === col.key ? (ordemDir === "asc" ? " ↑" : " ↓") : ""} ▾
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAberto(false)} />
          <div className={`absolute z-30 mt-1 w-56 rounded-xl p-2 shadow-lg space-y-1.5 text-left ${col.centro ? "right-0" : "left-0"}`} style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <div className="flex gap-1">
              {botaoOrdem("asc", col.tipo === "num" ? "Menor → maior" : "A → Z")}
              {botaoOrdem("desc", col.tipo === "num" ? "Maior → menor" : "Z → A")}
            </div>
            <input autoFocus value={filtro} onChange={(e) => onFiltro(e.target.value)} placeholder={`Filtrar ${col.label.toLowerCase()}…`} className="rel-input" style={{ padding: "4px 8px", fontSize: 12 }} />
            {filtro.trim().length > 0 && <button type="button" onClick={() => onFiltro("")} className="text-[11.5px] hover:underline" style={{ color: "var(--ink3)" }}>Limpar filtro</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** Cadastro de pessoa na base, sem expedição (dá pra alocar depois em "Adicionar existente"). */
function NovoPassageiro({ aberta, onFechar, onCriado }: { aberta: boolean; onFechar: () => void; onCriado: () => void }) {
  const { avisar } = useExp();
  const vazio = { nome_completo: "", cpf: "", data_nascimento: "", passaporte: "", validade_passaporte: "", email: "", telefone: "" };
  const [f, setF] = useState(vazio);
  const [erros, setErros] = useState<{ nome?: string; email?: string }>({});
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberta) { setF(vazio); setErros({}); } }, [aberta]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof vazio, v: string) => setF((s) => ({ ...s, [k]: v }));

  const salvar = async () => {
    const e: { nome?: string; email?: string } = {};
    if (f.nome_completo.trim().length < 2) e.nome = "Mínimo 2 caracteres";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "E-mail inválido";
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    try {
      const t = (s: string) => s.trim() || null;
      await criarPassageiroAvulso({
        nome_completo: f.nome_completo, cpf: t(f.cpf), data_nascimento: t(f.data_nascimento), passaporte: t(f.passaporte),
        validade_passaporte: t(f.validade_passaporte), email: t(f.email), telefone: t(f.telefone),
      });
      avisar("Passageiro cadastrado na base — sem expedição, aloque a uma quando quiser.");
      onCriado();
    } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao cadastrar", "erro"); }
    finally { setSalvando(false); }
  };

  return (
    <Gaveta aberta={aberta} titulo="Novo passageiro" onFechar={onFechar} largura={520}
      subtitulo="Cadastra uma pessoa na base sem vincular a nenhuma expedição. Você pode alocá-la depois, pelo botão “Adicionar existente” dentro da expedição."
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Cadastrar"}</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Nome completo" erro={erros.nome}><Entrada autoFocus value={f.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="CPF"><Entrada placeholder="Opcional" inputMode="numeric" value={f.cpf} onChange={(e) => set("cpf", mascaraCpf(e.target.value))} /></Campo>
          <Campo rotulo="Nascimento"><Entrada type="date" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Passaporte"><Entrada value={f.passaporte} onChange={(e) => set("passaporte", e.target.value)} /></Campo>
          <Campo rotulo="Validade passaporte"><Entrada type="date" value={f.validade_passaporte} onChange={(e) => set("validade_passaporte", e.target.value)} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="E-mail" erro={erros.email}><Entrada type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
          <Campo rotulo="Telefone"><Entrada value={f.telefone} onChange={(e) => set("telefone", e.target.value)} /></Campo>
        </div>
        <p className="rounded-lg border p-2.5 text-[11.5px]" style={{ borderColor: "var(--line)", background: "var(--card2)", color: "var(--ink3)" }}>
          Dica: informar o <b style={{ color: "var(--ink)" }}>CPF</b> evita duplicar a pessoa quando ela for importada ou adicionada a uma expedição.
        </p>
      </div>
    </Gaveta>
  );
}
