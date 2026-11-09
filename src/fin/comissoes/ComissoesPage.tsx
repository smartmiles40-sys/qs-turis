// src/fin/comissoes/ComissoesPage.tsx
// -----------------------------------------------------------------------------
// Financeiro › Comissões (Bruno, 06/11/2026). O financeiro vê o que cada SDR e
// closer tem pra receber, card por card, ajusta com motivo, fecha o mês (os
// valores congelam), marca pago e exporta igual à planilha.
//   Abas: SDR · Closer · Sem dono · Regras · Apelidos
// A conta é a de ./calculo (pura, com testes); os dados vêm de ./dados (0327).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Segmented } from "@/components/ui";
import { ResumoDaConta, SeletorDeMes, SeloStatus } from "./comuns";
import { supabase } from "@/lib/supabase";
import { Aviso, Campo, Entrada, Modal } from "../ui";
import { csvDasLinhas, dataBr, resumoPorPessoa, type Faixa, type FaixaBonus, type Linha, type Papel, type Regra } from "./calculo";
import {
  ajustarCard, apagarApelido, apagarRegra, atualizarAgora, baixarCsv, carregarMes, desfazerPago, fecharMes,
  historicoDoCard, listarApelidos, marcarPago, mesAnterior, mesAtual, reabrir, rotuloMes, salvarApelido, salvarLucro, salvarRegra,
  type Apelido, type DadosDoMes, type Fechamento,
} from "./dados";
import Planilha, { brl } from "./Planilha";

