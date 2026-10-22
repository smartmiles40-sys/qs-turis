// src/rel/viagens/BarraLote.tsx
// -----------------------------------------------------------------------------
// AÇÕES EM LOTE NA LISTA DE VIAGENS (0184, 22/10/2026). As filas de arrumação
// estavam grandes demais pra ir uma por uma (195 pra classificar, 424 sem data):
//
//   Classificar → marca várias e escolhe o serviço de uma vez
//   Sem data    → (gestão) "marcar as sugeridas" = venda há mais de 12 meses ou
//                 sem data de venda; arquiva com MOTIVO; aparece "Desfazer"
//   Arquivadas  → (gestão) desarquivar as marcadas
//   Sem dono / Próximas / Em viagem → (gestão) atribuir as marcadas a alguém
//
// Nada roda sozinho: o time escolhe, confere e confirma.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { ACOMPANHAMENTOS, SERVICOS, acompanhamentoDe, type FiltroViagens, type Servico, type Viagem } from "../lib/viagens";
import { arquivarViagens, atribuirViagens, classificarEmLote, desarquivarViagens, sugeridaParaArquivar } from "../lib/operacao";
import { Aviso, Botao, Entrada } from "../ui";

const ORDEM: Servico[] = ["pacote", "aereo", "cruzeiro", "hospedagem", "passeio", "expedicao", "seguro", "concierge", "conta_liminar", "outro"];
const MOTIVO_PADRAO = "Venda antiga sem data de embarque (não vai acontecer / já aconteceu)";

