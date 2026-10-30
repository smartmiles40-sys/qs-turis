// src/mkt/drive/Visualizador.tsx
// Abre um arquivo do Drive sem sair do QS: player de vídeo/áudio (mídia vem
// pelo proxy assinado do QS, em pedaços), imagem grande, PDF, e o resto pela
// visualização do Google. Ao lado: nome, tags, expedição, observação, mover e
// lixeira.
import { useEffect, useState } from "react";
import type { ConfigDrive, ItemDrive, Migalha } from "./tipos";
import * as api from "./api";
import { formatarData, formatarDuracao, formatarTamanho, ROTULO_TIPO, tocaNoNavegador } from "./formato";
import { Botao, Chip, Ic, IconeTipo, Modal, estiloEntrada } from "./ui";

function Midia({ item }: { item: ItemDrive }) {
  const [falhou, setFalhou] = useState(false);
  const caixa = "w-full rounded-xl overflow-hidden flex items-center justify-center";
  if (!falhou && item.midiaUrl && tocaNoNavegador(item.mimeType)) {
    return item.tipo === "audio" ? (
      <div className={`${caixa} p-6`} style={{ background: "var(--card2)" }}>
        <audio src={item.midiaUrl} controls preload="metadata" className="w-full" onError={() => setFalhou(true)} />
      </div>
    ) : (
      <div className={caixa} style={{ background: "#000" }}>
        <video src={item.midiaUrl} controls playsInline preload="metadata" poster={item.miniaturaGrandeUrl || undefined}
          className="w-full max-h-[62vh]" onError={() => setFalhou(true)} />
      </div>
    );
  }
  if (!falhou && item.tipo === "imagem" && (item.miniaturaGrandeUrl || item.midiaUrl)) {
    return (
      <div className={caixa} style={{ background: "var(--card2)" }}>
        <img src={item.miniaturaGrandeUrl || item.midiaUrl!} alt={item.nome} className="max-w-full max-h-[62vh] object-contain" onError={() => setFalhou(true)} />
      </div>
    );
  }
  if (!falhou && item.tipo === "pdf" && item.midiaUrl) {
    return <iframe title={item.nome} src={item.midiaUrl} className="w-full h-[62vh] rounded-xl" style={{ border: "1px solid var(--line)" }} />;
  }
  // Documento do Google, vídeo em formato que o navegador não toca, ou a mídia
  // não carregou: visualização do próprio Drive (precisa de acesso no Google).
  return (
    <div className="flex flex-col gap-2">
      <iframe title={item.nome} src={item.previewLink} allow="autoplay; fullscreen" className="w-full h-[58vh] rounded-xl" style={{ border: "1px solid var(--line)", background: "var(--card2)" }} />
      <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
        Esta visualização é do Google: se aparecer “pedir acesso”, abra no Drive com uma conta que seja membro do Drive compartilhado.
      </p>
    </div>
  );
}

function SeletorPasta({ aberto, excluirId, onFechar, onEscolher }: { aberto: boolean; excluirId: string; onFechar: () => void; onEscolher: (pastaId: string | null, nome: string) => void }) {
  const [pastaId, setPastaId] = useState<string | null>(null);
  const [caminho, setCaminho] = useState<Migalha[]>([]);
  const [pastas, setPastas] = useState<ItemDrive[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setErro(null);
    api.listarPasta(pastaId).then((r) => {
      if (!vivo) return;
      setPastas(r.itens.filter((i) => i.tipo === "pasta" && i.id !== excluirId));
      if (r.caminho) setCaminho(r.caminho);
    }).catch((e) => vivo && setErro((e as Error).message));
    return () => { vivo = false; };
  }, [aberto, pastaId, excluirId]);
  const atual = caminho[caminho.length - 1];
  return (
    <Modal aberto={aberto} titulo="Mover para…" onFechar={onFechar} largura={460}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => onEscolher(pastaId, atual?.nome || "Marketing")}>Mover pra cá</Botao></>}>
      <nav className="flex flex-wrap items-center gap-0.5 text-[12.5px] mb-2">
        {caminho.map((m, i) => (
          <span key={m.id} className="inline-flex items-center">
            {i > 0 && <span style={{ color: "var(--ink3)" }}>{Ic.seta()}</span>}
            <button type="button" className="px-1 hover:underline" style={{ color: "var(--ink2)" }} onClick={() => setPastaId(i === 0 ? null : m.id)}>{m.nome}</button>
          </span>
        ))}
      </nav>
      {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      <ul className="flex flex-col gap-1">
        {pastas.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setPastaId(p.id)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[13px] hover:bg-[var(--card2)]" style={{ color: "var(--ink)" }}>
              <IconeTipo tipo="pasta" /> <span className="truncate">{p.nome}</span>
            </button>
          </li>
        ))}
        {!pastas.length && !erro && <li className="text-[12.5px] px-2 py-3" style={{ color: "var(--ink3)" }}>Sem subpastas aqui.</li>}
      </ul>
    </Modal>
  );
}

