// src/expedicoes/passageiros/PainelPassageiros.tsx
// Aba Passageiros da expedição (app antigo: passageiros/page.tsx + PassageirosTabela.tsx).
// Planilha com edição na própria célula, busca e filtros (status/tipo/formulário
// pendente), KPIs, Líderes separados, divisão G1/G2 (admin), quarto do 1º trecho,
// prontidão por passageiro, criar/puxar da base/importar CSV e exportar .xlsx.
// Endereços: …/passageiros/pax/<id> (gaveta do pax), …/pax/<id>/perfil (página
// completa) e …/passageiros/prontidao/<id> (gaveta de prontidão).
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Botao, Vazio } from "@/rel/ui";
import { BotaoExcluir, Busca, Carregando, CelulaEditavel, CelulaEscolha, Selo, useAoVivo } from "../ui";
import { useExp } from "../contexto";
import { STATUS_RESERVA, TIPO_PASSAGEIRO } from "../lib/constants";
import { cpfValido } from "../lib/cpf";
import { aniversarioNaViagem, daysUntil, formatDate } from "../lib/utils";
import { conferirAcompanhante } from "../lib/rooming/acompanhante";
import { construirPosicoesFidelidade } from "../lib/fidelidade";
import { chaveIdentidade, listPessoas, type PessoaAgregada } from "../lib/pessoas";
import { esquecer } from "../lib/cache";
import type { ExpedicaoComAgregados, PassageiroRow, StatusReserva, TipoPassageiro } from "../lib/database";
import {
  alocarNoTrecho, ativarDivisao, atualizarPassageiro, capacidade, carregarAba, definirGrupoDoPax, preencheuFormulario, prontidaoDe,
  removerDivisao, resumoSyncBitrix, sincronizarDoBitrix, souAdmin, trechosDe, usaDivisao, type DadosAba,
} from "./dados";
import { exportarPassageiros } from "./exportar";
import { AdicionarExistente, ImportarPassageiros, NovoPassageiro } from "./Criar";
import EditarPassageiro from "./EditarPassageiro";
import PerfilPax from "./PerfilPax";
import { GavetaProntidao } from "./Prontidao";
import { FotoPax, SeloFidelidade, SeloProntidao, SeloSemFicha, SeloStatus, SeloTipo } from "./pecas";

type Col = "id" | "nome" | "tipo" | "grupo" | "cpf" | "passaporte" | "validade" | "quarto" | "status" | "prontidao";
const ORDEM_PRONT = { Apto: 0, Atenção: 1, Bloqueado: 2 } as const;

