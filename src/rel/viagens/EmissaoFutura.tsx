// src/rel/viagens/EmissaoFutura.tsx
// -----------------------------------------------------------------------------
// ABA "EMISSÃO FUTURA" DA FICHA DA VIAGEM (24/11/2026). Bruno: "para o que ainda
// não foi emitido e tem que emitir mais próximo da data".
//
//   1) A EMITIR — itens com situação "a emitir" (os da venda e os que o Rel
//      agenda aqui). Cada um sabe QUANDO ABRE (dados.emitir_de — o trem-bala
//      abre 3 meses antes) e ATÉ QUANDO (dados.emitir_ate; sem ele, a data de
//      uso). Ordem: vencido › urgente › aberto › ainda não abre.
//   2) VENDIDO SEM COMPROVANTE — o que a prontidão diz que a venda tem e ainda
//      não tem voo/voucher/apólice (venda antiga do Bitrix não tem item).
//      "Agendar" vira um item "a emitir" com as datas.
//   3) JÁ EMITIDO — fechado, só pra consulta.
// As regras de abertura (src/lib/emissao.ts) são editáveis aqui (gestão).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { dataBR, hojeSP } from "../lib/viagens";
import { TIPOS_LANCAVEIS, infoDoTipo, lancarItemAvulso, salvarItem, type Componente } from "../lib/componentes";
import type { Quadro } from "../lib/prontidao";
import { COR_EMISSAO, REGRAS_PADRAO, estadoEmissao, regraPara, sugerirDatas, textoDoItem, type RegraEmissao, type SituacaoEmissao } from "@/lib/emissao";
import { carregarRegras, salvarRegras } from "@/lib/emissaoRegras";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

const DE_QUADRO: Partial<Record<Quadro["chave"], string>> = { ida: "aereo", volta: "aereo", internos: "aereo", hospedagem: "hospedagem", passeios: "passeio", seguro: "seguro" };
const ORDEM: Record<SituacaoEmissao, number> = { vencida: 0, urgente: 1, aberta: 2, aguardando: 3 };
const TOM: Record<SituacaoEmissao, string> = { vencida: "falta", urgente: "atencao", aberta: "ok", aguardando: "espera" };
const txt = (x: unknown) => (typeof x === "string" ? x : "");

/** Quantas coisas ainda faltam emitir (o número da aba). */
export function pendenciasDeEmissao(comps: Componente[] | null, quadros: Quadro[]): number {
  const aEmitir = (comps ?? []).filter((c) => c.fonte === "venda" && c.status === "vendido");
  const tipos = new Set(aEmitir.map((c) => c.tipo));
  const lacunas = quadros.filter((q) => DE_QUADRO[q.chave] && (q.estado === "falta" || q.estado === "atencao") && !tipos.has(DE_QUADRO[q.chave]!));
  return aEmitir.length + lacunas.length;
}

interface Form { tipo: string; nome: string; uso: string; de: string; ate: string; fornecedor: string; obs: string; manual: boolean }

