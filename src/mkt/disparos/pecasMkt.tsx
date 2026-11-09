// src/mkt/disparos/pecasMkt.tsx
// Peças das telas de disparo do Marketing (0242): o público (base de contatos,
// leads ou clientes do QS) e o modelo com as variáveis. Reusa as peças e os
// filtros do disparo do Comercial/Rel (src/components/sdr/disparos).
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { FONTES, preverTexto, variaveisDoCorpo, type MapaVariaveis, type ModeloDisparo, type Previa } from "@/lib/qs/disparos";
import { Bolha, Campo, Chips, INPUT, INPUT_ESTILO } from "@/components/sdr/disparos/pecas";
import { FiltrosComercial, FiltrosRel, useOpcoes } from "@/components/sdr/disparos/DisparosPage";
import { listarListas, tagsEmUso, type FontePublico, type Lista, type PublicoMkt } from "./api";

export const FONTES_MKT = FONTES.filter((f) => f.setores.includes("marketing"));

export function useListasETags() {
  const [listas, setListas] = useState<Lista[]>([]);
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  useEffect(() => {
    let vivo = true;
    Promise.all([listarListas().catch(() => []), tagsEmUso().catch(() => [])]).then(([l, t]) => { if (vivo) { setListas(l); setTags(t); } });
    return () => { vivo = false; };
  }, []);
  return { listas, tags };
}

const separar = (v: string) => v.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

/** Escolha do público: base do Marketing (listas/tags) ou as bases do QS. */
export function PublicoMktForm({ p, set }: { p: PublicoMkt; set: (p: PublicoMkt) => void }) {
  const fonte: FontePublico = p.fonte ?? "contatos";
  const { listas, tags } = useListasETags();
  const op = useOpcoes("comercial");
  return (
    <div className="space-y-3">
      <Campo rotulo="De onde vem o público">
        <Chips<FontePublico> opcoes={[
          { id: "contatos", rotulo: "Base do Marketing (listas e tags)" },
          { id: "leads", rotulo: "Leads do QS" },
          { id: "clientes", rotulo: "Clientes do QS (já viajaram)" },
        ]} valor={[fonte]} onChange={(v) => { const f = v.filter((x) => x !== fonte)[0]; if (f) set({ fonte: f }); }} />
      </Campo>
      {fonte === "contatos" && (
        <>
          <Campo rotulo="Listas" dica={p.listas?.length ? "Quem está em QUALQUER uma delas" : "Nenhuma = a base toda"}>
            {listas.length === 0 ? <span className="text-[12.5px]" style={{ color: "var(--subtle)" }}>Nenhuma lista ainda (aba Contatos).</span>
              : <Chips opcoes={listas.map((l) => ({ id: l.id, rotulo: `${l.nome} (${l.total ?? 0})` }))} valor={p.listas ?? []} onChange={(v) => set({ ...p, listas: v })} />}
          </Campo>
          <Campo rotulo="Tags" dica={tags.length ? `Em uso: ${tags.slice(0, 12).map((t) => `${t.tag} (${t.n})`).join(", ")}` : "Separe por vírgula"}>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={INPUT} style={INPUT_ESTILO} placeholder="vip, japão" value={(p.tags ?? []).join(", ")} onChange={(e) => set({ ...p, tags: separar(e.target.value) })} />
              <select className={INPUT} style={INPUT_ESTILO} value={p.tags_modo ?? "qualquer"} onChange={(e) => set({ ...p, tags_modo: e.target.value as PublicoMkt["tags_modo"] })}>
                <option value="qualquer">qualquer uma</option><option value="todas">todas</option>
              </select>
            </div>
          </Campo>
          <Campo rotulo="Tirar quem tem as tags">
            <input className={INPUT} style={INPUT_ESTILO} placeholder="frio, já-comprou" value={(p.sem_tags ?? []).join(", ")} onChange={(e) => set({ ...p, sem_tags: separar(e.target.value) })} />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Entrou na base a partir de"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.criado_de ?? ""} onChange={(e) => set({ ...p, criado_de: e.target.value })} /></Campo>
            <Campo rotulo="Entrou até"><input type="date" className={INPUT} style={INPUT_ESTILO} value={p.criado_ate ?? ""} onChange={(e) => set({ ...p, criado_ate: e.target.value })} /></Campo>
          </div>
        </>
      )}
      {fonte === "leads" && <FiltrosComercial p={p} set={(x) => set({ ...x, fonte })} op={op} />}
      {fonte === "clientes" && <FiltrosRel p={p} set={(x) => set({ ...x, fonte })} />}
      {fonte !== "contatos" && (
        <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
          Sai pelo número do <b>Marketing</b>, nunca pelo do SDR ou do Rel. Quem está em conversa com o time nas últimas 24 h fica de fora.
        </p>
      )}
    </div>
  );
}

