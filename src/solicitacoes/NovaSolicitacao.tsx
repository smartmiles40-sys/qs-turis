// src/solicitacoes/NovaSolicitacao.tsx
// -----------------------------------------------------------------------------
// "Pedir a outro setor" (0149). Escolhe o setor, o tipo (o prazo vem dele, em
// horas úteis — dá pra trocar), escreve o que precisa e pronto: vira um cartão
// numerado na fila do outro setor. Aberto de dentro de uma viagem, ficha, lead
// ou conversa, já vai ligado a ela.
//
// 0150 (Bruno 20/10): todo pedido amarra o CLIENTE (fica na ficha dele) e, se
// tiver, a VENDA. Sem cliente só se marcar "não é de cliente".
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import {
  COR_SETOR, NOME_SETOR, PRIORIDADE_SOL, SETORES, criarSolicitacao, deInputLocal, listarTipos,
  type AlvoSol, type PrioridadeSol, type Setor, type TipoSol,
} from "./lib";

export default function NovaSolicitacao({ aberto, deSetor, alvo, paraInicial, onFechar, onCriada }: {
  aberto: boolean;
  /** Setor de quem pede (a área em que a pessoa está). */
  deSetor: Setor;
  alvo?: AlvoSol;
  paraInicial?: Setor;
  onFechar: () => void;
  onCriada: (id: string) => void;
}) {
  const destinos = SETORES.filter((s) => s !== deSetor);
  const [tipos, setTipos] = useState<TipoSol[]>([]);
  const [para, setPara] = useState<Setor>(paraInicial && paraInicial !== deSetor ? paraInicial : destinos.includes("operacional") ? "operacional" : destinos[0]);
  const [tipo, setTipo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<PrioridadeSol>("normal");
  const [outroPrazo, setOutroPrazo] = useState(false);
  const [prazo, setPrazo] = useState("");
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [semCliente, setSemCliente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(""); setDescricao(""); setPrioridade("normal"); setOutroPrazo(false); setPrazo(""); setErro(null); setSemCliente(false);
    setEscolha(alvo?.clienteId ? { clienteId: alvo.clienteId, clienteNome: (alvo.sobre ?? "").split(" · ")[0] || "Cliente", viagemId: alvo.viagemId ?? null, vendaTexto: null } : null);
    setPara(paraInicial && paraInicial !== deSetor ? paraInicial : destinos.includes("operacional") ? "operacional" : destinos[0]);
    listarTipos().then(setTipos).catch(() => setTipos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const doSetor = useMemo(() => tipos.filter((t) => t.setor === para && t.ativo), [tipos, para]);
  useEffect(() => { setTipo(doSetor[0]?.id ?? ""); }, [doSetor]);
  const tipoSel = doSetor.find((t) => t.id === tipo);

  async function enviar() {
    if (!tipo) { setErro("Escolha o tipo do pedido."); return; }
    if (!titulo.trim()) { setErro("Escreva em uma linha o que você precisa."); return; }
    if (outroPrazo && !prazo) { setErro("Escolha o prazo (ou use o padrão)."); return; }
    if (!escolha && !semCliente && !alvo?.leadId) { setErro("Escolha o cliente do pedido (ou marque que não é de cliente)."); return; }
    setEnviando(true); setErro(null);
    try {
      const id = await criarSolicitacao({
        de: deSetor, para, tipo, titulo: titulo.trim(), descricao: descricao.trim(), prioridade,
        prazo: outroPrazo ? deInputLocal(prazo) : null, ...(alvo ?? {}),
        clienteId: escolha?.clienteId ?? null,
        viagemId: escolha?.viagemId ?? null,
        // com cliente, o banco monta "Fulana · Venda"; sem, vale o nome do lead/conversa
        sobre: escolha ? null : alvo?.sobre ?? null,
      });
      onCriada(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    finally { setEnviando(false); }
  }

  return (
    <Modal aberto={aberto} titulo="Pedir a outro setor" onFechar={onFechar} largura={560}
      rodape={<><Botao onClick={onFechar} disabled={enviando}>Cancelar</Botao><Botao variante="primario" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Enviando…" : `Enviar pra ${NOME_SETOR[para]}`}</Botao></>}>
      <div className="space-y-4">
        <Campo rotulo="Pra qual setor">
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Setor que recebe">
            {destinos.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={para === s} onClick={() => setPara(s)}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold border flex items-center justify-center gap-2"
                style={para === s ? { borderColor: COR_SETOR[s], background: `${COR_SETOR[s]}14`, color: "var(--ink)" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: COR_SETOR[s] }} aria-hidden />{NOME_SETOR[s]}
              </button>
            ))}
          </div>
        </Campo>

        <Campo rotulo="Tipo do pedido" dica={tipoSel ? `Prazo padrão: ${tipoSel.prazo_horas}h úteis (seg–sex, 9h–18h).` : undefined}>
          <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {doSetor.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
          </select>
        </Campo>

        <div className="rel-card p-3 space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Cliente e venda <span style={{ color: "var(--ink3)", fontWeight: 400 }}>— o pedido fica na ficha do cliente</span></p>
          {alvo?.leadId && !escolha && (
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Vai ligado ao lead <b style={{ color: "var(--ink2)" }}>{alvo.sobre}</b>. Se ele já é cliente, escolha abaixo pra ficar na ficha também.</p>
          )}
          {semCliente ? (
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Pedido interno, sem cliente. <button type="button" className="underline" onClick={() => setSemCliente(false)}>escolher cliente</button></p>
          ) : (
            <EscolherClienteVenda valor={escolha} onMudar={setEscolha} travarCliente={!!alvo?.clienteId}
              buscaInicial={alvo?.leadId ? (alvo.sobre ?? "") : ""} />
          )}
          {!escolha && !semCliente && !alvo?.leadId && (
            <label className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>
              <input type="checkbox" checked={semCliente} onChange={(e) => setSemCliente(e.target.checked)} /> Não é de cliente (pedido interno)
            </label>
          )}
        </div>

        <Campo rotulo="O que você precisa (uma linha)" dica="Ex.: cotar aéreo GRU–Lisboa 12/03 a 26/03 pra 2 adultos.">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} autoFocus />
        </Campo>

        <Campo rotulo="Detalhes (opcional)" dica="Tudo que o outro setor precisa pra não ter que te perguntar.">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} maxLength={4000} className="rel-input" />
        </Campo>

        <div className="flex flex-wrap items-end gap-4">
          <Campo rotulo="Prioridade">
            <div className="flex gap-1.5" role="radiogroup" aria-label="Prioridade">
              {(Object.entries(PRIORIDADE_SOL) as [PrioridadeSol, string][]).map(([k, r]) => (
                <button key={k} type="button" role="radio" aria-checked={prioridade === k} onClick={() => setPrioridade(k)}
                  className="rounded-full px-3 h-8 text-[12.5px] border"
                  style={prioridade === k ? { background: k === "urgente" ? "var(--err-bg)" : "var(--rel-soft)", color: k === "urgente" ? "var(--err-ink)" : "var(--rel-ink)", borderColor: "transparent", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
              ))}
            </div>
          </Campo>
          <label className="flex items-center gap-2 text-[13px] pb-1.5" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" checked={outroPrazo} onChange={(e) => setOutroPrazo(e.target.checked)} /> Preciso pra uma data certa
          </label>
          {outroPrazo && (
            <Campo rotulo="Prazo">
              <input type="datetime-local" className="rel-input" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </Campo>
          )}
        </div>

        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
