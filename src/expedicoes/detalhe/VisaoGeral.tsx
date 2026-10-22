// src/expedicoes/detalhe/VisaoGeral.tsx
// Visão Geral da expedição (app antigo: app/(app)/expedicoes/[id]/page.tsx):
// próximos prazos (7 dias), prontidão, documentos pendentes (top 5), resumo e
// momentos especiais (marcos de fidelidade, aniversariantes, estreantes).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useExp } from "../contexto";
import { Cartao, Carregando, Selo } from "../ui";
import { lerTudo, type PaxProntidao, type ReqProntidao } from "../lib/banco";
import { prontidaoLeveDaExpedicao, type ProntidaoPassageiro } from "../lib/agregados";
import { listPessoas, type PessoaAgregada } from "../lib/pessoas";
import { construirPosicoesFidelidade, ehMarco } from "../lib/fidelidade";
import { aniversarioNoMesDaExpedicao, daysUntil, formatDate } from "../lib/utils";
import type { ChecklistItemRow } from "../lib/database";
import type { PropsAba } from "./ExpedicaoDetalhe";

// 22/10 (leveza): esta aba só mostra contagens, nomes e datas — lê as colunas
// leves dos passageiros (COLUNAS_PAX_PRONTIDAO cobre id, nome, status, nascimento)
// e só 5 colunas do checklist, com passageiros e checklist saindo JUNTOS. A base
// de pessoas (pra "Nª viagem") é a leitura guardada que as outras telas usam.
type CkVisao = Pick<ChecklistItemRow, "id" | "prazo" | "status" | "tarefa" | "etapa">;

