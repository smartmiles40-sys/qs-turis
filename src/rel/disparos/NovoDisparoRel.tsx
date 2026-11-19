// src/rel/disparos/NovoDisparoRel.tsx
// -----------------------------------------------------------------------------
// "+ NOVO DISPARO" do Relacionamento (0408), em passos como no ManyChat:
//   Para quem → Mensagem (modelo, variáveis, mídia, o que cada botão faz) →
//   Quando (agora ou agendado) → Revisar (+ mandar teste pro meu WhatsApp).
// A prévia do WhatsApp fica ao lado e muda enquanto a pessoa monta.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import {
  acaoCampanha, descreverPublico, FONTES, preverTexto, previa as pedirPrevia, variaveisDoCorpo,
  type MapaVariaveis, type Previa, type PublicoRel,
} from "@/lib/qs/disparos";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import PreviaWhatsApp from "@/mkt/disparos/PreviaWhatsApp";
import { ROTULO_CATEGORIA, type FonteExtra } from "@/mkt/disparos/oficial";
import { agendarRel, avisoDoTeste, criarCampanhaRel, testarRel, testarRelNumerosTeste, type EnvioExtraRel, type ModeloRel, type NumeroTeste, type RespostaBotao } from "./oficialRel";
import { CampoEtiquetas, limparPublico, PublicoRelForm, useEtiquetas } from "./PublicoRel";

