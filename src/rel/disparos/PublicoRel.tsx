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
import { Botao, Entrada } from "@/rel/ui";
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

/** Os filtros que dá pra ADICIONAR (começa em "todos os clientes", igual ao ManyChat). */
type IdFiltro = "etiquetas" | "sem_etiquetas" | "destino" | "embarque" | "sem_viagem_futura" | "viajou" | "expedicao" | "retorno" | "niveis" | "aniversario_mes" | "estados" | "clientes";
const FILTROS: { id: IdFiltro; rotulo: string; chaves: (keyof PublicoRel)[] }[] = [
  { id: "etiquetas", rotulo: "Tem a etiqueta", chaves: ["etiquetas", "etiquetas_modo"] },
  { id: "sem_etiquetas", rotulo: "Não tem a etiqueta", chaves: ["sem_etiquetas"] },
  { id: "destino", rotulo: "Destino da viagem", chaves: ["destino"] },
  { id: "embarque", rotulo: "Viagem marcada (embarque entre)", chaves: ["embarque_de", "embarque_ate"] },
  { id: "sem_viagem_futura", rotulo: "Sem viagem marcada", chaves: ["sem_viagem_futura"] },
  { id: "viajou", rotulo: "Já viajou com a gente?", chaves: ["viajou"] },
  { id: "expedicao", rotulo: "Expedição que fez", chaves: ["expedicao"] },
  { id: "retorno", rotulo: "Voltou de viagem entre", chaves: ["retorno_de", "retorno_ate"] },
  { id: "niveis", rotulo: "Nível do clube", chaves: ["niveis"] },
  { id: "aniversario_mes", rotulo: "Aniversário no mês", chaves: ["aniversario_mes"] },
  { id: "estados", rotulo: "Estado (UF)", chaves: ["estados"] },
  { id: "clientes", rotulo: "Só clientes escolhidos", chaves: ["clientes"] },
];
const preenchido = (v: unknown) => !(v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length));
const filtrosAtivos = (p: PublicoRel) => FILTROS.filter((f) => f.chaves.some((k) => k !== "etiquetas_modo" && preenchido(p[k]))).map((f) => f.id);

