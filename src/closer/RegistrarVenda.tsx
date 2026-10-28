// src/closer/RegistrarVenda.tsx
// -----------------------------------------------------------------------------
// "REGISTRAR VENDA" (0207, Bruno 27/10/2026): "criar todas as variáveis
// coletando quando for cada tipo de venda: Aéreo, pacote, seguro, expedição…
// 100% didático e fácil de preencher".
//
// Três passos, um de cada vez:
//   1. O que o cliente comprou? — cartões grandes, dá pra marcar vários;
//   2. Os detalhes — um formulário curto por item, gerado do catálogo
//      (TIPOS[tipo].campos em src/propostas/lib.ts). Quase nada é obrigatório:
//      o que o closer não souber agora o Relacionamento completa;
//   3. Valores e passageiros — valor de cada item, total somado, quem viaja.
// No fim (27/10, um caminho só): "Salvar e marcar como venda" — grava os itens
// e já faz a pré-venda (sobe pro Dashboard pelo Bitrix na hora). "Salvar
// rascunho" fica discreto, pra quem ainda não fechou. Venda já marcada: o
// "Salvar" regrava os itens e manda o valor novo pro Dashboard.
//
// Se já houver itens salvos, abre com eles. Se não, e houver proposta
// APROVADA, abre com os itens dela.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Stepper } from "@/components/ui";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import {
  ORDEM_TIPOS_VENDA, TIPOS, camposDoTipo, datasDoTipo, tipoVendaBitrix, type CampoTipo, type TipoItem,
} from "@/propostas/lib";
import { brl, emPreVenda, nomeDoLead, type Negocio } from "./lib";
import {
  itemPrincipal, itemVendaVazio, itensDaPropostaAprovada, listarItensDaVenda, marcarPreVenda, nomeSugerido,
  salvarItensDaVenda, somaDosItens, type ItemVenda, type ResultadoPreVenda,
} from "./vendaItens";

const PASSOS = ["O que vendeu", "Detalhes", "Valores e passageiros"] as const;

