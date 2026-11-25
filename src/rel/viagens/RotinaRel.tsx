// src/rel/viagens/RotinaRel.tsx
// -----------------------------------------------------------------------------
// MINHA ROTINA — a tela de trabalho do Relacionamento (24/11/2026), no jeito do
// painel dos SDRs: o time não organiza o dia, só segue a fila.
//   • card grande "PRÓXIMA ATIVIDADE" com a ação principal em 1 clique
//     (✓ Feito / Check-in feito / Marcar emitido), Checklist e Abrir;
//     "Depois" pula pra próxima sem perder a atividade;
//   • contadores (Atrasadas · Agora · Hoje · Próximos 7 dias · Futuras · Feitas hoje);
//   • a fila inteira por grupo — clicar numa linha a traz pro card.
// 25/11 (Bruno): "aparece o bilhete pra ela abrir, foco na companhia,
// localizador, destino e principais informações, bem visível" + "quando
// aparecer a atividade, aparece o WhatsApp pra entrar em contato com o
// cliente". O card virou um BILHETE (cia grande, rota em códigos, localizador
// com copiar, Ver bilhete, site de check-in) e ganhou o painel do CLIENTE com
// o botão de WhatsApp (abre a conversa no QS; sem conversa, manda modelo).
// A fila vem de src/rel/lib/rotina.ts (pacotes + expedições por grupo +
// check-ins + emissões futuras, inclusive as do closer + solicitações).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { COR_EMISSAO } from "@/lib/emissao";
import { ETAPA, concluirEtapa, desfazerEtapa, diasAte, type RegistroEtapa } from "../lib/etapas";
import { ETAPA_EXP, type EstadoEtapaExp, type Expedicao, type RegistroEtapaExp } from "../lib/etapasExpedicao";
import { concluirEtapaExp, desfazerEtapaExp } from "../lib/etapasExpedicaoBanco";
import {
  GRUPOS_ROTINA, carregarExtras, contatoDa, extrasVazios, montarRotina, rotuloDa,
  type Atividade, type Contato, type DadosExtras, type GrupoRotina, type ItemPacote,
} from "../lib/rotina";
import { abrirDocumentoPorId, dataBR, hojeSP, marcarCheckin, type Trecho } from "../lib/viagens";
import { salvarItem, infoDoTipo } from "../lib/componentes";
import { diaBR, diaLocal, horaLocal } from "../lib/problemas";
import { conversaPorTelefone, conversasDoCliente } from "../lib/whatsapp";
import { NOME_SETOR } from "@/solicitacoes/lib";
import ModeloModal from "../atendimento/ModeloModal";
import { Aviso, Botao, Modal } from "../ui";
import { EtapaModal } from "./EtapasViagem";
import type { ItemAtividade } from "./AtividadesRel";

const COR_SIT: Record<string, string> = { atrasada: "#DC2626", a_fazer: "#D97706", aguardando: "#64748B" };
const WA = "#25D366";

/** Nome da companhia pelo código IATA (o trecho às vezes traz só "LA", "EK"…). */
const CIAS: Record<string, string> = {
  LA: "LATAM", JJ: "LATAM", G3: "GOL", AD: "Azul", TP: "TAP Air Portugal", EK: "Emirates", QR: "Qatar Airways", AF: "Air France",
  KL: "KLM", IB: "Iberia", UX: "Air Europa", AA: "American Airlines", DL: "Delta", UA: "United", CM: "Copa Airlines", AV: "Avianca",
  AR: "Aerolíneas Argentinas", LH: "Lufthansa", TK: "Turkish Airlines", ET: "Ethiopian", JL: "Japan Airlines", NH: "ANA",
  TG: "Thai Airways", SQ: "Singapore Airlines", CX: "Cathay Pacific", MS: "EgyptAir", BA: "British Airways", AZ: "ITA Airways",
  LX: "Swiss", EY: "Etihad", AM: "Aeroméxico", H2: "Sky Airline", JA: "JetSMART", AC: "Air Canada", SA: "South African", MU: "China Eastern", CA: "Air China",
};
function nomeCia(t: Pick<Trecho, "companhia" | "numero">): string {
  const c = (t.companhia ?? "").trim();
  const cod = (c.length <= 3 ? c : "") || (t.numero ?? "").trim().slice(0, 2);
  return (c.length > 3 ? c : CIAS[cod.toUpperCase()]) || c || "Companhia não informada";
}
const numeroVoo = (t: Trecho) => [t.companhia && t.companhia.length <= 3 ? t.companhia : null, t.numero].filter(Boolean).join(" ") || "sem número";

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
const emDias = (d: number | null) => d === null || d < 0 ? "" : d === 0 ? " (hoje)" : d === 1 ? " (amanhã)" : ` (em ${d} dias)`;
const foneBR = (f: string | null) => {
  const d = (f ?? "").replace(/\D/g, "");
  const n = d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return f ?? "";
};

