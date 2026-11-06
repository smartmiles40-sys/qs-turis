// src/components/sdr/produto/CotacoesPage.tsx
// -----------------------------------------------------------------------------
// Cotações (spec 06/11, seção 5): quadro Solicitada · Em cotação · Entregue ·
// Aprovada · Perdida. Arrastar pra Entregue/Aprovada/Perdida abre o modal com os
// campos obrigatórios da etapa (o gatilho da 0321 confere de novo no banco).
// No celular (sem arrastar) cada card tem "Mover para…".
// O tempo desde a solicitação fica LARANJA acima do SLA (padrão 4h úteis)
// enquanto a cotação não foi entregue.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { fetchQsUsers } from "@/lib/qs/queries";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  CANAIS, ETAPAS_COTACAO, MOTIVOS_PERDA, camposDaEtapa, horasUteisEntre, numeroBr,
  type CotacaoCanal, type CotacaoMotivoPerda, type CotacaoStatus,
} from "@/lib/qs/produtoGanho";
import { listarCotacoes, moverCotacao, type Cotacao } from "@/lib/qs/produtoGanhoDados";

const SLA_HORAS = 4;
const brl = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBr = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
const PERIODOS = [
  { v: "30", rotulo: "30 dias" }, { v: "90", rotulo: "90 dias" }, { v: "7", rotulo: "7 dias" }, { v: "", rotulo: "Tudo" },
];

interface Pendente { cot: Cotacao; para: CotacaoStatus }

