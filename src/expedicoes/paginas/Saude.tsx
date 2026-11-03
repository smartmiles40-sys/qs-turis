// src/expedicoes/paginas/Saude.tsx
// -----------------------------------------------------------------------------
// SAÚDE · FILA DO MÉDICO (Bruno, 30/10): "quem tem algum problema de saúde, pra
// passar pro médico e ele fazer os laudos, o acompanhamento e a curadoria do
// cliente". Endereço #ops/saude.
//
//  · Pipeline da saúde (03/11, Bruno: "somente a parte de saúde que realmente fica
//    um pipeline") — quadro em colunas: Inscrição com alerta → Declarou alerta →
//    Laudo em andamento → Receita a enviar → Liberado (+ Não apto). As etapas saem
//    só de dados que já existem (lib/saudePipeline.ts, testada). Clicar no cartão
//    abre o caso: o que o cliente declarou, o status do laudo, o PDF, as anotações
//    (data + autor) e "apto a viajar". O laudo fica em cad_laudos_medicos (0225),
//    ligado ao cliente_id — a ficha do cliente lê de lá (docs/CONTRATO-LAUDOS.md).
//    Era "Fila do médico" + "Laudos resolvidos" (viraram colunas).
//  · Alimentação — restrições/alergias por viagem, com o texto pronto pra mandar
//    ao restaurante/fornecedor (só copia; nada é enviado daqui).
//
// Quem vê: exp_pode_ver_saude() (Operações, gestão do Relacionamento, papel
// 'medico'). Sem a 0225 a tela abre só pra leitura (Ops já lê passageiros.saude).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Aviso, Botao, Modal, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Selo, useAoVivo } from "../ui";
import { supabase } from "../lib/banco";
import { dataSP } from "../lib/fase.ts";
import { formatDate, formatDateTime } from "../lib/utils";
import { formatarCpf } from "../lib/cpf";
import { copiar } from "./_admin/comum";
import {
  ROTULO_APTO, ROTULO_STATUS, abrirPdfLaudo, anotar, carregarFila, diasAte, expedicoesFuturas, lerNotas, pendenteMedico, resumoAlimentar,
  salvarLaudo, subirPdfLaudo, textoDias, tirarPdfLaudo, urgencia,
  type Apto, type CasoSaude, type ItemDeclarado, type NotaLaudo, type StatusLaudo,
} from "../lib/saudeFila";
import { ETAPAS_SAUDE, etapaSaude, inscricaoTemAlertaSaude, montarPipeline, type CartaoPipeline, type EtapaSaude } from "../lib/saudePipeline";
import type { ExpedicaoRow } from "../lib/database";

type Aba = "pipeline" | "alimentacao";
type InscSaude = { id: string; nome: string; exp: ExpedicaoRow; dias: number | null };
type ItemPipe = { tipo: "caso"; c: CasoSaude } | { tipo: "inscricao"; i: InscSaude };
const TOM_STATUS: Record<StatusLaudo, "erro" | "aviso" | "ok" | "neutro"> = { a_fazer: "erro", em_andamento: "aviso", emitido: "ok", dispensado: "neutro" };
const TOM_APTO: Record<Apto, "ok" | "erro" | "aviso"> = { sim: "ok", nao: "erro", ressalvas: "aviso" };
const COR_URG = { erro: "var(--err-ink)", aviso: "var(--warn-ink)", neutro: "var(--line)" } as const;

function abrirFicha(clienteId: string) {
  const area = window.location.hash.startsWith("#rel") ? "rel" : "ops";
  window.location.hash = `#${area}/ficha/${encodeURIComponent(clienteId)}`;
}

