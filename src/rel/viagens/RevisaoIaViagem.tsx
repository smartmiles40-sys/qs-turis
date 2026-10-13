// src/rel/viagens/RevisaoIaViagem.tsx
// -----------------------------------------------------------------------------
// REVISÃO DA VIAGEM PELA IA (13/10/2026). A IA lê bilhetes, seguro e vouchers
// anexados (e os campos do Bitrix), e o servidor cruza: é tudo desta viagem?
// passageiros batem? seguro cobre as datas? o que é voo interno, transfer…
// Os trechos que ela acha entram em "Trechos" (marcados como "IA").
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CATEGORIA_SEG, STATUS_REVISAO, carregarRevisao, revisarViagem,
  type CategoriaSeg, type EstadoRevisao, type SegmentoIa,
} from "../lib/viagemIa";
import { Aviso, Botao, Etiqueta } from "../ui";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
/** Hora como está no documento (hora local do lugar), sem converter pro fuso do navegador. */
function horaLocal(iso: string | null) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : "";
}

const ICONE: Record<CategoriaSeg | "seguro", ReactNode> = {
  voo_internacional: <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  voo_interno: <><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></>,
  transfer: <><rect x="1" y="6" width="22" height="11" rx="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  trem: <><rect x="4" y="3" width="16" height="14" rx="3" /><path d="M4 11h16M8 21l2-4M16 21l-2-4" /></>,
  hospedagem: <><path d="M2 20V8M22 20v-6a3 3 0 0 0-3-3H10v6M2 17h20" /><circle cx="6.5" cy="11.5" r="2" /></>,
  passeio: <><circle cx="12" cy="10" r="3" /><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /></>,
  seguro: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
};
const COR: Record<CategoriaSeg, string> = {
  voo_internacional: "#2563EB", voo_interno: "#0E7C6A", transfer: "#B45309", trem: "#7C3AED", hospedagem: "#BE185D", passeio: "#0369A1",
};

function Icone({ c, cor }: { c: CategoriaSeg | "seguro"; cor: string }) {
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${cor}1A`, color: cor }} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONE[c]}</svg>
    </span>
  );
}

function LinhaSegmento({ s }: { s: SegmentoIa }) {
  const cor = COR[s.categoria];
  const titulo = s.categoria === "hospedagem" || s.categoria === "passeio"
    ? (s.nome_local || s.destino || s.origem || CATEGORIA_SEG[s.categoria])
    : `${s.origem || "?"} → ${s.destino || "?"}`;
  return (
    <li className="flex gap-3 items-start py-2">
      <Icone c={s.categoria} cor={cor} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{titulo}</span>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${cor}1A`, color: cor }}>{CATEGORIA_SEG[s.categoria]}</span>
          {s.fonte_leitura === "bitrix" && <span className="text-[11px]" style={{ color: "var(--ink3)" }}>(do Bitrix)</span>}
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: "var(--ink2)" }}>
          {s.categoria === "hospedagem" ? <>check-in {horaLocal(s.partida_em)}{s.chegada_em && <> · check-out {horaLocal(s.chegada_em)}</>}</>
            : <>{horaLocal(s.partida_em)}{s.chegada_em && <> → {horaLocal(s.chegada_em)}</>}</>}
          {[s.companhia, s.numero].filter(Boolean).length > 0 && <> · {[s.companhia, s.numero].filter(Boolean).join(" ")}</>}
          {s.localizador && <> · loc. <b className="font-mono">{s.localizador}</b></>}
          {s.bagagem && <> · bagagem {s.bagagem}</>}
        </div>
      </div>
    </li>
  );
}

