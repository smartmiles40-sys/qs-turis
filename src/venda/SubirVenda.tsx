// src/venda/SubirVenda.tsx
// -----------------------------------------------------------------------------
// SUBIR VENDA — UMA tela pra Closer, Relacionamento e Operacional (0214, Bruno
// 28/10/2026): "todos os setores têm que se conversar; preenchimento rápido
// porém assertivo". O Ops "sobe venda sem pipeline, só subir a venda".
//
// Quatro passos curtos:
//   1. Quem comprou — a pessoa (ficha única) + "Preencher pelo voucher" (IA);
//   2. O que vendeu — cartões do catálogo único (TIPOS em src/propostas/lib.ts);
//   3. Detalhes — campos de cada tipo. EXPEDIÇÃO tem bloco próprio
//      (BlocoExpedicao): só com vaga, quem viaja, valor de cada um, aéreo
//      incluso, quarto e com quem divide. Venda SEM expedição ganha "Quem viaja"
//      (QuemViaja, 0351) — a família vira qs_venda_pessoas e cards filhos no Bitrix;
//   4. Valores e pagamento — valor de cada item, forma, entrada, parcelas,
//      condição especial (ExpedAmigo…) e observações.
//
// Ao confirmar, a RPC venda_subir grava TUDO numa transação (pessoa, cabeçalho,
// itens e passageiros da expedição) — o Rel e o Ops já veem na hora.
// Closer: depois do banco, a pré-venda da 0207 leva o Bitrix pra "Em emissão"
// (marcarPreVenda → api/closer.js acao=pre-venda). Não há outra chamada ao Bitrix.
// "Salvar rascunho" do closer só guarda os itens (não ocupa vaga).
//
// 5. ANÁLISE PÓS-VENDA (0230, Bruno 30/10/2026): antes de concluir, a venda é
//    revisada (proposta aprovada × o que já foi emitido × o que está sendo
//    vendido) e a pessoa aguarda o extrato: OK / falta emitir / divergente +
//    risco. Dá pra concluir com pendência; aí a análise fica guardada na venda
//    (status) e abre a solicitação "Emissões pendentes" pro Relacionamento.
//    Ver src/venda/analise.ts e docs/ANALISE-POS-VENDA.md.
//
// 6. PROPOSTA ANEXADA (0295, Bruno 03/11/2026: "só pedirmos para anexar a
//    proposta na hora da venda"): no passo 4, "Proposta enviada ao cliente" é
//    OBRIGATÓRIO (1+ PDF/foto). Os arquivos sobem ANTES da venda_subir; se a
//    venda falhar, são apagados; se der certo, ficam amarrados na venda.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { Stepper } from "@/components/ui";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import {
  CONDICOES, FORMAS, ORDEM_TIPOS_VENDA, TIPOS, camposDoTipo, datasDoTipo, tipoVendaBitrix, type TipoItem,
} from "@/propostas/lib";
import { brl, emPreVenda, nomeDoLead, type Negocio } from "@/closer/lib";
import {
  itemPrincipal, itemVendaVazio, itensDaPropostaAprovada, listarItensDaVenda, marcarPreVenda, nomeSugerido,
  salvarItensDaVenda, somaDosItens, type ItemVenda, type ResultadoPreVenda,
} from "@/closer/vendaItens";
import {
  fichaDoComprador, itemDoVoucher, lerValor, lerVoucher, listarExpedicoesParaVenda, montarPayload, mostrarValor,
  pagamentoVendaVazio, passageirosDosItens, pessoaVazia, subirVenda, vendaDoNegocio, viajanteNovo,
  type ExpedicaoVaga, type OrigemVenda, type PagamentoVenda, type PessoaVenda, type Viajante,
} from "./api";
import { completarPessoa, restaurarViajantes, viajantesParaJson, type AcompFicha, type PaxJson } from "./vendaRegras";
import QuemViaja from "./QuemViaja";
import { familiaDoNegocio } from "./familia";
import DadosDaPessoaNaVenda from "./DadosDaPessoaNaVenda";
import BlocoExpedicao from "./BlocoExpedicao";
import CampoDoTipo from "./CampoDoTipo";
import ExtratoAnalise from "./ExtratoAnalise";
import { STATUS_ANALISE, abrirPedidoSem0230, analisarRascunho, analisarVendaGravada, type Analise } from "./analise";
import { anexarPropostas, desfazerAnexos, faltaProposta, listarPropostasDaVenda, vincularPropostas, type PropostaAnexada } from "./propostaAnexo";
import { CampoPropostaVenda } from "./PropostasAnexadas";

const PASSOS = ["Quem comprou", "O que vendeu", "Detalhes", "Valores e pagamento", "Análise pós-venda"] as const;
const PASSO_ANALISE = 4;

export interface SubirVendaProps {
  origem: OrigemVenda;
  aberto: boolean;
  onFechar: () => void;
  onSalvo: (r: ResultadoPreVenda) => void;
  /** Closer: o cartão do pipeline (obrigatório pro closer). */
  negocio?: Negocio | null;
  /** Rel/Ops: a pessoa já conhecida (ficha). */
  cliente?: Partial<PessoaVenda> & { id?: string | null; nome: string };
  /** Rel: venda lançada de dentro de uma viagem. */
  viagemId?: string | null;
}

