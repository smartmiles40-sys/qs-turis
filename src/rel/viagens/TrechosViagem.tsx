// src/rel/viagens/TrechosViagem.tsx
// -----------------------------------------------------------------------------
// TRECHOS da viagem (13/10): voos internacionais e internos, trens, transfers…
// Cada trecho tem hora de partida; voo abre CHECK-IN 48h antes e trem 24h
// (dá pra mudar a hora do check-in à mão). O check-in feito fica marcado —
// é isso que o painel e o calendário de Viagens mostram.
//
// Também aqui: o botão "Marcar viagem como revisada" (tudo conferido).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  TIPOS_TRECHO, apagarTrecho, criarTrecho, listarTrechos, marcarCheckin, marcarRevisada, revisoesDe, salvarTrecho,
  type Revisao, type TipoTrecho, type Trecho, type TrechoInput,
} from "../lib/viagens";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
// Trecho do Pós-Venda do Bitrix (0134b) só tem o DIA — a hora (00:00) é de mentira.
const soData = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" });

/** ISO (com fuso) → valor do <input type="datetime-local"> no horário do navegador. */
function paraInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const doInput = (v: string) => (v ? new Date(v).toISOString() : null);

const VAZIO = { tipo: "voo_internacional" as TipoTrecho, descricao: "", origem: "", destino: "", partida: "", chegada: "", companhia: "", numero: "", localizador: "", checkin: "" };

