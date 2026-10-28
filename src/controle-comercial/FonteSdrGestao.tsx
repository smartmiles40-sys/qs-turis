// src/controle-comercial/FonteSdrGestao.tsx
// -----------------------------------------------------------------------------
// GESTÃO › "Leads por fonte e SDR" (Bruno, 28/10/2026: filtros por fonte e por
// SDR responsável na lista de leads E na Gestão).
//
// Um bloco só, com os mesmos filtros da lista de leads (no endereço:
// ?fonte=&sdr=) e o período da Gestão. Conta os leads CRIADOS no período por
// fonte (qs_leads.segment) ou por SDR responsável (owner_id hoje) e quantos
// tiveram reunião marcada no período. Só leitura, paginado (teto de 1000).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/qs/queries";
import { DataTable, Segmented, type Column } from "@/components/ui";
import { intervalo, nomes, type Periodo } from "@/gestao/dados";
import { SEM_FONTE, casaFonte, lerFiltroDaUrl, useFiltrosNaUrl } from "./filtroUrl";
import { estiloEntrada } from "./pecas";

interface LeadLido { id: string; segment: string | null; owner_id: string | null; status: string }
interface Linha { chave: string; rotulo: string; recebidos: number; abertos: number; ganhos: number; perdidos: number; comReuniao: number }
type Agrupar = "fonte" | "sdr";

