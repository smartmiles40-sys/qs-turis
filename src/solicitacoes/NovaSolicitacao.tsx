// src/solicitacoes/NovaSolicitacao.tsx
// -----------------------------------------------------------------------------
// "Pedir a outro setor" (0149). Escolhe o setor, o tipo (o prazo vem dele, em
// horas úteis — dá pra trocar), escreve o que precisa e pronto: vira um cartão
// numerado na fila do outro setor. Aberto de dentro de uma viagem, ficha, lead
// ou conversa, já vai ligado a ela.
//
// 0150 (Bruno 20/10): todo pedido amarra o CLIENTE (fica na ficha dele) e, se
// tiver, a VENDA. Sem cliente só se marcar "não é de cliente".
//
// 0158 (Bruno 21/10): tipo com formulário de COTAÇÃO (Operações → Cotação)
// troca "o que você precisa" pelo formulário completo (FormCotacao).
//
// 0201 (Bruno 22/10): tipos de PAGAMENTO ao Financeiro (Pix, link, cartão,
// provisão) trocam pelo formulário do pagamento (FormPagamento) e a amarração
// vira "cliente/venda · expedição · não é de cliente (para que é)".
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import FormCotacaoCampos, { EscolherPrioridade, textoHoras } from "./FormCotacao";
import FormPagamentoCampos, { EscolherArquivos, VinculoPagamento } from "./FormPagamento";
import { cotacaoVazia, descricaoDaCotacao, faltaNaCotacao, tituloDaCotacao, type FormCotacao } from "./cotacao";
import {
  TIPO_PAG_DO, anexarArquivo, descricaoDoPagamento, faltaNoPagamento, pagamentoVazio, paraBanco, tituloDoPagamento, type FormPagamento,
} from "./pagamento";
import {
  COR_SETOR, NOME_SETOR, SETORES, horasDoTipo, criarSolicitacao, deInputLocal, listarTipos,
  type AlvoSol, type PrioridadeSol, type Setor, type TipoSol,
} from "./lib";

