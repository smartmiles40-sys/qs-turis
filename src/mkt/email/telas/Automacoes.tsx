// Marketing › E-mail › aba Automações: sequências automáticas em 3 passos
// (Quem entra → E-mails e esperas → Revisar e ligar), com a prévia do e-mail
// escolhido ao lado. O cron do QS (5 em 5 min) anda a fila.
// Cada pessoa passa UMA vez por automação; descadastro, bounce e spam tiram da sequência.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { erroDoBanco, listarListas, listarModelos, type Automacao, type Lista, type Modelo, type Passo } from "../lib/api";
import { renderEmail } from "../lib/blocos";
import {
  emUnidade, FATOR, PASSOS_AUTOMACAO, pendenciasAutomacao, textoEspera, textoGatilho, type PassoAutomacao, type Unidade,
} from "../lib/assistente";
import { useEmail } from "../contexto";
import { Aviso, Botao, Campo, Cartao, Entrada, Escolha, Etiqueta, OpcaoCartao, Passos, Topo, Vazio } from "../ui";
import { LadoPrevia } from "./LadoPrevia";
import { ComoConectar } from "./Conexao";

/** Trilha visual: ⚑ gatilho → ✉ → ⏱ 2 dias → ✉ … */
function Trilha({ a, modelos, nomesListas }: { a: Automacao; modelos: Modelo[]; nomesListas: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="px-2 py-0.5 rounded-full font-semibold" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{textoGatilho(a, nomesListas)}</span>
      {a.passos.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span aria-hidden style={{ color: "var(--ink3)" }}>→</span>
          {p.tipo === "email"
            ? <span className="px-2 py-0.5 rounded-full" style={{ border: "1px solid var(--line)", color: "var(--ink)" }}>✉ {modelos.find((m) => m.id === p.modelo_id)?.nome ?? "sem modelo"}</span>
            : <span className="px-2 py-0.5 rounded-full" style={{ background: "var(--card2)", color: "var(--ink2)" }}>⏱ {textoEspera(p.minutos)}</span>}
        </span>
      ))}
    </div>
  );
}

