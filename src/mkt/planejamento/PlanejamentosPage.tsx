// src/mkt/planejamento/PlanejamentosPage.tsx
// -----------------------------------------------------------------------------
// PLANEJAMENTO DE CONTEÚDO (0395, 13/11/2026).
//   • Da AGÊNCIA: chega pelo portal (#agencia), já lido e conferido pela IA.
//     O time só revisa: obs por conteúdo, aprovar ou devolver.
//   • INTERNO: o time preenche aqui mesmo (semanal ou diário), com os mesmos
//     campos, e manda pros supervisores.
// Aprovado → cada conteúdo vira card no Quadro, com data, horário e perfis.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { useMkt } from "../contexto";
import { irMkt, useRotaMkt } from "../navegacao";
import { NOME_VISAO, type TimeMkt } from "../menu";
import { Cabecalho } from "../conteudo/ui";
import { NOME_PERIODICIDADE, periodoValido, semanaDe, type Periodicidade } from "./regras";
import { criarPlanejamentoInterno, erroDePlano, listarPlanejamentos, type Planejamento, type StatusPlano } from "./dados";
import { dataCurta } from "./ItensEditor";
import PlanejamentoDetalhe from "./PlanejamentoDetalhe";

export const NOME_STATUS: Record<StatusPlano, string> = {
  rascunho: "Rascunho", enviado: "Para revisar", devolvido: "Devolvido", aprovado: "Aprovado", cancelado: "Cancelado",
};
export function ChipStatusPlano({ status }: { status: StatusPlano }) {
  const tom = status === "enviado" ? "aviso" : status === "devolvido" ? "erro" : status === "aprovado" ? "rel" : "neutro";
  return <Etiqueta tom={tom}>{NOME_STATUS[status]}</Etiqueta>;
}

type Filtro = "revisar" | "agencia" | "interno" | "todos";

export default function PlanejamentosPage() {
  const rota = useRotaMkt();
  if (rota.id) return <PlanejamentoDetalhe key={rota.id} id={rota.id} />;
  return <Lista />;
}

