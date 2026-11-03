// src/rel/viagens/RoteiroCartoes.tsx
// -----------------------------------------------------------------------------
// ROTEIRO EM CARTÕES (03/11/2026, desenho "Viagem" do Bruno). "Dia a dia" ou
// "Por tipo", com um cartão por coisa que o passageiro vive:
//   • VOO   — os trechos juntos (ida com a conexão, volta, cada interno): sigla
//             do aeroporto, hora local, nº do voo, duração, LOC, check-in;
//   • HOTEL — check-in, check-out, noites (o QS não tem campo de regime);
//   • PASSEIO / TRANSFER / TREM — selo do voucher: o QS só sabe se o trecho
//             veio de um arquivo anexado (documento_id). "Serve / libera na
//             véspera / só comprovante" não tem dado ainda — não inventamos.
// O que falta (prontidão) vira cartão com a ação ("Cadastrar voo").
// Editar / apagar / check-in feito: as mesmas funções do RoteiroViagem.
// A linha do tempo antiga (noites, dias livres, fora das datas) continua na
// página, recolhida embaixo do roteiro.
//
// 03/11 (Bruno: "tem que ter uma forma de correção humana … revisão manual, e o
// que já aconteceu eles têm que tirar também"):
//   • cada voo tem "Corrigir" (a correção com histórico da 0227, a mesma de
//     "Voos e check-ins"), "Conferi ✓" (0310: quem e quando) e "Tirar" (marca
//     como cancelado/não vale, com motivo — o apagar de verdade continua igual);
//   • o que já aconteceu (voado, chegada/check-out no passado) sai da lista e
//     vai pro bloco recolhido "Já aconteceu (N)"; o tirado vai pro "Tirados (N)".
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { TIPOS_TRECHO, apagarTrecho, marcarCheckin, type Trecho } from "../lib/viagens";
import { diaLocal, horaLocal, mapaDasNoites, type Nivel, type Problema } from "../lib/problemas";
import { codigoDe, type EstadoTrecho, type PapelVoo } from "../lib/statusViagem";
import { duracao, diaHoraCurta, type EstadoPront, type Quadro } from "../lib/prontidao";
import { contarConferidos, jaAconteceu, type Conferencia } from "../lib/conferencia";
import { conferirTrecho, situacaoDoTrecho } from "../lib/correcoes";
import { usePode } from "../equipe/usePode";
import { EditarTrecho } from "./TrechosViagem";
import { titulo as tituloTrecho } from "./RoteiroViagem";
import { CorrigirTrecho, PedirMotivo } from "./VoosDaViagem";

export interface InfoVoo { papel: PapelVoo | null; estado: EstadoTrecho; valido: boolean; motivoFora?: string }

type Kind = "voo" | "hotel" | "passeio" | "outro";
interface Item {
  chave: string;
  dia: string | null;
  quando: number;
  kind: Kind;
  grupo: "aereo" | "hotel" | "passeio" | "transporte" | "outro";
  titulo: string;
  sub: string;
  badge: { texto: string; estado: EstadoPront };
  segs?: Trecho[];
  t?: Trecho;
  /** cartão de "falta" vindo da prontidão */
  falta?: { nota: string; acao: string; kind: "voo" | "hotel" };
}

