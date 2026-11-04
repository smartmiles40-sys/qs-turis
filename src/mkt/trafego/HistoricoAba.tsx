// src/mkt/trafego/HistoricoAba.tsx — tudo que as travas e os alertas fizeram (0265).
// Quem (robô ou pessoa), qual trava, o valor medido, antes/depois. Campanha que
// o QS pausou ganha o botão "Reativar" — manual, com confirmação.
import { useState } from "react";
import { Botao, Vazio } from "@/rel/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useMkt } from "../contexto";
import { useTrafego } from "./MetaAdsPage";
import { reativarCampanha } from "./api";
import type { Acao, Metrica } from "./tipos";
import { dataHora } from "./ui";
import { descreverValor } from "./TravasAba";

const TIPO: Record<Acao["tipo"], { rotulo: string; bg: string; cor: string }> = {
  pausa: { rotulo: "Pausou", bg: "var(--err-bg)", cor: "var(--err-ink)" },
  pausaria: { rotulo: "Pausaria (simulação)", bg: "var(--warn-bg)", cor: "var(--warn-ink)" },
  aviso: { rotulo: "Aviso", bg: "var(--card2)", cor: "var(--ink2)" },
  alerta: { rotulo: "Alerta", bg: "var(--warn-bg)", cor: "var(--warn-ink)" },
  reativacao: { rotulo: "Reativou", bg: "var(--rel-soft)", cor: "var(--rel-ink)" },
  erro: { rotulo: "Erro", bg: "var(--err-bg)", cor: "var(--err-ink)" },
};

export default function HistoricoAba() {
  const { painel, recarregar } = useTrafego();
  const { nomeDe } = useMkt();
  const [filtro, setFiltro] = useState<"tudo" | "acoes">("tudo");
  const [reativando, setReativando] = useState<number | null>(null);
  if (!painel || painel.faltaBanco) return null;
  const acoes = (painel.acoes ?? []).filter((a) => filtro === "tudo" || ["pausa", "pausaria", "reativacao", "erro"].includes(a.tipo));
  const todas = painel.acoes ?? [];

  const jaReativada = (a: Acao) => todas.some((x) => x.tipo === "reativacao" && x.alvo_id === a.alvo_id && Date.parse(x.criado_em) > Date.parse(a.criado_em));
  const campanhaAtiva = (a: Acao) => painel.campanhas?.find((c) => c.id === a.alvo_id)?.effective_status === "ACTIVE";

  async function reativar(a: Acao) {
    if (!confirm(`Reativar "${a.alvo_nome}" na Meta?\n\nEla volta a gastar agora. Até o fim do dia as travas só AVISAM sobre ela (não pausam de novo).`)) return;
    setReativando(a.id);
    try { await reativarCampanha(a.id); notifySuccess("Campanha reativada."); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não reativou."); }
    finally { setReativando(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      <select className="rel-input max-w-[260px]" value={filtro} onChange={(e) => setFiltro(e.target.value as "tudo" | "acoes")} aria-label="Filtro">
        <option value="tudo">Tudo (avisos, alertas e ações)</option>
        <option value="acoes">Só pausas, simulações e reativações</option>
      </select>
      {acoes.length === 0 ? <div className="rel-card"><Vazio titulo="Nada registrado ainda" texto="Quando uma trava avisar, pausar (ou pausaria, na simulação) ou um alerta disparar, aparece aqui." /></div> : (
        <ul className="flex flex-col gap-2">
          {acoes.map((a) => {
            const t = TIPO[a.tipo];
            return (
              <li key={a.id} className="rel-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink3)" }}>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: t.bg, color: t.cor }}>{t.rotulo}</span>
                      {dataHora(a.criado_em)} · {a.quem ? nomeDe(a.quem) : "robô do QS"}
                    </p>
                    <p className="mt-1 text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>
                      {a.regra_nome ? `Trava "${a.regra_nome}"` : "Alerta"}{a.alvo_nome ? ` · ${a.alvo_nome}` : ""}
                    </p>
                    {a.detalhe && <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: "var(--ink2)" }}>{a.detalhe}</p>}
                    {a.metrica && a.limite != null && (
                      <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink3)" }}>
                        Medido {descreverValor(a.metrica as Metrica, a.valor_medido)} · limite {descreverValor(a.metrica as Metrica, Number(a.limite))}
                        {a.antes ? ` · antes ${JSON.stringify(a.antes)}` : ""}{a.depois ? ` · depois ${JSON.stringify(a.depois)}` : ""}
                      </p>
                    )}
                  </div>
                  {a.tipo === "pausa" && painel.podeEditar && !jaReativada(a) && !campanhaAtiva(a) && (
                    <Botao variante="secundario" disabled={reativando === a.id} onClick={() => void reativar(a)}>{reativando === a.id ? "Reativando…" : "Reativar"}</Botao>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
