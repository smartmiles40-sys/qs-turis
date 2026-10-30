// src/mkt/grupos/PassoEditor.tsx — a gaveta de UMA mensagem da cadência (igual ao SendFlow):
// no computador abre à direita com formulário + prévia lado a lado; no celular ocupa a tela.
import { useEffect, useState } from "react";
import { apagarCampanha, CONTEUDO_VAZIO, conteudoParaGravar, mudarStatus, salvarCampanha, type Cadencia, type Campanha, type Conteudo } from "./lib";
import { avisoPausadaDeProposito, isoDeSP, partesSP, problemasDaCampanha } from "./datas";
import { agendarNoServidor, useConfirmarRetomada } from "./Retomar";
import { EditorConteudo } from "./EditorConteudo";
import { BotaoGrande, Campo, Nota, PreviaWhatsApp, cor } from "./pecas";

export interface PassoAberto { passo: Campanha | null; numero: number; enviarEm: string; modelo?: Campanha | null }

export function PassoEditor({ cadencia, aberto, onFechar, onSalvo }: { cadencia: Cadencia; aberto: PassoAberto; onFechar: () => void; onSalvo: () => void }) {
  const p = aberto.passo;
  const novo = !p;
  const partes = partesSP(p?.enviar_em || aberto.enviarEm);
  const [salvo, setSalvo] = useState<Campanha | null>(p);
  const [nome, setNome] = useState(p?.nome || `${cadencia.nome} · mensagem ${aberto.numero}`);
  const [c, setC] = useState<Conteudo>(() => p
    ? { tipo: p.tipo, texto: p.texto ?? "", midia_url: p.midia_url, midia_nome: p.midia_nome, enquete_opcoes: p.enquete_opcoes, enquete_multipla: p.enquete_multipla,
      mencionar_todos: p.mencionar_todos, tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids, intervalo_min_seg: p.intervalo_min_seg, intervalo_max_seg: p.intervalo_max_seg }
    : { ...CONTEUDO_VAZIO, mencionar_todos: aberto.modelo?.mencionar_todos ?? false, tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids });
  const [data, setData] = useState(partes.data);
  const [hora, setHora] = useState(partes.hora);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pedirRetomada, modalRetomada] = useConfirmarRetomada();

  // Esc fecha; e a página de trás não rola enquanto a gaveta está aberta.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = antes; };
  }, [onFechar]);

  const parado = salvo ? salvo.status === "pausada" || salvo.status === "rascunho" || salvo.status === "erro" : false;
  const pausadaDeProposito = salvo?.status === "pausada" ? avisoPausadaDeProposito(salvo.avisos) : null;

  async function salvar() {
    setErroGeral(null);
    const enviarEm = isoDeSP(data, hora);
    const g = conteudoParaGravar(c);
    const corpo = {
      nome: nome.trim() || `${cadencia.nome} · mensagem ${aberto.numero}`, enviar_em: enviarEm, tipo: g.tipo, texto: g.texto, midia_url: g.midia_url, midia_nome: g.midia_nome,
      enquete_opcoes: g.enquete_opcoes, enquete_multipla: g.enquete_multipla, mencionar_todos: g.mencionar_todos,
      tag_ids: cadencia.tag_ids, grupo_jids: cadencia.grupo_jids, intervalo_min_seg: g.intervalo_min_seg, intervalo_max_seg: g.intervalo_max_seg,
      cadencia_id: cadencia.id,
    };
    const probl = problemasDaCampanha(corpo);
    if (!enviarEm) probl.enviar_em = "Escolha a data e a hora.";
    if (probl.publico) probl.publico = "A cadência está sem público — toque em “Trocar” em “Para quem vai”.";
    if (Object.keys(probl).length) { setErros(probl); setErroGeral(probl.publico || "Confira os campos marcados."); return; }
    setErros({});
    const executar = async () => {
      setOcupado(true);
      try {
        const s = await salvarCampanha(corpo, salvo?.id);
        setSalvo(s);
        const e = await agendarNoServidor(s.id);
        if (e.length) { setErroGeral(e.join(" · ")); return; }
        onSalvo();
      } catch (e) { setErroGeral((e as Error).message); }
      finally { setOcupado(false); }
    };
    if (salvo) pedirRetomada(salvo, executar); else await executar();
  }

  async function pausar() {
    if (!salvo) return;
    setOcupado(true); setErroGeral(null);
    try { await mudarStatus(salvo.id, "pausada"); onSalvo(); } catch (e) { setErroGeral((e as Error).message); } finally { setOcupado(false); }
  }
  async function apagar() {
    if (!salvo || !confirm(`Apagar a mensagem ${aberto.numero}? Ela não será enviada.`)) return;
    setOcupado(true); setErroGeral(null);
    try { await apagarCampanha(salvo.id); onSalvo(); } catch (e) { setErroGeral((e as Error).message); } finally { setOcupado(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Mensagem ${aberto.numero}`}>
      {modalRetomada}
      <button type="button" aria-label="Fechar" onClick={onFechar} className="absolute inset-0" style={{ background: "rgba(15,20,26,.45)" }} />
      <div className="relative flex h-full w-full max-w-[980px] flex-col shadow-2xl" style={{ background: "var(--bg)", borderLeft: "1px solid var(--line)" }}>
        <header className="flex items-center gap-3 px-4 py-3.5 md:px-6" style={{ borderBottom: "1px solid var(--line)", background: cor.card }}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white" style={{ background: "var(--rel)" }}>{aberto.numero}</span>
          <h3 className="min-w-0 flex-1 truncate text-[17px] font-semibold" style={{ color: cor.ink }}>{novo && !salvo ? "Nova mensagem" : `Mensagem ${aberto.numero}`}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="rounded-lg px-2.5 py-1.5 text-[22px] leading-none" style={{ color: cor.ink3 }}>×</button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              {pausadaDeProposito && <div className="mb-5"><Nota tom="aviso" icone="⚠️"><b>{pausadaDeProposito}</b></Nota></div>}
              <fieldset disabled={ocupado} className="min-w-0">
                <Campo rotulo="Quando sai" dica="· horário de Brasília" erro={erros.enviar_em}>
                  <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2.5">
                    <input type="date" className="rel-input" aria-label="Data do envio" value={data} onChange={(e) => setData(e.target.value)} />
                    <input type="time" className="rel-input" aria-label="Hora do envio" value={hora} onChange={(e) => setHora(e.target.value)} />
                  </div>
                </Campo>
                <EditorConteudo valor={c} onChange={setC} erros={erros} linhasTexto={7} />
                <Campo rotulo="Nome" dica="· aparece na lista de Campanhas" erro={erros.nome}>
                  <input className="rel-input" value={nome} onChange={(e) => setNome(e.target.value)} />
                </Campo>
              </fieldset>
            </div>
            <div className="lg:sticky lg:top-0">
              <PreviaWhatsApp tipo={c.tipo} texto={c.texto} midiaUrl={c.midia_url} midiaNome={c.midia_nome} mencionarTodos={c.mencionar_todos}
                enqueteOpcoes={c.enquete_opcoes} enqueteMultipla={c.enquete_multipla} grupo={{ nome: cadencia.nome }} />
            </div>
          </div>
        </div>

        <footer className="px-4 py-3.5 md:px-6" style={{ borderTop: "1px solid var(--line)", background: cor.card }}>
          {erroGeral && <p className="mb-3 text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erroGeral}</p>}
          <div className="flex flex-wrap items-center gap-2.5">
            <BotaoGrande disabled={ocupado} onClick={() => void salvar()}>
              {ocupado ? "Salvando…" : !salvo ? "📅 Agendar mensagem" : parado ? "▶️ Salvar e reativar" : "💾 Salvar"}
            </BotaoGrande>
            {salvo && salvo.status === "agendada" && <BotaoGrande variante="secundario" disabled={ocupado} onClick={() => void pausar()}>⏸ Pausar</BotaoGrande>}
            {salvo && ["rascunho", "agendada", "pausada"].includes(salvo.status) && (
              <BotaoGrande variante="perigo" className="sm:ml-auto" disabled={ocupado} onClick={() => void apagar()}>Apagar</BotaoGrande>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
