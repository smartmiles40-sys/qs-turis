// src/mkt/trafego/VerbaAba.tsx — o período de verba e o ritmo (0265).
// O gestor cadastra "R$ 15.000 de 01/11 a 15/11" (com divisão opcional por
// destino/campanha); a tela mostra gasto, saldo, ritmo ideal, projeção,
// diária segura e o orçamento PROGRAMADO na Meta — o que estoura antes de estourar.
import { useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal, Vazio } from "@/rel/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useMkt } from "../contexto";
import { useTrafego } from "./MetaAdsPage";
import { apagarPeriodo, salvarPeriodo, salvarQuemRecebe, salvarRegra } from "./api";
import type { Cota, Periodo, Verba } from "./tipos";
import { BarraVerba, brl, dataBr, Numero, pct, TD, TH } from "./ui";

export const lerValor = (s: string) => Number(String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));

export default function VerbaAba() {
  const { painel, recarregar, periodoId, setPeriodoId } = useTrafego();
  const { aprovador } = useMkt();
  const [editando, setEditando] = useState<Periodo | "novo" | null>(null);
  if (!painel || painel.faltaBanco) return null;
  const p = painel.periodo;
  const v = painel.verba;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(painel.periodos?.length ?? 0) > 1 && (
          <select className="rel-input max-w-[320px]" value={periodoId ?? p?.id ?? ""} onChange={(e) => setPeriodoId(e.target.value || null)} aria-label="Período">
            {painel.periodos!.map((x) => <option key={x.id} value={x.id}>{x.nome} · {dataBr(x.inicio)} a {dataBr(x.fim)}{x.ativo ? "" : " (desligado)"}</option>)}
          </select>
        )}
        {aprovador && p && <Botao onClick={() => setEditando(p)}>Editar período</Botao>}
        {aprovador && <Botao variante={p ? "fantasma" : "primario"} onClick={() => setEditando("novo")}>+ Novo período</Botao>}
      </div>

      {!p ? (
        <div className="rel-card">
          <Vazio titulo="Nenhum período de verba" texto={aprovador ? "Cadastre quanto pode gastar e até quando (ex.: R$ 15.000 de 01/11 a 15/11). O QS acompanha o ritmo e avisa antes de estourar." : "O gestor de Marketing cadastra o período de verba (quanto e até quando)."}
            acao={aprovador ? <Botao variante="primario" onClick={() => setEditando("novo")}>Cadastrar período</Botao> : undefined} />
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{p.nome}</h2>
            <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{dataBr(p.inicio)} a {dataBr(p.fim)} · verba {brl(Number(p.valor))}{!p.ativo ? " · desligado (as travas não olham)" : ""}</p>
          </div>
          {(painel.alertas ?? []).map((a) => <Aviso key={a.chave} tom={a.tom}>{a.texto}</Aviso>)}
          {v ? <Ritmo v={v} valor={Number(p.valor)} vitalicias={painel.orcamento?.vitalicias ?? 0} /> : null}
          {(painel.cotas?.length ?? 0) > 0 && <Cotas cotas={painel.cotas!} />}
        </>
      )}

      {aprovador && <QuemRecebe />}

      {editando && (
        <EditorPeriodo inicial={editando === "novo" ? null : editando} onFechar={() => setEditando(null)}
          onSalvo={async (id) => { setEditando(null); setPeriodoId(id || null); /* 04/11/2026: apagar devolve "" → volta pro período de hoje */ await recarregar(); }} />
      )}
    </div>
  );
}

