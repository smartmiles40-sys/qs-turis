// src/mkt/grupos/Cadencias.tsx — aba "Cadências": a lista em cartões e o "desenho" de uma
// cadência (linha do tempo vertical: Para quem vai → mensagem 1 → mensagem 2…), igual ao
// SendFlow. Cada mensagem é uma campanha com cadencia_id. Dentro da aba também ficam as
// Recorrentes (mensagens que se repetem toda semana).
//   #mkt/grupos?aba=cadencias                     → lista
//   #mkt/grupos?aba=cadencias&cadencia=<id>       → desenho da cadência
//   #mkt/grupos?aba=cadencias&ver=recorrentes     → recorrentes
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Vazio } from "@/rel/ui";
import {
  apagarCadencia, gruposDoDestino, lerCadencias, lerCampanhas, salvarCadencia, salvarCampanha, type Cadencia, type Campanha,
} from "./lib";
import { avisoPausadaDeProposito, diaPorExtenso, partesSP, passoEditavel, quandoSP, relativo, somarDias, sugerirData } from "./datas";
import { useBases, type Bases } from "./useBases";
import { irNaAba, useParam } from "./navegar";
import { agendarNoServidor, useConfirmarRetomada } from "./Retomar";
import { resumoPublico, SeletorPublico } from "./SeletorPublico";
import { PassoEditor, type PassoAberto } from "./PassoEditor";
import Recorrentes from "./Recorrentes";
import { BotaoGrande, Campo, Escolha, ICONE_TIPO, Nota, SeloStatus, SeloTag, cor } from "./pecas";

