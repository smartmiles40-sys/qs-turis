// src/prioridades/SeloPrioridade.tsx
// -----------------------------------------------------------------------------
// O SELO de prioridade (0226) nas listas de pacotes e na ficha da viagem, e o
// botão marcar/desmarcar. Igual no Relacionamento e em Operações.
// Sem a 0226 no banco, nada aparece (nem o botão).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { dataBR, grupoDe, type Viagem } from "@/rel/lib/viagens";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import {
  MOTIVOS, MOTIVO_CURTO, desmarcarPrioridade, doSetor, lerConfig, lerPrioridade, listarEquipeRelOps, marcarPrioridade, motivosSugeridos,
  nomeSugerido, paxEstimado, reais, tirarViagem, useSelos, viagensIrmas, CONFIG_PADRAO,
  type Config, type Motivo, type Pessoa, type Selo, type ViagemP,
} from "./lib";

const COR = { bg: "#FEE4E2", fg: "#B42318", borda: "#FDA29B" };
export const CSS_SELO = `
.pr-selo { display:inline-flex; align-items:center; gap:4px; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:700; white-space:nowrap;
  background:${COR.bg}; color:${COR.fg}; border:1px solid ${COR.borda}; }
html.dark .pr-selo { background: rgba(240, 68, 56, .16); color:#FDA29B; border-color: rgba(253, 162, 155, .4); }
`;
/** O CSS do selo entra UMA vez no <head> (a lista tem centenas de linhas). */
function garantirCss() {
  if (typeof document === "undefined" || document.getElementById("pr-selo-css")) return;
  const el = document.createElement("style");
  el.id = "pr-selo-css";
  el.textContent = CSS_SELO;
  document.head.appendChild(el);
}
garantirCss();

const Estrela = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
);

export const linkPainel = () => `#${window.location.hash.startsWith("#ops") ? "ops" : "rel"}/prioridades`;

function textoSelo(s: Selo) {
  const m = s.motivos.map((x) => MOTIVO_CURTO[x]).join(" · ");
  return m ? `Prioridade · ${m}` : "Prioridade";
}

/** Selo curto pras listas. Só aparece se a viagem está num acompanhamento ATIVO. */
export function SeloCurto({ viagemId }: { viagemId: string }) {
  const { mapa } = useSelos();
  const s = mapa.get(viagemId);
  if (!s?.ativo) return null;
  return (
    <span className="pr-selo" title={`${s.nome}${s.viagens > 1 ? ` · ${s.viagens} viagens no acompanhamento` : ""}`}>
      <Estrela />{textoSelo(s)}
    </span>
  );
}