function Ritmo({ v, valor, vitalicias }: { v: Verba; valor: number; vitalicias: number }) {
  const acima = v.acimaDoRitmo > 0.5;
  return (
    <>
      <div className="rel-card px-4 py-4"><BarraVerba pctVerba={v.pctVerba} pctTempo={v.pctTempo} /></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Numero rotulo="Gasto no período" valor={brl(v.gasto)} dica={`de ${brl(valor)} · hoje ${brl(v.gastoHoje)}`} tom={v.pctVerba >= 100 ? "erro" : undefined} />
        <Numero rotulo="Saldo" valor={brl(v.saldo)} dica={`${v.diasRestantes} dia(s) pela frente, contando hoje`} tom={v.saldo <= 0 ? "erro" : undefined} />
        <Numero rotulo="Ritmo ideal até agora" valor={brl(v.ritmoIdeal)}
          dica={acima ? `gastou ${brl(v.acimaDoRitmo)} a MAIS que o ritmo` : `${brl(-v.acimaDoRitmo)} abaixo do ritmo`} tom={acima ? "aviso" : "ok"} />
        <Numero rotulo="Diária máxima segura" valor={brl(v.diariaSegura)} dica="saldo ÷ dias que faltam: acima disso, não fecha" tom="ok" />
        <Numero rotulo="Projeção até o fim (ritmo atual)" valor={brl(v.projecao)}
          dica={v.sobraOuFaltaNaProjecao < 0 ? `estoura ${brl(-v.sobraOuFaltaNaProjecao)}${v.acabaNoDia ? ` · acaba dia ${dataBr(v.acabaNoDia)}` : ""}` : `sobra ${brl(v.sobraOuFaltaNaProjecao)} · média ${brl(v.mediaDiaria)}/dia`}
          tom={v.sobraOuFaltaNaProjecao < 0 ? "erro" : undefined} />
        <Numero rotulo="Programado na Meta (até o fim)" valor={brl(v.programado)}
          dica={<>
            {brl(v.orcamentoDiario)}/dia ativos{v.estouroProgramado > 0 ? <> · <b>estoura {brl(v.estouroProgramado)} no dia {dataBr(v.estouraNoDia)}</b></> : " · cabe no saldo"}
            {vitalicias ? ` · ${vitalicias} com orçamento vitalício (fora da conta)` : ""}
          </>}
          tom={v.estouroProgramado > 0 ? "erro" : "ok"} />
      </div>
      <p className="text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>
        {pct(v.pctTempo)} do período passou e {pct(v.pctVerba)} da verba foi gasta. "Programado" é a soma dos orçamentos diários que estão valendo na Meta agora
        (CBO pela campanha, ABO pelos conjuntos) × os dias que faltam — se alguém subir um orçamento lá, muda aqui na próxima leitura e o QS avisa.
      </p>
    </>
  );
}

