// src/solicitacoes/FormPagamento.tsx
// -----------------------------------------------------------------------------
// As telas dos PEDIDOS DE PAGAMENTO ao Financeiro (0201): preencher
// (NovaSolicitacao e "Enviar ajustes"), amarrar (cliente/venda · expedição ·
// para que é), ler, e o quadro do pagamento dentro da solicitação aberta (o que
// o Financeiro já fez + os botões do Financeiro). Regras e textos em pagamento.ts.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta } from "@/rel/ui";
import EscolherClienteVenda, { type Escolha } from "./EscolherClienteVenda";
import {
  ACEITA_ARQUIVO, FINALIDADES, FREQUENCIAS, MOEDAS, O_QUE_CARTAO, TIPO_PAG_DO, abrirArquivo, acaoParcela, acaoPagamento, anexarArquivo,
  buscarExpedicoes, carregarPagamento, dataBr, dinheiro, secoesDoPagamento, textoExpedicao, valorDe,
  type ExpedicaoAchada, type FormPagamento, type Moeda, type Vinculo,
} from "./pagamento";
import type { Solicitacao } from "./lib";

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

function Chips({ opcoes, valor, onMudar, rotulo }: { opcoes: (string | [string, string])[]; valor: string; onMudar: (v: string) => void; rotulo: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => {
        const [k, r] = typeof o === "string" ? [o, o] : o;
        const marcado = valor === k;
        return (
          <button key={k} type="button" role="radio" aria-checked={marcado} onClick={() => onMudar(k)}
            className="rounded-full px-3 h-8 text-[12.5px] border"
            style={marcado ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
            {r}
          </button>
        );
      })}
    </div>
  );
}

function Grupo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>{rotulo}</p>
      {children}
      {dica && <p className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>{dica}</p>}
    </div>
  );
}

/** Valor + moeda (Pix é sempre em reais). */
function ValorMoeda({ f, mudar, rotulo = "Valor" }: { f: FormPagamento; mudar: <K extends keyof FormPagamento>(k: K, v: FormPagamento[K]) => void; rotulo?: string }) {
  const v = valorDe(f);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
      <Campo rotulo={rotulo} dica={f.valor.trim() && v > 0 ? dinheiro(v, f.tipo === "pix" ? "BRL" : f.moeda) : "Ex.: 1.250,00"}>
        <Entrada inputMode="decimal" value={f.valor} onChange={(e) => mudar("valor", e.target.value.replace(/[^\d.,]/g, ""))} maxLength={16} placeholder="0,00" />
      </Campo>
      {f.tipo !== "pix" && (
        <Campo rotulo="Moeda">
          <select className="rel-input" value={f.moeda} onChange={(e) => mudar("moeda", e.target.value as Moeda)}>
            {MOEDAS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </Campo>
      )}
    </div>
  );
}

