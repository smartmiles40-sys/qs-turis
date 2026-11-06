// src/fin/comissoes/MinhasComissoesPage.tsx
// -----------------------------------------------------------------------------
// Comercial › Minhas comissões (Bruno, 06/11): a mesma planilha do Financeiro,
// SÓ com os cards da própria pessoa, e o status do mês (em aberto / fechado /
// pago). Quem garante "só os meus" é o banco (RLS da 0327), não esta tela.
// Mês fechado mostra os valores congelados no fechamento.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/ui";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { resumoPorPessoa, type Linha, type Papel } from "./calculo";
import { carregarMes, mesAtual, rotuloMes, type DadosDoMes } from "./dados";
import Planilha, { brl } from "./Planilha";
import { SeletorDeMes, SeloStatus } from "./comuns";

/** `moldura`: no Comercial (SdrLayout) a tela põe o próprio respiro; na área do closer a casca já põe. */
export default function MinhasComissoesPage({ moldura = true }: { moldura?: boolean }) {
  const { currentUser } = useQsAuth();
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState<DadosDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null); setDados(null);
    try { setDados(await carregarMes(mes)); } catch (e) { setErro((e as Error).message); }
  }, [mes]);
  useEffect(() => { void carregar(); }, [carregar]);

  const eu = currentUser?.id ?? "";
  const blocos = useMemo(() => {
    if (!dados) return [];
    return (["sdr", "closer"] as Papel[]).map((papel) => {
      const f = dados.fechamentos.find((x) => x.pessoa_id === eu && x.papel === papel);
      const linhas: Linha[] = f ? f.itens : dados.linhas.filter((l) => l.papel === papel && l.pessoa_id === eu);
      return { papel, f, linhas, r: resumoPorPessoa(linhas)[0] };
    }).filter((b) => b.linhas.length || b.f);
  }, [dados, eu]);

  // O papel "de casa" aparece mesmo vazio, pra pessoa saber que a tela é dela.
  const papelDeCasa: Papel = currentUser?.role === "closer" ? "closer" : "sdr";

  return (
    <div className={`${moldura ? "px-4 sm:px-6 py-6 " : ""}max-w-6xl mx-auto space-y-4`}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Minhas comissões</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Card por card, do jeito que o Financeiro vê. A venda conta no mês em que sobe no Bitrix
            {papelDeCasa === "sdr" ? "; a R.R, no mês da reunião realizada" : ""}.
          </p>
        </div>
        <SeletorDeMes mes={mes} onMes={setMes} />
      </div>
      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!dados && !erro && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}
      {dados && !blocos.length && (
        <div className="qs-card" style={{ padding: 24, textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>
          Nenhum card seu em {rotuloMes(mes)}{dados.regras.length ? "" : " (e as regras de comissão ainda não foram cadastradas pelo Financeiro)"}.
        </div>
      )}
      {blocos.map((b) => (
        <section key={b.papel} className="space-y-3">
          {blocos.length > 1 && <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Como {b.papel === "sdr" ? "SDR" : "closer"}</h2>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="A receber" value={brl(b.r?.total ?? 0)} hint={<SeloStatus f={b.f} />} />
            <KpiCard label="Cards" value={b.r?.cards ?? 0} />
            <KpiCard label="Vendas" value={b.r?.vendas ?? 0} hint={brl(b.r?.soma_vendas ?? 0)} />
            {b.papel === "sdr" && <KpiCard label="R.R no mês" value={b.r?.rr ?? 0} />}
          </div>
          {b.f && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              {b.f.status === "pago" ? "Mês fechado e pago" : "Mês fechado pelo Financeiro"} em {new Date(b.f.fechado_em).toLocaleDateString("pt-BR")}: estes valores não mudam mais.
            </p>
          )}
          {!b.f && !dados?.regras.some((r) => r.papel === b.papel) && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>As regras de comissão ainda não foram cadastradas: os valores aparecem como R$ 0,00 por enquanto.</p>
          )}
          <Planilha linhas={b.linhas} papel={b.papel} />
        </section>
      ))}
    </div>
  );
}
