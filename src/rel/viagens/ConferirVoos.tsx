// src/rel/viagens/ConferirVoos.tsx
// -----------------------------------------------------------------------------
// CONFERIR VOOS (0154, 20/10/2026). Bruno: "tem voos que estão com toda certeza
// errados [...] queria colocar de uma forma que podemos corrigir pra dar como
// concluído".
//
// A fila (rel_voos_a_conferir) traz a viagem ativa cujo voo não bate com as
// datas da venda: voo de OUTRA viagem (card antigo do Pós-Venda, outra edição),
// ou ida/volta que não casam (expedição ligada à turma errada, volta estendida).
// Pra cada uma, o time:
//   • Apaga o voo errado — ele não volta na sincronização do Bitrix;
//   • Edita o voo (data/hora certa);
//   • "Usar as datas dos voos" — a venda passa a ter as datas dos voos e fica
//     travada (o Bitrix não volta com as antigas);
//   • "Está certo" — conclui a conferência. Só volta pra fila se entrar voo novo.
//
// Mora em Viagens → "Conferir voos" (a fila toda) e no topo do roteiro da
// viagem (só aquela, quando estiver na fila).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TIPOS_TRECHO, trechosDasViagens, type Trecho } from "../lib/viagens";
import { diaBR, diaLocal, horaLocal } from "../lib/problemas";
import { Aviso, Botao, Etiqueta, Vazio } from "../ui";
import { EditarTrecho } from "./TrechosViagem";

type Motivo = "fora" | "ida" | "volta";
interface Item { viagem_id: string; motivos: Motivo[]; ida_voo: string | null; volta_voo: string | null }
interface V { id: string; titulo: string; expedicao: string | null; cliente_nome: string | null; data_embarque: string | null; data_retorno: string | null }

const MOTIVO: Record<Motivo, string> = {
  fora: "Voo fora das datas (de outra viagem?)",
  ida: "Ida não bate com a venda",
  volta: "Volta não bate com a venda",
};
const FONTE: Record<string, string> = { bitrix: "Bitrix (Pós-Venda)", expedicoes: "Sistema de Expedições", ia: "Lido pela IA", manual: "Cadastrado à mão" };
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ehVoo = (t: Trecho) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";

async function carregar(viagemId?: string) {
  const { data, error } = await supabase.rpc("rel_voos_a_conferir_lista", viagemId ? { p_viagem: viagemId } : {});
  if (error) throw error;
  const itens = (data ?? []) as Item[];
  const ids = itens.map((i) => i.viagem_id);
  if (!ids.length) return { itens, viagens: new Map<string, V>(), voos: new Map<string, Trecho[]>() };
  const viagens = new Map<string, V>();
  for (let i = 0; i < ids.length; i += 150) {
    const r = await supabase.from("rel_viagens_v").select("id,titulo,expedicao,cliente_nome,data_embarque,data_retorno").in("id", ids.slice(i, i + 150));
    if (r.error) throw r.error;
    for (const v of (r.data ?? []) as V[]) viagens.set(v.id, v);
  }
  const voos = new Map<string, Trecho[]>();
  for (const t of await trechosDasViagens(ids)) if (ehVoo(t)) voos.set(t.viagem_id, [...(voos.get(t.viagem_id) ?? []), t]);
  itens.sort((a, b) => (viagens.get(a.viagem_id)?.data_embarque ?? "9").localeCompare(viagens.get(b.viagem_id)?.data_embarque ?? "9"));
  return { itens, viagens, voos };
}

