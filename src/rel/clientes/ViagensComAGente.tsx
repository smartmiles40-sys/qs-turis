// src/rel/clientes/ViagensComAGente.tsx
// -----------------------------------------------------------------------------
// "Viagens com a gente" na ficha = o PASSAPORTE DO CLIENTE.
//
//   1. Capa: nome, categoria, viagens feitas e por vir, destinos, "cliente
//      desde" e a contagem regressiva da próxima viagem.
//   2. Por onde já andou: mini mapa-múndi (MapaMundi, só importado) + os
//      destinos como etiquetas — cheia = já visitou, tracejada = vai.
//   3. Carimbos por ano (o mais recente/futuro em cima): cada viagem é um
//      cartão com selo de entrada na FORMA do tipo (Expedição = círculo,
//      Pacote = losango), situação, titular/acompanhante, valor, voos,
//      documentos e o selo da revisão da IA. Clique abre a viagem.
//
// Dados: as viagens vêm de todasDoCliente (titular OU acompanhante — mesma
// regra de sempre); os enfeites de cada carimbo vêm depois, em paralelo
// (extrasDasViagens), e nunca travam a lista.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { grupoTipo, hojeSP, type Viagem } from "../lib/viagens";
import { carregarRegras, metricaDoCliente, type Metrica } from "../lib/clientes";
import { Aviso } from "../ui";
import MapaMundi, { MarcaTipo, type PontoMapa } from "../viagens/MapaMundi";
import { categoriasDe, type Cat } from "./KpisClientes";
import CarimboViagem from "./CarimboViagem";
import { diaMesAno, diasEntre, mesAno, nomeDestino, situacao, zonaDeLeitura } from "./passaporte";
import { extrasDasViagens, todasDoCliente, type Extras } from "./viagensCliente";

// Tokens de movimento (playbook): entrada out-expo 420ms com stagger de 45ms
// (teto de 8 itens), hover out-quart 180ms, "carimbada" out-expo 450ms.
const PP_CSS = `
.pp { --pp-exp: #0B6B5C; --pp-pac: #8F5B0A; }
html.dark .pp { --pp-exp: #3CCFB3; --pp-pac: #F5B942; }

.pp-capa {
  position: relative; overflow: hidden; color: #EAF6F2;
  background: radial-gradient(120% 140% at 100% 0%, #13574C 0%, #0B3B34 55%, #082C27 100%);
}
.pp-capa::before {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .55;
  background:
    repeating-radial-gradient(circle at 108% -12%, rgba(255,255,255,.07) 0 1px, transparent 1px 10px),
    repeating-radial-gradient(circle at -8% 118%, rgba(255,255,255,.05) 0 1px, transparent 1px 12px);
}
.pp-rotulo { color: rgba(234,246,242,.74); }
.pp-mrz { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; letter-spacing: .14em; color: rgba(234,246,242,.42); white-space: nowrap; overflow: hidden; }

@keyframes pp-entra { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes pp-carimba {
  0% { opacity: 0; transform: rotate(calc(var(--rot, 0deg) - 8deg)) scale(1.28); }
  55% { opacity: 1; }
  100% { opacity: .94; transform: rotate(var(--rot, 0deg)) scale(1); }
}
.pp-entra { animation: pp-entra .42s cubic-bezier(.16,1,.3,1) both; animation-delay: calc(min(var(--i, 0), 8) * 45ms); }
.pp-entra .pp-batido { animation: pp-carimba .45s cubic-bezier(.16,1,.3,1) both; animation-delay: calc(min(var(--i, 0), 8) * 45ms + 160ms); }

.pp-carimbo { transition: transform .18s cubic-bezier(.25,1,.5,1), box-shadow .18s cubic-bezier(.25,1,.5,1), border-color .18s cubic-bezier(.25,1,.5,1); }
.pp-carimbo:hover { transform: translateY(-2px); border-color: var(--rel-ink); box-shadow: 0 10px 24px -14px rgba(8,44,39,.45); }
.pp-carimbo:active { transform: scale(.985); transition-duration: .1s; }
.pp-cancelada .pp-selo { opacity: .55; }

.pp-selo { position: relative; flex: none; width: 68px; height: 68px; display: grid; place-items: center; transform: rotate(var(--rot, 0deg)); }
.pp-batido { opacity: .94; }
.pp-vazado { opacity: .8; }
.pp-selo-forma { position: absolute; border: 2px solid currentColor; }
.pp-vazado .pp-selo-forma { border-style: dashed; }
.pp-selo-forma.pp-expedicao { inset: 2px; border-radius: 50%; }
.pp-selo-forma.pp-pacote { width: 46px; height: 46px; left: 11px; top: 11px; border-radius: 5px; transform: rotate(45deg); }
.pp-selo-anel { position: absolute; inset: 7px; border-radius: 50%; border: 1px solid currentColor; opacity: .45; }
.pp-selo-txt { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.pp-selo-risco { position: absolute; left: 6px; right: 6px; top: 50%; height: 2px; background: currentColor; transform: rotate(-32deg); }

.pp-trilho { position: relative; padding-left: 26px; }
.pp-trilho::before { content: ""; position: absolute; left: 8px; top: 6px; bottom: 6px; border-left: 2px dotted var(--line); }
.pp-no { position: absolute; left: -26px; top: 38px; width: 18px; height: 18px; display: grid; place-items: center; background: var(--card); border-radius: 50%; }

.pp-ano-passado { color: transparent; -webkit-text-stroke: 1.2px var(--ink2); }

@media (prefers-reduced-motion: reduce) {
  .pp-entra, .pp-entra .pp-batido { animation: none; }
  .pp-carimbo:hover, .pp-carimbo:active { transform: none; }
}
`;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

