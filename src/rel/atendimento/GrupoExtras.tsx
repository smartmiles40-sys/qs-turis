// src/rel/atendimento/GrupoExtras.tsx
// -----------------------------------------------------------------------------
// Peças dos grupos "igual ao WhatsApp normal" (28/10/2026, 0219):
//   • FotoGrupo        — a foto do grupo (cai pras iniciais se o link venceu)
//   • EncaminharModal  — escolhe até 5 grupos e reenvia a mensagem
//   • AgendarModal     — agenda uma mensagem (texto/arquivo/@todos) pro grupo
//   • ListaAgendadas   — o que está na fila do grupo, com "Cancelar"
// Tudo sai pela ligação dos grupos e SÓ pra grupo (api/rel-grupos.js).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { AvatarWa } from "./waUi";
import { Aviso, Botao, Campo, Modal } from "../ui";
import {
  agendadasDoGrupo, agendarNoGrupo, cancelarAgendada, encaminharNoGrupo, listarGrupos,
  type Agendada, type Grupo, type MensagemGrupo,
} from "../lib/grupos";

export const nomeDoGrupo = (g: Pick<Grupo, "nome">) => g.nome?.trim() || "Grupo sem nome";

export function FotoGrupo({ grupo, tamanho = 49 }: { grupo: Pick<Grupo, "nome" | "foto_url">; tamanho?: number }) {
  const [quebrou, setQuebrou] = useState(false);
  useEffect(() => setQuebrou(false), [grupo.foto_url]);
  if (!grupo.foto_url || quebrou) return <AvatarWa nome={nomeDoGrupo(grupo)} tamanho={tamanho} />;
  return (
    <img src={grupo.foto_url} alt="" aria-hidden onError={() => setQuebrou(true)} referrerPolicy="no-referrer"
      className="rounded-full object-cover flex-shrink-0" style={{ width: tamanho, height: tamanho }} />
  );
}

// ── Encaminhar ───────────────────────────────────────────────────────────────

export function EncaminharModal({ msg, grupoAtual, onFechar, onFeito }: {
  msg: MensagemGrupo | null; grupoAtual: string; onFechar: () => void; onFeito: (texto: string) => void;
}) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [busca, setBusca] = useState("");
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    setEscolhidos([]); setBusca(""); setErro(null);
    listarGrupos().then(setGrupos).catch(() => setGrupos([]));
  }, [msg]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return grupos.filter((g) => g.jid !== grupoAtual && (!q || nomeDoGrupo(g).toLowerCase().includes(q))).slice(0, 80);
  }, [grupos, busca, grupoAtual]);

  async function enviar() {
    if (!msg || !escolhidos.length) return;
    setEnviando(true); setErro(null);
    try {
      const r = await encaminharNoGrupo(msg.id, escolhidos);
      const falhas = r.resultado.filter((x) => !x.ok);
      if (falhas.length) setErro(`Não foi pra ${falhas.length} grupo(s): ${falhas[0].erro || "erro"}`);
      else { onFeito(`Encaminhada pra ${escolhidos.length} grupo${escolhidos.length > 1 ? "s" : ""}.`); onFechar(); }
    } catch (e) { setErro(e instanceof Error ? e.message : "Não encaminhou."); }
    setEnviando(false);
  }

  return (
    <Modal aberto={!!msg} titulo="Encaminhar para grupos" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!escolhidos.length || enviando} onClick={() => void enviar()}>
          {enviando ? "Enviando…" : `Encaminhar${escolhidos.length ? ` (${escolhidos.length})` : ""}`}
        </Botao>
      </>}>
      <p className="text-[12.5px] mb-2" style={{ color: "var(--ink3)" }}>Até 5 grupos. Sai assinado com o seu nome e marcado "↪ Encaminhada". Só para grupos — conversa com pessoa continua no número oficial.</p>
      <input className="w-full px-3 py-2 rounded-lg text-[14px] mb-2" style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }}
        placeholder="Pesquisar grupo" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar grupo" autoFocus />
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <ul className="max-h-[50vh] overflow-y-auto">
        {visiveis.map((g) => {
          const marcado = escolhidos.includes(g.jid);
          const cheio = !marcado && escolhidos.length >= 5;
          return (
            <li key={g.jid}>
              <label className={`flex items-center gap-3 px-2 py-2 rounded-lg ${cheio ? "opacity-50" : "cursor-pointer"}`} style={{ background: marcado ? "var(--card2)" : undefined }}>
                <input type="checkbox" checked={marcado} disabled={cheio}
                  onChange={() => setEscolhidos((l) => (marcado ? l.filter((x) => x !== g.jid) : [...l, g.jid]))} />
                <FotoGrupo grupo={g} tamanho={34} />
                <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: "var(--ink)" }}>{nomeDoGrupo(g)}</span>
              </label>
            </li>
          );
        })}
        {!visiveis.length && <li className="text-[13px] py-4 text-center" style={{ color: "var(--ink3)" }}>Nenhum grupo.</li>}
      </ul>
    </Modal>
  );
}

// ── Agendar ──────────────────────────────────────────────────────────────────

