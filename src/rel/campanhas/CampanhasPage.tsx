// src/rel/campanhas/CampanhasPage.tsx
// -----------------------------------------------------------------------------
// CAMPANHAS (V2, 30/10/2026) — a porta única de "falar com a base toda".
//
// Bruno, 30/10: Disparos e remarketing, Automações, Pesquisas e Recompra
// estavam escondidos no "Mais ▸" e "ninguém vai usar". Viraram UM item do menu
// que abre esta página com 4 cartões grandes, cada um com um número vivo.
//
// Os números são contagens baratas (head + count, uma consulta cada) e só são
// lidos quando a página abre. Se uma falhar, o cartão mostra "–" e continua
// abrindo a tela; nada aqui grava no banco.
// -----------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { Icon } from "@/components/ui/icons";

type Destino = "disparos" | "automacoes" | "pesquisas" | "recompra";

interface Numero { valor: number | null; legenda: string; extra?: string }

const DIA = 86_400_000;
const diaISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function contar(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try { const r = await q; return r.error ? null : r.count ?? 0; } catch { return null; }
}

async function lerNumeros(): Promise<Record<Destino, Numero>> {
  const agora = Date.now();
  const desde90 = new Date(agora - 90 * DIA).toISOString();
  const [enviando, rascunho, autoAtivas, respondidas, semResposta, voltaram] = await Promise.all([
    contar(supabase.from("qs_disparo_campanhas").select("id", { count: "exact", head: true }).eq("setor", "relacionamento").eq("status", "enviando")),
    contar(supabase.from("qs_disparo_campanhas").select("id", { count: "exact", head: true }).eq("setor", "relacionamento").eq("status", "rascunho")),
    contar(supabase.from("rel_automacoes").select("id", { count: "exact", head: true }).eq("ativo", true)),
    contar(supabase.from("rel_pesquisas").select("id", { count: "exact", head: true }).gte("respondida_em", desde90)),
    contar(supabase.from("rel_pesquisas").select("id", { count: "exact", head: true }).is("respondida_em", null).gte("criado_em", desde90)),
    // Mesma janela da tela Recompra (voltaram há 30 a 400 dias); lá ainda tira quem já tem outra viagem.
    contar(supabase.from("rel_viagens").select("id", { count: "exact", head: true }).eq("status", "ativa")
      .gte("data_retorno", diaISO(agora - 400 * DIA)).lte("data_retorno", diaISO(agora - 30 * DIA))),
  ]);
  return {
    disparos: { valor: enviando, legenda: enviando === 1 ? "campanha enviando agora" : "campanhas enviando agora", extra: rascunho ? `${rascunho} em rascunho` : undefined },
    automacoes: { valor: autoAtivas, legenda: autoAtivas === 1 ? "automação ligada" : "automações ligadas" },
    pesquisas: { valor: respondidas, legenda: "respostas nos últimos 90 dias", extra: semResposta ? `${semResposta} esperando resposta` : undefined },
    recompra: { valor: voltaram, legenda: "viagens voltaram de 1 a 13 meses atrás", extra: "quem ainda não tem a próxima marcada" },
  };
}

const CARTOES: { id: Destino; titulo: string; texto: string; icone: ReactNode }[] = [
  { id: "disparos", titulo: "Disparos e remarketing", icone: Icon.disparo,
    texto: "Uma mensagem pra muita gente de uma vez: quem viajou, quem está sem viagem futura, o link do grupo." },
  { id: "automacoes", titulo: "Automações", icone: Icon.cadencia,
    texto: "Mensagens que saem sozinhas na data certa: aniversário, véspera do embarque, volta da viagem." },
  { id: "pesquisas", titulo: "Pesquisas", icone: Icon.pesquisa,
    texto: "A nota de quem voltou. Quem amou vira indicação; quem não gostou, a gente cuida antes de oferecer." },
  { id: "recompra", titulo: "Recompra", icone: Icon.recompra,
    texto: "Quem voltou e está pronto pra próxima. Um clique vira cartão no Pipeline de vendas." },
];

export default function CampanhasPage({ ir }: { ir: (destino: Destino) => void }) {
  const [n, setN] = useState<Record<Destino, Numero> | null>(null);
  useEffect(() => {
    let vivo = true;
    void lerNumeros().then((r) => { if (vivo) setN(r); });
    return () => { vivo = false; };
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Campanhas</h1>
        <p className="text-[13px] mt-1" style={{ color: "var(--ink2)" }}>
          Falar com a base toda e trazer o cliente de volta. Escolha por onde começar.
        </p>
      </header>
      <div className="grid sm:grid-cols-2 gap-4">
        {CARTOES.map((c) => {
          const num = n?.[c.id];
          return (
            <button key={c.id} type="button" onClick={() => ir(c.id)}
              className="rel-card p-5 text-left transition-shadow hover:shadow-md flex flex-col gap-3 min-h-[180px]">
              <span className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl [&>svg]:w-5 [&>svg]:h-5"
                  style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{c.icone}</span>
                <span className="text-[16px] font-bold flex-1" style={{ color: "var(--ink)" }}>{c.titulo}</span>
                <span className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }} aria-hidden>Abrir →</span>
              </span>
              <span className="text-[13px] leading-snug" style={{ color: "var(--ink2)" }}>{c.texto}</span>
              <span className="mt-auto flex items-baseline gap-2 flex-wrap" aria-live="polite">
                <span className="text-3xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>{n === null ? "…" : num?.valor ?? "–"}</span>
                <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{num?.legenda ?? ""}</span>
              </span>
              {num?.extra && <span className="text-[12px] -mt-2" style={{ color: "var(--ink3)" }}>{num.extra}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
