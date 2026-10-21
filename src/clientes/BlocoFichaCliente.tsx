// src/clientes/BlocoFichaCliente.tsx
// -----------------------------------------------------------------------------
// A FICHA DO CLIENTE vista do Operações (cadastro único, 0172/0173). Serve pra
// gaveta do passageiro (aba "Cliente") e pro perfil da pessoa no Clube de viajantes.
// Mostra: dados da ficha + categoria, divergências pra resolver, TODAS as idas da
// pessoa em expedições/pacotes, viagens do Relacionamento (com trechos),
// documentos do Relacionamento, últimos contatos e notas. Botão "Trocar ficha"
// quando a ligação automática errou.
// Enquanto a 0172/0173 não estão no banco, cada pedaço que não dá pra ler some e
// aparece "Ficha do cliente: aguardando ativação" — nada quebra.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Aviso, Botao, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { buscarClientes, formatarCpf, formatarData, formatarTelefone, type Cliente } from "@/rel/lib/clientes";
import { TIPOS_DOC, TIPOS_TRECHO, type TipoDocumento, type TipoTrecho } from "@/rel/lib/viagens";
import {
  contatosDaFicha, documentosDaFicha, fichaDoCliente, fichasDosPassageiros, idasDaFicha, linkDocumentoFicha, metricaDaFicha,
  notasDaFicha, trocarFicha, viagensDaFicha,
  type ContatoFicha, type DocumentoFicha, type IdaEmExpedicao, type MetricaFicha, type NotaFicha, type ViagemFicha,
} from "./cadastroUnico";
import FilaDivergencias from "./FilaDivergencias";

const CATEGORIA: Record<string, string> = { bronze: "Bronze", silver: "Silver", black: "Black", green: "Green" };
const CANAL: Record<string, string> = { ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail", presencial: "Presencial", instagram: "Instagram", outro: "Outro" };
const moeda = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

type Props = {
  /** Linhas `passageiros` desta pessoa (na gaveta: só a do pax; no Clube: todas). */
  passageiroIds: string[];
  /** Ficha já conhecida (ex.: o Clube agrupou por ela). Sem isso, descobre pelos passageiros. */
  clienteId?: string | null;
  /** Ida que está aberta agora (aparece marcada como "esta"). */
  passageiroAtual?: string;
  somenteLeitura: boolean;
  /** Abre outra ida da pessoa (expedição/pacote). */
  abrirIda?: (ida: IdaEmExpedicao) => void;
  avisar?: (texto: string, tom?: "ok" | "erro") => void;
  /** Algo mudou no banco (trocou ficha, resolveu divergência). */
  onMudou?: () => void;
};

type Estado =
  | { fase: "carregando" }
  | { fase: "inativo" }                         // 0172 ainda não aplicada
  | { fase: "sem_ficha" }                       // passageiro sem ficha ligada
  | { fase: "ok"; clienteId: string; varias: boolean };

export default function BlocoFichaCliente({ passageiroIds, clienteId, passageiroAtual, somenteLeitura, abrirIda, avisar, onMudou }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [rodada, setRodada] = useState(0);
  const [trocando, setTrocando] = useState(false);
  const chave = passageiroIds.join(",");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const r = await fichasDosPassageiros(chave ? chave.split(",") : []);
      if (!vivo) return;
      if (!r.ativo) { setEstado({ fase: "inativo" }); return; }
      const ids = Object.values(r.porPassageiro).filter((x): x is string => !!x);
      const distintas = [...new Set(ids)];
      const escolhida = clienteId && distintas.includes(clienteId) ? clienteId : maisComum(ids) ?? clienteId ?? null;
      setEstado(escolhida ? { fase: "ok", clienteId: escolhida, varias: distintas.length > 1 } : { fase: "sem_ficha" });
    })();
    return () => { vivo = false; };
  }, [chave, clienteId, rodada]);

  const recarregar = useCallback(() => { setRodada((n) => n + 1); onMudou?.(); }, [onMudou]);

  if (estado.fase === "carregando") return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando a ficha do cliente…</p>;
  if (estado.fase === "inativo") return <AguardandoAtivacao />;

  const botaoTrocar = !somenteLeitura && passageiroIds.length > 0 && (
    <Botao variante="fantasma" onClick={() => setTrocando(true)} title="Use quando a ligação automática juntou com a pessoa errada">
      {estado.fase === "sem_ficha" ? "Ligar a uma ficha" : "Trocar ficha"}
    </Botao>
  );
  const modal = (
    <TrocarFicha aberto={trocando} onFechar={() => setTrocando(false)} atual={estado.fase === "ok" ? estado.clienteId : null}
      onEscolher={async (c) => {
        try {
          for (const id of passageiroIds) await trocarFicha(id, c.id);
          avisar?.(`Ligado à ficha de ${c.nome}`);
          setTrocando(false); recarregar();
        } catch (e) { avisar?.(e instanceof Error ? e.message : "Não consegui trocar a ficha", "erro"); }
      }} />
  );

  if (estado.fase === "sem_ficha") {
    return (
      <div className="space-y-3">
        <Aviso>Esta pessoa ainda não está ligada a uma ficha do Relacionamento. Acontece com líder, lead e cancelado (o sistema só cria ficha pra cliente de verdade) — se ela já tem ficha, ligue à mão.</Aviso>
        {botaoTrocar}
        {modal}
      </div>
    );
  }

  return (
    <>
      <ConteudoFicha key={`${estado.clienteId}-${rodada}`} clienteId={estado.clienteId} varias={estado.varias} passageiroAtual={passageiroAtual} somenteLeitura={somenteLeitura}
        abrirIda={abrirIda} avisar={avisar} onMudou={recarregar} acao={botaoTrocar} />
      {modal}
    </>
  );
}