function EditarTrecho({ aberto, viagemId, trecho, onFechar, onSalvo }: {
  aberto: boolean; viagemId: string; trecho: Trecho | null; onFechar: () => void; onSalvo: () => void;
}) {
  const [f, setF] = useState(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setF(trecho ? {
      tipo: trecho.tipo, descricao: trecho.descricao ?? "", origem: trecho.origem ?? "", destino: trecho.destino ?? "",
      partida: paraInput(trecho.partida_em), chegada: paraInput(trecho.chegada_em), companhia: trecho.companhia ?? "",
      numero: trecho.numero ?? "", localizador: trecho.localizador ?? "", checkin: paraInput(trecho.checkin_abre_em),
    } : VAZIO);
  }, [aberto, trecho]);

  async function salvar() {
    if (!f.partida) { setErro("Informe a data e a hora da partida."); return; }
    if (f.chegada && f.chegada < f.partida) { setErro("A chegada não pode ser antes da partida."); return; }
    const dados: TrechoInput & { partida_em: string } = {
      tipo: f.tipo, descricao: f.descricao.trim() || null, origem: f.origem.trim() || null, destino: f.destino.trim() || null,
      partida_em: doInput(f.partida)!, chegada_em: doInput(f.chegada), companhia: f.companhia.trim() || null,
      numero: f.numero.trim().toUpperCase() || null, localizador: f.localizador.trim().toUpperCase() || null, checkin_abre_em: doInput(f.checkin),
    };
    setOcupado(true); setErro(null);
    try {
      if (trecho) await salvarTrecho(trecho.id, dados); else await criarTrecho(viagemId, dados);
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  const ehVoo = f.tipo === "voo_internacional" || f.tipo === "voo_interno";
  return (
    <Modal aberto={aberto} titulo={trecho ? "Editar trecho" : "Novo trecho"} onFechar={onFechar} largura={600}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Tipo">
            <select className="rel-input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoTrecho })}>
              {(Object.keys(TIPOS_TRECHO) as TipoTrecho[]).map((t) => <option key={t} value={t}>{TIPOS_TRECHO[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo={ehVoo ? "Companhia aérea" : "Empresa"}><Entrada value={f.companhia} onChange={(e) => setF({ ...f, companhia: e.target.value })} placeholder={ehVoo ? "Ex.: LATAM" : ""} /></Campo>
          <Campo rotulo="Saindo de"><Entrada value={f.origem} onChange={(e) => setF({ ...f, origem: e.target.value })} placeholder={ehVoo ? "Ex.: GRU" : ""} /></Campo>
          <Campo rotulo="Chegando em"><Entrada value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} placeholder={ehVoo ? "Ex.: NRT" : ""} /></Campo>
          <Campo rotulo="Partida * (horário de Brasília)" dica="Converta a hora local do bilhete para o horário de Brasília."><Entrada type="datetime-local" value={f.partida} onChange={(e) => setF({ ...f, partida: e.target.value })} /></Campo>
          <Campo rotulo="Chegada (horário de Brasília)"><Entrada type="datetime-local" value={f.chegada} onChange={(e) => setF({ ...f, chegada: e.target.value })} /></Campo>
          <Campo rotulo={ehVoo ? "Nº do voo" : "Número / código"}><Entrada value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} placeholder={ehVoo ? "Ex.: LA8070" : ""} /></Campo>
          <Campo rotulo="Localizador"><Entrada value={f.localizador} onChange={(e) => setF({ ...f, localizador: e.target.value })} placeholder="Ex.: ABC123" /></Campo>
        </div>
        <Campo rotulo="Check-in abre em (horário de Brasília)" dica={ehVoo ? "Vazio = 48h antes da partida (o padrão das companhias)." : f.tipo === "trem" ? "Vazio = 24h antes da partida." : "Vazio = sem check-in."}>
          <Entrada type="datetime-local" value={f.checkin} onChange={(e) => setF({ ...f, checkin: e.target.value })} />
        </Campo>
        <Campo rotulo="Observação"><Entrada value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: bagagem de 23 kg incluída" /></Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

export function TrechosViagem({ viagemId, ativa }: { viagemId: string; ativa: boolean }) {
  const { currentUser } = useQsAuth();
  const [lista, setLista] = useState<Trecho[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Trecho | null | undefined>(undefined); // undefined = fechado; null = novo

  const carregar = useCallback(() => {
    listarTrechos(viagemId).then((l) => { setLista(l); setErro(null); }).catch((e) => { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); });
  }, [viagemId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  const agora = Date.now();
  return (
    <div className="space-y-2">
      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum trecho ainda. Cadastre os voos (internacional e internos), trens e transfers — o check-in aparece sozinho no calendário.</p>
      ) : (
        <ul>
          {lista.map((t) => {
            const abre = t.checkin_em ? new Date(t.checkin_em).getTime() : null;
            const partiu = new Date(t.partida_em).getTime() < agora;
            const aberto = abre !== null && abre <= agora && !partiu;
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5" style={{ borderTop: "1px solid var(--line2)" }}>
                <div className="flex-1 min-w-[220px]">
                  <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                    {TIPOS_TRECHO[t.tipo]}{t.numero ? ` ${t.numero}` : ""}
                    {(t.origem || t.destino) && <span className="font-normal" style={{ color: "var(--ink2)" }}> · {[t.origem, t.destino].filter(Boolean).join(" → ")}</span>}
                    {t.fonte === "ia" && <span className="ml-2 align-middle"><Etiqueta tom="rel">lido pela IA</Etiqueta></span>}
                    {t.fonte === "expedicoes" && <span className="ml-2 align-middle"><Etiqueta>do sistema de Expedições</Etiqueta></span>}
                    {t.fonte === "bitrix" && <span className="ml-2 align-middle"><Etiqueta tom="aviso">do Pós-Venda · horário a confirmar</Etiqueta></span>}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                    {t.fonte === "bitrix" ? soData(t.partida_em) : dataHora(t.partida_em)}{t.chegada_em ? ` até ${dataHora(t.chegada_em)}` : ""}
                    {t.companhia ? ` · ${t.companhia}` : ""}{t.localizador ? ` · localizador ${t.localizador}` : ""}
                    {t.descricao ? ` · ${t.descricao}` : ""}
                  </p>
                </div>
                {t.checkin_em && (
                  t.checkin_feito_em
                    ? <Etiqueta tom="rel">check-in feito</Etiqueta>
                    : aberto ? <Etiqueta tom="aviso">check-in aberto</Etiqueta>
                    : !partiu ? <Etiqueta>check-in {dataHora(t.checkin_em)}</Etiqueta> : null
                )}
                {t.checkin_em && ativa && (
                  <label className="flex items-center gap-1.5 text-[12px] cursor-pointer py-1.5" style={{ color: "var(--ink2)" }}>
                    <input type="checkbox" className="w-4 h-4" style={{ accentColor: "var(--rel)" }} checked={!!t.checkin_feito_em} onChange={(e) => void acao(() => marcarCheckin(t.id, e.target.checked, currentUser?.id ?? ""))} />
                    check-in feito
                  </label>
                )}
                {ativa && <Botao variante="fantasma" onClick={() => setEditando(t)} aria-label={`Editar trecho ${TIPOS_TRECHO[t.tipo]}${t.numero ? ` ${t.numero}` : ""}`}>Editar</Botao>}
                {ativa && <Botao variante="fantasma" title="Apagar trecho" aria-label={`Apagar trecho ${TIPOS_TRECHO[t.tipo]}${t.numero ? ` ${t.numero}` : ""}`} onClick={() => { if (window.confirm("Apagar este trecho?")) void acao(() => apagarTrecho(t.id)); }}>×</Botao>}
              </li>
            );
          })}
        </ul>
      )}
      {ativa && <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setEditando(null)}>+ Trecho</Botao>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <EditarTrecho aberto={editando !== undefined} viagemId={viagemId} trecho={editando ?? null}
        onFechar={() => setEditando(undefined)} onSalvo={() => { setEditando(undefined); carregar(); }} />
    </div>
  );
}

// ── Revisão ─────────────────────────────────────────────────────────────────

export function RevisaoViagem({ viagemId, equipe }: { viagemId: string; equipe: { id: string; name: string }[] }) {
  const { currentUser } = useQsAuth();
  const [rev, setRev] = useState<Revisao | null>(null);
  const [aberto, setAberto] = useState(false);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    revisoesDe([viagemId]).then((m) => setRev(m.get(viagemId) ?? null)).catch(() => setRev(null));
  }, [viagemId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function gravar(revisada: boolean) {
    setOcupado(true); setErro(null);
    try { await marcarRevisada(viagemId, revisada, currentUser?.id ?? "", obs); setAberto(false); setObs(""); carregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  const quem = rev?.revisado_por ? equipe.find((u) => u.id === rev.revisado_por)?.name : null;
  return (
    <>
      {rev?.revisado_em ? (
        <div className="flex flex-wrap items-center gap-2">
          <Etiqueta tom="rel">Revisada em {new Date(rev.revisado_em).toLocaleDateString("pt-BR")}{quem ? ` por ${quem}` : ""}</Etiqueta>
          {rev.revisao_obs && <span className="text-[12px]" style={{ color: "var(--ink2)" }}>"{rev.revisao_obs}"</span>}
          <button className="text-[12px] underline py-1 disabled:opacity-50" style={{ color: "var(--ink2)" }} disabled={ocupado}
            onClick={() => { if (window.confirm("Desfazer a revisão? A viagem volta a aparecer como PENDENTE no painel.")) void gravar(false); }}>desfazer</button>
        </div>
      ) : (
        <Botao variante="primario" onClick={() => setAberto(true)}>Marcar viagem como revisada</Botao>
      )}
      {erro && !aberto && <Aviso tom="erro">{erro}</Aviso>}
      <Modal aberto={aberto} titulo="Marcar viagem como revisada" onFechar={() => setAberto(false)}
        rodape={<><Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao><Botao variante="primario" onClick={() => void gravar(true)} disabled={ocupado}>{ocupado ? "Salvando…" : "Confirmar revisão"}</Botao></>}>
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            Confirme que passageiros, documentos, voos, check-ins e reservas desta viagem foram conferidos. No painel ela passa a aparecer como <b>REVISADA ✓</b>.
          </p>
          <Campo rotulo="Observação (opcional)"><Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: tudo ok, falta só o seguro do acompanhante" /></Campo>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>
      </Modal>
    </>
  );
}