/** Na ficha da viagem: selo + "Ver acompanhamento" / "Desmarcar", ou o botão "Marcar prioridade". */
export function SeloDaViagem({ v }: { v: Viagem }) {
  const { currentUser } = useQsAuth();
  const { mapa, carregado, semMigration } = useSelos();
  const [abrir, setAbrir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const s = mapa.get(v.id);
  if (!carregado || semMigration || !currentUser) return null;
  // marcar é pra pacote (expedição tem o acompanhamento dela); se já está marcada, o selo aparece sempre
  if (!s?.ativo && grupoDe(v) === "expedicao") return null;

  async function desmarcar() {
    if (!s || !currentUser) return;
    const soEsta = s.viagens > 1
      ? window.confirm(`"${s.nome}" tem ${s.viagens} viagens.\n\nOK = tirar só ESTA viagem do acompanhamento.\nCancelar = não mexer.`)
      : window.confirm(`Desmarcar a prioridade de "${s.nome}"? O histórico de checks fica guardado.`);
    if (!soEsta) return;
    setErro(null);
    try {
      if (s.viagens > 1) await tirarViagem(s.prioridadeId, v.id);
      else await desmarcarPrioridade(s.prioridadeId, currentUser.id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não desmarcou."); }
  }

  return (
    <>
      {s?.ativo ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="pr-selo" title={s.nome}><Estrela />{textoSelo(s)}{s.viagens > 1 ? ` · ${s.viagens} viagens` : ""}</span>
          <a href={linkPainel()} className="text-[12px] font-semibold underline" style={{ color: "var(--rel-ink)" }}>acompanhamento</a>
          <button type="button" className="text-[12px] underline" style={{ color: "var(--ink3)" }} onClick={() => void desmarcar()}>desmarcar</button>
        </span>
      ) : (
        <button type="button" onClick={() => setAbrir(true)} className="pr-selo" style={{ background: "transparent", cursor: "pointer" }}
          title="Marcar como pacote prioritário (VIP, influenciador, grupo grande…)">
          <Estrela />Marcar prioridade
        </button>
      )}
      {erro && <span className="text-[12px]" style={{ color: "var(--err-ink)" }}>{erro}</span>}
      {abrir && <MarcarPrioridade viagem={v} existenteId={s?.prioridadeId ?? null} onFechar={() => setAbrir(false)} />}
    </>
  );
}

/**
 * Marcar como prioridade. O sistema SUGERE (grupo grande pelo N da config, VIP
 * pelo valor) e oferece juntar as viagens com a MESMA ida e volta — mas quem
 * decide é a pessoa: nada vem marcado sozinho.
 */
export function MarcarPrioridade({ viagem, existenteId, juntarIds, onFechar, onMarcou }: {
  viagem: ViagemP | Viagem; existenteId?: string | null;
  /** já vem com estas viagens irmãs marcadas (a sugestão do painel, que a pessoa conferiu) */
  juntarIds?: string[];
  onFechar: () => void; onMarcou?: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const [config, setConfig] = useState<Config>(CONFIG_PADRAO);
  const [irmas, setIrmas] = useState<ViagemP[] | null>(null);
  const [juntar, setJuntar] = useState<Set<string>>(() => new Set(juntarIds ?? []));
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [nome, setNome] = useState("");
  const [motivos, setMotivos] = useState<Set<Motivo>>(new Set());
  const [outro, setOutro] = useState("");
  const [obs, setObs] = useState("");
  const [respRel, setRespRel] = useState<string>("");
  const [respOps, setRespOps] = useState<string>("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    lerConfig().then(setConfig).catch(() => undefined);
    listarEquipeRelOps().then(setPessoas).catch(() => setPessoas([]));
    viagensIrmas(viagem).then(setIrmas).catch(() => setIrmas([]));
    // já foi prioridade (desmarcada)? volta com o que tinha
    if (existenteId) lerPrioridade(existenteId).then((r) => {
      if (!r) return;
      setNome(r.p.nome); setMotivos(new Set(r.p.motivos)); setOutro(r.p.motivo_outro ?? ""); setObs(r.p.observacoes ?? "");
      setRespRel(r.p.resp_rel_id ?? ""); setRespOps(r.p.resp_ops_id ?? "");
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viagem.id, viagem.data_embarque, viagem.data_retorno, existenteId]);

  const selecionadas = useMemo(() => [viagem as ViagemP, ...(irmas ?? []).filter((x) => juntar.has(x.id))], [viagem, irmas, juntar]);
  const sugestoes = useMemo(() => motivosSugeridos(selecionadas, config), [selecionadas, config]);
  const pax = paxEstimado(selecionadas);
  const nomeFinal = nome.trim() || nomeSugerido(selecionadas);

  const alterna = (m: Motivo) => setMotivos((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  const alternaIrma = (id: string) => setJuntar((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function salvar() {
    if (!currentUser) return;
    if (!motivos.size) { setErro("Escolha pelo menos um motivo."); return; }
    if (motivos.has("outro") && !outro.trim()) { setErro("Escreva qual é o outro motivo."); return; }
    setSalvando(true); setErro(null);
    try {
      const id = await marcarPrioridade({
        nome: nomeFinal, motivos: [...motivos], motivo_outro: motivos.has("outro") ? outro.trim() : null,
        observacoes: obs.trim() || null, resp_rel_id: respRel || null, resp_ops_id: respOps || null,
      }, selecionadas.map((x) => x.id), currentUser.id, existenteId);
      onMarcou?.(id);
      onFechar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não marcou."); setSalvando(false); }
  }

  return (
    <Modal aberto titulo="Marcar como prioridade" onFechar={onFechar} largura={620}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Marcando…" : "Marcar prioridade"}</Botao></>}>
      <div className="space-y-4">
        <Campo rotulo="Nome do acompanhamento" dica="Como o time vai achar no painel. Em branco, usa a sugestão.">
          <Entrada value={nome} placeholder={nomeSugerido(selecionadas)} onChange={(e) => setNome(e.target.value)} maxLength={200} />
        </Campo>

        <fieldset>
          <legend className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Por que é prioridade?</legend>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {(Object.keys(MOTIVOS) as Motivo[]).map((m) => {
              const sug = sugestoes.find((s) => s.motivo === m);
              return (
                <label key={m} className="flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer" style={{ border: `1px solid ${sug ? "var(--warn-line)" : "var(--line)"}`, background: motivos.has(m) ? "var(--rel-soft)" : "var(--card)" }}>
                  <input type="checkbox" className="mt-0.5" checked={motivos.has(m)} onChange={() => alterna(m)} style={{ accentColor: "var(--rel)" }} />
                  <span className="text-[13px]" style={{ color: "var(--ink)" }}>
                    {MOTIVOS[m]}
                    {sug && <span className="block text-[11px]" style={{ color: "var(--warn-ink)" }}>sugerido: {sug.porque}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {motivos.has("outro") && <div className="mt-2"><Entrada value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Qual? Ex.: lua de mel, cliente reclamou na última viagem" maxLength={300} /></div>}
        </fieldset>

        {irmas && irmas.length > 0 && (
          <fieldset>
            <legend className="block text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>
              Outras {irmas.length} viagens com a mesma ida e volta ({dataBR(viagem.data_embarque)} × {dataBR(viagem.data_retorno) || "—"})
            </legend>
            <p className="text-[11px] mb-1.5" style={{ color: "var(--ink3)" }}>O grupo costuma vir do Bitrix como vários negócios. Marque as que são do MESMO grupo: vira um cartão só, com um check do dia só.</p>
            <div className="flex gap-2 mb-1.5">
              <button type="button" className="text-[12px] underline" style={{ color: "var(--rel-ink)" }} onClick={() => setJuntar(new Set(irmas.map((x) => x.id)))}>marcar todas</button>
              <button type="button" className="text-[12px] underline" style={{ color: "var(--ink3)" }} onClick={() => setJuntar(new Set())}>nenhuma</button>
            </div>
            <ul className="max-h-48 overflow-y-auto rounded-lg" style={{ border: "1px solid var(--line)" }}>
              {irmas.map((x) => (
                <li key={x.id} style={{ borderTop: "1px solid var(--line2)" }}>
                  <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px]">
                    <input type="checkbox" checked={juntar.has(x.id)} onChange={() => alternaIrma(x.id)} style={{ accentColor: "var(--rel)" }} />
                    <span className="flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{x.cliente_nome ?? "sem cliente"} <span style={{ color: "var(--ink3)" }}>· {x.destino || x.titulo}{x.qtd_passageiros ? ` · ${x.qtd_passageiros} pax` : ""}</span></span>
                    {x.valor ? <span className="text-[12px] tabular-nums" style={{ color: "var(--ink3)" }}>{reais(Number(x.valor))}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          {selecionadas.length} viage{selecionadas.length > 1 ? "ns" : "m"} · ≈{pax} pessoa{pax > 1 ? "s" : ""} (estimativa: clientes diferentes, passageiros cadastrados ou o nº do Bitrix — o maior)
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Acompanha no Relacionamento">
            <select className="rel-input" value={respRel} onChange={(e) => setRespRel(e.target.value)}>
              <option value="">— ninguém ainda —</option>
              {doSetor(pessoas, "relacionamento").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Acompanha em Operações">
            <select className="rel-input" value={respOps} onChange={(e) => setRespOps(e.target.value)}>
              <option value="">— ninguém ainda —</option>
              {doSetor(pessoas, "operacional").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Campo>
        </div>
        <Campo rotulo="Observação (opcional)" dica="O que o time precisa saber de cara: ex. @ do influenciador, aniversário na viagem, cliente exigente.">
          <textarea className="rel-input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={2000} />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