const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const diaCurto = (d: string | null) => (d ? `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const soDia = (t: Trecho) => t.fonte === "bitrix";
const ehVoo = (t: Trecho) => t.tipo === "voo_internacional" || t.tipo === "voo_interno";
const diaDe = (t: Trecho) => diaLocal(t.partida_em, soDia(t) ? null : t.partida_fuso);
const ordemNivel: Record<Nivel, number> = { alta: 0, media: 1, info: 2 };

const ICONES: Record<Kind, ReactNode> = {
  voo: <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  hotel: <><path d="M2 20V8M2 14h20v6M22 14v-2a3 3 0 0 0-3-3h-8v5" /><circle cx="6.5" cy="11" r="1.5" /></>,
  passeio: <><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z" /><path d="M13 5v2M13 17v2M13 11v2" /></>,
  outro: <><rect x="1" y="6" width="22" height="11" rx="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
};
function IconeKind({ kind }: { kind: Kind }) {
  return (
    <div className={`vf-kind vf-kind--${kind}`} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONES[kind]}</svg>
    </div>
  );
}

const GRUPOS: { id: Item["grupo"]; titulo: string }[] = [
  { id: "aereo", titulo: "Aéreo" }, { id: "hotel", titulo: "Hospedagem" }, { id: "passeio", titulo: "Passeios" },
  { id: "transporte", titulo: "Transfers e trens" }, { id: "outro", titulo: "Outros" },
];

const TITULO_PAPEL: Record<string, string> = { ida: "Voo de ida", volta: "Voo de volta", interno: "Voo interno" };
const grupoPapel = (p: PapelVoo | null) => (p === "ida" || p === "nacional_ida" ? "ida" : p === "volta" || p === "nacional_volta" ? "volta" : p === "interno" ? "interno" : "outro");

/** Junta os trechos de voo válidos em cartões: a ida com a conexão, a volta, cada interno. */
function cartoesDeVoo(voos: Trecho[], info: Map<string, InfoVoo>, conferidos: Map<string, Conferencia>): Item[] {
  const ord = [...voos].sort((a, b) => a.partida_em.localeCompare(b.partida_em));
  const grupos: Trecho[][] = [];
  for (const t of ord) {
    const g = grupos[grupos.length - 1];
    const ult = g?.[g.length - 1];
    const mesmo = ult && grupoPapel(info.get(ult.id)?.papel ?? null) === grupoPapel(info.get(t.id)?.papel ?? null)
      && Date.parse(t.partida_em) - Date.parse(ult.chegada_em ?? ult.partida_em) < 24 * 3600_000;
    if (mesmo) g.push(t); else grupos.push([t]);
  }
  return grupos.map((segs) => {
    const papel = grupoPapel(info.get(segs[0].id)?.papel ?? null);
    const estados = segs.map((s) => info.get(s.id)?.estado ?? "a_voar");
    const cias = [...new Set(segs.map((s) => s.companhia).filter(Boolean))].join(" / ");
    const conexoes = segs.slice(0, -1).map((s) => codigoDe(s.destino_codigo, s.destino) || s.destino).filter(Boolean);
    const sub = [cias, segs.length > 1 ? `${segs.length - 1} conexão${segs.length > 2 ? "ões" : ""}${conexoes.length ? ` em ${conexoes.join(", ")}` : ""}` : "direto"].filter(Boolean).join(" · ");
    let badge: Item["badge"];
    if (estados.every((e) => e === "cancelado")) badge = { texto: "Tirado", estado: "neutro" };
    else if (estados.includes("cancelado")) badge = { texto: "Cancelado", estado: "falta" };
    else if (estados.every((e) => e === "voado")) badge = { texto: "Voado", estado: "neutro" };
    else if (segs.every(soDia)) badge = { texto: "Horário a confirmar", estado: "atencao" };
    else if (segs.some((s) => !s.localizador)) badge = { texto: "Sem localizador", estado: "atencao" };
    else if (estados.includes("checkin_a_fazer")) badge = { texto: "Check-in a fazer", estado: "atencao" };
    // revisão manual: veio da IA/Bitrix, mas só fica verde quando alguém confere
    else if (segs.some((s) => !conferidos.has(s.id))) badge = { texto: "Falta conferir", estado: "atencao" };
    else badge = { texto: "Conferido", estado: "ok" };
    const rota = [codigoDe(segs[0].origem_codigo, segs[0].origem) || segs[0].origem, codigoDe(segs[segs.length - 1].destino_codigo, segs[segs.length - 1].destino) || segs[segs.length - 1].destino].filter(Boolean).join(" → ");
    return {
      chave: `voo-${segs[0].id}`, dia: diaDe(segs[0]), quando: Date.parse(segs[0].partida_em), kind: "voo" as const, grupo: "aereo" as const,
      titulo: TITULO_PAPEL[papel] ?? (rota ? `Voo ${rota}` : "Voo"), sub: papel === "interno" && rota ? `${rota}${sub ? ` · ${sub}` : ""}` : sub, badge, segs,
    };
  });
}

function cartaoDeTrecho(t: Trecho): Item {
  const voucher = !!t.documento_id;
  if (t.tipo === "hospedagem") {
    return {
      chave: `t-${t.id}`, dia: diaDe(t), quando: Date.parse(t.partida_em), kind: "hotel", grupo: "hotel", t,
      titulo: tituloTrecho(t), sub: [t.destino && t.destino !== tituloTrecho(t) ? t.destino : "", t.endereco ?? ""].filter(Boolean).join(" · ") || "Hospedagem",
      badge: voucher ? { texto: "Voucher ok", estado: "ok" } : { texto: "Sem voucher", estado: "atencao" },
    };
  }
  const passeio = t.tipo === "passeio";
  const hora = soDia(t) ? "" : horaLocal(t.partida_em, t.partida_fuso);
  return {
    chave: `t-${t.id}`, dia: diaDe(t), quando: Date.parse(t.partida_em), kind: passeio ? "passeio" : "outro",
    grupo: passeio ? "passeio" : t.tipo === "transfer" || t.tipo === "trem" ? "transporte" : "outro", t,
    titulo: passeio || t.tipo === "outro" ? tituloTrecho(t) : `${TIPOS_TRECHO[t.tipo]} · ${tituloTrecho(t)}`,
    sub: [diaCurto(diaDe(t)), hora].filter(Boolean).join(" · "),
    badge: voucher ? { texto: passeio ? "Pronto" : "Voucher anexado", estado: "ok" } : { texto: "Sem voucher", estado: passeio ? "falta" : "atencao" },
  };
}

// ── peças do cartão ─────────────────────────────────────────────────────────

/** O que o cartão de voo precisa pra correção humana (0227) e a revisão manual (0310). */
export interface Revisao {
  /** pode editar viagens E a 0227 está no banco */
  pode: boolean;
  conferidos: Map<string, Conferencia>;
  pedir: (a: AcaoVoo) => void;
}
type AcaoVoo = { tipo: "corrigir" | "tirar" | "voltar"; t: Trecho };

const quandoCurto = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const nomeCurto = (n: string | null) => (n ?? "").replace(/\s*\|.*$/, "").trim().split(/\s+/)[0] || "alguém";

function Segmento({ t, info, ativa, rev, onEditar, onMudou }: { t: Trecho; info?: InfoVoo; ativa: boolean; rev: Revisao; onEditar: () => void; onMudou: () => void }) {
  const { currentUser } = useQsAuth();
  const [erro, setErro] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const conf = rev.conferidos.get(t.id);
  const tirado = info?.estado === "cancelado";
  async function conferir(sim: boolean) {
    setConferindo(true); setErro(null);
    try { await conferirTrecho(t.id, sim); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); } finally { setConferindo(false); }
  }
  const semHora = soDia(t);
  const de = codigoDe(t.origem_codigo, t.origem) || (t.origem || "???").slice(0, 3).toUpperCase();
  const para = codigoDe(t.destino_codigo, t.destino) || (t.destino || "???").slice(0, 3).toUpperCase();
  const fusoChegada = t.chegada_fuso || t.partida_fuso;
  const partiu = Date.parse(t.partida_em) < Date.now();
  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  return (
    <div id={`trecho-${t.id}`} className="vf-seg">
      <div className="vf-seg__pt">
        <span className="vf-seg__iata" title={t.origem ?? undefined}>{de}</span>
        <b>{semHora ? "--:--" : horaLocal(t.partida_em, t.partida_fuso)}</b>
        <span className="vf-rot">{diaCurto(diaDe(t))}</span>
      </div>
      <div className="vf-seg__meio">
        <span>{[t.companhia, t.numero].filter(Boolean).join(" ") || "nº do voo a definir"}</span>
        <i aria-hidden />
        <span>{semHora ? "horário a confirmar" : duracao(t.partida_em, t.chegada_em) || " "}</span>
      </div>
      <div className="vf-seg__pt vf-seg__pt--fim">
        <span className="vf-seg__iata" title={t.destino ?? undefined}>{para}</span>
        <b>{semHora || !t.chegada_em ? "--:--" : horaLocal(t.chegada_em, fusoChegada)}</b>
        <span className="vf-rot">{t.chegada_em ? diaCurto(diaLocal(t.chegada_em, semHora ? null : fusoChegada)) : ""}</span>
      </div>
      <div className="vf-seg__acoes">
        {info && !info.valido && <span className="vf-pill vf-pill--neutro">não vale: {info.motivoFora}</span>}
        {[t.terminal_partida && `terminal ${t.terminal_partida}`, t.assento && `assento ${t.assento}`, t.classe, t.bagagem && `bagagem ${t.bagagem}`, t.numero_bilhete && `e-ticket ${t.numero_bilhete}`]
          .filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}
        {t.fonte === "ia" && <span>lido pela IA</span>}
        {t.fonte === "expedicoes" && <span>do sistema de Expedições</span>}
        {t.fonte === "bitrix" && <span>do Pós-Venda do Bitrix</span>}
        {t.checkin_em && !partiu && (
          t.checkin_feito_em ? <span className="vf-tx-ok">check-in feito</span>
            : <span>check-in abre {diaHoraCurta(t.checkin_em, null)}</span>
        )}
        {ativa && t.checkin_em && !partiu && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={!!t.checkin_feito_em} onChange={(e) => void acao(() => marcarCheckin(t.id, e.target.checked, currentUser?.id ?? ""))} />
            marcar check-in feito
          </label>
        )}
        {t.status_manual_motivo && <span>motivo: {t.status_manual_motivo}</span>}
        {ativa && !rev.pode && (
          <span className="ml-auto inline-flex gap-2">
            <button type="button" className="vf-link" onClick={onEditar} aria-label={`Editar o voo ${de} → ${para}`}>Editar</button>
            <button type="button" className="vf-link" style={{ color: "var(--danger)" }} aria-label={`Apagar o voo ${de} → ${para}`}
              onClick={() => { if (window.confirm("Apagar este trecho?")) void acao(() => apagarTrecho(t.id)); }}>Apagar</button>
          </span>
        )}
      </div>
      {/* revisão humana: sempre à vista no cartão (quem não pode editar só vê o selo) */}
      <div className="vf-seg__rev">
        {conf
          ? <span className="vf-conf vf-conf--ok">✓ Conferido por {nomeCurto(conf.por)} · {quandoCurto(conf.em)}</span>
          : !tirado && info?.estado !== "voado" ? <span className="vf-conf">Ninguém conferiu este voo ainda</span> : <span />}
        {rev.pode && (
          <span className="vf-seg__botoes">
            {!tirado && (conf
              ? <button type="button" className="vf-link" disabled={conferindo} onClick={() => void conferir(false)} aria-label={`Tirar a conferência do voo ${de} → ${para}`}>desfazer</button>
              : <button type="button" className="vf-btn vf-btn--sm vf-btn--ok" disabled={conferindo} onClick={() => void conferir(true)} aria-label={`Conferi o voo ${de} → ${para}`}>{conferindo ? "Salvando…" : "Conferi ✓"}</button>)}
            <button type="button" className="vf-btn vf-btn--sm" onClick={() => rev.pedir({ tipo: "corrigir", t })} aria-label={`Corrigir o voo ${de} → ${para}`}>Corrigir</button>
            {tirado
              ? <button type="button" className="vf-btn vf-btn--sm" onClick={() => rev.pedir({ tipo: "voltar", t })} aria-label={`Voltar o voo ${de} → ${para} ao roteiro`}>Voltar ao roteiro</button>
              : <button type="button" className="vf-btn vf-btn--sm vf-btn--perigo" onClick={() => rev.pedir({ tipo: "tirar", t })} aria-label={`Tirar o voo ${de} → ${para}`} title="Está errado ou não existe: sai da conta (fica no histórico, dá pra desfazer)">Tirar</button>}
            <button type="button" className="vf-link" style={{ color: "var(--danger)" }} aria-label={`Apagar o voo ${de} → ${para}`}
              onClick={() => { if (window.confirm("Apagar este trecho de vez? Não fica no histórico — pra trecho errado, prefira “Tirar”.")) void acao(() => apagarTrecho(t.id)); }}>Apagar</button>
          </span>
        )}
      </div>
      {erro && <span className="vf-tx-falta text-[12.5px]">{erro}</span>}
    </div>
  );
}

function Detalhes({ t }: { t: Trecho }) {
  const tel = (t.contato ?? "").replace(/\D/g, "");
  const partes: ReactNode[] = [];
  if (t.localizador) partes.push(<span key="l">reserva <b className="vf-mono">{t.localizador}</b></span>);
  if (t.ponto_encontro) partes.push(<span key="p">encontro <b>{t.ponto_encontro}</b></span>);
  if (t.endereco) partes.push(<a key="e" className="underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.endereco)}`} target="_blank" rel="noreferrer">{t.endereco}</a>);
  if (t.contato) partes.push(tel.length >= 8
    ? <span key="c">contato <a className="underline" href={`tel:${tel}`}>{t.contato}</a> · <a className="underline" href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer">WhatsApp</a></span>
    : <span key="c">contato <b>{t.contato}</b></span>);
  if (t.numero_bilhete) partes.push(<span key="b">bilhete <b className="vf-mono">{t.numero_bilhete}</b></span>);
  if (t.passageiros?.length) partes.push(<span key="x">{t.passageiros.join(", ")}</span>);
  if (t.fonte === "ia") partes.push(<span key="f">lido pela IA</span>);
  if (t.fonte === "bitrix") partes.push(<span key="f">do Pós-Venda · horário a confirmar</span>);
  return (
    <>
      {partes.length > 0 && <div className="vf-det">{partes}</div>}
      {t.observacoes && <p className="text-[12.5px] whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{t.observacoes}</p>}
    </>
  );
}

