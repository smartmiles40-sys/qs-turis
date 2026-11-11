// src/venda/FamiliaDaVenda.tsx
// -----------------------------------------------------------------------------
// "FAMÍLIA / QUEM VAI" — a PASTA do cartão (0351, Bruno 09/11/2026).
//   "Não se cria outro card da família": o cartão do closer mostra todos que
//   vão na venda, cada um com vínculo, idade (menor em destaque + quem assina),
//   CPF/nascimento faltando (em vermelho), valor, aéreo, o card dele no Bitrix
//   (criado / a criar / erro) e a situação do contrato (Fase 3).
// Lê venda_familia (0351).
// Sprint final (11/11): o bloco "Quem vai" aparece SEMPRE no cartão (mesmo sem
// venda ainda) e edita ali mesmo (EditarQuemVai → venda_familia_salvar → espelhar
// no Bitrix). Quem vai junto pode ser cadastrado ainda em negociação.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import EditarQuemVai from "./EditarQuemVai";
import { Aviso, Botao, Etiqueta } from "@/rel/ui";
import { brl, dataBr } from "@/closer/lib";
import { familiaDoNegocio } from "./familia";
import {
  ativas, faltasDaPessoa, resumoFamilia, rotuloVinculo, situacaoBitrix, situacaoContrato, valorDoTitular,
  type FamiliaDaVenda as Familia, type PessoaFamilia,
} from "./familiaRegras";

export default function FamiliaDaVenda({ negocioId, versao = 0, nomeTitular = "", podeEditar = false, onMudou }: {
  negocioId: string;
  /** Muda depois de salvar a venda → relê. */
  versao?: number;
  /** Nome do cliente do cartão (o titular). */
  nomeTitular?: string;
  /** Cartão aberto (não perdido/cancelado): mostra "Editar quem vai". */
  podeEditar?: boolean;
  /** Depois de salvar quem vai: a mensagem pro aviso do cartão. */
  onMudou?: (r: { tom: "ok" | "aviso"; t: string }) => void;
}) {
  const [f, setF] = useState<Familia | null | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [rel, setRel] = useState(0);
  useEffect(() => {
    let vivo = true;
    familiaDoNegocio(negocioId).then((x) => vivo && setF(x)).catch((e) => { if (vivo) { setErro((e as Error).message); setF(null); } });
    return () => { vivo = false; };
  }, [negocioId, versao, rel]);

  const editor = editando && (
    <EditarQuemVai negocioId={negocioId} titular={nomeTitular} pessoas={f?.pessoas ?? []} onFechar={() => setEditando(false)}
      onSalvo={(r) => { setEditando(false); setRel((n) => n + 1); onMudou?.(r); }} />
  );
  if (f === undefined) return null;
  if (erro) return <section className="rel-card p-4"><Aviso tom="erro">Família: {erro}</Aviso></section>;
  if (!f) {
    // Sem venda ainda: o closer já pode dizer quem vai (a venda nasce em "negociação").
    if (!podeEditar) return null;
    return (
      <section className="rel-card p-4">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>👨‍👩‍👧 Quem vai</h2>
          <Botao variante="fantasma" onClick={() => setEditando(true)}>+ Adicionar quem vai</Botao>
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          Vai mais alguém além de {nomeTitular || "o cliente"} (cônjuge, filhos, amigos)? Cadastre já, mesmo em negociação: cada pessoa ganha o
          card dela no Bitrix (ligado a este) e os dados vêm prontos no Subir venda e no contrato.
        </p>
        {editor}
      </section>
    );
  }

  const pessoas = ativas(f.pessoas);
  const saiu = f.pessoas.filter((p) => p.removida_em);
  const r = resumoFamilia(f);
  const titular = valorDoTitular(f);
  return (
    <section className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>
          👨‍👩‍👧 {pessoas.length > 1 ? r.texto : "Quem vai"}
        </h2>
        {r.menores > 0 && <Etiqueta tom="aviso">{r.menores} menor{r.menores > 1 ? "es" : ""}</Etiqueta>}
        {r.incompletas > 0 && <Etiqueta tom="erro">{r.incompletas} ficha{r.incompletas > 1 ? "s" : ""} incompleta{r.incompletas > 1 ? "s" : ""}</Etiqueta>}
        {podeEditar && <Botao variante="fantasma" onClick={() => setEditando(true)}>Editar quem vai</Botao>}
      </div>
      {pessoas.length <= 1 && (
        <p className="text-[12.5px] mb-2" style={{ color: "var(--ink3)" }}>
          Só o titular nesta venda. Vai mais alguém? Em "Editar quem vai", coloque cada pessoa com o vínculo — ela ganha o card
          dela no Bitrix (ligado a este) e os dados chegam no Operacional.
        </p>
      )}
      <ul className="space-y-2">
        {pessoas.map((p) => <LinhaPessoa key={p.id} p={p} valorTitular={p.comprador ? titular ?? f.valor_total : null} />)}
      </ul>
      {pessoas.length > 1 && titular != null && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>
          No Bitrix cada pessoa é um card com o próprio valor: o do cliente (pai) fica com {brl(titular)} e os filhos somam {brl(Number(f.valor_total ?? 0) - titular)} — total {brl(f.valor_total)}.
        </p>
      )}
      {saiu.length > 0 && (
        <div className="mt-3 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
          <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Saíram da venda</p>
          {saiu.map((p) => {
            const b = situacaoBitrix(p);
            return (
              <p key={p.id} className="text-[12px] flex flex-wrap gap-2 items-center" style={{ color: "var(--ink3)" }}>
                <span className="line-through">{p.nome}</span> em {dataBr(p.removida_em)}
                {p.bitrix_deal_id && <Etiqueta tom={b.tom}>{b.t}</Etiqueta>}
              </p>
            );
          })}
        </div>
      )}
      {editor}
    </section>
  );
}

