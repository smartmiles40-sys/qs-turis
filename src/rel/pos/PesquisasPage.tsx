// src/rel/pos/PesquisasPage.tsx
// -----------------------------------------------------------------------------
// PESQUISA PÓS-VIAGEM. Duas abas:
//   Resultados — o NPS do período (promotores 9–10 menos detratores 0–6), a
//                nota média, quantos responderam e o que eles escreveram.
//   Para enviar — quem voltou nos últimos 60 dias, passageiro a passageiro.
//                "Gerar link" cria o convite; dá pra copiar ou mandar no
//                WhatsApp (só com a janela de 24h aberta — fora dela, quem
//                manda é o disparo automático da Fase 4, com modelo aprovado).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  calcularNps, gerarPesquisa, grupoNps, linkDaPesquisa, listarPesquisas, passageirosParaPesquisa,
  type PassageiroSemPesquisa, type Pesquisa,
} from "../lib/pos";
import { conversasDoCliente, enviarTexto } from "../lib/whatsapp";
import { Aviso, Botao, Etiqueta, Vazio } from "../ui";

const PERIODOS = [{ d: 30, r: "30 dias" }, { d: 90, r: "90 dias" }, { d: 365, r: "12 meses" }];

function Numero({ rotulo, valor, dica, cor }: { rotulo: string; valor: string; dica: string; cor?: string }) {
  return (
    <div className="rel-card p-4">
      <span className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="block text-3xl font-bold mt-1 tabular-nums" style={{ color: cor || "var(--ink)" }}>{valor}</span>
      <span className="block text-[11px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</span>
    </div>
  );
}

const COR_GRUPO = { promotor: "rel", neutro: "neutro", detrator: "erro" } as const;

