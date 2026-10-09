// src/rel/pos/RecompraPage.tsx
// -----------------------------------------------------------------------------
// PRONTOS PARA A PRÓXIMA VIAGEM. Clientes que voltaram há 30–400 dias e não têm
// outra viagem marcada. A ordem é a do bom senso comercial:
//   1. amou (nota 9–10) e já disse pra onde quer ir
//   2. amou (9–10)
//   3. não respondeu a pesquisa
//   4. neutro (7–8)
// Detrator (0–6) fica separado em "Cuidar antes de oferecer": oferecer viagem
// pra quem saiu insatisfeito antes de ouvir o motivo é o caminho mais curto
// pra perder o cliente de vez.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { candidatosRecompra, type CandidatoRecompra } from "../lib/pos";
import { formatarTelefone } from "../lib/clientes";
import { Aviso, Avatar, Etiqueta, Vazio } from "../ui";
import RecompraBotao from "./RecompraBotao";

const ROTULO_PRIORIDADE: Record<number, { t: string; tom: "rel" | "neutro" | "aviso" | "erro" }> = {
  0: { t: "Amou e sabe pra onde quer ir", tom: "rel" },
  1: { t: "Amou a viagem", tom: "rel" },
  2: { t: "Sem pesquisa", tom: "neutro" },
  3: { t: "Neutro", tom: "neutro" },
  9: { t: "Insatisfeito", tom: "erro" },
};

function Linha({ c, onAbrirCliente, onCriada }: { c: CandidatoRecompra; onAbrirCliente: (id: string) => void; onCriada: () => void }) {
  const r = ROTULO_PRIORIDADE[c.prioridade];
  const ultimaRecompra = c.recompras[0];
  return (
    <li className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderTop: "1px solid var(--line2)" }}>
      <Avatar nome={c.nome} />
      <button className="flex-1 min-w-[200px] text-left" onClick={() => onAbrirCliente(c.cliente_id)}>
        <span className="block text-sm font-semibold" style={{ color: "var(--ink)" }}>{c.nome}</span>
        <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
          {c.ultima_viagem.titulo} · voltou há {c.dias_desde_volta} dias{c.telefone ? ` · ${formatarTelefone(c.telefone)}` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 mt-1">
          <Etiqueta tom={r.tom}>{r.t}{c.nota != null ? ` · ${c.nota}/10` : ""}</Etiqueta>
          {c.proximo_destino && <Etiqueta tom="rel">✈ quer ir para {c.proximo_destino}</Etiqueta>}
          {ultimaRecompra && (
            <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
              oportunidade já criada em {new Date(ultimaRecompra.criado_em).toLocaleDateString("pt-BR")}
            </span>
          )}
        </span>
      </button>
      <RecompraBotao clienteId={c.cliente_id} viagemId={c.ultima_viagem.id} sugestao={c.proximo_destino} compacto onCriada={onCriada} />
    </li>
  );
}

export default function RecompraPage({ onAbrirCliente }: { onAbrirCliente: (id: string) => void }) {
  const [lista, setLista] = useState<CandidatoRecompra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    candidatosRecompra().then((l) => { setLista(l); setErro(null); })
      .catch((e) => { setErro(e instanceof Error ? e.message : "Não consegui carregar."); setLista([]); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const prontos = (lista ?? []).filter((c) => c.prioridade < 9);
  const cuidar = (lista ?? []).filter((c) => c.prioridade === 9);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Recompra</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Quem voltou de viagem há 30 dias a pouco mais de um ano e ainda não tem a próxima marcada.
          Criar a oportunidade manda o cliente para o Comercial.
        </p>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <section className="rel-card overflow-hidden">
        <h2 className="px-4 pt-4 pb-2 text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>
          Prontos para a próxima viagem {lista && `(${prontos.length})`}
        </h2>
        {lista === null ? (
          <p className="px-4 pb-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : prontos.length === 0 ? (
          <Vazio titulo="Ninguém na janela agora" texto="Aparecem aqui os clientes 30 dias depois de voltar de viagem." />
        ) : (
          <ul>{prontos.map((c) => <Linha key={c.cliente_id} c={c} onAbrirCliente={onAbrirCliente} onCriada={carregar} />)}</ul>
        )}
      </section>

      {cuidar.length > 0 && (
        <section className="rel-card overflow-hidden" style={{ borderColor: "var(--err-line)" }}>
          <h2 className="px-4 pt-4 pb-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--err-ink)" }}>
            Cuidar antes de oferecer ({cuidar.length})
          </h2>
          <p className="px-4 pb-2 text-[12px]" style={{ color: "var(--ink3)" }}>
            Deram nota de 0 a 6. Vale uma conversa pra entender o que deu errado antes de qualquer oferta.
          </p>
          <ul>{cuidar.map((c) => <Linha key={c.cliente_id} c={c} onAbrirCliente={onAbrirCliente} onCriada={carregar} />)}</ul>
        </section>
      )}
    </div>
  );
}
