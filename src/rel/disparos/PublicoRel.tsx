// src/rel/disparos/PublicoRel.tsx
// -----------------------------------------------------------------------------
// "PARA QUEM" do disparo do Relacionamento (0408) — o filtro igual ao do
// ManyChat: etiquetas (qualquer/todas, e "sem"), viagem feita ou marcada,
// nível do clube, aniversário, UF, clientes escolhidos a dedo e públicos salvos.
// Usado no "Novo disparo" e no "Etiquetar por filtro" (Contatos).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { MESES, NIVEIS, type PublicoRel } from "@/lib/qs/disparos";
import { Chips } from "@/components/sdr/disparos/pecas";
import { Botao, Campo, Entrada } from "@/rel/ui";
import {
  apagarSegmento, buscarClientes, contagemEtiquetas, listarSegmentos, nomesDosClientes, normalizarEtiqueta, salvarSegmento,
  type Segmento,
} from "./oficialRel";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

export function useEtiquetas(versao = 0) {
  const [lista, setLista] = useState<{ etiqueta: string; n: number }[]>([]);
  useEffect(() => {
    let vivo = true;
    contagemEtiquetas().then((l) => { if (vivo) setLista(l); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [versao]);
  return lista;
}

/** Campo de etiquetas: escolhe das existentes ou digita uma nova (Enter). */
export function CampoEtiquetas({ valor, onChange, existentes, placeholder = "digite e Enter" }: {
  valor: string[]; onChange: (v: string[]) => void; existentes: { etiqueta: string; n: number }[]; placeholder?: string;
}) {
  const [txt, setTxt] = useState("");
  const add = (s: string) => { const e = normalizarEtiqueta(s); if (e && !valor.includes(e)) onChange([...valor, e]); setTxt(""); };
  const sugestoes = existentes.filter((x) => !valor.includes(x.etiqueta) && (!txt || x.etiqueta.includes(normalizarEtiqueta(txt)))).slice(0, 12);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {valor.map((e) => (
          <button key={e} type="button" onClick={() => onChange(valor.filter((x) => x !== e))}
            className="rounded-full px-2.5 py-1 text-[12.5px] font-medium" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}
            aria-label={`Tirar ${e}`}>{e} ×</button>
        ))}
        <input className="rel-input min-w-[140px] flex-1" value={txt} placeholder={placeholder}
          onChange={(ev) => setTxt(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === ",") { ev.preventDefault(); add(txt); } }} />
      </div>
      {sugestoes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sugestoes.map((s) => (
            <button key={s.etiqueta} type="button" onClick={() => add(s.etiqueta)} className="rounded-full border px-2 py-0.5 text-[12px]"
              style={{ borderColor: "var(--line)", color: "var(--ink2)" }}>+ {s.etiqueta} <span style={{ color: "var(--ink3)" }}>{s.n}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClientesEscolhidos({ ids, onChange }: { ids: string[]; onChange: (v: string[]) => void }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<{ id: string; nome: string; telefone: string | null }[]>([]);
  const [nomes, setNomes] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const t = setTimeout(() => { void buscarClientes(termo).then(setAchados).catch(() => setAchados([])); }, 300);
    return () => clearTimeout(t);
  }, [termo]);
  useEffect(() => { void nomesDosClientes(ids).then(setNomes); }, [ids]);
  return (
    <div className="space-y-1.5">
      <Entrada value={termo} placeholder="Buscar por nome ou telefone…" onChange={(e) => setTermo(e.target.value)} />
      {achados.length > 0 && (
        <ul className="max-h-[150px] overflow-y-auto rounded-lg border text-[12.5px]" style={{ borderColor: "var(--line)" }}>
          {achados.map((c) => (
            <li key={c.id}>
              <button type="button" className="rel-linha flex w-full justify-between px-2.5 py-1.5 text-left" disabled={ids.includes(c.id)}
                onClick={() => { onChange([...ids, c.id]); setTermo(""); }}>
                <span style={{ color: "var(--ink)" }}>{c.nome}</span><span style={{ color: "var(--ink3)" }}>{c.telefone ? `…${c.telefone.replace(/\D/g, "").slice(-4)}` : "sem telefone"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <button key={id} type="button" onClick={() => onChange(ids.filter((x) => x !== id))} className="rounded-full border px-2.5 py-0.5 text-[12px]"
              style={{ borderColor: "var(--line)", color: "var(--ink)" }}>{nomes.get(id) ?? "…"} ×</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** O formulário inteiro do "Para quem". */
export function PublicoRelForm({ p, set, etiquetas }: { p: PublicoRel; set: (p: PublicoRel) => void; etiquetas: { etiqueta: string; n: number }[] }) {
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [nomeSeg, setNomeSeg] = useState("");
  const [mais, setMais] = useState(Boolean(p.expedicao || p.retorno_de || p.retorno_ate || p.niveis?.length || p.viajou || p.estados?.length || p.clientes?.length));
  const lerSeg = () => void listarSegmentos().then(setSegmentos).catch(() => setSegmentos([]));
  useEffect(lerSeg, []);

  async function salvar() {
    if (nomeSeg.trim().length < 2) return notifyError("Dê um nome ao público.");
    try { await salvarSegmento(nomeSeg, p); setNomeSeg(""); lerSeg(); notifySuccess("Público salvo."); } catch (e) { notifyError(erroDe(e, "Não salvou.")); }
  }

  return (
    <div className="space-y-4">
      {segmentos.length > 0 && (
        <Campo rotulo="Públicos salvos">
          <div className="flex flex-wrap gap-1.5">
            {segmentos.map((s) => (
              <span key={s.id} className="inline-flex items-center overflow-hidden rounded-full border text-[12.5px]" style={{ borderColor: "var(--line)" }}>
                <button type="button" className="px-2.5 py-1" style={{ color: "var(--ink)" }} onClick={() => set({ ...s.publico })}>{s.nome}</button>
                <button type="button" className="px-1.5 py-1" style={{ color: "var(--ink3)" }} aria-label={`Apagar ${s.nome}`}
                  onClick={() => void apagarSegmento(s.id).then(lerSeg).catch((e) => notifyError(erroDe(e, "Não apagou.")))}>×</button>
              </span>
            ))}
          </div>
        </Campo>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Campo rotulo="Com as etiquetas">
          <CampoEtiquetas valor={p.etiquetas ?? []} onChange={(v) => set({ ...p, etiquetas: v })} existentes={etiquetas} />
        </Campo>
        <Campo rotulo="Precisa ter">
          <select className="rel-input" value={p.etiquetas_modo ?? "qualquer"} onChange={(e) => set({ ...p, etiquetas_modo: e.target.value as PublicoRel["etiquetas_modo"] })}>
            <option value="qualquer">qualquer uma</option><option value="todas">todas</option>
          </select>
        </Campo>
      </div>
      <Campo rotulo="Sem as etiquetas" dica="Quem tiver qualquer uma destas fica de fora.">
        <CampoEtiquetas valor={p.sem_etiquetas ?? []} onChange={(v) => set({ ...p, sem_etiquetas: v })} existentes={etiquetas} />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Destino (contém)"><Entrada value={p.destino ?? ""} placeholder="Ex.: Japão" onChange={(e) => set({ ...p, destino: e.target.value })} /></Campo>
        <Campo rotulo="Embarca a partir de" dica="Viagem marcada"><Entrada type="date" value={p.embarque_de ?? ""} onChange={(e) => set({ ...p, embarque_de: e.target.value })} /></Campo>
        <Campo rotulo="Embarca até"><Entrada type="date" value={p.embarque_ate ?? ""} onChange={(e) => set({ ...p, embarque_ate: e.target.value })} /></Campo>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Aniversário no mês">
          <select className="rel-input" value={p.aniversario_mes ?? ""} onChange={(e) => set({ ...p, aniversario_mes: e.target.value ? Number(e.target.value) : "" })}>
            <option value="">Tanto faz</option>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Campo>
        <label className="flex items-end gap-2 pb-2 text-[13px]" style={{ color: "var(--ink)" }}>
          <input type="checkbox" checked={!!p.sem_viagem_futura} onChange={(e) => set({ ...p, sem_viagem_futura: e.target.checked })} />
          Só quem não tem viagem marcada
        </label>
      </div>

      <button type="button" className="text-[12.5px] font-semibold underline" style={{ color: "var(--ink2)" }} onClick={() => setMais(!mais)}>
        {mais ? "Menos filtros" : "Mais filtros (viagem feita, nível, UF, escolher a dedo)"}
      </button>
      {mais && (
        <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Expedição que fez (contém)"><Entrada value={p.expedicao ?? ""} placeholder="Ex.: Islândia" onChange={(e) => set({ ...p, expedicao: e.target.value })} /></Campo>
            <Campo rotulo="Voltou a partir de"><Entrada type="date" value={p.retorno_de ?? ""} onChange={(e) => set({ ...p, retorno_de: e.target.value })} /></Campo>
            <Campo rotulo="Voltou até"><Entrada type="date" value={p.retorno_ate ?? ""} onChange={(e) => set({ ...p, retorno_ate: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Nível do clube"><Chips opcoes={NIVEIS.map((n) => ({ id: n, rotulo: n }))} valor={p.niveis ?? []} onChange={(v) => set({ ...p, niveis: v })} /></Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Já viajou com a gente?">
              <select className="rel-input" value={p.viajou ?? ""} onChange={(e) => set({ ...p, viajou: e.target.value as PublicoRel["viajou"] })}>
                <option value="">Tanto faz</option><option value="sim">Sim</option><option value="nao">Nunca</option>
              </select>
            </Campo>
            <Campo rotulo="Estado (UF)"><Chips opcoes={UFS.map((u) => ({ id: u, rotulo: u }))} valor={p.estados ?? []} onChange={(v) => set({ ...p, estados: v })} /></Campo>
          </div>
          <Campo rotulo="Só estes clientes (escolher a dedo)" dica="Bom pra teste: escolha você mesmo.">
            <ClientesEscolhidos ids={p.clientes ?? []} onChange={(v) => set({ ...p, clientes: v })} />
          </Campo>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1"><Entrada value={nomeSeg} placeholder="Nome pra salvar este público (opcional)" onChange={(e) => setNomeSeg(e.target.value)} /></div>
        <Botao type="button" onClick={() => void salvar()} disabled={nomeSeg.trim().length < 2}>Salvar público</Botao>
      </div>
    </div>
  );
}

/** Tira campos vazios antes de mandar pro servidor (o filtro fica legível no banco). */
export function limparPublico(p: PublicoRel): PublicoRel {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === "" || v === undefined || v === null || v === false) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  if (!(out.etiquetas as string[] | undefined)?.length) delete out.etiquetas_modo;
  return out as PublicoRel;
}