function Cotas({ cotas }: { cotas: (Cota & { verba: Verba })[] }) {
  return (
    <div className="rel-card overflow-x-auto">
      <table className="w-full min-w-[620px] text-[13px]">
        <thead style={{ color: "var(--ink3)" }}><tr>
          <th className={TH}>Divisão</th><th className={TH}>Verba</th><th className={TH}>Gasto</th><th className={TH}>% gasto</th><th className={TH}>Diária segura</th><th className={TH}>Programado</th>
        </tr></thead>
        <tbody>
          {cotas.map((q) => (
            <tr key={`${q.tipo}:${q.alvo}`} className="border-t" style={{ borderColor: "var(--line)" }}>
              <td className={TD}>{q.rotulo}<span className="ml-1 text-[11px]" style={{ color: "var(--ink3)" }}>{q.tipo === "campanha" ? "campanha" : "destino"}</span></td>
              <td className={TD}>{brl(Number(q.valor))}</td>
              <td className={TD}>{brl(q.verba.gasto)}</td>
              <td className={TD} style={{ color: q.verba.pctVerba >= 100 ? "var(--err-ink)" : q.verba.pctVerba > q.verba.pctTempo + 2 ? "var(--warn-ink)" : undefined }}>{pct(q.verba.pctVerba)}</td>
              <td className={TD}>{brl(q.verba.diariaSegura)}</td>
              <td className={TD} style={{ color: q.verba.estouroProgramado > 0 ? "var(--err-ink)" : undefined }}>{q.verba.estouroProgramado > 0 ? `estoura ${brl(q.verba.estouroProgramado)}` : "cabe"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuemRecebe() {
  const { painel, recarregar } = useTrafego();
  const { pessoas } = useMkt();
  const atuais = painel?.config?.avisar_ids ?? [];
  const [salvando, setSalvando] = useState(false);
  async function alternar(id: string) {
    const novo = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id];
    setSalvando(true);
    try { await salvarQuemRecebe(novo); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }
  return (
    <div className="rel-card px-4 py-3">
      <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Quem recebe os avisos de tráfego no sino</p>
      <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink3)" }}>
        {atuais.length ? "Só as pessoas marcadas." : "Ninguém marcado = quem tem o papel Tráfego, os gestores de Marketing e os admins."}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {pessoas.map((p) => {
          const on = atuais.includes(p.id);
          return (
            <button key={p.id} type="button" disabled={salvando} onClick={() => void alternar(p.id)} aria-pressed={on}
              className="rounded-full px-3 py-1 text-[12.5px] font-medium"
              style={{ background: on ? "var(--rel)" : "var(--card2)", color: on ? "#fff" : "var(--ink2)", border: "1px solid var(--line)" }}>
              {p.nome}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EditorPeriodo({ inicial, onFechar, onSalvo }: { inicial: Periodo | null; onFechar: () => void; onSalvo: (id: string) => void }) {
  const { painel } = useTrafego();
  const hoje = painel?.hoje ?? new Date().toISOString().slice(0, 10);
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [inicio, setInicio] = useState(inicial?.inicio ?? hoje);
  const [fim, setFim] = useState(inicial?.fim ?? hoje);
  const [valor, setValor] = useState(inicial ? String(inicial.valor).replace(".", ",") : "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [cotas, setCotas] = useState<Cota[]>(inicial?.cotas ?? []);
  const [salvando, setSalvando] = useState(false);
  const total = lerValor(valor);
  const somaCotas = cotas.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const ok = nome.trim().length >= 2 && total > 0 && fim >= inicio && cotas.every((c) => c.alvo && c.valor > 0);
  const destinos = painel?.destinos ?? [];
  const campanhas = painel?.campanhas ?? [];

  async function salvar() {
    setSalvando(true);
    try {
      const id = await salvarPeriodo({ id: inicial?.id, nome: nome.trim(), inicio, fim, valor: total, cotas, ativo });
      // Período novo já nasce com a trava de verba (80% avisa, 100% passa do limite) — em "só avisar".
      if (!inicial) {
        await salvarRegra({ nome: `Verba: ${nome.trim()}`, ativa: true, periodo_id: id, escopo: "periodo", alvo: null, alvo_rotulo: null, metrica: "verba_pct", limite: 100, gasto_minimo: 0, horas: null, acao: "avisar" })
          .catch(() => notifyError("Período salvo, mas a trava de verba não foi criada (crie na aba Travas)."));
      }
      notifySuccess("Período salvo."); onSalvo(id);
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }
  async function apagar() {
    if (!inicial || !confirm(`Apagar o período "${inicial.nome}"? As travas presas a ele também somem.`)) return;
    try { await apagarPeriodo(inicial.id); notifySuccess("Período apagado."); onSalvo(""); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não apagou."); }
  }

  return (
    <Modal aberto titulo={inicial ? `Período · ${inicial.nome}` : "Novo período de verba"} onFechar={onFechar} largura={640}
      rodape={<>
        {inicial && <Botao variante="perigo" onClick={() => void apagar()} className="mr-auto">Apagar</Botao>}
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
        <Botao variante="primario" disabled={!ok || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
      </>}>
      <div className="flex flex-col gap-3">
        <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Novembro — 1ª quinzena" /></Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="De"><Entrada type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></Campo>
          <Campo rotulo="Até (inclusive)"><Entrada type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>
          <Campo rotulo="Verba total (R$)" dica={total > 0 ? brl(total) : undefined}><Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="15.000" /></Campo>
        </div>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo (as travas olham este período)
        </label>

        <div>
          <p className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Divisão (opcional)</p>
          <p className="mb-2 text-[12px]" style={{ color: "var(--ink3)" }}>Separe parte da verba por destino ou campanha. Cada parte ganha o próprio ritmo, e a trava de verba de um destino usa a parte dele.</p>
          {cotas.map((c, i) => (
            <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[120px_1fr_130px_auto]">
              <select className="rel-input" value={c.tipo} onChange={(e) => setCotas(cotas.map((x, j) => (j === i ? { ...x, tipo: e.target.value as Cota["tipo"], alvo: "", rotulo: "" } : x)))}>
                <option value="destino">Destino</option><option value="campanha">Campanha</option>
              </select>
              <select className="rel-input" value={c.alvo} onChange={(e) => {
                const alvo = e.target.value;
                const rotulo = c.tipo === "destino" ? destinos.find((d) => d.chave === alvo)?.rotulo ?? alvo : campanhas.find((x) => x.id === alvo)?.nome ?? alvo;
                setCotas(cotas.map((x, j) => (j === i ? { ...x, alvo, rotulo } : x)));
              }}>
                <option value="">Escolha…</option>
                {c.tipo === "destino"
                  ? destinos.map((d) => <option key={d.chave} value={d.chave}>{d.rotulo}</option>)
                  : campanhas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
              <Entrada inputMode="decimal" placeholder="R$" value={c.valor ? String(c.valor).replace(".", ",") : ""} onChange={(e) => setCotas(cotas.map((x, j) => (j === i ? { ...x, valor: lerValor(e.target.value) || 0 } : x)))} />
              <Botao variante="fantasma" onClick={() => setCotas(cotas.filter((_, j) => j !== i))} aria-label="Tirar">×</Botao>
            </div>
          ))}
          <Botao variante="secundario" onClick={() => setCotas([...cotas, { tipo: "destino", alvo: "", rotulo: "", valor: 0 }])}>+ Adicionar parte</Botao>
          {somaCotas > total && total > 0 && <p className="mt-2 text-[12px]" style={{ color: "var(--err-ink)" }}>As partes somam {brl(somaCotas)}, mais que a verba total.</p>}
        </div>
        {!inicial && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Ao salvar, o QS cria a trava "Verba" deste período (avisa em 80% e quando passar de 100%), em modo <b>só avisar</b>. Pra ela pausar tudo ao estourar, ligue na aba Travas.</p>}
      </div>
    </Modal>
  );
}
