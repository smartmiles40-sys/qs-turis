// src/rel/atendimento/Organizar.tsx
// -----------------------------------------------------------------------------
// As janelinhas que o menu do botão direito abre (14/10/2026):
//   • Etiquetas — coloridas, do time (como as do WhatsApp Business)
//   • Listas    — "grupos de conversas" do time (Fornecedores, Embarque da
//                 semana…), viram atalhos de filtro no topo da lista
//   • Encaminhar — uma mensagem pra até 5 conversas
//   • Nova conversa — por um número que ainda não escreveu (só modelo aprovado)
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import {
  CORES_ETIQUETA, apagarEtiqueta, apagarLista, criarEtiqueta, criarLista, encaminhar, etiquetarConversa, porNaLista,
  type Conversa, type Etiqueta, type Lista, type Mensagem,
} from "../lib/whatsapp";
import { formatarTelefone } from "../lib/clientes";
import { Aviso, Botao, Entrada, Modal } from "../ui";
import { AvatarWa } from "./waUi";

/** Celular BR com e sem o nono dígito (a Meta às vezes grava sem). */
export function variantesBr(d: string): string[] {
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, d.slice(0, 4) + "9" + d.slice(4)];
  return [d];
}

const nomeDa = (c: Conversa) => c.cliente_nome || c.nome_contato || formatarTelefone(c.telefone);

function Marca({ marcado }: { marcado: boolean }) {
  return (
    <span className="w-5 h-5 rounded inline-flex items-center justify-center flex-shrink-0 border-2"
      style={marcado ? { background: "var(--wa-green)", borderColor: "var(--wa-green)", color: "#fff" } : { borderColor: "var(--wa-meta)" }} aria-hidden>
      {marcado && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>}
    </span>
  );
}

// ── Etiquetas ───────────────────────────────────────────────────────────────

