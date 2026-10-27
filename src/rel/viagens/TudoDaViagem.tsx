// src/rel/viagens/TudoDaViagem.tsx
// -----------------------------------------------------------------------------
// "TUDO DA VIAGEM" (27/10/2026). Bruno: "um modelo pra aéreo, pacote, seguro
// etc. … ligar tudo e deixar de uma forma de visualização fácil e rápida, não
// perdendo tempo pra ficar consultando nada".
//
// Um bloco no topo do card da viagem que responde, numa olhada:
//   1) O QUE FALTA   — venda (serviço, data, cliente), emissão, documentos,
//                      pagamento, dono. O mais grave primeiro.
//   2) PRÓXIMAS DATAS — embarque, check-in do hotel, passeio, vencimento…
//   3) COMPONENTES   — um cartão por TIPO (aéreo, hotel, seguro, passeio,
//                      expedição…), com os campos rotulados pelo catálogo único
//                      `TIPOS` (src/propostas/lib.ts). Item da venda tem situação
//                      (a emitir / emitido / cancelado) e o Rel completa
//                      localizador, voucher, apólice… sem sair da tela.
//
// Fonte: rel_viagem_componentes (0208) = itens da venda (0207) + trechos +
// expedição. Sem a 0208 no banco, mostra trechos e expedição e avisa.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button, StatusDot, type Tone } from "@/components/ui";
import type { CampoTipo } from "@/propostas/lib";
import {
  STATUS_ITEM, TIPOS_LANCAVEIS, carregarComponentes, documentosDaViagem, infoDoTipo, lancarItemAvulso, oQueFalta, ordemDosTipos,
  pagamentoDaViagem, proximasDatas, salvarItem,
  type Componente, type DocResumo, type ResumoPagamento, type StatusItem,
} from "../lib/componentes";
import { SERVICOS, dataBR, horaDoLugar, type Passageiro, type Viagem } from "../lib/viagens";
import { usePode } from "../equipe/usePode";
import { Aviso, Campo, Entrada, Modal } from "../ui";

const brl = (n: number | null | undefined) => (n == null ? "" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const TOM_STATUS: Record<StatusItem, Tone | undefined> = { vendido: "warn", emitido: "ok", cancelado: undefined };

// Campos de EMISSÃO que o Rel completa em qualquer tipo (o catálogo diz o que foi
// vendido; isto é o comprovante de que foi emitido). Chave em `dados`.
const EMISSAO: CampoTipo[] = [
  { chave: "localizador", rotulo: "Localizador / nº da reserva", tipo: "texto" },
  { chave: "voucher", rotulo: "Voucher / bilhete / apólice", tipo: "texto", dica: "Número ou link" },
  { chave: "obs_rel", rotulo: "Anotação do Relacionamento", tipo: "area", largo: true },
];

/** Campos do tipo + os de emissão que o tipo ainda não tem. */
function camposDoItem(tipo: string): CampoTipo[] {
  const base = infoDoTipo(tipo).campos;
  return [...base, ...EMISSAO.filter((e) => !base.some((b) => b.chave === e.chave))];
}

const valorTexto = (x: unknown) => (x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x)).trim();

// ── Linhas de um componente ─────────────────────────────────────────────────

function Fato({ r, children }: { r: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-[12.5px]" style={{ color: "var(--text)" }}>
      <span style={{ color: "var(--subtle)" }}>{r}</span> {children}
    </span>
  );
}

function datasDoItem(c: Componente): string {
  const [r1, r2] = infoDoTipo(c.tipo).datas;
  const p: string[] = [];
  if (c.data_inicio) p.push(`${r1 ?? "Data"} ${dataBR(c.data_inicio)}`);
  if (c.data_fim && c.data_fim !== c.data_inicio) p.push(`${r2 ?? "até"} ${dataBR(c.data_fim)}`);
  return p.join(" · ");
}

