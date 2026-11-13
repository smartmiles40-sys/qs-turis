// src/agencia/AgenciaApp.tsx
// -----------------------------------------------------------------------------
// PORTAL DA AGÊNCIA (0395, 13/11/2026) — #agencia, fora do login do QS.
// A agência (hoje a Disrupt):
//   1. sobe o planejamento (PDF ou Google Docs) dizendo se é SEMANAL ou MENSAL;
//   2. a IA lê e preenche os conteúdos no formato padrão;
//   3. a agência completa o que faltou (rede, data, horário…) — sem isso não envia;
//   4. os supervisores revisam; se devolverem, as obs aparecem aqui;
//   5. aprovado → em "Produção" ela cola o link do Canva de cada conteúdo.
// Fala só com /api/mkt-agencia (src/agencia/api.ts).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { REL_CSS, Aviso, Botao, Entrada, Etiqueta } from "@/rel/ui";
import ItensEditor, { dataCurta, quando, type ObsVista } from "@/mkt/planejamento/ItensEditor";
import { NOME_PERIODICIDADE, faltasDoPlanejamento, periodoValido, semanaDe, type ItemPlano } from "@/mkt/planejamento/regras";
import { api, guardarToken, lerToken, SessaoExpirada, type CardAg, type PerfilAg, type PlanoAg, type PlanoResumo } from "./api";

const CSS = `${REL_CSS}
:root { --rel: #BE185D; --rel-hover: #9D174D; --rel-ink: #9D174D; --rel-soft: #FCE7F3; }
html.dark { --rel-ink: #F9A8D4; --rel-soft: rgba(244, 114, 182, .15); }
.rel-input:focus, .rel-input:focus-visible { box-shadow: 0 0 0 3px rgba(190, 24, 93, .25); }
`;

const STATUS: Record<string, { nome: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  rascunho: { nome: "Rascunho — falta enviar", tom: "neutro" },
  enviado: { nome: "Em revisão na STFV", tom: "aviso" },
  devolvido: { nome: "Devolvido — ajustar", tom: "erro" },
  aprovado: { nome: "Aprovado", tom: "rel" },
};

export default function AgenciaApp() {
  const [logado, setLogado] = useState<{ nome: string; agencia: string } | null>(null);
  const [checando, setChecando] = useState(!!lerToken());

  useEffect(() => {
    if (!lerToken()) return;
    api.eu().then((e) => setLogado(e)).catch(() => guardarToken(null)).finally(() => setChecando(false));
  }, []);

  const sair = useCallback(async () => {
    await api.sair().catch(() => null);
    guardarToken(null);
    setLogado(null);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <style>{CSS}</style>
      {checando ? null : logado ? <Portal quem={logado} onSair={sair} onExpirou={() => setLogado(null)} /> : <Login onEntrou={setLogado} />}
    </div>
  );
}

function Login({ onEntrou }: { onEntrou: (q: { nome: string; agencia: string }) => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  async function entrar(e: FormEvent) {
    e.preventDefault();
    setIndo(true); setErro(null);
    try {
      const r = await api.login(email.trim(), senha);
      guardarToken(r.token);
      onEntrou({ nome: r.nome, agencia: r.agencia });
    } catch (err) { setErro(err instanceof Error ? err.message : "Não deu para entrar."); }
    finally { setIndo(false); }
  }
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={entrar} className="rel-card w-full max-w-sm p-6 space-y-4" aria-labelledby="t-login">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--rel-ink)" }}>Se Tu For, Eu Vou</p>
          <h1 id="t-login" className="text-xl font-bold mt-1" style={{ color: "var(--ink)" }}>Portal da agência</h1>
          <p className="text-[13px] mt-1" style={{ color: "var(--ink3)" }}>Planejamento de conteúdo e produção.</p>
        </div>
        <label className="block text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>E-mail
          <Entrada type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1" />
        </label>
        <label className="block text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Senha
          <Entrada type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required className="mt-1" />
        </label>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Botao variante="primario" type="submit" className="w-full py-2.5" disabled={indo}>{indo ? "Entrando…" : "Entrar"}</Botao>
      </form>
    </main>
  );
}

type Aba = "planejamentos" | "producao";

