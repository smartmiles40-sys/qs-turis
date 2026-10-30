// Marketing › E-mail › aba Modelos: e-mails prontos (usados por campanhas e
// automações). Cartões com a miniatura do e-mail; o editor tem a prévia ao lado.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { chamar, dataHora, erroDoBanco, listarModelos, type Modelo } from "../lib/api";
import { MODELO_INICIAL, renderEmail, type Bloco } from "../lib/blocos";
import { useHtmlDosBlocos } from "../lib/useHtmlDosBlocos";
import { useEmail } from "../contexto";
import { Aviso, Botao, Campo, Cartao, Entrada, Miniatura, Topo, Vazio } from "../ui";
import { EditorBlocos } from "./EditorBlocos";
import { LadoPrevia } from "./LadoPrevia";

function Editor({ m, onVoltar }: { m: Modelo; onVoltar: () => void }) {
  const { cfg } = useEmail();
  const [x, setX] = useState<Modelo>(m);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [mexido, setMexido] = useState(false);
  const html = useHtmlDosBlocos(x.blocos, { texto: cfg?.config.rodape_texto, endereco: cfg?.config.rodape_endereco });
  const mudar = (p: Partial<Modelo>) => { setX((v) => ({ ...v, ...p })); setMexido(true); };
  const salvar = async () => {
    const { error } = await supabase.from("mkt_email_modelos")
      .update({ nome: x.nome.trim() || "Sem nome", assunto: x.assunto, preheader: x.preheader, blocos: x.blocos, html }).eq("id", x.id);
    setMsg(error ? { tom: "erro", texto: erroDoBanco(error) } : { tom: "ok", texto: "Modelo salvo." });
    if (!error) setMexido(false);
    return !error;
  };
  const testar = async (para: string) => {
    if (!(await salvar())) return "Não consegui salvar o modelo antes do teste.";
    try { await chamar({ acao: "teste", modeloId: x.id, para }); return null; } catch (e) { return (e as Error).message; }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Botao variante="fantasma" onClick={() => { if (mexido) void salvar(); onVoltar(); }}>← Modelos</Botao>
        <h2 className="text-[17px] font-bold truncate" style={{ color: "var(--ink)" }}>{x.nome || "Modelo"}</h2>
        <span className="ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>{mexido ? "Alterações não salvas" : "Salvo"}</span>
        <Botao variante="primario" disabled={!mexido} onClick={() => void salvar()}>Salvar</Botao>
      </div>
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
        <div className="min-w-0 space-y-4">
          <Cartao className="grid sm:grid-cols-3 gap-3">
            <Campo rotulo="Nome do modelo"><Entrada value={x.nome} onChange={(e) => mudar({ nome: e.target.value })} /></Campo>
            <Campo rotulo="Assunto sugerido"><Entrada value={x.assunto ?? ""} onChange={(e) => mudar({ assunto: e.target.value })} /></Campo>
            <Campo rotulo="Pré-cabeçalho"><Entrada value={x.preheader ?? ""} onChange={(e) => mudar({ preheader: e.target.value })} /></Campo>
          </Cartao>
          <EditorBlocos semPrevia blocos={x.blocos as Bloco[]} html={html} onChange={(b) => mudar({ blocos: b })} />
        </div>
        <LadoPrevia html={html} assunto={x.assunto} preheader={x.preheader} remetente={cfg?.config.remetente_nome} onTeste={testar} />
      </div>
    </div>
  );
}

export default function Modelos() {
  const { cfg } = useEmail();
  const [lista, setLista] = useState<Modelo[] | null>(null);
  const [aberto, setAberto] = useState<Modelo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => listarModelos().then(setLista);
  useEffect(() => { void carregar(); }, []);
  const rodape = { rodapeTexto: cfg?.config.rodape_texto, rodapeEndereco: cfg?.config.rodape_endereco };
  const miniaturas = useMemo(
    () => new Map((lista ?? []).map((m) => [m.id, renderEmail(m.blocos ?? [], rodape)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lista, rodape.rodapeTexto, rodape.rodapeEndereco],
  );

  const novo = async () => {
    const { data, error } = await supabase.from("mkt_email_modelos").insert({ nome: "Novo modelo", blocos: MODELO_INICIAL() }).select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberto(data as Modelo);
  };
  const apagar = async (m: Modelo) => {
    if (!window.confirm(`Apagar o modelo "${m.nome}"? Automações que usam ele param de mandar esse passo.`)) return;
    const { error } = await supabase.from("mkt_email_modelos").delete().eq("id", m.id);
    if (error) setErro(erroDoBanco(error)); else void carregar();
  };

  if (aberto) return <Editor m={aberto} onVoltar={() => { setAberto(null); void carregar(); }} />;
  return (
    <div>
      <Topo titulo="Modelos" texto="Monte uma vez, use em campanhas e automações." acoes={<Botao variante="primario" onClick={() => void novo()}>+ Novo modelo</Botao>} />
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum modelo salvo" texto="Um modelo é um e-mail pronto (título, texto, foto, botão) pra reaproveitar." acao={<Botao variante="primario" onClick={() => void novo()}>Criar o primeiro</Botao>} /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {lista.map((m) => (
            <div key={m.id} className="rel-card p-2.5 flex flex-col">
              <button type="button" className="text-left" onClick={() => setAberto(m)} aria-label={`Editar o modelo ${m.nome}`}>
                <Miniatura html={miniaturas.get(m.id) ?? ""} />
                <span className="block text-[14px] font-semibold mt-2 truncate" style={{ color: "var(--ink)" }}>{m.nome}</span>
                <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{m.assunto || "sem assunto"} · {dataHora(m.atualizado_em)}</span>
              </button>
              <div className="mt-2 flex gap-1">
                <Botao onClick={() => setAberto(m)}>Editar</Botao>
                <Botao variante="fantasma" onClick={() => void apagar(m)}>Apagar</Botao>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