export function EtiquetasModal({ aberto, conversa, etiquetas, onFechar, onMudou }: {
  aberto: boolean; conversa: Conversa | null; etiquetas: Etiqueta[]; onFechar: () => void; onMudou: () => void;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [nova, setNova] = useState("");
  const [cor, setCor] = useState(CORES_ETIQUETA[0]);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  // Só na abertura (a lista recarrega a cada 10 s — não pode apagar o que está sendo digitado).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (aberto && conversa) { setMarcadas(new Set(conversa.etiquetas || [])); setErro(null); setNova(""); setApagando(null); } }, [aberto, conversa?.id]);
  if (!conversa) return null;

  async function alternar(id: string) {
    const por = !marcadas.has(id);
    setMarcadas((m) => { const n = new Set(m); if (por) n.add(id); else n.delete(id); return n; });
    try { await etiquetarConversa(conversa!.id, id, por); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  async function criar() {
    if (!nova.trim()) return;
    try { const e = await criarEtiqueta(nova, cor); setNova(""); await etiquetarConversa(conversa!.id, e.id, true); setMarcadas((m) => new Set(m).add(e.id)); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  async function apagar(id: string) {
    try { await apagarEtiqueta(id); setApagando(null); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  return (
    <Modal aberto={aberto} titulo={`Etiquetas · ${nomeDa(conversa)}`} onFechar={onFechar} largura={440}>
      <div className="space-y-3">
        <ul className="space-y-0.5">
          {etiquetas.length === 0 && <li className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma etiqueta ainda. Crie a primeira aqui embaixo — ela vale pro time todo.</li>}
          {etiquetas.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <button onClick={() => void alternar(e.id)} className="rel-linha flex-1 flex items-center gap-3 px-2 py-2 rounded-lg text-left" aria-pressed={marcadas.has(e.id)}>
                <Marca marcado={marcadas.has(e.id)} />
                <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: e.cor }} aria-hidden />
                <span className="text-[14px]" style={{ color: "var(--ink)" }}>{e.nome}</span>
              </button>
              {apagando === e.id ? (
                <span className="flex items-center gap-1 text-[12px]">
                  <span style={{ color: "var(--ink3)" }}>Apagar de todas?</span>
                  <Botao onClick={() => void apagar(e.id)} className="!h-7 !px-2">Sim</Botao>
                  <Botao variante="fantasma" onClick={() => setApagando(null)} className="!h-7 !px-2">Não</Botao>
                </span>
              ) : (
                <button onClick={() => setApagando(e.id)} className="wa-icone w-8 h-8 inline-flex items-center justify-center" aria-label={`Apagar a etiqueta ${e.nome}`} title="Apagar etiqueta">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="rel-card p-3 space-y-2">
          <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Nova etiqueta</p>
          <div className="flex gap-2">
            <Entrada value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Ex.: Documentos pendentes" maxLength={40}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void criar(); } }} />
            <Botao variante="primario" onClick={() => void criar()} disabled={!nova.trim()}>Criar</Botao>
          </div>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Cor">
            {CORES_ETIQUETA.map((c) => (
              <button key={c} role="radio" aria-checked={cor === c} aria-label={`Cor ${c}`} onClick={() => setCor(c)}
                className="w-7 h-7 rounded-full" style={{ background: c, outline: cor === c ? "2px solid var(--ink)" : "none", outlineOffset: 2 }} />
            ))}
          </div>
        </div>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Listas ("grupos" de conversas) ──────────────────────────────────────────

export function ListasModal({ aberto, conversa, listas, onFechar, onMudou }: {
  aberto: boolean; conversa: Conversa | null; listas: Lista[]; onFechar: () => void; onMudou: () => void;
}) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (aberto) { setMarcadas(new Set(conversa?.listas || [])); setErro(null); setNova(""); setApagando(null); } }, [aberto, conversa?.id]);

  async function alternar(id: string) {
    if (!conversa) return;
    const por = !marcadas.has(id);
    setMarcadas((m) => { const n = new Set(m); if (por) n.add(id); else n.delete(id); return n; });
    try { await porNaLista(conversa.id, id, por); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  async function criar() {
    if (!nova.trim()) return;
    try {
      const l = await criarLista(nova); setNova("");
      if (conversa) { await porNaLista(conversa.id, l.id, true); setMarcadas((m) => new Set(m).add(l.id)); }
      onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  async function apagar(id: string) {
    try { await apagarLista(id); setApagando(null); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  return (
    <Modal aberto={aberto} titulo={conversa ? `Listas · ${nomeDa(conversa)}` : "Listas de conversas"} onFechar={onFechar} largura={440}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Listas juntam conversas num grupo do time (ex.: <i>Fornecedores</i>, <i>Embarcam esta semana</i>) e aparecem como filtro no topo da lista.
        </p>
        <ul className="space-y-0.5">
          {listas.length === 0 && <li className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma lista ainda.</li>}
          {listas.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              {conversa ? (
                <button onClick={() => void alternar(l.id)} className="rel-linha flex-1 flex items-center gap-3 px-2 py-2 rounded-lg text-left" aria-pressed={marcadas.has(l.id)}>
                  <Marca marcado={marcadas.has(l.id)} />
                  <span className="text-[14px]" style={{ color: "var(--ink)" }}>{l.nome}</span>
                </button>
              ) : <span className="flex-1 px-2 py-2 text-[14px]" style={{ color: "var(--ink)" }}>{l.nome}</span>}
              {apagando === l.id ? (
                <span className="flex items-center gap-1 text-[12px]">
                  <span style={{ color: "var(--ink3)" }}>Apagar a lista?</span>
                  <Botao onClick={() => void apagar(l.id)} className="!h-7 !px-2">Sim</Botao>
                  <Botao variante="fantasma" onClick={() => setApagando(null)} className="!h-7 !px-2">Não</Botao>
                </span>
              ) : (
                <button onClick={() => setApagando(l.id)} className="wa-icone w-8 h-8 inline-flex items-center justify-center" aria-label={`Apagar a lista ${l.nome}`} title="Apagar lista (as conversas não somem)">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Entrada value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nome da nova lista" maxLength={40}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void criar(); } }} />
          <Botao variante="primario" onClick={() => void criar()} disabled={!nova.trim()}>Criar</Botao>
        </div>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Encaminhar ──────────────────────────────────────────────────────────────

export function EncaminharModal({ mensagem, conversas, onFechar, onFeito }: {
  mensagem: Mensagem | null; conversas: Conversa[]; onFechar: () => void; onFeito: (msg: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { setBusca(""); setSel([]); setErro(null); }, [mensagem]);

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return conversas.filter((c) => c.id !== mensagem?.conversa_id && (!t || nomeDa(c).toLowerCase().includes(t) || c.telefone.includes(t.replace(/\D/g, "") || "§")));
  }, [busca, conversas, mensagem]);

  async function enviar() {
    if (!mensagem || !sel.length) return;
    setEnviando(true); setErro(null);
    try {
      const r = await encaminhar(mensagem.id, sel);
      const falhas = r.resultado.filter((x) => !x.ok);
      if (!falhas.length) { onFeito(sel.length === 1 ? "Mensagem encaminhada." : `Encaminhada para ${sel.length} conversas.`); return; }
      const nomes = falhas.map((f) => { const c = conversas.find((x) => x.id === f.conversaId); return `${c ? nomeDa(c) : "?"} (${f.erro})`; });
      setErro(`Não foi para: ${nomes.join(", ")}.`);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não encaminhou."); }
    finally { setEnviando(false); }
  }

  return (
    <Modal aberto={!!mensagem} titulo="Encaminhar mensagem para" onFechar={onFechar} largura={460}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => void enviar()} disabled={!sel.length || enviando}>{enviando ? "Enviando…" : `Encaminhar${sel.length ? ` (${sel.length})` : ""}`}</Botao></>}>
      <div className="space-y-2">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar nome ou número" autoFocus />
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Até 5 conversas. Só vai pra quem escreveu nas últimas 24h (regra da Meta).</p>
        <ul className="max-h-[50vh] overflow-y-auto -mx-1">
          {lista.slice(0, 80).map((c) => {
            const m = sel.includes(c.id);
            return (
              <li key={c.id}>
                <button onClick={() => setSel((s) => (m ? s.filter((x) => x !== c.id) : s.length >= 5 ? s : [...s, c.id]))} disabled={!m && sel.length >= 5}
                  className="rel-linha w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left disabled:opacity-50" aria-pressed={m}>
                  <Marca marcado={m} />
                  <AvatarWa nome={nomeDa(c)} tamanho={34} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[14px]" style={{ color: "var(--ink)" }}>{nomeDa(c)}</span>
                    {!c.janela_aberta && <span className="block text-[11.5px]" style={{ color: "var(--warn-ink)" }}>janela de 24h fechada</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Nova conversa ───────────────────────────────────────────────────────────

export function NovaConversaModal({ aberto, conversas, onFechar, onAbrir, onModelo }: {
  aberto: boolean; conversas: Conversa[]; onFechar: () => void;
  /** Já existe conversa com esse número → abre ela. */
  onAbrir: (id: string) => void;
  /** Número novo → manda um modelo (única forma de puxar conversa). */
  onModelo: (telefone: string) => void;
}) {
  const [fone, setFone] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) { setFone(""); setErro(null); } }, [aberto]);
  const dig = fone.replace(/\D/g, "");
  const parecidas = dig.length >= 4 ? conversas.filter((c) => c.telefone.includes(dig)).slice(0, 6) : [];

  function seguir() {
    let d = dig;
    if (!fone.trim().startsWith("+") && (d.length === 10 || d.length === 11)) d = `55${d}`;
    if (d.length < 12 || d.length > 15) { setErro("Digite DDD + número (ex.: 11 91234-5678) ou com DDI (+351…)."); return; }
    const existe = conversas.find((c) => variantesBr(c.telefone).includes(d));
    if (existe) { onAbrir(existe.id); return; }
    onModelo(d);
  }

  return (
    <Modal aberto={aberto} titulo="Nova conversa" onFechar={onFechar} largura={420}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={seguir} disabled={dig.length < 10}>Continuar</Botao></>}>
      <div className="space-y-3">
        <Entrada value={fone} onChange={(e) => setFone(e.target.value)} placeholder="Número com DDD" inputMode="tel" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); seguir(); } }} />
        {parecidas.length > 0 && (
          <ul className="rel-card overflow-hidden">
            {parecidas.map((c) => (
              <li key={c.id}>
                <button onClick={() => onAbrir(c.id)} className="rel-linha w-full flex items-center gap-3 px-3 py-2 text-left">
                  <AvatarWa nome={nomeDa(c)} tamanho={30} />
                  <span className="flex-1 truncate text-[13.5px]" style={{ color: "var(--ink)" }}>{nomeDa(c)}</span>
                  <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Aviso>Pra quem ainda não escreveu, a Meta só deixa começar com um <b>modelo aprovado</b>. Quando a pessoa responder, a conversa libera pra texto livre.</Aviso>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
