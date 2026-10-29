// src/expedicoes/paginas/Receitas.tsx
// Menu "Receitas" (Carol, 29/10 — app antigo fe8ff18/23fc68f): passageiros com
// "preciso emitir e enviar a receita" marcado na triagem da inscrição. Aparece
// quando faltam ≤ 20 dias pro embarque, com a data-limite (embarque − 20) e o
// botão "Marcar enviada". As de expedições mais adiante ficam só contadas.
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { Carregando, Selo, useAoVivo } from "../ui";
import { dataSP } from "../lib/fase.ts";
import { formatDate, formatDateTime } from "../lib/utils";
import { DIAS_JANELA_RECEITA, definirReceita, listarReceitas, naJanela, type Receita } from "../lib/receitas";

export default function Receitas() {
  const { podeDecidirInscricao, ir, avisar } = useExp();
  const [lista, setLista] = useState<Receita[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verEnviadas, setVerEnviadas] = useState(false);
  const hoje = dataSP(new Date());

  const carregar = useCallback(async () => {
    try { setLista(await listarReceitas(hoje)); setErro(null); }
    catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao carregar";
      setErro(/receita_pendente|column/i.test(msg) ? "O menu Receitas ainda não está ligado no banco (falta aplicar a migration 0223)." : msg);
    }
  }, [hoje]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros" }], () => { void carregar(); }, 800);

  async function mudar(r: Receita, m: { pendente?: boolean; enviada?: boolean }, ok: string) {
    setOcupado(r.passageiroId);
    try { await definirReceita(r.passageiroId, m); avisar(ok); await carregar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Não salvou", "erro"); }
    finally { setOcupado(null); }
  }

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!lista) return <Carregando />;

  const aFazer = lista.filter((r) => naJanela(r) && !r.enviadaEm);
  const enviadas = lista.filter((r) => r.enviadaEm);
  const adiante = lista.filter((r) => !naJanela(r) && !r.enviadaEm);

  const linha = (r: Receita) => {
    const meds = [r.saude.medicamento_diario_qual, r.saude.problema_saude_qual].filter(Boolean).join(" · ");
    const atrasada = r.diasAteLimite != null && r.diasAteLimite < 0 && !r.enviadaEm;
    return (
      <div key={r.passageiroId} className="rel-card p-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{r.nome}</div>
          <div className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {r.exp.nome}{r.exp.data_embarque ? ` · embarque ${formatDate(r.exp.data_embarque)}` : ""}{r.telefone ? ` · ${r.telefone}` : ""}
          </div>
          {meds && <div className="text-[12.5px] mt-1" style={{ color: "var(--ink2)" }}>{meds}</div>}
        </div>
        {r.enviadaEm
          ? <Selo tom="ok">Enviada {formatDateTime(r.enviadaEm)}</Selo>
          : r.limite && <Selo tom={atrasada ? "erro" : "aviso"}>{atrasada ? `Prazo passou (${formatDate(r.limite)})` : `Enviar até ${formatDate(r.limite)}`}</Selo>}
        <Botao variante="fantasma" onClick={() => ir("expedicoes", `${r.exp.id}/passageiros/pax/${r.passageiroId}`)}>Abrir passageiro ↗</Botao>
        {podeDecidirInscricao && (r.enviadaEm
          ? <Botao disabled={ocupado === r.passageiroId} onClick={() => mudar(r, { enviada: false }, "Voltou pra lista")}>Desfazer</Botao>
          : <>
            <Botao variante="fantasma" disabled={ocupado === r.passageiroId} onClick={() => mudar(r, { pendente: false }, "Receita tirada da lista")}>Não precisa</Botao>
            <Botao variante="primario" disabled={ocupado === r.passageiroId} onClick={() => mudar(r, { enviada: true }, "Receita marcada como enviada")}>Marcar enviada</Botao>
          </>)}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Receitas</h1>
        <Selo tom={aFazer.length ? "aviso" : "neutro"}>{aFazer.length}</Selo>
      </header>
      <p className="text-[13px]" style={{ color: "var(--ink3)", margin: 0 }}>
        Receitas marcadas na triagem de saúde das inscrições. Cada uma aparece quando faltam {DIAS_JANELA_RECEITA} dias ou menos pro embarque.
        {adiante.length > 0 && ` Mais ${adiante.length} marcada${adiante.length > 1 ? "s" : ""} pra expedições mais adiante.`}
      </p>
      {aFazer.length === 0
        ? <Vazio titulo="Nenhuma receita para enviar agora." texto="Quando faltar 20 dias pro embarque de quem precisa de receita, ela aparece aqui." />
        : <div className="space-y-2">{aFazer.map(linha)}</div>}
      {enviadas.length > 0 && (
        <section className="space-y-2">
          <button type="button" onClick={() => setVerEnviadas((v) => !v)} className="text-[13.5px] font-bold" style={{ color: "var(--ink2)" }}>
            {verEnviadas ? "▾" : "▸"} Enviadas ({enviadas.length})
          </button>
          {verEnviadas && <div className="space-y-2">{enviadas.map(linha)}</div>}
        </section>
      )}
    </div>
  );
}
