// src/mkt/grupos/CampanhasPage.tsx — campanhas para grupos: compor, agendar, acompanhar a fila.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Btn, Card, FilterPill, Page, PageHeader, StatCard } from "@/components/ui";
import { ConteudoEditor, DestinoPicker } from "./Compositor";
import { useBases, type Bases } from "./useBases";
import {
  api, apagarCampanha, classeCampo, CONTEUDO_VAZIO, conteudoParaGravar, deInputLocal, estiloCampo, lerCampanhas, lerEnvios,
  mudarStatus, paraInputLocal, quando, ROTULO_ENVIO, ROTULO_STATUS, salvarCampanha, TOM_STATUS,
  type Campanha, type Conteudo, type Envio, type StatusCampanha,
} from "./lib";

type Rascunho = Conteudo & { nome: string; enviar_em: string | null };

/**
 * Editor de campanha. `destinoFixo` (passo de cadência) esconde o seletor de
 * grupos e usa o destino da cadência.
 */
export function EditorCampanha({ inicial, bases, destinoFixo, cadenciaId, onSalvou, onCancelar }: {
  inicial?: Campanha | null; bases: Bases; destinoFixo?: { tag_ids: string[]; grupo_jids: string[] };
  cadenciaId?: string; onSalvou: () => void; onCancelar: () => void;
}) {
  const [c, setC] = useState<Rascunho>(() => inicial
    ? { ...CONTEUDO_VAZIO, ...inicial, nome: inicial.nome, enviar_em: inicial.enviar_em }
    : { ...CONTEUDO_VAZIO, ...(destinoFixo || {}), nome: "", enviar_em: null });
  const [erros, setErros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const travada = Boolean(inicial?.fanout_em);

  async function gravar(agendar: boolean) {
    setOcupado(true); setErros([]);
    try {
      const g = conteudoParaGravar(c);
      // só os campos que a tela pode mudar (o resto é do motor)
      const corpo = {
        nome: c.nome.trim(), enviar_em: c.enviar_em, tipo: g.tipo, texto: g.texto, midia_url: g.midia_url, midia_nome: g.midia_nome,
        enquete_opcoes: g.enquete_opcoes, enquete_multipla: g.enquete_multipla, mencionar_todos: g.mencionar_todos,
        tag_ids: (destinoFixo || g).tag_ids, grupo_jids: (destinoFixo || g).grupo_jids,
        intervalo_min_seg: g.intervalo_min_seg, intervalo_max_seg: g.intervalo_max_seg,
        ...(cadenciaId ? { cadencia_id: cadenciaId } : {}),
      };
      const salva = travada ? inicial! : await salvarCampanha(corpo, inicial?.id);
      if (agendar) {
        const r = await api<{ ok: boolean; erros?: string[] }>("agendar", { campanhaId: salva.id });
        if (!r.ok) { setErros(r.erros || ["Não deu pra agendar."]); return; }
      }
      onSalvou();
    } catch (e) { setErros([(e as Error).message]); }
    finally { setOcupado(false); }
  }

  return (
    <Card title={inicial ? `Editar: ${inicial.nome}` : "Nova campanha para grupos"} action={<Btn size="sm" variant="ghost" onClick={onCancelar}>Fechar</Btn>}>
      <div className="flex flex-col gap-4">
        {travada && <Alert tone="warn">A fila desta campanha já foi montada: o conteúdo não muda mais. Pause, retome ou cancele.</Alert>}
        {erros.length > 0 && <Alert tone="danger">{erros.join(" · ")}</Alert>}
        <label className="flex flex-col gap-1">
          <span className="qs-label">Nome (só pra você)</span>
          <input className={classeCampo} style={estiloCampo} value={c.nome} disabled={travada} onChange={(e) => setC({ ...c, nome: e.target.value })} placeholder="ex.: Live Japão — lembrete 1h antes" />
        </label>
        <fieldset disabled={travada} className="flex flex-col gap-4">
          <ConteudoEditor valor={c} onChange={(v) => setC({ ...c, ...v })} />
          {!destinoFixo && <DestinoPicker valor={c} onChange={(v) => setC({ ...c, ...v })} grupos={bases.grupos} tags={bases.tags} links={bases.links} />}
          <label className="flex flex-col gap-1" style={{ maxWidth: 280 }}>
            <span className="qs-label">Enviar em (dia e hora)</span>
            <input type="datetime-local" className={classeCampo} style={estiloCampo} value={paraInputLocal(c.enviar_em)} onChange={(e) => setC({ ...c, enviar_em: deInputLocal(e.target.value) })} />
          </label>
        </fieldset>
        <p className="text-[12px] qs-tone-muted">Sai pelo chip do Marketing, um grupo por vez, no intervalo escolhido, dentro da janela do chip. O motor roda a cada minuto. Em grupo o WhatsApp não diz quem leu — a fila mostra se chegou ao grupo.</p>
        {!travada && (
          <div className="flex flex-wrap gap-2">
            <Btn disabled={ocupado || !c.nome.trim()} onClick={() => void gravar(false)}>Salvar rascunho</Btn>
            <Btn variant="primary" disabled={ocupado || !c.nome.trim()} onClick={() => void gravar(true)}>Agendar</Btn>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Painel de uma campanha: números da fila + linha por grupo + ações. */
export function DetalheCampanha({ campanha, onMudou, onFechar }: { campanha: Campanha; onMudou: () => void; onFechar: () => void }) {
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => { lerEnvios(campanha.id).then(setEnvios).catch((e) => setErro((e as Error).message)); }, [campanha.id]);
  useEffect(() => {
    carregar();
    if (campanha.status !== "enviando") return;
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [carregar, campanha.status]);

  const n = useMemo(() => ({
    total: envios.length,
    chegaram: envios.filter((e) => e.status === "enviado" || e.status === "chegou").length,
    fila: envios.filter((e) => e.status === "pendente" || e.status === "enviando").length,
    falhas: envios.filter((e) => e.status === "falha").length,
  }), [envios]);

  async function status(s: "pausada" | "cancelada" | "agendada") {
    setErro(null);
    try {
      if (s === "cancelada" && !confirm("Cancelar? Quem ainda não recebeu sai da fila.")) return;
      if (s === "agendada") { const r = await api<{ ok: boolean; erros?: string[] }>("agendar", { campanhaId: campanha.id }); if (!r.ok) throw new Error((r.erros || []).join(" · ")); }
      else await mudarStatus(campanha.id, s);
      onMudou();
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <Card title={campanha.nome} action={<Btn size="sm" variant="ghost" onClick={onFechar}>Fechar</Btn>}>
      <div className="flex flex-col gap-3">
        {erro && <Alert tone="danger">{erro}</Alert>}
        {campanha.erro && <Alert tone="danger">{campanha.erro}</Alert>}
        {campanha.avisos?.length > 0 && <Alert tone="warn">{campanha.avisos.join(" · ")}</Alert>}
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <Badge tone={TOM_STATUS[campanha.status]}>{ROTULO_STATUS[campanha.status]}</Badge>
          <span>Envio: {quando(campanha.enviar_em)}</span>
          {campanha.concluido_em && <span className="qs-tone-muted">· concluída {quando(campanha.concluido_em)}</span>}
        </div>
        <div className="qs-stats">
          <StatCard label="Grupos" value={n.total} />
          <StatCard label="Chegaram ao grupo" value={n.chegaram} tone="ok" />
          <StatCard label="Na fila" value={n.fila} />
          <StatCard label="Falharam" value={n.falhas} tone={n.falhas ? "danger" : "default"} />
        </div>
        <div className="flex flex-wrap gap-2">
          {campanha.status === "enviando" && <Btn size="sm" onClick={() => void status("pausada")}>Pausar</Btn>}
          {campanha.status === "pausada" && <Btn size="sm" variant="primary" onClick={() => void status("agendada")}>Retomar</Btn>}
          {["agendada", "enviando", "pausada"].includes(campanha.status) && <Btn size="sm" variant="ghost" onClick={() => void status("cancelada")}>Cancelar</Btn>}
        </div>
        <div className="qs-table-wrap">
          <table className="qs-table">
            <thead><tr><th>Grupo</th><th>Situação</th><th>Quando</th></tr></thead>
            <tbody>
              {envios.map((e) => (
                <tr key={e.id}>
                  <td>{e.grupo_nome || e.grupo_jid}</td>
                  <td>{ROTULO_ENVIO[e.status]}{e.erro ? <div className="text-[12px] qs-tone-danger">{e.erro}</div> : null}</td>
                  <td className="qs-num">{quando(e.chegou_em || e.enviado_em)}</td>
                </tr>
              ))}
              {!envios.length && <tr><td colSpan={3} className="qs-tone-muted">A fila é montada na hora marcada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

const FILTROS: { v: "todas" | StatusCampanha; r: string }[] = [
  { v: "todas", r: "Todas" }, { v: "agendada", r: "Agendadas" }, { v: "enviando", r: "Enviando" },
  { v: "rascunho", r: "Rascunhos" }, { v: "concluida", r: "Concluídas" }, { v: "pausada", r: "Pausadas" },
];

export default function CampanhasPage() {
  const bases = useBases();
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [filtro, setFiltro] = useState<"todas" | StatusCampanha>("todas");
  const [editando, setEditando] = useState<Campanha | "nova" | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => { lerCampanhas().then(setCampanhas).catch((e) => setErro((e as Error).message)); }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = campanhas.filter((c) => filtro === "todas" || c.status === filtro);
  const atual = campanhas.find((c) => c.id === vendo) || null;

  return (
    <Page wide>
      <PageHeader crumb="Marketing · Grupos" title="Campanhas para grupos"
        subtitle="Texto, mídia, enquete e @todos para os grupos do chip do Marketing, com dia e hora marcados."
        actions={<Btn variant="primary" onClick={() => { setEditando("nova"); setVendo(null); }}>Nova campanha</Btn>} />
      <div className="flex flex-col gap-4">
        {(erro || bases.erro) && <Alert tone="danger">{erro || bases.erro}</Alert>}
        {editando && (
          <EditorCampanha inicial={editando === "nova" ? null : editando} bases={bases}
            onSalvou={() => { setEditando(null); carregar(); }} onCancelar={() => setEditando(null)} />
        )}
        <div className="flex flex-wrap gap-2">
          {FILTROS.map((f) => <FilterPill key={f.v} active={filtro === f.v} count={f.v === "todas" ? campanhas.length : campanhas.filter((c) => c.status === f.v).length} onClick={() => setFiltro(f.v)}>{f.r}</FilterPill>)}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: atual ? "minmax(0,1fr) minmax(0,460px)" : "minmax(0,1fr)" }}>
          <div className="qs-table-wrap">
            <table className="qs-table">
              <thead><tr><th>Campanha</th><th>Tipo</th><th>Quando</th><th>Situação</th><th style={{ textAlign: "right" }}>Chegaram</th><th /></tr></thead>
              <tbody>
                {lista.map((c) => (
                  <tr key={c.id} onClick={() => { setVendo(c.id); setEditando(null); }} style={{ cursor: "pointer" }}>
                    <td>{c.nome}{c.recorrencia_id ? <span className="qs-tone-muted text-[12px]"> · recorrência</span> : c.cadencia_id ? <span className="qs-tone-muted text-[12px]"> · cadência</span> : null}</td>
                    <td>{c.tipo}{c.mencionar_todos ? " · @todos" : ""}</td>
                    <td className="qs-num">{quando(c.enviar_em)}</td>
                    <td><Badge tone={TOM_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Badge></td>
                    <td className="qs-num" style={{ textAlign: "right" }}>{c.total ? `${c.enviados}/${c.total}` : "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {!c.fanout_em && ["rascunho", "agendada"].includes(c.status) && <Btn size="sm" variant="ghost" onClick={() => setEditando(c)}>Editar</Btn>}
                      {!c.fanout_em && ["rascunho", "agendada", "pausada"].includes(c.status) && (
                        <Btn size="sm" variant="ghost" onClick={() => { if (confirm("Apagar a campanha?")) apagarCampanha(c.id).then(carregar).catch((e) => setErro((e as Error).message)); }}>Apagar</Btn>
                      )}
                    </td>
                  </tr>
                ))}
                {!lista.length && <tr><td colSpan={6} className="qs-tone-muted">Nenhuma campanha.</td></tr>}
              </tbody>
            </table>
          </div>
          {atual && <DetalheCampanha campanha={atual} onMudou={carregar} onFechar={() => setVendo(null)} />}
        </div>
      </div>
    </Page>
  );
}
