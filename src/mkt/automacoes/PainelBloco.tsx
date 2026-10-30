// src/mkt/automacoes/PainelBloco.tsx
// O painel lateral do editor: edita o bloco selecionado. Um formulário por tipo.
// Os limites (20 caracteres por botão, 3 botões, 10 itens…) são os da Meta —
// os contadores mostram quanto falta; validarGrafo barra na hora de ativar.
import { useEffect, type ReactNode } from "react";
import {
  LIMITES, ROTULO_TIPO, novoId,
  type Acao, type Bloco, type CampoPersonalizado, type Fluxo, type Interacao, type No, type Regra,
} from "./tipos";
import type { ModeloMkt } from "./api";
import { AreaTexto, Aviso, Botao, Campo, Entrada, Selecao } from "./ui";

type Props = {
  no: No; campos: CampoPersonalizado[]; fluxos: Fluxo[]; modelos: ModeloMkt[] | null; usuarios: { id: string; name: string }[];
  precisaModelos: () => void; onMudar: (no: No) => void; onApagar: () => void; onDuplicar: () => void; onFechar: () => void;
};

const Conta = ({ n, max }: { n: number; max: number }) => <span style={{ color: n > max ? "var(--err-ink, #B91C1C)" : "var(--ink3)" }}>{n}/{max}</span>;
const Grupo = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <div className="space-y-2 pt-3 mt-3 border-t" style={{ borderColor: "var(--line)" }}>
    <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{titulo}</div>
    {children}
  </div>
);
const Remover = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} aria-label="Remover" className="px-1.5 text-lg leading-none" style={{ color: "var(--ink3)" }}>×</button>;

const MARCADORES = "{{primeiro_nome}}, {{nome}}, {{telefone}}, {{email}} ou {{chave_do_campo}}";

export default function PainelBloco(p: Props) {
  const { no, onMudar } = p;
  // patch tipado frouxo: cada editor sabe o formato dos seus dados
  const dados = (patch: Record<string, unknown>) => onMudar({ ...no, dados: { ...(no.dados as object), ...patch } } as No);

  return (
    <div className="text-[13px]">
      <div className="flex items-center gap-2 mb-3">
        <strong className="text-[14px]" style={{ color: "var(--ink)" }}>{ROTULO_TIPO[no.tipo]}</strong>
        <span className="flex-1" />
        {no.tipo !== "inicio" && <Botao variante="fantasma" onClick={p.onDuplicar}>Duplicar</Botao>}
        {no.tipo !== "inicio" && <Botao variante="perigo" onClick={() => { if (window.confirm("Apagar este bloco e as setas dele?")) p.onApagar(); }}>Apagar</Botao>}
        <button type="button" onClick={p.onFechar} aria-label="Fechar" className="text-lg px-1" style={{ color: "var(--ink3)" }}>×</button>
      </div>
      {no.tipo !== "inicio" && (
        <Campo rotulo="Nome do bloco (só para você)"><Entrada value={no.titulo ?? ""} onChange={(e) => onMudar({ ...no, titulo: e.target.value } as No)} placeholder="ex.: Boas-vindas" /></Campo>
      )}
      {no.tipo === "inicio" && <Aviso>O fluxo começa aqui. Quem faz ele começar são os gatilhos (palavra-chave, link, anúncio, LP…), nas outras abas.</Aviso>}
      {no.tipo === "mensagem" && <EditorMensagem no={no} dados={dados} />}
      {no.tipo === "template" && <EditorTemplate no={no} dados={dados} modelos={p.modelos} precisaModelos={p.precisaModelos} />}
      {no.tipo === "pergunta" && <EditorPergunta no={no} dados={dados} campos={p.campos} />}
      {no.tipo === "aguardar" && <EditorAguardar no={no} dados={dados} />}
      {no.tipo === "condicao" && <EditorCondicao no={no} dados={dados} campos={p.campos} />}
      {no.tipo === "acao" && <EditorAcoes no={no} dados={dados} campos={p.campos} usuarios={p.usuarios} />}
      {no.tipo === "randomizador" && <EditorAB no={no} dados={dados} />}
      {no.tipo === "ir_para" && (
        <Grupo titulo="Destino">
          <Selecao value={no.dados.fluxoId ?? ""} onChange={(e) => dados({ fluxoId: e.target.value || null })}>
            <option value="">(escolha)</option>
            {p.fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.status !== "ativo" ? ` (${f.status})` : ""}</option>)}
          </Selecao>
          <Aviso>A pessoa sai deste fluxo e entra no outro, do Início.</Aviso>
        </Grupo>
      )}
      {no.tipo === "fim" && <Aviso>Encerra o fluxo para esta pessoa.</Aviso>}
    </div>
  );
}