export default function PainelPassageiros({ exp, sub, onMudou }: { exp: ExpedicaoComAgregados; sub: string[]; onMudou: () => void }) {
  const { ir, somenteLeitura, avisar } = useExp();
  const tela = exp.tipo === "pacote" ? "pacotes" : "expedicoes";
  const irSub = useCallback((resto?: string) => ir(tela, `${exp.id}/passageiros${resto ? `/${resto}` : ""}`), [ir, tela, exp.id]);

  const [dados, setDados] = useState<DadosAba | null>(null);
  const [pessoas, setPessoas] = useState<PessoaAgregada[] | null>(null);
  const [admin, setAdmin] = useState(false);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState<StatusReserva | null>(null);
  const [fTipo, setFTipo] = useState<TipoPassageiro | null>(null);
  const [soPendentes, setSoPendentes] = useState(false);
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 } | null>(null);
  const [criar, setCriar] = useState<"novo" | "existente" | "importar" | null>(null);
  const [exportando, setExportando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;
  const carregar = useCallback(async () => {
    try { setDados(await carregarAba(exp.id)); } catch (e) { avisarRef.current(e instanceof Error ? e.message : "Erro ao carregar", "erro"); }
  }, [exp.id]);
  const recarregar = useCallback(() => { void carregar(); onMudou(); }, [carregar, onMudou]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { souAdmin().then(setAdmin).catch(() => setAdmin(false)); }, []);
  // Base de pessoas (só pra "Nª viagem"): leitura guardada que outras telas também
  // usam. Ao abrir aproveita; depois de criar/importar/mover, derruba e lê fresco.
  const carregarPessoas = useCallback((fresco = true) => {
    if (fresco) esquecer("passageiros");
    listPessoas().then(setPessoas).catch(() => setPessoas([]));
  }, []);
  useEffect(() => { carregarPessoas(false); }, [carregarPessoas]);
  useAoVivo([
    { tabela: "passageiros", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "arquivos", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "grupos_expedicao", filtro: `expedicao_id=eq.${exp.id}` },
    { tabela: "quartos", filtro: `expedicao_id=eq.${exp.id}` },
  ], () => void carregar(), 400);
  // Sem expedicao_id nessas duas (não dá pra filtrar no realtime): espera de 2 s,
  // pra edição em OUTRA expedição não refazer a planilha inteira a cada clique.
  useAoVivo([{ tabela: "passageiro_requisitos" }, { tabela: "passageiro_quarto" }], () => void carregar(), 2000);

  const pront = useMemo(() => (dados ? prontidaoDe(exp, dados.pax, dados.requisitos).resultado : new Map()), [dados, exp]);
  const posicoes = useMemo(() => (pessoas ? construirPosicoesFidelidade(pessoas, exp.id) : {}), [pessoas, exp.id]);
  const indice = useMemo(() => {
    const m = new Map<string, number>();
    [...(dados?.pax ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [dados]);
  const trechos = useMemo(() => trechosDe(dados?.quartos ?? []), [dados]);
  const grupos = dados?.grupos ?? [];
  const usaGrupos = usaDivisao(grupos);
  const g1 = grupos.find((g) => g.nome === "G1"); const g2 = grupos.find((g) => g.nome === "G2");
  const nomeGrupo = (p: PassageiroRow) => (p.grupo_id ? grupos.find((g) => g.id === p.grupo_id)?.nome ?? null : null);

  const quartosDoPax = useCallback((paxId: string) => {
    if (!dados) return [];
    const ids = new Set(dados.alocacoes.filter((a) => a.passageiro_id === paxId).map((a) => a.quarto_id));
    return dados.quartos.filter((q) => ids.has(q.id)).sort((a, b) => (a.check_in ?? "").localeCompare(b.check_in ?? ""));
  }, [dados]);

  const filtrados = useMemo(() => {
    if (!dados) return [];
    const t = busca.trim().toLowerCase();
    return dados.pax.filter((p) =>
      (!t || `${p.nome_completo} ${p.cpf ?? ""} ${p.passaporte ?? ""}`.toLowerCase().includes(t))
      && (!fStatus || p.status_reserva === fStatus) && (!fTipo || p.tipo === fTipo) && (!soPendentes || !preencheuFormulario(p)));
  }, [dados, busca, fStatus, fTipo, soPendentes]);

  const ordenados = useMemo(() => {
    const val = (p: PassageiroRow, c: Col): string | number => {
      switch (c) {
        case "id": return indice.get(p.id) ?? 0;
        case "nome": return p.nome_completo.toLowerCase();
        case "tipo": return p.tipo;
        case "grupo": { const n = nomeGrupo(p); return n === "G1" ? 0 : n === "G2" ? 1 : 2; }
        case "cpf": return (p.cpf ?? "").replace(/\D/g, "");
        case "passaporte": return (p.passaporte ?? "").toLowerCase();
        case "validade": return p.validade_passaporte ?? "9999-99-99";
        case "quarto": { const q = quartosDoPax(p.id)[0]; return q ? Number(q.numero) || Number.MAX_SAFE_INTEGER - 1 : Number.MAX_SAFE_INTEGER; }
        case "status": return STATUS_RESERVA.indexOf(p.status_reserva);
        case "prontidao": { const r = pront.get(p.id); return r ? ORDEM_PRONT[r.prontidao as keyof typeof ORDEM_PRONT] : 4; }
      }
    };
    const desempate = (a: PassageiroRow, b: PassageiroRow) => (indice.get(a.id) ?? 0) - (indice.get(b.id) ?? 0);
    const col: Col | null = sort?.col ?? (usaGrupos ? "grupo" : null);
    const dir = sort?.dir ?? 1;
    return [...filtrados].sort((a, b) => {
      if (!col) return desempate(a, b);
      const va = val(a, col), vb = val(b, col);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return c * dir || desempate(a, b);
    });
  }, [filtrados, sort, usaGrupos, indice, pront, quartosDoPax]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── endereço: pax / perfil / prontidão
  const [modo, alvoId, extra] = sub;
  const alvo = alvoId ? dados?.pax.find((p) => p.id === alvoId) : undefined;

  if (!dados) return <Carregando />;

  if (modo === "pax" && extra === "perfil" && alvo) {
    return <PerfilPax exp={exp} pax={alvo} dados={dados} posicao={posicoes[alvo.id]} admin={admin} onMudou={recarregar}
      onVoltar={() => irSub()} onEditar={() => irSub(`pax/${alvo.id}`)} />;
  }

  const kpi = {
    total: dados.pax.length,
    confirmados: dados.pax.filter((p) => p.status_reserva === "Confirmado").length,
    pre: dados.pax.filter((p) => p.status_reserva === "Pré-reserva").length,
    leads: dados.pax.filter((p) => p.status_reserva === "Lead").length,
    aptos: [...pront.values()].filter((r) => r.prontidao === "Apto").length,
    atencao: [...pront.values()].filter((r) => r.prontidao === "Atenção").length,
    bloq: [...pront.values()].filter((r) => r.prontidao === "Bloqueado").length,
    pendForm: dados.pax.filter((p) => !preencheuFormulario(p)).length,
  };
  const lideres = ordenados.filter((p) => p.tipo === "Líder");
  const demais = ordenados.filter((p) => p.tipo !== "Líder");
  const temLider = dados.pax.some((p) => p.tipo === "Líder");
  const agrupado = usaGrupos && (!sort || sort.col === "grupo");
  const primeiro = trechos[0];
  const cpfsExp = new Set(dados.pax.map((p) => (p.cpf ?? "").replace(/\D/g, "")).filter((c) => c.length === 11));

  const salvarCampo = (p: PassageiroRow, campo: keyof PassageiroRow) => async (v: string | number | null) => {
    if (campo === "cpf" && v && !cpfValido(String(v))) throw new Error("CPF inválido — confira os números.");
    await atualizarPassageiro(p.id, { [campo]: v == null ? null : String(v) } as Partial<PassageiroRow>);
    void carregar();
  };

  const Th = ({ col, children, className = "" }: { col: Col; children: React.ReactNode; className?: string }) => (
    <th className={`text-left px-2 py-2 font-semibold whitespace-nowrap ${className}`}>
      <button className="inline-flex items-center gap-1" onClick={() => setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))}>
        {children}<span style={{ opacity: sort?.col === col ? 1 : 0.25 }}>{sort?.col === col && sort.dir === -1 ? "▼" : "▲"}</span>
      </button>
    </th>
  );

  const celulaQuarto = (p: PassageiroRow) => {
    const meus = quartosDoPax(p.id);
    const atual = primeiro ? meus.find((q) => primeiro.quartos.some((x) => x.id === q.id)) : undefined;
    const idsMeus = new Set(meus.map((q) => q.id));
    const companheiros = [...new Set(dados.alocacoes.filter((a) => idsMeus.has(a.quarto_id) && a.passageiro_id !== p.id)
      .map((a) => dados.pax.find((x) => x.id === a.passageiro_id)?.nome_completo).filter((n): n is string => !!n))];
    const outros = meus.length - (atual ? 1 : 0);
    const conf = meus.length ? conferirAcompanhante(p.acompanhante_nome, companheiros) : "sem_indicacao";
    const ocup = (qid: string) => dados.alocacoes.filter((a) => a.quarto_id === qid).length;
    return (
      <div className="min-w-[170px]">
        {!somenteLeitura && primeiro?.quartos.length ? (
          <select className="rel-input" style={{ padding: "3px 6px", fontSize: 12 }} value={atual?.id ?? ""} aria-label="Quarto"
            onChange={async (e) => {
              try { await alocarNoTrecho(p.id, primeiro, e.target.value || null); void carregar(); }
              catch (er) { avisar(er instanceof Error ? er.message : "Erro", "erro"); }
            }}>
            <option value="">— sem quarto —</option>
            {primeiro.quartos.map((q) => {
              const lotado = ocup(q.id) >= capacidade(q.tipo) && q.id !== atual?.id;
              return <option key={q.id} value={q.id} disabled={lotado}>Quarto {q.numero} ({q.tipo}) · {ocup(q.id)}/{capacidade(q.tipo)}{lotado ? " · lotado" : ""}</option>;
            })}
          </select>
        ) : meus.length ? (
          <span title={meus.map((q) => `${q.hotel_cidade || "Hotel"}: Quarto ${q.numero} (${q.tipo})`).join(" · ")}>Quarto {meus[0].numero}{meus.length > 1 ? ` +${meus.length - 1}` : ""}</span>
        ) : <span style={{ color: "var(--ink3)" }}>{p.acompanhante_nome ? `Indicou: ${p.acompanhante_nome}` : "Viaja sozinho"}</span>}
        {companheiros.length > 0 && <p className="text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>com {companheiros.join(", ")}</p>}
        {outros > 0 && primeiro?.quartos.length ? <p className="text-[11px]" style={{ color: "var(--ink3)" }}>+{outros} em outro hotel</p> : null}
        {p.acompanhante_nome && meus.length > 0 && (
          <p className="text-[11px]" style={{ color: conf === "bate" ? "#166534" : conf === "nao_bate" ? "#C2410C" : "var(--ink3)" }}
            title={conf === "nao_bate" ? "O acompanhante indicado NÃO está neste quarto" : undefined}>
            {conf === "bate" ? "✓" : conf === "nao_bate" ? "⚠" : ""} indicou: {p.acompanhante_nome}
          </p>
        )}
      </div>
    );
  };

  const linha = (p: PassageiroRow) => {
    const r = pront.get(p.id);
    const aniv = aniversarioNaViagem(p.data_nascimento, exp.data_embarque, exp.data_retorno);
    const venceCedo = p.validade_passaporte && exp.data_embarque
      ? (daysUntil(p.validade_passaporte) ?? 0) - (daysUntil(exp.data_embarque) ?? 0) < 180 : false;
    const g = nomeGrupo(p);
    return (
      <tr key={p.id} className="border-t align-top rel-linha" style={{ borderColor: "var(--line)" }}>
        <td className="px-2 py-2 font-mono text-[11.5px]" style={{ color: "var(--ink3)" }}>#{String(indice.get(p.id) ?? 0).padStart(3, "0")}</td>
        <td className="px-2 py-2 min-w-[220px]">
          <div className="flex items-center gap-2">
            <FotoPax nome={p.nome_completo} url={p.foto_arquivo_id ? dados.fotos[p.foto_arquivo_id] : null} />
            <div className="min-w-0">
              <button className="text-left font-semibold hover:underline" style={{ color: "var(--ink)" }} onClick={() => irSub(`pax/${p.id}`)}>{p.nome_completo}</button>
              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                <SeloFidelidade posicao={posicoes[p.id]} />
                <SeloSemFicha pax={p} />
                {aniv && <Selo tom="aviso" titulo={`Faz aniversário em ${formatDate(aniv.data)}${aniv.idade != null ? ` (${aniv.idade} anos)` : ""}`}>🎂 {formatDate(aniv.data, "dd/MM")}</Selo>}
              </div>
            </div>
          </div>
        </td>
        <td className="px-2 py-2">
          <CelulaEscolha valor={p.tipo} opcoes={TIPO_PASSAGEIRO} rotulo="Tipo" render={(v) => <SeloTipo t={v ?? "Pagante"} />}
            onSalvar={async (v) => { await atualizarPassageiro(p.id, { tipo: v }); recarregar(); }} />
        </td>
        {usaGrupos && (
          <td className="px-2 py-2">
            {admin && !somenteLeitura ? (
              <select className="rel-input" style={{ padding: "3px 6px", fontSize: 12, width: 70 }} value={g === "G1" || g === "G2" ? g : ""} aria-label="Grupo"
                onChange={async (e) => {
                  const id = e.target.value === "G1" ? g1?.id : e.target.value === "G2" ? g2?.id : null;
                  try { await definirGrupoDoPax(p.id, id ?? null); void carregar(); } catch (er) { avisar(er instanceof Error ? er.message : "Erro", "erro"); }
                }}>
                <option value="">—</option><option>G1</option><option>G2</option>
              </select>
            ) : g ? (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={g === "G1" ? { background: "#DBEAFE", color: "#1E40AF" } : g === "G2" ? { background: "#EDE9FE", color: "#5B21B6" } : { background: "#FFEDD5", color: "#9A3412" }}>{g}</span>
            ) : <span style={{ color: "var(--ink3)" }}>—</span>}
          </td>
        )}
        <td className="px-2 py-2 font-mono text-[12px] min-w-[130px]"><CelulaEditavel valor={p.cpf} onSalvar={salvarCampo(p, "cpf")} /></td>
        <td className="px-2 py-2 font-mono text-[12px] min-w-[100px]"><CelulaEditavel valor={p.passaporte} onSalvar={salvarCampo(p, "passaporte")} /></td>
        <td className="px-2 py-2 min-w-[110px]">
          <CelulaEditavel tipo="date" valor={p.validade_passaporte?.slice(0, 10) ?? null} onSalvar={salvarCampo(p, "validade_passaporte")}
            formatar={(v) => <span style={{ color: venceCedo ? "var(--err-ink)" : undefined }}>{formatDate(String(v))}{venceCedo && <span className="block text-[10.5px]">⚠ &lt; 6m do embarque</span>}</span>} />
        </td>
        <td className="px-2 py-2">{celulaQuarto(p)}</td>
        <td className="px-2 py-2">
          <CelulaEscolha valor={p.status_reserva} opcoes={STATUS_RESERVA} rotulo="Status" render={(v) => <SeloStatus s={v ?? "Lead"} />}
            onSalvar={async (v) => { await atualizarPassageiro(p.id, { status_reserva: v }); recarregar(); }} />
        </td>
        <td className="px-2 py-2">
          {r ? <button onClick={() => irSub(`prontidao/${p.id}`)} title="Ver prontidão"><SeloProntidao p={r.prontidao} /></button> : <span style={{ color: "var(--ink3)" }}>—</span>}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {preencheuFormulario(p) ? <span className="text-[12px] font-semibold" style={{ color: "#166534" }}>✓ Preencheu</span> : <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Pendente</span>}
        </td>
      </tr>
    );
  };

  const corpo = (lista: PassageiroRow[]) => {
    if (!agrupado) return lista.map(linha);
    const distintos = new Set(lista.map((p) => { const n = nomeGrupo(p); return n === "G1" || n === "G2" ? n : "-"; }));
    if (distintos.size <= 1) return lista.map(linha);
    let atual: string | null = null;
    return lista.map((p) => {
      const n = nomeGrupo(p); const k = n === "G1" || n === "G2" ? n : "-";
      const cab = k !== atual;
      atual = k;
      const qtd = lista.filter((x) => { const m = nomeGrupo(x); return (m === "G1" || m === "G2" ? m : "-") === k; }).length;
      return (
        <Fragment key={p.id}>
          {cab && <tr><td colSpan={20} className="px-2 py-1.5 text-[11.5px] font-bold" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
            {k === "G1" ? "Grupo 1 (G1)" : k === "G2" ? "Grupo 2 (G2)" : "Sem grupo definido"} · {qtd} pessoa{qtd === 1 ? "" : "s"}</td></tr>}
          {linha(p)}
        </Fragment>
      );
    });
  };

  const tabela = (lista: PassageiroRow[], vazio: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead style={{ color: "var(--ink3)" }}>
          <tr>
            <Th col="id">ID</Th><Th col="nome">Nome</Th><Th col="tipo">Tipo</Th>{usaGrupos && <Th col="grupo">Grupo</Th>}
            <Th col="cpf">CPF</Th><Th col="passaporte">Passaporte</Th><Th col="validade">Validade</Th><Th col="quarto">Quarto</Th>
            <Th col="status">Status</Th><Th col="prontidao">Prontidão</Th>
            <th className="text-left px-2 py-2 font-semibold"><button onClick={() => setSoPendentes((v) => !v)} title="Mostrar só quem não preencheu">Formulário{soPendentes ? " ✕" : ""}</button></th>
          </tr>
        </thead>
        <tbody>{lista.length ? corpo(lista) : <tr><td colSpan={20} className="px-2 py-6 text-center" style={{ color: "var(--ink3)" }}>{vazio}</td></tr>}</tbody>
      </table>
    </div>
  );

  const pilula = (ativo: boolean, onClick: () => void, txt: string) => (
    <button onClick={onClick} className="px-2.5 py-1 rounded-full text-[12px] font-semibold"
      style={{ background: ativo ? "var(--rel-soft)" : "var(--card)", color: ativo ? "var(--rel-ink)" : "var(--ink2)", border: `1px solid ${ativo ? "transparent" : "var(--line)"}` }}>{txt}</button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar pax… (nome, CPF, passaporte)" /></div>
        <div className="flex flex-wrap gap-1">{pilula(!fStatus, () => setFStatus(null), "Todos")}{STATUS_RESERVA.map((s) => <Fragment key={s}>{pilula(fStatus === s, () => setFStatus(fStatus === s ? null : s), s)}</Fragment>)}</div>
        <div className="flex flex-wrap gap-1">{pilula(!fTipo, () => setFTipo(null), "Todos")}{TIPO_PASSAGEIRO.map((s) => <Fragment key={s}>{pilula(fTipo === s, () => setFTipo(fTipo === s ? null : s), s)}</Fragment>)}</div>
        <div className="flex-1" />
        {admin && !somenteLeitura && !pacoteSemGrupos(exp) && (usaGrupos ? (
          <span className="inline-flex items-center text-[12.5px]" style={{ color: "var(--err-ink)" }}>
            <BotaoExcluir icone={false} rotulo="Remover divisão" titulo="Remover a divisão G1/G2?" sucesso="Divisão removida"
              descricao="Apaga os grupos G1/G2 desta expedição e desmarca o grupo desses passageiros. A coluna Grupo some. Outros grupos e os quartos já montados não mudam."
              onConfirmar={async () => { await removerDivisao(exp.id); void carregar(); }} />
          </span>
        ) : <Botao variante="fantasma" onClick={async () => { try { await ativarDivisao(exp.id); void carregar(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } }}>Adicionar divisão por grupos</Botao>)}
        {!somenteLeitura && (
          <Botao disabled={sincronizando} title="Puxa do Bitrix os negócios da coluna desta expedição e cria/atualiza os passageiros (só preenche o que está vazio)"
            onClick={async () => {
              setSincronizando(true);
              try { const r = await sincronizarDoBitrix(exp.id); avisar(resumoSyncBitrix(r), r.erros?.length ? "erro" : undefined); void carregar(); }
              catch (e) { avisar(e instanceof Error ? e.message : "Erro ao sincronizar", "erro"); }
              finally { setSincronizando(false); }
            }}>{sincronizando ? "Pedindo ao Bitrix…" : "↻ Atualizar do Bitrix"}</Botao>
        )}
        <Botao disabled={exportando || !dados.pax.length} onClick={async () => {
          setExportando(true);
          try { await exportarPassageiros({ exp, pax: ordenados, quartos: dados.quartos, alocacoes: dados.alocacoes, grupos, prontidao: pront }); }
          catch (e) { avisar(e instanceof Error ? e.message : "Erro ao exportar", "erro"); } finally { setExportando(false); }
        }}>{exportando ? "Gerando…" : "Exportar"}</Botao>
        {!somenteLeitura && <>
          <Botao onClick={() => setCriar("importar")}>Importar</Botao>
          <Botao onClick={() => setCriar("existente")}>Adicionar existente</Botao>
          <Botao variante="primario" onClick={() => setCriar("novo")}>Adicionar</Botao>
        </>}
      </div>

      {dados.pax.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {[["Total", kpi.total], ["Confirmados", kpi.confirmados], ["Pré-reserva", kpi.pre], ["Leads", kpi.leads]].map(([r, n]) => (
            <span key={r} className="px-2.5 py-1 rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink2)" }}><b style={{ color: "var(--ink)" }}>{n}</b> {r}</span>
          ))}
          <span className="w-px h-5" style={{ background: "var(--line)" }} />
          <Selo tom="ok">{kpi.aptos} Aptos</Selo><Selo tom="aviso">{kpi.atencao} Atenção</Selo><Selo tom="erro">{kpi.bloq} Bloqueados</Selo>
          <span className="w-px h-5" style={{ background: "var(--line)" }} />
          {pilula(soPendentes, () => setSoPendentes((v) => !v), `Formulário pendente: ${kpi.pendForm}${soPendentes ? " ✕" : ""}`)}
        </div>
      )}

      {dados.pax.length === 0 ? (
        <section className="rel-card">
          <Vazio titulo="Nenhum passageiro ainda" texto="Adicione manualmente, importe de uma planilha (CSV) ou puxe alguém que já está na base da agência."
            acao={!somenteLeitura ? <Botao variante="primario" onClick={() => setCriar("novo")}>Adicionar passageiro</Botao> : undefined} />
        </section>
      ) : (
        <>
          {temLider && (
            <section className="rel-card p-3">
              <h3 className="text-[13.5px] font-bold mb-2 flex items-center gap-2" style={{ color: "var(--ink)" }}>👑 Líderes <Selo>{lideres.length}</Selo>
                <span className="text-[11.5px] font-normal" style={{ color: "var(--ink3)" }}>não contam na ocupação</span></h3>
              {tabela(lideres, "Nenhum líder no filtro atual.")}
            </section>
          )}
          <section className="rel-card p-3">
            <h3 className="text-[13.5px] font-bold mb-2 flex items-center gap-2" style={{ color: "var(--ink)" }}>ExpedAmigos <Selo>{demais.length}</Selo>
              <span className="text-[11.5px] font-normal" style={{ color: "var(--ink3)" }}>passageiros</span></h3>
            {tabela(demais, "Nenhum passageiro no filtro atual.")}
          </section>
          {!somenteLeitura && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Clique numa célula pra editar. Enter salva, Esc cancela. Dados pessoais (CPF, passaporte…) valem pra todas as expedições da pessoa.</p>}
        </>
      )}

      {criar === "novo" && <NovoPassageiro expId={exp.id} onFechar={() => setCriar(null)} onCriado={() => { recarregar(); carregarPessoas(); }} />}
      {criar === "existente" && <AdicionarExistente expId={exp.id} pessoas={pessoas} chavesNaExp={new Set(dados.pax.map(chaveIdentidade))}
        onFechar={() => setCriar(null)} onCriado={() => { recarregar(); }} />}
      {criar === "importar" && <ImportarPassageiros expId={exp.id} cpfsExistentes={cpfsExp} onFechar={() => setCriar(null)} onCriado={() => { recarregar(); carregarPessoas(); }} />}

      {modo === "pax" && alvo && (
        <EditarPassageiro key={alvo.id} exp={exp} pax={alvo} dados={dados} resultado={pront.get(alvo.id)} posicao={posicoes[alvo.id]} admin={admin}
          onFechar={() => irSub()} onMudou={recarregar} onPerfil={() => irSub(`pax/${alvo.id}/perfil`)}
          onMovido={(nova) => { carregarPessoas(); onMudou(); ir(tela, `${nova}/passageiros/pax/${alvo.id}`); }} />
      )}
      {modo === "prontidao" && alvo && (
        <GavetaProntidao exp={exp} pax={alvo} resultado={pront.get(alvo.id)} requisitos={dados.requisitos.filter((r) => r.passageiro_id === alvo.id)}
          arquivos={dados.arquivos} onMudou={recarregar} onFechar={() => irSub()} />
      )}
      {(modo === "pax" || modo === "prontidao") && alvoId && !alvo && (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Esse passageiro não está mais nesta expedição. <button className="underline" onClick={() => irSub()}>Fechar</button></p>
      )}
    </div>
  );
}

/** Pacote não tem divisão G1/G2 (a aba Divisões some no pacote). */
function pacoteSemGrupos(exp: ExpedicaoComAgregados) { return exp.tipo === "pacote"; }
