// src/propostas/PropostaEditor.tsx
// -----------------------------------------------------------------------------
// Montar a proposta (0156, 21/10/2026). Uma tela só, de cima pra baixo:
//   dados da viagem → opções (abas só a partir da 2ª) → serviços → valores e
//   pagamento → enviar ao cliente (link + mensagem pronta).
//
// Lições do AgentePro: a proposta nasce com UMA opção e a palavra "opção" só
// aparece quando cria a 2ª ("Duplicar esta" é o caso comum — troca o hotel);
// duplicar sempre COPIA; desconto e pagamento são POR OPÇÃO; rascunho salva a
// qualquer momento (nada obrigatório pra salvar).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import PropostaView from "./PropostaView";
import {
  CONDICOES, FORMAS, ORDEM_TIPOS, STATUS_PROPOSTA, TIPOS, TOM_PROPOSTA, brl, carregarProposta, dataBr, duplicarOpcao, duplicarProposta,
  itemVazio, linkDaProposta, mudarStatus, opcaoVazia, pagamentoVazio, paraVM, propostaVazia, salvarProposta, textoPagamento,
  tituloDaProposta, totaisDaOpcao, trechoVazio,
  type CondicaoPag, type FormaPag, type ItemProposta, type OpcaoProposta, type Pagamento, type Proposta, type TipoItem, type Trecho,
} from "./lib";
import type { Setor } from "@/components/sdr/types";

const area = "rel-input";
const numero = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")) || 0);
const numeroOuNulo = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")) || 0);

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

// ── Trechos do voo ──────────────────────────────────────────────────────────
function EditorTrechos({ trechos, onChange }: { trechos: Trecho[]; onChange: (t: Trecho[]) => void }) {
  const mudar = (n: number, c: Partial<Trecho>) => onChange(trechos.map((t, k) => (k === n ? { ...t, ...c } : t)));
  return (
    <div className="space-y-2">
      {trechos.map((t, n) => (
        <div key={n} className="rounded-lg p-2.5 grid grid-cols-2 sm:grid-cols-6 gap-2" style={{ background: "var(--card2)" }}>
          <select className={area} value={t.sentido} onChange={(e) => mudar(n, { sentido: e.target.value as Trecho["sentido"] })} aria-label="Sentido">
            <option value="ida">Ida</option><option value="volta">Volta</option><option value="interno">Trecho interno</option>
          </select>
          <Entrada placeholder="Origem (GRU)" value={t.origem} onChange={(e) => mudar(n, { origem: e.target.value.toUpperCase() })} aria-label="Origem" />
          <Entrada placeholder="Destino (NRT)" value={t.destino} onChange={(e) => mudar(n, { destino: e.target.value.toUpperCase() })} aria-label="Destino" />
          <Entrada type="date" value={t.data} onChange={(e) => mudar(n, { data: e.target.value })} aria-label="Data da saída" />
          <Entrada type="time" value={t.saida} onChange={(e) => mudar(n, { saida: e.target.value })} aria-label="Hora da saída" />
          <Entrada type="time" value={t.chegada} onChange={(e) => mudar(n, { chegada: e.target.value })} aria-label="Hora da chegada" />
          <Entrada placeholder="Cia (LATAM)" value={t.cia} onChange={(e) => mudar(n, { cia: e.target.value })} aria-label="Companhia" />
          <Entrada placeholder="Voo (LA8084)" value={t.voo} onChange={(e) => mudar(n, { voo: e.target.value.toUpperCase() })} aria-label="Número do voo" />
          <select className={area} value={t.classe} onChange={(e) => mudar(n, { classe: e.target.value })} aria-label="Classe">
            {["Econômica", "Premium Economy", "Executiva", "Primeira"].map((c) => <option key={c}>{c}</option>)}
          </select>
          <label className="col-span-2 flex items-center gap-2 text-[12px]" style={{ color: "var(--ink3)" }}>
            Chega em outro dia?
            <Entrada type="date" value={t.chegada_data} onChange={(e) => mudar(n, { chegada_data: e.target.value })} aria-label="Data da chegada" />
          </label>
          <Botao variante="fantasma" className="justify-self-end" onClick={() => onChange(trechos.filter((_, k) => k !== n))} aria-label="Tirar trecho">Tirar</Botao>
        </div>
      ))}
      <Botao variante="fantasma" onClick={() => onChange([...trechos, trechoVazio(trechos.at(-1)?.sentido ?? "ida", trechos.at(-1)?.chegada_data || trechos.at(-1)?.data || "")])}>+ Trecho / conexão</Botao>
    </div>
  );
}

