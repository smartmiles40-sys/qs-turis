// src/mkt/grupos/CalendarioDatas.tsx — "Vários dias": a mesma campanha em várias datas
// de uma vez (o MultiDatePicker do SendFlow): horário padrão, feriados num toque,
// data avulsa e, por data, mensagem e mídia próprias. Horários de Brasília.
import { useMemo, useState } from "react";
import type { TipoMsg } from "./lib";
import { hojeSP, normalizarDatas, proximosFeriados, temMidia, type EntradaData } from "./datas";
import { CampoArquivo, cor } from "./pecas";

const ddMM = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const ddMMyyyy = (ymd: string) => ymd.split("-").reverse().join("/");
const TIPOS_DATA: { v: TipoMsg; r: string }[] = [{ v: "texto", r: "Texto" }, { v: "imagem", r: "Imagem" }, { v: "video", r: "Vídeo" }, { v: "documento", r: "PDF" }];

function Pilula({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={ativo} onClick={onClick} className="rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={ativo ? { border: "1.5px solid var(--rel)", background: cor.relSoft, color: cor.relInk } : { border: "1px solid var(--line)", background: cor.card, color: cor.ink2 }}>
      {children}
    </button>
  );
}

export function CalendarioDatas({ entradas, onChange, textoBase, horaPadrao, onHoraPadrao }: {
  entradas: EntradaData[]; onChange: (e: EntradaData[]) => void; textoBase: string; horaPadrao: string; onHoraPadrao: (h: string) => void;
}) {
  const hoje = useMemo(() => hojeSP(), []);
  const feriados = useMemo(() => proximosFeriados(), []);
  const [avulsa, setAvulsa] = useState("");
  const [aberta, setAberta] = useState<Record<string, boolean>>({});
  const escolhidas = new Set(entradas.map((e) => e.data));
  const lista = normalizarDatas(entradas);

  const add = (data: string) => { if (data && data >= hoje && !escolhidas.has(data)) onChange(normalizarDatas([...entradas, { data, hora: horaPadrao }])); };
  const tirar = (data: string) => onChange(entradas.filter((e) => e.data !== data));
  const mudar = (data: string, p: Partial<EntradaData>) => onChange(entradas.map((e) => (e.data === data ? { ...e, ...p } : e)));
  function trocarTipo(data: string, t: TipoMsg | undefined) {
    if (t === undefined) mudar(data, { tipo: undefined, midia_url: undefined, midia_nome: undefined });
    else if (!temMidia(t)) mudar(data, { tipo: t, midia_url: undefined, midia_nome: undefined });
    else mudar(data, { tipo: t });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="gr-hora-padrao" className="mb-2 block text-[13px] font-semibold" style={{ color: cor.ink }}>
          Horário padrão <span className="font-normal" style={{ color: cor.ink3 }}>· usado ao adicionar datas (Brasília)</span>
        </label>
        <input id="gr-hora-padrao" type="time" className="rel-input" style={{ maxWidth: 140 }} value={horaPadrao} onChange={(e) => onHoraPadrao(e.target.value)} />
      </div>

      <div>
        <div className="mb-2 text-[13px] font-semibold" style={{ color: cor.ink }}>Feriados <span className="font-normal" style={{ color: cor.ink3 }}>· toque pra adicionar</span></div>
        {feriados.length === 0 ? <p className="text-[13px]" style={{ color: cor.ink3 }}>Nenhum feriado nacional à frente.</p> : (
          <div className="flex flex-wrap gap-2">
            {feriados.map((f) => {
              const on = escolhidas.has(f.data);
              return (
                <button key={f.data} type="button" aria-pressed={on} onClick={() => (on ? tirar(f.data) : add(f.data))}
                  className="flex items-center gap-2 rounded-full px-3 py-[7px] text-[12.5px] font-medium"
                  style={on ? { border: "1.5px solid var(--rel)", background: cor.relSoft, color: cor.relInk } : { border: "1px solid var(--line)", background: cor.card2, color: cor.ink2 }}>
                  <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none"
                    style={on ? { background: "var(--rel)", color: "#fff" } : { border: "1px solid var(--line)" }}>{on ? "✓" : "+"}</span>
                  <span>{f.nome}</span>
                  <span style={{ color: cor.ink3 }}>{ddMM(f.data)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="gr-data-avulsa" className="mb-2 block text-[13px] font-semibold" style={{ color: cor.ink }}>Adicionar data</label>
        <div className="flex flex-wrap gap-2">
          <input id="gr-data-avulsa" type="date" min={hoje} className="rel-input" style={{ maxWidth: 180 }} value={avulsa} onChange={(e) => setAvulsa(e.target.value)} />
          <button type="button" disabled={!avulsa || avulsa < hoje || escolhidas.has(avulsa)} onClick={() => { add(avulsa); setAvulsa(""); }}
            className="rounded-xl px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ border: "1px solid var(--rel)", background: cor.relSoft, color: cor.relInk }}>Adicionar</button>
        </div>
      </div>

      <div>
        <div className="mb-2 text-[13px] font-semibold" style={{ color: cor.ink }}>Datas selecionadas <span className="font-normal" style={{ color: cor.ink3 }}>{lista.length ? `· ${lista.length}` : ""}</span></div>
        {lista.length === 0 ? (
          <div className="rounded-xl px-3.5 py-6 text-center text-[13px]" style={{ border: "1.5px dashed var(--line)", background: cor.card2, color: cor.ink3 }}>
            Nenhuma data ainda. Escolha um feriado ou adicione uma data acima.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {lista.map((e) => {
              const ab = aberta[e.data] ?? false;
              const pers = Boolean(e.texto?.trim()) || e.tipo !== undefined;
              return (
                <li key={e.data} className="rounded-xl px-3.5 py-3" style={{ border: "1px solid var(--line)", background: cor.card2 }}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[14px] font-semibold tabular-nums" style={{ color: cor.ink }}>{ddMMyyyy(e.data)}</span>
                    <input type="time" aria-label={`Horário de ${ddMMyyyy(e.data)}`} value={e.hora} onChange={(x) => mudar(e.data, { hora: x.target.value })}
                      className="rounded-lg px-2.5 py-1.5 text-[13px]" style={{ border: "1px solid var(--line)", background: cor.card, color: cor.ink }} />
                    <button type="button" aria-expanded={ab} onClick={() => setAberta((s) => ({ ...s, [e.data]: !ab }))}
                      className="ml-auto rounded-lg px-2.5 py-1.5 text-[12px] font-semibold"
                      style={pers || ab ? { border: "1px solid var(--rel)", background: cor.relSoft, color: cor.relInk } : { border: "1px solid var(--line)", color: cor.ink2 }}>
                      {pers ? "✎ Personalizada" : "Personalizar mensagem"}
                    </button>
                    <button type="button" aria-label={`Remover ${ddMMyyyy(e.data)}`} onClick={() => tirar(e.data)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ border: "1px solid var(--line)", color: cor.ink3 }}>✕</button>
                  </div>
                  {ab && (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      <textarea rows={3} className="rel-input" value={e.texto ?? ""} placeholder={textoBase || "Herda a mensagem base…"}
                        aria-label={`Mensagem para ${ddMMyyyy(e.data)}`} onChange={(x) => mudar(e.data, { texto: x.target.value })} />
                      <div>
                        <div className="mb-1.5 text-[12px] font-semibold" style={{ color: cor.ink3 }}>Mídia desta data</div>
                        <div className="flex flex-wrap gap-1.5">
                          <Pilula ativo={e.tipo === undefined} onClick={() => trocarTipo(e.data, undefined)}>Herdar da base</Pilula>
                          {TIPOS_DATA.map((t) => <Pilula key={t.v} ativo={e.tipo === t.v} onClick={() => trocarTipo(e.data, t.v)}>{t.r}</Pilula>)}
                        </div>
                        {e.tipo && temMidia(e.tipo) && (
                          <div className="mt-2">
                            <CampoArquivo compacto tipo={e.tipo} url={e.midia_url ?? null} nome={e.midia_nome ?? null}
                              onSubiu={(r) => mudar(e.data, { midia_url: r.url, midia_nome: r.nome })} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