export default function NovaSolicitacao({ aberto, deSetor, alvo, paraInicial, soPagamento, onFechar, onCriada }: {
  aberto: boolean;
  /** Setor de quem pede (a área em que a pessoa está). */
  deSetor: Setor;
  alvo?: AlvoSol;
  paraInicial?: Setor;
  /** Atalho "Pedir pagamento": só o Financeiro e só os 4 tipos de pagamento. */
  soPagamento?: boolean;
  onFechar: () => void;
  onCriada: (id: string) => void;
}) {
  const destinos = soPagamento ? (["financeiro"] as Setor[]) : SETORES.filter((s) => s !== deSetor);
  const [tipos, setTipos] = useState<TipoSol[]>([]);
  const [para, setPara] = useState<Setor>(soPagamento ? "financeiro" : paraInicial && paraInicial !== deSetor ? paraInicial : destinos.includes("operacional") ? "operacional" : destinos[0]);
  const [tipo, setTipo] = useState("");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<PrioridadeSol>("normal");
  const [outroPrazo, setOutroPrazo] = useState(false);
  const [prazo, setPrazo] = useState("");
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [semCliente, setSemCliente] = useState(false);
  const [cot, setCot] = useState<FormCotacao>(() => cotacaoVazia());
  const [pag, setPag] = useState<FormPagamento>(() => pagamentoVazio("pix"));
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setTitulo(""); setDescricao(""); setPrioridade("normal"); setOutroPrazo(false); setPrazo(""); setErro(null); setSemCliente(false);
    setCot(cotacaoVazia(alvo?.sobre ? alvo.sobre.split(" · ")[0] : ""));
    setPag((p) => pagamentoVazio(p.tipo)); setArquivos([]);
    setEscolha(alvo?.clienteId ? { clienteId: alvo.clienteId, clienteNome: (alvo.sobre ?? "").split(" · ")[0] || "Cliente", viagemId: alvo.viagemId ?? null, vendaTexto: null } : null);
    setPara(soPagamento ? "financeiro" : paraInicial && paraInicial !== deSetor ? paraInicial : destinos.includes("operacional") ? "operacional" : destinos[0]);
    listarTipos().then(setTipos).catch(() => setTipos([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const doSetor = useMemo(() => tipos.filter((t) => t.setor === para && t.ativo && (!soPagamento || t.formulario === "pagamento")), [tipos, para, soPagamento]);
  useEffect(() => { setTipo(doSetor[0]?.id ?? ""); }, [doSetor]);
  const tipoSel = doSetor.find((t) => t.id === tipo);
  const ehCotacao = tipoSel?.formulario === "cotacao";
  const tipoPag = tipoSel?.formulario === "pagamento" ? TIPO_PAG_DO[tipoSel.id] : undefined;
  const ehPagamento = !!tipoPag;
  const horas = tipoSel ? horasDoTipo(tipoSel) : undefined;
  // Trocou o tipo de pagamento: formulário novo (a amarração escolhida fica).
  useEffect(() => {
    if (tipoPag) setPag((p) => ({ ...pagamentoVazio(tipoPag), vinculo: p.vinculo, expedicao_id: p.expedicao_id, expedicao_nome: p.expedicao_nome, finalidade: p.finalidade, finalidade_texto: p.finalidade_texto }));
  }, [tipoPag]);
  // Passageiro vazio herda o nome do cliente escolhido.
  useEffect(() => {
    if (escolha?.clienteNome) setCot((c) => (c.passageiro.trim() ? c : { ...c, passageiro: escolha.clienteNome }));
  }, [escolha?.clienteNome]);

  async function enviar() {
    if (!tipo) { setErro("Escolha o tipo do pedido."); return; }
    if (ehPagamento) return enviarPagamento();
    const falta = ehCotacao ? faltaNaCotacao(cot) : null;
    if (falta) { setErro(falta); return; }
    if (!ehCotacao && !titulo.trim()) { setErro("Escreva em uma linha o que você precisa."); return; }
    if (outroPrazo && !prazo) { setErro("Escolha o prazo (ou use o padrão)."); return; }
    if (!escolha && !semCliente && !alvo?.leadId) { setErro("Escolha o cliente do pedido (ou marque que não é de cliente)."); return; }
    setEnviando(true); setErro(null);
    try {
      const id = await criarSolicitacao({
        de: deSetor, para, tipo, prioridade,
        titulo: ehCotacao ? tituloDaCotacao(cot) : titulo.trim(),
        descricao: ehCotacao ? descricaoDaCotacao(cot) : descricao.trim(),
        formulario: ehCotacao ? cot : null,
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

  /** 0201: pedido de pagamento — formulário + amarração; os arquivos sobem depois de criar. */
  async function enviarPagamento() {
    const doCliente = pag.vinculo === "cliente";
    const falta = faltaNoPagamento(pag, !!escolha || !!alvo?.leadId || !!alvo?.viagemId);
    if (falta) { setErro(falta); return; }
    setEnviando(true); setErro(null);
    try {
      const id = await criarSolicitacao({
        de: deSetor, para, tipo, prioridade,
        titulo: tituloDoPagamento(pag),
        descricao: descricaoDoPagamento(pag),
        formulario: paraBanco(pag),
        // Amarrado a cliente: vai com o que veio da tela (lead/conversa) + a escolha.
        // Amarrado a expedição ou "para que é": sem cliente.
        ...(doCliente ? (alvo ?? {}) : {}),
        clienteId: doCliente ? escolha?.clienteId ?? null : null,
        viagemId: doCliente ? escolha?.viagemId ?? alvo?.viagemId ?? null : null,
        sobre: doCliente ? (escolha ? null : alvo?.sobre ?? null) : pag.vinculo === "expedicao" ? `Expedição ${pag.expedicao_nome}` : null,
      });
      const falhas: string[] = [];
      for (const a of arquivos) {
        try { await anexarArquivo(id, "documento", a); } catch (e) { falhas.push(e instanceof Error ? e.message : a.name); }
      }
      if (falhas.length) window.alert(`O pedido foi enviado, mas ${falhas.length === 1 ? "um arquivo não subiu" : "alguns arquivos não subiram"}:\n\n${falhas.join("\n")}\n\nAbra o pedido e anexe de novo.`);
      onCriada(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    finally { setEnviando(false); }
  }

  return (
    <Modal aberto={aberto} titulo={ehCotacao ? `Pedir cotação a ${NOME_SETOR[para]}` : ehPagamento ? "Pedir pagamento ao Financeiro" : "Pedir a outro setor"} onFechar={onFechar} largura={ehCotacao || ehPagamento ? 720 : 560}
      rodape={<><Botao onClick={onFechar} disabled={enviando}>Cancelar</Botao><Botao variante="primario" onClick={() => void enviar()} disabled={enviando}>{enviando ? "Enviando…" : `Enviar pra ${NOME_SETOR[para]}`}</Botao></>}>
      <div className="space-y-4">
        {!soPagamento && <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Pra qual setor</p>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Setor que recebe">
            {destinos.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={para === s} onClick={() => setPara(s)}
                className="rounded-lg px-3 py-2 text-[13px] font-semibold border flex items-center justify-center gap-2"
                style={para === s ? { borderColor: COR_SETOR[s], background: `${COR_SETOR[s]}14`, color: "var(--ink)" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: COR_SETOR[s] }} aria-hidden />{NOME_SETOR[s]}
              </button>
            ))}
          </div>
        </div>}

        {para === "financeiro" && !soPagamento && (
          <p className="text-[12.5px] -mb-2" style={{ color: "var(--ink3)" }}>
            Precisa de dinheiro saindo? Escolha <b>Pix para fornecedor</b>, <b>Link de pagamento</b>, <b>Cartão da empresa</b> ou <b>Provisionar pagamento</b>.
          </p>
        )}
        <Campo rotulo="Tipo do pedido" dica={horas ? `Prazo: Normal ${textoHoras(horas.normal)} · Alta ${textoHoras(horas.alta)} · Urgente ${textoHoras(horas.urgente)} (seg–sex, 9h–18h).` : undefined}>
          <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {doSetor.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
          </select>
        </Campo>

        {ehPagamento ? (<>
          <VinculoPagamento f={pag} onMudar={setPag} escolha={escolha} onEscolha={setEscolha} travarCliente={!!alvo?.clienteId}
            buscaInicial={alvo?.leadId || (alvo?.conversaId && !alvo.clienteId) ? (alvo.sobre ?? "") : ""}
            temLead={!!alvo?.leadId} nomeLead={alvo?.sobre} />
          <FormPagamentoCampos f={pag} onMudar={setPag} />
          <EscolherArquivos arquivos={arquivos} onMudar={setArquivos}
            rotulo={pag.tipo === "pix" ? "Anexar boleto, nota ou print (opcional)" : "Anexar arquivo (opcional)"} />
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Prioridade</p>
            <EscolherPrioridade valor={prioridade} onMudar={setPrioridade} horas={horas} />
          </div>
        </>) : (<>
        <div className="rel-card p-3 space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Cliente e venda <span style={{ color: "var(--ink3)", fontWeight: 400 }}>— o pedido fica na ficha do cliente</span></p>
          {alvo?.conversaId && !alvo.clienteId && !alvo.leadId && !escolha && (
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Esta conversa ainda não está ligada a uma ficha. Escolha o cliente abaixo pra o pedido ficar na ficha dele.</p>
          )}
          {alvo?.leadId && !escolha && (
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Vai ligado ao lead <b style={{ color: "var(--ink2)" }}>{alvo.sobre}</b>. Se ele já é cliente, escolha abaixo pra ficar na ficha também.</p>
          )}
          {semCliente ? (
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Pedido interno, sem cliente. <button type="button" className="underline" onClick={() => setSemCliente(false)}>escolher cliente</button></p>
          ) : (
            <EscolherClienteVenda valor={escolha} onMudar={setEscolha} travarCliente={!!alvo?.clienteId}
              buscaInicial={alvo?.leadId || (alvo?.conversaId && !alvo.clienteId) ? (alvo.sobre ?? "") : ""} />
          )}
          {!escolha && !semCliente && !alvo?.leadId && (
            <label className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>
              <input type="checkbox" checked={semCliente} onChange={(e) => setSemCliente(e.target.checked)} /> Não é de cliente (pedido interno)
            </label>
          )}
        </div>

        {ehCotacao ? (
          <FormCotacaoCampos f={cot} onMudar={setCot} prioridade={prioridade} onPrioridade={setPrioridade} horas={horas} />
        ) : (<>
        <Campo rotulo="O que você precisa (uma linha)" dica="Ex.: cotar aéreo GRU–Lisboa 12/03 a 26/03 pra 2 adultos.">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} autoFocus />
        </Campo>

        <Campo rotulo="Detalhes (opcional)" dica="Tudo que o outro setor precisa pra não ter que te perguntar.">
          <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} maxLength={4000} className="rel-input" />
        </Campo>
        </>)}

        <div className="flex flex-wrap items-end gap-4">
          {!ehCotacao && (
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Prioridade</p>
              <EscolherPrioridade valor={prioridade} onMudar={setPrioridade} horas={horas} />
            </div>
          )}
          <label className="flex items-center gap-2 text-[13px] pb-1.5" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" checked={outroPrazo} onChange={(e) => setOutroPrazo(e.target.checked)} /> Preciso pra uma data certa
          </label>
          {outroPrazo && (
            <Campo rotulo="Prazo">
              <input type="datetime-local" className="rel-input" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
            </Campo>
          )}
        </div>
        </>)}

        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
