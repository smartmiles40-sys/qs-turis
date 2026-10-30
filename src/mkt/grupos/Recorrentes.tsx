// src/mkt/grupos/Recorrentes.tsx — mensagens que se repetem (toda segunda e quarta às 19h…).
// Lista em cartões com chave liga/desliga e os próximos envios; o formulário tem a
// prévia do WhatsApp ao lado, como no resto da área.
//   #mkt/grupos?aba=cadencias&ver=recorrentes            → lista
//   #mkt/grupos?aba=cadencias&recorrencia=nova|<id>      → formulário
import { useCallback, useEffect, useMemo, useState } from "react";
import { Vazio } from "@/rel/ui";
import {
  apagarRecorrencia, CONTEUDO_VAZIO, conteudoParaGravar, gruposDoDestino, lerCadencias, lerRecorrencias, salvarRecorrencia,
  type Cadencia, type Conteudo, type Recorrencia,
} from "./lib";
import { DIAS_CURTOS, descreverRecorrencia, proximasOcorrencias, problemasDaCampanha, quandoSP } from "./datas";
import type { Bases } from "./useBases";
import { useParam } from "./navegar";
import { EditorConteudo } from "./EditorConteudo";
import { resumoPublico, SeletorPublico } from "./SeletorPublico";
import { BotaoGrande, Campo, Chave, Escolha, Nota, PreviaWhatsApp, SeloBolinha, cor } from "./pecas";