function LinhaPessoa({ p, valorTitular }: { p: PessoaFamilia; valorTitular: number | null }) {
  const faltas = faltasDaPessoa(p);
  const b = situacaoBitrix(p);
  const valor = p.comprador ? valorTitular : p.valor;
  const vermelho = { color: "var(--err-ink)", fontWeight: 600 } as const;
  return (
    <li className="rounded-lg p-2.5" style={{ background: "var(--card2)", border: p.menor ? "1px solid var(--aviso, #d97706)" : "1px solid transparent" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold flex-1 min-w-[160px]" style={{ color: "var(--ink)" }}>{p.nome ?? "Sem nome"}</span>
        <Etiqueta tom={p.comprador ? "rel" : "neutro"}>{rotuloVinculo(p)}</Etiqueta>
        {p.menor && <Etiqueta tom="aviso">Menor{p.idade != null ? ` · ${p.idade} anos` : ""}</Etiqueta>}
        <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{valor != null ? brl(valor) : "valor no titular"}</span>
      </div>
      <p className="text-[12px] mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: "var(--ink2)" }}>
        <span style={p.cpf ? undefined : vermelho}>{p.cpf ? `CPF ${p.cpf}` : "CPF faltando"}</span>
        <span style={p.nascimento ? undefined : vermelho}>
          {p.nascimento ? `nasc. ${dataBr(p.nascimento)}${p.idade != null && !p.menor ? ` (${p.idade} anos)` : ""}` : "nascimento faltando"}
        </span>
        {p.aereo_incluso != null && <span>{p.aereo_incluso ? "com aéreo" : "sem aéreo"}</span>}
        {p.menor && <span>assina: <b>{p.responsavel_nome ?? "o titular"}</b></span>}
        {!p.comprador && !p.vinculo && <span style={vermelho}>vínculo faltando</span>}
      </p>
      <p className="text-[12px] mt-1 flex flex-wrap gap-2 items-center" style={{ color: "var(--ink3)" }}>
        <Etiqueta tom={b.tom}>{b.t}</Etiqueta>
        <span>Contrato: {situacaoContrato(p)}</span>
        {p.bitrix_status === "erro" && p.bitrix_erro && <span style={{ color: "var(--err-ink)" }}>{p.bitrix_erro}</span>}
        {faltas.length > 0 && <span className="sr-only">Falta: {faltas.join(", ")}</span>}
      </p>
    </li>
  );
}