function FatosDoTrecho({ c }: { c: Componente }) {
  const d = c.dados;
  const s = (k: string) => valorTexto(d[k]);
  const partida = horaDoLugar(s("partida_em") || null, s("partida_fuso") || null);
  const chegada = horaDoLugar(s("chegada_em") || null, s("chegada_fuso") || null);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
      {partida.texto && <Fato r="sai">{partida.texto}</Fato>}
      {chegada.texto && <Fato r="chega">{chegada.texto}</Fato>}
      {(s("companhia") || s("numero")) && <Fato r="voo">{[s("companhia"), s("numero")].filter(Boolean).join(" ")}</Fato>}
      {s("localizador") ? <Fato r="localizador"><b className="qs-num">{s("localizador")}</b></Fato> : c.tipo === "aereo" ? <span className="text-[12.5px] qs-tone-warn">sem localizador</span> : null}
      {s("bagagem") && <Fato r="bagagem">{s("bagagem")}</Fato>}
      {s("classe") && <Fato r="classe">{s("classe")}</Fato>}
      {s("assento") && <Fato r="assento">{s("assento")}</Fato>}
      {s("numero_bilhete") && <Fato r="bilhete">{s("numero_bilhete")}</Fato>}
      {s("ponto_encontro") && <Fato r="encontro">{s("ponto_encontro")}</Fato>}
      {s("contato") && <Fato r="contato">{s("contato")}</Fato>}
      {s("endereco") && <Fato r="endereço">{s("endereco")}</Fato>}
    </div>
  );
}

function FatosDoItem({ c }: { c: Componente }) {
  const fatos = camposDoItem(c.tipo).map((k) => ({ k, v: valorTexto(c.dados[k.chave]) })).filter((x) => x.v);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
      {fatos.map(({ k, v }) => <Fato key={k.chave} r={k.rotulo.replace(/\s*\(.*\)$/, "").toLowerCase()}>{k.chave === "localizador" ? <b className="qs-num">{v}</b> : v}</Fato>)}
      {c.fornecedor && <Fato r="fornecedor">{c.fornecedor}</Fato>}
      {c.valor != null && <Fato r="valor">{brl(c.valor)}</Fato>}
      {!fatos.length && !c.fornecedor && <span className="text-[12.5px]" style={{ color: "var(--subtle)" }}>sem detalhes ainda</span>}
    </div>
  );
}

