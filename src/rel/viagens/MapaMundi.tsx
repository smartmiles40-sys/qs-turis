// src/rel/viagens/MapaMundi.tsx
// -----------------------------------------------------------------------------
// MAPA-MÚNDI do painel de Viagens: fundo escuro e um ponto de luz em cada
// destino que tem viajante. O tamanho e o brilho crescem com o nº de
// passageiros; Expedição e Pacote têm cores diferentes.
//
// O contorno dos países vem do `world-atlas` (arquivo de ~100 KB), baixado só
// quando o mapa aparece — não pesa no resto do sistema.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import paisesUrl from "world-atlas/countries-110m.json?url";
import type { Lugar } from "./destinos";

export const COR_EXP = "#3CCFB3";   // expedição (verde da área, versão clara)
export const COR_PAC = "#F5B942";   // pacote (âmbar)

export interface PontoMapa {
  lugar: Lugar;
  tipo: "expedicao" | "pacote";
  passageiros: number;
  viagens: number;
  proximoEmbarque: string | null;   // AAAA-MM-DD
}

const L = 960, A = 500;
const projecao = geoNaturalEarth1().scale(175).translate([L / 2, A / 2 + 20]);
const caminho = geoPath(projecao);

let paisesPromise: Promise<FeatureCollection<Geometry>> | null = null;
function carregarPaises() {
  if (!paisesPromise) {
    paisesPromise = fetch(paisesUrl)
      .then((r) => r.json() as Promise<Topology<{ countries: GeometryCollection }>>)
      .then((topo) => feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>)
      .catch((e) => { paisesPromise = null; throw e; });
  }
  return paisesPromise;
}

const CSS = `
@keyframes rel-pulso { 0% { transform: scale(.6); opacity: .85 } 100% { transform: scale(2.6); opacity: 0 } }
.rel-mapa-anel { transform-box: fill-box; transform-origin: center; animation: rel-pulso 2.6s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .rel-mapa-anel { animation: none; opacity: .25 } }
g.rel-mapa-ponto:focus, g.rel-mapa-ponto:focus-visible { outline: none; } /* o anel tracejado abaixo faz o papel do foco */
.rel-mapa-ponto .rel-mapa-foco { opacity: 0; transition: opacity .15s cubic-bezier(.25,1,.5,1); }
.rel-mapa-ponto:focus-visible .rel-mapa-foco { opacity: 1; }
`;

/** Expedição = círculo, Pacote = losango. A FORMA separa os dois, não só a cor (daltonismo). */
function Forma({ tipo, x, y, r, ...rest }: { tipo: "expedicao" | "pacote"; x: number; y: number; r: number } & React.SVGProps<SVGPathElement & SVGCircleElement>) {
  if (tipo === "expedicao") return <circle cx={x} cy={y} r={r} {...(rest as React.SVGProps<SVGCircleElement>)} />;
  const d = r * 1.25; // losango um tiquinho maior pra ter a mesma "massa" visual do círculo
  return <path d={`M ${x} ${y - d} L ${x + d} ${y} L ${x} ${y + d} L ${x - d} ${y} Z`} {...(rest as React.SVGProps<SVGPathElement>)} />;
}

/** A mesma forma em HTML, pra legenda e cards. */
export function MarcaTipo({ tipo, tamanho = 10, brilho = false }: { tipo: "expedicao" | "pacote"; tamanho?: number; brilho?: boolean }) {
  const cor = tipo === "expedicao" ? COR_EXP : COR_PAC;
  return (
    <span aria-hidden className="inline-block flex-shrink-0"
      style={{
        width: tamanho, height: tamanho, background: cor,
        borderRadius: tipo === "expedicao" ? "50%" : 1.5,
        transform: tipo === "pacote" ? "rotate(45deg) scale(.86)" : undefined,
        boxShadow: brilho ? `0 0 8px ${cor}` : "inset 0 0 0 1px rgba(0,0,0,.18)",
      }} />
  );
}

const dataCurta = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "sem data");