export default function EmissaoFutura({ viagemId, comps, quadros, carregando, dataIda, ativa, onMudou }: {
  viagemId: string; comps: Componente[] | null; quadros: Quadro[]; carregando: boolean;
  dataIda: string | null; ativa: boolean; onMudou: () => void;
}) {
  const hoje = hojeSP();
  const [regras, setRegras] = useState<RegraEmissao[]>(REGRAS_PADRAO);
  useEffect(() => { carregarRegras().then(setRegras).catch(() => {}); }, []);
  const [novo, setNovo] = useState<Form | null>(null);
  const [datas, setDatas] = useState<{ c: Componente; de: string; ate: string; obs: string } | null>(null);
  const [editRegras, setEditRegras] = useState<RegraEmissao[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const daVenda = (comps ?? []).filter((c) => c.fonte === "venda");
  const aEmitir = daVenda.filter((c) => c.status === "vendido")
    .map((c) => ({ c, e: estadoEmissao(c, hoje) }))
    .sort((a, b) => ORDEM[a.e.situacao] - ORDEM[b.e.situacao] || String(a.e.abre ?? a.e.prazo ?? "9999").localeCompare(String(b.e.abre ?? b.e.prazo ?? "9999")));
  const emitidos = daVenda.filter((c) => c.status === "emitido");
  const tiposAgendados = new Set(aEmitir.map((x) => x.c.tipo));
  const lacunas = quadros.filter((q) => DE_QUADRO[q.chave] && (q.estado === "falta" || q.estado === "atencao") && !tiposAgendados.has(DE_QUADRO[q.chave]!));

  /** Recalcula "abre em / emitir até" pela regra enquanto ninguém mexeu nas datas. */
  function comRegra(f: Form): Form {
    if (f.manual) return f;
    const s = sugerirDatas(regraPara(regras, f.tipo, f.nome), f.uso || null);
    return { ...f, de: s.emitir_de ?? "", ate: s.emitir_ate ?? "" };
  }
  const abrir = (tipo = "aereo", nome = "") => { setErro(null); setNovo(comRegra({ tipo, nome, uso: dataIda ?? "", de: "", ate: "", fornecedor: "", obs: "", manual: false })); };

  async function marcarEmitido(c: Componente) {
    setOcupado(c.id); setErro(null);
    try { await salvarItem(c.id, { status: "emitido" }); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não marcou."); }
    finally { setOcupado(null); }
  }
  async function salvarNovo() {
    if (!novo) return;
    setOcupado("novo"); setErro(null);
    try {
      await lancarItemAvulso(viagemId, {
        tipo: novo.tipo, nome: novo.nome.trim() || infoDoTipo(novo.tipo).rotulo, data_inicio: novo.uso || null, data_fim: null,
        dados: { emite_depois: "sim", emitir_de: novo.de || null, emitir_ate: novo.ate || null, obs: novo.obs.trim() || null },
        fornecedor: novo.fornecedor.trim() || null, status: "vendido",
      });
      setNovo(null); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(null); }
  }
  async function salvarDatas() {
    if (!datas) return;
    setOcupado("datas"); setErro(null);
    try {
      // null apaga a chave (o banco faz jsonb_strip_nulls)
      await salvarItem(datas.c.id, { dados: { emite_depois: "sim", emitir_de: datas.de || null, emitir_ate: datas.ate || null, obs: datas.obs.trim() || null, emissao_auto: null } });
      setDatas(null); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(null); }
  }
  async function gravarRegras() {
    if (!editRegras) return;
    const limpas = editRegras.filter((r) => r.rotulo.trim()).map((r) => ({ ...r, rotulo: r.rotulo.trim(), palavras: r.palavras.map((p) => p.trim()).filter(Boolean) }));
    setOcupado("regras"); setErro(null);
    const ok = await salvarRegras(limpas);
    setOcupado(null);
    if (!ok) { setErro("Não salvou as regras — só a gestão pode mudar."); return; }
    setRegras(limpas); setEditRegras(null);
  }

  if (carregando) return <div className="vf-card h-32 animate-pulse" style={{ background: "var(--surface-2)" }} aria-busy />;

  return (
    <section className="flex flex-col gap-5" aria-label="Emissão futura">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vf-sub">O que foi vendido e ainda vai ser emitido. Cada item mostra quando a emissão abre e até quando dá pra emitir — e cai na rotina do time no dia certo.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="vf-btn vf-btn--sm" onClick={() => setEditRegras(regras.map((r) => ({ ...r })))}>Regras de abertura</button>
          {ativa && <button type="button" className="vf-btn" onClick={() => abrir()}>+ Agendar emissão</button>}
        </div>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="vf-card flex flex-col gap-3">
        <h2 className="vf-h2">A emitir · {aEmitir.length}</h2>
        {aEmitir.length === 0 && <p className="vf-sub">Nada agendado pra emitir.{lacunas.length ? " Veja abaixo o que a venda tem e ainda não foi emitido." : ""}</p>}
        {aEmitir.map(({ c, e }) => {
          const info = infoDoTipo(c.tipo);
          const obs = txt(c.dados?.obs) || null;
          const podeEmitir = e.situacao !== "aguardando";
          return (
            <div key={c.id} className={`vf-emit vf-emit--${TOM[e.situacao]}`}>
              <span className="text-[20px]" aria-hidden>{info.emoji}</span>
              <span className="vf-emit__txt">
                <b>{c.nome}</b>
                <span className="vf-sub">{[info.rotulo, c.fornecedor, c.data_inicio && `uso em ${dataBR(c.data_inicio)}`, obs].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="vf-emit__quando">
                <b style={{ color: COR_EMISSAO[e.situacao] }}>{e.situacao === "aguardando" ? "Ainda não abre" : e.situacao === "vencida" ? "Prazo vencido" : e.situacao === "urgente" ? "Emitir já" : "Pode emitir"}</b>
                {e.texto}
              </span>
              {ativa && (
                <span className="flex gap-1.5">
                  <Botao onClick={() => setDatas({ c, de: txt(c.dados?.emitir_de), ate: txt(c.dados?.emitir_ate), obs: obs ?? "" })} title="Quando abre e até quando emitir">Datas</Botao>
                  <Botao variante={podeEmitir ? "primario" : "secundario"} disabled={ocupado === c.id} onClick={() => void marcarEmitido(c)}>{ocupado === c.id ? "…" : "Marcar emitido"}</Botao>
                </span>
              )}
            </div>
          );
        })}
      </div>

      {lacunas.length > 0 && (
        <div className="vf-card flex flex-col gap-3">
          <div>
            <h2 className="vf-h2">Vendido e ainda sem comprovante · {lacunas.length}</h2>
            <p className="vf-sub mt-1">Pelo que a venda tem: falta voo, voucher ou apólice. Agende a emissão com as datas certas, ou anexe o comprovante na aba Viagem.</p>
          </div>
          {lacunas.map((q) => (
            <div key={q.chave} className={`vf-emit vf-emit--${q.estado === "falta" ? "falta" : "atencao"}`}>
              <span className="text-[20px]" aria-hidden>{infoDoTipo(DE_QUADRO[q.chave]!).emoji}</span>
              <span className="vf-emit__txt">
                <b>{q.rotulo} · {q.valor}</b>
                {q.detalhe && <span className="vf-sub">{q.detalhe}</span>}
              </span>
              {ativa && <Botao onClick={() => abrir(DE_QUADRO[q.chave]!, q.chave === "ida" ? "Voo de ida" : q.chave === "volta" ? "Voo de volta" : q.chave === "internos" ? "Voo interno" : "")}>Agendar</Botao>}
            </div>
          ))}
        </div>
      )}

      {emitidos.length > 0 && (
        <details className="vf-card">
          <summary className="cursor-pointer vf-h2">Já emitido · {emitidos.length}</summary>
          <div className="flex flex-col gap-2 mt-3">
            {emitidos.map((c) => (
              <div key={c.id} className="vf-emit vf-emit--ok">
                <span className="text-[20px]" aria-hidden>{infoDoTipo(c.tipo).emoji}</span>
                <span className="vf-emit__txt"><b>{c.nome}</b><span className="vf-sub">{[infoDoTipo(c.tipo).rotulo, c.fornecedor, c.data_inicio && dataBR(c.data_inicio)].filter(Boolean).join(" · ")}</span></span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Agendar */}
      <Modal aberto={!!novo} titulo="Agendar emissão" onFechar={() => setNovo(null)}
        rodape={<><Botao onClick={() => setNovo(null)}>Cancelar</Botao><Botao variante="primario" disabled={ocupado === "novo"} onClick={() => void salvarNovo()}>{ocupado === "novo" ? "Salvando…" : "Agendar"}</Botao></>}>
        {novo && (() => {
          const r = regraPara(regras, novo.tipo, textoDoItem(novo.nome, {}));
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo rotulo="O que emitir">
                  <select className="rel-input" value={novo.tipo} onChange={(e) => setNovo(comRegra({ ...novo, tipo: e.target.value }))}>
                    {TIPOS_LANCAVEIS.map((t) => <option key={t} value={t}>{infoDoTipo(t).emoji} {infoDoTipo(t).rotulo}</option>)}
                  </select>
                </Campo>
                <Campo rotulo="Nome"><Entrada value={novo.nome} placeholder={infoDoTipo(novo.tipo).exemploNome || infoDoTipo(novo.tipo).rotulo} onChange={(e) => setNovo(comRegra({ ...novo, nome: e.target.value }))} /></Campo>
                <Campo rotulo="Data de uso"><Entrada type="date" value={novo.uso} onChange={(e) => setNovo(comRegra({ ...novo, uso: e.target.value }))} /></Campo>
                <Campo rotulo="Fornecedor"><Entrada value={novo.fornecedor} onChange={(e) => setNovo({ ...novo, fornecedor: e.target.value })} /></Campo>
                <Campo rotulo="Abre para emissão em" dica="Vazio = já pode emitir."><Entrada type="date" value={novo.de} onChange={(e) => setNovo({ ...novo, de: e.target.value, manual: true })} /></Campo>
                <Campo rotulo="Emitir até" dica="Vazio = até a data de uso."><Entrada type="date" value={novo.ate} onChange={(e) => setNovo({ ...novo, ate: e.target.value, manual: true })} /></Campo>
                <div className="sm:col-span-2"><Campo rotulo="Observação"><Entrada value={novo.obs} onChange={(e) => setNovo({ ...novo, obs: e.target.value })} /></Campo></div>
              </div>
              {r && <p className="vf-sub">Regra <b>{r.rotulo}</b>: {r.abre_dias != null ? `abre ${r.abre_dias} dias antes` : "emite quando quiser"}{r.limite_dias != null ? `, emitir até ${r.limite_dias} dias antes` : ""}.{novo.manual ? " (datas mudadas à mão)" : ""}</p>}
              {erro && <Aviso tom="erro">{erro}</Aviso>}
            </div>
          );
        })()}
      </Modal>

      {/* Datas de um item */}
      <Modal aberto={!!datas} titulo={datas ? `Datas da emissão · ${datas.c.nome}` : ""} onFechar={() => setDatas(null)}
        rodape={<><Botao onClick={() => setDatas(null)}>Cancelar</Botao><Botao variante="primario" disabled={ocupado === "datas"} onClick={() => void salvarDatas()}>{ocupado === "datas" ? "Salvando…" : "Salvar"}</Botao></>}>
        {datas && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo rotulo="Abre para emissão em" dica="Vazio = já pode emitir."><Entrada type="date" value={datas.de} onChange={(e) => setDatas({ ...datas, de: e.target.value })} /></Campo>
              <Campo rotulo="Emitir até" dica={datas.c.data_inicio ? `Vazio = até o uso (${dataBR(datas.c.data_inicio)}).` : "Vazio = sem prazo."}><Entrada type="date" value={datas.ate} onChange={(e) => setDatas({ ...datas, ate: e.target.value })} /></Campo>
              <div className="sm:col-span-2"><Campo rotulo="Observação"><Entrada value={datas.obs} onChange={(e) => setDatas({ ...datas, obs: e.target.value })} /></Campo></div>
            </div>
            {(() => {
              const s = sugerirDatas(regraPara(regras, datas.c.tipo, textoDoItem(datas.c.nome, datas.c.dados)), datas.c.data_inicio);
              return s.emitir_de || s.emitir_ate
                ? <button type="button" className="vf-link" onClick={() => setDatas({ ...datas, de: s.emitir_de ?? "", ate: s.emitir_ate ?? "" })}>Usar a regra: abre {s.emitir_de ? dataBR(s.emitir_de) : "já"}{s.emitir_ate ? `, até ${dataBR(s.emitir_ate)}` : ""}</button>
                : null;
            })()}
            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>

      {/* Regras de abertura */}
      <Modal aberto={!!editRegras} titulo="Regras de abertura da emissão" largura={820} onFechar={() => setEditRegras(null)}
        rodape={<><Botao onClick={() => setEditRegras(null)}>Cancelar</Botao><Botao variante="primario" disabled={ocupado === "regras"} onClick={() => void gravarRegras()}>{ocupado === "regras" ? "Salvando…" : "Salvar regras"}</Botao></>}>
        {editRegras && (
          <div className="space-y-3">
            <p className="vf-sub">Quantos dias antes da data de uso cada coisa <b>abre</b> pra emitir e até quando dá pra deixar. A venda já sugere as datas e a rotina avisa no dia. A regra com palavra (ex.: "shinkansen") vale antes da regra do tipo todo. Só a gestão salva.</p>
            {editRegras.map((r, n) => {
              const mudar = (p: Partial<RegraEmissao>) => setEditRegras(editRegras.map((x, i) => (i === n ? { ...x, ...p } : x)));
              const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v)) || 0));
              return (
                <div key={r.id} className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1.4fr_.7fr_.7fr_auto] gap-2 items-end">
                  <Campo rotulo="Nome"><Entrada value={r.rotulo} onChange={(e) => mudar({ rotulo: e.target.value })} /></Campo>
                  <Campo rotulo="Tipo">
                    <select className="rel-input" value={r.tipo} onChange={(e) => mudar({ tipo: e.target.value })}>
                      {TIPOS_LANCAVEIS.map((t) => <option key={t} value={t}>{infoDoTipo(t).rotulo}</option>)}
                    </select>
                  </Campo>
                  <Campo rotulo="Palavras (vírgula)"><Entrada value={r.palavras.join(", ")} placeholder="vazio = o tipo todo" onChange={(e) => mudar({ palavras: e.target.value.split(",") })} /></Campo>
                  <Campo rotulo="Abre (dias antes)"><Entrada inputMode="numeric" value={r.abre_dias ?? ""} onChange={(e) => mudar({ abre_dias: num(e.target.value) })} /></Campo>
                  <Campo rotulo="Até (dias antes)"><Entrada inputMode="numeric" value={r.limite_dias ?? ""} onChange={(e) => mudar({ limite_dias: num(e.target.value) })} /></Campo>
                  <Botao variante="fantasma" onClick={() => setEditRegras(editRegras.filter((_, i) => i !== n))}>Tirar</Botao>
                </div>
              );
            })}
            <button type="button" className="vf-link" onClick={() => setEditRegras([...editRegras, { id: `r${Date.now()}`, rotulo: "", tipo: "passeio", palavras: [], abre_dias: null, limite_dias: null }])}>+ Nova regra</button>
            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>
    </section>
  );
}
