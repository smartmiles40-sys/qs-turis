// src/mkt/planejamento/PlanejamentoDetalhe.tsx — um planejamento (0395).
//   Interno em rascunho/devolvido → o time edita e envia.
//   Enviado → supervisores deixam obs por conteúdo e aprovam ou devolvem.
//   Da agência → o time só lê (quem edita é a agência, no portal).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Modal } from "@/rel/ui";
import { useMkt } from "../contexto";
import { irMkt } from "../navegacao";
import { NOME_VISAO } from "../menu";
import { NOME_PERIODICIDADE, faltasDoPlanejamento, textoDasFaltas, type ItemPlano } from "./regras";
import {
  apagarPlanejamento, decidirPlanejamento, deixarObs, enviarPlanejamento, erroDePlano, lerPlanejamento, linkDoPdf,
  listarPerfis, resolverObs, salvarItens, type ItemSalvo, type Obs, type Perfil, type Planejamento,
} from "./dados";
import ItensEditor, { dataCurta, quando, type ObsVista } from "./ItensEditor";
import { ChipStatusPlano } from "./PlanejamentosPage";

export default function PlanejamentoDetalhe({ id }: { id: string }) {
  const { nomeDe, supervisorDe } = useMkt();
  const [plano, setPlano] = useState<Planejamento | null>(null);
  const [itens, setItens] = useState<ItemPlano[]>([]);
  const [salvos, setSalvos] = useState<ItemSalvo[]>([]);
  const [obs, setObs] = useState<Obs[]>([]);
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [mexido, setMexido] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [tentouEnviar, setTentouEnviar] = useState(false);
  const [obsAberta, setObsAberta] = useState<string | "geral" | null>(null);
  const [textoObs, setTextoObs] = useState("");
  const [decidindo, setDecidindo] = useState<"aprovado" | "devolvido" | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [r, pf] = await Promise.all([lerPlanejamento(id), listarPerfis(true)]);
      setPerfis(pf);
      if (!r) { setErro("Planejamento não encontrado."); return; }
      setPlano(r.plano); setSalvos(r.itens); setItens(r.itens); setObs(r.obs); setMexido(false); setErro(null);
    } catch (e) { setErro(erroDePlano(e)); }
    finally { setCarregando(false); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const ativos = useMemo(() => perfis.filter((p) => p.ativo), [perfis]);
  const editavel = !!plano && plano.origem === "interno" && (plano.status === "rascunho" || plano.status === "devolvido");
  const souSupDoTime = !!plano && supervisorDe(plano.time);
  const souSup = supervisorDe("organico") || supervisorDe("trafego");
  const podeDecidir = !!plano && plano.status === "enviado" && souSupDoTime;
  const podeObs = !!plano && souSup && plano.status !== "aprovado";

  const pendencias = useMemo(() => plano ? faltasDoPlanejamento(plano, itens, ativos.map((p) => p.id)) : [], [plano, itens, ativos]);

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (!plano) return <div className="max-w-3xl mx-auto"><Aviso tom="erro">{erro ?? "Planejamento não encontrado."}</Aviso><Voltar /></div>;

  const rotuloTime = (o: Obs) => o.autor_agencia ? "agência" : o.time ? `supervisão ${NOME_VISAO[o.time]}` : undefined;
  const vista = (o: Obs): ObsVista => ({
    id: o.id, autor: o.autor_agencia ? "Agência" : nomeDe(o.autor_id), texto: o.texto, rotulo: rotuloTime(o),
    resolvida: o.resolvida, criado_em: o.criado_em, daAgencia: !!o.autor_agencia,
  });
  const obsGerais = obs.filter((o) => !o.item_id);
  const ia = plano.ia_revisao;
  const avisosPorConteudo = (n: number) => (ia?.avisos ?? [])
    .filter((a): a is { conteudo: number | null; aviso: string } => typeof a === "object" && a?.conteudo === n + 1)
    .map((a) => a.aviso);
  const avisosGerais = (ia?.avisos ?? []).filter((a) => typeof a === "string" || a?.conteudo == null).map((a) => (typeof a === "string" ? a : a.aviso));

  async function salvar(): Promise<boolean> {
    setOcupado(true); setErro(null); setOk(null);
    try { await salvarItens(plano!.id, itens); await carregar(); setOk("Salvo."); return true; }
    catch (e) { setErro(erroDePlano(e)); return false; }
    finally { setOcupado(false); }
  }

  async function enviar() {
    setTentouEnviar(true);
    if (pendencias.length) { setErro("Complete o que está em vermelho antes de enviar."); return; }
    if (mexido && !(await salvar())) return;
    setOcupado(true); setErro(null);
    try {
      const r = await enviarPlanejamento(plano!.id);
      if (!r.ok) { setErro("Ainda falta: " + textoDasFaltas(r.faltas ?? []).join(" · ")); return; }
      setOk("Enviado para os supervisores.");
      await carregar();
    } catch (e) { setErro(erroDePlano(e)); }
    finally { setOcupado(false); }
  }

  async function mandarObs(itemId: string | null) {
    if (textoObs.trim().length < 2) return;
    setOcupado(true); setErro(null);
    try { await deixarObs(plano!.id, itemId, textoObs.trim()); setTextoObs(""); setObsAberta(null); await carregar(); }
    catch (e) { setErro(erroDePlano(e)); }
    finally { setOcupado(false); }
  }

  async function decidir(decisao: "aprovado" | "devolvido") {
    setOcupado(true); setErro(null);
    try {
      const r = await decidirPlanejamento(plano!.id, decisao, textoObs);
      setDecidindo(null); setTextoObs("");
      setOk(decisao === "aprovado" ? `Aprovado — ${r.cards ?? 0} card(s) criados no Quadro de conteúdo.` : "Devolvido com as obs.");
      await carregar();
    } catch (e) { setErro(erroDePlano(e)); }
    finally { setOcupado(false); }
  }

  async function abrirPdf() {
    try { window.open(await linkDoPdf(plano!.documento_path!), "_blank", "noopener"); }
    catch (e) { setErro(erroDePlano(e)); }
  }

  async function apagar() {
    if (!window.confirm("Apagar esse rascunho?")) return;
    try { await apagarPlanejamento(plano!.id); irMkt("planejamentos"); }
    catch (e) { setErro(erroDePlano(e)); }
  }

  const caixaObs = (alvo: string | "geral") => obsAberta === alvo && (
    <div className="w-full space-y-2">
      <textarea className="rel-input" rows={3} autoFocus value={textoObs} maxLength={4000}
        aria-label="Obs do supervisor" placeholder="O que precisa mudar?" onChange={(e) => setTextoObs(e.target.value)} />
      <div className="flex gap-2">
        <Botao variante="primario" disabled={ocupado || textoObs.trim().length < 2} onClick={() => mandarObs(alvo === "geral" ? null : alvo)}>Salvar obs</Botao>
        <Botao variante="fantasma" onClick={() => { setObsAberta(null); setTextoObs(""); }}>Cancelar</Botao>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto pb-24">
      <Voltar />
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>{plano.titulo}</h1>
          <ChipStatusPlano status={plano.status} />
        </div>
        <p className="text-[13px] mt-1" style={{ color: "var(--ink3)" }}>
          {plano.origem === "agencia" ? "Da agência" : `Do time · criado por ${nomeDe(plano.criado_por)}`} · {NOME_PERIODICIDADE[plano.periodicidade]} ·{" "}
          {dataCurta(plano.periodo_inicio)}{plano.periodo_fim !== plano.periodo_inicio ? ` a ${dataCurta(plano.periodo_fim)}` : ""} · {NOME_VISAO[plano.time]}
          {plano.rodada > 0 ? ` · ${plano.rodada}ª rodada` : ""}
          {plano.decidido_em ? ` · ${plano.status === "aprovado" ? "aprovado" : "decidido"} por ${nomeDe(plano.decidido_por)} em ${quando(plano.decidido_em)}` : ""}
        </p>
        {(plano.documento_path || plano.documento_link) && (
          <div className="flex flex-wrap gap-2 mt-2">
            {plano.documento_path && <Botao onClick={abrirPdf}>Ver documento original (PDF)</Botao>}
            {plano.documento_link && <a className="text-[13px] underline self-center" style={{ color: "var(--rel-ink)" }} href={plano.documento_link} target="_blank" rel="noopener noreferrer">Google Docs original</a>}
          </div>
        )}
      </header>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      {ok && <div className="mb-3"><Aviso tom="ok">{ok}</Aviso></div>}

      {ia && (ia.resumo || avisosGerais.length > 0 || (ia.avisos_leitura?.length ?? 0) > 0 || ia.erro) && (
        <section className="rel-card p-4 mb-4" aria-label="Revisão da IA">
          <h2 className="text-[13px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>✦ Revisão da IA</h2>
          {ia.resumo && <p className="text-[14px]" style={{ color: "var(--ink)" }}>{ia.resumo}</p>}
          {ia.erro && <p className="text-[13px]" style={{ color: "var(--warn-ink)" }}>{ia.erro}</p>}
          {[...(ia.avisos_leitura ?? []), ...avisosGerais].length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] list-disc pl-5" style={{ color: "var(--ink2)" }}>
              {[...(ia.avisos_leitura ?? []), ...avisosGerais].map((a, k) => <li key={k}>{a}</li>)}
            </ul>
          )}
        </section>
      )}

      {plano.status === "devolvido" && obs.some((o) => !o.resolvida && !o.autor_agencia) && (
        <div className="mb-4"><Aviso>Devolvido: veja as obs em amarelo, ajuste e envie de novo.</Aviso></div>
      )}

      <ItensEditor
        itens={itens}
        onChange={editavel ? (n) => { setItens(n); setMexido(true); } : undefined}
        perfis={(editavel ? ativos : perfis).map((p) => ({ id: p.id, nome: p.nome, rede: p.rede }))}
        periodo={plano}
        mostrarFaltas={!editavel || tentouEnviar}
        avisosDoItem={avisosPorConteudo}
        obsDoItem={(i) => obs.filter((o) => o.item_id && o.item_id === i.id).map(vista)}
        acoesDoItem={(i) => {
          const s = salvos.find((x) => x.id === i.id);
          const abertas = obs.filter((o) => o.item_id === i.id && !o.resolvida && !o.autor_agencia);
          return (
            <>
              {podeObs && i.id && obsAberta !== i.id && <Botao variante="fantasma" onClick={() => { setObsAberta(i.id!); setTextoObs(""); }}>+ Obs neste conteúdo</Botao>}
              {i.id && caixaObs(i.id)}
              {editavel && abertas.map((o) => (
                <Botao key={o.id} variante="fantasma" onClick={() => void resolverObs(o.id, true).then(carregar)}>Marcar obs como resolvida</Botao>
              ))}
              {s?.card_id && <Botao variante="fantasma" onClick={() => irMkt("quadro", s.card_id!)}>Abrir card no Quadro ›</Botao>}
            </>
          );
        }}
        vazio={editavel ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Adicione os conteúdos do {plano.periodicidade === "diario" ? "dia" : "período"}.</p> : undefined}
      />

      {(obsGerais.length > 0 || podeObs) && (
        <section className="rel-card p-4 mt-4" aria-label="Obs gerais">
          <h2 className="text-[13px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink3)" }}>Obs sobre o planejamento todo</h2>
          <div className="space-y-2">
            {obsGerais.map((o) => {
              const v = vista(o);
              return (
                <div key={o.id} className="rounded-lg px-3 py-2 text-[13px]" style={{ background: o.resolvida ? "var(--card2)" : "var(--warn-bg)", opacity: o.resolvida ? 0.7 : 1 }}>
                  <div className="text-[11.5px] mb-0.5" style={{ color: "var(--ink3)" }}><b style={{ color: "var(--ink2)" }}>{v.autor}</b>{v.rotulo ? ` · ${v.rotulo}` : ""} · {quando(o.criado_em)}</div>
                  <p className="whitespace-pre-wrap">{o.texto}</p>
                </div>
              );
            })}
          </div>
          {podeObs && obsAberta !== "geral" && <Botao className="mt-2" variante="fantasma" onClick={() => { setObsAberta("geral"); setTextoObs(""); }}>+ Obs geral</Botao>}
          <div className="mt-2">{caixaObs("geral")}</div>
        </section>
      )}

      {/* Barra de ações fixa embaixo */}
      {(editavel || podeDecidir) && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 py-3 flex flex-wrap justify-end gap-2"
          style={{ background: "var(--card)", borderTop: "1px solid var(--line)" }}>
          {editavel && (
            <>
              {tentouEnviar && pendencias.length > 0 && (
                <span className="self-center text-[13px] mr-auto" style={{ color: "var(--err-ink)" }}>
                  {pendencias.length} conteúdo(s) incompleto(s)
                </span>
              )}
              {plano.status === "rascunho" && <Botao variante="fantasma" onClick={apagar}>Apagar rascunho</Botao>}
              <Botao disabled={ocupado || !mexido} onClick={() => void salvar()}>{mexido ? "Salvar" : "Salvo"}</Botao>
              <Botao variante="primario" disabled={ocupado} onClick={enviar}>Enviar para os supervisores</Botao>
            </>
          )}
          {podeDecidir && (
            <>
              <Botao variante="perigo" disabled={ocupado} onClick={() => { setDecidindo("devolvido"); setTextoObs(""); }}>Devolver</Botao>
              <Botao variante="primario" disabled={ocupado} onClick={() => { setDecidindo("aprovado"); setTextoObs(""); }}>Aprovar e mandar pra produção</Botao>
            </>
          )}
        </div>
      )}

      {decidindo && (
        <Modal aberto titulo={decidindo === "aprovado" ? "Aprovar planejamento" : "Devolver planejamento"} onFechar={() => setDecidindo(null)}
          rodape={<>
            <Botao onClick={() => setDecidindo(null)}>Cancelar</Botao>
            <Botao variante={decidindo === "aprovado" ? "primario" : "perigo"} disabled={ocupado} onClick={() => decidir(decidindo)}>
              {decidindo === "aprovado" ? "Aprovar" : "Devolver"}
            </Botao>
          </>}>
          <p className="text-[14px] mb-3" style={{ color: "var(--ink2)" }}>
            {decidindo === "aprovado"
              ? `Cada um dos ${itens.length} conteúdos vira um card no Quadro de conteúdo, com data, horário e onde postar.${plano.origem === "agencia" ? " A agência passa a ver esses cards no portal pra mandar o link do Canva." : ""}`
              : `Volta para ${plano.origem === "agencia" ? "a agência" : "quem montou"} ajustar. As obs que você deixou nos conteúdos vão junto.`}
          </p>
          <textarea className="rel-input" rows={3} value={textoObs} maxLength={4000} onChange={(e) => setTextoObs(e.target.value)}
            aria-label="Obs" placeholder={decidindo === "aprovado" ? "Obs (opcional)" : "Obs geral (obrigatória se você não deixou obs nos conteúdos)"} />
        </Modal>
      )}
    </div>
  );
}

function Voltar() {
  return (
    <button type="button" onClick={() => irMkt("planejamentos")} className="text-[13px] mb-3 inline-flex items-center gap-1" style={{ color: "var(--ink3)" }}>
      ‹ Planejamentos
    </button>
  );
}
