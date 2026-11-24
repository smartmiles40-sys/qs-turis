// src/rel/viagens/EmissaoFutura.tsx
// -----------------------------------------------------------------------------
// ABA "EMISSÃO FUTURA" DA FICHA DA VIAGEM (24/11/2026). Bruno: "para o que ainda
// não foi emitido e tem que emitir mais próximo da data".
//
//   1) A EMITIR — itens com situação "a emitir" (os da venda e os que o Rel
//      agenda aqui), do prazo mais perto pro mais longe. "Emitir até" fica em
//      dados.emitir_ate; sem ele, vale a data de uso.
//   2) VENDIDO SEM COMPROVANTE — o que a prontidão diz que a venda tem e ainda
//      não tem voo/voucher/apólice (venda antiga do Bitrix não tem item).
//      "Agendar" vira um item "a emitir" com prazo.
//   3) JÁ EMITIDO — fechado, só pra consulta.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { dataBR, hojeSP } from "../lib/viagens";
import { TIPOS_LANCAVEIS, infoDoTipo, lancarItemAvulso, salvarItem, type Componente } from "../lib/componentes";
import type { Quadro } from "../lib/prontidao";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

const DE_QUADRO: Partial<Record<Quadro["chave"], string>> = { ida: "aereo", volta: "aereo", internos: "aereo", hospedagem: "hospedagem", passeios: "passeio", seguro: "seguro" };

const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const emDias = (n: number) => (n === 0 ? "hoje" : n === 1 ? "amanhã" : n === -1 ? "ontem" : n < 0 ? `há ${-n} dias` : `em ${n} dias`);
const prazoDe = (c: Componente) => (typeof c.dados?.emitir_ate === "string" && c.dados.emitir_ate) || c.data_inicio || null;

/** Quantas coisas ainda faltam emitir (o número da aba). */
export function pendenciasDeEmissao(comps: Componente[] | null, quadros: Quadro[]): number {
  const aEmitir = (comps ?? []).filter((c) => c.fonte === "venda" && c.status === "vendido");
  const tipos = new Set(aEmitir.map((c) => c.tipo));
  const lacunas = quadros.filter((q) => DE_QUADRO[q.chave] && (q.estado === "falta" || q.estado === "atencao") && !tipos.has(DE_QUADRO[q.chave]!));
  return aEmitir.length + lacunas.length;
}

