// src/rel/viagens/VoosDaViagem.tsx
// -----------------------------------------------------------------------------
// VOOS E CHECK-INS DA VIAGEM + CORREÇÃO MANUAL (30/10/2026, Bruno).
//   "ver realmente o que tem de VOO … quando TEM voo interno e quando NÃO tem …
//    fazer todos os CHECK-INs … quando estiver 'em viagem', tem que estar
//    acontecendo de verdade … o supervisor tem que conseguir CORRIGIR as
//    inconsistências pela tela".
//
// Numa olhada: o status REAL (pelos voos) e se foi forçado, o próximo voo, se
// tem voo interno (sim/não, quantos), os check-ins a fazer, a linha do tempo de
// TODOS os voos com o estado de cada um (a voar / check-in a fazer / check-in
// feito / voado / cancelado) e o papel (ida, interno, volta, nacional de conexão).
// Voo que não vale (fora das datas, data genérica do Bitrix, repetido) aparece
// apagado e com o porquê — nunca vira "próximo voo".
//
// Quem pode editar viagens corrige pela tela (0227): data/rota/nº do trecho,
// voado/cancelado, datas da viagem, status forçado com motivo, ignorar alerta —
// tudo no histórico (quem, quando, antes → depois) e com "Desfazer".
// Regras: src/rel/lib/statusViagem.ts. Sem a 0227, mostra e avisa.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { FASES, TIPOS_TRECHO, type Trecho, type Viagem } from "../lib/viagens";
import {
  codigoDe, resumirVoos,
  type FaseReal, type Inconsistencia,
} from "../lib/statusViagem";
import {
  ROTULO_ACAO, correcaoDisponivel, correcoesDaViagem, corrigirDatas, corrigirTrecho, desfazerCorrecao,
  ignorarAlerta, oQueMudou, situacaoDoTrecho, statusManual, type CamposTrecho, type Correcao,
} from "../lib/correcoes";
import { usePode } from "../equipe/usePode";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

const TOM_NIVEL = { alta: "erro", media: "aviso", info: "neutro" } as const;
const BR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");

const rota = (t: Trecho) => `${codigoDe(t.origem_codigo, t.origem) || t.origem || "?"} → ${codigoDe(t.destino_codigo, t.destino) || t.destino || "?"}`;

/** "2026-11-13T20:40" na hora LOCAL do fuso (o que está no bilhete). */
function paraLocal(iso: string | null | undefined, fuso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(fuso || "-03:00") ?? ["", "-", "03", "00"];
  const min = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return new Date(new Date(iso).getTime() + min * 60_000).toISOString().slice(0, 16);
}
const deLocal = (v: string, fuso: string | null | undefined) => (v ? new Date(`${v}:00${/^[+-]\d{2}:\d{2}$/.test(fuso || "") ? fuso : "-03:00"}`).toISOString() : null);

