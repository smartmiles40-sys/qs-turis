// src/rel/disparos/FluxosRel.tsx
// -----------------------------------------------------------------------------
// RELACIONAMENTO › DISPAROS › FLUXOS (0409) — o criador de fluxos "igual ao
// ManyChat": blocos ligados por setas (Template, Mensagem com botões, Pergunta,
// Aguardar, Condição, Ações…), e o botão "Disparar" que manda o fluxo pra um
// público (todos os clientes, ou só quem bate nos filtros que você adicionar).
//
// O editor é o do Marketing (EditorFluxo) com o adaptador do Rel (dadosFluxosRel.ts).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { previa as pedirPrevia, type Previa, type PublicoRel } from "@/lib/qs/disparos";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import EditorFluxo from "@/mkt/automacoes/EditorFluxo";
import { MKT_CSS } from "@/mkt/automacoes/ui";
import type { Fluxo } from "@/mkt/automacoes/tipos";
import {
  adaptadorRel, apagarFluxoRel, cancelarDisparo, criarFluxoRel, disparosDoFluxo, dispararFluxo, grafoAtivacao, grafoVazio,
  listarFluxosRel, salvarFluxoRel, type DisparoFluxo,
} from "./dadosFluxosRel";
import { limparPublico, PublicoRelForm, useEtiquetas } from "./PublicoRel";
import type { EstadoRel } from "./oficialRel";