export default function Recorrentes({ bases }: { bases: Bases }) {
  const [aberta, setAberta] = useParam("recorrencia");
  const [recs, setRecs] = useState<Recorrencia[] | null>(null);
  const [cads, setCads] = useState<Cadencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    Promise.all([lerRecorrencias(), lerCadencias()])
      .then(([r, c]) => { setRecs(r); setCads(c); setErro(null); })
      .catch((e) => { setErro((e as Error).message); setRecs((v) => v ?? []); });
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  if (aberta) {
    if (recs === null) return <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando…</div>;
    const inicial = aberta === "nova" ? undefined : recs.find((r) => r.id === aberta);
    if (aberta !== "nova" && !inicial) return (
      <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>
        Recorrência não encontrada. <button type="button" className="font-semibold underline" style={{ color: cor.relInk }} onClick={() => setAberta(null)}>Voltar</button>
      </div>
    );
    return <FormRecorrencia key={aberta} bases={bases} cadencias={cads} inicial={inicial}
      onPronto={() => { setAberta(null); carregar(); window.scrollTo(0, 0); }} onCancelar={() => { setAberta(null); window.scrollTo(0, 0); }} />;
  }

  async function alternar(r: Recorrencia, ativo: boolean) {
    try { await salvarRecorrencia({ nome: r.nome, ativo }, r.id); carregar(); } catch (e) { setErro((e as Error).message); }
  }
  async function apagar(r: Recorrencia) {
    try { await apagarRecorrencia(r.id); setConfirmando(null); carregar(); } catch (e) { setErro((e as Error).message); }
  }

  const nomeCad = (id: string | null) => cads.find((c) => c.id === id)?.nome;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Recorrentes</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>A mesma mensagem toda semana, nos dias e na hora que você escolher (ex.: lembrete da comunidade toda segunda às 19h).</p>
        </div>
        <BotaoGrande onClick={() => setAberta("nova")}>+ Nova recorrente</BotaoGrande>
      </div>
      {erro && <div className="mb-5"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}
      {recs === null ? (
        <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando…</div>
      ) : recs.length === 0 ? (
        <div className="gr-cartao"><Vazio titulo="Nenhuma mensagem recorrente" texto="Crie uma para repetir a mesma mensagem toda semana." /></div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {recs.map((r) => {
            const prox = proximasOcorrencias(r);
            const n = gruposDoDestino(r, bases.grupos, bases.links).length;
            const cad = nomeCad(r.cadencia_id);
            return (
              <div key={r.id} className="gr-cartao flex flex-col p-[18px]" style={{ opacity: r.ativo ? 1 : 0.8 }}>
                <div className="mb-2 flex items-start gap-2.5">
                  <h3 className="min-w-0 flex-1 break-words text-[16px] font-semibold leading-tight" style={{ color: cor.ink }}>{r.nome}</h3>
                  <Chave ligada={r.ativo} onChange={(v) => void alternar(r, v)} rotulo={r.ativo ? "Pausar a recorrente" : "Ativar a recorrente"} />
                </div>
                <div className="mb-2">{r.ativo ? <SeloBolinha tom="ok">Ativa</SeloBolinha> : <SeloBolinha tom="neutro">Pausada</SeloBolinha>}</div>
                <div className="text-[14px] font-semibold" style={{ color: cor.ink2 }}>🔄 {descreverRecorrencia(r.dias_semana, r.hora.slice(0, 5))}</div>
                <div className="mt-1 truncate text-[13px]" style={{ color: cor.ink3 }}>{resumoPublico(r, bases.tags)} · {n} grupo{n === 1 ? "" : "s"}{cad ? ` · cadência “${cad}”` : ""}</div>
                {(r.inicio || r.fim) && <div className="mt-1 text-[12.5px]" style={{ color: cor.ink3 }}>{r.inicio ? `de ${r.inicio.split("-").reverse().join("/")} ` : ""}{r.fim ? `até ${r.fim.split("-").reverse().join("/")}` : "sem fim"}</div>}
                <p className="mt-2.5 line-clamp-2 whitespace-pre-wrap break-words text-[13px]" style={{ color: cor.ink2 }}>{r.texto || <span style={{ color: cor.ink3 }}>(sem texto)</span>}</p>
                <div className="mt-3 text-[12.5px]" style={{ color: cor.ink3 }}>
                  {prox.length ? <>Próximos envios: <b style={{ color: cor.ink }}>{prox.map(quandoSP).join(" · ")}</b></> : r.ativo ? "Nenhum envio pela frente (veja as datas de início/fim)." : "Pausada — não cria envios."}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 pt-4">
                  <BotaoGrande pequeno variante="secundario" onClick={() => setAberta(r.id)}>✏️ Editar</BotaoGrande>
                  {confirmando === r.id ? (
                    <>
                      <BotaoGrande pequeno variante="perigo" onClick={() => void apagar(r)}>Sim, excluir</BotaoGrande>
                      <BotaoGrande pequeno variante="secundario" onClick={() => setConfirmando(null)}>Não</BotaoGrande>
                    </>
                  ) : <BotaoGrande pequeno variante="secundario" onClick={() => setConfirmando(r.id)}>🗑 Excluir</BotaoGrande>}
                </div>
                {confirmando === r.id && <p className="mt-2 text-[12px]" style={{ color: cor.ink3 }}>As campanhas que ela já criou continuam em Campanhas (cancele lá se não quiser que saiam).</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FormRecorrencia({ bases, cadencias, inicial, onPronto, onCancelar }: {
  bases: Bases; cadencias: Cadencia[]; inicial?: Recorrencia; onPronto: () => void; onCancelar: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome || "");
  const [dias, setDias] = useState<number[]>(inicial?.dias_semana || [1]);
  const [hora, setHora] = useState((inicial?.hora || "19:00").slice(0, 5));
  const [inicio, setInicio] = useState(inicial?.inicio || "");
  const [fim, setFim] = useState(inicial?.fim || "");
  const [cadenciaId, setCadenciaId] = useState<string>(inicial?.cadencia_id || "");
  const [c, setC] = useState<Conteudo>(() => inicial
    ? { tipo: inicial.tipo, texto: inicial.texto ?? "", midia_url: inicial.midia_url, midia_nome: inicial.midia_nome, enquete_opcoes: inicial.enquete_opcoes,
      enquete_multipla: inicial.enquete_multipla, mencionar_todos: inicial.mencionar_todos, tag_ids: inicial.tag_ids, grupo_jids: inicial.grupo_jids,
      intervalo_min_seg: inicial.intervalo_min_seg, intervalo_max_seg: inicial.intervalo_max_seg }
    : { ...CONTEUDO_VAZIO });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cad = cadencias.find((x) => x.id === cadenciaId) || null;
  const destino = cad ? { tag_ids: cad.tag_ids, grupo_jids: cad.grupo_jids } : { tag_ids: c.tag_ids, grupo_jids: c.grupo_jids };
  const nGrupos = gruposDoDestino(destino, bases.grupos, bases.links).length;
  const prox = useMemo(() => proximasOcorrencias({ dias_semana: dias, hora, inicio: inicio || null, fim: fim || null, ativo: true }), [dias, hora, inicio, fim]);
  const alternaDia = (d: number) => setDias(dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d].sort());

  async function salvar() {
    setErroGeral(null);
    const g = conteudoParaGravar(c);
    const e = problemasDaCampanha({ ...g, ...destino, nome, enviar_em: null }, { exigirData: false });
    if (!nome.trim()) e.nome = "Dê um nome (ex.: Lembrete semanal da comunidade).";
    if (!dias.length) e.dias = "Escolha ao menos um dia.";
    if (!/^\d{2}:\d{2}$/.test(hora)) e.hora = "Escolha a hora.";
    if (inicio && fim && fim < inicio) e.datas = "O fim é antes do início.";
    setErros(e);
    if (Object.keys(e).length) { setErroGeral(e.publico || "Confira os campos marcados."); return; }
    setOcupado(true);
    try {
      await salvarRecorrencia({
        nome: nome.trim(), cadencia_id: cad?.id ?? null, dias_semana: dias, hora, inicio: inicio || null, fim: fim || null, ativo: inicial?.ativo ?? true,
        tipo: g.tipo, texto: g.texto, midia_url: g.midia_url, midia_nome: g.midia_nome, enquete_opcoes: g.enquete_opcoes, enquete_multipla: g.enquete_multipla,
        mencionar_todos: g.mencionar_todos, tag_ids: destino.tag_ids, grupo_jids: destino.grupo_jids,
        intervalo_min_seg: g.intervalo_min_seg, intervalo_max_seg: g.intervalo_max_seg,
      }, inicial?.id);
      onPronto();
    } catch (x) { setErroGeral((x as Error).message); }
    finally { setOcupado(false); }
  }

  return (
    <div>
      <div className="mb-1.5 text-[13px]" style={{ color: cor.ink3 }}>
        <button type="button" onClick={onCancelar} className="hover:underline">Recorrentes</button> / <b style={{ color: cor.ink }}>{inicial ? inicial.nome : "Nova recorrente"}</b>
      </div>
      <h2 className="mb-5 text-[22px] font-semibold" style={{ color: cor.ink }}>{inicial ? "Editar recorrente" : "Nova recorrente"}</h2>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="gr-cartao min-w-0 p-4 sm:p-[22px]">
          <fieldset disabled={ocupado} className="min-w-0">
            <Campo rotulo="Nome" dica="· só pra você achar depois" erro={erros.nome}>
              <input className="rel-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Lembrete semanal da comunidade" />
            </Campo>
            <Campo rotulo="Dias da semana" erro={erros.dias}>
              <div className="flex flex-wrap gap-1.5">
                {DIAS_CURTOS.map((d, i) => <Escolha key={d} ativo={dias.includes(i)} onClick={() => alternaDia(i)}>{d}</Escolha>)}
              </div>
            </Campo>
            <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
              <Campo rotulo="Hora" dica="· Brasília" erro={erros.hora}>
                <input type="time" className="rel-input" value={hora} onChange={(e) => setHora(e.target.value)} />
              </Campo>
              <Campo rotulo="Começa em" dica="· opcional" erro={erros.datas}>
                <input type="date" className="rel-input" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </Campo>
              <Campo rotulo="Termina em" dica="· vazio = sem fim">
                <input type="date" className="rel-input" value={fim} onChange={(e) => setFim(e.target.value)} />
              </Campo>
            </div>
            <div className="mb-5 text-[13px]" style={{ color: cor.ink2 }}>
              🔄 <b>{descreverRecorrencia(dias, hora)}</b>
              {prox.length > 0 && <span style={{ color: cor.ink3 }}> · próximos: {prox.map(quandoSP).join(" · ")}</span>}
            </div>
            <EditorConteudo valor={c} onChange={setC} erros={erros} />
            {cadencias.length > 0 && (
              <Campo rotulo="Faz parte de uma cadência?" dica="· opcional — usa o público dela">
                <select className="rel-input" value={cadenciaId} onChange={(e) => setCadenciaId(e.target.value)}>
                  <option value="">Não — escolho os grupos aqui</option>
                  {cadencias.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </Campo>
            )}
            {cad ? (
              <div className="mb-5"><Nota icone="🧭">Vai para o público da cadência “{cad.nome}”: <b>{resumoPublico(cad, bases.tags)}</b> ({nGrupos} grupos hoje).</Nota></div>
            ) : (
              <SeletorPublico valor={{ tag_ids: c.tag_ids, grupo_jids: c.grupo_jids }} onChange={(v) => setC({ ...c, ...v })}
                grupos={bases.grupos} tags={bases.tags} links={bases.links} erro={erros.publico} />
            )}
            <div className="mb-5">
              <Nota icone="🔄">O motor cria a campanha de cada dia com até 24 h de antecedência — ela aparece em Campanhas e pode ser cancelada antes de sair.</Nota>
            </div>
          </fieldset>
          {erroGeral && <p className="mb-3 text-[14px]" role="alert" style={{ color: "var(--err-ink)" }}>{erroGeral}</p>}
          <div className="flex flex-wrap gap-2.5">
            <BotaoGrande disabled={ocupado} onClick={() => void salvar()}>{ocupado ? "Salvando…" : inicial ? "💾 Salvar" : "🔄 Criar recorrente"}</BotaoGrande>
            <BotaoGrande variante="secundario" onClick={onCancelar}>Cancelar</BotaoGrande>
          </div>
        </div>
        <div className="lg:sticky lg:top-4">
          <PreviaWhatsApp tipo={c.tipo} texto={c.texto} midiaUrl={c.midia_url} midiaNome={c.midia_nome} mencionarTodos={c.mencionar_todos}
            enqueteOpcoes={c.enquete_opcoes} enqueteMultipla={c.enquete_multipla} />
        </div>
      </div>
    </div>
  );
}
