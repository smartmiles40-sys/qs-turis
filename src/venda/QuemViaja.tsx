// src/venda/QuemViaja.tsx
// -----------------------------------------------------------------------------
// QUEM VIAJA numa venda SEM expedição (pacote, aéreo, hospedagem…) — 0351,
// Bruno 09/11/2026: "quando sobe uma venda e a pessoa tem família, não tem
// lugar fácil de ver que é uma família". A expedição já tinha a lista dela
// (BlocoExpedicao); aqui o resto ganha a mesma coisa: quem vai junto, o vínculo,
// os documentos (DadosDoViajante — o mesmo componente) e, opcional, o valor de
// cada um. Valor por pessoa é o que vira o card FILHO no Bitrix (cada card =
// 1 venda com o próprio valor); sem valor, tudo fica no titular.
// Vira qs_venda_pessoas pela venda_subir (viajantes com `item`).
// -----------------------------------------------------------------------------
import { Botao, Campo, Entrada } from "@/rel/ui";
import { brl } from "@/closer/lib";
import { viajanteNovo } from "./api";
import { lerValor, type Viajante } from "./vendaRegras";
import DadosDoViajante from "./DadosDoViajante";

export default function QuemViaja({ viajantes, nomeComprador, dataViagem, totalVenda, onViajantes }: {
  viajantes: Viajante[];
  nomeComprador: string;
  dataViagem?: string | null;
  totalVenda: number;
  onViajantes: (v: Viajante[]) => void;
}) {
  const lista = viajantes.some((v) => v.comprador) ? viajantes : [viajanteNovo(true), ...viajantes];
  const mudar = (chave: string, p: Partial<Viajante>) => onViajantes(lista.map((v) => (v.chave === chave ? { ...v, ...p } : v)));
  const tirar = (chave: string) => onViajantes(lista.filter((x) => x.chave !== chave)
    .map((x) => ({ ...x, responsavel: x.responsavel === chave ? "" : x.responsavel })));
  const acomp = lista.filter((v) => !v.comprador);
  const somaAcomp = Math.round(acomp.reduce((s, v) => s + (lerValor(v.valor_contratado) ?? 0), 0) * 100) / 100;
  const titular = Math.max(Math.round((totalVenda - somaAcomp) * 100) / 100, 0);

  return (
    <section className="rel-card p-4 space-y-3">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>👨‍👩‍👧 Quem viaja</h3>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Vai mais alguém nesta venda (cônjuge, filhos, amigos)? Coloque aqui: o Operacional recebe os dados de cada um, cada
          pessoa ganha o card dela no Bitrix (ligado ao do cliente) e o contrato sai por pessoa. Valor de cada um é opcional —
          sem valor, tudo fica no titular.
        </p>
      </div>
      <p className="text-[13px]" style={{ color: "var(--ink)" }}>
        <b>{nomeComprador || "Quem comprou"}</b> (titular){acomp.length > 0 && totalVenda > 0 ? <> — fica com {brl(titular)}</> : null}
      </p>
      {acomp.map((v, n) => (
        <div key={v.chave} className="rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13.5px] font-bold flex-1" style={{ color: "var(--ink)" }}>Acompanhante {n + 1}</span>
            <Botao variante="fantasma" onClick={() => tirar(v.chave)}>Tirar</Botao>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo rotulo="Nome completo *"><Entrada value={v.nome} onChange={(e) => mudar(v.chave, { nome: e.target.value })} /></Campo>
            <Campo rotulo="WhatsApp" dica="Ajuda a achar a ficha dela."><Entrada inputMode="tel" value={v.telefone} onChange={(e) => mudar(v.chave, { telefone: e.target.value })} /></Campo>
            <Campo rotulo="Valor desta pessoa (opcional)" dica="Vira o valor do card dela no Bitrix; sai do valor do titular.">
              <Entrada inputMode="decimal" placeholder="R$ 0,00" value={v.valor_contratado} onChange={(e) => mudar(v.chave, { valor_contratado: e.target.value })} />
            </Campo>
            <DadosDoViajante v={v} viajantes={lista} nomeComprador={nomeComprador} dataViagem={dataViagem} onMudar={(p) => mudar(v.chave, p)} />
          </div>
        </div>
      ))}
      <button type="button" className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}
        onClick={() => onViajantes([...lista, viajanteNovo(false)])}>
        + Vai acompanhado? Adicionar quem viaja junto
      </button>
      {somaAcomp > totalVenda + 0.009 && (
        <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>Os valores dos acompanhantes ({brl(somaAcomp)}) passam do total da venda ({brl(totalVenda)}).</p>
      )}
    </section>
  );
}