/** Os campos do pedido (o tipo já vem escolhido). */
export default function FormPagamentoCampos({ f, onMudar }: { f: FormPagamento; onMudar: (f: FormPagamento) => void }) {
  const mudar = <K extends keyof FormPagamento>(k: K, v: FormPagamento[K]) => onMudar({ ...f, [k]: v });
  const data = (k: "data_limite" | "vencimento", rotulo: string, dica?: string) => (
    <Campo rotulo={rotulo} dica={dica}><input type="date" className="rel-input" value={f[k]} onChange={(e) => mudar(k, e.target.value)} /></Campo>
  );

  return (
    <fieldset className="rel-card p-3 space-y-3">
      <legend className="px-1 text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>O pagamento</legend>

      {f.tipo === "pix" && (<>
        <ValorMoeda f={f} mudar={mudar} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Quem recebe (favorecido)"><Entrada value={f.favorecido} onChange={(e) => mudar("favorecido", e.target.value)} maxLength={120} placeholder="Nome ou razão social" /></Campo>
          <Campo rotulo="CPF ou CNPJ de quem recebe"><Entrada inputMode="numeric" value={f.documento} onChange={(e) => mudar("documento", e.target.value.replace(/[^\d./-]/g, ""))} maxLength={18} placeholder="Só os números serve" /></Campo>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Chave Pix"><Entrada value={f.chave_pix} onChange={(e) => mudar("chave_pix", e.target.value)} maxLength={120} placeholder="CPF/CNPJ, e-mail, telefone ou aleatória" /></Campo>
          {data("data_limite", "Pagar até")}
        </div>
        <Campo rotulo="Para que é" dica="O Financeiro usa isso pra lançar a despesa no lugar certo.">
          <Entrada value={f.para_que} onChange={(e) => mudar("para_que", e.target.value)} maxLength={300} placeholder="Ex.: sinal do hotel em Reykjavík da Islândia G2" />
        </Campo>
      </>)}

      {f.tipo === "link" && (<>
        <ValorMoeda f={f} mudar={mudar} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Parcelas (no máximo)" dica="1 = à vista.">
            <select className="rel-input" value={f.parcelas_max} onChange={(e) => mudar("parcelas_max", e.target.value)}>
              {Array.from({ length: 24 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n === "1" ? "À vista (1x)" : `Até ${n}x`}</option>)}
            </select>
          </Campo>
          {data("vencimento", "Vencimento do link (opcional)")}
        </div>
        <Campo rotulo="Descrição que aparece pro cliente" dica="É o texto que o cliente lê no link.">
          <Entrada value={f.descricao_cliente} onChange={(e) => mudar("descricao_cliente", e.target.value)} maxLength={200} placeholder="Ex.: Entrada — Expedição Japão Março 2027" />
        </Campo>
      </>)}

      {f.tipo === "cartao" && (<>
        <Grupo rotulo="O que vai ser comprado"><Chips rotulo="O que vai ser comprado" opcoes={O_QUE_CARTAO} valor={f.o_que} onMudar={(v) => mudar("o_que", v)} /></Grupo>
        <Campo rotulo={f.o_que === "Outro" ? "O que é" : "Detalhe (opcional)"}>
          <Entrada value={f.o_que_texto} onChange={(e) => mudar("o_que_texto", e.target.value)} maxLength={200} placeholder="Ex.: assento 14C ida e volta, voo LA8084" />
        </Campo>
        <Campo rotulo="Onde comprar (fornecedor ou site)"><Entrada value={f.fornecedor} onChange={(e) => mudar("fornecedor", e.target.value)} maxLength={200} placeholder="Ex.: site da LATAM, localizador SCIXQB" /></Campo>
        <ValorMoeda f={f} mudar={mudar} />
        {data("data_limite", "Pagar até")}
      </>)}

      {f.tipo === "provisao" && (<>
        <Campo rotulo="Fornecedor (quem vai receber)"><Entrada value={f.fornecedor} onChange={(e) => mudar("fornecedor", e.target.value)} maxLength={200} placeholder="Ex.: DMC Japan Travel" /></Campo>
        <ValorMoeda f={f} mudar={mudar} rotulo={Number(f.parcelas) > 1 ? "Valor de CADA parcela" : "Valor"} />
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo rotulo="Parcelas">
            <select className="rel-input" value={f.parcelas} onChange={(e) => mudar("parcelas", e.target.value)}>
              {Array.from({ length: 60 }, (_, i) => String(i + 1)).map((n) => <option key={n} value={n}>{n === "1" ? "Uma vez só" : `${n} parcelas`}</option>)}
            </select>
          </Campo>
          {data("vencimento", Number(f.parcelas) > 1 ? "1º vencimento" : "Vencimento")}
          {Number(f.parcelas) > 1 && (
            <Campo rotulo="De quanto em quanto tempo">
              <select className="rel-input" value={f.frequencia} onChange={(e) => mudar("frequencia", e.target.value as FormPagamento["frequencia"])}>
                {FREQUENCIAS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
              </select>
            </Campo>
          )}
        </div>
        {Number(f.parcelas) > 1 && valorDe(f) > 0 && (
          <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>Total previsto: <b>{dinheiro(valorDe(f) * Number(f.parcelas), f.moeda)}</b></p>
        )}
        <Campo rotulo="Para que é"><Entrada value={f.para_que} onChange={(e) => mudar("para_que", e.target.value)} maxLength={300} placeholder="Ex.: saldo da hospedagem do grupo G1" /></Campo>
      </>)}

      <Campo rotulo="Observações (opcional)" dica="Tudo que o Financeiro precisa pra não ter que te perguntar.">
        <textarea className="rel-input" rows={2} maxLength={2000} value={f.obs} onChange={(e) => mudar("obs", e.target.value)} />
      </Campo>
    </fieldset>
  );
}

/** Escolher a expedição (lista as que não foram canceladas). */
export function EscolherExpedicao({ id, nome, onMudar }: { id: string; nome: string; onMudar: (e: ExpedicaoAchada | null) => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<ExpedicaoAchada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (id) return;
    const h = setTimeout(() => { buscarExpedicoes(termo.trim()).then(setLista).catch((e) => setErro(e instanceof Error ? e.message : "Não buscou.")); }, 250);
    return () => clearTimeout(h);
  }, [termo, id]);

  if (id) {
    return (
      <div className="flex items-center gap-2 text-[13.5px]">
        <span className="font-semibold" style={{ color: "var(--ink)" }}>{nome || "Expedição escolhida"}</span>
        <button type="button" className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => onMudar(null)}>trocar</button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Nome, código ou destino da expedição" aria-label="Buscar expedição" />
      {erro && <p className="text-[12px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {lista && lista.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma expedição com isso.</p>}
      {lista && lista.length > 0 && (
        <ul className="rel-card max-h-48 overflow-y-auto divide-y" style={{ borderColor: "var(--line)" }}>
          {lista.map((e) => (
            <li key={e.id}>
              <button type="button" className="rel-linha w-full text-left px-3 py-2 text-[13.5px]" onClick={() => onMudar(e)}>
                <span className="font-semibold" style={{ color: "var(--ink)" }}>{e.nome}</span>
                <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{e.data_embarque ? ` · embarca ${dataBr(e.data_embarque)}` : ""}{e.codigo ? ` · ${e.codigo}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Amarrado a quê": cliente/venda · expedição · não é de cliente (para que é). */
export function VinculoPagamento({ f, onMudar, escolha, onEscolha, travarCliente, buscaInicial, temLead, nomeLead }: {
  f: FormPagamento; onMudar: (f: FormPagamento) => void;
  escolha: Escolha | null; onEscolha: (e: Escolha | null) => void;
  travarCliente?: boolean; buscaInicial?: string; temLead?: boolean; nomeLead?: string | null;
}) {
  const opcoes: [Vinculo, string][] = [["cliente", "Um cliente / venda"], ["expedicao", "Uma expedição"], ["finalidade", "Não é de cliente"]];
  return (
    <div className="rel-card p-3 space-y-2.5">
      <p className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Esse pagamento é de quê? <span style={{ color: "var(--ink3)", fontWeight: 400 }}>— fica tudo amarrado</span></p>
      {!travarCliente && <Chips rotulo="Amarrado a" opcoes={opcoes} valor={f.vinculo} onMudar={(v) => onMudar({ ...f, vinculo: v as Vinculo })} />}
      {f.vinculo === "cliente" && (<>
        {temLead && !escolha && (
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Vai ligado ao lead <b style={{ color: "var(--ink2)" }}>{nomeLead}</b>. Se ele já é cliente, escolha abaixo pra ficar na ficha também.</p>
        )}
        <EscolherClienteVenda valor={escolha} onMudar={onEscolha} travarCliente={travarCliente} buscaInicial={buscaInicial} />
      </>)}
      {f.vinculo === "expedicao" && (
        <EscolherExpedicao id={f.expedicao_id} nome={f.expedicao_nome}
          onMudar={(e) => onMudar({ ...f, expedicao_id: e?.id ?? "", expedicao_nome: e ? textoExpedicao(e) : "" })} />
      )}
      {f.vinculo === "finalidade" && (<>
        <Grupo rotulo="Para que é"><Chips rotulo="Para que é" opcoes={FINALIDADES} valor={f.finalidade} onMudar={(v) => onMudar({ ...f, finalidade: v })} /></Grupo>
        <Campo rotulo="Explique em uma frase">
          <Entrada value={f.finalidade_texto} onChange={(e) => onMudar({ ...f, finalidade_texto: e.target.value })} maxLength={300} placeholder="Ex.: anúncio no Instagram da live do Peru; conta de luz do escritório" />
        </Campo>
      </>)}
    </div>
  );
}

/** O pedido preenchido, de leitura. */
export function VerPagamento({ f }: { f: FormPagamento }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2.5">
      {secoesDoPagamento(f).map((s) => (
        <section key={s.titulo} className="rounded-xl p-3" style={{ background: "var(--card2)" }} aria-label={s.titulo}>
          <h4 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>{s.titulo}</h4>
          <dl className="space-y-1">
            {s.linhas.map(([r, v], i) => (
              <div key={i} className="text-[13px] leading-snug">
                {r && <dt className="inline font-semibold" style={{ color: "var(--ink2)" }}>{r}: </dt>}
                <dd className="inline whitespace-pre-wrap break-words" style={{ color: "var(--ink)" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Escolher arquivos (PDF ou foto). */
export function EscolherArquivos({ arquivos, onMudar, rotulo = "Anexar boleto, nota ou print (opcional)", multiplo = true }: {
  arquivos: File[]; onMudar: (a: File[]) => void; rotulo?: string; multiplo?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input ref={ref} type="file" accept={ACEITA_ARQUIVO} multiple={multiplo} className="hidden"
        onChange={(e) => { const novos = Array.from(e.target.files ?? []); onMudar(multiplo ? [...arquivos, ...novos].slice(0, 5) : novos.slice(0, 1)); e.target.value = ""; }} />
      <Botao type="button" onClick={() => ref.current?.click()}>📎 {rotulo}</Botao>
      {arquivos.length > 0 && (
        <ul className="text-[12.5px] space-y-0.5" style={{ color: "var(--ink2)" }}>
          {arquivos.map((a, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="truncate">{a.name}</span>
              <button type="button" className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => onMudar(arquivos.filter((_, j) => j !== i))}>tirar</button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px]" style={{ color: "var(--ink3)" }}>PDF ou foto, até 15 MB.</p>
    </div>
  );
}

type Dados = Awaited<ReturnType<typeof carregarPagamento>>;

/**
 * Dentro da solicitação aberta: o que o Financeiro já fez (link pra copiar,
 * pago em, parcelas, arquivos) e — pra quem é do Financeiro — os botões.
 */
export function PagamentoNoDetalhe({ s, f, financeiro, onMudou }: { s: Solicitacao; f: FormPagamento | null; financeiro: boolean; onMudou: () => void }) {
  const k = TIPO_PAG_DO[s.tipo_id ?? ""];
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [link, setLink] = useState("");
  const [obs, setObs] = useState("");
  const [pagoEm, setPagoEm] = useState(hoje());
  const [valor, setValor] = useState("");
  const [comprovante, setComprovante] = useState<File[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [baixa, setBaixa] = useState<{ id: string; data: string; valor: string } | null>(null);

  const carregar = useCallback(async () => {
    try { setD(await carregarPagamento(s.id)); } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou o pagamento."); }
  }, [s.id]);
  useEffect(() => { void carregar(); setLink(""); setObs(""); setPagoEm(hoje()); setValor(f?.valor ?? ""); setComprovante([]); setDocs([]); setBaixa(null); setErro(null); }, [carregar, s.atualizado_em, f?.valor]);

  async function rodar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await fn(); await carregar(); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo."); } finally { setOcupado(false); }
  }
  const temComprovante = !!d?.anexos.some((a) => a.tipo === "comprovante");
  const moeda = f?.tipo === "pix" ? "BRL" : f?.moeda ?? "BRL";
  const valorNum = (t: string) => { const n = valorDe({ valor: t }); return t.trim() && n > 0 ? n : null; };

  async function marcarPago() {
    await rodar(async () => {
      for (const a of comprovante) await anexarArquivo(s.id, "comprovante", a);
      await acaoPagamento(s.id, "pago", { data: pagoEm, valor: valorNum(valor), obs });
    });
  }

  if (!k) return null;
  return (
    <section className="rel-card p-3 space-y-3" aria-label="Pagamento">
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Pagamento no Financeiro</p>

      {/* O que já foi feito */}
      {d?.feito?.link && (
        <div className="rounded-xl p-3 space-y-1.5" style={{ background: "var(--rel-soft)" }}>
          <p className="text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }}>Link de pagamento pronto — copie e mande pro cliente:</p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={d.feito.link} target="_blank" rel="noreferrer" className="text-[13px] underline break-all" style={{ color: "var(--ink)" }}>{d.feito.link}</a>
            <Botao variante="primario" onClick={() => { void navigator.clipboard?.writeText(d.feito!.link!).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }); }}>
              {copiado ? "Copiado ✔" : "Copiar link"}
            </Botao>
          </div>
        </div>
      )}
      {d?.feito?.pago_em && (
        <Aviso tom="ok"><b>Pago em {dataBr(d.feito.pago_em)}</b> — {dinheiro(d.feito.pago_valor, d.feito.pago_moeda ?? moeda)}{d.feito.obs ? `. ${d.feito.obs}` : ""}</Aviso>
      )}
      {d && d.parcelas.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Parcelas provisionadas</p>
          <ul className="text-[13px] divide-y" style={{ borderColor: "var(--line)" }}>
            {d.parcelas.map((x) => {
              const atrasada = x.status === "a_pagar" && x.vencimento < hoje();
              return (
                <li key={x.id} className="py-1.5 flex flex-wrap items-center gap-2">
                  <span className="tabular-nums w-12" style={{ color: "var(--ink3)" }}>{x.numero}/{d.parcelas.length}</span>
                  <span className="tabular-nums">{dataBr(x.vencimento)}</span>
                  <b className="tabular-nums">{dinheiro(x.valor, x.moeda)}</b>
                  <Etiqueta tom={x.status === "pago" ? "rel" : x.status === "cancelado" ? "neutro" : atrasada ? "erro" : "aviso"}>
                    {x.status === "pago" ? `Paga em ${dataBr(x.pago_em)}` : x.status === "cancelado" ? "Cancelada" : atrasada ? "Atrasada" : "A pagar"}
                  </Etiqueta>
                  {financeiro && x.status === "a_pagar" && <Botao disabled={ocupado} onClick={() => setBaixa({ id: x.id, data: hoje(), valor: String(x.valor).replace(".", ",") })}>Marcar paga</Botao>}
                  {financeiro && x.status === "pago" && <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(() => acaoParcela(x.id, "desfazer"))}>Desfazer</Botao>}
                </li>
              );
            })}
          </ul>
          {baixa && (
            <div className="flex flex-wrap items-end gap-2 mt-2">
              <Campo rotulo="Pago em"><input type="date" className="rel-input" max={hoje()} value={baixa.data} onChange={(e) => setBaixa({ ...baixa, data: e.target.value })} /></Campo>
              <Campo rotulo="Valor pago"><Entrada inputMode="decimal" value={baixa.valor} onChange={(e) => setBaixa({ ...baixa, valor: e.target.value })} /></Campo>
              <Botao variante="primario" disabled={ocupado || !baixa.data} onClick={() => void rodar(async () => { await acaoParcela(baixa.id, "pago", { data: baixa.data, valor: valorNum(baixa.valor) }); setBaixa(null); })}>Confirmar</Botao>
              <Botao variante="fantasma" onClick={() => setBaixa(null)}>Voltar</Botao>
            </div>
          )}
        </div>
      )}

      {/* Arquivos */}
      {d && d.anexos.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Arquivos</p>
          <ul className="text-[13px] space-y-0.5">
            {d.anexos.map((a) => (
              <li key={a.id}>
                <button type="button" className="underline text-left" style={{ color: "var(--rel-ink)" }}
                  onClick={() => { abrirArquivo(a.path).then((u) => window.open(u, "_blank", "noopener")).catch((e) => setErro(e instanceof Error ? e.message : "Não abriu.")); }}>
                  {a.tipo === "comprovante" ? "🧾 Comprovante" : "📎"} {a.nome}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.aberta && (
        <div className="flex flex-wrap items-start gap-2">
          <EscolherArquivos arquivos={docs} onMudar={setDocs} rotulo="Anexar arquivo ao pedido" />
          {docs.length > 0 && <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(async () => { for (const a of docs) await anexarArquivo(s.id, "documento", a); setDocs([]); })}>Enviar arquivo{docs.length > 1 ? "s" : ""}</Botao>}
        </div>
      )}

      {/* Botões do Financeiro */}
      {financeiro && s.aberta && f && (
        <div className="rounded-xl p-3 space-y-2.5 border" style={{ borderColor: "var(--rel)" }}>
          {k === "link" && (<>
            <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Gerou o link? Cole aqui — {s.criado_por_nome?.split(" ")[0] ?? "quem pediu"} recebe na hora pra mandar ao cliente.</p>
            <Entrada value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Link de pagamento" />
            <Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Recado (opcional). Ex.: link vale por 3 dias" maxLength={500} aria-label="Recado" />
            <Botao variante="primario" disabled={ocupado || !/^https?:\/\/\S+$/i.test(link.trim())} onClick={() => void rodar(() => acaoPagamento(s.id, "link", { link: link.trim(), obs }))}>
              {ocupado ? "Enviando…" : "Enviar o link a quem pediu"}
            </Botao>
          </>)}
          {(k === "pix" || k === "cartao") && (<>
            <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Pagou? Anexe o comprovante e marque como pago.</p>
            <div className="flex flex-wrap items-end gap-3">
              <Campo rotulo="Pago em"><input type="date" className="rel-input" max={hoje()} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} /></Campo>
              <Campo rotulo={`Valor pago (${moeda})`}><Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))} /></Campo>
            </div>
            {!temComprovante && <EscolherArquivos arquivos={comprovante} onMudar={setComprovante} rotulo="Escolher o comprovante" multiplo={false} />}
            {temComprovante && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Comprovante já anexado.</p>}
            <Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" maxLength={500} aria-label="Observação" />
            <Botao variante="primario" disabled={ocupado || !pagoEm || (!temComprovante && comprovante.length === 0)} onClick={() => void marcarPago()}>
              {ocupado ? "Salvando…" : "Marcar como pago"}
            </Botao>
          </>)}
          {k === "provisao" && (<>
            <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              Conferiu? Provisione: vira {Number(f.parcelas) > 1 ? `${f.parcelas} parcelas` : "1 conta"} “a pagar” na aba Provisionado, a partir de {dataBr(f.vencimento)}.
            </p>
            <Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional)" maxLength={500} aria-label="Observação" />
            <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(() => acaoPagamento(s.id, "provisionar", { obs }))}>{ocupado ? "Salvando…" : "Provisionar"}</Botao>
          </>)}
          <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Isso conclui o pedido e avisa quem pediu. Faltou informação? Use <b>Pedir ajuste</b>.</p>
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </section>
  );
}