/** Título (quem) e descrição (o quê / quando) de uma atividade — usado nas linhas da fila. */
function textos(a: Atividade): { quem: string; oQue: string; quando: string; corQuando: string } {
  if (a.tipo === "etapa") {
    const d = diasAte(a.it.v.data_embarque);
    return { quem: a.it.v.cliente_nome || a.it.v.titulo, oQue: `${ETAPA[a.estado.id].nome} · ${a.it.v.destino || a.it.v.titulo} · ida ${diaBR(a.it.v.data_embarque)}${emDias(d)}`, quando: quando(a.estado), corQuando: COR_SIT[a.estado.situacao] ?? "#64748B" };
  }
  if (a.tipo === "etapa_exp") {
    return { quem: a.exp.nome, oQue: `${ETAPA_EXP[a.estado.id].nome} · ${a.exp.pax} passageiro${a.exp.pax === 1 ? "" : "s"} · ida ${diaBR(a.exp.data_embarque)}`, quando: quando(a.estado), corQuando: COR_SIT[a.estado.situacao] ?? "#64748B" };
  }
  if (a.tipo === "checkin") {
    const t = a.trechos[0];
    const pax = a.pax > 1 ? ` · ${a.pax} passageiros` : "";
    const loc = a.pax === 1 && t.localizador ? ` · loc. ${t.localizador}` : "";
    return { quem: a.quem, oQue: `${nomeCia(t)} ${numeroVoo(t)} · ${rota(t)} · voo ${horaVoo(t)}${pax}${loc}`, quando: t.fonte === "bitrix" ? "horário a confirmar" : a.aberto ? "aberto agora" : `abre ${horaLocal(t.checkin_em, null)}`, corQuando: a.aberto ? "#DC2626" : "#B45309" };
  }
  if (a.tipo === "solicitacao") {
    const s = a.sol;
    return { quem: s.sobre_nome || s.titulo, oQue: `${s.tipo_rotulo ? `${s.tipo_rotulo} · ` : ""}${s.titulo} · pedido do ${NOME_SETOR[s.de_setor as keyof typeof NOME_SETOR] ?? s.de_setor}`, quando: s.vencida ? "prazo vencido" : s.prazo ? `prazo ${new Date(s.prazo).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "sem prazo", corQuando: s.vencida ? "#DC2626" : "#7C3AED" };
  }
  const info = infoDoTipo(a.item.tipo);
  return { quem: a.item.quem, oQue: `Emitir ${info.emoji} ${a.item.nome}${a.item.fornecedor ? ` · ${a.item.fornecedor}` : ""}${a.item.data_inicio ? ` · uso em ${dataBR(a.item.data_inicio)}` : ""}${a.item.doCloser ? " · lançado pelo closer" : ""}`, quando: a.estado.texto, corQuando: COR_EMISSAO[a.estado.situacao] };
}

/** Botão de copiar com retorno "copiado". */
function Copiar({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="text-[11.5px] font-bold px-2 py-0.5 rounded-md border" style={{ borderColor: "var(--line)", color: ok ? "#16A34A" : "var(--ink2)", background: "var(--card)" }}
      onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>
      {ok ? "✓ copiado" : rotulo}
    </button>
  );
}

function Campinho({ rotulo, children, destaque = false }: { rotulo: string; children: ReactNode; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>{rotulo}</div>
      <div className={destaque ? "text-[22px] font-extrabold tracking-wider font-mono" : "text-[14px] font-bold"} style={{ color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

async function verArquivo(id: string) {
  const w = window.open("", "_blank");
  try { const url = await abrirDocumentoPorId(id); if (w) w.location.href = url; else window.open(url, "_blank"); }
  catch (e) { w?.close(); alertaSilencioso(e); }
}
function alertaSilencioso(e: unknown) { console.warn("[rotina] arquivo:", e); }

/**
 * O BILHETE do voo: companhia em destaque, rota em códigos grandes, horários,
 * localizador com copiar e os botões de abrir o bilhete e o site de check-in.
 */
function BilheteVoo({ t, cor, estado, outros }: { t: Trecho; cor: string; estado?: string; outros?: Trecho[] }) {
  const cia = nomeCia(t);
  const orig = t.origem_codigo || (t.origem ?? "").slice(0, 3).toUpperCase() || "—";
  const dest = t.destino_codigo || (t.destino ?? "").slice(0, 3).toUpperCase() || "—";
  const semHora = t.fonte === "bitrix";
  const locs = [...new Set((outros ?? [t]).map((x) => x.localizador).filter((x): x is string => !!x))];
  const docs = [...new Set((outros ?? [t]).map((x) => x.documento_id).filter((x): x is string => !!x))];
  const pax = [...new Set((outros ?? [t]).flatMap((x) => x.passageiros ?? []))];
  const linkCheckin = `https://www.google.com/search?q=${encodeURIComponent(`check-in online ${cia}`)}`;
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: `${cor}55`, background: "var(--card)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" style={{ background: cor, color: "#fff" }}>
        <span className="text-[19px] font-extrabold leading-tight">✈ {cia}</span>
        <span className="text-[14px] font-bold opacity-95">Voo {numeroVoo(t)}</span>
        {estado && <span className="ml-auto text-[12px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,.22)" }}>{estado}</span>}
      </div>
      <div className="px-4 py-3 grid gap-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-[34px] leading-none font-extrabold tracking-tight" style={{ color: "var(--ink)" }}>{orig}</div>
            <div className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>{t.origem || " "}</div>
          </div>
          <div className="flex-1 flex items-center gap-1 px-1" aria-hidden>
            <span className="flex-1 border-t-2 border-dashed" style={{ borderColor: `${cor}88` }} />
            <span style={{ color: cor }}>✈</span>
            <span className="flex-1 border-t-2 border-dashed" style={{ borderColor: `${cor}88` }} />
          </div>
          <div className="min-w-0 text-right">
            <div className="text-[34px] leading-none font-extrabold tracking-tight" style={{ color: "var(--ink)" }}>{dest}</div>
            <div className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>{t.destino || " "}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Campinho rotulo="Partida">{diaBR(diaLocal(t.partida_em, t.partida_fuso))} {semHora ? "· a confirmar" : horaLocal(t.partida_em, t.partida_fuso)}</Campinho>
          <Campinho rotulo="Chegada">{t.chegada_em ? `${diaBR(diaLocal(t.chegada_em, t.chegada_fuso ?? null))} ${horaLocal(t.chegada_em, t.chegada_fuso ?? null)}` : "—"}</Campinho>
          <Campinho rotulo="Check-in abre">{t.checkin_em ? `${diaBR(diaLocal(t.checkin_em, null))} ${horaLocal(t.checkin_em, null)}` : "—"}</Campinho>
          {t.terminal_partida ? <Campinho rotulo="Terminal">{t.terminal_partida}</Campinho> : t.classe ? <Campinho rotulo="Classe">{t.classe}</Campinho> : <span />}
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 pt-2 border-t border-dashed" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>Localizador{locs.length > 1 ? `es (${locs.length})` : ""}</div>
            {locs.length === 0 ? <div className="text-[14px] font-bold" style={{ color: "#DC2626" }}>sem localizador no QS</div> : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {locs.slice(0, 12).map((l) => (
                  <span key={l} className="inline-flex items-center gap-1.5">
                    <span className={`${locs.length > 1 ? "text-[17px]" : "text-[26px]"} font-extrabold tracking-[.12em] font-mono`} style={{ color: "var(--ink)" }}>{l}</span>
                    <Copiar texto={l} />
                  </span>
                ))}
                {locs.length > 12 && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>+{locs.length - 12}</span>}
              </div>
            )}
          </div>
          {t.numero_bilhete && <Campinho rotulo="Nº do bilhete">{t.numero_bilhete}</Campinho>}
          {t.assento && <Campinho rotulo="Assento">{t.assento}</Campinho>}
          {t.bagagem && <Campinho rotulo="Bagagem">{t.bagagem}</Campinho>}
          {t.terminal_partida && t.classe && <Campinho rotulo="Classe">{t.classe}</Campinho>}
        </div>
        {pax.length > 0 && (
          <div className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
            <b>Passageiro{pax.length > 1 ? "s" : ""}:</b> {pax.slice(0, 15).join(" · ")}{pax.length > 15 ? ` … +${pax.length - 15}` : ""}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {docs.length > 0
            ? docs.slice(0, 4).map((id, i) => <Botao key={id} variante="primario" onClick={() => void verArquivo(id)}>📄 Abrir bilhete{docs.length > 1 ? ` ${i + 1}` : ""}</Botao>)
            : <span className="text-[12.5px] font-semibold self-center" style={{ color: "#B45309" }}>Bilhete não anexado no QS</span>}
          <a href={linkCheckin} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold border" style={{ borderColor: "var(--line)", color: "var(--ink)", background: "var(--card)" }}>🌐 Site de check-in da {cia}</a>
        </div>
      </div>
    </div>
  );
}

