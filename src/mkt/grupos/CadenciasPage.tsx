// src/mkt/grupos/CadenciasPage.tsx — cadências (passos com data marcada) e recorrências de grupo.
// Ex.: aquecimento de uma live = cadência "Live Japão" (tag Live Japão) com passos
// D-7, D-3, D-1, 1h antes, "ao vivo agora" — e/ou uma recorrência seg/qua/sex 19h.
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Btn, Card, Page, PageHeader } from "@/components/ui";
import { ConteudoEditor, DestinoPicker, TagChip } from "./Compositor";
import { DetalheCampanha, EditorCampanha } from "./CampanhasPage";
import { useBases, type Bases } from "./useBases";
import {
  apagarCadencia, apagarRecorrencia, classeCampo, CONTEUDO_VAZIO, conteudoParaGravar, DIAS, estiloCampo, gruposDoDestino, lerCadencias,
  lerCampanhas, lerRecorrencias, quando, ROTULO_STATUS, salvarCadencia, salvarRecorrencia, TOM_STATUS,
  type Cadencia, type Campanha, type Recorrencia,
} from "./lib";

export default function CadenciasPage() {
  const bases = useBases();
  const [cadencias, setCadencias] = useState<Cadencia[]>([]);
  const [recs, setRecs] = useState<Recorrencia[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [recNova, setRecNova] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    Promise.all([lerCadencias(), lerRecorrencias()]).then(([c, r]) => { setCadencias(c); setRecs(r); }).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const cad = cadencias.find((c) => c.id === aberta) || null;

  return (
    <Page wide>
      <PageHeader crumb="Marketing · Grupos" title="Cadências e recorrências"
        subtitle="Sequência de mensagens com data marcada pros mesmos grupos (ex.: aquecimento de uma live) e mensagens que se repetem toda semana."
        actions={<div className="flex gap-2"><Btn onClick={() => setRecNova(true)}>Nova recorrência</Btn><Btn variant="primary" onClick={() => setNova(true)}>Nova cadência</Btn></div>} />
      <div className="flex flex-col gap-4">
        {(erro || bases.erro) && <Alert tone="danger">{erro || bases.erro}</Alert>}
        {nova && <EditorCadencia bases={bases} onSalvou={(c) => { setNova(false); carregar(); setAberta(c.id); }} onCancelar={() => setNova(false)} />}
        {recNova && <EditorRecorrencia bases={bases} onSalvou={() => { setRecNova(false); carregar(); }} onCancelar={() => setRecNova(false)} />}

        <div className="grid gap-4" style={{ gridTemplateColumns: cad ? "minmax(0,340px) minmax(0,1fr)" : "minmax(0,1fr)" }}>
          <Card title={`Cadências (${cadencias.length})`}>
            <ul className="flex flex-col gap-1">
              {cadencias.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setAberta(c.id)} className="w-full text-left px-3 py-2 rounded-lg text-[14px]"
                    style={{ background: aberta === c.id ? "var(--card2)" : undefined }}>
                    <strong>{c.nome}</strong>
                    <span className="qs-tone-muted"> · {gruposDoDestino(c, bases.grupos, bases.links).length} grupos</span>
                  </button>
                </li>
              ))}
              {!cadencias.length && <li className="text-[13px] qs-tone-muted">Nenhuma cadência.</li>}
            </ul>
          </Card>
          {cad && <PainelCadencia cad={cad} bases={bases} recs={recs.filter((r) => r.cadencia_id === cad.id)}
            onMudou={carregar} onFechar={() => setAberta(null)} />}
        </div>

        <Card title="Recorrências avulsas">
          <ListaRecorrencias recs={recs.filter((r) => !r.cadencia_id)} bases={bases} onMudou={carregar} />
        </Card>
      </div>
    </Page>
  );
}

