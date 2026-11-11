// src/venda/SubirVenda.tsx
// -----------------------------------------------------------------------------
// SUBIR VENDA — UMA tela pra Closer, Relacionamento e Operacional (0214, Bruno
// 28/10/2026): "todos os setores têm que se conversar; preenchimento rápido
// porém assertivo". O Ops "sobe venda sem pipeline, só subir a venda".
//
// SPRINT FINAL (11/11/2026 — contrato em docs/SUBIR-VENDA-FINAL.md). Cinco passos:
//   1. Quem comprou — a pessoa (ficha única) + QUEM VAI JUNTO, com vínculo.
//      Vem pronto da pasta do cartão (o closer cadastra no cartão, ainda em
//      negociação — EditarQuemVai) e do contrato já enviado (venda_do_contrato);
//   2. O que vendeu — cartões do catálogo (TIPOS); o tipo do contrato já vem marcado;
//   3. Detalhes — campos de cada tipo + "Preencher pelo voucher" (IA) AQUI dentro.
//      EXPEDIÇÃO: BlocoExpedicao (vagas livres = vagas + quem já é desta venda);
//      venda SEM expedição: valor de cada pessoa (opcional);
//   4. Pagamento — valor de cada item e o pagamento em LINHAS (forma, valor, data,
//      parcelas; soma = total), condição especial, observações e a observação pro
//      Financeiro. Proposta anexada é OPCIONAL (nunca bloqueia);
//   5. Análise — extrato da análise pós-venda (0230) + quem participou da venda
//      (Marketing / SDR / Closer / Pós-venda, venda_blocos).
//
// Botões finais:
//   • Salvar           → venda_subir {acao:'salvar'} (em negociação não ocupa vaga);
//   • Reservar vaga    → venda_subir {acao:'reservar'} e, no closer, a pré-venda da
//                        0207 (marcarPreVenda: conta no Dashboard, Bitrix "Em emissão");
//   • Consolidar venda → confere as faltas aqui (mesma ideia da RPC), reserva se
//                        ainda estava em negociação e chama venda_consolidar; se o
//                        banco devolver `faltas`, mostra a lista e leva ao passo certo.
//   NUNCA chama marcarPreVenda em venda já consolidada.
//
// RASCUNHO DA TELA INTEIRA: tudo o que está na tela vai pro localStorage (por
// cartão/cliente) com espera de 1,5 s e, a cada gravação, junto da venda_subir
// (`rascunho` → qs_vendas.rascunho). Reabrir restaura; voltar entre passos nunca
// limpa nada. Os arquivos da proposta escolhidos e não enviados não entram no
// rascunho (o navegador não deixa guardar arquivo).
// TODO(sprint final): gravar qs_vendas.rascunho a cada 1,5 s precisa de uma RPC
// leve (ex.: venda_rascunho_salvar) — a qs_vendas não tem policy de escrita e
// chamar a venda_subir a cada tecla seria pesado. Até lá: localStorage + rascunho
// junto de cada Salvar/Reservar/Consolidar.
//
// Análise pós-venda (0230): ver src/venda/analise.ts e docs/ANALISE-POS-VENDA.md.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { Stepper } from "@/components/ui";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { ORDEM_TIPOS_VENDA, TIPOS, camposDoTipo, datasDoTipo, tipoVendaBitrix, type TipoItem } from "@/propostas/lib";
import { brl, emPreVenda, espelharNoBitrix, nomeDoLead, type Negocio } from "@/closer/lib";
import {
  itemPrincipal, itemVendaVazio, itensDaPropostaAprovada, listarItensDaVenda, marcarPreVenda, nomeSugerido,
  salvarItensDaVenda, somaDosItens, type ItemVenda, type ResultadoPreVenda,
} from "@/closer/vendaItens";
import {
  consolidarVenda, fichaDoComprador, itemDoVoucher, lerValor, lerVoucher, listarExpedicoesParaVenda, montarPayload, mostrarValor,
  passageirosDosItens, pessoaVazia, salvarRascunhoNoBanco, subirVenda, temModeloNovo, vendaDoContrato, vendaDoNegocio, viajanteNovo,
  type ExpedicaoVaga, type OrigemVenda, type PessoaVenda, type ResultadoVenda, type Viajante,
} from "./api";
import { completarPessoa, restaurarViajantes, viajantesParaJson, type AcompFicha, type PaxJson } from "./vendaRegras";
import {
  ESTADOS_VENDA, PASSO, VERSAO_RASCUNHO, chaveRascunho, escolherRascunho, estadoDaVenda, faltasParaConsolidar, juntarPessoas,
  lerRascunho, linhaVazia, linhasDoBanco, linhasDoLegado, linhasParaPayload, pagamentoLegadoDasLinhas, primeiroPassoDasFaltas,
  problemaDaLinha, quemSaiu, tirarPessoas, vagasParaEstaVenda,
  type EstadoVenda, type LinhaPagamento, type RascunhoTela,
} from "./vendaFinal";
import QuemViaja from "./QuemViaja";
import { familiaDoNegocio } from "./familia";
import DadosDaPessoaNaVenda from "./DadosDaPessoaNaVenda";
import BlocoExpedicao from "./BlocoExpedicao";
import CampoDoTipo from "./CampoDoTipo";
import ExtratoAnalise from "./ExtratoAnalise";
import PagamentoLinhas from "./PagamentoLinhas";
import BlocosDaVenda from "./BlocosDaVenda";
import { STATUS_ANALISE, abrirPedidoSem0230, analisarRascunho, analisarVendaGravada, type Analise } from "./analise";
import { anexarPropostas, desfazerAnexos, listarPropostasDaVenda, vincularPropostas, type PropostaAnexada } from "./propostaAnexo";
import { CampoPropostaVenda } from "./PropostasAnexadas";

const PASSOS = ["Quem comprou", "O que vendeu", "Detalhes", "Pagamento", "Análise"] as const;
const PASSO_ANALISE = PASSO.analise;