export default function SubirVenda({ origem, aberto, onFechar, onSalvo, negocio, cliente, viagemId }: SubirVendaProps) {
  const [passo, setPasso] = useState(0);
  const [pessoa, setPessoa] = useState<PessoaVenda>(pessoaVazia);
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [viajantes, setViajantes] = useState<Record<string, Viajante[]>>({});
  // 0351: quem viaja numa venda SEM expedição (vai no 1º item que não é expedição).
  const [outros, setOutros] = useState<Viajante[]>([]);
  const [pag, setPag] = useState<PagamentoVenda>(pagamentoVendaVazio);
  const [especial, setEspecial] = useState(false);
  const [especialObs, setEspecialObs] = useState("");
  const [obs, setObs] = useState("");
  const [expedicoes, setExpedicoes] = useState<ExpedicaoVaga[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [lendoVoucher, setLendoVoucher] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tom: "ok" | "aviso"; t: string; lista?: string[] } | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // Análise pós-venda (passo 5)
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);
  // Proposta enviada ao cliente (0295): as já anexadas no cartão + as escolhidas agora
  const [propostasJa, setPropostasJa] = useState<PropostaAnexada[]>([]);
  const [propostasNovas, setPropostasNovas] = useState<File[]>([]);
  // Campos de quem comprou que vieram da ficha única (só pra avisar "já veio preenchido").
  const [daFicha, setDaFicha] = useState<string[]>([]);

  const ehCloser = origem === "closer" && !!negocio;
  const consolidada = !!negocio?.consolidada_em;
  const jaPreVenda = negocio ? emPreVenda(negocio) : false;
  const pessoaTravada = !ehCloser && !!cliente?.id;

  // ── Abrir: traz TUDO o que já foi digitado (Bruno 09/11: "digitar uma vez só") ──
  //   • closer: itens salvos (ou a proposta aprovada) + a venda gravada (qs_vendas:
  //     pagamento, condição especial, observações) — reabrir não zera nada;
  //   • quem comprou: lead + ficha única (rel_clientes: CPF, nascimento…), só no vazio;
  //   • viajantes da expedição: linhas de `passageiros` + json do item + acompanhantes da ficha.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true); setErro(null); setInfo(null); setPasso(0);
    setPag(pagamentoVendaVazio()); setEspecial(false); setEspecialObs(""); setObs("");
    setAnalise(null); setErroAnalise(null);
    setPropostasJa([]); setPropostasNovas([]); setDaFicha([]); setOutros([]);
    if (ehCloser) listarPropostasDaVenda({ negocioId: negocio!.id }).then((l) => vivo && setPropostasJa(l)).catch(() => undefined);
    const base = pessoaVazia();
    if (negocio?.lead) Object.assign(base, { nome: nomeDoLead(negocio.lead), telefone: negocio.lead.phone ?? "", email: negocio.lead.email ?? "" });
    if (cliente) Object.assign(base, Object.fromEntries(Object.entries(cliente).map(([k, v]) => [k, v ?? ""])), { id: cliente.id ?? null });
    setPessoa(base);
    (async () => {
      let lista: ItemVenda[] = [];
      const avisos: string[] = [];
      const venda = ehCloser ? await vendaDoNegocio(negocio!.id).catch(() => null) : null;
      if (ehCloser) {
        lista = await listarItensDaVenda(negocio!.id);
        if (!lista.length) {
          const p = await itensDaPropostaAprovada(negocio!.lead_id).catch(() => null);
          if (p) { lista = p.itens; avisos.push(`Já trouxe os itens da ${p.origem}. Confira e ajuste o que mudou.`); }
        }
      }
      // Ficha única de quem comprou: a da venda gravada → a ligada ao lead → a do cliente aberto.
      const ficha = await fichaDoComprador({ clienteId: venda?.cliente_id ?? cliente?.id ?? null, leadId: negocio?.lead_id ?? null });
      const pessoaFinal = completarPessoa(base, ficha);
      const veio = (["telefone", "email", "cpf", "nascimento"] as const)
        .filter((k) => !String(base[k] ?? "").trim() && String(pessoaFinal[k] ?? "").trim());
      // Viajantes: o mais completo que der pra ler.
      const exps = lista.filter((i) => i.tipo === "expedicao");
      const linhas = await passageirosDosItens(exps.map((i) => i.id).filter((x): x is string => !!x));
      const acomps: AcompFicha[] = ficha?.acompanhantes ?? [];
      let dividiu = false;
      const vjs = Object.fromEntries(exps.map((i) => {
        const r = restaurarViajantes({
          item: i, linhas: i.id ? linhas[i.id] : [], compradorClienteId: venda?.cliente_id ?? ficha?.id ?? null,
          nomeComprador: pessoaFinal.nome, acompanhantes: acomps,
        });
        dividiu ||= r.dividiuIgual;
        return [i.k, r.viajantes];
      }));
      // 0351: quem viaja nos itens que não são expedição (o json do item guarda a lista com chave).
      const comLista = lista.find((i) => i.tipo !== "expedicao" && (i.passageiros as PaxJson[]).some((x) => x?.chave));
      let vOutros = comLista && !exps.length
        ? restaurarViajantes({ item: { ...comLista, valor: null }, compradorClienteId: venda?.cliente_id ?? ficha?.id ?? null, nomeComprador: pessoaFinal.nome, acompanhantes: acomps }).viajantes
        : [];
      // Quem assina pelo menor: a pasta gravada (venda_familia) diz a ficha; a tela guarda a chave.
      const fam = ehCloser && venda ? await familiaDoNegocio(negocio!.id).catch(() => null) : null;
      if (fam) {
        const resp = new Map(fam.pessoas.filter((x) => x.responsavel_cliente_id && !x.comprador).map((x) => [x.cliente_id, x.responsavel_cliente_id as string]));
        const porFicha = (vs: Viajante[]) => vs.map((v) => {
          const r = v.cliente_id ? resp.get(v.cliente_id) : undefined;
          const chave = r ? vs.find((o) => !o.comprador && o.cliente_id === r)?.chave : undefined;
          return !v.responsavel && chave ? { ...v, responsavel: chave } : v;
        });
        for (const k of Object.keys(vjs)) vjs[k] = porFicha(vjs[k]);
        vOutros = porFicha(vOutros);
      }
      if (venda) avisos.push("Esta venda já foi registrada: pagamento, condição especial e observações vieram como estavam. Mude só o que precisar.");
      if (dividiu) avisos.push("O valor de cada viajante não estava guardado: dividi o total da expedição igualmente. Confira o valor de cada um.");
      if (!vivo) return;
      setPessoa(pessoaFinal);
      setDaFicha([...veio]);
      if (venda) {
        setPag(venda.pagamento); setEspecial(venda.condicao_especial); setEspecialObs(venda.condicao_obs); setObs(venda.observacoes);
      }
      setItens(lista);
      setValores(Object.fromEntries(lista.map((i) => [i.k, mostrarValor(i.valor)])));
      setViajantes(vjs);
      setOutros(vOutros);
      if (avisos.length) setInfo({ tom: dividiu ? "aviso" : "ok", t: avisos[0], lista: avisos.slice(1) });
    })().catch((e) => vivo && setErro((e as Error).message)).finally(() => vivo && setCarregando(false));
    listarExpedicoesParaVenda().then((l) => vivo && setExpedicoes(l)).catch((e) => vivo && (setExpedicoes([]), setErro((e as Error).message)));
    return () => { vivo = false; };
  }, [aberto, negocio?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiposMarcados = useMemo(() => new Set(itens.map((i) => i.tipo)), [itens]);
  // Valor final de cada item: expedição = soma de quem viaja; o resto = o que foi digitado.
  const comValores = itens.map((i) => ({ ...i, valor: i.tipo === "expedicao" ? i.valor : lerValor(valores[i.k] ?? "") }));
  const total = somaDosItens(comValores);
  const principal = itemPrincipal(comValores);
  // 0351: venda sem expedição → "Quem viaja" vale pra venda toda e vai no 1º item que não é expedição.
  const pivo = itens.some((i) => i.tipo === "expedicao") ? null : itens.find((i) => i.tipo !== "expedicao") ?? null;
  const acompOutros = pivo ? outros.filter((v) => !v.comprador) : [];
  const dataViagem = itens.map((i) => i.data_inicio).filter(Boolean).sort()[0] ?? null;

  const mudarItem = (k: string, p: Partial<ItemVenda>) => setItens((l) => l.map((i) => (i.k === k ? { ...i, ...p } : i)));
  const mudarDado = (k: string, chave: string, v: string) => setItens((l) => l.map((i) => (i.k === k ? { ...i, dados: { ...i.dados, [chave]: v } } : i)));

  function adicionar(t: TipoItem) {
    const novo = itemVendaVazio(t);
    setItens((l) => [...l, novo]);
    if (t === "expedicao") setViajantes((v) => ({ ...v, [novo.k]: [viajanteNovo(true)] }));
  }
  function alternarTipo(t: TipoItem) {
    setErro(null);
    if (!tiposMarcados.has(t)) { adicionar(t); return; }
    const doTipo = itens.filter((i) => i.tipo === t);
    if (doTipo.some((i) => i.status && i.status !== "vendido")) { setErro(`${TIPOS[t].rotulo}: já tem item emitido — esse não sai por aqui.`); return; }
    const temDados = doTipo.some((i) => i.nome || Object.values(i.dados).some(Boolean) || valores[i.k]);
    if (temDados && !window.confirm(`Tirar ${TIPOS[t].rotulo} da venda? O que você preencheu nele se perde.`)) return;
    setItens((l) => l.filter((i) => i.tipo !== t));
  }

  // ── Voucher (frente ia-voucher) ──
  async function usarVoucher(f: File | undefined) {
    if (!f) return;
    setLendoVoucher(true); setErro(null);
    try {
      const r = await lerVoucher(f);
      const novos = r.itens.map(itemDoVoucher);
      if (!novos.length && !r.pessoas.length) { setInfo({ tom: "aviso", t: "A IA não achou nada pra preencher nesse arquivo. Siga no manual." }); return; }
      setItens((l) => [...l, ...novos]);
      setValores((v) => ({ ...v, ...Object.fromEntries(novos.map((i) => [i.k, mostrarValor(i.valor)])) }));
      setViajantes((v) => ({ ...v, ...Object.fromEntries(novos.filter((i) => i.tipo === "expedicao").map((i) => [i.k, restaurarViajantes({ item: i, nomeComprador: pessoa.nome }).viajantes])) }));
      const p0 = r.pessoas[0];
      if (p0 && !pessoaTravada) setPessoa((p) => ({ ...p, nome: p.nome || p0.nome, cpf: p.cpf || p0.cpf || "", passaporte: p.passaporte || p0.passaporte || "", nascimento: p.nascimento || p0.nascimento || "" }));
      setInfo({ tom: r.avisos.length ? "aviso" : "ok", t: `O voucher preencheu ${novos.length} item(ns)${r.pessoas.length ? ` e ${r.pessoas.length} pessoa(s)` : ""}. Confira antes de confirmar.`, lista: r.avisos });
      if (novos.length && passo < 2) setPasso(2);
    } catch (e) {
      setInfo({ tom: "aviso", t: `Não deu pra ler o voucher (${(e as Error).message}). Siga no manual — nada se perdeu.` });
    } finally {
      setLendoVoucher(false);
      if (arquivo.current) arquivo.current.value = "";
    }
  }

  // ── Conferências de cada passo (assertivo, mas só o essencial) ──
  function conferir(ate: number): string | null {
    if (ate >= 0 && pessoa.nome.trim().length < 3) return "Escreva o nome completo de quem comprou.";
    if (ate >= 0 && !pessoaTravada && !pessoa.telefone.trim() && !pessoa.email.trim() && !pessoa.cpf.trim())
      return "Coloque pelo menos WhatsApp, e-mail ou CPF — é assim que o QS acha a ficha do cliente.";
    if (ate >= 0 && !pessoaTravada && pessoa.cpf.trim() && pessoa.cpf.replace(/\D/g, "").length !== 11)
      return "CPF de quem comprou: são 11 números (ou deixe em branco).";
    if (ate >= 1 && !itens.length) return "Toque em pelo menos um cartão: o que o cliente comprou?";
    if (ate >= 2) {
      const errado = itens.find((i) => i.data_inicio && i.data_fim && i.data_fim < i.data_inicio);
      if (errado) return `${TIPOS[errado.tipo].rotulo}: a segunda data está antes da primeira.`;
      for (const i of itens.filter((x) => x.tipo === "expedicao")) {
        const exp = expedicoes?.find((e) => e.id === i.dados.expedicao_id);
        if (!exp) return "Escolha qual expedição foi vendida.";
        const vs = viajantes[i.k] ?? [];
        if (vs.length > exp.vagas) return `${exp.nome}: só ${exp.vagas} vaga(s). Peça pro Operacional abrir vaga.`;
        if (vs.some((v) => !v.comprador && v.nome.trim().length < 3)) return "Escreva o nome de quem viaja junto.";
        if (vs.some((v) => !lerValor(v.valor_contratado))) return "Coloque o valor que cada pessoa paga na expedição.";
        if (vs.some((v) => v.valor_pago.trim() && lerValor(v.valor_pago) == null)) return "Valor pago que não entendi. Use só números, ex.: 2.500,00";
        if (vs.some((v) => v.divide === "t" && !v.divide_nome.trim())) return "Escreva o nome de quem divide o quarto.";
        if (vs.some((v) => !v.comprador && v.cpf.trim() && v.cpf.replace(/\D/g, "").length !== 11)) return "CPF de quem viaja junto: são 11 números (ou deixe em branco).";
      }
      if (acompOutros.some((v) => v.nome.trim().length < 3)) return "Quem viaja: escreva o nome de cada acompanhante.";
      if (acompOutros.some((v) => v.cpf.trim() && v.cpf.replace(/\D/g, "").length !== 11)) return "CPF de quem viaja junto: são 11 números (ou deixe em branco).";
      if (acompOutros.some((v) => v.valor_contratado.trim() && lerValor(v.valor_contratado) == null)) return "Valor de acompanhante que não entendi. Use só números, ex.: 2.500,00";
    }
    if (ate >= 3) {
      const ruim = itens.find((i) => i.tipo !== "expedicao" && (valores[i.k] ?? "").trim() && lerValor(valores[i.k]) == null);
      if (ruim) return `Valor que não entendi em ${TIPOS[ruim.tipo].rotulo}. Use só números, ex.: 12.500,00`;
      if (total <= 0) return "Coloque o valor de pelo menos um item (o total não pode ficar zerado).";
      if (!pag.forma) return "Escolha a forma de pagamento.";
      if (pag.condicao === "entrada" && (!lerValor(pag.entrada) || !pag.entrada_data)) return "Entrada: coloque o valor e a data.";
      if (pag.condicao !== "avista" && !(Number(pag.parcelas) >= 1)) return "Quantas parcelas?";
      if (especial && especialObs.trim().length < 3) return "Condição especial: escreva qual é (ex.: ExpedAmigo, 10% off pago no Pix).";
      const semProposta = faltaProposta(propostasJa.length, propostasNovas.length);
      if (semProposta) return semProposta;
    }
    return null;
  }

  function avancar() {
    const e = conferir(passo);
    setErro(e);
    if (e) return;
    const prox = Math.min(passo + 1, PASSOS.length - 1);
    setPasso(prox);
    if (prox === PASSO_ANALISE) void rodarAnalise();
  }

  /** Itens como vão pro banco (expedição leva quem viaja COM todos os detalhes — reabrir não perde nada; o resto, o comprador se vier vazio). */
  function itensFinais(): ItemVenda[] {
    return comValores.map((i) => (i.tipo === "expedicao"
      ? { ...i, passageiros: viajantesParaJson(viajantes[i.k] ?? [], pessoa.nome) }
      // 0351: o item "pivô" guarda quem viaja (reabrir não perde a família).
      : pivo && i.k === pivo.k && acompOutros.length
        ? { ...i, passageiros: viajantesParaJson(outrosComComprador(), pessoa.nome) }
        : { ...i, passageiros: i.passageiros.length && !(i.passageiros as PaxJson[]).some((x) => x?.chave) ? i.passageiros : [{ nome: pessoa.nome }] }));
  }
  /** "Quem viaja" sempre com o comprador na frente (a venda_subir conta ele como titular). */
  function outrosComComprador(): Viajante[] {
    return outros.some((v) => v.comprador) ? outros : [viajanteNovo(true), ...outros];
  }
  /** Viajantes por item como vão pra venda_subir (expedição + o pivô dos outros itens). */
  function viajantesFinais(): Record<string, Viajante[]> {
    return pivo && acompOutros.length ? { ...viajantes, [pivo.k]: outrosComComprador() } : viajantes;
  }

  // ── 5. Análise pós-venda: a pessoa aguarda o extrato antes de concluir ──
  async function rodarAnalise() {
    setAnalisando(true); setErroAnalise(null);
    try {
      const final = itensFinais();
      const vjs = final.filter((i) => i.tipo === "expedicao").flatMap((i) => (viajantes[i.k] ?? []).map((v) => ({
        nome: v.comprador ? pessoa.nome : v.nome, valor_contratado: lerValor(v.valor_contratado), valor_pago: lerValor(v.valor_pago) ?? 0,
      })));
      setAnalise(await analisarRascunho({
        origem, negocio_id: ehCloser ? negocio!.id : null, cliente_id: pessoa.id || null, viagem_id: viagemId ?? null,
        cliente: { nome: pessoa.nome },
        itens: final.map((i) => ({ tipo: i.tipo, nome: i.nome.trim() || nomeSugerido(i), data_inicio: i.data_inicio || null, data_fim: i.data_fim || null, dados: i.dados, passageiros: i.passageiros.map((x) => ({ nome: x.nome })), valor: i.valor, custo: i.custo, status: i.status ?? "vendido" })),
        viajantes: vjs,
        pagamento: { forma: pag.forma, condicao: pag.condicao, entrada: lerValor(pag.entrada), entrada_data: pag.entrada_data || null, parcelas: Number(pag.parcelas) || null },
        total,
      }));
    } catch (e) {
      setAnalise(null);
      setErroAnalise(`${(e as Error).message} Dá pra concluir mesmo assim — a análise roda de novo no painel "Vendas com pendência".`);
    } finally {
      setAnalisando(false);
    }
  }

  /** Depois de gravar: guarda a análise na venda e abre a solicitação pro Rel se falta algo. Nunca derruba a venda. */
  async function guardarAnalise(vendaId: string): Promise<string> {
    try {
      const a = await analisarVendaGravada(vendaId, "subir_venda", analise);
      const sol = a.solicitacao;
      const rot = STATUS_ANALISE[a.status]?.rotulo ?? a.status;
      if (a.gravado === false && a.falta0230 && (a.contagens.falta + a.contagens.divergente + a.contagens.extra) > 0) {
        const n = await abrirPedidoSem0230(origem, a, { cliente_id: pessoa.id || null, viagem_id: viagemId ?? null, nome: pessoa.nome }).catch(() => null);
        return ` Análise: ${rot}.${n ? ` Solicitação nº ${n} aberta pro Relacionamento com o que falta emitir.` : ""}`;
      }
      if (sol?.nova) return ` Análise: ${rot} — solicitação nº ${sol.numero} aberta pro Relacionamento com ${a.contagens.falta} emissão(ões) pendente(s).`;
      if (sol) return ` Análise: ${rot} — atualizada no pedido nº ${sol.numero}.`;
      if (origem === "rel" && a.status !== "tudo_emitido") return ` Análise: ${rot} — ficou em "Vendas com pendência".`;
      return ` Análise: ${rot}.${a.gravado === false && a.aviso ? ` ${a.aviso}` : ""}`;
    } catch (e) {
      return ` A análise pós-venda não rodou agora (${(e as Error).message}); reanalise no painel "Vendas com pendência".`;
    }
  }

  async function salvar(marcar: boolean) {
    const e = conferir(3);
    if (e) { setErro(e); return; }
    setErro(null); setSalvando(true);
    try {
      const final = itensFinais();

      // 0295: a proposta sobe ANTES — se não subir, a venda não é registrada.
      const novosIds = propostasNovas.length
        ? await anexarPropostas(propostasNovas, { negocioId: ehCloser ? negocio!.id : null, clienteId: pessoa.id || null })
        : [];
      // gravou: o que subiu passa a contar como "já anexada" (tentar de novo não duplica)
      const subiram = (vendaId?: string | null) => {
        setPropostasNovas([]);
        void listarPropostasDaVenda({ negocioId: ehCloser ? negocio!.id : null, vendaId }).then(setPropostasJa).catch(() => undefined);
      };

      // Rascunho do closer: só os itens (não ocupa vaga, não cria passageiro).
      if (ehCloser && !marcar && !jaPreVenda && !consolidada) {
        try { await salvarItensDaVenda(negocio!.id, final); }
        catch (e) { await desfazerAnexos(novosIds).catch(() => undefined); throw e; }
        subiram();
        onSalvo({ tom: "ok", mensagem: `Rascunho salvo (${brl(total)}). Ainda não conta como venda: quando fechar, abra de novo e use "Confirmar venda".` });
        return;
      }

      let r: Awaited<ReturnType<typeof subirVenda>>;
      try {
        r = await subirVenda(montarPayload({
          origem, negocio_id: ehCloser ? negocio!.id : null, viagem_id: viagemId ?? null,
          cliente: pessoa, itens: final, viajantes: viajantesFinais(), pagamento: pag,
          condicao_especial: especial, condicao_obs: especialObs, observacoes: obs,
        }, nomeSugerido));
      } catch (e) {
        await desfazerAnexos(novosIds).catch(() => undefined); // venda não gravou: não deixa a proposta solta
        throw e;
      }
      let avisoProposta = "";
      if (r.venda_id) {
        const ids = [...novosIds, ...propostasJa.filter((a) => !a.venda_id).map((a) => a.id)];
        await vincularPropostas(ids, r.venda_id).catch((e) => { avisoProposta = ` Atenção: a proposta anexada não ficou amarrada na venda (${(e as Error).message}).`; });
      }
      subiram(r.venda_id);
      const pax = (r.passageiros ? ` ${r.passageiros} passageiro(s) já estão na expedição (pré-reserva — o Operacional confirma).` : "")
        + ((r.pessoas ?? 0) > 1 ? ` Família: ${r.pessoas} pessoas na pasta da venda (cada uma ganha o card dela no Bitrix).` : "")
        + (r.familia_erro ? ` Atenção: a venda gravou, mas a lista da família não (${r.familia_erro}). Abra e salve de novo.` : "")
        + (r.venda_id ? await guardarAnalise(r.venda_id) : "") + avisoProposta;

      if (ehCloser && principal) {
        // Mesma regra do RegistrarVenda: marca (ou atualiza o valor/tipo) no Dashboard pela pré-venda da 0207.
        const mudou = jaPreVenda && (Math.abs(Number(negocio!.pre_venda_valor ?? 0) - total) > 0.009 || negocio!.pre_venda_tipo !== principal.tipo);
        if (marcar || mudou) {
          const pv = await marcarPreVenda(negocio!.id, { tipo: principal.tipo, valor: total });
          onSalvo({ tom: pv.tom, mensagem: pv.mensagem + pax });
          return;
        }
      }
      onSalvo({ tom: "ok", mensagem: `Venda registrada: ${r.itens} item(ns), ${brl(r.total)}.${pax}` });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ultimo = passo === PASSOS.length - 1;
  const titulo = `Subir venda${pessoa.nome ? ` — ${pessoa.nome}` : ""}`;
  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onFechar} largura={880}
      rodape={<>
        {passo > 0 ? <Botao variante="fantasma" onClick={() => { setErro(null); setPasso(passo - 1); }} disabled={salvando}>← Voltar</Botao>
          : <Botao variante="fantasma" onClick={onFechar} disabled={salvando}>Cancelar</Botao>}
        {!ultimo && <Botao variante="primario" onClick={avancar} disabled={carregando}>Continuar →</Botao>}
        {ultimo && (
          <Botao variante="fantasma" onClick={() => void rodarAnalise()} disabled={analisando || salvando} title="Roda a conferência de novo">Reanalisar</Botao>
        )}
        {ultimo && ehCloser && !consolidada && !jaPreVenda && (
          <Botao variante="fantasma" onClick={() => void salvar(false)} disabled={salvando} title="Guarda os itens sem contar como venda">Salvar rascunho</Botao>
        )}
        {ultimo && (
          <Botao variante="primario" onClick={() => void salvar(true)} disabled={salvando || analisando}
            title={ehCloser ? "Grava tudo e já conta como venda no Dashboard" : "Grava tudo: Relacionamento e Operacional já veem"}>
            {salvando ? "Salvando…" : ehCloser && (jaPreVenda || consolidada) ? "Salvar" : analise && analise.status !== "tudo_emitido" ? "Concluir com pendência" : "Confirmar venda"}
          </Botao>
        )}
      </>}>
      <div className="mb-4"><Stepper steps={PASSOS} current={passo} /></div>
      <input ref={arquivo} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => void usarVoucher(e.target.files?.[0])} />

      {carregando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : <>
        {info && (
          <div className="mb-3">
            <Aviso tom={info.tom}>
              {info.t}
              {info.lista && info.lista.length > 0 && <ul className="list-disc pl-5 mt-1">{info.lista.map((a) => <li key={a}>{a}</li>)}</ul>}
            </Aviso>
          </div>
        )}

        {/* ── 1. Quem comprou ── */}
        {passo === 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rel-card p-3">
              <span className="text-[13px] flex-1 min-w-[200px]" style={{ color: "var(--ink2)" }}>
                <b>Tem o voucher, bilhete ou reserva?</b> Mande o PDF ou a foto e a IA preenche os itens pra você conferir.
              </span>
              <Botao onClick={() => arquivo.current?.click()} disabled={lendoVoucher}>{lendoVoucher ? "Lendo o voucher…" : "📄 Preencher pelo voucher"}</Botao>
            </div>
            <DadosDaPessoaNaVenda pessoa={pessoa} onMudar={setPessoa} travada={pessoaTravada} daFicha={daFicha} />
          </div>
        )}

        {/* ── 2. O que vendeu ── */}
        {passo === 1 && (
          <>
            <p className="text-[14px] mb-3" style={{ color: "var(--ink)" }}>
              <b>O que o cliente comprou?</b> <span style={{ color: "var(--ink2)" }}>Toque em tudo que entrou na venda — pode ser mais de um.</span>
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {ORDEM_TIPOS_VENDA.map((t) => {
                const on = tiposMarcados.has(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => alternarTipo(t)}
                    className="text-left rounded-xl px-3.5 py-3 transition-colors min-h-[88px]"
                    style={{ border: `2px solid ${on ? "var(--rel)" : "var(--line)"}`, background: on ? "var(--rel-soft)" : "var(--card)" }}>
                    <span className="flex items-center gap-2">
                      <span className="text-[22px] leading-none" aria-hidden>{TIPOS[t].emoji}</span>
                      <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>{TIPOS[t].rotulo}</span>
                      {on && <span className="text-[13px] font-bold" style={{ color: "var(--rel-ink)" }} aria-hidden>✓</span>}
                    </span>
                    {TIPOS[t].ajuda && <span className="block text-[12px] mt-1.5 leading-snug" style={{ color: "var(--ink3)" }}>{TIPOS[t].ajuda}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── 3. Detalhes ── */}
        {passo === 2 && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              Preencha o que você já sabe. Na <b>expedição</b>, escolha a data e o valor de cada pessoa; no resto, o que faltar o Relacionamento completa na emissão.
            </p>
            {itens.map((i) => {
              const tinfo = TIPOS[i.tipo];
              const [d1, d2] = datasDoTipo(i.tipo, "venda");
              const emitido = i.status && i.status !== "vendido";
              const mesmos = itens.filter((x) => x.tipo === i.tipo);
              return (
                <section key={i.k} className="rel-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[20px]" aria-hidden>{tinfo.emoji}</span>
                    <h3 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>
                      {tinfo.rotulo}{mesmos.length > 1 ? ` ${mesmos.indexOf(i) + 1}` : ""}
                    </h3>
                    {emitido && <Etiqueta tom="rel">{i.status}</Etiqueta>}
                    {!emitido && <Botao variante="fantasma" onClick={() => setItens((l) => l.filter((x) => x.k !== i.k))}>Tirar</Botao>}
                  </div>
                  {i.tipo === "expedicao" ? (
                    <BlocoExpedicao item={i} viajantes={viajantes[i.k] ?? []} expedicoes={expedicoes} carregandoExp={expedicoes === null}
                      nomeComprador={pessoa.nome} podeAbrirVaga={origem === "ops"}
                      onItem={(p) => mudarItem(i.k, p)} onViajantes={(v) => setViajantes((m) => ({ ...m, [i.k]: v }))} />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="sm:col-span-2">
                        <Campo rotulo="Nome do item" dica={`Em branco, fica "${nomeSugerido(i)}".`}>
                          <Entrada value={i.nome} placeholder={tinfo.exemploNome} onChange={(e) => mudarItem(i.k, { nome: e.target.value })} />
                        </Campo>
                      </div>
                      {d1 && <Campo rotulo={d1}><Entrada type="date" value={i.data_inicio} onChange={(e) => mudarItem(i.k, { data_inicio: e.target.value })} /></Campo>}
                      {d2 && <Campo rotulo={d2}><Entrada type="date" value={i.data_fim} onChange={(e) => mudarItem(i.k, { data_fim: e.target.value })} /></Campo>}
                      {camposDoTipo(i.tipo, "venda").map((c) => (
                        <CampoDoTipo key={c.chave} c={c} valor={i.dados[c.chave] ?? ""} onMudar={(v) => mudarDado(i.k, c.chave, v)} />
                      ))}
                      <Campo rotulo="Fornecedor / operadora (interno)" dica="Opcional. O cliente não vê.">
                        <Entrada value={i.fornecedor} onChange={(e) => mudarItem(i.k, { fornecedor: e.target.value })} />
                      </Campo>
                    </div>
                  )}
                  {i.tipo !== "expedicao" && (
                    <button type="button" className="mt-3 text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }}
                      onClick={() => setItens((l) => { const j = l.findIndex((x) => x.k === i.k); const c = [...l]; c.splice(j + 1, 0, itemVendaVazio(i.tipo)); return c; })}>
                      + Outro {tinfo.rotulo.toLowerCase()} nesta venda
                    </button>
                  )}
                </section>
              );
            })}
            {/* 0351: venda sem expedição também tem "quem viaja" (a família vira a pasta do cartão e os cards filhos no Bitrix). */}
            {pivo && (
              <QuemViaja viajantes={outros} nomeComprador={pessoa.nome} dataViagem={dataViagem} totalVenda={total}
                onViajantes={setOutros} />
            )}
          </div>
        )}

        {/* ── 4. Valores e pagamento ── */}
        {passo === 3 && (
          <div className="space-y-4">
            <div className="rel-card p-4">
              <p className="text-[14px] font-bold mb-1" style={{ color: "var(--ink)" }}>Quanto o cliente pagou em cada item?</p>
              <p className="text-[12.5px] mb-3" style={{ color: "var(--ink3)" }}>Preço de venda em reais. Item "incluso" pode ficar 0. A expedição soma o valor de cada pessoa.</p>
              <ul className="space-y-2">
                {comValores.map((i) => (
                  <li key={i.k} className="grid grid-cols-[1fr_150px] sm:grid-cols-[1fr_180px_150px] gap-2 items-center">
                    <span className="text-[13.5px] min-w-0 truncate" style={{ color: "var(--ink)" }}>
                      <span aria-hidden>{TIPOS[i.tipo].emoji}</span> {i.nome.trim() || nomeSugerido(i)}
                    </span>
                    <span className="hidden sm:block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{tipoVendaBitrix(i.tipo).nome}</span>
                    {i.tipo === "expedicao"
                      ? <span className="text-[13.5px] font-semibold text-right pr-2" style={{ color: "var(--ink)" }}>{brl(i.valor)}</span>
                      : <Entrada inputMode="decimal" aria-label={`Valor de ${i.nome || TIPOS[i.tipo].rotulo}`} placeholder="R$ 0,00"
                          value={valores[i.k] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [i.k]: e.target.value }))} />}
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
                <span className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Total da venda</span>
                <span className="text-[18px] font-bold" style={{ color: total > 0 ? "var(--rel-ink)" : "var(--ink3)" }}>{brl(total)}</span>
              </div>
              {ehCloser && principal && total > 0 && (
                <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>No Dashboard/Bitrix entra como <b>{tipoVendaBitrix(principal.tipo).nome}</b> (o item de maior valor).</p>
              )}
            </div>

            <div className="rel-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <p className="sm:col-span-2 text-[14px] font-bold" style={{ color: "var(--ink)" }}>Como vai pagar?</p>
              <Campo rotulo="Forma de pagamento *">
                <select className="rel-input" value={pag.forma} onChange={(e) => setPag({ ...pag, forma: e.target.value })}>
                  <option value="">Escolha…</option>
                  {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Condição">
                <select className="rel-input" value={pag.condicao} onChange={(e) => setPag({ ...pag, condicao: e.target.value as PagamentoVenda["condicao"] })}>
                  {Object.entries(CONDICOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              {pag.condicao === "entrada" && <>
                <Campo rotulo="Valor da entrada *"><Entrada inputMode="decimal" placeholder="R$ 0,00" value={pag.entrada} onChange={(e) => setPag({ ...pag, entrada: e.target.value })} /></Campo>
                <Campo rotulo="Data da entrada *"><Entrada type="date" value={pag.entrada_data} onChange={(e) => setPag({ ...pag, entrada_data: e.target.value })} /></Campo>
              </>}
              {pag.condicao !== "avista" && <>
                <Campo rotulo="Nº de parcelas *"><Entrada type="number" min={1} max={48} value={pag.parcelas} onChange={(e) => setPag({ ...pag, parcelas: e.target.value })} /></Campo>
                <Campo rotulo="1ª parcela em"><Entrada type="date" value={pag.primeira_parcela} onChange={(e) => setPag({ ...pag, primeira_parcela: e.target.value })} /></Campo>
              </>}
              <div className="sm:col-span-2">
                <Campo rotulo="Peculiaridades do pagamento" dica="Ex.: parte no cartão da mãe, boleto todo dia 10, Pix do sinal já caiu.">
                  <Entrada value={pag.obs} onChange={(e) => setPag({ ...pag, obs: e.target.value })} />
                </Campo>
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-[13.5px] font-semibold cursor-pointer" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={especial} onChange={(e) => setEspecial(e.target.checked)} />
                Condição especial (ExpedAmigo, desconto, cortesia parcial…)
              </label>
              {especial && (
                <div className="sm:col-span-2">
                  <Campo rotulo="Qual condição? *"><Entrada value={especialObs} onChange={(e) => setEspecialObs(e.target.value)} placeholder="Ex.: ExpedAmigo — indicou a Ana, 5% off" /></Campo>
                </div>
              )}
              <div className="sm:col-span-2">
                <Campo rotulo="Observações pra quem vem depois" dica="Relacionamento, Operacional e Financeiro leem.">
                  <textarea className="rel-input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
                </Campo>
              </div>
            </div>

            <CampoPropostaVenda jaAnexadas={propostasJa} novos={propostasNovas} onNovos={(f) => { setPropostasNovas(f); setErro(null); }} />

            {ehCloser && !consolidada && !jaPreVenda && (
              <Aviso><b>Confirmar venda</b> grava tudo e a venda já conta no Dashboard. Depois, no cartão, é só <b>Fechar: pagamento e contrato</b>.</Aviso>
            )}
          </div>
        )}
        {/* ── 5. Análise pós-venda ── */}
        {passo === PASSO_ANALISE && (
          <div className="space-y-3">
            {analisando ? (
              <div className="rel-card p-6 text-center" role="status" aria-live="polite">
                <p className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Revisando a venda…</p>
                <p className="text-[13px] mt-1" style={{ color: "var(--ink3)" }}>Cruzando a proposta apresentada com o que já foi emitido e olhando os riscos. Leva alguns segundos.</p>
              </div>
            ) : analise ? (
              <>
                <ExtratoAnalise status={analise.status} base={analise.base} contagens={analise.contagens} linhas={analise.linhas} riscos={analise.riscos}
                  resumo={analise.resumo} proposta={analise.proposta} ia={analise.ia} />
                {analise.status !== "tudo_emitido" && (
                  <Aviso>
                    Dá pra concluir assim.{" "}
                    {origem === "rel"
                      ? <>A venda fica em <b>Vendas com pendência</b> com este extrato pra você emitir.</>
                      : <>Ao concluir, abre uma <b>solicitação pro Relacionamento</b> com {analise.contagens.falta ? <>as <b>{analise.contagens.falta}</b> emissão(ões) que faltam</> : "as divergências"} — e a venda fica com o status <b>{STATUS_ANALISE[analise.status]?.rotulo}</b> até tudo bater.</>}
                    {" "}Se algo está errado na venda, volte e corrija antes.
                  </Aviso>
                )}
              </>
            ) : erroAnalise ? <Aviso>{erroAnalise}</Aviso> : null}
          </div>
        )}
        {erro && <div className="mt-4"><Aviso tom="erro">{erro}</Aviso></div>}
      </>}
    </Modal>
  );
}

/** Botão + modal, pra pendurar em qualquer tela (ficha do cliente, viagem, Ops). */
export function BotaoSubirVenda({ origem, cliente, viagemId, rotulo = "Subir venda", variante = "secundario", onSalvo }: {
  origem: OrigemVenda;
  cliente?: SubirVendaProps["cliente"];
  viagemId?: string | null;
  rotulo?: string;
  variante?: "primario" | "secundario";
  onSalvo?: (r: ResultadoPreVenda) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState<ResultadoPreVenda | null>(null);
  return (
    <>
      <Botao variante={variante} onClick={() => { setAviso(null); setAberto(true); }}>💼 {rotulo}</Botao>
      {aberto && (
        <SubirVenda origem={origem} aberto={aberto} cliente={cliente} viagemId={viagemId} onFechar={() => setAberto(false)}
          onSalvo={(r) => { setAberto(false); setAviso(r); onSalvo?.(r); }} />
      )}
      {aviso && !onSalvo && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm" role="status" onClick={() => setAviso(null)}>
          <Aviso tom={aviso.tom}>{aviso.mensagem}</Aviso>
        </div>
      )}
    </>
  );
}
