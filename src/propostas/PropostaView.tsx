// src/propostas/PropostaView.tsx
// -----------------------------------------------------------------------------
// A proposta como o CLIENTE vê — usada no link público (/proposta/<token>), na
// prévia dentro do QS e no PDF (o PDF é esta mesma página impressa: "Salvar
// como PDF" do navegador com o CSS de impressão abaixo — página e PDF nunca
// divergem, lição do AgentePro).
//
// 21/10 (Bruno): TODAS as propostas no padrão do bilhete eletrônico da agência
// ("Bilhete Aereo - Saulo e Maria - SCIXQB.pdf"): faixa verde-escura com o selo,
// filete limão, cartão-resumo com o lado menta, títulos de seção espaçados com
// fio, cartão do voo com barra verde à esquerda e códigos grandes (NAT → GRU),
// bagagem em três caixas, lista com coração e rodapé escuro com o contato.
// Cores e fonte (Poppins) tiradas do próprio PDF.
// -----------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import {
  TIPOS, brl, noites, textoPagamento, textoPassageiros, tituloDaProposta, totaisDaOpcao,
  type PropostaVM, type Trecho,
} from "./lib";
import { aeroporto, duracaoVoo } from "./aeroportos";

const AGENCIA = "Se Tu For, Eu Vou · Viagens";
const SELO = "/marca/selo-stfv.png";
const CONTATO = ["+55 (11) 98012-4183", "Seg a qui, 09h30 às 19h30", "Sex, 10h00 às 19h00"];

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap");
.pv { --pv-escuro: #0B2A28; --pv-verde: #1E7A5A; --pv-menta: #E9F4EF; --pv-menta2: #DBE6DF; --pv-coracao: #8ED3B5; --pv-limao: #CDED5B;
  --pv-fundo: #FBF9F6; --pv-tinta: #14201B; --pv-suave: #6E7F77; --pv-apagado: #A8B5AF; --pv-card: #FFFFFF;
  background: var(--pv-fundo); color: var(--pv-tinta); font-family: Poppins, system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100%; }
