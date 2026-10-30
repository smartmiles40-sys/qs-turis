// src/expedicoes/paginas/Saude.tsx
// -----------------------------------------------------------------------------
// SAÚDE · FILA DO MÉDICO (Bruno, 30/10): "quem tem algum problema de saúde, pra
// passar pro médico e ele fazer os laudos, o acompanhamento e a curadoria do
// cliente". Endereço #ops/saude.
//
//  · Fila do médico — quem declarou algo clínico no formulário (lib/saudeFila.ts),
//    da viagem que embarca primeiro pra última; cada caso tem o que o cliente
//    declarou, o status do laudo, o PDF, as anotações (data + autor) e "apto a
//    viajar". O laudo fica em cad_laudos_medicos (0225), ligado ao cliente_id —
//    a ficha do cliente lê de lá (docs/CONTRATO-LAUDOS.md).
//  · Alimentação — restrições/alergias por viagem, com o texto pronto pra mandar
//    ao restaurante/fornecedor (só copia; nada é enviado daqui).
//  · Resolvidos — laudos emitidos/dispensados.
//
// Quem vê: exp_pode_ver_saude() (Operações, gestão do Relacionamento, papel
// 'medico'). Sem a 0225 a tela abre só pra leitura (Ops já lê passageiros.saude).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Aviso, Botao, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Selo, useAoVivo } from "../ui";
import { supabase } from "../lib/banco";
import { dataSP } from "../lib/fase.ts";
import { formatDate, formatDateTime } from "../lib/utils";
import { formatarCpf } from "../lib/cpf";
import { copiar } from "./_admin/comum";
import {
  ROTULO_APTO, ROTULO_STATUS, abrirPdfLaudo, anotar, carregarFila, lerNotas, pendenteMedico, resumoAlimentar,
  salvarLaudo, subirPdfLaudo, textoDias, tirarPdfLaudo, urgencia,
  type Apto, type CasoSaude, type ItemDeclarado, type NotaLaudo, type StatusLaudo,
} from "../lib/saudeFila";

type Aba = "fila" | "alimentacao" | "resolvidos";
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
  const [inscSaude, setInscSaude] = useState(0);
  const [aba, setAba] = useState<Aba>("fila");
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
    const { data } = await supabase.from("inscricoes_pendentes").select("dados").eq("status", "pendente").limit(1000);
    setInscSaude((data ?? []).filter((r) => {
      const s = ((r as { dados?: { saude?: Record<string, string> } }).dados?.saude ?? {}) as Record<string, string>;
      return Object.entries(s).some(([k, v]) => v === "Sim" && k !== "vacina_febre_amarela");
    }).length);
  }, [hoje]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "cad_laudos_medicos" }, { tabela: "cad_laudo_notas" }, { tabela: "passageiros" }], () => { void carregar(); }, 1500);

  const casos = dados?.casos ?? [];
  const exps = useMemo(() => {
    const m = new Map<string, CasoSaude["exp"]>();
    for (const c of casos) m.set(c.exp.id, c.exp);
    return [...m.values()];
  }, [casos]);
  const q = busca.trim().toLowerCase();
  const filtrar = (l: CasoSaude[]) => l.filter((c) => (!expFiltro || c.exp.id === expFiltro)
    && (!q || `${c.pax.nome_completo} ${c.exp.nome} ${c.pax.cpf ?? ""}`.toLowerCase().includes(q)));

  const fila = casos.filter(pendenteMedico);
  const resolvidos = casos.filter((c) => c.laudo && (c.laudo.status === "emitido" || c.laudo.status === "dispensado"));
  const alimentares = casos.filter((c) => c.alimentar.length);
  const aFazer = fila.filter((c) => !c.laudo || c.laudo.status === "a_fazer").length;
  const andamento = fila.filter((c) => c.laudo?.status === "em_andamento").length;
  const urgentes = fila.filter((c) => (c.dias ?? 999) <= 15).length;

  if (acesso === false) return <Aviso tom="erro">Dado de saúde é sensível (LGPD): esta tela é só de Operações, da gestão do Relacionamento e do médico.</Aviso>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!dados || acesso === null) return <Carregando />;

  const lista = filtrar(aba === "fila" ? fila : aba === "resolvidos" ? resolvidos : alimentares);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Saúde dos viajantes</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)", margin: 0 }}>
          O que cada cliente declarou no formulário de inscrição, pra o médico fazer o laudo e acompanhar. Mais urgente (embarque mais perto) em cima.
        </p>
      </header>

      {!dados.temLaudos && (
        <Aviso>Os laudos ainda não estão ligados no banco (falta aplicar a migration 0225). Dá pra ver a fila; salvar laudo, PDF e anotações fica desligado.</Aviso>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Contador rotulo="Laudos a fazer" valor={aFazer} tom="erro" onClick={() => setAba("fila")} />
        <Contador rotulo="Em andamento" valor={andamento} tom="aviso" onClick={() => setAba("fila")} />
        <Contador rotulo="Embarcam em até 15 dias sem laudo" valor={urgentes} tom={urgentes ? "erro" : "neutro"} onClick={() => setAba("fila")} />
        <Contador rotulo="Restrições alimentares" valor={alimentares.length} tom="lista" onClick={() => setAba("alimentacao")} />
      </div>

      {inscSaude > 0 && (
        <div className="rel-card px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <Selo tom="aviso">{inscSaude}</Selo>
          inscrições com resposta de saúde ainda aguardam aprovação — entram nesta fila quando forem aprovadas.
          <span className="flex-1" />
          <Botao variante="fantasma" onClick={() => ir("inscricoes")}>Ver inscrições ↗</Botao>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Abas aba={aba} setAba={setAba} n={{ fila: fila.length, alimentacao: alimentares.length, resolvidos: resolvidos.length }} />
        <span className="flex-1" />
        <select className="rel-input" style={{ width: "auto", minWidth: 220 }} value={expFiltro} onChange={(e) => setExpFiltro(e.target.value)} aria-label="Filtrar por viagem">
          <option value="">Todas as viagens</option>
          {exps.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <div style={{ minWidth: 240 }}><Busca valor={busca} onMudar={setBusca} placeholder="Buscar cliente…" /></div>
      </div>

      {aba === "alimentacao"
        ? <Alimentacao casos={lista} onCopiar={async (t) => avisar((await copiar(t)) ? "Resumo copiado — cole no WhatsApp/e-mail do fornecedor" : "Não consegui copiar", "ok")} />
        : lista.length === 0
          ? <Vazio titulo={aba === "fila" ? "Nenhum caso esperando o médico." : "Nenhum laudo resolvido ainda."} texto="Os casos vêm das respostas de saúde do formulário de inscrição das viagens que ainda não embarcaram." />
          : <div className="space-y-2.5">
            {lista.map((c) => (
              <CartaoCaso key={c.pax.id} c={c} aberto={aberto === c.pax.id} podeSalvar={dados.temLaudos}
                onAlternar={() => setAberto((a) => (a === c.pax.id ? null : c.pax.id))}
                onMudou={carregar}
                onPassageiro={() => ir(c.exp.tipo === "pacote" ? "pacotes" : "expedicoes", `${c.exp.id}/passageiros/pax/${c.pax.id}`)} />
            ))}
          </div>}
    </div>
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
  return <div role="tablist" className="flex flex-wrap gap-1.5">{item("fila", "Fila do médico")}{item("alimentacao", "Alimentação · logística")}{item("resolvidos", "Laudos resolvidos")}</div>;
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