/** Painel do CLIENTE no card: nome, telefone e o botão grande de WhatsApp. */
function PainelCliente({ contato, onWhats, ocupado, extra }: { contato: Contato | null; onWhats: () => void; ocupado: boolean; extra?: ReactNode }) {
  return (
    <aside className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--card2)" }} aria-label="Contato do cliente">
      <div className="text-[10.5px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>Cliente</div>
      {contato ? (
        <>
          <div>
            <div className="text-[16px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>{contato.nome || "Cliente"}</div>
            {contato.telefone && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[14px] font-semibold tabular-nums" style={{ color: "var(--ink2)" }}>{foneBR(contato.telefone)}</span>
                <Copiar texto={contato.telefone.replace(/\D/g, "")} />
              </div>
            )}
          </div>
          <button type="button" disabled={ocupado} onClick={onWhats}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-[14.5px] font-extrabold text-white shadow-sm disabled:opacity-60" style={{ background: WA }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" /></svg>
            {ocupado ? "Abrindo…" : "Chamar no WhatsApp"}
          </button>
        </>
      ) : (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Atividade do grupo: fale com cada passageiro pela expedição ou pelo grupo de WhatsApp.</p>
      )}
      {extra}
    </aside>
  );
}

export default function RotinaRel({ itens, equipe, abrirViagem, abrirExpedicao, abrirConversa, abrirSolicitacao, onMudou }: {
  itens: ItemAtividade[]; equipe: { id: string; name: string }[];
  abrirViagem: (id: string) => void; abrirExpedicao?: (id: string) => void;
  abrirConversa?: (conversaId: string) => void; abrirSolicitacao?: (id: string) => void; onMudou: () => void;
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
  const [modelo, setModelo] = useState<Contato | null>(null);
  const [abrindoWa, setAbrindoWa] = useState(false);

  useEffect(() => {
    let vivo = true;
    carregarExtras().then((d) => { if (vivo) { setExtras(d); setErroExtras(null); } })
      .catch((e) => { if (vivo) { setErroExtras(e instanceof Error ? e.message : "Não carregou expedições/emissões."); setExtras(extrasVazios()); } });
    return () => { vivo = false; };
  }, [versao]);
  const recarregar = () => { setVersao((x) => x + 1); onMudou(); };

  const fila = useMemo(() => montarRotina(itens.map((i): ItemPacote => ({ v: i.v, atual: i.atual, trechos: i.trechos })), extras), [itens, extras]);
  const porGrupo = useMemo(() => {
    const g: Record<GrupoRotina, Atividade[]> = { atrasadas: [], agora: [], hoje: [], proximas: [], futuras: [] };
    for (const a of fila) g[a.grupo].push(a);
    return g;
  }, [fila]);
  // a próxima: a escolhida, senão a primeira que não foi pulada (de atrasadas/agora/hoje)
  const doDia = fila.filter((a) => a.grupo !== "proximas" && a.grupo !== "futuras");
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

  /** WhatsApp do cliente: abre a conversa do Rel no QS (mesmo com a janela fechada — lá tem "Mandar modelo"); sem conversa, abre o modelo. */
  async function chamarNoWhats(c: Contato) {
    if (!abrirConversa) {
      const d = (c.telefone ?? "").replace(/\D/g, "");
      if (d) window.open(`https://wa.me/${d.length <= 11 ? "55" : ""}${d}`, "_blank", "noopener");
      return;
    }
    if (c.conversaId) { abrirConversa(c.conversaId); return; }
    setAbrindoWa(true); setErro(null);
    try {
      const doRel = c.clienteId ? (await conversasDoCliente(c.clienteId).catch(() => [])).filter((x) => x.setor !== "financeiro") : [];
      const cv = doRel.find((x) => x.janela_aberta) ?? doRel[0] ?? (c.telefone ? await conversaPorTelefone(c.telefone).catch(() => null) : null);
      if (cv) abrirConversa(cv.id);
      else if (c.clienteId || c.telefone) setModelo(c);
      else setErro("Esse cliente não tem telefone no cadastro.");
    } finally { setAbrindoWa(false); }
  }

  async function acao(a: Atividade) {
    if (a.tipo === "solicitacao") { abrir(a); return; }
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
    else if (a.tipo === "emissao") { if (a.item.viagem_id) abrirViagem(a.item.viagem_id); }
    else if (a.tipo === "solicitacao") { if (abrirSolicitacao) abrirSolicitacao(a.sol.id); else if (a.sol.viagem_id) abrirViagem(a.sol.viagem_id); }
    else if (a.tipo === "checkin" && a.viagemId) abrirViagem(a.viagemId);
    else { const id = a.tipo === "etapa_exp" ? a.exp.id : a.tipo === "checkin" ? a.expId : null; if (id && abrirExpedicao) abrirExpedicao(id); }
  }
  function checklist(a: Atividade) {
    if (a.tipo === "etapa") { const it = itens.find((i) => i.v.id === a.it.v.id); if (it) setChecklistPac({ ...it, atual: a.estado }); }
    if (a.tipo === "etapa_exp") setChecklistExp({ exp: a.exp, estado: a.estado });
  }
  const rotuloAcao = (a: Atividade) => a.tipo === "checkin" ? (a.pax > 1 ? `✓ Check-in do grupo feito (${a.pax})` : "✓ Check-in feito")
    : a.tipo === "emissao" ? "✓ Marcar emitido"
    : a.tipo === "solicitacao" ? "Abrir solicitação"
    : a.estado.situacao === "aguardando" ? "✓ Adiantar"
    : (a.tipo === "etapa" ? ETAPA[a.estado.id].perguntaAlteracao : ETAPA_EXP[a.estado.id].perguntaAlteracao) ? "✓ Feito, sem alteração" : "✓ Feito";
  const temChecklist = (a: Atividade) => a.tipo === "etapa" || a.tipo === "etapa_exp";
  const podeAbrir = (a: Atividade) => a.tipo === "etapa" || (a.tipo === "emissao" && !!a.item.viagem_id) || (a.tipo === "checkin" && !!a.viagemId)
    || (!!abrirExpedicao && (a.tipo === "etapa_exp" || (a.tipo === "checkin" && !!a.expId)));
  const rotuloAbrir = (a: Atividade) => a.tipo === "etapa_exp" || (a.tipo === "checkin" && !a.viagemId) ? "Abrir expedição" : "Abrir viagem";

  const CONT: { id: GrupoRotina | "feitas"; rotulo: string; n: number; cor: string }[] = [
    { id: "atrasadas", rotulo: "Atrasadas", n: porGrupo.atrasadas.length, cor: "#DC2626" },
    { id: "agora", rotulo: "Agora (check-in aberto)", n: porGrupo.agora.length, cor: "#B45309" },
    { id: "hoje", rotulo: "Para hoje", n: porGrupo.hoje.length, cor: "#D97706" },
    { id: "proximas", rotulo: "Próximos 7 dias", n: porGrupo.proximas.length, cor: "#2563EB" },
    { id: "futuras", rotulo: "Futuras", n: porGrupo.futuras.length, cor: "#64748B" },
    { id: "feitas", rotulo: "Feitas hoje", n: feitasHoje.length, cor: "#16A34A" },
  ];

  /** O miolo do card, por tipo: bilhete do voo, o que emitir, etapa com checklist, solicitação. */
  function miolo(a: Atividade, cor: string): ReactNode {
    if (a.tipo === "checkin") {
      return (
        <div className="grid gap-3">
          {a.trechos.length > 1 && a.pax === 1 && <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>{a.trechos.length} trechos no mesmo check-in.</p>}
          <BilheteVoo t={a.trechos[0]} cor={cor} estado={a.trechos[0].fonte === "bitrix" ? "horário a confirmar" : a.aberto ? "check-in aberto" : `abre ${horaLocal(a.trechos[0].checkin_em, null)}`} outros={a.trechos} />
        </div>
      );
    }
    if (a.tipo === "emissao") {
      const i = a.item; const info = infoDoTipo(i.tipo); const e = a.estado;
      const d = i.dados as Record<string, string | undefined>;
      return (
        <div className="rounded-xl overflow-hidden border" style={{ borderColor: `${cor}55` }}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5" style={{ background: cor, color: "#fff" }}>
            <span className="text-[19px] font-extrabold">{info.emoji} Emitir {info.rotulo.toLowerCase()}</span>
            <span className="ml-auto text-[12px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: "rgba(255,255,255,.22)" }}>{e.texto}</span>
          </div>
          <div className="px-4 py-3 grid gap-3">
            <div className="text-[22px] font-extrabold leading-tight" style={{ color: "var(--ink)" }}>{i.nome}</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Campinho rotulo="Fornecedor / cia">{i.fornecedor || "—"}</Campinho>
              <Campinho rotulo="Uso">{i.data_inicio ? `${dataBR(i.data_inicio)}${i.data_fim && i.data_fim !== i.data_inicio ? ` → ${dataBR(i.data_fim)}` : ""}` : "—"}</Campinho>
              <Campinho rotulo="Pode emitir a partir de">{d.emitir_de ? dataBR(d.emitir_de) : "já"}</Campinho>
              <Campinho rotulo="Emitir até">{d.emitir_ate ? dataBR(d.emitir_ate) : "—"}</Campinho>
            </div>
            {(i.destino || i.valor != null) && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]" style={{ color: "var(--ink2)" }}>
                {i.destino && <span><b>Viagem:</b> {i.destino}</span>}
                {i.valor != null && <span><b>Valor vendido:</b> {i.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>}
              </div>
            )}
            {i.doCloser && <Aviso tom="aviso">Lançado pelo closer na venda — a viagem ainda não foi criada no Relacionamento. Emita na data e, quando a viagem existir, o item vai junto.</Aviso>}
          </div>
        </div>
      );
    }
    if (a.tipo === "solicitacao") {
      const s = a.sol;
      return (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2 text-[12px] font-bold">
            {s.tipo_rotulo && <span className="px-2 py-0.5 rounded" style={{ background: `${cor}1F`, color: cor }}>{s.tipo_rotulo}</span>}
            <span className="px-2 py-0.5 rounded" style={{ background: "var(--card2)", color: "var(--ink2)" }}>Pedido do {NOME_SETOR[s.de_setor as keyof typeof NOME_SETOR] ?? s.de_setor}{s.criado_por_nome ? ` · ${s.criado_por_nome}` : ""}</span>
            {s.prioridade !== "normal" && <span className="px-2 py-0.5 rounded" style={{ background: "#FEE2E2", color: "#B91C1C" }}>{s.prioridade === "urgente" ? "Urgente" : "Alta"}</span>}
            {s.responsavel_nome && <span className="px-2 py-0.5 rounded" style={{ background: "var(--card2)", color: "var(--ink2)" }}>Com {s.responsavel_nome}</span>}
          </div>
          <div className="text-[18px] font-extrabold" style={{ color: "var(--ink)" }}>{s.numero ? `#${s.numero} · ` : ""}{s.titulo}</div>
          {s.descricao && <p className="text-[13.5px] whitespace-pre-wrap line-clamp-4" style={{ color: "var(--ink2)" }}>{s.descricao}</p>}
        </div>
      );
    }
    const def = a.tipo === "etapa" ? ETAPA[a.estado.id] : ETAPA_EXP[a.estado.id];
    const embarque = a.tipo === "etapa" ? a.it.v.data_embarque : a.exp.data_embarque;
    const destino = a.tipo === "etapa" ? a.it.v.destino || a.it.v.titulo : a.exp.nome;
    const proxVoo = a.tipo === "etapa" ? [...a.it.trechos].filter((t) => t.tipo.startsWith("voo") && new Date(t.partida_em).getTime() > Date.now()).sort((x, y) => x.partida_em.localeCompare(y.partida_em))[0] : undefined;
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Campinho rotulo="Destino">{destino}</Campinho>
          <Campinho rotulo="Embarque">{embarque ? `${diaBR(embarque)}${emDias(diasAte(embarque))}` : "—"}</Campinho>
          {a.tipo === "etapa_exp" ? <Campinho rotulo="Passageiros">{a.exp.pax}</Campinho> : <Campinho rotulo="Etapa">{def.nome}</Campinho>}
        </div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {def.checklist.map((c) => <li key={c} className="text-[13px] flex gap-2" style={{ color: "var(--ink2)" }}><span aria-hidden style={{ color: cor }}>☐</span>{c}</li>)}
        </ul>
        {proxVoo && (
          <details>
            <summary className="cursor-pointer text-[12.5px] font-extrabold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Próximo voo: {nomeCia(proxVoo)} {numeroVoo(proxVoo)} · {rota(proxVoo)}{proxVoo.localizador ? ` · loc. ${proxVoo.localizador}` : ""}</summary>
            <div className="mt-2"><BilheteVoo t={proxVoo} cor={cor} /></div>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
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
      {!extras ? <div className="rel-card h-48 animate-pulse" style={{ background: "var(--card2)" }} aria-busy /> : atual ? (() => {
        const t = textos(atual); const r = rotuloDa(atual); const c = contatoDa(atual);
        return (
          <section className="rel-card p-5 flex flex-col gap-4" style={{ borderLeft: `6px solid ${r.cor}` }} aria-label="Próxima atividade">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "var(--ink3)" }}>Próxima atividade</span>
              <span className="text-[12px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: `${r.cor}1F`, color: r.cor }}>{r.o_que}</span>
              <span className="text-[13px] font-bold" style={{ color: t.corQuando }}>{t.quando}</span>
            </div>
            <h2 className="text-[24px] font-extrabold leading-tight -mt-1" style={{ color: "var(--ink)" }}>{t.quem}</h2>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] items-start">
              <div className="min-w-0">{miolo(atual, r.cor)}</div>
              <PainelCliente contato={c} ocupado={abrindoWa} onWhats={() => c && void chamarNoWhats(c)}
                extra={podeAbrir(atual) ? <Botao onClick={() => abrir(atual)}>{rotuloAbrir(atual)}</Botao> : undefined} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1 border-t" style={{ borderColor: "var(--line)" }}>
              <Botao variante="primario" className="!text-[14px] !px-5 !py-2.5" disabled={ocupado === atual.chave} onClick={() => void acao(atual)}>{ocupado === atual.chave ? "…" : rotuloAcao(atual)}</Botao>
              {temChecklist(atual) && <Botao onClick={() => checklist(atual)}>Checklist / registrar alteração</Botao>}
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
                const t = textos(a); const r = rotuloDa(a); const c = contatoDa(a);
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
                      {c && (
                        <button type="button" title={`WhatsApp de ${c.nome || "cliente"}`} aria-label="Chamar no WhatsApp" onClick={() => void chamarNoWhats(c)}
                          className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-white" style={{ background: WA }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.5 12.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3 2.4 1 2.9.8 3.4.7.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z" /></svg>
                        </button>
                      )}
                      {podeAbrir(a) && a.tipo !== "solicitacao" && <Botao variante="fantasma" onClick={() => abrir(a)}>Abrir</Botao>}
                      <Botao variante={g.id === "proximas" || g.id === "futuras" ? "secundario" : "primario"} disabled={ocupado === a.chave} onClick={() => void acao(a)}>{ocupado === a.chave ? "…" : rotuloAcao(a)}</Botao>
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
      <ModeloModal aberto={!!modelo} alvo={modelo?.clienteId ? { clienteId: modelo.clienteId } : { telefone: modelo?.telefone ?? undefined }} nomeCliente={modelo?.nome ?? null}
        onFechar={() => setModelo(null)} onEnviado={(cid) => { setModelo(null); if (cid) abrirConversa?.(cid); }} />
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
