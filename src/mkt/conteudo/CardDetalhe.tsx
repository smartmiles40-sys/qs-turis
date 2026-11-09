// src/mkt/conteudo/CardDetalhe.tsx
// -----------------------------------------------------------------------------
// O CARD ABERTO (0240): campos, checklist, anexos, comentários, rodadas de
// aprovação e histórico. Aprovar / devolver ficam aqui pro gestor; "Pedir
// aprovação" pra quem fez. Abre por #mkt/<tela>/<id> (o aviso do sino leva pra
// #mkt/quadro/<id>).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { useMkt } from "../contexto";
import {
  anexar, apagarCard, apagarComentario, aprovar, comentar, devolver, editarCard, erroDe, lerCard, listarAnexos,
  listarAprovacoes, listarComentarios, listarDestinos, listarHistorico, reaproveitar, tirarAnexo, type EdicaoCard,
} from "./dados";
import { colunaAceitaCardNovo, comentarioDeDevolucaoOk, dataCurta, estaAtrasado, hojeSP, lerTags, podeMover, progressoChecklist } from "./regras";
import { seletorDrive, type ArquivoEscolhido } from "./seletorDrive";
import { NOME_ORIGEM, NOME_TIPO, TIPOS, type Anexo, type Aprovacao, type CardMkt, type Coluna, type Comentario, type DestinoExp, type Historico, type ItemChecklist, type Origem, type TipoConteudo } from "./tipos";
import { ChipOrigem, ChipStatus, ChipTipo, SelectPessoa } from "./ui";

const ACAO: Record<string, string> = {
  criou: "criou o card", pediu: "abriu o pedido", reaproveitou: "reaproveitou da Biblioteca", moveu: "moveu",
  responsavel: "trocou o responsável para", prazo: "mudou o prazo para", publicacao: "mudou a publicação para",
  anexou: "anexou", tirou_anexo: "tirou o anexo", arquivou: "arquivou", desarquivou: "desarquivou",
};

function quando(iso: string) {
  const d = new Date(iso);
  // 04/11/2026: fuso fixo de SP (igual ao hojeSP), não o do aparelho.
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}
const novoId = () => Math.random().toString(36).slice(2, 10);