export default function BarraLote({ filtro, lista, sel, setSel, gestor, equipe, onMudou }: {
  filtro: FiltroViagens; lista: Viagem[]; sel: Set<string>; setSel: (s: Set<string>) => void; gestor: boolean;
  equipe: { id: string; name: string }[]; onMudou: () => void;
}) {
  const [servico, setServico] = useState<Servico | "">("");
  const [pessoa, setPessoa] = useState("");
  const [motivo, setMotivo] = useState(MOTIVO_PADRAO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // último arquivamento feito aqui — dá pra desfazer o lote inteiro
  const [ultimoLote, setUltimoLote] = useState<{ lote: string; n: number } | null>(null);

  const ids = [...sel];
  const sugeridas = filtro === "sem_data" ? lista.filter((v) => sugeridaParaArquivar(v)) : [];

  async function rodar(fn: () => Promise<string>) {
    setOcupado(true); setErro(null); setOk(null);
    try { setOk(await fn()); setSel(new Set()); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  const classificar = () => rodar(async () => {
    const n = await classificarEmLote(ids, servico as Servico);
    return `${n} venda${n === 1 ? "" : "s"} classificada${n === 1 ? "" : "s"} como ${SERVICOS[servico as Servico]}.`;
  });
  const atribuir = () => rodar(async () => {
    const n = await atribuirViagens(ids, pessoa);
    return `${n} viage${n === 1 ? "m" : "ns"} agora com ${equipe.find((u) => u.id === pessoa)?.name ?? "a pessoa escolhida"}.`;
  });
  const arquivar = () => {
    if (motivo.trim().length < 3) { setErro("Escreva o motivo."); return; }
    if (!window.confirm(`Arquivar ${ids.length} viage${ids.length === 1 ? "m" : "ns"}?\n\nMotivo: ${motivo.trim()}\n\nElas saem das filas. Dá pra desfazer logo depois ou pela lista "Arquivadas".`)) return;
    void rodar(async () => {
      const n = ids.length;
      const lote = await arquivarViagens(ids, motivo.trim());
      if (lote) setUltimoLote({ lote, n });
      return lote ? `${n} viage${n === 1 ? "m" : "ns"} arquivada${n === 1 ? "" : "s"}.` : "Nenhuma foi arquivada (já não estavam ativas).";
    });
  };
  const desfazerLote = () => ultimoLote && rodar(async () => {
    const n = await desarquivarViagens({ lote: ultimoLote.lote });
    setUltimoLote(null);
    return `Desfeito: ${n} viage${n === 1 ? "m" : "ns"} de volta.`;
  });
  const desarquivar = () => rodar(async () => {
    const n = await desarquivarViagens({ ids });
    return `${n} viage${n === 1 ? "m" : "ns"} desarquivada${n === 1 ? "" : "s"}.`;
  });

  const podeAtribuir = gestor && (filtro === "sem_dono" || filtro === "proximas" || filtro === "em_viagem" || filtro === "minhas");
  const temAcao = filtro === "classificar" || (gestor && (filtro === "sem_data" || filtro === "arquivadas")) || podeAtribuir;
  if (!temAcao && !ok && !ultimoLote) return null;

  return (
    <div className="space-y-2 mb-3">
      {ultimoLote && (
        <div className="rel-card px-3 py-2 flex flex-wrap items-center gap-3" style={{ borderColor: "#16A34A" }} role="status">
          <span className="text-[13px] flex-1" style={{ color: "var(--ink)" }}>{ultimoLote.n} arquivada{ultimoLote.n === 1 ? "" : "s"} agora há pouco.</span>
          <Botao disabled={ocupado} onClick={() => void desfazerLote()}>Desfazer arquivamento</Botao>
        </div>
      )}
      {ok && !ultimoLote && <Aviso tom="ok">{ok}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {temAcao && (
        <div className="rel-card px-3 py-2.5 flex flex-wrap items-center gap-2 sticky top-16 z-10" style={sel.size ? { borderColor: "var(--rel)" } : undefined}>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" className="w-4 h-4" style={{ accentColor: "var(--rel)" }}
              checked={lista.length > 0 && sel.size === lista.length}
              onChange={(e) => setSel(e.target.checked ? new Set(lista.map((v) => v.id)) : new Set())} />
            {sel.size ? `${sel.size} marcada${sel.size === 1 ? "" : "s"}` : "Marcar todas"}
          </label>

          {filtro === "sem_data" && gestor && sugeridas.length > 0 && (
            <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setSel(new Set(sugeridas.map((v) => v.id)))}
              title="Venda há mais de 12 meses ou sem data de venda">
              Marcar as sugeridas ({sugeridas.length})
            </Botao>
          )}

          <span className="flex-1" />

          {filtro === "classificar" && (
            <>
              <select className="rel-input" style={{ width: "auto", padding: "5px 8px", fontSize: 13 }} value={servico} onChange={(e) => setServico(e.target.value as Servico | "")} aria-label="Serviço">
                <option value="">o que foi vendido…</option>
                {ORDEM.map((s) => <option key={s} value={s}>{SERVICOS[s]} — {ACOMPANHAMENTOS[acompanhamentoDe(s)]}</option>)}
              </select>
              <Botao variante="primario" disabled={!sel.size || !servico || ocupado} onClick={() => void classificar()}>Classificar {sel.size || ""}</Botao>
            </>
          )}

          {filtro === "sem_data" && gestor && (
            <>
              <span style={{ width: 300, maxWidth: "100%" }}><Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo do arquivamento" placeholder="Motivo" /></span>
              <Botao variante="perigo" disabled={!sel.size || ocupado} onClick={arquivar}>Arquivar {sel.size || ""}</Botao>
            </>
          )}

          {filtro === "arquivadas" && gestor && (
            <Botao variante="primario" disabled={!sel.size || ocupado} onClick={() => void desarquivar()}>Desarquivar {sel.size || ""}</Botao>
          )}

          {podeAtribuir && (
            <>
              <select className="rel-input" style={{ width: "auto", padding: "5px 8px", fontSize: 13 }} value={pessoa} onChange={(e) => setPessoa(e.target.value)} aria-label="Atribuir a">
                <option value="">atribuir a…</option>
                {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <Botao variante="primario" disabled={!sel.size || !pessoa || ocupado} onClick={() => void atribuir()}>Atribuir {sel.size || ""}</Botao>
            </>
          )}
        </div>
      )}
    </div>
  );
}
