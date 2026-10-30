// Marketing › E-mail › Modelos: e-mails salvos (usados por campanhas e automações).
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamar, dataHora, erroDoBanco, listarModelos, status as lerStatus, type Modelo, type StatusConexao } from "../lib/api";
import { MODELO_INICIAL, type Bloco } from "../lib/blocos";
import { Aviso, Botao, Campo, Entrada, Tela, Vazio } from "../ui";
import { EditorBlocos } from "./EditorBlocos";
import { useHtmlDosBlocos } from "../lib/useHtmlDosBlocos";

function Editor({ m, cfg, onVoltar }: { m: Modelo; cfg: StatusConexao | null; onVoltar: () => void }) {
  const [x, setX] = useState<Modelo>(m);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [para, setPara] = useState("");
  const html = useHtmlDosBlocos(x.blocos, { texto: cfg?.config.rodape_texto, endereco: cfg?.config.rodape_endereco });
  const salvar = async () => {
    const { error } = await supabase.from("mkt_email_modelos")
      .update({ nome: x.nome.trim() || "Sem nome", assunto: x.assunto, preheader: x.preheader, blocos: x.blocos, html }).eq("id", x.id);
    setMsg(error ? { tom: "erro", texto: erroDoBanco(error) } : { tom: "ok", texto: "Modelo salvo." });
    return !error;
  };
  const testar = async () => {
    if (!(await salvar())) return;
    try { await chamar({ acao: "teste", modeloId: x.id, para }); setMsg({ tom: "ok", texto: `Teste enviado para ${para}.` }); }
    catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
  };
  return (
    <Tela titulo={x.nome} acoes={<><Botao onClick={onVoltar}>← Modelos</Botao><Botao variante="primario" onClick={salvar}>Salvar</Botao></>}>
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      <div className="mke-card p-4 grid sm:grid-cols-3 gap-3 mb-4">
        <Campo rotulo="Nome"><Entrada value={x.nome} onChange={(e) => setX({ ...x, nome: e.target.value })} /></Campo>
        <Campo rotulo="Assunto"><Entrada value={x.assunto ?? ""} onChange={(e) => setX({ ...x, assunto: e.target.value })} /></Campo>
        <Campo rotulo="Pré-cabeçalho"><Entrada value={x.preheader ?? ""} onChange={(e) => setX({ ...x, preheader: e.target.value })} /></Campo>
      </div>
      <EditorBlocos blocos={x.blocos as Bloco[]} onChange={(b) => setX({ ...x, blocos: b })} html={html} />
      <div className="mke-card p-4 mt-4 flex flex-wrap gap-3 items-end">
        <div className="w-72"><Campo rotulo="Enviar teste para"><Entrada type="email" value={para} onChange={(e) => setPara(e.target.value)} /></Campo></div>
        <Botao disabled={!para} onClick={testar}>Enviar teste</Botao>
      </div>
    </Tela>
  );
}

export default function Modelos() {
  const [lista, setLista] = useState<Modelo[] | null>(null);
  const [aberto, setAberto] = useState<Modelo | null>(null);
  const [cfg, setCfg] = useState<StatusConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => listarModelos().then(setLista);
  useEffect(() => { carregar(); lerStatus().then(setCfg).catch(() => null); }, []);

  const novo = async () => {
    const { data, error } = await supabase.from("mkt_email_modelos").insert({ nome: "Novo modelo", blocos: MODELO_INICIAL() }).select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberto(data as Modelo);
  };
  const apagar = async (m: Modelo) => {
    if (!window.confirm(`Apagar o modelo "${m.nome}"? Automações que usam ele param de mandar esse passo.`)) return;
    const { error } = await supabase.from("mkt_email_modelos").delete().eq("id", m.id);
    if (error) setErro(erroDoBanco(error)); else carregar();
  };

  if (aberto) return <Editor m={aberto} cfg={cfg} onVoltar={() => { setAberto(null); carregar(); }} />;
  return (
    <Tela titulo="Modelos de e-mail" sub="Monte uma vez, use em campanhas e automações." acoes={<Botao variante="primario" onClick={novo}>+ Novo modelo</Botao>}>
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-sm">Carregando…</p> : lista.length === 0 ? <Vazio texto="Nenhum modelo salvo." /> : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((m) => (
            <div key={m.id} className="mke-card p-4">
              <button className="font-semibold text-left hover:underline" onClick={() => setAberto(m)}>{m.nome}</button>
              <div className="text-xs mt-1" style={{ color: "var(--ink2)" }}>{m.assunto || "sem assunto"} · {dataHora(m.atualizado_em)}</div>
              <div className="mt-3 flex gap-2"><Botao onClick={() => setAberto(m)}>Editar</Botao><Botao variante="fantasma" onClick={() => apagar(m)}>Apagar</Botao></div>
            </div>
          ))}
        </div>
      )}
    </Tela>
  );
}