function Cartao({ it, info, problemas, ativa, rev, onEditar, onNovo, onAnexar, onMudou }: {
  it: Item; info: Map<string, InfoVoo>; problemas: Map<string, Problema[]>; ativa: boolean; rev: Revisao;
  onEditar: (t: Trecho) => void; onNovo: () => void; onAnexar: () => void; onMudou: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const ids = it.segs ? it.segs.map((s) => s.id) : it.t ? [it.t.id] : [];
  const ps = ids.flatMap((id) => problemas.get(id) ?? []).filter((p, i, a) => a.findIndex((x) => x.titulo === p.titulo) === i)
    .sort((a, b) => ordemNivel[a.nivel] - ordemNivel[b.nivel]);
  const pior = ps[0]?.nivel;
  const estadoCartao = it.falta ? "falta" : pior === "alta" ? "falta" : pior === "media" || it.badge.estado === "falta" ? "atencao" : null;
  const t = it.t;
  const passou = it.segs ? it.segs.every((s) => info.get(s.id)?.estado === "voado") : t ? Date.parse(t.chegada_em ?? t.partida_em) < Date.now() - 86_400_000 : false;
  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }
  const semVoucher = t && !t.documento_id && t.tipo !== "hospedagem";
  return (
    <article id={t ? `trecho-${t.id}` : undefined} className={`vf-item${estadoCartao ? ` vf-item--${estadoCartao}` : ""}${passou ? " vf-item--passado" : ""}`}>
      <div className="vf-item__top">
        <div className="vf-item__id">
          <IconeKind kind={it.falta ? (it.falta.kind === "voo" ? "voo" : "hotel") : it.kind} />
          <div>
            <b>{it.titulo}</b>
            <span className="vf-sub">{it.sub}</span>
          </div>
        </div>
        <span className={`vf-pill vf-pill--${it.badge.estado}`}>{it.badge.texto}</span>
      </div>

      {it.segs && (
        <div className="flex flex-col gap-2">
          {it.segs.map((s) => <Segmento key={s.id} t={s} info={info.get(s.id)} ativa={ativa} rev={rev} onEditar={() => onEditar(s)} onMudou={onMudou} />)}
          {[...new Set(it.segs.map((s) => s.localizador).filter(Boolean))].length > 0 && (
            <div className="flex flex-wrap gap-2 items-center text-[13px]">
              {[...new Set(it.segs.map((s) => s.localizador).filter(Boolean))].map((l) => (
                <span key={l} className="vf-loc"><span>LOC</span><span>{l}</span></span>
              ))}
            </div>
          )}
        </div>
      )}

      {it.falta && (
        <>
          <p className="vf-sub">{it.falta.nota}</p>
          {ativa && <div className="vf-item__acoes"><button type="button" className="vf-btn vf-btn--sm" onClick={onNovo}>{it.falta.acao}</button></div>}
        </>
      )}

      {t && t.tipo === "hospedagem" && (
        <div className="vf-rows">
          <div><span className="vf-rot">Check-in</span><b>{soDia(t) ? diaCurto(diaDe(t)) : `${diaCurto(diaDe(t))} · ${horaLocal(t.partida_em, t.partida_fuso)}`}</b></div>
          <div><span className="vf-rot">Check-out</span><b>{t.chegada_em ? `${diaCurto(diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso))}${soDia(t) ? "" : ` · ${horaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso)}`}` : "não anotado"}</b></div>
          <div><span className="vf-rot">Noites</span><b>{t.chegada_em ? Math.max(0, diasEntre(diaDe(t)!, diaLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso)!)) : "—"}</b></div>
        </div>
      )}

      {t && t.tipo !== "hospedagem" && (
        <div className={`vf-voucher vf-voucher--${t.documento_id ? "ok" : t.tipo === "passeio" ? "falta" : "atencao"}`}>
          <b>{t.documento_id ? "Voucher anexado" : "Sem voucher anexado"}</b>
          <span>{t.documento_id
            ? "Este trecho veio de um arquivo anexado à viagem. Se ele serve como entrada ou só libera na véspera, o QS ainda não registra."
            : t.tipo === "passeio" ? "Sem o ingresso em mãos, o passageiro pode não entrar." : "Nenhum arquivo ligado a este trecho."}</span>
        </div>
      )}

      {t && <Detalhes t={t} />}

      {ps.map((p, k) => <p key={k} className={`vf-prob vf-prob--${p.nivel}`}><span aria-hidden>{p.nivel === "alta" ? "⚠" : "•"}</span>{p.titulo}</p>)}

      {t && ativa && (
        <div className="vf-item__acoes">
          {semVoucher && <button type="button" className="vf-btn vf-btn--sm" onClick={onAnexar}>Anexar voucher</button>}
          <button type="button" className="vf-btn vf-btn--sm" onClick={() => onEditar(t)}>Editar</button>
          <button type="button" className="vf-btn vf-btn--sm" style={{ color: "var(--danger)" }}
            onClick={() => { if (window.confirm("Apagar este trecho?")) void acao(() => apagarTrecho(t.id)); }}>Apagar</button>
        </div>
      )}
      {erro && <p className="vf-tx-falta text-[12.5px]">{erro}</p>}
    </article>
  );
}