export default function CardDetalhe({ id, colunas, onFechar, onMudou, onAbrir }: {
  id: string;
  colunas: Coluna[];
  onFechar: () => void;
  /** Algo mudou: a tela de trás recarrega. */
  onMudou: () => void;
  /** Abrir outro card (o original de um reaproveitado, o card novo). */
  onAbrir: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const { aprovador, nomeDe } = useMkt();
  const [c, setC] = useState<CardMkt | null>(null);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [rodadas, setRodadas] = useState<Aprovacao[]>([]);
  const [destinos, setDestinos] = useState<DestinoExp[]>([]);
  const [original, setOriginal] = useState<CardMkt | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [naoAchou, setNaoAchou] = useState(false);
  const [aba, setAba] = useState<"comentarios" | "historico">("comentarios");
  // decisões
  const [decidindo, setDecidindo] = useState<null | "aprovar" | "devolver">(null);
  const [textoDecisao, setTextoDecisao] = useState("");
  const [reapAberto, setReapAberto] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const card = await lerCard(id);
      if (!card) { setNaoAchou(true); return; }
      setC(card);
      const [cm, an, hi, ro] = await Promise.all([listarComentarios(id), listarAnexos(id), listarHistorico(id), listarAprovacoes(id)]);
      setComentarios(cm); setAnexos(an); setHistorico(hi); setRodadas(ro);
      setOriginal(card.original_id ? await lerCard(card.original_id) : null);
    } catch (e) { setErro(erroDe(e)); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { listarDestinos().then(setDestinos).catch(() => setDestinos([])); }, []);

  const colPorId = useMemo(() => new Map(colunas.map((k) => [k.id, k])), [colunas]);
  const coluna = c ? colPorId.get(c.coluna_id) : undefined;
  const ordenadas = useMemo(() => [...colunas].sort((a, b) => a.ordem - b.ordem), [colunas]);

  async function fazer(f: () => Promise<unknown>, fechar = false) {
    setOcupado(true); setErro(null);
    try {
      await f();
      onMudou();
      if (fechar) onFechar(); else await carregar();
    } catch (e) {
      setErro(erroDe(e));
      // 04/11/2026: o checklist muda na tela antes de salvar; se o banco recusou,
      // relê o card pra tela não mostrar como salvo o que não foi.
      void carregar();
    }
    finally { setOcupado(false); }
  }
  const salvar = (m: EdicaoCard) => c && fazer(() => editarCard(c.id, m));

  if (naoAchou) {
    return (
      <Modal aberto titulo="Card" onFechar={onFechar}>
        <Aviso>Esse card não existe mais (ou você não tem acesso a ele).</Aviso>
      </Modal>
    );
  }
  if (!c || !coluna) {
    // 04/11/2026: card lido mas a etapa dele não está na lista de colunas desta tela
    // ficava em "Carregando…" pra sempre.
    return <Modal aberto titulo="Card" onFechar={onFechar}><p className="text-[13px]" style={{ color: "var(--ink3)" }}>{erro ?? (c ? "A etapa deste card não apareceu no quadro. Recarregue a página." : "Carregando…")}</p></Modal>;
  }

  const hoje = hojeSP();
  const atrasado = estaAtrasado(c, coluna.tipo, hoje);
  const colAprovacao = colunas.find((k) => k.tipo === "aprovacao");
  const emAprovacao = coluna.tipo === "aprovacao";
  const destinosPossiveis = ordenadas.filter((k) => k.id === c.coluna_id || podeMover(coluna.tipo, k.tipo, aprovador, c.status_aprovacao).ok);
  const ck = progressoChecklist(c.checklist);
  const Drive = seletorDrive();

  function mudarColuna(destId: string) {
    if (!c || destId === c.coluna_id) return;
    const dest = colPorId.get(destId);
    if (!dest || !coluna) return;
    const m = podeMover(coluna.tipo, dest.tipo, aprovador, c.status_aprovacao);
    if (!m.ok) { setErro(m.motivo); return; }
    if (m.acao === "aprovar" && emAprovacao) { setDecidindo("aprovar"); return; }
    if (m.acao === "devolver") { setDecidindo("devolver"); return; }
    void salvar({ coluna_id: destId });
  }

  function mudarChecklist(itens: ItemChecklist[]) {
    setC((x) => (x ? { ...x, checklist: itens } : x));
    void salvar({ checklist: itens });
  }

  return (
    <Modal aberto titulo={c.eh_pedido ? "Pedido do Tráfego" : "Conteúdo"} onFechar={onFechar} largura={820}>
      <div className="space-y-5">
        {/* Título e selos */}
        <div>
          <input
            key={`t${c.atualizado_em}`}
            defaultValue={c.titulo}
            aria-label="Título"
            className="w-full text-lg font-bold bg-transparent rounded-md px-1 -mx-1 focus:outline-none focus-visible:ring-2"
            style={{ color: "var(--ink)" }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.titulo) void salvar({ titulo: v }); }}
          />
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <ChipOrigem origem={c.origem} pedido={c.eh_pedido} />
            <ChipTipo tipo={c.tipo} />
            <ChipStatus status={c.status_aprovacao} rodada={c.rodada} />
            {atrasado && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>Atrasado</span>}
            {c.arquivado && <span className="text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>Arquivado</span>}
          </div>
          {original && (
            <button type="button" className="mt-2 text-[12px] font-semibold underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrir(original.id)}>
              Reaproveitado de: {original.titulo}
            </button>
          )}
        </div>

        {erro && <Aviso tom="erro">{erro}</Aviso>}

        {/* Fluxo: coluna + aprovação */}
        <div className="rel-card p-3 sm:p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 min-w-0">
              <Campo rotulo="Etapa">
                <select className="rel-input" value={c.coluna_id} disabled={ocupado} onChange={(e) => mudarColuna(e.target.value)}>
                  {destinosPossiveis.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}
                </select>
              </Campo>
            </div>
            <div className="flex flex-wrap gap-2">
              {!emAprovacao && colAprovacao && coluna.tipo !== "aprovado" && coluna.tipo !== "publicado" && (
                <Botao variante="primario" disabled={ocupado} onClick={() => void salvar({ coluna_id: colAprovacao.id })}>
                  Pedir aprovação
                </Botao>
              )}
              {emAprovacao && aprovador && (
                <>
                  <Botao variante="primario" disabled={ocupado} onClick={() => { setTextoDecisao(""); setDecidindo("aprovar"); }}>Aprovar</Botao>
                  <Botao variante="perigo" disabled={ocupado} onClick={() => { setTextoDecisao(""); setDecidindo("devolver"); }}>Devolver</Botao>
                </>
              )}
              {c.status_aprovacao === "aprovado" && (
                <Botao disabled={ocupado} onClick={() => setReapAberto(true)}>Reaproveitar para tráfego</Botao>
              )}
            </div>
          </div>
          {emAprovacao && !aprovador && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Esperando o gestor de Marketing aprovar ou devolver. Enquanto isso o card fica parado aqui.</p>
          )}
          {decidindo && (
            <div className="space-y-2">
              <Campo rotulo={decidindo === "devolver" ? "O que precisa ajustar? (obrigatório)" : "Comentário (opcional)"}>
                <textarea className="rel-input" rows={3} autoFocus value={textoDecisao} onChange={(e) => setTextoDecisao(e.target.value)} />
              </Campo>
              <div className="flex gap-2 justify-end">
                <Botao variante="fantasma" onClick={() => setDecidindo(null)}>Cancelar</Botao>
                {decidindo === "aprovar" ? (
                  <Botao variante="primario" disabled={ocupado} onClick={() => void fazer(async () => { await aprovar(c.id, textoDecisao); setDecidindo(null); })}>Confirmar aprovação</Botao>
                ) : (
                  <Botao variante="perigo" disabled={ocupado || !comentarioDeDevolucaoOk(textoDecisao)}
                    onClick={() => void fazer(async () => { await devolver(c.id, textoDecisao); setDecidindo(null); })}>Devolver pra ajustes</Botao>
                )}
              </div>
            </div>
          )}
          {rodadas.length > 0 && (
            <ul className="text-[12px] space-y-1" style={{ color: "var(--ink2)" }}>
              {rodadas.map((r) => (
                <li key={r.id}>
                  <b>{r.rodada}ª rodada</b> · enviada {quando(r.enviado_em)} por {nomeDe(r.enviado_por)}
                  {r.decisao && <> · <b style={{ color: r.decisao === "aprovado" ? "var(--rel-ink)" : "var(--err-ink)" }}>{r.decisao === "aprovado" ? "aprovada" : "devolvida"}</b> por {nomeDe(r.decidido_por)}{r.decidido_em ? ` em ${quando(r.decidido_em)}` : ""}</>}
                  {r.comentario && <span className="block pl-3" style={{ color: "var(--ink3)" }}>“{r.comentario}”</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Campos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Tipo">
            <select className="rel-input" value={c.tipo} onChange={(e) => void salvar({ tipo: e.target.value as TipoConteudo })}>
              {TIPOS.map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Área">
            <select className="rel-input" value={c.origem} onChange={(e) => void salvar({ origem: e.target.value as Origem })}>
              {(["organico", "trafego"] as Origem[]).map((o) => <option key={o} value={o}>{NOME_ORIGEM[o]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Responsável">
            <SelectPessoa valor={c.responsavel_id} onMudar={(v) => void salvar({ responsavel_id: v })} />
          </Campo>
          <Campo rotulo="Prazo" dica={atrasado ? "Prazo vencido" : undefined}>
            <Entrada type="date" defaultValue={c.prazo ?? ""} key={`p${c.prazo}`} onBlur={(e) => { const v = e.target.value || null; if (v !== c.prazo) void salvar({ prazo: v }); }} />
          </Campo>
          <Campo rotulo="Data de publicação" dica="Aparece no calendário editorial.">
            <Entrada type="date" defaultValue={c.data_publicacao ?? ""} key={`d${c.data_publicacao}`} onBlur={(e) => { const v = e.target.value || null; if (v !== c.data_publicacao) void salvar({ data_publicacao: v }); }} />
          </Campo>
          <Campo rotulo="Expedição / pacote">
            <select className="rel-input" value={c.expedicao_id ?? ""} onChange={(e) => {
              const exp = destinos.find((d) => d.id === e.target.value);
              void salvar({ expedicao_id: exp?.id ?? null, ...(exp && !c.destino ? { destino: exp.destino ?? exp.nome } : {}) });
            }}>
              <option value="">Nenhum</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nome}{d.data_embarque ? ` · ${dataCurta(d.data_embarque, hoje)}` : ""}{d.tipo === "pacote" ? " (pacote)" : ""}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Destino" dica="Ex.: Japão, Peru — vira filtro na Biblioteca.">
            <Entrada defaultValue={c.destino ?? ""} key={`de${c.destino}`} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.destino) void salvar({ destino: v }); }} />
          </Campo>
          <Campo rotulo="Temas (tags)" dica="Separe por vírgula: cultura, gastronomia, depoimento…">
            <Entrada defaultValue={c.tags.join(", ")} key={`g${c.tags.join()}`} onBlur={(e) => { const v = lerTags(e.target.value); if (v.join() !== c.tags.join()) void salvar({ tags: v }); }} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo rotulo={c.eh_pedido ? "Briefing do pedido" : "Descrição / roteiro"}>
              <textarea className="rel-input" rows={4} defaultValue={c.descricao ?? ""} key={`x${c.atualizado_em}`}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.descricao) void salvar({ descricao: v }); }} />
            </Campo>
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Link da publicação" dica="Quando sair no ar: o link do post/anúncio.">
              <Entrada type="url" placeholder="https://" defaultValue={c.link_publicacao ?? ""} key={`l${c.link_publicacao}`}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== c.link_publicacao) void salvar({ link_publicacao: v }); }} />
            </Campo>
          </div>
        </div>

        {/* Checklist */}
        <Checklist itens={c.checklist} progresso={ck} onMudar={mudarChecklist} />

        {/* Anexos */}
        <Anexos anexos={anexos} Drive={Drive} podeTirar={(a) => a.criado_por === currentUser?.id || aprovador}
          onAnexar={(l) => currentUser && void fazer(() => anexar(c.id, currentUser.id, l))}
          onTirar={(a) => void fazer(() => tirarAnexo(a.id))} />

        {/* Comentários / histórico */}
        <div>
          <div className="flex gap-1 mb-2" role="tablist">
            {(["comentarios", "historico"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={aba === t} type="button" onClick={() => setAba(t)}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold"
                style={aba === t ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
                {t === "comentarios" ? `Comentários (${comentarios.length})` : "Histórico"}
              </button>
            ))}
          </div>
          {aba === "comentarios" ? (
            <Comentarios lista={comentarios} nomeDe={nomeDe} meuId={currentUser?.id} aprovador={aprovador}
              onEnviar={(t) => currentUser && void fazer(() => comentar(c.id, currentUser.id, t))}
              onApagar={(cm) => void fazer(() => apagarComentario(cm.id))} />
          ) : (
            <ul className="space-y-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
              {historico.length === 0 && <li style={{ color: "var(--ink3)" }}>Nada registrado ainda.</li>}
              {historico.map((h) => (
                <li key={h.id}><span style={{ color: "var(--ink3)" }}>{quando(h.criado_em)}</span> · <b>{nomeDe(h.user_id)}</b> {ACAO[h.acao] ?? h.acao}{h.detalhe ? `: ${h.detalhe}` : ""}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Rodapé do card */}
        <div className="flex flex-wrap gap-2 justify-between pt-2 border-t" style={{ borderColor: "var(--line)" }}>
          <p className="text-[11px]" style={{ color: "var(--ink3)" }}>
            Criado por {nomeDe(c.criado_por)} em {quando(c.criado_em)}{c.solicitante_id && c.solicitante_id !== c.criado_por ? ` · pedido de ${nomeDe(c.solicitante_id)}` : ""}
          </p>
          <div className="flex gap-2">
            <Botao variante="fantasma" disabled={ocupado} onClick={() => void salvar({ arquivado: !c.arquivado })}>{c.arquivado ? "Desarquivar" : "Arquivar"}</Botao>
            {(c.criado_por === currentUser?.id || aprovador) && (
              <Botao variante="perigo" disabled={ocupado} onClick={() => { if (window.confirm("Apagar este card de vez? Comentários e anexos vão junto.")) void fazer(() => apagarCard(c.id), true); }}>Apagar</Botao>
            )}
          </div>
        </div>
      </div>

      {reapAberto && (
        <Reaproveitar card={c} colunaEntradaOk={colunas.some((k) => k.tipo === "entrada" && colunaAceitaCardNovo(k.tipo))}
          onFechar={() => setReapAberto(false)}
          onFeito={(novo) => { setReapAberto(false); onMudou(); onAbrir(novo); }} />
      )}
    </Modal>
  );
}

function Checklist({ itens, progresso, onMudar }: { itens: ItemChecklist[]; progresso: { feitos: number; total: number }; onMudar: (l: ItemChecklist[]) => void }) {
  const [novo, setNovo] = useState("");
  return (
    <div>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>
        Checklist {progresso.total > 0 && <span style={{ color: "var(--ink3)" }}>· {progresso.feitos}/{progresso.total}</span>}
      </p>
      <ul className="space-y-1">
        {itens.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={i.feito} aria-label={i.texto} onChange={(e) => onMudar(itens.map((x) => (x.id === i.id ? { ...x, feito: e.target.checked } : x)))} />
            <span className="flex-1 min-w-0" style={{ color: i.feito ? "var(--ink3)" : "var(--ink)", textDecoration: i.feito ? "line-through" : undefined }}>{i.texto}</span>
            <button type="button" aria-label={`Tirar ${i.texto}`} className="text-[12px] px-1" style={{ color: "var(--ink3)" }} onClick={() => onMudar(itens.filter((x) => x.id !== i.id))}>×</button>
          </li>
        ))}
      </ul>
      <form className="flex gap-2 mt-2" onSubmit={(e) => { e.preventDefault(); const t = novo.trim(); if (!t) return; onMudar([...itens, { id: novoId(), texto: t, feito: false }]); setNovo(""); }}>
        <Entrada placeholder="Novo item (ex.: legenda, capa, música)" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Botao type="submit" disabled={!novo.trim()}>Adicionar</Botao>
      </form>
    </div>
  );
}

function Anexos({ anexos, Drive, podeTirar, onAnexar, onTirar }: {
  anexos: Anexo[];
  Drive: ReturnType<typeof seletorDrive>;
  podeTirar: (a: Anexo) => boolean;
  onAnexar: (l: { nome: string; url?: string | null; drive_file_id?: string | null; mime?: string | null; thumb?: string | null }[]) => void;
  onTirar: (a: Anexo) => void;
}) {
  const [url, setUrl] = useState("");
  const [nome, setNome] = useState("");
  const [driveAberto, setDriveAberto] = useState(false);
  const urlOk = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <div>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Anexos {anexos.length > 0 && <span style={{ color: "var(--ink3)" }}>· {anexos.length}</span>}</p>
      {anexos.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          {anexos.map((a) => (
            <li key={a.id} className="rel-card flex items-center gap-2 p-2 min-w-0">
              {a.thumb ? <img src={a.thumb} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" loading="lazy" />
                : <span className="w-10 h-10 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "var(--card2)", color: "var(--ink3)" }}>{a.drive_file_id ? "DRIVE" : "LINK"}</span>}
              <a href={a.url ?? undefined} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-[13px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--ink)" }}>{a.nome}</a>
              {podeTirar(a) && <button type="button" aria-label={`Tirar ${a.nome}`} className="text-[12px] px-1" style={{ color: "var(--ink3)" }} onClick={() => onTirar(a)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!urlOk) return;
        const u = url.trim();
        onAnexar([{ nome: nome.trim() || u.replace(/^https?:\/\//, "").slice(0, 80), url: u }]);
        setUrl(""); setNome("");
      }}>
        <Entrada type="url" placeholder="Colar link (Drive, Canva, YouTube…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Entrada placeholder="Nome (opcional)" value={nome} onChange={(e) => setNome(e.target.value)} className="sm:max-w-[200px]" />
        <Botao type="submit" disabled={!urlOk}>Anexar link</Botao>
        {Drive && <Botao type="button" onClick={() => setDriveAberto(true)}>Escolher do Drive</Botao>}
      </form>
      {Drive && (
        <Drive aberto={driveAberto} onFechar={() => setDriveAberto(false)}
          onEscolher={(arqs: ArquivoEscolhido[]) => { setDriveAberto(false); onAnexar(arqs.map((x) => ({ ...x }))); }} />
      )}
    </div>
  );
}

function Comentarios({ lista, nomeDe, meuId, aprovador, onEnviar, onApagar }: {
  lista: Comentario[]; nomeDe: (id: string | null) => string; meuId?: string; aprovador: boolean;
  onEnviar: (t: string) => void; onApagar: (c: Comentario) => void;
}) {
  const [texto, setTexto] = useState("");
  return (
    <div>
      <ul className="space-y-2 mb-2">
        {lista.length === 0 && <li className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhum comentário ainda.</li>}
        {lista.map((cm) => {
          const destaque = cm.tipo === "devolucao" ? { background: "var(--err-bg)", borderColor: "var(--err-line)" }
            : cm.tipo === "aprovacao" ? { background: "var(--rel-soft)", borderColor: "transparent" } : { background: "var(--card2)", borderColor: "var(--line)" };
          return (
            <li key={cm.id} className="rounded-lg border px-3 py-2" style={destaque}>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--ink3)" }}>
                <b style={{ color: "var(--ink2)" }}>{nomeDe(cm.autor_id)}</b>
                {cm.tipo === "devolucao" && <span style={{ color: "var(--err-ink)" }}>devolveu pra ajustes</span>}
                {cm.tipo === "aprovacao" && <span style={{ color: "var(--rel-ink)" }}>aprovou</span>}
                <span>{quando(cm.criado_em)}</span>
                {((cm.autor_id === meuId && cm.tipo === "comentario") || aprovador) && (
                  <button type="button" className="ml-auto underline" onClick={() => { if (window.confirm("Apagar o comentário?")) onApagar(cm); }}>apagar</button>
                )}
              </div>
              <p className="text-[13px] mt-0.5 whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{cm.texto}</p>
            </li>
          );
        })}
      </ul>
      <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); if (!texto.trim()) return; onEnviar(texto); setTexto(""); }}>
        <textarea className="rel-input" rows={2} placeholder="Escreva um comentário…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Botao type="submit" variante="primario" disabled={!texto.trim()}>Comentar</Botao>
      </form>
    </div>
  );
}

function Reaproveitar({ card, colunaEntradaOk, onFechar, onFeito }: { card: CardMkt; colunaEntradaOk: boolean; onFechar: () => void; onFeito: (novoId: string) => void }) {
  const [tipo, setTipo] = useState<TipoConteudo>("criativo_anuncio");
  const [titulo, setTitulo] = useState(`Tráfego: ${card.titulo}`.slice(0, 200));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal aberto titulo="Reaproveitar para tráfego" onFechar={onFechar}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={ocupado || !titulo.trim() || !colunaEntradaOk} onClick={async () => {
          setOcupado(true); setErro(null);
          try { onFeito(await reaproveitar(card.id, tipo, titulo)); } catch (e) { setErro(erroDe(e)); setOcupado(false); }
        }}>Criar card do Tráfego</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Cria um card novo do Tráfego, ligado a este conteúdo, com os mesmos anexos, destino e temas. O original não muda.
        </p>
        {/* 04/11/2026: "Colunas do quadro" virou a aba Ajustes › Colunas (30/10). */}
        {!colunaEntradaOk && <Aviso>O quadro precisa de uma coluna de entrada (configure em Ajustes › Colunas).</Aviso>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Campo rotulo="Título"><Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Campo>
        <Campo rotulo="Vai virar">
          <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoConteudo)}>
            {TIPOS.map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
          </select>
        </Campo>
      </div>
    </Modal>
  );
}
