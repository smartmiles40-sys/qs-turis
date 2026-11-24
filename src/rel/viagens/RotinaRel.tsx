// src/rel/viagens/RotinaRel.tsx
// -----------------------------------------------------------------------------
// MINHA ROTINA — a tela de trabalho do Relacionamento (24/11/2026), no jeito do
// painel dos SDRs: o time não organiza o dia, só segue a fila.
//   • card grande "PRÓXIMA ATIVIDADE" com a ação principal em 1 clique
//     (✓ Feito / Check-in feito / Marcar emitido), Checklist e Abrir;
//     "Depois" pula pra próxima sem perder a atividade;
//   • contadores (Atrasadas · Agora · Hoje · Próximos 7 dias · Feitas hoje);
//   • a fila inteira por grupo — clicar numa linha a traz pro card.
// A fila vem de src/rel/lib/rotina.ts (pacotes + expedições por grupo +
// check-ins + emissões futuras). Concluiu → sai e entra a próxima.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { COR_EMISSAO } from "@/lib/emissao";
import { ETAPA, concluirEtapa, desfazerEtapa, diasAte, type RegistroEtapa } from "../lib/etapas";
import { ETAPA_EXP, type EstadoEtapaExp, type Expedicao, type RegistroEtapaExp } from "../lib/etapasExpedicao";
import { concluirEtapaExp, desfazerEtapaExp } from "../lib/etapasExpedicaoBanco";
import { GRUPOS_ROTINA, carregarExtras, montarRotina, rotuloDa, type Atividade, type DadosExtras, type GrupoRotina, type ItemPacote } from "../lib/rotina";
import { dataBR, hojeSP, marcarCheckin, type Trecho } from "../lib/viagens";
import { salvarItem, infoDoTipo } from "../lib/componentes";
import { diaBR, diaLocal, horaLocal } from "../lib/problemas";
import { Aviso, Botao, Modal } from "../ui";
import { EtapaModal } from "./EtapasViagem";
import type { ItemAtividade } from "./AtividadesRel";

const COR_SIT: Record<string, string> = { atrasada: "#DC2626", a_fazer: "#D97706", aguardando: "#64748B" };

function quando(e: { situacao: string; abre: string | null; prazo: string | null }): string {
  if (e.situacao === "aguardando") return e.abre ? `abre ${dataBR(e.abre).slice(0, 5)}` : "sem data";
  const d = diasAte(e.prazo);
  if (d === null) return "sem prazo";
  if (d < 0) return `atrasada ${-d} dia${d === -1 ? "" : "s"}`;
  return d === 0 ? "vence hoje" : d === 1 ? "vence amanhã" : `vence em ${d} dias`;
}
const voo = (t: Trecho) => [t.companhia, t.numero].filter(Boolean).join(" ") || "voo sem número";
const rota = (t: Trecho) => [t.origem_codigo || t.origem, t.destino_codigo || t.destino].filter(Boolean).join(" → ");
const horaVoo = (t: Trecho) => `${diaBR(diaLocal(t.partida_em, t.partida_fuso))} ${t.fonte === "bitrix" ? "(horário a confirmar)" : horaLocal(t.partida_em, t.partida_fuso)}`;