function Resultados({ dias, onAbrirCliente, onAbrirViagem }: { dias: number; onAbrirCliente: (id: string) => void; onAbrirViagem: (id: string) => void }) {
  const [lista, setLista] = useState<Pesquisa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    setLista(null);
    listarPesquisas(dias).then(setLista).catch((e) => { setErro(e instanceof Error ? e.message : "Falhou."); setLista([]); });
  }, [dias]);

  const respondidas = useMemo(() => (lista ?? []).filter((p) => p.respondida_em && p.nota != null), [lista]);
  const r = calcularNps(respondidas.map((p) => p.nota as number));
  const taxa = lista?.length ? Math.round((respondidas.length / lista.length) * 100) : null;
  const corNps = r.nps == null ? undefined : r.nps >= 50 ? "var(--rel-ink)" : r.nps < 0 ? "var(--err-ink)" : undefined;

  return (
    <div className="space-y-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero rotulo="NPS" valor={r.nps == null ? "–" : String(r.nps)} dica={`${r.prom} promotores · ${r.det} detratores`} cor={corNps} />
        <Numero rotulo="Nota média" valor={r.media == null ? "–" : String(r.media).replace(".", ",")} dica="de 0 a 10" />
        <Numero rotulo="Respostas" valor={String(respondidas.length)} dica={`${lista?.length ?? 0} links enviados`} />
        <Numero rotulo="Taxa de resposta" valor={taxa == null ? "–" : `${taxa}%`} dica="respondidas ÷ enviadas" />
      </div>

      <section className="rel-card overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>O que os clientes disseram</h2>
        {lista === null ? (
          <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : respondidas.length === 0 ? (
          <Vazio titulo="Nenhuma resposta no período" texto="Gere os links na aba “Para enviar” — ou ligue o disparo automático de pesquisa em Disparos." />
        ) : (
          <ul>
            {respondidas.map((p) => {
              const g = grupoNps(p.nota)!;
              return (
                <li key={p.id} className="px-4 py-3 space-y-1" style={{ borderTop: "1px solid var(--line2)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Etiqueta tom={COR_GRUPO[g]}>{p.nota}/10</Etiqueta>
                    <button className="text-sm font-semibold underline-offset-2 hover:underline" style={{ color: "var(--ink)" }} onClick={() => onAbrirCliente(p.cliente_id)}>
                      {p.cliente?.nome ?? "Cliente"}
                    </button>
                    {p.viagem_id && p.viagem && (
                      <button className="text-[12px] underline" style={{ color: "var(--ink3)" }} onClick={() => onAbrirViagem(p.viagem_id!)}>{p.viagem.titulo}</button>
                    )}
                    <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{new Date(p.respondida_em!).toLocaleDateString("pt-BR")}</span>
                    {p.nota! >= 9 && p.proximo_destino && <Etiqueta tom="rel">✈ quer ir para {p.proximo_destino}</Etiqueta>}
                  </div>
                  {p.melhor_parte && <p className="text-[13px]" style={{ color: "var(--ink)" }}><b>Melhor parte:</b> {p.melhor_parte}</p>}
                  {p.comentario && <p className="text-[13px]" style={{ color: "var(--ink2)" }}><b>Poderia melhorar:</b> {p.comentario}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ParaEnviar({ onAbrirCliente }: { onAbrirCliente: (id: string) => void }) {
  const [lista, setLista] = useState<PassageiroSemPesquisa[] | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro" | "aviso"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(() => {
    passageirosParaPesquisa(60).then(setLista).catch((e) => { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Falhou." }); setLista([]); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function gerar(p: PassageiroSemPesquisa) {
    setOcupado(`${p.viagem_id}:${p.cliente_id}`);
    try { await gerarPesquisa(p.cliente_id, p.viagem_id); carregar(); }
    catch (e) { setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não gerou." }); }
    finally { setOcupado(null); }
  }

  async function copiar(token: string) {
    try { await navigator.clipboard.writeText(linkDaPesquisa(token)); setMsg({ tom: "ok", t: "Link copiado." }); }
    catch { setMsg({ tom: "aviso", t: linkDaPesquisa(token) }); }
  }

  async function mandar(p: PassageiroSemPesquisa) {
    if (!p.pesquisa) return;
    setOcupado(`${p.viagem_id}:${p.cliente_id}`);
    setMsg(null);
    try {
      const convs = await conversasDoCliente(p.cliente_id);
      const aberta = convs.find((c) => c.janela_aberta);
      if (!aberta) {
        setMsg({ tom: "aviso", t: `${p.cliente_nome.split(" ")[0]} não escreveu nas últimas 24h — a Meta só deixa mandar modelo aprovado. Copie o link ou use o disparo automático de pesquisa (Disparos).` });
        return;
      }
      const primeiro = p.cliente_nome.split(" ")[0];
      await enviarTexto(aberta.id, `Oi, ${primeiro}! Que bom ter você de volta 😊\nConta pra gente como foi a viagem? Leva 1 minutinho:\n${linkDaPesquisa(p.pesquisa.token)}`);
      setMsg({ tom: "ok", t: `Pesquisa enviada para ${primeiro}.` });
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não enviou." });
    } finally {
      setOcupado(null);
    }
  }

  const pendentes = (lista ?? []).filter((p) => !p.pesquisa?.respondida_em);

  return (
    <div className="space-y-3">
      {msg && <Aviso tom={msg.tom}>{msg.t}</Aviso>}
      <section className="rel-card overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>
          Voltaram nos últimos 60 dias {lista && `(${pendentes.length} sem resposta)`}
        </h2>
        {lista === null ? (
          <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : pendentes.length === 0 ? (
          <Vazio titulo="Ninguém pendente" texto="Todos que voltaram nos últimos 60 dias já responderam (ou ainda não há viagens concluídas)." />
        ) : (
          <ul>
            {pendentes.map((p) => {
              const k = `${p.viagem_id}:${p.cliente_id}`;
              return (
                <li key={k} className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderTop: "1px solid var(--line2)" }}>
                  <button className="flex-1 min-w-[200px] text-left" onClick={() => onAbrirCliente(p.cliente_id)}>
                    <span className="block text-sm font-semibold" style={{ color: "var(--ink)" }}>{p.cliente_nome}</span>
                    <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
                      {p.viagem_titulo}{p.data_retorno ? ` · voltou ${p.data_retorno.split("-").reverse().join("/")}` : ""}
                      {p.pesquisa ? " · link gerado, sem resposta" : ""}
                    </span>
                  </button>
                  {p.pesquisa ? (
                    <span className="flex gap-1.5">
                      <Botao onClick={() => copiar(p.pesquisa!.token)}>Copiar link</Botao>
                      <Botao variante="primario" disabled={ocupado === k || !p.telefone} onClick={() => mandar(p)}>Mandar no WhatsApp</Botao>
                    </span>
                  ) : (
                    <Botao variante="primario" disabled={ocupado === k} onClick={() => gerar(p)}>{ocupado === k ? "…" : "Gerar link"}</Botao>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function PesquisasPage({ onAbrirCliente, onAbrirViagem }: { onAbrirCliente: (id: string) => void; onAbrirViagem: (id: string) => void }) {
  const [aba, setAba] = useState<"resultados" | "enviar">("resultados");
  const [dias, setDias] = useState(90);
  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Pesquisa pós-viagem</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>“De 0 a 10, quanto você recomendaria a Se Tu For, Eu Vou para um amigo?”</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rel-card p-1">
            {(["resultados", "enviar"] as const).map((a) => (
              <button key={a} onClick={() => setAba(a)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                style={aba === a ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
                {a === "resultados" ? "Resultados" : "Para enviar"}
              </button>
            ))}
          </div>
          {aba === "resultados" && (
            <div className="flex gap-1 rel-card p-1">
              {PERIODOS.map((p) => (
                <button key={p.d} onClick={() => setDias(p.d)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                  style={dias === p.d ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
                  {p.r}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {aba === "resultados"
        ? <Resultados dias={dias} onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem} />
        : <ParaEnviar onAbrirCliente={onAbrirCliente} />}
    </div>
  );
}