// ── Um serviço ──────────────────────────────────────────────────────────────
function EditorItem({ i, onChange, onTirar, onSubir, onDescer }: {
  i: ItemProposta; onChange: (c: Partial<ItemProposta>) => void; onTirar: () => void; onSubir?: () => void; onDescer?: () => void;
}) {
  const info = TIPOS[i.tipo];
  const [aberto, setAberto] = useState(!i.nome);
  const d = i.detalhes as Record<string, string>;
  const mudarD = (chave: string, v: unknown) => onChange({ detalhes: { ...i.detalhes, [chave]: v } });
  const lucroCalc = i.custo != null ? i.valor_total - i.custo : null;
  return (
    <div className="rel-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[18px]" aria-hidden>{info.emoji}</span>
        <button type="button" onClick={() => setAberto((a) => !a)} className="flex-1 min-w-0 text-left" aria-expanded={aberto}>
          <span className="block truncate text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{i.nome || <span style={{ color: "var(--ink3)" }}>{info.rotulo} sem nome</span>}</span>
          <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
            {info.rotulo}{i.data_inicio ? ` · ${dataBr(i.data_inicio, false)}${i.data_fim ? `–${dataBr(i.data_fim, false)}` : ""}` : ""}
          </span>
        </button>
        <span className="text-[13px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{i.incluso ? "Incluso" : brl(i.valor_total)}</span>
        {onSubir && <button type="button" onClick={onSubir} className="p-1 text-[13px]" style={{ color: "var(--ink3)" }} aria-label="Subir">▲</button>}
        {onDescer && <button type="button" onClick={onDescer} className="p-1 text-[13px]" style={{ color: "var(--ink3)" }} aria-label="Descer">▼</button>}
      </div>
      {aberto && (
        <div className="border-t px-3 py-3 space-y-3" style={{ borderColor: "var(--line)" }}>
          <div className="grid sm:grid-cols-[1fr_140px] gap-3">
            <Campo rotulo="Nome (o cliente vê)"><Entrada value={i.nome} placeholder={info.exemploNome} onChange={(e) => onChange({ nome: e.target.value })} /></Campo>
            <Campo rotulo="Quantidade"><Entrada type="number" min={1} value={i.quantidade} onChange={(e) => onChange({ quantidade: Math.max(1, Math.floor(numero(e.target.value))) })} /></Campo>
          </div>
          {(info.datas[0] || info.datas[1]) && (
            <div className="grid grid-cols-2 gap-3">
              {info.datas[0] && <Campo rotulo={info.datas[0]}><Entrada type="date" value={i.data_inicio} onChange={(e) => onChange({ data_inicio: e.target.value })} /></Campo>}
              {info.datas[1] && <Campo rotulo={info.datas[1]}><Entrada type="date" value={i.data_fim} onChange={(e) => onChange({ data_fim: e.target.value })} /></Campo>}
            </div>
          )}
          {i.tipo === "aereo" && (
            <Campo rotulo="Trechos (ida, conexões e volta)">
              <EditorTrechos trechos={(Array.isArray(i.detalhes.trechos) ? i.detalhes.trechos : []) as Trecho[]} onChange={(t) => mudarD("trechos", t)} />
            </Campo>
          )}
          {info.campos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {info.campos.map((c) => (
                <div key={c.chave} className={c.largo ? "col-span-2 sm:col-span-3" : ""}>
                  <Campo rotulo={c.rotulo} dica={c.dica}>
                    {c.tipo === "select" ? (
                      <select className={area} value={d[c.chave] ?? ""} onChange={(e) => mudarD(c.chave, e.target.value)}>
                        {(c.opcoes ?? []).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                      </select>
                    ) : c.tipo === "area" ? (
                      <textarea className={area} rows={3} value={d[c.chave] ?? ""} onChange={(e) => mudarD(c.chave, e.target.value)} />
                    ) : (
                      <Entrada type={c.tipo === "hora" ? "time" : c.tipo === "numero" ? "number" : c.tipo === "data" ? "date" : "text"}
                        value={d[c.chave] ?? ""} onChange={(e) => mudarD(c.chave, e.target.value)} />
                    )}
                  </Campo>
                </div>
              ))}
            </div>
          )}
          <Campo rotulo="Descrição (o cliente vê)"><textarea className={area} rows={2} value={i.descricao} onChange={(e) => onChange({ descricao: e.target.value })} /></Campo>

          <div className="rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end" style={{ background: "var(--card2)" }}>
            <Campo rotulo="Preço de venda">
              <Entrada type="number" step="0.01" min={0} value={i.valor_total || ""} disabled={i.incluso} onChange={(e) => onChange({ valor_total: numero(e.target.value) })} />
            </Campo>
            <Campo rotulo="Custo (interno)">
              <Entrada type="number" step="0.01" min={0} value={i.custo ?? ""} onChange={(e) => onChange({ custo: numeroOuNulo(e.target.value) })} />
            </Campo>
            <Campo rotulo="Lucro (interno)" dica={i.lucro == null && lucroCalc != null ? `Calculado: ${brl(lucroCalc)}` : undefined}>
              <Entrada type="number" step="0.01" value={i.lucro ?? ""} placeholder={lucroCalc != null ? String(lucroCalc.toFixed(2)) : ""} onChange={(e) => onChange({ lucro: numeroOuNulo(e.target.value) })} />
            </Campo>
            <Campo rotulo="Fornecedor (interno)"><Entrada value={i.fornecedor} onChange={(e) => onChange({ fornecedor: e.target.value })} /></Campo>
            <label className="col-span-2 flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" checked={i.incluso} onChange={(e) => onChange({ incluso: e.target.checked, ...(e.target.checked ? { valor_total: 0 } : {}) })} />
              Mostrar "Incluso" no lugar do preço
            </label>
            <div className="col-span-2 flex justify-end"><Botao variante="perigo" onClick={onTirar}>Tirar serviço</Botao></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formas de pagamento da opção ────────────────────────────────────────────
function EditorPagamentos({ pags, total, onChange }: { pags: Pagamento[]; total: number; onChange: (p: Pagamento[]) => void }) {
  const mudar = (n: number, c: Partial<Pagamento>) => onChange(pags.map((p, k) => (k === n ? { ...p, ...c } : p)));
  return (
    <div className="space-y-2">
      {pags.map((p, n) => (
        <div key={n} className="rounded-lg p-2.5 space-y-2" style={{ background: "var(--card2)" }}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <select className={area} value={p.forma} onChange={(e) => mudar(n, { forma: e.target.value as FormaPag })} aria-label="Forma">
              {Object.entries(FORMAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={area} value={p.condicao} onChange={(e) => mudar(n, { condicao: e.target.value as CondicaoPag })} aria-label="Condição">
              {Object.entries(CONDICOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {p.condicao !== "avista" && <Entrada type="number" min={1} max={48} value={p.parcelas} onChange={(e) => mudar(n, { parcelas: Math.max(1, Math.floor(numero(e.target.value))) })} aria-label="Parcelas" placeholder="Parcelas" />}
            {p.condicao === "entrada" && <Entrada type="number" step="0.01" min={0} value={p.entrada || ""} onChange={(e) => mudar(n, { entrada: numero(e.target.value) })} aria-label="Entrada" placeholder="Entrada R$" />}
            {p.condicao !== "avista" && (
              <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
                <input type="checkbox" checked={p.com_juros} onChange={(e) => mudar(n, { com_juros: e.target.checked })} /> Com juros
              </label>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <Entrada placeholder="Observação (ex.: 5% de desconto no Pix)" value={p.obs} onChange={(e) => mudar(n, { obs: e.target.value })} />
            <Botao variante="fantasma" onClick={() => onChange(pags.filter((_, k) => k !== n))}>Tirar</Botao>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>O cliente lê: {textoPagamento(p, total)}</p>
        </div>
      ))}
      {pags.length < 4 && <Botao variante="fantasma" onClick={() => onChange([...pags, pagamentoVazio()])}>+ Forma de pagamento</Botao>}
    </div>
  );
}

// ── A tela ──────────────────────────────────────────────────────────────────
export default function PropostaEditor({ id, setor, inicial, onVoltar, onAbrir }: {
  id: string | null;
  setor: Setor;
  /** Nova proposta já amarrada (veio de uma solicitação). */
  inicial?: Partial<Proposta>;
  onVoltar: () => void;
  /** Depois de salvar uma nova / duplicar: abre pelo id. */
  onAbrir: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const [p, setP] = useState<Proposta | null>(id ? null : { ...propostaVazia(setor), ...inicial });
  const [aba, setAba] = useState(0);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [previa, setPrevia] = useState(false);
  const [envio, setEnvio] = useState(false);
  const [novaOpcao, setNovaOpcao] = useState(false);
  const [marcarAprov, setMarcarAprov] = useState(false);
  const [addTipo, setAddTipo] = useState(false);
  const [abrirDepois, setAbrirDepois] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    if (!id) return;
    try {
      const x = await carregarProposta(id);
      setP(x); setSujo(false);
      // quem montou abriu: o aviso de aprovação foi visto
      if (x.aprovada_em && !x.aprovacao_vista_em && x.criado_por === currentUser?.id) void mudarStatus(x.id!, "visto").catch(() => {});
    } catch (e) { setErro(e instanceof Error ? e.message : "Não abriu."); }
  }, [id, currentUser?.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3000); return () => clearTimeout(t); }, [aviso]);

  const mudar = (c: Partial<Proposta>) => { setP((x) => (x ? { ...x, ...c } : x)); setSujo(true); };
  const mudarOpcao = (n: number, c: Partial<OpcaoProposta>) => {
    setP((x) => (x ? { ...x, opcoes: x.opcoes.map((o, k) => (k === n ? { ...o, ...c } : o)) } : x)); setSujo(true);
  };
  const mudarItem = (n: number, k: string, c: Partial<ItemProposta>) => {
    setP((x) => (x ? { ...x, opcoes: x.opcoes.map((o, j) => (j === n ? { ...o, itens: o.itens.map((i) => (i.k === k ? { ...i, ...c } : i)) } : o)) } : x)); setSujo(true);
  };

  /** `navegar` = proposta nova vai pro endereço dela; false (Enviar) recarrega aqui e abre depois. */
  const salvar = useCallback(async (navegar = true): Promise<string | null> => {
    if (!p) return null;
    setSalvando(true); setErro(null);
    try {
      const novoId = await salvarProposta(p);
      setSujo(false);
      if (!p.id && navegar) { onAbrir(novoId); return novoId; }
      setP(await carregarProposta(novoId));
      if (!p.id) setAbrirDepois(novoId); else setAviso("Salvo.");
      return novoId;
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); return null; }
    finally { setSalvando(false); }
  }, [p, onAbrir]);

  // Ctrl+S salva
  const salvarRef = useRef(salvar);
  salvarRef.current = salvar;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void salvarRef.current(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  // sair com coisa não salva
  useEffect(() => {
    if (!sujo) return;
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [sujo]);

  const opcao = p?.opcoes[Math.min(aba, (p?.opcoes.length ?? 1) - 1)];
  const nOpcao = p ? Math.min(aba, p.opcoes.length - 1) : 0;
  const totais = useMemo(() => (opcao ? totaisDaOpcao(opcao) : null), [opcao]);

  if (!p) return <p className="text-[14px]" style={{ color: "var(--ink3)" }}>{erro ?? "Carregando…"}</p>;
  const cancelada = p.status === "cancelada";
  const varias = p.opcoes.length > 1;
  const link = p.token ? linkDaProposta(p.token) : null;
  const primeiroNome = p.cliente_nome.trim().split(/\s+/)[0] || "";
  const mensagem = `Olá${primeiroNome ? `, ${primeiroNome}` : ""}! Preparamos sua proposta de viagem${p.destino ? ` para ${p.destino}` : ""}${varias ? ` com ${p.opcoes.length} opções` : ""}. É só abrir o link pra ver todos os detalhes${varias ? " e escolher a sua preferida" : ""}:\n\n${link ?? ""}\n\nQualquer dúvida, estou por aqui!`;

  const voltar = () => { if (!sujo || window.confirm("Sair sem salvar as mudanças?")) onVoltar(); };
  const acao = async (fn: () => Promise<unknown>, ok?: string) => {
    setErro(null);
    try { await fn(); await carregar(); if (ok) setAviso(ok); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  };
  async function enviar() {
    const pid = sujo || !p!.id ? await salvar(false) : p!.id!;
    if (!pid) return;
    if (p!.status === "rascunho") {
      try { await mudarStatus(pid, "enviada"); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); return; }
    }
    setP(await carregarProposta(pid));
    setEnvio(true);
  }
  const fecharEnvio = () => { setEnvio(false); if (abrirDepois) { const x = abrirDepois; setAbrirDepois(null); onAbrir(x); } };
  const copiar = (t: string, ok: string) => void navigator.clipboard?.writeText(t).then(() => setAviso(ok));

  function tirarOpcao(n: number) {
    if (!window.confirm(`Tirar a ${varias ? `Opção ${n + 1}` : "opção"} e todos os serviços dela?`)) return;
    mudar({ opcoes: p!.opcoes.filter((_, k) => k !== n) });
    setAba(Math.max(0, n - 1));
  }

  return (
    <div className="max-w-[980px] space-y-5">
      {/* Topo */}
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="fantasma" onClick={voltar}>← Propostas</Botao>
        <h1 className="text-[20px] font-bold flex-1 min-w-[200px] truncate" style={{ color: "var(--ink)" }}>
          {p.numero ? `Proposta nº ${p.numero}` : "Nova proposta"}{p.titulo || p.destino ? ` · ${tituloDaProposta(p)}` : ""}
        </h1>
        <Etiqueta tom={TOM_PROPOSTA[p.status]}>{STATUS_PROPOSTA[p.status]}</Etiqueta>
        {sujo && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>não salvo</span>}
      </div>

      {/* Andamento */}
      {p.id && (
        <div className="rel-card px-4 py-3 text-[13px] flex flex-wrap gap-x-5 gap-y-1" style={{ color: "var(--ink2)" }}>
          {p.criado_por_nome && <span>Montada por <b>{p.criado_por_nome}</b></span>}
          {p.enviada_em && <span>Enviada {quando(p.enviada_em)}</span>}
          {p.status !== "rascunho" && (p.vista_em
            ? <span>👀 Cliente abriu {p.visualizacoes}× · última {quando(p.vista_ultima_em || p.vista_em)}</span>
            : <span>Cliente ainda não abriu o link</span>)}
          {p.aprovada_em && (
            <span style={{ color: "var(--rel-ink)" }}>
              ✅ {varias ? `Opção ${p.opcoes.findIndex((o) => o.id === p.aprovada_opcao_id) + 1}` : "Proposta"} aprovada {quando(p.aprovada_em)}{p.aprovada_nome ? ` por ${p.aprovada_nome} (pelo link)` : " (marcada pelo time)"}
            </span>
          )}
        </div>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}
      {cancelada && <Aviso>Proposta cancelada — o link não abre mais pro cliente. Duplique pra fazer uma nova.</Aviso>}

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" onClick={() => void salvar(true)} disabled={salvando || cancelada}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        <Botao onClick={() => setPrevia(true)}>Ver como o cliente vê</Botao>
        {!cancelada && <Botao onClick={() => void enviar()} disabled={salvando}>{p.status === "rascunho" ? "Enviar ao cliente" : "Link e mensagem"}</Botao>}
        {p.id && !cancelada && p.status !== "aprovada" && <Botao onClick={() => setMarcarAprov(true)}>Cliente aprovou (fora do link)</Botao>}
        {p.id && p.status === "enviada" && <Botao variante="fantasma" onClick={() => void acao(() => mudarStatus(p.id!, "recusada"), "Marcada como recusada.")}>Cliente recusou</Botao>}
        {p.id && (p.status === "aprovada" || p.status === "recusada") && <Botao variante="fantasma" onClick={() => { if (window.confirm("Voltar pra rascunho? A aprovação é desfeita e o link para de abrir até enviar de novo.")) void acao(() => mudarStatus(p.id!, "rascunho"), "Voltou pra rascunho."); }}>Voltar pra rascunho</Botao>}
        {p.id && <Botao variante="fantasma" onClick={() => void duplicarProposta(p.id!).then(onAbrir).catch((e) => setErro(e.message))}>Duplicar proposta</Botao>}
        {p.id && !cancelada && <Botao variante="fantasma" onClick={() => { if (window.confirm("Cancelar esta proposta? O link para de abrir pro cliente.")) void acao(() => mudarStatus(p.id!, "cancelada"), "Proposta cancelada."); }}>Cancelar proposta</Botao>}
      </div>
      {p.status === "aprovada" && <Aviso>Esta proposta já foi aprovada. Se mudar algo, o cliente vê a versão nova no mesmo link.</Aviso>}

      {/* Dados da viagem */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>A viagem</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Título (o cliente vê no topo)" dica={!p.titulo ? `Vazio = "${tituloDaProposta(p)}"` : undefined}>
            <Entrada value={p.titulo} placeholder="Ex.: Japão em família — primavera 2027" onChange={(e) => mudar({ titulo: e.target.value })} />
          </Campo>
          <Campo rotulo="Nome do cliente (aparece na proposta)"><Entrada value={p.cliente_nome} onChange={(e) => mudar({ cliente_nome: e.target.value })} /></Campo>
          <Campo rotulo="Destino"><Entrada value={p.destino} placeholder="Ex.: Japão" onChange={(e) => mudar({ destino: e.target.value })} /></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Ida"><Entrada type="date" value={p.data_ida} onChange={(e) => mudar({ data_ida: e.target.value })} /></Campo>
            <Campo rotulo="Volta"><Entrada type="date" value={p.data_volta} onChange={(e) => mudar({ data_volta: e.target.value })} /></Campo>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Campo rotulo="Adultos"><Entrada type="number" min={0} value={p.adultos} onChange={(e) => mudar({ adultos: Math.max(0, Math.floor(numero(e.target.value))) })} /></Campo>
            <Campo rotulo="Crianças"><Entrada type="number" min={0} value={p.criancas} onChange={(e) => mudar({ criancas: Math.max(0, Math.floor(numero(e.target.value))) })} /></Campo>
            <Campo rotulo="Bebês"><Entrada type="number" min={0} value={p.bebes} onChange={(e) => mudar({ bebes: Math.max(0, Math.floor(numero(e.target.value))) })} /></Campo>
          </div>
          <Campo rotulo="Foto da capa (link da imagem)" dica="Opcional. Cole o endereço de uma foto do destino.">
            <Entrada value={p.capa_url} placeholder="https://…" onChange={(e) => mudar({ capa_url: e.target.value })} />
          </Campo>
        </div>
        <Campo rotulo="Apresentação (texto de abertura pro cliente)">
          <textarea className={area} rows={3} value={p.apresentacao} placeholder="Ex.: Preparamos esta viagem pensando em vocês: cerejeiras em flor, Kyoto com calma e uma noite num ryokan…" onChange={(e) => mudar({ apresentacao: e.target.value })} />
        </Campo>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={p.esconder_precos} onChange={(e) => mudar({ esconder_precos: e.target.checked })} />
          Esconder o preço de cada serviço (o cliente vê só o total de cada opção)
        </label>
      </section>

      {/* Opções */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {varias && p.opcoes.map((o, n) => (
            <button key={o.k} type="button" onClick={() => setAba(n)} aria-current={n === nOpcao}
              className="px-3 py-1.5 rounded-full text-[13px] font-semibold border"
              style={n === nOpcao ? { background: "var(--rel)", color: "#fff", borderColor: "var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
              Opção {n + 1}{o.titulo ? ` · ${o.titulo}` : ""} · {brl(totaisDaOpcao(o).total)}{o.recomendada ? " ★" : ""}
            </button>
          ))}
          <Botao variante="fantasma" onClick={() => setNovaOpcao(true)} disabled={cancelada}>+ Nova opção</Botao>
        </div>

        {opcao && totais && (
          <div className="space-y-3">
            {varias && (
              <div className="rel-card p-4 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <Campo rotulo={`Nome da Opção ${nOpcao + 1}`}><Entrada value={opcao.titulo} placeholder="Ex.: Hotéis 4★" onChange={(e) => mudarOpcao(nOpcao, { titulo: e.target.value })} /></Campo>
                <Campo rotulo="Resumo (aparece no comparativo)"><Entrada value={opcao.descricao} placeholder="Ex.: mais econômica, voo com 1 conexão" onChange={(e) => mudarOpcao(nOpcao, { descricao: e.target.value })} /></Campo>
                <div className="flex gap-2">
                  <Botao onClick={() => { setP((x) => x && ({ ...x, opcoes: x.opcoes.map((o, k) => ({ ...o, recomendada: k === nOpcao ? !o.recomendada : false })) })); setSujo(true); }}>
                    {opcao.recomendada ? "★ Recomendada" : "☆ Recomendar"}
                  </Botao>
                  <Botao variante="perigo" onClick={() => tirarOpcao(nOpcao)}>Tirar</Botao>
                </div>
              </div>
            )}

            {/* Serviços */}
            <div className="space-y-2">
              {opcao.itens.length === 0 && (
                <div className="rel-card px-4 py-6 text-center text-[13.5px]" style={{ color: "var(--ink3)" }}>
                  Nenhum serviço ainda. Comece pelo aéreo ou pela hospedagem.
                </div>
              )}
              {opcao.itens.map((i, n) => (
                <EditorItem key={i.k} i={i}
                  onChange={(c) => mudarItem(nOpcao, i.k, c)}
                  onTirar={() => { if (window.confirm("Tirar este serviço?")) mudarOpcao(nOpcao, { itens: opcao.itens.filter((x) => x.k !== i.k) }); }}
                  onSubir={n > 0 ? () => { const l = [...opcao.itens]; [l[n - 1], l[n]] = [l[n], l[n - 1]]; mudarOpcao(nOpcao, { itens: l }); } : undefined}
                  onDescer={n < opcao.itens.length - 1 ? () => { const l = [...opcao.itens]; [l[n + 1], l[n]] = [l[n], l[n + 1]]; mudarOpcao(nOpcao, { itens: l }); } : undefined} />
              ))}
              {addTipo ? (
                <div className="rel-card p-3">
                  <p className="text-[12.5px] font-semibold mb-2" style={{ color: "var(--ink2)" }}>Que serviço?</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ORDEM_TIPOS.map((t: TipoItem) => (
                      <button key={t} type="button" className="rel-linha rounded-lg border px-3 py-2 text-left text-[13.5px]" style={{ borderColor: "var(--line)", color: "var(--ink)" }}
                        onClick={() => { mudarOpcao(nOpcao, { itens: [...opcao.itens, itemVazio(t, p)] }); setAddTipo(false); }}>
                        <span aria-hidden>{TIPOS[t].emoji}</span> {TIPOS[t].rotulo}
                      </button>
                    ))}
                  </div>
                  <Botao variante="fantasma" className="mt-2" onClick={() => setAddTipo(false)}>Cancelar</Botao>
                </div>
              ) : (
                <Botao onClick={() => setAddTipo(true)} disabled={cancelada}>+ Adicionar serviço</Botao>
              )}
            </div>

            {/* Valores e pagamento */}
            <div className="rel-card p-4 grid md:grid-cols-[280px_1fr] gap-5">
              <div className="space-y-2 text-[14px]">
                <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>Valores{varias ? ` da Opção ${nOpcao + 1}` : ""}</h3>
                <p className="flex justify-between"><span style={{ color: "var(--ink3)" }}>Subtotal</span><span className="tabular-nums">{brl(totais.subtotal)}</span></p>
                <Campo rotulo="Desconto (R$)"><Entrada type="number" step="0.01" min={0} value={opcao.desconto || ""} onChange={(e) => mudarOpcao(nOpcao, { desconto: numero(e.target.value) })} /></Campo>
                <p className="flex justify-between text-[16px] font-bold" style={{ color: "var(--ink)" }}><span>Total</span><span className="tabular-nums">{brl(totais.total)}</span></p>
                <div className="pt-2 border-t space-y-1 text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink2)" }}>
                  <p className="text-[11px] font-bold uppercase" style={{ color: "var(--ink3)" }}>Interno (o cliente não vê)</p>
                  {totais.temCusto ? (
                    <>
                      <p className="flex justify-between"><span>Custo</span><span className="tabular-nums">{brl(totais.custo)}</span></p>
                      <p className="flex justify-between"><span>Lucro</span><span className="tabular-nums">{brl(totais.lucro)}</span></p>
                      <p className="flex justify-between"><span>Margem</span><span className="tabular-nums">{totais.total > 0 ? `${((totais.lucro / totais.total) * 100).toFixed(1)}%` : "—"}</span></p>
                    </>
                  ) : <p style={{ color: "var(--ink3)" }}>Preencha o custo dos serviços pra ver lucro e margem.</p>}
                </div>
              </div>
              <div>
                <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--ink)" }}>Formas de pagamento <span className="font-normal text-[12.5px]" style={{ color: "var(--ink3)" }}>(alternativas — o cliente escolhe uma)</span></h3>
                <EditorPagamentos pags={opcao.pagamentos} total={totais.total} onChange={(pg) => mudarOpcao(nOpcao, { pagamentos: pg })} />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Observações */}
      <section className="rel-card p-4">
        <Campo rotulo="Informações importantes (o que inclui, o que não inclui, documentos, condições)">
          <textarea className={area} rows={5} value={p.observacoes} onChange={(e) => mudar({ observacoes: e.target.value })}
            placeholder={"Inclui: …\nNão inclui: refeições não mencionadas, gorjetas, despesas pessoais.\nDocumentos: passaporte com validade mínima de 6 meses."} />
        </Campo>
      </section>

      <div className="flex gap-2 pb-10">
        <Botao variante="primario" onClick={() => void salvar(true)} disabled={salvando || cancelada}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        <Botao onClick={() => setPrevia(true)}>Ver como o cliente vê</Botao>
      </div>

      {/* Prévia */}
      {previa && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#F8F6F7" }} role="dialog" aria-modal="true" aria-label="Prévia da proposta">
          <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
            <p className="flex-1 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Prévia{sujo ? " (com as mudanças ainda não salvas)" : ""}</p>
            <Botao onClick={() => setPrevia(false)}>Fechar</Botao>
          </div>
          <div className="flex-1 overflow-y-auto"><PropostaView p={paraVM(p)} previa /></div>
        </div>
      )}

      {/* + Nova opção */}
      <Modal aberto={novaOpcao} titulo="Nova opção" onFechar={() => setNovaOpcao(false)} largura={440}>
        <div className="space-y-2">
          <button type="button" className="rel-linha w-full text-left rounded-xl border p-3" style={{ borderColor: "var(--line)" }}
            onClick={() => { const nova = duplicarOpcao(opcao!, ""); mudar({ opcoes: [...p.opcoes, nova] }); setAba(p.opcoes.length); setNovaOpcao(false); }}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Duplicar {varias ? `a Opção ${nOpcao + 1}` : "esta viagem"}</p>
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Copia todos os serviços — aí é só trocar o hotel, o voo… (cópia independente)</p>
          </button>
          <button type="button" className="rel-linha w-full text-left rounded-xl border p-3" style={{ borderColor: "var(--line)" }}
            onClick={() => { mudar({ opcoes: [...p.opcoes, opcaoVazia()] }); setAba(p.opcoes.length); setNovaOpcao(false); }}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Começar do zero</p>
            <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Uma opção vazia, sem serviços</p>
          </button>
          {!varias && <p className="text-[12px] pt-1" style={{ color: "var(--ink3)" }}>Com 2 opções ou mais, o cliente vê um comparativo e escolhe a dele.</p>}
        </div>
      </Modal>

      {/* Enviar ao cliente */}
      <Modal aberto={envio} titulo="Enviar ao cliente" onFechar={fecharEnvio} largura={520}>
        {link ? (
          <div className="space-y-3">
            <Campo rotulo="Link da proposta">
              <div className="flex gap-2"><Entrada readOnly value={link} onFocus={(e) => e.target.select()} /><Botao onClick={() => copiar(link, "Link copiado.")}>Copiar</Botao></div>
            </Campo>
            <Campo rotulo="Mensagem pronta (cole no WhatsApp do cliente)">
              <textarea className={area} rows={7} readOnly value={mensagem} />
            </Campo>
            <div className="flex flex-wrap gap-2">
              <Botao variante="primario" onClick={() => copiar(mensagem, "Mensagem copiada — cole na conversa do cliente.")}>Copiar mensagem</Botao>
              <Botao onClick={() => window.open(`${link}?equipe=1`, "_blank", "noopener")}>Abrir o link</Botao>
            </div>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Quando o cliente abrir, aparece aqui. Se ele escolher uma opção pelo link, você recebe o aviso no menu Propostas.</p>
          </div>
        ) : <p className="text-[14px]">Salve a proposta primeiro.</p>}
      </Modal>

      {/* Cliente aprovou por fora */}
      <Modal aberto={marcarAprov} titulo="Qual opção o cliente aprovou?" onFechar={() => setMarcarAprov(false)} largura={440}>
        <div className="space-y-2">
          {p.opcoes.map((o, n) => (
            <button key={o.k} type="button" disabled={!o.id} className="rel-linha w-full text-left rounded-xl border p-3 disabled:opacity-50" style={{ borderColor: "var(--line)" }}
              onClick={() => { setMarcarAprov(false); void acao(() => mudarStatus(p.id!, "aprovada", o.id), "Aprovação registrada."); }}>
              <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{varias ? `Opção ${n + 1}${o.titulo ? ` · ${o.titulo}` : ""}` : "A proposta"}</p>
              <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{brl(totaisDaOpcao(o).total)}{!o.id ? " · salve antes" : ""}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
