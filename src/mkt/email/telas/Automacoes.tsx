// Marketing › E-mail › Automações: gatilho (entrou na lista / ganhou tag /
// formulário) → sequência de e-mails com esperas. O cron do QS (5 em 5 min) anda a fila.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { erroDoBanco, listarListas, listarModelos, type Automacao, type Lista, type Modelo, type Passo } from "../lib/api";
import { Aviso, Botao, Campo, Entrada, Escolha, Etiqueta, Tela, Vazio } from "../ui";

type Unidade = "minutos" | "horas" | "dias";
const FATOR: Record<Unidade, number> = { minutos: 1, horas: 60, dias: 1440 };
const emUnidade = (min: number): [number, Unidade] => (min % 1440 === 0 ? [min / 1440, "dias"] : min % 60 === 0 ? [min / 60, "horas"] : [min, "minutos"]);

function EditorAutomacao({ a, listas, modelos, onVoltar }: { a: Automacao; listas: Lista[]; modelos: Modelo[]; onVoltar: () => void }) {
  const [x, setX] = useState<Automacao>(a);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [contagem, setContagem] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.from("mkt_email_auto_execucoes").select("status").eq("automacao_id", a.id).limit(5000).then(({ data }) => {
      const c: Record<string, number> = {};
      for (const r of data ?? []) c[(r as { status: string }).status] = (c[(r as { status: string }).status] ?? 0) + 1;
      setContagem(c);
    });
  }, [a.id]);

  const salvar = async (ativo = x.ativo) => {
    const { error } = await supabase.from("mkt_email_automacoes").update({
      nome: x.nome.trim() || "Sem nome", ativo, gatilho_tipo: x.gatilho_tipo,
      gatilho_valor: x.gatilho_valor?.trim() || null, passos: x.passos,
    }).eq("id", x.id);
    if (error) { setMsg({ tom: "erro", texto: /passos_chk/.test(error.message) ? "Confira os passos: todo e-mail precisa de modelo e toda espera de 1 min a 90 dias." : erroDoBanco(error) }); return; }
    setX({ ...x, ativo });
    setMsg({ tom: "ok", texto: ativo ? "Automação LIGADA: quem entrar no gatilho a partir de agora começa a sequência." : "Salvo." });
  };
  const trocarPasso = (i: number, p: Passo) => setX({ ...x, passos: x.passos.map((q, j) => (j === i ? p : q)) });

  return (
    <Tela
      titulo={x.nome}
      sub={<>{x.ativo ? <Etiqueta tom="ok">Ligada</Etiqueta> : <Etiqueta>Desligada</Etiqueta>} <span className="ml-2">Em andamento: {contagem.ativa ?? 0} · concluídas: {contagem.concluida ?? 0} · canceladas: {contagem.cancelada ?? 0}</span></>}
      acoes={<>
        <Botao onClick={onVoltar}>← Automações</Botao>
        <Botao onClick={() => salvar()}>Salvar</Botao>
        <Botao variante={x.ativo ? "perigo" : "primario"} onClick={() => salvar(!x.ativo)}>{x.ativo ? "Desligar" : "Salvar e ligar"}</Botao>
      </>}
    >
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      <Aviso>Cada pessoa passa UMA vez por automação. Quem descadastra, dá bounce ou marca spam sai da sequência. Desligar segura quem está no meio (continua quando religar).</Aviso>
      <div className="mke-card p-4 grid sm:grid-cols-3 gap-3 mb-4">
        <Campo rotulo="Nome"><Entrada value={x.nome} onChange={(e) => setX({ ...x, nome: e.target.value })} /></Campo>
        <Campo rotulo="Quando começa">
          <Escolha value={x.gatilho_tipo} onChange={(e) => setX({ ...x, gatilho_tipo: e.target.value as Automacao["gatilho_tipo"], gatilho_valor: null })}>
            <option value="lista">Entrou na lista</option>
            <option value="tag">Ganhou a tag</option>
            <option value="formulario">Respondeu formulário</option>
          </Escolha>
        </Campo>
        {x.gatilho_tipo === "lista" ? (
          <Campo rotulo="Lista">
            <Escolha value={x.gatilho_valor ?? ""} onChange={(e) => setX({ ...x, gatilho_valor: e.target.value })}>
              <option value="">— escolha —</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Escolha>
          </Campo>
        ) : (
          <Campo rotulo={x.gatilho_tipo === "tag" ? "Tag" : "Nome do formulário"} dica={x.gatilho_tipo === "formulario" ? "Vazio = qualquer formulário (evento 'formulario' do contato)." : undefined}>
            <Entrada value={x.gatilho_valor ?? ""} onChange={(e) => setX({ ...x, gatilho_valor: e.target.value })} />
          </Campo>
        )}
      </div>
      <div className="space-y-2">
        {x.passos.map((p, i) => {
          const [n, u] = p.tipo === "esperar" ? emUnidade(p.minutos) : [0, "dias" as Unidade];
          return (
            <div key={i} className="mke-card p-3 flex flex-wrap gap-2 items-center">
              <span className="text-xs font-bold w-16" style={{ color: "var(--ink2)" }}>Passo {i + 1}</span>
              {p.tipo === "email" ? (
                <><span className="text-[13px]">Enviar e-mail</span>
                  <Escolha className="w-72" value={p.modelo_id} onChange={(e) => trocarPasso(i, { tipo: "email", modelo_id: e.target.value })}>
                    <option value="">— modelo —</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </Escolha></>
              ) : (
                <><span className="text-[13px]">Esperar</span>
                  <Entrada className="w-24" type="number" min={1} value={n} onChange={(e) => trocarPasso(i, { tipo: "esperar", minutos: Math.max(1, Number(e.target.value) || 1) * FATOR[u] })} />
                  <Escolha className="w-32" value={u} onChange={(e) => trocarPasso(i, { tipo: "esperar", minutos: n * FATOR[e.target.value as Unidade] })}>
                    <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
                  </Escolha></>
              )}
              <Botao variante="fantasma" className="ml-auto" aria-label="Remover passo" onClick={() => setX({ ...x, passos: x.passos.filter((_, j) => j !== i) })}>✕</Botao>
            </div>
          );
        })}
        <div className="flex gap-2">
          <Botao onClick={() => setX({ ...x, passos: [...x.passos, { tipo: "email", modelo_id: "" }] })}>+ E-mail</Botao>
          <Botao onClick={() => setX({ ...x, passos: [...x.passos, { tipo: "esperar", minutos: 1440 }] })}>+ Espera</Botao>
        </div>
        {modelos.length === 0 ? <p className="text-xs" style={{ color: "var(--ink2)" }}>Crie um modelo em "Modelos de e-mail" antes.</p> : null}
      </div>
    </Tela>
  );
}

