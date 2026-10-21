// src/clientes/FilaDivergencias.tsx
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO (0172): as informações que estão DIFERENTES entre a ficha do
// cliente (rel_clientes) e as idas dele nas expedições (passageiros). O banco
// não escolhe no chute — fica em cad_divergencias até alguém decidir:
//   • campo (CPF, passaporte, validade, nascimento, e-mail, telefone):
//     "Vale o da ficha" / "Vale o da expedição" → grava nos dois lados;
//   • pessoa (a importação de 13/10 tinha posto esse passageiro noutra ficha):
//     "É a mesma pessoa" (volta pra ficha antiga) / "É outra pessoa" (fica).
// Com `clienteId`: só as daquela ficha (some quando não há nada). Sem: a fila
// inteira agrupada por cliente, com busca. Relacionamento e Operações usam o
// mesmo componente. Antes da 0172 a tabela não existe: some (ficha) ou avisa.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { NOME_CAMPO, divergenciasAbertas, resolverDivergencia, valorLegivel, type Divergencia } from "./cadastroUnico";
import { contextoDivergencias, faltaCadastroUnico, type ContextoDivergencias } from "./idasDetalhe";
import { Aviso, Botao, Entrada, Etiqueta } from "@/rel/ui";

type Escolha = "ficha" | "expedicao" | "mesma" | "outra";

const POR_PAGINA = 40;

export default function FilaDivergencias({ clienteId, onAbrirCliente, onAbrirPassageiro, onMudou }: {
  /** Só as divergências desta ficha. Sem: a fila inteira. */
  clienteId?: string;
  onAbrirCliente?: (id: string) => void;
  /** Abre o passageiro dentro da expedição (opcional). */
  onAbrirPassageiro?: (expedicaoId: string, tipo: string | null | undefined, passageiroId: string) => void;
  /** Avisa quem está em volta (contadores, ficha) que algo foi resolvido. */
  onMudou?: () => void;
}) {
  const [lista, setLista] = useState<Divergencia[] | null>(null);
  const [ativo, setAtivo] = useState(true);
  const [ctx, setCtx] = useState<ContextoDivergencias>({ clientes: {}, passageiros: {} });
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mostrar, setMostrar] = useState(POR_PAGINA);

  const carregar = useCallback(async () => {
    try {
      const l = await divergenciasAbertas(clienteId);
      setAtivo(true); setErro(null); setLista(l);
      const c = await contextoDivergencias(
        [...l.map((d) => d.cliente_id), ...l.map((d) => d.ficha_sugerida).filter((x): x is string => !!x)],
        l.map((d) => d.passageiro_id),
      );
      setCtx(c);
    } catch (e) {
      if (faltaCadastroUnico(e)) { setAtivo(false); setLista([]); return; }
      setErro(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Não carregou as divergências.");
      setLista([]);
    }
  }, [clienteId]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  async function resolver(d: Divergencia, escolha: Escolha, msg: string) {
    setOcupado(d.id); setErro(null); setOk(null);
    try {
      await resolverDivergencia(d.id, escolha);
      setOk(msg);
      await carregar();
      onMudou?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Não consegui resolver.");
    } finally { setOcupado(null); }
  }

  const grupos = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const m = new Map<string, Divergencia[]>();
    for (const d of lista ?? []) {
      if (t) {
        const pax = ctx.passageiros[d.passageiro_id];
        const alvo = [ctx.clientes[d.cliente_id], pax?.nome, pax?.expedicao, d.valor_ficha, d.valor_expedicao, NOME_CAMPO[d.campo]].join(" ").toLowerCase();
        if (!alvo.includes(t)) continue;
      }
      const g = m.get(d.cliente_id);
      if (g) g.push(d); else m.set(d.cliente_id, [d]);
    }
    return [...m.entries()].sort((a, b) => (ctx.clientes[a[0]] ?? "").localeCompare(ctx.clientes[b[0]] ?? ""));
  }, [lista, ctx, busca]);

  // ── Na ficha: só aparece quando tem algo pra decidir ──
  if (clienteId) {
    if (!ativo || lista === null || (lista.length === 0 && !ok && !erro)) return null;
    return (
      <section className="rounded-[14px] p-4 sm:p-5 border" style={{ background: "var(--warn-bg)", borderColor: "var(--warn-line)" }} aria-label="Informações diferentes">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--warn-ink)" }}>
          {lista.length === 0 ? "Tudo certo entre a ficha e as expedições" : `${lista.length} ${lista.length === 1 ? "informação diferente" : "informações diferentes"} entre a ficha e as expedições`}
        </h2>
        {lista.length > 0 && (
          <p className="text-[12.5px] mt-0.5 mb-2" style={{ color: "var(--warn-ink)" }}>
            Escolha qual vale: o valor escolhido vai pra ficha e pra todas as viagens da pessoa.
          </p>
        )}
        {erro && <div className="mb-2"><Aviso tom="erro">{erro}</Aviso></div>}
        {ok && lista.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--warn-ink)" }}>{ok}</p>}
        <ul className="space-y-2">
          {lista.map((d) => <ItemDivergencia key={d.id} d={d} ctx={ctx} ocupado={ocupado} onResolver={resolver} onAbrirCliente={onAbrirCliente} onAbrirPassageiro={onAbrirPassageiro} />)}
        </ul>
      </section>
    );
  }

  // ── A fila inteira ──
  if (!ativo) return <Aviso>Aguardando a ativação do cadastro único. Quando estiver ligado, aqui aparecem as informações diferentes entre as fichas e as expedições.</Aviso>;
  if (lista === null) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
        CPF, passaporte, validade, nascimento, e-mail e telefone que estão diferentes entre a ficha do cliente e a inscrição na expedição.
        O que você escolher vai pra ficha e pra todas as viagens da pessoa. "Pessoa": a importação de 13/10 tinha posto esse passageiro noutra ficha.
      </p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="ok">{ok}</Aviso>}
      {lista.length > 0 && (
        <Entrada placeholder="Buscar por cliente, expedição ou valor…" value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(POR_PAGINA); }} />
      )}
      {lista.length === 0 ? (
        <div className="rel-card p-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nada diferente entre as fichas e as expedições.</div>
      ) : grupos.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada encontrado com essa busca.</p>
      ) : (
        <>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{grupos.length} cliente{grupos.length > 1 ? "s" : ""} · {grupos.reduce((n, g) => n + g[1].length, 0)} item(ns)</p>
          <ul className="space-y-2">
            {grupos.slice(0, mostrar).map(([cid, itens]) => (
              <li key={cid} className="rel-card p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <b className="text-[14px]" style={{ color: "var(--ink)" }}>{ctx.clientes[cid] ?? "Ficha"}</b>
                  <Etiqueta>{itens.length}</Etiqueta>
                  <span className="flex-1" />
                  {onAbrirCliente && <Botao variante="fantasma" onClick={() => onAbrirCliente(cid)}>Abrir ficha</Botao>}
                </div>
                <ul className="space-y-2">
                  {itens.map((d) => <ItemDivergencia key={d.id} d={d} ctx={ctx} ocupado={ocupado} onResolver={resolver} onAbrirCliente={onAbrirCliente} onAbrirPassageiro={onAbrirPassageiro} />)}
                </ul>
              </li>
            ))}
          </ul>
          {grupos.length > mostrar && (
            <div className="flex justify-center"><Botao onClick={() => setMostrar((n) => n + POR_PAGINA)}>Mostrar mais ({grupos.length - mostrar})</Botao></div>
          )}
        </>
      )}
    </div>
  );
}