function EditorAutomacao({ a, listas, modelos, onVoltar }: { a: Automacao; listas: Lista[]; modelos: Modelo[]; onVoltar: () => void }) {
  const { cfg, conectado } = useEmail();
  const [x, setX] = useState<Automacao>(a);
  const [passo, setPasso] = useState<PassoAutomacao>(a.passos.length ? "sequencia" : "gatilho");
  const [sel, setSel] = useState<number>(() => Math.max(0, a.passos.findIndex((p) => p.tipo === "email")));
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [mexido, setMexido] = useState(false);
  const [contagem, setContagem] = useState<Record<string, number>>({});

  useEffect(() => {
    supabase.from("mkt_email_auto_execucoes").select("status").eq("automacao_id", a.id).limit(5000).then(({ data }) => {
      const c: Record<string, number> = {};
      for (const r of data ?? []) c[(r as { status: string }).status] = (c[(r as { status: string }).status] ?? 0) + 1;
      setContagem(c);
    });
  }, [a.id]);

  const pend = pendenciasAutomacao(x);
  const nomesListas = Object.fromEntries(listas.map((l) => [l.id, l.nome]));
  const mudar = (p: Partial<Automacao>) => { setX((v) => ({ ...v, ...p })); setMexido(true); };
  const trocarPasso = (i: number, p: Passo) => mudar({ passos: x.passos.map((q, j) => (j === i ? p : q)) });

  const salvar = async (ativo = x.ativo) => {
    const { error } = await supabase.from("mkt_email_automacoes").update({
      nome: x.nome.trim() || "Sem nome", ativo, gatilho_tipo: x.gatilho_tipo,
      gatilho_valor: x.gatilho_valor?.trim() || null, passos: x.passos,
    }).eq("id", x.id);
    // 04/11/2026: o CHECK do gatilho (lista/tag sem valor) voltava em inglês cru ao trocar de passo.
    if (error) { setMsg({ tom: "erro", texto: /passos_chk/.test(error.message) ? "Confira os passos: todo e-mail precisa de modelo e toda espera vai de 1 minuto a 90 dias." : /automacoes_check/.test(error.message) ? "Ainda não salvou: escolha a lista (ou escreva a tag) de quem entra." : erroDoBanco(error) }); return false; }
    setX((v) => ({ ...v, ativo })); setMexido(false);
    setMsg({ tom: "ok", texto: ativo !== x.ativo ? (ativo ? "Automação LIGADA: quem entrar a partir de agora começa a sequência." : "Automação desligada: quem está no meio espera até religar.") : "Salvo." });
    return true;
  };
  const ir = (p: PassoAutomacao) => { if (mexido) void salvar(); setPasso(p); window.scrollTo(0, 0); };
  const i = PASSOS_AUTOMACAO.findIndex((p) => p.id === passo);

  // Prévia: o e-mail do passo escolhido (ou o primeiro).
  const passoSel = x.passos[sel];
  const modeloSel = passoSel?.tipo === "email" ? modelos.find((m) => m.id === passoSel.modelo_id) : undefined;
  const htmlPrevia = useMemo(
    () => (modeloSel ? renderEmail(modeloSel.blocos ?? [], { rodapeTexto: cfg?.config.rodape_texto, rodapeEndereco: cfg?.config.rodape_endereco }) : ""),
    [modeloSel, cfg?.config.rodape_texto, cfg?.config.rodape_endereco],
  );
  const adicionar = (p: Passo) => { mudar({ passos: [...x.passos, p] }); if (p.tipo === "email") setSel(x.passos.length); };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Botao variante="fantasma" onClick={() => { if (mexido) void salvar(); onVoltar(); }}>← Automações</Botao>
        <h2 className="text-[17px] font-bold truncate" style={{ color: "var(--ink)" }}>{x.nome || "Automação"}</h2>
        {x.ativo ? <Etiqueta tom="ok">Ligada</Etiqueta> : <Etiqueta>Desligada</Etiqueta>}
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Em andamento: {contagem.ativa ?? 0} · concluídas: {contagem.concluida ?? 0} · canceladas: {contagem.cancelada ?? 0}</span>
        <span className="ml-auto" />
        <Botao disabled={!mexido} onClick={() => void salvar()}>Salvar</Botao>
      </div>
      <Passos passos={PASSOS_AUTOMACAO} atual={passo} pendencias={pend} onIr={ir} />
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5">
        <div className="min-w-0 space-y-4">
          {passo === "gatilho" ? (
            <>
              <Cartao>
                <Campo rotulo="Nome da automação (só a equipe vê)"><Entrada value={x.nome} onChange={(e) => mudar({ nome: e.target.value })} placeholder="Ex.: Boas-vindas de quem baixou o roteiro" /></Campo>
              </Cartao>
              <Cartao className="space-y-3">
                <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Quando a pessoa entra na sequência?</div>
                <div role="radiogroup" aria-label="Gatilho" className="grid sm:grid-cols-3 gap-3">
                  <OpcaoCartao icone="📋" titulo="Entrou numa lista" texto="Ex.: lista de interessados no Japão." marcado={x.gatilho_tipo === "lista"} onEscolher={() => mudar({ gatilho_tipo: "lista", gatilho_valor: null })} />
                  <OpcaoCartao icone="🏷" titulo="Ganhou uma tag" texto="Ex.: quem foi marcado como vip." marcado={x.gatilho_tipo === "tag"} onEscolher={() => mudar({ gatilho_tipo: "tag", gatilho_valor: null })} />
                  <OpcaoCartao icone="📝" titulo="Respondeu um formulário" texto="Ex.: formulário de uma LP." marcado={x.gatilho_tipo === "formulario"} onEscolher={() => mudar({ gatilho_tipo: "formulario", gatilho_valor: null })} />
                </div>
                <div className="max-w-md">
                  {x.gatilho_tipo === "lista" ? (
                    <Campo rotulo="Qual lista">
                      <Escolha value={x.gatilho_valor ?? ""} onChange={(e) => mudar({ gatilho_valor: e.target.value || null })}>
                        <option value="">— escolha —</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                      </Escolha>
                    </Campo>
                  ) : (
                    <Campo rotulo={x.gatilho_tipo === "tag" ? "Qual tag" : "Nome do formulário (opcional)"} dica={x.gatilho_tipo === "formulario" ? "Em branco = qualquer formulário." : undefined}>
                      <Entrada value={x.gatilho_valor ?? ""} onChange={(e) => mudar({ gatilho_valor: e.target.value })} />
                    </Campo>
                  )}
                </div>
              </Cartao>
            </>
          ) : null}

          {passo === "sequencia" ? (
            <Cartao>
              <div className="text-[15px] font-bold mb-3" style={{ color: "var(--ink)" }}>O que acontece, em ordem</div>
              <ol className="relative space-y-2">
                <li className="flex items-center gap-3 text-[13px]">
                  <span aria-hidden className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--rel)", color: "#fff" }}>⚑</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{textoGatilho(x, nomesListas)}</span>
                </li>
                {x.passos.map((p, k) => {
                  const [n, u] = p.tipo === "esperar" ? emUnidade(p.minutos) : [0, "dias" as Unidade];
                  const ativo = k === sel && p.tipo === "email";
                  return (
                    <li key={k} className="flex items-start gap-3">
                      <span aria-hidden className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[14px]"
                        style={p.tipo === "email" ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { background: "var(--card2)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
                        {p.tipo === "email" ? "✉" : "⏱"}
                      </span>
                      <div className="flex-1 min-w-0 rounded-xl p-2.5 flex flex-wrap gap-2 items-center"
                        style={{ border: `1.5px solid ${ativo ? "var(--rel)" : "var(--line)"}` }}
                        onClick={() => p.tipo === "email" && setSel(k)}>
                        {p.tipo === "email" ? (
                          <>
                            <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Enviar o e-mail</span>
                            <Escolha className="!w-auto flex-1 min-w-[180px]" value={p.modelo_id} aria-label={`Modelo do passo ${k + 1}`}
                              onFocus={() => setSel(k)} onChange={(e) => { trocarPasso(k, { tipo: "email", modelo_id: e.target.value }); setSel(k); }}>
                              <option value="">— escolha o modelo —</option>{modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                            </Escolha>
                          </>
                        ) : (
                          <>
                            <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Esperar</span>
                            <Entrada className="!w-20" type="number" min={1} value={n} aria-label={`Quanto esperar no passo ${k + 1}`}
                              onChange={(e) => trocarPasso(k, { tipo: "esperar", minutos: Math.max(1, Number(e.target.value) || 1) * FATOR[u] })} />
                            <Escolha className="!w-28" value={u} aria-label="Unidade" onChange={(e) => trocarPasso(k, { tipo: "esperar", minutos: n * FATOR[e.target.value as Unidade] })}>
                              <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
                            </Escolha>
                          </>
                        )}
                        <Botao variante="fantasma" className="ml-auto" aria-label={`Remover o passo ${k + 1}`}
                          onClick={(e) => { e.stopPropagation(); mudar({ passos: x.passos.filter((_, j) => j !== k) }); if (sel >= k) setSel(Math.max(0, sel - 1)); }}>✕</Botao>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <div className="flex flex-wrap gap-2 mt-3 pl-11">
                <Botao onClick={() => adicionar({ tipo: "esperar", minutos: 1440 })}>+ Esperar</Botao>
                <Botao onClick={() => adicionar({ tipo: "email", modelo_id: "" })}>+ E-mail</Botao>
              </div>
              {modelos.length === 0 ? <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Crie um modelo na aba Modelos antes — cada e-mail da sequência usa um.</p> : null}
            </Cartao>
          ) : null}

          {passo === "revisar" ? (
            <>
              {!conectado ? <ComoConectar compacto /> : null}
              <Cartao className="space-y-3">
                <div className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Como vai funcionar</div>
                <Trilha a={x} modelos={modelos} nomesListas={nomesListas} />
                <ul className="text-[13px] list-disc pl-5 space-y-1" style={{ color: "var(--ink2)" }}>
                  <li>Cada pessoa passa <b>uma vez</b> por esta automação.</li>
                  <li>Quem descadastra, dá bounce ou marca spam <b>sai da sequência</b> na hora.</li>
                  <li>Desligar segura quem está no meio; continua de onde parou quando religar.</li>
                  <li>Todo e-mail sai com o rodapé de descadastro e os dados da empresa.</li>
                </ul>
              </Cartao>
              {pend.revisar.length ? <Aviso><b>Falta:</b><ul className="list-disc pl-5 mt-1">{pend.revisar.map((p) => <li key={p}>{p}</li>)}</ul></Aviso> : null}
              <div className="flex flex-wrap gap-2">
                {x.ativo
                  ? <Botao variante="perigo" onClick={() => void salvar(false)}>Desligar</Botao>
                  : <Botao variante="primario" className="!px-5 !py-2.5 !text-[14px]" disabled={pend.revisar.length > 0 || !conectado} onClick={() => void salvar(true)}>Salvar e ligar</Botao>}
              </div>
            </>
          ) : null}

          <div className="flex justify-between gap-2">
            <Botao disabled={i === 0} onClick={() => ir(PASSOS_AUTOMACAO[i - 1].id)}>← Voltar</Botao>
            {i < PASSOS_AUTOMACAO.length - 1 ? <Botao variante="primario" onClick={() => ir(PASSOS_AUTOMACAO[i + 1].id)}>Próximo: {PASSOS_AUTOMACAO[i + 1].rotulo} →</Botao> : null}
          </div>
        </div>
        {modeloSel
          ? <LadoPrevia html={htmlPrevia} assunto={modeloSel.assunto} preheader={modeloSel.preheader} remetente={cfg?.config.remetente_nome} />
          : (
            <aside className="lg:sticky lg:top-4 self-start rel-card p-5 text-center text-[13px]" style={{ color: "var(--ink3)" }}>
              <div aria-hidden className="text-[28px] mb-1">✉</div>
              A prévia do e-mail aparece aqui quando você escolher o modelo de um passo da sequência.
            </aside>
          )}
      </div>
    </div>
  );
}

export default function Automacoes() {
  const { carregando: conferindo, conectado } = useEmail();
  const [lista, setLista] = useState<Automacao[] | null>(null);
  const [aberta, setAberta] = useState<Automacao | null>(null);
  const [listas, setListas] = useState<Lista[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = () => supabase.from("mkt_email_automacoes").select("*").order("criado_em", { ascending: false }).then(({ data }) => setLista((data ?? []) as Automacao[]));
  useEffect(() => { void carregar(); listarListas().then(setListas); listarModelos().then(setModelos); }, []);

  const nova = async () => {
    const { data, error } = await supabase.from("mkt_email_automacoes")
      .insert({ nome: "Boas-vindas", gatilho_tipo: "formulario", gatilho_valor: null, passos: [] }).select("*").single();
    if (error) return setErro(erroDoBanco(error));
    setAberta(data as Automacao);
  };
  const apagar = async (a: Automacao) => {
    if (!window.confirm(`Apagar "${a.nome}"? Quem está no meio para de receber.`)) return;
    const { error } = await supabase.from("mkt_email_automacoes").delete().eq("id", a.id);
    if (error) setErro(erroDoBanco(error)); else void carregar();
  };

  const nomesListas = Object.fromEntries(listas.map((l) => [l.id, l.nome]));
  if (aberta) return <EditorAutomacao a={aberta} listas={listas} modelos={modelos} onVoltar={() => { setAberta(null); void carregar(); }} />;
  return (
    <div>
      {!conferindo && !conectado ? <ComoConectar compacto={Boolean(lista?.length)} /> : null}
      <Topo titulo="Automações" texto="Sequências que andam sozinhas: alguém entra → recebe os e-mails, com esperas no meio." acoes={<Botao variante="primario" onClick={() => void nova()}>+ Nova automação</Botao>} />
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma automação ainda" texto="Ex.: quem responde o formulário recebe as boas-vindas na hora e, dois dias depois, o roteiro." acao={<Botao variante="primario" onClick={() => void nova()}>Criar a primeira</Botao>} /></div>
      ) : (
        <ul className="space-y-2">
          {lista.map((a) => (
            <li key={a.id} className="rel-card rel-linha p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setAberta(a)}>
                <span className="flex items-center gap-2 mb-1.5">
                  <span className="text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{a.nome}</span>
                  {a.ativo ? <Etiqueta tom="ok">Ligada</Etiqueta> : <Etiqueta>Desligada</Etiqueta>}
                </span>
                <Trilha a={a} modelos={modelos} nomesListas={nomesListas} />
              </button>
              <span className="flex gap-1">
                <Botao onClick={() => setAberta(a)}>Editar</Botao>
                <Botao variante="fantasma" onClick={() => void apagar(a)}>Apagar</Botao>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