// localStorage pode não existir / estar cheio / bloqueado (aba anônima): nunca derruba a tela.
const lsLer = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsGravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem espaço: segue sem rede */ } };
const lsApagar = (k: string) => { try { localStorage.removeItem(k); } catch { /* idem */ } };
const horaBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

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

type Acao = "salvar" | "reservar" | "consolidar";

export default function SubirVenda({ origem, aberto, onFechar, onSalvo, negocio, cliente, viagemId }: SubirVendaProps) {
  const [passo, setPasso] = useState(0);
  const [pessoa, setPessoa] = useState<PessoaVenda>(pessoaVazia);
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [viajantes, setViajantes] = useState<Record<string, Viajante[]>>({});
  // Quem vai junto (sem o comprador): passo 1. Sem expedição, é a lista que vai pra venda_subir (item "pivô").
  const [outros, setOutros] = useState<Viajante[]>([]);
  const [linhas, setLinhas] = useState<LinhaPagamento[]>(() => [linhaVazia()]);
  const [obsFin, setObsFin] = useState("");
  const [especial, setEspecial] = useState(false);
  const [especialObs, setEspecialObs] = useState("");
  const [obs, setObs] = useState("");
  const [expedicoes, setExpedicoes] = useState<ExpedicaoVaga[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [lendoVoucher, setLendoVoucher] = useState(false);
  const [salvando, setSalvando] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<{ tom: "ok" | "aviso"; t: string; lista?: string[] } | null>(null);
  const [faltas, setFaltas] = useState<string[] | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // Venda gravada: id, estado (negociação/reservada/consolidada) e se o banco já tem o modelo da sprint final.
  const [vendaId, setVendaId] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoVenda>("negociacao");
  const [modeloNovo, setModeloNovo] = useState(false);
  // Rascunho: só grava depois de carregar (senão a tela vazia apagaria o rascunho bom).
  const [pronto, setPronto] = useState(false);
  const [restaurado, setRestaurado] = useState<{ de: "aparelho" | "banco"; em: string } | null>(null);
  const [recarga, setRecarga] = useState(0);
  const ignorarRascunho = useRef(false);
  // Análise pós-venda (passo 5)
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState<string | null>(null);
  // Proposta enviada ao cliente (0295, agora OPCIONAL): as já anexadas no cartão + as escolhidas agora
  const [propostasJa, setPropostasJa] = useState<PropostaAnexada[]>([]);
  const [propostasNovas, setPropostasNovas] = useState<File[]>([]);
  // Campos de quem comprou que vieram da ficha única (só pra avisar "já veio preenchido").
  const [daFicha, setDaFicha] = useState<string[]>([]);

  const ehCloser = origem === "closer" && !!negocio;
  const jaPreVenda = negocio ? emPreVenda(negocio) : false;
  const consolidada = estado === "consolidada";
  const pessoaTravada = !ehCloser && !!cliente?.id;
  const chaveLocal = chaveRascunho({ origem, negocioId: ehCloser ? negocio!.id : null, clienteId: cliente?.id ?? null, viagemId });

  // ── Abrir: traz TUDO o que já foi digitado (Bruno 09/11: "digitar uma vez só") ──
  //   • closer: itens salvos (ou a proposta aprovada) + a venda gravada (qs_vendas:
  //     linhas de pagamento, condição especial, observações, estado) — reabrir não zera nada;
  //   • quem comprou: lead + ficha única (rel_clientes) + contrato enviado, só no vazio;
  //   • quem vai: pasta do cartão (venda_familia) + lista da expedição/item + contrato;
  //   • por cima de tudo, o rascunho da tela (aparelho ou banco), se for mais novo.
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCarregando(true); setPronto(false); setErro(null); setInfo(null); setFaltas(null); setPasso(0);
    setLinhas([linhaVazia()]); setObsFin(""); setEspecial(false); setEspecialObs(""); setObs("");
    setAnalise(null); setErroAnalise(null); setRestaurado(null);
    setPropostasJa([]); setPropostasNovas([]); setDaFicha([]); setOutros([]); setVendaId(null);
    if (ehCloser) listarPropostasDaVenda({ negocioId: negocio!.id }).then((l) => vivo && setPropostasJa(l)).catch(() => undefined);
    const base = pessoaVazia();
    if (negocio?.lead) Object.assign(base, { nome: nomeDoLead(negocio.lead), telefone: negocio.lead.phone ?? "", email: negocio.lead.email ?? "" });
    if (cliente) Object.assign(base, Object.fromEntries(Object.entries(cliente).map(([k, v]) => [k, v ?? ""])), { id: cliente.id ?? null });
    setPessoa(base);
    (async () => {
      let lista: ItemVenda[] = [];
      const avisos: string[] = [];
      const [venda, novo, contrato] = await Promise.all([
        ehCloser ? vendaDoNegocio(negocio!.id).catch(() => null) : Promise.resolve(null),
        temModeloNovo(),
        ehCloser ? vendaDoContrato(negocio!.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (ehCloser) {
        lista = await listarItensDaVenda(negocio!.id);
        if (!lista.length) {
          const p = await itensDaPropostaAprovada(negocio!.lead_id).catch(() => null);
          if (p) { lista = p.itens; avisos.push(`Já trouxe os itens da ${p.origem}. Confira e ajuste o que mudou.`); }
        }
      }
      // Ficha única de quem comprou: a da venda gravada → a ligada ao lead → a do cliente aberto.
      const ficha = await fichaDoComprador({ clienteId: venda?.cliente_id ?? cliente?.id ?? null, leadId: negocio?.lead_id ?? null });
      let pessoaFinal = completarPessoa(base, ficha);
      // Contrato enviado: completa quem comprou (só o vazio).
      const doContrato = contrato?.pessoas ?? [];
      const compContrato = doContrato.find((x) => x.comprador);
      if (compContrato) pessoaFinal = completarPessoa(pessoaFinal, compContrato);
      const veio = (["telefone", "email", "cpf", "nascimento"] as const)
        .filter((k) => !String(base[k] ?? "").trim() && String(pessoaFinal[k] ?? "").trim());
      // Viajantes: o mais completo que der pra ler.
      const exps = lista.filter((i) => i.tipo === "expedicao");
      const linhasPax = await passageirosDosItens(exps.map((i) => i.id).filter((x): x is string => !!x));
      const acomps: AcompFicha[] = ficha?.acompanhantes ?? [];
      let dividiu = false;
      const vjs: Record<string, Viajante[]> = Object.fromEntries(exps.map((i) => {
        const r = restaurarViajantes({
          item: i, linhas: i.id ? linhasPax[i.id] : [], compradorClienteId: venda?.cliente_id ?? ficha?.id ?? null,
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
      // A pasta do cartão (venda_familia): quem o closer cadastrou em "Quem vai" + quem assina pelo menor.
      const fam = ehCloser ? await familiaDoNegocio(negocio!.id).catch(() => null) : null;
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
      // "Quem vai" do passo 1: contrato (base) ← pasta do cartão ← lista do item ← lista da expedição (a mais completa manda).
      const doContratoVs: Viajante[] = doContrato.filter((x) => !x.comprador).map((x) => ({
        ...viajanteNovo(false, x.nome), cpf: x.cpf, nascimento: x.nascimento, email: x.email, telefone: x.telefone, vinculo: x.vinculo,
      }));
      const daPasta: Viajante[] = (fam?.pessoas ?? []).filter((x) => !x.comprador && !x.removida_em && x.nome).map((x) => ({
        ...viajanteNovo(false, x.nome ?? ""), cliente_id: x.cliente_id, cpf: x.cpf ?? "", nascimento: (x.nascimento ?? "").slice(0, 10),
        email: x.email ?? "", telefone: x.telefone ?? "", vinculo: (x.vinculo ?? "") as Viajante["vinculo"],
      }));
      let quemVai = juntarPessoas(daPasta, doContratoVs, true);
      quemVai = juntarPessoas(vOutros, quemVai, true);
      const exp1 = exps[0] ? vjs[exps[0].k] ?? [] : [];
      quemVai = juntarPessoas(exp1, quemVai, true);
      // Venda sem expedição: a lista do item manda nas chaves (é ela que vai pra venda_subir).
      const outrosFinal = quemVai.filter((v) => !v.comprador);

      // O que vendeu: o tipo do contrato já vem marcado (só se ainda não tem nada).
      if (!lista.length && contrato?.tipo) {
        const it = itemVendaVazio(contrato.tipo);
        if (contrato.tipo === "expedicao" && contrato.expedicao_id) it.dados = { ...it.dados, expedicao_id: contrato.expedicao_id };
        if (contrato.tipo !== "expedicao" && contrato.valor) it.valor = contrato.valor;
        lista = [it];
        if (contrato.tipo === "expedicao") vjs[it.k] = [viajanteNovo(true), ...outrosFinal.map((v) => ({ ...v }))];
      }
      if (contrato && (doContrato.length || contrato.tipo)) {
        avisos.push(`Trouxe do contrato enviado: ${[doContrato.length ? `${doContrato.length} pessoa(s)` : "", contrato.tipo ? TIPOS[contrato.tipo].rotulo : ""].filter(Boolean).join(" e ")}. Confira.`);
      }

      // Pagamento em linhas: as gravadas → o `pagamento` antigo convertido → 1 linha vazia.
      const totalGravado = somaDosItens(lista);
      const linhasIni = venda?.pagamentos?.length ? linhasDoBanco(venda.pagamentos)
        : venda ? linhasDoLegado(venda.pagamento, totalGravado) : [linhaVazia()];
      const est = estadoDaVenda(venda?.estado, { consolidada: !!negocio?.consolidada_em, preVenda: jaPreVenda });

      if (venda) avisos.push(`Esta venda já está gravada (${ESTADOS_VENDA[est].rotulo.toLowerCase()}): tudo veio como estava. Mude só o que precisar.`);
      if (dividiu) avisos.push("O valor de cada viajante não estava guardado: dividi o total da expedição igualmente. Confira o valor de cada um.");
      if (!vivo) return;

      setModeloNovo(novo);
      setEstado(est);
      setVendaId(venda?.id ?? null);
      setPessoa(pessoaFinal);
      setDaFicha([...veio]);
      if (venda) {
        setEspecial(venda.condicao_especial); setEspecialObs(venda.condicao_obs); setObs(venda.observacoes);
        setObsFin(venda.obs_financeiro || venda.pagamento.obs || "");
      }
      setLinhas(linhasIni);
      setItens(lista);
      setValores(Object.fromEntries(lista.map((i) => [i.k, mostrarValor(i.valor)])));
      setViajantes(vjs);
      setOutros(outrosFinal);

      // Rascunho da tela: o do aparelho (não gravado) ou o do banco, se for mais novo que a venda gravada.
      const pick = ignorarRascunho.current ? null
        : escolherRascunho(lerRascunho(lsLer(chaveLocal)), lerRascunho(venda?.rascunho), venda?.atualizado_em);
      ignorarRascunho.current = false;
      if (pick) {
        const r = pick.r;
        setPessoa(pessoaTravada ? pessoaFinal : r.pessoa);
        setItens(r.itens as ItemVenda[]);
        setValores(r.valores); setViajantes(r.viajantes); setOutros(r.outros.filter((v) => !v.comprador));
        setLinhas(r.linhas.length ? r.linhas : [linhaVazia()]);
        setEspecial(r.especial); setEspecialObs(r.especialObs); setObs(r.obs); setObsFin(r.obsFin);
        setPasso(r.passo);
        setRestaurado({ de: pick.de, em: r.salvo_em });
      }
      if (avisos.length) setInfo({ tom: dividiu ? "aviso" : "ok", t: avisos[0], lista: avisos.slice(1) });
      setPronto(true);
    })().catch((e) => vivo && setErro((e as Error).message)).finally(() => vivo && setCarregando(false));
    listarExpedicoesParaVenda().then((l) => vivo && setExpedicoes(l)).catch((e) => vivo && (setExpedicoes([]), setErro((e as Error).message)));
    return () => { vivo = false; };
  }, [aberto, negocio?.id, recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiposMarcados = useMemo(() => new Set(itens.map((i) => i.tipo)), [itens]);
  // Valor final de cada item: expedição = soma de quem viaja; o resto = o que foi digitado.
  const comValores = itens.map((i) => ({ ...i, valor: i.tipo === "expedicao" ? i.valor : lerValor(valores[i.k] ?? "") }));
  const total = somaDosItens(comValores);
  const principal = itemPrincipal(comValores);
  // 0351: venda sem expedição → "Quem vai" vale pra venda toda e vai no 1º item que não é expedição.
  const temExpedicao = itens.some((i) => i.tipo === "expedicao");
  const pivo = temExpedicao ? null : itens.find((i) => i.tipo !== "expedicao") ?? null;
  const acompOutros = outros.filter((v) => !v.comprador);
  const dataViagem = itens.map((i) => i.data_inicio).filter(Boolean).sort()[0] ?? null;

  // ── Rascunho: guarda a tela inteira 1,5 s depois da última mudança ──
  function montarRascunho(): RascunhoTela {
    return {
      v: VERSAO_RASCUNHO, salvo_em: new Date().toISOString(), passo: Math.min(passo, PASSO.pagamento),
      pessoa, itens, valores, viajantes, outros, linhas, especial, especialObs, obs, obsFin,
    };
  }
  // Foto da tela logo depois de abrir: só guarda rascunho quando a pessoa MUDA algo (senão
  // todo reabrir mostraria "voltei com o que você preenchia" sem ninguém ter digitado nada).
  const fotoAoAbrir = useRef("");
  useEffect(() => { if (!pronto) fotoAoAbrir.current = ""; }, [pronto]);
  useEffect(() => {
    if (!aberto || carregando || !pronto) return;
    const { salvo_em: _s, ...sem } = montarRascunho();
    const agora = JSON.stringify(sem);
    if (!fotoAoAbrir.current) { fotoAoAbrir.current = agora; return; }
    if (agora === fotoAoAbrir.current) return;
    const t = window.setTimeout(() => {
      const r = montarRascunho();
      lsGravar(chaveLocal, JSON.stringify(r));
      // Closer com o banco novo (0357): o rascunho também vai pro qs_vendas.rascunho —
      // sobrevive a trocar de computador. Falha aqui nunca atrapalha (o aparelho já guardou).
      if (ehCloser && modeloNovo && negocio?.id) void salvarRascunhoNoBanco(negocio.id, r).catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [aberto, carregando, pronto, passo, pessoa, itens, valores, viajantes, outros, linhas, especial, especialObs, obs, obsFin]); // eslint-disable-line react-hooks/exhaustive-deps

  function descartarRascunho() {
    if (!window.confirm("Descartar o que estava preenchido e voltar pro que está gravado?")) return;
    lsApagar(chaveLocal);
    ignorarRascunho.current = true;
    setRecarga((n) => n + 1);
  }

  const mudarItem = (k: string, p: Partial<ItemVenda>) => setItens((l) => l.map((i) => (i.k === k ? { ...i, ...p } : i)));
  const mudarDado = (k: string, chave: string, v: string) => setItens((l) => l.map((i) => (i.k === k ? { ...i, dados: { ...i.dados, [chave]: v } } : i)));

  /** Quem sai do passo 1 sai também da lista da expedição (e a vaga volta ao salvar). */
  function mudarOutros(novos: Viajante[]) {
    const saiu = quemSaiu(outros, novos);
    setOutros(novos.filter((v) => !v.comprador));
    if (saiu.length) setViajantes((m) => Object.fromEntries(Object.entries(m).map(([k, vs]) => [k, tirarPessoas(vs, saiu)])));
  }
  /** Quem sai da expedição sai também do passo 1. */
  function mudarViajantesExp(k: string, novos: Viajante[]) {
    const saiu = quemSaiu(viajantes[k] ?? [], novos);
    setViajantes((m) => ({ ...m, [k]: novos }));
    if (saiu.length) setOutros((o) => tirarPessoas(o, saiu));
  }

  function adicionar(t: TipoItem) {
    const novo = itemVendaVazio(t);
    setItens((l) => [...l, novo]);
    // Expedição nova já nasce com quem vai (passo 1): ninguém digita de novo.
    if (t === "expedicao") setViajantes((v) => ({ ...v, [novo.k]: [viajanteNovo(true), ...outros.map((o) => ({ ...o }))] }));
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

  // ── Voucher (frente ia-voucher) — agora dentro de Detalhes ──
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
      setInfo({ tom: r.avisos.length ? "aviso" : "ok", t: `O voucher preencheu ${novos.length} item(ns)${r.pessoas.length ? ` e ${r.pessoas.length} pessoa(s)` : ""}. Confira antes de salvar.`, lista: r.avisos });
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
    if (ate >= 0 && acompOutros.some((v) => v.nome.trim().length < 3)) return "Quem vai junto: escreva o nome de cada pessoa (ou tire quem não vai).";
    if (ate >= 0 && acompOutros.some((v) => v.cpf.trim() && v.cpf.replace(/\D/g, "").length !== 11)) return "CPF de quem vai junto: são 11 números (ou deixe em branco).";
    if (ate >= 1 && !itens.length) return "Toque em pelo menos um cartão: o que o cliente comprou?";
    if (ate >= 2) {
      const errado = itens.find((i) => i.data_inicio && i.data_fim && i.data_fim < i.data_inicio);
      if (errado) return `${TIPOS[errado.tipo].rotulo}: a segunda data está antes da primeira.`;
      for (const i of itens.filter((x) => x.tipo === "expedicao")) {
        const exp = expedicoes?.find((e) => e.id === i.dados.expedicao_id);
        if (!exp) return "Escolha qual expedição foi vendida.";
        const vs = viajantes[i.k] ?? [];
        // Vagas livres pra ESTA venda = vagas da expedição + quem já é desta venda (reabrir não trava).
        const livres = vagasParaEstaVenda(exp.vagas, vs);
        if (vs.length > livres) return `${exp.nome}: só ${livres} vaga(s) pra esta venda. Peça pro Operacional abrir vaga.`;
        if (vs.some((v) => !v.comprador && v.nome.trim().length < 3)) return "Escreva o nome de quem viaja junto.";
        if (vs.some((v) => !lerValor(v.valor_contratado))) return "Coloque o valor que cada pessoa paga na expedição.";
        if (vs.some((v) => v.valor_pago.trim() && lerValor(v.valor_pago) == null)) return "Valor pago que não entendi. Use só números, ex.: 2.500,00";
        if (vs.some((v) => v.divide === "t" && !v.divide_nome.trim())) return "Escreva o nome de quem divide o quarto.";
        if (vs.some((v) => !v.comprador && v.cpf.trim() && v.cpf.replace(/\D/g, "").length !== 11)) return "CPF de quem viaja junto: são 11 números (ou deixe em branco).";
      }
      if (pivo && acompOutros.some((v) => v.valor_contratado.trim() && lerValor(v.valor_contratado) == null)) return "Valor de acompanhante que não entendi. Use só números, ex.: 2.500,00";
    }
    if (ate >= 3) {
      const ruim = itens.find((i) => i.tipo !== "expedicao" && (valores[i.k] ?? "").trim() && lerValor(valores[i.k]) == null);
      if (ruim) return `Valor que não entendi em ${TIPOS[ruim.tipo].rotulo}. Use só números, ex.: 12.500,00`;
      if (total <= 0) return "Coloque o valor de pelo menos um item (o total não pode ficar zerado).";
      for (const [n, l] of linhas.entries()) { const p = problemaDaLinha(l, n + 1); if (p) return p; }
      if (especial && especialObs.trim().length < 3) return "Condição especial: escreva qual é (ex.: ExpedAmigo, 10% off pago no Pix).";
      // Proposta anexada: OPCIONAL (sprint final, decisão 6) — nunca bloqueia.
    }
    return null;
  }

  /** Troca de passo SEM perder nada: leva quem vai (passo 1) pra expedição e traz de volta o que mudou lá. */
  function irPara(destino: number) {
    if (passo === 0 && destino > 0 && outros.length) {
      setViajantes((m) => Object.fromEntries(Object.entries(m).map(([k, vs]) => [k, juntarPessoas(outros, vs, true)])));
    }
    if (passo === 2 && destino !== 2) {
      const exp1 = itens.find((i) => i.tipo === "expedicao");
      if (exp1) setOutros((o) => juntarPessoas(viajantes[exp1.k] ?? [], o, true).filter((v) => !v.comprador));
    }
    setPasso(destino);
    if (destino === PASSO_ANALISE) void rodarAnalise();
  }

  function avancar() {
    const e = conferir(passo);
    setErro(e);
    if (e) return;
    irPara(Math.min(passo + 1, PASSOS.length - 1));
  }

  /** Itens como vão pro banco (expedição leva quem viaja COM todos os detalhes — reabrir não perde nada; o resto, o comprador se vier vazio). */
  function itensFinais(): ItemVenda[] {
    return comValores.map((i) => (i.tipo === "expedicao"
      ? { ...i, passageiros: viajantesParaJson(viajantes[i.k] ?? [], pessoa.nome) }
      // 0351: o item "pivô" guarda quem vai (reabrir não perde a família).
      : pivo && i.k === pivo.k && acompOutros.length
        ? { ...i, passageiros: viajantesParaJson(outrosComComprador(), pessoa.nome) }
        : { ...i, passageiros: i.passageiros.length && !(i.passageiros as PaxJson[]).some((x) => x?.chave) ? i.passageiros : [{ nome: pessoa.nome }] }));
  }
  /** "Quem vai" sempre com o comprador na frente (a venda_subir conta ele como titular). */
  function outrosComComprador(): Viajante[] {
    return [viajanteNovo(true), ...acompOutros];
  }
  /** Viajantes por item como vão pra venda_subir (expedição + o pivô dos outros itens). */
  function viajantesFinais(): Record<string, Viajante[]> {
    return pivo && acompOutros.length ? { ...viajantes, [pivo.k]: outrosComComprador() } : viajantes;
  }
  /** Todos que vão junto (sem o comprador), pra conferir as faltas: expedições + passo 1, sem repetir. */
  function todosAcompanhantes(): Viajante[] {
    let todos = acompOutros;
    for (const i of itens.filter((x) => x.tipo === "expedicao")) todos = juntarPessoas(viajantes[i.k] ?? [], todos, true);
    return todos.filter((v) => !v.comprador);
  }

  /** A família como a análise espera: o comprador + quem vai junto, com os itens (ordem 1..n) onde cada um está. */
  function pessoasParaAnalise(final: ItemVenda[]) {
    const vjs = viajantesFinais();
    const todos = [viajanteNovo(true), ...todosAcompanhantes()];
    return todos.map((v) => {
      const itensDela = final.flatMap((i, n) => {
        const lista = vjs[i.k] ?? [];
        const esta = v.comprador ? true : lista.some((x) => !x.comprador && (x.chave === v.chave || (!!x.cliente_id && x.cliente_id === v.cliente_id) || x.nome.trim().toLowerCase() === v.nome.trim().toLowerCase()));
        return esta ? [n + 1] : [];
      });
      return {
        chave: v.chave, nome: v.comprador ? pessoa.nome : v.nome, vinculo: v.comprador ? null : v.vinculo || null,
        cpf: (v.comprador ? pessoa.cpf : v.cpf).replace(/\D/g, "") || null, nascimento: (v.comprador ? pessoa.nascimento : v.nascimento) || null,
        comprador: v.comprador, responsavel: v.comprador ? null : v.responsavel || null, itens: itensDela,
      };
    });
  }

  // ── 5. Análise pós-venda: a pessoa aguarda o extrato antes de concluir ──
  async function rodarAnalise() {
    setAnalisando(true); setErroAnalise(null);
    try {
      const final = itensFinais();
      const vjs = final.filter((i) => i.tipo === "expedicao").flatMap((i) => (viajantes[i.k] ?? []).map((v) => ({
        nome: v.comprador ? pessoa.nome : v.nome, valor_contratado: lerValor(v.valor_contratado), valor_pago: lerValor(v.valor_pago) ?? 0,
      })));
      const leg = pagamentoLegadoDasLinhas(linhas, obsFin);
      setAnalise(await analisarRascunho({
        origem, negocio_id: ehCloser ? negocio!.id : null, cliente_id: pessoa.id || null, viagem_id: viagemId ?? null,
        cliente: { nome: pessoa.nome },
        itens: final.map((i) => ({ tipo: i.tipo, nome: i.nome.trim() || nomeSugerido(i), data_inicio: i.data_inicio || null, data_fim: i.data_fim || null, dados: i.dados, passageiros: i.passageiros.map((x) => ({ nome: x.nome })), valor: i.valor, custo: i.custo, status: i.status ?? "vendido" })),
        viajantes: vjs,
        pagamento: { forma: leg.forma, condicao: leg.condicao, entrada: lerValor(leg.entrada), entrada_data: leg.entrada_data || null, parcelas: Number(leg.parcelas) || null },
        total,
        // Sprint final: a análise confere soma × total e a família (vínculo, CPF, nascimento, pessoa sem item).
        pagamentos: linhasParaPayload(linhas).map(({ forma, valor, data, parcelas, obs }) => ({ forma, valor, data, parcelas, obs })),
        pessoas: pessoasParaAnalise(final),
      }));
    } catch (e) {
      setAnalise(null);
      setErroAnalise(`${(e as Error).message} Dá pra salvar mesmo assim — a análise roda de novo no painel "Vendas com pendência".`);
    } finally {
      setAnalisando(false);
    }
  }

  /** Depois de gravar: guarda a análise na venda e abre a solicitação pro Rel se falta algo. Nunca derruba a venda. */
  async function guardarAnalise(id: string): Promise<string> {
    try {
      const a = await analisarVendaGravada(id, "subir_venda", analise);
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

  /** Grava a venda inteira (venda_subir) com as propostas novas; se a venda falhar, os anexos somem. */
  async function gravarVenda(acao: "salvar" | "reservar"): Promise<{ r: ResultadoVenda; aviso: string }> {
    const final = itensFinais();
    const novosIds = propostasNovas.length
      ? await anexarPropostas(propostasNovas, { negocioId: ehCloser ? negocio!.id : null, clienteId: pessoa.id || null })
      : [];
    let r: ResultadoVenda;
    try {
      r = await subirVenda(montarPayload({
        origem, negocio_id: ehCloser ? negocio!.id : null, viagem_id: viagemId ?? null,
        cliente: pessoa, itens: final, viajantes: viajantesFinais(),
        pagamento: pagamentoLegadoDasLinhas(linhas, obsFin), pagamentos: linhasParaPayload(linhas), obs_financeiro: obsFin,
        condicao_especial: especial, condicao_obs: especialObs, observacoes: obs,
        acao, rascunho: montarRascunho(), venda_id: vendaId,
      }, nomeSugerido));
    } catch (e) {
      await desfazerAnexos(novosIds).catch(() => undefined); // venda não gravou: não deixa a proposta solta
      throw e;
    }
    let aviso = "";
    if (r.venda_id) {
      setVendaId(r.venda_id);
      const ids = [...novosIds, ...propostasJa.filter((a) => !a.venda_id).map((a) => a.id)];
      if (ids.length) await vincularPropostas(ids, r.venda_id).catch((e) => { aviso = ` Atenção: a proposta anexada não ficou amarrada na venda (${(e as Error).message}).`; });
    }
    setPropostasNovas([]);
    void listarPropostasDaVenda({ negocioId: ehCloser ? negocio!.id : null, vendaId: r.venda_id }).then(setPropostasJa).catch(() => undefined);
    if (r.estado) setEstado(estadoDaVenda(r.estado));
    lsApagar(chaveLocal); // está no banco (com o rascunho junto)
    const pax = (r.passageiros ? ` ${r.passageiros} passageiro(s) na expedição (o Operacional confirma).` : "")
      + ((r.pessoas ?? 0) > 1 ? ` Família: ${r.pessoas} pessoas na pasta da venda (cada uma ganha o card dela no Bitrix).` : "")
      + (r.familia_erro ? ` Atenção: a venda gravou, mas a lista da família não (${r.familia_erro}). Abra e salve de novo.` : "");
    return { r, aviso: pax + aviso };
  }

  async function executar(acao: Acao) {
    const e = conferir(3);
    if (e) { setErro(e); return; }
    setErro(null); setFaltas(null); setSalvando(acao);
    try {
      // ── Consolidar: confere tudo ANTES de gravar qualquer coisa ──
      if (acao === "consolidar") {
        const f = faltasParaConsolidar({
          comprador: pessoa, acompanhantes: todosAcompanhantes(), total, linhas,
          itens: itens.map((i) => ({ tipo: i.tipo, rotulo: TIPOS[i.tipo].rotulo, expedicaoEscolhida: i.tipo === "expedicao" ? !!i.dados.expedicao_id : undefined })),
        });
        if (f.length) { setFaltas(f); irPara(primeiroPassoDasFaltas(f)); return; }
        if (!modeloNovo) {
          setErro("Consolidar pela tela ainda não está ligado no banco (falta aplicar as migrations 0356–0358). Use \"Reservar vaga\" e depois \"Fechar a venda\" no cartão.");
          return;
        }
      }

      // ── Closer em banco antigo, ainda em negociação: "Salvar" só guarda os itens (não ocupa vaga) ──
      if (acao === "salvar" && ehCloser && !modeloNovo && estado === "negociacao" && !jaPreVenda) {
        await salvarItensDaVenda(negocio!.id, itensFinais());
        lsApagar(chaveLocal);
        onSalvo({ tom: "ok", mensagem: `Venda salva (${brl(total)}), ainda em negociação: não ocupa vaga nem conta no Dashboard. Quando fechar, use "Reservar vaga" ou "Consolidar venda".` });
        return;
      }

      const eraNegociacao = estado === "negociacao";
      const { r, aviso } = await gravarVenda(acao === "salvar" ? "salvar" : eraNegociacao ? "reservar" : "salvar");

      // ── Pré-venda (Dashboard + Bitrix "Em emissão"): ao reservar; NUNCA em venda consolidada ──
      let pv: ResultadoPreVenda | null = null;
      if (ehCloser && principal && !consolidada) {
        const mudou = jaPreVenda && (Math.abs(Number(negocio!.pre_venda_valor ?? 0) - total) > 0.009 || negocio!.pre_venda_tipo !== principal.tipo);
        const reservou = acao !== "salvar" && eraNegociacao;
        if (reservou || (acao === "salvar" && estado === "reservada" && mudou)) {
          pv = await marcarPreVenda(negocio!.id, { tipo: principal.tipo, valor: total })
            .catch((err: Error) => ({ tom: "aviso" as const, mensagem: `A venda gravou, mas o Dashboard não foi avisado agora (${err.message}). O QS tenta de novo sozinho.` }));
        }
      }
      if (acao !== "salvar" && eraNegociacao) setEstado("reservada");

      if (acao === "consolidar") {
        const c = await consolidarVenda(r.venda_id);
        if (!c.ok) {
          setFaltas(c.faltas);
          setInfo({ tom: "aviso", t: `A venda foi salva${eraNegociacao ? " e a vaga ficou reservada" : ""}, mas ainda não dá pra consolidar. Complete o que falta e tente de novo.` });
          irPara(primeiroPassoDasFaltas(c.faltas));
          return;
        }
        setEstado("consolidada");
        // Consolidou: o cartão (e os filhos da família) andam no Bitrix agora. Erro aparece; o cartão tem "Tentar agora".
        let bx = "";
        if (ehCloser) {
          const b = await espelharNoBitrix(negocio!.id).catch((err: Error) => ({ ok: false, status: "erro", mensagem: err.message }));
          if (b && !b.ok && b.status === "erro") bx = ` Gravado no QS, mas o Bitrix recusou: ${b.mensagem ?? "sem motivo"}. Use "Tentar agora" no cartão (o QS também tenta sozinho).`;
        }
        const an = await guardarAnalise(r.venda_id);
        onSalvo({ tom: bx || pv?.tom === "aviso" ? "aviso" : "ok", mensagem: `Venda consolidada! ${brl(r.total)} — a viagem nasce no Relacionamento e as contas a receber no Financeiro.${aviso}${an}${pv && pv.tom === "aviso" ? ` ${pv.mensagem}` : ""}${bx}` });
        return;
      }

      const an = acao === "reservar" || consolidada ? await guardarAnalise(r.venda_id) : "";
      if (pv) { onSalvo({ tom: pv.tom, mensagem: `${acao === "reservar" ? "Vaga reservada. " : ""}${pv.mensagem}${aviso}${an}` }); return; }
      const qual = acao === "reservar" ? "Vaga reservada: a venda já conta como venda." : consolidada ? "Alterações salvas na venda consolidada." : `Venda salva (${ESTADOS_VENDA[estado].rotulo.toLowerCase()}).`;
      onSalvo({ tom: "ok", mensagem: `${qual} ${r.itens} item(ns), ${brl(r.total)}.${aviso}${an}` });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  const ultimo = passo === PASSOS.length - 1;
  const ocupado = salvando !== null;
  const titulo = `Subir venda${pessoa.nome ? ` — ${pessoa.nome}` : ""}`;
  return (
    <Modal aberto={aberto} titulo={titulo} onFechar={onFechar} largura={880}
      rodape={<>
        {passo > 0 ? <Botao variante="fantasma" onClick={() => { setErro(null); irPara(passo - 1); }} disabled={ocupado}>← Voltar</Botao>
          : <Botao variante="fantasma" onClick={onFechar} disabled={ocupado} title="Nada se perde: o que você preencheu fica guardado">Fechar</Botao>}
        {!ultimo && <Botao variante="primario" onClick={avancar} disabled={carregando}>Continuar →</Botao>}
        {ultimo && (
          <Botao variante="fantasma" onClick={() => void rodarAnalise()} disabled={analisando || ocupado} title="Roda a conferência de novo">Reanalisar</Botao>
        )}
        {ultimo && (
          <Botao variante={estado === "negociacao" ? "fantasma" : consolidada ? "primario" : "secundario"} onClick={() => void executar("salvar")} disabled={ocupado}
            title={estado === "negociacao" ? "Guarda tudo; ainda não ocupa vaga nem conta como venda" : "Grava as mudanças"}>
            {salvando === "salvar" ? "Salvando…" : consolidada ? "Salvar alterações" : "Salvar"}
          </Botao>
        )}
        {ultimo && estado === "negociacao" && (
          <Botao variante="secundario" onClick={() => void executar("reservar")} disabled={ocupado || analisando}
            title={ehCloser ? "Ocupa a vaga, conta como venda no Dashboard e o Bitrix vai pra Em emissão" : "Ocupa a vaga e grava a venda"}>
            {salvando === "reservar" ? "Reservando…" : "Reservar vaga"}
          </Botao>
        )}
        {ultimo && !consolidada && (
          <Botao variante="primario" onClick={() => void executar("consolidar")} disabled={ocupado || analisando}
            title="Só com tudo preenchido: pessoas com vínculo, itens, detalhes e pagamento que fecha com o total. Gera a viagem no Relacionamento e as contas no Financeiro.">
            {salvando === "consolidar" ? "Consolidando…" : analise && analise.status !== "tudo_emitido" ? "Consolidar com pendência" : "Consolidar venda"}
          </Botao>
        )}
      </>}>
      <div className="mb-4"><Stepper steps={PASSOS} current={passo} /></div>
      <input ref={arquivo} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => void usarVoucher(e.target.files?.[0])} />

      {carregando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : <>
        {(vendaId || estado !== "negociacao") && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>
            <Etiqueta tom={ESTADOS_VENDA[estado].tom}>{ESTADOS_VENDA[estado].rotulo}</Etiqueta>
            {estado === "negociacao" && <span>Ainda não ocupa vaga nem conta como venda.</span>}
            {estado === "reservada" && <span>A vaga está ocupada e já conta como venda. Falta consolidar.</span>}
          </div>
        )}
        {restaurado && (
          <div className="mb-3">
            <Aviso tom="ok">
              Voltei com o que você estava preenchendo ({restaurado.de === "aparelho" ? "guardado neste aparelho" : "guardado na venda"} em {horaBr(restaurado.em)}).{" "}
              <button type="button" className="underline font-semibold" onClick={descartarRascunho}>Descartar e usar o que está gravado</button>
            </Aviso>
          </div>
        )}
        {info && (
          <div className="mb-3">
            <Aviso tom={info.tom}>
              {info.t}
              {info.lista && info.lista.length > 0 && <ul className="list-disc pl-5 mt-1">{info.lista.map((a) => <li key={a}>{a}</li>)}</ul>}
            </Aviso>
          </div>
        )}
        {faltas && faltas.length > 0 && (
          <div className="mb-3">
            <Aviso tom="erro">
              <b>Pra consolidar, falta:</b>
              <ul className="list-disc pl-5 mt-1">
                {faltas.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </Aviso>
          </div>
        )}

        {/* ── 1. Quem comprou + quem vai junto ── */}
        {passo === 0 && (
          <div className="space-y-4">
            <DadosDaPessoaNaVenda pessoa={pessoa} onMudar={setPessoa} travada={pessoaTravada} daFicha={daFicha} />
            <QuemViaja modo="pessoas" viajantes={outros} nomeComprador={pessoa.nome} dataViagem={dataViagem} totalVenda={total} onViajantes={mudarOutros} />
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

        {/* ── 3. Detalhes (com o voucher/IA aqui dentro) ── */}
        {passo === 2 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rel-card p-3">
              <span className="text-[13px] flex-1 min-w-[200px]" style={{ color: "var(--ink2)" }}>
                <b>Tem o voucher, bilhete ou reserva?</b> Mande o PDF ou a foto e a IA preenche os detalhes pra você conferir.
              </span>
              <Botao onClick={() => arquivo.current?.click()} disabled={lendoVoucher}>{lendoVoucher ? "Lendo o voucher…" : "📄 Preencher pelo voucher"}</Botao>
            </div>
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
                      onItem={(p) => mudarItem(i.k, p)} onViajantes={(v) => mudarViajantesExp(i.k, v)} />
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
            {/* Venda sem expedição: o valor de cada pessoa (opcional) — quem vai se muda no passo 1. */}
            {pivo && (
              <QuemViaja modo="valores" viajantes={outros} nomeComprador={pessoa.nome} dataViagem={dataViagem} totalVenda={total} onViajantes={mudarOutros} />
            )}
          </div>
        )}

        {/* ── 4. Pagamento ── */}
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

            <div className="rel-card p-4 space-y-3">
              <div>
                <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Como vai pagar?</p>
                <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Uma linha pra cada forma (ex.: entrada no Pix + resto no cartão em 10x). A soma tem que dar o total pra consolidar.</p>
              </div>
              <PagamentoLinhas linhas={linhas} total={total} onLinhas={setLinhas} />
              <Campo rotulo="Observação para o Financeiro" dica="Ex.: boleto todo dia 10, parte no cartão da mãe, Pix do sinal já caiu.">
                <textarea className="rel-input" rows={2} value={obsFin} onChange={(e) => setObsFin(e.target.value)} />
              </Campo>
            </div>

            <div className="rel-card p-4 grid grid-cols-1 gap-3">
              <label className="flex items-center gap-2 text-[13.5px] font-semibold cursor-pointer" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={especial} onChange={(e) => setEspecial(e.target.checked)} />
                Condição especial (ExpedAmigo, desconto, cortesia parcial…)
              </label>
              {especial && (
                <Campo rotulo="Qual condição? *"><Entrada value={especialObs} onChange={(e) => setEspecialObs(e.target.value)} placeholder="Ex.: ExpedAmigo — indicou a Ana, 5% off" /></Campo>
              )}
              <Campo rotulo="Observações pra quem vem depois" dica="Relacionamento e Operacional leem.">
                <textarea className="rel-input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
              </Campo>
            </div>

            <CampoPropostaVenda jaAnexadas={propostasJa} novos={propostasNovas} obrigatorio={false} onNovos={(f) => { setPropostasNovas(f); setErro(null); }} />
          </div>
        )}

        {/* ── 5. Análise ── */}
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
                    Dá pra seguir assim.{" "}
                    {origem === "rel"
                      ? <>A venda fica em <b>Vendas com pendência</b> com este extrato pra você emitir.</>
                      : <>Ao reservar ou consolidar, abre uma <b>solicitação pro Relacionamento</b> com {analise.contagens.falta ? <>as <b>{analise.contagens.falta}</b> emissão(ões) que faltam</> : "as divergências"} — e a venda fica com o status <b>{STATUS_ANALISE[analise.status]?.rotulo}</b> até tudo bater.</>}
                    {" "}Se algo está errado na venda, volte e corrija antes.
                  </Aviso>
                )}
              </>
            ) : erroAnalise ? <Aviso>{erroAnalise}</Aviso> : null}
            <BlocosDaVenda vendaId={vendaId} />
            <div className="rel-card p-3 text-[12.5px] space-y-1" style={{ color: "var(--ink2)" }}>
              <p><b>Salvar</b>: guarda tudo{estado === "negociacao" ? " — ainda não ocupa vaga nem conta como venda" : ""}.</p>
              {estado === "negociacao" && <p><b>Reservar vaga</b>: ocupa a vaga{ehCloser ? ", conta como venda no Dashboard e o Bitrix vai pra Em emissão" : ""}. Não expira.</p>}
              {!consolidada && <p><b>Consolidar venda</b>: só com tudo preenchido (pessoas com vínculo, itens, detalhes e pagamento que fecha com o total). Gera a viagem no Relacionamento e as contas no Financeiro.</p>}
            </div>
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
