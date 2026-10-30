// src/expedicoes/checklist/EditorPadrao.tsx
// -----------------------------------------------------------------------------
// EDITOR DO CHECKLIST PADRÃO (Bruno, 30/10): "quem é de Operações consegue CRIAR
// novas tarefas no checklist padrão, editar e incrementar, pra toda vez que se
// criar uma expedição ela já vir com isso, SEM fazer nada via código".
//
// Abre pelo botão "Editar o padrão" da aba Checklist do cockpit (não é mais item
// solto no menu). Lista o padrão por fase, com setor, PARA QUEM é (pessoa fixa ou
// "responsável operacional/comercial da expedição"), prazo relativo (D-30 do
// embarque), prioridade e tipo de produto. Ops cria, edita, sobe/desce, liga/desliga
// e adiciona passos (subtarefas). "Aplicar às expedições em andamento" mostra a
// prévia do que entra em cada uma antes de gravar.
// Sem a 0224 aplicada: mostra o padrão do código, só leitura.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { Carregando, Gaveta, useAoVivo } from "../ui";
import { PRIORIDADE } from "../lib/constants";
import { formatDate } from "../lib/utils";
import {
  COR_SETOR, ETAPAS_CK, NOME_PAPEL, NOME_SETOR, NOME_TIPO, SETORES_CK, arvoreDoModelo, moverNaLista, rotuloPrazo, textoResponsavel,
  type ModeloTarefa, type PapelResponsavel, type ReferenciaPrazo, type SetorCk, type TipoProduto,
} from "../lib/checklist/modelo";
import {
  aplicarModelo, carregarModelo, criarTarefaModelo, reordenarModelo, salvarTarefaModelo, souOps,
  type CamposModelo, type LinhaAplicacao, type ModeloCarregado,
} from "./modeloDados";
import { ChipSetor } from "./ChipSetor";

type Form = { tipo: "nova" } | { tipo: "passo"; pai: ModeloTarefa } | { tipo: "editar"; t: ModeloTarefa };