export default function FonteSdrGestao({ periodo, chave }: { periodo: Periodo; chave: string }) {
  const [fonte, setFonte] = useState(() => lerFiltroDaUrl("fonte"));
  const [sdr, setSdr] = useState(() => lerFiltroDaUrl("sdr"));
  const [agrupar, setAgrupar] = useState<Agrupar>(() => (lerFiltroDaUrl("fonte") ? "sdr" : "fonte"));
  useFiltrosNaUrl(fonte, sdr);
  const [dado, setDado] = useState<{ leads: LeadLido[]; comReuniao: Set<string>; pessoas: Map<string, { nome: string; ativo: boolean }> } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDado(null); setErro(null);
    const i = intervalo(periodo);
    Promise.all([
      fetchAllRows<LeadLido>((de, ate) => supabase.from("qs_leads").select("id, segment, owner_id, status")
        .gte("created_at", i.deIso).lte("created_at", i.ateIso).order("id").range(de, ate)),
      fetchAllRows<{ lead_id: string | null }>((de, ate) => supabase.from("qs_meetings").select("lead_id")
        .neq("status", "arquivada").gte("created_at", i.deIso).lte("created_at", i.ateIso).order("id").range(de, ate)),
      nomes(),
    ]).then(([leads, reunioes, pessoas]) => {
      if (!vivo) return;
      setDado({ leads, comReuniao: new Set(reunioes.map((r) => r.lead_id).filter((x): x is string => !!x)), pessoas });
    }).catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : "não carregou"); });
    return () => { vivo = false; };
  }, [periodo, chave]);

  const fontes = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of dado?.leads ?? []) { const s = (l.segment ?? "").trim() || SEM_FONTE; c.set(s, (c.get(s) ?? 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [dado]);
  const sdrs = useMemo(() => {
    const ids = new Set((dado?.leads ?? []).map((l) => l.owner_id).filter((x): x is string => !!x));
    if (sdr) ids.add(sdr);
    return [...ids].map((id) => ({ id, ...(dado?.pessoas.get(id) ?? { nome: "Sem nome", ativo: true }) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [dado, sdr]);

  const linhas = useMemo<Linha[]>(() => {
    if (!dado) return [];
    const m = new Map<string, Linha>();
    for (const l of dado.leads) {
      if (!casaFonte(l.segment, fonte)) continue;
      if (sdr && l.owner_id !== sdr) continue;
      const k = agrupar === "fonte" ? ((l.segment ?? "").trim() || SEM_FONTE) : (l.owner_id ?? "-");
      let r = m.get(k);
      if (!r) {
        const rotulo = agrupar === "fonte" ? (k === SEM_FONTE ? "(sem fonte)" : k)
          : k === "-" ? "(sem responsável)" : `${dado.pessoas.get(k)?.nome ?? "Sem nome"}${dado.pessoas.get(k)?.ativo === false ? " (inativo)" : ""}`;
        r = { chave: k, rotulo, recebidos: 0, abertos: 0, ganhos: 0, perdidos: 0, comReuniao: 0 };
        m.set(k, r);
      }
      r.recebidos++;
      if (l.status === "ganho") r.ganhos++;
      else if (l.status === "perdido") r.perdidos++;
      else r.abertos++;
      if (dado.comReuniao.has(l.id)) r.comReuniao++;
    }
    return [...m.values()].sort((a, b) => b.recebidos - a.recebidos);
  }, [dado, fonte, sdr, agrupar]);
  const total = linhas.reduce((t, l) => ({ ...t, recebidos: t.recebidos + l.recebidos, comReuniao: t.comReuniao + l.comReuniao }), { recebidos: 0, comReuniao: 0 });

  const N = ({ v }: { v: number }) => <span className={`qs-num${v ? "" : " qs-tone-subtle"}`}>{v ? v.toLocaleString("pt-BR") : "—"}</span>;
  const col: Column<Linha>[] = [
    { key: "g", header: agrupar === "fonte" ? "Fonte" : "SDR responsável", render: (r) => r.rotulo },
    { key: "rec", header: "Leads", align: "right", render: (r) => <N v={r.recebidos} /> },
    { key: "ab", header: "Em aberto", align: "right", render: (r) => <N v={r.abertos} /> },
    { key: "re", header: "Com reunião marcada", align: "right", render: (r) => <span className="qs-num">{r.comReuniao ? `${r.comReuniao} (${Math.round((r.comReuniao / r.recebidos) * 100)}%)` : "—"}</span> },
    { key: "ga", header: "Ganhos", align: "right", render: (r) => <N v={r.ganhos} /> },
    { key: "pe", header: "Perdidos", align: "right", render: (r) => <N v={r.perdidos} /> },
  ];

  return (
    <section aria-label="Leads por fonte e SDR" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, flex: "1 1 auto" }}>Leads por fonte e SDR</h2>
        <Segmented label="Agrupar por" value={agrupar} onChange={setAgrupar} options={[{ value: "fonte", label: "Por fonte" }, { value: "sdr", label: "Por SDR" }]} />
        <select aria-label="Fonte" value={fonte} onChange={(e) => setFonte(e.target.value)} style={{ ...estiloEntrada, width: 230 }}>
          <option value="">Todas as fontes</option>
          {fonte && !fontes.some(([f]) => f === fonte) && <option value={fonte}>{fonte === SEM_FONTE ? "(sem fonte)" : fonte}</option>}
          {fontes.map(([f, n]) => <option key={f} value={f}>{f === SEM_FONTE ? "(sem fonte)" : f} ({n})</option>)}
        </select>
        <select aria-label="SDR responsável" value={sdr} onChange={(e) => setSdr(e.target.value)} style={{ ...estiloEntrada, width: 200 }}>
          <option value="">Todos os responsáveis</option>
          {sdrs.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
        </select>
      </div>
      <span className="qs-label">
        Leads criados no período{fonte || sdr ? ", com os filtros" : ""}: {total.recebidos.toLocaleString("pt-BR")}
        {total.recebidos ? ` · ${total.comReuniao} com reunião marcada no período` : ""}. Responsável = dono atual do lead. Os mesmos filtros valem na lista de leads (ficam no endereço).
      </span>
      {erro ? <div className="qs-card" style={{ padding: 16 }}><span className="qs-tone-danger">Não carregou: {erro}</span></div>
        : !dado ? <div className="qs-card animate-pulse" style={{ height: 120 }} aria-busy="true" aria-label="Carregando" />
        : <DataTable columns={col} rows={linhas} rowKey={(r) => r.chave} minWidth={620}
            empty={<p className="qs-label" style={{ padding: 16, margin: 0 }}>Nenhum lead no período com esses filtros.</p>} />}
    </section>
  );
}