interface Destino { chave: string; nome: string; tipo: "expedicao" | "pacote"; visitadoEm: string | null; vaiEm: string | null; noMapa: boolean }

function resumir(lista: Viagem[]) {
  const ativas = lista.filter((v) => situacao(v) !== "cancelada");
  const realizadas = ativas.filter((v) => situacao(v) === "realizada").length;
  const futuras = ativas.filter((v) => { const s = situacao(v); return s === "proxima" || s === "em_viagem"; }).length;

  const destinos = new Map<string, Destino>();
  const pontos = new Map<string, PontoMapa>();
  for (const v of ativas) {
    const s = situacao(v);
    const g = grupoTipo(v.tipo);
    const { principal, lugares } = nomeDestino(v);
    const itens = lugares.length ? lugares.map((l) => ({ chave: l.id, nome: l.nome, lugar: l })) : [{ chave: principal.toLowerCase(), nome: principal, lugar: null }];
    for (const it of itens) {
      const d = destinos.get(it.chave) ?? { chave: it.chave, nome: it.nome, tipo: g, visitadoEm: null, vaiEm: null, noMapa: !!it.lugar };
      if ((s === "realizada" || s === "em_viagem") && v.data_embarque && (!d.visitadoEm || v.data_embarque > d.visitadoEm)) { d.visitadoEm = v.data_embarque; d.tipo = g; }
      if (s === "proxima" && v.data_embarque && (!d.vaiEm || v.data_embarque < d.vaiEm)) { d.vaiEm = v.data_embarque; if (!d.visitadoEm) d.tipo = g; }
      destinos.set(it.chave, d);
      if (it.lugar) {
        const k = `${it.lugar.id}-${g}`;
        const p = pontos.get(k) ?? { lugar: it.lugar, tipo: g, passageiros: 1, viagens: 0, proximoEmbarque: null };
        p.viagens++;
        if (s === "proxima" && v.data_embarque && (!p.proximoEmbarque || v.data_embarque < p.proximoEmbarque)) p.proximoEmbarque = v.data_embarque;
        pontos.set(k, p);
      }
    }
  }

  const datasCompra = ativas.map((v) => v.data_venda || v.data_embarque).filter((d): d is string => !!d).sort();
  const emViagem = ativas.find((v) => situacao(v) === "em_viagem") ?? null;
  const proxima = ativas
    .filter((v) => situacao(v) === "proxima" && v.dias_para_embarque != null)
    .sort((a, b) => (a.dias_para_embarque ?? 0) - (b.dias_para_embarque ?? 0))[0] ?? null;

  const ordem = [...destinos.values()].sort((a, b) => {
    if (a.vaiEm && !b.vaiEm) return -1;
    if (!a.vaiEm && b.vaiEm) return 1;
    if (a.vaiEm && b.vaiEm) return a.vaiEm.localeCompare(b.vaiEm);
    return (b.visitadoEm ?? "").localeCompare(a.visitadoEm ?? "");
  });

  return {
    realizadas, futuras, destinos: ordem, pontos: [...pontos.values()],
    desde: datasCompra[0] ?? null, emViagem, proxima,
  };
}

