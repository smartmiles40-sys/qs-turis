// src/rel/viagens/AtividadesRel.tsx
// -----------------------------------------------------------------------------
// ATIVIDADES DO RELACIONAMENTO (16/10/2026). Bruno: "igual os SDRs, que eles só
// atendem e ficam concluindo atividades". Cada etapa da esteira que precisa de
// alguém vira uma ATIVIDADE. Check-in de voo também é atividade.
//
// 22/10 (0184) — "MINHAS ATIVIDADES DE HOJE". Em 6 dias de Esteira no ar
// ninguém concluiu nenhuma etapa: nenhuma viagem tinha dono (então "só as
// minhas" ficava vazio), a tela ficava escondida no menu Viagens e concluir
// pedia o checklist inteiro ou uma justificativa. Agora:
//   • abre em MINHAS (as etapas abertas das viagens que eu cuido, por prazo);
//   • SEM DONO aparece em destaque — "Assumir" em 1 clique; a gestão
//     seleciona várias e atribui de uma vez;
//   • "✓ Feito" conclui em 1 clique (checklist inteiro marcado; nas checagens
//     D-x, "sem alteração") com DESFAZER; "Checklist" abre o detalhe pra
//     marcar item a item ou registrar que algo mudou;
//   • viagem embarcando em até 30 dias sem preferências anotadas ganha o selo
//     "faltam preferências".
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { ETAPA, concluirEtapa, desfazerEtapa, diasAte, type EstadoEtapa, type EtapaId, type RegistroEtapa } from "../lib/etapas";
import { hojeSP, marcarCheckin, type Trecho, type Viagem } from "../lib/viagens";
import { atribuirViagens } from "../lib/operacao";
import { diaBR, diaLocal, horaLocal } from "../lib/problemas";
import { podeGerirRelacionamento } from "../equipe/permissao";
import { Aviso, Botao } from "../ui";
import { EtapaModal, quandoTexto, COR_SITUACAO } from "./EtapasViagem";
import DonoViagem from "./DonoViagem";

export interface ItemAtividade { v: Viagem; etapas: EstadoEtapa[]; atual: EstadoEtapa | null; trechos: Trecho[]; registros: RegistroEtapa[] }
type Grupo = "atrasadas" | "hoje" | "proximas";
type Vista = "minhas" | "sem_dono" | "todas";

const CHAVE_VISTA = "rel_atividades_vista";
const somaDias = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ehVoo = (t: Trecho) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";
const nomeDe = (v: Viagem) => v.cliente_nome || v.titulo;

/** Em que grupo a etapa atual da viagem cai (ou fora da lista). */
function grupoDe(it: ItemAtividade, hoje: string): Grupo | null {
  const a = it.atual;
  if (!a) return null;
  // "Em viagem" é acompanhamento contínuo: vira atividade só na hora de fechar (véspera da volta)
  if (a.id === "em_viagem" && a.situacao === "a_fazer") return a.prazo && a.prazo <= somaDias(hoje, 1) ? "hoje" : null;
  if (a.situacao === "atrasada") return "atrasadas";
  if (a.situacao === "a_fazer") return a.prazo && a.prazo > somaDias(hoje, 1) ? "proximas" : "hoje";
  if (a.situacao === "aguardando" && a.abre && a.abre <= somaDias(hoje, 7)) return "proximas";
  return null;
}

function vistaSalva(): Vista {
  try { const v = localStorage.getItem(CHAVE_VISTA); return v === "sem_dono" || v === "todas" ? v : "minhas"; } catch { return "minhas"; }
}

