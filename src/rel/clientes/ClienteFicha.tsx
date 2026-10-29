// src/rel/clientes/ClienteFicha.tsx
// -----------------------------------------------------------------------------
// A FICHA DO CLIENTE — o lugar da pessoa no Relacionamento e no Operações
// (cadastro único, 0172/0173/0213).
//
// Redesenho de 29/10 (docs/ref/qs-redesign-ficha-solicitacoes.md, seção 3):
//   breadcrumb → cabeçalho (nome limpo + tags, chips, alertas, ações + "Mais
//   ações") → indicadores → duas colunas: [Pronta para embarcar? + abas] e a
//   lateral (Contato, Pessoas ligadas, Origem, LGPD, Observações).
// A aba ativa vai pra URL: #rel/cliente/<id>?aba=documentos (src/lib/hashQuery).
//
// Onde foi parar cada ação da ficha antiga (nenhuma sumiu):
//   Registrar contato ........ botão primário do cabeçalho (e aba Atendimento)
//   Pedir a outro setor ...... botão do cabeçalho (e estado vazio de Atendimento)
//   WhatsApp (abrir/mandar) .. botão do cabeçalho; Contato da lateral (wa.me/ligar); aba Atendimento
//   + Oportunidade de venda .. Mais ações › Vendas
//   Subir venda .............. Mais ações › Vendas
//   Pedir pagamento .......... Mais ações › Financeiro
//   Enviar ao Financeiro ..... Mais ações › Financeiro
//   Abrir chamado ............ Mais ações › Atendimento (e na lista de chamados)
//   Editar / Completar ....... Mais ações › Cadastro, "Preencher agora", "Registrar aceite" (LGPD)
//   + Adicionar familiar ..... Pessoas ligadas (lateral) e Mais ações › Cadastro
//   Endereço e quem viaja junto  card Endereço (Visão geral) e Pessoas ligadas › Quem viaja junto
//   Desarquivar / abrir a ficha que ficou  avisos no topo (iguais)
//   Divergências ficha × expedição  FilaDivergencias, logo abaixo dos indicadores (igual)
//   Status no Financeiro e Solicitações do cliente  aba Atendimento
//   De onde veio e onde aparece (0151)  Origem (lateral) + aba Histórico
//   Histórico da ficha ....... aba Histórico (linha do tempo completa)
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import {
  carregarCliente, carregarFamilia, carregarHistorico, CANAIS_CONTATO, REGRAS_PADRAO, carregarRegras,
  listarContatos, metricaDoCliente, moeda, carregarLigacoes, completude, formatarData,
  type LigacoesCliente, type Auditoria, type Cliente, type Contato, type Metrica, type RegrasCategorias,
} from "../lib/clientes";
import { linkBitrix, type Viagem } from "../lib/viagens";
import ViagensComAGente from "./ViagensComAGente";
import ArquivosDoCliente from "./ArquivosDoCliente";
import ContatoModal from "./ContatoModal";
import { categoriasDe } from "./KpisClientes";
import { Aviso, Botao, Etiqueta, Modal } from "../ui";
import ClienteForm from "./ClienteForm";
import SubirVenda from "@/venda/SubirVenda";
import type { ResultadoPreVenda } from "@/closer/vendaItens";
import ModeloModal from "../atendimento/ModeloModal";
import DocumentosPainel from "../viagens/DocumentosPainel";
import ExpedicoesDaFicha, { type AbrirExpedicao, type EstadoIdas } from "./ExpedicoesDaFicha";
import ArquivosDasExpedicoes from "./ArquivosDasExpedicoes";
import LigacoesDoCliente from "./LigacoesDoCliente";
import FilaDivergencias from "@/clientes/FilaDivergencias";
import { idasDaFicha } from "@/clientes/cadastroUnico";
import { detalharIdas, faltaCadastroUnico, type IdaDetalhada } from "@/clientes/idasDetalhe";
import ChamadosDoCliente from "../chamados/ChamadosDoCliente";
import ChamadoModal from "../chamados/ChamadoModal";
import NovaOportunidade from "../vendas/NovaOportunidade";
import { EnviarFinanceiroModal, StatusNoFinanceiro } from "../../fin/EnviarFinanceiro";
import { HistoricoDeSolicitacoes } from "@/solicitacoes/PedirOutroSetor";
import NovaSolicitacao from "@/solicitacoes/NovaSolicitacao";
import { solicitacoesDe, type Solicitacao } from "@/solicitacoes/lib";
import { conversasDoCliente, duracao, horaCurta, type Conversa } from "../lib/whatsapp";
import ComprasDoCliente from "@/clientes/ComprasDoCliente";
import ExpedAmigoDoCliente from "@/clientes/ExpedAmigoDoCliente";
import CadastroPessoa from "@/clientes/cadastro/CadastroPessoa";
import { lerPessoa, type Pessoa } from "@/clientes/cadastro";
import { nivelFidelidade } from "@/expedicoes/lib/fidelidade";
import { todasDoCliente } from "./viagensCliente";
import {
  Avatar, Btn, Card, EmptyState, FilterPill, Menu, StatCard, StatusChip, Timeline, parseClientName, type MenuGrupo,
} from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";
import ProntaParaEmbarcar from "./ficha/ProntaParaEmbarcar";
import VisaoGeral, { resumoEndereco } from "./ficha/VisaoGeral";
import LateralFicha from "./ficha/LateralFicha";
import { linhaDoTempo, proximaViagem, statusDaViagem, trilha } from "./ficha/dados";
import { ITENS_PEDIVEIS, pedirItem } from "./ficha/pedirACliente";
import "./ficha/ficha.css";

