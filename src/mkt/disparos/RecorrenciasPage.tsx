// src/mkt/disparos/RecorrenciasPage.tsx
// -----------------------------------------------------------------------------
// RECORRÊNCIAS DO MARKETING (0242): "toda segunda às 9h, pra lista X".
// É um MOLDE: na hora marcada o cron cria uma campanha agendada normal (com o
// público de NAQUELE momento) e ela anda na mesma fila, ritmo e simulação.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, EmptyState, Page, PageHeader } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { descreverPublico, lerConfig, type ConfigDisparo, type MapaVariaveis } from "@/lib/qs/disparos";
import { Campo, Chips, INPUT, INPUT_ESTILO, Modal } from "@/components/sdr/disparos/pecas";
import { apagarRecorrencia, listarRecorrencias, salvarRecorrencia, type PublicoMkt, type Recorrencia } from "./api";
import { ModeloEVariaveis, PublicoMktForm, variaveisOk } from "./pecasMkt";
import { DIAS_CURTOS, descreverRecorrencia } from "./regras";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function Editor({ cfg, inicial, onFechar, onSalvo }: { cfg: ConfigDisparo; inicial: Recorrencia | null; onFechar: () => void; onSalvo: () => void }) {
  const aprovados = cfg.modelos.filter((m) => m.status === "aprovado" && m.setor === "marketing");
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [modeloNome, setModeloNome] = useState(inicial?.modelo_nome ?? "");
  const [mapa, setMapa] = useState<MapaVariaveis>(inicial?.params ?? {});
  const [publico, setPublico] = useState<PublicoMkt>(inicial?.publico ?? { fonte: "contatos" });
  const [dias, setDias] = useState<number[]>(inicial?.dias_semana ?? [1]);
  const [hora, setHora] = useState(inicial?.hora ?? "09:00");
  const [salvando, setSalvando] = useState(false);
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;
  const ok = nome.trim().length >= 2 && variaveisOk(modelo, mapa) && dias.length > 0 && /^\d{2}:\d{2}$/.test(hora);

  async function salvar() {
    if (!modelo) return;
    setSalvando(true);
    try {
      await salvarRecorrencia({ id: inicial?.id, nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico, dias_semana: dias, hora, ativa: inicial?.ativa ?? true });
      notifySuccess("Recorrência salva."); onSalvo();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={inicial ? `Recorrência · ${inicial.nome}` : "Nova recorrência"} onFechar={onFechar} largura={780}
      rodape={<><Button variant="ghost" onClick={onFechar}>Fechar</Button><Button variant="primary" disabled={!ok || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button></>}>
      <Campo rotulo="Nome (vira o nome de cada campanha + a data)"><input className={INPUT} style={INPUT_ESTILO} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Novidades da semana" /></Campo>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <Campo rotulo="Dias"><Chips opcoes={DIAS_CURTOS.map((d, i) => ({ id: String(i), rotulo: d }))} valor={dias.map(String)} onChange={(v) => setDias(v.map(Number).sort())} /></Campo>
        <Campo rotulo="Hora (Brasília)"><input type="time" className={INPUT} style={INPUT_ESTILO} value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
      </div>
      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{descreverRecorrencia(dias, hora)}. Fora da janela de envio ({cfg.ritmo.inicio}–{cfg.ritmo.fim}), a fila espera a janela abrir.</p>
      <ModeloEVariaveis aprovados={aprovados} modeloNome={modeloNome} setModeloNome={setModeloNome} mapa={mapa} setMapa={setMapa} fonte={publico.fonte} />
      <PublicoMktForm p={publico} set={setPublico} />
      <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
        Cuidado com o intervalo mínimo ({cfg.ritmo.intervalo_dias} dias): numa recorrência semanal com intervalo de 7 dias, quem recebeu na semana passada pode ficar de fora se a hora variar. O QS mostra quem saiu e por quê no funil de cada campanha.
      </p>
    </Modal>
  );
}

export default function RecorrenciasPage() {
  const [cfg, setCfg] = useState<ConfigDisparo | null>(null);
  const [lista, setLista] = useState<Recorrencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Recorrencia | "nova" | null>(null);

  const carregar = useCallback(async () => {
    try { const [c, l] = await Promise.all([lerConfig("marketing"), listarRecorrencias()]); setCfg(c); setLista(l); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <Page>
      <PageHeader title="Recorrências" subtitle="Disparos que se repetem sozinhos: toda segunda às 9h, toda sexta às 18h…"
        actions={cfg ? <Button variant="primary" onClick={() => setEditando("nova")}>+ Nova recorrência</Button> : undefined} />
      {erro && <Alert tone="danger">{erro}</Alert>}
      {cfg && !cfg.numeroMkt && <Alert tone="warn">O Marketing ainda não tem número: a campanha de cada ocorrência é criada, mas fica pausada até o número existir.</Alert>}
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p>
        : lista.length === 0 ? <div className="qs-card"><EmptyState title="Nenhuma recorrência" description="Ex.: toda segunda às 9h, as vagas abertas da semana pra lista 'Comunidade'." /></div>
        : (
          <ul className="space-y-2">
            {lista.map((r) => (
              <li key={r.id} className="qs-card p-4 flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{r.nome}</p>
                  <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{descreverRecorrencia(r.dias_semana, r.hora)} · {r.modelo_nome} · {descreverPublico("marketing", r.publico)}</p>
                  <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
                    {r.ativa && r.proxima_em ? `Próxima: ${dataHora(r.proxima_em)}` : "Pausada"}{r.ultima_em ? ` · última: ${dataHora(r.ultima_em)}` : ""}
                  </p>
                </div>
                <Badge tone={r.ativa ? "ok" : undefined} dot>{r.ativa ? "ativa" : "pausada"}</Badge>
                <Button size="sm" onClick={async () => {
                  try { await salvarRecorrencia({ ...r, ativa: !r.ativa }); void carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
                }}>{r.ativa ? "Pausar" : "Ativar"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditando(r)}>Editar</Button>
                <Button size="sm" variant="destructive" onClick={async () => {
                  if (!window.confirm(`Apagar a recorrência "${r.nome}"? As campanhas já criadas continuam.`)) return;
                  try { await apagarRecorrencia(r.id); void carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
                }}>Apagar</Button>
              </li>
            ))}
          </ul>
        )}
      {editando && cfg && <Editor cfg={cfg} inicial={editando === "nova" ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void carregar(); }} />}
    </Page>
  );
}