function Portal({ quem, onSair, onExpirou }: { quem: { nome: string; agencia: string }; onSair: () => void; onExpirou: () => void }) {
  const [aba, setAba] = useState<Aba>("planejamentos");
  const [aberto, setAberto] = useState<string | null>(null);
  const [perfis, setPerfis] = useState<PerfilAg[]>([]);
  const tratar = useCallback((e: unknown) => {
    if (e instanceof SessaoExpirada) { onExpirou(); return null; }
    return e instanceof Error ? e.message : "Algo deu errado.";
  }, [onExpirou]);

  useEffect(() => { api.perfis().then((r) => setPerfis(r.perfis)).catch(tratar); }, [tratar]);

  return (
    <>
      <header className="sticky top-0 z-10 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3" style={{ background: "var(--card)", borderBottom: "1px solid var(--line)" }}>
        <div className="mr-auto min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--rel-ink)" }}>Se Tu For, Eu Vou · Portal da agência</p>
          <p className="text-[13px] truncate" style={{ color: "var(--ink3)" }}>{quem.nome} · {quem.agencia}</p>
        </div>
        <nav className="flex gap-1" aria-label="Seções">
          {(["planejamentos", "producao"] as Aba[]).map((a) => (
            <button key={a} type="button" aria-current={aba === a ? "page" : undefined} onClick={() => { setAba(a); setAberto(null); }}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold"
              style={aba === a ? { background: "var(--rel)", color: "#fff" } : { color: "var(--ink2)" }}>
              {a === "planejamentos" ? "Planejamentos" : "Produção"}
            </button>
          ))}
        </nav>
        <Botao variante="fantasma" onClick={onSair}>Sair</Botao>
      </header>
      <main className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
        {aba === "producao" ? <Producao perfis={perfis} tratar={tratar} />
          : aberto ? <Detalhe id={aberto} perfis={perfis} tratar={tratar} onVoltar={() => setAberto(null)} />
          : <ListaPlanos tratar={tratar} onAbrir={setAberto} />}
      </main>
    </>
  );
}

// ── Lista + novo ────────────────────────────────────────────────────────────