// 23/10 (cadastro único): a ficha é O lugar da pessoa — tudo que estava espalhado
// (Clube de viajantes, Clientes & compras, Acessos ExpedAmigo, passageiro) virou aba.
type Aba = "geral" | "viagens" | "compras" | "documentos" | "expedamigo" | "atendimento" | "historico";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "geral", rotulo: "Visão geral" },
  { id: "viagens", rotulo: "Viagens" },
  { id: "compras", rotulo: "Compras" },
  { id: "documentos", rotulo: "Documentos" },
  { id: "expedamigo", rotulo: "ExpedAmigo" },
  // Atendimento: WhatsApp/contatos/chamados só pro Relacionamento (0173); as
  // solicitações e o status no Financeiro, pros dois setores.
  { id: "atendimento", rotulo: "Atendimento" },
  // 0213: Operações também edita a ficha — e vê o histórico de quem mudou o quê.
  { id: "historico", rotulo: "Histórico" },
];
const ehAba = (x: string | null): x is Aba => !!x && ABAS.some((a) => a.id === x);
/** Link antigo (?aba=resumo) cai na Visão geral. */
const abaDaUrl = (): Aba => { const a = lerParamDoHash("aba"); return a === "resumo" ? "geral" : ehAba(a) ? a : "geral"; };

// Nomes amigáveis dos campos, pro histórico ler como gente.
const CAMPOS: Record<string, string> = {
  nome: "nome", cpf: "CPF", passaporte: "passaporte", passaporte_validade: "validade do passaporte",
  nascimento: "nascimento", telefone: "telefone", email: "e-mail", titular_id: "família",
  parentesco: "parentesco", bitrix_contato_id: "ID do Bitrix", observacoes: "observações",
  lgpd_consentimento_em: "consentimento LGPD", mesclado_em_id: "junção",
  endereco_cep: "CEP", endereco_rua: "rua", endereco_numero: "número", endereco_complemento: "complemento",
  endereco_bairro: "bairro", endereco_cidade: "cidade", endereco_estado: "UF",
};

function mudancas(a: Auditoria): string {
  if (a.acao === "INSERT") return "criou a ficha";
  if (a.acao === "JUNTAR") return `juntou a ficha repetida de ${(a.antes?.nome as string) ?? "outra pessoa"} nesta`;
  if (a.acao === "DELETE") return "apagou a ficha";
  const antes = a.antes ?? {};
  const depois = a.depois ?? {};
  const campos = Object.keys(CAMPOS).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
  if (!campos.length) return "salvou sem mudanças";
  if (campos.includes("mesclado_em_id")) return "juntou esta ficha a outra";
  return `alterou ${campos.map((k) => CAMPOS[k]).join(", ")}`;
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return <Card title={titulo} action={acao}>{children}</Card>;
}

const dataBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

