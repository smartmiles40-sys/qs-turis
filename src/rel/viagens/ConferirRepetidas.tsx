// src/rel/viagens/ConferirRepetidas.tsx
// -----------------------------------------------------------------------------
// CONFERIR VIAGENS REPETIDAS (0134a, 14/10/2026).
//
// O cruzamento com o sistema de Expedições marcou algumas viagens com
// "CONFERIR: possível viagem repetida": o cliente já tinha vendas do Bitrix
// SEM DATA, que podem ser a mesma expedição. Aqui a marcada fica ao lado das
// candidatas (mesmo cliente, sem data ou com embarque perto) e a gestora decide:
//   • "É a mesma viagem" → tudo da candidata passa pra marcada e a candidata
//     fica cancelada como "juntada" (rel_viagens_juntar — nada é apagado);
//   • "Nenhuma é a mesma" → tira a marca (rel_viagens_diferentes).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { moeda } from "../lib/clientes";
import { TIPOS_VIAGEM, periodo, type TipoViagem } from "../lib/viagens";
import { Aviso, Botao, Etiqueta, Vazio } from "../ui";

const MARCA = "CONFERIR: possível viagem repetida";
/** Embarques a até 45 dias um do outro ainda podem ser a mesma viagem. */
const PERTO_DIAS = 45;

interface V {
  id: string;
  cliente_id: string | null;
  titulo: string;
  destino: string | null;
  expedicao: string | null;
  tipo: TipoViagem;
  data_venda: string | null;
  data_embarque: string | null;
  data_retorno: string | null;
  valor: number | null;
  origem: string | null;
  bitrix_deal_id: string | null;
  bitrix_funil: string | null;
  expedicoes_id: string | null;
  observacoes: string | null;
  status: string;
}
interface Par { marcada: V; candidatas: V[]; cliente: string }

const COLS = "id, cliente_id, titulo, destino, expedicao, tipo, data_venda, data_embarque, data_retorno, valor, origem, bitrix_deal_id, bitrix_funil, expedicoes_id, observacoes, status";
const dias = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

