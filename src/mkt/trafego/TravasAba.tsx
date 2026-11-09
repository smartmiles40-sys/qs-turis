// src/mkt/trafego/TravasAba.tsx — as travas (0265).
// "Desligar campanha se o custo por reunião passar do valor que a gente
// estipular, idem agendamento, CAC…". Toda trava nasce SÓ AVISANDO; pausar é
// escolha explícita por trava — e só pausa de verdade com a chave geral
// (MKT_TRAFEGO_PAUSA_LIGADA) ligada no servidor. Sem ela: "pausaria" no histórico.
import { useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal, Vazio } from "@/rel/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useTrafego } from "./MetaAdsPage";
import { apagarRegra, ligarRegra, salvarRegra, type RegraNova } from "./api";
import { NOME_METRICA, type Escopo, type Metrica, type Regra } from "./tipos";
import { brl, ChipSituacao, pct } from "./ui";
import { lerValor } from "./VerbaAba";

const EM_PCT: Metrica[] = ["verba_pct"];
const PRECISA_UTM: Metrica[] = ["custo_agendamento", "custo_reuniao", "cac"];
const COM_MINIMO: Metrica[] = ["cpl", "custo_agendamento", "custo_reuniao", "cac"];

const MODELOS: { rotulo: string; r: Partial<RegraNova> }[] = [
  { rotulo: "Custo por reunião passou de R$ 600", r: { nome: "Custo por reunião", metrica: "custo_reuniao", limite: 600, gasto_minimo: 1500 } },
  { rotulo: "Custo por agendamento passou de R$ 250", r: { nome: "Custo por agendamento", metrica: "custo_agendamento", limite: 250, gasto_minimo: 800 } },
  { rotulo: "CAC passou de R$ 3.000", r: { nome: "CAC", metrica: "cac", limite: 3000, gasto_minimo: 4000 } },
  { rotulo: "CPL passou de R$ 40", r: { nome: "CPL", metrica: "cpl", limite: 40, gasto_minimo: 300 } },
  { rotulo: "Gastou R$ 300 sem nenhum lead em 6 h", r: { nome: "Gasto sem lead", metrica: "sem_lead", limite: 300, horas: 6 } },
  { rotulo: "Gasto do dia passou de R$ 1.200", r: { nome: "Teto do dia", metrica: "gasto_dia", limite: 1200 } },
];

export function descreverValor(m: Metrica, v: number | null) {
  if (v == null) return "—";
  return EM_PCT.includes(m) ? pct(v, 1) : brl(v, 2);
}