function EditorCadencia({ bases, inicial, onSalvou, onCancelar }: { bases: Bases; inicial?: Cadencia; onSalvou: (c: Cadencia) => void; onCancelar: () => void }) {
  const [c, setC] = useState({ nome: inicial?.nome || "", descricao: inicial?.descricao || "", tag_ids: inicial?.tag_ids || [], grupo_jids: inicial?.grupo_jids || [] });
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    setErro(null);
    if (!c.tag_ids.length && !c.grupo_jids.length) { setErro("Escolha os grupos da cadência."); return; }
    try { onSalvou(await salvarCadencia({ ...c, nome: c.nome.trim() }, inicial?.id)); } catch (e) { setErro((e as Error).message); }
  }
  return (
    <Card title={inicial ? "Editar cadência" : "Nova cadência"} action={<Btn size="sm" variant="ghost" onClick={onCancelar}>Fechar</Btn>}>
      <div className="flex flex-col gap-3">
        {erro && <Alert tone="danger">{erro}</Alert>}
        <input className={classeCampo} style={estiloCampo} placeholder="Nome (ex.: Aquecimento Live Japão)" value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} />
        <textarea rows={2} className={classeCampo} style={estiloCampo} placeholder="Descrição (opcional)" value={c.descricao} onChange={(e) => setC({ ...c, descricao: e.target.value })} />
        <DestinoPicker valor={c} onChange={(v) => setC({ ...c, ...v })} grupos={bases.grupos} tags={bases.tags} links={bases.links} />
        <p className="text-[12px] qs-tone-muted">Todos os passos vão sempre pros mesmos grupos. Mudar o destino aqui vale pros passos que ainda não começaram a enviar.</p>
        <div><Btn variant="primary" disabled={!c.nome.trim()} onClick={() => void salvar()}>Salvar</Btn></div>
      </div>
    </Card>
  );
}

function PainelCadencia({ cad, bases, recs, onMudou, onFechar }: { cad: Cadencia; bases: Bases; recs: Recorrencia[]; onMudou: () => void; onFechar: () => void }) {
  const [passos, setPassos] = useState<Campanha[]>([]);
  const [novoPasso, setNovoPasso] = useState(false);
  const [recNova, setRecNova] = useState(false);
  const [editando, setEditando] = useState(false);
  const [vendo, setVendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    lerCampanhas({ cadenciaId: cad.id }).then((l) => setPassos([...l].sort((a, b) => String(a.enviar_em || "").localeCompare(String(b.enviar_em || ""))))).catch((e) => setErro((e as Error).message));
  }, [cad.id]);
  useEffect(() => { carregar(); }, [carregar]);
  const destino = { tag_ids: cad.tag_ids, grupo_jids: cad.grupo_jids };
  const tagsDaCad = bases.tags.filter((t) => cad.tag_ids.includes(t.id));
  const visto = passos.find((p) => p.id === vendo) || null;

  return (
    <div className="flex flex-col gap-4">
      <Card title={cad.nome} action={<div className="flex gap-2">
        <Btn size="sm" onClick={() => setEditando(true)}>Editar destino</Btn>
        <Btn size="sm" variant="ghost" onClick={() => { if (confirm("Apagar a cadência? Os passos já criados ficam como campanhas avulsas.")) apagarCadencia(cad.id).then(() => { onFechar(); onMudou(); }).catch((e) => setErro((e as Error).message)); }}>Apagar</Btn>
        <Btn size="sm" variant="ghost" onClick={onFechar}>Fechar</Btn></div>}>
        <div className="flex flex-col gap-3">
          {erro && <Alert tone="danger">{erro}</Alert>}
          {cad.descricao && <p className="text-[14px]">{cad.descricao}</p>}
          <div className="flex flex-wrap gap-1.5 items-center text-[13px]">
            {tagsDaCad.map((t) => <TagChip key={t.id} tag={t} ativo />)}
            {cad.grupo_jids.length > 0 && <span>+ {cad.grupo_jids.length} grupo(s) escolhidos</span>}
            <span className="qs-tone-muted">= {gruposDoDestino(cad, bases.grupos, bases.links).length} grupos hoje</span>
          </div>
          <div className="qs-label">Passos</div>
          <ol className="flex flex-col gap-1">
            {passos.map((p, i) => (
              <li key={p.id}>
                <button type="button" onClick={() => setVendo(p.id)} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[14px]" style={{ border: "1px solid var(--line)" }}>
                  <span className="qs-num qs-tone-muted">{i + 1}.</span>
                  <span className="qs-num">{quando(p.enviar_em)}</span>
                  <span className="truncate">{p.nome}</span>
                  <span className="ml-auto"><Badge tone={TOM_STATUS[p.status]}>{ROTULO_STATUS[p.status]}</Badge></span>
                </button>
              </li>
            ))}
            {!passos.length && <li className="text-[13px] qs-tone-muted">Nenhum passo ainda.</li>}
          </ol>
          <div className="flex gap-2"><Btn size="sm" variant="primary" onClick={() => setNovoPasso(true)}>+ Passo</Btn><Btn size="sm" onClick={() => setRecNova(true)}>+ Recorrência nesta cadência</Btn></div>
          {recs.length > 0 && <><div className="qs-label">Recorrências</div><ListaRecorrencias recs={recs} bases={bases} onMudou={onMudou} /></>}
        </div>
      </Card>
      {editando && <EditorCadencia bases={bases} inicial={cad} onSalvou={() => { setEditando(false); onMudou(); }} onCancelar={() => setEditando(false)} />}
      {novoPasso && <EditorCampanha bases={bases} destinoFixo={destino} cadenciaId={cad.id} onSalvou={() => { setNovoPasso(false); carregar(); }} onCancelar={() => setNovoPasso(false)} />}
      {recNova && <EditorRecorrencia bases={bases} cadencia={cad} onSalvou={() => { setRecNova(false); onMudou(); }} onCancelar={() => setRecNova(false)} />}
      {visto && <DetalheCampanha campanha={visto} onMudou={carregar} onFechar={() => setVendo(null)} />}
    </div>
  );
}

