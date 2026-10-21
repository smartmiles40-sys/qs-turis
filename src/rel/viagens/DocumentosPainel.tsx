// src/rel/viagens/DocumentosPainel.tsx
// -----------------------------------------------------------------------------
// Documentos (Fase 3): a lista, o envio pelo time, a revisão (aprovar/recusar,
// validade) e o "Pedir documentos ao cliente" — que gera o link público
// /documentos/<token> e, se a conversa estiver com a janela de 24h aberta,
// manda pelo WhatsApp do Relacionamento.
//
// Usado na viagem (vários passageiros) e na ficha do cliente (uma pessoa).
// O bucket é PRIVADO: abrir um arquivo gera um link assinado de 5 minutos.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  TIPOS_DOC, abrirDocumento, apagarDocumento, atualizarValidade, criarPedidoDocs, dataBR, linkDocumentos,
  listarDocumentos, listarPedidosDocs, revisarDocumento, subirDocumento, tamanhoLegivel,
  type Documento, type PedidoDocs, type TipoDocumento,
} from "../lib/viagens";
import { conversasDoCliente, enviarTexto } from "../lib/whatsapp";
import {
  ROTULO_CAMPO, aplicarSugestao, conferirDocumento, conferirPendentes, conferivel, precisaConferir,
  type DocumentoIa, type IaSugestao,
} from "../lib/docsIa";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

export interface Pessoa { id: string; nome: string }

const TOM_STATUS = { recebido: "aviso", aprovado: "rel", recusado: "erro" } as const;
const ROTULO_STATUS = { recebido: "a conferir", aprovado: "aprovado", recusado: "recusado" } as const;

// ── Pedir documentos ────────────────────────────────────────────────────────

export function PedirDocumentosModal({ aberto, pessoas, viagemId, onFechar, onCriado }: {
  aberto: boolean;
  pessoas: Pessoa[];
  viagemId?: string | null;
  onFechar: () => void;
  onCriado?: () => void;
}) {
  const [clienteId, setClienteId] = useState("");
  const [tipos, setTipos] = useState<TipoDocumento[]>(["passaporte"]);
  const [mensagem, setMensagem] = useState("");
  const [pedido, setPedido] = useState<PedidoDocs | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setClienteId(pessoas[0]?.id ?? ""); setTipos(["passaporte"]); setMensagem("");
    setPedido(null); setErro(null); setAviso(null);
  }, [aberto, pessoas]);

  const pessoa = pessoas.find((p) => p.id === clienteId);
  const primeiro = (pessoa?.nome || "").trim().split(/\s+/)[0] || "";
  const textoWhats = pedido
    ? `Oi${primeiro ? ` ${primeiro}` : ""}! Para organizarmos sua viagem, envie seus documentos por este link seguro (vale por 30 dias):\n${linkDocumentos(pedido.token)}`
    : "";

  async function criar() {
    if (!clienteId) { setErro("Escolha a pessoa."); return; }
    if (!tipos.length) { setErro("Escolha ao menos um documento."); return; }
    setOcupado(true); setErro(null);
    try {
      setPedido(await criarPedidoDocs({ clienteId, viagemId, tipos, mensagem }));
      onCriado?.();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou o link."); }
    finally { setOcupado(false); }
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(textoWhats); setAviso("Mensagem com o link copiada."); }
    catch { setAviso("Não consegui copiar — selecione o link e copie à mão."); }
  }

  async function mandarWhats() {
    setOcupado(true); setErro(null);
    try {
      const conversas = await conversasDoCliente(clienteId);
      const aberta = conversas.find((c) => c.janela_aberta);
      if (!aberta) {
        setErro("O cliente não escreveu nas últimas 24h: a Meta só deixa mandar um MODELO. Mande um modelo pela ficha (WhatsApp → Mandar mensagem) e, quando ele responder, envie o link.");
        return;
      }
      await enviarTexto(aberta.id, textoWhats);
      setAviso("Link enviado no WhatsApp do Relacionamento.");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não enviou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={pedido ? "Link de documentos pronto" : "Pedir documentos ao cliente"}
      onFechar={onFechar}
      rodape={pedido ? (
        <>
          <Botao onClick={copiar}>Copiar mensagem</Botao>
          <Botao variante="primario" onClick={mandarWhats} disabled={ocupado}>Mandar no WhatsApp</Botao>
        </>
      ) : (
        <>
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={criar} disabled={ocupado}>{ocupado ? "Criando…" : "Gerar link"}</Botao>
        </>
      )}
    >
      {pedido ? (
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            O cliente abre o link no celular, sem senha, e manda as fotos ou PDFs. Os arquivos chegam aqui com o status <b>a conferir</b>.
          </p>
          <div className="rounded-xl p-3 text-[13px] whitespace-pre-wrap break-all" style={{ background: "var(--wa-soft)", color: "var(--wa-ink)" }}>{textoWhats}</div>
          {aviso && <Aviso tom="ok">{aviso}</Aviso>}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>
      ) : (
        <div className="space-y-4">
          {pessoas.length > 1 && (
            <Campo rotulo="De quem?">
              <select className="rel-input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
          )}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Quais documentos?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(Object.keys(TIPOS_DOC) as TipoDocumento[]).map((t) => (
                <label key={t} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--ink)" }}>
                  <input type="checkbox" checked={tipos.includes(t)} onChange={(e) => setTipos((x) => e.target.checked ? [...x, t] : x.filter((y) => y !== t))} />
                  {TIPOS_DOC[t]}
                </label>
              ))}
            </div>
          </div>
          <Campo rotulo="Recado para o cliente (opcional)" dica="Aparece no topo da página do link.">
            <textarea className="rel-input" rows={2} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder="Ex.: a foto do passaporte precisa mostrar a página com a foto inteira." />
          </Campo>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>
      )}
    </Modal>
  );
}