export default function ClienteFicha({ id, onAbrir, onVoltar, onAbrirConversa, onAbrirViagem, onAbrirExpedicao, setor = "relacionamento" }: {
  id: string; onAbrir: (id: string) => void; onVoltar: () => void; onAbrirConversa?: (conversaId: string) => void;
  /** Sem ela (Operações sem acesso ao Rel), as viagens aparecem mas não abrem. */
  onAbrirViagem?: (viagemId: string) => void;
  /** Quem está vendo: Operações não vê WhatsApp/contatos/chamados do Relacionamento (0173). */
  setor?: "relacionamento" | "operacional";
  /** Cadastro único (0172): abre a expedição/passageiro no módulo de Expedições. */
  onAbrirExpedicao?: AbrirExpedicao;
}) {
  const [c, setC] = useState<Cliente | null>(null);
  const [aba, setAbaEstado] = useState<Aba>(abaDaUrl);
  const ehRel = setor === "relacionamento";
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [familia, setFamilia] = useState<Cliente[]>([]);
  const [historico, setHistorico] = useState<Auditoria[]>([]);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [novoFamiliar, setNovoFamiliar] = useState(false);
  const [viajaJunto, setViajaJunto] = useState(false);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [mandarModelo, setMandarModelo] = useState(false);
  const [novoChamado, setNovoChamado] = useState(false);
  // Financeiro (0127): mandar o cliente pra lá e acompanhar o status.
  const [enviarFin, setEnviarFin] = useState(false);
  const [pedirSetor, setPedirSetor] = useState<null | "geral" | "pagamento">(null);
  const [oportunidade, setOportunidade] = useState(false);
  const [subirVenda, setSubirVenda] = useState(false);
  const [avisoVenda, setAvisoVenda] = useState<ResultadoPreVenda | null>(null);
  const [sinalPedidos, setSinalPedidos] = useState(0);
  const [sinalFin, setSinalFin] = useState(0);
  const [versaoChamados, setVersaoChamados] = useState(0);
  const [metrica, setMetrica] = useState<Metrica | null>(null);
  const [erroMetrica, setErroMetrica] = useState<string | null>(null);
  const [regras, setRegras] = useState<RegrasCategorias>(REGRAS_PADRAO);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [novoContato, setNovoContato] = useState(false);
  // 0151: o que mais está ligado a esta pessoa (lead, grupos, Financeiro…).
  const [ligacoes, setLigacoes] = useState<LigacoesCliente | null>(null);
  // 0172 (cadastro único): as idas da pessoa nas expedições, ao vivo. ativo=false = 0172 ainda não aplicada.
  const [estadoIdas, setEstadoIdas] = useState<EstadoIdas | null>(null);
  // cópias de 13/10 (rel_documentos) cujo arquivo original aparece em "Arquivos das expedições"
  const [copiasEscondidas, setCopiasEscondidas] = useState<Set<string>>(new Set());
  // 0213: endereço + quem viaja junto (undefined = carregando; null = cadastro único fora do ar)
  const [pessoa, setPessoa] = useState<Pessoa | null | undefined>(undefined);
  const [viagensRel, setViagensRel] = useState<Viagem[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([]);
  const [detalheProx, setDetalheProx] = useState<IdaDetalhada | null>(null);
  const [pedidos, setPedidos] = useState<Record<string, "pedindo" | "pedido" | undefined>>({});
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  const setAba = useCallback((a: Aba) => {
    setAbaEstado(a);
    gravarParamNoHash("aba", a === "geral" ? null : a);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const cli = await carregarCliente(id);
      if (!cli) { setErro("Ficha não encontrada."); return; }
      setC(cli);
      setErro(null);
      const idTitular = cli.titular_id ?? cli.id;
      if (setor === "relacionamento") conversasDoCliente(cli.id).then(setConversas).catch(() => setConversas([]));
      setErroMetrica(null);
      metricaDoCliente(cli.id).then(setMetrica)
        .catch((e) => { setMetrica(null); setErroMetrica(e instanceof Error ? e.message : "erro desconhecido"); });
      listarContatos(cli.id).then(setContatos).catch(() => setContatos([]));
      carregarLigacoes(cli.id).then(setLigacoes).catch(() => setLigacoes(null));
      lerPessoa(cli.id).then((p) => setPessoa(p)).catch(() => setPessoa(null)); // CadastroInativo ou erro: o card avisa
      todasDoCliente(cli.id).then(setViagensRel).catch(() => setViagensRel([]));
      idasDaFicha(cli.id)
        .then((idas) => setEstadoIdas({ ativo: true, idas }))
        .catch((e) => setEstadoIdas(faltaCadastroUnico(e)
          ? { ativo: false, idas: [] }
          : { ativo: true, idas: [], erro: e instanceof Error ? e.message : (e as { message?: string })?.message ?? "erro desconhecido" }));
      const [tit, fam, hist] = await Promise.all([
        cli.titular_id ? carregarCliente(cli.titular_id) : Promise.resolve(null),
        carregarFamilia(idTitular),
        carregarHistorico(cli.id),
      ]);
      setTitular(tit);
      setFamilia(fam.filter((m) => m.id !== cli.id));
      setHistorico(hist);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui abrir a ficha.");
    }
  }, [id, setor]);

  useEffect(() => { setC(null); void carregar(); }, [carregar]);

  // Solicitações sobre a pessoa (indicador + linha do tempo); recarrega quando alguém pede algo.
  useEffect(() => {
    solicitacoesDe({ clienteId: id }, 300).then(setSolicitacoes).catch(() => setSolicitacoes([]));
  }, [id, sinalPedidos]);

  // Voltar/avançar do navegador com outra ?aba= na mesma ficha.
  useEffect(() => {
    const onHash = () => setAbaEstado(abaDaUrl());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // a seção Documentos recarrega quando "pessoas" muda: só muda se mudar nome/id
  const pessoasDoc = useMemo(() => (c ? [{ id: c.id, nome: c.nome }] : []), [c?.id, c?.nome]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregarRegras().then((r) => setRegras(r.regras)).catch(() => undefined); }, []);

  useEffect(() => {
    supabase.from("qs_users").select("id, name").then(({ data }) => {
      setUsuarios(Object.fromEntries((data ?? []).map((u: { id: string; name: string }) => [u.id, u.name])));
    });
  }, []);

  const idas = estadoIdas?.idas ?? [];
  const proxima = useMemo(() => proximaViagem(idas, viagensRel), [idas, viagensRel]);

  // Prontidão (regras do Operações) só da ida da próxima viagem: Contrato, Pagamento, Aéreo, Seguro…
  const idProxIda = proxima?.idaExp?.id ?? null;
  useEffect(() => {
    if (!proxima?.idaExp) { setDetalheProx(null); return; }
    let vivo = true;
    detalharIdas([proxima.idaExp]).then((d) => { if (vivo) setDetalheProx(d[0] ?? null); }).catch(() => { if (vivo) setDetalheProx(null); });
    return () => { vivo = false; };
  }, [idProxIda]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeline = useMemo(() => linhaDoTempo({ historico, mudancas, usuarios, contatos, solicitacoes, ligacoes, viagens: viagensRel }),
    [historico, usuarios, contatos, solicitacoes, ligacoes, viagensRel]);

  if (erro) return <div className="fc"><Aviso tom="erro">{erro}</Aviso></div>;
  if (!c) return (
    <div className="fc" aria-busy="true" aria-label="Carregando a ficha">
      <div className="qs-card2" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span className="fc-esq" style={{ width: 56, height: 56, borderRadius: "50%" }} />
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="fc-esq" style={{ height: 18, width: "45%" }} />
          <span className="fc-esq" style={{ height: 12, width: "30%" }} />
        </span>
      </div>
      <div className="qs-stats">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="qs-stat fc-esq" style={{ height: 88 }} />)}</div>
    </div>
  );

  const { name: nome, tags } = parseClientName(c.nome);
  const bloqueado = !!c.mesclado_em_id;
  const ehTitular = !c.titular_id;
  const fone = c.telefone ?? "";
  // Completude: os campos da ficha + a foto do passaporte (vem da métrica) — a mesma regra de antes.
  const comp = completude(c);
  const semFoto: boolean | null = metrica ? metrica.faltando.includes("doc_passaporte") : null;
  const nFaltando = comp.faltando.length + (semFoto ? 1 : 0);
  const pct = Math.round(((7 - nFaltando) / 7) * 100);
  const nExpedicoes = idas.filter((i) => i.status_reserva !== "Cancelado" && i.status_reserva !== "Lead").length;
  const cats = categoriasDe(regras);
  const cat = metrica && metrica.categoria !== "sem_categoria" ? cats.find((x) => x.id === metrica.categoria) : null;
  const leadDesde = [...(ligacoes?.leads ?? [])].map((l) => l.criado_em).sort()[0] ?? null;
  const abertas = solicitacoes.filter((s) => s.aberta);
  const atrasadas = abertas.filter((s) => s.vencida).length;
  const endereco = resumoEndereco(pessoa ?? null);
  const status = statusDaViagem(proxima, detalheProx, nFaltando, ligacoes);
  const etapas = trilha(proxima, status, detalheProx);
  const conversaAberta = conversas.find((x) => x.janela_aberta);
  const nCompras = (metrica?.viagens_compradas ?? 0) + (metrica?.compras_avulsas ?? 0);
  const nViagens = idas.length + viagensRel.length;
  const nuncaContato = metrica ? metrica.ultimo_contato_em == null : false;

  const abrirWhatsApp = () => {
    if (ehRel && conversaAberta) onAbrirConversa?.(conversaAberta.id);
    else if (ehRel && fone) setMandarModelo(true);
    else if (fone) window.open(`https://wa.me/${fone.replace(/\D/g, "").length <= 11 ? "55" : ""}${fone.replace(/\D/g, "")}`, "_blank", "noopener");
  };

  async function pedir(chave: string) {
    const item = ITENS_PEDIVEIS[chave];
    if (!item || !c) return;
    setErroPedido(null);
    setPedidos((p) => ({ ...p, [chave]: "pedindo" }));
    try {
      await pedirItem({ clienteId: c.id, nome, deSetor: setor, item });
      setPedidos((p) => ({ ...p, [chave]: "pedido" }));
      setSinalPedidos((n) => n + 1);
    } catch (e) {
      setPedidos((p) => ({ ...p, [chave]: undefined }));
      setErroPedido(e instanceof Error ? e.message : "Não consegui criar o pedido.");
    }
  }
  const estadoPedido = (chave: string): "nao" | "pedindo" | "pedido" => pedidos[chave] ?? "nao";

  const menu: MenuGrupo[] = [
    { titulo: "Vendas", itens: [
      ...(ehRel ? [{ rotulo: "Nova oportunidade de venda", onClick: () => setOportunidade(true) }] : []),
      { rotulo: "Subir venda", onClick: () => { setAvisoVenda(null); setSubirVenda(true); } },
    ] },
    { titulo: "Financeiro", itens: [
      { rotulo: "Pedir pagamento", onClick: () => setPedirSetor("pagamento") },
      ...(ehRel ? [{ rotulo: "Enviar ao Financeiro", onClick: () => setEnviarFin(true) }] : []),
    ] },
    { titulo: "Atendimento", itens: ehRel ? [{ rotulo: "Abrir chamado", onClick: () => setNovoChamado(true) }] : [] },
    { titulo: "Cadastro", itens: [
      { rotulo: "Editar ficha", onClick: () => setEditando(true) },
      ...(ehTitular ? [{ rotulo: "Adicionar familiar", onClick: () => setNovoFamiliar(true) }] : []),
    ] },
  ];

  // Documentos da aba: slots (faltando = borda tracejada) + o painel de sempre embaixo.
  const slots: { chave: string; rotulo: string; sub: string; ok: boolean }[] = [
    { chave: "doc_passaporte", rotulo: "Foto do passaporte", ok: semFoto !== true, sub: semFoto === true ? "Faltando" : semFoto === null ? "não deu pra conferir" : "Enviada" },
    { chave: "cpf", rotulo: "CPF", ok: !!c.cpf, sub: c.cpf ? "Número cadastrado" : "Faltando" },
    { chave: "passaporte", rotulo: "Nº do passaporte", ok: !!c.passaporte, sub: c.passaporte ? c.passaporte : "Faltando" },
    { chave: "passaporte_validade", rotulo: "Validade do passaporte", ok: !!c.passaporte_validade, sub: c.passaporte_validade ? formatarData(c.passaporte_validade) : "Faltando" },
    { chave: "nascimento", rotulo: "Data de nascimento", ok: !!c.nascimento, sub: c.nascimento ? formatarData(c.nascimento) : "Faltando" },
    { chave: "contrato", rotulo: "Contrato", ok: status[0].tom === "ok", sub: status[0].texto === "—" ? "sem viagem com contrato" : status[0].texto },
  ];
  const statusTom = (t: string) => (t === "ok" ? "qs-tone-ok" : t === "warn" ? "qs-tone-warn" : t === "danger" ? "qs-tone-danger" : "");

  return (
    <div className="fc">
      <nav className="fc-crumb" aria-label="Navegação">
        <button type="button" onClick={onVoltar}>Clientes</button>
        <span aria-hidden>/</span>
        <span aria-current="page">{nome}</span>
      </nav>

      {c.mesclado_em_id && (
        <Aviso>
          Esta ficha era repetida e foi juntada a outra.{" "}
          <button className="underline font-semibold" onClick={() => onAbrir(c.mesclado_em_id!)}>Abrir a ficha que ficou</button>
        </Aviso>
      )}

      {c.arquivado_em && ehRel && (
        <Aviso>
          Ficha arquivada — não conta como cliente{c.arquivado_motivo ? <> ({c.arquivado_motivo})</> : null}. Ela não aparece na lista nem nos KPIs.{" "}
          <button className="underline font-semibold" onClick={async () => {
            const { error } = await supabase.from("rel_clientes").update({ arquivado_em: null, arquivado_motivo: null }).eq("id", c.id);
            if (error) alert(`Não consegui desarquivar: ${error.message}`); else window.location.reload();
          }}>Desarquivar</button>
        </Aviso>
      )}

      {/* Cabeçalho */}
      <section className="fc-head" aria-label="Cliente">
        <div className="fc-head__id">
          <Avatar name={c.nome} size={56} />
          <div className="fc-head__tx">
            <div className="fc-head__nome">
              <h1 className="fc-h1">{nome}</h1>
              {tags.map((t) => <StatusChip key={t}>{t}</StatusChip>)}
            </div>
            <div className="fc-linha">
              {cat && <StatusChip icon={<span className="fc-dot" style={{ background: cat.cor }} aria-hidden />}>{cat.nome}</StatusChip>}
              {nExpedicoes > 0 && <StatusChip>Clube {nivelFidelidade(nExpedicoes).tier} · {nExpedicoes} viage{nExpedicoes === 1 ? "m" : "ns"}</StatusChip>}
              {c.titular_id && titular && <StatusChip>{c.parentesco ? `${({ conjuge: "Cônjuge", filho: "Filho(a)", pai_mae: "Pai / Mãe", irmao: "Irmão(ã)", neto: "Neto(a)", amigo: "Amigo(a)", outro: "Família" } as const)[c.parentesco]} de ${parseClientName(titular.nome).name.split(" ")[0]}` : "Família"}</StatusChip>}
              <StatusChip>{leadDesde ? `Lead desde ${dataBR(leadDesde)}` : `Ficha desde ${dataBR(c.criado_em)}`}</StatusChip>
            </div>
            {(!c.lgpd_consentimento_em || nuncaContato) && (
              <div className="fc-linha">
                {!c.lgpd_consentimento_em && <StatusChip tone="warn" icon={Icon.alerta}>Sem consentimento LGPD</StatusChip>}
                {nuncaContato && <StatusChip tone="warn">Nunca teve contato</StatusChip>}
              </div>
            )}
          </div>
        </div>
        {!bloqueado && (
          <div className="fc-head__acts">
            {fone && <Btn icon={Icon.chat} onClick={abrirWhatsApp}>WhatsApp</Btn>}
            <Btn onClick={() => setPedirSetor("geral")}>Pedir a outro setor</Btn>
            {ehRel && <Btn variant="primary" onClick={() => setNovoContato(true)}>Registrar contato</Btn>}
            <Menu rotulo="Mais ações" grupos={menu} />
          </div>
        )}
      </section>

      {/* Indicadores */}
      <section className="qs-stats" aria-label="Indicadores do cliente">
        <StatCard label="LTV" value={metrica ? moeda(metrica.valor_total) : "—"}
          sub={metrica ? `${nCompras} compra${nCompras === 1 ? "" : "s"}` : erroMetrica ? "não carregou" : "carregando…"} />
        <StatCard label="Próximo embarque" value={proxima ? formatarData(proxima.ida) : metrica?.proximo_embarque ? formatarData(metrica.proximo_embarque) : "—"}
          sub={proxima ? [proxima.nome, proxima.grupo].filter(Boolean).join(" · ") : "nenhuma viagem à frente"}
          onClick={proxima ? () => setAba("viagens") : undefined} />
        <StatCard label="Cadastro" value={`${pct}%`} tone={pct < 100 ? "warn" : "ok"}
          sub={nFaltando ? `${nFaltando} dado${nFaltando > 1 ? "s" : ""} faltando` : "completo"} />
        <StatCard label="Solicitações abertas" value={abertas.length} tone={atrasadas ? "danger" : "default"}
          sub={abertas.length === 0 ? "nenhuma pendente com outro setor" : atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? "s" : ""}` : "em andamento"}
          onClick={() => setAba("atendimento")} />
        <StatCard label="Último contato" value={!metrica ? "—" : metrica.ultimo_contato_em ? dataBR(metrica.ultimo_contato_em) : "Nunca"}
          tone={nuncaContato ? "warn" : "default"}
          sub={!metrica ? "" : metrica.dias_sem_contato == null ? "registre o primeiro contato" : metrica.dias_sem_contato === 0 ? "hoje" : `${metrica.dias_sem_contato} dias sem contato`}
          onClick={ehRel && !bloqueado ? () => setNovoContato(true) : undefined} />
      </section>

      {erroMetrica && <Aviso tom="erro">Categoria, LTV e cadastro não carregaram ({erroMetrica}).</Aviso>}
      {avisoVenda && (
        <div role="status" onClick={() => setAvisoVenda(null)}><Aviso tom={avisoVenda.tom}>{avisoVenda.mensagem}</Aviso></div>
      )}

      {/* 0172: o que está diferente entre a ficha e as expedições (some quando não há nada) */}
      {!bloqueado && (
        <FilaDivergencias clienteId={c.id} onAbrirCliente={onAbrir}
          onAbrirPassageiro={onAbrirExpedicao ? (exp, tipo, pax) => onAbrirExpedicao(exp, tipo, pax) : undefined}
          onMudou={() => void carregar()} />
      )}

      <div className="fc-cols">
        <main className="fc-main">
          <ProntaParaEmbarcar c={c} nome={nome} semFoto={semFoto} endereco={endereco} deSetor={setor} bloqueado={bloqueado}
            onPreencher={() => setEditando(true)} onPedido={() => setSinalPedidos((n) => n + 1)} />

          <div className="fc-abas" role="tablist" aria-label="Seções da ficha">
            {ABAS.map((a) => (
              <FilterPill key={a.id} role="tab" active={aba === a.id} controls="fc-painel" onClick={() => setAba(a.id)}
                count={a.id === "viagens" ? nViagens : a.id === "compras" ? nCompras : a.id === "documentos" ? nFaltando : a.id === "atendimento" ? abertas.length : null}
                countTone={a.id === "documentos" ? "warn" : a.id === "atendimento" && atrasadas ? "danger" : undefined}>
                {a.rotulo}
              </FilterPill>
            ))}
          </div>

          <div id="fc-painel" role="tabpanel" aria-label={ABAS.find((a) => a.id === aba)?.rotulo} className="fc-main">
            {erroPedido && <Aviso tom="erro">{erroPedido}</Aviso>}

            {aba === "geral" && (
              <VisaoGeral c={c} pessoa={pessoa} semFoto={semFoto} bloqueado={bloqueado} proxima={proxima} etapas={etapas} timeline={timeline}
                pedirEndereco={() => void pedir("endereco")} pedindoEndereco={estadoPedido("endereco")}
                onIrAba={setAba} onMudou={() => void carregar()} />
            )}

            {aba === "viagens" && <>
              {proxima && (
                <Card title="Próxima viagem" action={proxima.viagem?.bitrix_deal_id
                  ? <a className="fc-link" href={linkBitrix(proxima.viagem.bitrix_deal_id)} target="_blank" rel="noreferrer">Abrir no Bitrix</a>
                  : proxima.viagem && onAbrirViagem ? <button type="button" className="fc-link fc-link--btn" onClick={() => onAbrirViagem(proxima.viagem!.id)}>Abrir viagem</button> : undefined}>
                  <div className="fc-viagem">
                    <span className="fc-viagem__n">{proxima.nome}</span>
                    <span className="fc-viagem__s">
                      {[proxima.grupo, `${formatarData(proxima.ida)}${proxima.volta ? ` a ${formatarData(proxima.volta)}` : ""}`, proxima.viagem?.valor ? moeda(proxima.viagem.valor) : proxima.idaExp?.valor_contratado_brl ? moeda(proxima.idaExp.valor_contratado_brl) : null].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div className="fc-status">
                    {status.map((s) => (
                      <div key={s.rotulo} className="fc-status__i">
                        <span className="fc-status__l">{s.rotulo}</span>
                        <span className={`fc-status__v ${statusTom(s.tom)}`}>{s.texto}</span>
                      </div>
                    ))}
                  </div>
                  {/* ENCAIXAR: <ContratoDoCliente clienteId={c.id} /> — contrato por cliente (componente feito à parte) */}
                </Card>
              )}
              <ExpedicoesDaFicha clienteId={c.id} estado={estadoIdas} onAbrirExpedicao={onAbrirExpedicao} />
              <ViagensComAGente clienteId={c.id} onAbrirViagem={onAbrirViagem ?? (() => undefined)} metrica={metrica} cats={cats}
                onAbrirExpedicao={onAbrirExpedicao ? (exp, tipo) => onAbrirExpedicao(exp, tipo) : undefined} />
            </>}

            {aba === "compras" && <ComprasDoCliente cliente={c} />}

            {aba === "documentos" && <>
              <section className="fc-slots" aria-label="Documentos da pessoa">
                {slots.map((s) => {
                  const pedivel = !s.ok && !bloqueado && ITENS_PEDIVEIS[s.chave];
                  const st = estadoPedido(s.chave);
                  return (
                    <div key={s.chave} className={`fc-slot${s.ok ? "" : " fc-slot--falta"}`}>
                      <span className="fc-slot__l">{s.rotulo}</span>
                      <span className="fc-slot__s">{s.sub}</span>
                      {pedivel && (
                        <span><Btn size="sm" disabled={st !== "nao"} onClick={() => void pedir(s.chave)}>
                          {st === "pedido" ? "Pedido ✓" : st === "pedindo" ? "Pedindo…" : "Pedir à cliente"}
                        </Btn></span>
                      )}
                    </div>
                  );
                })}
              </section>
              <DocumentosPainel pessoas={pessoasDoc} clienteId={c.id} esconder={copiasEscondidas} />
              {estadoIdas?.ativo && estadoIdas.idas.length > 0 && <ArquivosDasExpedicoes idas={estadoIdas.idas} onCopias={setCopiasEscondidas} />}
              <ArquivosDoCliente clienteId={c.id} bloqueado={bloqueado} />
            </>}

            {aba === "expedamigo" && (
              <ExpedAmigoDoCliente nome={c.nome} cpf={c.cpf} telefone={c.telefone} idas={idas} onMudou={() => void carregar()} />
            )}

            {aba === "atendimento" && <>
              {solicitacoes.length === 0 && (!ehRel || (conversas.length === 0 && contatos.length === 0)) && (
                <Card as="div">
                  <EmptyState title="Nenhum atendimento aberto"
                    description="Chamados e pedidos a outros setores sobre esta pessoa aparecem aqui, com prazo e responsável."
                    action={!bloqueado ? <Btn onClick={() => setPedirSetor("geral")}>Pedir a outro setor</Btn> : undefined} />
                </Card>
              )}
              <HistoricoDeSolicitacoes clienteId={c.id} recarregar={sinalPedidos} links={{ onAbrirViagem, onAbrirConversa, onAbrirCliente: onAbrir }} />
              <StatusNoFinanceiro alvo={{ clienteId: c.id }} recarregar={sinalFin} />

              {ehRel && <>
                {/* WhatsApp do Relacionamento (Fase 2) */}
                <Secao
                  titulo="WhatsApp"
                  acao={!bloqueado && c.telefone ? (
                    conversaAberta
                      ? <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirConversa?.(conversaAberta.id)}>Abrir conversa</Botao>
                      : <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setMandarModelo(true)}>Mandar mensagem</Botao>
                  ) : undefined}
                >
                  {!c.telefone && conversas.length === 0 ? (
                    <p className="fc-p">Sem telefone na ficha.</p>
                  ) : conversas.length === 0 ? (
                    <p className="fc-p">Nenhuma conversa ainda pelo WhatsApp do Relacionamento.</p>
                  ) : conversas.map((cv) => (
                    <button key={cv.id} onClick={() => onAbrirConversa?.(cv.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] truncate" style={{ color: "var(--ink)" }}>{cv.ultima_mensagem || "—"}</span>
                        <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                          {horaCurta(cv.atualizado_em)} · {cv.estado === "resolvida" ? "resolvida" : cv.aguardando_desde ? `esperando há ${duracao(cv.minutos_esperando)}` : "em andamento"}
                          {cv.atendente_nome ? ` · ${cv.atendente_nome.split(" ")[0]}` : ""}
                        </span>
                      </span>
                      {cv.nao_lidas > 0 && <Etiqueta tom="rel">{cv.nao_lidas}</Etiqueta>}
                    </button>
                  ))}
                </Secao>

                <Secao titulo="Contatos registrados" acao={!bloqueado ? (
                  <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setNovoContato(true)}>+ Registrar</Botao>
                ) : undefined}>
                  {contatos.length === 0 ? (
                    <p className="fc-p">Nenhum contato registrado à mão. Conversa pelo WhatsApp do Relacionamento e chamado já contam sozinhos.</p>
                  ) : (
                    <ol className="space-y-1.5 py-1">
                      {contatos.map((k) => (
                        <li key={k.id} className="text-[13px]" style={{ color: "var(--ink)" }}>
                          <b>{CANAIS_CONTATO[k.canal]}</b>
                          <span style={{ color: "var(--ink3)" }}> · {new Date(k.feito_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}{k.autor_id && usuarios[k.autor_id] ? ` · ${usuarios[k.autor_id].split(" ")[0]}` : ""}</span>
                          {k.resumo && <span className="block text-[12px]" style={{ color: "var(--ink2)" }}>{k.resumo}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </Secao>
                <ChamadosDoCliente key={versaoChamados} clienteId={c.id} />
              </>}
            </>}

            {aba === "historico" && <>
              <Card title="Histórico completo" action={<span className="qs-num qs-tone-subtle" style={{ fontSize: 13 }}>{timeline.length} evento{timeline.length === 1 ? "" : "s"}</span>}>
                <Timeline items={timeline} empty="Sem registros." />
              </Card>
              {ligacoes && <div id="fc-onde-aparece"><LigacoesDoCliente l={ligacoes} /></div>}
            </>}
          </div>
        </main>

        <LateralFicha c={c} titular={titular} familia={familia} acompanhantes={pessoa ? pessoa.acompanhantes : null}
          ligacoes={ligacoes} metrica={metrica} ehRel={ehRel}
          onAbrir={onAbrir} onAdicionarFamiliar={() => setNovoFamiliar(true)} onViajaJunto={() => setViajaJunto(true)}
          onEnviarTermo={() => setMandarModelo(true)} onEditar={() => setEditando(true)}
          onVerOndeAparece={() => { setAba("historico"); setTimeout(() => document.getElementById("fc-onde-aparece")?.scrollIntoView({ behavior: "smooth" }), 50); }}
          onMudou={() => void carregar()} />
      </div>

      <ClienteForm
        aberto={editando}
        cliente={c}
        onFechar={() => setEditando(false)}
        onSalvo={() => { setEditando(false); void carregar(); }}
        onAbrirFicha={(x) => { setEditando(false); onAbrir(x); }}
      />
      <ContatoModal
        aberto={novoContato}
        clienteId={c.id}
        nome={nome}
        onFechar={() => setNovoContato(false)}
        onSalvo={() => { setNovoContato(false); void carregar(); }}
      />
      <EnviarFinanceiroModal aberto={enviarFin} origem="relacionamento" alvo={{ clienteId: c.id, telefone: c.telefone }} nome={nome}
        onFechar={() => setEnviarFin(false)} onEnviado={() => { setEnviarFin(false); setSinalFin((n) => n + 1); }} />
      <ChamadoModal
        aberto={novoChamado}
        inicial={{ clienteId: c.id }}
        onFechar={() => setNovoChamado(false)}
        onSalvo={() => { setNovoChamado(false); setVersaoChamados((v) => v + 1); }}
      />
      <ModeloModal
        aberto={mandarModelo}
        alvo={{ clienteId: c.id }}
        nomeCliente={nome}
        onFechar={() => setMandarModelo(false)}
        onEnviado={(cid) => { setMandarModelo(false); if (cid) onAbrirConversa?.(cid); else void carregar(); }}
      />
      <ClienteForm
        aberto={novoFamiliar}
        titular={c}
        onFechar={() => setNovoFamiliar(false)}
        onSalvo={() => { setNovoFamiliar(false); void carregar(); }}
        onAbrirFicha={(x) => { setNovoFamiliar(false); onAbrir(x); }}
      />
      <NovaSolicitacao aberto={pedirSetor !== null} deSetor={setor} alvo={{ clienteId: c.id, sobre: nome }} soPagamento={pedirSetor === "pagamento"}
        onFechar={() => setPedirSetor(null)} onCriada={() => { setPedirSetor(null); setSinalPedidos((n) => n + 1); }} />
      {ehRel && (
        <NovaOportunidade aberto={oportunidade} onFechar={() => setOportunidade(false)} cliente={{ id: c.id, nome: c.nome }} origem="manual"
          onCriada={() => { setOportunidade(false); setAvisoVenda({ tom: "ok", mensagem: "Oportunidade criada no Pipeline de vendas do Relacionamento." }); }} />
      )}
      {subirVenda && (
        <SubirVenda origem={ehRel ? "rel" : "ops"} aberto={subirVenda}
          cliente={{ id: c.id, nome: c.nome, telefone: c.telefone ?? "", email: c.email ?? "" }}
          onFechar={() => setSubirVenda(false)} onSalvo={(r) => { setSubirVenda(false); setAvisoVenda(r); }} />
      )}
      {/* "Quem viaja junto" (cad_acompanhantes, 0213) — o mesmo cadastro que SDR, Closer e Ops preenchem */}
      <Modal aberto={viajaJunto} titulo={`Quem viaja junto com ${nome.split(" ")[0]}`} onFechar={() => { setViajaJunto(false); void carregar(); }} largura={640}>
        {viajaJunto && <CadastroPessoa clienteId={c.id} secoes={["acompanhantes"]} embutido onMudou={(p) => setPessoa(p)} />}
      </Modal>
    </div>
  );
}