export default function Automacoes() {
  const [lista, setLista] = useState<Automacao[] | null>(null);
  const [aberta, setAberta] = useState<Automacao | null>(null);
  const [listas, setListas] = useState<Lista[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => supabase.from("mkt_email_automacoes").select("*").order("criado_em", { ascending: false }).then(({ data }) => setLista((data ?? []) as Automacao[]));
  useEffect(() => { carregar(); listarListas().then(setListas); listarModelos().then(setModelos); }, []);

  const nova = async () => {
    const { data, error } = await supabase.from("mkt_email_automacoes")
      .insert({ nome: "Boas-vindas", gatilho_tipo: "formulario", gatilho_valor: null, passos: [] }).select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberta(data as Automacao);
  };
  const apagar = async (a: Automacao) => {
    if (!window.confirm(`Apagar "${a.nome}"? Quem está no meio para de receber.`)) return;
    const { error } = await supabase.from("mkt_email_automacoes").delete().eq("id", a.id);
    if (error) setErro(erroDoBanco(error)); else carregar();
  };

  if (aberta) return <EditorAutomacao a={aberta} listas={listas} modelos={modelos} onVoltar={() => { setAberta(null); carregar(); }} />;
  const rotGatilho = (a: Automacao) =>
    a.gatilho_tipo === "lista" ? `Entrou na lista ${listas.find((l) => l.id === a.gatilho_valor)?.nome ?? "?"}`
      : a.gatilho_tipo === "tag" ? `Ganhou a tag "${a.gatilho_valor}"` : `Formulário ${a.gatilho_valor ? `"${a.gatilho_valor}"` : "(qualquer)"}`;
  return (
    <Tela titulo="Automações de e-mail" sub="Sequências simples: gatilho → e-mails com esperas." acoes={<Botao variante="primario" onClick={nova}>+ Nova automação</Botao>}>
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-sm">Carregando…</p> : lista.length === 0 ? <Vazio texto="Nenhuma automação ainda." /> : (
        <div className="grid sm:grid-cols-2 gap-3">
          {lista.map((a) => (
            <div key={a.id} className="mke-card p-4">
              <div className="flex items-center gap-2"><button className="font-semibold hover:underline" onClick={() => setAberta(a)}>{a.nome}</button>{a.ativo ? <Etiqueta tom="ok">Ligada</Etiqueta> : <Etiqueta>Desligada</Etiqueta>}</div>
              <div className="text-xs mt-1" style={{ color: "var(--ink2)" }}>{rotGatilho(a)} · {a.passos.filter((p) => p.tipo === "email").length} e-mail(s)</div>
              <div className="mt-3 flex gap-2"><Botao onClick={() => setAberta(a)}>Editar</Botao><Botao variante="fantasma" onClick={() => apagar(a)}>Apagar</Botao></div>
            </div>
          ))}
        </div>
      )}
    </Tela>
  );
}