/** Anos com as viagens: sem data em cima, depois do mais novo pro mais velho. */
function porAno(lista: Viagem[]): { ano: string; viagens: Viagem[] }[] {
  const grupos = new Map<string, Viagem[]>();
  for (const v of lista) {
    const ano = v.data_embarque?.slice(0, 4) ?? "Sem data";
    grupos.set(ano, [...(grupos.get(ano) ?? []), v]);
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => (a === "Sem data" ? -1 : b === "Sem data" ? 1 : b.localeCompare(a)))
    .map(([ano, vs]) => ({ ano, viagens: vs.sort((x, y) => (y.data_embarque ?? "").localeCompare(x.data_embarque ?? "")) }));
}

// ── Capa ────────────────────────────────────────────────────────────────────

function Numero({ valor, rotulo }: { valor: string | number; rotulo: string }) {
  return (
    <div className="min-w-0 flex flex-col-reverse">
      <dt className="pp-rotulo text-[11px] font-semibold uppercase tracking-[.12em] mt-1.5">{rotulo}</dt>
      <dd className="text-[24px] sm:text-[26px] font-extrabold leading-none tabular-nums tracking-tight">{valor}</dd>
    </div>
  );
}

function Capa({ nome, cat, r }: { nome: string; cat: Cat | null; r: ReturnType<typeof resumir> }) {
  const [l1, l2] = zonaDeLeitura(nome, r.realizadas, r.futuras, r.destinos.length);
  const hoje = hojeSP();
  const foco = r.emViagem ?? r.proxima;
  const destinoFoco = foco ? nomeDestino(foco).principal : null;

  return (
    <div className="pp-capa px-4 sm:px-6 pt-5 pb-3">
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="pp-rotulo text-[11px] font-bold uppercase tracking-[.2em]">Passaporte de viagens · Se Tu For, Eu Vou</p>
          {cat && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-[.12em]"
              style={{ background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.22)" }}>
              <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: cat.cor, boxShadow: "0 0 0 1.5px rgba(255,255,255,.55)" }} />
              {cat.nome}
            </span>
          )}
        </div>
        <h3 className="text-[22px] sm:text-[26px] font-extrabold leading-tight tracking-tight mt-2">{nome}</h3>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-5 md:gap-8 mt-5 items-end">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
            <Numero valor={r.realizadas} rotulo={r.realizadas === 1 ? "realizada" : "realizadas"} />
            <Numero valor={r.futuras} rotulo="por vir" />
            <Numero valor={r.destinos.length} rotulo={r.destinos.length === 1 ? "destino" : "destinos"} />
            <Numero valor={r.desde ? mesAno(r.desde) : "—"} rotulo="cliente desde" />
          </dl>

          <div className="rounded-xl px-4 py-3 md:min-w-[220px]" style={{ background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.16)" }}>
            {r.emViagem ? (
              <>
                <p className="pp-rotulo text-[11px] font-bold uppercase tracking-[.14em]">Em viagem agora</p>
                <p className="text-[17px] font-extrabold leading-tight mt-1">{destinoFoco}</p>
                {r.emViagem.data_retorno && (
                  <p className="pp-rotulo text-[12px] mt-0.5">
                    {(() => { const n = diasEntre(hoje, r.emViagem.data_retorno); return n <= 0 ? "volta hoje" : `volta em ${plural(n, "dia", "dias")} · ${diaMesAno(r.emViagem.data_retorno)}`; })()}
                  </p>
                )}
              </>
            ) : r.proxima && r.proxima.dias_para_embarque != null ? (
              <>
                <p className="pp-rotulo text-[11px] font-bold uppercase tracking-[.14em]">Próximo embarque</p>
                <p className="flex items-baseline gap-1.5 mt-1">
                  {r.proxima.dias_para_embarque === 0 ? (
                    <span className="text-[30px] font-extrabold leading-none">hoje</span>
                  ) : (
                    <>
                      <span className="text-[38px] font-extrabold leading-none tabular-nums tracking-tight">{r.proxima.dias_para_embarque}</span>
                      <span className="text-[13px] font-semibold">{r.proxima.dias_para_embarque === 1 ? "dia" : "dias"}</span>
                    </>
                  )}
                </p>
                <p className="text-[13px] font-semibold mt-1 leading-snug">{destinoFoco}</p>
                {r.proxima.data_embarque && <p className="pp-rotulo text-[12px]">{diaMesAno(r.proxima.data_embarque)}</p>}
              </>
            ) : (
              <>
                <p className="pp-rotulo text-[11px] font-bold uppercase tracking-[.14em]">Próximo embarque</p>
                <p className="text-[15px] font-bold mt-1">Nenhum marcado</p>
                <p className="pp-rotulo text-[12px] leading-snug">Boa hora pra sugerir a próxima.</p>
              </>
            )}
          </div>
        </div>

        <div aria-hidden className="pp-mrz text-[10px] sm:text-[11px] leading-[1.5] mt-5">
          <div>{l1}</div>
          <div>{l2}</div>
        </div>
      </div>
    </div>
  );
}