/** Título (quem) e descrição (o quê / quando) de uma atividade. */
function textos(a: Atividade): { quem: string; oQue: string; quando: string; corQuando: string } {
  if (a.tipo === "etapa") {
    const d = diasAte(a.it.v.data_embarque);
    return { quem: a.it.v.cliente_nome || a.it.v.titulo, oQue: `${ETAPA[a.estado.id].nome} · ${a.it.v.destino || a.it.v.titulo} · ida ${diaBR(a.it.v.data_embarque)}${d !== null && d >= 0 ? ` (${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`})` : ""}`, quando: quando(a.estado), corQuando: COR_SIT[a.estado.situacao] ?? "#64748B" };
  }
  if (a.tipo === "etapa_exp") {
    return { quem: a.exp.nome, oQue: `${ETAPA_EXP[a.estado.id].nome} · ${a.exp.pax} passageiro${a.exp.pax === 1 ? "" : "s"} · ida ${diaBR(a.exp.data_embarque)}`, quando: quando(a.estado), corQuando: COR_SIT[a.estado.situacao] ?? "#64748B" };
  }
  if (a.tipo === "checkin") {
    const t = a.trechos[0];
    const pax = a.pax > 1 ? ` · ${a.pax} passageiros` : "";
    const loc = a.pax === 1 && t.localizador ? ` · loc. ${t.localizador}` : "";
    return { quem: a.quem, oQue: `Check-in ${voo(t)} · ${rota(t)} · voo ${horaVoo(t)}${pax}${loc}`, quando: t.fonte === "bitrix" ? "horário a confirmar" : a.aberto ? "aberto agora" : `abre ${horaLocal(t.checkin_em, null)}`, corQuando: a.aberto ? "#DC2626" : "#B45309" };
  }
  const info = infoDoTipo(a.item.tipo);
  return { quem: a.item.quem, oQue: `Emitir ${info.emoji} ${a.item.nome}${a.item.fornecedor ? ` · ${a.item.fornecedor}` : ""}${a.item.data_inicio ? ` · uso em ${dataBR(a.item.data_inicio)}` : ""}`, quando: a.estado.texto, corQuando: COR_EMISSAO[a.estado.situacao] };
}

export default function RotinaRel({ itens, equipe, abrirViagem, abrirExpedicao, onMudou }: {
  itens: ItemAtividade[]; equipe: { id: string; name: string }[];
  abrirViagem: (id: string) => void; abrirExpedicao?: (id: string) => void; onMudou: () => void;
}) {
  const { currentUser } = useQsAuth();
  const eu = currentUser?.id ?? "";
  const [extras, setExtras] = useState<DadosExtras | null>(null);
  const [erroExtras, setErroExtras] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [ver, setVer] = useState<GrupoRotina | "todas">("todas");
  const [ativa, setAtiva] = useState<string | null>(null);
  const [pulei, setPulei] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feitas, setFeitas] = useState<{ texto: string; desfazer?: () => Promise<void> }[]>([]);
  const [checklistPac, setChecklistPac] = useState<ItemAtividade | null>(null);
  const [checklistExp, setChecklistExp] = useState<{ exp: Expedicao; estado: EstadoEtapaExp } | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarExtras().then((d) => { if (vivo) { setExtras(d); setErroExtras(null); } })
      .catch((e) => { if (vivo) { setErroExtras(e instanceof Error ? e.message : "Não carregou expedições/emissões."); setExtras({ exps: [], regsExp: new Map(), checkins: [], emissoes: [] }); } });
    return () => { vivo = false; };
  }, [versao]);
  const recarregar = () => { setVersao((x) => x + 1); onMudou(); };

  const fila = useMemo(() => montarRotina(itens.map((i): ItemPacote => ({ v: i.v, atual: i.atual, trechos: i.trechos })), extras), [itens, extras]);
  const porGrupo = useMemo(() => {
    const g: Record<GrupoRotina, Atividade[]> = { atrasadas: [], agora: [], hoje: [], proximas: [] };
    for (const a of fila) g[a.grupo].push(a);
    return g;
  }, [fila]);
  // a próxima: a escolhida, senão a primeira que não foi pulada (de atrasadas/agora/hoje)
  const doDia = fila.filter((a) => a.grupo !== "proximas");
  const atual = fila.find((a) => a.chave === ativa) ?? doDia.find((a) => !pulei.has(a.chave)) ?? doDia[0] ?? null;

  const hoje = hojeSP();
  const feitasHoje = useMemo(() => {
    const doDiaSP = (iso: string | null) => !!iso && new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === hoje;
    const pac = itens.flatMap((i) => i.registros.filter((r) => doDiaSP(r.concluida_em)).map((r) => `${ETAPA[r.etapa].curto} · ${i.v.cliente_nome || i.v.titulo}`));
    const exp = (extras?.exps ?? []).flatMap((e) => (extras?.regsExp.get(e.id) ?? []).filter((r) => doDiaSP(r.concluida_em)).map((r) => `${ETAPA_EXP[r.etapa].curto} · ${e.nome}`));
    return [...pac, ...exp];
  }, [itens, extras, hoje]);

  function registrar(texto: string, desfazer?: () => Promise<void>) {
    setFeitas((l) => [{ texto, desfazer }, ...l].slice(0, 5));
    setAtiva(null);
  }

  async function acao(a: Atividade) {
    setOcupado(a.chave); setErro(null);
    try {
      if (a.tipo === "etapa") {
        const def = ETAPA[a.estado.id];
        const antes: RegistroEtapa | null = a.estado.registro ?? null;
        const alterou = antes?.houve_alteracao === true;
        await concluirEtapa({ viagemId: a.it.v.id, etapa: a.estado.id, userId: eu, checklist: def.checklist.map((item) => ({ item, feito: true })), houveAlteracao: def.perguntaAlteracao ? alterou : null, alteracao: alterou ? antes?.alteracao ?? null : null, obs: antes?.obs ?? null });
        registrar(`${def.nome} · ${a.it.v.cliente_nome || a.it.v.titulo}`, async () => { await desfazerEtapa(a.it.v.id, a.estado.id, eu, { antes }); });
      } else if (a.tipo === "etapa_exp") {
        const def = ETAPA_EXP[a.estado.id];
        const antes: RegistroEtapaExp | null = a.estado.registro ?? null;
        const alterou = antes?.houve_alteracao === true;
        await concluirEtapaExp({ expedicaoId: a.exp.id, etapa: a.estado.id, userId: eu, checklist: def.checklist.map((item) => ({ item, feito: true })), houveAlteracao: def.perguntaAlteracao ? alterou : null, alteracao: alterou ? antes?.alteracao ?? null : null, obs: antes?.obs ?? null });
        registrar(`${def.nome} · ${a.exp.nome}`, async () => { await desfazerEtapaExp(a.exp.id, a.estado.id, antes); });
      } else if (a.tipo === "checkin") {
        await Promise.all(a.trechos.map((t) => marcarCheckin(t.id, true, eu)));
        registrar(`Check-in ${voo(a.trechos[0])} · ${a.quem}`, async () => { await Promise.all(a.trechos.map((t) => marcarCheckin(t.id, false, eu))); });
      } else {
        await salvarItem(a.item.id, { status: "emitido" });
        registrar(`Emitido ${a.item.nome} · ${a.item.quem}`, async () => { await salvarItem(a.item.id, { status: "vendido" }); });
      }
      recarregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não concluiu."); }
    finally { setOcupado(null); }
  }

  async function desfazer(i: number) {
    const f = feitas[i];
    if (!f?.desfazer) return;
    try { await f.desfazer(); setFeitas((l) => l.filter((_, k) => k !== i)); recarregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não desfez."); }
  }

  function abrir(a: Atividade) {
    if (a.tipo === "etapa") abrirViagem(a.it.v.id);
    else if (a.tipo === "emissao") abrirViagem(a.item.viagem_id);
    else if (a.tipo === "checkin" && a.viagemId) abrirViagem(a.viagemId);
    else { const id = a.tipo === "etapa_exp" ? a.exp.id : a.tipo === "checkin" ? a.expId : null; if (id && abrirExpedicao) abrirExpedicao(id); }
  }
  function checklist(a: Atividade) {
    if (a.tipo === "etapa") { const it = itens.find((i) => i.v.id === a.it.v.id); if (it) setChecklistPac({ ...it, atual: a.estado }); }
    if (a.tipo === "etapa_exp") setChecklistExp({ exp: a.exp, estado: a.estado });
  }
  const rotuloAcao = (a: Atividade) => a.tipo === "checkin" ? (a.pax > 1 ? `Check-in do grupo feito (${a.pax})` : "Check-in feito")
    : a.tipo === "emissao" ? "Marcar emitido"
    : a.estado.situacao === "aguardando" ? "✓ Adiantar"
    : (a.tipo === "etapa" ? ETAPA[a.estado.id].perguntaAlteracao : ETAPA_EXP[a.estado.id].perguntaAlteracao) ? "✓ Feito, sem alteração" : "✓ Feito";
  const temChecklist = (a: Atividade) => a.tipo === "etapa" || a.tipo === "etapa_exp";
  const podeAbrir = (a: Atividade) => a.tipo === "etapa" || a.tipo === "emissao" || (a.tipo === "checkin" && !!a.viagemId) || (!!abrirExpedicao && (a.tipo === "etapa_exp" || (a.tipo === "checkin" && !!a.expId)));

  const CONT: { id: GrupoRotina | "feitas"; rotulo: string; n: number; cor: string }[] = [
    { id: "atrasadas", rotulo: "Atrasadas", n: porGrupo.atrasadas.length, cor: "#DC2626" },
    { id: "agora", rotulo: "Agora (check-in aberto)", n: porGrupo.agora.length, cor: "#B45309" },
    { id: "hoje", rotulo: "Para hoje", n: porGrupo.hoje.length, cor: "#D97706" },
    { id: "proximas", rotulo: "Próximos 7 dias", n: porGrupo.proximas.length, cor: "#2563EB" },
    { id: "feitas", rotulo: "Feitas hoje", n: feitasHoje.length, cor: "#16A34A" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {CONT.map((c) => (
          <button key={c.id} type="button" disabled={c.id === "feitas"} onClick={() => c.id !== "feitas" && setVer((v) => (v === c.id ? "todas" : (c.id as GrupoRotina)))}
            className="rel-card px-3 py-2 text-left disabled:cursor-default" aria-pressed={ver === c.id}
            style={ver === c.id ? { borderColor: c.cor, boxShadow: `inset 0 0 0 1px ${c.cor}` } : undefined}>
            <span className="block text-[24px] leading-none font-extrabold tabular-nums" style={{ color: c.cor }}>{c.n}</span>
            <span className="block text-[12px] font-semibold mt-1" style={{ color: "var(--ink2)" }}>{c.rotulo}</span>
          </button>
        ))}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {erroExtras && <Aviso tom="erro">Expedições/emissões: {erroExtras}</Aviso>}
      {feitas.length > 0 && (
        <div className="rel-card px-3 py-2 space-y-1" style={{ borderColor: "#16A34A" }} role="status">
          {feitas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="flex-1" style={{ color: "var(--ink)" }}><span style={{ color: "#16A34A" }}>✓</span> {f.texto}</span>
              {f.desfazer && <button type="button" className="font-bold underline" style={{ color: "var(--rel-ink)" }} onClick={() => void desfazer(i)}>Desfazer</button>}
            </div>
          ))}
        </div>
      )}

      {/* PRÓXIMA ATIVIDADE */}
      {!extras ? <div className="rel-card h-40 animate-pulse" style={{ background: "var(--card2)" }} aria-busy /> : atual ? (() => {
        const t = textos(atual); const r = rotuloDa(atual);
        return (
          <section className="rel-card p-5 flex flex-col gap-4" style={{ borderLeft: `6px solid ${r.cor}` }} aria-label="Próxima atividade">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>Próxima atividade</span>
              <span className="text-[11px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${r.cor}1F`, color: r.cor }}>{r.o_que}</span>
              <span className="text-[12px] font-bold" style={{ color: t.corQuando }}>{t.quando}</span>
            </div>
            <div>
              <h2 className="text-[22px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>{t.quem}</h2>
              <p className="text-[14px] mt-1" style={{ color: "var(--ink2)" }}>{t.oQue}</p>
              {(atual.tipo === "etapa" || atual.tipo === "etapa_exp") && (
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {(atual.tipo === "etapa" ? ETAPA[atual.estado.id] : ETAPA_EXP[atual.estado.id]).checklist.map((c) => (
                    <li key={c} className="text-[13px] flex gap-2" style={{ color: "var(--ink2)" }}><span aria-hidden style={{ color: r.cor }}>•</span>{c}</li>
                  ))}
                </ul>
              )}
              {atual.tipo === "checkin" && atual.pax > 1 && (
                <p className="text-[12.5px] mt-2" style={{ color: "var(--ink3)" }}>
                  {atual.trechos.map((x) => x.localizador).filter(Boolean).slice(0, 12).join(" · ")}{atual.trechos.length > 12 ? " …" : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Botao variante="primario" disabled={ocupado === atual.chave} onClick={() => void acao(atual)}>{ocupado === atual.chave ? "…" : rotuloAcao(atual)}</Botao>
              {temChecklist(atual) && <Botao onClick={() => checklist(atual)}>Checklist / registrar alteração</Botao>}
              {podeAbrir(atual) && <Botao onClick={() => abrir(atual)}>{atual.tipo === "etapa_exp" || (atual.tipo === "checkin" && !atual.viagemId) ? "Abrir expedição" : "Abrir viagem"}</Botao>}
              <Botao variante="fantasma" onClick={() => { setPulei((s) => new Set(s).add(atual.chave)); setAtiva(null); }} title="Vai pra próxima; esta continua na fila">Depois →</Botao>
            </div>
          </section>
        );
      })() : (
        <section className="rel-card p-6 text-center">
          <p className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>Tudo em dia por hoje. 🎉</p>
          <p className="text-[13px] mt-1" style={{ color: "var(--ink3)" }}>{porGrupo.proximas.length ? `Nos próximos 7 dias: ${porGrupo.proximas.length} atividade${porGrupo.proximas.length === 1 ? "" : "s"}.` : "Nada previsto pros próximos 7 dias."}</p>
        </section>
      )}

      {/* A FILA */}
      {extras && GRUPOS_ROTINA.filter((g) => ver === "todas" || ver === g.id).map((g) => (
        porGrupo[g.id].length > 0 || ver === g.id ? (
          <section key={g.id}>
            <h2 className="text-[13px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: g.cor }}>{g.titulo} · {porGrupo[g.id].length}</h2>
            {porGrupo[g.id].length === 0 && <p className="text-[13px] px-1" style={{ color: "var(--ink3)" }}>Nada aqui.</p>}
            <ul className="space-y-1.5">
              {porGrupo[g.id].map((a) => {
                const t = textos(a); const r = rotuloDa(a);
                const eAtual = atual?.chave === a.chave;
                return (
                  <li key={a.chave} className="rel-card px-3 py-2.5 flex flex-wrap lg:flex-nowrap items-center gap-x-3 gap-y-2"
                    style={{ borderLeft: `4px solid ${r.cor}`, ...(eAtual ? { boxShadow: `inset 0 0 0 1px ${r.cor}` } : {}) }}>
                    <span className="w-[130px] flex-shrink-0">
                      <span className="block text-[11px] font-extrabold uppercase tracking-wide" style={{ color: r.cor }}>{r.o_que}</span>
                      <span className="block text-[11.5px] font-semibold" style={{ color: t.corQuando }}>{t.quando}</span>
                    </span>
                    <button type="button" onClick={() => { setAtiva(a.chave); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="min-w-0 flex-1 text-left basis-[220px]" title="Trazer pro card da próxima atividade">
                      <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{t.quem}</span>
                      <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{t.oQue}</span>
                    </button>
                    <span className="flex gap-1.5 flex-shrink-0">
                      {podeAbrir(a) && <Botao variante="fantasma" onClick={() => abrir(a)}>Abrir</Botao>}
                      <Botao variante={g.id === "proximas" ? "secundario" : "primario"} disabled={ocupado === a.chave} onClick={() => void acao(a)}>{ocupado === a.chave ? "…" : rotuloAcao(a)}</Botao>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null
      ))}

      {feitasHoje.length > 0 && (
        <details className="rel-card p-3">
          <summary className="cursor-pointer text-[12.5px] font-extrabold uppercase tracking-wide" style={{ color: "#16A34A" }}>Feitas hoje · {feitasHoje.length}</summary>
          <ul className="text-[13px] space-y-1 mt-2">{feitasHoje.map((f, i) => <li key={i}><span style={{ color: "#16A34A" }}>✓</span> {f}</li>)}</ul>
        </details>
      )}

      {checklistPac && checklistPac.atual && (
        <EtapaModal viagem={checklistPac.v} estado={checklistPac.atual} trechos={checklistPac.trechos} equipe={equipe}
          onFechar={() => setChecklistPac(null)} onSalvo={() => { setChecklistPac(null); setAtiva(null); recarregar(); }} />
      )}
      {checklistExp && (
        <ChecklistExp exp={checklistExp.exp} estado={checklistExp.estado} userId={eu}
          onFechar={() => setChecklistExp(null)} onSalvo={() => { setChecklistExp(null); setAtiva(null); recarregar(); }} />
      )}
    </div>
  );
}

/** Checklist de uma etapa da expedição (marcar item a item, registrar alteração). */
function ChecklistExp({ exp, estado, userId, onFechar, onSalvo }: { exp: Expedicao; estado: EstadoEtapaExp; userId: string; onFechar: () => void; onSalvo: () => void }) {
  const def = ETAPA_EXP[estado.id];
  const salvo = new Map((estado.registro?.checklist ?? []).map((c) => [c.item, c.feito]));
  const [check, setCheck] = useState(def.checklist.map((item) => ({ item, feito: salvo.get(item) ?? false })));
  const [alterou, setAlterou] = useState<boolean | null>(estado.registro?.houve_alteracao ?? null);
  const [alteracao, setAlteracao] = useState(estado.registro?.alteracao ?? "");
  const [obs, setObs] = useState(estado.registro?.obs ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const faltam = check.filter((c) => !c.feito).length;

  async function concluir() {
    if (def.perguntaAlteracao && alterou === null) { setErro("Responda se houve alteração."); return; }
    if (alterou && !alteracao.trim()) { setErro("Descreva o que mudou."); return; }
    if (faltam && !obs.trim()) { setErro(`Faltam ${faltam} item(ns). Marque ou explique na observação.`); return; }
    setOcupado(true); setErro(null);
    try { await concluirEtapaExp({ expedicaoId: exp.id, etapa: estado.id, userId, checklist: check, houveAlteracao: def.perguntaAlteracao ? alterou : null, alteracao, obs }); onSalvo(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal aberto titulo={`${def.nome} · ${exp.nome}`} onFechar={onFechar} largura={640}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={ocupado} onClick={() => void concluir()}>{ocupado ? "Salvando…" : "Concluir etapa"}</Botao></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{def.descricao} {exp.pax} passageiro{exp.pax === 1 ? "" : "s"}.</p>
        <ul className="space-y-1">
          {check.map((c, i) => (
            <li key={c.item}>
              <label className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer rel-linha">
                <input type="checkbox" className="w-4 h-4 mt-0.5" style={{ accentColor: "var(--rel)" }} checked={c.feito}
                  onChange={(e) => setCheck((l) => l.map((x, k) => (k === i ? { ...x, feito: e.target.checked } : x)))} />
                <span className="text-[14px]" style={{ color: c.feito ? "var(--ink3)" : "var(--ink)", textDecoration: c.feito ? "line-through" : "none" }}>{c.item}</span>
              </label>
            </li>
          ))}
        </ul>
        {def.perguntaAlteracao && (
          <div className="flex flex-wrap items-center gap-3 text-[13px]" style={{ color: "var(--ink)" }}>
            <span className="font-semibold">Mudou alguma coisa?</span>
            <label className="flex items-center gap-1"><input type="radio" checked={alterou === false} onChange={() => setAlterou(false)} /> Não</label>
            <label className="flex items-center gap-1"><input type="radio" checked={alterou === true} onChange={() => setAlterou(true)} /> Sim</label>
          </div>
        )}
        {alterou && <textarea className="rel-input w-full" rows={2} placeholder="O que mudou?" value={alteracao} onChange={(e) => setAlteracao(e.target.value)} />}
        <textarea className="rel-input w-full" rows={2} placeholder="Observação (obrigatória se algum item ficou sem marcar)" value={obs} onChange={(e) => setObs(e.target.value)} />
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
