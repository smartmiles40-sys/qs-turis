// src/propostas/PropostaView.tsx
// -----------------------------------------------------------------------------
// A proposta como o CLIENTE vê — usada no link público (/proposta/<token>), na
// prévia dentro do QS e no PDF (o PDF é esta mesma página impressa: "Salvar
// como PDF" do navegador com o CSS de impressão abaixo — página e PDF nunca
// divergem, lição do AgentePro).
//
// Marca da agência (paleta das LPs): verde-petróleo #09282B, off-white #F8F6F7,
// limão #D7F264 no destaque. Página clara sempre (é documento comercial).
// -----------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import {
  TIPOS, brl, dataBr, noites, textoPagamento, textoPassageiros, tituloDaProposta, totaisDaOpcao,
  type PropostaVM, type Trecho,
} from "./lib";

const AGENCIA = "Se Tu For, Eu Vou! Viagens";

const CSS = `
.pv { --pv-escuro: #09282B; --pv-fundo: #F8F6F7; --pv-limao: #D7F264; --pv-tinta: #1C2B2D; --pv-suave: #5B6B6D; --pv-linha: #E3E0E1; --pv-card: #FFFFFF;
  background: var(--pv-fundo); color: var(--pv-tinta); font-family: "Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif; min-height: 100%; }
.pv-serif { font-family: Georgia, "Times New Roman", serif; letter-spacing: -.01em; }
.pv-card { background: var(--pv-card); border: 1px solid var(--pv-linha); border-radius: 16px; }
.pv-botao { background: var(--pv-escuro); color: #fff; border-radius: 999px; padding: 10px 18px; font-weight: 700; font-size: 14px; }
.pv-botao:hover { opacity: .92; }
.pv-botao-limao { background: var(--pv-limao); color: var(--pv-escuro); }
.pv-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.1); color: #fff; font-size: 13px; }
.pv-sec { font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--pv-suave); }
.pv :focus-visible { outline: 2px solid var(--pv-escuro); outline-offset: 2px; }
@media print {
  @page { size: A4; margin: 12mm; }
  .pv { background: #fff !important; }
  .pv-nao-imprime { display: none !important; }
  .pv-quebra { break-before: page; }
  .pv-card, .pv-bloco { break-inside: avoid; }
  .pv * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

type Item = PropostaVM["opcoes"][number]["itens"][number];
type Opcao = PropostaVM["opcoes"][number];

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor == null || valor === "") return null;
  return <span className="mr-4 whitespace-nowrap"><span style={{ color: "var(--pv-suave)" }}>{rotulo}:</span> {valor}</span>;
}

function Valor({ i, esconder }: { i: Item; esconder: boolean }) {
  if (i.incluso) return <span className="text-[13px] font-semibold" style={{ color: "#0E7C6A" }}>Incluso</span>;
  if (esconder || !i.valor_total) return null;
  return <span className="text-[14px] font-bold tabular-nums whitespace-nowrap">{brl(i.valor_total)}</span>;
}

function Voos({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <div className="space-y-3">
      {itens.map((i, n) => {
        const trechos = (Array.isArray(i.detalhes.trechos) ? i.detalhes.trechos : []) as Trecho[];
        const d = i.detalhes as Record<string, string>;
        return (
          <div key={n} className="pv-card p-4 pv-bloco">
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="font-semibold text-[15px]">{i.nome || "Voo"}</p>
              <Valor i={i} esconder={esconder} />
            </div>
            <ol className="space-y-2">
              {trechos.filter((t) => t.origem || t.destino).map((t, k) => (
                <li key={k} className="grid grid-cols-[auto_1fr] gap-x-3 text-[13.5px]">
                  <span className="text-[11px] font-bold uppercase mt-0.5 px-2 py-0.5 rounded-full h-fit" style={{ background: t.sentido === "volta" ? "#EEF2F2" : "var(--pv-limao)", color: "var(--pv-escuro)" }}>
                    {t.sentido === "volta" ? "Volta" : t.sentido === "interno" ? "Trecho" : "Ida"}
                  </span>
                  <span>
                    <b>{t.origem || "?"} → {t.destino || "?"}</b>
                    <span style={{ color: "var(--pv-suave)" }}>
                      {" · "}{dataBr(t.data)}{t.saida ? ` ${t.saida}` : ""}{t.chegada ? ` → ${t.chegada_data && t.chegada_data !== t.data ? `${dataBr(t.chegada_data, false)} ` : ""}${t.chegada}` : ""}
                      {(t.cia || t.voo) ? ` · ${[t.cia, t.voo].filter(Boolean).join(" ")}` : ""}{t.classe ? ` · ${t.classe}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {(d.bagagem_mao || d.bagagem_despachada) && (
              <p className="text-[13px] mt-2"><Linha rotulo="Bagagem de mão" valor={d.bagagem_mao} /><Linha rotulo="Despachada" valor={d.bagagem_despachada} /></p>
            )}
            {i.descricao && <p className="text-[13px] mt-2 whitespace-pre-wrap" style={{ color: "var(--pv-suave)" }}>{i.descricao}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Hoteis({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {itens.map((i, n) => {
        const d = i.detalhes as Record<string, string>;
        const nts = noites(i.data_inicio, i.data_fim);
        const estrelas = Number(d.estrelas) || 0;
        return (
          <div key={n} className="pv-card p-4 pv-bloco">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[15px]">{i.nome || "Hospedagem"}</p>
                <p className="text-[13px]" style={{ color: "var(--pv-suave)" }}>
                  {estrelas > 0 && <span aria-label={`${estrelas} estrelas`} style={{ color: "#B7791F" }}>{"★".repeat(estrelas)} </span>}
                  {d.cidade}
                </p>
              </div>
              <Valor i={i} esconder={esconder} />
            </div>
            {(i.data_inicio || i.data_fim) && (
              <p className="text-[13.5px] mt-2">
                {dataBr(i.data_inicio)}{d.checkin_hora ? ` ${d.checkin_hora}` : ""}{i.data_fim ? ` → ${dataBr(i.data_fim)}${d.checkout_hora ? ` ${d.checkout_hora}` : ""}` : ""}
                {nts > 0 && <b> · {nts} noite{nts === 1 ? "" : "s"}</b>}
              </p>
            )}
            <p className="text-[13px] mt-1">
              <Linha rotulo="Quarto" valor={[d.quartos && Number(d.quartos) > 1 ? `${d.quartos}×` : "", d.quarto].filter(Boolean).join(" ")} />
              <Linha rotulo="Regime" valor={d.regime} />
            </p>
            {d.endereco && <p className="text-[12.5px] mt-1" style={{ color: "var(--pv-suave)" }}>{d.endereco}</p>}
            {i.descricao && <p className="text-[13px] mt-2 whitespace-pre-wrap" style={{ color: "var(--pv-suave)" }}>{i.descricao}</p>}
          </div>
        );
      })}
    </div>
  );
}

/** Transfer, trem, passeio, seguro, carro, cruzeiro, visto, pacote, outro. */
function Servicos({ itens, esconder }: { itens: Item[]; esconder: boolean }) {
  return (
    <ul className="pv-card divide-y" style={{ borderColor: "var(--pv-linha)" }}>
      {itens.map((i, n) => {
        const info = TIPOS[i.tipo];
        const d = i.detalhes as Record<string, string>;
        const [r1, r2] = info.datas;
        const extras = info.campos.filter((c) => c.tipo !== "area" && d[c.chave]).map((c) => <Linha key={c.chave} rotulo={c.rotulo} valor={d[c.chave]} />);
        return (
          <li key={n} className="p-4 flex gap-3 pv-bloco" style={{ borderColor: "var(--pv-linha)" }}>
            <span className="text-[20px] leading-none mt-0.5" aria-hidden>{info.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-[14.5px]">{i.nome || info.rotulo}{i.quantidade > 1 ? ` · ${i.quantidade}×` : ""}</p>
                <Valor i={i} esconder={esconder} />
              </div>
              <p className="text-[13px] mt-0.5">
                {r1 && i.data_inicio && <Linha rotulo={r1} valor={dataBr(i.data_inicio)} />}
                {r2 && i.data_fim && <Linha rotulo={r2} valor={dataBr(i.data_fim)} />}
                {extras}
              </p>
              {d.inclui && <p className="text-[13px] mt-1 whitespace-pre-wrap">{d.inclui}</p>}
              {i.descricao && <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: "var(--pv-suave)" }}>{i.descricao}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function rotuloOpcao(o: Opcao, n: number, total: number) {
  if (total === 1) return o.titulo || "Sua viagem";
  return `Opção ${n + 1}${o.titulo ? ` · ${o.titulo}` : ""}`;
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

  async function confirmar() {
    if (!escolhendo || !onEscolher) return;
    if (nome.trim().length < 3) { setErro("Escreva seu nome completo."); return; }
    setEnviando(true); setErro(null);
    try { await onEscolher(escolhendo, nome.trim()); setEscolhendo(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não conseguimos registrar agora. Tente de novo."); }
    setEnviando(false);
  }

  const BotaoEscolher = ({ o, n }: { o: Opcao; n: number }) => (podeEscolher ? (
    <button type="button" className="pv-botao pv-nao-imprime w-full sm:w-auto" onClick={() => { setErro(null); setEscolhendo(o.id); }}>
      {varias ? `Quero a opção ${n + 1}` : "Quero esta proposta"}
    </button>
  ) : null);

  return (
    <div className="pv">
      <style>{CSS}</style>
      {/* Topo */}
      <header className="pv-nao-imprime sticky top-0 z-10 border-b" style={{ background: "rgba(248,246,247,.94)", borderColor: "var(--pv-linha)", backdropFilter: "blur(6px)" }}>
        <div className="max-w-[880px] mx-auto px-4 py-3 flex items-center gap-3">
          <p className="flex-1 min-w-0 truncate font-bold text-[15px]" style={{ color: "var(--pv-escuro)" }}>{AGENCIA}</p>
          {p.numero > 0 && <span className="text-[12.5px] hidden sm:inline" style={{ color: "var(--pv-suave)" }}>Proposta nº {p.numero}</span>}
          <button type="button" onClick={() => window.print()} className="text-[13px] font-semibold px-3 py-1.5 rounded-full border" style={{ borderColor: "var(--pv-linha)", color: "var(--pv-escuro)", background: "#fff" }}>
            Baixar PDF
          </button>
        </div>
      </header>

      {previa && <p className="pv-nao-imprime text-center text-[12.5px] py-2" style={{ background: "#FFF7E0", color: "#7A5A00" }}>Prévia — é assim que o cliente vê. Custo, lucro, fornecedor e localizador não aparecem.</p>}

      {/* Capa */}
      <section style={{ background: "var(--pv-escuro)", color: "#fff" }}>
        {p.capa_url && <img src={p.capa_url} alt="" className="w-full max-h-[340px] object-cover" style={{ opacity: .9 }} />}
        <div className="max-w-[880px] mx-auto px-4 py-10 sm:py-14">
          <p className="text-[13px] font-semibold mb-2" style={{ color: "var(--pv-limao)" }}>
            {p.cliente_nome ? `Proposta para ${p.cliente_nome}` : "Proposta de viagem"}{p.numero > 0 ? ` · nº ${p.numero}` : ""}
          </p>
          <h1 className="pv-serif text-[34px] sm:text-[46px] leading-[1.08] font-bold">{tituloDaProposta(p)}</h1>
          <div className="flex flex-wrap gap-2 mt-5">
            {p.destino && <span className="pv-chip">📍 {p.destino}</span>}
            {p.data_ida && <span className="pv-chip">🗓️ {dataBr(p.data_ida)}{p.data_volta ? ` a ${dataBr(p.data_volta)}` : ""}{nts > 0 ? ` · ${nts} noites` : ""}</span>}
            {textoPassageiros(p) && <span className="pv-chip">👥 {textoPassageiros(p)}</span>}
          </div>
        </div>
      </section>

      <main className="max-w-[880px] mx-auto px-4 py-8 space-y-10">
        {aprovada && (
          <div className="rounded-2xl p-4 text-[14.5px] font-semibold" style={{ background: "#E4F4EF", color: "#0B6B5C" }}>
            ✓ {varias ? `${rotuloOpcao(aprovada, p.opcoes.indexOf(aprovada), p.opcoes.length)} escolhida` : "Proposta aprovada"}
            {p.aprovada_em ? ` em ${new Date(p.aprovada_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}. Nosso time já foi avisado e vai seguir com você.
          </div>
        )}

        {p.apresentacao && <p className="text-[16px] leading-relaxed whitespace-pre-wrap">{p.apresentacao}</p>}

        {/* Comparativo das opções */}
        {varias && (
          <section className="pv-bloco">
            <p className="pv-sec mb-3">Compare as opções</p>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}>
              {p.opcoes.map((o, n) => {
                const t = totaisDaOpcao(o);
                return (
                  <div key={o.id} className="pv-card p-4 flex flex-col gap-2" style={o.recomendada ? { borderColor: "var(--pv-escuro)", borderWidth: 2 } : undefined}>
                    {o.recomendada && <span className="self-start text-[11px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: "var(--pv-limao)", color: "var(--pv-escuro)" }}>Recomendada</span>}
                    <p className="font-semibold text-[15px]">{rotuloOpcao(o, n, p.opcoes.length)}</p>
                    {o.descricao && <p className="text-[13px]" style={{ color: "var(--pv-suave)" }}>{o.descricao}</p>}
                    <p className="pv-serif text-[24px] font-bold mt-auto">{brl(t.total)}</p>
                    <a href={`#opcao-${n + 1}`} className="text-[13px] font-semibold underline pv-nao-imprime" style={{ color: "var(--pv-escuro)" }}>Ver o que inclui</a>
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
            <section key={o.id} id={`opcao-${n + 1}`} className={`space-y-6 scroll-mt-20 ${varias && n > 0 ? "pv-quebra" : ""}`}>
              {varias && (
                <div className="flex items-center gap-3 border-b pb-3" style={{ borderColor: "var(--pv-linha)" }}>
                  <h2 className="pv-serif text-[26px] font-bold flex-1">{rotuloOpcao(o, n, p.opcoes.length)}</h2>
                  {o.recomendada && <span className="text-[11px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: "var(--pv-limao)", color: "var(--pv-escuro)" }}>Recomendada</span>}
                </div>
              )}
              {voos.length > 0 && <div><p className="pv-sec mb-3">Voos</p><Voos itens={voos} esconder={p.esconder_precos} /></div>}
              {hoteis.length > 0 && <div><p className="pv-sec mb-3">Hospedagem</p><Hoteis itens={hoteis} esconder={p.esconder_precos} /></div>}
              {outros.length > 0 && <div><p className="pv-sec mb-3">Serviços</p><Servicos itens={outros} esconder={p.esconder_precos} /></div>}

              {/* Investimento */}
              <div className="pv-card p-5 pv-bloco" style={{ background: "#fff" }}>
                <p className="pv-sec mb-3">Investimento</p>
                {t.desconto > 0 && (
                  <div className="text-[14px] space-y-1 mb-2">
                    <p className="flex justify-between"><span style={{ color: "var(--pv-suave)" }}>Subtotal</span><span className="tabular-nums">{brl(t.subtotal)}</span></p>
                    <p className="flex justify-between"><span style={{ color: "var(--pv-suave)" }}>Desconto</span><span className="tabular-nums">− {brl(t.desconto)}</span></p>
                  </div>
                )}
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold">Total{textoPassageiros(p) ? ` (${textoPassageiros(p)})` : ""}</span>
                  <span className="pv-serif text-[30px] font-bold tabular-nums">{brl(t.total)}</span>
                </p>
                {o.pagamentos.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[13px] font-semibold mb-1.5">{o.pagamentos.length > 1 ? "Formas de pagamento (escolha uma)" : "Forma de pagamento"}</p>
                    <ul className="space-y-1.5">
                      {o.pagamentos.map((pg, k) => (
                        <li key={k} className="text-[14px] flex gap-2"><span aria-hidden style={{ color: "#0E7C6A" }}>•</span><span>{textoPagamento(pg, t.total)}{pg.obs ? <span style={{ color: "var(--pv-suave)" }}> — {pg.obs}</span> : null}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {podeEscolher && <div className="mt-5"><BotaoEscolher o={o} n={n} /></div>}
              </div>
            </section>
          );
        })}

        {p.observacoes && (
          <section className="pv-bloco">
            <p className="pv-sec mb-2">Informações importantes</p>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{p.observacoes}</p>
          </section>
        )}

        <footer className="border-t pt-6 space-y-3 text-[13px]" style={{ borderColor: "var(--pv-linha)", color: "var(--pv-suave)" }}>
          <p>Valores sujeitos a confirmação de disponibilidade e tarifa no momento da reserva.{varias || p.opcoes.some((o) => o.pagamentos.length > 1) ? " As formas de pagamento são alternativas — você escolhe uma." : ""}</p>
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 min-w-[200px]"><b style={{ color: "var(--pv-tinta)" }}>{AGENCIA}</b>{p.consultor?.nome ? ` · seu consultor: ${p.consultor.nome}` : ""}</p>
            {zap && <a href={zap} target="_blank" rel="noreferrer" className="pv-botao pv-botao-limao pv-nao-imprime">Falar no WhatsApp</a>}
          </div>
        </footer>
      </main>

      {/* Confirmar a escolha */}
      {escolhendo && (
        <div className="pv-nao-imprime fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Confirmar escolha">
          <div className="absolute inset-0" style={{ background: "rgba(9,40,43,.5)" }} onClick={() => !enviando && setEscolhendo(null)} />
          <div className="relative w-full max-w-[440px] rounded-t-2xl sm:rounded-2xl p-5 space-y-4" style={{ background: "#fff" }}>
            <h2 className="pv-serif text-[22px] font-bold">
              {varias ? `Confirmar a opção ${p.opcoes.findIndex((o) => o.id === escolhendo) + 1}?` : "Confirmar esta proposta?"}
            </h2>
            <p className="text-[14px]" style={{ color: "var(--pv-suave)" }}>Nosso time recebe o aviso na hora e entra em contato para confirmar a reserva e o pagamento. Ainda não é cobrança.</p>
            <label className="block">
              <span className="block text-[13px] font-semibold mb-1">Seu nome</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus className="w-full px-3 py-2.5 rounded-xl border text-[15px]" style={{ borderColor: "var(--pv-linha)" }} />
            </label>
            {erro && <p className="text-[13px]" style={{ color: "#B4242A" }}>{erro}</p>}
            <div className="flex gap-2 justify-end">
              <button type="button" className="px-4 py-2 text-[14px] font-semibold" onClick={() => setEscolhendo(null)} disabled={enviando}>Voltar</button>
              <button type="button" className="pv-botao" onClick={() => void confirmar()} disabled={enviando}>{enviando ? "Enviando…" : "Confirmar"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
