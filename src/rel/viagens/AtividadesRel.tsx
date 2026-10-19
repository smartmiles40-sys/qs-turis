// src/rel/viagens/AtividadesRel.tsx
// -----------------------------------------------------------------------------
// ATIVIDADES DO RELACIONAMENTO (16/10/2026). Bruno: "igual os SDRs, que eles só
// atendem e ficam concluindo atividades". Cada etapa da esteira que precisa de
// alguém vira uma ATIVIDADE com um botão "Fazer": abre o checklist, conclui,
// some da lista e entra a próxima. Check-in de voo também é atividade.
//
// Contadores no topo (atrasadas · hoje · próximos 7 dias · feitas hoje),
// "só as minhas" pelo responsável da viagem e "assumir" pra quem está sem dono.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { ETAPA, diasAte, type EstadoEtapa, type RegistroEtapa } from "../lib/etapas";
import { hojeSP, marcarCheckin, salvarViagem, type Trecho, type Viagem } from "../lib/viagens";
import { diaBR, diaLocal, horaLocal } from "../lib/problemas";
import { Botao } from "../ui";
import { EtapaModal, quandoTexto, COR_SITUACAO } from "./EtapasViagem";

export interface ItemAtividade { v: Viagem; etapas: EstadoEtapa[]; atual: EstadoEtapa | null; trechos: Trecho[]; registros: RegistroEtapa[] }
type Grupo = "atrasadas" | "hoje" | "proximas";

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