function ListaPlanos({ tratar, onAbrir }: { tratar: (e: unknown) => string | null; onAbrir: (id: string) => void }) {
  const [planos, setPlanos] = useState<PlanoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  useEffect(() => { api.planejamentos().then((r) => setPlanos(r.planejamentos)).catch((e) => setErro(tratar(e))); }, [tratar]);

  if (novo) return <NovoPlano tratar={tratar} onCriado={onAbrir} onCancelar={() => setNovo(false)} />;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Planejamentos</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Cada conteúdo precisa de: título, formato, referência, como adaptar pra marca, onde postar, data e horário.</p>
        </div>
        <Botao variante="primario" onClick={() => setNovo(true)}>Enviar planejamento</Botao>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {planos === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : planos.length === 0 ? <p className="text-[14px]" style={{ color: "var(--ink3)" }}>Nenhum planejamento ainda. Clique em "Enviar planejamento".</p>
        : (
          <ul className="space-y-2">
            {planos.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onAbrir(p.id)} className="rel-card w-full text-left p-4 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold" style={{ color: "var(--ink)" }}>{p.titulo}</span>
                      <Etiqueta tom={STATUS[p.status]?.tom ?? "neutro"}>{STATUS[p.status]?.nome ?? p.status}</Etiqueta>
                    </div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>
                      {NOME_PERIODICIDADE[p.periodicidade]} · {dataCurta(p.periodo_inicio)} a {dataCurta(p.periodo_fim)}{p.rodada > 1 ? ` · ${p.rodada}ª rodada` : ""}
                    </div>
                  </div>
                  <span aria-hidden style={{ color: "var(--ink3)" }}>›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </>
  );
}

function hoje(): string { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }); }
function mesDe(d: string): { inicio: string; fim: string } {
  const [a, m] = d.split("-").map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { inicio: `${a}-${String(m).padStart(2, "0")}-01`, fim: `${a}-${String(m).padStart(2, "0")}-${String(fim).padStart(2, "0")}` };
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function NovoPlano({ tratar, onCriado, onCancelar }: { tratar: (e: unknown) => string | null; onCriado: (id: string) => void; onCancelar: () => void }) {
  const [periodicidade, setPeriodicidade] = useState<"semanal" | "mensal" | null>(null);
  const [dia, setDia] = useState(hoje());
  const [fonte, setFonte] = useState<"pdf" | "link">("pdf");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [titulo, setTitulo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);

  const periodo = periodicidade === "mensal" ? mesDe(dia) : semanaDe(dia);
  const tituloPadrao = periodicidade === "mensal"
    ? `Linha editorial — ${MESES[Number(dia.slice(5, 7)) - 1]}`
    : `Semana ${dataCurta(periodo.inicio)} a ${dataCurta(periodo.fim)}`;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!periodicidade) { setErro("Diga se o planejamento é SEMANAL ou MENSAL."); return; }
    const ep = periodoValido(periodicidade, periodo.inicio, periodo.fim);
    if (ep) { setErro(ep); return; }
    if (fonte === "pdf" && arquivo && arquivo.size > 3 * 1024 * 1024) { setErro("PDF grande demais (máx. 3 MB). Mande o link do Google Docs."); return; }
    setIndo(true); setErro(null);
    try {
      let pdf_base64: string | undefined;
      if (fonte === "pdf" && arquivo) {
        const buf = new Uint8Array(await arquivo.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        pdf_base64 = btoa(bin);
      }
      const r = await api.criar({
        periodicidade, titulo: titulo.trim() || tituloPadrao, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim,
        ...(pdf_base64 ? { pdf_base64, nome_arquivo: arquivo!.name } : {}),
        ...(fonte === "link" && link.trim() ? { link: link.trim() } : {}),
      });
      onCriado(r.id);
    } catch (err) { setErro(tratar(err)); setIndo(false); }
  }

  return (
    <form onSubmit={enviar} className="space-y-5" aria-labelledby="t-novo">
      <div>
        <button type="button" onClick={onCancelar} className="text-[13px] mb-2" style={{ color: "var(--ink3)" }}>‹ Planejamentos</button>
        <h1 id="t-novo" className="text-xl font-bold" style={{ color: "var(--ink)" }}>Enviar planejamento</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>A IA lê o documento e monta os conteúdos. Você confere e completa o que faltar antes de enviar.</p>
      </div>

      <fieldset className="rel-card p-4">
        <legend className="px-1 text-[13px] font-bold" style={{ color: "var(--ink)" }}>1. É semanal ou mensal? <span style={{ color: "var(--err-ink)" }}>*</span></legend>
        <div className="flex gap-2 mt-1">
          {(["semanal", "mensal"] as const).map((p) => (
            <label key={p} className="flex-1 inline-flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer text-[14px] font-semibold"
              style={{ border: `1px solid ${periodicidade === p ? "var(--rel)" : "var(--line)"}`, background: periodicidade === p ? "var(--rel-soft)" : "transparent", color: "var(--ink)" }}>
              <input type="radio" name="periodicidade" checked={periodicidade === p} onChange={() => setPeriodicidade(p)} required className="accent-[var(--rel)]" />
              {p === "semanal" ? "Semanal" : "Mensal"}
            </label>
          ))}
        </div>
        {periodicidade && (
          <label className="block mt-3 text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>
            {periodicidade === "semanal" ? "Qualquer dia da semana" : "Qualquer dia do mês"}
            <Entrada type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="mt-1" />
            <span className="block text-[12px] font-normal mt-1" style={{ color: "var(--ink3)" }}>
              Período: {dataCurta(periodo.inicio)} a {dataCurta(periodo.fim)}
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="rel-card p-4">
        <legend className="px-1 text-[13px] font-bold" style={{ color: "var(--ink)" }}>2. Documento</legend>
        <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Como mandar o documento">
          {(["pdf", "link"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={fonte === f} onClick={() => setFonte(f)}
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold"
              style={fonte === f ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
              {f === "pdf" ? "Subir PDF" : "Link do Google Docs"}
            </button>
          ))}
        </div>
        {fonte === "pdf" ? (
          <input type="file" accept="application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="block text-[13px]" aria-label="Arquivo PDF" />
        ) : (
          <>
            <Entrada type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/document/d/…" />
            <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>O documento precisa estar como "Qualquer pessoa com o link pode ver".</p>
          </>
        )}
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Sem documento? Pode criar vazio e preencher os conteúdos direto aqui.</p>
      </fieldset>

      <label className="block text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Nome (opcional)
        <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={periodicidade ? tituloPadrao : ""} maxLength={200} className="mt-1" />
      </label>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex justify-end gap-2">
        <Botao type="button" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante="primario" type="submit" disabled={indo}>{indo ? "A IA está lendo o documento…" : "Continuar"}</Botao>
      </div>
    </form>
  );
}

// ── Detalhe ─────────────────────────────────────────────────────────────────

function Detalhe({ id, perfis, tratar, onVoltar }: { id: string; perfis: PerfilAg[]; tratar: (e: unknown) => string | null; onVoltar: () => void }) {
  const [plano, setPlano] = useState<PlanoAg | null>(null);
  const [itens, setItens] = useState<ItemPlano[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [faltas, setFaltas] = useState<string[] | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [mexido, setMexido] = useState(false);
  const [indo, setIndo] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [resposta, setResposta] = useState<{ item: string | null; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await api.planejamento(id);
      setPlano(r.planejamento); setItens(r.planejamento.itens); setMexido(false); setErro(null);
    } catch (e) { setErro(tratar(e)); }
  }, [id, tratar]);
  useEffect(() => { void carregar(); }, [carregar]);

  const pendencias = useMemo(() => plano ? faltasDoPlanejamento(plano, itens, perfis.map((p) => p.id)) : [], [plano, itens, perfis]);

  if (!plano) return erro ? <Aviso tom="erro">{erro}</Aviso> : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  const editavel = plano.status === "rascunho" || plano.status === "devolvido";
  const ia = plano.ia_revisao;
  const avisosLeitura = (ia?.avisos ?? []).map((a) => (typeof a === "string" ? a : a.aviso));

  async function salvar(): Promise<boolean> {
    setIndo(true); setErro(null); setOk(null);
    try { await api.salvar(plano!.id, itens); await carregar(); setOk("Salvo."); return true; }
    catch (e) { setErro(tratar(e)); return false; }
    finally { setIndo(false); }
  }
  async function enviar() {
    setTentou(true); setFaltas(null);
    if (mexido && !(await salvar())) return;
    setIndo(true); setErro(null); setOk(null);
    try {
      const r = await api.enviar(plano!.id);
      if (!r.ok) { setFaltas(r.faltas ?? []); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
      setOk("Enviado! A equipe da STFV vai revisar. Se precisar de ajuste, ele volta aqui com as obs.");
      await carregar();
    } catch (e) { setErro(tratar(e)); }
    finally { setIndo(false); }
  }
  async function responder() {
    if (!resposta || resposta.texto.trim().length < 2) return;
    try { await api.responder(plano!.id, resposta.texto.trim(), resposta.item); setResposta(null); await carregar(); }
    catch (e) { setErro(tratar(e)); }
  }

  const vista = (o: PlanoAg["obs"][number]): ObsVista => ({
    id: o.id, autor: o.autor_agencia ? "Você (agência)" : o.autor, rotulo: o.autor_agencia ? undefined : "STFV",
    texto: o.texto, resolvida: o.resolvida, criado_em: o.criado_em, daAgencia: !!o.autor_agencia,
  });
  const caixaResposta = (item: string | null): ReactNode => resposta && resposta.item === item ? (
    <div className="w-full space-y-2">
      <textarea className="rel-input" rows={2} autoFocus aria-label="Resposta" value={resposta.texto} onChange={(e) => setResposta({ item, texto: e.target.value })} />
      <div className="flex gap-2"><Botao variante="primario" onClick={responder}>Responder</Botao><Botao variante="fantasma" onClick={() => setResposta(null)}>Cancelar</Botao></div>
    </div>
  ) : null;
  const obsGerais = plano.obs.filter((o) => !o.item_id);

  return (
    <div className="pb-24">
      <button type="button" onClick={onVoltar} className="text-[13px] mb-2" style={{ color: "var(--ink3)" }}>‹ Planejamentos</button>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>{plano.titulo}</h1>
        <Etiqueta tom={STATUS[plano.status]?.tom ?? "neutro"}>{STATUS[plano.status]?.nome ?? plano.status}</Etiqueta>
      </div>
      <p className="text-[13px] mt-1 mb-4" style={{ color: "var(--ink3)" }}>
        {NOME_PERIODICIDADE[plano.periodicidade]} · {dataCurta(plano.periodo_inicio)} a {dataCurta(plano.periodo_fim)}{plano.documento_nome ? ` · ${plano.documento_nome}` : ""}
      </p>

      {faltas && faltas.length > 0 && (
        <div className="mb-4">
          <Aviso tom="erro">
            <b>Ainda não dá pra enviar. Falta:</b>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">{faltas.map((f, k) => <li key={k}>{f}</li>)}</ul>
          </Aviso>
        </div>
      )}
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {ok && <div className="mb-3"><Aviso tom="ok">{ok}</Aviso></div>}
      {plano.status === "enviado" && <div className="mb-4"><Aviso>Em revisão pela STFV. Você é avisada aqui se voltar com ajustes.</Aviso></div>}
      {plano.status === "aprovado" && <div className="mb-4"><Aviso tom="ok">Aprovado! Agora mande o link do Canva de cada conteúdo na aba <b>Produção</b>.</Aviso></div>}
      {plano.status === "devolvido" && <div className="mb-4"><Aviso tom="erro">A STFV devolveu com obs (em amarelo). Ajuste e envie de novo.</Aviso></div>}

      {editavel && avisosLeitura.length > 0 && (
        <section className="rel-card p-4 mb-4" aria-label="O que a IA notou no documento">
          <h2 className="text-[13px] font-bold mb-1.5" style={{ color: "var(--ink)" }}>✦ O que a IA notou no documento</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]" style={{ color: "var(--ink2)" }}>{avisosLeitura.map((a, k) => <li key={k}>{a}</li>)}</ul>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Confira cada conteúdo abaixo: o que está em vermelho precisa ser preenchido.</p>
        </section>
      )}

      {obsGerais.length > 0 && (
        <section className="rel-card p-4 mb-4" aria-label="Obs gerais">
          <h2 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink)" }}>Obs gerais</h2>
          {obsGerais.map((o) => (
            <div key={o.id} className="rounded-lg px-3 py-2 text-[13px] mb-2" style={{ background: o.autor_agencia || o.resolvida ? "var(--card2)" : "var(--warn-bg)" }}>
              <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}><b>{vista(o).autor}</b> · {quando(o.criado_em)}</div>
              <p className="whitespace-pre-wrap">{o.texto}</p>
            </div>
          ))}
          {!resposta && <Botao variante="fantasma" onClick={() => setResposta({ item: null, texto: "" })}>Responder</Botao>}
          {caixaResposta(null)}
        </section>
      )}

      <ItensEditor
        itens={itens}
        onChange={editavel ? (n) => { setItens(n); setMexido(true); } : undefined}
        perfis={perfis}
        periodo={plano}
        mostrarFaltas={tentou || plano.status === "devolvido" || (editavel && !!ia)}
        obsDoItem={(i) => plano.obs.filter((o) => o.item_id && o.item_id === i.id).map(vista)}
        acoesDoItem={(i) => {
          const temObs = plano.obs.some((o) => o.item_id === i.id && !o.autor_agencia);
          return temObs && i.id ? (
            <>
              {!(resposta && resposta.item === i.id) && <Botao variante="fantasma" onClick={() => setResposta({ item: i.id!, texto: "" })}>Responder obs</Botao>}
              {caixaResposta(i.id)}
            </>
          ) : null;
        }}
      />

      {editavel && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 py-3 flex flex-wrap justify-end gap-2" style={{ background: "var(--card)", borderTop: "1px solid var(--line)" }}>
          {pendencias.length > 0 && <span className="self-center text-[13px] mr-auto" style={{ color: "var(--err-ink)" }}>{pendencias.length} conteúdo(s) incompleto(s)</span>}
          <Botao disabled={indo || !mexido} onClick={() => void salvar()}>{mexido ? "Salvar" : "Salvo"}</Botao>
          <Botao variante="primario" disabled={indo} onClick={enviar}>{indo ? "Enviando…" : "Enviar para a STFV"}</Botao>
        </div>
      )}
    </div>
  );
}