// ── o roteiro ───────────────────────────────────────────────────────────────

export default function RoteiroCartoes({ viagemId, trechos, problemas, voos, quadros, dataIda, dataVolta, ativa, modo, onMudou, onAnexar,
  conferidos = SEM_CONFERENCIA, correcao = false }: {
  viagemId: string; trechos: Trecho[] | null; problemas: Problema[]; voos: Map<string, InfoVoo>; quadros: Quadro[];
  dataIda: string | null; dataVolta: string | null; ativa: boolean; modo: "dia" | "tipo"; onMudou: () => void; onAnexar: () => void;
  /** 0310: quem conferiu cada voo (conferidosDoHistorico) */
  conferidos?: Map<string, Conferencia>;
  /** a 0227 está no banco (correcaoDisponivel) */
  correcao?: boolean;
}) {
  const [editando, setEditando] = useState<Trecho | null | undefined>(undefined);
  const [acaoVoo, setAcaoVoo] = useState<AcaoVoo | null>(null);
  const podeEditar = usePode("relacionamento.editar_viagens") === true;
  const rev: Revisao = useMemo(() => ({ pode: podeEditar && correcao && ativa, conferidos, pedir: setAcaoVoo }), [podeEditar, correcao, ativa, conferidos]);

  const { itens, aconteceu, tirados, foraDeData, contagem } = useMemo(() => {
    const lista = trechos ?? [];
    const agora = Date.now();
    const passou = (t: Trecho) => jaAconteceu(t, agora, voos.get(t.id)?.estado);
    // voos: só os que valem (resumirVoos); os que não valem ficam na linha do tempo/Voos e check-ins
    const voosValidos = lista.filter((t) => ehVoo(t) && (voos.get(t.id)?.valido ?? true));
    const foraDeData = lista.filter((t) => ehVoo(t) && voos.get(t.id) && !voos.get(t.id)!.valido).length;
    // "Tirar" = cancelado à mão (ou pelo automático): sai do roteiro, vai pro bloco "Tirados"
    const cancelado = (t: Trecho) => voos.get(t.id)?.estado === "cancelado";
    const vivos = voosValidos.filter((t) => !cancelado(t));
    const tirados = cartoesDeVoo(voosValidos.filter(cancelado), voos, conferidos).sort((a, b) => a.quando - b.quando);
    const todos: Item[] = [...cartoesDeVoo(vivos, voos, conferidos), ...lista.filter((t) => !ehVoo(t)).map(cartaoDeTrecho)];
    // o que já aconteceu sai da lista principal (bloco recolhido no fim)
    const itemPassou = (it: Item) => (it.segs ? it.segs.every(passou) : it.t ? passou(it.t) : false);
    const aconteceu = todos.filter(itemPassou).sort((a, b) => a.quando - b.quando);
    const out = todos.filter((it) => !itemPassou(it));
    const contagem = contarConferidos(vivos.map((t) => ({ id: t.id, valido: true, passou: passou(t), conferido: conferidos.has(t.id) })));
    // o que a prontidão diz que FALTA vira cartão com a ação
    const q = (c: string) => quadros.find((x) => x.chave === c);
    if (q("ida")?.estado === "falta") out.push({ chave: "falta-ida", dia: dataIda, quando: dataIda ? Date.parse(`${dataIda}T00:00:00Z`) : 0, kind: "voo", grupo: "aereo", titulo: "Voo de ida", sub: "Não cadastrado", badge: { texto: "Sem voo", estado: "falta" }, falta: { nota: "Nenhum voo de ida cadastrado. Anexe o bilhete (a IA lê) ou cadastre à mão.", acao: "Cadastrar voo", kind: "voo" } });
    if (q("volta")?.estado === "falta") out.push({ chave: "falta-volta", dia: dataVolta, quando: dataVolta ? Date.parse(`${dataVolta}T23:00:00Z`) : Number.MAX_SAFE_INTEGER, kind: "voo", grupo: "aereo", titulo: "Voo de volta", sub: "Não cadastrado", badge: { texto: "Sem voo", estado: "falta" }, falta: { nota: "Nenhum voo de volta cadastrado. Anexe o bilhete ou cadastre à mão.", acao: "Cadastrar voo", kind: "voo" } });
    if (q("hospedagem")?.estado === "falta") out.push({ chave: "falta-hotel", dia: dataIda, quando: dataIda ? Date.parse(`${dataIda}T01:00:00Z`) : 1, kind: "hotel", grupo: "hotel", titulo: "Hospedagem", sub: "Não cadastrada", badge: { texto: "Sem hotel", estado: "falta" }, falta: { nota: "Nenhum hotel no roteiro. Anexe o voucher ou cadastre à mão.", acao: "Cadastrar hotel", kind: "hotel" } });
    return { itens: out.sort((a, b) => a.quando - b.quando), aconteceu, tirados, foraDeData, contagem };
  }, [trechos, voos, quadros, dataIda, dataVolta, conferidos]);

  const porTrecho = useMemo(() => {
    const m = new Map<string, Problema[]>();
    for (const p of problemas) for (const id of p.trechos) m.set(id, [...(m.get(id) ?? []), p]);
    return m;
  }, [problemas]);
  const noites = useMemo(() => mapaDasNoites((trechos ?? []).filter((t) => !ehVoo(t) || (voos.get(t.id)?.valido ?? true))), [trechos, voos]);

  const secoes = useMemo(() => {
    if (modo === "tipo") {
      return GRUPOS.map((g) => {
        const its = itens.filter((i) => i.grupo === g.id);
        const pend = its.filter((i) => i.badge.estado === "falta" || i.badge.estado === "atencao").length;
        return { chave: g.id, titulo: g.titulo, sub: pend ? `${pend} pendente${pend > 1 ? "s" : ""}` : "tudo pronto", itens: its, noite: null as ReactNode };
      }).filter((s) => s.itens.length);
    }
    // noite sem hotel que já passou não é mais pendência
    const hoje = diaLocal(new Date().toISOString(), "-03:00") ?? "";
    const dias = [...new Set([...itens.map((i) => i.dia).filter(Boolean) as string[], ...[...noites.semHotel].filter((d) => d >= hoje)])].sort();
    const primeiro = [dataIda, dias[0]].filter(Boolean).sort()[0] as string | undefined;
    const semDia = itens.filter((i) => !i.dia);
    const s = dias.map((d) => {
      const hotel = noites.hotelDaNoite.get(d);
      const noite: ReactNode = hotel
        ? <p className="vf-noite"><span aria-hidden>🌙</span> Noite: <b>{tituloTrecho(hotel)}</b></p>
        : noites.semHotel.has(d) && d >= hoje ? <p className="vf-noite vf-noite--falta"><span aria-hidden>🌙</span> Sem hospedagem nesta noite</p> : null;
      return { chave: d, titulo: diaCurto(d), sub: primeiro ? `Dia ${diasEntre(primeiro, d) + 1}` : "", itens: itens.filter((i) => i.dia === d), noite };
    });
    if (semDia.length) s.push({ chave: "sem-dia", titulo: "Sem data", sub: "", itens: semDia, noite: null });
    return s;
  }, [modo, itens, noites, dataIda]);

  if (trechos === null) return <div className="h-40 rounded-xl animate-pulse" style={{ background: "var(--surface-2)" }} />;

  const cartao = (it: Item) => (
    <Cartao key={it.chave} it={it} info={voos} problemas={porTrecho} ativa={ativa} rev={rev}
      onEditar={setEditando} onNovo={() => setEditando(null)} onAnexar={onAnexar} onMudou={onMudou} />
  );
  const fecharAcao = () => setAcaoVoo(null);
  const rotaDe = (t: Trecho) => `${codigoDe(t.origem_codigo, t.origem) || t.origem || "?"} → ${codigoDe(t.destino_codigo, t.destino) || t.destino || "?"}`;

  return (
    <div className="vf-secoes">
      {contagem.total > 0 && (
        <div className={`vf-contagem vf-contagem--${contagem.conferidos === contagem.total ? "ok" : "atencao"}`} role="status">
          <b>{contagem.conferidos} de {contagem.total} voo{contagem.total > 1 ? "s" : ""} conferido{contagem.total > 1 ? "s" : ""}</b>
          <span>{contagem.conferidos === contagem.total
            ? "Todos revisados por alguém do time."
            : rev.pode ? "Confira cada voo com o bilhete e clique em “Conferi ✓”. Errado? “Corrigir”. Não existe? “Tirar”."
            : "Voo trazido pela IA ou pelo Bitrix só fica pronto depois que alguém do time confere."}</span>
        </div>
      )}
      {!itens.length && !aconteceu.length && (
        <p className="vf-sub">Nenhum trecho ainda. Anexe bilhetes e vouchers e rode a revisão da IA, ou cadastre à mão em “+ Trecho”.</p>
      )}
      {secoes.map((s) => (
        <section key={s.chave} className="vf-secao" aria-label={s.titulo}>
          <div className="vf-secao__t"><b>{s.titulo}</b>{s.sub && <span className="vf-sub">{s.sub}</span>}</div>
          {s.itens.map(cartao)}
          {s.noite}
        </section>
      ))}
      {foraDeData > 0 && (
        <p className="vf-rot">{foraDeData} voo{foraDeData > 1 ? "s" : ""} fora das datas, genérico{foraDeData > 1 ? "s" : ""} do Bitrix ou repetido{foraDeData > 1 ? "s" : ""} não {foraDeData > 1 ? "entram" : "entra"} aqui — veja em “Voos e check-ins” e na linha do tempo completa.</p>
      )}
      {aconteceu.length > 0 && (
        <details className="vf-bloco">
          <summary>Já aconteceu ({aconteceu.length}) <span className="vf-sub">voado, chegada ou check-out no passado — não conta como pendência</span></summary>
          <div className="vf-secao">{aconteceu.map(cartao)}</div>
        </details>
      )}
      {tirados.length > 0 && (
        <details className="vf-bloco">
          <summary>Tirados do roteiro ({tirados.length}) <span className="vf-sub">marcados como cancelado / não vale — dá pra voltar</span></summary>
          <div className="vf-secao">{tirados.map(cartao)}</div>
        </details>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {ativa ? <button type="button" className="vf-link" onClick={() => setEditando(null)}>+ Trecho</button> : <span />}
        <span className="vf-rot">Horários na hora local de cada lugar (quando o fuso é conhecido); sem fuso, Brasília.</span>
      </div>
      <EditarTrecho aberto={editando !== undefined} viagemId={viagemId} trecho={editando ?? null}
        onFechar={() => setEditando(undefined)} onSalvo={() => { setEditando(undefined); onMudou(); }} />
      {/* a correção humana: os mesmos modais e funções de "Voos e check-ins" (0227), tudo no histórico com Desfazer */}
      {acaoVoo?.tipo === "corrigir" && <CorrigirTrecho t={acaoVoo.t} onFechar={fecharAcao} onSalvo={onMudou} />}
      {acaoVoo?.tipo === "tirar" && (
        <PedirMotivo titulo="Tirar este trecho" onFechar={fecharAcao}
          explicacao={`${rotaDe(acaoVoo.t)} sai do roteiro e da conta (não é próximo voo, não pede check-in nem conferência). Fica no histórico e dá pra voltar. Apagar de vez continua no “Apagar”.`}
          onConfirmar={async (m) => { await situacaoDoTrecho(acaoVoo.t.id, "cancelado", m); onMudou(); }} />
      )}
      {acaoVoo?.tipo === "voltar" && (
        <PedirMotivo titulo="Voltar ao roteiro" exigir={false} onFechar={fecharAcao}
          explicacao={`${rotaDe(acaoVoo.t)} volta a contar: a situação é calculada de novo pelo horário.`}
          onConfirmar={async (m) => { await situacaoDoTrecho(acaoVoo.t.id, null, m); onMudou(); }} />
      )}
    </div>
  );
}

const SEM_CONFERENCIA = new Map<string, Conferencia>();
