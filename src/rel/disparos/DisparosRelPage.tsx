// src/rel/disparos/DisparosRelPage.tsx
// -----------------------------------------------------------------------------
// RELACIONAMENTO › DISPAROS — "igual ao ManyChat" (0408, 19/11/2026).
//
// Três abas:
//   • Disparos            → a lista (rascunho, agendado, enviando, concluído) com
//                           o funil de cada um e o "+ Novo disparo" em passos;
//   • Contatos e etiquetas→ as tags do ManyChat em cima da ficha do cliente;
//   • Número e ritmo      → o que falta pra sair de verdade, saúde do número na
//                           Meta, modelos aprovados e o ritmo (teto por dia).
//
// O envio é OFICIAL pela Cloud API, pelo número do Relacionamento, só com modelo
// aprovado (api/_relDisparoOficial.js). Sai pelo servidor (cron a cada 5 min):
// dá pra fechar a aba. Quem pediu pra parar sai sozinho.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  acaoCampanha, descreverPublico, lerConfig, listarCampanhas, type Campanha, type StatusCampanha,
} from "@/lib/qs/disparos";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { ROTULO_TIER } from "@/mkt/disparos/oficial";
import {
  aoVivoRel, avisoDoTeste, desagendarRel, estadoRel, salvarRitmoRel, sincronizarModelosRel, testarRel, testarRelNumerosTeste, agendarRel,
  type AoVivoRel, type EstadoRel, type ModeloRel, type NumeroTeste, type RitmoRel,
} from "./oficialRel";
import NumerosTeste from "./NumerosTeste";
import NovoDisparoRel from "./NovoDisparoRel";
import ContatosRel from "./ContatosRel";
import FluxosRel from "./FluxosRel";
import AcompanharRel from "./AcompanharRel";

