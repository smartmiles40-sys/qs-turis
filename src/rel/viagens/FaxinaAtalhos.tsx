// src/rel/viagens/FaxinaAtalhos.tsx
// -----------------------------------------------------------------------------
// ATALHOS DA FAXINA na Lista de Viagens (0208, 27/10/2026). Uma faixa com o
// tamanho de cada fila de arrumação — clicou, a lista abre nela:
//
//   Sem dono · Classificar · Sem data · Repetidas? · Sem cliente · Vendas soltas
//
// "Repetidas?" e "Vendas soltas" também têm as CANDIDATAS que o banco achou
// (mesma pessoa, ida a ≤3 dias): a gestão confere e marca / junta. Antes da
// 0208 no banco, mostra só as três contagens que já existiam (0184).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { dataBR, pendenciasViagens, SERVICOS, type FiltroViagens, type Servico } from "../lib/viagens";
import {
  anexarComoComponente, componentesSoltos, marcarRepetidas, paresRepetidos, resumoFaxina,
  type ComponenteSolto, type ParRepetido, type ResumoFaxina,
} from "../lib/faxina";
import { Aviso, Modal } from "../ui";

interface Chip { id: FiltroViagens | "soltas"; rotulo: string; n: number; extra?: string; tom?: "warn" | "danger" }

export default function FaxinaAtalhos({ filtro, onFiltro, gestor, versao, onMudou, onAbrirViagem, onConferirRepetidas }: {
  filtro: FiltroViagens; onFiltro: (f: FiltroViagens) => void; gestor: boolean; versao: number; onMudou: () => void;
  onAbrirViagem: (id: string) => void; onConferirRepetidas: () => void;
}) {
  const [r, setR] = useState<ResumoFaxina | null>(null);
  const [antigo, setAntigo] = useState<{ semData: number; classificar: number; semDono: number } | null>(null);
  const [painel, setPainel] = useState<"repetidas" | "soltas" | null>(null);

  useEffect(() => {
    let vivo = true;
    resumoFaxina()
      .then((x) => {
        if (!vivo) return;
        setR(x);
        if (!x) pendenciasViagens().then((p) => { if (vivo) setAntigo(p); }).catch(() => {});
      })
      .catch(() => { pendenciasViagens().then((p) => { if (vivo) setAntigo(p); }).catch(() => {}); });
    return () => { vivo = false; };
  }, [versao]);

  const chips: Chip[] = r ? [
    { id: "sem_dono", rotulo: "Sem dono", n: r.sem_dono, tom: r.sem_dono ? "danger" : undefined },
    { id: "classificar", rotulo: "Classificar", n: r.classificar, extra: r.classificar_com_sugestao ? `${r.classificar_com_sugestao} com sugestão` : undefined, tom: r.classificar_futuras ? "warn" : undefined },
    { id: "sem_data", rotulo: "Sem data", n: r.sem_data, extra: r.sem_data_com_voo ? `${r.sem_data_com_voo} já têm voo` : undefined },
    { id: "repetidas", rotulo: "Repetidas?", n: r.repetidas_marcadas, extra: r.repetidas_candidatas ? `+${r.repetidas_candidatas} pares novos` : undefined, tom: r.repetidas_marcadas ? "warn" : undefined },
    { id: "sem_cliente", rotulo: "Sem cliente", n: r.sem_cliente },
    { id: "soltas", rotulo: "Vendas soltas", n: r.componentes_soltos, extra: "seguro/hotel da mesma viagem" },
  ] : antigo ? [
    { id: "sem_dono", rotulo: "Sem dono", n: antigo.semDono, tom: antigo.semDono ? "danger" : undefined },
    { id: "classificar", rotulo: "Classificar", n: antigo.classificar, tom: antigo.classificar ? "warn" : undefined },
    { id: "sem_data", rotulo: "Sem data", n: antigo.semData },
    { id: "repetidas", rotulo: "Repetidas?", n: -1 },
    { id: "sem_cliente", rotulo: "Sem cliente", n: -1 },
  ] : [];

  if (!chips.length) return null;
  return (
    <div className="mb-3">
      <p className="qs-label mb-1.5">Faxina das viagens</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filas de arrumação">
        {chips.map((c) => {
          const ativo = c.id === filtro;
          return (
            <button key={c.id} type="button" aria-pressed={ativo}
              onClick={() => (c.id === "soltas" ? setPainel("soltas") : onFiltro(c.id))}
              className="qs-card text-left px-3 py-2 min-w-[118px]"
              style={ativo ? { borderColor: "var(--text)", background: "var(--surface-2)" } : undefined}>
              <span className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium" style={{ color: "var(--muted)" }}>{c.rotulo}</span>
                {c.n >= 0 && <span className={`qs-num text-[15px] font-semibold ${c.tom === "danger" ? "qs-tone-danger" : c.tom === "warn" ? "qs-tone-warn" : ""}`} style={c.tom ? undefined : { color: "var(--text)" }}>{c.n}</span>}
              </span>
              {c.extra && <span className="block text-[11.5px]" style={{ color: "var(--subtle)" }}>{c.extra}</span>}
            </button>
          );
        })}
      </div>
      {filtro === "repetidas" && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Button size="sm" onClick={onConferirRepetidas}>Conferir lado a lado</Button>
          {r && r.repetidas_candidatas > 0 && <Button size="sm" variant="ghost" onClick={() => setPainel("repetidas")}>Ver {r.repetidas_candidatas} pares novos</Button>}
        </div>
      )}
      <ParesRepetidos aberto={painel === "repetidas"} gestor={gestor} onFechar={() => setPainel(null)} onMudou={onMudou} onAbrirViagem={onAbrirViagem} />
      <VendasSoltas aberto={painel === "soltas"} gestor={gestor} onFechar={() => setPainel(null)} onMudou={onMudou} onAbrirViagem={onAbrirViagem} />
    </div>
  );
}

