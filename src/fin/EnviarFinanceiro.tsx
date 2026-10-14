// src/fin/EnviarFinanceiro.tsx
// -----------------------------------------------------------------------------
// "ENVIAR AO FINANCEIRO" + o STATUS que quem mandou acompanha (0127, 14/10).
//
// Uma peça só pras três áreas que mandam cliente (Comercial, Relacionamento,
// Operações): escolhe o motivo, conta o caso em uma frase e pronto — vira um
// atendimento numerado na fila do Financeiro. Se veio de uma conversa do
// WhatsApp, a conversa passa junto (o cliente continua no mesmo número).
//
// Fora do Relacionamento (Comercial, Operações) as cores da área não existem —
// envolva com <ComCoresDoRel> pra não ficar sem cor nem vazar CSS.
//
// Exemplo pra Operações (a tela ainda não existe):
//   const [enviar, setEnviar] = useState(false);
//   <ComCoresDoRel>
//     <button onClick={() => setEnviar(true)}>💰 Enviar ao Financeiro</button>
//     <StatusNoFinanceiro alvo={{ clienteId }} compacto />
//     <EnviarFinanceiroModal aberto={enviar} origem="operacional"
//       alvo={{ clienteId, telefone }} nome={nomeDoCliente}
//       onFechar={() => setEnviar(false)} onEnviado={() => setEnviar(false)} />
//   </ComCoresDoRel>
// -----------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from "react";
import { Aviso, Botao, Campo, Etiqueta, Modal } from "../rel/ui";
import {
  MOTIVO_FIN, PRIORIDADE_FIN, STATUS_FIN, TOM_STATUS, atendimentosDe, enviarAoFinanceiro, haQuanto,
  type AtendimentoFin, type MotivoFin, type OrigemFin, type PrioridadeFin,
} from "./lib/atendimentos";