function LinhaComponente({ c, podeEditar, onEditar, onAbrirExpedicao }: {
  c: Componente; podeEditar: boolean; onEditar: () => void; onAbrirExpedicao?: (id: string, tipo: string | null) => void;
}) {
  const cancelado = c.status === "cancelado";
  return (
    <li className="py-2" style={{ borderTop: "1px solid var(--border)", opacity: cancelado ? 0.55 : 1 }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold truncate" style={{ color: "var(--text)", textDecoration: cancelado ? "line-through" : undefined }} title={c.nome}>{c.nome}</p>
          {datasDoItem(c) && <p className="text-[12px] qs-num" style={{ color: "var(--muted)" }}>{datasDoItem(c)}</p>}
          {c.fonte === "trecho" ? <FatosDoTrecho c={c} /> : c.fonte === "venda" ? <FatosDoItem c={c} /> : null}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {c.fonte === "venda" && c.status && <Badge tone={TOM_STATUS[c.status]} dot>{STATUS_ITEM[c.status]}</Badge>}
          {c.fonte === "trecho" && <span className="text-[11px]" style={{ color: "var(--subtle)" }} title="Trecho do roteiro: edite no Roteiro, mais abaixo">roteiro</span>}
          {c.fonte === "venda" && podeEditar && <Button size="sm" variant="ghost" onClick={onEditar}>Editar</Button>}
          {c.fonte === "expedicao" && onAbrirExpedicao && (
            <Button size="sm" onClick={() => onAbrirExpedicao(String(c.dados.expedicoes_id ?? c.id), (c.dados.tipo as string | null) ?? null)}>Abrir expedição</Button>
          )}
        </div>
      </div>
    </li>
  );
}

function CartaoTipo({ tipo, itens, podeEditar, onEditar, onAbrirExpedicao }: {
  tipo: string; itens: Componente[]; podeEditar: boolean; onEditar: (c: Componente) => void; onAbrirExpedicao?: (id: string, tipo: string | null) => void;
}) {
  const info = infoDoTipo(tipo);
  const vendidos = itens.filter((c) => c.fonte === "venda" && c.status !== "cancelado");
  const aEmitir = vendidos.filter((c) => c.status === "vendido").length;
  const ordenados = [...itens].sort((a, b) => (a.data_inicio ?? "9999").localeCompare(b.data_inicio ?? "9999") || a.ordem - b.ordem);
  return (
    <section className="qs-card p-3.5 min-w-0">
      <header className="flex items-center gap-2 mb-1">
        <span aria-hidden className="text-[16px] leading-none">{info.emoji}</span>
        <h3 className="text-[13px] font-semibold flex-1" style={{ color: "var(--text)" }}>{info.rotulo} <span className="qs-num" style={{ color: "var(--subtle)" }}>· {itens.length}</span></h3>
        {aEmitir > 0 ? <Badge tone="warn">{aEmitir} a emitir</Badge> : vendidos.length > 0 ? <Badge tone="ok">emitido</Badge> : null}
      </header>
      <ul>{ordenados.map((c) => <LinhaComponente key={`${c.fonte}-${c.id}`} c={c} podeEditar={podeEditar} onEditar={() => onEditar(c)} onAbrirExpedicao={onAbrirExpedicao} />)}</ul>
    </section>
  );
}

// ── Editar / lançar item ────────────────────────────────────────────────────

function CampoDinamico({ k, valor, onChange }: { k: CampoTipo; valor: string; onChange: (v: string) => void }) {
  if (k.tipo === "select") {
    return (
      <select className="rel-input" value={valor} onChange={(e) => onChange(e.target.value)}>
        {(k.opcoes ?? [""]).map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    );
  }
  if (k.tipo === "area") return <textarea className="rel-input" rows={2} value={valor} onChange={(e) => onChange(e.target.value)} placeholder={k.dica} />;
  const tipo = k.tipo === "hora" ? "time" : k.tipo === "numero" ? "number" : k.tipo === "data" ? "date" : "text";
  return <Entrada type={tipo} value={valor} onChange={(e) => onChange(e.target.value)} placeholder={k.dica} />;
}

function ItemModal({ viagemId, item, aberto, onFechar, onSalvo }: {
  viagemId: string; item: Componente | null; aberto: boolean; onFechar: () => void; onSalvo: () => void;
}) {
  const novo = !item;
  const [tipo, setTipo] = useState<string>("aereo");
  const [nome, setNome] = useState("");
  const [ini, setIni] = useState("");
  const [fim, setFim] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [status, setStatus] = useState<StatusItem>("vendido");
  const [dados, setDados] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setTipo(item?.tipo ?? "aereo");
    setNome(item?.nome ?? "");
    setIni(item?.data_inicio ?? "");
    setFim(item?.data_fim ?? "");
    setFornecedor(item?.fornecedor ?? "");
    setStatus(item?.status ?? "vendido");
    const d: Record<string, string> = {};
    for (const [k, v] of Object.entries(item?.dados ?? {})) d[k] = valorTexto(v);
    setDados(d);
  }, [aberto, item]);

  const info = infoDoTipo(tipo);
  const campos = camposDoItem(tipo);

  async function salvar() {
    setOcupado(true); setErro(null);
    try {
      if (novo) {
        if (nome.trim().length < 2) throw new Error("Dê um nome ao item (ex.: " + (info.exemploNome || "Seguro viagem") + ").");
        const limpo: Record<string, unknown> = {};
        for (const k of campos) if ((dados[k.chave] ?? "").trim()) limpo[k.chave] = dados[k.chave].trim();
        await lancarItemAvulso(viagemId, { tipo, nome: nome.trim(), data_inicio: ini || null, data_fim: fim || null, dados: limpo, fornecedor: fornecedor.trim() || null, status });
      } else {
        // só manda o que mudou; campo apagado vai como null (o banco tira a chave)
        const mud: Record<string, unknown> = {};
        for (const k of campos) {
          const antes = valorTexto(item!.dados[k.chave]);
          const agora = (dados[k.chave] ?? "").trim();
          if (antes !== agora) mud[k.chave] = agora || null;
        }
        await salvarItem(item!.id, { status: status !== item!.status ? status : undefined, dados: Object.keys(mud).length ? mud : undefined });
      }
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} largura={620}
      titulo={novo ? "Lançar item na viagem" : `${info.emoji} ${item!.nome}`}
      rodape={<><Button variant="ghost" onClick={onFechar}>Cancelar</Button><Button variant="primary" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar"}</Button></>}>
      <div className="space-y-3">
        {novo && (
          <>
            <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              Para o que foi vendido fora do QS (ou que chegou do Bitrix sem itens). Venda nova feita pelo closer já chega com os itens.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo rotulo="Tipo">
                <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {TIPOS_LANCAVEIS.map((t) => <option key={t} value={t}>{infoDoTipo(t).emoji} {infoDoTipo(t).rotulo}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Nome do item *"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder={info.exemploNome} /></Campo>
              {info.datas[0] && <Campo rotulo={info.datas[0]}><Entrada type="date" value={ini} onChange={(e) => setIni(e.target.value)} /></Campo>}
              {info.datas[1] && <Campo rotulo={info.datas[1]}><Entrada type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></Campo>}
              <Campo rotulo="Fornecedor"><Entrada value={fornecedor} onChange={(e) => setFornecedor(e.target.value)} /></Campo>
            </div>
          </>
        )}
        {!novo && (
          <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
            {datasDoItem(item!) || "Sem datas"}{item!.fornecedor ? ` · ${item!.fornecedor}` : ""} — o que foi vendido (nome, datas, valor) é do Comercial; aqui o Rel registra a emissão.
          </p>
        )}
        <Campo rotulo="Situação">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Situação do item">
            {(Object.keys(STATUS_ITEM) as StatusItem[]).map((s) => (
              <label key={s} className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: "var(--text)" }}>
                <input type="radio" name="status-item" checked={status === s} onChange={() => setStatus(s)} /> {STATUS_ITEM[s]}
              </label>
            ))}
          </div>
        </Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campos.map((k) => (
            <div key={k.chave} className={k.largo ? "sm:col-span-2" : undefined}>
              <Campo rotulo={k.rotulo}><CampoDinamico k={k} valor={dados[k.chave] ?? ""} onChange={(v) => setDados((d) => ({ ...d, [k.chave]: v }))} /></Campo>
            </div>
          ))}
        </div>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── O bloco ─────────────────────────────────────────────────────────────────

const TOM_GRUPO: Record<string, string> = { venda: "Venda", emissao: "Emissão", documento: "Documentos", pagamento: "Pagamento", operacao: "Relacionamento" };

export default function TudoDaViagem({ v, pass, versao, onMudou, onAbrirExpedicao }: {
  v: Viagem; pass: Passageiro[]; versao: number; onMudou: () => void; onAbrirExpedicao?: (id: string, tipo: string | null) => void;
}) {
  const podeEditar = usePode("relacionamento.editar_viagens") === true;
  const [comps, setComps] = useState<Componente[] | null>(null);
  const [comItens, setComItens] = useState(true);
  const [pag, setPag] = useState<ResumoPagamento | null>(null);
  const [docs, setDocs] = useState<DocResumo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Componente | null>(null);
  const [lancando, setLancando] = useState(false);

  const carregar = useCallback(() => {
    carregarComponentes(v.id)
      .then((r) => { setComps(r.itens); setComItens(r.comItensDaVenda); setErro(null); })
      .catch((e) => { setComps([]); setErro(e instanceof Error ? e.message : "Não carregou os componentes."); });
    pagamentoDaViagem(v.id).then(setPag).catch(() => setPag(null));
    documentosDaViagem(v.id).then(setDocs).catch(() => setDocs([]));
  }, [v.id]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  const faltas = useMemo(() => (comps ? oQueFalta(v, comps, pass, pag, docs) : []), [v, comps, pass, pag, docs]);
  const datas = useMemo(() => (comps ? proximasDatas(v, comps, pag) : []), [v, comps, pag]);
  const porTipo = useMemo(() => {
    const m = new Map<string, Componente[]>();
    for (const c of comps ?? []) m.set(c.tipo, [...(m.get(c.tipo) ?? []), c]);
    return ordemDosTipos([...m.keys()]).map((t) => ({ tipo: t, itens: m.get(t)! }));
  }, [comps]);

  const mudou = () => { setEditando(null); setLancando(false); carregar(); onMudou(); };
  const urgentes = faltas.filter((f) => f.tom === "danger").length;

  return (
    <section className="qs-card p-4 sm:p-5" aria-label="Tudo da viagem">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-[15px] font-semibold" style={{ color: "var(--text)" }}>Tudo da viagem</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{v.servico ? SERVICOS[v.servico] : "serviço a classificar"}</Badge>
          <Badge tone={v.responsavel_id ? undefined : "warn"}>{v.responsavel_nome ? `cuida: ${v.responsavel_nome.replace(/\s*\|.*$/, "")}` : "sem dono"}</Badge>
          {pag && pag.planos > 0 && <Badge tone={pag.atrasado > 0 ? "danger" : pag.em_aberto > 0 ? "info" : "ok"}>{pag.atrasado > 0 ? "pagamento atrasado" : pag.em_aberto > 0 ? `recebido ${brl(pag.pago)} de ${brl(pag.total)}` : "pago"}</Badge>}
          {podeEditar && comItens && v.status === "ativa" && <Button size="sm" onClick={() => setLancando(true)}>+ Lançar item</Button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 mb-4">
        {/* O que falta */}
        <div>
          <p className="qs-label mb-1.5">O que falta {faltas.length > 0 && <span className="qs-num">· {faltas.length}{urgentes ? ` (${urgentes} urgente${urgentes > 1 ? "s" : ""})` : ""}</span>}</p>
          {comps === null ? (
            <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--surface-2)" }} />
          ) : faltas.length === 0 ? (
            <p className="text-[13px] qs-tone-ok">{v.fase === "concluida" ? "Viagem concluída." : "Nada pendente no que o sistema consegue ver."}</p>
          ) : (
            <ul className="space-y-1">
              {faltas.map((f) => (
                <li key={f.chave} className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text)" }}>
                  <StatusDot tone={f.tom} />
                  <span className="flex-1 min-w-0">{f.texto}</span>
                  <span className="text-[11px] flex-shrink-0" style={{ color: "var(--subtle)" }}>{TOM_GRUPO[f.grupo]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Próximas datas */}
        <div>
          <p className="qs-label mb-1.5">Próximas datas</p>
          {datas.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--subtle)" }}>{v.data_embarque ? "Nenhuma data pela frente." : "Sem data de embarque."}</p>
          ) : (
            <ul className="space-y-1">
              {datas.map((d, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[13px]">
                  <span className="qs-num font-semibold w-[46px] flex-shrink-0" style={{ color: "var(--text)" }}>{dataBR(d.data).slice(0, 5)}</span>
                  <span className="truncate" style={{ color: "var(--muted)" }}>{d.texto}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}

      {/* Componentes por tipo */}
      {comps !== null && porTipo.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--subtle)" }}>
          Nenhum componente ainda. {comItens ? "Venda feita pelo closer no QS chega com os itens; venda antiga do Bitrix: use “+ Lançar item”." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
          {porTipo.map(({ tipo, itens }) => (
            <CartaoTipo key={tipo} tipo={tipo} itens={itens} podeEditar={podeEditar && v.status === "ativa"} onEditar={setEditando} onAbrirExpedicao={onAbrirExpedicao} />
          ))}
        </div>
      )}
      {!comItens && (
        <p className="text-[12px] mt-3" style={{ color: "var(--subtle)" }}>
          Mostrando o roteiro e a expedição. Os itens da venda (aéreo, hotel, seguro… com situação de emissão) aparecem quando a atualização do banco (0207/0208) for aplicada.
        </p>
      )}

      <ItemModal viagemId={v.id} item={editando} aberto={!!editando || lancando} onFechar={() => { setEditando(null); setLancando(false); }} onSalvo={mudou} />
    </section>
  );
}