/** Modelo aprovado + de onde vem cada {{n}} + a bolha. */
export function ModeloEVariaveis({ aprovados, modeloNome, setModeloNome, mapa, setMapa, fonte, semBolha, emCartoes }: {
  aprovados: ModeloDisparo[]; modeloNome: string; setModeloNome: (n: string) => void;
  mapa: MapaVariaveis; setMapa: (m: MapaVariaveis) => void; fonte?: FontePublico;
  /** A prévia do WhatsApp está ao lado: não repete a bolha aqui. */
  semBolha?: boolean;
  /** Mostra os modelos como cartões clicáveis (o "TemplatePicker" do SendFlow). */
  emCartoes?: boolean;
}) {
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;
  const vars = modelo ? variaveisDoCorpo(modelo.corpo) : [];
  const fontes = FONTES_MKT.filter((f) => f.id !== "campo" || !fonte || fonte === "contatos");
  if (!aprovados.length) return <Alert tone="warn">Nenhum modelo aprovado do Marketing ainda. Aprove o modelo na Meta (WhatsApp Manager do número do Marketing) e clique em “Sincronizar modelos da Meta” — disparo em massa só sai com modelo aprovado.</Alert>;
  return (
    <div className="space-y-2">
      {emCartoes ? (
        <div role="radiogroup" aria-label="Modelo aprovado" className="grid gap-2 sm:grid-cols-2">
          {aprovados.map((m) => {
            const on = m.nome === modeloNome;
            return (
              <button key={`${m.nome}:${m.idioma}`} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) { setModeloNome(m.nome); setMapa({}); } }}
                className="rounded-xl border p-3 text-left transition-colors"
                style={on ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)", background: "var(--card)" }}>
                <span className="block text-[13px] font-semibold" style={{ color: on ? "var(--rel-ink)" : "var(--ink)" }}>{m.nome}</span>
                <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{m.categoria === "UTILITY" ? "Utilidade" : "Marketing"} · {m.idioma}</span>
                <span className="mt-0.5 block text-[12px] leading-snug line-clamp-2" style={{ color: "var(--ink3)" }}>{m.corpo}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <Campo rotulo="Modelo aprovado">
          <select className={INPUT} style={INPUT_ESTILO} value={modeloNome} onChange={(e) => { setModeloNome(e.target.value); setMapa({}); }}>
            <option value="">Escolha…</option>
            {aprovados.map((m) => <option key={`${m.nome}:${m.idioma}`} value={m.nome}>{m.nome} ({m.categoria === "UTILITY" ? "Utilidade" : "Marketing"} · {m.idioma})</option>)}
          </select>
        </Campo>
      )}
      {vars.length > 0 && <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>De onde vem cada pedaço variável do texto:</p>}
      {vars.map((v) => (
        <div key={v} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
          <span className="text-[13px] qs-num" style={{ color: "var(--muted)" }}>{`{{${v}}}`}</span>
          <select className={INPUT} style={INPUT_ESTILO} value={mapa[v]?.fonte ?? ""} onChange={(e) => setMapa({ ...mapa, [v]: { fonte: e.target.value as MapaVariaveis[string]["fonte"] } })}>
            <option value="">De onde vem?</option>
            {fontes.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
          </select>
          {["texto", "destino", "campo"].includes(mapa[v]?.fonte ?? "")
            ? <input className={INPUT} style={INPUT_ESTILO}
                     placeholder={mapa[v]?.fonte === "destino" ? "Se não achar, usar…" : mapa[v]?.fonte === "campo" ? "nome do campo (ex.: cidade)" : "Texto"}
                     value={mapa[v]?.valor ?? ""} onChange={(e) => setMapa({ ...mapa, [v]: { ...mapa[v], valor: e.target.value } })} />
            : <span />}
        </div>
      ))}
      {modelo && !semBolha && <Bolha titulo={modelo.cabecalho} texto={preverTexto(modelo.corpo, mapa)} rodape={modelo.rodape} botao={modelo.botaoParar !== false ? "Parar de receber" : null} />}
    </div>
  );
}

export const variaveisOk = (modelo: ModeloDisparo | null, mapa: MapaVariaveis) =>
  !!modelo && variaveisDoCorpo(modelo.corpo).every((v) => mapa[v] && (!["texto", "campo"].includes(mapa[v].fonte) || (mapa[v].valor ?? "").trim()));

/** Quem recebe e quem sai (e por quê), com a lista de quem recebe. */
export function CaixaPreviaMkt({ pv, carregando }: { pv: Previa | null; carregando: boolean }) {
  const [verLista, setVerLista] = useState(false);
  if (carregando) return <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Contando…</p>;
  if (!pv) return null;
  return (
    <div className="qs-card p-3 space-y-2">
      <p className="text-[14px]" style={{ color: "var(--text)" }}><b className="text-[20px] qs-num">{pv.total}</b> pessoas recebem.</p>
      {pv.excluidos.length > 0 && (
        <ul className="text-[12.5px] space-y-0.5" style={{ color: "var(--muted)" }}>
          {pv.excluidos.map((x) => <li key={x.motivo}>Saem <b className="qs-num">{x.n}</b> — {x.motivo}</li>)}
        </ul>
      )}
      {!!pv.lista?.length && (
        <>
          <button type="button" className="text-[12.5px] underline" style={{ color: "var(--muted)" }} onClick={() => setVerLista(!verLista)}>
            {verLista ? "Esconder" : "Ver"} quem recebe{pv.total > pv.lista.length ? ` (primeiros ${pv.lista.length})` : ""}
          </button>
          {verLista && (
            <ul className="max-h-[180px] overflow-y-auto text-[12.5px] columns-2" style={{ color: "var(--text)" }}>
              {pv.lista.map((a, i) => <li key={i}>{a.nome || "—"} <span style={{ color: "var(--subtle)" }}>{a.telefone}</span></li>)}
            </ul>
          )}
        </>
      )}
      {!pv.numeroOk && <Alert tone="warn">O Marketing ainda não tem número: dá pra montar e agendar, mas nada entra na fila até o admin definir o número (botão Número).</Alert>}
    </div>
  );
}
