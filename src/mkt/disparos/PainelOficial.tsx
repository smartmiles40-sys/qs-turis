// src/mkt/disparos/PainelOficial.tsx
// -----------------------------------------------------------------------------
// DISPARO OFICIAL DO MARKETING (0341) — as peças da tela:
//   • EnvioOficial   → as travas (o que falta pra sair de verdade), o número na
//                      Meta (limite e qualidade), sincronizar modelos, ritmo e preço
//   • ExtrasDoModelo → mídia do topo, variável do título e final do link dos botões
//   • AoVivo         → os números da campanha atualizando sozinhos + pausar/retomar
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { ProgressBar } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { acaoCampanha, type Campanha } from "@/lib/qs/disparos";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import {
  aoVivo, estadoOficial, salvarPrecos, salvarRitmoOficial, sincronizarModelos, ROTULO_TIER,
  type AoVivo as DadosAoVivo, type EnvioExtra, type EstadoOficial, type FonteExtra, type ModeloMkt,
} from "./oficial";
import { DIAS_CURTOS } from "./regras";

const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const dinheiro = (v: number, moeda: string) => v.toLocaleString("pt-BR", { style: "currency", currency: moeda || "BRL" });

// ── Travas e número ─────────────────────────────────────────────────────────

export function EnvioOficial({ ehAdmin, onModelosMudaram }: { ehAdmin: boolean; onModelosMudaram: () => void }) {
  const [est, setEst] = useState<EstadoOficial | null>(null);
  const [ocupado, setOcupado] = useState<"" | "sync" | "meta">("");
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async (conferir = false) => {
    try { setEst(await estadoOficial(conferir)); } catch (e) { notifyError(erroDe(e, "Não carregou o estado do envio.")); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  if (!est) return null;
  const itens: { ok: boolean; texto: string }[] = [
    { ok: !!est.numero, texto: est.numero ? `Número do Marketing: ${est.numero.numero || est.numero.phone_number_id}` : "Cadastrar o número do Marketing" },
    { ok: est.temToken, texto: est.temToken ? "O QS tem o token do número" : "Conectar o número pelo painel de WhatsApp (o QS precisa do token)" },
    { ok: est.modelos.aprovados > 0, texto: est.modelos.aprovados ? `${est.modelos.aprovados} modelo(s) aprovado(s) na Meta` : "Ter modelo APROVADO na WABA do Marketing e sincronizar" },
    { ok: !est.simulacao, texto: est.simulacao ? "Modo simulação ligado (o Bruno desliga quando quiser)" : "Simulação desligada" },
    { ok: est.envLigado, texto: est.envLigado ? "Trava da Vercel ligada (MKT_DISPARO_ENVIO=1)" : "Trava da Vercel desligada (MKT_DISPARO_ENVIO)" },
  ];

  return (
    <section className="rel-card space-y-3 p-4" aria-label="Envio pela API oficial">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Envio pela API oficial da Meta</p>
        <Etiqueta tom={est.real ? "rel" : est.simulacao ? "aviso" : "erro"}>{est.real ? "envio real LIGADO" : est.simulacao ? "simulação" : "parado"}</Etiqueta>
      </div>
      {!est.real && !est.simulacao && <Aviso tom="erro">A simulação está desligada mas falta trava: a fila fica PARADA — {est.faltam.join("; ")}.</Aviso>}
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {itens.map((i) => (
          <li key={i.texto} className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
            <span aria-hidden className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
              style={i.ok ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{i.ok ? "✓" : "!"}</span>
            {i.texto}
          </li>
        ))}
      </ul>
      {est.saude && (
        <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
          Na Meta: limite <b>{ROTULO_TIER[est.saude.tier ?? ""] ?? est.saude.tier ?? "não informado"}</b> · qualidade <b>{qualidade(est.saude.qualidade)}</b>
          {est.saude.nome ? ` · ${est.saude.nome}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao disabled={!!ocupado || !est.numero} onClick={async () => {
          setOcupado("sync");
          try { const r = await sincronizarModelos(); notifySuccess(`${r.total} modelo(s) lidos da Meta, ${r.aprovados} aprovado(s).`); await carregar(); onModelosMudaram(); }
          catch (e) { notifyError(erroDe(e, "Não sincronizou.")); } finally { setOcupado(""); }
        }}>{ocupado === "sync" ? "Sincronizando…" : "Sincronizar modelos da Meta"}</Botao>
        <Botao variante="fantasma" disabled={!!ocupado || !est.temToken} onClick={async () => { setOcupado("meta"); await carregar(true); setOcupado(""); }}>
          {ocupado === "meta" ? "Conferindo…" : "Ver limite e qualidade"}
        </Botao>
        <Botao variante="fantasma" onClick={() => setAberto(!aberto)}>{aberto ? "Fechar ritmo e custo" : "Ritmo e custo"}</Botao>
      </div>
      {est.modelos.sincronizadoEm && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Modelos lidos da Meta em {dataHora(est.modelos.sincronizadoEm)}.</p>}
      {aberto && <RitmoECusto est={est} ehAdmin={ehAdmin} onSalvo={() => void carregar()} />}
    </section>
  );
}

const qualidade = (q: string | null) => ({ GREEN: "verde (alta)", YELLOW: "amarela (média)", RED: "vermelha (baixa)" } as Record<string, string>)[String(q || "").toUpperCase()] ?? (q || "não informada");

function RitmoECusto({ est, ehAdmin, onSalvo }: { est: EstadoOficial; ehAdmin: boolean; onSalvo: () => void }) {
  const [r, setR] = useState(est.ritmo);
  const [p, setP] = useState(est.precos);
  const numero = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
  return (
    <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Campo rotulo="Mensagens por segundo" dica="A Meta aguenta 80; comece baixo."><Entrada type="number" min={0.2} max={80} step={0.5} disabled={!ehAdmin} value={r.por_segundo} onChange={(e) => setR({ ...r, por_segundo: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Teto por dia"><Entrada type="number" min={1} disabled={!ehAdmin} value={r.por_dia} onChange={(e) => setR({ ...r, por_dia: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Usar do limite da Meta" dica="O limite é da empresa toda."><Entrada type="number" min={10} max={100} step={5} disabled={!ehAdmin} value={Math.round(r.margem_tier * 100)} onChange={(e) => setR({ ...r, margem_tier: Number(e.target.value) / 100 })} /></Campo>
        <Campo rotulo="Janela (Brasília)">
          <div className="flex gap-1">
            <Entrada type="time" disabled={!ehAdmin} value={r.inicio} onChange={(e) => setR({ ...r, inicio: e.target.value })} />
            <Entrada type="time" disabled={!ehAdmin} value={r.fim} onChange={(e) => setR({ ...r, fim: e.target.value })} />
          </div>
        </Campo>
      </div>
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Dias: {r.dias.map((d) => DIAS_CURTOS[d]).join(", ")}. Sem leitura da Meta, o QS assume o limite {ROTULO_TIER[r.tier_padrao] ?? r.tier_padrao}.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo={`Preço por mensagem de Marketing (${p.moeda})`} dica="Tabela da Meta pro Brasil."><Entrada inputMode="decimal" disabled={!ehAdmin} value={p.marketing ?? ""} onChange={(e) => setP({ ...p, marketing: numero(e.target.value) })} /></Campo>
        <Campo rotulo={`Preço por mensagem de Utilidade (${p.moeda})`}><Entrada inputMode="decimal" disabled={!ehAdmin} value={p.utility ?? ""} onChange={(e) => setP({ ...p, utility: numero(e.target.value) })} /></Campo>
      </div>
      {ehAdmin ? (
        <Botao variante="primario" onClick={async () => {
          try { await salvarRitmoOficial(r); await salvarPrecos(p); notifySuccess("Ritmo e preços salvos."); onSalvo(); }
          catch (e) { notifyError(erroDe(e, "Não salvou.")); }
        }}>Salvar ritmo e preços</Botao>
      ) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só admin muda o ritmo e os preços.</p>}
    </div>
  );
}

// ── Extras do modelo ────────────────────────────────────────────────────────

const FONTES_EXTRA: { id: FonteExtra; rotulo: string }[] = [
  { id: "texto", rotulo: "Texto fixo" }, { id: "nome", rotulo: "Primeiro nome" },
  { id: "destino", rotulo: "Destino" }, { id: "campo", rotulo: "Campo do contato" },
];

function FonteEValor({ v, set, placeholder }: { v?: { fonte: FonteExtra; valor?: string }; set: (x: { fonte: FonteExtra; valor?: string }) => void; placeholder: string }) {
  const fonte = v?.fonte ?? "texto";
  return (
    <div className="grid grid-cols-[150px_1fr] gap-2">
      <select className="rel-input" value={fonte} onChange={(e) => set({ fonte: e.target.value as FonteExtra, valor: v?.valor })}>
        {FONTES_EXTRA.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
      </select>
      {["texto", "campo", "destino"].includes(fonte)
        ? <Entrada value={v?.valor ?? ""} placeholder={fonte === "campo" ? "nome do campo (ex.: cidade)" : fonte === "destino" ? "Se não achar, usar…" : placeholder} onChange={(e) => set({ fonte, valor: e.target.value })} />
        : <span />}
    </div>
  );
}

/** O que o modelo da Meta pede além do texto: arquivo do topo, título variável, link do botão. */
export function ExtrasDoModelo({ modelo, extra, setExtra }: { modelo: ModeloMkt | null; extra: EnvioExtra; setExtra: (e: EnvioExtra) => void }) {
  if (!modelo || modelo.origem !== "meta") return null;
  const botoesUrl = (modelo.botoes ?? []).filter((b) => b.tipo === "URL" && b.variavel);
  if (!modelo.precisaMidia && !(modelo.variaveisTopo ?? []).length && !botoesUrl.length) return null;
  const tipo = modelo.cabecalhoFormato === "IMAGE" ? "imagem" : modelo.cabecalhoFormato === "VIDEO" ? "vídeo" : "documento";
  return (
    <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
      <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Este modelo também pede:</p>
      {modelo.precisaMidia && (
        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <Campo rotulo={`Link da ${tipo} do topo (https)`} dica="Um link público do arquivo (Drive público, site, CDN). A Meta baixa a cada envio.">
            <Entrada value={extra.midia?.link ?? ""} placeholder="https://…" onChange={(e) => setExtra({ ...extra, midia: { ...extra.midia, link: e.target.value.trim() } })} />
          </Campo>
          {modelo.cabecalhoFormato === "DOCUMENT" && (
            <Campo rotulo="Nome do arquivo"><Entrada value={extra.midia?.nome ?? ""} placeholder="roteiro.pdf" onChange={(e) => setExtra({ ...extra, midia: { ...extra.midia, nome: e.target.value } })} /></Campo>
          )}
        </div>
      )}
      {(modelo.variaveisTopo ?? []).length > 0 && (
        <Campo rotulo={`Título: ${modelo.cabecalho ?? ""}`}><FonteEValor v={extra.topo} set={(x) => setExtra({ ...extra, topo: x })} placeholder="Texto do título" /></Campo>
      )}
      {botoesUrl.map((b) => (
        <Campo key={b.indice} rotulo={`Botão "${b.texto}" — final do link`} dica="O começo do link já está no modelo aprovado.">
          <FonteEValor v={extra.botoes?.[String(b.indice)]} set={(x) => setExtra({ ...extra, botoes: { ...extra.botoes, [String(b.indice)]: x } })} placeholder="ex.: japao-2027" />
        </Campo>
      ))}
    </div>
  );
}

// ── Ao vivo ─────────────────────────────────────────────────────────────────

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export function AoVivoModal({ c, onFechar, onMudou }: { c: Campanha; onFechar: () => void; onMudou: () => void }) {
  const [d, setD] = useState<DadosAoVivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ler = useCallback(async () => {
    try { setD(await aoVivo(c.id)); setErro(null); } catch (e) { setErro(erroDe(e, "Não carregou.")); }
  }, [c.id]);
  useEffect(() => { void ler(); const t = setInterval(() => void ler(), 10_000); return () => clearInterval(t); }, [ler]);

  async function agir(acao: "pausar" | "retomar") {
    setOcupado(true);
    try { await acaoCampanha(acao, c.id); await ler(); onMudou(); } catch (e) { notifyError(erroDe(e, "Falhou.")); } finally { setOcupado(false); }
  }
  const k = d?.kpis;
  const feitos = k ? k.total - k.na_fila - k.cancelados : 0;
  return (
    <Modal aberto titulo={`Ao vivo · ${c.nome}`} onFechar={onFechar} largura={760}
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
            <Numero rotulo="Falharam" v={k.falharam} tom={k.falharam ? "erro" : undefined} />
            <Numero rotulo="Pulados" v={k.pulados} />
            <Numero rotulo="Custo estimado" texto={k.custo.completo ? dinheiro(k.custo.total, k.custo.moeda) : "defina o preço"}
              extra={Object.entries(k.cobraveis).map(([cat, n]) => `${n} ${cat}`).join(" · ") || "nada cobrado"} />
          </dl>
          {Object.keys(k.erros).length > 0 && (
            <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              Falhas por código da Meta: {Object.entries(k.erros).map(([cod, n]) => `${cod} (${n})`).join(", ")}
            </p>
          )}
          {!!d?.falhas.length && (
            <details>
              <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Quem falhou ou foi pulado (últimos {d.falhas.length})</summary>
              <ul className="mt-2 max-h-[220px] space-y-1 overflow-y-auto text-[12.5px]" style={{ color: "var(--ink)" }}>
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

function Numero({ rotulo, v, texto, extra, tom }: { rotulo: string; v?: number; texto?: string; extra?: string; tom?: "erro" }) {
  return (
    <div className="rounded-xl border p-2.5" style={{ borderColor: "var(--line)" }}>
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[20px] font-bold tabular-nums" style={{ color: tom === "erro" ? "var(--err-ink)" : "var(--ink)" }}>{texto ?? v ?? 0}</dd>
      {extra && <dd className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{extra}</dd>}
    </div>
  );
}
