// src/components/sdr/disparos/DisparosPage.tsx
// -----------------------------------------------------------------------------
// DISPARO EM MASSA (0217) — a mesma tela no Comercial e no Relacionamento.
//
//   Comercial: público de LEADS com filtros; cada lead sai pelo número do SDR
//   DONO; o disparo é o passo 1 da cadência escolhida.
//   Relacionamento (remarketing): público de CLIENTES (viagem passada, volta,
//   sem viagem futura, nível do clube); pode levar o link do grupo.
//
// A fila anda SOZINHA (cron de 5 em 5 min, com teto por número e janela de
// horário) — fechar a aba não para nada. Pausar/retomar/cancelar aqui.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, EmptyState, KpiCard, Page, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/qs/queries";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  acaoCampanha, contagens, criarCampanha, descreverPublico, FONTES, lerConfig, listarCampanhas, NIVEIS, painel,
  preverTexto, previa as pedirPrevia, salvarRitmo, STATUS_LEAD, variaveisDoCorpo,
  type Campanha, type ConfigDisparo, type MapaVariaveis, type Painel, type Previa, type Publico, type Ritmo,
  type SetorDisparo, type StatusCampanha, type StatusEnvio,
} from "@/lib/qs/disparos";
import ModelosDisparo from "./ModelosDisparo";
import { Bolha, Campo, Chips, INPUT, INPUT_ESTILO, Modal } from "./pecas";

const STATUS: Record<StatusCampanha, { rotulo: string; tom?: "ok" | "warn" | "danger" | "info" }> = {
  rascunho: { rotulo: "rascunho" },
  enviando: { rotulo: "enviando", tom: "info" },
  pausada: { rotulo: "pausada", tom: "warn" },
  cancelada: { rotulo: "cancelada", tom: "danger" },
  concluida: { rotulo: "concluída", tom: "ok" },
};
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ── Opções dos filtros do Comercial ─────────────────────────────────────────

interface Opcoes { segmentos: string[]; sdrs: { id: string; rotulo: string }[]; cadencias: { id: string; rotulo: string; ativa: boolean }[] }

function useOpcoes(setor: SetorDisparo): Opcoes {
  const [o, setO] = useState<Opcoes>({ segmentos: [], sdrs: [], cadencias: [] });
  useEffect(() => {
    if (setor !== "comercial") return;
    let vivo = true;
    (async () => {
      const [segs, users, cads] = await Promise.all([
        fetchAllRows<{ segment: string | null }>((de, ate) => supabase.from("qs_leads").select("segment").order("id").range(de, ate)).catch(() => []),
        supabase.from("qs_users").select("id, name").eq("is_active", true).in("role", ["sdr", "gestor", "admin"]).order("name"),
        supabase.from("qs_cadences").select("id, name, status").order("name"),
      ]);
      const cont = new Map<string, number>();
      for (const s of segs) if (s.segment) cont.set(s.segment, (cont.get(s.segment) ?? 0) + 1);
      if (!vivo) return;
      setO({
        segmentos: [...cont].sort((a, b) => b[1] - a[1]).map(([s]) => s),
        sdrs: ((users.data ?? []) as { id: string; name: string }[]).map((u) => ({ id: u.id, rotulo: u.name })),
        cadencias: ((cads.data ?? []) as { id: string; name: string; status: string | null }[])
          .map((c) => ({ id: c.id, rotulo: c.status === "disponivel" ? c.name : `${c.name} (${c.status})`, ativa: c.status === "disponivel" })),
      });
    })();
    return () => { vivo = false; };
  }, [setor]);
  return o;
}

// ── Filtros do público ──────────────────────────────────────────────────────