export function EditorPadrao({ aberto, onFechar, onAplicado }: { aberto: boolean; onFechar: () => void; onAplicado?: () => void }) {
  const { usuarios, avisar } = useExp();
  const [dados, setDados] = useState<ModeloCarregado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ops, setOps] = useState(false);
  const [setor, setSetor] = useState<SetorCk | "">("");
  const [verInativas, setVerInativas] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [previa, setPrevia] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try { setDados(await carregarModelo()); setErro(null); } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar o padrão"); }
  }, []);
  useEffect(() => { if (aberto) { void carregar(); void souOps().then(setOps); } }, [aberto, carregar]);
  useAoVivo(aberto && dados?.noBanco ? [{ tabela: "exp_checklist_modelo" }] : [], carregar, 400);

  const nomes = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome])), [usuarios]);
  const arvore = useMemo(() => arvoreDoModelo(dados?.tarefas ?? []), [dados]);
  const pode = !!dados?.noBanco && ops;

  if (!aberto) return null;

  const visiveis = arvore.filter(({ processo: p }) => (!setor || p.setor === setor) && (verInativas || p.ativo));
  const contaSetor = (s: SetorCk) => arvore.filter(({ processo: p }) => p.setor === s && p.ativo).length;

  const mover = async (t: ModeloTarefa, delta: -1 | 1) => {
    const irmaos = t.parent_id
      ? arvore.find((a) => a.processo.id === t.parent_id)?.subs ?? []
      : arvore.filter((a) => a.processo.etapa === t.etapa).map((a) => a.processo);
    const nova = moverNaLista(irmaos.map((i) => i.id), t.id, delta);
    if (!nova) return;
    try { await reordenarModelo(nova); void carregar(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao reordenar", "erro"); }
  };
  const alternarAtivo = async (t: ModeloTarefa) => {
    try {
      await salvarTarefaModelo(t.id, { ativo: !t.ativo }, dados?.tarefas ?? []);
      avisar(t.ativo ? "Tarefa desligada: não entra mais nas expedições novas" : "Tarefa ligada: entra nas expedições novas");
      void carregar();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  };

  return (
    <>
      <Gaveta aberta titulo="Checklist padrão" largura={920} onFechar={onFechar}
        subtitulo="O que toda expedição nova recebe, por fase, e para quem é cada tarefa"
        rodape={pode ? (
          <>
            <Botao onClick={() => setPrevia(true)}>Aplicar às expedições em andamento…</Botao>
            <Botao variante="primario" onClick={() => setForm({ tipo: "nova" })}>+ Nova tarefa no padrão</Botao>
          </>
        ) : undefined}>
        {erro ? <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p> : !dados ? <Carregando /> : (
          <div className="space-y-3">
            {!dados.noBanco && (
              <p className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>
                O padrão ainda está no código (só leitura). A edição liga quando a migration <b>0224</b> for aplicada no banco.
              </p>
            )}
            {dados.noBanco && !ops && (
              <p className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}>
                Só quem é de Operações edita o padrão. Você está vendo como ele está.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
              <FiltroBotao ativo={setor === ""} onClick={() => setSetor("")}>Todos os setores · {arvore.filter((a) => a.processo.ativo).length}</FiltroBotao>
              {SETORES_CK.map((s) => (
                <FiltroBotao key={s} ativo={setor === s} onClick={() => setSetor(s)} cor={COR_SETOR[s]}>{NOME_SETOR[s]} · {contaSetor(s)}</FiltroBotao>
              ))}
              <label className="ml-auto inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
                <input type="checkbox" checked={verInativas} onChange={(e) => setVerInativas(e.target.checked)} /> mostrar desligadas
              </label>
            </div>

            {ETAPAS_CK.map((etapa) => {
              const doGrupo = visiveis.filter((a) => a.processo.etapa === etapa);
              if (!doGrupo.length) return null;
              return (
                <section key={etapa} className="rel-card overflow-hidden">
                  <h3 className="px-3 py-2 text-[12.5px] font-bold" style={{ background: "var(--card2)", color: "var(--ink)", borderBottom: "1px solid var(--line)" }}>
                    {etapa} <span className="font-normal" style={{ color: "var(--ink3)" }}>· {doGrupo.filter((a) => a.processo.ativo).length} ativas</span>
                  </h3>
                  <ul>
                    {doGrupo.map(({ processo: p, subs }) => {
                      const aberto = abertos.has(p.id);
                      return (
                        <li key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
                          <LinhaModelo t={p} nomes={nomes} pode={pode} nSubs={subs.length} aberto={aberto}
                            onAbrir={() => setAbertos((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })}
                            onSubir={() => void mover(p, -1)} onDescer={() => void mover(p, 1)} onAtivo={() => void alternarAtivo(p)}
                            onEditar={() => setForm({ tipo: "editar", t: p })} onPasso={() => setForm({ tipo: "passo", pai: p })} />
                          {aberto && subs.map((s) => (
                            <LinhaModelo key={s.id} t={s} sub nomes={nomes} pode={pode} nSubs={0} aberto={false} onAbrir={() => {}}
                              onSubir={() => void mover(s, -1)} onDescer={() => void mover(s, 1)} onAtivo={() => void alternarAtivo(s)}
                              onEditar={() => setForm({ tipo: "editar", t: s })} />
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {!visiveis.length && <p className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma tarefa neste filtro.</p>}
            {dados.noBanco && (
              <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                Tarefa desligada não entra nas expedições novas e não sai das que já têm. Mudança no padrão vale pras expedições criadas daqui pra frente;
                pras que já estão em andamento, use “Aplicar às expedições em andamento”.
              </p>
            )}
          </div>
        )}
      </Gaveta>

      {form && dados && (
        <FormModelo form={form} todas={dados.tarefas} onFechar={() => setForm(null)}
          onSalvo={(msg) => { setForm(null); avisar(msg); void carregar(); }} />
      )}
      {previa && <PreviaAplicar onFechar={() => setPrevia(false)} onAplicado={() => { setPrevia(false); onAplicado?.(); }} />}
    </>
  );
}

function FiltroBotao({ ativo, onClick, cor, children }: { ativo: boolean; onClick: () => void; cor?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
      style={{
        border: `1px solid ${ativo ? "var(--ink)" : "var(--line)"}`, background: ativo ? "var(--ink)" : "var(--card)", color: ativo ? "var(--bg)" : "var(--ink2)",
        borderLeft: cor ? `4px solid var(--sector-${cor})` : undefined,
      }}>{children}</button>
  );
}

function LinhaModelo({ t, sub = false, nomes, pode, nSubs, aberto, onAbrir, onSubir, onDescer, onAtivo, onEditar, onPasso }: {
  t: ModeloTarefa; sub?: boolean; nomes: Map<string, string>; pode: boolean; nSubs: number; aberto: boolean;
  onAbrir: () => void; onSubir: () => void; onDescer: () => void; onAtivo: () => void; onEditar: () => void; onPasso?: () => void;
}) {
  const quem = t.atualizado_por ? nomes.get(t.atualizado_por) : null;
  const rastro = t.atualizado_em ? `Última edição: ${quem ?? "alguém"} em ${formatDate(t.atualizado_em)}` : undefined;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px] ${sub ? "pl-10" : ""}`}
      style={{ background: sub ? "var(--card2)" : undefined, opacity: t.ativo ? 1 : 0.55 }} title={rastro}>
      {pode && (
        <span className="inline-flex flex-col leading-none">
          <button type="button" aria-label="Subir" title="Subir" onClick={onSubir} className="px-1 text-[10px]" style={{ color: "var(--ink3)" }}>▲</button>
          <button type="button" aria-label="Descer" title="Descer" onClick={onDescer} className="px-1 text-[10px]" style={{ color: "var(--ink3)" }}>▼</button>
        </span>
      )}
      {!sub && <ChipSetor setor={t.setor} />}
      <button type="button" onClick={onAbrir} disabled={sub || !nSubs} className="min-w-[200px] flex-1 text-left font-semibold disabled:cursor-default"
        style={{ color: sub ? "var(--ink2)" : "var(--ink)", fontWeight: sub ? 400 : 600 }}>
        {t.titulo}
        {!sub && nSubs > 0 && <span className="font-normal" style={{ color: "var(--ink3)" }}> · {nSubs} passos {aberto ? "▾" : "▸"}</span>}
        {!t.ativo && <span className="ml-1.5 rounded-full px-1.5 text-[10.5px] font-bold" style={{ border: "1px dashed var(--line)", color: "var(--ink3)" }}>desligada</span>}
        {t.descricao && <span className="block text-[11.5px] font-normal" style={{ color: "var(--ink3)" }}>{t.descricao}</span>}
      </button>
      {!sub && <span className="whitespace-nowrap" style={{ color: "var(--ink2)" }} title="Para quem é">👤 {textoResponsavel(t, nomes)}</span>}
      {sub && t.responsavel_usuario_id && <span className="whitespace-nowrap" style={{ color: "var(--ink2)" }}>👤 {nomes.get(t.responsavel_usuario_id) ?? "—"}</span>}
      <span className="whitespace-nowrap tabular-nums" style={{ color: "var(--ink3)" }}>{rotuloPrazo(t.prazo_dias, t.prazo_referencia, sub)}</span>
      {!sub && <span className="whitespace-nowrap" style={{ color: t.prioridade === "Crítica" ? "var(--danger)" : t.prioridade === "Alta" ? "var(--warn-ink)" : "var(--ink3)" }}>{t.prioridade}</span>}
      {!sub && t.tipo_produto !== "expedicao" && <span className="whitespace-nowrap text-[11px]" style={{ color: "var(--ink3)" }}>{NOME_TIPO[t.tipo_produto]}</span>}
      {pode && (
        <span className="ml-auto inline-flex items-center gap-1">
          <label className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: "var(--ink2)" }} title={t.ativo ? "Desligar (não entra nas expedições novas)" : "Ligar"}>
            <input type="checkbox" checked={t.ativo} onChange={onAtivo} /> ativa
          </label>
          {onPasso && <button type="button" onClick={onPasso} title="Novo passo (subtarefa)" className="rounded px-1.5 py-0.5 text-[12px]" style={{ color: "var(--ink2)" }}>＋ passo</button>}
          <button type="button" onClick={onEditar} title="Editar" aria-label={`Editar ${t.titulo}`} className="rounded px-1.5 py-0.5 text-[13px]" style={{ color: "var(--ink2)" }}>✎</button>
        </span>
      )}
    </div>
  );
}

/* ───────────── criar / editar tarefa do padrão ───────────── */

const PESSOA = "pessoa:";
function FormModelo({ form, todas, onFechar, onSalvo }: { form: Form; todas: ModeloTarefa[]; onFechar: () => void; onSalvo: (msg: string) => void }) {
  const { usuarios } = useExp();
  const base = form.tipo === "editar" ? form.t : null;
  const pai = form.tipo === "passo" ? form.pai : base?.parent_id ? todas.find((t) => t.id === base.parent_id) ?? null : null;
  const ehPasso = !!pai;
  const [f, setF] = useState(() => {
    const dias = base?.prazo_dias ?? (ehPasso ? null : 30);
    return {
      titulo: base?.titulo ?? "", descricao: base?.descricao ?? "",
      etapa: base?.etapa ?? pai?.etapa ?? "6 a 2 meses", setor: (base?.setor ?? pai?.setor ?? "operacional") as SetorCk,
      resp: base?.responsavel_usuario_id ? `${PESSOA}${base.responsavel_usuario_id}` : base ? (base.responsavel_papel ?? "") : ehPasso ? "" : "resp_operacional",
      herdaPrazo: ehPasso && dias == null,
      dias: dias == null ? "30" : String(Math.abs(dias)), sentido: (dias ?? 1) < 0 ? "depois" : "antes",
      ref: (base?.prazo_referencia ?? pai?.prazo_referencia ?? "embarque") as ReferenciaPrazo,
      prioridade: base?.prioridade ?? pai?.prioridade ?? "Média", tipo: (base?.tipo_produto ?? pai?.tipo_produto ?? "expedicao") as TipoProduto,
      ativo: base?.ativo ?? true,
    };
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (f.titulo.trim().length < 2) { setErro("Mínimo 2 caracteres"); return; }
    const n = Number(f.dias);
    if (!f.herdaPrazo && (!Number.isInteger(n) || n < 0 || n > 999)) { setErro("Prazo: um número inteiro de dias (0 a 999)"); return; }
    const campos: CamposModelo = {
      titulo: f.titulo, descricao: f.descricao || null, etapa: f.etapa, setor: f.setor,
      responsavel_usuario_id: f.resp.startsWith(PESSOA) ? f.resp.slice(PESSOA.length) : null,
      responsavel_papel: f.resp && !f.resp.startsWith(PESSOA) ? (f.resp as PapelResponsavel) : null,
      prazo_dias: f.herdaPrazo ? null : f.sentido === "depois" ? -n : n, prazo_referencia: f.ref,
      prioridade: f.prioridade, ativo: f.ativo, tipo_produto: f.tipo,
    };
    setSalvando(true);
    try {
      if (base) {
        await salvarTarefaModelo(base.id, campos, todas);
        onSalvo("Padrão salvo");
      } else {
        await criarTarefaModelo({ ...campos, parent_id: pai?.id ?? null }, todas);
        onSalvo(ehPasso ? "Passo adicionado ao padrão" : "Tarefa adicionada ao padrão: entra nas expedições novas");
      }
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao salvar"); } finally { setSalvando(false); }
  };

  const sel = "rel-input";
  const titulo = base ? (ehPasso ? "Editar passo do padrão" : "Editar tarefa do padrão") : ehPasso ? "Novo passo no padrão" : "Nova tarefa no padrão";
  return (
    <Gaveta aberta titulo={titulo} largura={500} onFechar={onFechar}
      subtitulo={pai ? <>Dentro de “{pai.titulo}”</> : "Entra em toda expedição criada daqui pra frente."}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : base ? "Salvar" : "Adicionar"}</Botao></>}>
      <div className="space-y-3.5">
        <Campo rotulo="Tarefa" erro={erro}>
          <Entrada autoFocus value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Confirmar seguro viagem de todos" />
        </Campo>
        <Campo rotulo="Descrição (opcional)" dica="Vai pras observações da tarefa em cada expedição.">
          <textarea className={sel} rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        </Campo>
        {!ehPasso && (
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Fase">
              <select className={sel} value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value })}>
                {ETAPAS_CK.map((x) => <option key={x}>{x}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Setor">
              <select className={sel} value={f.setor} onChange={(e) => setF({ ...f, setor: e.target.value as SetorCk })}>
                {SETORES_CK.map((s) => <option key={s} value={s}>{NOME_SETOR[s]}</option>)}
              </select>
            </Campo>
          </div>
        )}
        <Campo rotulo="Para quem é (responsável padrão)" dica={ehPasso ? "Vazio = o mesmo responsável do processo." : "Papel = a pessoa daquela expedição; pessoa = sempre a mesma."}>
          <select className={sel} value={f.resp} onChange={(e) => setF({ ...f, resp: e.target.value })}>
            <option value="">{ehPasso ? "O mesmo do processo" : `Ninguém fixo (fica com o setor ${NOME_SETOR[f.setor]})`}</option>
            {!ehPasso && (
              <optgroup label="Papel na expedição">
                {(Object.keys(NOME_PAPEL) as PapelResponsavel[]).map((p) => <option key={p} value={p}>{NOME_PAPEL[p]}</option>)}
              </optgroup>
            )}
            <optgroup label="Pessoa">
              {[...usuarios].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((u) => <option key={u.id} value={`${PESSOA}${u.id}`}>{u.nome}</option>)}
            </optgroup>
          </select>
        </Campo>
        <Campo rotulo="Prazo" dica="Calculado em cada expedição a partir da data de embarque (ou de retorno).">
          {ehPasso && (
            <label className="mb-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" checked={f.herdaPrazo} onChange={(e) => setF({ ...f, herdaPrazo: e.target.checked })} /> mesmo prazo do processo
            </label>
          )}
          {!f.herdaPrazo && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Entrada type="number" min={0} max={999} value={f.dias} onChange={(e) => setF({ ...f, dias: e.target.value })} style={{ width: 90 }} />
              <span>dias</span>
              <select className={sel} style={{ width: "auto" }} value={f.sentido} onChange={(e) => setF({ ...f, sentido: e.target.value })}>
                <option value="antes">antes</option><option value="depois">depois</option>
              </select>
              <select className={sel} style={{ width: "auto" }} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value as ReferenciaPrazo })} disabled={ehPasso}>
                <option value="embarque">do embarque</option><option value="retorno">do retorno</option>
              </select>
              <span className="text-[12px]" style={{ color: "var(--ink3)" }}>= {rotuloPrazo(f.sentido === "depois" ? -Number(f.dias || 0) : Number(f.dias || 0), f.ref)}</span>
            </div>
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Prioridade">
            <select className={sel} value={f.prioridade} onChange={(e) => setF({ ...f, prioridade: e.target.value })}>
              {PRIORIDADE.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Campo>
          {!ehPasso && (
            <Campo rotulo="Vale pra">
              <select className={sel} value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoProduto })}>
                {(Object.keys(NOME_TIPO) as TipoProduto[]).map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
              </select>
            </Campo>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativa (entra nas expedições novas)
        </label>
      </div>
    </Gaveta>
  );
}

/* ───────────── aplicar às expedições em andamento (com prévia) ───────────── */

function PreviaAplicar({ onFechar, onAplicado }: { onFechar: () => void; onAplicado: () => void }) {
  const { avisar, usuarios } = useExp();
  const [linhas, setLinhas] = useState<LinhaAplicacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);
  const nomes = useMemo(() => new Map(usuarios.map((u) => [u.id, u.nome.split(" ")[0]])), [usuarios]);

  useEffect(() => {
    aplicarModelo({ simular: true }).then(setLinhas).catch((e) => setErro(e instanceof Error ? e.message : "Erro na prévia"));
  }, []);

  const porExp = useMemo(() => {
    const m = new Map<string, { codigo: string; nome: string; itens: LinhaAplicacao[] }>();
    for (const l of linhas ?? []) {
      const g = m.get(l.o_expedicao) ?? { codigo: l.o_codigo, nome: l.o_nome, itens: [] };
      g.itens.push(l);
      m.set(l.o_expedicao, g);
    }
    return [...m.entries()];
  }, [linhas]);
  const escolhidas = porExp.filter(([id]) => !fora.has(id));
  const nTarefas = escolhidas.reduce((s, [, g]) => s + g.itens.length, 0);

  const aplicar = async () => {
    setAplicando(true);
    try {
      const feitas = await aplicarModelo({ expedicoes: escolhidas.map(([id]) => id), simular: false });
      avisar(`Padrão aplicado · ${feitas.length} tarefa${feitas.length === 1 ? "" : "s"} em ${escolhidas.length} expedi${escolhidas.length === 1 ? "ção" : "ções"}`);
      onAplicado();
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao aplicar"); } finally { setAplicando(false); }
  };

  return (
    <Gaveta aberta titulo="Aplicar o padrão às expedições em andamento" largura={680} onFechar={onFechar}
      subtitulo="Só ACRESCENTA o que falta. Nada é apagado nem mudado nas tarefas que já existem."
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={aplicando || !nTarefas} onClick={aplicar}>{aplicando ? "Aplicando…" : `Aplicar ${nTarefas} tarefa${nTarefas === 1 ? "" : "s"} em ${escolhidas.length} expedi${escolhidas.length === 1 ? "ção" : "ções"}`}</Botao></>}>
      {erro ? <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p> : !linhas ? <Carregando texto="Montando a prévia…" /> : !porExp.length ? (
        <p className="py-8 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Todas as expedições em andamento já têm o padrão inteiro. Nada a aplicar.</p>
      ) : (
        <div className="space-y-2.5">
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Desmarque a expedição que não deve receber. Prazo e responsável já calculados pra cada uma.</p>
          {porExp.map(([id, g]) => (
            <details key={id} className="rel-card" open={porExp.length <= 3}>
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px]">
                <input type="checkbox" checked={!fora.has(id)} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setFora((s) => { const n = new Set(s); if (e.target.checked) n.delete(id); else n.add(id); return n; })} />
                <span className="font-mono text-[11.5px]" style={{ color: "var(--ink3)" }}>{g.codigo}</span>
                <span className="flex-1 font-semibold" style={{ color: "var(--ink)" }}>{g.nome}</span>
                <span className="text-[12px]" style={{ color: "var(--ink2)" }}>+{g.itens.length}</span>
              </summary>
              <ul className="px-3 pb-2 text-[12.5px]">
                {g.itens.map((l, i) => (
                  <li key={i} className={`flex gap-2 py-0.5 ${l.o_sub ? "pl-5" : ""}`} style={{ color: l.o_sub ? "var(--ink3)" : "var(--ink2)" }}>
                    <span className="flex-1">{l.o_sub ? "↳ " : ""}{l.o_tarefa}{!l.o_sub && <span style={{ color: "var(--ink3)" }}> · {l.o_etapa}</span>}</span>
                    <span className="whitespace-nowrap">{l.o_responsavel ? nomes.get(l.o_responsavel) ?? "—" : "sem pessoa"}</span>
                    <span className="whitespace-nowrap tabular-nums">{l.o_prazo ? formatDate(l.o_prazo) : "sem prazo"}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </Gaveta>
  );
}