// ── modal: pedir o motivo ───────────────────────────────────────────────────
export function PedirMotivo({ titulo, explicacao, onConfirmar, onFechar, exigir = true, children }: {
  titulo: string; explicacao: string; exigir?: boolean; onConfirmar: (motivo: string) => Promise<void>; onFechar: () => void; children?: React.ReactNode;
}) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const ok = async () => {
    if (exigir && !motivo.trim()) { setErro("Diga o motivo — fica no histórico da viagem."); return; }
    setSalvando(true); setErro(null);
    try { await onConfirmar(motivo.trim()); onFechar(); } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); } finally { setSalvando(false); }
  };
  return (
    <Modal aberto titulo={titulo} onFechar={onFechar} rodape={<><Botao onClick={onFechar}>Voltar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void ok()}>{salvando ? "Salvando…" : "Confirmar"}</Botao></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{explicacao}</p>
        {children}
        <Campo rotulo={exigir ? "Motivo (obrigatório)" : "Motivo (opcional)"}>
          <textarea className="rel-input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Ex.: data do card do Pós-Venda é de outra viagem" />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── modal: corrigir um trecho ───────────────────────────────────────────────
export function CorrigirTrecho({ t, onFechar, onSalvo }: { t: Trecho; onFechar: () => void; onSalvo: () => void }) {
  const [f, setF] = useState({
    tipo: t.tipo, partida: paraLocal(t.partida_em, t.partida_fuso), chegada: paraLocal(t.chegada_em, t.chegada_fuso || t.partida_fuso),
    partida_fuso: t.partida_fuso ?? "", chegada_fuso: t.chegada_fuso ?? "", origem: t.origem ?? "", destino: t.destino ?? "",
    numero: t.numero ?? "", companhia: t.companhia ?? "", localizador: t.localizador ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async (motivo: string) => {
    const novo: CamposTrecho = {
      tipo: f.tipo, partida_em: deLocal(f.partida, f.partida_fuso) ?? t.partida_em, chegada_em: deLocal(f.chegada, f.chegada_fuso || f.partida_fuso),
      partida_fuso: f.partida_fuso || null, chegada_fuso: f.chegada_fuso || null, origem: f.origem || null, destino: f.destino || null,
      numero: f.numero || null, companhia: f.companhia || null, localizador: f.localizador || null,
    };
    // manda só o que mudou (o histórico fica limpo)
    const atual: Record<string, unknown> = { ...t };
    const campos = Object.fromEntries(Object.entries(novo).filter(([k, v]) => {
      const a = atual[k] ?? null;
      if (k.endsWith("_em") && a && v) return new Date(String(a)).getTime() !== new Date(String(v)).getTime();
      return (a ?? null) !== (v ?? null);
    })) as CamposTrecho;
    if (!Object.keys(campos).length) throw new Error("Nada mudou.");
    await corrigirTrecho(t.id, campos, motivo);
    onSalvo();
  };
  return (
    <PedirMotivo titulo="Corrigir trecho" onFechar={onFechar} onConfirmar={salvar}
      explicacao="A correção fica no histórico (com o valor anterior) e a sincronização do Bitrix, das Expedições e a IA não mexem mais neste trecho.">
      <div className="grid grid-cols-2 gap-2">
        <Campo rotulo="Tipo">
          <select className="rel-input" value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>
            <option value="voo_internacional">{TIPOS_TRECHO.voo_internacional}</option>
            <option value="voo_interno">{TIPOS_TRECHO.voo_interno}</option>
          </select>
        </Campo>
        <Campo rotulo="Nº do voo"><Entrada value={f.numero} onChange={(e) => set("numero", e.target.value)} placeholder="AZ 675" /></Campo>
        <Campo rotulo="Partida (hora local)"><Entrada type="datetime-local" value={f.partida} onChange={(e) => set("partida", e.target.value)} /></Campo>
        <Campo rotulo="Fuso da partida" dica="ex.: +09:00 (vazio = Brasília)"><Entrada value={f.partida_fuso} onChange={(e) => set("partida_fuso", e.target.value)} placeholder="-03:00" /></Campo>
        <Campo rotulo="Chegada (hora local)"><Entrada type="datetime-local" value={f.chegada} onChange={(e) => set("chegada", e.target.value)} /></Campo>
        <Campo rotulo="Fuso da chegada"><Entrada value={f.chegada_fuso} onChange={(e) => set("chegada_fuso", e.target.value)} placeholder="-03:00" /></Campo>
        <Campo rotulo="Origem"><Entrada value={f.origem} onChange={(e) => set("origem", e.target.value)} placeholder="São Paulo (GRU)" /></Campo>
        <Campo rotulo="Destino"><Entrada value={f.destino} onChange={(e) => set("destino", e.target.value)} placeholder="Roma (FCO)" /></Campo>
        <Campo rotulo="Companhia"><Entrada value={f.companhia} onChange={(e) => set("companhia", e.target.value)} /></Campo>
        <Campo rotulo="Localizador"><Entrada value={f.localizador} onChange={(e) => set("localizador", e.target.value)} /></Campo>
      </div>
    </PedirMotivo>
  );
}

type Acao =
  | { tipo: "corrigir"; t: Trecho }
  | { tipo: "situacao"; t: Trecho; situacao: "voado" | "cancelado" | null }
  | { tipo: "ignorar"; i: Inconsistencia; ignorar: boolean }
  | { tipo: "status"; fase: Exclude<FaseReal, "cancelada" | "sem_data"> | null }
  | { tipo: "datas" };

export default function VoosDaViagem({ v, trechos, onMudou }: { v: Viagem; trechos: Trecho[] | null; onMudou: () => void }) {
  const podeEditar = usePode("relacionamento.editar_viagens") === true;
  const disponivel = correcaoDisponivel(v);
  const pode = podeEditar && disponivel;
  const [acao, setAcao] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [hist, setHist] = useState<Correcao[]>([]);
  const [verHist, setVerHist] = useState(false);
  const [faseNova, setFaseNova] = useState<"antes" | "em_viagem" | "concluida">("antes");
  const [ate, setAte] = useState("");
  const [datas, setDatas] = useState({ ida: v.data_embarque ?? "", volta: v.data_retorno ?? "" });

  const carregarHist = useCallback(() => {
    if (!disponivel) return;
    correcoesDaViagem(v.id).then(setHist).catch(() => setHist([]));
  }, [v.id, disponivel]);
  useEffect(() => { carregarHist(); }, [carregarHist, trechos]);
  useEffect(() => { setDatas({ ida: v.data_embarque ?? "", volta: v.data_retorno ?? "" }); }, [v.data_embarque, v.data_retorno]);

  const r = useMemo(() => resumirVoos({
    data_embarque: v.data_embarque, data_retorno: v.data_retorno, status: v.status, titulo: v.titulo, expedicao: v.expedicao, servico: v.servico,
    fase_manual: v.fase_manual ?? null, fase_manual_motivo: v.fase_manual_motivo ?? null, fase_manual_ate: v.fase_manual_ate ?? null,
    alertas_ignorados: v.alertas_ignorados ?? null,
  }, trechos ?? []), [v, trechos]);

  const mudou = () => { carregarHist(); onMudou(); };
  const rodar = async (fn: () => Promise<void>) => { setErro(null); try { await fn(); mudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); } };

  if (trechos === null) return <section className="rel-card p-4 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando os voos…</section>;

  const abertas = r.inconsistencias.filter((i) => !i.ignorada);
  const ignoradas = r.inconsistencias.filter((i) => i.ignorada);
  // a fase da tela (view) × a calculada aqui: sem a 0227 a view ainda usa a régua antiga
  const divergeDaView = v.fase !== r.fase && v.status === "ativa" && !(v.fase === "sem_data" && r.fase === "sem_data");
  // desfazer: só a correção mais recente (valendo) de cada item
  const ultimaPorItem = new Set<string>();
  const vistos = new Set<string>();
  // 0310: a conferência ("Conferi ✓") não restaura nada — cada uma se desfaz sozinha e não trava as outras
  for (const c of hist) {
    if (c.desfeita_em) continue;
    if (c.acao === "trecho_conferido") { ultimaPorItem.add(c.id); continue; }
    const k = c.trecho_id ?? "viagem"; if (vistos.has(k)) continue; vistos.add(k); ultimaPorItem.add(c.id);
  }

  return (
    // 24/11 (Bruno: "os voos aparecem em 4 lugares"): a lista de voos e os check-ins moram SÓ no Roteiro.
    // Aqui fica o que não é de um voo: alertas que não batem, status forçado, datas da viagem e o histórico.
    // 24/11 (Bruno): mora no LÁPIS do cabeçalho da ficha (abre num modal)
    <div className="space-y-3" aria-label="Ajustes da viagem">
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        Status pelos voos: <b style={{ color: "var(--ink)" }}>{FASES[r.fase]}</b>{r.faseManual ? " (forçado à mão)" : ""}.
        {!disponivel && podeEditar && " Correção pela tela chega com a migration 0227."}
      </p>

      {divergeDaView && (
        <Aviso>A lista mostra esta viagem como <b>{FASES[v.fase]}</b>, mas pelos voos ela está <b>{FASES[r.fase]}</b>{!disponivel ? " (a régua nova entra com a migration 0227)" : ""}.</Aviso>
      )}

      {/* inconsistências */}
      {abertas.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Não bate · {abertas.length}</p>
          {abertas.map((i) => (
            <div key={i.chave} className="flex flex-wrap items-start justify-between gap-2 rounded-lg px-3 py-2" style={{ border: "1px solid var(--line)" }}>
              <div className="min-w-0">
                <Etiqueta tom={TOM_NIVEL[i.nivel]}>{i.nivel === "alta" ? "urgente" : i.nivel === "media" ? "conferir" : "info"}</Etiqueta>{" "}
                <b className="text-[13px]" style={{ color: "var(--ink)" }}>{i.titulo}</b>
                <p className="text-[12px]" style={{ color: "var(--ink2)" }}>{i.detalhe}</p>
              </div>
              {pode && <Botao variante="fantasma" onClick={() => setAcao({ tipo: "ignorar", i, ignorar: true })}>Ignorar alerta</Botao>}
            </div>
          ))}
        </div>
      )}
      {ignoradas.length > 0 && (
        <details className="text-[12px]" style={{ color: "var(--ink3)" }}>
          <summary className="cursor-pointer">{ignoradas.length} alerta(s) ignorado(s)</summary>
          {ignoradas.map((i) => (
            <div key={i.chave} className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span><s>{i.titulo}</s> — {i.ignorada?.motivo || "sem motivo"}</span>
              {pode && <Botao variante="fantasma" onClick={() => setAcao({ tipo: "ignorar", i, ignorar: false })}>Voltar a mostrar</Botao>}
            </div>
          ))}
        </details>
      )}

      {/* supervisor: status e datas da viagem */}
      {pode && (
        <div className="flex flex-wrap items-end gap-2 pt-2" style={{ borderTop: "1px solid var(--line)" }}>
          <Campo rotulo="Forçar o status">
            <select className="rel-input" value={faseNova} onChange={(e) => setFaseNova(e.target.value as typeof faseNova)}>
              <option value="antes">{FASES.antes}</option>
              <option value="em_viagem">{FASES.em_viagem}</option>
              <option value="concluida">{FASES.concluida}</option>
            </select>
          </Campo>
          <Campo rotulo="Até (opcional)"><Entrada type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
          <Botao onClick={() => setAcao({ tipo: "status", fase: faseNova })}>Forçar status</Botao>
          {v.fase_manual && <Botao variante="fantasma" onClick={() => setAcao({ tipo: "status", fase: null })}>Voltar ao automático</Botao>}
          <span className="flex-1" />
          <Campo rotulo="Ida"><Entrada type="date" value={datas.ida} onChange={(e) => setDatas((d) => ({ ...d, ida: e.target.value }))} /></Campo>
          <Campo rotulo="Volta"><Entrada type="date" value={datas.volta} onChange={(e) => setDatas((d) => ({ ...d, volta: e.target.value }))} /></Campo>
          <Botao disabled={datas.ida === (v.data_embarque ?? "") && datas.volta === (v.data_retorno ?? "")} onClick={() => setAcao({ tipo: "datas" })}>Corrigir datas</Botao>
        </div>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {/* histórico */}
      {disponivel && hist.length > 0 && (
        <div>
          <button className="text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--ink2)" }} onClick={() => setVerHist((x) => !x)}>
            {verHist ? "Esconder" : "Ver"} o histórico de correções ({hist.length})
          </button>
          {verHist && (
            <ul className="mt-1.5 space-y-1">
              {hist.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: "var(--card2)", opacity: c.desfeita_em ? 0.6 : 1 }}>
                  <span className="min-w-0">
                    <b style={{ color: "var(--ink)" }}>{ROTULO_ACAO[c.acao] ?? c.acao}</b>
                    <span style={{ color: "var(--ink3)" }}> · {c.feito_por_nome || "alguém"} · {new Date(c.feito_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}</span>
                    <span className="block" style={{ color: "var(--ink2)" }}>{oQueMudou(c)}</span>
                    {c.motivo && <span className="block" style={{ color: "var(--ink3)" }}>motivo: {c.motivo}</span>}
                    {c.desfeita_em && <span className="block font-semibold" style={{ color: "var(--ink3)" }}>desfeita por {c.desfeita_por_nome || "alguém"} em {new Date(c.desfeita_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>}
                  </span>
                  {podeEditar && ultimaPorItem.has(c.id) && <Botao variante="fantasma" onClick={() => void rodar(() => desfazerCorrecao(c.id))}>Desfazer</Botao>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {acao?.tipo === "corrigir" && <CorrigirTrecho t={acao.t} onFechar={() => setAcao(null)} onSalvo={mudou} />}
      {acao?.tipo === "situacao" && (
        <PedirMotivo titulo={acao.situacao === "voado" ? "Marcar como voado" : acao.situacao === "cancelado" ? "Marcar como cancelado" : "Voltar ao automático"}
          exigir={acao.situacao !== null}
          explicacao={acao.situacao === "cancelado"
            ? `${rota(acao.t)} sai da conta: não é mais "próximo voo", não pede check-in e não decide se a viagem está acontecendo.`
            : acao.situacao === "voado" ? `${rota(acao.t)} passa a contar como feito (sai do "próximo voo").`
            : "A situação deste trecho volta a ser calculada pelo horário."}
          onFechar={() => setAcao(null)} onConfirmar={async (m) => { await situacaoDoTrecho(acao.t.id, acao.situacao, m); mudou(); }} />
      )}
      {acao?.tipo === "ignorar" && (
        <PedirMotivo titulo={acao.ignorar ? "Ignorar alerta" : "Voltar a mostrar o alerta"} exigir={acao.ignorar}
          explicacao={acao.ignorar ? `"${acao.i.titulo}" some desta viagem (fica no histórico, e dá pra voltar a mostrar).` : `"${acao.i.titulo}" volta a aparecer.`}
          onFechar={() => setAcao(null)} onConfirmar={async (m) => { await ignorarAlerta(v.id, acao.i.chave, m, acao.ignorar); mudou(); }} />
      )}
      {acao?.tipo === "status" && (
        <PedirMotivo titulo={acao.fase ? `Forçar "${FASES[acao.fase]}"` : "Voltar ao status automático"} exigir={acao.fase !== null}
          explicacao={acao.fase
            ? `A viagem fica como "${FASES[acao.fase]}" ${ate ? `até ${BR(ate)}` : "até alguém voltar ao automático"}, mesmo que os voos digam outra coisa. Pelos voos hoje: ${FASES[r.faseAuto]}.`
            : `Volta a valer o cálculo pelos voos (hoje: ${FASES[r.faseAuto]}).`}
          onFechar={() => setAcao(null)} onConfirmar={async (m) => { await statusManual(v.id, acao.fase, m, acao.fase ? ate || null : null); mudou(); }} />
      )}
      {acao?.tipo === "datas" && (
        <PedirMotivo titulo="Corrigir as datas da viagem"
          explicacao={`Ida ${BR(v.data_embarque)} → ${BR(datas.ida || null)} · volta ${BR(v.data_retorno)} → ${BR(datas.volta || null)}. As datas ficam travadas: a sincronização do Bitrix não volta com as antigas.`}
          onFechar={() => setAcao(null)} onConfirmar={async (m) => { await corrigirDatas(v.id, datas.ida || null, datas.volta || null, m); mudou(); }} />
      )}
    </div>
  );
}