.pv-wrap { max-width: 860px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; }
.pv-card { background: var(--pv-card); border: 1px solid var(--pv-menta2); border-radius: 14px; }
.pv-barra { border-left: 5px solid var(--pv-verde); }
.pv-rotulo { font-size: 10.5px; font-weight: 500; letter-spacing: .22em; text-transform: uppercase; color: var(--pv-suave); }
.pv-sec { display: flex; align-items: center; gap: 14px; font-size: 10.5px; font-weight: 500; letter-spacing: .22em; text-transform: uppercase; color: var(--pv-verde); margin-bottom: 12px; }
.pv-sec::after { content: ""; flex: 1; height: 1px; background: var(--pv-menta2); }
.pv-chip { display: inline-block; padding: 3px 12px; border-radius: 999px; background: var(--pv-menta); color: var(--pv-verde); font-size: 10.5px; font-weight: 500; letter-spacing: .18em; text-transform: uppercase; }
.pv-codigo { font-weight: 700; color: var(--pv-escuro); line-height: 1; letter-spacing: -.01em; }
.pv-leve { font-weight: 300; color: var(--pv-suave); }
.pv-pontos { flex: 1; border-top: 2px dotted var(--pv-menta2); position: relative; min-width: 24px; }
.pv-botao { background: var(--pv-escuro); color: #fff; border-radius: 999px; padding: 11px 20px; font-weight: 600; font-size: 14px; }
.pv-botao:hover { opacity: .92; }
.pv-botao-limao { background: var(--pv-limao); color: var(--pv-escuro); }
.pv :focus-visible { outline: 2px solid var(--pv-verde); outline-offset: 2px; }
@media print {
  @page { size: A4; margin: 12mm 0; }
  @page :first { margin-top: 0; }
  .pv-sec { break-after: avoid; }
  .pv { background: #fff !important; }   /* a margem da folha sai branca: o fundo todo também */
  .pv-wrap { max-width: none; padding-left: 14mm; padding-right: 14mm; }
  .pv-nao-imprime { display: none !important; }
  .pv-quebra { break-before: page; }
  .pv-card, .pv-bloco { break-inside: avoid; }
  .pv * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

type Item = PropostaVM["opcoes"][number]["itens"][number];
type Opcao = PropostaVM["opcoes"][number];

/** "Segunda-feira, 9 de novembro de 2026" */
function dataLonga(iso: string) {
  if (!iso) return "";
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "9 nov" */
const dataCurta = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "") : "");
const diaDaSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long" }).replace("-feira", "");

function Coracao() {
  return <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden className="flex-shrink-0 mt-[5px]"><path fill="#8ED3B5" d="M12 21s-7.5-4.6-10-9.2C.3 8.4 2.2 4 6.3 4c2.3 0 3.9 1.3 5.7 3.3C13.8 5.3 15.4 4 17.7 4 21.8 4 23.7 8.4 22 11.8 19.5 16.4 12 21 12 21z" /></svg>;
}
function Mala({ apagada, grande }: { apagada?: boolean; grande?: boolean }) {
  const c = apagada ? "#A8B5AF" : "#1E7A5A";
  return (
    <svg width={grande ? 30 : 24} height={grande ? 40 : 32} viewBox="0 0 24 32" fill="none" stroke={c} strokeWidth="1.4" aria-hidden className="flex-shrink-0">
      <rect x="3" y={grande ? 5 : 9} width="18" height={grande ? 25 : 21} rx="3" /><path d={grande ? "M9 5V2h6v3" : "M9 9V6h6v3"} /><path d={grande ? "M12 10v15" : "M12 14v11"} />
    </svg>
  );
}

function Lista({ itens }: { itens: { titulo: string; texto?: string }[] }) {
  return (
    <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
      {itens.map((x, n) => (
        <li key={n} className="flex gap-2.5 pv-bloco">
          <Coracao />
          <span className="min-w-0">
            <span className="block text-[14px] font-medium">{x.titulo}</span>
            {x.texto && <span className="block text-[12.5px] pv-leve">{x.texto}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Texto livre ("Inclui: …", uma informação por linha) → itens da lista com coração. */
function linhasEmItens(t: string) {
  return t.split(/\n+/).map((l) => l.replace(/^[\s•\-*–]+/, "").trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.{2,60}?)\s*[:—–]\s+(.+)$/);
    return m ? { titulo: m[1], texto: m[2] } : { titulo: l };
  });
}

function Preco({ i, esconder, rotulo }: { i: Item; esconder: boolean; rotulo?: string }) {
  if (i.incluso) return <span className="text-[13px] font-medium" style={{ color: "var(--pv-verde)" }}>Incluso</span>;
  if (esconder || !i.valor_total) return null;
  return <span className="text-[13.5px] font-semibold tabular-nums whitespace-nowrap">{rotulo ? <span className="pv-leve font-light">{rotulo} </span> : null}{brl(i.valor_total)}</span>;
}

// ── Voo: um cartão por sentido (ida, volta, trecho), conexões no meio ────────
function CartaoVoo({ trechos }: { trechos: Trecho[] }) {
  const a = trechos[0];
  const z = trechos[trechos.length - 1];
  const ida = a.sentido === "volta" ? "Volta" : a.sentido === "interno" ? "Trecho" : "Ida";
  const ao = aeroporto(a.origem), az = aeroporto(z.destino);
  const chegaEm = z.chegada_data || z.data || a.data;
  const dur = duracaoVoo(a.origem, z.destino, a.data, a.saida, z.chegada, chegaEm);
  const conexoes = trechos.slice(0, -1).map((t) => t.destino).filter(Boolean);
  const voos = [...new Set(trechos.map((t) => t.voo.trim()).filter(Boolean))];
  const cias = [...new Set(trechos.map((t) => t.cia.trim()).filter(Boolean))];
  const madrugada = a.saida && a.data && Number(a.saida.slice(0, 2)) < 5;
  const outroDia = chegaEm && a.data && chegaEm !== a.data;
  let nota = "";
  if (madrugada) {
    const vespera = new Date(`${a.data}T12:00:00`); vespera.setDate(vespera.getDate() - 1);
    nota = `Embarque na madrugada de ${diaDaSemana(vespera.toISOString().slice(0, 10))} para ${diaDaSemana(a.data)}`;
  } else if (outroDia) nota = `Chega em ${dataLonga(chegaEm).split(",")[0].toLowerCase()}, ${dataCurta(chegaEm)}`;

  const Ponta = ({ cod, ap, hora, lado }: { cod: string; ap: ReturnType<typeof aeroporto>; hora: string; lado: "e" | "d" }) => (
    <div className={`flex items-end gap-3 ${lado === "d" ? "flex-row-reverse text-right" : ""}`}>
      <div>
        <p className="pv-codigo text-[38px] sm:text-[46px]">{cod || "—"}</p>
        <p className="text-[19px] sm:text-[21px] font-medium mt-1 tabular-nums">{hora || "--:--"}</p>
      </div>
      {ap && <p className="hidden sm:block text-[12.5px] pv-leve leading-snug pb-9">{ap.cidade}<br />{ap.nome}</p>}
    </div>
  );

  return (
    <div className="pv-card pv-barra pv-bloco px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="pv-chip">{ida}</span>
        <span className="text-[13px] pv-leve font-medium flex-1">{dataLonga(a.data)}</span>
        {voos.length > 0 && <span className="text-[12.5px] font-medium">Voo {voos.join(" · ")}</span>}
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Ponta cod={a.origem} ap={ao} hora={a.saida} lado="e" />
        <div className="flex-1 flex flex-col items-center gap-1 px-1 min-w-[70px]">
          <div className="w-full flex items-center">
            <span className="pv-pontos" />
            <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden className="mx-1 flex-shrink-0"><path d="M0 5h12V0l8 7-8 7V9H0z" fill="#1E7A5A" /></svg>
            <span className="pv-pontos" />
          </div>
          {dur && <span className="text-[12.5px] font-medium" style={{ color: "var(--pv-verde)" }}>{dur}</span>}
          <span className="text-[11.5px] pv-leve text-center">{conexoes.length ? `${conexoes.length} conexão${conexoes.length > 1 ? "ões" : ""} · ${conexoes.join(", ")}` : "voo direto"}</span>
        </div>
        <Ponta cod={z.destino} ap={az} hora={z.chegada} lado="d" />
      </div>
      {/* No celular a cidade some do lado do código: vem embaixo */}
      {(ao || az) && <p className="sm:hidden flex justify-between gap-3 text-[11.5px] pv-leve mt-1"><span>{ao?.cidade}</span><span className="text-right">{az?.cidade}</span></p>}
      {conexoes.length > 0 && (
        <ol className="mt-3 space-y-0.5 text-[12px] pv-leve">
          {trechos.map((t, k) => (
            <li key={k}>{t.origem} {t.saida} → {t.destino} {t.chegada}{t.chegada_data && t.chegada_data !== t.data ? ` (${dataCurta(t.chegada_data)})` : ""}{t.voo ? ` · ${[t.cia, t.voo].filter(Boolean).join(" ")}` : ""}</li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t mt-3 pt-2.5 text-[12.5px]" style={{ borderColor: "var(--pv-menta2)" }}>
        <span className="pv-leve">{[a.classe ? `Classe ${a.classe}` : "", cias.length ? cias.join(", ") : ""].filter(Boolean).join(" · ")}</span>
        {nota && <span className="font-medium" style={{ color: "var(--pv-verde)" }}>{nota}</span>}
      </div>
    </div>
  );
}

/** Ida/volta/trecho em sequência viram um cartão cada. */
function agruparTrechos(ts: Trecho[]): Trecho[][] {
  const g: Trecho[][] = [];
  for (const t of ts.filter((x) => x.origem || x.destino)) {
    const ult = g[g.length - 1];
    if (ult && ult[0].sentido === t.sentido && t.sentido !== "interno") ult.push(t); else g.push([t]);
  }
  return g;
}

function Bagagem({ d }: { d: Record<string, string> }) {
  const caixas = [
    { t: "Item pessoal", v: d.item_pessoal || "Incluso", sub: "Sob o assento dianteiro", grande: false },
    { t: "Mala de mão", v: d.bagagem_mao, sub: "No compartimento superior", grande: true },
    { t: "Bagagem despachada", v: d.bagagem_despachada, sub: "Despachada no check-in", grande: true },
  ];
  const nao = (v?: string) => !v || /^n[ãa]o\b|^sem\b/i.test(v.trim());
  return (
    <div className="rounded-[14px] p-4 grid sm:grid-cols-3 gap-4 pv-bloco" style={{ background: "var(--pv-menta)" }}>
      {caixas.map((c) => {
        const off = nao(c.v);
        return (
          <div key={c.t} className="flex items-center gap-3">
            <Mala apagada={off} grande={c.grande} />
            <div className="min-w-0" style={off ? { color: "var(--pv-apagado)" } : undefined}>
              <p className="text-[14px] font-medium">{c.t}</p>
              <p className="text-[12.5px] font-light" style={off ? { fontWeight: 500 } : { color: "var(--pv-suave)" }}>{off ? (c.v?.trim() || "Não inclusa") : c.v}</p>
              <p className="text-[12px] font-light" style={{ color: off ? "var(--pv-apagado)" : "var(--pv-suave)" }}>{off ? "Pode ser adicionada à parte" : c.sub}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Voos({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <div className="space-y-4">
      {itens.map((i, n) => {
        const grupos = agruparTrechos((Array.isArray(i.detalhes.trechos) ? i.detalhes.trechos : []) as Trecho[]);
        const d = i.detalhes as Record<string, string>;
        const preco = <Preco i={i} esconder={esconder} rotulo="Aéreo" />;
        return (
          <div key={n} className="space-y-3">
            {(itens.length > 1 && i.nome) && <p className="text-[14px] font-medium">{i.nome}</p>}
            {grupos.map((g, k) => <CartaoVoo key={k} trechos={g} />)}
            {grupos.length === 0 && <div className="pv-card pv-barra px-5 py-4 text-[14px] font-medium">{i.nome || "Aéreo"}</div>}
            <div className="pv-bloco">
              <p className="pv-sec">Bagagem inclusa por passageiro</p>
              <Bagagem d={d} />
            </div>
            {i.descricao && <p className="text-[13px] pv-leve whitespace-pre-wrap">{i.descricao}</p>}
            {(i.incluso || (!esconder && i.valor_total > 0)) && <p className="text-right">{preco}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Hoteis({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <div className="space-y-3">
      {itens.map((i, n) => {
        const d = i.detalhes as Record<string, string>;
        const nts = noites(i.data_inicio, i.data_fim);
        const estrelas = Number(d.estrelas) || 0;
        const Ponta = ({ rotulo, data, hora, lado }: { rotulo: string; data: string; hora?: string; lado: "e" | "d" }) => (
          <div className={lado === "d" ? "text-right" : ""}>
            <p className="pv-rotulo">{rotulo}</p>
            <p className="pv-codigo text-[26px] sm:text-[30px] mt-1">{data ? dataCurta(data) : "—"}</p>
            <p className="text-[12.5px] pv-leve">{data ? diaDaSemana(data) : ""}{hora ? ` · ${hora}` : ""}</p>
          </div>
        );
        return (
          <div key={n} className="pv-card pv-barra pv-bloco px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="pv-chip">Hospedagem</span>
              <span className="text-[13px] pv-leve font-medium flex-1">{d.cidade}</span>
              {estrelas > 0 && <span className="text-[12.5px]" aria-label={`${estrelas} estrelas`} style={{ color: "var(--pv-verde)" }}>{"★".repeat(estrelas)}</span>}
            </div>
            <p className="text-[19px] font-semibold mt-3" style={{ color: "var(--pv-escuro)" }}>{i.nome || "Hospedagem"}</p>
            {d.endereco && <p className="text-[12.5px] pv-leve">{d.endereco}</p>}
            {(i.data_inicio || i.data_fim) && (
              <div className="flex items-center gap-3 mt-3">
                <Ponta rotulo="Check-in" data={i.data_inicio} hora={d.checkin_hora} lado="e" />
                <div className="flex-1 flex flex-col items-center gap-1 min-w-[60px]">
                  <span className="pv-pontos w-full" />
                  {nts > 0 && <span className="text-[12.5px] font-medium" style={{ color: "var(--pv-verde)" }}>{nts} noite{nts === 1 ? "" : "s"}</span>}
                </div>
                <Ponta rotulo="Check-out" data={i.data_fim} hora={d.checkout_hora} lado="d" />
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t mt-3 pt-2.5 text-[12.5px]" style={{ borderColor: "var(--pv-menta2)" }}>
              <span className="pv-leve">{[[d.quartos && Number(d.quartos) > 1 ? `${d.quartos}×` : "", d.quarto].filter(Boolean).join(" "), d.regime].filter(Boolean).join(" · ")}</span>
              <Preco i={i} esconder={esconder} />
            </div>
            {i.descricao && <p className="text-[12.5px] pv-leve mt-2 whitespace-pre-wrap">{i.descricao}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Transfer, trem, passeio, seguro, carro, cruzeiro, visto, pacote, outro. */
function Servicos({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <div className="space-y-3">
      {itens.map((i, n) => {
        const info = TIPOS[i.tipo];
        const d = i.detalhes as Record<string, string>;
        const [r1, r2] = info.datas;
        const extras: ReactNode[] = info.campos.filter((c) => c.tipo !== "area" && d[c.chave]).map((c) => <span key={c.chave} className="mr-4 whitespace-nowrap"><span className="pv-leve">{c.rotulo}:</span> {d[c.chave]}</span>);
        return (
          <div key={n} className="pv-card pv-barra pv-bloco px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="pv-chip">{info.rotulo}</span>
              <span className="text-[13px] pv-leve font-medium flex-1">
                {[r1 && i.data_inicio ? dataLonga(i.data_inicio) : "", r2 && i.data_fim ? `até ${dataCurta(i.data_fim)}` : ""].filter(Boolean).join(" ")}
              </span>
              <Preco i={i} esconder={esconder} />
            </div>
            <p className="text-[16px] font-semibold mt-2.5" style={{ color: "var(--pv-escuro)" }}>{i.nome || info.rotulo}{i.quantidade > 1 ? ` · ${i.quantidade}×` : ""}</p>
            {extras.length > 0 && <p className="text-[12.5px] mt-1">{extras}</p>}
            {d.inclui && <div className="mt-3"><Lista itens={linhasEmItens(d.inclui)} /></div>}
            {i.descricao && <p className="text-[12.5px] pv-leve mt-2 whitespace-pre-wrap">{i.descricao}</p>}
          </div>
        );
      })}
    </div>
  );
}

function rotuloOpcao(o: Opcao, n: number, total: number) {
  if (total === 1) return o.titulo || "Sua viagem";
  return `Opção ${n + 1}${o.titulo ? ` · ${o.titulo}` : ""}`;
}

function Selo({ tamanho }: { tamanho: number }) {
  return <img src={SELO} alt="Se Tu For, Eu Vou! Viagens" width={tamanho} height={tamanho} className="rounded-full" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,.18)" }} />;
}

export default function PropostaView({ p, onEscolher, previa = false }: {
  p: PropostaVM;
  /** Link público: o cliente escolhe uma opção (com o nome dele). */
  onEscolher?: (opcaoId: string, nome: string) => Promise<void>;
  previa?: boolean;
}) {
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [nome, setNome] = useState(p.cliente_nome || "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const varias = p.opcoes.length > 1;
  const nts = noites(p.data_ida, p.data_volta);
  const podeEscolher = !!onEscolher && p.status === "enviada" && !p.aprovada_opcao_id;
  const aprovada = p.opcoes.find((o) => o.id === p.aprovada_opcao_id);
  const zap = p.consultor?.whatsapp ? `https://wa.me/${p.consultor.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá! Estou vendo a proposta nº ${p.numero} (${tituloDaProposta(p)}).`)}` : null;
  const passageiros = textoPassageiros(p);
  // "9 a 13 nov 2026" (mesmo mês) · "28 nov a 3 dez 2026"
  const mes = (iso: string) => dataCurta(iso).replace(/^\d+ de /, "");
  const dia = (iso: string) => String(Number(iso.slice(8, 10)));
  const datas = !p.data_ida ? "" : !p.data_volta ? `${dia(p.data_ida)} ${mes(p.data_ida)} ${p.data_ida.slice(0, 4)}`
    : p.data_ida.slice(0, 7) === p.data_volta.slice(0, 7) ? `${dia(p.data_ida)} a ${dia(p.data_volta)} ${mes(p.data_volta)} ${p.data_volta.slice(0, 4)}`
    : `${dia(p.data_ida)} ${mes(p.data_ida)} a ${dia(p.data_volta)} ${mes(p.data_volta)} ${p.data_volta.slice(0, 4)}`;

  async function confirmar() {
    if (!escolhendo || !onEscolher) return;
    if (nome.trim().length < 3) { setErro("Escreva seu nome completo."); return; }
    setEnviando(true); setErro(null);
    try { await onEscolher(escolhendo, nome.trim()); setEscolhendo(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não conseguimos registrar agora. Tente de novo."); }
    setEnviando(false);
  }

  return (
    <div className="pv">
      <style>{CSS}</style>

      {/* Barra de ações (não sai no PDF) */}
      <div className="pv-nao-imprime sticky top-0 z-10 border-b" style={{ background: "rgba(251,249,246,.95)", borderColor: "var(--pv-menta2)", backdropFilter: "blur(6px)" }}>
        <div className="pv-wrap py-2.5 flex items-center gap-3">
          <p className="flex-1 min-w-0 truncate text-[13px] font-medium" style={{ color: "var(--pv-suave)" }}>{p.numero > 0 ? `Proposta nº ${p.numero}` : "Proposta de viagem"}</p>
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="text-[13px] font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--pv-limao)", color: "var(--pv-escuro)" }}>WhatsApp</a>}
          <button type="button" onClick={() => window.print()} className="text-[13px] font-semibold px-3 py-1.5 rounded-full border" style={{ borderColor: "var(--pv-menta2)", color: "var(--pv-escuro)", background: "#fff" }}>Baixar PDF</button>
        </div>
      </div>
      {previa && <p className="pv-nao-imprime text-center text-[12.5px] py-2" style={{ background: "#FFF7E0", color: "#7A5A00" }}>Prévia — é assim que o cliente vê. Custo, lucro, fornecedor e localizador não aparecem.</p>}

      {/* Faixa da marca */}
      <header style={{ background: "var(--pv-escuro)" }}>
        <div className="pv-wrap py-5 flex items-center gap-4">
          <Selo tamanho={72} />
          <div className="flex-1 text-right">
            <p className="text-[11.5px] font-medium" style={{ color: "var(--pv-limao)", letterSpacing: ".3em" }}>{aprovada ? "PROPOSTA APROVADA" : "PROPOSTA DE VIAGEM"}</p>
            <p className="text-[13px] font-light mt-1" style={{ color: "rgba(255,255,255,.75)" }}>
              {p.cliente_nome ? `Preparada para ${p.cliente_nome}` : "Preparada para você"}{p.numero > 0 ? ` · nº ${p.numero}` : ""}
            </p>
          </div>
        </div>
      </header>
      <div style={{ height: 6, background: "var(--pv-limao)" }} />

      <main className="pv-wrap py-7 space-y-8">
        {p.capa_url && <img src={p.capa_url} alt="" className="w-full max-h-[300px] object-cover rounded-[14px] pv-bloco" />}

        {/* Resumo — mesmo cartão do bilhete (lado menta + colunas) */}
        <section className="pv-card overflow-hidden grid sm:grid-cols-[1.15fr_1fr_1fr] pv-bloco">
          <div className="px-6 py-5" style={{ background: "var(--pv-menta)" }}>
            <p className="pv-rotulo" style={{ color: "var(--pv-verde)" }}>{p.destino ? "Destino" : "Sua viagem"}</p>
            <p className="text-[24px] sm:text-[27px] font-bold leading-tight mt-1.5" style={{ color: "var(--pv-escuro)" }}>{p.destino || tituloDaProposta(p)}</p>
          </div>
          <div className="px-6 py-5">
            <p className="pv-rotulo">Passageiros</p>
            <p className="text-[17px] font-medium mt-2">{passageiros || "—"}</p>
          </div>
          <div className="px-6 py-5">
            <p className="pv-rotulo">Datas</p>
            <p className="text-[17px] font-medium mt-2">{datas || "A combinar"}</p>
            {nts > 0 && <p className="text-[12px] pv-leve">{nts} noite{nts === 1 ? "" : "s"}</p>}
          </div>
        </section>

        {p.titulo.trim() && p.destino && <h1 className="text-[24px] sm:text-[28px] font-semibold leading-tight -mb-3" style={{ color: "var(--pv-escuro)" }}>{p.titulo}</h1>}

        {aprovada && (
          <div className="rounded-[14px] p-4 text-[14px] font-medium flex gap-2.5" style={{ background: "var(--pv-menta)", color: "var(--pv-verde)" }}>
            <Coracao />
            <span>{varias ? `${rotuloOpcao(aprovada, p.opcoes.indexOf(aprovada), p.opcoes.length)} escolhida` : "Proposta aprovada"}
              {p.aprovada_em ? ` em ${new Date(p.aprovada_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}. Nosso time já foi avisado e vai seguir com você.</span>
          </div>
        )}

        {p.apresentacao && <p className="text-[15px] leading-relaxed font-light whitespace-pre-wrap">{p.apresentacao}</p>}

        {/* Comparativo das opções */}
        {varias && (
          <section className="pv-bloco">
            <p className="pv-sec">Compare as opções</p>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {p.opcoes.map((o, n) => {
                const t = totaisDaOpcao(o);
                return (
                  <div key={o.id} className="pv-card pv-barra px-5 py-4 flex flex-col gap-1.5" style={o.recomendada ? { borderColor: "var(--pv-verde)" } : { borderLeftColor: "var(--pv-coracao)" }}>
                    {o.recomendada && <span className="pv-chip self-start" style={{ background: "var(--pv-limao)", color: "var(--pv-escuro)" }}>Recomendada</span>}
                    <p className="font-semibold text-[15px]">{rotuloOpcao(o, n, p.opcoes.length)}</p>
                    {o.descricao && <p className="text-[12.5px] pv-leve">{o.descricao}</p>}
                    <p className="text-[24px] font-bold mt-auto tabular-nums" style={{ color: "var(--pv-escuro)" }}>{brl(t.total)}</p>
                    <a href={`#opcao-${n + 1}`} className="text-[12.5px] font-medium underline pv-nao-imprime" style={{ color: "var(--pv-verde)" }}>Ver o que inclui</a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Cada opção */}
        {p.opcoes.map((o, n) => {
          const voos = o.itens.filter((i) => i.tipo === "aereo");
          const hoteis = o.itens.filter((i) => i.tipo === "hospedagem");
          const outros = o.itens.filter((i) => i.tipo !== "aereo" && i.tipo !== "hospedagem");
          const t = totaisDaOpcao(o);
          return (
            <section key={o.id} id={`opcao-${n + 1}`} className={`space-y-7 scroll-mt-16 ${varias && n > 0 ? "pv-quebra" : ""}`}>
              {varias && (
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <h2 className="text-[22px] font-bold flex-1" style={{ color: "var(--pv-escuro)" }}>{rotuloOpcao(o, n, p.opcoes.length)}</h2>
                  {o.recomendada && <span className="pv-chip" style={{ background: "var(--pv-limao)", color: "var(--pv-escuro)" }}>Recomendada</span>}
                </div>
              )}
              {voos.length > 0 && <div><p className="pv-sec">Sua viagem</p><Voos itens={voos} esconder={p.esconder_precos} /></div>}
              {hoteis.length > 0 && <div><p className="pv-sec">Hospedagem</p><Hoteis itens={hoteis} esconder={p.esconder_precos} /></div>}
              {outros.length > 0 && <div><p className="pv-sec">Serviços</p><Servicos itens={outros} esconder={p.esconder_precos} /></div>}

              {/* Investimento — cartão-resumo com o lado menta */}
              <div className="pv-bloco">
                <p className="pv-sec">Investimento</p>
                <div className="pv-card overflow-hidden grid sm:grid-cols-[1fr_1.4fr]">
                  <div className="px-6 py-5" style={{ background: "var(--pv-menta)" }}>
                    <p className="pv-rotulo" style={{ color: "var(--pv-verde)" }}>Total{passageiros ? ` · ${passageiros}` : ""}</p>
                    <p className="text-[30px] font-bold tabular-nums mt-1.5 leading-tight" style={{ color: "var(--pv-escuro)" }}>{brl(t.total)}</p>
                    {t.desconto > 0 && <p className="text-[12.5px] pv-leve mt-1">De {brl(t.subtotal)} · desconto de {brl(t.desconto)}</p>}
                  </div>
                  <div className="px-6 py-5">
                    {o.pagamentos.length > 0 ? (
                      <>
                        <p className="pv-rotulo mb-3">{o.pagamentos.length > 1 ? "Formas de pagamento (escolha uma)" : "Forma de pagamento"}</p>
                        <ul className="space-y-2">
                          {o.pagamentos.map((pg, k) => (
                            <li key={k} className="flex gap-2.5 text-[14px]"><Coracao /><span><span className="font-medium">{textoPagamento(pg, t.total)}</span>{pg.obs ? <span className="block text-[12.5px] pv-leve">{pg.obs}</span> : null}</span></li>
                          ))}
                        </ul>
                      </>
                    ) : <p className="text-[13.5px] pv-leve">Condições de pagamento combinadas com seu consultor.</p>}
                    {podeEscolher && (
                      <button type="button" className="pv-botao pv-nao-imprime w-full sm:w-auto mt-5" onClick={() => { setErro(null); setEscolhendo(o.id); }}>
                        {varias ? `Quero a opção ${n + 1}` : "Quero esta proposta"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        {p.observacoes.trim() && (
          <section className="pv-bloco">
            <p className="pv-sec">Informações importantes</p>
            <Lista itens={linhasEmItens(p.observacoes)} />
          </section>
        )}

        <p className="text-[12px] pv-leve">
          Valores sujeitos a confirmação de disponibilidade e tarifa no momento da reserva.{varias || p.opcoes.some((o) => o.pagamentos.length > 1) ? " As formas de pagamento são alternativas — você escolhe uma." : ""}
          {p.consultor?.nome ? ` Seu consultor: ${p.consultor.nome}.` : ""}
        </p>
      </main>

      {/* Rodapé da marca */}
      <div style={{ height: 6, background: "var(--pv-limao)" }} />
      <footer className="text-center" style={{ background: "var(--pv-escuro)", color: "#fff" }}>
        <div className="pv-wrap py-6 flex flex-col items-center gap-2">
          <Selo tamanho={46} />
          <p className="text-[16px] font-medium mt-1">{AGENCIA}</p>
          <p className="text-[12.5px] font-light" style={{ color: "rgba(255,255,255,.7)" }}>{CONTATO.join("  ·  ")}</p>
          {zap && <a href={zap} target="_blank" rel="noreferrer" className="pv-botao pv-botao-limao pv-nao-imprime mt-2">Falar com {p.consultor?.nome?.split(" ")[0] || "o consultor"} no WhatsApp</a>}
        </div>
      </footer>

      {/* Confirmar a escolha */}
      {escolhendo && (
        <div className="pv-nao-imprime fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Confirmar escolha">
          <div className="absolute inset-0" style={{ background: "rgba(11,42,40,.55)" }} onClick={() => !enviando && setEscolhendo(null)} />
          <div className="relative w-full max-w-[440px] rounded-t-2xl sm:rounded-2xl p-5 space-y-4" style={{ background: "#fff" }}>
            <h2 className="text-[20px] font-semibold" style={{ color: "var(--pv-escuro)" }}>
              {varias ? `Confirmar a opção ${p.opcoes.findIndex((o) => o.id === escolhendo) + 1}?` : "Confirmar esta proposta?"}
            </h2>
            <p className="text-[13.5px] pv-leve">Nosso time recebe o aviso na hora e entra em contato para confirmar a reserva e o pagamento. Ainda não é cobrança.</p>
            <label className="block">
              <span className="block text-[13px] font-medium mb-1">Seu nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className="w-full px-3 py-2.5 rounded-xl border text-[15px]" style={{ borderColor: "var(--pv-menta2)" }} />
            </label>
            {erro && <p className="text-[13px]" style={{ color: "#B4242A" }}>{erro}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 text-[14px] font-medium" onClick={() => setEscolhendo(null)} disabled={enviando}>Voltar</button>
              <button type="button" className="pv-botao" onClick={() => void confirmar()} disabled={enviando}>{enviando ? "Enviando…" : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
