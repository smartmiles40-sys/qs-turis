// src/rel/viagens/EtapasViagem.tsx
// -----------------------------------------------------------------------------
// AS 8 ETAPAS DA VIAGEM (0141, 16/10/2026) — no topo do card. Cada etapa mostra
// se está feita (✓), é a atual, está atrasada (vermelho) ou ainda vai abrir.
// Clicar abre o checklist da etapa; concluir grava quem fez e quando. Nas
// checagens D-30/D-7/D-3 o time responde "mudou algo na reserva?".
// No Check-in, os voos aparecem ali mesmo pra marcar o check-in feito.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { ETAPA, ETAPAS, concluirEtapa, desfazerEtapa, diasAte, estadoDaEsteira, etapasDe, type EstadoEtapa, type EtapaId, type RegistroEtapa } from "../lib/etapas";
import { TIPOS_TRECHO, dataBR, marcarCheckin, type Trecho, type Viagem } from "../lib/viagens";
import { horaLocal, diaBR, diaLocal } from "../lib/problemas";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

export const COR_SITUACAO = { feita: "#16A34A", atrasada: "#DC2626", a_fazer: "#D97706", aguardando: "#94A3B8", nao_se_aplica: "#CBD5E1" } as const;
export const ROTULO_SITUACAO = { feita: "feita", atrasada: "atrasada", a_fazer: "a fazer", aguardando: "ainda não abriu", nao_se_aplica: "não se aplica" } as const;