export default function VisaoGeral({ exp }: PropsAba) {
  const { ir } = useExp();
  const pacote = exp.tipo === "pacote";
  const [pax, setPax] = useState<PaxProntidao[] | null>(null);
  const [checklist, setChecklist] = useState<CkVisao[]>([]);
  const [pront, setPront] = useState<ProntidaoPassageiro<PaxProntidao, ReqProntidao>[]>([]);
  const [pessoas, setPessoas] = useState<PessoaAgregada[]>([]);

  const carregar = useCallback(async () => {
    const [ck, { pax: p, pront: pr }] = await Promise.all([
      pacote ? Promise.resolve([] as CkVisao[]) : lerTudo<CkVisao>("checklist_itens", (q) => q.eq("expedicao_id", exp.id), "id, prazo, status, tarefa, etapa"),
      prontidaoLeveDaExpedicao(exp),
    ]);
    setPax(p); setChecklist(ck); setPront(pr);
    listPessoas().then(setPessoas).catch(() => setPessoas([]));
  }, [exp, pacote]);
  useEffect(() => { void carregar(); }, [carregar]);

  const prazos = useMemo(() => checklist
    .map((c) => ({ c, d: daysUntil(c.prazo) }))
    .filter(({ c, d }) => d != null && d >= 0 && d <= 7 && c.status !== "Concluído")
    .sort((a, b) => (a.c.prazo ?? "").localeCompare(b.c.prazo ?? "")), [checklist]);

  const contagem = useMemo(() => ({
    aptos: pront.filter((p) => p.resultado.prontidao === "Apto").length,
    atencao: pront.filter((p) => p.resultado.prontidao === "Atenção").length,
    bloqueados: pront.filter((p) => p.resultado.prontidao === "Bloqueado").length,
  }), [pront]);

  const pendentes = useMemo(() => pront
    .map((p) => {
      const faltas = p.resultado.checagens.filter((c) => c.semaforo === "atencao" || c.semaforo === "bloqueio");
      return { p, faltas, bloqueio: faltas.some((c) => c.semaforo === "bloqueio") };
    })
    .filter((x) => x.faltas.length > 0)
    .sort((a, b) => Number(b.bloqueio) - Number(a.bloqueio) || a.p.passageiro.nome_completo.localeCompare(b.p.passageiro.nome_completo, "pt-BR"))
    .slice(0, 5), [pront]);

  const momentos = useMemo(() => {
    const ativos = (pax ?? []).filter((p) => p.status_reserva !== "Cancelado");
    const pos = construirPosicoesFidelidade(pessoas, exp.id);
    const marcos = ativos.filter((p) => ehMarco(pos[p.id])).map((p) => ({ p, pos: pos[p.id] })).sort((a, b) => b.pos - a.pos);
    const aniversarios = ativos
      .map((p) => ({ p, a: aniversarioNoMesDaExpedicao(p.data_nascimento, exp.data_embarque, exp.data_retorno) }))
      .filter((x): x is { p: PaxProntidao; a: NonNullable<typeof x.a> } => x.a != null)
      .sort((x, y) => x.a.data.localeCompare(y.a.data));
    const estreantes = pessoas.length ? ativos.filter((p) => pos[p.id] === 1) : [];
    return { marcos, aniversarios, estreantes };
  }, [pax, pessoas, exp]);

  if (!pax) return <Carregando />;
  const abrirPax = (id: string) => ir(pacote ? "pacotes" : "expedicoes", `${exp.id}/passageiros/prontidao/${id}`);
  const confirmados = pax.filter((p) => p.status_reserva === "Confirmado").length;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!pacote && (
        <Cartao titulo="Próximos prazos (7 dias)">
          {prazos.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum prazo próximo.</p> : (
            <ul className="space-y-2">
              {prazos.map(({ c, d }) => (
                <li key={c.id} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{c.tarefa}</p>
                    <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{c.etapa} · {formatDate(c.prazo)}</p>
                  </div>
                  <Selo tom={d! <= 1 ? "erro" : d! <= 3 ? "aviso" : "lista"}>{d === 0 ? "Hoje" : `${d}d`}</Selo>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      <Cartao titulo="Prontidão de embarque">
        {pront.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Sem passageiros ainda.</p> : (
          <div className="grid grid-cols-3 gap-2 text-center">
            {([["Aptos", contagem.aptos, "ok"], ["Atenção", contagem.atencao, "aviso"], ["Bloqueados", contagem.bloqueados, "erro"]] as const).map(([r, n, t]) => (
              <button key={r} onClick={() => ir(pacote ? "pacotes" : "expedicoes", `${exp.id}/passageiros`)} className="rounded-xl py-3" style={{ background: t === "ok" ? "#DCFCE7" : t === "aviso" ? "var(--warn-bg)" : "var(--err-bg)" }}>
                <div className="text-[22px] font-bold" style={{ color: t === "ok" ? "#166534" : t === "aviso" ? "var(--warn-ink)" : "var(--err-ink)" }}>{n}</div>
                <div className="text-[11.5px] font-semibold" style={{ color: "var(--ink2)" }}>{r}</div>
              </button>
            ))}
          </div>
        )}
      </Cartao>

      <Cartao titulo="Documentos pendentes">
        {pendentes.length === 0 ? <p className="text-[13px]" style={{ color: "#16A34A" }}>✓ Tudo OK.</p> : (
          <ul className="space-y-1.5">
            {pendentes.map(({ p, faltas, bloqueio }) => (
              <li key={p.passageiro.id}>
                <button onClick={() => abrirPax(p.passageiro.id)} className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 rel-linha">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate underline-offset-2 hover:underline" style={{ color: "var(--ink)" }}>{p.passageiro.nome_completo}</p>
                    <p className="text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{faltas.map((c) => c.tipo).join(" · ")}</p>
                  </div>
                  <Selo tom={bloqueio ? "erro" : "aviso"}>{faltas.length}</Selo>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="Resumo">
        <dl className="text-[13px] space-y-1.5" style={{ color: "var(--ink2)" }}>
          <div className="flex justify-between"><dt>Passageiros</dt><dd className="font-semibold" style={{ color: "var(--ink)" }}>{pax.length} ({confirmados} confirmados)</dd></div>
          <div className="flex justify-between"><dt>Prontidão</dt><dd className="font-semibold" style={{ color: "var(--ink)" }}>{contagem.aptos}/{pront.length} aptos</dd></div>
          {!pacote && <div className="flex justify-between"><dt>Checklist</dt><dd className="font-semibold" style={{ color: "var(--ink)" }}>{checklist.filter((c) => c.status === "Concluído").length}/{checklist.length} concluídos</dd></div>}
          {exp.observacoes && <div className="pt-2 text-[12.5px] whitespace-pre-wrap" style={{ color: "var(--ink3)" }}>{exp.observacoes}</div>}
        </dl>
      </Cartao>

      <Cartao titulo="Momentos especiais" className="md:col-span-2">
        {momentos.marcos.length + momentos.aniversarios.length + momentos.estreantes.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada em destaque por enquanto — marcos de fidelidade, aniversários e estreantes aparecem aqui.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 text-[13px]">
            <ListaMomento titulo="Marcos" itens={momentos.marcos.map(({ p, pos }) => ({ id: p.id, nome: p.nome_completo, texto: `${pos}ª expedição com a gente 🎉` }))} />
            <ListaMomento titulo="Aniversariantes do mês" itens={momentos.aniversarios.map(({ p, a }) => ({
              id: p.id, nome: p.nome_completo,
              texto: `🎂 ${formatDate(a.data)}${a.idade != null ? ` — faz ${a.idade} anos` : ""}${a.naViagem ? " · 🎉 durante a viagem" : ""}`,
            }))} />
            <ListaMomento titulo="Estreantes" itens={momentos.estreantes.map((p) => ({ id: p.id, nome: p.nome_completo, texto: "Primeira viagem com a gente 👋" }))} />
          </div>
        )}
      </Cartao>
    </div>
  );
}

function ListaMomento({ titulo, itens }: { titulo: string; itens: { id: string; nome: string; texto: string }[] }) {
  if (!itens.length) return null;
  return (
    <div>
      <h4 className="text-[11.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>{titulo}</h4>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li key={i.id}><p className="font-semibold" style={{ color: "var(--ink)" }}>{i.nome}</p><p className="text-[12px]" style={{ color: "var(--ink3)" }}>{i.texto}</p></li>
        ))}
      </ul>
    </div>
  );
}
