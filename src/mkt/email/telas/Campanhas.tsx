// Marketing › E-mail › aba Campanhas.
//   Lista: resumo de todos os envios no topo + uma linha por campanha.
//   Rascunho abre o ASSISTENTE em 4 passos (Para quem → Conteúdo → Quando →
//   Revisar) com a prévia do e-mail ao lado e o teste embaixo dela.
//   Agendada/enviando/enviada abre o DETALHE: relatório + pausar/retomar/cancelar.
// Só rascunho é editável (RLS da 0245) — por isso o assistente só existe nele;
// pra mudar uma agendada, "Voltar a rascunho".
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { supabase } from "@/lib/supabase";
import {
  chamar, dataHora, erroDoBanco, lerMetricas, listarCampanhas, listarListas, listarModelos, listarSegmentos, pct,
  STATUS_ROTULO, type Campanha, type Lista, type Metricas, type Modelo, type Publico, type Segmento,
} from "../lib/api";
import { MODELO_INICIAL, renderEmail, type Bloco } from "../lib/blocos";
import { PASSOS_CAMPANHA, pendenciasCampanha, quandoParaIso, resumoPublico, type Envio, type PassoCampanha } from "../lib/assistente";
import { useHtmlDosBlocos } from "../lib/useHtmlDosBlocos";
import { useEmail } from "../contexto";
import { Aviso, Botao, Campo, Cartao, Entrada, Escolha, Etiqueta, Ficha, Miniatura, OpcaoCartao, Passos, Topo, Vazio, type Tom } from "../ui";
import { EditorBlocos } from "./EditorBlocos";
import { LadoPrevia } from "./LadoPrevia";
import { ComoConectar } from "./Conexao";
import { BarraProgresso, RelatorioCampanha, ResumoEnvios } from "./Relatorios";

const TOM: Record<Campanha["status"], Tom> = {
  rascunho: "neutro", agendada: "aviso", enviando: "ativo", pausada: "aviso", enviada: "ok", cancelada: "neutro", erro: "erro",
};

const msgErro = (e: unknown) => (e as Error).message;