function FiltrosComercial({ p, set, op }: { p: Publico; set: (p: Publico) => void; op: Opcoes }) {
  const [buscaSeg, setBuscaSeg] = useState("");
  const segs = op.segmentos.filter((s) => !buscaSeg || s.toLowerCase().includes(buscaSeg.toLowerCase())).slice(0, 40);
  return (
    <div className="space-y-3">
      <Campo rotulo="Fonte do lead" dica={p.segmentos?.length ? `${p.segmentos.length} escolhida(s)` : "Nenhuma = todas"}>
        <input className={INPUT} style={INPUT_ESTILO} placeholder="Buscar fonte (ex.: Japão)" value={buscaSeg} onChange={(e) => setBuscaSeg(e.target.value)} />
        <div className="mt-2 max-h-[120px] overflow-y-auto">
          <Chips opcoes={[...new Set([...(p.segmentos ?? []), ...segs])].map((s) => ({ id: s, rotulo: s }))} valor={p.segmentos ?? []} onChange={(v) => set({ ...p, segmentos: v })} />
        </div>
      </Campo>
      <Campo rotulo="SDR dono"><Chips opcoes={op.sdrs} valor={p.sdrs ?? []} onChange={(v) => set({ ...p, sdrs: v })} /></Campo>
      <Campo rotulo="Etapa" dica="Ganho fica de fora: cliente é do Relacionamento."><Chips opcoes={STATUS_LEAD.map((s) => ({ id: s.id, rotulo: s.rotulo }))} valor={p.status ?? []} onChange={(v) => set({ ...p, status: v })} /></Campo>
      <Campo rotulo="Está hoje na cadência"><Chips opcoes={op.cadencias.map((c) => ({ id: c.id, rotulo: c.rotulo }))} valor={p.cadencias ?? []} onChange={(v) => set({ ...p, cadencias: v })} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Entrou a partir de"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.entrada_de ?? ""} onChange={(e) => set({ ...p, entrada_de: e.target.value })} /></Campo>
        <Campo rotulo="Entrou até"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.entrada_ate ?? ""} onChange={(e) => set({ ...p, entrada_ate: e.target.value })} /></Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Tags das atividades" dica="Separe por vírgula. Ex.: sem-resposta">
          <input className={INPUT} style={INPUT_ESTILO} value={(p.tags ?? []).join(", ")}
                 onChange={(e) => set({ ...p, tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
        </Campo>
        <Campo rotulo="Já respondeu no WhatsApp?">
          <select className={INPUT} style={INPUT_ESTILO} value={p.respondeu ?? ""} onChange={(e) => set({ ...p, respondeu: e.target.value as Publico["respondeu"] })}>
            <option value="">Tanto faz</option><option value="sim">Já respondeu alguma vez</option><option value="nao">Nunca respondeu</option>
          </select>
        </Campo>
      </div>
    </div>
  );
}

function FiltrosRel({ p, set }: { p: Publico; set: (p: Publico) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Expedição que fez (contém)"><input className={INPUT} style={INPUT_ESTILO} placeholder="Ex.: Japão" value={p.expedicao ?? ""} onChange={(e) => set({ ...p, expedicao: e.target.value })} /></Campo>
        <Campo rotulo="Destino (contém)"><input className={INPUT} style={INPUT_ESTILO} placeholder="Ex.: Islândia" value={p.destino ?? ""} onChange={(e) => set({ ...p, destino: e.target.value })} /></Campo>
        <Campo rotulo="Voltou a partir de"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.retorno_de ?? ""} onChange={(e) => set({ ...p, retorno_de: e.target.value })} /></Campo>
        <Campo rotulo="Voltou até"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.retorno_ate ?? ""} onChange={(e) => set({ ...p, retorno_ate: e.target.value })} /></Campo>
      </div>
      <Campo rotulo="Nível do clube"><Chips opcoes={NIVEIS.map((n) => ({ id: n, rotulo: n }))} valor={p.niveis ?? []} onChange={(v) => set({ ...p, niveis: v })} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Já viajou com a gente?">
          <select className={INPUT} style={INPUT_ESTILO} value={p.viajou ?? ""} onChange={(e) => set({ ...p, viajou: e.target.value as Publico["viajou"] })}>
            <option value="">Tanto faz</option><option value="sim">Sim</option><option value="nao">Nunca</option>
          </select>
        </Campo>
        <label className="flex items-end gap-2 pb-2 text-[13.5px]" style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={!!p.sem_viagem_futura} onChange={(e) => set({ ...p, sem_viagem_futura: e.target.checked })} />
          Só quem não tem viagem marcada
        </label>
      </div>
    </div>
  );
}