export function EnviarFinanceiroModal({ aberto, origem, alvo, nome, onFechar, onEnviado }: {
  aberto: boolean;
  origem: OrigemFin;
  /** Quem é o cliente: pelo menos um. */
  alvo: { clienteId?: string | null; leadId?: string | null; conversaId?: string | null; telefone?: string | null };
  nome?: string | null;
  onFechar: () => void;
  onEnviado: (id: string) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoFin>("duvida");
  const [prioridade, setPrioridade] = useState<PrioridadeFin>("normal");
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) { setMotivo("duvida"); setPrioridade("normal"); setDescricao(""); setErro(null); } }, [aberto]);

  async function enviar() {
    if (!descricao.trim()) { setErro("Conte em uma frase o que o cliente precisa — o Financeiro começa por aí."); return; }
    setEnviando(true); setErro(null);
    try {
      const id = await enviarAoFinanceiro({ origem, motivo, prioridade, descricao: descricao.trim(), nome: nome ?? null, ...alvo });
      onEnviado(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    finally { setEnviando(false); }
  }

  return (
    <Modal aberto={aberto} titulo={`Enviar ao Financeiro${nome ? ` · ${nome}` : ""}`} onFechar={onFechar} largura={520}
      rodape={<><Botao onClick={onFechar} disabled={enviando}>Cancelar</Botao><Botao variante="primario" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Enviando…" : "Enviar ao Financeiro"}</Botao></>}>
      <div className="space-y-4">
        <Campo rotulo="Motivo">
          <div className="grid sm:grid-cols-2 gap-1.5" role="radiogroup" aria-label="Motivo">
            {(Object.entries(MOTIVO_FIN) as [MotivoFin, string][]).map(([k, r]) => (
              <button key={k} role="radio" aria-checked={motivo === k} onClick={() => setMotivo(k)}
                className="rounded-lg px-3 py-2 text-[13px] text-left border"
                style={motivo === k ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
        </Campo>
        <Campo rotulo="O que o cliente precisa" dica="Ex.: quer a 2ª via do boleto de novembro; diz que pagou o Pix e não foi baixado.">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} autoFocus maxLength={1000}
            className="w-full rounded-lg px-3 py-2 text-[14px] border" style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink)" }} />
        </Campo>
        <Campo rotulo="Prioridade">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Prioridade">
            {(Object.entries(PRIORIDADE_FIN) as [PrioridadeFin, string][]).map(([k, r]) => (
              <button key={k} role="radio" aria-checked={prioridade === k} onClick={() => setPrioridade(k)}
                className="rounded-full px-3 h-8 text-[12.5px] border"
                style={prioridade === k ? { background: k === "urgente" ? "var(--err-bg)" : "var(--rel-soft)", color: k === "urgente" ? "var(--err-ink)" : "var(--rel-ink)", borderColor: "transparent", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
            ))}
          </div>
        </Campo>
        {alvo.conversaId && <Aviso>A conversa do WhatsApp vai junto: ela sai da fila do Relacionamento e o Financeiro responde por ela. O cliente não troca de número.</Aviso>}
        {!alvo.conversaId && <Aviso>O Financeiro chama o cliente pelo WhatsApp do Relacionamento. Se ele ainda não falou com esse número, a 1ª mensagem é um modelo aprovado.</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

/**
 * O status no Financeiro, pra quem mandou acompanhar (ficha, lead, conversa).
 * Mostra só os abertos + o último resolvido; some se não houver nada.
 */
export function StatusNoFinanceiro({ alvo, recarregar = 0, compacto }: {
  alvo: { clienteId?: string | null; leadId?: string | null; conversaId?: string | null };
  recarregar?: number;
  compacto?: boolean;
}) {
  const [lista, setLista] = useState<AtendimentoFin[]>([]);
  const chave = `${alvo.clienteId}|${alvo.leadId}|${alvo.conversaId}|${recarregar}`;
  useEffect(() => {
    let vivo = true;
    atendimentosDe(alvo).then((l) => { if (vivo) setLista(l); }).catch(() => undefined);
    const t = setInterval(() => { if (!document.hidden) atendimentosDe(alvo).then((l) => { if (vivo) setLista(l); }).catch(() => undefined); }, 30_000);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const abertos = lista.filter((a) => a.status !== "resolvido" && a.status !== "cancelado");
  const mostrar = abertos.length ? abertos : lista.slice(0, 1);
  if (!mostrar.length) return null;
  return (
    <div className={compacto ? "flex flex-wrap gap-1.5 items-center" : "rel-card p-3 space-y-2"}>
      {!compacto && <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>No Financeiro</p>}
      {mostrar.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink2)" }}
          title={a.descricao}>
          <span aria-hidden>💰</span>
          <b style={{ color: "var(--ink)" }}>#{a.numero}</b>
          <span>{MOTIVO_FIN[a.motivo]}</span>
          <Etiqueta tom={TOM_STATUS[a.status]}>{STATUS_FIN[a.status]}</Etiqueta>
          {a.responsavel_nome && <span>· com {a.responsavel_nome.split(" ")[0]}</span>}
          <span style={{ color: "var(--ink3)" }}>· {haQuanto(a.atualizado_em)}</span>
          {a.resolucao && a.status === "resolvido" && <span className="w-full" style={{ color: "var(--ink3)" }}>Solução: {a.resolucao}</span>}
        </div>
      ))}
    </div>
  );
}

// Só as cores da área do Relacionamento (--rel*), presas a este pedaço da tela.
// O REL_CSS inteiro mexe no :root (foco, --ink3) — não pode entrar no Comercial.
const CORES_REL = `
.cores-rel { --rel: #0E7C6A; --rel-hover: #0B6B5C; --rel-ink: #0B6B5C; --rel-soft: #E4F4EF; }
html.dark .cores-rel { --rel-ink: #3CCFB3; --rel-soft: rgba(43, 192, 166, .14); }
.cores-rel .rel-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
.cores-rel .rel-linha:hover { background: var(--card2); }
`;

/** Envolve o botão/selo/modal do Financeiro fora da área do Relacionamento. */
export function ComCoresDoRel({ children }: { children: ReactNode }) {
  return (
    <div className="cores-rel contents">
      <style>{CORES_REL}</style>
      {children}
    </div>
  );
}