export default function AtividadesRel({ itens, equipe, abrirViagem, onMudou }: {
  itens: ItemAtividade[]; equipe: { id: string; name: string }[]; abrirViagem: (id: string) => void; onMudou: () => void;
}) {
  const { currentUser } = useQsAuth();
  const [soMinhas, setSoMinhas] = useState(false);
  const [ver, setVer] = useState<Grupo | "todas">("todas");
  const [fazendo, setFazendo] = useState<ItemAtividade | null>(null);
  const [verFeitas, setVerFeitas] = useState(false);
  const hoje = hojeSP();
  const agora = Date.now();
  const nomeEquipe = new Map(equipe.map((u) => [u.id, u.name.split(" ")[0]]));

  const meus = (it: ItemAtividade) => !soMinhas || it.v.responsavel_id === currentUser?.id;
  const { grupos, checkins, feitasHoje } = useMemo(() => {
    const g: Record<Grupo, ItemAtividade[]> = { atrasadas: [], hoje: [], proximas: [] };
    for (const it of itens) { if (!meus(it)) continue; const k = grupoDe(it, hoje); if (k) g[k].push(it); }
    const porPrazo = (a: ItemAtividade, b: ItemAtividade) => String(a.atual?.prazo ?? a.atual?.abre).localeCompare(String(b.atual?.prazo ?? b.atual?.abre)) || String(a.v.data_embarque).localeCompare(String(b.v.data_embarque));
    (Object.keys(g) as Grupo[]).forEach((k) => g[k].sort(porPrazo));
    const checkins = itens.filter(meus).flatMap((it) => it.trechos
      .filter((t) => ehVoo(t) && t.checkin_em && !t.checkin_feito_em && new Date(t.checkin_em).getTime() <= agora + 24 * 3600_000 && new Date(t.partida_em).getTime() > agora)
      .map((t) => ({ it, t }))).sort((a, b) => a.t.partida_em.localeCompare(b.t.partida_em));
    const feitasHoje = itens.filter(meus).flatMap((it) => it.registros
      .filter((r) => r.concluida_em && new Date(r.concluida_em).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) === hoje)
      .map((r) => ({ it, r })));
    return { grupos: g, checkins, feitasHoje };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, soMinhas, hoje, currentUser?.id]);

  async function assumir(it: ItemAtividade) {
    if (!currentUser?.id) return;
    await salvarViagem(it.v.id, { responsavel_id: currentUser.id }).catch(() => null);
    onMudou();
  }

  const CONTADORES: { id: Grupo | "feitas"; rotulo: string; n: number; cor: string }[] = [
    { id: "atrasadas", rotulo: "Atrasadas", n: grupos.atrasadas.length, cor: "#DC2626" },
    { id: "hoje", rotulo: "Para hoje", n: grupos.hoje.length + checkins.length, cor: "#D97706" },
    { id: "proximas", rotulo: "Próximos 7 dias", n: grupos.proximas.length, cor: "#2563EB" },
    { id: "feitas", rotulo: "Feitas hoje", n: feitasHoje.length, cor: "#16A34A" },
  ];

  function Linha({ it, grupo }: { it: ItemAtividade; grupo: Grupo }) {
    const e = it.atual!;
    const def = ETAPA[e.id];
    const dono = it.v.responsavel_id ? nomeEquipe.get(it.v.responsavel_id) : null;
    const d = diasAte(it.v.data_embarque);
    const antesDeAbrir = e.situacao === "aguardando";
    return (
      <li className="rel-card px-3 py-2.5 flex flex-wrap sm:flex-nowrap items-center gap-3" style={{ borderLeft: `4px solid ${COR_SITUACAO[e.situacao]}`, opacity: antesDeAbrir ? 0.8 : 1 }}>
        <span className="w-[112px] flex-shrink-0">
          <span className="block text-[11px] font-extrabold uppercase tracking-wide" style={{ color: def.cor }}>{def.curto}</span>
          <span className="block text-[11.5px] font-semibold" style={{ color: COR_SITUACAO[e.situacao] }}>{quandoTexto(e)}</span>
        </span>
        <button onClick={() => abrirViagem(it.v.id)} className="min-w-0 flex-1 text-left">
          <span className="block text-[14px] font-bold truncate" style={{ color: "var(--ink)" }}>{nomeDe(it.v)}</span>
          <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            {it.v.destino || it.v.titulo} · ida {diaBR(it.v.data_embarque)}{d !== null && d >= 0 ? ` (${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`})` : ""}
          </span>
        </button>
        <span className="text-[12px] flex-shrink-0 w-[92px] text-right" style={{ color: "var(--ink3)" }}>
          {dono ? dono : <button className="underline font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => void assumir(it)}>assumir</button>}
        </span>
        <Botao variante={grupo === "proximas" ? "secundario" : "primario"} onClick={() => setFazendo(it)}>{antesDeAbrir ? "Adiantar" : "Fazer"}</Botao>
      </li>
    );
  }

  const secoes: { id: Grupo; titulo: string; cor: string; vazio: string }[] = [
    { id: "atrasadas", titulo: "Atrasadas", cor: "#DC2626", vazio: "Nada atrasado. 👏" },
    { id: "hoje", titulo: "Para hoje", cor: "#D97706", vazio: "Nenhuma etapa para hoje." },
    { id: "proximas", titulo: "Próximos 7 dias", cor: "#2563EB", vazio: "Nada nos próximos 7 dias." },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 min-w-[280px]">
          {CONTADORES.map((c) => (
            <button key={c.id} onClick={() => (c.id === "feitas" ? setVerFeitas((x) => !x) : setVer((v) => (v === c.id ? "todas" : (c.id as Grupo))))}
              className="rel-card px-3 py-2 text-left" aria-pressed={ver === c.id || (c.id === "feitas" && verFeitas)}
              style={ver === c.id || (c.id === "feitas" && verFeitas) ? { borderColor: c.cor, boxShadow: `inset 0 0 0 1px ${c.cor}` } : undefined}>
              <span className="block text-[24px] leading-none font-extrabold tabular-nums" style={{ color: c.cor }}>{c.n}</span>
              <span className="block text-[12px] font-semibold mt-1" style={{ color: "var(--ink2)" }}>{c.rotulo}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" className="w-4 h-4" style={{ accentColor: "var(--rel)" }} checked={soMinhas} onChange={(e) => setSoMinhas(e.target.checked)} /> Só as minhas
        </label>
      </div>

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
                  <Botao variante="primario" onClick={async () => { await marcarCheckin(t.id, true, currentUser?.id ?? "").catch(() => null); onMudou(); }}>Check-in feito</Botao>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {secoes.filter((s) => ver === "todas" || ver === s.id).map((s) => (
        <section key={s.id}>
          <h2 className="text-[13px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: s.cor }}>{s.titulo} · {grupos[s.id].length}</h2>
          {grupos[s.id].length
            ? <ul className="space-y-1.5">{grupos[s.id].map((it) => <Linha key={it.v.id} it={it} grupo={s.id} />)}</ul>
            : <p className="text-[13px] px-1" style={{ color: "var(--ink3)" }}>{s.vazio}</p>}
        </section>
      ))}

      {fazendo && fazendo.atual && (
        <EtapaModal viagem={fazendo.v} estado={fazendo.atual} trechos={fazendo.trechos} equipe={equipe}
          onFechar={() => setFazendo(null)} onSalvo={() => { setFazendo(null); onMudou(); }} />
      )}
    </div>
  );
}
