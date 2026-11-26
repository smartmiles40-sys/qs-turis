// src/propostas/ModeloEditor.tsx
// -----------------------------------------------------------------------------
// Editor dos 3 MODELOS-PADRÃO (0280, Bruno 03/11/2026): pede exatamente o que
// cada PDF-padrão mostra, na mesma ordem das seções. Os dados da viagem
// (título, cliente, destino, datas, passageiros, foto da capa, apresentação)
// continuam no cartão "A viagem" do PropostaEditor; aqui ficam:
//   · as seções de texto do modelo (SECOES em modelos.ts);
//   · pacote   → hotéis, dia a dia e os cartões de preço (= opções);
//   · servicos → os serviços (= itens da opção única), valor por pessoa;
//   · seguro   → seguradoras e os planos de cada uma (= opções).
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import {
  ORDEM_TIPOS, TIPOS, brl, itemVazio, novaChave, opcaoVazia, pagamentoVazio, totaisDaOpcao,
  type ItemProposta, type OpcaoProposta, type Proposta, type TipoItem,
} from "./lib";
import {
  MODELOS, SECOES, conteudoInicial, diaVazio, hotelVazio, numeroBr, seguradoraVazia,
  type CampoModelo, type Conteudo, type DetalhesServico, type DiaPacote, type ExtraOpcao, type HotelPacote, type ModeloProposta, type SeguradoraModelo,
} from "./modelos";

const area = "rel-input";
const numero = (v: string) => (v.trim() === "" ? 0 : numeroBr(v));
const numeroOuNulo = (v: string) => (v.trim() === "" ? null : numeroBr(v));
const pax = (p: Proposta) => (p.adultos || 0) + (p.criancas || 0) + (p.bebes || 0);

/** Muda o modelo: textos iniciais do modelo + opções no formato dele (itens preservados). */
export function aplicarModelo(p: Proposta, modelo: ModeloProposta | null): Partial<Proposta> {
  if (!modelo) return { modelo: null };
  const conteudo = conteudoInicial(modelo, { pax: pax(p), cliente: p.cliente_nome || p.titulo });
  let opcoes = p.opcoes.length ? p.opcoes : [opcaoVazia()];
  if (modelo === "pacote") {
    opcoes = opcoes.map((o, n) => ({
      ...o, itens: o.itens.length ? o.itens : [{ ...itemVazio("pacote", p), nome: "Pacote" }],
      extra: { rotulo: n === 0 ? "Quarto duplo · por pessoa" : "", total_rotulo: "Total por pessoa", ...o.extra },
      pagamentos: o.pagamentos.some((x) => x.condicao === "parcelado") ? o.pagamentos : [{ ...pagamentoVazio(), forma: "cartao", condicao: "parcelado", parcelas: 10 }],
    }));
  } else if (modelo === "servicos") {
    const todos = opcoes.flatMap((o) => o.itens);
    opcoes = [{ ...opcoes[0], titulo: opcoes[0].titulo || "Serviços", itens: todos }];
  } else {
    opcoes = opcoes.map((o) => ({ ...o, extra: { grupo: 0, ...o.extra }, itens: o.itens.length ? o.itens : [{ ...itemVazio("seguro", p), nome: o.titulo || "Seguro viagem" }] }));
  }
  return { modelo, conteudo: { ...conteudo, ...(p.modelo === modelo ? p.conteudo : {}) }, opcoes };
}

// ── Peças ───────────────────────────────────────────────────────────────────
export function CampoTexto({ c, valor, onChange }: { c: CampoModelo; valor: unknown; onChange: (v: string) => void }) {
  const v = String(valor ?? "");
  return (
    <Campo rotulo={c.rotulo} dica={c.dica}>
      {c.tipo === "texto" ? <Entrada value={v} placeholder={c.exemplo} onChange={(e) => onChange(e.target.value)} />
        : <textarea className={area} rows={c.linhas ?? 3} value={v} placeholder={c.exemplo} onChange={(e) => onChange(e.target.value)}
            style={c.tipo === "tabela" ? { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 } : undefined} />}
    </Campo>
  );
}

