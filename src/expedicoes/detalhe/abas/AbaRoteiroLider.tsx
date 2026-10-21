// Aba "Roteiro do Líder" (app antigo: expedicoes/[id]/roteiro-lider/ —
// RoteiroLiderEditor + DocsLiderPanel). Resumo operacional dia a dia que a
// equipe traduz pro líder; aparece na Área do Líder (/lider, que segue no app
// antigo lendo `roteiro_lider_dias` por `ordem` e depois `dia`).
// No antigo as escritas usavam service role; aqui vão direto com a sessão
// (RLS da 0160: só quem não é "só leitura" grava). Novidade: setas pra mudar a
// ordem (no antigo só dava a ordem de cadastro).
import { useCallback, useEffect, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import type { PropsAba } from "../ExpedicaoDetalhe";
import { useExp } from "../../contexto";
import { BotaoExcluir, Carregando, Gaveta } from "../../ui";
import { supabase, erroOuDados, traduzirErro } from "../../lib/banco";
import type { RoteiroLiderDiaRow } from "../../lib/database";
import { formatDate } from "../../lib/utils";
import DocsLider from "../../roteiro-lider/DocsLider";
import { IconeSvg } from "../../drive/icones";

const NIVEIS = ["", "Crítico", "Atenção", "Verificar"] as const;
const EMOJI: Record<string, string> = { Crítico: "🔴", Atenção: "🟠", Verificar: "🟡" };

type Form = {
  dia: string; data: string; fase: string; local: string; programacao: string; lideres_ativos: string; pax: string;
  observacoes: string; alerta_nivel: string; alerta_texto: string; alerta_acao: string; alerta_responsavel: string;
};
const vazio = (): Form => ({ dia: "", data: "", fase: "", local: "", programacao: "", lideres_ativos: "", pax: "", observacoes: "", alerta_nivel: "", alerta_texto: "", alerta_acao: "", alerta_responsavel: "" });
const doRow = (d: RoteiroLiderDiaRow): Form => ({
  dia: String(d.dia ?? ""), data: d.data ?? "", fase: d.fase ?? "", local: d.local ?? "", programacao: d.programacao ?? "",
  lideres_ativos: d.lideres_ativos ?? "", pax: d.pax ?? "", observacoes: d.observacoes ?? "", alerta_nivel: d.alerta_nivel ?? "",
  alerta_texto: d.alerta_texto ?? "", alerta_acao: d.alerta_acao ?? "", alerta_responsavel: d.alerta_responsavel ?? "",
});

export default function AbaRoteiroLider({ exp }: PropsAba) {
  const { somenteLeitura, avisar } = useExp();
  const [dias, setDias] = useState<RoteiroLiderDiaRow[] | null>(null);
  const [editando, setEditando] = useState<RoteiroLiderDiaRow | "novo" | null>(null);

  const carregar = useCallback(async () => {
    try {
      setDias(erroOuDados(await supabase.from("roteiro_lider_dias").select("*").eq("expedicao_id", exp.id)
        .order("ordem", { ascending: true }).order("dia", { ascending: true }).order("created_at", { ascending: true })) as RoteiroLiderDiaRow[]);
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar", "erro"); setDias([]); }
  }, [exp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [carregar]);

  async function mover(i: number, delta: -1 | 1) {
    if (!dias) return;
    const j = i + delta;
    if (j < 0 || j >= dias.length) return;
    // Regrava a ordem 0..n-1 com os dois trocados (evita empate de `ordem`).
    const nova = [...dias];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setDias(nova);
    try {
      for (const [pos, d] of nova.entries()) {
        if (d.ordem === pos) continue;
        const { error } = await supabase.from("roteiro_lider_dias").update({ ordem: pos }).eq("id", d.id);
        if (error) throw new Error(traduzirErro(error.message));
      }
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao reordenar", "erro"); }
    await carregar();
  }

  return (
    <div className="space-y-4">
      <DocsLider expedicaoId={exp.id} />

      <section>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Roteiro do Líder</h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>Resumo operacional dia a dia — o que a equipe traduz pro líder. Aparece na Área do Líder, nesta ordem.</p>
          </div>
          {!somenteLeitura && <Botao variante="primario" onClick={() => setEditando("novo")}><IconeSvg nome="mais" /> Adicionar dia</Botao>}
        </div>

        {dias === null ? <Carregando /> : dias.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>
            Nenhum dia cadastrado ainda. Clique em “Adicionar dia”.
          </div>
        ) : (
          <div className="space-y-1.5">
            {dias.map((d, i) => (
              <div key={d.id} className="group flex items-start gap-3 rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
                <div className="flex w-10 flex-shrink-0 flex-col items-center rounded-md py-1 text-white" style={{ background: "#1F2937" }}>
                  <span className="text-[8px] font-bold uppercase" style={{ color: "#FCD34D" }}>Dia</span>
                  <span className="text-[15px] font-bold leading-tight">{d.dia}</span>
                </div>
                <div className="min-w-0 flex-1">
                  {d.fase && <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{d.fase}</div>}
                  <div className="text-[13px] font-medium leading-snug whitespace-pre-line" style={{ color: "var(--ink)" }}>{d.programacao ?? "—"}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {d.data && <span>{formatDate(d.data)}</span>}
                    {d.local && <span>{d.local}</span>}
                    {d.lideres_ativos && <span>👤 {d.lideres_ativos}</span>}
                    {d.pax && <span>{d.pax} pax</span>}
                    {d.alerta_nivel && <span title={d.alerta_texto ?? undefined}>{EMOJI[d.alerta_nivel] ?? "⚠️"} {d.alerta_nivel}</span>}
                  </div>
                  {d.alerta_nivel && (d.alerta_texto || d.alerta_acao) && (
                    <div className="mt-1 text-[11.5px] rounded-md px-2 py-1" style={{ background: d.alerta_nivel === "Crítico" ? "var(--err-bg)" : "var(--warn-bg)", color: d.alerta_nivel === "Crítico" ? "var(--err-ink)" : "var(--warn-ink)" }}>
                      {d.alerta_texto}{d.alerta_acao && <> · <strong>Ação:</strong> {d.alerta_acao}</>}{d.alerta_responsavel && <> · {d.alerta_responsavel}</>}
                    </div>
                  )}
                </div>
                {!somenteLeitura && (
                  <div className="flex flex-shrink-0 items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                    <button type="button" title="Subir" aria-label="Subir" disabled={i === 0} onClick={() => void mover(i, -1)} className="p-1.5 rounded-md hover:bg-[var(--card2)] disabled:opacity-30" style={{ color: "var(--ink2)" }}>▲</button>
                    <button type="button" title="Descer" aria-label="Descer" disabled={i === dias.length - 1} onClick={() => void mover(i, 1)} className="p-1.5 rounded-md hover:bg-[var(--card2)] disabled:opacity-30" style={{ color: "var(--ink2)" }}>▼</button>
                    <button type="button" title="Editar" aria-label="Editar" onClick={() => setEditando(d)} className="p-1.5 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}><IconeSvg nome="lapis" /></button>
                    <BotaoExcluir titulo={`Excluir o Dia ${d.dia}?`} sucesso="Dia excluído" onConfirmar={async () => {
                      const { error } = await supabase.from("roteiro_lider_dias").delete().eq("id", d.id);
                      if (error) throw new Error(traduzirErro(error.message));
                      await carregar();
                    }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {editando && (
        <FormDia expedicaoId={exp.id} registro={editando === "novo" ? null : editando}
          proximaOrdem={(dias ?? []).reduce((m, d) => Math.max(m, d.ordem + 1), 0)}
          proximoDia={(dias ?? []).reduce((m, d) => Math.max(m, d.dia), 0) + 1}
          onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await carregar(); }} />
      )}
    </div>
  );
}

function FormDia({ expedicaoId, registro, proximaOrdem, proximoDia, onFechar, onSalvo }: {
  expedicaoId: string; registro: RoteiroLiderDiaRow | null; proximaOrdem: number; proximoDia: number; onFechar: () => void; onSalvo: () => void;
}) {
  const { avisar } = useExp();
  const [f, setF] = useState<Form>(() => registro ? doRow(registro) : { ...vazio(), dia: String(proximoDia) });
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof Form, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function salvar() {
    if (!f.programacao.trim() && !f.dia.trim()) { avisar("Preencha ao menos o dia e a programação", "erro"); return; }
    const nn = (s: string) => (s.trim() === "" ? null : s.trim());
    const semAlerta = !f.alerta_nivel;
    const valores = {
      dia: f.dia.trim() === "" ? 1 : parseInt(f.dia, 10) || 1,
      data: nn(f.data), fase: nn(f.fase), local: nn(f.local), programacao: nn(f.programacao),
      lideres_ativos: nn(f.lideres_ativos), pax: nn(f.pax), observacoes: nn(f.observacoes),
      alerta_nivel: nn(f.alerta_nivel),
      // Sem nível = sem alerta: limpa os textos (no antigo ficavam gravados escondidos).
      alerta_texto: semAlerta ? null : nn(f.alerta_texto), alerta_acao: semAlerta ? null : nn(f.alerta_acao),
      alerta_responsavel: semAlerta ? null : nn(f.alerta_responsavel),
    };
    setSalvando(true);
    const { error } = registro
      ? await supabase.from("roteiro_lider_dias").update(valores).eq("id", registro.id)
      : await supabase.from("roteiro_lider_dias").insert({ expedicao_id: expedicaoId, ordem: proximaOrdem, ...valores });
    setSalvando(false);
    if (error) { avisar(traduzirErro(error.message), "erro"); return; }
    avisar(registro ? "Dia atualizado" : "Dia adicionado");
    onSalvo();
  }

  const area = (k: keyof Form, ph?: string, linhas = 2) => (
    <textarea className="rel-input" rows={linhas} value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
  );

  return (
    <Gaveta aberta titulo={registro ? `Editar Dia ${registro.dia}` : "Novo dia"} subtitulo="Aparece na Área do Líder." onFechar={onFechar} largura={480}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Dia"><Entrada inputMode="numeric" value={f.dia} placeholder="1" onChange={(e) => set("dia", e.target.value)} /></Campo>
          <Campo rotulo="Data"><Entrada type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></Campo>
        </div>
        <Campo rotulo="Fase / região"><Entrada value={f.fase} placeholder="TÓQUIO" onChange={(e) => set("fase", e.target.value)} /></Campo>
        <Campo rotulo="Programação">{area("programacao", "O que o grupo faz no dia", 3)}</Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Local"><Entrada value={f.local} placeholder="Cidade" onChange={(e) => set("local", e.target.value)} /></Campo>
          <Campo rotulo="Pax" dica='Aceita "18 → 25"'><Entrada value={f.pax} placeholder="24" onChange={(e) => set("pax", e.target.value)} /></Campo>
        </div>
        <Campo rotulo="Líderes ativos" dica="Separe os nomes por ·"><Entrada value={f.lideres_ativos} placeholder="Everton · Jacqueline · Beatriz" onChange={(e) => set("lideres_ativos", e.target.value)} /></Campo>
        <Campo rotulo="Observações">{area("observacoes")}</Campo>

        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--line)" }}>
          <div className="text-[12px] font-bold" style={{ color: "var(--ink)" }}>Alerta operacional (opcional)</div>
          <Campo rotulo="Nível">
            <select className="rel-input" value={f.alerta_nivel} onChange={(e) => set("alerta_nivel", e.target.value)}>
              {NIVEIS.map((n) => <option key={n} value={n}>{n === "" ? "— sem alerta —" : `${EMOJI[n]} ${n}`}</option>)}
            </select>
          </Campo>
          {f.alerta_nivel && (
            <>
              <Campo rotulo="Descrição do alerta">{area("alerta_texto")}</Campo>
              <Campo rotulo="Ação necessária">{area("alerta_acao")}</Campo>
              <Campo rotulo="Responsável"><Entrada value={f.alerta_responsavel} placeholder="Operações + DMC" onChange={(e) => set("alerta_responsavel", e.target.value)} /></Campo>
            </>
          )}
        </div>
      </div>
    </Gaveta>
  );
}