type Ed<T extends No["tipo"]> = { no: Extract<No, { tipo: T }>; dados: (patch: Record<string, unknown>) => void };

function EditorMensagem({ no, dados }: Ed<"mensagem">) {
  const d = no.dados;
  const blocos = d.blocos;
  const it = d.interacao ?? { tipo: "nenhuma" };
  const setBloco = (i: number, b: Bloco) => dados({ blocos: blocos.map((x, j) => (j === i ? b : x)) });
  const setIt = (novo: Interacao) => dados({ interacao: novo });
  return (
    <>
      <Grupo titulo="Conteúdo">
        {blocos.map((b, i) => (
          <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: "var(--card2)" }}>
            <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>
              <span className="font-semibold uppercase">{b.tipo}</span>
              {b.tipo === "texto" && <Conta n={b.texto.length} max={it.tipo !== "nenhuma" && i === blocos.length - 1 ? LIMITES.textoInterativo : LIMITES.texto} />}
              <span className="flex-1" />
              {i > 0 && <button type="button" onClick={() => { const n = [...blocos]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; dados({ blocos: n }); }} aria-label="Subir">↑</button>}
              {blocos.length > 1 && <Remover onClick={() => dados({ blocos: blocos.filter((_, j) => j !== i) })} />}
            </div>
            {b.tipo === "texto"
              ? <AreaTexto rows={4} value={b.texto} onChange={(e) => setBloco(i, { tipo: "texto", texto: e.target.value })} placeholder="Oi {{primeiro_nome}}! …" />
              : <>
                  <Entrada value={b.url} onChange={(e) => setBloco(i, { ...b, url: e.target.value })} placeholder="https://… (link público do arquivo)" />
                  {b.tipo !== "audio" && <Entrada value={b.legenda ?? ""} onChange={(e) => setBloco(i, { ...b, legenda: e.target.value })} placeholder="Legenda (opcional)" />}
                  {b.tipo === "documento" && <Entrada value={b.nome ?? ""} onChange={(e) => setBloco(i, { ...b, nome: e.target.value })} placeholder="Nome do arquivo (ex.: roteiro.pdf)" />}
                </>}
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          {(["texto", "imagem", "video", "audio", "documento"] as const).map((t) => (
            <Botao key={t} variante="fantasma" onClick={() => dados({ blocos: [...blocos, t === "texto" ? { tipo: "texto", texto: "" } : { tipo: t, url: "" }] })}>+ {t}</Botao>
          ))}
        </div>
        <div className="text-[11px]" style={{ color: "var(--ink3)" }}>Marcadores: {MARCADORES}</div>
      </Grupo>

      <Grupo titulo="Botões / lista / link (no último texto)">
        <Selecao value={it.tipo} onChange={(e) => {
          const t = e.target.value as Interacao["tipo"];
          setIt(t === "botoes" ? { tipo: "botoes", botoes: [{ id: novoId("b"), titulo: "" }] }
            : t === "lista" ? { tipo: "lista", rotuloBotao: "Ver opções", secoes: [{ titulo: "", itens: [{ id: novoId("i"), titulo: "" }] }] }
            : t === "link" ? { tipo: "link", rotulo: "Abrir", url: "" } : { tipo: "nenhuma" });
        }}>
          <option value="nenhuma">Nenhum</option>
          <option value="botoes">Botões de resposta (até 3)</option>
          <option value="lista">Lista de opções (até 10)</option>
          <option value="link">Botão de link</option>
        </Selecao>
        {it.tipo === "botoes" && (
          <>
            {it.botoes.map((b, i) => (
              <div key={b.id} className="flex items-center gap-1.5">
                <Entrada value={b.titulo} maxLength={LIMITES.tituloBotao + 5} onChange={(e) => setIt({ ...it, botoes: it.botoes.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) })} placeholder={`Botão ${i + 1}`} />
                <span className="text-[11px] w-10"><Conta n={b.titulo.length} max={LIMITES.tituloBotao} /></span>
                <Remover onClick={() => setIt({ ...it, botoes: it.botoes.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {it.botoes.length < LIMITES.botoes && <Botao variante="fantasma" onClick={() => setIt({ ...it, botoes: [...it.botoes, { id: novoId("b"), titulo: "" }] })}>+ botão</Botao>}
          </>
        )}
        {it.tipo === "lista" && (
          <>
            <Campo rotulo="Texto do botão que abre a lista"><Entrada value={it.rotuloBotao} onChange={(e) => setIt({ ...it, rotuloBotao: e.target.value })} /></Campo>
            {it.secoes.map((s, si) => (
              <div key={si} className="rounded-lg p-2 space-y-1.5" style={{ background: "var(--card2)" }}>
                <div className="flex gap-1.5">
                  <Entrada value={s.titulo} onChange={(e) => setIt({ ...it, secoes: it.secoes.map((x, j) => (j === si ? { ...x, titulo: e.target.value } : x)) })} placeholder="Título da seção (opcional)" />
                  {it.secoes.length > 1 && <Remover onClick={() => setIt({ ...it, secoes: it.secoes.filter((_, j) => j !== si) })} />}
                </div>
                {s.itens.map((item, ii) => (
                  <div key={item.id} className="flex gap-1.5">
                    <Entrada value={item.titulo} onChange={(e) => setIt({ ...it, secoes: it.secoes.map((x, j) => (j === si ? { ...x, itens: x.itens.map((y, k) => (k === ii ? { ...y, titulo: e.target.value } : y)) } : x)) })} placeholder="Opção" />
                    <Entrada value={item.descricao ?? ""} onChange={(e) => setIt({ ...it, secoes: it.secoes.map((x, j) => (j === si ? { ...x, itens: x.itens.map((y, k) => (k === ii ? { ...y, descricao: e.target.value } : y)) } : x)) })} placeholder="Descrição" />
                    <Remover onClick={() => setIt({ ...it, secoes: it.secoes.map((x, j) => (j === si ? { ...x, itens: x.itens.filter((_, k) => k !== ii) } : x)) })} />
                  </div>
                ))}
                <Botao variante="fantasma" onClick={() => setIt({ ...it, secoes: it.secoes.map((x, j) => (j === si ? { ...x, itens: [...x.itens, { id: novoId("i"), titulo: "" }] } : x)) })}>+ opção</Botao>
              </div>
            ))}
            <Botao variante="fantasma" onClick={() => setIt({ ...it, secoes: [...it.secoes, { titulo: "", itens: [{ id: novoId("i"), titulo: "" }] }] })}>+ seção</Botao>
          </>
        )}
        {it.tipo === "link" && (
          <>
            <Campo rotulo="Texto do botão"><Entrada value={it.rotulo} onChange={(e) => setIt({ ...it, rotulo: e.target.value })} /></Campo>
            <Campo rotulo="Endereço"><Entrada value={it.url} onChange={(e) => setIt({ ...it, url: e.target.value })} placeholder="https://setufor.com/…" /></Campo>
          </>
        )}
        {(it.tipo === "botoes" || it.tipo === "lista") && (
          <Campo rotulo="Se não clicar em (minutos)" dica="0 = espera para sempre. Com prazo, aparece a saída “Não respondeu”.">
            <Entrada type="number" min={0} value={d.esperarMinutos ?? 0} onChange={(e) => dados({ esperarMinutos: Math.max(0, Number(e.target.value) || 0) })} />
          </Campo>
        )}
        {it.tipo !== "nenhuma" && (
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Cabeçalho"><Entrada value={d.cabecalho ?? ""} onChange={(e) => dados({ cabecalho: e.target.value })} /></Campo>
            <Campo rotulo="Rodapé"><Entrada value={d.rodape ?? ""} onChange={(e) => dados({ rodape: e.target.value })} /></Campo>
          </div>
        )}
      </Grupo>
      <Grupo titulo="Envio">
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.digitando !== false} onChange={(e) => dados({ digitando: e.target.checked })} /> Mostrar “digitando…” antes</label>
        <Aviso>Só sai com a janela de 24 h aberta. Fechada, segue pela saída “Janela de 24 h fechada” (ligue nela um Template).</Aviso>
      </Grupo>
    </>
  );
}

function EditorTemplate({ no, dados, modelos, precisaModelos }: Ed<"template"> & { modelos: ModeloMkt[] | null; precisaModelos: () => void }) {
  useEffect(() => { precisaModelos(); }, [precisaModelos]);
  const d = no.dados;
  const m = modelos?.find((x) => x.nome === d.nome && x.idioma === d.idioma) ?? modelos?.find((x) => x.nome === d.nome);
  return (
    <Grupo titulo="Modelo aprovado na Meta">
      {modelos === null || (modelos.length === 0 && !d.nome)
        ? <Aviso tom="alerta">{modelos === null ? "Carregando os modelos…" : "Nenhum modelo aprovado no número do Marketing (ou número não conectado)."}</Aviso>
        : (
          <Selecao value={d.nome ? `${d.nome}|${d.idioma}` : ""} onChange={(e) => {
            const [nome, idioma] = e.target.value.split("|");
            const novo = modelos.find((x) => x.nome === nome && x.idioma === idioma);
            dados({ nome: nome ?? "", idioma: idioma ?? "pt_BR", botoes: novo?.botoes ?? [], variaveis: {} });
          }}>
            <option value="">(escolha)</option>
            {modelos.map((x) => <option key={`${x.nome}|${x.idioma}`} value={`${x.nome}|${x.idioma}`}>{x.nome} · {x.idioma} · {x.categoria}</option>)}
            {d.nome && !m && <option value={`${d.nome}|${d.idioma}`}>{d.nome} (não encontrado)</option>}
          </Selecao>
        )}
      {m && <div className="rounded-lg p-2 whitespace-pre-wrap text-[12.5px]" style={{ background: "var(--card2)", color: "var(--ink2)" }}>{m.corpo}</div>}
      {Array.from({ length: m?.variaveis ?? Object.keys(d.variaveis).length }, (_, i) => String(i + 1)).map((k) => (
        <Campo key={k} rotulo={`Variável {{${k}}}`}>
          <Entrada value={d.variaveis[k] ?? ""} onChange={(e) => dados({ variaveis: { ...d.variaveis, [k]: e.target.value } })} placeholder="{{primeiro_nome}}" />
        </Campo>
      ))}
      {m?.cabecalho && m.cabecalho !== "TEXT" && (
        <Campo rotulo={`Mídia do cabeçalho (${m.cabecalho.toLowerCase()})`}><Entrada value={d.cabecalhoUrl ?? ""} onChange={(e) => dados({ cabecalhoUrl: e.target.value || null })} placeholder="https://…" /></Campo>
      )}
      <Aviso>Template sai mesmo com a janela fechada (é pago por conversa). Cada botão de resposta rápida do modelo vira uma saída.</Aviso>
    </Grupo>
  );
}

function EditorPergunta({ no, dados, campos }: Ed<"pergunta"> & { campos: CampoPersonalizado[] }) {
  const d = no.dados;
  return (
    <>
      <Grupo titulo="Pergunta">
        <AreaTexto rows={3} value={d.pergunta} onChange={(e) => dados({ pergunta: e.target.value })} placeholder="Para qual destino você quer viajar?" />
        <Campo rotulo="Tipo de resposta">
          <Selecao value={d.tipoResposta} onChange={(e) => dados({ tipoResposta: e.target.value })}>
            <option value="texto">Texto</option><option value="numero">Número</option><option value="email">E-mail</option>
            <option value="telefone">Telefone</option><option value="data">Data</option><option value="qualquer">Qualquer coisa</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Guardar a resposta em" dica="Nome, e-mail e telefone vão no cadastro; os outros, nos campos personalizados.">
          <Selecao value={d.salvarEm ?? ""} onChange={(e) => dados({ salvarEm: e.target.value || null })}>
            <option value="">(não guardar)</option>
            <option value="nome">Nome</option><option value="email">E-mail</option><option value="telefone">Telefone</option>
            {campos.map((c) => <option key={c.id} value={c.chave}>{c.rotulo}</option>)}
          </Selecao>
        </Campo>
        <Campo rotulo="Sugestões (viram botões, até 3)" dica="Separe por vírgula.">
          <Entrada value={(d.sugestoes ?? []).join(", ")} onChange={(e) => dados({ sugestoes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5) })} />
        </Campo>
      </Grupo>
      <Grupo titulo="Se a resposta não servir">
        <Campo rotulo="Mensagem de erro"><Entrada value={d.mensagemErro ?? ""} onChange={(e) => dados({ mensagemErro: e.target.value })} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Tentativas"><Entrada type="number" min={1} max={5} value={d.tentativas ?? 2} onChange={(e) => dados({ tentativas: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} /></Campo>
          <Campo rotulo="Prazo (min, 0 = sem)"><Entrada type="number" min={0} value={d.esperarMinutos ?? 0} onChange={(e) => dados({ esperarMinutos: Math.max(0, Number(e.target.value) || 0) })} /></Campo>
        </div>
      </Grupo>
    </>
  );
}

function EditorAguardar({ no, dados }: Ed<"aguardar">) {
  const d = no.dados;
  return (
    <Grupo titulo="Esperar">
      <div className="grid grid-cols-2 gap-2">
        <Entrada type="number" min={1} value={d.quantidade} onChange={(e) => dados({ quantidade: Math.max(0, Number(e.target.value) || 0) })} />
        <Selecao value={d.unidade} onChange={(e) => dados({ unidade: e.target.value })}>
          <option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">dias</option>
        </Selecao>
      </div>
      <Campo rotulo="Só continuar entre (horário de São Paulo)" dica="Deixe vazio para qualquer hora. Ex.: 09:00–20:00 — se cair fora, espera abrir.">
        <div className="flex items-center gap-2">
          <Entrada type="time" value={d.janelaInicio ?? ""} onChange={(e) => dados({ janelaInicio: e.target.value || null })} />
          <span>–</span>
          <Entrada type="time" value={d.janelaFim ?? ""} onChange={(e) => dados({ janelaFim: e.target.value || null })} />
        </div>
      </Campo>
      <Aviso>Esperou mais de 24 h desde a última mensagem da pessoa? Texto não sai mais: use um Template depois.</Aviso>
    </Grupo>
  );
}

const CAMPOS_COND: { id: Regra["campo"]; rotulo: string }[] = [
  { id: "tag", rotulo: "Tag" }, { id: "campo", rotulo: "Campo personalizado" }, { id: "nome", rotulo: "Nome" }, { id: "email", rotulo: "E-mail" },
  { id: "telefone", rotulo: "Telefone" }, { id: "janela_aberta", rotulo: "Janela de 24 h aberta" }, { id: "inscrito_whatsapp", rotulo: "Inscrito no WhatsApp" },
];
const OPS: Record<string, { id: Regra["operador"]; rotulo: string }[]> = {
  tag: [{ id: "tem", rotulo: "tem" }, { id: "nao_tem", rotulo: "não tem" }],
  bool: [{ id: "tem", rotulo: "sim" }, { id: "nao_tem", rotulo: "não" }],
  texto: [
    { id: "igual", rotulo: "é igual a" }, { id: "diferente", rotulo: "é diferente de" }, { id: "contem", rotulo: "contém" }, { id: "nao_contem", rotulo: "não contém" },
    { id: "vazio", rotulo: "está vazio" }, { id: "preenchido", rotulo: "está preenchido" }, { id: "maior", rotulo: "maior que" }, { id: "menor", rotulo: "menor que" },
  ],
};

function EditorCondicao({ no, dados, campos }: Ed<"condicao"> & { campos: CampoPersonalizado[] }) {
  const d = no.dados;
  const setRegra = (i: number, r: Regra) => dados({ regras: d.regras.map((x, j) => (j === i ? r : x)) });
  return (
    <Grupo titulo="Se…">
      <Selecao value={d.combinar} onChange={(e) => dados({ combinar: e.target.value })}>
        <option value="todas">TODAS as regras valem</option><option value="qualquer">QUALQUER regra vale</option>
      </Selecao>
      {d.regras.map((r, i) => {
        const ops = r.campo === "tag" ? OPS.tag : r.campo === "janela_aberta" || r.campo === "inscrito_whatsapp" ? OPS.bool : OPS.texto;
        const semValor = ["janela_aberta", "inscrito_whatsapp"].includes(r.campo) || r.operador === "vazio" || r.operador === "preenchido";
        return (
          <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: "var(--card2)" }}>
            <div className="flex gap-1.5">
              <Selecao value={r.campo} onChange={(e) => { const c = e.target.value as Regra["campo"]; setRegra(i, { campo: c, operador: c === "tag" || c === "janela_aberta" || c === "inscrito_whatsapp" ? "tem" : "igual", valor: "" }); }}>
                {CAMPOS_COND.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
              </Selecao>
              {d.regras.length > 1 && <Remover onClick={() => dados({ regras: d.regras.filter((_, j) => j !== i) })} />}
            </div>
            {r.campo === "campo" && (
              <Selecao value={r.chave ?? ""} onChange={(e) => setRegra(i, { ...r, chave: e.target.value })}>
                <option value="">(qual campo?)</option>
                {campos.map((c) => <option key={c.id} value={c.chave}>{c.rotulo}</option>)}
              </Selecao>
            )}
            <div className="flex gap-1.5">
              <Selecao value={r.operador} onChange={(e) => setRegra(i, { ...r, operador: e.target.value as Regra["operador"] })}>
                {ops.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
              </Selecao>
              {!semValor && <Entrada value={r.valor ?? ""} onChange={(e) => setRegra(i, { ...r, valor: e.target.value })} placeholder={r.campo === "tag" ? "nome da tag" : "valor"} />}
            </div>
          </div>
        );
      })}
      <Botao variante="fantasma" onClick={() => dados({ regras: [...d.regras, { campo: "tag", operador: "tem", valor: "" }] })}>+ regra</Botao>
    </Grupo>
  );
}

const TIPOS_ACAO: { id: Acao["tipo"]; rotulo: string }[] = [
  { id: "adicionar_tag", rotulo: "Adicionar tag" }, { id: "remover_tag", rotulo: "Remover tag" },
  { id: "definir_campo", rotulo: "Preencher campo" }, { id: "limpar_campo", rotulo: "Limpar campo" },
  { id: "adicionar_lista", rotulo: "Pôr na lista" }, { id: "remover_lista", rotulo: "Tirar da lista" },
  { id: "avisar_humano", rotulo: "Avisar alguém do time" }, { id: "pausar_automacao", rotulo: "Pausar o robô nesta conversa" },
  { id: "parar_outros_fluxos", rotulo: "Parar outros fluxos da pessoa" }, { id: "descadastrar", rotulo: "Descadastrar (opt-out)" },
  { id: "reinscrever", rotulo: "Reinscrever" }, { id: "webhook", rotulo: "Chamar webhook (n8n…)" },
];
function acaoNova(t: Acao["tipo"]): Acao {
  switch (t) {
    case "adicionar_tag": case "remover_tag": return { tipo: t, tag: "" };
    case "definir_campo": return { tipo: t, chave: "", valor: "" };
    case "limpar_campo": return { tipo: t, chave: "" };
    case "adicionar_lista": case "remover_lista": return { tipo: t, lista: "" };
    case "avisar_humano": return { tipo: t, usuarios: [], mensagem: "{{nome}} pediu para falar com alguém.", horas: 12 };
    case "pausar_automacao": return { tipo: t, horas: 12 };
    case "webhook": return { tipo: t, url: "" };
    default: return { tipo: t } as Acao;
  }
}

function EditorAcoes({ no, dados, campos, usuarios }: Ed<"acao"> & { campos: CampoPersonalizado[]; usuarios: { id: string; name: string }[] }) {
  const acoes = no.dados.acoes;
  const set = (i: number, a: Acao) => dados({ acoes: acoes.map((x, j) => (j === i ? a : x)) });
  const seletorCampo = (valor: string, on: (v: string) => void) => (
    <Selecao value={valor} onChange={(e) => on(e.target.value)}>
      <option value="">(qual campo?)</option>
      <option value="nome">Nome</option><option value="email">E-mail</option>
      {campos.map((c) => <option key={c.id} value={c.chave}>{c.rotulo}</option>)}
    </Selecao>
  );
  return (
    <Grupo titulo="Fazer, na ordem">
      {acoes.map((a, i) => (
        <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: "var(--card2)" }}>
          <div className="flex gap-1.5">
            <Selecao value={a.tipo} onChange={(e) => set(i, acaoNova(e.target.value as Acao["tipo"]))}>
              {TIPOS_ACAO.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </Selecao>
            <Remover onClick={() => dados({ acoes: acoes.filter((_, j) => j !== i) })} />
          </div>
          {(a.tipo === "adicionar_tag" || a.tipo === "remover_tag") && <Entrada value={a.tag} onChange={(e) => set(i, { ...a, tag: e.target.value })} placeholder="ex.: quer-japao" />}
          {(a.tipo === "adicionar_lista" || a.tipo === "remover_lista") && <Entrada value={a.lista} onChange={(e) => set(i, { ...a, lista: e.target.value })} placeholder="ex.: Interesse Japão 2027" />}
          {a.tipo === "definir_campo" && <>{seletorCampo(a.chave, (v) => set(i, { ...a, chave: v }))}<Entrada value={a.valor} onChange={(e) => set(i, { ...a, valor: e.target.value })} placeholder="valor (aceita marcadores)" /></>}
          {a.tipo === "limpar_campo" && seletorCampo(a.chave, (v) => set(i, { ...a, chave: v }))}
          {a.tipo === "pausar_automacao" && <Campo rotulo="Por quantas horas"><Entrada type="number" min={1} value={a.horas} onChange={(e) => set(i, { ...a, horas: Math.max(1, Number(e.target.value) || 1) })} /></Campo>}
          {a.tipo === "webhook" && <Entrada value={a.url} onChange={(e) => set(i, { ...a, url: e.target.value })} placeholder="https://… (recebe POST com a pessoa)" />}
          {a.tipo === "avisar_humano" && (
            <>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {usuarios.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={a.usuarios.includes(u.id)} onChange={(e) => set(i, { ...a, usuarios: e.target.checked ? [...a.usuarios, u.id] : a.usuarios.filter((x) => x !== u.id) })} />
                    {u.name}
                  </label>
                ))}
              </div>
              <Entrada value={a.mensagem} onChange={(e) => set(i, { ...a, mensagem: e.target.value })} placeholder="Texto do aviso" />
              <Campo rotulo="Pausar o robô por (horas)" dica="Enquanto alguém atende."><Entrada type="number" min={0} value={a.horas ?? 12} onChange={(e) => set(i, { ...a, horas: Math.max(0, Number(e.target.value) || 0) })} /></Campo>
            </>
          )}
        </div>
      ))}
      <Botao variante="fantasma" onClick={() => dados({ acoes: [...acoes, acaoNova("adicionar_tag")] })}>+ ação</Botao>
    </Grupo>
  );
}

function EditorAB({ no, dados }: Ed<"randomizador">) {
  const vs = no.dados.variantes;
  const total = vs.reduce((s, v) => s + (Number(v.peso) || 0), 0);
  return (
    <Grupo titulo="Caminhos (sorteio por peso)">
      {vs.map((v, i) => (
        <div key={v.id} className="flex gap-1.5 items-center">
          <Entrada value={v.nome} onChange={(e) => dados({ variantes: vs.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
          <Entrada type="number" min={0} className="!w-20" value={v.peso} onChange={(e) => dados({ variantes: vs.map((x, j) => (j === i ? { ...x, peso: Math.max(0, Number(e.target.value) || 0) } : x)) })} />
          <span className="text-[11px]" style={{ color: "var(--ink3)" }}>{total ? Math.round((v.peso / total) * 100) : 0}%</span>
          {vs.length > 2 && <Remover onClick={() => dados({ variantes: vs.filter((_, j) => j !== i) })} />}
        </div>
      ))}
      {vs.length < 6 && <Botao variante="fantasma" onClick={() => dados({ variantes: [...vs, { id: novoId("v"), nome: String.fromCharCode(65 + vs.length), peso: 0 }] })}>+ caminho</Botao>}
      <Aviso>Os números de cada saída no bloco mostram quantos foram por cada caminho.</Aviso>
    </Grupo>
  );
}
