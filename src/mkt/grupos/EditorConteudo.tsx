// src/mkt/grupos/EditorConteudo.tsx — o miolo comum do compositor (campanha, passo da
// cadência, recorrência): tipo de conteúdo, mídia, mensagem/pergunta, enquete,
// "Mencionar todos" e o intervalo entre grupos. Mesmos textos do SendFlow.
import type { Conteudo, TipoMsg } from "./lib";
import { temMidia } from "./datas";
import { Campo, CampoArquivo, EditorEnquete, Escolha, LinhaChave, TIPOS, cor } from "./pecas";

export function EditorConteudo({ valor, onChange, erros = {}, linhasTexto = 5, semIntervalo }: {
  valor: Conteudo; onChange: (v: Conteudo) => void; erros?: Record<string, string>; linhasTexto?: number; semIntervalo?: boolean;
}) {
  const set = (p: Partial<Conteudo>) => onChange({ ...valor, ...p });
  const escolherTipo = (t: TipoMsg) => set({
    tipo: t,
    ...(temMidia(t) ? {} : { midia_url: null, midia_nome: null }),
    ...(t === "enquete" && !valor.enquete_opcoes?.length ? { enquete_opcoes: ["", ""] } : {}),
  });
  const enquete = valor.tipo === "enquete";
  return (
    <>
      <Campo rotulo="Tipo de conteúdo">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {TIPOS.map((t) => <Escolha key={t.v} ativo={valor.tipo === t.v} onClick={() => escolherTipo(t.v)}>{t.r}</Escolha>)}
        </div>
      </Campo>

      {temMidia(valor.tipo) && (
        <Campo rotulo="Mídia" erro={erros.midia}>
          <CampoArquivo tipo={valor.tipo} url={valor.midia_url} nome={valor.midia_nome} onSubiu={(r) => set({ midia_url: r.url, midia_nome: r.nome })} />
        </Campo>
      )}

      <Campo rotulo={enquete ? "Pergunta" : temMidia(valor.tipo) ? "Legenda" : "Mensagem"}
        dica={enquete ? "· aparece em cima das opções" : temMidia(valor.tipo) ? "· opcional" : "· *negrito*, _itálico_ e ~riscado~ como no WhatsApp"} erro={erros.texto}>
        <textarea className="rel-input resize-y leading-relaxed" rows={enquete ? 2 : linhasTexto} maxLength={4096} value={valor.texto}
          placeholder={enquete ? "Qual o melhor horário para a live?" : "Bom dia, pessoal! ☀️ …"} onChange={(e) => set({ texto: e.target.value })} />
        <div className="mt-1 text-right text-[11px] tabular-nums" style={{ color: cor.ink3 }}>{valor.texto.length}/4096</div>
      </Campo>

      {enquete && (
        <EditorEnquete opcoes={valor.enquete_opcoes ?? ["", ""]} onOpcoes={(o) => set({ enquete_opcoes: o })}
          multipla={valor.enquete_multipla} onMultipla={(v) => set({ enquete_multipla: v })} erro={erros.enquete} />
      )}

      <Campo>
        <LinhaChave titulo="Mencionar todos" texto="marca @todos os participantes de cada grupo (todo mundo recebe notificação)"
          ligada={valor.mencionar_todos} onChange={(v) => set({ mencionar_todos: v })} />
      </Campo>

      {!semIntervalo && (
        <details className="mb-5 rounded-xl px-3.5 py-3" style={{ border: "1px solid var(--line)", background: cor.card2 }}>
          <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: cor.ink2 }}>
            Intervalo entre um grupo e outro <span className="font-normal" style={{ color: cor.ink3 }}>· {valor.intervalo_min_seg != null || valor.intervalo_max_seg != null ? `${valor.intervalo_min_seg ?? "?"}–${valor.intervalo_max_seg ?? "?"}s` : "o padrão do chip"}</span>
          </summary>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: cor.ink2 }}>
            de
            <input type="number" min={5} className="rel-input" style={{ width: 90 }} value={valor.intervalo_min_seg ?? ""} placeholder="20" aria-label="Intervalo mínimo"
              onChange={(e) => set({ intervalo_min_seg: e.target.value ? Number(e.target.value) : null })} />
            a
            <input type="number" min={5} className="rel-input" style={{ width: 90 }} value={valor.intervalo_max_seg ?? ""} placeholder="45" aria-label="Intervalo máximo"
              onChange={(e) => set({ intervalo_max_seg: e.target.value ? Number(e.target.value) : null })} />
            segundos. Vazio = o padrão do chip. Menos de 5 s não passa (anti-bloqueio).
          </div>
        </details>
      )}
    </>
  );
}
