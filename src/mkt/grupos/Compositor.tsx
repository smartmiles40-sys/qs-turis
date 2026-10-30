// src/mkt/grupos/Compositor.tsx — "Nova campanha" / "Editar campanha", igual ao SendFlow:
// formulário à esquerda, prévia do WhatsApp à direita (fixa enquanto rola), público por
// cartões, "Agendar / Enviar agora" ou "Vários dias" (uma campanha por data).
// Grava direto no banco (RLS 0243); quem agenda de verdade é o servidor (confere tudo).
import { useEffect, useMemo, useState } from "react";
import { CONTEUDO_VAZIO, conteudoParaGravar, gruposDoDestino, lerCampanha, salvarCampanha, type Campanha, type Conteudo } from "./lib";
import {
  avisoPausadaDeProposito, campanhasDasDatas, estimarDuracao, formatarDuracao, hojeSP, isoDeSP, partesSP, problemasDaCampanha,
  problemasDasDatas, type EntradaData,
} from "./datas";
import type { Bases } from "./useBases";
import { intervaloDoChip, useChip } from "./contexto";
import { agendarNoServidor, useConfirmarRetomada } from "./Retomar";
import { EditorConteudo } from "./EditorConteudo";
import { SeletorPublico } from "./SeletorPublico";
import { CalendarioDatas } from "./CalendarioDatas";
import { BotaoGrande, Campo, Escolha, LinhaChave, Nota, PreviaWhatsApp, cor } from "./pecas";

