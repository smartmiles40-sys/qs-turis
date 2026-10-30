// Marketing › E-mail › Campanhas: lista, editor (público, remetente, assunto,
// pré-cabeçalho, blocos), teste para 1 e-mail, agendar/enviar, pausar/cancelar.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  chamar, dataHora, erroDoBanco, lerMetricas, listarCampanhas, listarListas, listarModelos, listarSegmentos, pct, status as lerStatus,
  STATUS_ROTULO, type Campanha, type Lista, type Metricas, type Modelo, type Publico, type Segmento, type StatusConexao,
} from "../lib/api";
import { MODELO_INICIAL, type Bloco } from "../lib/blocos";
import { Aviso, Botao, Campo, Entrada, Escolha, Etiqueta, Tela, Vazio } from "../ui";
import { EditorBlocos } from "./EditorBlocos";
import { useHtmlDosBlocos } from "../lib/useHtmlDosBlocos";

const TOM: Record<Campanha["status"], "neutro" | "ok" | "aviso" | "erro" | "ativo"> = {
  rascunho: "neutro", agendada: "aviso", enviando: "ativo", pausada: "aviso", enviada: "ok", cancelada: "neutro", erro: "erro",
};

function SeletorPublico({ valor, onChange, listas, segmentos, desligado }: {
  valor: Publico; onChange: (p: Publico) => void; listas: Lista[]; segmentos: Segmento[]; desligado: boolean;
}) {
  const [previa, setPrevia] = useState<string | null>(null);
  const contar = async () => {
    setPrevia("Contando…");
    try {
      const r = await chamar<{ total: number }>({ acao: "previa", publico: valor });
      setPrevia(`${r.total.toLocaleString("pt-BR")} pessoa(s) com e-mail ativo (sem descadastrados, bounce e spam).`);
    } catch (e) { setPrevia((e as Error).message); }
  };
  const alternar = (id: string) =>
    onChange({ ...valor, listas: valor.listas.includes(id) ? valor.listas.filter((x) => x !== id) : [...valor.listas, id] });
  return (
    <div className="mke-card p-4 space-y-3">
      <div className="text-sm font-semibold">Público</div>
      <p className="text-xs" style={{ color: "var(--ink2)" }}>Quem recebe: está em alguma das listas marcadas <b>E</b> tem alguma das tags <b>E</b> casa com o segmento. Sem nada marcado ninguém recebe.</p>
      <div>
        <div className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Listas</div>
        {listas.length === 0 ? <p className="text-xs" style={{ color: "var(--ink2)" }}>Nenhuma lista ainda (Marketing › Contatos).</p> : (
          <div className="flex flex-wrap gap-2 max-h-40 overflow-auto">
            {listas.map((l) => (
              <label key={l.id} className="inline-flex items-center gap-1.5 text-[13px] px-2 py-1 rounded-lg" style={{ border: "1px solid var(--line)" }}>
                <input type="checkbox" disabled={desligado} checked={valor.listas.includes(l.id)} onChange={() => alternar(l.id)} /> {l.nome}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Campo rotulo="Segmento">
          <Escolha disabled={desligado} value={valor.segmento_id ?? ""} onChange={(e) => onChange({ ...valor, segmento_id: e.target.value || null })}>
            <option value="">— nenhum —</option>
            {segmentos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </Escolha>
        </Campo>
        <Campo rotulo="Tags (separe por vírgula)" dica="Basta ter UMA delas.">
          <Entrada disabled={desligado} value={valor.tags.join(", ")} onChange={(e) => onChange({ ...valor, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
        </Campo>
      </div>
      <div className="flex items-center gap-3">
        <Botao onClick={contar}>Contar quem recebe</Botao>
        {previa ? <span className="text-xs" style={{ color: "var(--ink2)" }}>{previa}</span> : null}
      </div>
    </div>
  );
}

function Editor({ inicial, onVoltar, cfg }: { inicial: Campanha; onVoltar: () => void; cfg: StatusConexao | null }) {
  const [c, setC] = useState<Campanha>(inicial);
  const [listas, setListas] = useState<Lista[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [para, setPara] = useState("");
  const [quando, setQuando] = useState("");
  const editavel = c.status === "rascunho";
  const html = useHtmlDosBlocos(c.blocos, { texto: cfg?.config.rodape_texto, endereco: cfg?.config.rodape_endereco });

  useEffect(() => {
    listarListas().then(setListas);
    listarSegmentos().then(setSegmentos);
    listarModelos().then(setModelos);
  }, []);

  const salvar = async (): Promise<boolean> => {
    const corpo = {
      nome: c.nome.trim() || "Sem nome", publico: c.publico, remetente_nome: c.remetente_nome || null,
      remetente_email: c.remetente_email?.trim().toLowerCase() || null, responder_para: c.responder_para?.trim() || null,
      assunto: c.assunto, preheader: c.preheader, blocos: c.blocos, html, modelo_id: c.modelo_id,
    };
    const { error } = await supabase.from("mkt_email_campanhas").update(corpo).eq("id", c.id);
    if (error) { setMsg({ tom: "erro", texto: erroDoBanco(error) }); return false; }
    setC((x) => ({ ...x, html }));
    setMsg({ tom: "ok", texto: "Salvo." });
    return true;
  };

  const agir = async (acao: string, extra: Record<string, unknown> = {}) => {
    setOcupado(true); setMsg(null);
    try {
      if (editavel && !(await salvar())) return;
      const r = await chamar<{ ok: true; total?: number; avisos?: string[] }>({ acao, campanhaId: c.id, ...extra });
      if (acao === "teste") setMsg({ tom: "ok", texto: `Teste enviado para ${extra.para}. Abertura e clique do teste NÃO contam.` });
      else {
        const { data } = await supabase.from("mkt_email_campanhas").select("*").eq("id", c.id).single();
        if (data) setC(data as Campanha);
        const falta = r.avisos?.length ? ` Atenção: ${r.avisos.join("; ")} — a fila espera até isso ficar pronto.` : "";
        setMsg({ tom: falta ? "aviso" : "ok", texto: (r.total ? `Agendada para ${r.total.toLocaleString("pt-BR")} pessoa(s).` : "Feito.") + falta });
      }
    } catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
    finally { setOcupado(false); }
  };

  const usarModelo = (id: string) => {
    const m = modelos.find((x) => x.id === id);
    if (!m) return;
    setC({ ...c, modelo_id: m.id, assunto: c.assunto || m.assunto, preheader: c.preheader || m.preheader, blocos: m.blocos?.length ? m.blocos : c.blocos });
  };
  const salvarComoModelo = async () => {
    const nome = window.prompt("Nome do modelo:", c.nome);
    if (!nome) return;
    const { error } = await supabase.from("mkt_email_modelos").insert({ nome, assunto: c.assunto, preheader: c.preheader, blocos: c.blocos, html });
    setMsg(error ? { tom: "erro", texto: erroDoBanco(error) } : { tom: "ok", texto: `Modelo "${nome}" salvo.` });
    if (!error) listarModelos().then(setModelos);
  };

  return (
    <Tela
      titulo={c.nome || "Campanha"}
      sub={<><Etiqueta tom={TOM[c.status]}>{STATUS_ROTULO[c.status]}</Etiqueta>{c.agendada_para ? <span className="ml-2">para {dataHora(c.agendada_para)}</span> : null}{c.erro ? <span className="ml-2" style={{ color: "var(--red)" }}>{c.erro}</span> : null}</>}
      acoes={<>
        <Botao onClick={onVoltar}>← Campanhas</Botao>
        {editavel ? <Botao variante="primario" disabled={ocupado} onClick={salvar}>Salvar rascunho</Botao> : null}
        {c.status === "agendada" ? <Botao disabled={ocupado} onClick={() => agir("voltar_rascunho")}>Voltar a rascunho</Botao> : null}
        {c.status === "enviando" ? <Botao disabled={ocupado} onClick={() => agir("pausar")}>Pausar</Botao> : null}
        {c.status === "pausada" ? <Botao disabled={ocupado} onClick={() => agir("retomar")}>Retomar</Botao> : null}
        {["agendada", "enviando", "pausada"].includes(c.status) ? (
          <Botao variante="perigo" disabled={ocupado} onClick={() => window.confirm("Cancelar a campanha? Quem ainda não recebeu, não recebe mais.") && agir("cancelar")}>Cancelar</Botao>
        ) : null}
      </>}
    >
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      {!editavel ? <Aviso>Só rascunho é editável. Para mudar uma agendada, volte-a a rascunho.</Aviso> : null}
      <fieldset disabled={!editavel} className="space-y-4">
        <div className="mke-card p-4 grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Nome interno"><Entrada value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} /></Campo>
          <Campo rotulo="Partir de um modelo">
            <Escolha value={c.modelo_id ?? ""} onChange={(e) => usarModelo(e.target.value)}>
              <option value="">— em branco —</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </Escolha>
          </Campo>
          <Campo rotulo="Nome do remetente" dica={`Padrão: ${cfg?.config.remetente_nome ?? "—"}`}><Entrada value={c.remetente_nome ?? ""} onChange={(e) => setC({ ...c, remetente_nome: e.target.value })} /></Campo>
          <Campo rotulo="E-mail do remetente" dica={cfg?.config.dominio ? `Precisa ser @${cfg.config.dominio}. Padrão: ${cfg.config.remetente_email ?? "—"}` : "Defina o domínio em Conexão."}>
            <Entrada type="email" value={c.remetente_email ?? ""} onChange={(e) => setC({ ...c, remetente_email: e.target.value })} />
          </Campo>
          <Campo rotulo="Responder para (opcional)"><Entrada type="email" value={c.responder_para ?? ""} onChange={(e) => setC({ ...c, responder_para: e.target.value })} /></Campo>
          <Campo rotulo="Assunto" dica="Aceita {{primeiro_nome}}."><Entrada value={c.assunto ?? ""} maxLength={200} onChange={(e) => setC({ ...c, assunto: e.target.value })} /></Campo>
          <div className="sm:col-span-2">
            <Campo rotulo="Pré-cabeçalho" dica="O trecho que aparece depois do assunto na caixa de entrada.">
              <Entrada value={c.preheader ?? ""} maxLength={200} onChange={(e) => setC({ ...c, preheader: e.target.value })} />
            </Campo>
          </div>
        </div>
        <SeletorPublico valor={c.publico} onChange={(p) => setC({ ...c, publico: p })} listas={listas} segmentos={segmentos} desligado={!editavel} />
        <EditorBlocos blocos={c.blocos as Bloco[]} onChange={(b) => setC({ ...c, blocos: b })} html={html} />
      </fieldset>
      <div className="mke-card p-4 mt-4 grid md:grid-cols-3 gap-4 items-end">
        <Campo rotulo="Enviar teste para">
          <Entrada type="email" value={para} onChange={(e) => setPara(e.target.value)} placeholder="voce@agencia.com" />
        </Campo>
        <Botao disabled={ocupado || !para} onClick={() => agir("teste", { para })}>Enviar teste</Botao>
        <Botao disabled={!editavel || ocupado} onClick={salvarComoModelo}>Salvar como modelo</Botao>
        {editavel ? <>
          <Campo rotulo="Agendar para (horário de Brasília)" dica="Vazio = sai na próxima rodada (até 5 min).">
            <Entrada type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} />
          </Campo>
          <Botao variante="primario" disabled={ocupado} onClick={() => {
            const iso = quando ? new Date(`${quando}:00-03:00`).toISOString() : null;
            if (window.confirm(iso ? `Agendar para ${dataHora(iso)}?` : "Enviar agora (na próxima rodada, até 5 min)?")) agir("agendar", { quando: iso });
          }}>{quando ? "Agendar" : "Enviar agora"}</Botao>
        </> : null}
      </div>
    </Tela>
  );
}

export default function Campanhas() {
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [met, setMet] = useState<Map<string, Metricas>>(new Map());
  const [aberta, setAberta] = useState<Campanha | null>(null);
  const [cfg, setCfg] = useState<StatusConexao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [c, m] = await Promise.all([listarCampanhas(), lerMetricas()]);
    setLista(c);
    setMet(new Map(m.map((x) => [x.campanha_id, x])));
  }, []);
  useEffect(() => { carregar(); lerStatus().then(setCfg).catch(() => setCfg(null)); }, [carregar]);

  const nova = async () => {
    setErro(null);
    const { data, error } = await supabase.from("mkt_email_campanhas")
      .insert({ nome: `Campanha ${new Date().toLocaleDateString("pt-BR")}`, blocos: MODELO_INICIAL() })
      .select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberta(data as Campanha);
  };
  const apagar = async (c: Campanha) => {
    if (!window.confirm(`Apagar "${c.nome}"? O histórico de envios dela some junto.`)) return;
    const { error } = await supabase.from("mkt_email_campanhas").delete().eq("id", c.id);
    if (error) setErro(erroDoBanco(error)); else carregar();
  };

  if (aberta) return <Editor inicial={aberta} cfg={cfg} onVoltar={() => { setAberta(null); carregar(); }} />;

  return (
    <Tela titulo="Campanhas de e-mail" sub="Envio pelo Resend, fila por destinatário, abertura e clique medidos pelo QS." acoes={<Botao variante="primario" onClick={nova}>+ Nova campanha</Botao>}>
      {cfg && cfg.faltando.length ? <Aviso>Antes de enviar: {cfg.faltando.join(" · ")} (Conexão).</Aviso> : null}
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-sm">Carregando…</p> : lista.length === 0 ? <Vazio texto="Nenhuma campanha ainda." acao={<Botao variante="primario" onClick={nova}>Criar a primeira</Botao>} /> : (
        <div className="mke-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr style={{ color: "var(--ink2)" }} className="text-left">
              <th className="p-3">Campanha</th><th className="p-3">Situação</th><th className="p-3 text-right">Enviados</th>
              <th className="p-3 text-right">Abertura</th><th className="p-3 text-right">Clique</th><th className="p-3">Quando</th><th className="p-3" />
            </tr></thead>
            <tbody>
              {lista.map((c) => {
                const m = met.get(c.id);
                return (
                  <tr key={c.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="p-3"><button className="font-semibold text-left hover:underline" onClick={() => setAberta(c)}>{c.nome}</button><div className="text-xs" style={{ color: "var(--ink2)" }}>{c.assunto || "sem assunto"}</div></td>
                    <td className="p-3"><Etiqueta tom={TOM[c.status]}>{STATUS_ROTULO[c.status]}</Etiqueta></td>
                    <td className="p-3 text-right tabular-nums">{m ? `${m.enviados}/${m.total}` : "—"}</td>
                    <td className="p-3 text-right tabular-nums">{m ? pct(m.abriram, m.enviados) : "—"}</td>
                    <td className="p-3 text-right tabular-nums">{m ? pct(m.clicaram, m.enviados) : "—"}</td>
                    <td className="p-3 text-xs">{dataHora(c.concluida_em || c.agendada_para || c.criado_em)}</td>
                    <td className="p-3 text-right">{["rascunho", "cancelada", "erro"].includes(c.status) ? <Botao variante="fantasma" onClick={() => apagar(c)}>Apagar</Botao> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Tela>
  );
}