const STATUS: Record<StatusCampanha, { rotulo: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" }, agendada: { rotulo: "agendado", tom: "rel" }, enviando: { rotulo: "enviando", tom: "rel" },
  pausada: { rotulo: "pausado", tom: "aviso" }, cancelada: { rotulo: "cancelado", tom: "erro" }, concluida: { rotulo: "concluído", tom: "neutro" },
};
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const localParaIso = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00-03:00`).toISOString() : "");

type Resumo = { total: number; enviados: number; entregues: number; lidos: number; responderam: number; pendentes: number };
async function resumos(ids: string[]): Promise<Record<string, Resumo>> {
  const out: Record<string, Resumo> = {};
  await Promise.all(ids.map(async (id) => {
    const { data } = await supabase.rpc("qs_disparo_resumo", { p_campanha: id });
    out[id] = (data ?? {}) as Resumo;
  }));
  return out;
}

// ── Ao vivo ─────────────────────────────────────────────────────────────────

function Numero({ rotulo, v, extra, tom }: { rotulo: string; v: number | string; extra?: string; tom?: "erro" }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--line)" }}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[20px] font-bold tabular-nums" style={{ color: tom === "erro" ? "var(--err-ink)" : "var(--ink)" }}>{v}</dd>
      {extra && <dd className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{extra}</dd>}
    </div>
  );
}

function AoVivo({ c, onFechar, onMudou }: { c: Campanha; onFechar: () => void; onMudou: () => void }) {
  const [d, setD] = useState<AoVivoRel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ler = useCallback(async () => {
    try { setD(await aoVivoRel(c.id)); setErro(null); } catch (e) { setErro(erroDe(e, "Não carregou.")); }
  }, [c.id]);
  useEffect(() => { void ler(); const t = setInterval(() => void ler(), 10_000); return () => clearInterval(t); }, [ler]);
  async function agir(acao: "pausar" | "retomar") {
    setOcupado(true);
    try { await acaoCampanha(acao, c.id); await ler(); onMudou(); } catch (e) { notifyError(erroDe(e, "Falhou.")); } finally { setOcupado(false); }
  }
  const k = d?.kpis;
  const feitos = k ? k.total - k.na_fila - k.cancelados : 0;
  return (
    <Modal aberto titulo={`Ao vivo · ${c.nome}`} onFechar={onFechar} largura={800}
      rodape={<>
        <span className="mr-auto text-[12px]" style={{ color: "var(--ink3)" }}>Atualiza sozinho a cada 10 s.</span>
        {d?.status === "enviando" && <Botao disabled={ocupado} onClick={() => void agir("pausar")}>Pausar</Botao>}
        {d?.status === "pausada" && <Botao variante="primario" disabled={ocupado} onClick={() => void agir("retomar")}>Retomar</Botao>}
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
      </>}>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!k ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : (
        <div className="space-y-4">
          {d?.ultimo_erro && <Aviso tom={d.status === "pausada" ? "erro" : "aviso"}>{d.ultimo_erro}</Aviso>}
          {k.simulados > 0 && <Aviso>{k.simulados} envio(s) em simulação: nada disso saiu de verdade.</Aviso>}
          <ProgressBar value={k.total ? (feitos / k.total) * 100 : 0} label="Progresso da fila" />
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero rotulo="Na fila" v={k.na_fila} />
            <Numero rotulo="Enviados" v={k.enviados} />
            <Numero rotulo="Entregues" v={k.entregues} extra={pct(k.entregues, k.enviados)} />
            <Numero rotulo="Lidos" v={k.lidos} extra={pct(k.lidos, k.entregues)} />
            <Numero rotulo="Responderam" v={k.responderam} extra={pct(k.responderam, k.entregues)} />
            <Numero rotulo="Clicaram" v={k.clicaram} extra={pct(k.clicaram, k.entregues)} />
            <Numero rotulo="Falharam" v={k.falharam} tom={k.falharam ? "erro" : undefined} />
            <Numero rotulo="Pulados" v={k.pulados} />
          </dl>
          {Object.keys(k.botoes).length > 0 && (
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>Cliques: {Object.entries(k.botoes).map(([b, n]) => `“${b}” ${n}`).join(" · ")}</p>
          )}
          {!!d?.interagiram.length && (
            <details open>
              <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Quem respondeu ou clicou ({d.interagiram.length})</summary>
              <ul className="mt-2 max-h-[220px] space-y-1 overflow-y-auto text-[12.5px]" style={{ color: "var(--ink)" }}>
                {d.interagiram.map((x, i) => (
                  <li key={i}><b>{x.nome || "—"}</b>{x.botao ? ` — tocou em “${x.botao}”` : ""}{x.respondeu_em ? ` — respondeu ${dataHora(x.respondeu_em)}` : ""}</li>
                ))}
              </ul>
              <p className="mt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>A conversa de cada um está no Atendimento (WhatsApp do Relacionamento).</p>
            </details>
          )}
          {!!d?.falhas.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Quem falhou ou foi pulado (últimos {d.falhas.length})</summary>
              <ul className="mt-2 max-h-[200px] space-y-1 overflow-y-auto text-[12.5px]" style={{ color: "var(--ink)" }}>
                {d.falhas.map((f, i) => <li key={i}><b>{f.nome || "—"}</b> <span style={{ color: "var(--ink3)" }}>{f.telefone}</span> — {f.motivo || f.status}</li>)}
              </ul>
            </details>
          )}
          {k.ultimo_envio && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Último envio: {dataHora(k.ultimo_envio)}.</p>}
        </div>
      )}
    </Modal>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────────

function CartaoCampanha({ c, r, numerosTeste, onAoVivo, onMudou }: { c: Campanha; r?: Resumo; numerosTeste: NumeroTeste[]; onAoVivo: () => void; onMudou: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [agendando, setAgendando] = useState(false);
  const [quando, setQuando] = useState("");
  const [testando, setTestando] = useState(false);
  const [tel, setTel] = useState(() => { try { return localStorage.getItem("rel_disparo_tel_teste") ?? ""; } catch { return ""; } });
  async function agir(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try { await fn(); if (ok) notifySuccess(ok); onMudou(); } catch (e) { notifyError(erroDe(e, "Falhou.")); } finally { setOcupado(false); }
  }
  const s = STATUS[c.status];
  const total = r?.total ?? c.total ?? 0;
  return (
    <li className="rel-card space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px]" style={{ color: "var(--ink)" }}>{c.nome}</b>
        <Etiqueta tom={s.tom}>{s.rotulo}</Etiqueta>
        {c.agendada_para && c.status === "agendada" && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{dataHora(c.agendada_para)}</span>}
        <span className="ml-auto text-[11.5px]" style={{ color: "var(--ink3)" }}>{c.modelo_nome} · criado {dataHora(c.criado_em)}</span>
      </div>
      <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>{descreverPublico("relacionamento", c.publico)}</p>
      {r && total > 0 && (
        <p className="text-[12.5px] tabular-nums" style={{ color: "var(--ink)" }}>
          {total} na lista · {r.enviados} enviados · {r.entregues} entregues ({pct(r.entregues, r.enviados)}) · {r.lidos} lidos · {r.responderam} responderam{r.pendentes ? ` · ${r.pendentes} na fila` : ""}
        </p>
      )}
      {c.ultimo_erro && ["pausada", "enviando"].includes(c.status) && <Aviso tom={c.status === "pausada" ? "erro" : "aviso"}>{c.ultimo_erro}</Aviso>}
      <div className="flex flex-wrap gap-2">
        {c.status === "rascunho" && <>
          <Botao variante="primario" disabled={ocupado} onClick={() => void agir(() => acaoCampanha("iniciar", c.id), "Na fila.")}>Disparar agora</Botao>
          <Botao disabled={ocupado} onClick={() => setAgendando(!agendando)}>Agendar</Botao>
          <Botao variante="fantasma" disabled={ocupado} onClick={() => { if (window.confirm("Apagar este rascunho?")) void agir(() => acaoCampanha("apagar", c.id)); }}>Apagar</Botao>
        </>}
        {c.status === "agendada" && <Botao disabled={ocupado} onClick={() => void agir(() => desagendarRel(c.id), "Voltou pra rascunho.")}>Desagendar</Botao>}
        {c.status !== "rascunho" && c.status !== "agendada" && <Botao onClick={onAoVivo}>Ao vivo</Botao>}
        {c.status === "enviando" && <Botao disabled={ocupado} onClick={() => void agir(() => acaoCampanha("pausar", c.id))}>Pausar</Botao>}
        {c.status === "pausada" && <Botao variante="primario" disabled={ocupado} onClick={() => void agir(() => acaoCampanha("retomar", c.id))}>Retomar</Botao>}
        {["enviando", "pausada", "agendada"].includes(c.status) && (
          <Botao variante="perigo" disabled={ocupado} onClick={() => { if (window.confirm("Cancelar? Quem ainda não recebeu não recebe mais.")) void agir(() => acaoCampanha("cancelar", c.id)); }}>Cancelar</Botao>
        )}
        <Botao variante="fantasma" onClick={() => setTestando(!testando)}>Mandar teste</Botao>
      </div>
      {agendando && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Dia e hora (Brasília)"><Entrada type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} /></Campo>
          <Botao variante="primario" disabled={ocupado || !localParaIso(quando)} onClick={() => void agir(() => agendarRel(c.id, localParaIso(quando)), "Agendado.").then(() => setAgendando(false))}>Confirmar</Botao>
        </div>
      )}
      {testando && numerosTeste.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="primario" disabled={ocupado} onClick={() => {
            setOcupado(true);
            void testarRelNumerosTeste({ campanhaId: c.id })
              .then((x) => (x.erros.length ? notifyError : notifySuccess)(avisoDoTeste(x)))
              .catch((e) => notifyError(erroDe(e, "O teste não saiu.")))
              .finally(() => setOcupado(false));
          }}>Mandar pros números de teste ({numerosTeste.length})</Botao>
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{numerosTeste.map((n) => n.nome).join(", ")} · ou um número avulso:</span>
        </div>
      )}
      {testando && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Mandar só pra este número, agora"><Entrada value={tel} placeholder="DDD + número" onChange={(e) => setTel(e.target.value)} /></Campo>
          <Botao disabled={ocupado || tel.replace(/\D/g, "").length < 10} onClick={() => {
            try { localStorage.setItem("rel_disparo_tel_teste", tel); } catch { /* sem storage */ }
            void agir(() => testarRel(tel, { campanhaId: c.id }), "Teste enviado.");
          }}>Enviar</Botao>
        </div>
      )}
    </li>
  );
}

function AbaDisparos({ est, modelos, onIrNumero, onModelosMudaram }: { est: EstadoRel | null; modelos: ModeloRel[]; onIrNumero: () => void; onModelosMudaram: () => void }) {
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [res, setRes] = useState<Record<string, Resumo>>({});
  const [novo, setNovo] = useState(false);
  const [aoVivo, setAoVivo] = useState<Campanha | null>(null);
  const [filtro, setFiltro] = useState<"ativos" | "todos">("ativos");
  const ler = useCallback(async () => {
    try {
      const l = await listarCampanhas("relacionamento");
      setLista(l);
      setRes(await resumos(l.filter((c) => c.status !== "rascunho").slice(0, 30).map((c) => c.id)));
    } catch (e) { notifyError(erroDe(e, "Não carregou os disparos.")); setLista([]); }
  }, []);
  useEffect(() => { void ler(); const t = setInterval(() => void ler(), 30_000); return () => clearInterval(t); }, [ler]);
  const visiveis = (lista ?? []).filter((c) => filtro === "todos" || !["cancelada", "concluida"].includes(c.status) || Date.now() - new Date(c.concluida_em ?? c.criado_em).getTime() < 7 * 86_400_000);
  const aprovados = modelos.filter((m) => m.status === "aprovado").length;

  return (
    <div className="space-y-4">
      {est && !est.real && (
        <Aviso tom={est.simulacao ? "aviso" : "erro"}>
          <b>{est.simulacao ? "Modo simulação" : "Envio travado"}:</b> {est.simulacao ? "dá pra montar, agendar e ver o funil, mas nada sai de verdade." : "a fila está parada."}{" "}
          Falta: {est.faltam.join("; ")}. <button type="button" className="underline" onClick={onIrNumero}>Ver detalhes</button>
        </Aviso>
      )}
      {!aprovados && <Aviso>Nenhum modelo aprovado sincronizado. <button type="button" className="underline" onClick={onIrNumero}>Sincronizar modelos</button></Aviso>}
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo disparo</Botao>
        <select className="rel-input ml-auto w-auto" value={filtro} onChange={(e) => setFiltro(e.target.value as "ativos" | "todos")}>
          <option value="ativos">Ativos e da última semana</option><option value="todos">Todos</option>
        </select>
      </div>
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : !visiveis.length ? <Vazio titulo="Nenhum disparo ainda" texto="Monte o primeiro: escolha quem recebe (por etiqueta, viagem, aniversário…), o modelo aprovado e o que cada botão faz." acao={<Botao variante="primario" onClick={() => setNovo(true)}>+ Novo disparo</Botao>} />
        : <ul className="space-y-3">{visiveis.map((c) => <CartaoCampanha key={c.id} c={c} r={res[c.id]} numerosTeste={est?.numerosTeste ?? []} onAoVivo={() => setAoVivo(c)} onMudou={() => void ler()} />)}</ul>}
      {novo && <NovoDisparoRel modelos={modelos} numeros={est?.numeros ?? []} onModelosMudaram={onModelosMudaram} simulacao={est?.simulacao !== false} numerosTeste={est?.numerosTeste ?? []} onFechar={() => setNovo(false)} onCriado={() => { setNovo(false); void ler(); }} />}
      {aoVivo && <AoVivo c={aoVivo} onFechar={() => setAoVivo(null)} onMudou={() => void ler()} />}
    </div>
  );
}

// ── Número e ritmo ──────────────────────────────────────────────────────────

function AbaNumero({ est, ehAdmin, podeTeste, onMudou }: { est: EstadoRel | null; ehAdmin: boolean; podeTeste: boolean; onMudou: () => void }) {
  const [saude, setSaude] = useState<EstadoRel["saude"]>(null);
  const [ocupado, setOcupado] = useState<"" | "sync" | "meta" | "ritmo">("");
  const [ritmo, setRitmo] = useState<RitmoRel | null>(null);
  const [modelos, setModelos] = useState<{ nome: string; idioma: string; status: string | null; categoria: string | null; motivo: string | null }[]>([]);
  useEffect(() => { if (est) setRitmo(est.ritmo); }, [est]);
  const lerModelos = useCallback(() => void supabase.from("rel_wa_modelos").select("nome, idioma, status, categoria, motivo").order("nome").then(({ data }) => setModelos((data ?? []) as typeof modelos)), []);
  useEffect(lerModelos, [lerModelos]);

  async function sync() {
    setOcupado("sync");
    try { const r = await sincronizarModelosRel(); notifySuccess(`${r.total} modelo(s), ${r.aprovados} aprovado(s).`); lerModelos(); onMudou(); } catch (e) { notifyError(erroDe(e, "Não sincronizou.")); } finally { setOcupado(""); }
  }
  async function conferir() {
    setOcupado("meta");
    try { setSaude((await estadoRel(true)).saude); } catch (e) { notifyError(erroDe(e, "Não conferiu.")); } finally { setOcupado(""); }
  }
  async function salvar() {
    if (!ritmo) return;
    setOcupado("ritmo");
    try { await salvarRitmoRel(ritmo); notifySuccess("Ritmo salvo."); onMudou(); } catch (e) { notifyError(erroDe(e, "Não salvou.")); } finally { setOcupado(""); }
  }
  if (!est) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  const r = ritmo ?? est.ritmo;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rel-card space-y-3 p-4">
        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Número do Relacionamento</p>
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{est.numero?.numero ?? "sem número"} {est.numero?.conectado ? "· conectado" : "· NÃO conectado"}</p>
        <div className="flex flex-wrap gap-2">
          <Botao disabled={!!ocupado} onClick={() => void conferir()}>{ocupado === "meta" ? "Conferindo…" : "Conferir na Meta"}</Botao>
          <Botao disabled={!!ocupado} onClick={() => void sync()}>{ocupado === "sync" ? "Sincronizando…" : "Sincronizar modelos"}</Botao>
        </div>
        {saude && (
          <p className="text-[13px]" style={{ color: "var(--ink)" }}>
            Limite: <b>{ROTULO_TIER[saude.tier ?? ""] ?? saude.tier ?? "?"}</b> · Qualidade: <b style={{ color: saude.qualidade === "RED" ? "var(--err-ink)" : saude.qualidade === "YELLOW" ? "var(--warn-ink)" : "var(--ink)" }}>{saude.qualidade === "GREEN" ? "boa" : saude.qualidade === "YELLOW" ? "média" : saude.qualidade === "RED" ? "baixa (nada sai)" : saude.qualidade ?? "?"}</b>
          </p>
        )}
        <div>
          <p className="mb-1 text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Pra sair de verdade</p>
          {est.real ? <Aviso tom="ok">Tudo ligado: os disparos saem de verdade.</Aviso> : (
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]" style={{ color: "var(--ink)" }}>{est.faltam.map((f) => <li key={f}>{f}</li>)}</ul>
          )}
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>A simulação desliga por decisão da diretoria (no banco: qs_settings.rel_disparo_simulacao = false) e a env REL_DISPARO_ENVIO=1 na Vercel. O “Mandar teste” só precisa da env.</p>
        </div>
        <div>
          <p className="mb-1 text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Modelos na Meta ({modelos.length})</p>
          {!modelos.length ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum sincronizado. Crie no WhatsApp Manager e clique em Sincronizar.</p> : (
            <ul className="max-h-[220px] space-y-1 overflow-y-auto text-[12.5px]">
              {modelos.map((m) => (
                <li key={`${m.nome}:${m.idioma}`} className="flex gap-2">
                  <span style={{ color: "var(--ink)" }}>{m.nome}</span>
                  <Etiqueta tom={m.status === "APPROVED" ? "rel" : m.status === "PENDING" ? "aviso" : "erro"}>{m.status === "APPROVED" ? "aprovado" : m.status === "PENDING" ? "em análise" : (m.status ?? "?").toLowerCase()}</Etiqueta>
                  {m.motivo && <span style={{ color: "var(--ink3)" }}>{m.motivo}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="rel-card space-y-3 p-4">
        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Ritmo</p>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>O número é o mesmo do atendimento: disparo demais derruba a qualidade e trava o atendimento também. O QS usa só uma parte do limite da Meta e para sozinho se a qualidade ficar vermelha.</p>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Máximo por dia"><Entrada type="number" disabled={!ehAdmin} value={r.por_dia} onChange={(e) => setRitmo({ ...r, por_dia: Number(e.target.value) })} /></Campo>
          <Campo rotulo="Mensagens por segundo"><Entrada type="number" step="0.5" disabled={!ehAdmin} value={r.por_segundo} onChange={(e) => setRitmo({ ...r, por_segundo: Number(e.target.value) })} /></Campo>
          <Campo rotulo="Começa às"><Entrada type="time" disabled={!ehAdmin} value={r.inicio} onChange={(e) => setRitmo({ ...r, inicio: e.target.value })} /></Campo>
          <Campo rotulo="Para às"><Entrada type="time" disabled={!ehAdmin} value={r.fim} onChange={(e) => setRitmo({ ...r, fim: e.target.value })} /></Campo>
          <Campo rotulo="Uso do limite da Meta" dica="0,6 = até 60% do limite de 24 h"><Entrada type="number" step="0.1" min="0.1" max="1" disabled={!ehAdmin} value={r.margem_tier} onChange={(e) => setRitmo({ ...r, margem_tier: Number(e.target.value) })} /></Campo>
          <Campo rotulo="Não repetir disparo pra mesma pessoa em (dias)"><Entrada type="number" disabled={!ehAdmin} value={r.intervalo_dias} onChange={(e) => setRitmo({ ...r, intervalo_dias: Number(e.target.value) })} /></Campo>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DIAS.map((d, i) => {
            const on = r.dias.includes(i);
            return <button key={d} type="button" disabled={!ehAdmin} onClick={() => setRitmo({ ...r, dias: on ? r.dias.filter((x) => x !== i) : [...r.dias, i].sort() })}
              className="rounded-full border px-2.5 py-1 text-[12.5px]" style={on ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" } : { borderColor: "var(--line)", color: "var(--ink3)" }}>{d}</button>;
          })}
        </div>
        {ehAdmin ? <Botao variante="primario" disabled={!!ocupado} onClick={() => void salvar()}>{ocupado === "ritmo" ? "Salvando…" : "Salvar ritmo"}</Botao>
          : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só admin muda o ritmo.</p>}
      </div>
      <NumerosTeste atuais={est.numerosTeste ?? []} podeEditar={podeTeste} onMudou={onMudou} />
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

type Aba = "acompanhar" | "fluxos" | "disparos" | "contatos" | "numero";

export default function DisparosRelPage() {
  const { currentUser } = useQsAuth();
  const ehAdmin = currentUser?.role === "admin";
  const ehGestor = ehAdmin || currentUser?.role === "gestor";
  const [aba, setAba] = useState<Aba>(() => { try { return (localStorage.getItem("rel_disparos_aba") as Aba) || "fluxos"; } catch { return "fluxos"; } });
  const [est, setEst] = useState<EstadoRel | null>(null);
  const [modelos, setModelos] = useState<ModeloRel[]>([]);
  const ler = useCallback(async () => {
    try {
      const cfg = await lerConfig("relacionamento") as Awaited<ReturnType<typeof lerConfig>> & { relOficial?: EstadoRel };
      setModelos(cfg.modelos as ModeloRel[]);
      setEst(cfg.relOficial ?? await estadoRel());
    } catch (e) { notifyError(erroDe(e, "Não carregou a configuração do disparo.")); }
  }, []);
  useEffect(() => { void ler(); }, [ler]);
  const ir = (a: Aba) => { setAba(a); try { localStorage.setItem("rel_disparos_aba", a); } catch { /* sem storage */ } };
  const ABAS: { id: Aba; rotulo: string }[] = [{ id: "acompanhar", rotulo: "Acompanhar" }, { id: "fluxos", rotulo: "Fluxos" }, { id: "disparos", rotulo: "Disparo simples" }, { id: "contatos", rotulo: "Contatos e etiquetas" }, { id: "numero", rotulo: "Número e ritmo" }];

  return (
    <div className={`mx-auto space-y-4 p-4 ${aba === "fluxos" ? "max-w-none" : "max-w-[1100px]"}`}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Disparos</h1>
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Mensagem em massa pelo WhatsApp do Relacionamento ou de um SDR, só com modelo aprovado pela Meta.</p>
        </div>
        {est && <Etiqueta tom={est.real ? "rel" : "aviso"}>{est.real ? "envio real ligado" : est.simulacao ? "simulação" : "travado"}</Etiqueta>}
      </header>
      <nav role="tablist" className="flex gap-1 border-b" style={{ borderColor: "var(--line)" }}>
        {ABAS.map((a) => (
          <button key={a.id} role="tab" aria-selected={aba === a.id} type="button" onClick={() => ir(a.id)}
            className="-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold"
            style={aba === a.id ? { borderColor: "var(--rel)", color: "var(--rel-ink)" } : { borderColor: "transparent", color: "var(--ink3)" }}>{a.rotulo}</button>
        ))}
      </nav>
      {aba === "acompanhar" && <AcompanharRel est={est} />}
      {aba === "fluxos" && <FluxosRel est={est} />}
      {aba === "disparos" && <AbaDisparos est={est} modelos={modelos} onIrNumero={() => ir("numero")} onModelosMudaram={() => void ler()} />}
      {aba === "contatos" && <ContatosRel ehGestor={ehGestor} />}
      {aba === "numero" && <AbaNumero est={est} ehAdmin={ehAdmin} podeTeste={ehAdmin || currentUser?.role === "gestor"} onMudou={() => void ler()} />}
    </div>
  );
}