// ── Estados ─────────────────────────────────────────────────────────────────

function Esqueleto() {
  const bloco = (cls: string, extra?: CSSProperties) => <span className={`block rounded animate-pulse ${cls}`} style={{ background: "var(--card2)", ...extra }} />;
  return (
    <div aria-busy="true" aria-label="Carregando as viagens">
      <div className="pp-capa px-4 sm:px-6 pt-5 pb-5">
        <div className="relative space-y-3">
          {bloco("h-3 w-56", { background: "rgba(255,255,255,.12)" })}
          {bloco("h-6 w-2/5", { background: "rgba(255,255,255,.16)" })}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3">
            {[0, 1, 2, 3].map((i) => <span key={i}>{bloco("h-7 w-12", { background: "rgba(255,255,255,.14)" })}{bloco("h-2.5 w-16 mt-2", { background: "rgba(255,255,255,.1)" })}</span>)}
          </div>
        </div>
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rel-card p-4 flex gap-4">
            <span className="w-[68px] h-[68px] rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--card2)" }} />
            <span className="flex-1 space-y-2 pt-1">{bloco("h-5 w-1/3")}{bloco("h-3 w-2/3")}{bloco("h-3 w-1/2")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PassaporteEmBranco() {
  return (
    <div className="pp-capa px-5 sm:px-6 py-8 text-center">
      <div className="relative flex flex-col items-center">
        <span aria-hidden className="pp-selo pp-vazado mb-3" style={{ color: "rgba(234,246,242,.55)" }}>
          <span className="pp-selo-forma pp-expedicao" />
          <span className="pp-selo-txt"><span className="text-[9px] font-bold tracking-[.16em]">AINDA</span><span className="text-[9px] font-bold tracking-[.16em]">SEM</span><span className="text-[9px] font-bold tracking-[.16em]">CARIMBO</span></span>
        </span>
        <p className="text-[16px] font-extrabold">Passaporte em branco</p>
        <p className="pp-rotulo text-[13px] mt-1 max-w-sm leading-snug">
          Nenhuma viagem ainda. As vendas do Bitrix ("Em emissão" e "Venda realizada") viram viagem sozinhas — e o primeiro carimbo aparece aqui.
        </p>
      </div>
    </div>
  );
}

// ── Componente ──────────────────────────────────────────────────────────────

export default function ViagensComAGente({ clienteId, onAbrirViagem, metrica, cats }: {
  clienteId: string;
  onAbrirViagem: (id: string) => void;
  /** Se a ficha já carregou, manda; se não vier (undefined), o passaporte busca sozinho. */
  metrica?: Metrica | null;
  cats?: Cat[];
}) {
  const [lista, setLista] = useState<Viagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [metricaPropria, setMetricaPropria] = useState<Metrica | null>(null);
  const [catsProprias, setCatsProprias] = useState<Cat[] | null>(null);

  useEffect(() => {
    let atual = true;
    setLista(null);
    setErro(null);
    setExtras(null);
    todasDoCliente(clienteId)
      .then((l) => {
        if (!atual) return;
        setLista(l);
        // os enfeites dos carimbos vêm depois e nunca derrubam a lista
        extrasDasViagens(clienteId, l.map((v) => v.id))
          .then((x) => { if (atual) setExtras(x); })
          .catch(() => { if (atual) setExtras({ porViagem: new Map(), parcial: true }); });
      })
      .catch((e) => { if (atual) { setErro(e instanceof Error ? e.message : "erro desconhecido"); setLista([]); } });
    return () => { atual = false; };
  }, [clienteId]);

  // categoria e nome: usa o que a ficha mandou; só busca se não veio nada
  useEffect(() => {
    if (metrica !== undefined) return;
    let atual = true;
    metricaDoCliente(clienteId).then((m) => { if (atual) setMetricaPropria(m); }).catch(() => undefined);
    return () => { atual = false; };
  }, [clienteId, metrica]);
  useEffect(() => {
    if (cats) return;
    carregarRegras().then((r) => setCatsProprias(categoriasDe(r.regras))).catch(() => undefined);
  }, [cats]);

  const m = metrica !== undefined ? metrica : metricaPropria;
  const listaCats = cats ?? catsProprias ?? [];
  const cat = m && m.categoria !== "sem_categoria" ? listaCats.find((c) => c.id === m.categoria) ?? null : null;

  const r = useMemo(() => (lista ? resumir(lista) : null), [lista]);
  const anos = useMemo(() => (lista ? porAno(lista) : []), [lista]);
  const nome = m?.nome || lista?.find((v) => v.cliente_id === clienteId)?.cliente_nome || "Viajante";
  const anoAtual = hojeSP().slice(0, 4);

  let indice = 0; // índice global pro stagger dos carimbos

  return (
    <section className="pp rel-card overflow-hidden" aria-labelledby="pp-titulo">
      <style>{PP_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 pt-4 pb-3">
        <h2 id="pp-titulo" className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Viagens com a gente</h2>
        {lista && lista.length > 0 && (
          <span className="flex items-center gap-3 text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>
            <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="expedicao" tamanho={9} />Expedição</span>
            <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="pacote" tamanho={9} />Pacote</span>
          </span>
        )}
      </div>

      {erro ? (
        <div className="px-4 sm:px-5 pb-4"><Aviso tom="erro">Não consegui carregar as viagens ({erro}).</Aviso></div>
      ) : lista === null || !r ? (
        <Esqueleto />
      ) : lista.length === 0 ? (
        <PassaporteEmBranco />
      ) : (
        <>
          <Capa nome={nome} cat={cat} r={r} />

          {/* Por onde já andou */}
          {r.destinos.length > 0 && (
            <div className="px-4 sm:px-5 pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <h3 className="text-[12px] font-bold uppercase tracking-[.12em]" style={{ color: "var(--ink2)" }}>Por onde já andou</h3>
                <span className="flex items-center gap-3 text-[11px]" style={{ color: "var(--ink3)" }}>
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-3.5 h-2.5 rounded-sm" style={{ background: "var(--card2)", border: "1px solid var(--line)" }} />visitou</span>
                  <span className="inline-flex items-center gap-1.5"><span aria-hidden className="w-3.5 h-2.5 rounded-sm" style={{ border: "1.5px dashed var(--ink3)" }} />vai</span>
                </span>
              </div>
              {r.pontos.length > 0 && <MapaMundi pontos={r.pontos} />}
              <ul className="flex flex-wrap gap-1.5 mt-3" aria-label="Destinos do cliente">
                {r.destinos.map((d) => {
                  const vai = !!d.vaiEm && !d.visitadoEm;
                  return (
                    <li key={d.chave} className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-[12px]"
                      style={vai
                        ? { border: `1.5px dashed ${d.tipo === "expedicao" ? "var(--pp-exp)" : "var(--pp-pac)"}`, color: "var(--ink)" }
                        : { background: "var(--card2)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                      <MarcaTipo tipo={d.tipo} tamanho={8} />
                      <span className="font-semibold">{d.nome}</span>
                      <span className="tabular-nums" style={{ color: "var(--ink3)" }}>
                        {d.visitadoEm ? d.visitadoEm.slice(0, 4) : ""}
                        {d.visitadoEm && d.vaiEm ? " · volta " : ""}
                        {d.vaiEm ? (d.visitadoEm ? mesAno(d.vaiEm) : `vai ${mesAno(d.vaiEm)}`) : ""}
                        {!d.visitadoEm && !d.vaiEm ? "sem data" : ""}
                      </span>
                      <span className="sr-only">{vai ? " (viagem futura)" : d.visitadoEm ? " (já visitou)" : ""}{d.noMapa ? "" : " — fora do mapa"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Carimbos por ano */}
          <div className="px-4 sm:px-5 pt-6 pb-5 space-y-6">
            {extras?.parcial && (
              <Aviso>Alguns detalhes (voos, documentos ou companhia) não carregaram — as viagens estão todas aqui.</Aviso>
            )}
            {anos.map(({ ano, viagens }) => {
              const futuro = ano !== "Sem data" && ano > anoAtual;
              const passado = ano !== "Sem data" && ano < anoAtual;
              return (
                <div key={ano}>
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className={`text-[30px] sm:text-[34px] font-extrabold leading-none tabular-nums tracking-tight ${passado ? "pp-ano-passado" : ""}`}
                      style={passado ? undefined : { color: ano === "Sem data" ? "var(--ink2)" : "var(--ink)", fontSize: ano === "Sem data" ? 20 : undefined }}>
                      {ano}
                    </h3>
                    <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: "var(--ink3)" }}>
                      {plural(viagens.length, "viagem", "viagens")}{futuro ? " · por vir" : ano === anoAtual ? " · este ano" : ""}
                    </span>
                    <span aria-hidden className="flex-1 border-t" style={{ borderColor: "var(--line)" }} />
                  </div>
                  <ol className="pp-trilho space-y-3">
                    {viagens.map((v) => {
                      const i = indice++;
                      return (
                        <li key={v.id} className="pp-entra relative" style={{ "--i": i } as CSSProperties}>
                          <span aria-hidden className="pp-no"><MarcaTipo tipo={grupoTipo(v.tipo)} tamanho={10} /></span>
                          <CarimboViagem v={v} clienteId={clienteId} extra={extras?.porViagem.get(v.id)} onAbrir={onAbrirViagem} />
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