function maisComum(xs: string[]): string | null {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function AguardandoAtivacao() {
  return (
    <div className="rounded-xl border border-dashed p-4 text-[13px]" style={{ borderColor: "var(--line)", color: "var(--ink2)" }}>
      <b style={{ color: "var(--ink)" }}>Ficha do cliente: aguardando ativação.</b>
      <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink3)" }}>
        Quando o cadastro único for ligado, aqui aparece a mesma ficha que o Relacionamento vê: contatos, categoria, todas as viagens e documentos da pessoa.
      </p>
    </div>
  );
}

type Lido<T> = { ok: true; v: T } | { ok: false };
const ler = async <T,>(p: Promise<T>): Promise<Lido<T>> => { try { return { ok: true, v: await p }; } catch { return { ok: false }; } };

function ConteudoFicha({ clienteId, varias, passageiroAtual, somenteLeitura, abrirIda, avisar, onMudou, acao }: {
  clienteId: string; varias: boolean; passageiroAtual?: string; somenteLeitura: boolean; abrirIda?: (ida: IdaEmExpedicao) => void;
  avisar?: (texto: string, tom?: "ok" | "erro") => void; onMudou: () => void; acao: ReactNode;
}) {
  const [d, setD] = useState<{
    ficha: Cliente | null; metrica: MetricaFicha | null; idas: Lido<IdaEmExpedicao[]>; viagens: Lido<ViagemFicha[]>;
    docs: Lido<DocumentoFicha[]>; contatos: Lido<ContatoFicha[]>; notas: Lido<NotaFicha[]>;
  } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [ficha, metrica, idas, viagens, docs, contatos, notas] = await Promise.all([
        fichaDoCliente(clienteId), metricaDaFicha(clienteId).catch(() => null), ler(idasDaFicha(clienteId)), ler(viagensDaFicha(clienteId)),
        ler(documentosDaFicha(clienteId)), ler(contatosDaFicha(clienteId)), ler(notasDaFicha(clienteId)),
      ]);
      if (vivo) setD({ ficha, metrica, idas, viagens, docs, contatos, notas });
    })();
    return () => { vivo = false; };
  }, [clienteId]);

  const abrirDoc = async (doc: DocumentoFicha) => {
    const aba = window.open("", "_blank"); // abre já no clique (senão o navegador bloqueia)
    try {
      const url = await linkDocumentoFicha(doc.arquivo_path);
      if (aba) aba.location.href = url; else window.location.assign(url);
    } catch (e) { aba?.close(); avisar?.(e instanceof Error ? e.message : "Não consegui abrir", "erro"); }
  };

  if (!d) return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando a ficha do cliente…</p>;
  const f = d.ficha;

  return (
    <div className="space-y-5">
      {/* dados da ficha */}
      <section className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Ficha do cliente (Relacionamento)</p>
            <p className="text-[15px] font-bold truncate" style={{ color: "var(--ink)" }}>{f?.nome ?? "Ficha ligada"}</p>
          </div>
          {d.metrica && CATEGORIA[d.metrica.categoria] && <Etiqueta tom="rel">{CATEGORIA[d.metrica.categoria]}</Etiqueta>}
          {acao}
        </div>
        {f ? (
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Linha rotulo="Telefone" valor={f.telefone ? formatarTelefone(f.telefone) : null} />
            <Linha rotulo="E-mail" valor={f.email} />
            <Linha rotulo="CPF" valor={f.cpf ? formatarCpf(f.cpf) : null} />
            <Linha rotulo="Nascimento" valor={f.nascimento ? formatarData(f.nascimento) : null} />
            <Linha rotulo="Passaporte" valor={f.passaporte} />
            <Linha rotulo="Validade" valor={f.passaporte_validade ? formatarData(f.passaporte_validade) : null} />
            {f.observacoes && <div className="sm:col-span-2"><Linha rotulo="Observações" valor={f.observacoes} /></div>}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>A pessoa já está ligada a uma ficha, mas o Operações ainda não tem permissão pra ler os dados dela (aguardando ativação).</p>
        )}
        {d.metrica && (
          <p className="text-[12px]" style={{ color: "var(--ink2)" }}>
            {d.metrica.viagens_compradas} viage{d.metrica.viagens_compradas === 1 ? "m comprada" : "ns compradas"} · {d.metrica.viagens_realizadas} realizada{d.metrica.viagens_realizadas === 1 ? "" : "s"} · {moeda(d.metrica.valor_total)} no total
            {d.metrica.proximo_embarque && ` · próximo embarque ${formatarData(d.metrica.proximo_embarque)}`}
            {d.metrica.dias_sem_contato != null && ` · ${d.metrica.dias_sem_contato} dias sem contato`}
          </p>
        )}
        {varias && <p className="text-[12px]" style={{ color: "var(--warn-ink)" }}>Atenção: as idas desta pessoa estão em fichas diferentes. Mostrando a mais usada — confira e troque se precisar.</p>}
        <p className="text-[11px]" style={{ color: "var(--ink3)" }}>CPF, passaporte, validade, nascimento, e-mail e telefone andam juntos: editar no passageiro atualiza a ficha e as outras viagens da pessoa.</p>
      </section>

      {/* divergências (resolver = escrever: só quem edita) */}
      {!somenteLeitura && <FilaDivergencias clienteId={clienteId} onMudou={onMudou} />}

      {/* idas em expedições */}
      <Secao titulo="Expedições e pacotes" n={d.idas.ok ? d.idas.v.length : undefined}>
        {!d.idas.ok ? <Indisponivel /> : d.idas.v.length === 0 ? <Nada texto="Nenhuma ida em expedição." /> : (
          <ul className="space-y-1.5">
            {d.idas.v.map((i) => {
              const esta = i.id === passageiroAtual;
              return (
                <li key={i.id}>
                  <button type="button" disabled={esta || !abrirIda || !i.expedicao} onClick={() => abrirIda?.(i)}
                    className="w-full flex items-center gap-2 rounded-lg border p-2.5 text-left rel-linha disabled:cursor-default"
                    style={{ borderColor: esta ? "var(--rel)" : "var(--line)" }}>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                        {i.expedicao?.nome ?? "Sem expedição"}{esta && <span className="ml-1.5 text-[11px] font-bold" style={{ color: "var(--rel-ink)" }}>· esta</span>}
                      </span>
                      <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                        {[i.expedicao?.destino, i.expedicao?.data_embarque ? formatarData(i.expedicao.data_embarque) : null, i.expedicao?.tipo === "pacote" ? "Pacote" : null, i.tipo !== "Pagante" ? i.tipo : null].filter(Boolean).join(" · ")}
                        {i.saldo_brl != null && i.saldo_brl > 0 && ` · saldo ${moeda(i.saldo_brl)}`}
                      </span>
                    </span>
                    <Etiqueta tom={i.status_reserva === "Confirmado" ? "rel" : i.status_reserva === "Cancelado" ? "erro" : i.status_reserva === "Pré-reserva" ? "aviso" : "neutro"}>{i.status_reserva}</Etiqueta>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>

      {/* viagens do Relacionamento */}
      <Secao titulo="Viagens no Relacionamento" n={d.viagens.ok ? d.viagens.v.length : undefined}>
        {!d.viagens.ok ? <Indisponivel /> : d.viagens.v.length === 0 ? <Nada texto="Nenhuma viagem registrada no Relacionamento." /> : (
          <ul className="space-y-1.5">
            {d.viagens.v.map((v) => (
              <li key={v.id} className="rounded-lg border p-2.5" style={{ borderColor: "var(--line)", opacity: v.status === "cancelada" ? 0.6 : 1 }}>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</span>
                  {!v.titular && <Etiqueta>acompanhante</Etiqueta>}
                  {v.status === "cancelada" && <Etiqueta tom="erro">cancelada</Etiqueta>}
                </div>
                <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  {[v.destino, v.data_embarque ? `${formatarData(v.data_embarque)}${v.data_retorno ? ` → ${formatarData(v.data_retorno)}` : ""}` : "sem data", v.valor ? moeda(v.valor) : null].filter(Boolean).join(" · ")}
                </p>
                {v.trechos.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {v.trechos.slice(0, 6).map((t) => (
                      <li key={t.id} className="text-[11.5px]" style={{ color: "var(--ink2)" }}>
                        <span style={{ color: "var(--ink3)" }}>{dataHora(t.partida_em)}</span> · {TIPOS_TRECHO[t.tipo as TipoTrecho] ?? t.tipo}
                        {(t.origem || t.destino) && ` ${[t.origem, t.destino].filter(Boolean).join(" → ")}`}
                        {(t.companhia || t.numero) && ` (${[t.companhia, t.numero].filter(Boolean).join(" ")})`}
                      </li>
                    ))}
                    {v.trechos.length > 6 && <li className="text-[11.5px]" style={{ color: "var(--ink3)" }}>+ {v.trechos.length - 6} trecho{v.trechos.length - 6 === 1 ? "" : "s"}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* documentos */}
      <Secao titulo="Documentos do Relacionamento" n={d.docs.ok ? d.docs.v.length : undefined}>
        {!d.docs.ok ? <Indisponivel /> : d.docs.v.length === 0 ? <Nada texto="Nenhum documento na ficha." /> : (
          <ul className="space-y-1">
            {d.docs.v.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--line)" }}>
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={{ color: "var(--ink)" }} title={doc.descricao ?? doc.arquivo_nome ?? ""}>{doc.arquivo_nome ?? doc.descricao ?? "Arquivo"}</span>
                  <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                    {TIPOS_DOC[doc.tipo as TipoDocumento] ?? doc.tipo} · {formatarData(doc.enviado_em.slice(0, 10))}{doc.validade && ` · vale até ${formatarData(doc.validade)}`}
                  </span>
                </span>
                {doc.status === "recusado" && <Etiqueta tom="erro">recusado</Etiqueta>}
                <button type="button" className="font-semibold hover:underline" style={{ color: "var(--rel-ink)" }} onClick={() => void abrirDoc(doc)}>Abrir</button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {/* contatos e notas */}
      <Secao titulo="Últimos contatos">
        {!d.contatos.ok ? <Indisponivel /> : d.contatos.v.length === 0 ? <Nada texto="Nenhum contato registrado." /> : (
          <ul className="space-y-1">
            {d.contatos.v.map((c) => (
              <li key={c.id} className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                <span style={{ color: "var(--ink3)" }}>{dataHora(c.feito_em)}</span> · <b style={{ color: "var(--ink)" }}>{CANAL[c.canal] ?? c.canal}</b>{c.resumo && ` — ${c.resumo}`}
              </li>
            ))}
          </ul>
        )}
      </Secao>
      {d.notas.ok && d.notas.v.length > 0 && (
        <Secao titulo="Notas">
          <ul className="space-y-1.5">
            {d.notas.v.map((n) => (
              <li key={n.id} className="rounded-md border px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--line)" }}>
                <b style={{ color: "var(--ink)" }}>{n.titulo || "Nota"}</b>
                <span className="ml-1.5 text-[11px]" style={{ color: "var(--ink3)" }}>{dataHora(n.atualizado_em)}</span>
                {n.texto && <p className="whitespace-pre-wrap line-clamp-3" style={{ color: "var(--ink2)" }}>{n.texto}</p>}
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}

function Secao({ titulo, n, children }: { titulo: string; n?: number; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>{titulo}{n != null && <span className="ml-1.5 font-semibold" style={{ color: "var(--ink3)" }}>({n})</span>}</h3>
      {children}
    </section>
  );
}
function Linha({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div className="flex gap-2 py-0.5 text-[12.5px]">
      <span className="w-24 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <span className="flex-1 min-w-0 break-words" style={{ color: valor ? "var(--ink)" : "var(--ink3)" }}>{valor || "—"}</span>
    </div>
  );
}
const Nada = ({ texto }: { texto: string }) => <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{texto}</p>;
const Indisponivel = () => <p className="text-[12.5px] italic" style={{ color: "var(--ink3)" }}>Aguardando ativação — o Operações ainda não lê esta parte.</p>;

/** Busca uma ficha do Relacionamento pra ligar o passageiro (quando a automática errou). */
function TrocarFicha({ aberto, atual, onFechar, onEscolher }: { aberto: boolean; atual: string | null; onFechar: () => void; onEscolher: (c: Cliente) => Promise<void> }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<Cliente | null>(null);
  const [indo, setIndo] = useState(false);

  useEffect(() => { if (aberto) { setTermo(""); setLista(null); setErro(null); setEscolhida(null); } }, [aberto]);
  useEffect(() => {
    if (!aberto || termo.trim().length < 2) { setLista(null); return; }
    let vivo = true;
    const t = setTimeout(async () => {
      try { const r = await buscarClientes(termo, 20); if (vivo) { setLista(r); setErro(null); } }
      catch { if (vivo) { setLista([]); setErro("Não consegui buscar as fichas (o Operações pode ainda não ter acesso)."); } }
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo, aberto]);

  return (
    <Modal aberto={aberto} titulo={escolhida ? "Confirmar troca de ficha" : "Trocar ficha do cliente"} onFechar={onFechar} largura={520}
      rodape={escolhida ? <>
        <Botao onClick={() => setEscolhida(null)} disabled={indo}>Voltar</Botao>
        <Botao variante="primario" disabled={indo} onClick={async () => { setIndo(true); try { await onEscolher(escolhida); } finally { setIndo(false); } }}>{indo ? "Trocando…" : "Ligar a esta ficha"}</Botao>
      </> : <Botao onClick={onFechar}>Cancelar</Botao>}>
      {escolhida ? (
        <div className="space-y-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <p>Ligar este passageiro à ficha de <b style={{ color: "var(--ink)" }}>{escolhida.nome}</b>?</p>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>O sistema confere os dados de novo: o que estiver vazio de um lado é completado; o que for diferente aparece como divergência pra alguém escolher.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Use quando o sistema juntou com a pessoa errada (ex.: parente com o mesmo e-mail). Busque por nome, CPF, telefone, e-mail ou passaporte.</p>
          <Entrada autoFocus placeholder="Buscar ficha…" value={termo} onChange={(e) => setTermo(e.target.value)} />
          {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
          {lista && !erro && (lista.length === 0 ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhuma ficha encontrada.</p> : (
            <ul className="space-y-1 max-h-[50vh] overflow-y-auto">
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" disabled={c.id === atual} onClick={() => setEscolhida(c)}
                    className="w-full text-left rounded-lg border px-2.5 py-2 rel-linha disabled:opacity-60 disabled:cursor-default" style={{ borderColor: "var(--line)" }}>
                    <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{c.nome}{c.id === atual && " (ficha atual)"}</span>
                    <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                      {[c.cpf ? formatarCpf(c.cpf) : null, c.telefone ? formatarTelefone(c.telefone) : null, c.email, c.nascimento ? formatarData(c.nascimento) : null].filter(Boolean).join(" · ") || "sem dados"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
    </Modal>
  );
}