async function carregar(): Promise<{ pares: Par[]; pax: Record<string, number>; trechos: Record<string, number> }> {
  const { data: marcadas, error } = await supabase.from("rel_viagens").select(COLS)
    .ilike("observacoes", `%${MARCA}%`).is("mesclada_em_id", null).neq("status", "cancelada").order("data_embarque");
  if (error) throw error;
  const ms = (marcadas ?? []) as V[];
  const clientes = [...new Set(ms.map((m) => m.cliente_id).filter(Boolean))] as string[];
  if (!clientes.length) return { pares: [], pax: {}, trechos: {} };
  const [outras, nomes] = await Promise.all([
    supabase.from("rel_viagens").select(COLS).in("cliente_id", clientes).eq("status", "ativa").is("mesclada_em_id", null).limit(1000),
    supabase.from("rel_clientes").select("id, nome").in("id", clientes),
  ]);
  if (outras.error) throw outras.error;
  const nomeDe = new Map(((nomes.data ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));
  const pares: Par[] = ms.map((m) => ({
    marcada: m,
    cliente: nomeDe.get(m.cliente_id ?? "") ?? "Cliente",
    candidatas: ((outras.data ?? []) as V[])
      .filter((c) => c.id !== m.id && c.cliente_id === m.cliente_id
        && (!c.data_embarque || !m.data_embarque || dias(c.data_embarque, m.data_embarque) <= PERTO_DIAS))
      // Expedição primeiro (é o mais provável de ser a mesma), depois o resto.
      .sort((a, b) => Number(b.tipo === "expedicao") - Number(a.tipo === "expedicao") || (b.valor ?? 0) - (a.valor ?? 0)),
  }));
  const ids = [...new Set(pares.flatMap((p) => [p.marcada.id, ...p.candidatas.map((c) => c.id)]))];
  const [pax, tr] = await Promise.all([
    supabase.from("rel_viagem_passageiros").select("viagem_id").in("viagem_id", ids).limit(5000),
    supabase.from("rel_viagem_trechos").select("viagem_id").in("viagem_id", ids).limit(5000),
  ]);
  const contar = (l: { viagem_id: string }[] | null) => (l ?? []).reduce<Record<string, number>>((acc, x) => { acc[x.viagem_id] = (acc[x.viagem_id] ?? 0) + 1; return acc; }, {});
  return { pares, pax: contar(pax.data as never), trechos: contar(tr.data as never) };
}

function Ficha({ v, pax, trechos, destaque }: { v: V; pax: number; trechos: number; destaque?: boolean }) {
  const origem = v.origem === "expedicoes" ? "sistema de Expedições" : v.origem === "bitrix" ? "Bitrix" : v.origem || "manual";
  return (
    <div className="rel-card p-3 space-y-1 text-[12.5px] h-full" style={{ color: "var(--ink2)", ...(destaque ? { borderColor: "var(--warn-line)" } : {}) }}>
      <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{v.titulo}</p>
      <p className="flex flex-wrap gap-1.5">
        <Etiqueta>{TIPOS_VIAGEM[v.tipo] ?? v.tipo}</Etiqueta>
        <Etiqueta tom={v.origem === "expedicoes" ? "rel" : "neutro"}>{origem}</Etiqueta>
      </p>
      <p>Embarque: <b>{periodo(v)}</b>{v.data_venda ? ` · venda ${v.data_venda.split("-").reverse().join("/")}` : ""}</p>
      <p>Valor: <b>{v.valor != null ? moeda(v.valor) : "—"}</b> · {pax} passageiro(s) · {trechos} trecho(s)</p>
      <p style={{ color: "var(--ink3)" }}>
        {v.bitrix_deal_id ? `Bitrix #${v.bitrix_deal_id}${v.bitrix_funil ? ` (${v.bitrix_funil})` : ""}` : "Sem negócio no Bitrix"}
        {v.expedicao && v.expedicao !== v.titulo ? ` · ${v.expedicao}` : ""}
      </p>
    </div>
  );
}

export default function ConferirRepetidas({ onAbrirViagem }: { onAbrirViagem: (id: string) => void }) {
  const { currentUser } = useQsAuth();
  const pode = podeGerirRelacionamento(currentUser);
  const [dados, setDados] = useState<Awaited<ReturnType<typeof carregar>> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null); // `${marcada}|${candidata}`
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(() => {
    carregar().then((d) => { setDados(d); setErro(null); })
      .catch((e) => { setErro(e instanceof Error ? e.message : "Não carregou."); setDados({ pares: [], pax: {}, trechos: {} }); });
  }, []);
  useEffect(() => { recarregar(); }, [recarregar]);

  async function rodar(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const { error } = await fn();
      if (error) throw new Error(error.message);
      setAviso(ok); setConfirmar(null); recarregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  if (!dados) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        Viagens que o cruzamento com o sistema de Expedições achou que podem estar repetidas: o cliente já tinha uma venda do Bitrix sem data.
        Compare e diga se é a mesma viagem. {pode ? "" : "Só a gestora do Relacionamento (ou admin) pode decidir."}
      </p>
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {dados.pares.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nada pra conferir" texto="Nenhuma viagem marcada como possível repetida. 🎉" /></div>
      ) : dados.pares.map(({ marcada: m, candidatas, cliente }) => (
        <section key={m.id} className="rel-card p-3 space-y-3" aria-label={`Conferir ${m.titulo}`}>
          <h2 className="flex flex-wrap items-center gap-2 text-[14px] font-bold" style={{ color: "var(--ink)" }}>
            {cliente}
            <span className="text-[12px] font-normal" style={{ color: "var(--ink3)" }}>{candidatas.length} candidata(s)</span>
            <button className="ml-auto text-[12.5px] underline font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirViagem(m.id)}>Abrir a viagem marcada</button>
          </h2>
          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink3)" }}>A marcada (fica)</p>
              <Ficha v={m} pax={dados.pax[m.id] ?? 0} trechos={dados.trechos[m.id] ?? 0} destaque />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Pode ser a mesma que…</p>
              {candidatas.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma venda sem data (ou com embarque perto) desse cliente — provavelmente não é repetida.</p>}
              {candidatas.map((c) => {
                const chave = `${m.id}|${c.id}`;
                return (
                  <div key={c.id} className="space-y-1.5">
                    <Ficha v={c} pax={dados.pax[c.id] ?? 0} trechos={dados.trechos[c.id] ?? 0} />
                    {pode && (confirmar === chave ? (
                      <div className="flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
                        <span>Passageiros, trechos, documentos e o negócio do Bitrix dela passam pra marcada; ela fica cancelada como “juntada”.</span>
                        <Botao variante="primario" disabled={ocupado}
                          onClick={() => void rodar(() => supabase.rpc("rel_viagens_juntar", { p_manter: m.id, p_remover: c.id }), `Juntado: "${c.titulo}" agora faz parte de "${m.titulo}".`)}>
                          {ocupado ? "Juntando…" : "Confirmar: é a mesma"}
                        </Botao>
                        <Botao variante="fantasma" onClick={() => setConfirmar(null)}>Voltar</Botao>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Botao onClick={() => setConfirmar(chave)} disabled={ocupado}>É a mesma viagem</Botao>
                        <button className="text-[12.5px] underline" style={{ color: "var(--ink3)" }} onClick={() => onAbrirViagem(c.id)}>abrir</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {pode && (
            <div className="flex justify-end">
              <Botao variante="fantasma" disabled={ocupado}
                onClick={() => void rodar(() => supabase.rpc("rel_viagens_diferentes", { p_viagem: m.id }), `"${m.titulo}" conferida: não é repetida.`)}>
                Nenhuma é a mesma — são viagens diferentes
              </Botao>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