export function Visualizador({ item: inicial, config, onFechar, onMudou, onIrParaPasta }: {
  item: ItemDrive | null;
  config: ConfigDrive | null;
  onFechar: () => void;
  /** Algo mudou no Drive (renomeou, moveu, lixeira, tags) → a lista recarrega. */
  onMudou: () => void;
  onIrParaPasta?: (pastaId: string | null) => void;
}) {
  const [item, setItem] = useState<ItemDrive | null>(inicial);
  const [caminho, setCaminho] = useState<Migalha[]>([]);
  const [nome, setNome] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [novaTag, setNovaTag] = useState("");
  const [expedicaoId, setExpedicaoId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [confirmarLixeira, setConfirmarLixeira] = useState(false);

  useEffect(() => {
    setItem(inicial);
    setAviso(null);
    setConfirmarLixeira(false);
    if (!inicial) return;
    setNome(inicial.nome); setTags(inicial.tags); setExpedicaoId(inicial.expedicaoId || ""); setObservacao(inicial.observacao || "");
    let vivo = true;
    api.metadados(inicial.id).then((r) => {
      if (!vivo) return;
      setItem(r.item); setCaminho(r.caminho);
      setTags(r.item.tags); setExpedicaoId(r.item.expedicaoId || ""); setObservacao(r.item.observacao || "");
    }).catch(() => { /* fica com o que veio da lista */ });
    return () => { vivo = false; };
  }, [inicial]);

  if (!item) return null;

  const adicionarTag = () => {
    const t = novaTag.replace(/^#+/, "").trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 20) setTags([...tags, t]);
    setNovaTag("");
  };

  const salvar = async () => {
    setSalvando(true); setAviso(null);
    try {
      let atual = item;
      if (nome.trim() && nome.trim() !== item.nome) atual = (await api.renomear(item.id, nome.trim())).item;
      const r = await api.etiquetar(item.id, { tags, expedicaoId: expedicaoId || null, observacao: observacao.trim() || null });
      setItem({ ...atual, ...r.item, midiaUrl: atual.midiaUrl, miniaturaGrandeUrl: item.miniaturaGrandeUrl });
      setAviso({ tom: "ok", texto: "Salvo." });
      onMudou();
    } catch (e) {
      setAviso({ tom: "erro", texto: (e as Error).message });
    } finally { setSalvando(false); }
  };

  const moverPara = async (pastaId: string | null, nomePasta: string) => {
    setMovendo(false); setAviso(null);
    try {
      await api.mover(item.id, pastaId);
      setAviso({ tom: "ok", texto: `Movido para “${nomePasta}”.` });
      const r = await api.metadados(item.id).catch(() => null);
      if (r) setCaminho(r.caminho);
      onMudou();
    } catch (e) { setAviso({ tom: "erro", texto: (e as Error).message }); }
  };

  const lixeira = async () => {
    try {
      await api.mandarPraLixeira(item.id);
      onMudou();
      onFechar();
    } catch (e) { setAviso({ tom: "erro", texto: (e as Error).message }); }
  };

  const sugestoes = (config?.tags || []).map((t) => t.tag).filter((t) => !tags.includes(t) && (!novaTag || t.includes(novaTag.toLowerCase()))).slice(0, 8);
  const dur = formatarDuracao(item.duracaoMs);

  return (
    <Modal aberto titulo={item.nome} onFechar={onFechar} largura={1180} cheio>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 flex flex-col gap-2">
          <Midia key={item.id} item={item} />
          <div className="flex flex-wrap gap-2">
            <a href={item.webViewLink} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
              {Ic.externo()} Abrir no Google Drive
            </a>
            {/* O proxy entrega no máximo 4 MB por pedido: baixar pelo QS só arquivo pequeno. */}
            {item.midiaUrl && item.tamanho != null && item.tamanho <= 4 * 1024 * 1024 && (
              <a href={item.midiaUrl} download={item.nome}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                Baixar
              </a>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-3 text-[13px] min-w-0">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt style={{ color: "var(--ink3)" }}>Tipo</dt><dd style={{ color: "var(--ink)" }}>{ROTULO_TIPO[item.tipo]}</dd>
            {item.tamanho != null && <><dt style={{ color: "var(--ink3)" }}>Tamanho</dt><dd style={{ color: "var(--ink)" }}>{formatarTamanho(item.tamanho)}</dd></>}
            {dur && <><dt style={{ color: "var(--ink3)" }}>Duração</dt><dd style={{ color: "var(--ink)" }}>{dur}</dd></>}
            <dt style={{ color: "var(--ink3)" }}>Modificado</dt><dd style={{ color: "var(--ink)" }}>{formatarData(item.modificadoEm)}{item.modificadoPor ? ` · ${item.modificadoPor}` : ""}</dd>
            <dt style={{ color: "var(--ink3)" }}>Pasta</dt>
            <dd className="min-w-0">
              {caminho.length ? (
                <button type="button" className="text-left hover:underline truncate max-w-full" style={{ color: "var(--ink)" }}
                  onClick={() => { const p = caminho[caminho.length - 1]; onIrParaPasta?.(caminho.length === 1 ? null : p.id); onFechar(); }}>
                  {caminho.map((c) => c.nome).join(" / ")}
                </button>
              ) : "…"}
            </dd>
          </dl>

          <label className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Nome
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={250} style={{ ...estiloEntrada, marginTop: 4 }} />
          </label>

          <div>
            <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Tags do QS</span>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {tags.map((t) => <Chip key={t} onRemover={() => setTags(tags.filter((x) => x !== t))}>#{t}</Chip>)}
              {!tags.length && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhuma ainda.</span>}
            </div>
            <input value={novaTag} onChange={(e) => setNovaTag(e.target.value)} placeholder="Nova tag + Enter (ex.: reels, japão, depoimento)"
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); adicionarTag(); } }}
              style={estiloEntrada} maxLength={40} aria-label="Nova tag" />
            {sugestoes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {sugestoes.map((t) => <Chip key={t} onClick={() => setTags([...tags, t])}>+ #{t}</Chip>)}
              </div>
            )}
          </div>

          <label className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Expedição / destino
            <select value={expedicaoId} onChange={(e) => setExpedicaoId(e.target.value)} style={{ ...estiloEntrada, marginTop: 4 }}>
              <option value="">— nenhuma —</option>
              {(config?.expedicoes || []).map((x) => <option key={x.id} value={x.id}>{x.nome}{x.destino ? ` · ${x.destino}` : ""}</option>)}
            </select>
          </label>

          <label className="block text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>
            Observação
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={2000}
              placeholder="Ex.: bruto da gravação de 28/10, falta legenda" style={{ ...estiloEntrada, marginTop: 4, resize: "vertical" }} />
          </label>

          {aviso && <p className="text-[12.5px]" role="status" style={{ color: aviso.tom === "ok" ? "var(--green)" : "var(--err-ink)" }}>{aviso.texto}</p>}

          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Botao>
            <Botao onClick={() => setMovendo(true)}>Mover…</Botao>
            {confirmarLixeira ? (
              <>
                <Botao variante="perigo" onClick={() => void lixeira()}>Confirmar lixeira</Botao>
                <Botao variante="fantasma" onClick={() => setConfirmarLixeira(false)}>Não</Botao>
              </>
            ) : (
              <Botao variante="perigo" onClick={() => setConfirmarLixeira(true)}>Lixeira</Botao>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink3)" }}>A lixeira é a do Google Drive: dá pra restaurar por lá por 30 dias.</p>
        </aside>
      </div>
      <SeletorPasta aberto={movendo} excluirId={item.id} onFechar={() => setMovendo(false)} onEscolher={(p, n) => void moverPara(p, n)} />
    </Modal>
  );
}