// ── Selo da IA ──────────────────────────────────────────────────────────────

const SELO_IA = {
  ok: { tom: "rel", texto: "Conferido pela IA ✓" },
  divergente: { tom: "erro", texto: "Divergente ⚠" },
  ilegivel: { tom: "aviso", texto: "Ilegível" },
  erro: { tom: "aviso", texto: "IA: erro" },
  pendente: { tom: "neutro", texto: "IA: na fila" },
} as const;

function SeloIa({ d, onAplicar }: { d: DocumentoIa; onAplicar: (s: IaSugestao) => void }) {
  const [aberto, setAberto] = useState(false);
  if (!conferivel(d)) return null;
  if (!d.ia_status || precisaConferir(d)) {
    return <Etiqueta>{d.ia_em ? "IA: arquivo novo, conferir" : "IA: não conferido"}</Etiqueta>;
  }
  const r = d.ia_resultado;
  const s = SELO_IA[d.ia_status];
  const temDetalhe = !!r && (r.divergencias.length > 0 || r.alertas.length > 0 || r.sugestoes.length > 0 || d.ia_status !== "ok");
  return (
    <span className="inline-flex flex-col gap-1 w-full">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Etiqueta tom={s.tom}>{s.texto}</Etiqueta>
        {r && r.alertas.length > 0 && d.ia_status === "ok" && <Etiqueta tom="aviso">{r.alertas.length} alerta{r.alertas.length > 1 ? "s" : ""}</Etiqueta>}
        {temDetalhe && (
          <button className="text-[11px] underline" style={{ color: "var(--ink3)" }} onClick={() => setAberto((x) => !x)}>
            {aberto ? "esconder" : "ver o que a IA viu"}
          </button>
        )}
      </span>
      {aberto && r && (
        <span className="block rounded-lg p-2 text-[12px] space-y-1" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink2)" }}>
          <span className="block font-semibold" style={{ color: "var(--ink)" }}>{r.resumo}</span>
          {r.divergencias.map((x, i) => (
            <span key={i} className="block" style={{ color: "var(--err-ink)" }}>
              ⚠ {ROTULO_CAMPO[x.campo] || x.campo}: ficha <b>{x.cadastro || "—"}</b> × documento <b>{x.documento || "—"}</b>
            </span>
          ))}
          {r.alertas.map((a, i) => <span key={i} className="block" style={{ color: "var(--warn-ink)" }}>• {a}</span>)}
          {r.sugestoes.map((x) => (
            <span key={x.alvo + x.campo} className="flex flex-wrap items-center gap-2">
              <span>{x.rotulo} lido no documento: <b>{x.campo.includes("validade") || x.campo === "nascimento" ? x.valor.split("-").reverse().join("/") : x.valor}</b> (a ficha está vazia)</span>
              <button className="text-[11px] font-semibold underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAplicar(x)}>Usar no cadastro</button>
            </span>
          ))}
          {d.ia_em && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>Conferido em {new Date(d.ia_em).toLocaleString("pt-BR")}</span>}
        </span>
      )}
    </span>
  );
}