export default function CotacoesPage() {
  const { currentUser } = useQsAuth();
  const gestor = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const [lista, setLista] = useState<Cotacao[] | null>(null);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  const [periodo, setPeriodo] = useState("30");
  const [resp, setResp] = useState("");
  const [sdr, setSdr] = useState("");
  const [soRepassadas, setSoRepassadas] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  const carregar = useCallback(async () => {
    const desde = periodo ? new Date(Date.now() - Number(periodo) * 86_400_000) : null;
    setLista(await listarCotacoes({ desde, responsavelId: resp || null, sdrId: sdr || null, soRepassadas }));
  }, [periodo, resp, sdr, soRepassadas]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { fetchQsUsers().then((us) => setNomes(new Map(us.map((u) => [u.id, u.name])))); }, []);
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 60_000); return () => clearInterval(t); }, []);

  const pessoas = useMemo(() => {
    const ids = new Set<string>();
    for (const c of lista ?? []) { ids.add(c.responsavel_id); ids.add(c.sdr_id); }
    return [...ids].map((id) => ({ id, nome: nomes.get(id) ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [lista, nomes]);

  const porEtapa = useMemo(() => {
    const m = new Map<CotacaoStatus, Cotacao[]>(ETAPAS_COTACAO.map((e) => [e.status, []]));
    for (const c of lista ?? []) m.get(c.status)?.push(c);
    return m;
  }, [lista]);

  async function mover(cot: Cotacao, para: CotacaoStatus, campos: Parameters<typeof moverCotacao>[2] = {}) {
    const r = await moverCotacao(cot.id, para, campos);
    if (!r.ok) { notifyError(r.error); return false; }
    setLista((prev) => (prev ?? []).map((c) => (c.id === cot.id ? r.cotacao : c)));
    notifySuccess(`Cotação movida para ${ETAPAS_COTACAO.find((e) => e.status === para)?.rotulo}.`);
    return true;
  }

  function pedirMover(cot: Cotacao, para: CotacaoStatus) {
    if (cot.status === para) return;
    if (camposDaEtapa(para).length > 0) setPendente({ cot, para });
    else void mover(cot, para);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--ink, #111)" }}>Cotações</h1>
          <p className="text-xs" style={{ color: "var(--ink3, #6b7280)" }}>
            Aéreo não gera reunião: gera cotação. Arraste o card de etapa — entregue, aprovada e perdida pedem os dados da etapa.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="qsx-sel rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--line, #e5e7eb)", background: "var(--card, #fff)", color: "var(--ink, #111)" }} aria-label="Período">
            {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.rotulo}</option>)}
          </select>
          {gestor && (
            <>
              <select value={resp} onChange={(e) => setResp(e.target.value)} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--line, #e5e7eb)", background: "var(--card, #fff)", color: "var(--ink, #111)" }} aria-label="Responsável">
                <option value="">Todos os responsáveis</option>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <select value={sdr} onChange={(e) => setSdr(e.target.value)} className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--line, #e5e7eb)", background: "var(--card, #fff)", color: "var(--ink, #111)" }} aria-label="SDR de origem">
                <option value="">Todos os SDRs</option>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </>
          )}
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--ink2, #374151)" }}>
            <input type="checkbox" checked={soRepassadas} onChange={(e) => setSoRepassadas(e.target.checked)} />
            Só repassadas ao closer
          </label>
        </div>
      </div>

      {lista === null ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--ink3, #6b7280)" }}>Carregando…</p>
      ) : (
        <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: "repeat(5, minmax(220px, 1fr))" }}>
          {ETAPAS_COTACAO.map((et) => {
            const cards = porEtapa.get(et.status) ?? [];
            return (
              <section
                key={et.status}
                onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const c = (lista ?? []).find((x) => x.id === arrastando);
                  setArrastando(null);
                  if (c) pedirMover(c, et.status);
                }}
                className="flex min-h-[200px] flex-col rounded-xl p-2"
                style={{ background: "var(--card2, #f6f6f6)", border: "1px solid var(--line, #e5e7eb)" }}
                aria-label={et.rotulo}
              >
                <header className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink2, #374151)" }}>{et.rotulo}</span>
                  <span className="text-[12px] tabular-nums" style={{ color: "var(--ink3, #6b7280)" }}>{cards.length}</span>
                </header>
                <div className="flex flex-col gap-2">
                  {cards.map((c) => (
                    <CardCotacao
                      key={c.id}
                      c={c}
                      agora={agora}
                      nomes={nomes}
                      onDragStart={() => setArrastando(c.id)}
                      onDragEnd={() => setArrastando(null)}
                      onMover={(para) => pedirMover(c, para)}
                    />
                  ))}
                  {cards.length === 0 && <p className="px-1 py-4 text-center text-[11px]" style={{ color: "var(--ink3, #9ca3af)" }}>Nada aqui</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {pendente && (
        <ModalEtapa
          p={pendente}
          onCancelar={() => setPendente(null)}
          onConfirmar={async (campos) => {
            const ok = await mover(pendente.cot, pendente.para, campos);
            if (ok) setPendente(null);
          }}
        />
      )}
    </div>
  );
}

function CardCotacao({ c, agora, nomes, onDragStart, onDragEnd, onMover }: {
  c: Cotacao;
  agora: Date;
  nomes: Map<string, string>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMover: (para: CotacaoStatus) => void;
}) {
  const aberta = c.status === "solicitada" || c.status === "em_cotacao";
  const horas = horasUteisEntre(new Date(c.solicitada_em), aberta ? agora : new Date(c.entregue_em ?? c.decidida_em ?? agora));
  const estourou = aberta && horas > SLA_HORAS;
  const venceu = c.validade_ate && new Date(c.validade_ate) < agora && c.status === "entregue";
  const pax = [c.adultos ? `${c.adultos}A` : "", c.criancas ? `${c.criancas}C` : "", c.bebes ? `${c.bebes}B` : ""].filter(Boolean).join(" ");
  return (
    <article
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; onDragStart(); }}
      onDragEnd={onDragEnd}
      className="cursor-grab rounded-lg p-2.5 text-[12px] active:cursor-grabbing"
      style={{ background: "var(--card, #fff)", border: "1px solid var(--line, #e5e7eb)", color: "var(--ink, #111)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold leading-tight">{c.lead?.full_name ?? "Cliente"}</span>
        {c.repassada_closer && <span className="shrink-0 rounded px-1 text-[10px]" style={{ background: "var(--card2, #f3f4f6)", color: "var(--ink2, #374151)" }}>repassada</span>}
      </div>
      <div className="mt-1" style={{ color: "var(--ink2, #374151)" }}>
        {c.origem ?? "?"} → {c.destino ?? "?"}
      </div>
      <div className="mt-0.5" style={{ color: "var(--ink3, #6b7280)" }}>
        {dataBr(c.data_ida)}{c.data_volta ? `–${dataBr(c.data_volta)}` : " (só ida)"}{pax ? ` · ${pax}` : ""}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2" style={{ color: "var(--ink3, #6b7280)" }}>
        <span className="truncate">{nomes.get(c.responsavel_id) ?? "—"}</span>
        <span className="tabular-nums font-medium" style={{ color: estourou ? "#EA580C" : undefined }} title="Horas úteis desde a solicitação">
          {horas < 1 ? `${Math.round(horas * 60)} min` : `${horas.toFixed(1).replace(".", ",")} h`}
        </span>
      </div>
      {(c.valor_cotado != null || c.valor_emitido != null || c.validade_ate) && (
        <div className="mt-1 flex items-center justify-between gap-2" style={{ color: "var(--ink3, #6b7280)" }}>
          <span>{c.valor_emitido != null ? `Emitido ${brl(c.valor_emitido)}` : c.valor_cotado != null ? `Cotado ${brl(c.valor_cotado)}` : ""}</span>
          {c.validade_ate && (
            <span style={{ color: venceu ? "#EA580C" : undefined }}>val. {new Date(c.validade_ate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
          )}
        </div>
      )}
      <select
        value=""
        onChange={(e) => { if (e.target.value) onMover(e.target.value as CotacaoStatus); }}
        className="mt-2 w-full rounded border px-1.5 py-1 text-[11px] md:hidden"
        style={{ borderColor: "var(--line, #e5e7eb)", background: "var(--card, #fff)", color: "var(--ink2, #374151)" }}
        aria-label="Mover para"
      >
        <option value="">Mover para…</option>
        {ETAPAS_COTACAO.filter((e) => e.status !== c.status).map((e) => <option key={e.status} value={e.status}>{e.rotulo}</option>)}
      </select>
    </article>
  );
}

function ModalEtapa({ p, onCancelar, onConfirmar }: {
  p: Pendente;
  onCancelar: () => void;
  onConfirmar: (campos: Parameters<typeof moverCotacao>[2]) => Promise<void>;
}) {
  const campos = camposDaEtapa(p.para);
  const [valorCotado, setValorCotado] = useState(p.cot.valor_cotado != null ? String(p.cot.valor_cotado) : "");
  const [canal, setCanal] = useState<CotacaoCanal | "">(p.cot.canal_entrega ?? "");
  const [validade, setValidade] = useState(() => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    return p.cot.validade_ate ? p.cot.validade_ate.slice(0, 10) : d.toISOString().slice(0, 10);
  });
  const [valorEmitido, setValorEmitido] = useState(p.cot.valor_emitido != null ? String(p.cot.valor_emitido) : p.cot.valor_cotado != null ? String(p.cot.valor_cotado) : "");
  const [motivo, setMotivo] = useState<CotacaoMotivoPerda | "">(p.cot.motivo_perda ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const titulo = ETAPAS_COTACAO.find((e) => e.status === p.para)?.rotulo ?? p.para;
  const cls = "w-full rounded-lg border px-3 py-2 text-sm";
  const sty = { borderColor: "var(--line, #e5e7eb)", background: "var(--card, #fff)", color: "var(--ink, #111)" };

  async function confirmar() {
    setErro(null);
    const out: NonNullable<Parameters<typeof moverCotacao>[2]> = {};
    if (campos.includes("valor_cotado")) {
      const v = numeroBr(valorCotado);
      if (!Number.isFinite(v) || v <= 0) return setErro("Informe o valor cotado.");
      out.valor_cotado = v;
    }
    if (campos.includes("canal_entrega")) {
      if (!canal) return setErro("Por onde a cotação foi entregue?");
      out.canal_entrega = canal;
    }
    if (campos.includes("validade_ate") && validade) out.validade_ate = new Date(`${validade}T23:59:00-03:00`).toISOString();
    if (campos.includes("valor_emitido")) {
      const v = numeroBr(valorEmitido);
      if (!Number.isFinite(v) || v <= 0) return setErro("Informe o valor emitido.");
      out.valor_emitido = v;
    }
    if (campos.includes("motivo_perda")) {
      if (!motivo) return setErro("Escolha o motivo da perda.");
      out.motivo_perda = motivo;
    }
    setSalvando(true);
    await onConfirmar(out);
    setSalvando(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !salvando && onCancelar()} />
      <div className="relative w-full max-w-sm space-y-3 rounded-2xl p-5 shadow-xl" style={{ background: "var(--card, #fff)", color: "var(--ink, #111)" }}>
        <div>
          <p className="text-sm font-semibold">Mover para {titulo}</p>
          <p className="text-xs" style={{ color: "var(--ink3, #6b7280)" }}>{p.cot.lead?.full_name ?? "Cliente"} · {p.cot.origem} → {p.cot.destino}</p>
        </div>
        {campos.includes("valor_cotado") && (
          <label className="block text-xs">Valor cotado (R$) *
            <input className={cls} style={sty} inputMode="decimal" value={valorCotado} onChange={(e) => setValorCotado(e.target.value)} autoFocus />
          </label>
        )}
        {campos.includes("canal_entrega") && (
          <div className="text-xs">Entregue por *
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              {CANAIS.map((c) => (
                <button key={c.v} type="button" onClick={() => setCanal(c.v)} className="rounded-lg border py-1.5 text-[12px] font-medium"
                  style={canal === c.v ? { background: "#0147FF", borderColor: "#0147FF", color: "#fff" } : sty}>{c.rotulo}</button>
              ))}
            </div>
          </div>
        )}
        {campos.includes("validade_ate") && (
          <label className="block text-xs">Validade da cotação
            <input type="date" className={cls} style={sty} value={validade} onChange={(e) => setValidade(e.target.value)} />
            <span className="mt-0.5 block text-[10.5px]" style={{ color: "var(--ink3, #6b7280)" }}>Passou da validade sem resposta → o responsável ganha uma atividade de FUP.</span>
          </label>
        )}
        {campos.includes("valor_emitido") && (
          <label className="block text-xs">Valor emitido (R$) *
            <input className={cls} style={sty} inputMode="decimal" value={valorEmitido} onChange={(e) => setValorEmitido(e.target.value)} autoFocus />
          </label>
        )}
        {campos.includes("motivo_perda") && (
          <label className="block text-xs">Motivo da perda *
            <select className={cls} style={sty} value={motivo} onChange={(e) => setMotivo(e.target.value as CotacaoMotivoPerda)} autoFocus>
              <option value="">Escolha…</option>
              {MOTIVOS_PERDA.map((m) => <option key={m.v} value={m.v}>{m.rotulo}</option>)}
            </select>
          </label>
        )}
        {erro && <p className="text-xs" style={{ color: "#DC2626" }}>{erro}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancelar} disabled={salvando} className="flex-1 rounded-lg border py-2 text-sm font-medium" style={sty}>Cancelar</button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando} className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "#0147FF" }}>
            {salvando ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
