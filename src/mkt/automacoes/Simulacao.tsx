// src/mkt/automacoes/Simulacao.tsx
// O "Simular": mostra, passo a passo, o que o fluxo MANDARIA — sem mandar nada.
// O servidor roda o mesmo simulador puro do motor (api/_mktRegras.js simularFluxo).
// Onde o fluxo para esperando clique/resposta, dá para escolher a saída e seguir.
import { useEffect, useState } from "react";
import { notifyError } from "@/lib/qs/notify";
import { ROTULO_TIPO, saidasDoNo, type Grafo } from "./tipos";
import { acao } from "./api";
import { Botao, Chip, COR_SUAVE, Modal } from "./ui";

export interface PassoSimulado { noId: string; tipo: string; titulo: string | null; enviar: Record<string, any>[]; saida: string | null; nota: string | null }
export interface ResultadoSimulacao { passos: PassoSimulado[]; fim: string; erro?: boolean; pessoa?: { tags?: string[]; campos?: Record<string, unknown> } }

/** Um corpo da Cloud API em texto legível (o que a pessoa veria). */
export function textoDoCorpo(c: Record<string, any>): { texto: string; botoes: string[]; extra?: string } {
  switch (c?.type) {
    case "text": return { texto: c.text?.body ?? "", botoes: [] };
    case "image": case "video": case "audio": case "document": {
      const m = c[c.type] ?? {};
      return { texto: m.caption ?? "", botoes: [], extra: `[${c.type}] ${m.link ?? ""}` };
    }
    case "interactive": {
      const i = c.interactive ?? {};
      const botoes = i.type === "button" ? (i.action?.buttons ?? []).map((b: any) => b.reply?.title ?? "")
        : i.type === "list" ? [`☰ ${i.action?.button ?? "Opções"}`, ...(i.action?.sections ?? []).flatMap((s: any) => (s.rows ?? []).map((r: any) => `• ${r.title}`))]
        : i.type === "cta_url" ? [`🔗 ${i.action?.parameters?.display_text ?? "Abrir"}`] : [];
      return { texto: [i.header?.text, i.body?.text, i.footer?.text].filter(Boolean).join("\n\n"), botoes };
    }
    case "template": return { texto: `Modelo "${c.template?.name}" (${c.template?.language?.code ?? ""})`, botoes: [], extra: (c.params ?? []).length ? `variáveis: ${(c.params as string[]).join(" | ")}` : undefined };
    default: return { texto: JSON.stringify(c), botoes: [] };
  }
}

export default function Simulacao({ resultado, grafo, onFechar }: { resultado: ResultadoSimulacao | null; grafo: Grafo; onFechar: () => void }) {
  const [r, setR] = useState<ResultadoSimulacao | null>(resultado);
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [janela, setJanela] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setR(resultado); setRespostas({}); setJanela(true); }, [resultado]);

  async function refazer(novas: Record<string, string>, comJanela = janela) {
    setOcupado(true);
    try { setR(await acao<ResultadoSimulacao>({ acao: "simular", grafo, respostas: novas, janela: comJanela })); setRespostas(novas); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não consegui simular."); }
    finally { setOcupado(false); }
  }

  if (!resultado || !r) return null;
  const ultimo = r.passos[r.passos.length - 1];
  const parado = r.fim === "esperando a resposta da pessoa" && ultimo;
  const noParado = parado ? grafo.nos.find((n) => n.id === ultimo.noId) : null;

  return (
    <Modal aberto titulo="Simulação (nada foi enviado)" onFechar={onFechar} largura={600}
      rodape={<>
        <label className="mr-auto flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={janela} onChange={(e) => { setJanela(e.target.checked); void refazer(respostas, e.target.checked); }} />
          Janela de 24 h aberta
        </label>
        {Object.keys(respostas).length > 0 && <Botao onClick={() => void refazer({})} disabled={ocupado}>Recomeçar</Botao>}
        <Botao variante="primario" onClick={onFechar}>Fechar</Botao>
      </>}>
      <ol className="space-y-3">
        {r.passos.map((p, i) => (
          <li key={`${p.noId}-${i}`} className="text-[13px]">
            <div className="flex items-center gap-2 mb-1">
              <Chip>{ROTULO_TIPO[p.tipo as keyof typeof ROTULO_TIPO] ?? p.tipo}</Chip>
              {p.titulo && <strong style={{ color: "var(--ink)" }}>{p.titulo}</strong>}
              {p.saida && <span className="text-[11.5px] ml-auto" style={{ color: "var(--ink3)" }}>→ saída “{p.saida}”</span>}
            </div>
            {p.enviar.map((c, j) => {
              const t = textoDoCorpo(c);
              return (
                <div key={j} className="ml-2 mt-1 rounded-xl px-3 py-2 max-w-[440px] whitespace-pre-wrap" style={{ background: "#DCF8C6", color: "#111" }}>
                  {t.extra && <div className="text-[11.5px] opacity-70 break-all">{t.extra}</div>}
                  {t.texto}
                  {t.botoes.length > 0 && <div className="mt-2 flex flex-col gap-1">{t.botoes.map((b, k) => <span key={k} className="text-center rounded-lg bg-white/80 py-1 text-[12.5px] font-semibold" style={{ color: "#0B7A5A" }}>{b}</span>)}</div>}
                </div>
              );
            })}
            {p.nota && <div className="ml-2 mt-1 text-[12px]" style={{ color: "var(--ink3)" }}>{p.nota}</div>}
          </li>
        ))}
      </ol>
      <div className="mt-4 rounded-lg px-3 py-2 text-[12.5px]" style={{ background: r.erro ? "var(--err-bg, #FEF2F2)" : COR_SUAVE, color: r.erro ? "var(--err-ink, #B91C1C)" : "var(--ink)" }}>
        <b>Fim da simulação:</b> {r.fim}
        {(r.pessoa?.tags?.length ?? 0) > 0 && <div className="mt-1">Tags ao final: {r.pessoa?.tags?.join(", ")}</div>}
      </div>
      {noParado && (
        <div className="mt-3">
          <div className="text-[12.5px] mb-1.5" style={{ color: "var(--ink2)" }}>A pessoa responderia…</div>
          <div className="flex flex-wrap gap-1.5">
            {saidasDoNo(noParado).filter((s) => s.id !== "janela_fechada").map((s) => (
              <Botao key={s.id} disabled={ocupado} onClick={() => void refazer({ ...respostas, [noParado.id]: s.id })}>{s.rotulo}</Botao>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