export default function EmissaoFutura({ viagemId, comps, quadros, carregando, dataIda, ativa, onMudou }: {
  viagemId: string; comps: Componente[] | null; quadros: Quadro[]; carregando: boolean;
  dataIda: string | null; ativa: boolean; onMudou: () => void;
}) {
  const hoje = hojeSP();
  const [novo, setNovo] = useState<{ tipo: string; nome: string; uso: string; ate: string; fornecedor: string; obs: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const daVenda = (comps ?? []).filter((c) => c.fonte === "venda");
  const aEmitir = daVenda.filter((c) => c.status === "vendido")
    .sort((a, b) => String(prazoDe(a) ?? "9999").localeCompare(String(prazoDe(b) ?? "9999")));
  const emitidos = daVenda.filter((c) => c.status === "emitido");
  const tiposAgendados = new Set(aEmitir.map((c) => c.tipo));
  const lacunas = quadros.filter((q) => DE_QUADRO[q.chave] && (q.estado === "falta" || q.estado === "atencao") && !tiposAgendados.has(DE_QUADRO[q.chave]!));

  const abrir = (tipo = "aereo", nome = "") => { setErro(null); setNovo({ tipo, nome, uso: dataIda ?? "", ate: "", fornecedor: "", obs: "" }); };

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
        dados: { emitir_ate: novo.ate || null, obs: novo.obs.trim() || null }, fornecedor: novo.fornecedor.trim() || null, status: "vendido",
      });
      setNovo(null); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(null); }
  }

  if (carregando) return <div className="vf-card h-32 animate-pulse" style={{ background: "var(--surface-2)" }} aria-busy />;

  return (
    <section className="flex flex-col gap-5" aria-label="Emissão futura">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vf-sub">O que foi vendido e ainda vai ser emitido, do prazo mais perto pro mais longe.</p>
        {ativa && <button type="button" className="vf-btn" onClick={() => abrir()}>+ Agendar emissão</button>}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="vf-card flex flex-col gap-3">
        <h2 className="vf-h2">A emitir · {aEmitir.length}</h2>
        {aEmitir.length === 0 && <p className="vf-sub">Nada agendado pra emitir.{lacunas.length ? " Veja abaixo o que a venda tem e ainda não foi emitido." : ""}</p>}
        {aEmitir.map((c) => {
          const info = infoDoTipo(c.tipo);
          const prazo = prazoDe(c);
          const n = prazo ? dias(hoje, prazo) : null;
          const tom = n == null ? "atencao" : n <= 7 ? "falta" : n <= 30 ? "atencao" : "ok";
          const temAte = typeof c.dados?.emitir_ate === "string" && !!c.dados.emitir_ate;
          const obs = typeof c.dados?.obs === "string" ? c.dados.obs : null;
          return (
            <div key={c.id} className={`vf-emit vf-emit--${tom}`}>
              <span className="text-[20px]" aria-hidden>{info.emoji}</span>
              <span className="vf-emit__txt">
                <b>{c.nome}</b>
                <span className="vf-sub">{[info.rotulo, c.fornecedor, c.data_inicio && `uso em ${dataBR(c.data_inicio)}`, obs].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="vf-emit__quando">
                {prazo ? <><b>{temAte ? "emitir até " : ""}{dataBR(prazo)}</b>{n != null ? emDias(n) : ""}</> : <b>sem prazo</b>}
              </span>
              {ativa && <Botao variante="primario" disabled={ocupado === c.id} onClick={() => void marcarEmitido(c)}>{ocupado === c.id ? "…" : "Marcar emitido"}</Botao>}
            </div>
          );
        })}
      </div>

      {lacunas.length > 0 && (
        <div className="vf-card flex flex-col gap-3">
          <div>
            <h2 className="vf-h2">Vendido e ainda sem comprovante · {lacunas.length}</h2>
            <p className="vf-sub mt-1">Pelo que a venda tem: falta voo, voucher ou apólice. Agende a emissão com o prazo certo, ou anexe o comprovante na aba Viagem.</p>
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

      <Modal aberto={!!novo} titulo="Agendar emissão" onFechar={() => setNovo(null)}
        rodape={<><Botao onClick={() => setNovo(null)}>Cancelar</Botao><Botao variante="primario" disabled={ocupado === "novo"} onClick={() => void salvarNovo()}>{ocupado === "novo" ? "Salvando…" : "Agendar"}</Botao></>}>
        {novo && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo rotulo="O que emitir">
                <select className="rel-input" value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}>
                  {TIPOS_LANCAVEIS.map((t) => <option key={t} value={t}>{infoDoTipo(t).emoji} {infoDoTipo(t).rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Nome"><Entrada value={novo.nome} placeholder={infoDoTipo(novo.tipo).exemploNome || infoDoTipo(novo.tipo).rotulo} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></Campo>
              <Campo rotulo="Data de uso"><Entrada type="date" value={novo.uso} onChange={(e) => setNovo({ ...novo, uso: e.target.value })} /></Campo>
              <Campo rotulo="Emitir até"><Entrada type="date" value={novo.ate} onChange={(e) => setNovo({ ...novo, ate: e.target.value })} /></Campo>
              <Campo rotulo="Fornecedor"><Entrada value={novo.fornecedor} onChange={(e) => setNovo({ ...novo, fornecedor: e.target.value })} /></Campo>
              <Campo rotulo="Observação"><Entrada value={novo.obs} onChange={(e) => setNovo({ ...novo, obs: e.target.value })} /></Campo>
            </div>
            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>
    </section>
  );
}