function Lista() {
  const { supervisorDe, visao } = useMkt();
  const [planos, setPlanos] = useState<Planejamento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const souSup = supervisorDe("organico") || supervisorDe("trafego");
  const [filtro, setFiltro] = useState<Filtro>(souSup ? "revisar" : "todos");
  const [novo, setNovo] = useState(false);

  const carregar = useCallback(async () => {
    try { setPlanos(await listarPlanejamentos()); setErro(null); }
    catch (e) { setErro(erroDePlano(e)); }
    finally { setCarregando(false); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = useMemo(() => planos.filter((p) =>
    filtro === "revisar" ? p.status === "enviado"
      : filtro === "agencia" ? p.origem === "agencia"
      : filtro === "interno" ? p.origem === "interno" : true), [planos, filtro]);
  const nRevisar = planos.filter((p) => p.status === "enviado").length;

  return (
    <div className="max-w-5xl mx-auto">
      <Cabecalho titulo="Planejamento de conteúdo"
        texto="O que vai ser postado, onde, quando e como — da agência e do time. Aprovado vira card no Quadro."
        acoes={<Botao variante="primario" onClick={() => setNovo(true)}>Novo planejamento</Botao>} />

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Filtrar planejamentos">
        {([["revisar", `Para revisar${nRevisar ? ` (${nRevisar})` : ""}`], ["agencia", "Da agência"], ["interno", "Do time"], ["todos", "Todos"]] as [Filtro, string][]).map(([id, rot]) => (
          <button key={id} role="tab" aria-selected={filtro === id} onClick={() => setFiltro(id)}
            className="px-3 py-1.5 rounded-full text-[13px] font-semibold"
            style={filtro === id ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
            {rot}
          </button>
        ))}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {carregando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : visiveis.length === 0 ? (
          <Vazio titulo={filtro === "revisar" ? "Nada para revisar" : "Nenhum planejamento aqui"}
            texto={filtro === "revisar" ? "Quando a agência ou o time mandar um planejamento, ele aparece aqui." : "Crie um planejamento semanal ou diário do time, ou espere o da agência chegar pelo portal."} />
        ) : (
          <ul className="space-y-2">
            {visiveis.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => irMkt("planejamentos", p.id)}
                  className="rel-card w-full text-left p-4 flex flex-wrap items-center gap-x-4 gap-y-2 hover:shadow-sm transition-shadow">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[14.5px]" style={{ color: "var(--ink)" }}>{p.titulo}</span>
                      <ChipStatusPlano status={p.status} />
                    </div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>
                      {p.origem === "agencia" ? "Agência" : "Time"} · {NOME_PERIODICIDADE[p.periodicidade]} · {dataCurta(p.periodo_inicio)}
                      {p.periodo_fim !== p.periodo_inicio ? ` a ${dataCurta(p.periodo_fim)}` : ""} · {NOME_VISAO[p.time]}
                      {p.rodada > 1 ? ` · ${p.rodada}ª rodada` : ""}
                    </div>
                  </div>
                  <span aria-hidden style={{ color: "var(--ink3)" }}>›</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      {novo && <NovoPlanejamento timePadrao={visao === "trafego" ? "trafego" : "organico"} onFechar={() => setNovo(false)} />}
    </div>
  );
}

function hojeSp(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function NovoPlanejamento({ timePadrao, onFechar }: { timePadrao: TimeMkt; onFechar: () => void }) {
  const [periodicidade, setPeriodicidade] = useState<Periodicidade>("semanal");
  const [time, setTime] = useState<TimeMkt>(timePadrao);
  const [dia, setDia] = useState(hojeSp());
  const [titulo, setTitulo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const periodo = periodicidade === "semanal" ? semanaDe(dia) : { inicio: dia, fim: dia };
  const tituloPadrao = periodicidade === "semanal"
    ? `Semana ${dataCurta(periodo.inicio)} a ${dataCurta(periodo.fim)}`
    : `Dia ${dataCurta(dia)}`;

  async function criar() {
    const e = periodoValido(periodicidade, periodo.inicio, periodo.fim);
    if (e) { setErro(e); return; }
    setSalvando(true); setErro(null);
    try {
      const id = await criarPlanejamentoInterno({ titulo: titulo.trim() || tituloPadrao, periodicidade, time, periodo_inicio: periodo.inicio, periodo_fim: periodo.fim });
      onFechar();
      irMkt("planejamentos", id);
    } catch (err) { setErro(erroDePlano(err)); setSalvando(false); }
  }

  return (
    <Modal aberto titulo="Novo planejamento do time" onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={criar}>{salvando ? "Criando…" : "Criar e preencher"}</Botao></>}>
      <div className="space-y-4">
        <fieldset>
          <legend className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>É semanal ou diário?</legend>
          <div className="flex gap-2">
            {(["semanal", "diario"] as Periodicidade[]).map((p) => (
              <label key={p} className="flex-1 inline-flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-[14px]"
                style={{ border: `1px solid ${periodicidade === p ? "var(--rel)" : "var(--line)"}`, background: periodicidade === p ? "var(--rel-soft)" : "transparent" }}>
                <input type="radio" name="periodicidade" checked={periodicidade === p} onChange={() => setPeriodicidade(p)} className="accent-[var(--rel)]" />
                {NOME_PERIODICIDADE[p]}
              </label>
            ))}
          </div>
        </fieldset>
        <Campo rotulo={periodicidade === "semanal" ? "Qualquer dia da semana" : "Dia"}
          dica={periodicidade === "semanal" ? `Semana de ${dataCurta(periodo.inicio)} a ${dataCurta(periodo.fim)} (segunda a domingo).` : undefined}>
          <Entrada type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
        </Campo>
        <Campo rotulo="Time">
          <select className="rel-input" value={time} onChange={(e) => setTime(e.target.value as TimeMkt)}>
            <option value="organico">Orgânico</option>
            <option value="trafego">Tráfego</option>
          </select>
        </Campo>
        <Campo rotulo="Nome (opcional)">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tituloPadrao} maxLength={200} />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