// ── Pares repetidos novos ───────────────────────────────────────────────────

function ParesRepetidos({ aberto, gestor, onFechar, onMudou, onAbrirViagem }: { aberto: boolean; gestor: boolean; onFechar: () => void; onMudou: () => void; onAbrirViagem: (id: string) => void }) {
  const [pares, setPares] = useState<ParRepetido[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    setPares(null); setMsg(null);
    paresRepetidos().then((l) => { setPares(l); setSel(new Set(l.filter((p) => p.futura).map((p) => p.marcar))); })
      .catch((e) => { setPares([]); setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não carregou." }); });
  }, [aberto]);

  async function marcar() {
    setOcupado(true); setMsg(null);
    try { const n = await marcarRepetidas([...sel]); setMsg({ tom: "ok", t: `${n} marcada${n === 1 ? "" : "s"} pra conferir. Elas aparecem em "Repetidas?" e em "Conferir repetidas".` }); onMudou(); }
    catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
    finally { setOcupado(false); }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} largura={760} titulo="Possíveis repetidas (pares novos)"
      rodape={<><Button variant="ghost" onClick={onFechar}>Fechar</Button>{gestor && <Button variant="primary" disabled={!sel.size || ocupado} onClick={() => void marcar()}>Marcar {sel.size || ""} pra conferir</Button>}</>}>
      <p className="text-[12.5px] mb-2" style={{ color: "var(--muted)" }}>
        Mesma pessoa, duas vendas ativas com ida a até 3 dias. Pode ser venda repetida no Bitrix — ou a família comprando em cards separados. Marcar só manda pra conferência; ninguém some.
        {!gestor && " Marcar é com a gestão."}
      </p>
      {msg && <div className="mb-2"><Aviso tom={msg.tom}>{msg.t}</Aviso></div>}
      {pares === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : pares.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Nenhum par novo.</p> : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {pares.map((p) => (
            <li key={`${p.viagem_a}-${p.viagem_b}`} className="py-2 flex items-start gap-2 text-[13px]" style={{ color: "var(--text)" }}>
              {gestor && <input type="checkbox" className="mt-1" checked={sel.has(p.marcar)} aria-label="Marcar pra conferir"
                onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.marcar); else n.delete(p.marcar); return n; })} />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{p.cliente_nome ?? "—"} {p.futura ? <Badge tone="warn">vai acontecer</Badge> : null}</p>
                <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  <button className="underline" onClick={() => onAbrirViagem(p.viagem_a)}>{p.titulo_a}</button> ({dataBR(p.ida_a)}{p.deal_a ? ` · #${p.deal_a}` : ""})
                  {" × "}
                  <button className="underline" onClick={() => onAbrirViagem(p.viagem_b)}>{p.titulo_b}</button> ({dataBR(p.ida_b)}{p.deal_b ? ` · #${p.deal_b}` : ""})
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ── Vendas soltas (componente de outra viagem) ──────────────────────────────

function VendasSoltas({ aberto, gestor, onFechar, onMudou, onAbrirViagem }: { aberto: boolean; gestor: boolean; onFechar: () => void; onMudou: () => void; onAbrirViagem: (id: string) => void }) {
  const [l, setL] = useState<ComponenteSolto[] | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const carregar = () => componentesSoltos().then(setL).catch((e) => { setL([]); setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não carregou." }); });
  useEffect(() => { if (aberto) { setL(null); setMsg(null); void carregar(); } }, [aberto]);

  async function juntar(c: ComponenteSolto) {
    if (!window.confirm(`"${c.avulsa_titulo}" vira um item da viagem "${c.principal_titulo}" e sai das filas (arquivada).\n\nDá pra desfazer em Arquivadas → Desarquivar.`)) return;
    setOcupado(c.avulsa_id); setMsg(null);
    try { await anexarComoComponente(c.principal_id, c.avulsa_id); setMsg({ tom: "ok", t: `"${c.avulsa_titulo}" agora é componente de "${c.principal_titulo}".` }); onMudou(); await carregar(); }
    catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); }
    finally { setOcupado(null); }
  }

  const rotulo = (s: string | null) => (s && s in SERVICOS ? SERVICOS[s as Servico] : s === "classificar" ? "a classificar" : s ?? "—");
  return (
    <Modal aberto={aberto} onFechar={onFechar} largura={760} titulo="Vendas soltas da mesma viagem"
      rodape={<Button variant="ghost" onClick={onFechar}>Fechar</Button>}>
      <p className="text-[12.5px] mb-2" style={{ color: "var(--muted)" }}>
        Seguro, hotel ou passeio vendido num card separado, para a mesma pessoa e com ida a até 3 dias de um pacote/aéreo/expedição.
        Juntar faz dele um componente da viagem principal — tudo numa tela só.{!gestor && " Juntar é com a gestão."}
      </p>
      {msg && <div className="mb-2"><Aviso tom={msg.tom}>{msg.t}</Aviso></div>}
      {l === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : l.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Nenhuma venda solta encontrada.</p> : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {l.map((c) => (
            <li key={`${c.avulsa_id}-${c.principal_id}`} className="py-2 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--text)" }}>
              <div className="flex-1 min-w-[260px]">
                <p className="font-semibold">{c.cliente_nome ?? "—"} {c.futura ? <Badge tone="warn">vai acontecer</Badge> : null}</p>
                <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                  <button className="underline" onClick={() => onAbrirViagem(c.avulsa_id)}>{c.avulsa_titulo}</button> ({rotulo(c.avulsa_servico)}, {dataBR(c.avulsa_ida)})
                  {" → "}
                  <button className="underline" onClick={() => onAbrirViagem(c.principal_id)}>{c.principal_titulo}</button> ({rotulo(c.principal_servico)}, {dataBR(c.principal_ida)})
                </p>
              </div>
              {gestor && <Button size="sm" disabled={ocupado === c.avulsa_id} onClick={() => void juntar(c)}>{ocupado === c.avulsa_id ? "Juntando…" : "Juntar"}</Button>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