export function Compositor({ bases, editarId, copiarId, onPronto, onCancelar }: {
  bases: Bases; editarId?: string | null; copiarId?: string | null; onPronto: () => void; onCancelar: () => void;
}) {
  const { estado } = useChip();
  const editando = Boolean(editarId);
  const [original, setOriginal] = useState<Campanha | null>(null);
  const [carregando, setCarregando] = useState(Boolean(editarId || copiarId));
  const [nome, setNome] = useState("");
  const [c, setC] = useState<Conteudo>({ ...CONTEUDO_VAZIO });
  const [agendar, setAgendar] = useState(true);
  const [data, setData] = useState("");
  const [hora, setHora] = useState("09:00");
  const [multi, setMulti] = useState(false);
  const [entradas, setEntradas] = useState<EntradaData[]>([]);
  const [horaPadrao, setHoraPadrao] = useState("09:00");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pedirRetomada, modalRetomada] = useConfirmarRetomada();

  useEffect(() => {
    const id = editarId || copiarId;
    if (!id) return;
    let vivo = true;
    lerCampanha(id).then((x) => {
      if (!vivo) return;
      if (!x) { setErroGeral("Campanha não encontrada."); return; }
      setC({
        tipo: x.tipo, texto: x.texto ?? "", midia_url: x.midia_url, midia_nome: x.midia_nome, enquete_opcoes: x.enquete_opcoes,
        enquete_multipla: x.enquete_multipla, mencionar_todos: x.mencionar_todos, tag_ids: x.tag_ids || [], grupo_jids: x.grupo_jids || [],
        intervalo_min_seg: x.intervalo_min_seg, intervalo_max_seg: x.intervalo_max_seg,
      });
      if (editarId) {
        setOriginal(x);
        setNome(x.nome);
        if (x.enviar_em) { const p = partesSP(x.enviar_em); setData(p.data); setHora(p.hora); }
      } else {
        setNome(`${x.nome} (cópia)`);
      }
    }).catch((e) => setErroGeral((e as Error).message)).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [editarId, copiarId]);

  const travada = Boolean(original?.fanout_em);
  const nGrupos = gruposDoDestino(c, bases.grupos, bases.links).length;
  const iv = intervaloDoChip(estado, c);
  const est = estimarDuracao(nGrupos, iv.min, iv.max);
  const pausadaDeProposito = original?.status === "pausada" ? avisoPausadaDeProposito(original.avisos) : null;
  const grupoDaPrevia = useMemo(() => {
    const g = gruposDoDestino(c, bases.grupos, bases.links)[0];
    return g ? { nome: g.nome || "Grupo", participantes: g.participantes } : null;
  }, [c, bases.grupos, bases.links]);

  function corpo(enviarEm: string | null, conteudo: Conteudo = c) {
    const g = conteudoParaGravar(conteudo);
    return {
      nome: nome.trim(), enviar_em: enviarEm, tipo: g.tipo, texto: g.texto, midia_url: g.midia_url, midia_nome: g.midia_nome,
      enquete_opcoes: g.enquete_opcoes, enquete_multipla: g.enquete_multipla, mencionar_todos: g.mencionar_todos,
      tag_ids: c.tag_ids, grupo_jids: c.grupo_jids, intervalo_min_seg: g.intervalo_min_seg, intervalo_max_seg: g.intervalo_max_seg,
    };
  }

  /** Salvar (e, se `paraAgendar`, mandar o servidor agendar). */
  async function enviar(paraAgendar: boolean) {
    setErroGeral(null);
    const enviarEm = !paraAgendar ? (data ? isoDeSP(data, hora) : null) : agendar ? isoDeSP(data, hora) : new Date().toISOString();
    const base = corpo(enviarEm);
    const problemas = paraAgendar
      ? problemasDaCampanha({ ...base, enquete_opcoes: base.enquete_opcoes }, { exigirData: true })
      : (!nome.trim() ? { nome: "Dê um nome pra campanha." } : {});
    if (paraAgendar && agendar && !enviarEm) problemas.enviar_em = "Escolha a data e a hora.";
    if (Object.keys(problemas).length) { setErros(problemas); setErroGeral("Confira os campos marcados."); return; }
    setErros({});
    const executar = async () => {
      setOcupado(true);
      try {
        const statusSemAgendar = original?.status === "pausada" ? "pausada" : "rascunho";
        const salva = await salvarCampanha(editando && !paraAgendar ? { ...base, status: statusSemAgendar } : base, original?.id);
        if (paraAgendar) {
          const e = await agendarNoServidor(salva.id);
          if (e.length) { setErroGeral(e.join(" · ")); setOriginal(salva); return; }
        }
        onPronto();
      } catch (e) { setErroGeral((e as Error).message); }
      finally { setOcupado(false); }
    };
    if (paraAgendar && original) pedirRetomada(original, executar);
    else await executar();
  }

  /** "Vários dias": uma campanha por data, uma de cada vez (progresso honesto). */
  async function enviarVarias() {
    setErroGeral(null);
    const baseConteudo = { tipo: c.tipo, texto: c.texto, midia_url: c.midia_url, midia_nome: c.midia_nome };
    const probl = problemasDasDatas(baseConteudo, entradas);
    const lista = campanhasDasDatas(baseConteudo, entradas);
    const conteudo = problemasDaCampanha({ ...corpo(lista[0]?.enviar_em ?? null), ...(lista[0] || {}) }, { exigirData: false });
    delete conteudo.midia; // a mídia é conferida por data
    if (Object.keys(conteudo).length || probl.length) { setErros(conteudo); setErroGeral([...probl, ...(Object.keys(conteudo).length ? ["Confira os campos marcados."] : [])].join(" ")); return; }
    setErros({});
    setOcupado(true);
    let falhas = 0;
    try {
      for (let i = 0; i < lista.length; i++) {
        setProgresso(`Criando ${i + 1} de ${lista.length}…`);
        const d = lista[i];
        try {
          const salva = await salvarCampanha(corpo(d.enviar_em, { ...c, tipo: d.tipo, texto: d.texto, midia_url: d.midia_url, midia_nome: d.midia_nome }));
          if ((await agendarNoServidor(salva.id)).length) falhas++;
        } catch { falhas++; }
      }
      if (!falhas) { onPronto(); return; }
      setErroGeral(`${falhas} de ${lista.length} não foram agendadas (ficaram como rascunho ou deram erro). As demais foram agendadas — revise em Rascunhos.`);
    } finally { setProgresso(null); setOcupado(false); }
  }

  const titulo = editando ? "Editar campanha" : copiarId ? "Nova campanha (cópia)" : "Nova campanha";
  const rotuloPrincipal = ocupado ? (progresso ?? "Salvando…")
    : editando ? (pausadaDeProposito || original?.status === "pausada" ? "▶ Salvar e retomar" : "📅 Salvar e agendar")
      : multi ? `📅 Agendar ${entradas.length} campanha${entradas.length === 1 ? "" : "s"}`
        : agendar ? "📅 Agendar campanha" : "🚀 Enviar agora";

  return (
    <div>
      {modalRetomada}
      <div className="mb-1.5 text-[13px]" style={{ color: cor.ink3 }}>
        <button type="button" onClick={onCancelar} className="hover:underline">Campanhas</button> / <b style={{ color: cor.ink }}>{titulo}</b>
      </div>
      <h2 className="mb-5 text-[22px] font-semibold" style={{ color: cor.ink }}>{titulo}</h2>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="gr-cartao p-4 sm:p-[22px]">
          {carregando && <div className="mb-5 rounded-xl px-3.5 py-3 text-[13px]" style={{ background: cor.card2, color: cor.ink3 }}>Carregando campanha…</div>}
          {pausadaDeProposito && <div className="mb-5"><Nota tom="aviso" icone="⚠️"><b>{pausadaDeProposito}</b></Nota></div>}
          {travada && <div className="mb-5"><Nota tom="aviso" icone="🔒">A fila desta campanha já foi montada: o conteúdo não muda mais. Pause, retome ou cancele na lista.</Nota></div>}

          <fieldset disabled={travada || ocupado} className="min-w-0">
            <Campo rotulo="Nome da campanha" dica="(só pra você identificar)" erro={erros.nome}>
              <input className="rel-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Live Japão — lembrete 1h antes" />
            </Campo>

            <EditorConteudo valor={c} onChange={setC} erros={erros} />

            <SeletorPublico valor={c} onChange={(v) => setC({ ...c, ...v })} grupos={bases.grupos} tags={bases.tags} links={bases.links} erro={erros.publico} />

            <Campo rotulo="Agendamento" dica="· horário de Brasília" erro={erros.enviar_em}>
              {!editando && (
                <div className="mb-3">
                  <LinhaChave titulo="Vários dias" texto="agenda a mesma campanha em várias datas de uma vez" ligada={multi} onChange={setMulti} />
                </div>
              )}
              {multi && !editando ? (
                <CalendarioDatas entradas={entradas} onChange={setEntradas} textoBase={c.texto} horaPadrao={horaPadrao} onHoraPadrao={setHoraPadrao} />
              ) : (
                <>
                  <div className="mb-3 flex gap-2">
                    <Escolha ativo={agendar} onClick={() => setAgendar(true)}>Agendar</Escolha>
                    <Escolha ativo={!agendar} onClick={() => setAgendar(false)}>Enviar agora</Escolha>
                  </div>
                  {agendar && (
                    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2.5" style={{ maxWidth: 380 }}>
                      <input type="date" className="rel-input" aria-label="Data do envio" min={hojeSP()} value={data} onChange={(e) => setData(e.target.value)} />
                      <input type="time" className="rel-input" aria-label="Hora do envio" value={hora} onChange={(e) => setHora(e.target.value)} />
                    </div>
                  )}
                  {!agendar && <p className="text-[12px]" style={{ color: cor.ink3 }}>Entra na fila na hora — o motor roda a cada minuto e respeita a janela do chip.</p>}
                </>
              )}
            </Campo>
          </fieldset>

          <Nota icone="⏱️">
            O envio respeita o intervalo de <b>{iv.min}–{iv.max}s entre grupos</b> (anti-bloqueio).{" "}
            {nGrupos ? <>~{nGrupos} grupo{nGrupos === 1 ? "" : "s"} ≈ {formatarDuracao(est.minSeg)}–{formatarDuracao(est.maxSeg)} pra concluir.</> : "Escolha o público pra ver quanto tempo leva."}
            {" "}Em grupo o WhatsApp não diz quem leu: o resultado mostra se chegou ao grupo.
          </Nota>

          {progresso && <p className="mt-4 text-[14px]" role="status" aria-live="polite" style={{ color: cor.ink2 }}>{progresso}</p>}
          {erroGeral && <p className="mt-4 text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erroGeral}</p>}

          {!travada && (
            <div className="mt-[22px] flex flex-wrap gap-3">
              <BotaoGrande disabled={ocupado || carregando || (multi && !editando && entradas.length === 0)}
                onClick={() => void (multi && !editando ? enviarVarias() : enviar(true))}>{rotuloPrincipal}</BotaoGrande>
              {!(multi && !editando) && (
                <BotaoGrande variante="secundario" disabled={ocupado || carregando} onClick={() => void enviar(false)}>
                  {editando && original?.status === "pausada" ? "Salvar e manter pausada" : "Salvar rascunho"}
                </BotaoGrande>
              )}
              <BotaoGrande variante="secundario" disabled={ocupado} onClick={onCancelar}>Cancelar</BotaoGrande>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-4">
          <PreviaWhatsApp tipo={c.tipo} texto={c.texto} midiaUrl={c.midia_url} midiaNome={c.midia_nome} mencionarTodos={c.mencionar_todos}
            enqueteOpcoes={c.enquete_opcoes} enqueteMultipla={c.enquete_multipla} grupo={grupoDaPrevia} />
        </div>
      </div>
    </div>
  );
}