function ItemDivergencia({ d, ctx, ocupado, onResolver, onAbrirCliente, onAbrirPassageiro }: {
  d: Divergencia;
  ctx: ContextoDivergencias;
  ocupado: string | null;
  onResolver: (d: Divergencia, escolha: Escolha, msg: string) => void;
  onAbrirCliente?: (id: string) => void;
  onAbrirPassageiro?: (expedicaoId: string, tipo: string | null | undefined, passageiroId: string) => void;
}) {
  const pax = ctx.passageiros[d.passageiro_id];
  const travado = ocupado !== null;
  const ondeExp = pax?.expedicao ?? "expedição";
  const linkPax = onAbrirPassageiro && pax?.expedicao_id
    ? <button type="button" className="underline" onClick={() => onAbrirPassageiro(pax.expedicao_id!, pax.tipo, d.passageiro_id)}>{ondeExp}</button>
    : <>{ondeExp}</>;

  if (d.campo === "pessoa") {
    const antiga = d.ficha_sugerida ? ctx.clientes[d.ficha_sugerida] ?? d.valor_ficha : d.valor_ficha;
    return (
      <li className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
        <p className="text-[13px]" style={{ color: "var(--ink)" }}>
          <b>Pessoa</b> · o passageiro <b>{d.valor_expedicao ?? pax?.nome ?? "—"}</b> em {linkPax} estava, na importação de 13/10, na ficha de{" "}
          {d.ficha_sugerida && onAbrirCliente
            ? <button type="button" className="underline font-semibold" onClick={() => onAbrirCliente(d.ficha_sugerida!)}>{antiga ?? "outra pessoa"}</button>
            : <b>{antiga ?? "outra pessoa"}</b>}.
          {" "}É a mesma pessoa daquela ficha?
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Botao disabled={travado || !d.ficha_sugerida} onClick={() => onResolver(d, "mesma", `Passageiro levado pra ficha de ${antiga ?? "origem"}.`)}>
            {ocupado === d.id ? "Salvando…" : "É a mesma pessoa"}
          </Botao>
          <Botao disabled={travado} onClick={() => onResolver(d, "outra", "Anotado: é outra pessoa, fica nesta ficha.")}>É outra pessoa</Botao>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg p-3" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
      <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{NOME_CAMPO[d.campo]}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5">
        <div className="rounded-md px-2.5 py-2" style={{ background: "var(--card2)" }}>
          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>Na ficha</span>
          <span className="block text-[13.5px] font-semibold break-all" style={{ color: "var(--ink)" }}>{valorLegivel(d.campo, d.valor_ficha)}</span>
        </div>
        <div className="rounded-md px-2.5 py-2" style={{ background: "var(--card2)" }}>
          <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>Em {linkPax}{pax?.nome ? ` (${pax.nome})` : ""}</span>
          <span className="block text-[13.5px] font-semibold break-all" style={{ color: "var(--ink)" }}>{valorLegivel(d.campo, d.valor_expedicao)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <Botao disabled={travado} onClick={() => onResolver(d, "ficha", `${NOME_CAMPO[d.campo]}: ficou o da ficha.`)}>
          {ocupado === d.id ? "Salvando…" : "Vale o da ficha"}
        </Botao>
        <Botao disabled={travado} onClick={() => onResolver(d, "expedicao", `${NOME_CAMPO[d.campo]}: ficou o da expedição.`)}>Vale o da expedição</Botao>
      </div>
    </li>
  );
}