/** "1.234,56" / "1234.56" / "1234" → número (ou null se vazio). */
function lerValor(t: string): number | null {
  const s = t.trim();
  if (!s) return null;
  const n = /^\d+\.\d{1,2}$/.test(s) ? Number(s) : Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const mostrarValor = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

function CampoDoTipo({ c, valor, onMudar }: { c: CampoTipo; valor: string; onMudar: (v: string) => void }) {
  return (
    <div className={c.largo ? "sm:col-span-2" : ""}>
      <Campo rotulo={c.rotulo} dica={c.dica}>
        {c.tipo === "select" ? (
          <select className="rel-input" value={valor} onChange={(e) => onMudar(e.target.value)}>
            {(c.opcoes ?? []).map((o) => <option key={o} value={o}>{o || "Escolha…"}</option>)}
          </select>
        ) : c.tipo === "area" ? (
          <textarea className="rel-input" rows={3} value={valor} onChange={(e) => onMudar(e.target.value)} />
        ) : (
          <Entrada type={c.tipo === "hora" ? "time" : c.tipo === "numero" ? "number" : c.tipo === "data" ? "date" : "text"}
            value={valor} onChange={(e) => onMudar(e.target.value)} />
        )}
      </Campo>
    </div>
  );
}

export default function RegistrarVenda({ negocio, aberto, onFechar, onSalvo }: {
  negocio: Negocio;
  aberto: boolean;
  onFechar: () => void;
  onSalvo: (r: ResultadoPreVenda) => void;
}) {
  const [passo, setPasso] = useState(0);
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [passageirosTxt, setPassageirosTxt] = useState("");
  const [origem, setOrigem] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const consolidada = !!negocio.consolidada_em;
  const jaPreVenda = emPreVenda(negocio);

  // Abre com o que já foi salvo; senão, com a proposta aprovada.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true);
    (async () => {
      let lista = await listarItensDaVenda(negocio.id);
      let de: string | null = null;
      if (!lista.length) {
        const p = await itensDaPropostaAprovada(negocio.lead_id).catch(() => null);
        if (p) { lista = p.itens; de = `Já trouxe os itens da ${p.origem}. Confira e ajuste o que mudou.`; }
      }
      if (!vivo) return;
      setItens(lista);
      setValores(Object.fromEntries(lista.map((i) => [i.k, mostrarValor(i.valor)])));
      setPassageirosTxt((lista.find((i) => i.passageiros.length)?.passageiros ?? []).map((p) => p.nome).join("\n"));
      setOrigem(de);
      setPasso(lista.length ? 1 : 0);
    })().catch((e) => setErro((e as Error).message)).finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [aberto, negocio.id, negocio.lead_id]);

  const tiposMarcados = useMemo(() => new Set(itens.map((i) => i.tipo)), [itens]);
  const comValores = itens.map((i) => ({ ...i, valor: lerValor(valores[i.k] ?? "") }));
  const total = somaDosItens(comValores);
  const passageiros = passageirosTxt.split("\n").map((s) => s.trim()).filter(Boolean);
  const principal = itemPrincipal(comValores);

  const mudarItem = (k: string, p: Partial<ItemVenda>) => setItens((l) => l.map((i) => (i.k === k ? { ...i, ...p } : i)));
  const mudarDado = (k: string, chave: string, v: string) => setItens((l) => l.map((i) => (i.k === k ? { ...i, dados: { ...i.dados, [chave]: v } } : i)));

  function alternarTipo(t: TipoItem) {
    setErro(null);
    if (!tiposMarcados.has(t)) { setItens((l) => [...l, itemVendaVazio(t)]); return; }
    const doTipo = itens.filter((i) => i.tipo === t);
    if (doTipo.some((i) => i.status && i.status !== "vendido")) {
      setErro(`${TIPOS[t].rotulo}: já tem item emitido pelo Relacionamento — esse não sai por aqui.`);
      return;
    }
    const temDados = doTipo.some((i) => i.nome || Object.values(i.dados).some(Boolean) || valores[i.k]);
    if (temDados && !window.confirm(`Tirar ${TIPOS[t].rotulo} da venda? O que você preencheu nele se perde.`)) return;
    setItens((l) => l.filter((i) => i.tipo !== t));
  }

  function avancar() {
    setErro(null);
    if (passo === 0 && !itens.length) { setErro("Toque em pelo menos um cartão: o que o cliente comprou?"); return; }
    if (passo === 1) {
      const errado = itens.find((i) => i.data_inicio && i.data_fim && i.data_fim < i.data_inicio);
      if (errado) { setErro(`${TIPOS[errado.tipo].rotulo}: a segunda data está antes da primeira.`); return; }
    }
    setPasso((p) => Math.min(p + 1, PASSOS.length - 1));
  }

  async function salvar(marcar: boolean) {
    setErro(null);
    const ruins = itens.filter((i) => (valores[i.k] ?? "").trim() && lerValor(valores[i.k]) == null);
    if (ruins.length) { setErro(`Valor que não entendi em ${TIPOS[ruins[0].tipo].rotulo}. Use só números, ex.: 12.500,00`); return; }
    if (total <= 0) { setErro("Coloque o valor de pelo menos um item (o total da venda não pode ficar zerado)."); return; }
    setSalvando(true);
    try {
      const pax = passageiros.map((nome) => ({ nome }));
      const final = comValores.map((i) => ({ ...i, passageiros: pax }));
      await salvarItensDaVenda(negocio.id, final);
      // Já marcada e o valor/tipo mudou: manda o novo pro Dashboard (precisa da 0211 no banco; sem ela, nada muda).
      const mudouValor = jaPreVenda && principal && (Math.abs(Number(negocio.pre_venda_valor ?? 0) - total) > 0.009 || negocio.pre_venda_tipo !== principal.tipo);
      if ((marcar || mudouValor) && principal) {
        onSalvo(await marcarPreVenda(negocio.id, { tipo: principal.tipo, valor: total }));
      } else {
        onSalvo({ tom: "ok", mensagem: marcar || jaPreVenda || consolidada
          ? `Venda salva: ${final.length} item(ns), ${brl(total)}.`
          : `Rascunho salvo (${brl(total)}). Ainda não conta como venda: quando fechar, abra de novo e use "Salvar e marcar como venda".` });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ultimo = passo === PASSOS.length - 1;
  return (
    <Modal aberto={aberto} titulo={`Registrar venda — ${nomeDoLead(negocio.lead)}`} onFechar={onFechar} largura={860}
      rodape={<>
        {passo > 0 ? <Botao variante="fantasma" onClick={() => { setErro(null); setPasso(passo - 1); }} disabled={salvando}>← Voltar</Botao>
          : <Botao variante="fantasma" onClick={onFechar} disabled={salvando}>Cancelar</Botao>}
        {!ultimo && <Botao variante="primario" onClick={avancar} disabled={carregando}>Continuar →</Botao>}
        {ultimo && (consolidada || jaPreVenda) && (
          <Botao variante="primario" onClick={() => void salvar(false)} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        )}
        {ultimo && !consolidada && !jaPreVenda && <>
          <Botao variante="fantasma" onClick={() => void salvar(false)} disabled={salvando} title="Guarda o que já preencheu, sem contar como venda">Salvar rascunho</Botao>
          <Botao variante="primario" onClick={() => void salvar(true)} disabled={salvando} title="Grava e já conta como venda no Dashboard">
            {salvando ? "Salvando…" : "Salvar e marcar como venda"}
          </Botao>
        </>}
      </>}>
      <div className="mb-4"><Stepper steps={PASSOS} current={passo} /></div>
      {carregando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : <>
        {origem && passo < 2 && <div className="mb-3"><Aviso tom="ok">{origem}</Aviso></div>}

        {/* ── Passo 1: o que vendeu ── */}
        {passo === 0 && (
          <>
            <p className="text-[14px] mb-3" style={{ color: "var(--ink)" }}>
              <b>O que o cliente comprou?</b> <span style={{ color: "var(--ink2)" }}>Toque em tudo que entrou na venda — pode ser mais de um.</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {ORDEM_TIPOS_VENDA.map((t) => {
                const on = tiposMarcados.has(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => alternarTipo(t)}
                    className="text-left rounded-xl px-3.5 py-3 transition-colors min-h-[92px]"
                    style={{ border: `2px solid ${on ? "var(--rel)" : "var(--line)"}`, background: on ? "var(--rel-soft)" : "var(--card)" }}>
                    <span className="flex items-center gap-2">
                      <span className="text-[24px] leading-none" aria-hidden>{TIPOS[t].emoji}</span>
                      <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>{TIPOS[t].rotulo}</span>
                      {on && <span className="text-[13px] font-bold" style={{ color: "var(--rel-ink)" }} aria-hidden>✓</span>}
                    </span>
                    {TIPOS[t].ajuda && <span className="block text-[12px] mt-1.5 leading-snug" style={{ color: "var(--ink3)" }}>{TIPOS[t].ajuda}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Passo 2: detalhes de cada item ── */}
        {passo === 1 && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              Preencha o que você já sabe. <b>Nada aqui é obrigatório</b> — o que faltar, o Relacionamento completa na emissão.
            </p>
            {itens.map((i, n) => {
              const info = TIPOS[i.tipo];
              const [d1, d2] = datasDoTipo(i.tipo, "venda");
              const emitido = i.status && i.status !== "vendido";
              const mesmos = itens.filter((x) => x.tipo === i.tipo);
              return (
                <section key={i.k} className="rel-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[20px]" aria-hidden>{info.emoji}</span>
                    <h3 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>
                      {info.rotulo}{mesmos.length > 1 ? ` ${mesmos.indexOf(i) + 1}` : ""}
                    </h3>
                    {emitido && <Etiqueta tom="rel">{i.status}</Etiqueta>}
                    {!emitido && mesmos.length > 1 && (
                      <Botao variante="fantasma" aria-label={`Tirar ${info.rotulo} ${n + 1}`} onClick={() => setItens((l) => l.filter((x) => x.k !== i.k))}>Tirar</Botao>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="sm:col-span-2">
                      <Campo rotulo="Nome do item" dica={`Em branco, fica "${nomeSugerido(i)}".`}>
                        <Entrada value={i.nome} placeholder={info.exemploNome} onChange={(e) => mudarItem(i.k, { nome: e.target.value })} />
                      </Campo>
                    </div>
                    {d1 && <Campo rotulo={d1}><Entrada type="date" value={i.data_inicio} onChange={(e) => mudarItem(i.k, { data_inicio: e.target.value })} /></Campo>}
                    {d2 && <Campo rotulo={d2}><Entrada type="date" value={i.data_fim} onChange={(e) => mudarItem(i.k, { data_fim: e.target.value })} /></Campo>}
                    {camposDoTipo(i.tipo, "venda").map((c) => (
                      <CampoDoTipo key={c.chave} c={c} valor={i.dados[c.chave] ?? ""} onMudar={(v) => mudarDado(i.k, c.chave, v)} />
                    ))}
                    <Campo rotulo="Fornecedor / operadora (interno)" dica="Opcional. O cliente não vê.">
                      <Entrada value={i.fornecedor} onChange={(e) => mudarItem(i.k, { fornecedor: e.target.value })} />
                    </Campo>
                  </div>
                  <button type="button" className="mt-3 text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }}
                    onClick={() => setItens((l) => { const j = l.findIndex((x) => x.k === i.k); const c = [...l]; c.splice(j + 1, 0, itemVendaVazio(i.tipo)); return c; })}>
                    + Outro {info.rotulo.toLowerCase()} nesta venda
                  </button>
                </section>
              );
            })}
          </div>
        )}

        {/* ── Passo 3: valores e passageiros ── */}
        {passo === 2 && (
          <div className="space-y-4">
            <div className="rel-card p-4">
              <p className="text-[14px] font-bold mb-1" style={{ color: "var(--ink)" }}>Quanto custou cada item pro cliente?</p>
              <p className="text-[12.5px] mb-3" style={{ color: "var(--ink3)" }}>Preço de venda em reais. Item que veio "incluso" pode ficar 0.</p>
              <ul className="space-y-2">
                {comValores.map((i) => (
                  <li key={i.k} className="grid grid-cols-[1fr_150px] sm:grid-cols-[1fr_180px_150px] gap-2 items-center">
                    <span className="text-[13.5px] min-w-0 truncate" style={{ color: "var(--ink)" }}>
                      <span aria-hidden>{TIPOS[i.tipo].emoji}</span> {i.nome.trim() || nomeSugerido(i)}
                    </span>
                    <span className="hidden sm:block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{tipoVendaBitrix(i.tipo).nome}</span>
                    <Entrada inputMode="decimal" aria-label={`Valor de ${i.nome || TIPOS[i.tipo].rotulo}`} placeholder="R$ 0,00"
                      value={valores[i.k] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [i.k]: e.target.value }))} />
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
                <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Total da venda</span>
                <span className="text-[18px] font-bold" style={{ color: total > 0 ? "var(--rel-ink)" : "var(--ink3)" }}>{brl(total)}</span>
              </div>
              {principal && total > 0 && (
                <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
                  No Dashboard/Bitrix entra como <b>{tipoVendaBitrix(principal.tipo).nome}</b> (o item de maior valor).
                </p>
              )}
            </div>

            <div className="rel-card p-4">
              <Campo rotulo={`Quem vai viajar${passageiros.length ? ` (${passageiros.length})` : ""}`} dica="Um nome por linha. Opcional agora — ajuda o Relacionamento e o app do cliente.">
                <textarea className="rel-input" rows={3} value={passageirosTxt} onChange={(e) => setPassageirosTxt(e.target.value)} placeholder={"Maria da Silva\nJoão da Silva"} />
              </Campo>
            </div>

            {!consolidada && !jaPreVenda && (
              <Aviso>
                <b>Salvar e marcar como venda</b> grava e a venda já conta no Dashboard. Depois, no cartão, é só
                <b> Fechar: pagamento e contrato</b> — a venda não conta de novo.
              </Aviso>
            )}
          </div>
        )}
        {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
      </>}
    </Modal>
  );
}
