// Marketing › E-mail › Segmentos (regras E/OU aninhadas) e Pontuação (score).
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  chamar, dataHora, erroDoBanco, listarCampanhas, listarListas, listarSegmentos, status as lerStatus,
  type Campanha, type Condicao, type Lista, type Regras, type Segmento, type StatusConexao,
} from "../lib/api";
import { CAMPOS, condicaoPadrao, definicao, ehGrupo, operador, REGRAS_VAZIAS } from "../lib/segmentos";
import { Aviso, Botao, Campo, Entrada, Escolha, Tela, Vazio } from "../ui";

interface Apoio { listas: Lista[]; campanhas: Campanha[] }

function EditarCondicao({ c, onChange, apoio }: { c: Condicao; onChange: (c: Condicao) => void; apoio: Apoio }) {
  const def = definicao(c.campo);
  const op = operador(c.campo, c.op);
  const grupos = [...new Set(CAMPOS.map((x) => x.grupo))];
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Escolha className="w-48" value={c.campo} aria-label="Campo" onChange={(e) => onChange(condicaoPadrao(e.target.value))}>
        {grupos.map((g) => <optgroup key={g} label={g}>{CAMPOS.filter((x) => x.grupo === g).map((x) => <option key={x.campo} value={x.campo}>{x.rotulo}</option>)}</optgroup>)}
      </Escolha>
      {c.campo === "campo" ? <Entrada className="w-36" placeholder="chave (ex.: cidade)" value={c.chave ?? ""} onChange={(e) => onChange({ ...c, chave: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /> : null}
      <Escolha className="w-64" value={c.op} aria-label="Regra" onChange={(e) => {
        const novo = operador(c.campo, e.target.value);
        onChange({ ...c, op: e.target.value, valor: novo.valor === "dias" ? "30" : novo.valor === op.valor ? c.valor : "" });
      }}>
        {def.ops.map((o) => <option key={o.op} value={o.op}>{o.rotulo}</option>)}
      </Escolha>
      {op.valor === "lista" ? (
        <Escolha className="w-52" value={c.valor ?? ""} onChange={(e) => onChange({ ...c, valor: e.target.value })} aria-label="Lista">
          <option value="">— lista —</option>{apoio.listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </Escolha>
      ) : op.valor === "campanha" ? (
        <Escolha className="w-52" value={c.valor ?? ""} onChange={(e) => onChange({ ...c, valor: e.target.value })} aria-label="Campanha">
          <option value="">— campanha —</option>{apoio.campanhas.filter((x) => x.status !== "rascunho").map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </Escolha>
      ) : op.valor === "nenhum" ? null : (
        <Entrada className="w-44" aria-label="Valor" type={op.valor === "data" ? "date" : op.valor === "numero" || op.valor === "dias" ? "number" : "text"}
          value={c.valor ?? ""} onChange={(e) => onChange({ ...c, valor: e.target.value })} />
      )}
    </div>
  );
}

function EditarGrupo({ g, onChange, onRemover, nivel, apoio }: { g: Regras; onChange: (g: Regras) => void; onRemover?: () => void; nivel: number; apoio: Apoio }) {
  const trocar = (i: number, item: Condicao | Regras) => onChange({ ...g, condicoes: g.condicoes.map((x, j) => (j === i ? item : x)) });
  const tirar = (i: number) => onChange({ ...g, condicoes: g.condicoes.filter((_, j) => j !== i) });
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ border: "1px dashed var(--line)", background: nivel % 2 ? "var(--card2)" : "var(--card)" }}>
      <div className="flex items-center gap-2 text-[13px]">
        <span>Combinar</span>
        <Escolha className="w-56" value={g.combinar} onChange={(e) => onChange({ ...g, combinar: e.target.value as Regras["combinar"] })}>
          <option value="todas">todas as regras (E)</option>
          <option value="qualquer">qualquer uma (OU)</option>
        </Escolha>
        {onRemover ? <Botao variante="fantasma" className="ml-auto" onClick={onRemover}>Remover grupo</Botao> : null}
      </div>
      {g.condicoes.map((item, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="text-[11px] font-bold pt-2 w-6 text-right" style={{ color: "var(--ink2)" }}>{i === 0 ? "" : g.combinar === "todas" ? "E" : "OU"}</span>
          <div className="flex-1">
            {ehGrupo(item)
              ? <EditarGrupo g={item} nivel={nivel + 1} apoio={apoio} onChange={(n) => trocar(i, n)} onRemover={() => tirar(i)} />
              : <div className="flex gap-2 items-center"><EditarCondicao c={item} apoio={apoio} onChange={(n) => trocar(i, n)} /><Botao variante="fantasma" aria-label="Remover regra" onClick={() => tirar(i)}>✕</Botao></div>}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Botao onClick={() => onChange({ ...g, condicoes: [...g.condicoes, condicaoPadrao()] })}>+ Regra</Botao>
        {nivel < 3 ? <Botao onClick={() => onChange({ ...g, condicoes: [...g.condicoes, { combinar: "qualquer", condicoes: [condicaoPadrao()] }] })}>+ Grupo</Botao> : null}
      </div>
    </div>
  );
}

function EditorSegmento({ s, apoio, onVoltar }: { s: Segmento; apoio: Apoio; onVoltar: () => void }) {
  const [x, setX] = useState<Segmento>(s);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [previa, setPrevia] = useState<{ total: number; amostra: { nome: string | null; email: string | null; score: number | null }[] } | null>(null);
  const salvar = async () => {
    const { error } = await supabase.from("mkt_segmentos").update({ nome: x.nome.trim() || "Sem nome", descricao: x.descricao, regras: x.regras }).eq("id", x.id);
    setMsg(error ? { tom: "erro", texto: erroDoBanco(error) } : { tom: "ok", texto: "Segmento salvo." });
  };
  const contar = async () => {
    const { data, error } = await supabase.rpc("mkt_segmento_previa", { p_regras: x.regras });
    if (error) { setMsg({ tom: "erro", texto: erroDoBanco(error) }); return; }
    setPrevia(data as typeof previa);
  };
  return (
    <Tela titulo={x.nome} acoes={<><Botao onClick={onVoltar}>← Segmentos</Botao><Botao onClick={contar}>Contar</Botao><Botao variante="primario" onClick={salvar}>Salvar</Botao></>}>
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      <div className="mke-card p-4 grid sm:grid-cols-2 gap-3 mb-4">
        <Campo rotulo="Nome"><Entrada value={x.nome} onChange={(e) => setX({ ...x, nome: e.target.value })} /></Campo>
        <Campo rotulo="Descrição"><Entrada value={x.descricao ?? ""} onChange={(e) => setX({ ...x, descricao: e.target.value })} /></Campo>
      </div>
      <p className="text-xs mb-2" style={{ color: "var(--ink2)" }}>Segmento sem regra nenhuma = ninguém. O segmento é recalculado na hora do envio.</p>
      <EditarGrupo g={x.regras} nivel={0} apoio={apoio} onChange={(r) => setX({ ...x, regras: r })} />
      {previa ? (
        <div className="mke-card p-4 mt-4 text-[13px]">
          <b>{previa.total.toLocaleString("pt-BR")}</b> contato(s) casam agora.
          {previa.amostra.length ? <ul className="mt-2 space-y-0.5">{previa.amostra.map((a, i) => <li key={i}>{a.nome || "—"} · {a.email || "sem e-mail"} · {a.score ?? 0} pts</li>)}</ul> : null}
        </div>
      ) : null}
    </Tela>
  );
}

function Pontuacao() {
  const [cfg, setCfg] = useState<StatusConexao | null>(null);
  const [pesos, setPesos] = useState<[string, string][]>([]);
  const [janela, setJanela] = useState("90");
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  useEffect(() => {
    lerStatus().then((s) => {
      setCfg(s);
      setPesos(Object.entries(s.config.score_pesos ?? {}).map(([k, v]) => [k, String(v)]));
      setJanela(String(s.config.score_janela_dias ?? 90));
    }).catch((e) => setMsg({ tom: "erro", texto: e.message }));
  }, []);
  const salvar = async () => {
    try {
      const score_pesos = Object.fromEntries(pesos.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), Number(v)]));
      const s = await chamar<StatusConexao>({ acao: "salvar_config", config: { score_pesos, score_janela_dias: Number(janela) } });
      setCfg(s); setMsg({ tom: "ok", texto: "Pesos salvos. Valem a partir do próximo recálculo." });
    } catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
  };
  const recalcular = async () => {
    try { const r = await chamar<{ alterados: number }>({ acao: "recalcular_score" }); setMsg({ tom: "ok", texto: `Recalculado: ${r.alterados} contato(s) mudaram de nota.` }); }
    catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
  };
  return (
    <div className="mke-card p-4 space-y-3 max-w-2xl">
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        A nota do contato é a soma dos pesos dos eventos dele nos últimos <b>{janela}</b> dias. Sobe na hora (abriu, clicou);
        desce sozinha na passada diária, quando o evento sai da janela. Último recálculo: {dataHora(cfg?.config.score_recalculado_em ?? null)}.
      </p>
      {pesos.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Entrada className="flex-1" value={k} aria-label="Evento" onChange={(e) => setPesos(pesos.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
          <Entrada className="w-24" type="number" value={v} aria-label="Peso" onChange={(e) => setPesos(pesos.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
          <Botao variante="fantasma" aria-label="Remover" onClick={() => setPesos(pesos.filter((_, j) => j !== i))}>✕</Botao>
        </div>
      ))}
      <div className="text-[11px]" style={{ color: "var(--ink2)" }}>Eventos que o e-mail grava: email_abriu, email_clicou, email_descadastrou, email_bounce, email_spam. As outras frentes gravam os delas (ex.: formulario).</div>
      <div className="flex flex-wrap gap-2 items-end">
        <Botao onClick={() => setPesos([...pesos, ["", "1"]])}>+ Evento</Botao>
        <div className="w-40"><Campo rotulo="Janela (dias)"><Entrada type="number" min={7} max={365} value={janela} onChange={(e) => setJanela(e.target.value)} /></Campo></div>
        <Botao variante="primario" onClick={salvar}>Salvar pesos</Botao>
        <Botao onClick={recalcular}>Recalcular agora</Botao>
      </div>
    </div>
  );
}

export default function Segmentos() {
  const [aba, setAba] = useState<"segmentos" | "pontuacao">("segmentos");
  const [lista, setLista] = useState<Segmento[] | null>(null);
  const [aberto, setAberto] = useState<Segmento | null>(null);
  const [apoio, setApoio] = useState<Apoio>({ listas: [], campanhas: [] });
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => listarSegmentos().then(setLista);
  useEffect(() => {
    carregar();
    Promise.all([listarListas(), listarCampanhas()]).then(([listas, campanhas]) => setApoio({ listas, campanhas }));
  }, []);

  const novo = async () => {
    const { data, error } = await supabase.from("mkt_segmentos").insert({ nome: "Novo segmento", regras: REGRAS_VAZIAS }).select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberto(data as Segmento);
  };
  const apagar = async (s: Segmento) => {
    if (!window.confirm(`Apagar "${s.nome}"? Campanha agendada com ele vai dar erro em vez de mandar pra todo mundo.`)) return;
    const { error } = await supabase.from("mkt_segmentos").delete().eq("id", s.id);
    if (error) setErro(erroDoBanco(error)); else carregar();
  };

  if (aberto) return <EditorSegmento s={aberto} apoio={apoio} onVoltar={() => { setAberto(null); carregar(); }} />;
  return (
    <Tela titulo="Segmentos e pontuação" acoes={aba === "segmentos" ? <Botao variante="primario" onClick={novo}>+ Novo segmento</Botao> : undefined}>
      <div role="tablist" className="flex gap-1 mb-4">
        <button role="tab" aria-selected={aba === "segmentos"} className="mke-tab px-3 py-1.5 rounded-lg text-sm" onClick={() => setAba("segmentos")}>Segmentos</button>
        <button role="tab" aria-selected={aba === "pontuacao"} className="mke-tab px-3 py-1.5 rounded-lg text-sm" onClick={() => setAba("pontuacao")}>Pontuação (score)</button>
      </div>
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {aba === "pontuacao" ? <Pontuacao /> : lista === null ? <p className="text-sm">Carregando…</p> : lista.length === 0 ? <Vazio texto="Nenhum segmento ainda." /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {lista.map((s) => (
            <div key={s.id} className="mke-card p-4">
              <button className="font-semibold hover:underline" onClick={() => setAberto(s)}>{s.nome}</button>
              <div className="text-xs mt-1" style={{ color: "var(--ink2)" }}>{s.descricao || `${s.regras.condicoes.length} regra(s)`} · {dataHora(s.atualizado_em)}</div>
              <div className="mt-3 flex gap-2"><Botao onClick={() => setAberto(s)}>Editar</Botao><Botao variante="fantasma" onClick={() => apagar(s)}>Apagar</Botao></div>
            </div>
          ))}
        </div>
      )}
    </Tela>
  );
}