// ── Passo 1: Para quem ───────────────────────────────────────────────────────
function PassoPara({ c, mudar, listas, segmentos }: {
  c: Campanha; mudar: (p: Partial<Campanha>) => void; listas: Lista[]; segmentos: Segmento[];
}) {
  const [previa, setPrevia] = useState<string | null>(null);
  const pub = c.publico;
  const setPub = (p: Publico) => { mudar({ publico: p }); setPrevia(null); };
  const alternar = (id: string) => setPub({ ...pub, listas: pub.listas.includes(id) ? pub.listas.filter((x) => x !== id) : [...pub.listas, id] });
  const contar = async () => {
    setPrevia("Contando…");
    try {
      const r = await chamar<{ total: number }>({ acao: "previa", publico: pub });
      setPrevia(`${r.total.toLocaleString("pt-BR")} pessoa(s) vão receber.`);
    } catch (e) { setPrevia(msgErro(e)); }
  };
  return (
    <div className="space-y-4">
      <Cartao>
        <Campo rotulo="Nome da campanha (só a equipe vê)">
          <Entrada value={c.nome} maxLength={120} onChange={(e) => mudar({ nome: e.target.value })} placeholder="Ex.: Japão 2027 — abertura de vagas" />
        </Campo>
      </Cartao>
      <Cartao className="space-y-4">
        <div>
          <h3 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Quem vai receber</h3>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>
            Marque as listas. Pra afinar, use tags ou um segmento (aba Públicos) — se usar mais de um, a pessoa precisa passar em todos.
            Quem descadastrou, deu bounce ou marcou spam fica de fora sozinho.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Listas</div>
          {listas.length === 0
            ? <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhuma lista ainda. As listas de contatos são criadas nos Grupos/Disparos do Marketing.</p>
            : <div className="flex flex-wrap gap-2 max-h-48 overflow-auto">{listas.map((l) => <Ficha key={l.id} ligada={pub.listas.includes(l.id)} onAlternar={() => alternar(l.id)}>{l.nome}</Ficha>)}</div>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Segmento (opcional)">
            <Escolha value={pub.segmento_id ?? ""} onChange={(e) => setPub({ ...pub, segmento_id: e.target.value || null })}>
              <option value="">— nenhum —</option>
              {segmentos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </Escolha>
          </Campo>
          <Campo rotulo="Tags (opcional, separe por vírgula)" dica="Basta ter UMA delas.">
            <Entrada value={pub.tags.join(", ")} onChange={(e) => setPub({ ...pub, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Botao onClick={() => void contar()}>Contar quem recebe</Botao>
          {previa ? <span className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}>{previa}</span> : null}
        </div>
      </Cartao>
    </div>
  );
}

// ── Passo 2: Conteúdo ────────────────────────────────────────────────────────
function PassoConteudo({ c, mudar, modelos, html, rodape }: {
  c: Campanha; mudar: (p: Partial<Campanha>) => void; modelos: Modelo[]; html: string;
  rodape: { texto?: string | null; endereco?: string | null };
}) {
  const [mexeuNosBlocos, setMexeu] = useState(false);
  const trocar = (p: Partial<Campanha>, nome: string) => {
    if (mexeuNosBlocos && !window.confirm(`Trocar o conteúdo que você montou por "${nome}"?`)) return;
    mudar(p); setMexeu(false);
  };
  const miniaturas = useMemo(
    () => new Map(modelos.map((m) => [m.id, renderEmail(m.blocos ?? [], { rodapeTexto: rodape.texto, rodapeEndereco: rodape.endereco })])),
    [modelos, rodape.texto, rodape.endereco],
  );
  return (
    <div className="space-y-4">
      <Cartao>
        <div className="text-[15px] font-bold mb-2" style={{ color: "var(--ink)" }}>Começar de um modelo</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          <button type="button" onClick={() => trocar({ modelo_id: null, blocos: MODELO_INICIAL() }, "um e-mail em branco")}
            className="rounded-xl p-2 text-left" style={{ border: `1.5px solid ${!c.modelo_id ? "var(--rel)" : "var(--line)"}` }}>
            <div className="flex items-center justify-center rounded-lg text-[28px]" style={{ height: 120, background: "var(--card2)", color: "var(--ink3)" }}>+</div>
            <div className="text-[13px] font-semibold mt-1.5" style={{ color: "var(--ink)" }}>Em branco</div>
          </button>
          {modelos.map((m) => (
            <button key={m.id} type="button" onClick={() => trocar({ modelo_id: m.id, assunto: m.assunto || c.assunto, preheader: m.preheader || c.preheader, blocos: m.blocos?.length ? m.blocos : c.blocos }, m.nome)}
              className="rounded-xl p-2 text-left" style={{ border: `1.5px solid ${c.modelo_id === m.id ? "var(--rel)" : "var(--line)"}` }}>
              <Miniatura html={miniaturas.get(m.id) ?? ""} altura={120} />
              <div className="text-[13px] font-semibold mt-1.5 truncate" style={{ color: "var(--ink)" }}>{m.nome}</div>
            </button>
          ))}
        </div>
        {modelos.length === 0 ? <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Os modelos salvos (aba Modelos) aparecem aqui.</p> : null}
      </Cartao>
      <Cartao className="grid gap-3">
        <Campo rotulo="Assunto" dica="O que aparece na caixa de entrada. Aceita {{primeiro_nome}}.">
          <Entrada value={c.assunto ?? ""} maxLength={200} onChange={(e) => mudar({ assunto: e.target.value })} placeholder="Ex.: {{primeiro_nome}}, as vagas do Japão abriram" />
        </Campo>
        <Campo rotulo="Pré-cabeçalho (opcional)" dica="O trecho cinza que aparece depois do assunto.">
          <Entrada value={c.preheader ?? ""} maxLength={200} onChange={(e) => mudar({ preheader: e.target.value })} />
        </Campo>
      </Cartao>
      <EditorBlocos semPrevia blocos={c.blocos as Bloco[]} html={html} onChange={(b) => { mudar({ blocos: b }); setMexeu(true); }} />
    </div>
  );
}

// ── Passo 3: Quando ──────────────────────────────────────────────────────────
function PassoQuando({ c, mudar, envio, setEnvio }: {
  c: Campanha; mudar: (p: Partial<Campanha>) => void; envio: Envio; setEnvio: (e: Envio) => void;
}) {
  const { cfg } = useEmail();
  const d = cfg?.config;
  return (
    <div className="space-y-4">
      <Cartao className="space-y-3">
        <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Quando enviar</div>
        <div role="radiogroup" aria-label="Quando enviar" className="grid sm:grid-cols-2 gap-3">
          <OpcaoCartao icone="⚡" titulo="Enviar agora" texto="Sai na próxima rodada da fila (até 5 minutos)." marcado={envio.modo === "agora"} onEscolher={() => setEnvio({ ...envio, modo: "agora" })} />
          <OpcaoCartao icone="🗓" titulo="Agendar" texto="Escolha o dia e a hora (horário de Brasília)." marcado={envio.modo === "agendar"} onEscolher={() => setEnvio({ ...envio, modo: "agendar" })} />
        </div>
        {envio.modo === "agendar" ? (
          <div className="max-w-xs">
            <Campo rotulo="Dia e hora (Brasília)"><Entrada type="datetime-local" value={envio.quando} onChange={(e) => setEnvio({ ...envio, quando: e.target.value })} /></Campo>
          </div>
        ) : null}
      </Cartao>
      <Cartao className="space-y-3">
        <div>
          <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Remetente</div>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>Em branco usa o padrão da conexão{d?.remetente_email ? ` (${d.remetente_nome} <${d.remetente_email}>)` : ""}.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Nome que aparece"><Entrada value={c.remetente_nome ?? ""} placeholder={d?.remetente_nome ?? ""} onChange={(e) => mudar({ remetente_nome: e.target.value })} /></Campo>
          <Campo rotulo="E-mail de envio" dica={d?.dominio ? `Precisa ser @${d.dominio}.` : undefined}>
            <Entrada type="email" value={c.remetente_email ?? ""} placeholder={d?.remetente_email ?? ""} onChange={(e) => mudar({ remetente_email: e.target.value })} />
          </Campo>
          <Campo rotulo="Responder para (opcional)"><Entrada type="email" value={c.responder_para ?? ""} placeholder={d?.responder_para ?? ""} onChange={(e) => mudar({ responder_para: e.target.value })} /></Campo>
        </div>
      </Cartao>
    </div>
  );
}

// ── Passo 4: Revisar ─────────────────────────────────────────────────────────
function Linha({ ok, rotulo, valor, onMudar }: { ok: boolean; rotulo: string; valor: ReactNode; onMudar?: () => void }) {
  return (
    <li className="flex items-start gap-3 py-2.5 border-t first:border-t-0" style={{ borderColor: "var(--line)" }}>
      <span aria-label={ok ? "pronto" : "falta"} className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold flex-shrink-0"
        style={ok ? { background: "var(--rel)", color: "#fff" } : { background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>{ok ? "✓" : "!"}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{rotulo}</span>
        <span className="block text-[14px] break-words" style={{ color: "var(--ink)" }}>{valor}</span>
      </span>
      {onMudar ? <Botao variante="fantasma" onClick={onMudar}>Mudar</Botao> : null}
    </li>
  );
}

type SetCampanha = Dispatch<SetStateAction<Campanha>>;

function Assistente({ c, setC, onVoltar }: { c: Campanha; setC: SetCampanha; onVoltar: () => void }) {
  const { cfg, conectado } = useEmail();
  const [passo, setPasso] = useState<PassoCampanha>("para");
  const [listas, setListas] = useState<Lista[]>([]);
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [envio, setEnvio] = useState<Envio>({ modo: "agora", quando: "" });
  const [msg, setMsg] = useState<{ tom: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mexido, setMexido] = useState(false);
  const rodape = { texto: cfg?.config.rodape_texto, endereco: cfg?.config.rodape_endereco };
  const html = useHtmlDosBlocos(c.blocos, rodape);

  useEffect(() => {
    listarListas().then(setListas);
    listarSegmentos().then(setSegmentos);
    listarModelos().then(setModelos);
  }, []);

  const pend = pendenciasCampanha(c, envio, { dominio: cfg?.config.dominio, remetentePadrao: cfg?.config.remetente_email });
  const mudar = (p: Partial<Campanha>) => { setC((x) => ({ ...x, ...p })); setMexido(true); };

  const salvar = async (): Promise<boolean> => {
    const corpo = {
      nome: c.nome.trim() || "Sem nome", publico: c.publico, remetente_nome: c.remetente_nome?.trim() || null,
      remetente_email: c.remetente_email?.trim().toLowerCase() || null, responder_para: c.responder_para?.trim() || null,
      assunto: c.assunto, preheader: c.preheader, blocos: c.blocos, html, modelo_id: c.modelo_id,
    };
    const { data, error } = await supabase.from("mkt_email_campanhas").update(corpo).eq("id", c.id).select("id");
    if (error) { setMsg({ tom: "erro", texto: erroDoBanco(error) }); return false; }
    // 04/11/2026: a RLS só deixa mexer em rascunho e, fora dele, o update volta sem erro e sem linha — antes dizia "Salvo".
    if (!data?.length) { setMsg({ tom: "erro", texto: "Não salvou: a campanha não é mais rascunho (foi agendada ou enviada em outra aba). Volte pra lista e abra de novo." }); return false; }
    setC((x) => ({ ...x, html })); setMexido(false);
    return true;
  };
  const ir = (p: PassoCampanha) => { if (mexido) void salvar(); setPasso(p); setMsg(null); window.scrollTo(0, 0); };
  const i = PASSOS_CAMPANHA.findIndex((p) => p.id === passo);

  const disparar = async () => {
    const iso = envio.modo === "agendar" ? quandoParaIso(envio.quando) : null;
    if (!window.confirm(iso ? `Agendar para ${dataHora(iso)}? E-mail enviado não volta.` : "Enviar agora (sai em até 5 minutos)? E-mail enviado não volta.")) return;
    setOcupado(true); setMsg(null);
    try {
      if (!(await salvar())) return;
      const r = await chamar<{ ok: true; total?: number; avisos?: string[] }>({ acao: "agendar", campanhaId: c.id, quando: iso });
      const { data } = await supabase.from("mkt_email_campanhas").select("*").eq("id", c.id).single();
      const falta = r.avisos?.length ? ` Atenção: ${r.avisos.join("; ")} — a fila espera até isso ficar pronto.` : "";
      if (falta) window.alert(`Agendada para ${(r.total ?? 0).toLocaleString("pt-BR")} pessoa(s).${falta}`);
      if (data) setC(data as Campanha); // sai de rascunho → vira o detalhe
    } catch (e) { setMsg({ tom: "erro", texto: msgErro(e) }); }
    finally { setOcupado(false); }
  };
  const salvarComoModelo = async () => {
    const nome = window.prompt("Nome do modelo:", c.nome);
    if (!nome) return;
    const { error } = await supabase.from("mkt_email_modelos").insert({ nome, assunto: c.assunto, preheader: c.preheader, blocos: c.blocos, html });
    setMsg(error ? { tom: "erro", texto: erroDoBanco(error) } : { tom: "ok", texto: `Modelo "${nome}" salvo — aparece na aba Modelos.` });
  };
  const testar = async (para: string) => {
    if (!(await salvar())) return "Não consegui salvar o rascunho antes do teste.";
    try { await chamar({ acao: "teste", campanhaId: c.id, para }); return null; } catch (e) { return msgErro(e); }
  };

  const nomesListas = Object.fromEntries(listas.map((l) => [l.id, l.nome]));
  const nomesSeg = Object.fromEntries(segmentos.map((s) => [s.id, s.nome]));
  const d = cfg?.config;
  const remetenteNome = c.remetente_nome || d?.remetente_nome || "";
  const remetenteEmail = c.remetente_email || d?.remetente_email || "";
  const quandoIso = envio.modo === "agendar" ? quandoParaIso(envio.quando) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Botao variante="fantasma" onClick={() => { if (mexido) void salvar(); onVoltar(); }}>← Campanhas</Botao>
        <h2 className="text-[17px] font-bold truncate" style={{ color: "var(--ink)" }}>{c.nome || "Campanha"}</h2>
        <Etiqueta>Rascunho</Etiqueta>
        <span className="ml-auto text-[12px]" style={{ color: "var(--ink3)" }}>{mexido ? "Alterações não salvas" : "Salvo"}</span>
        <Botao disabled={ocupado || !mexido} onClick={() => void salvar()}>Salvar rascunho</Botao>
      </div>
      <Passos passos={PASSOS_CAMPANHA} atual={passo} pendencias={pend} onIr={ir} />
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
        <div className="min-w-0">
          {passo === "para" ? <PassoPara c={c} mudar={mudar} listas={listas} segmentos={segmentos} /> : null}
          {passo === "conteudo" ? <PassoConteudo c={c} mudar={mudar} modelos={modelos} html={html} rodape={rodape} /> : null}
          {passo === "quando" ? <PassoQuando c={c} mudar={mudar} envio={envio} setEnvio={setEnvio} /> : null}
          {passo === "revisar" ? (
            <div className="space-y-4">
              {!conectado ? <ComoConectar compacto /> : null}
              <Cartao>
                <ul>
                  <Linha ok={!pend.para.length} rotulo="Para quem" valor={resumoPublico(c.publico, nomesListas, nomesSeg)} onMudar={() => ir("para")} />
                  <Linha ok={!pend.conteudo.length} rotulo="Assunto" valor={<>{c.assunto || "—"}{c.preheader ? <span style={{ color: "var(--ink3)" }}> · {c.preheader}</span> : null}</>} onMudar={() => ir("conteudo")} />
                  <Linha ok={!pend.quando.some((x) => /remetente/i.test(x))} rotulo="Remetente" valor={remetenteEmail ? `${remetenteNome} <${remetenteEmail}>` : "—"} onMudar={() => ir("quando")} />
                  <Linha ok={!pend.quando.some((x) => !/remetente/i.test(x))} rotulo="Quando" valor={quandoIso ? `Agendado para ${dataHora(quandoIso)}` : envio.modo === "agora" ? "Agora (em até 5 minutos)" : "Escolha o dia e a hora"} onMudar={() => ir("quando")} />
                  <Linha ok rotulo="Rodapé" valor="Link de descadastro e dados da empresa entram sozinhos em todo e-mail." />
                  <Linha ok rotulo="Quem fica de fora" valor="Descadastrados, bounce e denúncia de spam nunca recebem." />
                </ul>
              </Cartao>
              {pend.revisar.length ? (
                <Aviso><b>Antes de enviar:</b><ul className="list-disc pl-5 mt-1">{pend.revisar.map((p) => <li key={p}>{p}</li>)}</ul></Aviso>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Botao variante="primario" className="!px-5 !py-2.5 !text-[14px]" disabled={ocupado || !conectado || pend.revisar.length > 0} onClick={() => void disparar()}>
                  {quandoIso ? `Agendar para ${dataHora(quandoIso)}` : "Enviar agora"}
                </Botao>
                <Botao disabled={ocupado} onClick={() => void salvarComoModelo()}>Salvar como modelo</Botao>
              </div>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Dica: mande um teste pra você (ao lado) e confira na caixa de entrada antes.</p>
            </div>
          ) : null}

          <div className="flex justify-between gap-2 mt-5">
            <Botao disabled={i === 0} onClick={() => ir(PASSOS_CAMPANHA[i - 1].id)}>← Voltar</Botao>
            {i < PASSOS_CAMPANHA.length - 1 ? <Botao variante="primario" onClick={() => ir(PASSOS_CAMPANHA[i + 1].id)}>Próximo: {PASSOS_CAMPANHA[i + 1].rotulo} →</Botao> : null}
          </div>
        </div>
        <LadoPrevia html={html} assunto={c.assunto} preheader={c.preheader} remetente={remetenteNome || null} onTeste={testar} />
      </div>
    </div>
  );
}

// ── Detalhe (fora de rascunho): relatório + ações ────────────────────────────
function Detalhe({ c, setC, onVoltar }: { c: Campanha; setC: SetCampanha; onVoltar: () => void }) {
  const [met, setMet] = useState<Metricas | undefined>();
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => { void lerMetricas(c.id).then((m) => setMet(m[0])); }, [c.id]);
  useEffect(() => {
    carregar();
    if (c.status !== "enviando") return;
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar, c.status]);

  const agir = async (acao: string) => {
    setOcupado(true); setMsg(null);
    try {
      await chamar({ acao, campanhaId: c.id });
      const { data } = await supabase.from("mkt_email_campanhas").select("*").eq("id", c.id).single();
      if (data) setC(data as Campanha);
      carregar();
    } catch (e) { setMsg(msgErro(e)); }
    finally { setOcupado(false); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Botao variante="fantasma" onClick={onVoltar}>← Campanhas</Botao>
        <h2 className="text-[17px] font-bold truncate" style={{ color: "var(--ink)" }}>{c.nome}</h2>
        <Etiqueta tom={TOM[c.status]}>{STATUS_ROTULO[c.status]}</Etiqueta>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {c.status === "agendada" ? `para ${dataHora(c.agendada_para)}` : c.iniciada_em ? `início ${dataHora(c.iniciada_em)}${c.concluida_em ? ` · fim ${dataHora(c.concluida_em)}` : ""}` : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {c.status === "agendada" ? <Botao disabled={ocupado} onClick={() => void agir("voltar_rascunho")}>Voltar a rascunho</Botao> : null}
          {c.status === "enviando" ? <Botao disabled={ocupado} onClick={() => void agir("pausar")}>Pausar</Botao> : null}
          {c.status === "pausada" ? <Botao variante="primario" disabled={ocupado} onClick={() => void agir("retomar")}>Retomar</Botao> : null}
          {["agendada", "enviando", "pausada"].includes(c.status) ? (
            <Botao variante="perigo" disabled={ocupado} onClick={() => window.confirm("Cancelar a campanha? Quem ainda não recebeu, não recebe mais.") && void agir("cancelar")}>Cancelar</Botao>
          ) : null}
        </div>
      </div>
      {msg ? <Aviso tom="erro">{msg}</Aviso> : null}
      {c.erro ? <Aviso tom="erro">{c.erro}</Aviso> : null}
      {c.status === "agendada" ? <Aviso>Só rascunho é editável. Pra mudar alguma coisa, volte a campanha a rascunho (ela sai da agenda).</Aviso> : null}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
        <div className="min-w-0">
          {c.status === "agendada" ? <p className="text-[13px] mb-3" style={{ color: "var(--ink2)" }}>O relatório aparece aqui quando o envio começar.</p> : <RelatorioCampanha campanhaId={c.id} metricas={met} />}
        </div>
        <LadoPrevia html={c.html} assunto={c.assunto} preheader={c.preheader} remetente={c.remetente_nome} />
      </div>
    </div>
  );
}

function CampanhaAberta({ inicial, onVoltar }: { inicial: Campanha; onVoltar: () => void }) {
  const [c, setC] = useState(inicial);
  return c.status === "rascunho" ? <Assistente c={c} setC={setC} onVoltar={onVoltar} /> : <Detalhe c={c} setC={setC} onVoltar={onVoltar} />;
}

// ── Lista ────────────────────────────────────────────────────────────────────
export default function Campanhas() {
  const { carregando: conferindo, conectado, pronto, cfg, abrirConexao } = useEmail();
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [met, setMet] = useState<Map<string, Metricas>>(new Map());
  const [aberta, setAberta] = useState<Campanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [c, m] = await Promise.all([listarCampanhas(), lerMetricas()]);
    setLista(c);
    setMet(new Map(m.map((x) => [x.campanha_id, x])));
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

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
    if (error) setErro(erroDoBanco(error)); else void carregar();
  };

  if (aberta) return <CampanhaAberta inicial={aberta} onVoltar={() => { setAberta(null); void carregar(); }} />;

  return (
    <div>
      {!conferindo && !conectado ? <ComoConectar compacto={Boolean(lista?.length)} /> : null}
      {conectado && !pronto && cfg?.faltando.length ? (
        <Aviso>Antes de enviar falta: {cfg.faltando.join(" · ")}. <button type="button" className="underline font-semibold" onClick={abrirConexao}>Resolver</button></Aviso>
      ) : null}
      <ResumoEnvios metricas={[...met.values()]} />
      <Topo titulo="Campanhas" texto="Um e-mail para muita gente, agora ou numa data marcada." acoes={<Botao variante="primario" onClick={() => void nova()}>+ Nova campanha</Botao>} />
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma campanha ainda" texto="Em 4 passos: pra quem vai, o conteúdo, quando sai e uma revisada final." acao={<Botao variante="primario" onClick={() => void nova()}>Criar a primeira</Botao>} /></div>
      ) : (
        <ul className="space-y-2">
          {lista.map((c) => {
            const m = met.get(c.id);
            return (
              <li key={c.id} className="rel-card rel-linha flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:px-4">
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setAberta(c)}>
                  <span className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{c.nome}</span>
                    <Etiqueta tom={TOM[c.status]}>{STATUS_ROTULO[c.status]}</Etiqueta>
                  </span>
                  <span className="block text-[12px] truncate mt-0.5" style={{ color: "var(--ink3)" }}>
                    {c.assunto || "sem assunto"} · {dataHora(c.concluida_em || c.agendada_para || c.criado_em)}
                  </span>
                  {m && c.status === "enviando" ? <span className="block mt-2 max-w-sm"><BarraProgresso feito={m.enviados + m.falhas} total={m.total} /></span> : null}
                </button>
                {m ? (
                  <span className="flex gap-5 text-[12px] tabular-nums" style={{ color: "var(--ink3)" }}>
                    <span><b className="block text-[14px]" style={{ color: "var(--ink)" }}>{m.enviados.toLocaleString("pt-BR")}</b>enviados</span>
                    <span><b className="block text-[14px]" style={{ color: "var(--ink)" }}>{pct(m.abriram, m.enviados)}</b>abriram</span>
                    <span><b className="block text-[14px]" style={{ color: "var(--ink)" }}>{pct(m.clicaram, m.enviados)}</b>clicaram</span>
                  </span>
                ) : null}
                <span className="flex gap-1">
                  <Botao onClick={() => setAberta(c)}>{c.status === "rascunho" ? "Continuar" : c.status === "agendada" ? "Abrir" : "Ver relatório"}</Botao>
                  {["rascunho", "cancelada", "erro"].includes(c.status) ? <Botao variante="fantasma" onClick={() => void apagar(c)}>Apagar</Botao> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