function EditorFiltro({ id, p, set, etiquetas }: { id: IdFiltro; p: PublicoRel; set: (p: PublicoRel) => void; etiquetas: { etiqueta: string; n: number }[] }) {
  switch (id) {
    case "etiquetas": return (
      <div className="space-y-1.5">
        <CampoEtiquetas valor={p.etiquetas ?? []} onChange={(v) => set({ ...p, etiquetas: v })} existentes={etiquetas} />
        {(p.etiquetas ?? []).length > 1 && (
          <select className="rel-input w-auto" value={p.etiquetas_modo ?? "qualquer"} onChange={(e) => set({ ...p, etiquetas_modo: e.target.value as PublicoRel["etiquetas_modo"] })}>
            <option value="qualquer">qualquer uma delas</option><option value="todas">todas elas</option>
          </select>
        )}
      </div>
    );
    case "sem_etiquetas": return <CampoEtiquetas valor={p.sem_etiquetas ?? []} onChange={(v) => set({ ...p, sem_etiquetas: v })} existentes={etiquetas} />;
    case "destino": return <Entrada value={p.destino ?? ""} placeholder="Ex.: Japão" onChange={(e) => set({ ...p, destino: e.target.value })} />;
    case "embarque": return (
      <div className="grid grid-cols-2 gap-2">
        <Entrada type="date" aria-label="Embarca a partir de" value={p.embarque_de ?? ""} onChange={(e) => set({ ...p, embarque_de: e.target.value })} />
        <Entrada type="date" aria-label="Embarca até" value={p.embarque_ate ?? ""} onChange={(e) => set({ ...p, embarque_ate: e.target.value })} />
      </div>
    );
    case "sem_viagem_futura": return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Só quem não tem nenhuma viagem marcada.</p>;
    case "viajou": return (
      <select className="rel-input" value={p.viajou || "sim"} onChange={(e) => set({ ...p, viajou: e.target.value as PublicoRel["viajou"] })}>
        <option value="sim">Sim, já viajou</option><option value="nao">Nunca viajou</option>
      </select>
    );
    case "expedicao": return <Entrada value={p.expedicao ?? ""} placeholder="Ex.: Islândia" onChange={(e) => set({ ...p, expedicao: e.target.value })} />;
    case "retorno": return (
      <div className="grid grid-cols-2 gap-2">
        <Entrada type="date" aria-label="Voltou a partir de" value={p.retorno_de ?? ""} onChange={(e) => set({ ...p, retorno_de: e.target.value })} />
        <Entrada type="date" aria-label="Voltou até" value={p.retorno_ate ?? ""} onChange={(e) => set({ ...p, retorno_ate: e.target.value })} />
      </div>
    );
    case "niveis": return <Chips opcoes={NIVEIS.map((n) => ({ id: n, rotulo: n }))} valor={p.niveis ?? []} onChange={(v) => set({ ...p, niveis: v })} />;
    case "aniversario_mes": return (
      <select className="rel-input" value={p.aniversario_mes || ""} onChange={(e) => set({ ...p, aniversario_mes: e.target.value ? Number(e.target.value) : "" })}>
        <option value="">Escolha o mês</option>
        {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
    );
    case "estados": return <Chips opcoes={UFS.map((u) => ({ id: u, rotulo: u }))} valor={p.estados ?? []} onChange={(v) => set({ ...p, estados: v })} />;
    case "clientes": return <ClientesEscolhidos ids={p.clientes ?? []} onChange={(v) => set({ ...p, clientes: v })} />;
  }
}

/** Valor que o filtro ganha ao ser adicionado (o de sim/não já entra marcado). */
function valorInicial(id: IdFiltro): Partial<PublicoRel> {
  if (id === "sem_viagem_futura") return { sem_viagem_futura: true };
  if (id === "viajou") return { viajou: "sim" };
  return {};
}

/**
 * O "PARA QUEM", igual ao ManyChat: começa em TODOS os clientes com WhatsApp e
 * você adiciona só o filtro que precisa ("+ Filtro"). Nenhum campo obrigatório.
 */
export function PublicoRelForm({ p, set, etiquetas }: { p: PublicoRel; set: (p: PublicoRel) => void; etiquetas: { etiqueta: string; n: number }[] }) {
  const [segmentos, setSegmentos] = useState<Segmento[]>([]);
  const [nomeSeg, setNomeSeg] = useState("");
  const [abertos, setAbertos] = useState<IdFiltro[]>(() => filtrosAtivos(p));
  const [menu, setMenu] = useState(false);
  const lerSeg = () => void listarSegmentos().then(setSegmentos).catch(() => setSegmentos([]));
  useEffect(lerSeg, []);

  function adicionar(id: IdFiltro) {
    setAbertos((a) => (a.includes(id) ? a : [...a, id]));
    set({ ...p, ...valorInicial(id) });
    setMenu(false);
  }
  function tirar(id: IdFiltro) {
    const f = FILTROS.find((x) => x.id === id);
    const novo = { ...p };
    for (const k of f?.chaves ?? []) delete novo[k];
    setAbertos((a) => a.filter((x) => x !== id));
    set(novo);
  }
  async function salvar() {
    if (nomeSeg.trim().length < 2) return notifyError("Dê um nome ao público.");
    try { await salvarSegmento(nomeSeg, p); setNomeSeg(""); lerSeg(); notifySuccess("Público salvo."); } catch (e) { notifyError(erroDe(e, "Não salvou.")); }
  }
  const livres = FILTROS.filter((f) => !abertos.includes(f.id));

  return (
    <div className="space-y-3">
      {segmentos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>Públicos salvos:</span>
          {segmentos.map((s) => (
            <span key={s.id} className="inline-flex items-center overflow-hidden rounded-full border text-[12.5px]" style={{ borderColor: "var(--line)" }}>
              <button type="button" className="px-2.5 py-1" style={{ color: "var(--ink)" }} onClick={() => { setAbertos(filtrosAtivos(s.publico)); set({ ...s.publico }); }}>{s.nome}</button>
              <button type="button" className="px-1.5 py-1" style={{ color: "var(--ink3)" }} aria-label={`Apagar ${s.nome}`}
                onClick={() => void apagarSegmento(s.id).then(lerSeg).catch((e) => notifyError(erroDe(e, "Não apagou.")))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
          {abertos.length ? "Clientes com WhatsApp que batem com TODOS os filtros:" : "Todos os clientes com WhatsApp"}
        </p>
        {!abertos.length && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Quem pediu pra não receber já sai sozinho. Adicione um filtro só se quiser afunilar.</p>}
        <ul className="mt-2 space-y-2">
          {abertos.map((id) => {
            const f = FILTROS.find((x) => x.id === id);
            if (!f) return null;
            return (
              <li key={id} className="rounded-lg p-2.5" style={{ background: "var(--card2)" }}>
                <div className="mb-1.5 flex items-center">
                  <span className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>{f.rotulo}</span>
                  <button type="button" className="ml-auto px-1.5 text-[16px] leading-none" style={{ color: "var(--ink3)" }} aria-label={`Tirar o filtro ${f.rotulo}`} onClick={() => tirar(id)}>×</button>
                </div>
                <EditorFiltro id={id} p={p} set={set} etiquetas={etiquetas} />
              </li>
            );
          })}
        </ul>
        <div className="relative mt-2">
          <Botao type="button" variante="fantasma" onClick={() => setMenu(!menu)} aria-expanded={menu}>+ Filtro</Botao>
          {menu && (
            <ul className="absolute z-20 mt-1 max-h-[260px] w-[260px] overflow-y-auto rounded-xl border p-1 shadow-lg" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
              {livres.map((f) => (
                <li key={f.id}><button type="button" className="rel-linha w-full rounded-lg px-2.5 py-1.5 text-left text-[13px]" style={{ color: "var(--ink)" }} onClick={() => adicionar(f.id)}>{f.rotulo}</button></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {abertos.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1"><Entrada value={nomeSeg} placeholder="Salvar este público com o nome… (opcional)" onChange={(e) => setNomeSeg(e.target.value)} /></div>
          <Botao type="button" onClick={() => void salvar()} disabled={nomeSeg.trim().length < 2}>Salvar público</Botao>
        </div>
      )}
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