// ── Produção ────────────────────────────────────────────────────────────────

function Producao({ perfis, tratar }: { perfis: PerfilAg[]; tratar: (e: unknown) => string | null }) {
  const [cards, setCards] = useState<CardAg[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try { setCards((await api.producao()).cards); setErro(null); } catch (e) { setErro(tratar(e)); }
  }, [tratar]);
  useEffect(() => { void carregar(); }, [carregar]);

  const grupos = useMemo(() => {
    const c = cards ?? [];
    return {
      mandar: c.filter((x) => !["aprovacao", "aprovado", "publicado"].includes(x.coluna?.tipo ?? "")),
      revisao: c.filter((x) => x.coluna?.tipo === "aprovacao"),
      ok: c.filter((x) => ["aprovado", "publicado"].includes(x.coluna?.tipo ?? "")),
    };
  }, [cards]);
  const nomePerfis = (ids: string[]) => ids.map((id) => perfis.find((p) => p.id === id)?.nome).filter(Boolean).join(", ");

  return (
    <>
      <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Produção</h1>
      <p className="text-[13px] mb-4" style={{ color: "var(--ink3)" }}>Conteúdos aprovados nos planejamentos. Cole o link do Canva de cada um e mande pra aprovação.</p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {cards === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : (
        <div className="space-y-6">
          <Secao titulo={`Mandar a produção (${grupos.mandar.length})`}>
            {grupos.mandar.length === 0 ? <Nada>Nada pendente.</Nada> : grupos.mandar.map((c) => <CardProducao key={c.id} c={c} perfis={nomePerfis(c.perfil_ids)} tratar={tratar} onEnviado={carregar} />)}
          </Secao>
          <Secao titulo={`Em aprovação na STFV (${grupos.revisao.length})`}>
            {grupos.revisao.length === 0 ? <Nada>Nenhum.</Nada> : grupos.revisao.map((c) => <CardProducao key={c.id} c={c} perfis={nomePerfis(c.perfil_ids)} tratar={tratar} onEnviado={carregar} soLeitura />)}
          </Secao>
          <Secao titulo={`Aprovados (${grupos.ok.length})`}>
            {grupos.ok.length === 0 ? <Nada>Nenhum ainda.</Nada> : grupos.ok.map((c) => <CardProducao key={c.id} c={c} perfis={nomePerfis(c.perfil_ids)} tratar={tratar} onEnviado={carregar} soLeitura />)}
          </Secao>
        </div>
      )}
    </>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <section><h2 className="text-[13px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink3)" }}>{titulo}</h2><div className="space-y-2">{children}</div></section>;
}
function Nada({ children }: { children: ReactNode }) { return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{children}</p>; }