function CaixaPrevia({ pv, carregando, setor }: { pv: Previa | null; carregando: boolean; setor: SetorDisparo }) {
  if (carregando) return <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Contando…</p>;
  if (!pv) return null;
  return (
    <div className="qs-card p-3 space-y-2">
      <p className="text-[14px]" style={{ color: "var(--text)" }}><b className="text-[20px] qs-num">{pv.total}</b> {setor === "comercial" ? "leads" : "clientes"} recebem.</p>
      {pv.porSdr.length > 0 && (
        <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>Por número: {pv.porSdr.map((s) => `${s.nome.split(" ")[0]} ${s.n}`).join(" · ")}</p>
      )}
      {pv.excluidos.length > 0 && (
        <ul className="text-[12.5px] space-y-0.5" style={{ color: "var(--muted)" }}>
          {pv.excluidos.map((x) => <li key={x.motivo}>Fora: <b className="qs-num">{x.n}</b> — {x.motivo}</li>)}
        </ul>
      )}
      {pv.amostra.length > 0 && (
        <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
          Ex.: {pv.amostra.map((a) => `${a.nome.split(" ")[0]} (${a.telefone}${a.sdr ? ` · ${a.sdr.split(" ")[0]}` : ""})`).join(", ")}
        </p>
      )}
      {!pv.numeroOk && <Alert tone="danger">O número do Relacionamento não está conectado na Meta.</Alert>}
    </div>
  );
}

// ── Nova campanha ───────────────────────────────────────────────────────────