export default function Saude() {
  const { ir, avisar } = useExp();
  const hoje = dataSP(new Date());
  const [dados, setDados] = useState<{ casos: CasoSaude[]; temLaudos: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acesso, setAcesso] = useState<boolean | null>(null);
  const [inscricoes, setInscricoes] = useState<InscSaude[]>([]);
  const [aba, setAba] = useState<Aba>("pipeline");
  const [busca, setBusca] = useState("");
  const [expFiltro, setExpFiltro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    // Sem a 0225 a função não existe: Operações já lê a saúde hoje, então deixa abrir.
    supabase.rpc("exp_pode_ver_saude").then(({ data, error }) => setAcesso(error ? true : Boolean(data)));
  }, []);

  const carregar = useCallback(async () => {
    try { setDados(await carregarFila(hoje)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
    // Coluna 1 do pipeline: inscrição com "Sim" na saúde, das viagens que ainda não embarcaram
    try {
      const [exps, { data }] = await Promise.all([
        expedicoesFuturas(hoje),
        supabase.from("inscricoes_pendentes").select("id,nome_completo,expedicao_id,dados").eq("status", "pendente").limit(1000),
      ]);
      const porId = new Map(exps.map((e) => [e.id, e]));
      setInscricoes(((data ?? []) as { id: string; nome_completo: string | null; expedicao_id: string; dados: unknown }[])
        .filter((r) => porId.has(r.expedicao_id) && inscricaoTemAlertaSaude(r.dados))
        .map((r) => {
          const exp = porId.get(r.expedicao_id)!;
          return { id: r.id, nome: r.nome_completo ?? "—", exp, dias: diasAte(hoje, exp.data_embarque) };
        }));
    } catch { setInscricoes([]); }
  }, [hoje]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "cad_laudos_medicos" }, { tabela: "cad_laudo_notas" }, { tabela: "passageiros" }, { tabela: "inscricoes_pendentes" }], () => { void carregar(); }, 1500);

  const casos = dados?.casos ?? [];
  const exps = useMemo(() => {
    const m = new Map<string, ExpedicaoRow>();
    for (const c of casos) m.set(c.exp.id, c.exp);
    for (const i of inscricoes) m.set(i.exp.id, i.exp);
    return [...m.values()].sort((a, b) => (a.data_embarque ?? "9999").localeCompare(b.data_embarque ?? "9999"));
  }, [casos, inscricoes]);
  const q = busca.trim().toLowerCase();
  const passa = (expId: string, texto: string) => (!expFiltro || expId === expFiltro) && (!q || texto.toLowerCase().includes(q));

  const colunas = useMemo(() => {
    const cartoes: CartaoPipeline<ItemPipe>[] = [];
    for (const c of casos) {
      const etapa = etapaSaude({ clinicos: c.clinico.length, laudo: c.laudo, receitaPendente: c.pax.receita_pendente, receitaEnviadaEm: c.pax.receita_enviada_em });
      if (etapa && passa(c.exp.id, `${c.pax.nome_completo} ${c.exp.nome} ${c.pax.cpf ?? ""}`)) cartoes.push({ etapa, dias: c.dias, nome: c.pax.nome_completo, item: { tipo: "caso", c } });
    }
    for (const i of inscricoes) {
      if (passa(i.exp.id, `${i.nome} ${i.exp.nome}`)) cartoes.push({ etapa: "inscricao", dias: i.dias, nome: i.nome, item: { tipo: "inscricao", i } });
    }
    return montarPipeline(cartoes);
  }, [casos, inscricoes, expFiltro, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const fila = casos.filter(pendenteMedico);
  const alimentares = casos.filter((c) => c.alimentar.length);
  const aFazer = fila.filter((c) => !c.laudo || c.laudo.status === "a_fazer").length;
  const andamento = fila.filter((c) => c.laudo?.status === "em_andamento").length;
  const urgentes = fila.filter((c) => (c.dias ?? 999) <= 15).length;
  const casoAberto = aberto ? casos.find((c) => c.pax.id === aberto) ?? null : null;

  if (acesso === false) return <Aviso tom="erro">Dado de saúde é sensível (LGPD): esta tela é só de Operações, da gestão do Relacionamento e do médico.</Aviso>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!dados || acesso === null) return <Carregando />;

  const listaAlimentar = alimentares.filter((c) => passa(c.exp.id, `${c.pax.nome_completo} ${c.exp.nome} ${c.pax.cpf ?? ""}`));
  const telaDe = (e: ExpedicaoRow) => (e.tipo === "pacote" ? "pacotes" : "expedicoes");

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Saúde dos viajantes</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)", margin: 0 }}>
          Cada caso anda da esquerda pra direita: do alerta no formulário até o médico liberar. Em cada coluna, quem embarca antes fica em cima.
        </p>
      </header>

      {!dados.temLaudos && (
        <Aviso>Os laudos ainda não estão ligados no banco (falta aplicar a migration 0225). Dá pra ver o pipeline; salvar laudo, PDF e anotações fica desligado.</Aviso>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Contador rotulo="Laudos a fazer" valor={aFazer} tom="erro" onClick={() => setAba("pipeline")} />
        <Contador rotulo="Em andamento" valor={andamento} tom="aviso" onClick={() => setAba("pipeline")} />
        <Contador rotulo="Embarcam em até 15 dias sem laudo" valor={urgentes} tom={urgentes ? "erro" : "neutro"} onClick={() => setAba("pipeline")} />
        <Contador rotulo="Restrições alimentares" valor={alimentares.length} tom="lista" onClick={() => setAba("alimentacao")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Abas aba={aba} setAba={setAba} n={{ pipeline: ETAPAS_SAUDE.reduce((s, e) => s + colunas[e.id].length, 0), alimentacao: alimentares.length }} />
        <span className="flex-1" />
        <select className="rel-input" style={{ width: "auto", minWidth: 220 }} value={expFiltro} onChange={(e) => setExpFiltro(e.target.value)} aria-label="Filtrar por expedição">
          <option value="">Todas as expedições e pacotes</option>
          {exps.map((e) => <option key={e.id} value={e.id}>{e.nome}{e.data_embarque ? ` · ${formatDate(e.data_embarque)}` : ""}</option>)}
        </select>
        <div style={{ minWidth: 240 }}><Busca valor={busca} onMudar={setBusca} placeholder="Buscar cliente…" /></div>
      </div>

      {aba === "alimentacao"
        ? <Alimentacao casos={listaAlimentar} onCopiar={async (t) => avisar((await copiar(t)) ? "Resumo copiado — cole no WhatsApp/e-mail do fornecedor" : "Não consegui copiar", "ok")} />
        : <Pipeline colunas={colunas}
          onAbrirCaso={(c) => setAberto(c.pax.id)}
          onAbrirInscricao={(i) => ir(telaDe(i.exp), `${i.exp.id}/passageiros`)} />}

      {casoAberto && (
        <Modal aberto titulo={casoAberto.pax.nome_completo} onFechar={() => setAberto(null)} largura={760}>
          <CartaoCaso c={casoAberto} aberto={casoAberto.clinico.length > 0} podeSalvar={dados.temLaudos}
            onAlternar={() => setAberto(null)}
            onMudou={carregar}
            onPassageiro={() => { setAberto(null); ir(telaDe(casoAberto.exp), `${casoAberto.exp.id}/passageiros/pax/${casoAberto.pax.id}`); }} />
        </Modal>
      )}
    </div>
  );
}

// ── Pipeline (quadro em colunas) ─────────────────────────────────────────────
const COR_COLUNA: Record<EtapaSaude, string> = {
  inscricao: "var(--ink3)", declarou: "var(--err-ink)", andamento: "var(--warn-ink)", receita: "#5B21B6", liberado: "#166534", nao_apto: "var(--err-ink)",
};

function Pipeline({ colunas, onAbrirCaso, onAbrirInscricao }: {
  colunas: Record<EtapaSaude, CartaoPipeline<ItemPipe>[]>;
  onAbrirCaso: (c: CasoSaude) => void;
  onAbrirInscricao: (i: InscSaude) => void;
}) {
  const total = ETAPAS_SAUDE.reduce((s, e) => s + colunas[e.id].length, 0);
  if (!total) return <Vazio titulo="Nenhum caso de saúde nas viagens que vão acontecer." texto="Os casos vêm das respostas de saúde do formulário de inscrição e das receitas marcadas na triagem." />;
  return (
    <div className="overflow-x-auto pb-2 -mx-1 px-1">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${ETAPAS_SAUDE.length}, minmax(230px, 1fr))`, minWidth: ETAPAS_SAUDE.length * 242 }}>
        {ETAPAS_SAUDE.map((e) => {
          const l = colunas[e.id];
          return (
            <section key={e.id} aria-label={e.rotulo} className="rounded-xl p-2.5 space-y-2 flex flex-col" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <header className="px-0.5" title={e.dica}>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COR_COLUNA[e.id] }} />
                  <span className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{e.rotulo}</span>
                  <span className="ml-auto text-[12px] font-bold tabular-nums" style={{ color: l.length ? COR_COLUNA[e.id] : "var(--ink3)" }}>{l.length}</span>
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--ink3)", margin: 0 }}>{e.dica}</p>
              </header>
              <div className="space-y-2">
                {l.length === 0
                  ? <p className="text-[12px] text-center py-3" style={{ color: "var(--ink3)", margin: 0 }}>—</p>
                  : l.map((k) => k.item.tipo === "caso"
                    ? <CartaoPipe key={`c-${k.item.c.pax.id}`} item={k.item} onClick={() => onAbrirCaso((k.item as { c: CasoSaude }).c)} />
                    : <CartaoPipe key={`i-${k.item.i.id}`} item={k.item} onClick={() => onAbrirInscricao((k.item as { i: InscSaude }).i)} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CartaoPipe({ item, onClick }: { item: ItemPipe; onClick: () => void }) {
  const nome = item.tipo === "caso" ? item.c.pax.nome_completo : item.i.nome;
  const exp = item.tipo === "caso" ? item.c.exp : item.i.exp;
  const dias = item.tipo === "caso" ? item.c.dias : item.i.dias;
  const resolvido = item.tipo === "caso" && (item.c.laudo?.status === "emitido" || item.c.laudo?.status === "dispensado");
  const urg = resolvido ? "neutro" : urgencia(dias);
  return (
    <button type="button" onClick={onClick} className="rel-card w-full p-2.5 text-left space-y-1 hover:shadow-md transition-shadow"
      style={{ borderLeft: `4px solid ${COR_URG[urg]}` }}
      title={item.tipo === "caso" ? "Abrir o caso (laudo, PDF, anotações)" : "Abrir os passageiros da viagem pra aprovar a inscrição"}>
      <div className="text-[13px] font-bold leading-snug" style={{ color: "var(--ink)" }}>{nome}</div>
      <div className="text-[11.5px] leading-snug" style={{ color: "var(--ink3)" }}>
        {exp.tipo === "pacote" ? "Pacote" : "Expedição"} {exp.nome}
        {exp.data_embarque ? ` · ${formatDate(exp.data_embarque)}` : ""}
      </div>
      <div className="flex flex-wrap gap-1 pt-0.5">
        <Selo tom={urg === "neutro" ? "neutro" : urg}>{textoDias(dias)}</Selo>
        {item.tipo === "caso" && item.c.clinico.length > 0 && <Selo tom="erro" titulo={item.c.clinico.map((x) => x.curto).join(" · ")}>{item.c.clinico.length === 1 ? item.c.clinico[0].curto : `${item.c.clinico.length} alertas`}</Selo>}
        {item.tipo === "caso" && item.c.laudo?.apto && <Selo tom={TOM_APTO[item.c.laudo.apto]}>{ROTULO_APTO[item.c.laudo.apto]}</Selo>}
        {item.tipo === "caso" && item.c.laudo?.arquivo_path && <Selo tom="lista">PDF</Selo>}
        {item.tipo === "caso" && item.c.pax.receita_pendente && <Selo tom={item.c.pax.receita_enviada_em ? "ok" : "lista"}>{item.c.pax.receita_enviada_em ? "Receita enviada" : "Receita"}</Selo>}
        {item.tipo === "inscricao" && <Selo tom="aviso">Aguardando aprovação</Selo>}
      </div>
    </button>
  );
}

function Contador({ rotulo, valor, tom, onClick }: { rotulo: string; valor: number; tom: "erro" | "aviso" | "neutro" | "lista"; onClick: () => void }) {
  const cor = tom === "erro" ? "var(--err-ink)" : tom === "aviso" ? "var(--warn-ink)" : tom === "lista" ? "#5B21B6" : "var(--ink2)";
  return (
    <button type="button" onClick={onClick} className="rel-card p-3.5 text-left hover:opacity-90" style={{ borderLeft: `4px solid ${valor ? cor : "var(--line)"}` }}>
      <div className="text-[26px] font-bold leading-none" style={{ color: valor ? cor : "var(--ink3)" }}>{valor}</div>
      <div className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>{rotulo}</div>
    </button>
  );
}

function Abas({ aba, setAba, n }: { aba: Aba; setAba: (a: Aba) => void; n: Record<Aba, number> }) {
  const item = (id: Aba, rotulo: string) => (
    <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)}
      className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
      style={aba === id ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
      {rotulo} ({n[id]})
    </button>
  );
  return <div role="tablist" className="flex flex-wrap gap-1.5">{item("pipeline", "Pipeline da saúde")}{item("alimentacao", "Alimentação · logística")}</div>;
}

function Itens({ titulo, itens, tom }: { titulo: string; itens: ItemDeclarado[]; tom: "erro" | "aviso" | "neutro" }) {
  if (!itens.length) return null;
  const fundo = tom === "erro" ? "var(--err-bg)" : tom === "aviso" ? "var(--warn-bg)" : "var(--card2)";
  const cor = tom === "erro" ? "var(--err-ink)" : tom === "aviso" ? "var(--warn-ink)" : "var(--ink3)";
  return (
    <div className="rounded-lg px-2.5 py-2 text-[12.5px]" style={{ background: fundo }}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide mb-0.5" style={{ color: cor }}>{titulo}</div>
      <ul className="space-y-0.5" style={{ color: "var(--ink)" }}>
        {itens.map((i) => <li key={i.campo}><strong>{i.curto}</strong>{i.detalhe ? `: ${i.detalhe}` : ""}</li>)}
      </ul>
    </div>
  );
}

function CartaoCaso({ c, aberto, podeSalvar, onAlternar, onMudou, onPassageiro }: {
  c: CasoSaude; aberto: boolean; podeSalvar: boolean; onAlternar: () => void; onMudou: () => void; onPassageiro: () => void;
}) {
  const urg = c.laudo?.status === "emitido" || c.laudo?.status === "dispensado" ? "neutro" : urgencia(c.dias);
  const status: StatusLaudo = c.laudo?.status ?? "a_fazer";
  return (
    <article className="rel-card p-3.5 space-y-2.5" style={{ borderLeft: `4px solid ${COR_URG[urg]}` }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold" style={{ color: "var(--ink)" }}>{c.pax.nome_completo}</div>
          <div className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {c.exp.tipo === "pacote" ? "Pacote" : "Expedição"} {c.exp.nome}
            {c.exp.data_embarque ? ` · embarque ${formatDate(c.exp.data_embarque)}` : ""}
            {c.pax.data_nascimento ? ` · nasc. ${formatDate(c.pax.data_nascimento)}` : ""}
          </div>
        </div>
        <Selo tom={urg === "neutro" ? "neutro" : urg}>{textoDias(c.dias)}</Selo>
        {c.clinico.length > 0 && <Selo tom={TOM_STATUS[status]}>Laudo: {ROTULO_STATUS[status]}</Selo>}
        {c.laudo?.apto && <Selo tom={TOM_APTO[c.laudo.apto]}>{ROTULO_APTO[c.laudo.apto]}</Selo>}
        {c.laudo?.arquivo_path && <Selo tom="lista">PDF</Selo>}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Itens titulo="Declarou (clínico)" itens={c.clinico} tom="erro" />
        <Itens titulo="Alimentação" itens={c.alimentar} tom="aviso" />
      </div>
      {c.leve.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{c.leve.map((i) => <Selo key={i.campo} titulo={i.detalhe ?? undefined}>{i.curto}</Selo>)}</div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {c.clinico.length > 0 && <Botao variante={aberto ? "secundario" : "primario"} onClick={onAlternar}>{aberto ? "Fechar laudo" : c.laudo ? "Abrir laudo" : "Começar laudo"}</Botao>}
        {c.pax.cliente_id && <Botao variante="fantasma" onClick={() => abrirFicha(c.pax.cliente_id!)}>Ficha do cliente ↗</Botao>}
        <Botao variante="fantasma" onClick={onPassageiro}>Passageiro na viagem ↗</Botao>
        {c.pax.telefone && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{c.pax.telefone}</span>}
      </div>

      {aberto && <PainelLaudo c={c} podeSalvar={podeSalvar} onMudou={onMudou} />}
    </article>
  );
}

function PainelLaudo({ c, podeSalvar, onMudou }: { c: CasoSaude; podeSalvar: boolean; onMudou: () => void }) {
  const { avisar } = useExp();
  const [status, setStatus] = useState<StatusLaudo>(c.laudo?.status ?? "a_fazer");
  const [apto, setApto] = useState<Apto | "">(c.laudo?.apto ?? "");
  const [ressalvas, setRessalvas] = useState(c.laudo?.ressalvas ?? "");
  const [parecer, setParecer] = useState(c.laudo?.parecer ?? "");
  const [indo, setIndo] = useState<string | null>(null);
  const [notas, setNotas] = useState<NotaLaudo[] | null>(null);
  const [nota, setNota] = useState("");

  const recarregarNotas = useCallback(() => {
    if (!c.laudo) { setNotas([]); return; }
    lerNotas(c.laudo.id).then(setNotas).catch(() => setNotas([]));
  }, [c.laudo]);
  useEffect(recarregarNotas, [recarregarNotas]);

  async function salvar(extra?: Parameters<typeof salvarLaudo>[1]) {
    setIndo("salvar");
    try {
      await salvarLaudo(c.pax.id, { status, apto, ressalvas, parecer, ...extra });
      avisar(status === "emitido" ? "Laudo emitido — já aparece na ficha do cliente" : "Laudo salvo");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não salvou o laudo", "erro"); }
    finally { setIndo(null); }
  }

  async function subir(f: File | undefined) {
    if (!f) return;
    setIndo("pdf");
    try {
      const arq = await subirPdfLaudo(c, f);
      await salvarLaudo(c.pax.id, { arquivo: arq, status: status === "a_fazer" ? "em_andamento" : undefined });
      if (status === "a_fazer") setStatus("em_andamento");
      avisar("PDF do laudo anexado");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não subiu o PDF", "erro"); }
    finally { setIndo(null); }
  }

  async function addNota() {
    if (!nota.trim()) return;
    setIndo("nota");
    try {
      // a anotação precisa do laudo: cria em "em andamento" se ainda não existe
      const laudo = c.laudo ?? await salvarLaudo(c.pax.id, { status: "em_andamento" });
      await anotar(laudo.id, nota);
      setNota("");
      if (!c.laudo) setStatus("em_andamento");
      onMudou();
      lerNotas(laudo.id).then(setNotas).catch(() => undefined);
    } catch (e) { avisar(e instanceof Error ? e.message : "Não salvou a anotação", "erro"); }
    finally { setIndo(null); }
  }

  const Escolha = <T extends string>({ valor, opcoes, onEscolher }: { valor: T | ""; opcoes: [T, string, "ok" | "erro" | "aviso" | "neutro"][]; onEscolher: (v: T) => void }) => (
    <div className="flex flex-wrap gap-1.5">
      {opcoes.map(([v, r, tom]) => {
        const on = valor === v;
        const cor = tom === "ok" ? "#166534" : tom === "erro" ? "var(--err-ink)" : tom === "aviso" ? "var(--warn-ink)" : "var(--ink2)";
        return (
          <button key={v} type="button" aria-pressed={on} disabled={!podeSalvar} onClick={() => onEscolher(v)}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
            style={on ? { background: cor, color: "#fff", border: `1px solid ${cor}` } : { background: "var(--card)", color: cor, border: "1px solid var(--line)" }}>
            {r}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="border-t pt-3 space-y-3" style={{ borderColor: "var(--line)" }}>
      <Campo rotulo="Status do laudo">
        <Escolha valor={status} onEscolher={setStatus} opcoes={[["a_fazer", "A fazer", "erro"], ["em_andamento", "Em andamento", "aviso"], ["emitido", "Emitido", "ok"], ["dispensado", "Dispensado", "neutro"]]} />
      </Campo>
      <Campo rotulo="Apto a viajar?">
        <Escolha valor={apto} onEscolher={setApto} opcoes={[["sim", "Sim", "ok"], ["ressalvas", "Com ressalvas", "aviso"], ["nao", "Não", "erro"]]} />
      </Campo>
      {apto === "ressalvas" && (
        <Campo rotulo="Ressalvas (o que o time e o guia precisam saber)">
          <textarea className="rel-input" rows={2} value={ressalvas} disabled={!podeSalvar} onChange={(e) => setRessalvas(e.target.value)} placeholder="Ex.: evitar trilhas acima de 3.000 m; levar insulina na bagagem de mão" />
        </Campo>
      )}
      <Campo rotulo="Parecer / curadoria do médico">
        <textarea className="rel-input" rows={3} value={parecer} disabled={!podeSalvar} onChange={(e) => setParecer(e.target.value)} placeholder="Resumo clínico, orientações pro cliente, o que conferir antes do embarque…" />
      </Campo>

      <Campo rotulo="Laudo em PDF">
        <div className="flex flex-wrap items-center gap-2">
          {c.laudo?.arquivo_path ? (
            <>
              <Botao onClick={() => abrirPdfLaudo(c.laudo!.arquivo_path!).catch((e) => avisar(e instanceof Error ? e.message : "Não abriu", "erro"))}>Ver {c.laudo.arquivo_nome ?? "laudo.pdf"}</Botao>
              <Botao variante="fantasma" disabled={!podeSalvar || !!indo} onClick={async () => {
                setIndo("pdf");
                try { await tirarPdfLaudo(c.laudo!.id); avisar("PDF tirado"); onMudou(); }
                catch (e) { avisar(e instanceof Error ? e.message : "Não tirou o PDF", "erro"); }
                finally { setIndo(null); }
              }}>Tirar PDF</Botao>
            </>
          ) : <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum PDF ainda.</span>}
          <label className="text-[12.5px] font-semibold cursor-pointer" style={{ color: podeSalvar ? "var(--rel-ink)" : "var(--ink3)" }}>
            {indo === "pdf" ? "Subindo…" : c.laudo?.arquivo_path ? "Trocar PDF" : "Anexar PDF"}
            <input type="file" accept="application/pdf" className="sr-only" disabled={!podeSalvar || !!indo} onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      </Campo>

      <div className="flex flex-wrap items-center gap-2">
        {c.laudo?.emitido_em && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Emitido {formatDateTime(c.laudo.emitido_em)}{c.laudo.emitido_por_nome ? ` por ${c.laudo.emitido_por_nome}` : ""}</span>}
        <span className="flex-1" />
        <Botao variante="primario" disabled={!podeSalvar || !!indo} onClick={() => void salvar()}>{indo === "salvar" ? "Salvando…" : status === "emitido" ? "Salvar e emitir" : "Salvar laudo"}</Botao>
      </div>

      <Campo rotulo="Acompanhamento">
        <div className="space-y-2">
          <div className="flex gap-2 items-start">
            <textarea className="rel-input" rows={2} value={nota} disabled={!podeSalvar} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: liguei pro cliente, pedi o exame de esforço; volta até 10/11" />
            <Botao disabled={!podeSalvar || !nota.trim() || !!indo} onClick={() => void addNota()}>{indo === "nota" ? "…" : "Anotar"}</Botao>
          </div>
          {notas === null ? null : notas.length === 0
            ? <p className="text-[12.5px]" style={{ color: "var(--ink3)", margin: 0 }}>Sem anotações ainda.</p>
            : <ul className="space-y-1.5">
              {notas.map((n) => (
                <li key={n.id} className="rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: "var(--card2)" }}>
                  <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{formatDateTime(n.criado_em)}{n.autor_nome ? ` · ${n.autor_nome}` : ""}</div>
                  <div className="whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{n.texto}</div>
                </li>
              ))}
            </ul>}
        </div>
      </Campo>
      <p className="text-[11.5px]" style={{ color: "var(--ink3)", margin: 0 }}>CPF {formatarCpf(c.pax.cpf)} · dado de saúde: só Operações, gestão do Relacionamento e médico veem.</p>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</div>
      {children}
    </div>
  );
}

function Alimentacao({ casos, onCopiar }: { casos: CasoSaude[]; onCopiar: (texto: string) => void }) {
  const grupos = useMemo(() => {
    const m = new Map<string, CasoSaude[]>();
    for (const c of casos) m.set(c.exp.id, [...(m.get(c.exp.id) ?? []), c]);
    return [...m.values()];
  }, [casos]);
  if (!grupos.length) return <Vazio titulo="Nenhuma restrição alimentar declarada." texto="Quando alguém responder alergia ou restrição alimentar no formulário, aparece aqui por viagem." />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {grupos.map((l) => {
        const exp = l[0].exp;
        const tom = urgencia(l[0].dias);
        return (
          <section key={exp.id} className="rel-card p-3.5 space-y-2" style={{ borderLeft: `4px solid ${COR_URG[tom]}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{exp.nome}</div>
                <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{exp.data_embarque ? `embarque ${formatDate(exp.data_embarque)}` : "sem data"} · {l.length} pessoa{l.length === 1 ? "" : "s"}</div>
              </div>
              <Selo tom={tom}>{textoDias(l[0].dias)}</Selo>
              <Botao variante="primario" onClick={() => onCopiar(resumoAlimentar(exp, l))}>Copiar pro fornecedor</Botao>
            </div>
            <ul className="space-y-1 text-[12.5px]" style={{ color: "var(--ink)" }}>
              {l.map((c) => (
                <li key={c.pax.id}><strong>{c.pax.nome_completo}</strong>: {c.alimentar.map((i) => `${i.curto}${i.detalhe ? ` (${i.detalhe})` : ""}`).join("; ")}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