export default function TravasAba() {
  const { painel, recarregar } = useTrafego();
  const [editando, setEditando] = useState<Regra | "nova" | null>(null);
  if (!painel || painel.faltaBanco) return null;
  const regras = painel.regras ?? [];
  const pode = !!painel.podeEditar;

  async function alternar(r: Regra) {
    try { await ligarRegra(r.id, !r.ativa); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não mudou."); }
  }
  async function apagar(r: Regra) {
    if (!confirm(`Apagar a trava "${r.nome}"? O histórico dela fica.`)) return;
    try { await apagarRegra(r.id); notifySuccess("Trava apagada."); await recarregar(); }
    catch (e) { notifyError(e instanceof Error ? e.message : "Não apagou."); }
  }

  return (
    <div className="flex flex-col gap-3">
      {painel.pausaLigada
        ? <Aviso tom="erro"><b>Pausa de verdade LIGADA</b> no servidor: trava em "pausar" desliga as campanhas ativas do escopo na Meta (o QS nunca reativa sozinho).</Aviso>
        : <Aviso tom="ok"><b>Modo simulação.</b> A chave geral MKT_TRAFEGO_PAUSA_LIGADA está desligada: trava em "pausar" só registra "pausaria" no histórico e avisa. Nada é desligado na Meta.</Aviso>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Avaliadas a cada 30 min, depois de cada leitura da Meta. Cada trava avisa no máximo uma vez por dia por situação.</p>
        {pode && <Botao variante="primario" onClick={() => setEditando("nova")}>+ Nova trava</Botao>}
      </div>

      {regras.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma trava ainda" texto="Ex.: avisar (ou pausar) quando o custo por reunião passar de R$ 600 depois de gastar pelo menos R$ 1.500." acao={pode ? <Botao variante="primario" onClick={() => setEditando("nova")}>Criar trava</Botao> : undefined} /></div>
      ) : (
        <ul className="flex flex-col gap-2">
          {regras.map((r) => {
            const a = r.avaliacao;
            return (
              <li key={r.id} className="rel-card px-4 py-3" style={{ opacity: r.ativa ? 1 : 0.6 }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                      {r.nome} <ChipSituacao s={a.situacao} />
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={r.acao === "pausar" ? { background: "var(--err-bg)", color: "var(--err-ink)" } : { background: "var(--card2)", color: "var(--ink2)" }}>
                        {r.acao === "pausar" ? "Pausa" : "Só avisa"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink3)" }}>
                      {NOME_METRICA[r.metrica]}{r.metrica === "sem_lead" ? ` (${r.horas} h)` : ""} {r.metrica === "sem_lead" ? "≥" : ">"} {descreverValor(r.metrica, Number(r.limite))}
                      {" · "}{r.escopo === "periodo" ? "período inteiro" : r.escopo === "destino" ? `destino ${r.alvo_rotulo ?? r.alvo}` : `campanha ${r.alvo_rotulo ?? r.alvo}`}
                      {Number(r.gasto_minimo) > 0 ? ` · só julga depois de ${brl(Number(r.gasto_minimo))}` : ""}
                    </p>
                    <p className="mt-1 text-[13px]" style={{ color: "var(--ink2)" }}>
                      Agora: <b>{a.infinito ? "nenhum ainda" : descreverValor(r.metrica, a.valor)}</b> — {a.texto}
                      {r.acaoAgora === "pausaria" && <> · <b>pausaria {r.alvosAtivos.length} campanha(s)</b></>}
                      {r.acaoAgora === "pausar" && <> · <b style={{ color: "var(--err-ink)" }}>vai pausar {r.alvosAtivos.length} campanha(s) na próxima rodada</b></>}
                    </p>
                  </div>
                  {pode && (
                    <div className="flex shrink-0 gap-1">
                      <Botao variante="fantasma" onClick={() => void alternar(r)}>{r.ativa ? "Desligar" : "Ligar"}</Botao>
                      <Botao variante="secundario" onClick={() => setEditando(r)}>Editar</Botao>
                      <Botao variante="fantasma" onClick={() => void apagar(r)} aria-label={`Apagar ${r.nome}`}>Apagar</Botao>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editando && <EditorRegra inicial={editando === "nova" ? null : editando} onFechar={() => setEditando(null)} onSalvo={async () => { setEditando(null); await recarregar(); }} />}
    </div>
  );
}

function EditorRegra({ inicial, onFechar, onSalvo }: { inicial: Regra | null; onFechar: () => void; onSalvo: () => void }) {
  const { painel } = useTrafego();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [escopo, setEscopo] = useState<Escopo>(inicial?.escopo ?? "periodo");
  const [alvo, setAlvo] = useState(inicial?.alvo ?? "");
  const [metrica, setMetrica] = useState<Metrica>(inicial?.metrica ?? "custo_reuniao");
  const [limite, setLimite] = useState(inicial ? String(inicial.limite).replace(".", ",") : "");
  const [minimo, setMinimo] = useState(inicial ? String(inicial.gasto_minimo).replace(".", ",") : "0");
  const [horas, setHoras] = useState(String(inicial?.horas ?? 6));
  const [acao, setAcao] = useState<"avisar" | "pausar">(inicial?.acao ?? "avisar");
  const [ativa, setAtiva] = useState(inicial?.ativa ?? true);
  const [periodoId, setPeriodoId] = useState<string>(inicial?.periodo_id ?? "");
  const [salvando, setSalvando] = useState(false);

  const destinos = painel?.destinos ?? [];
  const campanhas = (painel?.campanhas ?? []).filter((c) => c.effective_status === "ACTIVE" || c.gasto > 0);
  const lim = lerValor(limite);
  const min = lerValor(minimo) || 0;
  const ok = nome.trim().length >= 2 && lim > 0 && (escopo === "periodo" || !!alvo) && (metrica !== "sem_lead" || (+horas >= 1 && +horas <= 72));
  const rotuloAlvo = escopo === "destino" ? destinos.find((d) => d.chave === alvo)?.rotulo ?? alvo : escopo === "campanha" ? campanhas.find((c) => c.id === alvo)?.nome ?? alvo : null;

  function modelo(i: number) {
    const m = MODELOS[i]?.r;
    if (!m) return;
    if (m.nome) setNome(m.nome);
    if (m.metrica) setMetrica(m.metrica);
    if (m.limite != null) setLimite(String(m.limite));
    setMinimo(String(m.gasto_minimo ?? 0));
    if (m.horas) setHoras(String(m.horas));
  }

  async function salvar() {
    setSalvando(true);
    try {
      await salvarRegra({
        id: inicial?.id, nome: nome.trim(), ativa, periodo_id: periodoId || null, escopo,
        alvo: escopo === "periodo" ? null : alvo, alvo_rotulo: rotuloAlvo,
        metrica, limite: lim, gasto_minimo: COM_MINIMO.includes(metrica) ? min : 0,
        horas: metrica === "sem_lead" ? Math.round(+horas) : null, acao,
      });
      notifySuccess("Trava salva."); onSalvo();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={inicial ? `Trava · ${inicial.nome}` : "Nova trava"} onFechar={onFechar} largura={640}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Fechar</Botao><Botao variante="primario" disabled={!ok || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="flex flex-col gap-3">
        {!inicial && (
          <Campo rotulo="Começar de um modelo (opcional)">
            <select className="rel-input" defaultValue="" onChange={(e) => modelo(Number(e.target.value))}>
              <option value="" disabled>Escolha…</option>
              {MODELOS.map((m, i) => <option key={i} value={i}>{m.rotulo}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Custo por reunião — Tailândia" /></Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Vale para">
            <select className="rel-input" value={escopo} onChange={(e) => { setEscopo(e.target.value as Escopo); setAlvo(""); }}>
              <option value="periodo">O período inteiro (todas as campanhas)</option>
              <option value="destino">Um destino</option>
              <option value="campanha">Uma campanha</option>
            </select>
          </Campo>
          {escopo !== "periodo" && (
            <Campo rotulo={escopo === "destino" ? "Destino" : "Campanha"}>
              <select className="rel-input" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
                <option value="">Escolha…</option>
                {escopo === "destino" ? destinos.map((d) => <option key={d.chave} value={d.chave}>{d.rotulo}</option>)
                  : campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <Campo rotulo="Medida">
            <select className="rel-input" value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)}>
              {(Object.keys(NOME_METRICA) as Metrica[]).map((m) => <option key={m} value={m}>{NOME_METRICA[m]}</option>)}
            </select>
          </Campo>
          <Campo rotulo={metrica === "verba_pct" ? "Limite (%)" : metrica === "sem_lead" ? "Gastou (R$)" : "Limite (R$)"} dica={metrica === "verba_pct" ? "100 = a verba toda; avisa antes em 80% disso" : undefined}>
            <Entrada inputMode="decimal" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder={metrica === "verba_pct" ? "100" : "600"} />
          </Campo>
        </div>
        {metrica === "sem_lead" && (
          <Campo rotulo="Nas últimas (horas)" dica="Lead aqui é o que a Meta conta (pixel/formulário). Se o pixel quebrar, esta trava também avisa."><Entrada type="number" min={1} max={72} value={horas} onChange={(e) => setHoras(e.target.value)} /></Campo>
        )}
        {COM_MINIMO.includes(metrica) && (
          <Campo rotulo="Gasto mínimo antes de julgar (R$)" dica="Com amostra pequena um custo alto é sorte/azar. Abaixo disso a trava espera.">
            <Entrada inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="1.500" />
          </Campo>
        )}
        {escopo === "campanha" && PRECISA_UTM.includes(metrica) && (
          <Aviso tom="aviso">Por campanha, agendamento/reunião/venda só existem quando o lead chega com utm_campaign. Sem UTM a trava fica "sem dado" e não age — use o escopo destino.</Aviso>
        )}

        {(painel?.periodos?.length ?? 0) > 0 && (
          <Campo rotulo="Período">
            <select className="rel-input" value={periodoId} onChange={(e) => setPeriodoId(e.target.value)}>
              <option value="">O período de verba de hoje (qualquer um)</option>
              {painel!.periodos!.map((p) => <option key={p.id} value={p.id}>Só {p.nome}</option>)}
            </select>
          </Campo>
        )}

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold" style={{ color: "var(--ink2)" }}>Quando passar do limite</legend>
          <label className="flex items-start gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
            <input type="radio" name="acao" checked={acao === "avisar"} onChange={() => setAcao("avisar")} className="mt-1" />
            <span><b>Só avisar</b> — aviso no sino de quem cuida do tráfego e registro no histórico.</span>
          </label>
          <label className="mt-1.5 flex items-start gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
            <input type="radio" name="acao" checked={acao === "pausar"} onChange={() => setAcao("pausar")} className="mt-1" />
            <span><b>Pausar</b> todas as campanhas ATIVAS do escopo na Meta (e avisar). O QS nunca reativa sozinho: reativar é pelo histórico, com confirmação.</span>
          </label>
          {acao === "pausar" && !painel?.pausaLigada && <p className="mt-1.5 text-[12px]" style={{ color: "var(--warn-ink)" }}>A chave geral está desligada: por enquanto vira "pausaria" (simulação) no histórico.</p>}
        </fieldset>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} /> Ligada
        </label>
      </div>
    </Modal>
  );
}