export default function CadenciasAba() {
  const [ver, setVer] = useParam("ver");
  const [cadencia] = useParam("cadencia");
  const [recorrencia] = useParam("recorrencia");
  const bases = useBases();
  const recorrentes = ver === "recorrentes" || Boolean(recorrencia);
  return (
    <div>
      {!cadencia && !recorrencia && (
        <div className="mb-5 flex gap-2" style={{ maxWidth: 420 }}>
          <Escolha ativo={!recorrentes} onClick={() => setVer(null)}>🧭 Cadências</Escolha>
          <Escolha ativo={recorrentes} onClick={() => setVer("recorrentes")}>🔄 Recorrentes</Escolha>
        </div>
      )}
      {recorrentes ? <Recorrentes bases={bases} /> : cadencia ? <Desenho id={cadencia} bases={bases} /> : <ListaCadencias bases={bases} />}
    </div>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────────
function ListaCadencias({ bases }: { bases: Bases }) {
  const [, setCadencia] = useParam("cadencia");
  const [itens, setItens] = useState<Cadencia[] | null>(null);
  const [passos, setPassos] = useState<Campanha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nova, setNova] = useState({ nome: "", descricao: "", tag_ids: [] as string[], grupo_jids: [] as string[] });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    Promise.all([lerCadencias(), lerCampanhas()])
      .then(([c, camp]) => { setItens(c); setPassos(camp.filter((x) => x.cadencia_id)); })
      .catch((e) => { setErro((e as Error).message); setItens([]); });
  }, []);

  const resumo = useMemo(() => {
    const m = new Map<string, { total: number; enviados: number; proximo: string | null }>();
    for (const p of passos) {
      const r = m.get(p.cadencia_id as string) || { total: 0, enviados: 0, proximo: null };
      r.total++;
      if (p.status === "concluida") r.enviados++;
      if ((p.status === "agendada" || p.status === "enviando") && p.enviar_em && (!r.proximo || p.enviar_em < r.proximo)) r.proximo = p.enviar_em;
      m.set(p.cadencia_id as string, r);
    }
    return m;
  }, [passos]);

  async function criar() {
    const e: Record<string, string> = {};
    if (!nova.nome.trim()) e.nome = "Dê um nome (ex.: Live do Japão — 20/09).";
    if (!nova.tag_ids.length && !nova.grupo_jids.length) e.publico = "Escolha para quais grupos vai (por tag ou um a um).";
    setErros(e);
    if (Object.keys(e).length) return;
    setOcupado(true);
    try {
      const c = await salvarCadencia({ nome: nova.nome.trim(), descricao: nova.descricao.trim() || null, tag_ids: nova.tag_ids, grupo_jids: nova.grupo_jids });
      setCadencia(c.id);
      window.scrollTo(0, 0);
    } catch (x) { setErros({ geral: (x as Error).message }); }
    finally { setOcupado(false); }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Cadências</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>Uma sequência de mensagens com dia e hora marcados, desenhada numa tela só: mensagem 1, mensagem 2, mensagem 3…</p>
        </div>
        {!criando && <BotaoGrande onClick={() => setCriando(true)}>+ Nova cadência</BotaoGrande>}
      </div>

      {erro && <div className="mb-5"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}

      {criando && (
        <div className="gr-cartao mb-6 p-4 sm:p-[22px]">
          <h3 className="mb-4 text-[17px] font-semibold" style={{ color: cor.ink }}>Nova cadência</h3>
          <Campo rotulo="Nome" dica="· ex.: Live do Japão 20/09" erro={erros.nome}>
            <input className="rel-input" autoFocus value={nova.nome} onChange={(e) => setNova({ ...nova, nome: e.target.value })} placeholder="Live do Japão — 20/09" />
          </Campo>
          <Campo rotulo="Descrição" dica="· opcional">
            <input className="rel-input" value={nova.descricao} onChange={(e) => setNova({ ...nova, descricao: e.target.value })} placeholder="Aquecimento: D-7, D-3, D-1, 1h antes e “ao vivo agora”" />
          </Campo>
          <SeletorPublico valor={nova} onChange={(v) => setNova({ ...nova, ...v })} grupos={bases.grupos} tags={bases.tags} links={bases.links} erro={erros.publico} />
          {erros.geral && <p className="mb-3 text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erros.geral}</p>}
          <div className="flex flex-wrap gap-2.5">
            <BotaoGrande disabled={ocupado} onClick={() => void criar()}>{ocupado ? "Criando…" : "Criar e desenhar as mensagens ›"}</BotaoGrande>
            <BotaoGrande variante="secundario" onClick={() => setCriando(false)}>Cancelar</BotaoGrande>
          </div>
        </div>
      )}

      {itens === null ? (
        <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando…</div>
      ) : itens.length === 0 && !criando ? (
        <div className="gr-cartao"><Vazio titulo="Nenhuma cadência ainda" texto="Crie a primeira e monte as mensagens no desenho." /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((c) => {
            const r = resumo.get(c.id) || { total: 0, enviados: 0, proximo: null };
            const n = gruposDoDestino(c, bases.grupos, bases.links).length;
            return (
              <button key={c.id} type="button" onClick={() => { setCadencia(c.id); window.scrollTo(0, 0); }}
                className="gr-cartao gr-cartao-clicavel flex flex-col p-[18px] text-left">
                <h3 className="mb-1 break-words text-[17px] font-semibold leading-tight" style={{ color: cor.ink }}>{c.nome}</h3>
                <p className="truncate text-[13px]" style={{ color: cor.ink3 }}>{resumoPublico(c, bases.tags)} · {n} grupo{n === 1 ? "" : "s"}</p>
                <div className="mt-3 text-[13px]" style={{ color: cor.ink2 }}>{r.total} {r.total === 1 ? "mensagem" : "mensagens"} · {r.enviados} enviadas</div>
                <div className="mt-1 text-[12.5px]" style={{ color: cor.ink3 }}>
                  {r.proximo ? <>Próxima: <b style={{ color: cor.ink }}>{quandoSP(r.proximo)}</b></> : r.total && r.enviados === r.total ? "Concluída ✓" : "Nada agendado"}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── O desenho de uma cadência ───────────────────────────────────────────────
function linhaDeResultado(p: Campanha): string | null {
  if (!p.total) return null;
  return `${p.enviados}/${p.total} grupos receberam${p.falhas ? ` · ${p.falhas} com falha` : ""}`;
}

function Desenho({ id, bases }: { id: string; bases: Bases }) {
  const [, setCadencia] = useParam("cadencia");
  const [cad, setCad] = useState<Cadencia | null | undefined>(undefined);
  const [passos, setPassos] = useState<Campanha[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<PassoAberto | null>(null);
  const [painel, setPainel] = useState<"destino" | "duplicar" | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [ativando, setAtivando] = useState(false);
  const [pedirRetomada, modalRetomada] = useConfirmarRetomada();

  const carregar = useCallback(async () => {
    try {
      const [cs, ps] = await Promise.all([lerCadencias(), lerCampanhas({ cadenciaId: id })]);
      setCad(cs.find((c) => c.id === id) ?? null);
      setPassos([...ps].sort((a, b) => String(a.enviar_em || "9").localeCompare(String(b.enviar_em || "9"))));
      setErro(null);
    } catch (e) { setErro((e as Error).message); setCad((v) => v ?? null); }
    finally { setAgora(Date.now()); }
  }, [id]);
  // Recarrega a cada 20 s: é assim que "Agendada" vira "Enviando…" e "Enviada" sozinho.
  useEffect(() => { void carregar(); const t = setInterval(() => void carregar(), 20_000); return () => clearInterval(t); }, [carregar]);

  const paradas = passos.filter((p) => !p.fanout_em && (p.status === "pausada" || p.status === "rascunho"));
  const voltar = () => { setCadencia(null); window.scrollTo(0, 0); };

  if (cad === undefined) return <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando cadência…</div>;
  if (cad === null) return (
    <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>
      {erro ?? "Cadência não encontrada."} <button type="button" className="font-semibold underline" style={{ color: cor.relInk }} onClick={voltar}>Voltar</button>
    </div>
  );
  const cadencia = cad;

  function abrirNovo(i: number) {
    setEditando({ passo: null, numero: i + 1, enviarEm: sugerirData(passos[i - 1]?.enviar_em ?? null, passos[i]?.enviar_em ?? null), modelo: passos[i - 1] ?? null });
  }

  function ativarTodas() {
    const comAviso = paradas.map((p) => avisoPausadaDeProposito(p.avisos)).find(Boolean);
    const rodar = async () => {
      setAtivando(true); setErro(null);
      const falhas: string[] = [];
      for (const p of paradas) {
        try { const e = await agendarNoServidor(p.id); if (e.length) falhas.push(`${quandoSP(p.enviar_em)}: ${e[0]}`); }
        catch (x) { falhas.push(`${quandoSP(p.enviar_em)}: ${(x as Error).message}`); }
      }
      setAtivando(false);
      await carregar();
      if (falhas.length) setErro(`${falhas.length} mensagem(ns) não puderam ser ativadas — abra cada uma e ajuste (data no passado?). ${falhas.join(" · ")}`);
    };
    pedirRetomada({ nome: `${paradas.length} mensagens pausadas de “${cadencia.nome}”`, avisos: comAviso ? [comAviso] : [] }, rodar);
  }

  async function apagar() {
    const vivas = passos.filter((p) => ["agendada", "enviando", "pausada"].includes(p.status)).length;
    if (!confirm(`Apagar a cadência “${cadencia.nome}”? As mensagens já criadas continuam como campanhas avulsas${vivas ? ` — ${vivas} delas ainda vão sair (cancele antes em Campanhas se não quiser)` : ""}.`)) return;
    try { await apagarCadencia(cadencia.id); voltar(); } catch (e) { setErro((e as Error).message); }
  }

  const dias = passos.map((p) => (p.enviar_em ? diaPorExtenso(p.enviar_em, agora) : "sem data"));
  const nGrupos = gruposDoDestino(cadencia, bases.grupos, bases.links).length;
  const tagsDaCad = bases.tags.filter((t) => cadencia.tag_ids.includes(t.id));

  return (
    <div>
      {modalRetomada}
      <div className="mb-1.5 text-[13px]" style={{ color: cor.ink3 }}>
        <button type="button" onClick={voltar} className="hover:underline">Cadências</button> / <b style={{ color: cor.ink }}>{cadencia.nome}</b>
      </div>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[22px] font-semibold leading-tight" style={{ color: cor.ink }}>{cadencia.nome}</h2>
          {cadencia.descricao && <p className="mt-1 text-[14px]" style={{ color: cor.ink2 }}>{cadencia.descricao}</p>}
          <div className="mt-2 text-[13px]" style={{ color: cor.ink3 }}>
            {passos.length} {passos.length === 1 ? "mensagem" : "mensagens"} · {passos.filter((p) => p.status === "concluida").length} enviadas
          </div>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <BotaoGrande pequeno variante="secundario" onClick={() => setPainel("duplicar")}>⧉ Duplicar</BotaoGrande>
          <BotaoGrande pequeno variante="perigo" onClick={() => void apagar()}>Apagar</BotaoGrande>
        </div>
      </div>

      {erro && <div className="mb-4"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}

      {paradas.length > 0 && (
        <div className="gr-cartao mb-4 flex flex-wrap items-center gap-3 px-3.5 py-3 text-[14px]">
          <span className="min-w-0 flex-1" style={{ color: cor.ink2 }}>
            ⏸ {paradas.length} {paradas.length === 1 ? "mensagem pausada" : "mensagens pausadas"} — não {paradas.length === 1 ? "sai" : "saem"} até ativar.
            {paradas.some((p) => avisoPausadaDeProposito(p.avisos)) && <b style={{ color: "var(--warn-ink)" }}> Tem mensagem migrada do SendFlow pausada de propósito.</b>}
          </span>
          <BotaoGrande pequeno disabled={ativando} onClick={ativarTodas}>{ativando ? "Ativando…" : "▶ Ativar todas"}</BotaoGrande>
        </div>
      )}

      {/* O "desenho": fundo pontilhado e uma linha do tempo vertical, do início ao fim. */}
      <div className="rounded-[14px] px-3 py-6 sm:px-6"
        style={{ border: "1px solid var(--line)", backgroundColor: "var(--bg)", backgroundImage: "radial-gradient(circle, rgba(120,130,150,.22) 1px, transparent 1.2px)", backgroundSize: "22px 22px" }}>
        <div className="mx-auto max-w-[620px]">
          <div className="gr-cartao px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px]" style={{ border: "1px solid var(--rel)", color: cor.relInk }}>▶</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: cor.ink3 }}>Para quem vai</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[14px] font-semibold" style={{ color: cor.ink }}>
                  {tagsDaCad.map((t) => <SeloTag key={t.id} tag={t} pequeno />)}
                  {cadencia.grupo_jids.length > 0 && <span>{tagsDaCad.length ? "+ " : ""}{cadencia.grupo_jids.length} grupo(s) escolhidos</span>}
                  <span className="font-normal" style={{ color: cor.ink3 }}>= {nGrupos} grupos hoje</span>
                </div>
              </div>
              <BotaoGrande pequeno variante="secundario" onClick={() => setPainel("destino")}>Trocar</BotaoGrande>
            </div>
          </div>

          {passos.map((p, i) => {
            const novoDia = i === 0 || dias[i] !== dias[i - 1];
            const editavel = passoEditavel(p);
            const resultado = linhaDeResultado(p);
            const parado = p.status === "rascunho" || p.status === "pausada";
            const aviso = p.status === "pausada" ? avisoPausadaDeProposito(p.avisos) : null;
            return (
              <div key={p.id}>
                <Conector onInserir={() => abrirNovo(i)} rotulo={`Inserir mensagem antes da ${i + 1}`} />
                {novoDia && (
                  <div className="mb-3 text-center">
                    <span className="inline-block rounded-full px-3 py-1 text-[12px] font-semibold first-letter:uppercase" style={{ border: "1px solid var(--line)", background: cor.card2, color: cor.ink2 }}>{dias[i]}</span>
                  </div>
                )}
                <button type="button" onClick={() => (editavel ? setEditando({ passo: p, numero: i + 1, enviarEm: p.enviar_em || new Date().toISOString() }) : irNaAba("campanhas", { campanha: p.id }))}
                  className="group gr-cartao-clicavel block w-full rounded-[14px] px-4 py-3.5 text-left"
                  style={{ background: aviso ? "var(--warn-bg)" : cor.card, border: parado ? "1.5px dashed var(--line)" : "1px solid var(--line)", opacity: parado && !aviso ? 0.85 : 1 }}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold"
                      style={p.status === "concluida" ? { background: "rgba(34,197,94,.18)", color: "var(--green, #16a34a)" } : { background: "var(--rel)", color: "#fff" }}>
                      {p.status === "concluida" ? "✓" : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[20px] font-semibold tabular-nums" style={{ color: cor.ink }}>{p.enviar_em ? partesSP(p.enviar_em).hora : "--:--"}</span>
                        <span className="text-[12px]" style={{ color: cor.ink3 }}>{ICONE_TIPO[p.tipo]} {p.enviar_em ? relativo(p.enviar_em, agora) : ""}</span>
                      </div>
                    </div>
                    <SeloStatus status={p.status} detalhe={p.status === "enviando" && p.total ? `${p.enviados}/${p.total}` : undefined} />
                  </div>
                  <div className="mt-2.5 flex gap-3">
                    {p.tipo === "imagem" && p.midia_url && <img src={p.midia_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
                    <p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words text-[13.5px] leading-snug" style={{ color: cor.ink2 }}>
                      {p.texto || <span style={{ color: cor.ink3 }}>(sem texto)</span>}
                      {p.tipo === "enquete" && p.enquete_opcoes?.length ? <span className="mt-1 block text-[12.5px]" style={{ color: cor.ink3 }}>{p.enquete_opcoes.join(" · ")}</span> : null}
                    </p>
                  </div>
                  {aviso && <div className="mt-2.5 text-[12px] font-semibold" style={{ color: "var(--warn-ink)" }}>⚠️ {aviso}</div>}
                  {(resultado || p.status === "erro") && (
                    <div className="mt-2.5 pt-2 text-[12px]" style={{ borderTop: "1px solid var(--line)", color: p.status === "erro" ? "var(--err-ink)" : cor.ink3 }}>
                      {resultado ?? (p.erro || "O envio deu erro — abra para corrigir e reagendar.")}
                    </div>
                  )}
                  <div className="mt-1.5 text-[11.5px] font-semibold opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100" style={{ color: cor.relInk }}>
                    {editavel ? "Toque para editar ›" : "Ver quais grupos receberam ›"}
                  </div>
                </button>
              </div>
            );
          })}

          <Conector />
          <button type="button" onClick={() => abrirNovo(passos.length)}
            className="block w-full rounded-[14px] px-4 py-4 text-center text-[14px] font-semibold transition-opacity hover:opacity-85"
            style={{ border: "1.5px dashed var(--rel)", background: cor.relSoft, color: cor.relInk }}>
            + {passos.length ? "Adicionar a próxima mensagem" : "Criar a mensagem 1"}
          </button>
        </div>
      </div>

      {editando && <PassoEditor key={editando.passo?.id || `novo-${editando.numero}`} cadencia={cadencia} aberto={editando}
        onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />}
      {painel === "destino" && <PainelDestino cadencia={cadencia} passos={passos} bases={bases} onFechar={() => setPainel(null)} onSalvo={() => { setPainel(null); void carregar(); }} />}
      {painel === "duplicar" && <PainelDuplicar cadencia={cadencia} passos={passos} onFechar={() => setPainel(null)} onCriada={(novaId) => { setPainel(null); setCadencia(novaId); window.scrollTo(0, 0); }} />}
    </div>
  );
}

/** A linha que liga um nó ao próximo; com `onInserir`, vira um "+" para encaixar uma mensagem ali. */
function Conector({ onInserir, rotulo }: { onInserir?: () => void; rotulo?: string }) {
  return (
    <div className="relative flex h-10 items-center justify-center">
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: "var(--line)" }} />
      {onInserir && (
        <button type="button" onClick={onInserir} aria-label={rotulo} title={rotulo}
          className="relative flex h-7 w-7 items-center justify-center rounded-full text-[14px] transition-colors"
          style={{ border: "1px solid var(--line)", background: "var(--bg)", color: cor.ink3 }}>+</button>
      )}
    </div>
  );
}

/** "Para quem vai": troca o público da cadência E das mensagens que ainda não montaram a fila. */
function PainelDestino({ cadencia, passos, bases, onFechar, onSalvo }: { cadencia: Cadencia; passos: Campanha[]; bases: Bases; onFechar: () => void; onSalvo: () => void }) {
  const [d, setD] = useState({ tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const aMudar = passos.filter((p) => passoEditavel(p));
  async function salvar() {
    if (!d.tag_ids.length && !d.grupo_jids.length) { setErro("Escolha ao menos uma tag ou um grupo. Destino vazio NÃO quer dizer “todos”."); return; }
    setOcupado(true); setErro(null);
    try {
      await salvarCadencia({ nome: cadencia.nome, tag_ids: d.tag_ids, grupo_jids: d.grupo_jids }, cadencia.id);
      for (const p of aMudar) await salvarCampanha({ nome: p.nome, tag_ids: d.tag_ids, grupo_jids: d.grupo_jids }, p.id);
      onSalvo();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo="Para quem vai" onFechar={onFechar} largura={620}
      rodape={<><BotaoGrande pequeno variante="secundario" onClick={onFechar}>Cancelar</BotaoGrande><BotaoGrande pequeno disabled={ocupado} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar destino"}</BotaoGrande></>}>
      <SeletorPublico valor={d} onChange={setD} grupos={bases.grupos} tags={bases.tags} links={bases.links} erro={erro} />
      <p className="text-[12px] leading-relaxed" style={{ color: cor.ink3 }}>
        Vale para as {aMudar.length} mensagem(ns) que ainda não saíram. As que já montaram a fila continuam registradas para onde foram.
      </p>
    </Modal>
  );
}

/** "Duplicar para a próxima": copia o destino e as mensagens, empurrando as datas. As cópias nascem como rascunho. */
function PainelDuplicar({ cadencia, passos, onFechar, onCriada }: { cadencia: Cadencia; passos: Campanha[]; onFechar: () => void; onCriada: (id: string) => void }) {
  const [nome, setNome] = useState(`${cadencia.nome} (cópia)`);
  const [dias, setDias] = useState("7");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function duplicar() {
    const n = Number(dias);
    if (!nome.trim()) { setErro("Dê um nome."); return; }
    if (!Number.isInteger(n) || n < 0 || n > 365) { setErro("Dias: de 0 a 365."); return; }
    setOcupado(true); setErro(null);
    try {
      const nova = await salvarCadencia({ nome: nome.trim(), descricao: cadencia.descricao, tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids });
      for (const p of passos) {
        if (p.status === "cancelada") continue;
        await salvarCampanha({
          nome: p.nome.replace(cadencia.nome, nome.trim()), cadencia_id: nova.id, enviar_em: p.enviar_em ? somarDias(p.enviar_em, n) : null,
          tipo: p.tipo, texto: p.texto, midia_url: p.midia_url, midia_nome: p.midia_nome, enquete_opcoes: p.enquete_opcoes, enquete_multipla: p.enquete_multipla,
          mencionar_todos: p.mencionar_todos, tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids,
          intervalo_min_seg: p.intervalo_min_seg, intervalo_max_seg: p.intervalo_max_seg,
        });
      }
      onCriada(nova.id);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo="Duplicar para a próxima" onFechar={onFechar} largura={520}
      rodape={<><BotaoGrande pequeno variante="secundario" onClick={onFechar}>Cancelar</BotaoGrande><BotaoGrande pequeno disabled={ocupado} onClick={() => void duplicar()}>{ocupado ? "Duplicando…" : "⧉ Criar cópia"}</BotaoGrande></>}>
      <Campo rotulo="Nome da nova cadência"><input className="rel-input" value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="Empurrar as datas em" dica="· dias"><input type="number" inputMode="numeric" min={0} max={365} className="rel-input" value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>
      <p className="mb-2 text-[12px] leading-relaxed" style={{ color: cor.ink3 }}>
        Copia o destino e todas as mensagens. As cópias nascem <b style={{ color: cor.ink }}>pausadas (rascunho)</b>, para você revisar o texto antes; depois é só tocar em “Ativar todas”.
      </p>
      {erro && <p className="text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erro}</p>}
    </Modal>
  );
}