function CardProducao({ c, perfis, tratar, onEnviado, soLeitura }: { c: CardAg; perfis: string; tratar: (e: unknown) => string | null; onEnviado: () => void; soLeitura?: boolean }) {
  const [link, setLink] = useState(c.link_producao ?? "");
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const devolucao = c.coluna?.tipo === "ajustes" ? c.comentarios[0] : undefined;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setIndo(true); setErro(null);
    try { await api.producaoEnviar(c.id, link.trim(), comentario.trim() || undefined); onEnviado(); }
    catch (err) { setErro(tratar(err)); }
    finally { setIndo(false); }
  }
  return (
    <article className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold" style={{ color: "var(--ink)" }}>{c.titulo}</span>
        {c.rodada > 1 && <Etiqueta>{c.rodada}ª rodada</Etiqueta>}
      </div>
      <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>
        {dataCurta(c.data_publicacao)}{c.horario ? ` · ${c.horario.slice(0, 5)}` : ""}{perfis ? ` · ${perfis}` : ""}
      </p>
      {devolucao && (
        <div className="mt-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--warn-bg)" }}>
          <b>A STFV pediu ajuste:</b> <span className="whitespace-pre-wrap">{devolucao.texto}</span>
        </div>
      )}
      {soLeitura ? (
        c.link_producao && <a href={c.link_producao} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[13px] underline" style={{ color: "var(--rel-ink)" }}>Ver produção enviada</a>
      ) : (
        <form onSubmit={enviar} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <Entrada type="url" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link do Canva (https://…)" aria-label={`Link do Canva de ${c.titulo}`} />
          <Botao variante="primario" type="submit" disabled={indo || !link.trim()}>{indo ? "Enviando…" : "Mandar pra aprovação"}</Botao>
          <textarea className="rel-input sm:col-span-2" rows={2} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="Comentário (opcional)" aria-label="Comentário" />
          {erro && <div className="sm:col-span-2"><Aviso tom="erro">{erro}</Aviso></div>}
        </form>
      )}
    </article>
  );
}