export default function MapaMundi({ pontos }: { pontos: PontoMapa[] }) {
  const [paises, setPaises] = useState<FeatureCollection<Geometry> | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [foco, setFoco] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => { carregarPaises().then(setPaises).catch(() => setFalhou(true)); }, []);

  const contornos = useMemo(() => (paises ? paises.features.map((f) => caminho(f) ?? "") : []), [paises]);
  const grade = useMemo(() => caminho(geoGraticule10()) ?? "", []);
  const borda = useMemo(() => caminho({ type: "Sphere" }) ?? "", []);

  const maxPax = Math.max(1, ...pontos.map((p) => p.passageiros));
  const marcados = useMemo(() => pontos.map((p) => {
    // pacote no mesmo lugar de uma expedição fica um pouquinho ao lado
    const desloca = p.tipo === "pacote" && pontos.some((q) => q.tipo === "expedicao" && q.lugar.id === p.lugar.id) ? 1.6 : 0;
    const xy = projecao([p.lugar.lon + desloca, p.lugar.lat]) ?? [0, 0];
    const r = 3 + 9 * Math.sqrt(p.passageiros / maxPax);
    return { ...p, x: xy[0], y: xy[1], r };
  }).sort((a, b) => b.r - a.r), [pontos, maxPax]);

  const f = foco !== null ? marcados[foco] : null;

  return (
    <div ref={caixa} className="relative rounded-2xl overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 40%, #0F2230 0%, #081219 70%)", border: "1px solid #14262F" }}>
      <style>{CSS}</style>
      <svg viewBox={`0 0 ${L} ${A}`} className="w-full h-auto block" role="img" aria-label={`Mapa com ${pontos.length} destinos com viajantes`}>
        <defs>
          <radialGradient id="rel-luz-exp"><stop offset="0%" stopColor="#fff" stopOpacity=".95" /><stop offset="35%" stopColor={COR_EXP} stopOpacity=".9" /><stop offset="100%" stopColor={COR_EXP} stopOpacity="0" /></radialGradient>
          <radialGradient id="rel-luz-pac"><stop offset="0%" stopColor="#fff" stopOpacity=".95" /><stop offset="35%" stopColor={COR_PAC} stopOpacity=".9" /><stop offset="100%" stopColor={COR_PAC} stopOpacity="0" /></radialGradient>
        </defs>
        <path d={borda} fill="#0A1820" stroke="#173040" strokeWidth={0.8} />
        <path d={grade} fill="none" stroke="#12303D" strokeWidth={0.4} />
        {contornos.map((d, i) => <path key={i} d={d} fill="#16303C" stroke="#21455A" strokeWidth={0.4} />)}
        {!falhou && paises && pontos.length === 0 && <text x={L / 2} y={A / 2} textAnchor="middle" fill="#8FB0BE" fontSize="15">Nenhum destino com viajante neste filtro.</text>}
        {falhou && <text x={L / 2} y={A / 2} textAnchor="middle" fill="#7FA3B3" fontSize="14">Não carregou o desenho do mapa — os pontos continuam aqui.</text>}
        {marcados.map((p, i) => {
          const cor = p.tipo === "expedicao" ? COR_EXP : COR_PAC;
          return (
            <g key={`${p.lugar.id}-${p.tipo}`} onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)}
              onFocus={() => setFoco(i)} onBlur={() => setFoco(null)} tabIndex={0} className="rel-mapa-ponto" style={{ cursor: "default" }}
              role="img" aria-label={`${p.lugar.nome} — ${p.tipo === "expedicao" ? "Expedição" : "Pacote"}: ${p.passageiros} viajante${p.passageiros === 1 ? "" : "s"}`}>
              <circle cx={p.x} cy={p.y} r={p.r * 2.4} fill={`url(#rel-luz-${p.tipo === "expedicao" ? "exp" : "pac"})`} opacity={0.35 + 0.5 * (p.passageiros / maxPax)} />
              <Forma tipo={p.tipo} x={p.x} y={p.y} r={p.r} className="rel-mapa-anel" fill="none" stroke={cor} strokeWidth={1.2} style={{ animationDelay: `${(i % 7) * 0.37}s` }} />
              <Forma tipo={p.tipo} x={p.x} y={p.y} r={Math.max(2.4, p.r * 0.5)} fill="#fff" stroke={cor} strokeWidth={1} />
              <Forma tipo={p.tipo} x={p.x} y={p.y} r={Math.max(9, p.r * 1.6)} className="rel-mapa-foco" fill="none" stroke="#fff" strokeWidth={1.5} strokeDasharray="3 2" />
              <circle cx={p.x} cy={p.y} r={Math.max(12, p.r * 1.6)} fill="transparent" />
            </g>
          );
        })}
      </svg>

      {f && (
        <div className="absolute pointer-events-none px-3 py-2 rounded-lg text-[12px] shadow-lg"
          style={{
            left: `${(f.x / L) * 100}%`, top: `${(f.y / A) * 100}%`,
            transform: `translate(${f.x > L * 0.7 ? "-105%" : "12px"}, -50%)`,
            background: "rgba(6,14,19,.94)", color: "#E6F1F4", border: `1px solid ${f.tipo === "expedicao" ? COR_EXP : COR_PAC}`, whiteSpace: "nowrap",
          }}>
          <p className="font-bold text-[13px]">{f.lugar.nome}</p>
          <p className="inline-flex items-center gap-1.5" style={{ color: f.tipo === "expedicao" ? COR_EXP : COR_PAC }}><MarcaTipo tipo={f.tipo} tamanho={8} />{f.tipo === "expedicao" ? "Expedição" : "Pacote"}</p>
          <p>{f.passageiros} viajante{f.passageiros === 1 ? "" : "s"} · {f.viagens} venda{f.viagens === 1 ? "" : "s"}</p>
          <p style={{ color: "#9FB8C2" }}>Próximo embarque: {dataCurta(f.proximoEmbarque)}</p>
        </div>
      )}

      <div className="absolute left-3 bottom-3 flex flex-wrap gap-3 px-3 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: "rgba(6,14,19,.75)", color: "#C9DCE2" }}>
        <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="expedicao" brilho />Expedição <span style={{ color: "#8FB0BE" }}>(círculo)</span></span>
        <span className="inline-flex items-center gap-1.5"><MarcaTipo tipo="pacote" brilho />Pacote <span style={{ color: "#8FB0BE" }}>(losango)</span></span>
        <span className="hidden sm:inline" style={{ color: "#8FB0BE" }}>maior = mais viajantes</span>
      </div>
    </div>
  );
}