/** Seção que abre e fecha. 0290: `resumo` (uma linha quando fechada), `ia` (marca discreta) e `alerta` (nº de itens pra conferir: borda âmbar). */
export function Bloco({ titulo, dica, children, abertoInicial = false, resumo, ia, alerta = 0 }: { titulo: string; dica?: string; children: React.ReactNode; abertoInicial?: boolean; resumo?: string; ia?: boolean; alerta?: number }) {
  const [aberto, setAberto] = useState(abertoInicial);
  return (
    <section className="rel-card" style={alerta > 0 ? { borderColor: "var(--warn-line)", boxShadow: "0 0 0 1px var(--warn-line)" } : undefined}>
      <button type="button" className="w-full flex items-center gap-2 px-4 py-3 text-left" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 text-[14.5px] font-bold" style={{ color: "var(--ink)" }}>{titulo}{ia && <MarcaIa />}{alerta > 0 && <span className="text-[11px] font-semibold px-1.5 rounded-full" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{alerta} pra conferir</span>}</span>
          {resumo && !aberto && <span className="block truncate text-[12.5px] font-normal" style={{ color: "var(--ink3)" }}>{resumo}</span>}
        </span>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{aberto ? "▲" : "▼"}</span>
      </button>
      {aberto && (
        <div className="border-t px-4 py-4 space-y-3" style={{ borderColor: "var(--line)" }}>
          {dica && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{dica}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

/** "IA" pequeno ao lado do que veio do Montar com IA. */
export function MarcaIa({ titulo = "Preenchido pela IA a partir dos insumos" }: { titulo?: string }) {
  return <span title={titulo} aria-label={titulo} className="inline-flex items-center px-1.5 rounded text-[10px] font-bold tracking-wide" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>IA</span>;
}

function Mover({ n, total, onMover, onTirar }: { n: number; total: number; onMover: (de: number, para: number) => void; onTirar: () => void }) {
  return (
    <div className="flex gap-1 justify-end">
      {n > 0 && <Botao variante="fantasma" onClick={() => onMover(n, n - 1)} aria-label="Subir">▲</Botao>}
      {n < total - 1 && <Botao variante="fantasma" onClick={() => onMover(n, n + 1)} aria-label="Descer">▼</Botao>}
      <Botao variante="perigo" onClick={onTirar}>Tirar</Botao>
    </div>
  );
}
function mover<T>(l: T[], de: number, para: number): T[] { const c = [...l]; const [x] = c.splice(de, 1); c.splice(para, 0, x); return c; }

function CamposInternos({ i, onChange }: { i: ItemProposta; onChange: (c: Partial<ItemProposta>) => void }) {
  return (
    <div className="rounded-lg p-2.5 grid grid-cols-2 sm:grid-cols-3 gap-2" style={{ background: "var(--card2)" }}>
      <Campo rotulo="Custo (interno)"><Entrada inputMode="decimal" value={i.custo ?? ""} onChange={(e) => onChange({ custo: numeroOuNulo(e.target.value) })} /></Campo>
      <Campo rotulo="Fornecedor (interno)"><Entrada value={i.fornecedor} onChange={(e) => onChange({ fornecedor: e.target.value })} /></Campo>
      <Campo rotulo="Tipo (pra venda/Bitrix)">
        <select className={area} value={i.tipo} onChange={(e) => onChange({ tipo: e.target.value as TipoItem })}>
          {ORDEM_TIPOS.map((t) => <option key={t} value={t}>{TIPOS[t].rotulo}</option>)}
        </select>
      </Campo>
    </div>
  );
}

// ── Pacote ──────────────────────────────────────────────────────────────────
export function EditorHoteis({ hoteis, onChange }: { hoteis: HotelPacote[]; onChange: (h: HotelPacote[]) => void }) {
  const mudar = (n: number, c: Partial<HotelPacote>) => onChange(hoteis.map((h, k) => (k === n ? { ...h, ...c } : h)));
  return (
    <div className="space-y-3">
      {hoteis.map((h, n) => (
        <div key={n} className="rounded-lg p-3 space-y-2" style={{ background: "var(--card2)" }}>
          <div className="grid sm:grid-cols-[1fr_200px] gap-2">
            <Campo rotulo="Nome do hotel"><Entrada value={h.nome} placeholder="Hilton Cancun Mar Caribe All Inclusive Resort" onChange={(e) => mudar(n, { nome: e.target.value })} /></Campo>
            <Campo rotulo="Selo"><Entrada value={h.selo} placeholder="4 NOITES · ALL INCLUSIVE" onChange={(e) => mudar(n, { selo: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Endereço e quarto"><textarea className={area} rows={2} value={h.descricao} placeholder="Boulevard Kukulcán, Km 17… Quarto Resort View: cama queen no duplo e cama king no single." onChange={(e) => mudar(n, { descricao: e.target.value })} /></Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Check-in"><Entrada value={h.checkin} placeholder="Qua, 18/08 a partir das 15h" onChange={(e) => mudar(n, { checkin: e.target.value })} /></Campo>
            <Campo rotulo="Check-out"><Entrada value={h.checkout} placeholder="Dom, 22/08 até 12h" onChange={(e) => mudar(n, { checkout: e.target.value })} /></Campo>
          </div>
          <div className="grid sm:grid-cols-[160px_1fr] gap-2">
            <Campo rotulo="Rótulo das comodidades"><Entrada value={h.comodidades_rotulo} onChange={(e) => mudar(n, { comodidades_rotulo: e.target.value })} /></Campo>
            <Campo rotulo="Comodidades (uma por linha)"><textarea className={area} rows={3} value={h.comodidades} placeholder={"Comida e bebida inclusas\nPraia com guarda-sol e espreguiçadeira\nSpa e sauna"} onChange={(e) => mudar(n, { comodidades: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Fotos (link | legenda, uma por linha)"><textarea className={area} rows={3} value={h.fotos} placeholder="https://… | O resort visto do alto" onChange={(e) => mudar(n, { fotos: e.target.value })} /></Campo>
          <Mover n={n} total={hoteis.length} onMover={(a, b) => onChange(mover(hoteis, a, b))} onTirar={() => onChange(hoteis.filter((_, k) => k !== n))} />
        </div>
      ))}
      <Botao variante="fantasma" onClick={() => onChange([...hoteis, hotelVazio()])}>+ Hotel</Botao>
    </div>
  );
}

export function EditorDias({ dias, inicio, onChange }: { dias: DiaPacote[]; inicio: string; onChange: (d: DiaPacote[]) => void }) {
  const mudar = (n: number, c: Partial<DiaPacote>) => onChange(dias.map((d, k) => (k === n ? { ...d, ...c } : d)));
  const proxima = () => {
    const ult = dias[dias.length - 1]?.data || "";
    if (!ult) return inicio;
    const d = new Date(`${ult}T12:00:00`); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return (
    <div className="space-y-3">
      {dias.map((d, n) => (
        <div key={n} className="rounded-lg p-3 space-y-2" style={{ background: "var(--card2)" }}>
          <div className="grid sm:grid-cols-[160px_1fr] gap-2">
            <Campo rotulo={`Dia ${n + 1}`}><Entrada type="date" value={d.data} onChange={(e) => mudar(n, { data: e.target.value })} /></Campo>
            <Campo rotulo="Título do dia"><Entrada value={d.titulo} placeholder="Chegada a Cancún" onChange={(e) => mudar(n, { titulo: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Linha abaixo do título"><Entrada value={d.subtitulo} placeholder="Bogotá, Cancún · Hilton" onChange={(e) => mudar(n, { subtitulo: e.target.value })} /></Campo>
          <Campo rotulo="Programação (Quando | o que acontece, uma por linha)">
            <textarea className={area} rows={4} value={d.linhas} placeholder={"07:45 | Voo G3 6628 para Cancún.\nTarde | Almoço no resort, piscina e mar."} onChange={(e) => mudar(n, { linhas: e.target.value })}
              style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }} />
          </Campo>
          <Campo rotulo="Fotos (link | legenda)"><textarea className={area} rows={2} value={d.fotos} placeholder="https://… | O primeiro fim de tarde no Caribe mexicano" onChange={(e) => mudar(n, { fotos: e.target.value })} /></Campo>
          <Mover n={n} total={dias.length} onMover={(a, b) => onChange(mover(dias, a, b))} onTirar={() => onChange(dias.filter((_, k) => k !== n))} />
        </div>
      ))}
      <Botao variante="fantasma" onClick={() => onChange([...dias, diaVazio(proxima())])}>+ Dia</Botao>
    </div>
  );
}

export function CartoesPreco({ p, onOpcoes }: { p: Proposta; onOpcoes: (o: OpcaoProposta[]) => void }) {
  const mudar = (n: number, c: Partial<OpcaoProposta>) => onOpcoes(p.opcoes.map((o, k) => (k === n ? { ...o, ...c } : o)));
  const extra = (n: number, c: Partial<ExtraOpcao>) => mudar(n, { extra: { ...p.opcoes[n].extra, ...c } });
  const mudarItem0 = (n: number, c: Partial<ItemProposta>) => mudar(n, { itens: p.opcoes[n].itens.map((i, k) => (k === 0 ? { ...i, ...c } : i)) });
  const novo = (): OpcaoProposta => ({ ...opcaoVazia(), extra: { total_rotulo: "Total" }, itens: [{ ...itemVazio("pacote", p), nome: "Pacote" }], pagamentos: [{ ...pagamentoVazio(), forma: "cartao", condicao: "parcelado", parcelas: 10 }] });
  return (
    <div className="space-y-3">
      {p.opcoes.map((o, n) => {
        const t = totaisDaOpcao(o);
        const pg = o.pagamentos.find((x) => x.condicao === "parcelado");
        const um = o.itens.length === 1 ? o.itens[0] : null;
        return (
          <div key={o.k} className="rounded-lg p-3 space-y-2" style={{ background: "var(--card2)" }}>
            <div className="grid sm:grid-cols-3 gap-2">
              <Campo rotulo="Rótulo"><Entrada value={o.extra?.rotulo ?? ""} placeholder="QUARTO DUPLO · CASAL" onChange={(e) => extra(n, { rotulo: e.target.value })} /></Campo>
              <Campo rotulo="Título do cartão"><Entrada value={o.titulo} placeholder="2 viajantes" onChange={(e) => mudar(n, { titulo: e.target.value })} /></Campo>
              <Campo rotulo="Selo"><Entrada value={o.extra?.selo ?? ""} placeholder="10% OFF GRUPO BNI" onChange={(e) => extra(n, { selo: e.target.value })} /></Campo>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {um ? <Campo rotulo="Preço cheio (R$)"><Entrada inputMode="decimal" value={um.valor_total || ""} onChange={(e) => mudarItem0(n, { valor_total: numero(e.target.value) })} /></Campo>
                : <Campo rotulo="Preço cheio" dica={`soma de ${o.itens.length} serviços`}><Entrada value={brl(t.subtotal)} disabled /></Campo>}
              <Campo rotulo="Desconto (R$)" dica={t.desconto > 0 ? `aparece "De ${brl(t.subtotal)}"` : undefined}><Entrada inputMode="decimal" value={o.desconto || ""} onChange={(e) => mudar(n, { desconto: numero(e.target.value) })} /></Campo>
              <Campo rotulo="Parcelas no cartão" dica={pg ? `${pg.parcelas}x de ${brl(t.total / Math.max(1, pg.parcelas))}` : "vazio = só o total"}>
                <Entrada type="number" min={0} max={24} value={pg?.parcelas ?? ""} onChange={(e) => {
                  const k = Math.max(0, Math.floor(numero(e.target.value)));
                  const resto = o.pagamentos.filter((x) => x.condicao !== "parcelado");
                  mudar(n, { pagamentos: k > 1 ? [{ ...(pg ?? { ...pagamentoVazio(), forma: "cartao", condicao: "parcelado" }), parcelas: k }, ...resto] : resto });
                }} />
              </Campo>
              <Campo rotulo="Rótulo do total"><Entrada value={o.extra?.total_rotulo ?? ""} placeholder="Total por pessoa" onChange={(e) => extra(n, { total_rotulo: e.target.value })} /></Campo>
            </div>
            {um && <CamposInternos i={um} onChange={(c) => mudarItem0(n, c)} />}
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Total: {brl(t.total)}{t.temCusto ? ` · lucro ${brl(t.lucro)}` : ""}</span>
              <Botao onClick={() => onOpcoes(p.opcoes.map((x, k) => ({ ...x, recomendada: k === n ? !x.recomendada : false })))}>{o.recomendada ? "★ Destacado" : "☆ Destacar"}</Botao>
              {p.opcoes.length > 1 && <Mover n={n} total={p.opcoes.length} onMover={(a, b) => onOpcoes(mover(p.opcoes, a, b))} onTirar={() => { if (window.confirm("Tirar este cartão de preço?")) onOpcoes(p.opcoes.filter((_, k) => k !== n)); }} />}
            </div>
          </div>
        );
      })}
      {p.opcoes.length < 4 && <Botao variante="fantasma" onClick={() => onOpcoes([...p.opcoes, novo()])}>+ Cartão de preço</Botao>}
    </div>
  );
}

// ── Serviços ────────────────────────────────────────────────────────────────
export function EditorServicos({ p, onOpcoes }: { p: Proposta; onOpcoes: (o: OpcaoProposta[]) => void }) {
  const o = p.opcoes[0] ?? opcaoVazia("Serviços");
  const itens = o.itens;
  const setItens = (l: ItemProposta[]) => onOpcoes([{ ...o, itens: l }, ...p.opcoes.slice(1)]);
  const mudar = (n: number, c: Partial<ItemProposta>) => setItens(itens.map((i, k) => (k === n ? { ...i, ...c } : i)));
  const det = (n: number, c: Partial<DetalhesServico>) => mudar(n, { detalhes: { ...itens[n].detalhes, ...c } });
  return (
    <div className="space-y-3">
      {itens.length === 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum serviço ainda.</p>}
      {itens.map((i, n) => {
        const d = i.detalhes as DetalhesServico;
        return (
          <div key={i.k} className="rounded-lg p-3 space-y-2" style={{ background: "var(--card2)" }}>
            <div className="grid sm:grid-cols-[1fr_150px_150px] gap-2">
              <Campo rotulo={`Serviço ${n + 1}`}><Entrada value={i.nome} placeholder="Passeio panorâmico com churros e chocolate" onChange={(e) => mudar(n, { nome: e.target.value })} /></Campo>
              <Campo rotulo="Local"><Entrada value={d.local ?? ""} placeholder="Madri" onChange={(e) => det(n, { local: e.target.value })} /></Campo>
              <Campo rotulo="Data"><Entrada type="date" value={i.data_inicio} onChange={(e) => mudar(n, { data_inicio: e.target.value })} /></Campo>
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <Campo rotulo="Nota do dia" dica="Ex.: CHEGADA, DIA INTEIRO"><Entrada value={d.nota_dia ?? ""} onChange={(e) => det(n, { nota_dia: e.target.value })} /></Campo>
              <Campo rotulo="Sem data: quando" dica="Ex.: TODA A VIAGEM (no resumo: Viagem)"><Entrada value={d.data_rotulo ?? ""} onChange={(e) => det(n, { data_rotulo: e.target.value })} /></Campo>
              <Campo rotulo="Nome curto no resumo" dica="vazio = o nome do serviço"><Entrada value={d.resumo ?? ""} placeholder="Chegada e passeio panorâmico em Madri" onChange={(e) => det(n, { resumo: e.target.value })} /></Campo>
            </div>
            <Campo rotulo="Descrição"><textarea className={area} rows={3} value={i.descricao} onChange={(e) => mudar(n, { descricao: e.target.value })} /></Campo>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
              <Campo rotulo="Valor por pessoa (R$)"><Entrada inputMode="decimal" value={i.valor_total || ""} disabled={i.incluso} onChange={(e) => mudar(n, { valor_total: numero(e.target.value) })} /></Campo>
              <label className="col-span-2 flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
                <input type="checkbox" checked={i.incluso} onChange={(e) => mudar(n, { incluso: e.target.checked, ...(e.target.checked ? { valor_total: 0 } : {}) })} />
                "Já previsto na programação" no lugar do preço
              </label>
            </div>
            <details className="rounded-lg px-3 py-2" style={{ border: "1px dashed var(--line)" }}>
              <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>Opcional deste serviço (caixa tracejada)</summary>
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <Campo rotulo="Rótulo"><Entrada value={d.opcional_rotulo ?? ""} placeholder="OPCIONAL · ESTENDER PARA O ALMOÇO" onChange={(e) => det(n, { opcional_rotulo: e.target.value })} /></Campo>
                <Campo rotulo="O que é"><Entrada value={d.opcional_texto ?? ""} placeholder="+2h de espera do ônibus durante o almoço" onChange={(e) => det(n, { opcional_texto: e.target.value })} /></Campo>
                <Campo rotulo="Valor por pessoa (R$)"><Entrada inputMode="decimal" value={d.opcional_valor ?? ""} onChange={(e) => det(n, { opcional_valor: e.target.value })} /></Campo>
                <Campo rotulo="Nome curto no resumo"><Entrada value={d.opcional_resumo ?? ""} placeholder="estender o passeio para o almoço (+2h)" onChange={(e) => det(n, { opcional_resumo: e.target.value })} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Observação"><Entrada value={d.opcional_nota ?? ""} placeholder="Precisa ser definido com antecedência…" onChange={(e) => det(n, { opcional_nota: e.target.value })} /></Campo></div>
              </div>
            </details>
            <details className="rounded-lg px-3 py-2" style={{ border: "1px dashed var(--line)" }}>
              <summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>Alternativas (o cliente escolhe uma — ex.: com ou sem almoço)</summary>
              <div className="space-y-2 mt-2">
                <Campo rotulo="Texto antes das alternativas"><Entrada value={d.alternativas_intro ?? ""} placeholder="Duas opções para o dia. Elas são alternativas: a família escolhe uma." onChange={(e) => det(n, { alternativas_intro: e.target.value })} /></Campo>
                <Campo rotulo="Alternativas (Rótulo | texto | valor por pessoa | nome curto no resumo)" dica="Comece com * a que sai em destaque (cartão escuro). **negrito** funciona no texto.">
                  <textarea className={area} rows={3} value={d.alternativas ?? ""} onChange={(e) => det(n, { alternativas: e.target.value })} style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }}
                    placeholder={"OPÇÃO 1 · SEM ALMOÇO | Excursão privativa de dia inteiro… | 577,82 | Segóvia sem almoço\n*OPÇÃO 2 · COM ALMOÇO | Excursão… **Pratos principais:** leitão… | 1.000,48 | Segóvia com almoço"} />
                </Campo>
              </div>
            </details>
            <CamposInternos i={i} onChange={(c) => mudar(n, c)} />
            <Mover n={n} total={itens.length} onMover={(a, b) => setItens(mover(itens, a, b))} onTirar={() => { if (window.confirm("Tirar este serviço?")) setItens(itens.filter((_, k) => k !== n)); }} />
          </div>
        );
      })}
      <Botao onClick={() => setItens([...itens, { ...itemVazio("passeio", p), data_inicio: "", data_fim: "" }])}>+ Serviço</Botao>
    </div>
  );
}

// ── Seguro ──────────────────────────────────────────────────────────────────
export function EditorSeguro({ p, onOpcoes, onConteudo }: { p: Proposta; onOpcoes: (o: OpcaoProposta[]) => void; onConteudo: (c: Partial<Conteudo>) => void }) {
  const segs = (Array.isArray(p.conteudo.seguradoras) && p.conteudo.seguradoras.length ? p.conteudo.seguradoras : [seguradoraVazia()]) as SeguradoraModelo[];
  const n = Math.max(1, pax(p));
  const mudarSeg = (g: number, c: Partial<SeguradoraModelo>) => onConteudo({ seguradoras: segs.map((s, k) => (k === g ? { ...s, ...c } : s)) });
  const mudarOp = (k: number, c: Partial<OpcaoProposta>) => onOpcoes(p.opcoes.map((o, j) => (j === k ? { ...o, ...c } : o)));
  const mudarItem = (k: number, c: Partial<ItemProposta>) => {
    const o = p.opcoes[k];
    const itens = o.itens.length ? o.itens : [{ ...itemVazio("seguro", p) }];
    mudarOp(k, { itens: itens.map((i, j) => (j === 0 ? { ...i, ...c } : i)) });
  };
  const novoPlano = (g: number): OpcaoProposta => ({ ...opcaoVazia(), k: novaChave(), extra: { grupo: g }, itens: [{ ...itemVazio("seguro", p), nome: "Seguro viagem" }] });
  // planos ficam agrupados por seguradora (a ordem das colunas do comparativo segue esta)
  const ordenar = (l: OpcaoProposta[]) => [...l].sort((a, b) => (Number(a.extra?.grupo) || 0) - (Number(b.extra?.grupo) || 0));
  let col = 0;
  return (
    <div className="space-y-4">
      {segs.map((s, g) => {
        const planos = p.opcoes.map((o, k) => ({ o, k })).filter(({ o }) => (Number(o.extra?.grupo) || 0) === g);
        return (
          <div key={g} className="rounded-lg p-3 space-y-3" style={{ background: "var(--card2)" }}>
            <div className="grid sm:grid-cols-[1fr_2fr] gap-2">
              <Campo rotulo={`Seguradora ${g + 1}`}><Entrada value={s.nome} placeholder="Hero Seguros" onChange={(e) => mudarSeg(g, { nome: e.target.value })} /></Campo>
              <Campo rotulo="Linha abaixo do nome"><Entrada value={s.nota} placeholder="Todos os planos incluem eSIM de 300MB para chegar conectado." onChange={(e) => mudarSeg(g, { nota: e.target.value })} /></Campo>
            </div>
            {planos.map(({ o, k }) => {
              const item = o.itens[0];
              const total = totaisDaOpcao(o).total;
              const c = ++col;
              return (
                <div key={o.k} className="rounded-lg p-3 space-y-2" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
                  <p className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>Plano · coluna {c} do comparativo</p>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <Campo rotulo="Nome do plano"><Entrada value={o.titulo} placeholder="HERO 80" onChange={(e) => { mudarOp(k, { titulo: e.target.value }); }} /></Campo>
                    <Campo rotulo="Selo"><Entrada value={o.extra?.selo ?? ""} placeholder={o.recomendada ? "RECOMENDADO · MAIS VENDIDO" : "ESSENCIAL"} onChange={(e) => mudarOp(k, { extra: { ...o.extra, selo: e.target.value } })} /></Campo>
                    <Campo rotulo="Linha abaixo do nome"><Entrada value={o.descricao} placeholder="Linha VIP + eSIM grátis" onChange={(e) => mudarOp(k, { descricao: e.target.value })} /></Campo>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Campo rotulo="Assistência médica"><Entrada value={String(item?.detalhes?.cobertura ?? "")} placeholder="US$ 80.000" onChange={(e) => mudarItem(k, { detalhes: { ...item?.detalhes, cobertura: e.target.value, seguradora: s.nome, plano: o.titulo } })} /></Campo>
                    <Campo rotulo="Por passageiro (R$)" dica={!o.extra?.preco_pax && total ? `vazio = total ÷ ${n}` : undefined}>
                      <Entrada inputMode="decimal" value={o.extra?.preco_pax ?? ""} onChange={(e) => {
                        const v = numeroOuNulo(e.target.value);
                        mudarOp(k, { extra: { ...o.extra, preco_pax: v ?? undefined } });
                      }} />
                    </Campo>
                    <Campo rotulo={`Total ${n} passageiros (R$)`} dica={o.extra?.preco_pax && !item?.valor_total ? `sugestão: ${brl(Number(o.extra.preco_pax) * n)}` : undefined}>
                      <Entrada inputMode="decimal" value={item?.valor_total || ""} onChange={(e) => mudarItem(k, { valor_total: numero(e.target.value) })} />
                    </Campo>
                  </div>
                  {item && <CamposInternos i={item} onChange={(cc) => mudarItem(k, cc)} />}
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Botao onClick={() => onOpcoes(p.opcoes.map((x, j) => ({ ...x, recomendada: j === k ? !x.recomendada : false })))}>{o.recomendada ? "★ Recomendado" : "☆ Recomendar"}</Botao>
                    <Botao variante="perigo" onClick={() => { if (p.opcoes.length > 1 && window.confirm("Tirar este plano?")) onOpcoes(p.opcoes.filter((_, j) => j !== k)); }} disabled={p.opcoes.length <= 1}>Tirar plano</Botao>
                  </div>
                </div>
              );
            })}
            <Botao variante="fantasma" onClick={() => onOpcoes(ordenar([...p.opcoes, novoPlano(g)]))}>+ Plano da {s.nome || `seguradora ${g + 1}`}</Botao>
            <CampoTexto c={{ chave: "coberturas", rotulo: "Coberturas completas (Cobertura | plano 1 | plano 2 | …) — página própria", tipo: "tabela", linhas: 8,
              exemplo: "Despesas médicas e hospitalares (por evento) | USD 80.000 | USD 100.000 | USD 250.000\nCancelamento de viagem \"Plus Reason\" | Não inclui | Não inclui | Não inclui" }}
              valor={s.coberturas} onChange={(v) => mudarSeg(g, { coberturas: v })} />
            <CampoTexto c={{ chave: "rodape", rotulo: "Nota abaixo das coberturas", tipo: "texto", exemplo: "Valores de cobertura em dólar (USD) ou real (R$), conforme indicado. Condições gerais completas disponíveis na apólice." }}
              valor={s.rodape} onChange={(v) => mudarSeg(g, { rodape: v })} />
            {segs.length > 1 && planos.length === 0 && <Botao variante="perigo" onClick={() => onConteudo({ seguradoras: segs.filter((_, k) => k !== g) })}>Tirar seguradora</Botao>}
          </div>
        );
      })}
      <Botao variante="fantasma" onClick={() => onConteudo({ seguradoras: [...segs, seguradoraVazia()] })}>+ Seguradora</Botao>
    </div>
  );
}

// ── O editor do modelo ──────────────────────────────────────────────────────
export default function ModeloEditor({ p, mudar }: { p: Proposta; mudar: (c: Partial<Proposta>) => void }) {
  const modelo = p.modelo!;
  const c = p.conteudo;
  const setC = (x: Partial<Conteudo>) => mudar({ conteudo: { ...c, ...x } });
  const onOpcoes = (opcoes: OpcaoProposta[]) => mudar({ opcoes });
  const secoes = SECOES[modelo];
  const blocoTexto = (i: number) => (
    <Bloco key={`s${i}`} titulo={secoes[i].titulo} dica={secoes[i].dica}>
      {secoes[i].campos.map((f) => <CampoTexto key={f.chave} c={f} valor={c[f.chave]} onChange={(v) => setC({ [f.chave]: v })} />)}
    </Bloco>
  );
  return (
    <div className="space-y-3">
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        Modelo <b>{MODELOS[modelo].rotulo}</b>: o cliente vê as seções nesta ordem. Seção vazia não aparece. Tabelas: uma linha por item, colunas separadas por <code>|</code>.
      </p>
      {modelo === "pacote" && (
        <>
          {blocoTexto(0)}
          {blocoTexto(1)}
          <Bloco titulo="Hospedagem" dica="Uma página por hotel.">
            <EditorHoteis hoteis={(c.hoteis ?? []) as HotelPacote[]} onChange={(h) => setC({ hoteis: h })} />
          </Bloco>
          <Bloco titulo="Dia a dia" dica="Cada dia: data, título, programação e fotos. O sumário usa a data e o título se você não preencher.">
            <EditorDias dias={(c.dias ?? []) as DiaPacote[]} inicio={p.data_ida} onChange={(d) => setC({ dias: d })} />
          </Bloco>
          {secoes.slice(2).map((_, k) => blocoTexto(k + 2))}
          <Bloco titulo="Cartões de preço (Investimento)" dica="Cada cartão é uma opção que o cliente pode escolher (ex.: duplo por pessoa, casal, single)." abertoInicial>
            <CartoesPreco p={p} onOpcoes={onOpcoes} />
          </Bloco>
        </>
      )}
      {modelo === "servicos" && (
        <>
          {blocoTexto(0)}
          {blocoTexto(1)}
          <Bloco titulo="Serviços (valor por pessoa)" abertoInicial><EditorServicos p={p} onOpcoes={onOpcoes} /></Bloco>
          {secoes.slice(2).map((_, k) => blocoTexto(k + 2))}
        </>
      )}
      {modelo === "seguro" && (
        <>
          {blocoTexto(0)}
          <Bloco titulo="Seguradoras e planos" dica="Cada plano é uma opção que o cliente pode escolher. O ★ é o da página Nossa recomendação." abertoInicial>
            <EditorSeguro p={p} onOpcoes={onOpcoes} onConteudo={setC} />
          </Bloco>
          {secoes.slice(1).map((_, k) => blocoTexto(k + 1))}
        </>
      )}
    </div>
  );
}

/** Escolher o modelo (proposta nova ou antiga sem modelo). */
export function EscolherModelo({ atual, onEscolher }: { atual: ModeloProposta | null; onEscolher: (m: ModeloProposta | null) => void }) {
  return (
    <div className="grid sm:grid-cols-4 gap-2">
      {(["pacote", "servicos", "seguro"] as ModeloProposta[]).map((m) => (
        <button key={m} type="button" onClick={() => onEscolher(m)} aria-pressed={atual === m}
          className="rounded-xl border px-3 py-2.5 text-left"
          style={atual === m ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)", background: "var(--card)" }}>
          <span className="block text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{MODELOS[m].rotulo}</span>
          <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{MODELOS[m].dica}</span>
        </button>
      ))}
      <button type="button" onClick={() => onEscolher(null)} aria-pressed={atual === null}
        className="rounded-xl border px-3 py-2.5 text-left"
        style={atual === null ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)", background: "var(--card)" }}>
        <span className="block text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Formato antigo</span>
        <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>Opções e serviços livres (como antes)</span>
      </button>
    </div>
  );
}