// ── O painel ────────────────────────────────────────────────────────────────

export default function DocumentosPainel({ pessoas, viagemId, clienteId, esconder }: {
  /** Quem pode ter documento aqui (passageiros da viagem ou o próprio cliente). */
  pessoas: Pessoa[];
  viagemId?: string | null;
  /** Na ficha: mostra os documentos do cliente de todas as viagens. */
  clienteId?: string;
  /** Ids de documentos pra não mostrar (cadastro único: cópias de 13/10 de arquivo que a ficha já mostra da expedição). */
  esconder?: ReadonlySet<string>;
}) {
  const { currentUser } = useQsAuth();
  const [docsTodos, setDocs] = useState<Documento[] | null>(null);
  const docs = esconder?.size && docsTodos ? docsTodos.filter((x) => !esconder.has(x.id)) : docsTodos;
  const [pedidos, setPedidos] = useState<PedidoDocs[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pedir, setPedir] = useState(false);
  const [subir, setSubir] = useState(false);
  const [recusando, setRecusando] = useState<Documento | null>(null);
  const [motivo, setMotivo] = useState("");
  const [iaOcupado, setIaOcupado] = useState<string | null>(null); // id do doc, ou "lote"
  const [iaAviso, setIaAviso] = useState<string | null>(null);

  // Formulário de envio pelo time
  const [quem, setQuem] = useState("");
  const [tipo, setTipo] = useState<TipoDocumento>("passaporte");
  const [validade, setValidade] = useState("");
  const [enviando, setEnviando] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const filtro = clienteId ? { clienteId } : { viagemId: viagemId || undefined };
  const chave = `${clienteId}|${viagemId}`;
  const carregar = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([listarDocumentos(filtro), listarPedidosDocs(filtro)]);
      setDocs(d); setPedidos(p); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou os documentos."); setDocs([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setQuem(pessoas[0]?.id ?? ""); }, [pessoas]);

  const nomeDe = (id: string) => pessoas.find((p) => p.id === id)?.nome?.split(" ")[0] || "";

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  async function abrir(d: Documento) {
    // Abre a aba ANTES do await: navegador bloqueia popup aberto depois de esperar.
    const aba = window.open("about:blank", "_blank");
    try {
      const url = await abrirDocumento(d);
      if (aba) aba.location.href = url; else window.open(url, "_blank");
    } catch (e) {
      aba?.close();
      setErro(e instanceof Error ? e.message : "Não abriu.");
    }
  }

  async function enviarArquivo(f: File | undefined) {
    if (!f || !quem) return;
    setEnviando(true); setErro(null);
    try {
      await subirDocumento({ clienteId: quem, viagemId: viagemId || null, tipo, arquivo: f, validade: validade || null });
      setSubir(false); setValidade("");
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não subiu."); }
    finally { setEnviando(false); if (arquivoRef.current) arquivoRef.current.value = ""; }
  }

  async function conferirUm(d: Documento) {
    setIaOcupado(d.id); setErro(null); setIaAviso(null);
    try { await conferirDocumento(d.id); await carregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "A IA não conferiu."); }
    finally { setIaOcupado(null); }
  }

  async function conferirTodos() {
    setIaOcupado("lote"); setErro(null); setIaAviso(null);
    try {
      const r = await conferirPendentes(clienteId ? { clienteId } : { viagemId });
      setIaAviso(r.conferidos === 0
        ? "Nada pendente: todos os documentos já foram conferidos."
        : `Conferidos ${r.conferidos}: ${r.ok} ok, ${r.divergentes} divergente(s), ${r.ilegiveis} ilegível(is), ${r.erros} com erro.${r.restam > 0 ? ` Faltam ${r.restam} — clique de novo.` : ""}${r.aviso ? ` ${r.aviso}` : ""}`);
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "A IA não conferiu."); }
    finally { setIaOcupado(null); }
  }

  const docsIa = (docs ?? []) as DocumentoIa[];
  const pendentesIa = docsIa.filter(precisaConferir).length;
  const vencendo = dataVencendo(docs);
  const pendentes = pedidos.filter((p) => !p.concluido_em && new Date(p.expira_em) > new Date());

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" onClick={() => setPedir(true)} disabled={!pessoas.length}>Pedir documentos ao cliente</Botao>
        <Botao onClick={() => setSubir(true)} disabled={!pessoas.length}>Enviar arquivo</Botao>
        {pendentesIa > 0 && (
          <Botao onClick={() => void conferirTodos()} disabled={!!iaOcupado} title="A IA lê cada documento e compara com a ficha do cliente">
            {iaOcupado === "lote" ? "Conferindo…" : `Conferir ${pendentesIa} pendente${pendentesIa > 1 ? "s" : ""} com IA`}
          </Botao>
        )}
      </div>
      {iaAviso && <Aviso tom="ok">{iaAviso}</Aviso>}

      {pendentes.length > 0 && (
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {pendentes.length} link{pendentes.length > 1 ? "s" : ""} de documentos aberto{pendentes.length > 1 ? "s" : ""} ·{" "}
          {pendentes.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <button className="underline" onClick={() => navigator.clipboard?.writeText(linkDocumentos(p.token))} title="Copiar link">
                {p.tipos.map((t) => TIPOS_DOC[t]).join(" + ")}{pessoas.length > 1 ? ` (${nomeDe(p.cliente_id)})` : ""}
              </button>
            </span>
          ))}
        </p>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {docs === null ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : docs.length === 0 ? (
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhum documento ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {docsIa.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <span className="flex-1 min-w-[180px]">
                <span className="flex flex-wrap items-center gap-1.5">
                  <b className="text-[13px]" style={{ color: "var(--ink)" }}>{TIPOS_DOC[d.tipo]}</b>
                  {pessoas.length > 1 && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>· {nomeDe(d.cliente_id)}</span>}
                  <Etiqueta tom={TOM_STATUS[d.status]}>{ROTULO_STATUS[d.status]}</Etiqueta>
                  {d.enviado_por === "cliente" && <Etiqueta>enviado pelo cliente</Etiqueta>}
                </span>
                <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                  {d.arquivo_nome} {d.tamanho ? `· ${tamanhoLegivel(d.tamanho)}` : ""} · {new Date(d.enviado_em).toLocaleDateString("pt-BR")}
                  {d.status === "recusado" && d.motivo_recusa ? ` · motivo: ${d.motivo_recusa}` : ""}
                </span>
                <span className="block mt-1"><SeloIa d={d} onAplicar={(s) => void acao(() => aplicarSugestao(d, s))} /></span>
              </span>
              <label className="flex items-center gap-1 text-[12px]" style={{ color: "var(--ink3)" }} title="Validade do documento">
                validade
                <input
                  type="date"
                  className="rel-input"
                  style={{ width: 140, padding: "4px 8px", fontSize: 12 }}
                  defaultValue={d.validade ?? ""}
                  onBlur={(e) => { if ((e.target.value || null) !== d.validade) void acao(() => atualizarValidade(d.id, e.target.value || null)); }}
                />
              </label>
              <Botao variante="fantasma" onClick={() => void abrir(d)}>Abrir</Botao>
              {conferivel(d) && d.status !== "recusado" && (
                <Botao variante="fantasma" disabled={!!iaOcupado} onClick={() => void conferirUm(d)} title="A IA lê o documento e compara com a ficha">
                  {iaOcupado === d.id ? "Conferindo…" : d.ia_em ? "Conferir de novo" : "Conferir com IA"}
                </Botao>
              )}
              {d.status !== "aprovado" && <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => void acao(() => revisarDocumento(d.id, "aprovado", currentUser?.id ?? ""))}>Aprovar</Botao>}
              {d.status !== "recusado" && <Botao variante="fantasma" onClick={() => { setRecusando(d); setMotivo(""); }}>Recusar</Botao>}
              <Botao variante="fantasma" title="Apagar" onClick={() => { if (window.confirm(`Apagar ${TIPOS_DOC[d.tipo]} (${d.arquivo_nome})? Não dá para desfazer.`)) void acao(() => apagarDocumento(d)); }}>×</Botao>
            </li>
          ))}
        </ul>
      )}

      {vencendo && (
        <p className="text-[12px]" style={{ color: "var(--warn-ink)" }}>
          Atenção: há documento com validade vencida ou vencendo em menos de 6 meses ({vencendo}).
        </p>
      )}

      <PedirDocumentosModal aberto={pedir} pessoas={pessoas} viagemId={viagemId} onFechar={() => setPedir(false)} onCriado={() => void carregar()} />

      <Modal
        aberto={subir}
        titulo="Enviar arquivo"
        onFechar={() => setSubir(false)}
        rodape={<><Botao variante="fantasma" onClick={() => setSubir(false)}>Cancelar</Botao><Botao variante="primario" disabled={enviando || !quem} onClick={() => arquivoRef.current?.click()}>{enviando ? "Enviando…" : "Escolher arquivo"}</Botao></>}
      >
        <div className="space-y-3">
          {pessoas.length > 1 && (
            <Campo rotulo="De quem?">
              <select className="rel-input" value={quem} onChange={(e) => setQuem(e.target.value)}>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Campo>
          )}
          <Campo rotulo="Tipo">
            <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumento)}>
              {(Object.keys(TIPOS_DOC) as TipoDocumento[]).map((t) => <option key={t} value={t}>{TIPOS_DOC[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Validade (se tiver)"><Entrada type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></Campo>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Foto, PDF ou qualquer arquivo até 20 MB. Enviado pelo time já entra como aprovado.</p>
          <input ref={arquivoRef} type="file" hidden onChange={(e) => void enviarArquivo(e.target.files?.[0])} />
        </div>
      </Modal>

      <Modal
        aberto={!!recusando}
        titulo="Recusar documento"
        onFechar={() => setRecusando(null)}
        rodape={<><Botao variante="fantasma" onClick={() => setRecusando(null)}>Cancelar</Botao><Botao variante="perigo" onClick={() => { const d = recusando!; setRecusando(null); void acao(() => revisarDocumento(d.id, "recusado", currentUser?.id ?? "", motivo.trim())); }}>Recusar</Botao></>}
      >
        <Campo rotulo="Motivo (aparece aqui para o time)">
          <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: foto cortada, documento vencido" autoFocus />
        </Campo>
      </Modal>
    </div>
  );
}

/** A primeira validade que vence em menos de 6 meses (ou já venceu), em DD/MM/AAAA. */
function dataVencendo(docs: Documento[] | null): string {
  if (!docs) return "";
  const limite = new Date();
  limite.setMonth(limite.getMonth() + 6);
  const d = docs.filter((x) => x.validade && x.status !== "recusado" && new Date(x.validade + "T12:00:00") < limite)
    .sort((a, b) => (a.validade! < b.validade! ? -1 : 1))[0];
  return d?.validade ? dataBR(d.validade) : "";
}