function Cartao({ item, v, voos, sozinho, onAbrirViagem, onMudou }: {
  item: Item; v: V; voos: Trecho[]; sozinho: boolean; onAbrirViagem?: (id: string) => void; onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmarApagar, setConfirmarApagar] = useState<string | null>(null);
  const [editando, setEditando] = useState<Trecho | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ini = v.data_embarque, fim = v.data_retorno ?? v.data_embarque;

  async function rodar(chave: string, f: () => PromiseLike<{ error: unknown }>) {
    setOcupado(chave); setErro(null);
    try {
      const { error } = await f();
      if (error) throw error;
      onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Não deu certo."); }
    finally { setOcupado(null); setConfirmarApagar(null); }
  }

  const podeUsarDatas = item.ida_voo && (item.motivos.includes("ida") || item.motivos.includes("volta"))
    && (item.ida_voo !== v.data_embarque || (item.volta_voo && item.volta_voo !== v.data_retorno));

  return (
    <article className={sozinho ? "rounded-xl p-3 space-y-2" : "rel-card p-3 sm:p-4 space-y-2"}
      style={sozinho ? { border: "1px solid var(--warn-line)", background: "var(--warn-bg)" } : undefined}>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {sozinho
          ? <p className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Voos a conferir</p>
          : <button className="text-[14px] font-bold underline-offset-2 hover:underline text-left" style={{ color: "var(--ink)" }} onClick={() => onAbrirViagem?.(v.id)}>
              {v.cliente_nome ?? "Sem cliente"} <span className="font-semibold" style={{ color: "var(--ink2)" }}>· {v.titulo}</span>
            </button>}
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
          venda {diaBR(v.data_embarque)}{v.data_retorno ? ` → ${diaBR(v.data_retorno)}` : ""}
          {item.ida_voo ? ` · voos ${diaBR(item.ida_voo)}${item.volta_voo && item.volta_voo !== item.ida_voo ? ` → ${diaBR(item.volta_voo)}` : ""}` : ""}
        </span>
        <span className="flex flex-wrap gap-1">{item.motivos.map((m) => <Etiqueta key={m} tom={m === "fora" ? "erro" : "aviso"}>{MOTIVO[m]}</Etiqueta>)}</span>
      </header>

      <ul className="space-y-1">
        {voos.map((t) => {
          const dia = diaLocal(t.partida_em, t.fonte === "bitrix" ? null : t.partida_fuso);
          const fora = !!(ini && fim && dia && (dia < somaDias(ini, -10) || dia > somaDias(fim, 60)));
          const rota = [t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ");
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-[12.5px]"
              style={{ background: fora ? "var(--err-bg)" : "var(--card2)", color: "var(--ink2)" }}>
              <b className="tabular-nums" style={{ color: fora ? "var(--err-ink)" : "var(--ink)" }}>
                {dia ? `${diaBR(dia)}/${dia.slice(2, 4)}` : "sem data"}{t.fonte !== "bitrix" ? ` ${horaLocal(t.partida_em, t.partida_fuso)}` : ""}
              </b>
              <span>{TIPOS_TRECHO[t.tipo]}</span>
              <span className="min-w-0 truncate" style={{ color: "var(--ink)" }}>{rota || <i style={{ color: "var(--ink3)" }}>sem rota</i>}</span>
              {(t.companhia || t.numero) && <span>{[t.companhia, t.numero].filter(Boolean).join(" ")}</span>}
              <span style={{ color: "var(--ink3)" }}>· {FONTE[t.fonte ?? "manual"] ?? t.fonte}</span>
              {fora && <span className="font-semibold" style={{ color: "var(--err-ink)" }}>· fora das datas</span>}
              <span className="ml-auto flex gap-1">
                <Botao variante="fantasma" onClick={() => setEditando(t)} disabled={!!ocupado}>Editar</Botao>
                {confirmarApagar === t.id
                  ? <Botao variante="perigo" onClick={() => void rodar(t.id, () => supabase.rpc("rel_voo_descartar", { p_trecho: t.id }))} disabled={!!ocupado}>
                      {ocupado === t.id ? "Apagando…" : "Confirmar: apagar"}
                    </Botao>
                  : <Botao variante="fantasma" onClick={() => setConfirmarApagar(t.id)} disabled={!!ocupado} style={{ color: "var(--err-ink)" }}>Apagar</Botao>}
              </span>
            </li>
          );
        })}
      </ul>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <footer className="flex flex-wrap items-center gap-2 pt-1">
        <Botao variante="primario" disabled={!!ocupado} onClick={() => void rodar("ok", () => supabase.rpc("rel_voos_conferir", { p_viagem: v.id }))}>
          {ocupado === "ok" ? "Salvando…" : "✓ Está certo — concluir"}
        </Botao>
        {podeUsarDatas && (
          <Botao disabled={!!ocupado} onClick={() => void rodar("datas", () => supabase.rpc("rel_viagem_datas_pelos_voos", { p_viagem: v.id }))}
            title="A venda passa a ter as datas dos voos e fica travada: o Bitrix não volta com as antigas">
            {ocupado === "datas" ? "Ajustando…" : `Usar as datas dos voos (${diaBR(item.ida_voo)}${item.volta_voo ? ` → ${diaBR(item.volta_voo)}` : ""})`}
          </Botao>
        )}
        {!sozinho && onAbrirViagem && <Botao variante="fantasma" onClick={() => onAbrirViagem(v.id)}>Abrir viagem</Botao>}
        <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Apagar tira o voo de vez — a sincronização do Bitrix não traz de novo.</span>
      </footer>

      <EditarTrecho aberto={!!editando} viagemId={v.id} trecho={editando}
        onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); onMudou(); }} />
    </article>
  );
}

/** A fila toda (sem `viagemId`) ou só a viagem aberta (com `viagemId` — some se não estiver na fila). */
export default function ConferirVoos({ viagemId, onAbrirViagem, onMudou }: { viagemId?: string; onAbrirViagem?: (id: string) => void; onMudou?: () => void }) {
  const [dados, setDados] = useState<Awaited<ReturnType<typeof carregar>> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(() => { setVersao((x) => x + 1); onMudou?.(); }, [onMudou]);
  useEffect(() => {
    let vivo = true;
    carregar(viagemId).then((d) => { if (vivo) { setDados(d); setErro(null); } }).catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : "Não carregou."); });
    return () => { vivo = false; };
  }, [viagemId, versao]);

  if (viagemId) {
    const item = dados?.itens[0];
    const v = item && dados.viagens.get(item.viagem_id);
    if (!item || !v) return null;
    return <div className="mb-3"><Cartao item={item} v={v} voos={dados.voos.get(v.id) ?? []} sozinho onMudou={recarregar} /></div>;
  }

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!dados) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div className="space-y-3 max-w-5xl mx-auto">
      <Aviso>
        Viagens (que ainda não voltaram) com voo que não bate com as datas da venda. Apague o voo errado, corrija a data,
        ou ajuste a venda pelas datas dos voos — e clique em <b>Está certo</b> pra concluir. {dados.itens.length} pra conferir.
      </Aviso>
      {dados.itens.length === 0
        ? <div className="rel-card"><Vazio titulo="Nenhum voo pra conferir" texto="Tudo bate com as datas das vendas." /></div>
        : dados.itens.map((it) => {
            const v = dados.viagens.get(it.viagem_id);
            return v ? <Cartao key={it.viagem_id} item={it} v={v} voos={dados.voos.get(v.id) ?? []} sozinho={false} onAbrirViagem={onAbrirViagem} onMudou={recarregar} /> : null;
          })}
    </div>
  );
}
