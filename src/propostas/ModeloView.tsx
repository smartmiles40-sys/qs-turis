// src/propostas/ModeloView.tsx
// -----------------------------------------------------------------------------
// A proposta nos 3 MODELOS-PADRÃO (0280, Bruno 03/11/2026), como o cliente vê
// no link, na prévia do QS e no PDF ("Baixar PDF" = imprimir esta página, como
// na 0156: página e PDF nunca divergem).
//
// Copiado dos PDFs-padrão (ordem das seções, textos fixos, cores e fontes):
//   pacote   → folhas com a faixa escura da marca + filete limão no topo
//              (Capa · Sumário e voos · Hospedagem · Dia a dia + Bom saber ·
//              Antes de ir · Documentos e cancelamento · Dicas locais · Taxas e
//              opcionais · Exclusivo Se Tu For · Tudo o que está no pacote ·
//              Investimento) e o rodapé "Se Tu For, Eu Vou! Viagens · Proposta
//              de dd/mm/aaaa   n/N" em cada página;
//   servicos → capa escura + seções numeradas (1 Serviços adicionais por dia ·
//              2 Resumo · 3 Informações importantes · 4 Roteiro da viagem);
//   seguro   → Capa com os planos · Comparativo · Coberturas completas de cada
//              seguradora · Nossa recomendação.
// Seção sem conteúdo não aparece. O cliente escolhe uma opção pelo mesmo
// fluxo de antes (onEscolher).
// -----------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import { brl, textoPassageiros, tituloDaProposta, totaisDaOpcao, type PropostaVM } from "./lib";
import {
  FIXO, MODELOS, alternativas, colunas, dataExtenso, ddmm, ddmmaaaa, diaCurto, diaSemana, diasInclusivos, extenso, fotos, linhas,
  linhasDoDia, mesNome, negritos, numeroBr, periodoCurto, periodoLongo, resumoServicos, roteiroServicos, tabela, tabelaComGrupos,
  type Conteudo, type DetalhesServico, type DiaPacote, type HotelPacote, type SeguradoraModelo,
} from "./modelos";

type Opcao = PropostaVM["opcoes"][number];

const C = {
  escuro: "#0A2A2B", limao: "#CDEB5E", verde: "#5A8A1C", painel: "#F4F7E9", borda: "#E2E5D6",
  tinta: "#1C2A2A", suave: "#5E6B6A", teal: "#1F5A55", fundoServ: "#F6F6F3", tagServ: "#D3DED6",
};

const css = (rodape: string) => `
@import url("https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&family=Oswald:wght@300&family=Schibsted+Grotesk:wght@400;500;700;800&display=swap");
.mp { background: #ECEDE8; color: ${C.tinta}; font-family: Lato, system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; min-height: 100%; }
.mp-serif { font-family: "Source Serif 4", Georgia, serif; font-weight: 700; color: ${C.escuro}; letter-spacing: -.005em; }
.mp-folha { background: #fff; max-width: 900px; margin: 0 auto 18px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.mp-corpo { padding: 32px 56px 28px; }
.mp-rot { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: ${C.suave}; }
.mp-pill { display: inline-block; background: ${C.limao}; color: ${C.escuro}; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 3px 11px; border-radius: 999px; }
.mp-painel { background: ${C.painel}; border-radius: 12px; }
.mp-card { border: 1px solid ${C.borda}; border-radius: 12px; background: #fff; }
.mp-tab { width: 100%; border-collapse: collapse; font-size: 13px; }
.mp-tab th { background: ${C.escuro}; color: #fff; text-align: left; font-weight: 700; padding: 10px 14px; }
.mp-tab td { padding: 10px 14px; border-bottom: 1px solid ${C.borda}; vertical-align: top; }
.mp-tab tr.mp-grupo td { background: ${C.painel}; font-weight: 700; }
.mp-tab tr.mp-nota td { font-style: italic; color: ${C.suave}; font-size: 12px; padding-top: 6px; padding-bottom: 6px; }
.mp-bola { width: 7px; height: 7px; border-radius: 50%; background: #8DBA3C; flex-shrink: 0; margin-top: 7px; }
.mp-foto { width: 100%; object-fit: cover; border-radius: 12px; display: block; }
.mp-leg { font-size: 11.5px; color: ${C.suave}; margin-top: 5px; }
.mp-botao { background: ${C.escuro}; color: #fff; border-radius: 999px; padding: 9px 18px; font-weight: 700; font-size: 13.5px; }
.mp-rodape { display: flex; justify-content: space-between; font-size: 11px; color: ${C.suave}; border-top: 1px solid ${C.borda}; margin: 0 56px; padding: 10px 0 16px; }
.mp :focus-visible { outline: 2px solid ${C.verde}; outline-offset: 2px; }
.mp-grot { font-family: "Schibsted Grotesk", Lato, system-ui, sans-serif; }
@media (max-width: 640px) { .mp-corpo { padding: 22px 16px; } .mp-rodape { margin: 0 16px; } .mp-folha { margin-bottom: 10px; } }
@media print {
  @page { size: A4; margin: 0 0 12mm 0;
    @bottom-left { content: "${rodape.replace(/["\\]/g, "")}"; font-family: Lato, sans-serif; font-size: 8pt; color: #5E6B6A; padding-left: 15mm; }
    @bottom-right { content: counter(page) "/" counter(pages); font-family: Lato, sans-serif; font-size: 8pt; color: #5E6B6A; padding-right: 15mm; } }
  html, body, #root, .mp { background: #fff !important; }
  .mp-folha { box-shadow: none; margin: 0; max-width: none; break-before: page; }
  .mp-folha:first-of-type { break-before: auto; }
  .mp-corpo { padding: 9mm 15mm 6mm; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
  .mp-nao-imprime, .mp-rodape { display: none !important; }
  .mp-bloco, .mp-card, .mp-painel, .mp-tab tr { break-inside: avoid; }
  .mp * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

// ── Peças comuns ────────────────────────────────────────────────────────────
function Marca({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <span className="inline-flex items-end gap-1.5" aria-label={FIXO.agencia}>
      <span style={{ fontFamily: "Oswald, 'Arial Narrow', sans-serif", fontWeight: 300, fontSize: tamanho, lineHeight: 1, color: "#E4ECE6", letterSpacing: "-.01em" }}>SE TU FOR, EU VOU!</span>
      <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 300, fontSize: 9, color: "#C9D4CE", paddingBottom: 3 }}>Viagens</span>
    </span>
  );
}
function Faixa({ titulo, secao }: { titulo: string; secao: string }) {
  return (
    <header>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-[56px] max-sm:px-4 py-7" style={{ background: C.escuro }}>
        <Marca />
        <div className="flex-1 text-right min-w-[180px]">
          <p className="mp-serif text-[24px] max-sm:text-[19px]" style={{ color: "#fff" }}>{titulo}</p>
          {secao && <p className="text-[11.5px] font-bold uppercase mt-1" style={{ color: C.limao, letterSpacing: ".02em" }}>{secao}</p>}
        </div>
      </div>
      <div style={{ height: 6, background: C.limao }} />
    </header>
  );
}
function Folha({ titulo, secao, rodape, children }: { titulo: string; secao: string; rodape: string; children: ReactNode }) {
  return (
    <section className="mp-folha">
      <Faixa titulo={titulo} secao={secao} />
      <div className="mp-corpo space-y-6">{children}</div>
      <div className="mp-rodape"><span>{rodape}</span></div>
    </section>
  );
}
function Bolinhas({ itens, cols = 1 }: { itens: string[]; cols?: number }) {
  return (
    <ul className="grid gap-x-6 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {itens.map((t, n) => <li key={n} className="flex gap-2.5 text-[13.5px]"><span className="mp-bola" /><span><Negrito t={t} /></span></li>)}
    </ul>
  );
}
function Negrito({ t }: { t: string }) {
  return <>{negritos(t).map((x, n) => (x.b ? <b key={n}>{x.t}</b> : <span key={n}>{x.t}</span>))}</>;
}
function Fotos({ t }: { t: unknown }) {
  const fs = fotos(t);
  if (!fs.length) return null;
  const linhasFotos: (typeof fs)[] = [];
  if (fs.length <= 2) linhasFotos.push(fs);
  else { linhasFotos.push(fs.slice(0, 2)); for (let i = 2; i < fs.length; i += 3) linhasFotos.push(fs.slice(i, i + 3)); }
  return (
    <div className="space-y-4">
      {linhasFotos.map((l, k) => (
        <div key={k} className="grid gap-4 mp-bloco" style={{ gridTemplateColumns: `repeat(${l.length}, minmax(0, 1fr))` }}>
          {l.map((f, n) => (
            <figure key={n}>
              <img src={f.url} alt={f.legenda} className="mp-foto" style={{ height: l.length === 1 ? 300 : l.length === 2 ? 260 : 165 }} />
              {f.legenda && <figcaption className="mp-leg">{f.legenda}</figcaption>}
            </figure>
          ))}
        </div>
      ))}
    </div>
  );
}
function FotoLarga({ url }: { url: unknown }) {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? <img src={u} alt="" className="mp-foto mp-bloco" style={{ height: 270 }} /> : null;
}
/** Quadros lado a lado com fio entre eles (capa do pacote, datas do seguro). */
function Quadros({ itens, grande }: { itens: { r: string; v: string; d?: string }[]; grande?: boolean }) {
  if (!itens.length) return null;
  return (
    <div className="mp-painel px-5 py-4 grid gap-y-3 mp-bloco" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${grande ? 150 : 120}px, 1fr))` }}>
      {itens.map((q, n) => (
        <div key={n} className="px-3" style={n > 0 ? { borderLeft: `1px solid ${C.borda}` } : undefined}>
          <p className="mp-rot">{q.r}</p>
          <p className="font-bold text-[15px] mt-1">{q.v}</p>
          {q.d && <p className="text-[12px]" style={{ color: C.suave }}>{q.d}</p>}
        </div>
      ))}
    </div>
  );
}
const tx = (c: Conteudo, k: string) => String(c[k] ?? "").trim();
const paxTotal = (p: PropostaVM) => (p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0);