const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const localParaIso = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00-03:00`).toISOString() : "");
const ROTULO_DISPARO: Record<DisparoFluxo["status"], string> = { agendado: "agendado", rodando: "enviando", concluido: "enviado", cancelado: "cancelado" };

// ── Disparar ────────────────────────────────────────────────────────────────

function Disparar({ fluxo, simulacao, onFechar, onFeito }: { fluxo: Fluxo; simulacao: boolean; onFechar: () => void; onFeito: () => void }) {
  const etiquetas = useEtiquetas();
  const [publico, setPublico] = useState<PublicoRel>({});
  const [pv, setPv] = useState<Previa | null>(null);
  const [contando, setContando] = useState(false);
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [dataHoraTxt, setDataHoraTxt] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setContando(true);
    const t = setTimeout(() => {
      pedirPrevia("relacionamento", limparPublico(publico))
        .then((r) => { if (vivo) setPv(r); })
        .catch(() => { if (vivo) setPv(null); })
        .finally(() => { if (vivo) setContando(false); });
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [publico]);

  // No fluxo, o filtro de "já recebeu disparo há pouco"/"conversa aberta" não tira ninguém: só quem pediu pra parar.
  const optout = pv?.excluidos.find((x) => /parar|não receber|optout/i.test(x.motivo))?.n ?? 0;
  const recebem = pv ? pv.total + pv.excluidos.reduce((s, x) => s + x.n, 0) - optout : 0;
  const isoAgendado = localParaIso(dataHoraTxt);
  const podeIr = recebem > 0 && (quando === "agora" || (isoAgendado && new Date(isoAgendado).getTime() > Date.now() + 60_000));

  async function ir() {
    if (!window.confirm(`Disparar o fluxo "${fluxo.nome}" pra ~${recebem} cliente(s)${quando === "agendar" ? ` em ${dataHoraTxt.replace("T", " às ")}` : " agora"}?${simulacao ? "\n\nModo simulação: nada sai de verdade." : ""}`)) return;
    setOcupado(true);
    try {
      await dispararFluxo(fluxo.id, limparPublico(publico), quando === "agendar" ? isoAgendado : null);
      notifySuccess(quando === "agora" ? "Disparo na fila: começa a sair em até 5 minutos, no ritmo do número." : "Disparo agendado.");
      onFeito();
    } catch (e) { notifyError(erroDe(e, "Não disparou.")); } finally { setOcupado(false); }
  }

  return (
    <Modal aberto titulo={`Disparar · ${fluxo.nome}`} onFechar={onFechar} largura={720}
      rodape={<>
        <span className="mr-auto text-[12.5px]" style={{ color: "var(--ink2)" }}>{contando ? "Contando…" : <><b className="tabular-nums">{recebem}</b> cliente(s) recebem{optout ? ` · ${optout} pediram pra não receber` : ""}</>}</span>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!podeIr || ocupado} onClick={() => void ir()}>{ocupado ? "Disparando…" : quando === "agora" ? "Disparar agora" : "Agendar"}</Botao>
      </>}>
      <div className="space-y-4">
        {simulacao && <Aviso>Modo simulação ligado: o fluxo anda e conta, mas nenhuma mensagem sai de verdade.</Aviso>}
        <section>
          <h3 className="mb-2 text-[13px] font-bold" style={{ color: "var(--ink)" }}>Para quem</h3>
          <PublicoRelForm p={publico} set={setPublico} etiquetas={etiquetas} />
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-bold" style={{ color: "var(--ink)" }}>Quando</h3>
          <div className="flex flex-wrap gap-2">
            {(["agora", "agendar"] as const).map((q) => (
              <label key={q} className="flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px]"
                style={{ borderColor: quando === q ? "var(--rel)" : "var(--line)", background: quando === q ? "var(--rel-soft)" : "var(--card)", color: "var(--ink)" }}>
                <input type="radio" name="quando-fluxo" checked={quando === q} onChange={() => setQuando(q)} /> {q === "agora" ? "Agora" : "Agendar"}
              </label>
            ))}
            {quando === "agendar" && <Entrada type="datetime-local" aria-label="Dia e hora (Brasília)" className="w-auto" value={dataHoraTxt} onChange={(e) => setDataHoraTxt(e.target.value)} />}
          </div>
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--ink3)" }}>Sai pelo servidor (pode fechar a aba), no ritmo e no teto do dia do número, só dentro da janela de envio. O 1º bloco precisa ser um Template aprovado.</p>
        </section>
      </div>
    </Modal>
  );
}

// ── Disparos de um fluxo ────────────────────────────────────────────────────

function Historico({ fluxo, versao }: { fluxo: Fluxo; versao: number }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof disparosDoFluxo>> | null>(null);
  const ler = useCallback(() => void disparosDoFluxo(fluxo.id).then(setD).catch(() => setD({ disparos: [], andamento: new Map(), funil: new Map() })), [fluxo.id]);
  useEffect(() => { ler(); const t = setInterval(ler, 20_000); return () => clearInterval(t); }, [ler, versao]);
  if (!d?.disparos.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-[12.5px]" style={{ color: "var(--ink2)" }}>
      {d.disparos.slice(0, 3).map((x) => {
        const a = d.andamento.get(x.id) ?? {};
        const naFila = (a.aguardando_tempo ?? 0) + (a.rodando ?? 0);
        const f = d.funil.get(x.id);
        const pct = (n: number, de: number) => (de ? ` (${Math.round((n / de) * 100)}%)` : "");
        return (
          <li key={x.id} className="flex flex-wrap items-center gap-2">
            <Etiqueta tom={x.status === "cancelado" ? "erro" : x.status === "concluido" ? "neutro" : "rel"}>{ROTULO_DISPARO[x.status]}</Etiqueta>
            <span>{dataHora(x.agendado_para)} · {x.total} cliente(s)</span>
            {x.status !== "agendado" && <span style={{ color: "var(--ink3)" }}>{naFila ? `${naFila} na fila · ` : ""}{a.aguardando_resposta ?? 0} aguardando clique · {a.concluida ?? 0} terminaram{a.erro ? ` · ${a.erro} erro` : ""}</span>}
            {f && f.enviadas > 0 && (
              <span className="basis-full flex flex-wrap gap-x-3 gap-y-0.5 font-semibold" style={{ color: "var(--ink2)" }}
                title="Do modelo (1ª mensagem): enviadas → entregues → lidas. Clicaram = tocaram em algum botão ou abriram algum link do fluxo.">
                <span>📤 {f.enviadas} enviadas</span>
                <span>✓✓ {f.entregues} entregues{pct(f.entregues, f.enviadas)}</span>
                <span>👁 {f.lidas} lidas{pct(f.lidas, f.enviadas)}</span>
                <span>👆 {f.clicaram} clicaram{pct(f.clicaram, f.enviadas)}</span>
                {f.falharam > 0 && <span style={{ color: "var(--err-ink)" }}>✕ {f.falharam} falharam</span>}
              </span>
            )}
            {["agendado", "rodando"].includes(x.status) && (
              <button type="button" className="underline" style={{ color: "var(--err-ink)" }}
                onClick={() => { if (window.confirm("Cancelar este disparo? Quem ainda não recebeu não recebe mais.")) void cancelarDisparo(x.id).then(ler).catch((e) => notifyError(erroDe(e, "Não cancelou."))); }}>cancelar</button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────────

export default function FluxosRel({ est }: { est: EstadoRel | null }) {
  const { currentUser } = useQsAuth();
  const [lista, setLista] = useState<Fluxo[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(() => { try { return sessionStorage.getItem("rel_fluxo_aberto"); } catch { return null; } });
  const [disparar, setDisparar] = useState<Fluxo | null>(null);
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState("");
  const [modelo, setModelo] = useState<"ativacao" | "vazio">("ativacao");
  const [versao, setVersao] = useState(0);
  const simulacao = est?.simulacao !== false;

  const ler = useCallback(() => void listarFluxosRel().then(setLista).catch((e) => { notifyError(erroDe(e, "Não carregou os fluxos.")); setLista([]); }), []);
  useEffect(ler, [ler]);
  const abrir = (id: string | null) => { setAberto(id); try { if (id) sessionStorage.setItem("rel_fluxo_aberto", id); else sessionStorage.removeItem("rel_fluxo_aberto"); } catch { /* sem storage */ } };

  async function criar() {
    try {
      const f = await criarFluxoRel(nome.trim(), modelo === "ativacao" ? grafoAtivacao() : grafoVazio(), currentUser?.id);
      setNovo(false); setNome(""); ler(); abrir(f.id);
    } catch (e) { notifyError(erroDe(e, "Não criou.")); }
  }

  if (aberto) {
    return (
      <div className="mkt-raiz">
        <style>{MKT_CSS}</style>
        <EditorFluxo fluxoId={aberto} onVoltar={() => { abrir(null); ler(); }}
          adaptador={adaptadorRel({
            extraBarra: (f, sujo) => (
              <Botao variante="primario" title="Mandar este fluxo pra um público"
                onClick={() => {
                  if (sujo) return notifyError("Salve o fluxo antes de disparar.");
                  if (f.status !== "ativo") return notifyError("Ative o fluxo antes de disparar (Salvar e ativar).");
                  if (f.grafo_rascunho && !window.confirm("Este fluxo tem um RASCUNHO não publicado. O disparo usa a versão publicada. Disparar mesmo assim? (Para usar as mudanças, clique em Publicar antes.)")) return;
                  setDisparar(f);
                }}>Disparar…</Botao>
            ),
            ajuda: (
              <>
                <p>Arraste o bloco pelo topo. Pra ligar, puxe a bolinha da saída até outro bloco. Clique numa seta pra apagar.</p>
                <p>O disparo começa SEMPRE por um <b>Template</b> (modelo aprovado pela Meta). Cada botão de resposta rápida do modelo vira uma saída: ligue no que acontece quando tocarem.</p>
                <p>Depois que a pessoa toca ou responde, a <b>janela de 24 h</b> abre: aí valem Mensagem (texto, foto, botões), Pergunta etc.</p>
                <Aviso>Os números em cima de cada bloco: quantas pessoas passaram por ele e, nos blocos que mandam mensagem, ✓✓ entregues · 👁 lidas · 🔗 clicaram no link (passe o mouse pra ver os %).</Aviso>
                <p style={{ color: "var(--ink3)" }}>Ações: pôr/tirar etiqueta, avisar alguém do time no sino, parar outros fluxos, descadastrar.</p>
              </>
            ),
          }, est?.numerosTeste ?? [])} />
        {disparar && <Disparar fluxo={disparar} simulacao={simulacao} onFechar={() => setDisparar(null)} onFeito={() => { setDisparar(null); setVersao((v) => v + 1); }} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo fluxo</Botao>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Monte a conversa em blocos (como no ManyChat) e dispare pra quem quiser.</p>
      </div>
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : !lista.length ? (
          <Vazio titulo="Nenhum fluxo ainda" texto="Comece pelo modelo “Campanha de ativação”: modelo aprovado com botões → quem tocar recebe uma resposta, ganha etiqueta e o time é avisado."
            acao={<Botao variante="primario" onClick={() => { setNome("Campanha de ativação"); setNovo(true); }}>+ Criar campanha de ativação</Botao>} />
        ) : (
          <ul className="space-y-3">
            {lista.map((f) => (
              <li key={f.id} className="rel-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="text-left text-[14px] font-bold hover:underline" style={{ color: "var(--ink)" }} onClick={() => abrir(f.id)}>{f.nome}</button>
                  <Etiqueta tom={f.status === "ativo" ? "rel" : f.status === "pausado" ? "aviso" : "neutro"}>{f.status}</Etiqueta>
                  <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{f.execucoes_total} entraram · {f.concluidas_total} terminaram · editado {dataHora(f.atualizado_em)}</span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Botao onClick={() => abrir(f.id)}>Abrir</Botao>
                    <Botao variante="primario" disabled={f.status !== "ativo"} title={f.status !== "ativo" ? "Ative o fluxo no editor primeiro" : undefined} onClick={() => setDisparar(f)}>Disparar…</Botao>
                    {f.status === "ativo" && <Botao variante="fantasma" onClick={() => void salvarFluxoRel(f.id, { status: "pausado" }).then(ler).catch((e) => notifyError(erroDe(e, "Falhou.")))}>Pausar</Botao>}
                    <Botao variante="fantasma" onClick={() => { if (window.confirm(`Apagar o fluxo "${f.nome}"? Quem está no meio dele para.`)) void apagarFluxoRel(f.id).then(ler).catch((e) => notifyError(erroDe(e, "Não apagou."))); }}>Apagar</Botao>
                  </span>
                </div>
                <Historico fluxo={f} versao={versao} />
              </li>
            ))}
          </ul>
        )}

      {novo && (
        <Modal aberto titulo="Novo fluxo" onFechar={() => setNovo(false)} largura={560}
          rodape={<><Botao variante="fantasma" onClick={() => setNovo(false)}>Cancelar</Botao><Botao variante="primario" disabled={nome.trim().length < 2} onClick={() => void criar()}>Criar e abrir</Botao></>}>
          <div className="space-y-3">
            <Campo rotulo="Nome"><Entrada value={nome} autoFocus placeholder="Ex.: Ativação — Datas 2027" onChange={(e) => setNome(e.target.value)} /></Campo>
            <div role="radiogroup" aria-label="Começar de" className="grid gap-2 sm:grid-cols-2">
              {([
                ["ativacao", "Campanha de ativação", "Template com botões → resposta, etiqueta e aviso pro time em quem tocar."],
                ["vazio", "Em branco", "Só o Início e um Template. Você monta o resto."],
              ] as const).map(([id, t, d]) => (
                <button key={id} type="button" role="radio" aria-checked={modelo === id} onClick={() => setModelo(id)}
                  className="rounded-xl border p-3 text-left" style={modelo === id ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)" }}>
                  <b className="block text-[13px]" style={{ color: "var(--ink)" }}>{t}</b>
                  <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{d}</span>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {disparar && <Disparar fluxo={disparar} simulacao={simulacao} onFechar={() => setDisparar(null)} onFeito={() => { setDisparar(null); setVersao((v) => v + 1); }} />}
    </div>
  );
}