export default function AtividadesRel({ itens, equipe, abrirViagem, onMudou, semPreferencias }: {
  itens: ItemAtividade[]; equipe: { id: string; name: string }[]; abrirViagem: (id: string) => void; onMudou: () => void;
  /** viagens que embarcam em até 30 dias sem nada anotado sobre a pessoa (0184) */
  semPreferencias?: Set<string>;
}) {
  const { currentUser } = useQsAuth();
  const gestor = podeGerirRelacionamento(currentUser);
  const [vista, setVistaEstado] = useState<Vista>(vistaSalva);
  const setVista = (v: Vista) => { setVistaEstado(v); setSel(new Set()); try { localStorage.setItem(CHAVE_VISTA, v); } catch { /* sem memória */ } };
  const [ver, setVer] = useState<Grupo | "todas">("todas");
  const [fazendo, setFazendo] = useState<ItemAtividade | null>(null);
  const [verFeitas, setVerFeitas] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // "✓ Feito" mostra um aviso com DESFAZER por alguns segundos
  const [feito, setFeito] = useState<{ viagemId: string; etapa: EtapaId; texto: string } | null>(null);
  useEffect(() => { if (!feito) return; const t = setTimeout(() => setFeito(null), 10_000); return () => clearTimeout(t); }, [feito]);
  // gestão: várias viagens sem dono → "Atribuir a…" de uma vez
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loteDono, setLoteDono] = useState("");
  const hoje = hojeSP();
  const agora = Date.now();
  const eu = currentUser?.id ?? "";
  const nomeEquipe = new Map(equipe.map((u) => [u.id, u.name.split(" ")[0]]));

  const daVista = (it: ItemAtividade) => vista === "todas" || (vista === "minhas" ? it.v.responsavel_id === eu : !it.v.responsavel_id);
  const { grupos, checkins, feitasHoje, semDono, minhas } = useMemo(() => {
    const g: Record<Grupo, ItemAtividade[]> = { atrasadas: [], hoje: [], proximas: [] };
    for (const it of itens) { if (!daVista(it)) continue; const k = grupoDe(it, hoje); if (k) g[k].push(it); }
    const porPrazo = (a: ItemAtividade, b: ItemAtividade) => String(a.atual?.prazo ?? a.atual?.abre).localeCompare(String(b.atual?.prazo ?? b.atual?.abre)) || String(a.v.data_embarque).localeCompare(String(b.v.data_embarque));
    (Object.keys(g) as Grupo[]).forEach((k) => g[k].sort(porPrazo));
    const checkins = itens.filter(daVista).flatMap((it) => it.trechos
      .filter((t) => ehVoo(t) && t.checkin_em && !t.checkin_feito_em && new Date(t.checkin_em).getTime() <= agora + 24 * 3600_000 && new Date(t.partida_em).getTime() > agora)
      .map((t) => ({ it, t }))).sort((a, b) => a.t.partida_em.localeCompare(b.t.partida_em));
    const feitasHoje = itens.filter(daVista).flatMap((it) => it.registros
      .filter((r) => r.concluida_em && new Date(r.concluida_em).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === hoje)
      .map((r) => ({ it, r })));
    // quantas viagens (com algo pra fazer agora ou nos próximos 7 dias) estão sem dono / são minhas
    const comAtividade = itens.filter((it) => grupoDe(it, hoje));
    return { grupos: g, checkins, feitasHoje, semDono: comAtividade.filter((it) => !it.v.responsavel_id).length, minhas: itens.filter((it) => it.v.responsavel_id === eu).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, vista, hoje, eu]);

  async function feitoRapido(it: ItemAtividade) {
    const e = it.atual;
    if (!e) return;
    const def = ETAPA[e.id];
    setOcupado(it.v.id); setErro(null);
    try {
      await concluirEtapa({
        viagemId: it.v.id, etapa: e.id, userId: eu,
        checklist: def.checklist.map((item) => ({ item, feito: true })),
        houveAlteracao: def.perguntaAlteracao ? false : null, obs: null,
      });
      setFeito({ viagemId: it.v.id, etapa: e.id, texto: `${def.nome} · ${nomeDe(it.v)} concluída${def.perguntaAlteracao ? " (sem alteração na reserva)" : ""}.` });
      onMudou();
    } catch (er) { setErro(er instanceof Error ? er.message : "Não concluiu."); }
    finally { setOcupado(null); }
  }
  async function desfazer() {
    if (!feito) return;
    try { await desfazerEtapa(feito.viagemId, feito.etapa, eu); setFeito(null); onMudou(); }
    catch (er) { setErro(er instanceof Error ? er.message : "Não desfez."); }
  }
  async function atribuirLote() {
    if (!loteDono || !sel.size) return;
    setOcupado("lote"); setErro(null);
    try { await atribuirViagens([...sel], loteDono); setSel(new Set()); setLoteDono(""); onMudou(); }
    catch (er) { setErro(er instanceof Error ? er.message : "Não atribuiu."); }
    finally { setOcupado(null); }
  }

  const CONTADORES: { id: Grupo | "feitas"; rotulo: string; n: number; cor: string }[] = [
    { id: "atrasadas", rotulo: "Atrasadas", n: grupos.atrasadas.length, cor: "#DC2626" },
    { id: "hoje", rotulo: "Para hoje", n: grupos.hoje.length + checkins.length, cor: "#D97706" },
    { id: "proximas", rotulo: "Próximos 7 dias", n: grupos.proximas.length, cor: "#2563EB" },
    { id: "feitas", rotulo: "Feitas hoje", n: feitasHoje.length, cor: "#16A34A" },
  ];
  const selecionavel = gestor && vista !== "minhas";

  function Linha({ it, grupo }: { it: ItemAtividade; grupo: Grupo }) {
    const e = it.atual!;
    const def = ETAPA[e.id];
    const d = diasAte(it.v.data_embarque);
    const antesDeAbrir = e.situacao === "aguardando";
    const faltaPref = semPreferencias?.has(it.v.id);
    return (
      <li className="rel-card px-3 py-2.5 flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-2" style={{ borderLeft: `4px solid ${COR_SITUACAO[e.situacao]}`, opacity: antesDeAbrir ? 0.85 : 1 }}>
        {selecionavel && (
          <input type="checkbox" className="w-4 h-4 flex-shrink-0" style={{ accentColor: "var(--rel)" }} aria-label={`Selecionar ${nomeDe(it.v)}`}
            checked={sel.has(it.v.id)} onChange={(ev) => setSel((s) => { const n = new Set(s); if (ev.target.checked) n.add(it.v.id); else n.delete(it.v.id); return n; })} />
        )}
        <span className="w-[112px] flex-shrink-0">
          <span className="block text-[11px] font-extrabold uppercase tracking-wide" style={{ color: def.cor }}>{def.curto}</span>
          <span className="block text-[11.5px] font-semibold" style={{ color: COR_SITUACAO[e.situacao] }}>{quandoTexto(e)}</span>
        </span>
        <button onClick={() => abrirViagem(it.v.id)} className="min-w-0 flex-1 text-left basis-[200px]">
          <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{nomeDe(it.v)}</span>
          <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            {it.v.destino || it.v.titulo} · ida {diaBR(it.v.data_embarque)}{d !== null && d >= 0 ? ` (${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`})` : ""}
          </span>
          {faltaPref && <span className="inline-block mt-0.5 text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(217,119,6,.12)", color: "#B45309" }}>faltam preferências</span>}
        </button>
        <span className="flex-shrink-0"><DonoViagem viagemId={it.v.id} responsavelId={it.v.responsavel_id} equipe={equipe} onMudou={onMudou} compacto /></span>
        <span className="flex gap-1.5 flex-shrink-0">
          <Botao variante="secundario" onClick={() => setFazendo(it)} title="Abrir o checklist da etapa (marcar item a item, registrar alteração)">Checklist</Botao>
          <Botao variante={grupo === "proximas" ? "secundario" : "primario"} disabled={ocupado === it.v.id}
            title="Conclui a etapa com o checklist inteiro marcado. Dá pra desfazer."
            onClick={() => void feitoRapido(it)}>
            {ocupado === it.v.id ? "…" : antesDeAbrir ? "✓ Adiantar" : def.perguntaAlteracao ? "✓ Feito, sem alteração" : "✓ Feito"}
          </Botao>
        </span>
      </li>
    );
  }

  const secoes: { id: Grupo; titulo: string; cor: string; vazio: string }[] = [
    { id: "atrasadas", titulo: "Atrasadas", cor: "#DC2626", vazio: "Nada atrasado. 👏" },
    { id: "hoje", titulo: "Para hoje", cor: "#D97706", vazio: "Nenhuma etapa para hoje." },
    { id: "proximas", titulo: "Próximos 7 dias", cor: "#2563EB", vazio: "Nada nos próximos 7 dias." },
  ];
  const VISTAS: { id: Vista; rotulo: string; n?: number }[] = [
    { id: "minhas", rotulo: "Minhas" },
    { id: "sem_dono", rotulo: "Sem dono", n: semDono },
    { id: "todas", rotulo: "Todas do time" },
  ];
  const totalVista = grupos.atrasadas.length + grupos.hoje.length + grupos.proximas.length + checkins.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rel-card p-1" role="group" aria-label="De quem">
          {VISTAS.map((x) => (
            <button key={x.id} onClick={() => setVista(x.id)} aria-pressed={vista === x.id} className="rel-linha px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap"
              style={vista === x.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink2)" }}>
              {x.rotulo}{x.n ? <span className="ml-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(220,38,38,.12)", color: "#DC2626" }}>{x.n}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* ninguém cuida → ninguém faz: o "sem dono" fica na cara de todo mundo até ser distribuído */}
      {vista === "minhas" && semDono > 0 && (
        <Aviso tom="aviso">
          <b>{semDono} viage{semDono === 1 ? "m" : "ns"} com etapa pra fazer está{semDono === 1 ? "" : "o"} sem dono.</b>{" "}
          {gestor ? "Distribua pro time" : "Assuma as que são suas"} —{" "}
          <button className="underline font-semibold" onClick={() => setVista("sem_dono")}>ver as sem dono</button>.
        </Aviso>
      )}
      {vista === "minhas" && minhas === 0 && (
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Você ainda não cuida de nenhuma viagem. Abra <b>Sem dono</b> e clique em <b>Assumir</b> nas suas — elas passam a aparecer aqui.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CONTADORES.map((c) => (
          <button key={c.id} onClick={() => (c.id === "feitas" ? setVerFeitas((x) => !x) : setVer((v) => (v === c.id ? "todas" : (c.id as Grupo))))}
            className="rel-card px-3 py-2 text-left" aria-pressed={ver === c.id || (c.id === "feitas" && verFeitas)}
            style={ver === c.id || (c.id === "feitas" && verFeitas) ? { borderColor: c.cor, boxShadow: `inset 0 0 0 1px ${c.cor}` } : undefined}>
            <span className="block text-[24px] leading-none font-extrabold tabular-nums" style={{ color: c.cor }}>{c.n}</span>
            <span className="block text-[12px] font-semibold mt-1" style={{ color: "var(--ink2)" }}>{c.rotulo}</span>
          </button>
        ))}
      </div>

      {feito && (
        <div className="rel-card px-3 py-2 flex flex-wrap items-center gap-3" style={{ borderColor: "#16A34A" }} role="status">
          <span className="text-[13px] flex-1" style={{ color: "var(--ink)" }}><span style={{ color: "#16A34A" }}>✓</span> {feito.texto}</span>
          <button className="text-[13px] font-bold underline" style={{ color: "var(--rel-ink)" }} onClick={() => void desfazer()}>Desfazer</button>
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {selecionavel && sel.size > 0 && (
        <div className="rel-card px-3 py-2 flex flex-wrap items-center gap-2 sticky top-16 z-10" style={{ borderColor: "var(--rel)" }}>
          <b className="text-[13px]" style={{ color: "var(--ink)" }}>{sel.size} selecionada{sel.size > 1 ? "s" : ""}</b>
          <span className="text-[13px]" style={{ color: "var(--ink2)" }}>Atribuir a</span>
          <select className="rel-input" style={{ width: "auto", padding: "5px 8px", fontSize: 13 }} value={loteDono} onChange={(e) => setLoteDono(e.target.value)}>
            <option value="">escolha…</option>
            {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <Botao variante="primario" disabled={!loteDono || ocupado === "lote"} onClick={() => void atribuirLote()}>{ocupado === "lote" ? "Salvando…" : "Atribuir"}</Botao>
          <Botao variante="fantasma" onClick={() => setSel(new Set())}>Limpar</Botao>
        </div>
      )}

      {verFeitas && (
        <section className="rel-card p-3">
          <h2 className="text-[12.5px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: "#16A34A" }}>Feitas hoje</h2>
          {feitasHoje.length ? (
            <ul className="text-[13px] space-y-1">
              {feitasHoje.map(({ it, r }) => (
                <li key={`${it.v.id}${r.etapa}`} className="flex gap-2"><span style={{ color: "#16A34A" }}>✓</span><b>{ETAPA[r.etapa].curto}</b> · {nomeDe(it.v)}{r.concluida_por ? <span style={{ color: "var(--ink3)" }}> · {nomeEquipe.get(r.concluida_por) ?? ""}</span> : null}</li>
              ))}
            </ul>
          ) : <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma atividade concluída hoje ainda.</p>}
        </section>
      )}

      {(ver === "todas" || ver === "hoje") && checkins.length > 0 && (
        <section>
          <h2 className="text-[13px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: "#B45309" }}>Check-ins (próximas 24h) · {checkins.length}</h2>
          <ul className="space-y-1.5">
            {checkins.map(({ it, t }) => {
              const aberto = new Date(t.checkin_em!).getTime() <= agora;
              return (
                <li key={t.id} className="rel-card px-3 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-3" style={{ borderLeft: `4px solid ${aberto ? "#DC2626" : "#B45309"}` }}>
                  <span className="w-[112px] flex-shrink-0">
                    <span className="block text-[11px] font-extrabold uppercase tracking-wide" style={{ color: "#B45309" }}>Check-in</span>
                    <span className="block text-[11.5px] font-semibold" style={{ color: aberto ? "#DC2626" : "#B45309" }}>{t.fonte === "bitrix" ? "horário a confirmar" : aberto ? "aberto agora" : `abre ${horaLocal(t.checkin_em, null)}`}</span>
                  </span>
                  <button onClick={() => abrirViagem(it.v.id)} className="min-w-0 flex-1 text-left">
                    <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{nomeDe(it.v)} · {[t.companhia, t.numero].filter(Boolean).join(" ") || "voo sem número"}</span>
                    <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                      {[t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ")} · voo {diaBR(diaLocal(t.partida_em, t.partida_fuso))} {t.fonte === "bitrix" ? "(horário a confirmar)" : horaLocal(t.partida_em, t.partida_fuso)}{t.localizador ? ` · loc. ${t.localizador}` : ""}
                    </span>
                  </button>
                  <Botao variante="primario" onClick={async () => { try { await marcarCheckin(t.id, true, eu); onMudou(); } catch (er) { setErro(er instanceof Error ? er.message : "Não marcou."); } }}>Check-in feito</Botao>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {secoes.filter((s) => ver === "todas" || ver === s.id).map((s) => (
        <section key={s.id}>
          <div className="flex items-center gap-3 mb-1.5">
            <h2 className="text-[13px] font-extrabold uppercase tracking-wide" style={{ color: s.cor }}>{s.titulo} · {grupos[s.id].length}</h2>
            {selecionavel && grupos[s.id].length > 0 && (
              <button className="text-[12px] font-semibold underline" style={{ color: "var(--ink3)" }}
                onClick={() => setSel((x) => { const n = new Set(x); grupos[s.id].forEach((it) => n.add(it.v.id)); return n; })}>selecionar todas</button>
            )}
          </div>
          {grupos[s.id].length
            ? <ul className="space-y-1.5">{grupos[s.id].map((it) => <Linha key={it.v.id} it={it} grupo={s.id} />)}</ul>
            : <p className="text-[13px] px-1" style={{ color: "var(--ink3)" }}>{s.vazio}</p>}
        </section>
      ))}

      {totalVista === 0 && vista === "minhas" && minhas > 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Tudo em dia nas suas viagens. 🎉</p>}

      {fazendo && fazendo.atual && (
        <EtapaModal viagem={fazendo.v} estado={fazendo.atual} trechos={fazendo.trechos} equipe={equipe}
          onFechar={() => setFazendo(null)} onSalvo={() => { setFazendo(null); onMudou(); }} />
      )}
    </div>
  );
}