/** Parcela do cartão: "10x de R$ 1.599,48" + "sem juros no cartão de crédito". */
function parcelaDa(o: Opcao, total: number): { n: number; valor: number; texto: string } | null {
  const pg = o.pagamentos.find((x) => x.condicao === "parcelado") ?? o.pagamentos.find((x) => x.condicao === "entrada");
  if (!pg) return null;
  const n = Math.max(1, Math.floor(Number(pg.parcelas) || 1));
  const base = pg.condicao === "entrada" ? total - Math.min(Number(pg.entrada) || 0, total) : total;
  const texto = pg.forma === "cartao" && !pg.com_juros ? FIXO.semJuros : `${pg.com_juros ? "com juros" : "sem juros"}${pg.forma === "cartao" ? " no cartão de crédito" : ""}`;
  return { n, valor: base / n, texto };
}

function BotaoEscolher({ pode, rotulo, onClick }: { pode: boolean; rotulo: string; onClick: () => void }) {
  if (!pode) return null;
  return <button type="button" className="mp-botao mp-nao-imprime mt-3 w-full" onClick={onClick}>{rotulo}</button>;
}

// ── PACOTE ──────────────────────────────────────────────────────────────────
function Pacote({ p, rodape, escolher }: { p: PropostaVM; rodape: string; escolher?: (o: Opcao) => void }) {
  const c = p.conteudo ?? {};
  const T = MODELOS.pacote.cabecalho;
  const titulo = tituloDaProposta(p);
  const faixaCapa = [p.destino || p.titulo, periodoCurto(p.data_ida, p.data_volta)].filter(Boolean).join(" · ");
  const dias = (Array.isArray(c.dias) ? c.dias : []) as DiaPacote[];
  const hoteis = ((Array.isArray(c.hoteis) ? c.hoteis : []) as HotelPacote[]).filter((h) => h.nome.trim());
  const quadros = tabela(c.capa_quadros).map((x) => ({ r: x[0], v: x[1] ?? "", d: x[2] }));
  const resumo = tabela(c.capa_resumo).map((x) => ({ r: x[0], v: x[1] ?? "" }));
  const resumoCapa = resumo.length ? resumo : (p.data_ida ? [{ r: "Datas", v: periodoLongo(p.data_ida, p.data_volta) }] : []);
  const rota = tabela(c.rota);
  const sumario = tabela(c.sumario).length ? tabela(c.sumario).map((x) => ({ d: x[0], t: x.slice(1).join(" | ") }))
    : dias.filter((d) => d.titulo).map((d) => ({ d: ddmm(d.data), t: d.titulo }));
  const voos = tabelaComGrupos(c.voos);
  const bom = cartoesComTitulo(c.bom_saber);
  const clima = colunas(tx(c, "clima"));
  const tempo = linhas(c.tempo), mala = linhas(c.mala);
  const docs = tabela(c.documentos).filter((x) => x[1]);
  const canc = tabela(c.cancelamento);
  const dicas = tabela(c.dicas).filter((x) => x[1]);
  const taxas = tabela(c.taxas);
  const opcionais = tabela(c.opcionais);
  const exp = tabela(c.experiencia).filter((x) => x[0]);
  const recap = tabela(c.recap).filter((x) => x[1] || x[2]);
  const recapNotas = linhas(c.recap_notas);
  const temAntes = clima.some(Boolean) || tempo.length || mala.length;

  return (
    <>
      {/* 1 · Capa */}
      <Folha titulo={T} secao={faixaCapa} rodape={rodape}>
        {p.capa_url && <img src={p.capa_url} alt="" className="mp-foto mp-bloco" style={{ height: 420, maxHeight: "52vw" }} />}
        <div className="space-y-2">
          {tx(c, "selo") && <span className="mp-pill">{tx(c, "selo")}</span>}
          <h1 className="mp-serif text-[46px] max-sm:text-[34px] leading-tight">{titulo}</h1>
          {p.apresentacao && <p className="text-[15px] whitespace-pre-wrap" style={{ color: C.suave }}>{p.apresentacao}</p>}
        </div>
        <Quadros itens={quadros} />
        {rota.length > 1 && (
          <div className="mp-card px-6 py-4 flex items-center gap-2 overflow-x-auto mp-bloco">
            {rota.map((r, n) => (
              <div key={n} className="contents">
                <div className="text-center flex-shrink-0">
                  <p className="mp-serif text-[21px] leading-none">{r[0]}</p>
                  <p className="text-[11px] mt-1" style={{ color: C.suave }}>{r[1]}</p>
                </div>
                {n < rota.length - 1 && (
                  <div className="flex-1 min-w-[90px] flex flex-col items-center">
                    <div className="w-full flex items-center"><span className="flex-1" style={{ borderTop: `1.5px dashed #9BC24B` }} /><span style={{ color: "#8DBA3C", fontSize: 11 }}>▶</span></div>
                    {r[2] && <p className="text-[11px] mt-0.5 whitespace-nowrap"><b>{r[2].split("·")[0].trim()}</b>{r[2].includes("·") ? ` · ${r[2].split("·").slice(1).join("·").trim()}` : ""}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <Quadros itens={resumoCapa} grande />
      </Folha>

      {/* 2 · Sumário e voos */}
      {(sumario.length > 0 || voos.length > 0) && (
        <Folha titulo={T} secao="Sumário e voos" rodape={rodape}>
          {sumario.length > 0 && (
            <div>
              <h2 className="mp-serif text-[22px]">Sumário da viagem</h2>
              {tx(c, "sumario_sub") && <p className="text-[13px] mt-1 mb-3" style={{ color: C.suave }}>{tx(c, "sumario_sub")}</p>}
              <div style={{ borderTop: `1px solid ${C.borda}` }}>
                {sumario.map((s, n) => (
                  <div key={n} className="grid grid-cols-[96px_1fr] py-2.5 text-[14px]" style={{ borderBottom: `1px solid ${C.borda}` }}>
                    <span className="font-bold" style={{ color: C.verde }}>{s.d}</span><span>{s.t}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {voos.length > 0 && (
            <div>
              <h2 className="mp-serif text-[22px]">Voos</h2>
              {tx(c, "voos_nota") && <p className="text-[13px] mt-1 mb-3 whitespace-pre-wrap" style={{ color: C.suave }}>{tx(c, "voos_nota")}</p>}
              <div className="overflow-x-auto">
                <table className="mp-tab">
                  <thead><tr><th>Trecho</th><th>Voo</th><th>Saída</th><th>Chegada</th><th style={{ textAlign: "right" }}>Duração</th></tr></thead>
                  <tbody>
                    {voos.map((l, n) => l.tipo === "grupo" ? <tr key={n} className="mp-grupo"><td colSpan={5}>{l.cols[0]}</td></tr>
                      : l.tipo === "nota" ? <tr key={n} className="mp-nota"><td colSpan={5}>{l.cols[0]}</td></tr>
                      : <tr key={n}><td>{l.cols[0]}</td><td>{l.cols[1]}</td><td>{l.cols[2]}</td><td>{l.cols[3]}</td><td style={{ textAlign: "right" }}>{l.cols[4]}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Folha>
      )}

      {/* 3 · Hospedagem */}
      {hoteis.map((h, n) => (
        <Folha key={n} titulo={T} secao="Hospedagem" rodape={rodape}>
          <div className="space-y-2">
            {h.selo && <span className="mp-pill">{h.selo}</span>}
            <h2 className="mp-serif text-[32px] max-sm:text-[25px] leading-tight">{h.nome}</h2>
            {h.descricao && <p className="text-[14px] whitespace-pre-wrap" style={{ color: C.suave }}>{h.descricao}</p>}
          </div>
          <Quadros grande itens={[h.checkin && { r: "Check-in", v: h.checkin }, h.checkout && { r: "Check-out", v: h.checkout }].filter(Boolean) as { r: string; v: string }[]} />
          {linhas(h.comodidades).length > 0 && (
            <div className="mp-card px-5 py-4 mp-bloco">
              <p className="mp-rot mb-2">{h.comodidades_rotulo || "No hotel"}</p>
              <Bolinhas itens={linhas(h.comodidades)} cols={3} />
            </div>
          )}
          <Fotos t={h.fotos} />
        </Folha>
      ))}

      {/* 4 · Dia a dia + Bom saber */}
      {(dias.length > 0 || bom.length > 0) && (
        <Folha titulo={T} secao="Dia a dia" rodape={rodape}>
          {dias.length > 0 && <h2 className="mp-serif text-[24px]">Dia a dia</h2>}
          {dias.map((d, n) => (
            <div key={n} className="space-y-4 pb-6" style={n < dias.length - 1 ? { borderBottom: `1px solid ${C.borda}` } : undefined}>
              <div className="grid grid-cols-[92px_1fr] max-sm:grid-cols-[70px_1fr] gap-5 mp-bloco">
                <div className="rounded-[12px] text-center py-3 self-start" style={{ background: C.escuro }}>
                  <p className="mp-serif text-[34px] leading-none" style={{ color: C.limao }}>{d.data ? Number(d.data.slice(8, 10)) : n + 1}</p>
                  <p className="text-[10px] font-bold uppercase mt-1.5" style={{ color: "#fff" }}>{mesNome(d.data)}</p>
                  <p className="text-[10.5px]" style={{ color: "#C9D4CE" }}>{diaSemana(d.data)}</p>
                </div>
                <div>
                  <h3 className="mp-serif text-[20px]">{d.titulo}</h3>
                  {d.subtitulo && <p className="text-[12.5px]" style={{ color: C.suave }}>{d.subtitulo}</p>}
                  <div className="mt-2 space-y-1.5">
                    {linhasDoDia(d.linhas).map((l, k) => (
                      <div key={k} className="grid grid-cols-[96px_1fr] max-sm:grid-cols-[72px_1fr] gap-2 text-[13.5px]">
                        <span className="font-bold" style={{ color: C.verde }}>{l.quando}</span><span>{l.texto}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <Fotos t={d.fotos} />
            </div>
          ))}
          {bom.length > 0 && (
            <div className="space-y-3">
              <h2 className="mp-serif text-[24px]">Bom saber</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {bom.map((b, n) => (
                  <div key={n} className="mp-painel px-5 py-4 mp-bloco">
                    <p className="mp-serif text-[16px] mb-2">{b.titulo}</p>
                    <Bolinhas itens={b.itens} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Folha>
      )}

      {/* 5 · Antes de ir */}
      {temAntes ? (
        <Folha titulo={T} secao="Antes de ir" rodape={rodape}>
          <div>
            <h2 className="mp-serif text-[24px]">Antes de ir</h2>
            <p className="text-[13px] mt-1" style={{ color: C.suave }}>{FIXO.antesDeIrSub}</p>
          </div>
          {clima.some(Boolean) && (
            <div className="space-y-3">
              {tx(c, "clima_titulo") && <h3 className="mp-serif text-[17px]">{tx(c, "clima_titulo")}</h3>}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {clima.map((v, n) => v && FIXO.climaRotulos[n] ? (
                  <div key={n} className="rounded-[12px] px-5 py-4 mp-bloco" style={{ background: C.escuro }}>
                    <p className="mp-serif text-[26px]" style={{ color: C.limao }}>{v}</p>
                    <p className="text-[10.5px] uppercase mt-1" style={{ color: "#C9D4CE" }}>{FIXO.climaRotulos[n]}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          )}
          {(tempo.length > 0 || mala.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {tempo.length > 0 && <div className="mp-card px-5 py-4"><p className="mp-serif text-[16px] mb-2">Como é o tempo</p><Bolinhas itens={tempo} /></div>}
              {mala.length > 0 && <div className="mp-card px-5 py-4"><p className="mp-serif text-[16px] mb-2">O que levar na mala</p><Bolinhas itens={mala} /></div>}
            </div>
          )}
          <FotoLarga url={c.antes_foto} />
        </Folha>
      ) : null}

      {/* 6 · Documentos e cancelamento */}
      {(docs.length > 0 || canc.length > 0) && (
        <Folha titulo={T} secao="Documentos e cancelamento" rodape={rodape}>
          {docs.length > 0 && (
            <div className="space-y-2">
              <h2 className="mp-serif text-[24px] mb-3">Documentos necessários</h2>
              <table className="mp-tab"><thead><tr><th style={{ width: "30%" }}>Documento</th><th>Detalhe</th></tr></thead>
                <tbody>{docs.map((x, n) => <tr key={n}><td className="font-bold">{x[0]}</td><td>{x.slice(1).join(" | ")}</td></tr>)}</tbody></table>
              {tx(c, "documentos_nota") && <p className="text-[12px]" style={{ color: C.suave }}>{tx(c, "documentos_nota")}</p>}
            </div>
          )}
          {canc.length > 0 && (
            <div className="space-y-2">
              <h2 className="mp-serif text-[24px] mb-3">Condições de cancelamento</h2>
              <table className="mp-tab"><thead><tr><th style={{ width: "30%" }}>Serviço</th><th style={{ width: "28%" }}>Cancelamento grátis até</th><th>Depois disso</th></tr></thead>
                <tbody>{canc.map((x, n) => <tr key={n}><td className="font-bold">{x[0]}</td><td>{x[1]}</td><td>{x[2]}</td></tr>)}</tbody></table>
              {tx(c, "cancelamento_nota") && <p className="text-[12px]" style={{ color: C.suave }}>{tx(c, "cancelamento_nota")}</p>}
            </div>
          )}
        </Folha>
      )}

      {/* 7 · Dicas locais */}
      {dicas.length > 0 && (
        <Folha titulo={T} secao="Dicas locais" rodape={rodape}>
          <h2 className="mp-serif text-[24px]">Dicas locais</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {dicas.map((d, n) => (
              <div key={n} className="mp-painel px-5 py-4 mp-bloco">
                <p className="mp-serif text-[16px] mb-1.5">{d[0]}</p>
                <p className="text-[13px]">{d.slice(1).join(" | ")}</p>
              </div>
            ))}
          </div>
          <FotoLarga url={c.dicas_foto} />
        </Folha>
      )}

      {/* 8 · Taxas e opcionais */}
      {(taxas.length > 0 || opcionais.length > 0) && (
        <Folha titulo={T} secao="Taxas e opcionais" rodape={rodape}>
          {taxas.length > 0 && (
            <div className="space-y-2">
              <span className="mp-pill">{FIXO.taxasSelo}</span>
              <h2 className="mp-serif text-[24px]">{FIXO.taxasTitulo}</h2>
              {tx(c, "taxas_sub") && <p className="text-[13px] mb-2" style={{ color: C.suave }}>{tx(c, "taxas_sub")}</p>}
              <table className="mp-tab"><thead><tr><th>Taxa</th><th style={{ width: "22%" }}>Quando</th><th style={{ width: "22%" }}>No pacote</th></tr></thead>
                <tbody>{taxas.map((x, n) => <tr key={n}><td>{x[0]}</td><td>{x[1]}</td><td style={/^inclus/i.test(x[2] ?? "") ? { color: C.verde, fontWeight: 700 } : undefined}>{x[2]}</td></tr>)}</tbody></table>
              {tx(c, "taxas_nota") && <p className="text-[12px]" style={{ color: C.suave }}>{tx(c, "taxas_nota")}</p>}
            </div>
          )}
          {opcionais.length > 0 && (
            <div className="space-y-3">
              <div><h2 className="mp-serif text-[24px]">Opcionais</h2><p className="text-[13px]" style={{ color: C.suave }}>{FIXO.opcionaisSub}</p></div>
              {opcionais.map((o, n) => (
                <div key={n} className="mp-card px-5 py-4 flex flex-wrap gap-4 items-center mp-bloco">
                  <div className="flex-1 min-w-[220px]">
                    {o[0] && <p className="mp-rot">{o[0]}</p>}
                    <p className="mp-serif text-[18px]">{o[1]}</p>
                    {o[2] && <p className="text-[13px]">{o[2]}</p>}
                  </div>
                  {o[3] && (
                    <div className="text-right">
                      <p className="mp-rot">Referência por pessoa</p>
                      <p className="mp-serif text-[28px]" style={{ color: C.verde }}>{o[3]}</p>
                      {o[4] && <p className="text-[12px]" style={{ color: C.suave }}>{o[4]}</p>}
                    </div>
                  )}
                </div>
              ))}
              {tx(c, "opcionais_aviso") && (
                <div className="mp-painel px-5 py-4 mp-bloco">
                  <p className="mp-serif text-[16px] mb-1">{tx(c, "opcionais_aviso_titulo") || "Consulte antes de incluir"}</p>
                  <p className="text-[13.5px]">{tx(c, "opcionais_aviso")}</p>
                </div>
              )}
            </div>
          )}
        </Folha>
      )}

      {/* 9 · Exclusivo Se Tu For */}
      {(exp.length > 0 || tx(c, "lider")) && (
        <Folha titulo={T} secao={FIXO.experienciaSelo} rodape={rodape}>
          <div className="space-y-2">
            <span className="mp-pill">{FIXO.experienciaSelo}</span>
            <h2 className="mp-serif text-[24px]">{FIXO.experienciaTitulo}</h2>
            <p className="text-[13px]" style={{ color: C.suave }}>{FIXO.experienciaSub}</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {exp.map((x, n) => (
              <div key={n} className="mp-card px-5 py-4 mp-bloco">
                <p className="mp-serif text-[16px] mb-1">{x[0]}</p>
                <p className="text-[13px]">{x.slice(1).join(" | ")}</p>
              </div>
            ))}
          </div>
          {tx(c, "lider") && (
            <div className="rounded-[12px] px-7 py-6 mp-bloco" style={{ background: C.escuro }}>
              <p className="text-[11px] uppercase" style={{ color: "#C9D4CE", letterSpacing: ".04em" }}>{FIXO.liderRotulo}</p>
              <p className="mp-serif text-[20px] mt-2" style={{ color: "#fff" }}>{tx(c, "lider")}</p>
            </div>
          )}
        </Folha>
      )}

      {/* 10 · Recapitulando */}
      {recap.length > 0 && (
        <Folha titulo={T} secao={FIXO.recapSelo} rodape={rodape}>
          <div className="space-y-2">
            <span className="mp-pill">{FIXO.recapSelo}</span>
            <h2 className="mp-serif text-[24px]">{FIXO.recapTitulo}</h2>
            {tx(c, "recap_sub") && <p className="text-[13px]" style={{ color: C.suave }}>{tx(c, "recap_sub")}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {recap.map((x, n) => {
              const destaque = x[0]?.startsWith("*");
              return (
                <div key={n} className={`px-5 py-4 rounded-[12px] mp-bloco ${destaque ? "" : "mp-painel"}`} style={destaque ? { border: `2px solid ${C.escuro}`, background: "#fff" } : undefined}>
                  <p className="mp-rot">{(x[0] ?? "").replace(/^\*\s*/, "")}</p>
                  <p className="mp-serif text-[17px]">{x[1]}</p>
                  {x[2] && <p className="text-[13px] mt-0.5">{x.slice(2).join(" | ")}</p>}
                </div>
              );
            })}
          </div>
          {recapNotas.map((l, n) => <p key={n} className={n === recapNotas.length - 1 && recapNotas.length > 1 ? "text-[11px]" : "text-[12px]"} style={{ color: C.suave }}>{l}</p>)}
        </Folha>
      )}

      {/* 11 · Investimento */}
      <Folha titulo={T} secao={FIXO.investimento} rodape={rodape}>
        <div>
          <p className="mp-rot">{FIXO.investimento}</p>
          {tx(c, "invest_titulo") && <h2 className="mp-serif text-[34px] max-sm:text-[26px] leading-tight mt-1">{tx(c, "invest_titulo")}</h2>}
          {tx(c, "invest_texto") && <p className="text-[14px] mt-1" style={{ color: C.suave }}>{tx(c, "invest_texto")}</p>}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(210px, 1fr))` }}>
          {p.opcoes.map((o) => {
            const t = totaisDaOpcao(o);
            const parc = parcelaDa(o, t.total);
            const ex = o.extra ?? {};
            return (
              <div key={o.id} className="rounded-[12px] px-5 py-5 flex flex-col mp-bloco" style={{ background: "#fff", border: o.recomendada ? `2px solid ${C.escuro}` : `1px solid ${C.borda}` }}>
                {ex.selo && <span className="mp-pill self-start mb-3">{ex.selo}</span>}
                {ex.rotulo && <p className="mp-rot">{ex.rotulo}</p>}
                <p className="mp-serif text-[19px] leading-snug">{o.titulo || "Sua viagem"}</p>
                {o.descricao && <p className="text-[12.5px]" style={{ color: C.suave }}>{o.descricao}</p>}
                {t.desconto > 0 && <p className="text-[12.5px] mt-3" style={{ color: C.suave }}>De <s>{brl(t.subtotal)}</s></p>}
                {!p.esconder_precos && parc && parc.n > 1 ? (
                  <div className="mt-3">
                    <p className="text-[13px]">{parc.n}x de</p>
                    <p className="mp-serif text-[30px] leading-none" style={{ color: C.verde }}>{brl(parc.valor)}</p>
                    <p className="text-[12px] mt-1" style={{ color: C.suave }}>{parc.texto}</p>
                  </div>
                ) : null}
                <div className="mt-auto pt-3" style={{ borderTop: `1px solid ${C.borda}`, marginTop: 14 }}>
                  <p className="text-[12.5px]" style={{ color: C.suave }}>{ex.total_rotulo || "Total"}</p>
                  <p className="font-bold text-[16px]">{brl(t.total)}</p>
                  {o.pagamentos.filter((x) => x.obs).map((x, k) => <p key={k} className="text-[12px]" style={{ color: C.suave }}>{x.obs}</p>)}
                </div>
                <BotaoEscolher pode={!!escolher} rotulo={p.opcoes.length > 1 ? "Quero esta opção" : "Quero esta proposta"} onClick={() => escolher?.(o)} />
              </div>
            );
          })}
        </div>
        {tx(c, "condicoes") && (
          <div className="mp-painel px-5 py-4 mp-bloco">
            <p className="mp-serif text-[16px] mb-1">Condições</p>
            <p className="text-[13.5px] whitespace-pre-wrap">{tx(c, "condicoes")}</p>
          </div>
        )}
        <Contato chamada={tx(c, "chamada")} />
        <p className="text-center text-[12px]" style={{ color: C.suave }}>Proposta preparada pela {FIXO.agencia} em {dataExtenso(p.data)}.</p>
      </Folha>
    </>
  );
}

function Contato({ chamada }: { chamada: string }) {
  return (
    <div className="rounded-[14px] px-6 py-8 text-center space-y-4 mp-bloco" style={{ background: C.escuro }}>
      {chamada && <p className="text-[11.5px] uppercase" style={{ color: "#C9D4CE", letterSpacing: ".05em" }}>{chamada}</p>}
      <p className="mp-serif text-[30px]" style={{ color: "#fff" }}>{FIXO.slogan}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <a href={`https://wa.me/${FIXO.telefone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="px-5 py-2 rounded-full text-[14px] font-bold" style={{ border: `1.5px solid ${C.limao}`, color: C.limao }}>{FIXO.telefone}</a>
        <a href={`mailto:${FIXO.email}`} className="px-5 py-2 rounded-full text-[14px] font-bold" style={{ border: `1.5px solid ${C.limao}`, color: C.limao }}>{FIXO.email}</a>
      </div>
    </div>
  );
}

/** "# Título\nitem\nitem" → cartões. */
function cartoesComTitulo(t: unknown): { titulo: string; itens: string[] }[] {
  const out: { titulo: string; itens: string[] }[] = [];
  for (const l of linhas(t)) {
    if (l.startsWith("#")) out.push({ titulo: l.replace(/^#+\s*/, ""), itens: [] });
    else if (out.length) out[out.length - 1].itens.push(l);
  }
  return out.filter((x) => x.itens.length);
}

// ── SERVIÇOS ────────────────────────────────────────────────────────────────
function Servicos({ p, escolher }: { p: PropostaVM; escolher?: (o: Opcao) => void }) {
  const c = p.conteudo ?? {};
  const o = p.opcoes[0];
  const itens = o?.itens ?? [];
  const n = paxTotal(p);
  const resumo = resumoServicos(itens);
  const infos = tabela(c.infos).filter((x) => x[0] || x[1]);
  const ida = tabela(c.ida), volta = tabela(c.retorno);
  const rot = roteiroServicos(c.roteiro);
  const periodo = p.data_ida ? (p.data_volta ? `${ddmm(p.data_ida)} a ${ddmmaaaa(p.data_volta)}` : ddmmaaaa(p.data_ida)) : "";
  const reais = (v: number) => brl(v);
  const espaco = (s: string) => ({ letterSpacing: s });

  const Sec = ({ num, titulo, extra }: { num: number; titulo: string; extra?: string }) => (
    <div className="flex items-center gap-3 mb-3">
      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold" style={{ background: C.limao, color: C.escuro }}>{num}</span>
      <h2 className="text-[22px] font-bold" style={{ color: C.escuro }}>{titulo}{extra && <span className="font-normal" style={{ color: C.suave }}> · {extra}</span>}</h2>
    </div>
  );
  const Barra = ({ rotulo, l }: { rotulo: string; l: string[][] }) => l.length ? (
    <div className="rounded-[14px] px-5 py-4 flex items-center gap-4 mp-bloco" style={{ background: C.escuro, color: "#fff" }}>
      <span className="px-4 py-1 rounded-full text-[11px] font-bold" style={{ background: C.limao, color: C.escuro, ...espaco(".2em") }}>{rotulo}</span>
      <div className="flex-1 space-y-1">
        {l.map((x, k) => (
          <p key={k} className="flex flex-wrap items-baseline gap-x-4">
            <span className="text-[13px]" style={{ color: C.limao }}>{x[0]}</span>
            <span className="text-[17px] font-bold">{x[1]}</span>
            {x[2] && <span className="text-[12.5px]" style={{ color: "#C9D4CE" }}>{x[2]}</span>}
          </p>
        ))}
      </div>
    </div>
  ) : null;
  const Dia = ({ d }: { d: { n: number; data: string; titulo: string; texto: string; sugestao: boolean } }) => (
    <div className="grid grid-cols-[110px_1fr] max-sm:grid-cols-[80px_1fr] gap-3 px-5 py-3" style={{ borderTop: `1px solid ${C.borda}` }}>
      <div>
        <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background: C.tagServ }}>D{d.n}</span>
        <p className="text-[12.5px] mt-1" style={{ color: C.suave }}>{/^\d{4}-\d{2}-\d{2}$/.test(d.data) ? diaCurto(d.data) : d.data}</p>
      </div>
      <div>
        <p className="text-[13.5px] font-medium" style={{ color: C.escuro }}>{d.titulo}
          {d.sugestao && <span className="ml-2 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase" style={{ background: C.limao, color: C.escuro, ...espaco(".12em") }}>{FIXO.servSugestao}</span>}
        </p>
        {d.texto && <p className="text-[14px]" style={{ color: C.suave }}>{d.texto}</p>}
      </div>
    </div>
  );

  return (
    <div className="mp-grot mp-folha" style={{ background: C.fundoServ }}>
      {/* Capa */}
      <header className="px-[72px] max-sm:px-5 pt-10 pb-8" style={{ background: C.escuro, color: "#fff" }}>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-[21px] font-extrabold">Se Tu For, <span style={{ color: C.limao }}>Eu Vou!</span></p>
            <p className="text-[11px]" style={{ ...espaco(".3em"), color: "#C9D4CE" }}>VIAGENS</p>
          </div>
          {tx(c, "selo") && <span className="px-4 py-1.5 rounded-full text-[11px] font-bold uppercase" style={{ background: C.limao, color: C.escuro, ...espaco(".2em") }}>{tx(c, "selo")}</span>}
        </div>
        {tx(c, "cidades") && <p className="text-[12.5px] font-bold uppercase mt-8" style={{ color: C.limao, ...espaco(".25em") }}>{tx(c, "cidades")}</p>}
        <h1 className="text-[44px] max-sm:text-[32px] font-extrabold leading-tight mt-1">{tituloDaProposta(p)}</h1>
        {p.apresentacao && <p className="text-[16px] max-w-[640px] mt-2 whitespace-pre-wrap" style={{ color: "#D5DED9" }}>{p.apresentacao}</p>}
        <div className="flex flex-wrap gap-x-10 gap-y-3 mt-7 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,.18)" }}>
          {n > 0 && <div><p className="text-[11px]" style={{ ...espaco(".2em"), color: "#C9D4CE" }}>GRUPO</p><p className="text-[21px] font-bold">{n} passageiro{n === 1 ? "" : "s"}</p></div>}
          {periodo && <div><p className="text-[11px]" style={{ ...espaco(".2em"), color: "#C9D4CE" }}>SERVIÇOS</p><p className="text-[21px] font-bold">{periodo}</p></div>}
          <div><p className="text-[11px]" style={{ ...espaco(".2em"), color: "#C9D4CE" }}>VALORES</p><p className="text-[21px] font-bold">{FIXO.servValores}</p></div>
        </div>
      </header>

      <div className="px-[72px] max-sm:px-4 py-8 space-y-10">
        {/* 1 */}
        {itens.length > 0 && (
          <section>
            <Sec num={1} titulo={FIXO.servSec1} />
            <div className="space-y-4">
              {tx(c, "nota_valores") && <div className="mp-card px-5 py-4 text-[14px]"><b>{FIXO.servValoresIndividuais}</b> {tx(c, "nota_valores")}</div>}
              {itens.map((i, k) => {
                const d = i.detalhes as DetalhesServico;
                const alts = alternativas(d.alternativas);
                const eyebrow = [d.local, i.data_inicio ? diaCurto(i.data_inicio) : d.data_rotulo, d.nota_dia].filter(Boolean).join(" · ");
                return (
                  <div key={k} className="mp-card px-6 py-5 mp-bloco">
                    {eyebrow && <p className="text-[11.5px] uppercase" style={{ color: C.suave, ...espaco(".2em") }}>{eyebrow}</p>}
                    <h3 className="text-[21px] font-bold" style={{ color: C.escuro }}>{i.nome}</h3>
                    {(d.alternativas_intro || i.descricao) && <p className="text-[14px] whitespace-pre-wrap" style={{ color: C.suave }}>{alts.length ? d.alternativas_intro || i.descricao : i.descricao}</p>}
                    {alts.length > 0 ? (
                      <div className="grid sm:grid-cols-2 gap-4 mt-4">
                        {alts.map((a, j) => (
                          <div key={j} className="rounded-[12px] px-5 py-4 flex flex-col" style={a.destaque ? { background: C.escuro, color: "#fff" } : { border: `1px solid ${C.borda}`, background: "#fff" }}>
                            <span className="self-start px-3 py-1 rounded-full text-[11px] font-bold uppercase" style={{ background: C.limao, color: C.escuro, ...espaco(".15em") }}>{a.rotulo}</span>
                            <p className="text-[13.5px] mt-3 whitespace-pre-wrap" style={{ color: a.destaque ? "#D5DED9" : C.suave }}><Negrito t={a.texto} /></p>
                            <div className="flex items-end justify-between mt-auto pt-4" style={{ borderTop: `1px solid ${a.destaque ? "rgba(255,255,255,.18)" : C.borda}`, marginTop: 16 }}>
                              <span className="text-[13px]">{FIXO.servPorPessoa}</span>
                              <span className="text-[26px] font-extrabold" style={{ color: a.destaque ? C.limao : C.escuro }}>{reais(a.valor)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between pt-3 mt-3" style={{ borderTop: `1px solid ${C.borda}` }}>
                        <span className="text-[13px]" style={{ color: C.suave }}>{FIXO.servPorPessoa}</span>
                        {i.incluso ? <span className="px-3 py-1 rounded-full text-[14px] font-medium" style={{ background: C.tagServ, color: C.escuro }}>{FIXO.servPrevisto}</span>
                          : <span className="text-[28px] font-extrabold" style={{ color: C.escuro }}>{reais(i.valor_total)}</span>}
                      </div>
                    )}
                    {(d.opcional_rotulo || d.opcional_texto) && (
                      <div className="rounded-[10px] px-4 py-3 mt-4" style={{ border: `1.5px dashed ${C.suave}` }}>
                        {d.opcional_rotulo && <p className="text-[11.5px] uppercase font-bold" style={{ color: C.escuro, ...espaco(".2em") }}>{d.opcional_rotulo}</p>}
                        <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                          <span className="text-[13.5px]">{d.opcional_texto}</span>
                          {d.opcional_valor && <span className="text-[19px] font-extrabold" style={{ color: C.escuro }}>+ {reais(numeroBr(d.opcional_valor))} por pessoa</span>}
                        </div>
                        {d.opcional_nota && <p className="text-[13px]" style={{ color: C.suave }}>{d.opcional_nota}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 2 */}
        {resumo.length > 0 && (
          <section>
            <Sec num={2} titulo={FIXO.servSec2} />
            <div className="mp-card overflow-hidden mp-bloco">
              <div className="flex justify-between px-5 py-3 text-[11.5px] uppercase" style={{ background: "#EEF1EE", color: C.suave, ...espaco(".2em") }}>
                <span>{FIXO.servResumoCols[0]}</span><span>{FIXO.servResumoCols[1]}</span>
              </div>
              {resumo.map((r, k) => (
                <div key={k} className="flex items-center gap-3 px-5 py-3 text-[14px]" style={{ borderTop: `1px solid ${C.borda}` }}>
                  <span className="px-2 py-0.5 rounded-md text-[12px] font-bold" style={{ background: C.tagServ }}>{r.tag}</span>
                  <span className="flex-1">{r.texto}</span>
                  <span className="tabular-nums">{r.valor}</span>
                </div>
              ))}
            </div>
            {tx(c, "pagamento") && (
              <div className="rounded-[12px] px-5 py-4 mt-4 mp-bloco" style={{ background: C.limao, color: C.escuro }}>
                <p className="text-[11.5px] font-bold uppercase" style={espaco(".2em")}>{FIXO.servFormaPagamento}</p>
                <p className="text-[14px] mt-1">{tx(c, "pagamento")}</p>
              </div>
            )}
            {tx(c, "nota_resumo") && <p className="text-[14px] mt-2 whitespace-pre-wrap" style={{ color: C.suave }}>{tx(c, "nota_resumo")}</p>}
            <BotaoEscolher pode={!!escolher && !!o} rotulo="Quero seguir com estes serviços" onClick={() => o && escolher?.(o)} />
          </section>
        )}

        {/* 3 */}
        {(infos.length > 0 || tx(c, "infos_nota")) && (
          <section>
            <Sec num={3} titulo={FIXO.servSec3} />
            <div className="grid sm:grid-cols-2 gap-3">
              {infos.map((x, k) => (
                <div key={k} className="mp-card px-5 py-4 mp-bloco">
                  <p className="text-[11.5px] uppercase" style={{ color: C.suave, ...espaco(".2em") }}>{x[0]}</p>
                  <p className="text-[15px] mt-1">{x.slice(1).join(" | ")}</p>
                </div>
              ))}
            </div>
            {tx(c, "infos_nota") && <p className="text-[14px] mt-2" style={{ color: C.suave }}>{tx(c, "infos_nota")}</p>}
          </section>
        )}

        {/* 4 */}
        {(rot.totalDias > 0 || ida.length > 0) && (
          <section className="space-y-3">
            <Sec num={4} titulo={FIXO.servSec4} extra={rot.totalDias ? `${rot.totalDias} dias` : undefined} />
            <p className="text-[14px] -mt-2" style={{ color: C.suave }}>{FIXO.servRoteiroSub}</p>
            <Barra rotulo="IDA" l={ida} />
            {rot.blocos.map((b, k) => b.tipo === "cidade" ? (
              <div key={k} className="mp-card overflow-hidden">
                {(b.cidade || b.hotel) && (
                  <div className="flex flex-wrap justify-between items-baseline gap-2 px-5 py-3" style={{ background: "#EEF1EE" }}>
                    <span className="text-[19px] font-bold" style={{ color: C.escuro }}>{b.cidade}</span>
                    <span className="text-[13.5px]" style={{ color: C.suave }}>{b.hotel}</span>
                  </div>
                )}
                {b.dias.map((d) => <Dia key={d.n} d={d} />)}
              </div>
            ) : (
              <div key={k} className="rounded-[12px] px-5 py-3 text-[13px] flex items-start gap-3" style={{ border: `1.5px dashed ${C.borda}`, background: "#fff" }}>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold" style={{ background: C.limao }}>D{b.dia.n}</span>
                <p><b>{[/^\d{4}-\d{2}-\d{2}$/.test(b.dia.data) ? diaCurto(b.dia.data) : b.dia.data, b.dia.titulo].filter(Boolean).join(" · ")}</b>{b.dia.texto ? ` · ${b.dia.texto}` : ""}
                  {b.dia.sugestao && <span className="ml-2 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase" style={{ background: C.limao, ...espaco(".12em") }}>{FIXO.servSugestao}</span>}</p>
              </div>
            ))}
            <Barra rotulo="RETORNO" l={volta} />
          </section>
        )}
      </div>
    </div>
  );
}

// ── SEGURO ──────────────────────────────────────────────────────────────────
interface Plano { o: Opcao; nome: string; sub: string; selo: string; grupo: number; medica: string; pax: number; total: number; recomendado: boolean }

function Seguro({ p, rodape, escolher }: { p: PropostaVM; rodape: string; escolher?: (o: Opcao) => void }) {
  const c = p.conteudo ?? {};
  const T = MODELOS.seguro.cabecalho;
  const segs = (Array.isArray(c.seguradoras) ? c.seguradoras : []) as SeguradoraModelo[];
  const pax = Math.max(1, paxTotal(p));
  const planos: Plano[] = p.opcoes.map((o) => {
    const t = totaisDaOpcao(o).total;
    const item = o.itens.find((i) => i.tipo === "seguro") ?? o.itens[0];
    const ex = o.extra ?? {};
    return {
      o, nome: o.titulo || "Plano", sub: o.descricao, selo: ex.selo ?? "", grupo: Math.max(0, Math.min(Number(ex.grupo) || 0, Math.max(0, segs.length - 1))),
      medica: String(item?.detalhes?.cobertura ?? ""), total: t, pax: ex.preco_pax != null && Number(ex.preco_pax) > 0 ? Number(ex.preco_pax) : t / pax, recomendado: o.recomendada,
    };
  }).sort((a, b) => a.grupo - b.grupo); // colunas do comparativo agrupadas por seguradora (sort é estável)
  const grupos = (segs.length ? segs : [{ nome: "", nota: "", coberturas: "", rodape: "" }]).map((s, g) => ({ s, g, planos: planos.filter((x) => x.grupo === g) })).filter((x) => x.planos.length);
  const nomeSeg = (g: number) => segs[g]?.nome || "";
  const faixa = [p.destino, periodoCurto(p.data_ida, p.data_volta)].filter(Boolean).join(" · ");
  const dur = diasInclusivos(p.data_ida, p.data_volta);
  const sub = p.apresentacao.trim() || `${extenso(planos.length)} ${planos.length === 1 ? "opção" : "opções"} de seguro viagem para ${pax} passageiro${pax === 1 ? "" : "s"}${grupos.length > 1 ? `, de ${extenso(grupos.length).toLowerCase()} seguradoras` : ""}, com assistência 24h.`;
  const comp = tabela(c.comparativo).filter((x) => x[0] && x.slice(1).some(Boolean));
  const notasComp = linhas(c.comparativo_notas);
  const rec = planos.find((x) => x.recomendado);
  const motivos = linhas(c.rec_motivos);
  const cores = [C.escuro, C.teal];
  const naoInclui = (v: string) => /^n[ãa]o inclui|^—$|^-$/i.test(v.trim());

  const CartaoPlano = ({ x }: { x: Plano }) => (
    <div className="rounded-[12px] px-5 py-4 flex flex-col mp-bloco" style={{ background: "#fff", border: x.recomendado ? `2px solid ${C.escuro}` : `1px solid ${C.borda}` }}>
      <div className="min-h-[26px]">
        {(x.selo || x.recomendado) && (
          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={x.recomendado ? { background: C.limao, color: C.escuro } : { background: C.escuro, color: "#fff" }}>{x.selo || "Recomendado"}</span>
        )}
      </div>
      <p className="font-bold text-[17px] mt-2">{x.nome}</p>
      {x.sub && <p className="text-[11.5px]" style={{ color: C.suave }}>{x.sub}</p>}
      {x.medica && <><p className="text-[12px] mt-3" style={{ color: C.suave }}>Assistência médica</p><p className="font-bold text-[15px]">{x.medica}</p></>}
      <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${C.borda}` }}>
        <p className="text-[12px]" style={{ color: C.suave }}>Por passageiro</p>
        <p className="mp-serif text-[24px]" style={x.recomendado ? { color: C.verde } : undefined}>{brl(x.pax)}</p>
        <p className="text-[11.5px]" style={{ color: C.suave }}>Total ({pax} pax): {brl(x.total)}</p>
      </div>
      <BotaoEscolher pode={!!escolher} rotulo="Quero este plano" onClick={() => escolher?.(x.o)} />
    </div>
  );

  return (
    <>
      {/* 1 · Capa com os planos */}
      <Folha titulo={T} secao={faixa} rodape={rodape}>
        <div>
          <p className="mp-rot">{FIXO.seguroPreparado}</p>
          <h1 className="mp-serif text-[36px] max-sm:text-[28px] leading-tight">{p.cliente_nome || tituloDaProposta(p)}</h1>
          <p className="text-[14px]" style={{ color: C.suave }}>{sub}</p>
        </div>
        <Quadros itens={[
          p.destino && { r: "Destino", v: p.destino }, p.data_ida && { r: "Embarque", v: ddmmaaaa(p.data_ida) }, p.data_volta && { r: "Retorno", v: ddmmaaaa(p.data_volta) },
          dur > 0 && { r: "Duração", v: `${dur} dias` }, { r: "Passageiros", v: textoPassageiros(p) || `${pax}` },
        ].filter(Boolean) as { r: string; v: string }[]} />
        {grupos.map(({ s, g, planos: ps }, k) => (
          <div key={g} className="space-y-3">
            <div>
              <h2 className="mp-serif text-[20px]">Opção {k + 1}{s.nome ? ` · ${s.nome}` : ""}</h2>
              {s.nota && <p className="text-[12.5px]" style={{ color: C.suave }}>{s.nota}</p>}
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>{ps.map((x, n) => <CartaoPlano key={n} x={x} />)}</div>
          </div>
        ))}
        {(tx(c, "condicoes_pagamento") || tx(c, "validade")) && (
          <div className="mp-painel px-5 py-4 mp-bloco">
            <p className="font-bold text-[14px] mb-1">Condições</p>
            <p className="text-[13px]">
              {tx(c, "condicoes_pagamento") && <><b>Pagamento:</b> {tx(c, "condicoes_pagamento")} </>}
              {tx(c, "validade") && <><b>Validade:</b> {tx(c, "validade")} </>}
              {FIXO.seguroCondicoes}
            </p>
          </div>
        )}
      </Folha>

      {/* 2 · Comparativo */}
      {comp.length > 0 && planos.length > 0 && (
        <Folha titulo={T} secao={FIXO.seguroComparativoSec} rodape={rodape}>
          <div>
            <h2 className="mp-serif text-[20px]">As {planos.length} opções lado a lado</h2>
            <p className="text-[12.5px]" style={{ color: C.suave }}>Valores das coberturas em dólar (US$). Totais para os {pax} passageiros.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="mp-tab" style={{ fontSize: 12 }}>
              <thead>
                {grupos.length > 1 && (
                  <tr><th style={{ background: "#fff" }} />{grupos.map(({ g, planos: ps }) => <th key={g} colSpan={ps.length} style={{ background: cores[g % 2], textAlign: "center" }}>{nomeSeg(g)}</th>)}</tr>
                )}
                <tr>
                  <th style={{ background: C.painel, color: C.tinta }}>Cobertura</th>
                  {planos.map((x, n) => <th key={n} style={{ background: C.painel, color: C.tinta, textAlign: "center" }}>{x.nome}</th>)}
                </tr>
              </thead>
              <tbody>
                {comp.map((r, k) => <tr key={k}><td>{r[0]}</td>{planos.map((_, n) => <td key={n} style={{ textAlign: "center" }}>{r[n + 1] || "—"}</td>)}</tr>)}
                <tr style={{ background: C.painel }}><td className="font-bold">Por passageiro (R$)</td>{planos.map((x, n) => <td key={n} className="font-bold" style={{ textAlign: "center" }}>{brl(x.pax).replace("R$", "").trim()}</td>)}</tr>
                <tr style={{ background: C.painel }}><td className="font-bold">Total {pax} passageiros (R$)</td>{planos.map((x, n) => <td key={n} className="font-bold" style={{ textAlign: "center", color: C.verde }}>{brl(x.total).replace("R$", "").trim()}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {notasComp.length > 0 && <div className="space-y-2">{notasComp.map((l, n) => <p key={n} className="text-[12.5px]" style={{ color: C.suave }}><Negrito t={l} /></p>)}</div>}
        </Folha>
      )}

      {/* 3 · Coberturas completas de cada seguradora */}
      {grupos.map(({ s, g, planos: ps }) => {
        const rows = tabelaComGrupos(s.coberturas).filter((l) => l.tipo === "linha" && l.cols[0]);
        if (!rows.length) return null;
        return (
          <Folha key={g} titulo={T} secao={`${s.nome || "Seguradora"} · ${FIXO.seguroCompletasSec}`} rodape={rodape}>
            <div className="overflow-x-auto">
              <table className="mp-tab" style={{ fontSize: 12 }}>
                <thead><tr><th style={{ background: cores[g % 2] }}>Cobertura</th>{ps.map((x, n) => <th key={n} style={{ background: cores[g % 2], textAlign: "center" }}>{x.nome}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, k) => (
                    <tr key={k}><td style={{ padding: "6px 14px" }}>{r.cols[0]}</td>
                      {ps.map((_, n) => { const v = r.cols[n + 1] ?? ""; return <td key={n} style={{ textAlign: "center", padding: "6px 14px", color: naoInclui(v) ? "#8E9897" : undefined }}>{v || "—"}</td>; })}
                    </tr>
                  ))}
                  <tr style={{ background: C.painel, borderTop: `2px solid ${C.escuro}` }}><td className="font-bold">Valor por passageiro</td>{ps.map((x, n) => <td key={n} className="font-bold" style={{ textAlign: "center" }}>{brl(x.pax)}</td>)}</tr>
                  <tr style={{ background: C.painel }}><td className="font-bold">Valor total ({pax} passageiros)</td>{ps.map((x, n) => <td key={n} className="font-bold" style={{ textAlign: "center", color: C.verde }}>{brl(x.total)}</td>)}</tr>
                </tbody>
              </table>
            </div>
            {s.rodape && <p className="text-[12px]" style={{ color: C.suave }}>{s.rodape}</p>}
          </Folha>
        );
      })}

      {/* 4 · Nossa recomendação */}
      {rec && (
        <Folha titulo={T} secao={FIXO.seguroRecSec} rodape={rodape}>
          <div>
            <p className="mp-rot">{FIXO.seguroRecEyebrow}</p>
            <h2 className="mp-serif text-[34px] max-sm:text-[26px] leading-tight">{[nomeSeg(rec.grupo), rec.nome].filter(Boolean).join(" ")}</h2>
            {tx(c, "rec_sub") && <p className="text-[14px]" style={{ color: C.suave }}>{tx(c, "rec_sub")}</p>}
          </div>
          <div className="rounded-[14px] px-7 py-6 grid sm:grid-cols-3 gap-4 mp-bloco" style={{ background: C.escuro, color: "#fff" }}>
            {rec.medica && <div><p className="text-[11px] uppercase" style={{ color: "#C9D4CE" }}>Assistência médica</p><p className="mp-serif text-[26px]" style={{ color: "#fff" }}>{rec.medica}</p></div>}
            <div><p className="text-[11px] uppercase" style={{ color: "#C9D4CE" }}>Por passageiro</p><p className="mp-serif text-[26px]" style={{ color: C.limao }}>{brl(rec.pax)}</p></div>
            <div><p className="text-[11px] uppercase" style={{ color: "#C9D4CE" }}>Total ({pax} passageiros)</p><p className="mp-serif text-[26px]" style={{ color: "#fff" }}>{brl(rec.total)}</p></div>
          </div>
          {motivos.length > 0 && <div className="space-y-3"><h3 className="mp-serif text-[19px]">{FIXO.seguroPorque}</h3><Bolinhas itens={motivos} /></div>}
          {(tx(c, "rec_alt_titulo") || tx(c, "rec_alt_texto")) && (
            <div className="mp-painel px-6 py-5 mp-bloco">
              {tx(c, "rec_alt_titulo") && <p className="font-bold text-[15px] mb-1">{tx(c, "rec_alt_titulo")}</p>}
              <p className="text-[13.5px]"><Negrito t={tx(c, "rec_alt_texto")} /></p>
            </div>
          )}
          <div>
            <p className="text-[14px]">{FIXO.seguroFecho}</p>
            <p className="text-[11.5px]" style={{ color: C.suave }}>{FIXO.seguroCambio}</p>
          </div>
          <BotaoEscolher pode={!!escolher} rotulo={`Quero o ${rec.nome}`} onClick={() => escolher?.(rec.o)} />
        </Folha>
      )}
    </>
  );
}

// ── A página ────────────────────────────────────────────────────────────────
export default function ModeloView({ p, onEscolher, previa = false }: {
  p: PropostaVM;
  onEscolher?: (opcaoId: string, nome: string) => Promise<void>;
  previa?: boolean;
}) {
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [nome, setNome] = useState(p.cliente_nome || "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const modelo = p.modelo ?? "pacote";
  const podeEscolher = !!onEscolher && p.status === "enviada" && !p.aprovada_opcao_id;
  const aprovada = p.opcoes.find((o) => o.id === p.aprovada_opcao_id);
  const zap = p.consultor?.whatsapp ? `https://wa.me/${p.consultor.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Estou vendo a proposta nº ${p.numero} (${tituloDaProposta(p)}).`)}` : null;
  const rodape = modelo === "seguro" && tx(p.conteudo ?? {}, "rodape") ? tx(p.conteudo ?? {}, "rodape") : `${FIXO.agencia} · Proposta de ${ddmmaaaa(p.data) || ddmmaaaa(new Date().toISOString())}`;
  const escolher = podeEscolher ? (o: Opcao) => { setErro(null); setEscolhendo(o.id); } : undefined;
  const varias = p.opcoes.length > 1;

  async function confirmar() {
    if (!escolhendo || !onEscolher) return;
    if (nome.trim().length < 3) { setErro("Escreva seu nome completo."); return; }
    setEnviando(true); setErro(null);
    try { await onEscolher(escolhendo, nome.trim()); setEscolhendo(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não conseguimos registrar agora. Tente de novo."); }
    setEnviando(false);
  }

  return (
    <div className="mp">
      <style>{css(rodape)}</style>
      <div className="mp-nao-imprime sticky top-0 z-10 border-b" style={{ background: "rgba(255,255,255,.95)", borderColor: C.borda, backdropFilter: "blur(6px)" }}>
        <div className="max-w-[900px] mx-auto px-4 py-2.5 flex items-center gap-3">
          <p className="flex-1 min-w-0 truncate text-[13px] font-bold" style={{ color: C.suave }}>{p.numero > 0 ? `Proposta nº ${p.numero}` : MODELOS[modelo].cabecalho}</p>
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="text-[13px] font-bold px-3 py-1.5 rounded-full" style={{ background: C.limao, color: C.escuro }}>WhatsApp</a>}
          <button type="button" onClick={() => window.print()} className="text-[13px] font-bold px-3 py-1.5 rounded-full border" style={{ borderColor: C.borda, color: C.escuro, background: "#fff" }}>Baixar PDF</button>
        </div>
      </div>
      {previa && <p className="mp-nao-imprime text-center text-[12.5px] py-2" style={{ background: "#FFF7E0", color: "#7A5A00" }}>Prévia — é assim que o cliente vê. Custo, lucro, fornecedor e localizador não aparecem.</p>}
      {aprovada && (
        <p className="mp-nao-imprime max-w-[900px] mx-auto my-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={{ background: C.painel, color: C.verde }}>
          {varias ? `${aprovada.titulo || "Opção escolhida"} — escolhida` : "Proposta aprovada"}
          {p.aprovada_em ? ` em ${new Date(p.aprovada_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}. Nosso time já foi avisado e vai seguir com você.
        </p>
      )}
      <div className="py-4 max-sm:py-0">
        {modelo === "pacote" && <Pacote p={p} rodape={rodape} escolher={escolher} />}
        {modelo === "servicos" && <Servicos p={p} escolher={escolher} />}
        {modelo === "seguro" && <Seguro p={p} rodape={rodape} escolher={escolher} />}
      </div>

      {escolhendo && (
        <div className="mp-nao-imprime fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Confirmar escolha">
          <div className="absolute inset-0" style={{ background: "rgba(10,42,43,.55)" }} onClick={() => !enviando && setEscolhendo(null)} />
          <div className="relative w-full max-w-[440px] rounded-t-2xl sm:rounded-2xl p-5 space-y-4" style={{ background: "#fff" }}>
            <h2 className="mp-serif text-[20px]">{varias ? `Confirmar ${p.opcoes.find((o) => o.id === escolhendo)?.titulo || "esta opção"}?` : "Confirmar esta proposta?"}</h2>
            <p className="text-[13.5px]" style={{ color: C.suave }}>Nosso time recebe o aviso na hora e entra em contato para confirmar a reserva e o pagamento. Ainda não é cobrança.</p>
            <label className="block">
              <span className="block text-[13px] font-bold mb-1">Seu nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className="w-full px-3 py-2.5 rounded-xl border text-[15px]" style={{ borderColor: C.borda }} />
            </label>
            {erro && <p className="text-[13px]" style={{ color: "#B4242A" }}>{erro}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 text-[14px] font-bold" onClick={() => setEscolhendo(null)} disabled={enviando}>Voltar</button>
              <button type="button" className="mp-botao" onClick={() => void confirmar()} disabled={enviando}>{enviando ? "Enviando…" : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