function ListaRecorrencias({ recs, bases, onMudou }: { recs: Recorrencia[]; bases: Bases; onMudou: () => void }) {
  const [editando, setEditando] = useState<Recorrencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!recs.length) return <p className="text-[13px] qs-tone-muted">Nenhuma.</p>;
  return (
    <div className="flex flex-col gap-2">
      {erro && <Alert tone="danger">{erro}</Alert>}
      {recs.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-[14px]" style={{ border: "1px solid var(--line)" }}>
          <strong>{r.nome}</strong>
          <span>{r.dias_semana.map((d) => DIAS[d]).join(", ")} às {r.hora}</span>
          <span className="qs-tone-muted">{r.inicio ? `de ${r.inicio.split("-").reverse().join("/")}` : ""}{r.fim ? ` até ${r.fim.split("-").reverse().join("/")}` : ""}</span>
          <Badge tone={r.ativo ? "ok" : undefined}>{r.ativo ? "Ativa" : "Parada"}</Badge>
          <span className="ml-auto flex gap-1">
            <Btn size="sm" onClick={() => salvarRecorrencia({ nome: r.nome, ativo: !r.ativo }, r.id).then(onMudou).catch((e) => setErro((e as Error).message))}>{r.ativo ? "Parar" : "Ativar"}</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setEditando(r)}>Editar</Btn>
            <Btn size="sm" variant="ghost" onClick={() => { if (confirm("Apagar a recorrência? As campanhas já geradas ficam.")) apagarRecorrencia(r.id).then(onMudou).catch((e) => setErro((e as Error).message)); }}>Apagar</Btn>
          </span>
        </div>
      ))}
      {editando && <EditorRecorrencia bases={bases} inicial={editando} onSalvou={() => { setEditando(null); onMudou(); }} onCancelar={() => setEditando(null)} />}
    </div>
  );
}