const doisDig = (n: number) => String(n).padStart(2, "0");
/** "2026-10-28T15:30" no fuso do navegador (o que o <input type=datetime-local> usa). */
const paraCampo = (d: Date) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}T${doisDig(d.getHours())}:${doisDig(d.getMinutes())}`;

export function AgendarModal({ aberto, grupo, textoInicial, ligado, onFechar, onFeito }: {
  aberto: boolean; grupo: Grupo; textoInicial: string;
  /** REL_GRUPOS_AGENDADAS ligado na Vercel? (senão a mensagem fica na fila e não sai) */
  ligado: boolean | null;
  onFechar: () => void; onFeito: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [quando, setQuando] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [todos, setTodos] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    const d = new Date(Date.now() + 60 * 60_000); d.setMinutes(0, 0, 0);
    setTexto(textoInicial); setQuando(paraCampo(d)); setArquivo(null); setTodos(false); setErro(null);
  }, [aberto, textoInicial]);

  async function salvar() {
    const d = new Date(quando);
    if (!quando || Number.isNaN(d.getTime())) { setErro("Escolha dia e hora."); return; }
    if (!texto.trim() && !arquivo) { setErro("Escreva a mensagem ou escolha um arquivo."); return; }
    setSalvando(true); setErro(null);
    try {
      await agendarNoGrupo(grupo.jid, { texto: texto.trim(), enviarEm: d, arquivo, todos });
      onFeito(`Agendada pra ${d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`);
      onFechar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não agendou."); }
    setSalvando(false);
  }

  return (
    <Modal aberto={aberto} titulo={`Agendar mensagem · ${nomeDoGrupo(grupo)}`} onFechar={onFechar} largura={520}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Agendando…" : "Agendar"}</Botao>
      </>}>
      <div className="space-y-3">
        {ligado === false && (
          <Aviso>O envio automático das agendadas está <b>desligado</b> (falta o Bruno liberar). Dá pra deixar na fila — ela só sai quando ligar.</Aviso>
        )}
        <Campo rotulo="Mensagem" dica="Sai assinada com o seu nome, igual às outras.">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={4000}
            className="w-full px-3 py-2 rounded-lg text-[14px] resize-y" style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }}
            placeholder="Ex.: Bom dia, pessoal! Amanhã o encontro no aeroporto é às 6h, no balcão da…" />
        </Campo>
        <Campo rotulo="Quando sai">
          <input type="datetime-local" value={quando} min={paraCampo(new Date(Date.now() + 2 * 60_000))} onChange={(e) => setQuando(e.target.value)}
            className="px-3 py-2 rounded-lg text-[14px]" style={{ background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" }} />
        </Campo>
        <Campo rotulo="Arquivo (opcional)" dica="Foto, vídeo, PDF… vai com a mensagem de legenda.">
          <input type="file" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-[13px]" style={{ color: "var(--ink2)" }} />
        </Campo>
        <label className="flex items-center gap-2 text-[13.5px]" style={{ color: "var(--ink)" }}>
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Marcar <b>@todos</b> (todo mundo do grupo recebe a notificação)
        </label>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

const ROTULO_AG: Record<Agendada["status"], string> = { pendente: "na fila", enviando: "enviando…", enviada: "enviada", erro: "erro", cancelada: "cancelada" };

export function ListaAgendadas({ jid, versao, onMudou }: { jid: string; versao: number; onMudou?: () => void }) {
  const [lista, setLista] = useState<Agendada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => agendadasDoGrupo(jid).then(setLista).catch(() => setLista([]));
  useEffect(() => { void carregar(); }, [jid, versao]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lista) return <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Carregando…</p>;
  if (!lista.length) return <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Nenhuma mensagem agendada.</p>;
  return (
    <ul className="space-y-1.5">
      {erro && <li className="text-[12.5px]" style={{ color: "var(--red)" }}>{erro}</li>}
      {lista.map((a) => (
        <li key={a.id} className="rounded-lg px-2.5 py-2 text-[13px]" style={{ background: "var(--wa-head)", color: "var(--wa-txt)" }}>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{new Date(a.enviar_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
            <span className="text-[11.5px] px-1.5 rounded" style={{ background: a.status === "erro" ? "#FDE2E1" : "rgba(127,127,127,.15)", color: a.status === "erro" ? "#B42318" : "var(--wa-meta)" }}>{ROTULO_AG[a.status]}</span>
            {a.mencionar_todos && <span className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>@todos</span>}
            <span className="flex-1" />
            {a.status === "pendente" && (
              <button className="text-[12px] font-semibold" style={{ color: "#B42318" }}
                onClick={() => { if (window.confirm("Cancelar esta mensagem agendada?")) void cancelarAgendada(a.id).then(() => { void carregar(); onMudou?.(); }).catch((e) => setErro(e instanceof Error ? e.message : "Não cancelou.")); }}>
                Cancelar
              </button>
            )}
          </div>
          <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap" style={{ color: "var(--wa-meta)" }}>{a.anexo_nome ? `📎 ${a.anexo_nome} · ` : ""}{a.texto}</p>
          {a.erro && <p className="mt-0.5 text-[12px]" style={{ color: "#B42318" }}>{a.erro}</p>}
          {a.assinatura && <p className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>por {a.assinatura}</p>}
        </li>
      ))}
    </ul>
  );
}