function NovaCampanha({ setor, cfg, onFechar, onCriada }: { setor: SetorDisparo; cfg: ConfigDisparo; onFechar: () => void; onCriada: () => void }) {
  const op = useOpcoes(setor);
  const aprovados = cfg.modelos.filter((m) => m.status === "aprovado" && (!m.setor || m.setor === setor));
  const [passo, setPasso] = useState(1);
  const [nome, setNome] = useState("");
  const [modeloNome, setModeloNome] = useState("");
  const [mapa, setMapa] = useState<MapaVariaveis>({});
  const [publico, setPublico] = useState<Publico>(setor === "comercial" ? { status: ["perdido"] } : { viajou: "sim", sem_viagem_futura: true });
  const [cadencia, setCadencia] = useState("");
  const [grupoLink, setGrupoLink] = useState("");
  const [pv, setPv] = useState<Previa | null>(null);
  const [contando, setContando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;
  const vars = modelo ? variaveisDoCorpo(modelo.corpo) : [];
  const fontes = FONTES.filter((f) => f.setores.includes(setor));
  const usaGrupo = Object.values(mapa).some((m) => m.fonte === "link_grupo");

  useEffect(() => {
    if (passo !== 2) return;
    setContando(true);
    const t = setTimeout(() => {
      pedirPrevia(setor, publico).then(setPv).catch((e) => notifyError(e instanceof Error ? e.message : "Falhou.")).finally(() => setContando(false));
    }, 450);
    return () => clearTimeout(t);
  }, [publico, passo, setor]);

  const ok1 = nome.trim().length >= 2 && !!modelo && vars.every((v) => mapa[v] && (mapa[v].fonte !== "texto" || (mapa[v].valor ?? "").trim()));
  const ok3 = (setor !== "comercial" || !!cadencia) && (!usaGrupo || /^https:\/\/chat\.whatsapp\.com\//.test(grupoLink));

  async function criar() {
    if (!modelo) return;
    setSalvando(true);
    try {
      await criarCampanha(setor, { nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico, cadence_id: cadencia || null, grupo_link: grupoLink || null });
      notifySuccess("Campanha criada como rascunho.");
      onCriada();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não criou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={`Nova campanha · passo ${passo} de 3`} onFechar={onFechar} largura={760}
      rodape={<>
        {passo > 1 && <Button variant="ghost" onClick={() => setPasso(passo - 1)}>Voltar</Button>}
        {passo === 1 && <Button variant="primary" disabled={!ok1} onClick={() => setPasso(2)}>Escolher público</Button>}
        {passo === 2 && <Button variant="primary" disabled={!pv?.total} onClick={() => setPasso(3)}>{setor === "comercial" ? "Escolher cadência" : "Revisar"}</Button>}
        {passo === 3 && <Button variant="primary" disabled={!ok3 || salvando} onClick={() => void criar()}>{salvando ? "Criando…" : "Criar campanha"}</Button>}
      </>}>
      {passo === 1 && (
        <>
          <Campo rotulo="Nome da campanha (só o time vê)">
            <input className={INPUT} style={INPUT_ESTILO} value={nome} autoFocus onChange={(e) => setNome(e.target.value)}
                   placeholder={setor === "comercial" ? "Ex.: Resgate perdidos Japão — outubro" : "Ex.: Recompra quem voltou da Islândia"} />
          </Campo>
          {aprovados.length === 0 ? (
            <Alert tone="warn">Nenhum modelo aprovado ainda. Monte na aba Modelos, aprove na Meta e marque como aprovado.</Alert>
          ) : (
            <Campo rotulo="Modelo aprovado">
              <select className={INPUT} style={INPUT_ESTILO} value={modeloNome} onChange={(e) => { setModeloNome(e.target.value); setMapa({}); }}>
                <option value="">Escolha…</option>
                {aprovados.map((m) => <option key={m.nome} value={m.nome}>{m.nome}</option>)}
              </select>
            </Campo>
          )}
          {modelo && vars.map((v) => (
            <div key={v} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
              <span className="text-[13px] qs-num" style={{ color: "var(--muted)" }}>{`{{${v}}}`}</span>
              <select className={INPUT} style={INPUT_ESTILO} value={mapa[v]?.fonte ?? ""} onChange={(e) => setMapa({ ...mapa, [v]: { fonte: e.target.value as MapaVariaveis[string]["fonte"] } })}>
                <option value="">De onde vem?</option>
                {fontes.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
              </select>
              {mapa[v]?.fonte === "texto" || mapa[v]?.fonte === "destino"
                ? <input className={INPUT} style={INPUT_ESTILO} placeholder={mapa[v]?.fonte === "destino" ? "Se não achar, usar…" : "Texto"} value={mapa[v]?.valor ?? ""}
                         onChange={(e) => setMapa({ ...mapa, [v]: { ...mapa[v], valor: e.target.value } })} />
                : <span />}
            </div>
          ))}
          {modelo && <Bolha titulo={modelo.cabecalho} texto={preverTexto(modelo.corpo, mapa, grupoLink)} rodape={modelo.rodape} botao={modelo.botaoParar !== false ? "Parar de receber" : null} />}
        </>
      )}

      {passo === 2 && (
        <>
          {setor === "comercial" ? <FiltrosComercial p={publico} set={setPublico} op={op} /> : <FiltrosRel p={publico} set={setPublico} />}
          <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
            Saem sozinhos: quem pediu pra parar, telefone inválido, números proibidos (1935) e do time, quem está em conversa nas últimas 24 h,
            quem recebeu disparo nos últimos {cfg.ritmo.intervalo_dias} dias{setor === "comercial" ? " e lead cujo SDR não tem número conectado na Meta" : ""}.
          </p>
          <CaixaPrevia pv={pv} carregando={contando} setor={setor} />
        </>
      )}

      {passo === 3 && modelo && (
        <>
          {setor === "comercial" && (
            <Campo rotulo="Cadência (o disparo é o passo 1)" dica="Quem responde cai no WhatsApp do SDR dono com uma atividade pra hoje; quem não responde segue os próximos passos.">
              <select className={INPUT} style={INPUT_ESTILO} value={cadencia} onChange={(e) => setCadencia(e.target.value)}>
                <option value="">Escolha…</option>
                {op.cadencias.filter((c) => c.ativa).map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
              </select>
            </Campo>
          )}
          {(setor === "relacionamento" || usaGrupo) && (
            <Campo rotulo={usaGrupo ? "Link de convite do grupo" : "Link do grupo (opcional — use a variável “Link do grupo”)"}>
              <input className={INPUT} style={INPUT_ESTILO} placeholder="https://chat.whatsapp.com/…" value={grupoLink} onChange={(e) => setGrupoLink(e.target.value.trim())} />
            </Campo>
          )}
          <dl className="text-[13px] space-y-1" style={{ color: "var(--text)" }}>
            <div><dt className="inline font-semibold">Campanha: </dt><dd className="inline">{nome}</dd></div>
            <div><dt className="inline font-semibold">Modelo: </dt><dd className="inline">{modelo.nome}</dd></div>
            <div><dt className="inline font-semibold">Público: </dt><dd className="inline">{descreverPublico(setor, publico)} — <b>{pv?.total ?? 0}</b></dd></div>
            <div><dt className="inline font-semibold">Ritmo: </dt><dd className="inline">até {cfg.ritmo.por_hora}/hora e {cfg.ritmo.por_dia}/dia por número, {cfg.ritmo.inicio}–{cfg.ritmo.fim} ({cfg.ritmo.dias.map((d) => DIAS[d]).join(", ")})</dd></div>
          </dl>
          {cfg.simulacao && <Alert tone="info">Modo simulação: a fila anda e o painel mostra tudo, mas nenhuma mensagem sai, nenhuma tarefa é criada.</Alert>}
          <p className="text-[12px]" style={{ color: "var(--subtle)" }}>A campanha nasce como rascunho. O envio começa quando você clicar em "Iniciar".</p>
        </>
      )}
    </Modal>
  );
}

// ── Painel da campanha ──────────────────────────────────────────────────────

function PainelCampanha({ c, onFechar }: { c: Campanha; onFechar: () => void }) {
  const [p, setP] = useState<Painel | null>(null);
  useEffect(() => { painel(c.id).then(setP).catch((e) => notifyError(e instanceof Error ? e.message : "Falhou.")); }, [c.id]);
  const r = p?.resumo;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <Modal aberto titulo={c.nome} onFechar={onFechar} largura={820}>
      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{c.modelo_nome} · {descreverPublico(c.setor, c.publico)}</p>
      {!r ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : (
        <>
          {r.simulados > 0 && <Alert tone="info">{r.simulados} envio(s) em simulação — nada saiu de verdade.</Alert>}
          <div className="qs-kpis">
            <KpiCard label="Na fila" value={r.pendentes} hint={`${r.pulados} pulados · ${r.cancelados} cancelados`} />
            <KpiCard label="Enviados" value={r.enviados} hint={`${r.erros} com erro`} tone={r.erros ? "danger" : undefined} />
            <KpiCard label="Entregues" value={r.entregues} hint={pct(r.entregues, r.enviados)} />
            <KpiCard label="Lidos" value={r.lidos} hint={pct(r.lidos, r.entregues)} />
            <KpiCard label="Responderam" value={r.responderam} hint={pct(r.responderam, r.enviados)} tone={r.responderam ? "ok" : undefined} />
          </div>
          {c.setor === "comercial" && <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{r.na_cadencia} lead(s) já entraram na cadência.</p>}
          {p.porSdr.length > 0 && (
            <div className="qs-card qs-table-wrap">
              <table className="qs-table">
                <thead><tr><th>SDR (número)</th><th>Na campanha</th><th>Enviados</th><th>Responderam</th></tr></thead>
                <tbody>{p.porSdr.map((s) => <tr key={s.sdr_id}><td>{s.nome}</td><td className="qs-num">{s.total}</td><td className="qs-num">{s.enviados}</td><td className="qs-num">{s.responderam}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="qs-label mb-1">Últimas respostas</p>
              {p.respostas.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Ninguém respondeu ainda.</p> : (
                <ul className="text-[13px] space-y-1" style={{ color: "var(--text)" }}>
                  {p.respostas.map((x, i) => <li key={i}>{x.nome ?? "—"}{x.sdr ? <span style={{ color: "var(--subtle)" }}> · {x.sdr.split(" ")[0]}</span> : null} <span style={{ color: "var(--subtle)" }}>{new Date(x.respondeu_em).toLocaleString("pt-BR")}</span></li>)}
                </ul>
              )}
            </div>
            <div>
              <p className="qs-label mb-1">Pulados e erros</p>
              {p.erros.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Nenhum.</p> : (
                <ul className="text-[13px] space-y-1" style={{ color: "var(--text)" }}>
                  {p.erros.map((x, i) => <li key={i}>{x.nome ?? "—"} <span style={{ color: "var(--subtle)" }}>— {x.motivo ?? x.status}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Ritmo (admin) ───────────────────────────────────────────────────────────

function RitmoForm({ cfg, onSalvo, podeEditar }: { cfg: ConfigDisparo; onSalvo: () => void; podeEditar: boolean }) {
  const [r, setR] = useState<Ritmo>(cfg.ritmo);
  const n = (k: keyof Ritmo, v: string) => setR({ ...r, [k]: Number(v) });
  return (
    <div className="qs-card p-4 space-y-3 max-w-[560px]">
      <p className="text-[13px]" style={{ color: "var(--muted)" }}>Teto POR NÚMERO (cada SDR tem o dele). A fila anda de 5 em 5 minutos, espalhando a hora — nada de rajada.</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo rotulo="Por hora"><input type="number" min={1} className={INPUT} style={INPUT_ESTILO} disabled={!podeEditar} value={r.por_hora} onChange={(e) => n("por_hora", e.target.value)} /></Campo>
        <Campo rotulo="Por dia"><input type="number" min={1} className={INPUT} style={INPUT_ESTILO} disabled={!podeEditar} value={r.por_dia} onChange={(e) => n("por_dia", e.target.value)} /></Campo>
        <Campo rotulo="Começa às"><input type="time" className={INPUT} style={INPUT_ESTILO} disabled={!podeEditar} value={r.inicio} onChange={(e) => setR({ ...r, inicio: e.target.value })} /></Campo>
        <Campo rotulo="Para às"><input type="time" className={INPUT} style={INPUT_ESTILO} disabled={!podeEditar} value={r.fim} onChange={(e) => setR({ ...r, fim: e.target.value })} /></Campo>
      </div>
      <Campo rotulo="Dias"><Chips opcoes={DIAS.map((d, i) => ({ id: String(i), rotulo: d }))} valor={r.dias.map(String)} onChange={(v) => podeEditar && setR({ ...r, dias: v.map(Number).sort() })} /></Campo>
      <Campo rotulo="Intervalo mínimo entre dois disparos pra mesma pessoa (dias)"><input type="number" min={0} className={INPUT} style={INPUT_ESTILO} disabled={!podeEditar} value={r.intervalo_dias} onChange={(e) => n("intervalo_dias", e.target.value)} /></Campo>
      {podeEditar
        ? <Button variant="primary" onClick={async () => { try { await salvarRitmo(r); notifySuccess("Ritmo salvo."); onSalvo(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>Salvar ritmo</Button>
        : <p className="text-[12px]" style={{ color: "var(--subtle)" }}>Só admin muda o ritmo.</p>}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

type Aba = "campanhas" | "modelos" | "ritmo";

export default function DisparosPage({ setor }: { setor: SetorDisparo }) {
  const { currentUser } = useQsAuth();
  const ehAdmin = currentUser?.role === "admin";
  const podeModelo = ehAdmin || currentUser?.role === "gestor";
  const [aba, setAba] = useState<Aba>("campanhas");
  const [cfg, setCfg] = useState<ConfigDisparo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [cont, setCont] = useState<Record<string, Partial<Record<StatusEnvio, number>>>>({});
  const [nova, setNova] = useState(false);
  const [vendo, setVendo] = useState<Campanha | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([lerConfig(setor), listarCampanhas(setor)]);
      setCfg(c); setLista(l); setErro(null);
      setCont(await contagens(l.filter((x) => x.status !== "rascunho").slice(0, 20).map((x) => x.id)));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); }
  }, [setor]);
  useEffect(() => { void carregar(); }, [carregar]);
  // A fila anda no servidor: atualiza a lista de tempos em tempos.
  useEffect(() => { const t = setInterval(() => void carregar(), 60_000); return () => clearInterval(t); }, [carregar]);

  async function agir(acao: "iniciar" | "pausar" | "retomar" | "cancelar" | "apagar", c: Campanha) {
    if (acao === "cancelar" && !window.confirm(`Cancelar "${c.nome}"? Quem ainda não recebeu não recebe mais.`)) return;
    if (acao === "iniciar" && !window.confirm(`Iniciar "${c.nome}"? A fila começa a andar na próxima janela de envio.`)) return;
    setOcupado(c.id);
    try {
      const r = await acaoCampanha(acao, c.id);
      if (acao === "iniciar") notifySuccess(`${r.total ?? 0} na fila${r.simulacao ? " (simulação)" : ""}.`);
      await carregar();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(null); }
  }

  const abas = useMemo(() => [
    { value: "campanhas" as Aba, label: "Campanhas" },
    { value: "modelos" as Aba, label: "Modelos" },
    { value: "ritmo" as Aba, label: "Ritmo e janela" },
  ], []);

  return (
    <Page>
      <PageHeader
        title={setor === "comercial" ? "Disparo em massa" : "Disparos e remarketing"}
        subtitle={setor === "comercial"
          ? "Modelo aprovado pela Meta, pelo número de cada SDR, como passo 1 de uma cadência."
          : "Modelo aprovado pela Meta, pelo número do Relacionamento, pra base de clientes e pros grupos."}
        actions={aba === "campanhas" && cfg ? <Button variant="primary" onClick={() => setNova(true)}>+ Nova campanha</Button> : undefined}
      />
      {cfg?.simulacao && <Alert tone="info">Modo simulação ligado: nada sai de verdade. Desligar é decisão do Bruno (docs/DISPARO-EM-MASSA.md).</Alert>}
      {cfg && !cfg.simulacao && !cfg.envioRealPlugado && <Alert tone="warn">Simulação desligada, mas o envio real ainda não está plugado — a fila fica parada.</Alert>}
      {cfg && setor === "comercial" && cfg.numerosSdr.length === 0 && <Alert tone="warn">Nenhum SDR com número conectado na Meta (Configurações → WhatsApp). Sem número, o lead fica de fora.</Alert>}
      {cfg && setor === "relacionamento" && !cfg.numeroRel?.conectado && <Alert tone="warn">O número do Relacionamento não está conectado na Meta.</Alert>}
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Segmented options={abas} value={aba} onChange={setAba} label="Seções do disparo" />

      {aba === "modelos" && cfg && <ModelosDisparo setor={setor} modelos={cfg.modelos} podeEditar={podeModelo} onMudou={() => void carregar()} />}
      {aba === "ritmo" && cfg && <RitmoForm cfg={cfg} podeEditar={ehAdmin} onSalvo={() => void carregar()} />}

      {aba === "campanhas" && (lista === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p>
        : lista.length === 0 ? (
          <div className="qs-card"><EmptyState title="Nenhuma campanha ainda"
            description={setor === "comercial" ? "Ex.: resgatar os perdidos do Japão de setembro, cada um pelo número do SDR dono." : "Ex.: chamar quem voltou da Islândia e não tem viagem marcada."}
            action={cfg ? <Button variant="primary" onClick={() => setNova(true)}>Criar a primeira</Button> : undefined} /></div>
        ) : (
          <ul className="space-y-3">
            {lista.map((c) => {
              const st = STATUS[c.status];
              const k = cont[c.id] ?? {};
              const feitos = (k.enviado ?? 0) + (k.erro ?? 0) + (k.pulado ?? 0);
              const total = feitos + (k.pendente ?? 0);
              return (
                <li key={c.id} className="qs-card p-4 space-y-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{c.nome}</p>
                      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{c.modelo_nome} · {descreverPublico(c.setor, c.publico)} · criada {new Date(c.criado_em).toLocaleDateString("pt-BR")}</p>
                      {c.ultimo_erro && <p className="text-[12.5px] qs-tone-danger">{c.ultimo_erro}</p>}
                    </div>
                    <Badge tone={st.tom} dot>{st.rotulo}</Badge>
                  </div>
                  {c.status !== "rascunho" && total > 0 && (
                    <>
                      <ProgressBar value={(feitos / total) * 100} label="Progresso da fila" />
                      <p className="text-[12px] qs-num" style={{ color: "var(--subtle)" }}>
                        {k.enviado ?? 0} enviados · {k.respondeu ?? 0} responderam · {k.pendente ?? 0} na fila · {k.pulado ?? 0} pulados · {k.erro ?? 0} erros
                      </p>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "rascunho" && <Button variant="primary" size="sm" disabled={!!ocupado} onClick={() => void agir("iniciar", c)}>Iniciar</Button>}
                    {c.status === "enviando" && <Button size="sm" disabled={!!ocupado} onClick={() => void agir("pausar", c)}>Pausar</Button>}
                    {c.status === "pausada" && <Button variant="primary" size="sm" disabled={!!ocupado} onClick={() => void agir("retomar", c)}>Retomar</Button>}
                    {(c.status === "enviando" || c.status === "pausada") && <Button variant="destructive" size="sm" disabled={!!ocupado} onClick={() => void agir("cancelar", c)}>Cancelar</Button>}
                    {c.status !== "rascunho" && <Button variant="ghost" size="sm" onClick={() => setVendo(c)}>Painel</Button>}
                    {c.status === "rascunho" && <Button variant="ghost" size="sm" disabled={!!ocupado} onClick={() => void agir("apagar", c)}>Apagar</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {nova && cfg && <NovaCampanha setor={setor} cfg={cfg} onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />}
      {vendo && <PainelCampanha c={vendo} onFechar={() => setVendo(null)} />}
    </Page>
  );
}