function EditorRecorrencia({ bases, inicial, cadencia, onSalvou, onCancelar }: {
  bases: Bases; inicial?: Recorrencia; cadencia?: Cadencia; onSalvou: () => void; onCancelar: () => void;
}) {
  const fixo = cadencia ? { tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids } : null;
  const [r, setR] = useState(() => ({
    ...CONTEUDO_VAZIO, ...(inicial || {}), ...(fixo || {}),
    nome: inicial?.nome || "", dias_semana: inicial?.dias_semana || [1], hora: inicial?.hora || "19:00",
    inicio: inicial?.inicio || "", fim: inicial?.fim || "", ativo: inicial?.ativo ?? true,
  }));
  const [erro, setErro] = useState<string | null>(null);
  const alternaDia = (d: number) => setR({ ...r, dias_semana: r.dias_semana.includes(d) ? r.dias_semana.filter((x) => x !== d) : [...r.dias_semana, d].sort() });

  async function salvar() {
    setErro(null);
    if (!r.nome.trim()) { setErro("Dê um nome."); return; }
    if (!r.dias_semana.length) { setErro("Escolha ao menos um dia."); return; }
    const destino = fixo || r;
    if (!destino.tag_ids.length && !destino.grupo_jids.length) { setErro("Escolha os grupos."); return; }
    const g = conteudoParaGravar(r);
    if (g.tipo === "texto" && !g.texto.trim()) { setErro("Escreva a mensagem."); return; }
    if (g.tipo === "enquete" && ((g.enquete_opcoes || []).length < 2 || !g.texto.trim())) { setErro("Enquete: pergunta e 2 a 12 opções."); return; }
    if (["imagem", "video", "documento", "audio"].includes(g.tipo) && !g.midia_url) { setErro("Escolha o arquivo."); return; }
    try {
      await salvarRecorrencia({
        nome: r.nome.trim(), cadencia_id: cadencia?.id ?? inicial?.cadencia_id ?? null, dias_semana: r.dias_semana, hora: r.hora,
        inicio: r.inicio || null, fim: r.fim || null, ativo: r.ativo,
        tipo: g.tipo, texto: g.texto, midia_url: g.midia_url, midia_nome: g.midia_nome, enquete_opcoes: g.enquete_opcoes,
        enquete_multipla: g.enquete_multipla, mencionar_todos: g.mencionar_todos, tag_ids: destino.tag_ids, grupo_jids: destino.grupo_jids,
        intervalo_min_seg: g.intervalo_min_seg, intervalo_max_seg: g.intervalo_max_seg,
      }, inicial?.id);
      onSalvou();
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <Card title={inicial ? `Editar recorrência: ${inicial.nome}` : cadencia ? `Nova recorrência em “${cadencia.nome}”` : "Nova recorrência"} action={<Btn size="sm" variant="ghost" onClick={onCancelar}>Fechar</Btn>}>
      <div className="flex flex-col gap-3">
        {erro && <Alert tone="danger">{erro}</Alert>}
        <input className={classeCampo} style={estiloCampo} placeholder="Nome (ex.: Lembrete semanal da comunidade)" value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} />
        <div className="flex flex-wrap items-center gap-1.5">
          {DIAS.map((d, i) => <Btn key={d} size="sm" variant={r.dias_semana.includes(i) ? "primary" : "secondary"} onClick={() => alternaDia(i)}>{d}</Btn>)}
          <span className="text-[13px] ml-2">às</span>
          <input type="time" className="px-2 py-1 rounded-lg" style={estiloCampo} value={r.hora} onChange={(e) => setR({ ...r, hora: e.target.value })} />
          <span className="text-[12px] qs-tone-muted">(hora de Brasília)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          de <input type="date" className="px-2 py-1 rounded-lg" style={estiloCampo} value={r.inicio} onChange={(e) => setR({ ...r, inicio: e.target.value })} />
          até <input type="date" className="px-2 py-1 rounded-lg" style={estiloCampo} value={r.fim} onChange={(e) => setR({ ...r, fim: e.target.value })} />
          <span className="qs-tone-muted">(vazio = sem limite)</span>
        </div>
        <ConteudoEditor valor={r} onChange={(v) => setR({ ...r, ...v })} />
        {!fixo && <DestinoPicker valor={r} onChange={(v) => setR({ ...r, ...v })} grupos={bases.grupos} tags={bases.tags} links={bases.links} />}
        <p className="text-[12px] qs-tone-muted">O motor cria a campanha de cada dia com até 24 h de antecedência — ela aparece em Campanhas e pode ser cancelada antes de sair.</p>
        <div><Btn variant="primary" onClick={() => void salvar()}>Salvar</Btn></div>
      </div>
    </Card>
  );
}
