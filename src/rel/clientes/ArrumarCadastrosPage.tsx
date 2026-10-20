// src/rel/clientes/ArrumarCadastrosPage.tsx
// -----------------------------------------------------------------------------
// "Arrumar cadastros" (0151 — Bruno 20/10: "cruze todas as informações pra
// termos uma base real de todos os clientes").
//
// O banco cruza sozinho só o que é seguro (botão "Cruzar a base agora"): campo
// vazio que o Bitrix/venda confirma e conversa/venda/atendimento que bate com
// UM cliente só. O que ficou em dúvida cai aqui, em filas curtas, pra pessoa
// do time decidir: é a mesma pessoa? de quem é esta conversa? quem comprou
// esta venda? Nada é sobrescrito e cada rodada automática dá pra desfazer.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import {
  CAMPOS_CADASTRO, buscarClientes, carregarFila, cruzarBase, desfazerCruzamento, formatarCpf, formatarData,
  formatarTelefone, juntarClientes, naoEhDuplicado, vincularCadastro,
  type Cliente, type ClienteMini, type DuplicadoSugerido, type FilaCadastros, type ResultadoCruzamento, type TipoVinculo,
} from "../lib/clientes";
import { Aviso, Botao, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import { usePode } from "../equipe/usePode";

type Aba = "parecidos" | "conversas" | "viagens" | "financeiro" | "cpf" | "incompletos";

const NOME_CAMPO: Record<string, string> = {
  cpf: "CPF", email: "e-mail", telefone: "telefone", nascimento: "nascimento", passaporte: "passaporte",
  passaporte_validade: "validade do passaporte",
};
const NOME_LIGACAO: Record<string, string> = {
  rel_wa_conversas: "conversas", rel_viagens: "vendas", fin_atendimentos: "atendimentos do Financeiro", rel_chamados: "chamados",
};

function resumoRodada(r: ResultadoCruzamento): string {
  const partes = [
    ...Object.entries(r.campos).map(([k, n]) => `${n} ${NOME_CAMPO[k] ?? k}`),
    ...Object.entries(r.ligacoes).map(([k, n]) => `${n} ${NOME_LIGACAO[k] ?? k} ligados`),
  ];
  return partes.length ? partes.join(" · ") : "nada novo pra cruzar com segurança";
}

const dataCurta = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

/** Busca uma ficha pelo nome, CPF ou telefone e devolve a escolhida. */
function EscolherFicha({ sugestoes, onEscolher, ocupado }: { sugestoes: ClienteMini[]; onEscolher: (c: ClienteMini) => void; ocupado: boolean }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<Cliente[]>([]);
  useEffect(() => {
    if (termo.trim().length < 3) { setAchados([]); return; }
    const t = setTimeout(() => { buscarClientes(termo, 6).then(setAchados).catch(() => setAchados([])); }, 250);
    return () => clearTimeout(t);
  }, [termo]);

  return (
    <div className="space-y-1.5">
      {sugestoes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Parece ser:</span>
          {sugestoes.map((s) => (
            <Botao key={s.id} disabled={ocupado} onClick={() => onEscolher(s)} className="!h-7 !px-2.5 !text-[12.5px]">{s.nome}</Botao>
          ))}
        </div>
      )}
      <Entrada placeholder="Ligar a outra ficha: nome, CPF ou telefone…" value={termo} onChange={(e) => setTermo(e.target.value)} />
      {achados.length > 0 && (
        <ul className="rel-card p-1">
          {achados.map((c) => (
            <li key={c.id}>
              <button disabled={ocupado} onClick={() => { onEscolher(c); setTermo(""); }} className="rel-linha w-full text-left rounded-lg px-2 py-1.5 text-[13px]" style={{ color: "var(--ink)" }}>
                <b>{c.nome}</b>
                <span style={{ color: "var(--ink3)" }}> · {c.cpf ? formatarCpf(c.cpf) : "sem CPF"}{c.telefone ? ` · ${formatarTelefone(c.telefone)}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ArrumarCadastrosPage({ onAbrir, onAbrirViagem, onAbrirConversa, onMudou }: {
  onAbrir: (id: string) => void; onAbrirViagem: (id: string) => void; onAbrirConversa: (id: string) => void; onMudou: () => void;
}) {
  const podeJuntar = usePode("relacionamento.juntar_clientes") !== false;
  const [fila, setFila] = useState<FilaCadastros | null>(null);
  const [aba, setAba] = useState<Aba>("parecidos");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<ResultadoCruzamento | null>(null);
  const [juntando, setJuntando] = useState<{ par: DuplicadoSugerido; manter: string } | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  const carregar = useCallback(async () => {
    try { setFila(await carregarFila()); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar a fila."); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function rodar(fn: () => Promise<unknown>, msg?: string) {
    setOcupado(true); setErro(null); setOk(null);
    try { await fn(); if (msg) setOk(msg); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  const ligar = (tipo: TipoVinculo, id: string, c: ClienteMini) => rodar(() => vincularCadastro(tipo, id, c.id), `Ligado à ficha de ${c.nome}.`);

  async function simular() {
    setOcupado(true); setErro(null); setOk(null);
    try { setPrevia(await cruzarBase(false)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui cruzar."); }
    finally { setOcupado(false); }
  }

  if (!fila) return (
    <div className="max-w-4xl mx-auto">
      {erro ? <Aviso tom="erro">{erro}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Cruzando a base…</p>}
    </div>
  );

  const abas: { id: Aba; rotulo: string; n: number }[] = [
    { id: "parecidos", rotulo: "Mesma pessoa?", n: fila.parecidos.length },
    { id: "conversas", rotulo: "Conversas sem ficha", n: fila.conversas.length },
    { id: "viagens", rotulo: "Vendas sem comprador", n: fila.viagens.length },
    { id: "financeiro", rotulo: "Financeiro sem ficha", n: fila.financeiro.length },
    { id: "cpf", rotulo: "CPF diferente na venda", n: fila.cpf_divergente.length },
    { id: "incompletos", rotulo: "Faltando dados", n: fila.incompletos_total },
  ];
  const incompletos = verTodos ? fila.incompletos : fila.incompletos.filter((x) => x.proximo_embarque);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Arrumar cadastros</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            O que o sistema não pôde decidir sozinho. Cada item resolvido some da fila.
          </p>
        </div>
        <Botao variante="primario" disabled={ocupado} onClick={() => void simular()}>Cruzar a base agora</Botao>
      </div>

      {fila.ultima_rodada && (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Último cruzamento automático: {new Date(fila.ultima_rodada.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {fila.ultima_rodada.mudancas} mudança{fila.ultima_rodada.mudancas === 1 ? "" : "s"}
          {podeJuntar && <> · <button className="underline" disabled={ocupado} onClick={() => void rodar(async () => { const n = await desfazerCruzamento(fila.ultima_rodada!.rodada); setOk(`Desfeito: ${n} campo(s) voltaram a ficar vazios.`); })}>desfazer</button></>}
        </p>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="ok">{ok}</Aviso>}

      <div className="flex flex-wrap gap-1.5" role="tablist">
        {abas.map((a) => (
          <button key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}
            className="rounded-full px-3 h-8 text-[12.5px] border inline-flex items-center gap-1.5"
            style={aba === a.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "transparent", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
            {a.rotulo} <span className="tabular-nums" style={{ color: a.n ? "inherit" : "var(--ink3)" }}>{a.n}</span>
          </button>
        ))}
      </div>

      {aba === "parecidos" && (
        fila.parecidos.length === 0 ? <div className="rel-card"><Vazio titulo="Nada aqui" texto="Os duplicados por telefone, e-mail ou CPF ficam em Clientes → Duplicados." /></div> : (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Mesmo nome e sobrenome, e uma das fichas sem telefone — quase sempre a ficha que veio do sistema de Expedições sem achar o contato do Bitrix.</p>
            <ul className="space-y-2">
            {fila.parecidos.map((p) => (
              <li key={`${p.a_id}-${p.b_id}`} className="rel-card p-3 flex flex-wrap items-center gap-2">
                <button className="text-[13.5px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--ink)" }} onClick={() => onAbrir(p.a_id)}>{p.a_nome}</button>
                <span style={{ color: "var(--ink3)" }}>×</span>
                <button className="text-[13.5px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--ink)" }} onClick={() => onAbrir(p.b_id)}>{p.b_nome}</button>
                <span className="flex-1" />
                {podeJuntar && <Botao variante="primario" disabled={ocupado} onClick={() => setJuntando({ par: p, manter: p.a_id })}>Juntar…</Botao>}
                <Botao disabled={ocupado} onClick={() => void rodar(() => naoEhDuplicado(p.a_id, p.b_id))}>Não é a mesma pessoa</Botao>
              </li>
            ))}
          </ul>
          </div>
        )
      )}

      {aba === "conversas" && (
        fila.conversas.length === 0 ? <div className="rel-card"><Vazio titulo="Toda conversa tem ficha" /></div> : (
          <ul className="space-y-2">
            {fila.conversas.map((w) => (
              <li key={w.id} className="rel-card p-3 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-[13.5px]" style={{ color: "var(--ink)" }}>{w.nome_contato || "Sem nome"}</b>
                  <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{formatarTelefone(w.telefone)} · {dataCurta(w.atualizado_em)}{w.setor ? ` · ${w.setor}` : ""}</span>
                  <span className="flex-1" />
                  <Botao variante="fantasma" onClick={() => onAbrirConversa(w.id)}>Abrir conversa</Botao>
                </div>
                {w.ultima_mensagem && <p className="text-[12.5px] truncate" style={{ color: "var(--ink2)" }}>“{w.ultima_mensagem}”</p>}
                <EscolherFicha sugestoes={w.sugestoes} ocupado={ocupado} onEscolher={(c) => void ligar("conversa", w.id, c)} />
              </li>
            ))}
          </ul>
        )
      )}

      {aba === "viagens" && (
        fila.viagens.length === 0 ? <div className="rel-card"><Vazio titulo="Toda venda tem comprador" /></div> : (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Vendas do Bitrix sem contato no negócio. Diga de quem é — o sincronismo nunca apaga essa ligação.</p>
            <ul className="space-y-2">
            {fila.viagens.map((v) => (
              <li key={v.id} className="rel-card p-3 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-[13.5px]" style={{ color: "var(--ink)" }}>{v.titulo || v.destino || "Venda sem título"}</b>
                  <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
                    {v.bitrix_deal_id ? `negócio #${v.bitrix_deal_id} · ` : ""}embarque {dataCurta(v.data_embarque)}{v.valor ? ` · ${v.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}
                  </span>
                  <span className="flex-1" />
                  <Botao variante="fantasma" onClick={() => onAbrirViagem(v.id)}>Abrir venda</Botao>
                </div>
                <EscolherFicha sugestoes={v.sugestoes} ocupado={ocupado} onEscolher={(c) => void ligar("viagem", v.id, c)} />
              </li>
            ))}
          </ul>
          </div>
        )
      )}

      {aba === "financeiro" && (
        fila.financeiro.length === 0 ? <div className="rel-card"><Vazio titulo="Todo atendimento do Financeiro tem ficha" /></div> : (
          <ul className="space-y-2">
            {fila.financeiro.map((f) => (
              <li key={f.id} className="rel-card p-3 space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-[13.5px]" style={{ color: "var(--ink)" }}>#{f.numero} {f.nome || "Sem nome"}</b>
                  <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{f.telefone ? formatarTelefone(f.telefone) : "sem telefone"} · {f.motivo ?? "—"} · {dataCurta(f.criado_em)}</span>
                </div>
                <EscolherFicha sugestoes={[]} ocupado={ocupado} onEscolher={(c) => void ligar("financeiro", f.id, c)} />
              </li>
            ))}
          </ul>
        )
      )}

      {aba === "cpf" && (
        fila.cpf_divergente.length === 0 ? <div className="rel-card"><Vazio titulo="Os CPFs batem" /></div> : (
          <div className="space-y-2">
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>O CPF do negócio no Bitrix é outro. Às vezes é o de quem pagou (marido, filha) — às vezes a ficha está errada. Confira e corrija onde precisar.</p>
            <ul className="space-y-2">
            {fila.cpf_divergente.map((x) => (
              <li key={x.id} className="rel-card p-3 flex flex-wrap items-center gap-2 text-[13px]">
                <b style={{ color: "var(--ink)" }}>{x.nome}</b>
                <span style={{ color: "var(--ink3)" }}>ficha {formatarCpf(x.cpf)} · venda “{x.titulo ?? "—"}” {formatarCpf(x.cpf_venda)}</span>
                <span className="flex-1" />
                <Botao variante="fantasma" onClick={() => onAbrirViagem(x.viagem_id)}>Abrir venda</Botao>
                <Botao onClick={() => onAbrir(x.id)}>Abrir ficha</Botao>
              </li>
            ))}
          </ul>
          </div>
        )
      )}

      {aba === "incompletos" && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>
            <span>{fila.incompletos_total} fichas com dado faltando · <b style={{ color: "var(--ink2)" }}>{fila.incompletos_viajando} com viagem pela frente</b> (estas primeiro).</span>
            <span className="flex-1" />
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> ver também quem não tem viagem marcada</label>
          </div>
          {incompletos.length === 0 ? <div className="rel-card"><Vazio titulo="Ninguém com viagem pela frente está com cadastro faltando" /></div> : (
            <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
              {incompletos.map((x) => (
                <li key={x.id}>
                  <button onClick={() => onAbrir(x.id)} className="rel-linha w-full text-left px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <b className="text-[13px]" style={{ color: "var(--ink)" }}>{x.nome}</b>
                    {x.proximo_embarque && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>embarca {formatarData(x.proximo_embarque)}</span>}
                    <span className="flex-1" />
                    {x.faltando.map((k) => <Etiqueta key={k} tom={x.proximo_embarque ? "aviso" : "neutro"}>{CAMPOS_CADASTRO[k] ?? NOME_CAMPO[k] ?? k}</Etiqueta>)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {verTodos && fila.incompletos.length < fila.incompletos_total && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Mostrando as primeiras {fila.incompletos.length}.</p>
          )}
        </div>
      )}

      <Modal aberto={!!previa} titulo="Cruzar a base" onFechar={() => setPrevia(null)} rodape={
        <>
          <Botao variante="fantasma" onClick={() => setPrevia(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado || !previa || (!Object.keys(previa.campos).length && !Object.keys(previa.ligacoes).length)}
            onClick={() => void rodar(async () => { const r = await cruzarBase(true); setPrevia(null); setOk(`Feito: ${resumoRodada(r)}.`); })}>
            {ocupado ? "Cruzando…" : "Aplicar"}
          </Botao>
        </>
      }>
        {previa && (
          <div className="space-y-3 text-[13.5px]" style={{ color: "var(--ink2)" }}>
            <p>O sistema conferiu ficha × contato do Bitrix × vendas × conversas × Financeiro e acha seguro fazer:</p>
            <p className="font-semibold" style={{ color: "var(--ink)" }}>{resumoRodada(previa)}</p>
            <Aviso tom="ok">Só preenche o que está <b>vazio</b> e só liga quando <b>um cliente só</b> bate. Nada é apagado nem juntado, e dá pra desfazer depois.</Aviso>
          </div>
        )}
      </Modal>

      <Modal aberto={!!juntando} titulo="Juntar fichas" onFechar={() => setJuntando(null)} rodape={
        <>
          <Botao variante="fantasma" onClick={() => setJuntando(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado} onClick={() => {
            if (!juntando) return;
            const { par, manter } = juntando;
            const remover = manter === par.a_id ? par.b_id : par.a_id;
            void rodar(async () => { await juntarClientes(manter, remover); setJuntando(null); }, "Fichas juntadas.");
          }}>{ocupado ? "Juntando…" : "Juntar"}</Botao>
        </>
      }>
        {juntando && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Qual ficha <b>fica</b>? A outra completa o que faltar — nada é sobrescrito.</p>
            {[{ id: juntando.par.a_id, nome: juntando.par.a_nome }, { id: juntando.par.b_id, nome: juntando.par.b_nome }].map((x) => (
              <label key={x.id} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer" style={{ border: `2px solid ${juntando.manter === x.id ? "var(--rel)" : "var(--line)"}`, background: juntando.manter === x.id ? "var(--rel-soft)" : "transparent" }}>
                <input type="radio" checked={juntando.manter === x.id} onChange={() => setJuntando({ ...juntando, manter: x.id })} />
                <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{x.nome}</span>
              </label>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
