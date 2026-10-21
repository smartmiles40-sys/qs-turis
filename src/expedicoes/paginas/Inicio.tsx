// src/expedicoes/paginas/Inicio.tsx
// Início das Expedições (app antigo: app/(app)/dashboard/page.tsx): 4 números-chave
// clicáveis, próximas expedições, prontidão & alertas, prazos & checklist e
// momentos especiais (marcos de fidelidade 3ª/5ª/10ª e aniversariantes na viagem).
// Só leitura. Só expedições em grupo (pacotes ficam de fora, como no antigo).
// Diferença boa: tudo paginado (o antigo cortava checklist e passageiros em 1000).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Avatar } from "@/rel/ui";
import { useExp } from "../contexto";
import { Cartao, Carregando, Selo, useAoVivo, type Tom } from "../ui";
import { listPessoas, type PessoaAgregada } from "../lib/pessoas";
import { ehMarco, ordinalFem } from "../lib/fidelidade";
import { aniversarioNaViagem, daysUntil, formatDate } from "../lib/utils";
import {
  carregarProntidaoAtivas, resumoProcessos, resumoProntidao,
  type ProntidaoAtivas, type ResumoProcessoExpedicao, type ResumoProntidaoExpedicao,
} from "./_globais/prontidaoGlobal";

const hojeLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Inicio() {
  const { ir } = useExp();
  const [dados, setDados] = useState<{ pront: ProntidaoAtivas; resPront: ResumoProntidaoExpedicao[]; resProc: ResumoProcessoExpedicao[] } | null>(null);
  const [pessoas, setPessoas] = useState<PessoaAgregada[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const pront = await carregarProntidaoAtivas();
      const resProc = await resumoProcessos(pront.expedicoes);
      setDados({ pront, resPront: resumoProntidao(pront), resProc });
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
    listPessoas().then(setPessoas).catch(() => setPessoas([]));
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "expedicoes" }, { tabela: "passageiros" }, { tabela: "passageiro_requisitos" }, { tabela: "checklist_itens" }], carregar, 2000);

  const calc = useMemo(() => {
    if (!dados) return null;
    const hoje = hojeLocal();
    const { pront, resPront, resProc } = dados;
    const ativas = pront.expedicoes;
    const pctPorExp = new Map(resProc.map((r) => [r.id, r.checklist_pct]));
    const prontPorExp = new Map(resPront.map((r) => [r.id, r]));
    const paxConf = (id: string) => (pront.porExpedicao.get(id) ?? []).filter(({ passageiro: p }) => p.status_reserva === "Confirmado" && p.tipo !== "Líder").length;

    const totalAptos = resPront.reduce((s, r) => s + r.aptos, 0);
    const totalPront = resPront.reduce((s, r) => s + r.total, 0);
    const futuras = ativas.filter((e) => (e.data_embarque ?? "").slice(0, 10) >= hoje).sort((a, b) => (a.data_embarque ?? "").localeCompare(b.data_embarque ?? ""));

    // Momentos especiais: posição cronológica da pessoa em cada expedição futura.
    const infoExp = new Map(futuras.map((e) => [e.id, e]));
    const marcos: { nome: string; exp: string; expId: string; pos: number }[] = [];
    const aniversariantes: { nome: string; exp: string; expId: string; data: string }[] = [];
    for (const p of pessoas) {
      const ativasPessoa = p.expedicoes.filter((e) => e.status_reserva !== "Cancelado").slice()
        .sort((a, b) => a.data_embarque.localeCompare(b.data_embarque) || a.expedicao_id.localeCompare(b.expedicao_id));
      ativasPessoa.forEach((e, idx) => {
        const info = infoExp.get(e.expedicao_id);
        if (!info) return;
        const pos = idx + 1;
        if (ehMarco(pos)) marcos.push({ nome: p.nome_completo, exp: e.nome, expId: e.expedicao_id, pos });
        const aniv = aniversarioNaViagem(p.data_nascimento, info.data_embarque, info.data_retorno);
        if (aniv) aniversariantes.push({ nome: p.nome_completo, exp: e.nome, expId: e.expedicao_id, data: aniv.data });
      });
    }
    marcos.sort((a, b) => b.pos - a.pos);
    aniversariantes.sort((a, b) => a.data.localeCompare(b.data));

    return {
      kpis: {
        ativas: ativas.length,
        confirmados: ativas.reduce((s, e) => s + paxConf(e.id), 0),
        totalAptos, totalPront, pct: totalPront > 0 ? Math.round((totalAptos / totalPront) * 100) : 0,
        atrasados: resProc.reduce((s, r) => s + r.atrasados, 0),
        atencao: resPront.reduce((s, r) => s + r.atencao, 0),
        bloqueados: resPront.reduce((s, r) => s + r.bloqueados, 0),
      },
      proximas: futuras.slice(0, 6).map((e) => ({ e, pax: paxConf(e.id), pront: prontPorExp.get(e.id), pct: pctPorExp.get(e.id) ?? 0 })),
      comPendencia: resPront.filter((r) => r.bloqueados > 0 || r.atencao > 0).sort((a, b) => b.bloqueados - a.bloqueados || b.atencao - a.atencao).slice(0, 6),
      prazosPend: resProc.filter((r) => r.atrasados > 0 || r.proximos7d > 0).sort((a, b) => b.atrasados - a.atrasados || b.proximos7d - a.proximos7d).slice(0, 6),
      marcos, aniversariantes,
    };
  }, [dados, pessoas]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Início</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Resumo geral — clique em qualquer item para abrir.</p>
      </header>
      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!calc ? <Carregando /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi valor={calc.kpis.ativas} rotulo="Expedições ativas" cor="#2563EB" onClick={() => ir("expedicoes")} />
            <Kpi valor={calc.kpis.confirmados} rotulo="Passageiros confirmados" cor="#16A34A" onClick={() => ir("passageiros")} />
            <Kpi valor={`${calc.kpis.pct}%`} rotulo={`Prontos (${calc.kpis.totalAptos}/${calc.kpis.totalPront})`} cor="#7C3AED" onClick={() => ir("expedicoes")} />
            <Kpi valor={calc.kpis.atrasados} rotulo="Prazos atrasados" cor="#DC2626" onClick={() => ir("expedicoes")} />
          </div>

          <Cartao titulo="Próximas expedições" acao={<button className="text-[12.5px] font-semibold hover:underline" style={{ color: "var(--rel-ink)" }} onClick={() => ir("expedicoes")}>Ver tudo</button>}>
            {calc.proximas.length === 0 ? <Nada texto="Nenhuma expedição futura." /> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {calc.proximas.map(({ e, pax, pront, pct }) => {
                  const dias = daysUntil(e.data_embarque);
                  const tom: Tom = dias == null ? "neutro" : dias <= 15 ? "erro" : dias <= 45 ? "aviso" : "lista";
                  return (
                    <button key={e.id} onClick={() => ir("expedicoes", e.id)} className="text-left rounded-xl border p-3 rel-linha" style={{ borderColor: "var(--line)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-bold uppercase tracking-wide truncate" style={{ color: "var(--ink3)" }}>{e.destino}</span>
                        {dias != null && dias >= 0 && <Selo tom={tom}>{dias === 0 ? "hoje" : `${dias}d`}</Selo>}
                      </div>
                      <div className="mt-1 text-[14px] font-bold leading-tight truncate" style={{ color: "var(--ink)" }}>{e.nome}</div>
                      <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>{formatDate(e.data_embarque)}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Selo>{pax} pax</Selo>
                        <Selo>{pront?.aptos ?? 0}/{pront?.total ?? 0} prontos</Selo>
                        <Selo>{Math.round(pct * 100)}% checklist</Selo>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Cartao>

          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="Prontidão & alertas">
              <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                <MiniStat valor={calc.kpis.totalAptos} rotulo="Aptos" cor="#16A34A" />
                <MiniStat valor={calc.kpis.atencao} rotulo="Atenção" cor="#EA580C" />
                <MiniStat valor={calc.kpis.bloqueados} rotulo="Bloqueados" cor="#DC2626" />
              </div>
              {calc.comPendencia.length === 0 ? <Nada texto="Sem pendências de prontidão. 🎉" /> : (
                <ul className="space-y-0.5">
                  {calc.comPendencia.map((r) => (
                    <Linha key={r.id} titulo={r.nome} sub={r.topBloqueador ? `Principal: ${r.topBloqueador}` : "Requisitos pendentes"} onClick={() => ir("expedicoes", `${r.id}/passageiros`)}>
                      {r.bloqueados > 0 && <Selo tom="erro" titulo="Bloqueados">{r.bloqueados}</Selo>}
                      {r.atencao > 0 && <Selo tom="aviso" titulo="Atenção">{r.atencao}</Selo>}
                    </Linha>
                  ))}
                </ul>
              )}
            </Cartao>

            <Cartao titulo="Prazos & checklist">
              {calc.prazosPend.length === 0 ? <Nada texto="Nenhum prazo atrasado ou próximo." /> : (
                <ul className="space-y-0.5">
                  {calc.prazosPend.map((r) => (
                    <Linha key={r.id} titulo={r.nome} sub={r.faseAtual ?? ""} onClick={() => ir("expedicoes", `${r.id}/checklist`)}>
                      {r.atrasados > 0 && <Selo tom="erro">{r.atrasados} atrasado{r.atrasados > 1 ? "s" : ""}</Selo>}
                      {r.proximos7d > 0 && <Selo tom="aviso">{r.proximos7d} em 7d</Selo>}
                    </Linha>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>

          <Cartao titulo="Momentos especiais">
            {calc.marcos.length + calc.aniversariantes.length === 0 ? <Nada texto="Marcos de fidelidade e aniversários das próximas viagens aparecem aqui." /> : (
              <div className="grid gap-4 sm:grid-cols-2">
                {calc.marcos.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[12px] font-bold" style={{ color: "var(--ink2)" }}>★ Marcos de fidelidade</p>
                    <ul className="space-y-0.5">
                      {calc.marcos.map((m, i) => <Momento key={i} nome={m.nome} detalhe={`${ordinalFem(m.pos)} expedição · ${m.exp}`} onClick={() => ir("expedicoes", m.expId)} />)}
                    </ul>
                  </div>
                )}
                {calc.aniversariantes.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[12px] font-bold" style={{ color: "var(--ink2)" }}>🎂 Aniversariantes na viagem</p>
                    <ul className="space-y-0.5">
                      {calc.aniversariantes.map((a, i) => <Momento key={i} nome={a.nome} detalhe={`🎂 ${formatDate(a.data)} · ${a.exp}`} onClick={() => ir("expedicoes", a.expId)} />)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Cartao>
        </>
      )}
    </div>
  );
}

function Kpi({ valor, rotulo, cor, onClick }: { valor: number | string; rotulo: string; cor: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rel-card p-3.5 text-left hover:opacity-90">
      <span className="block w-7 h-1.5 rounded-full" style={{ background: cor }} />
      <span className="block mt-2 text-[26px] font-bold tabular-nums leading-none" style={{ color: "var(--ink)" }}>{valor}</span>
      <span className="block mt-1 text-[12px]" style={{ color: "var(--ink3)" }}>{rotulo}</span>
    </button>
  );
}

function MiniStat({ valor, rotulo, cor }: { valor: number; rotulo: string; cor: string }) {
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: "var(--line)" }}>
      <div className="text-[20px] font-bold tabular-nums" style={{ color: cor }}>{valor}</div>
      <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{rotulo}</div>
    </div>
  );
}

function Linha({ titulo, sub, onClick, children }: { titulo: string; sub: string; onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button onClick={onClick} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left rel-linha">
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{titulo}</span>
          {sub && <span className="block text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{sub}</span>}
        </span>
        <span className="flex items-center gap-1 flex-shrink-0">{children}</span>
      </button>
    </li>
  );
}

function Momento({ nome, detalhe, onClick }: { nome: string; detalhe: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left rel-linha">
        <Avatar nome={nome} tamanho={26} />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{nome}</span>
          <span className="block text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{detalhe}</span>
        </span>
      </button>
    </li>
  );
}

function Nada({ texto }: { texto: string }) {
  return <p className="py-2 text-[12.5px]" style={{ color: "var(--ink3)" }}>{texto}</p>;
}