const FONTES_REL = FONTES.filter((f) => f.setores.includes("relacionamento"));
const PASSOS = ["Para quem", "Mensagem", "Quando", "Revisar"] as const;
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
/** "2026-11-20T09:00" (Brasília) → ISO. */
const localParaIso = (v: string) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00-03:00`).toISOString() : "");

const FONTES_EXTRA: { id: FonteExtra; rotulo: string }[] = [
  { id: "texto", rotulo: "Texto fixo" }, { id: "nome", rotulo: "Primeiro nome" }, { id: "destino", rotulo: "Destino" },
];

function variaveisOkRel(m: ModeloRel | null, mapa: MapaVariaveis) {
  if (!m) return false;
  return variaveisDoCorpo(m.corpo).every((v) => {
    const c = mapa[v];
    if (!c) return false;
    if (c.fonte === "texto") return !!(c.valor ?? "").trim();
    if (c.fonte === "link") return /^https?:\/\/\S+$/i.test(c.valor ?? "");
    return true;
  });
}
function extrasOkRel(m: ModeloRel | null, e: EnvioExtraRel) {
  if (!m) return false;
  if (m.precisaMidia && !/^https:\/\/\S+$/i.test(e.midia?.link ?? "")) return false;
  const temValor = (x?: { fonte: FonteExtra; valor?: string }) => !!x && (x.fonte !== "texto" || !!(x.valor ?? "").trim());
  if ((m.variaveisTopo ?? []).length && !temValor(e.topo)) return false;
  for (const b of m.botoes ?? []) if (b.tipo === "URL" && b.variavel && !temValor(e.botoes?.[String(b.indice)])) return false;
  return true;
}

function Passos({ atual, onIr }: { atual: number; onIr: (i: number) => void }) {
  return (
    <ol className="mb-4 flex flex-wrap gap-1.5" aria-label="Passos">
      {PASSOS.map((p, i) => (
        <li key={p}>
          <button type="button" disabled={i > atual} onClick={() => onIr(i)} aria-current={i === atual ? "step" : undefined}
            className="rounded-full px-3 py-1 text-[12.5px] font-semibold"
            style={i === atual ? { background: "var(--rel)", color: "#fff" } : i < atual ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { background: "var(--card2)", color: "var(--ink3)" }}>
            {i + 1}. {p}
          </button>
        </li>
      ))}
    </ol>
  );
}

function FonteEValor({ v, set, placeholder }: { v?: { fonte: FonteExtra; valor?: string }; set: (x: { fonte: FonteExtra; valor?: string }) => void; placeholder: string }) {
  const fonte = v?.fonte ?? "texto";
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <select className="rel-input" value={fonte} onChange={(e) => set({ fonte: e.target.value as FonteExtra, valor: v?.valor })}>
        {FONTES_EXTRA.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
      </select>
      {fonte !== "nome" ? <Entrada value={v?.valor ?? ""} placeholder={fonte === "destino" ? "Se não achar, usar…" : placeholder} onChange={(e) => set({ fonte, valor: e.target.value })} /> : <span />}
    </div>
  );
}

function RespostaDoBotao({ rotulo, r, set, etiquetas }: { rotulo: string; r: RespostaBotao; set: (r: RespostaBotao) => void; etiquetas: { etiqueta: string; n: number }[] }) {
  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
      <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Quando tocarem em “{rotulo}”</p>
      <Campo rotulo="Responder com" dica="Sai na hora, só no 1º toque. Pode usar {{nome}} e {{destino}}. Vazio = não responde.">
        <textarea className="rel-input min-h-[70px]" value={r.texto ?? ""} placeholder="Ex.: Oba, {{nome}}! Já te mando as datas de 2027 😊"
          onChange={(e) => set({ ...r, texto: e.target.value })} />
      </Campo>
      <div className="grid gap-2 sm:grid-cols-2">
        <Campo rotulo="Pôr a etiqueta"><CampoEtiquetas valor={r.etiqueta ? [r.etiqueta] : []} onChange={(v) => set({ ...r, etiqueta: v[v.length - 1] })} existentes={etiquetas} placeholder="ex.: quente" /></Campo>
        <Campo rotulo="Tirar a etiqueta"><CampoEtiquetas valor={r.tirar_etiqueta ? [r.tirar_etiqueta] : []} onChange={(v) => set({ ...r, tirar_etiqueta: v[v.length - 1] })} existentes={etiquetas} placeholder="ex.: frio" /></Campo>
      </div>
      <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
        <input type="checkbox" checked={!!r.avisar} onChange={(e) => set({ ...r, avisar: e.target.checked })} />
        Avisar no sino quem atende a conversa (ou as gestoras)
      </label>
    </div>
  );
}

export default function NovoDisparoRel({ modelos, simulacao, numerosTeste = [], onFechar, onCriado }: {
  modelos: ModeloRel[]; simulacao: boolean; numerosTeste?: NumeroTeste[]; onFechar: () => void; onCriado: () => void;
}) {
  const etiquetas = useEtiquetas();
  const [passo, setPasso] = useState(0);
  const [publico, setPublico] = useState<PublicoRel>({});
  const [pv, setPv] = useState<Previa | null>(null);
  const [contando, setContando] = useState(false);
  const [modeloNome, setModeloNome] = useState("");
  const [mapa, setMapa] = useState<MapaVariaveis>({});
  const [extra, setExtra] = useState<EnvioExtraRel>({});
  const [grupoLink, setGrupoLink] = useState("");
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [dataHora, setDataHora] = useState("");
  const [nome, setNome] = useState("");
  const [telTeste, setTelTeste] = useState(() => { try { return localStorage.getItem("rel_disparo_tel_teste") ?? ""; } catch { return ""; } });
  const [ocupado, setOcupado] = useState<"" | "criar" | "teste">("");

  const aprovados = useMemo(() => modelos.filter((m) => m.status === "aprovado"), [modelos]);
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;
  const vars = modelo ? variaveisDoCorpo(modelo.corpo) : [];
  const usaGrupo = Object.values(mapa).some((x) => x.fonte === "link_grupo");
  const botoesResposta = (modelo?.botoes ?? []).filter((b) => b.tipo === "QUICK_REPLY" && !/parar/i.test(b.texto));
  const botoesUrl = (modelo?.botoes ?? []).filter((b) => b.tipo === "URL" && b.variavel);
  const limpo = useMemo(() => limparPublico(publico), [publico]);

  // Conta quem recebe enquanto o filtro muda.
  useEffect(() => {
    if (passo !== 0 && passo !== 3) return;
    let vivo = true;
    setContando(true);
    const t = setTimeout(() => {
      pedirPrevia("relacionamento", limpo).then((r) => { if (vivo) setPv(r); }).catch((e) => { if (vivo) { setPv(null); notifyError(erroDe(e, "Não contou.")); } }).finally(() => { if (vivo) setContando(false); });
    }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [limpo, passo]);

  const mensagemOk = variaveisOkRel(modelo, mapa) && extrasOkRel(modelo, extra) && (!usaGrupo || /^https:\/\/chat\.whatsapp\.com\//.test(grupoLink));
  const quandoOk = quando === "agora" || (!!localParaIso(dataHora) && new Date(localParaIso(dataHora)).getTime() > Date.now() + 60_000);
  const podeAvancar = [Boolean(pv && pv.total > 0), mensagemOk, quandoOk, nome.trim().length >= 2][passo];

  const envioExtra = (): EnvioExtraRel => {
    const respostas = Object.fromEntries(Object.entries(extra.respostas ?? {}).filter(([i]) => botoesResposta.some((b) => String(b.indice) === i)));
    return { ...extra, respostas };
  };

  async function testarNaLista() {
    if (!modelo) return;
    setOcupado("teste");
    try {
      const r = await testarRelNumerosTeste({ rascunho: { nome: nome || "teste", modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, envio_extra: envioExtra(), grupo_link: grupoLink || null } });
      (r.erros.length ? notifyError : notifySuccess)(avisoDoTeste(r));
    } catch (e) { notifyError(erroDe(e, "O teste não saiu.")); } finally { setOcupado(""); }
  }

  async function testar() {
    if (!modelo) return;
    setOcupado("teste");
    try {
      try { localStorage.setItem("rel_disparo_tel_teste", telTeste); } catch { /* sem storage */ }
      await testarRel(telTeste, { rascunho: { nome: nome || "teste", modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, envio_extra: envioExtra(), grupo_link: grupoLink || null } });
      notifySuccess("Teste enviado. Confira no WhatsApp.");
    } catch (e) { notifyError(erroDe(e, "O teste não saiu.")); } finally { setOcupado(""); }
  }

  async function criar() {
    if (!modelo) return;
    setOcupado("criar");
    try {
      const { campanha } = await criarCampanhaRel({
        nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico: limpo,
        envio_extra: envioExtra(), grupo_link: usaGrupo ? grupoLink : null,
      });
      if (quando === "agora") {
        const r = await acaoCampanha("iniciar", campanha.id);
        notifySuccess(`${r.total ?? ""} na fila. ${r.simulacao ? "Modo simulação: nada sai de verdade." : "Começa a sair em até 5 minutos."}`);
      } else {
        await agendarRel(campanha.id, localParaIso(dataHora));
        notifySuccess("Disparo agendado.");
      }
      onCriado();
    } catch (e) { notifyError(erroDe(e, "Não criou.")); } finally { setOcupado(""); }
  }

  const balao = modelo ? [{
    titulo: modelo.cabecalho, texto: preverTexto(modelo.corpo, mapa, grupoLink), rodape: modelo.rodape,
    botoes: (modelo.botoes ?? []).map((b) => b.texto),
    midia: modelo.precisaMidia ? { tipo: modelo.cabecalhoFormato ?? "IMAGE", link: extra.midia?.link } : undefined,
  }, ...botoesResposta.slice(0, 1).flatMap((b) => {
    const r = extra.respostas?.[String(b.indice)];
    return r?.texto ? [{ texto: b.texto, daPessoa: true }, { texto: r.texto.replace(/{{\s*nome\s*}}/gi, "Ana").replace(/{{\s*destino\s*}}/gi, "Japão") }] : [];
  })] : [];

  return (
    <Modal aberto titulo="Novo disparo" onFechar={onFechar} largura={1040}
      rodape={<>
        {simulacao && <span className="mr-auto text-[12px]" style={{ color: "var(--warn-ink)" }}>Modo simulação ligado: a fila anda, mas nada sai.</span>}
        {passo > 0 && <Botao variante="fantasma" onClick={() => setPasso(passo - 1)}>Voltar</Botao>}
        {passo < 3
          ? <Botao variante="primario" disabled={!podeAvancar} onClick={() => setPasso(passo + 1)}>Continuar</Botao>
          : <Botao variante="primario" disabled={!podeAvancar || !!ocupado} onClick={() => void criar()}>{ocupado === "criar" ? "Criando…" : quando === "agora" ? "Disparar" : "Agendar"}</Botao>}
      </>}>
      <Passos atual={passo} onIr={setPasso} />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
          {passo === 0 && (
            <>
              <PublicoRelForm p={publico} set={setPublico} etiquetas={etiquetas} />
              <div className="rounded-xl p-3" style={{ background: "var(--card2)" }}>
                {contando ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Contando…</p> : pv && (
                  <div className="space-y-1">
                    <p className="text-[14px]" style={{ color: "var(--ink)" }}><b className="text-[20px] tabular-nums">{pv.total}</b> clientes recebem.</p>
                    {pv.excluidos.map((x) => <p key={x.motivo} className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Saem <b>{x.n}</b> — {x.motivo}</p>)}
                    {!pv.numeroOk && <Aviso tom="erro">O número do Relacionamento não está conectado na Meta.</Aviso>}
                  </div>
                )}
              </div>
            </>
          )}

          {passo === 1 && (
            <>
              {!aprovados.length ? (
                <Aviso>Nenhum modelo aprovado no número do Relacionamento. Crie e aprove o modelo no WhatsApp Manager da Meta e clique em “Sincronizar modelos” (aba Número e ritmo).</Aviso>
              ) : (
                <div role="radiogroup" aria-label="Modelo aprovado" className="grid gap-2 sm:grid-cols-2">
                  {aprovados.map((m) => {
                    const on = m.nome === modeloNome;
                    return (
                      <button key={`${m.nome}:${m.idioma}`} type="button" role="radio" aria-checked={on}
                        onClick={() => { if (!on) { setModeloNome(m.nome); setMapa({}); setExtra({}); } }}
                        className="rounded-xl border p-3 text-left" style={on ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)", background: "var(--card)" }}>
                        <span className="block text-[13px] font-semibold" style={{ color: on ? "var(--rel-ink)" : "var(--ink)" }}>{m.nome}</span>
                        <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                          {ROTULO_CATEGORIA[m.categoriaMeta ?? m.categoria] ?? m.categoria} · {m.idioma}{m.precisaMidia ? ` · ${m.cabecalhoFormato === "VIDEO" ? "vídeo" : m.cabecalhoFormato === "DOCUMENT" ? "documento" : "imagem"}` : ""}{m.botoes?.length ? ` · ${m.botoes.length} botão(ões)` : ""}
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{m.corpo}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {vars.length > 0 && <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>De onde vem cada pedaço variável:</p>}
              {vars.map((v) => (
                <div key={v} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
                  <span className="text-[13px] tabular-nums" style={{ color: "var(--ink3)" }}>{`{{${v}}}`}</span>
                  <select className="rel-input" value={mapa[v]?.fonte ?? ""} onChange={(e) => setMapa({ ...mapa, [v]: { fonte: e.target.value as MapaVariaveis[string]["fonte"] } })}>
                    <option value="">De onde vem?</option>
                    {FONTES_REL.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
                  </select>
                  {["texto", "destino", "link"].includes(mapa[v]?.fonte ?? "")
                    ? <Entrada value={mapa[v]?.valor ?? ""} placeholder={mapa[v]?.fonte === "link" ? "https://… (pra onde o link leva)" : mapa[v]?.fonte === "destino" ? "Se não achar, usar…" : "Texto"}
                        onChange={(e) => setMapa({ ...mapa, [v]: { ...mapa[v], valor: e.target.value } })} />
                    : <span />}
                </div>
              ))}
              {usaGrupo && (
                <Campo rotulo="Link de convite do grupo"><Entrada value={grupoLink} placeholder="https://chat.whatsapp.com/…" onChange={(e) => setGrupoLink(e.target.value.trim())} /></Campo>
              )}

              {modelo && (modelo.precisaMidia || (modelo.variaveisTopo ?? []).length > 0 || botoesUrl.length > 0) && (
                <div className="space-y-3 rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
                  <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Este modelo também pede:</p>
                  {modelo.precisaMidia && (
                    <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
                      <Campo rotulo={`Link da ${modelo.cabecalhoFormato === "VIDEO" ? "vídeo" : modelo.cabecalhoFormato === "DOCUMENT" ? "documento" : "imagem"} do topo (https)`} dica="Link público do arquivo. A Meta baixa a cada envio.">
                        <Entrada value={extra.midia?.link ?? ""} placeholder="https://…" onChange={(e) => setExtra({ ...extra, midia: { ...extra.midia, link: e.target.value.trim() } })} />
                      </Campo>
                      {modelo.cabecalhoFormato === "DOCUMENT" && (
                        <Campo rotulo="Nome do arquivo"><Entrada value={extra.midia?.nome ?? ""} placeholder="roteiro.pdf" onChange={(e) => setExtra({ ...extra, midia: { ...extra.midia, nome: e.target.value } })} /></Campo>
                      )}
                    </div>
                  )}
                  {(modelo.variaveisTopo ?? []).length > 0 && (
                    <Campo rotulo={`Título: ${modelo.cabecalho ?? ""}`}><FonteEValor v={extra.topo} set={(x) => setExtra({ ...extra, topo: x })} placeholder="Texto do título" /></Campo>
                  )}
                  {botoesUrl.map((b) => (
                    <Campo key={b.indice} rotulo={`Botão “${b.texto}” — final do link`}>
                      <FonteEValor v={extra.botoes?.[String(b.indice)]} set={(x) => setExtra({ ...extra, botoes: { ...extra.botoes, [String(b.indice)]: x } })} placeholder="ex.: japao-2027" />
                    </Campo>
                  ))}
                </div>
              )}

              {botoesResposta.map((b) => (
                <RespostaDoBotao key={b.indice} rotulo={b.texto} etiquetas={etiquetas}
                  r={extra.respostas?.[String(b.indice)] ?? {}}
                  set={(r) => setExtra({ ...extra, respostas: { ...extra.respostas, [String(b.indice)]: r } })} />
              ))}
              {modelo && !botoesResposta.length && (
                <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                  Dica: modelo com botões de resposta rápida (ex.: “Quero saber mais”) deixa você responder sozinho e etiquetar quem tocou, igual ao ManyChat.
                </p>
              )}
            </>
          )}

          {passo === 2 && (
            <div className="space-y-3">
              {(["agora", "agendar"] as const).map((q) => (
                <label key={q} className="flex cursor-pointer items-start gap-2 rounded-xl border p-3" style={{ borderColor: quando === q ? "var(--rel)" : "var(--line)", background: quando === q ? "var(--rel-soft)" : "var(--card)" }}>
                  <input type="radio" name="quando" checked={quando === q} onChange={() => setQuando(q)} className="mt-1" />
                  <span>
                    <b className="block text-[13.5px]" style={{ color: "var(--ink)" }}>{q === "agora" ? "Enviar agora" : "Agendar"}</b>
                    <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{q === "agora" ? "Entra na fila e começa a sair em até 5 minutos, no ritmo do número." : "Escolha o dia e a hora (horário de Brasília)."}</span>
                  </span>
                </label>
              ))}
              {quando === "agendar" && <Campo rotulo="Dia e hora (Brasília)"><Entrada type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} /></Campo>}
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Fora da janela de envio (aba Número e ritmo) a fila espera e continua no próximo horário.</p>
            </div>
          )}

          {passo === 3 && (
            <div className="space-y-3">
              <Campo rotulo="Nome do disparo"><Entrada value={nome} placeholder="Ex.: Datas 2027 — quem foi pro Japão" onChange={(e) => setNome(e.target.value)} /></Campo>
              <dl className="space-y-1.5 text-[13px]" style={{ color: "var(--ink)" }}>
                <div><dt className="inline font-semibold">Para quem: </dt><dd className="inline">{descreverPublico("relacionamento", limpo)} — {contando ? "…" : `${pv?.total ?? 0} clientes`}</dd></div>
                <div><dt className="inline font-semibold">Modelo: </dt><dd className="inline">{modelo?.nome}</dd></div>
                <div><dt className="inline font-semibold">Quando: </dt><dd className="inline">{quando === "agora" ? "agora" : dataHora.replace("T", " às ")}</dd></div>
                {botoesResposta.some((b) => extra.respostas?.[String(b.indice)]) && (
                  <div><dt className="inline font-semibold">Botões: </dt><dd className="inline">{botoesResposta.filter((b) => extra.respostas?.[String(b.indice)]).map((b) => `“${b.texto}”`).join(", ")} com ação</dd></div>
                )}
              </dl>
              <div className="rounded-xl border p-3" style={{ borderColor: "var(--line)" }}>
                <p className="mb-2 text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Mandar um teste antes</p>
                {numerosTeste.length > 0 && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Botao variante="primario" disabled={!!ocupado} onClick={() => void testarNaLista()}>{ocupado === "teste" ? "Enviando…" : `Mandar pros números de teste (${numerosTeste.length})`}</Botao>
                    <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{numerosTeste.map((n) => n.nome).join(", ")}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <div className="min-w-[180px] flex-1"><Entrada value={telTeste} placeholder="DDD + número" onChange={(e) => setTelTeste(e.target.value)} /></div>
                  <Botao disabled={!!ocupado || telTeste.replace(/\D/g, "").length < 10} onClick={() => void testar()}>{ocupado === "teste" ? "Enviando…" : "Mandar teste"}</Botao>
                </div>
                <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink3)" }}>Sai de verdade, agora, só pra esse número. O link vai direto (sem contar clique).</p>
              </div>
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-0 lg:self-start">
          <PreviaWhatsApp baloes={balao} contato="Se Tu For, Eu Vou! · Relacionamento" vazio="Escolha o modelo pra ver a mensagem." />
        </div>
      </div>
    </Modal>
  );
}