export function quandoTexto(e: EstadoEtapa): string {
  if (e.situacao === "feita") return e.registro?.concluida_em ? `feita ${new Date(e.registro.concluida_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : "feita";
  if (e.situacao === "nao_se_aplica") return e.id === "passagem" ? "antes da esteira" : "vendida depois";
  if (e.situacao === "aguardando") return e.abre ? `abre ${dataBR(e.abre).slice(0, 5)}` : "sem data";
  const d = diasAte(e.prazo);
  if (d === null) return "sem data";
  if (d < 0) return `atrasada ${-d}d`;
  if (d === 0) return "vence hoje";
  return `até ${dataBR(e.prazo).slice(0, 5)}`;
}

export function EtapaModal({ viagem, estado, trechos, equipe, onFechar, onSalvo }: {
  viagem: Pick<Viagem, "id" | "titulo">; estado: EstadoEtapa; trechos: Trecho[]; equipe: { id: string; name: string }[]; onFechar: () => void; onSalvo: () => void;
}) {
  const { currentUser } = useQsAuth();
  const def = ETAPA[estado.id];
  const r = estado.registro;
  const [check, setCheck] = useState<{ item: string; feito: boolean }[]>([]);
  const [alterou, setAlterou] = useState<boolean | null>(null);
  const [alteracao, setAlteracao] = useState("");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [voos, setVoos] = useState<Trecho[]>([]);

  useEffect(() => {
    const salvo = new Map((r?.checklist ?? []).map((c) => [c.item, c.feito]));
    setCheck(def.checklist.map((item) => ({ item, feito: salvo.get(item) ?? false })));
    setAlterou(r?.houve_alteracao ?? null); setAlteracao(r?.alteracao ?? ""); setObs(r?.obs ?? ""); setErro(null);
  }, [estado.id, r, def.checklist]);
  // check-in: os voos da etapa (ida no Check-in; internos e volta no Em viagem)
  useEffect(() => {
    const vs = trechos.filter((t) => t.tipo === "voo_internacional" || t.tipo === "voo_interno")
      .sort((a, b) => a.partida_em.localeCompare(b.partida_em));
    // ida = os voos até a primeira parada de mais de 24h (o resto é interno/volta)
    const ida: Trecho[] = [];
    for (const t of vs) {
      const ant = ida[ida.length - 1];
      if (ant && new Date(t.partida_em).getTime() - new Date(ant.chegada_em || ant.partida_em).getTime() > 24 * 3600_000) break;
      ida.push(t);
    }
    setVoos(estado.id === "checkin" ? ida
      : estado.id === "em_viagem" ? vs.filter((t) => !ida.includes(t)) : []);
  }, [estado.id, trechos]);

  const feita = estado.situacao === "feita";
  const faltam = check.filter((c) => !c.feito).length;

  async function concluir() {
    if (def.perguntaAlteracao && alterou === null) { setErro("Responda se houve alteração na reserva."); return; }
    if (alterou && !alteracao.trim()) { setErro("Descreva o que mudou."); return; }
    if (faltam && !obs.trim()) { setErro(`Faltam ${faltam} item(ns) do checklist. Marque ou explique na observação por que ficou sem.`); return; }
    setOcupado(true); setErro(null);
    try {
      await concluirEtapa({ viagemId: viagem.id, etapa: estado.id, userId: currentUser?.id ?? "", checklist: check, houveAlteracao: def.perguntaAlteracao ? alterou : null, alteracao, obs });
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }
  async function desfazer() {
    if (!window.confirm(`Reabrir a etapa "${def.nome}"?`)) return;
    setOcupado(true);
    try { await desfazerEtapa(viagem.id, estado.id, currentUser?.id ?? ""); onSalvo(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }
  const quem = r?.concluida_por ? equipe.find((u) => u.id === r.concluida_por)?.name : null;

  return (
    <Modal aberto titulo={`${def.nome} · ${viagem.titulo}`} onFechar={onFechar} largura={640}
      rodape={feita
        ? <><Botao variante="fantasma" onClick={() => void desfazer()} disabled={ocupado}>Reabrir etapa</Botao><Botao variante="primario" onClick={onFechar}>Fechar</Botao></>
        : <><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => void concluir()} disabled={ocupado}>{ocupado ? "Salvando…" : "Concluir etapa"}</Botao></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{def.descricao}</p>
        {feita && (
          <Aviso tom="ok">Feita em {new Date(r!.concluida_em!).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{quem ? ` por ${quem}` : ""}.{r?.houve_alteracao ? ` Houve alteração: ${r.alteracao}` : r?.houve_alteracao === false ? " Sem alteração na reserva." : ""}</Aviso>
        )}
        {voos.length > 0 && (
          <div className="rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
            <p className="text-[12px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>Check-in dos voos</p>
            <ul className="space-y-1.5">
              {voos.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                  <input type="checkbox" className="w-4 h-4" style={{ accentColor: "var(--rel)" }} checked={!!t.checkin_feito_em}
                    onChange={async (e) => { try { await marcarCheckin(t.id, e.target.checked, currentUser?.id ?? ""); setVoos((l) => l.map((x) => x.id === t.id ? { ...x, checkin_feito_em: e.target.checked ? new Date().toISOString() : null } : x)); } catch (er) { setErro(er instanceof Error ? er.message : "Falhou."); } }} />
                  <span className="flex-1"><b>{[t.companhia, t.numero].filter(Boolean).join(" ") || TIPOS_TRECHO[t.tipo]}</b> {[t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ")}</span>
                  <span className="tabular-nums" style={{ color: "var(--ink3)" }}>{diaBR(diaLocal(t.partida_em, t.partida_fuso))} {horaLocal(t.partida_em, t.partida_fuso)}</span>
                  {t.localizador && <span className="font-mono text-[12px]">{t.localizador}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="space-y-1">
          {check.map((c, i) => (
            <li key={c.item}>
              <label className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer rel-linha">
                <input type="checkbox" className="w-4 h-4 mt-0.5" style={{ accentColor: "var(--rel)" }} checked={c.feito} disabled={feita}
                  onChange={(e) => setCheck((l) => l.map((x, k) => k === i ? { ...x, feito: e.target.checked } : x))} />
                <span className="text-[14px]" style={{ color: c.feito ? "var(--ink3)" : "var(--ink)", textDecoration: c.feito ? "line-through" : "none" }}>{c.item}</span>
              </label>
            </li>
          ))}
        </ul>
        {def.perguntaAlteracao && !feita && (
          <div className="rounded-xl p-3" style={{ background: "var(--card2)" }}>
            <p className="text-[13px] font-semibold mb-2" style={{ color: "var(--ink)" }}>Houve alguma alteração na passagem ou nas reservas?</p>
            <div className="flex gap-2">
              {([[false, "Não, tudo igual"], [true, "Sim, mudou algo"]] as const).map(([v, t]) => (
                <button key={t} onClick={() => setAlterou(v)} aria-pressed={alterou === v} className="px-3 py-2 rounded-lg text-[13px] font-semibold"
                  style={alterou === v ? { background: v ? "#DC2626" : "var(--rel)", color: "#fff" } : { background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink2)" }}>{t}</button>
              ))}
            </div>
            {alterou && <div className="mt-2"><Campo rotulo="O que mudou? (o time e a revisão precisam saber)"><textarea className="rel-input" rows={2} value={alteracao} onChange={(e) => setAlteracao(e.target.value)} placeholder="Ex.: voo de volta LA8085 mudou de 22:10 para 23:40; cliente avisado" /></Campo></div>}
          </div>
        )}
        {!feita && <Campo rotulo="Observação"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder={faltam ? "Obrigatória se algum item ficar sem marcar" : "Opcional"} /></Campo>}
        {feita && r?.obs && <p className="text-[13px]" style={{ color: "var(--ink2)" }}><b>Obs.:</b> {r.obs}</p>}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

/** A linha das 8 etapas no topo do card. */
export default function EtapasViagem({ viagem, trechos, equipe, onMudou }: {
  viagem: Viagem; trechos: Trecho[]; equipe: { id: string; name: string }[]; onMudou?: () => void;
}) {
  const [registros, setRegistros] = useState<RegistroEtapa[] | null>(null);
  const [aberta, setAberta] = useState<EtapaId | null>(null);
  const carregar = () => etapasDe([viagem.id]).then((m) => setRegistros(m.get(viagem.id) ?? [])).catch(() => setRegistros([]));
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [viagem.id]);
  const { etapas, atual } = useMemo(() => estadoDaEsteira(viagem, registros ?? []), [viagem, registros]);
  if (registros === null) return <div className="rel-card h-[92px] animate-pulse" style={{ background: "var(--card2)" }} />;
  const estadoAberto = etapas.find((e) => e.id === aberta) ?? null;

  return (
    <section className="rel-card p-3 sm:p-4" aria-label="Etapas do Relacionamento">
      <div className="flex flex-wrap items-baseline gap-2 mb-2.5">
        <h2 className="text-[13px] font-extrabold uppercase tracking-wide" style={{ color: "var(--ink)" }}>Esteira</h2>
        <span className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
          {atual ? <>Agora: <b style={{ color: COR_SITUACAO[atual.situacao] }}>{ETAPA[atual.id].nome}</b> · {quandoTexto(atual)}</> : "Todas as etapas concluídas ✓"}
        </span>
      </div>
      <ol className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
        {etapas.map((e, i) => {
          const cor = COR_SITUACAO[e.situacao];
          const ehAtual = atual?.id === e.id;
          return (
            <li key={e.id}>
              <button onClick={() => setAberta(e.id)} className="w-full text-left rounded-lg px-2 py-2 h-full transition-colors"
                style={{ border: `${ehAtual ? 2 : 1}px solid ${ehAtual ? cor : "var(--line)"}`, background: e.situacao === "feita" ? "rgba(22,163,74,.08)" : ehAtual ? `${cor}14` : "var(--card)", opacity: e.situacao === "nao_se_aplica" ? 0.55 : 1 }}
                aria-label={`${ETAPAS[i].nome}: ${ROTULO_SITUACAO[e.situacao]}`}>
                <span className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0" style={{ background: cor }}>{e.situacao === "feita" ? "✓" : i + 1}</span>
                  <span className="text-[12.5px] font-bold truncate" style={{ color: "var(--ink)" }}>{ETAPAS[i].curto}</span>
                </span>
                <span className="block text-[11px] mt-0.5 font-semibold" style={{ color: cor }}>{quandoTexto(e)}</span>
                {e.registro?.houve_alteracao && <span className="block text-[10.5px] font-bold" style={{ color: "#DC2626" }}>⚠ houve alteração</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {estadoAberto && (
        <EtapaModal viagem={viagem} estado={estadoAberto} trechos={trechos} equipe={equipe}
          onFechar={() => setAberta(null)} onSalvo={() => { setAberta(null); void carregar(); onMudou?.(); }} />
      )}
    </section>
  );
}
