// src/mkt/conteudo/AprovacoesPage.tsx
// -----------------------------------------------------------------------------
// APROVAÇÕES (0240): o que está "Em aprovação", do mais antigo pro mais novo.
// O gestor aprova ou devolve daqui mesmo; quem fez vê o que está esperando
// e o que voltou pra ajustes.
// -----------------------------------------------------------------------------
import { useMemo, useState } from "react";
import { Aviso, Botao, Vazio } from "@/rel/ui";
import { useMkt } from "../contexto";
import { irMkt, useRotaMkt } from "../navegacao";
import CardDetalhe from "./CardDetalhe";
import { Devolver } from "./QuadroPage";
import { aprovar, erroDe } from "./dados";
import { dataCurta, hojeSP } from "./regras";
import type { CardMkt } from "./tipos";
import { Cabecalho, ChipOrigem, ChipStatus, ChipTipo, useQuadro } from "./ui";

export default function AprovacoesPage() {
  const rota = useRotaMkt();
  const { aprovador, nomeDe } = useMkt();
  const { colunas, cards, carregando, erro, recarregar } = useQuadro();
  const [devolvendo, setDevolvendo] = useState<CardMkt | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aprovando, setAprovando] = useState<string | null>(null);
  const hoje = hojeSP();
  const tipoDe = useMemo(() => new Map(colunas.map((k) => [k.id, k.tipo])), [colunas]);
  const pendentes = cards.filter((c) => tipoDe.get(c.coluna_id) === "aprovacao").sort((a, b) => a.atualizado_em.localeCompare(b.atualizado_em));
  const devolvidos = cards.filter((c) => c.status_aprovacao === "devolvido" && tipoDe.get(c.coluna_id) === "ajustes");

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;

  const Linha = ({ c, acoes }: { c: CardMkt; acoes: boolean }) => (
    <li className="rel-card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
      <button type="button" className="flex-1 min-w-0 text-left" onClick={() => irMkt("aprovacoes", c.id)}>
        <span className="block text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{c.titulo}</span>
        <span className="flex flex-wrap gap-1 mt-1"><ChipOrigem origem={c.origem} pedido={c.eh_pedido} /><ChipTipo tipo={c.tipo} /><ChipStatus status={c.status_aprovacao} rodada={c.rodada} /></span>
        <span className="block text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
          {c.responsavel_id ? nomeDe(c.responsavel_id) : "Sem responsável"}{c.data_publicacao ? ` · publica ${dataCurta(c.data_publicacao, hoje)}` : ""}{(c.n_anexos ?? 0) > 0 ? ` · ${c.n_anexos} anexo(s)` : ""}
        </span>
      </button>
      {acoes && aprovador && (
        <div className="flex gap-2">
          {/* 04/11/2026: trava o botão enquanto aprova (2 cliques = 2 chamadas; a 2ª falhava). */}
          <Botao variante="primario" disabled={aprovando === c.id} onClick={async () => {
            setErroAcao(null); setAprovando(c.id);
            try { await aprovar(c.id); await recarregar(); } catch (e) { setErroAcao(erroDe(e)); } finally { setAprovando(null); }
          }}>{aprovando === c.id ? "Aprovando…" : "Aprovar"}</Botao>
          <Botao variante="perigo" onClick={() => setDevolvendo(c)}>Devolver</Botao>
        </div>
      )}
    </li>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <Cabecalho titulo="Aprovações"
        texto={aprovador ? "Abra o card pra ver anexos e comentários antes de decidir. Devolver pede o que ajustar." : "O que está esperando o gestor de Marketing e o que voltou pra ajustes."} />
      {erroAcao && <div className="mb-3"><Aviso tom="erro">{erroAcao}</Aviso></div>}
      <h2 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink2)" }}>Esperando aprovação ({pendentes.length})</h2>
      {pendentes.length ? <ul className="space-y-2 mb-6">{pendentes.map((c) => <Linha key={c.id} c={c} acoes />)}</ul>
        : <div className="rel-card mb-6"><Vazio titulo="Nada esperando aprovação" texto="Quando alguém mover um card pra Em aprovação, ele aparece aqui e o gestor recebe o aviso no sino." /></div>}
      <h2 className="text-[13px] font-bold mb-2" style={{ color: "var(--ink2)" }}>Devolvidos pra ajustes ({devolvidos.length})</h2>
      {devolvidos.length ? <ul className="space-y-2">{devolvidos.map((c) => <Linha key={c.id} c={c} acoes={false} />)}</ul>
        : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum.</p>}

      {devolvendo && <Devolver card={devolvendo} onFechar={() => setDevolvendo(null)} onFeito={() => { setDevolvendo(null); void recarregar(); }} />}
      {rota.id && <CardDetalhe key={rota.id} id={rota.id} colunas={colunas} onAbrir={(id) => irMkt("aprovacoes", id)} onFechar={() => irMkt("aprovacoes")} onMudou={() => void recarregar()} />}
    </div>
  );
}
