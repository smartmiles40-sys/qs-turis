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
import { SeletorDeMes, SeloStatus } from "./comuns";
import { supabase } from "@/lib/supabase";
import { Aviso, Campo, Entrada, Modal } from "../ui";
import { csvDasLinhas, dataBr, resumoPorPessoa, type Linha, type Papel, type Regra } from "./calculo";
import {
  ajustarCard, apagarApelido, apagarRegra, atualizarAgora, baixarCsv, carregarMes, desfazerPago, fecharMes,
  historicoDoCard, listarApelidos, marcarPago, mesAnterior, mesAtual, reabrir, rotuloMes, salvarApelido, salvarRegra,
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
      const r = resumoPorPessoa(linhasDe(id, papel))[0] ?? { cards: 0, vendas: 0, soma_vendas: 0, rr: 0, total: 0 };
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
            O que cada SDR e closer tem pra receber, card por card. Venda conta na data da venda; R.R na data da reunião realizada.
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
                <tr>{["Pessoa", "Cards", "Vendas", "Soma das vendas", ...(papel === "sdr" ? ["R.R"] : []), "A receber", "Status", ""].map((h) => (
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
                    {papel === "sdr" && <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)" }}>{r.rr}</td>}
                    <td style={{ padding: "9px 10px", borderTop: "1px solid var(--line)", fontWeight: 700, whiteSpace: "nowrap" }}>{brl(r.total)}</td>
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
            <Planilha linhas={linhas} papel={papel}
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
                <Planilha linhas={ls} papel={p} acoes={(l) => <span className="text-[12px]" style={{ color: "var(--ink2)" }}>Bitrix: {l.nome_bitrix}</span>} />
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

const vazioRegra = (papel: Papel): Omit<Regra, "id"> & { id?: string; obs?: string | null } => ({
  papel, pessoa_id: null, vigente_desde: `${mesAtual()}-01`, valor_rr: null, valor_expedicao: null, pct_aereo: null, pct_pacote: null, obs: null,
});

function AbaRegras({ regras, pessoas, nomeDe, onMudou }: { regras: Regra[]; pessoas: Pessoa[]; nomeDe: (id: string | null, r?: string) => string; onMudou: () => void }) {
  const [form, setForm] = useState<ReturnType<typeof vazioRegra> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const campoNum = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const lerNum = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));
  const vendedores = pessoas.filter((p) => p.is_active && ["sdr", "closer", "gestor", "admin"].includes(p.role));

  async function salvar() {
    if (!form) return;
    try { setErro(null); await salvarRegra(form); setForm(null); onMudou(); } catch (e) { setErro((e as Error).message); }
  }

  const fmt = (v: number | null, pct?: boolean) => (v == null ? "—" : pct ? `${String(v).replace(".", ",")}%` : brl(v));
  return (
    <div className="space-y-3">
      <Aviso tom="aviso">
        Valor fixo por R.R (só SDR) e por venda de Expedição; percentual do valor da venda para Aéreo e Pacote. Outros tipos (Seguro, Passeios,
        Hospedagem…) e venda sem tipo ficam em R$ 0,00 — ajuste o card com motivo. A regra que vale é a mais nova com vigência até a data da
        venda (ou da R.R). Exceção por pessoa: campo vazio usa a regra geral. Mês já fechado nunca muda.
      </Aviso>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="primary" onClick={() => setForm(vazioRegra("sdr"))}>Nova regra de SDR</Button>
        <Button size="sm" variant="primary" onClick={() => setForm(vazioRegra("closer"))}>Nova regra de closer</Button>
      </div>
      {(["sdr", "closer"] as Papel[]).map((p) => (
        <div key={p} className="qs-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead style={{ background: "var(--card2)" }}>
              <tr>{[p === "sdr" ? "SDR" : "Closer", "Vale desde", ...(p === "sdr" ? ["Por R.R"] : []), "Por Expedição", "% Aéreo", "% Pacote", "Obs.", ""].map((h) => (
                <th key={h} style={{ padding: "8px 10px", fontSize: 11.5, textAlign: "left", color: "var(--ink2)" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {regras.filter((r) => r.papel === p).map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)", fontWeight: 600 }}>{r.pessoa_id ? `Exceção: ${nomeDe(r.pessoa_id)}` : "Geral"}</td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{dataBr(r.vigente_desde)}</td>
                  {p === "sdr" && <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{fmt(r.valor_rr)}</td>}
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{fmt(r.valor_expedicao)}</td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{fmt(r.pct_aereo, true)}</td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)" }}>{fmt(r.pct_pacote, true)}</td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--ink3)" }}>{r.obs ?? ""}</td>
                  <td style={{ padding: "8px 10px", borderTop: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...r, obs: r.obs ?? null })}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Apagar esta regra? Meses em aberto passam a usar a regra anterior.")) void apagarRegra(r.id!).then(onMudou).catch((e) => setErro(e.message)); }}>Apagar</Button>
                  </td>
                </tr>
              ))}
              {!regras.some((r) => r.papel === p) && <tr><td colSpan={8} style={{ padding: 16, color: "var(--ink3)", fontSize: 13 }}>Nenhuma regra de {p === "sdr" ? "SDR" : "closer"} ainda: tudo sai R$ 0,00.</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
      {form && (
        <Modal aberto titulo={`${form.id ? "Editar" : "Nova"} regra de ${form.papel === "sdr" ? "SDR" : "closer"}`} onFechar={() => setForm(null)}
          rodape={<><Button onClick={() => setForm(null)}>Cancelar</Button><Button variant="primary" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(form.vigente_desde)} onClick={() => void salvar()}>Salvar</Button></>}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo rotulo="Para quem">
              <select className="rel-input" value={form.pessoa_id ?? ""} onChange={(e) => setForm({ ...form, pessoa_id: e.target.value || null })}>
                <option value="">Todos ({form.papel === "sdr" ? "regra geral de SDR" : "regra geral de closer"})</option>
                {vendedores.map((p) => <option key={p.id} value={p.id}>Exceção: {p.name}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Vale a partir de" dica="Não reescreve meses já fechados.">
              <Entrada type="date" value={form.vigente_desde} onChange={(e) => setForm({ ...form, vigente_desde: e.target.value })} />
            </Campo>
            {form.papel === "sdr" && (
              <Campo rotulo="Valor fixo por R.R (R$)"><Entrada inputMode="decimal" value={campoNum(form.valor_rr)} onChange={(e) => setForm({ ...form, valor_rr: lerNum(e.target.value) })} /></Campo>
            )}
            <Campo rotulo="Valor fixo por venda de Expedição (R$)"><Entrada inputMode="decimal" value={campoNum(form.valor_expedicao)} onChange={(e) => setForm({ ...form, valor_expedicao: lerNum(e.target.value) })} /></Campo>
            <Campo rotulo="% da venda de Aéreo"><Entrada inputMode="decimal" value={campoNum(form.pct_aereo)} onChange={(e) => setForm({ ...form, pct_aereo: lerNum(e.target.value) })} /></Campo>
            <Campo rotulo="% da venda de Pacote"><Entrada inputMode="decimal" value={campoNum(form.pct_pacote)} onChange={(e) => setForm({ ...form, pct_pacote: lerNum(e.target.value) })} /></Campo>
            <div className="sm:col-span-2">
              <Campo rotulo="Observação"><Entrada value={form.obs ?? ""} onChange={(e) => setForm({ ...form, obs: e.target.value || null })} placeholder="Ex.: planilha do Bruno de 06/11" /></Campo>
            </div>
          </div>
          {form.pessoa_id && <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Na exceção, deixe vazio o campo que deve seguir a regra geral.</p>}
        </Modal>
      )}
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