type Aba = "sdr" | "closer" | "semdono" | "regras" | "apelidos";
interface Pessoa { id: string; name: string; role: string; is_active: boolean }

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export default function ComissoesPage() {
  const [mes, setMes] = useState(() => mesAnterior(mesAtual()));
  const [aba, setAba] = useState<Aba>("sdr");
  const [dados, setDados] = useState<DadosDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);        // pessoa_id na planilha
  const [ajustando, setAjustando] = useState<Linha | null>(null);
  const [lucrando, setLucrando] = useState<Linha | null>(null);
  const [acao, setAcao] = useState<{ tipo: "pagar" | "reabrir" | "fechar-todos"; f?: Fechamento } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setDados(await carregarMes(mes)); } catch (e) { setErro((e as Error).message); }
  }, [mes]);
  useEffect(() => { setDados(null); void carregar(); }, [carregar]);
  useEffect(() => {
    void supabase.from("qs_users").select("id,name,role,is_active").order("name").then(({ data }) => setPessoas((data ?? []) as Pessoa[]));
  }, []);

  const nomeDe = useCallback((id: string | null, reserva = "—") => pessoas.find((p) => p.id === id)?.name ?? reserva, [pessoas]);
  const papel: Papel = aba === "closer" ? "closer" : "sdr";

  // Linhas de cada pessoa: congeladas se o mês dela está fechado, senão as ao vivo.
  const fechamentoDe = useCallback((pid: string, p: Papel) => dados?.fechamentos.find((f) => f.pessoa_id === pid && f.papel === p), [dados]);
  const linhasDe = useCallback((pid: string, p: Papel): Linha[] => {
    const f = fechamentoDe(pid, p);
    if (f) return f.itens;
    return (dados?.linhas ?? []).filter((l) => l.papel === p && l.pessoa_id === pid);
  }, [dados, fechamentoDe]);

  const resumo = useMemo(() => {
    if (!dados) return [];
    const vivos = resumoPorPessoa(dados.linhas.filter((l) => l.papel === papel && l.pessoa_id));
    const ids = new Set([...vivos.map((r) => r.pessoa_id!), ...dados.fechamentos.filter((f) => f.papel === papel).map((f) => f.pessoa_id)]);
    return [...ids].map((id) => {
      const f = fechamentoDe(id, papel);
      const r = resumoPorPessoa(linhasDe(id, papel))[0] ?? { cards: 0, vendas: 0, soma_vendas: 0, rr: 0, rr_faixa: 0, valor_por_rr: 0, falta_lucro: 0, total: 0 };
      const aoVivo = vivos.find((v) => v.pessoa_id === id)?.total ?? 0;
      return { id, nome: nomeDe(id), f, ...r, mudou: !!f && Math.abs(aoVivo - f.total) > 0.005, aoVivo };
    }).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  }, [dados, papel, fechamentoDe, linhasDe, nomeDe]);

  const semDono = useMemo(() => (dados?.linhas ?? []).filter((l) => !l.pessoa_id), [dados]);

  async function rodar(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try { await fn(); if (ok) setAviso(ok); await carregar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  const exportar = (linhas: (Linha & { pessoa?: string })[], nome: string, p: Papel) =>
    baixarCsv(`comissoes-${p}-${mes}-${nome.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}.csv`, csvDasLinhas(linhas, p));

  const exportarTodos = () => {
    const todas = resumo.flatMap((r) => linhasDe(r.id, papel).map((l) => ({ ...l, pessoa: r.nome })));
    exportar(todas, "todos", papel);
  };

  const fecharTodos = () => rodar(async () => {
    let n = 0;
    for (const r of resumo) if (!r.f) { await fecharMes(r.id, papel, mes, linhasDe(r.id, papel)); n++; }
    setAviso(`${n} fechamento${n === 1 ? "" : "s"} de ${rotuloMes(mes)} feito${n === 1 ? "" : "s"}.`);
  });

  const pessoaAberta = aberta ? resumo.find((r) => r.id === aberta) : null;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Comissões</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            O que cada SDR e closer tem pra receber, card por card. Venda conta na data da venda; R.R na data da reunião realizada (a faixa do mês vale pra todas); bônus no dia do agendamento.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SeletorDeMes mes={mes} onMes={(m) => { setMes(m); setAberta(null); }} />
          <Button size="sm" disabled={ocupado} onClick={() => rodar(atualizarAgora, "Cards atualizados do Bitrix (via Dashboard).")}>Atualizar agora</Button>
        </div>
      </div>
      {dados?.sync && (
        <p className="text-[12px]" style={{ color: dados.sync.erro ? "var(--err-ink)" : "var(--ink3)" }}>
          {dados.sync.rodou_em ? `Cards copiados do Bitrix em ${new Date(dados.sync.rodou_em).toLocaleString("pt-BR")}` : "Ainda não houve cópia do Bitrix."}
          {dados.sync.erro ? ` · Última tentativa falhou: ${dados.sync.erro}` : ""}
        </p>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}

      <Segmented<Aba> label="Comissões" value={aba} onChange={(a) => { setAba(a); setAberta(null); }} options={[
        { value: "sdr", label: "SDR" }, { value: "closer", label: "Closer" },
        { value: "semdono", label: "Sem dono", count: semDono.length || undefined },
        { value: "regras", label: "Regras" }, { value: "apelidos", label: "Apelidos" },
      ]} />

      {!dados && !erro && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}

      {dados && (aba === "sdr" || aba === "closer") && !pessoaAberta && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" disabled={!resumo.length} onClick={exportarTodos}>Exportar CSV (todos)</Button>
            <Button size="sm" variant="primary" disabled={ocupado || !resumo.some((r) => !r.f)} onClick={() => setAcao({ tipo: "fechar-todos" })}>
              Fechar {rotuloMes(mes)} de todos
            </Button>
          </div>
          {!dados.regras.some((r) => r.papel === papel) && (
            <Aviso tom="aviso">Ainda não há regra de comissão de {papel === "sdr" ? "SDR" : "closer"}: todos os valores estão em R$ 0,00. Preencha na aba Regras.</Aviso>
          )}
          <div className="qs-card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead style={{ background: "var(--card2)" }}>
                <tr>{["Pessoa", "Cards", "Vendas", "Soma das vendas", ...(papel === "sdr" ? ["R.R × faixa"] : []), "A receber", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 11.5, textAlign: "left", color: "var(--ink2)" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={r.id} className="rel-linha" style={{ cursor: "pointer" }} onClick={() => setAberta(r.id)}>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", fontWeight: 600, color: "var(--ink)" }}>{r.nome}</td>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)" }}>{r.cards}</td>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)" }}>{r.vendas}</td>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", whiteSpace: "nowrap" }}>{brl(r.soma_vendas)}</td>
                    {papel === "sdr" && <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", whiteSpace: "nowrap" }}>{r.rr}{r.rr ? <span style={{ color: "var(--ink3)" }}> × {brl(r.valor_por_rr)}</span> : null}</td>}
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {brl(r.total)}
                      {!r.f && r.falta_lucro > 0 && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--warn-ink, #B45309)" }}>{r.falta_lucro} sem lucro</span>}
                    </td>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)" }}>
                      <SeloStatus f={r.f} />
                      {r.mudou && <span style={{ display: "block", fontSize: 11, color: "var(--warn-ink, #B45309)" }} title="Os cards mudaram depois do fechamento">ao vivo hoje: {brl(r.aoVivo)}</span>}
                    </td>
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", color: "var(--ink3)" }}>Abrir ›</td>
                  </tr>
                ))}
                {!resumo.length && <tr><td colSpan={8} style={{ padding: 20, textAlign: "center", color: "var(--ink3)", fontSize: 13 }}>Nenhum card de {papel === "sdr" ? "SDR" : "closer"} em {rotuloMes(mes)}.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dados && (aba === "sdr" || aba === "closer") && pessoaAberta && (() => {
        const f = pessoaAberta.f;
        const linhas = linhasDe(pessoaAberta.id, papel);
        return (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Button size="sm" onClick={() => setAberta(null)}>‹ Voltar</Button>
              <strong style={{ color: "var(--ink)", fontSize: 15 }}>{pessoaAberta.nome}</strong>
              <SeloStatus f={f} />
              <span style={{ flex: 1 }} />
              <Button size="sm" onClick={() => exportar(linhas.map((l) => ({ ...l, pessoa: pessoaAberta.nome })), pessoaAberta.nome, papel)}>Exportar CSV</Button>
              {!f && <Button size="sm" variant="primary" disabled={ocupado} onClick={() => rodar(() => fecharMes(pessoaAberta.id, papel, mes, linhas), `${rotuloMes(mes)} de ${pessoaAberta.nome} fechado: valores congelados.`)}>Fechar o mês</Button>}
              {f?.status === "fechado" && <Button size="sm" variant="primary" disabled={ocupado} onClick={() => setAcao({ tipo: "pagar", f })}>Marcar pago</Button>}
              {f?.status === "pago" && <Button size="sm" disabled={ocupado} onClick={() => rodar(() => desfazerPago(f.id), "Pagamento desmarcado.")}>Desfazer pago</Button>}
              {f && <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setAcao({ tipo: "reabrir", f })}>Reabrir</Button>}
            </div>
            {f && (
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                Fechado em {new Date(f.fechado_em).toLocaleString("pt-BR")} por {nomeDe(f.fechado_por)}: estes valores não mudam mais, mesmo se a regra ou o card mudarem.
                {pessoaAberta.mudou && ` Hoje, ao vivo, daria ${brl(pessoaAberta.aoVivo)}. Para refazer, reabra com motivo e feche de novo.`}
              </p>
            )}
            <ResumoDaConta r={resumoPorPessoa(linhas)[0]} papel={papel} regras={dados.regras} pessoaId={pessoaAberta.id} mes={mes} />
            <Planilha linhas={linhas} papel={papel} onLucro={f ? undefined : setLucrando}
              acoes={f ? undefined : (l) => <Button size="sm" variant="ghost" onClick={() => setAjustando(l)}>Ajustar</Button>} />
            {dados.historico.filter((h) => h.pessoa_id === pessoaAberta.id && h.papel === papel).map((h) => (
              <p key={h.id} className="text-[12px]" style={{ color: "var(--ink3)" }}>
                Reaberto em {h.reaberto_em ? new Date(h.reaberto_em).toLocaleString("pt-BR") : "—"} (era {brl(h.total)}): {h.motivo_reabertura}
              </p>
            ))}
          </>
        );
      })()}

      {dados && aba === "semdono" && (
        <>
          <Aviso tom="aviso">
            Cards cujo SDR ou closer do Bitrix não casou com ninguém do QS, ou sem SDR e sem closer ("Não se aplica"). Só o Financeiro vê.
            Se o nome é de alguém do time, cadastre o apelido na aba Apelidos e o card vai pra pessoa.
          </Aviso>
          {(["sdr", "closer"] as Papel[]).map((p) => {
            const ls = semDono.filter((l) => l.papel === p);
            if (!ls.length) return null;
            return (
              <div key={p} className="space-y-2">
                <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{p === "sdr" ? "Como SDR" : "Como closer / sem responsável"}</h2>
                <Planilha linhas={ls} papel={p} onLucro={setLucrando} acoes={(l) => <span className="text-[12px]" style={{ color: "var(--ink2)" }}>Bitrix: {l.nome_bitrix}</span>} />
              </div>
            );
          })}
          {!semDono.length && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Todo card de {rotuloMes(mes)} tem dono.</p>}
        </>
      )}

      {dados && aba === "regras" && <AbaRegras regras={dados.regras} pessoas={pessoas} nomeDe={nomeDe} onMudou={carregar} />}
      {aba === "apelidos" && <AbaApelidos pessoas={pessoas} sugestoes={[...new Set(semDono.map((l) => l.nome_bitrix).filter((n) => n && !/n[aã]o se aplica|sem respons/i.test(n)))]} onMudou={carregar} />}

      {ajustando && (
        <ModalAjuste linha={ajustando} mes={mes} nome={nomeDe(ajustando.pessoa_id)} nomeDe={nomeDe}
          onFechar={() => setAjustando(null)} onSalvo={() => { setAjustando(null); void carregar(); }} />
      )}
      {lucrando && (
        <ModalLucro linha={lucrando} atual={dados?.lucros[lucrando.bitrix_id] ?? null} nomeDe={nomeDe}
          onFechar={() => setLucrando(null)} onSalvo={() => { setLucrando(null); void carregar(); }} />
      )}
      {acao?.tipo === "pagar" && acao.f && (
        <ModalTexto titulo="Marcar como pago" rotulo="Data do pagamento" tipo="date" inicial={hoje()} onFechar={() => setAcao(null)}
          onOk={(v) => { const f = acao.f!; setAcao(null); void rodar(() => marcarPago(f.id, v), "Marcado como pago."); }} />
      )}
      {acao?.tipo === "reabrir" && acao.f && (
        <ModalTexto titulo="Reabrir o mês" rotulo="Motivo (fica no histórico)" tipo="text" inicial="" onFechar={() => setAcao(null)}
          onOk={(v) => { const f = acao.f!; setAcao(null); void rodar(() => reabrir(f.id, v), "Mês reaberto: os valores voltam a ser calculados ao vivo."); }} />
      )}
      {acao?.tipo === "fechar-todos" && (
        <Modal aberto titulo={`Fechar ${rotuloMes(mes)} de todos`} onFechar={() => setAcao(null)}
          rodape={<><Button onClick={() => setAcao(null)}>Cancelar</Button><Button variant="primary" onClick={() => { setAcao(null); void fecharTodos(); }}>Fechar e congelar</Button></>}>
          <p className="text-[13.5px]" style={{ color: "var(--ink)" }}>
            Fecha o mês de {resumo.filter((r) => !r.f).length} {papel === "sdr" ? "SDR(s)" : "closer(s)"} em aberto, total de{" "}
            {brl(resumo.filter((r) => !r.f).reduce((s, r) => s + r.total, 0))}. Os valores ficam congelados; depois só reabrindo com motivo.
          </p>
        </Modal>
      )}
    </div>
  );
}