export default function RevisaoIaViagem({ viagemId, onRevisado }: { viagemId: string; onRevisado?: () => void }) {
  const [estado, setEstado] = useState<EstadoRevisao | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [verLeituras, setVerLeituras] = useState(false);

  const carregar = useCallback(async () => {
    try { setEstado(await carregarRevisao(viagemId)); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar a revisão."); }
  }, [viagemId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function revisar() {
    setRodando(true); setErro(null);
    try { await revisarViagem(viagemId); await carregar(); onRevisado?.(); }
    catch (e) { setErro(e instanceof Error ? e.message : "A revisão falhou."); }
    finally { setRodando(false); }
  }

  const r = estado?.ia_revisao ?? null;
  const st = estado?.ia_revisao_status ? STATUS_REVISAO[estado.ia_revisao_status] : null;
  const ordem = { alta: 0, media: 1, baixa: 2 } as const;
  const divergencias = [...(r?.divergencias ?? [])].sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  const seguros = (r?.documentos ?? []).filter((d) => d.lido?.seguro);

  return (
    <section className="rel-card p-4 sm:p-5 space-y-3" aria-busy={rodando}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Revisão da IA</h2>
          {st && <Etiqueta tom={st.tom}>{st.txt}</Etiqueta>}
          {estado?.ia_revisao_em && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>em {quando(estado.ia_revisao_em)}</span>}
        </div>
        <Botao variante="primario" disabled={rodando} onClick={() => void revisar()}>
          {rodando ? "Revisando… (até 1 min)" : r ? "Revisar de novo" : "Revisar viagem com IA"}
        </Botao>
      </div>

      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        A IA lê bilhetes, seguro e vouchers anexados (e os campos de voo do Bitrix), confere se é tudo desta viagem e
        separa voo internacional, voo interno, transfer, trem e hotel. Os trechos encontrados entram em "Trechos".
      </p>

      {erro && <Aviso tom="erro">{erro}{/OPENAI_API_KEY/.test(erro) && " Peça ao Bruno pra cadastrar a chave da OpenAI na Vercel."}</Aviso>}
      {estado === null && !erro && <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--card2)" }} />}
      {estado && !r && !erro && !rodando && <p className="text-sm" style={{ color: "var(--ink2)" }}>Esta viagem ainda não foi revisada.</p>}

      {r && (
        <>
          <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>{r.resumo}</p>

          {divergencias.length > 0 && (
            <ul className="space-y-1.5">
              {divergencias.map((d, i) => (
                <li key={i} className="text-[13px] px-3 py-2 rounded-lg flex gap-2"
                  style={d.gravidade === "alta" ? { background: "var(--err-bg)", color: "var(--err-ink)" }
                    : d.gravidade === "media" ? { background: "var(--warn-bg)", color: "var(--warn-ink)" }
                    : { background: "var(--card2)", color: "var(--ink2)" }}>
                  <span className="font-bold uppercase text-[10.5px] pt-0.5 flex-shrink-0">{d.gravidade === "alta" ? "Grave" : d.gravidade === "media" ? "Conferir" : "Info"}</span>
                  <span>{d.texto}</span>
                </li>
              ))}
            </ul>
          )}

          {r.passageiros_cobertos.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Passageiros</h3>
              <ul className="flex flex-wrap gap-1.5">
                {r.passageiros_cobertos.map((p) => (
                  <li key={p.cliente_id} className="text-[12px] px-2 py-1 rounded-lg border" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
                    {p.nome} · <span style={{ color: p.bilhete ? "var(--rel-ink)" : "var(--err-ink)" }}>{p.bilhete ? "✓" : "✗"} bilhete</span>
                    {" "}· <span style={{ color: p.seguro ? "var(--rel-ink)" : "var(--err-ink)" }}>{p.seguro ? "✓" : "✗"} seguro</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(r.segmentos.length > 0 || seguros.length > 0) && (
            <div>
              <h3 className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>O que a IA encontrou</h3>
              <ul className="divide-y" style={{ borderColor: "var(--line2)" }}>
                {r.segmentos.map((s, i) => <LinhaSegmento key={i} s={s} />)}
                {seguros.map((d, i) => {
                  const sg = d.lido!.seguro!;
                  return (
                    <li key={`sg${i}`} className="flex gap-3 items-start py-2">
                      <Icone c="seguro" cor="#15803D" />
                      <div className="text-[12px]" style={{ color: "var(--ink2)" }}>
                        <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Seguro {sg.seguradora || ""}</span>
                        <div>vigência {sg.vigencia_inicio?.split("-").reverse().join("/") || "?"} a {sg.vigencia_fim?.split("-").reverse().join("/") || "?"}
                          {sg.cobertura && <> · {sg.cobertura}</>}{sg.apolice && <> · apólice {sg.apolice}</>}</div>
                        {sg.segurados.length > 0 && <div>segurados: {sg.segurados.join(", ")}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>Horários como estão no documento (hora local do lugar).</p>
            </div>
          )}

          {r.avisos.length > 0 && (
            <ul className="text-[12px] list-disc pl-5 space-y-0.5" style={{ color: "var(--ink3)" }}>
              {r.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          {r.trechos && (r.trechos.novos + r.trechos.completados + r.trechos.removidos > 0) && (
            <p className="text-[12px]" style={{ color: "var(--ink2)" }}>
              Trechos: {r.trechos.novos} novo(s), {r.trechos.completados} completado(s){r.trechos.removidos ? `, ${r.trechos.removidos} removido(s)` : ""}.
            </p>
          )}

          <button className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }} aria-expanded={verLeituras} onClick={() => setVerLeituras((x) => !x)}>
            {verLeituras ? "Esconder" : "Ver"} o que foi lido ({r.documentos.length})
          </button>
          {verLeituras && (
            <ul className="text-[12px] space-y-1" style={{ color: "var(--ink2)" }}>
              {r.documentos.map((d, i) => (
                <li key={i}>
                  <b>{d.arquivo_nome || d.tipo_cadastro}</b>
                  {d.erro ? <span style={{ color: "var(--err-ink)" }}> — {d.erro}</span>
                    : d.lido ? <> — {d.lido.legivel ? d.lido.tipo_detectado.replace("_", " ") : "ilegível"}
                      {d.lido.passageiros.length > 0 && <> · {d.lido.passageiros.join(", ")}</>}
                      {d.lido.localizador && <> · loc. {d.lido.localizador}</>}
                      {d.lido.observacao && <> · <i>{d.lido.observacao}</i></>}</> : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