function ModalTexto({ titulo, rotulo, tipo, inicial, onOk, onFechar }: { titulo: string; rotulo: string; tipo: "text" | "date"; inicial: string; onOk: (v: string) => void; onFechar: () => void }) {
  const [v, setV] = useState(inicial);
  const ok = tipo === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(v) : v.trim().length >= 3;
  return (
    <Modal aberto titulo={titulo} onFechar={onFechar} largura={440}
      rodape={<><Button onClick={onFechar}>Cancelar</Button><Button variant="primary" disabled={!ok} onClick={() => onOk(v.trim())}>Confirmar</Button></>}>
      <Campo rotulo={rotulo}><Entrada type={tipo} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Campo>
    </Modal>
  );
}

function ModalLucro({ linha, atual, nomeDe, onFechar, onSalvo }: {
  linha: Linha; atual: { lucro: number; obs: string | null; atualizado_por: string | null; atualizado_em: string } | null;
  nomeDe: (id: string | null) => string; onFechar: () => void; onSalvo: () => void;
}) {
  const [valor, setValor] = useState(atual ? String(atual.lucro).replace(".", ",") : "");
  const [obs, setObs] = useState(atual?.obs ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const numero = Number(valor.replace(/\./g, "").replace(",", "."));
  const ok = valor.trim() !== "" && Number.isFinite(numero) && numero >= 0;
  const pct = linha.valor_venda > 0 && ok ? Math.round((numero / linha.valor_venda) * 1000) / 10 : null;

  async function salvar(apagar = false) {
    try { await salvarLucro(linha.bitrix_id, apagar ? null : numero, obs.trim() || null); onSalvo(); } catch (e) { setErro((e as Error).message); }
  }

  return (
    <Modal aberto titulo={`Lucro do card ${linha.bitrix_id}`} onFechar={onFechar} largura={460}
      rodape={<>
        {atual && <Button variant="ghost" onClick={() => void salvar(true)}>Apagar</Button>}
        <Button onClick={onFechar}>Cancelar</Button>
        <Button variant="primary" disabled={!ok} onClick={() => void salvar()}>Salvar</Button>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          {linha.cliente} · {linha.tipo_venda ?? "Sem tipo"} · venda de <strong>{brl(linha.valor_venda)}</strong>
        </p>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          A comissão de pacote, aéreo e demais produtos (closer) e de aéreo vendido pelo próprio SDR é % do lucro. O Bitrix não traz o custo,
          então o lucro é digitado aqui. Vale pro SDR e pro closer do card.
        </p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Campo rotulo="Lucro da venda (R$)" dica={pct != null ? `${String(pct).replace(".", ",")}% do valor da venda` : undefined}>
          <Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 1.250,00" autoFocus />
        </Campo>
        <Campo rotulo="Observação (opcional)"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: conforme fechamento do fornecedor" /></Campo>
        {atual && (
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            Última mudança: {new Date(atual.atualizado_em).toLocaleString("pt-BR")}{atual.atualizado_por ? ` por ${nomeDe(atual.atualizado_por)}` : ""}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function ModalAjuste({ linha, mes, nome, nomeDe, onFechar, onSalvo }: { linha: Linha; mes: string; nome: string; nomeDe: (id: string | null) => string; onFechar: () => void; onSalvo: () => void }) {
  const [tipo, setTipo] = useState<"valor" | "nao_comissiona" | "limpar">(linha.ajuste?.tipo === "nao_comissiona" ? "nao_comissiona" : "valor");
  const [valor, setValor] = useState(linha.ajuste?.valor != null ? String(linha.ajuste.valor).replace(".", ",") : "");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [hist, setHist] = useState<Awaited<ReturnType<typeof historicoDoCard>>>([]);
  useEffect(() => { if (linha.pessoa_id) void historicoDoCard(linha.bitrix_id, linha.pessoa_id, linha.papel).then(setHist).catch(() => setHist([])); }, [linha]);
  const numero = Number(valor.replace(/\./g, "").replace(",", "."));
  const ok = motivo.trim().length >= 3 && (tipo !== "valor" || (valor.trim() !== "" && Number.isFinite(numero)));

  async function salvar() {
    if (!linha.pessoa_id) return;
    try {
      await ajustarCard({ bitrix_id: linha.bitrix_id, pessoa_id: linha.pessoa_id, papel: linha.papel, mes, tipo, valor: tipo === "valor" ? numero : null, motivo: motivo.trim() });
      onSalvo();
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <Modal aberto titulo={`Ajustar card ${linha.bitrix_id}`} onFechar={onFechar}
      rodape={<><Button onClick={onFechar}>Cancelar</Button><Button variant="primary" disabled={!ok} onClick={() => void salvar()}>Salvar ajuste</Button></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          {linha.cliente} · {nome} ({linha.papel === "sdr" ? "SDR" : "closer"}) · calculado: <strong>{brl(linha.comissao_calculada)}</strong>
        </p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Segmented value={tipo} onChange={setTipo} label="Tipo de ajuste" options={[
          { value: "valor", label: "Valor manual" }, { value: "nao_comissiona", label: "Não comissiona" },
          ...(linha.ajuste ? [{ value: "limpar" as const, label: "Voltar ao calculado" }] : []),
        ]} />
        {tipo === "valor" && (
          <Campo rotulo="Comissão deste card (R$)"><Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 150,00" /></Campo>
        )}
        <Campo rotulo="Motivo (obrigatório, fica no histórico)"><Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        {hist.length > 0 && (
          <div>
            <span className="block text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Histórico deste card</span>
            <ul className="text-[12px] space-y-1" style={{ color: "var(--ink3)" }}>
              {hist.map((h, i) => (
                <li key={i}>{new Date(h.criado_em).toLocaleString("pt-BR")} · {h.mes} · {h.tipo === "valor" ? brl(Number(h.valor)) : h.tipo === "limpar" ? "voltou ao calculado" : "não comissiona"} · {h.motivo}
                  {h.criado_por ? ` · ${nomeDe(h.criado_por)}` : ""}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

type FormRegra = Omit<Regra, "id"> & { id?: string; obs?: string | null };

const FAIXAS_PDF: Faixa[] = [{ de: 0, valor: 8 }, { de: 41, valor: 12 }, { de: 60, valor: 16 }, { de: 90, valor: 20 }];
const BONUS_PDF: FaixaBonus[] = [{ min: 6, valor: 20 }, { min: 10, valor: 40 }];

const vazioRegra = (papel: Papel): FormRegra => ({
  papel, pessoa_id: null, vigente_desde: `${mesAtual()}-01`, obs: null,
  valor_exp_geral: null, valor_exp_peru: null, valor_exp_amazonia: null, valor_pacote: null, valor_outros: null,
  pct_lucro: null, valor_cotacao: null, faixas_rr: papel === "sdr" ? FAIXAS_PDF : null, bonus_dia: papel === "sdr" ? BONUS_PDF : null,
});

const campoNum = (v: number | null | undefined) => (v == null ? "" : String(v).replace(".", ","));
const lerNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));

function AbaRegras({ regras, pessoas, nomeDe, onMudou }: { regras: Regra[]; pessoas: Pessoa[]; nomeDe: (id: string | null, r?: string) => string; onMudou: () => void }) {
  const [form, setForm] = useState<FormRegra | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const vendedores = pessoas.filter((p) => p.is_active && ["sdr", "closer", "gestor", "admin"].includes(p.role));

  async function salvar() {
    if (!form) return;
    try { setErro(null); await salvarRegra(form); setForm(null); onMudou(); } catch (e) { setErro((e as Error).message); }
  }

  const fmt = (v: number | null | undefined, pct?: boolean) => (v == null ? "—" : pct ? `${String(v).replace(".", ",")}%` : brl(v));
  const fmtFaixas = (f: Faixa[] | null | undefined) => (f?.length ? [...f].sort((a, b) => a.de - b.de).map((x) => `${x.de}+: ${brl(x.valor)}`).join(" · ") : "—");
  const fmtBonus = (f: FaixaBonus[] | null | undefined) => (f?.length ? [...f].sort((a, b) => a.min - b.min).map((x) => `${x.min}: ${brl(x.valor)}`).join(" · ") : "—");
  const td = { padding: "8px 10px", borderTop: "1px solid var(--line)", fontSize: 13, verticalAlign: "top" as const };
  const COLS: Record<Papel, { h: string; v: (r: Regra) => string }[]> = {
    sdr: [
      { h: "Exp. geral", v: (r) => fmt(r.valor_exp_geral) }, { h: "Exp. Peru", v: (r) => fmt(r.valor_exp_peru) },
      { h: "Exp. Amazônia", v: (r) => fmt(r.valor_exp_amazonia) }, { h: "Pacote", v: (r) => fmt(r.valor_pacote) },
      { h: "Passagem/hosp./seguro/outros", v: (r) => fmt(r.valor_outros) }, { h: "Aéreo próprio (% lucro)", v: (r) => fmt(r.pct_lucro, true) },
      { h: "Cotação", v: (r) => fmt(r.valor_cotacao) }, { h: "R.R por faixa", v: (r) => fmtFaixas(r.faixas_rr) },
      { h: "Bônus do dia", v: (r) => fmtBonus(r.bonus_dia) },
    ],
    closer: [
      { h: "Exp. geral", v: (r) => fmt(r.valor_exp_geral) }, { h: "Exp. Peru", v: (r) => fmt(r.valor_exp_peru) },
      { h: "Exp. Amazônia", v: (r) => fmt(r.valor_exp_amazonia) }, { h: "Pacote, aéreo e demais (% lucro)", v: (r) => fmt(r.pct_lucro, true) },
    ],
  };

  return (
    <div className="space-y-3">
      <Aviso tom="aviso">
        SDR: fixo por venda originada (expedição por destino, pacote, demais produtos), % do lucro no aéreo que ela mesma vendeu, fixo por
        cotação de aéreo entregue, R.R pela faixa do mês (vale pra todas as R.R) e bônus no dia em que bater os agendamentos.
        Closer: fixo por expedição (por destino) e % do lucro no resto. Expedição que não é Peru nem Amazônia usa o "geral".
        A regra que vale é a mais nova com vigência até a data do fato. Exceção por pessoa: campo vazio usa a regra geral. Mês fechado nunca muda.
      </Aviso>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="primary" onClick={() => setForm(vazioRegra("sdr"))}>Nova regra de SDR</Button>
        <Button size="sm" variant="primary" onClick={() => setForm(vazioRegra("closer"))}>Nova regra de closer</Button>
      </div>
      {(["sdr", "closer"] as Papel[]).map((p) => (
        <div key={p} className="qs-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: p === "sdr" ? 1100 : 760 }}>
            <thead style={{ background: "var(--card2)" }}>
              <tr>{[p === "sdr" ? "SDR" : "Closer", "Vale desde", ...COLS[p].map((c) => c.h), ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", fontSize: 11.5, textAlign: "left", color: "var(--ink2)" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {regras.filter((r) => r.papel === p).map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {r.pessoa_id ? `Exceção: ${nomeDe(r.pessoa_id)}` : "Geral"}
                    {r.sem_comissao && <span style={{ display: "block", fontSize: 11.5, color: "var(--err-ink)" }}>Fora da comissão</span>}
                    {r.obs && <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, color: "var(--ink3)", maxWidth: 220 }}>{r.obs}</span>}
                  </td>
                  <td style={td}>{dataBr(r.vigente_desde)}</td>
                  {COLS[p].map((c) => <td key={c.h} style={td}>{c.v(r)}</td>)}
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...r, obs: r.obs ?? null })}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Apagar esta regra? Meses em aberto passam a usar a regra anterior.")) void apagarRegra(r.id!).then(onMudou).catch((e) => setErro(e.message)); }}>Apagar</Button>
                  </td>
                </tr>
              ))}
              {!regras.some((r) => r.papel === p) && <tr><td colSpan={COLS[p].length + 3} style={{ padding: 16, color: "var(--ink3)", fontSize: 13 }}>Nenhuma regra de {p === "sdr" ? "SDR" : "closer"} ainda: tudo sai R$ 0,00.</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
      {form && (
        <Modal aberto titulo={`${form.id ? "Editar" : "Nova"} regra de ${form.papel === "sdr" ? "SDR" : "closer"}`} onFechar={() => setForm(null)} largura={640}
          rodape={<><Button onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(form.vigente_desde)} onClick={() => void salvar()}>Salvar</Button></>}>
          <FormularioRegra form={form} setForm={setForm} vendedores={vendedores} />
        </Modal>
      )}
    </div>
  );
}

function FormularioRegra({ form, setForm, vendedores }: { form: FormRegra; setForm: (f: FormRegra) => void; vendedores: Pessoa[] }) {
  const sdr = form.papel === "sdr";
  const num = (k: "valor_exp_geral" | "valor_exp_peru" | "valor_exp_amazonia" | "valor_pacote" | "valor_outros" | "pct_lucro" | "valor_cotacao", rotulo: string, dica?: string) => (
    <Campo rotulo={rotulo} dica={dica}>
      <Entrada inputMode="decimal" value={campoNum(form[k])} onChange={(e) => setForm({ ...form, [k]: lerNum(e.target.value) })} />
    </Campo>
  );
  const titulo = (t: string) => <h3 className="sm:col-span-3 text-[12.5px] font-bold mt-1" style={{ color: "var(--ink2)" }}>{t}</h3>;
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <div className="sm:col-span-2">
        <Campo rotulo="Para quem">
          <select className="rel-input" value={form.pessoa_id ?? ""} onChange={(e) => setForm({ ...form, pessoa_id: e.target.value || null })}>
            <option value="">Todos ({sdr ? "regra geral de SDR" : "regra geral de closer"})</option>
            {vendedores.map((p) => <option key={p.id} value={p.id}>Exceção: {p.name}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Vale a partir de" dica="Não reescreve meses já fechados.">
        <Entrada type="date" value={form.vigente_desde} onChange={(e) => setForm({ ...form, vigente_desde: e.target.value })} />
      </Campo>

      {form.pessoa_id && (
        <label className="sm:col-span-3" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--ink)" }}>
          <input type="checkbox" checked={!!form.sem_comissao} onChange={(e) => setForm({ ...form, sem_comissao: e.target.checked })} />
          Fora da comissão (ex.: supervisor): as vendas e R.R dessa pessoa não entram na conta
        </label>
      )}
      {titulo("Venda de expedição (valor fixo por venda, R$)")}
      {num("valor_exp_geral", "Ásia, Europa, Egito e demais")}
      {num("valor_exp_peru", "Peru")}
      {num("valor_exp_amazonia", "Amazônia")}

      {titulo(sdr ? "Demais vendas originadas" : "Demais vendas")}
      {sdr && num("valor_pacote", "Pacote (R$ fixo)")}
      {sdr && num("valor_outros", "Passagem, hospedagem, seguro e outros (R$ fixo)", "Passagem fechada pelo closer entra aqui.")}
      {num("pct_lucro", sdr ? "Aéreo vendido pela própria SDR (% do lucro)" : "Pacotes, aéreo e demais (% do lucro)")}
      {sdr && num("valor_cotacao", "Cotação de aéreo entregue (R$ por proposta)")}

      {sdr && (
        <>
          {titulo("Reunião realizada: a faixa do mês vale pra todas as R.R")}
          <div className="sm:col-span-3">
            <EditorFaixas
              linhas={(form.faixas_rr ?? []).map((f) => ({ n: f.de, valor: f.valor }))}
              rotuloN="A partir de (R.R no mês)" rotuloValor="Valor por R.R (R$)"
              onMudar={(ls) => setForm({ ...form, faixas_rr: ls.map((l) => ({ de: l.n, valor: l.valor })) })} />
          </div>
          {titulo("Bônus diário de agendamentos (vale a maior faixa batida no dia)")}
          <div className="sm:col-span-3">
            <EditorFaixas
              linhas={(form.bonus_dia ?? []).map((f) => ({ n: f.min, valor: f.valor }))}
              rotuloN="Agendamentos no dia" rotuloValor="Bônus do dia (R$)"
              onMudar={(ls) => setForm({ ...form, bonus_dia: ls.map((l) => ({ min: l.n, valor: l.valor })) })} />
          </div>
        </>
      )}

      <div className="sm:col-span-3">
        <Campo rotulo="Observação"><Entrada value={form.obs ?? ""} onChange={(e) => setForm({ ...form, obs: e.target.value || null })} placeholder="Ex.: planilha de comissão de outubro" /></Campo>
      </div>
      {form.pessoa_id && <p className="sm:col-span-3 text-[12px]" style={{ color: "var(--ink3)" }}>Na exceção, deixe vazio (ou sem faixas) o que deve seguir a regra geral.</p>}
    </div>
  );
}

function EditorFaixas({ linhas, rotuloN, rotuloValor, onMudar }: {
  linhas: { n: number; valor: number }[]; rotuloN: string; rotuloValor: string; onMudar: (l: { n: number; valor: number }[]) => void;
}) {
  const mudar = (i: number, k: "n" | "valor", v: string) => onMudar(linhas.map((l, j) => (j === i ? { ...l, [k]: lerNum(v) ?? 0 } : l)));
  return (
    <div className="space-y-2">
      {linhas.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
          <Campo rotulo={i === 0 ? rotuloN : ""}><Entrada inputMode="numeric" value={String(l.n)} onChange={(e) => mudar(i, "n", e.target.value)} /></Campo>
          <Campo rotulo={i === 0 ? rotuloValor : ""}><Entrada inputMode="decimal" value={campoNum(l.valor)} onChange={(e) => mudar(i, "valor", e.target.value)} /></Campo>
          <Button size="sm" variant="ghost" aria-label="Tirar faixa" onClick={() => onMudar(linhas.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onMudar([...linhas, { n: (linhas.at(-1)?.n ?? 0) + 1, valor: 0 }])}>+ Faixa</Button>
    </div>
  );
}

function AbaApelidos({ pessoas, sugestoes, onMudou }: { pessoas: Pessoa[]; sugestoes: string[]; onMudou: () => void }) {
  const [lista, setLista] = useState<Apelido[] | null>(null);
  const [nome, setNome] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = useCallback(() => listarApelidos().then(setLista).catch((e) => setErro(e.message)), []);
  useEffect(() => { void recarregar(); }, [recarregar]);
  const nomeDe = (id: string) => pessoas.find((p) => p.id === id)?.name ?? "—";

  async function salvar() {
    try { setErro(null); await salvarApelido(nome, pessoa); setNome(""); setPessoa(""); await recarregar(); onMudou(); } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div className="space-y-3">
      <Aviso tom="aviso">
        O nome do Bitrix casa sozinho com a pessoa do QS quando é igual (sem o " - SDR"/" - Closer") ou quando um é o começo do outro e só
        uma pessoa bate. Quando não casa, o card vai pra "Sem dono". Aqui você diz quem é quem; os cards mudam de dono na hora.
      </Aviso>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="qs-card" style={{ padding: 12, display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", alignItems: "end" }}>
        <Campo rotulo="Nome como vem do Bitrix">
          <Entrada list="fin-com-sugestoes" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Mariana Rodrigues - SDR" />
          <datalist id="fin-com-sugestoes">{sugestoes.map((s) => <option key={s} value={s} />)}</datalist>
        </Campo>
        <Campo rotulo="Pessoa do QS">
          <select className="rel-input" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Escolha…</option>
            {pessoas.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Campo>
        <Button variant="primary" disabled={!nome.trim() || !pessoa} onClick={() => void salvar()}>Salvar</Button>
      </div>
      <div className="qs-card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ background: "var(--card2)" }}>
            <tr>{["Nome no Bitrix", "Pessoa do QS", ""].map((h) => <th key={h} style={{ padding: "8px 10px", fontSize: 11.5, textAlign: "left", color: "var(--ink2)" }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(lista ?? []).map((a) => (
              <tr key={a.nome_norm}>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{a.nome_bitrix}</td>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{nomeDe(a.pessoa_id)}</td>
                <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>
                  <Button size="sm" variant="ghost" onClick={() => void apagarApelido(a.nome_norm).then(recarregar).then(onMudou).catch((e) => setErro(e.message))}>Apagar</Button>
                </td>
              </tr>
            ))}
            {lista && !lista.length && <tr><td colSpan={3} style={{ padding: 16, color: "var(--ink3)", fontSize: 13 }}>Nenhum apelido.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
