// src/closer/PipelinePage.tsx
// -----------------------------------------------------------------------------
// O PIPELINE DO CLOSER (0174 → 0205, 26/10/2026): um cartão por cliente.
//
//   Aguardando reunião · Reagendamento · Em cotação · Em negociação · No-show ·
//   Oportunidade futura · Aguardando emissão · Venda cancelada · Perdido ·
//   Venda realizada
//
// Tudo é feito AQUI e vai pro Bitrix depois (na hora; o cron reenvia o que
// ficou pendente). O cartão nasce na reunião agendada e anda sozinho com ela
// (reagendou, no-show, realizada → Em cotação) e com a proposta enviada
// (→ Em negociação). Aguardando emissão só pela ficha de fechamento.
// Cliente que já tinha card no Bitrix: "Trazer do Bitrix" pelo ID do negócio.
// O closer vê só os próprios cartões; a gestão filtra por closer.
// Filtros: período (quando entrou no pipeline), etapa e closer (só a gestão).
// Cada coluna mostra quantos cartões e quanto vale.
// 0351: cartão com família vira PASTA — "Família · N pessoas" e, aberto, quem vai.
// 0352: com contrato por pessoa, a pasta mostra "contratos 2/4 assinados".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { ETAPAS, ETAPAS_COM_MOTIVO, ETAPAS_FINAIS, NOME_ETAPA, bancoSemPipelineV2, brl, dataBr, emPreVenda, espelharNoBitrix, listarNegocios, moverNegocio, nomeDoLead, seloDaVenda, trazerDoBitrix, useConfigDaArea, type Etapa, type Negocio } from "./lib";
import NegocioPainel, { type LinksDoPainel } from "./NegocioPainel";
import { familiasDosNegocios } from "@/venda/familia";
import { ativas, ehFamilia, linhaCurta, resumoContratosFamilia, resumoFamilia, type FamiliaDaVenda } from "@/venda/familiaRegras";

const PERIODOS = [
  { id: "30", rotulo: "Últimos 30 dias" },
  { id: "90", rotulo: "Últimos 90 dias" },
  { id: "365", rotulo: "Último ano" },
  { id: "tudo", rotulo: "Tudo" },
];

export default function PipelinePage({ abrirId, onAbrirId, links }: {
  abrirId: string | null;
  onAbrirId: (id: string | null) => void;
  links: LinksDoPainel;
}) {
  const { currentUser } = useQsAuth();
  const gestao = currentUser?.role === "admin" || currentUser?.role === "gestor";
  const ehCloser = currentUser?.role === "closer";
  const [lista, setLista] = useState<Negocio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(() => { try { return localStorage.getItem("qs_closer_periodo") || "90"; } catch { return "90"; } });
  const [etapaFiltro, setEtapaFiltro] = useState<Etapa | "">("");
  const [closerFiltro, setCloserFiltro] = useState("");
  const [closers, setClosers] = useState<{ id: string; name: string }[]>([]);
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [perdendo, setPerdendo] = useState<{ id: string; etapa: Etapa; motivo: string } | null>(null);
  const [trazendo, setTrazendo] = useState<{ dealId: string; closerId?: string; ocupado: boolean; erro: string | null } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const config = useConfigDaArea();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const desde = periodo === "tudo" ? null : new Date(Date.now() - Number(periodo) * 86400000).toISOString();
      // Closer: só os clientes dele.
      setLista(await listarNegocios({ desde, closerId: ehCloser ? currentUser?.id ?? null : closerFiltro || null }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [periodo, closerFiltro, ehCloser, currentUser?.id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { try { localStorage.setItem("qs_closer_periodo", periodo); } catch { /* sem memória */ } }, [periodo]);
  useEffect(() => {
    if (!gestao) return;
    void supabase.from("qs_users").select("id, name").eq("role", "closer").eq("is_active", true).order("name")
      .then(({ data }) => setClosers((data ?? []) as { id: string; name: string }[]));
  }, [gestao]);

  // ZUMBIS (09/11): cartão em Aguardando reunião/Reagendamento cuja reunião foi
  // CANCELADA e o lead não tem reunião mais nova. Nada anda sozinho — o cartão
  // só ganha um selo pro closer reagendar ou marcar perdido. Uma consulta pelos
  // ids da lista (+1 só pros leads das canceladas).
  const [zumbis, setZumbis] = useState<Set<string>>(new Set());
  useEffect(() => {
    const alvo = lista.filter((n) => (n.etapa === "aguardando_reuniao" || n.etapa === "reagendamento") && n.meeting_id);
    if (!alvo.length) { setZumbis(new Set()); return; }
    let vivo = true;
    void (async () => {
      try {
        const ids = [...new Set(alvo.map((n) => n.meeting_id as string))];
        const canceladas = new Map<string, { lead_id: string; created_at: string }>();
        for (let i = 0; i < ids.length; i += 150) {
          const { data, error } = await supabase.from("qs_meetings").select("id, lead_id, status, created_at")
            .in("id", ids.slice(i, i + 150)).eq("status", "cancelada");
          if (error) return;
          for (const m of (data ?? []) as { id: string; lead_id: string; created_at: string }[]) canceladas.set(m.id, m);
        }
        const novas = new Map<string, string>(); // lead → created_at da reunião não cancelada mais nova
        const leads = [...new Set([...canceladas.values()].map((m) => m.lead_id))];
        for (let i = 0; i < leads.length; i += 150) {
          const { data, error } = await supabase.from("qs_meetings").select("lead_id, created_at")
            .in("lead_id", leads.slice(i, i + 150)).neq("status", "cancelada");
          if (error) return;
          for (const m of (data ?? []) as { lead_id: string; created_at: string }[]) {
            if (!novas.has(m.lead_id) || m.created_at > (novas.get(m.lead_id) as string)) novas.set(m.lead_id, m.created_at);
          }
        }
        const set = new Set<string>();
        for (const n of alvo) {
          const c = canceladas.get(n.meeting_id as string);
          if (!c) continue;
          const nova = novas.get(c.lead_id);
          if (!nova || new Date(nova) <= new Date(c.created_at)) set.add(n.id);
        }
        if (vivo) setZumbis(set);
      } catch { /* selo é extra: falhou, o quadro segue igual */ }
    })();
    return () => { vivo = false; };
  }, [lista]);

  // 0351: a PASTA da família de cada cartão (venda_familia). Extra: falhou, o quadro segue igual.
  const [familias, setFamilias] = useState<Map<string, FamiliaDaVenda>>(new Map());
  const [pastaAberta, setPastaAberta] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = lista.filter((n) => n.pre_venda_em || n.consolidada_em).map((n) => n.id);
    if (!ids.length) { setFamilias(new Map()); return; }
    let vivo = true;
    familiasDosNegocios(ids).then((m) => vivo && setFamilias(m)).catch(() => undefined);
    return () => { vivo = false; };
  }, [lista]);

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return lista.filter((n) => !b || nomeDoLead(n.lead).toLowerCase().includes(b) || (n.lead?.phone ?? "").includes(b));
  }, [lista, busca]);
  const colunas = useMemo(() => ETAPAS.filter((e) => !etapaFiltro || e.id === etapaFiltro), [etapaFiltro]);
  const porEtapa = useMemo(() => {
    const m = new Map<Etapa, Negocio[]>();
    for (const n of filtrados) m.set(n.etapa, [...(m.get(n.etapa) ?? []), n]);
    return m;
  }, [filtrados]);

  const abertos = filtrados.filter((n) => !ETAPAS_FINAIS.includes(n.etapa));
  // Pré-venda (0207) já é venda pro Dashboard: conta aqui também.
  const vendas = filtrados.filter((n) => n.etapa === "venda_realizada" || n.etapa === "aguardando_emissao" || emPreVenda(n));
  const valorDe = (n: Negocio) => Number(n.ficha?.valor_total ?? n.pre_venda_valor ?? n.valor_previsto ?? 0);

  /** Moveu no QS → manda pro Bitrix na hora (se falhar, o cron tenta de novo). */
  async function mover(id: string, etapa: Etapa, motivo?: string) {
    try {
      setLista((l) => l.map((x) => (x.id === id ? { ...x, etapa } : x)));
      await moverNegocio(id, etapa, motivo);
      void espelharNoBitrix(id)
        .then((r) => { if (!r.ok && r.status === "erro") setAviso(`Mudou no QS, mas o Bitrix recusou: ${r.mensagem}`); })
        .catch(() => null)
        .finally(() => void carregar());
    } catch (e) {
      setAviso((e as Error).message);
    }
    void carregar();
  }

  function soltar(id: string, etapa: Etapa) {
    const n = lista.find((x) => x.id === id);
    if (!n || n.etapa === etapa) return;
    if (etapa === "aguardando_emissao" && !n.consolidada_em) {
      setAviso(emPreVenda(n)
        ? "Pra ir pra Aguardando emissão, use \"Fechar a venda\" no cartão (pagamento e contrato)."
        : "Pra ir pra Aguardando emissão, use \"Registrar venda\" no cartão.");
      onAbrirId(id);
      return;
    }
    if ((etapa === "venda_realizada" || etapa === "venda_cancelada") && !n.consolidada_em) {
      setAviso(`${NOME_ETAPA[etapa]} vale só pra venda fechada. Abra o cartão: "Registrar venda" e depois "Fechar a venda".`);
      return;
    }
    if (ETAPAS_COM_MOTIVO.includes(etapa)) { setPerdendo({ id, etapa, motivo: "" }); return; }
    void mover(id, etapa);
  }

  async function trazer() {
    if (!trazendo?.dealId.trim() || trazendo.ocupado) return;
    setTrazendo({ ...trazendo, ocupado: true, erro: null });
    try {
      const r = await trazerDoBitrix(trazendo.dealId, gestao ? trazendo.closerId || closerFiltro || null : null);
      setTrazendo(null);
      setAviso(r.comOutro
        ? `${r.cliente || "Esse cliente"} já está com ${r.com} (cartão em “${NOME_ETAPA[r.etapa]}”). Se for seu, peça pra ${r.com} ou pro gestor passar pra você em “Trocar responsável”.`
        : `${r.cliente || "Cliente"} entrou no quadro em “${NOME_ETAPA[r.etapa]}”${r.com ? `, com ${r.com}` : ""}.`);
      void carregar();
    } catch (e) {
      setTrazendo((t) => (t ? { ...t, ocupado: false, erro: (e as Error).message } : t));
    }
  }

  if (abrirId) {
    return <NegocioPainel id={abrirId} onVoltar={() => { onAbrirId(null); void carregar(); }} links={links} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Pipeline</h1>
        <span className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Em aberto: <b>{abertos.length}</b> · {brl(abertos.reduce((s, n) => s + valorDe(n), 0))}
          {"  "}· Vendas: <b>{vendas.length}</b> · {brl(vendas.reduce((s, n) => s + valorDe(n), 0))}
        </span>
        {config?.bitrix !== false && <Botao onClick={() => setTrazendo({ dealId: "", closerId: closerFiltro, ocupado: false, erro: null })}>Trazer do Bitrix</Botao>}
      </div>

      {/* Celular (04/11): busca na largura toda e os filtros lado a lado (eram 3 linhas). */}
      <div className="flex flex-wrap gap-2">
        <input className="rel-input max-md:!max-w-none max-md:basis-full" style={{ maxWidth: 240 }} placeholder="Buscar cliente ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente" />
        <select className="rel-input max-md:!max-w-none max-md:flex-1 max-md:min-w-0" style={{ maxWidth: 180 }} value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.rotulo}</option>)}
        </select>
        <select className="rel-input max-md:!max-w-none max-md:flex-1 max-md:min-w-0" style={{ maxWidth: 200 }} value={etapaFiltro} onChange={(e) => setEtapaFiltro(e.target.value as Etapa | "")} aria-label="Etapa">
          <option value="">Todas as etapas</option>
          {ETAPAS.map((e) => <option key={e.id} value={e.id}>{e.rotulo}</option>)}
        </select>
        {gestao && (
          <select className="rel-input max-md:!max-w-none max-md:flex-1 max-md:min-w-0" style={{ maxWidth: 200 }} value={closerFiltro} onChange={(e) => setCloserFiltro(e.target.value)} aria-label="Closer">
            <option value="">Todos os closers</option>
            {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {aviso && <Aviso>{aviso} <button className="underline ml-1" onClick={() => setAviso(null)}>ok</button></Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!carregando && bancoSemPipelineV2 && (
        <Aviso>Prévia: o banco ainda está na versão antiga do pipeline (falta aplicar a 0205 junto com o deploy). Os cartões antigos aparecem na coluna nova equivalente; não mova nada por aqui.</Aviso>
      )}

      {carregando ? (
        <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : !filtrados.length ? (
        <Vazio titulo="Nenhum cliente no pipeline" texto="Toda reunião agendada com você cria um cartão em “Aguardando reunião”. Cliente que já tinha card no Bitrix: use “Trazer do Bitrix”." />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollSnapType: "x proximity" }}>
          {colunas.map((col) => {
            const itens = porEtapa.get(col.id) ?? [];
            const total = itens.reduce((s, n) => s + valorDe(n), 0);
            return (
              <section key={col.id} aria-label={col.rotulo}
                className="flex-shrink-0 w-[264px] rounded-xl flex flex-col max-h-[calc(100dvh-230px)]"
                style={{ background: "var(--card2)", border: "1px solid var(--line)", scrollSnapAlign: "start" }}
                onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); setArrastando(null); if (id) void soltar(id, col.id); }}>
                <header className="px-3 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.cor }} aria-hidden />
                    <span className="text-[13px] font-bold flex-1" style={{ color: "var(--ink)" }}>{col.rotulo}</span>
                    <span className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}>{itens.length}</span>
                  </div>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{brl(total)}</p>
                </header>
                <div className="px-2 pb-2 space-y-2 overflow-y-auto flex-1">
                  {itens.map((n) => {
                    const atrasada = n.proxima_acao_em && new Date(n.proxima_acao_em).getTime() < Date.now();
                    const fam = familias.get(n.id);
                    const pasta = fam && ehFamilia(fam) ? fam : null;
                    const aberta = pastaAberta.has(n.id);
                    return (
                      <div key={n.id} className="rounded-lg" style={pasta ? { boxShadow: "3px 3px 0 0 var(--line)" } : undefined}>
                      <button draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/plain", n.id); setArrastando(n.id); }}
                        onDragEnd={() => setArrastando(null)}
                        onClick={() => onAbrirId(n.id)}
                        className="w-full text-left rounded-lg p-2.5 rel-linha"
                        style={{ background: "var(--card)", border: "1px solid var(--line)", opacity: arrastando === n.id ? 0.5 : 1 }}>
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{nomeDoLead(n.lead)}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--ink2)" }}>
                          {valorDe(n) ? brl(valorDe(n)) : "sem valor"}
                          {gestao && n.closer?.name ? <span style={{ color: "var(--ink3)" }}> · {n.closer.name.split(" ")[0]}</span> : null}
                        </p>
                        {n.proxima_acao && (
                          <p className="text-[12px] mt-1 truncate" style={{ color: atrasada ? "var(--err-ink)" : "var(--ink3)" }}>
                            → {n.proxima_acao}{n.proxima_acao_em ? ` (${dataBr(n.proxima_acao_em)})` : ""}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(() => { const s = seloDaVenda(n); return s ? <Etiqueta tom={s.tom}>{s.t}</Etiqueta> : null; })()}
                          {zumbis.has(n.id) && <Etiqueta tom="aviso">Reunião cancelada — reagende ou marque perdido</Etiqueta>}
                          {/* "Indo pro Bitrix" saiu (27/10): é automático, ninguém precisa ver. */}
                          {n.bitrix_status === "erro" && <Etiqueta tom="erro">Bitrix não atualizou</Etiqueta>}
                          {n.bitrix_status === "sem_card" && <Etiqueta>Sem card no Bitrix</Etiqueta>}
                          {ETAPAS_COM_MOTIVO.includes(n.etapa) && n.motivo_perda && <Etiqueta>{n.motivo_perda.slice(0, 30)}</Etiqueta>}
                        </div>
                      </button>
                      {pasta && (() => {
                        const r = resumoFamilia(pasta);
                        // 0352: um contrato por pessoa → "contratos 2/4 assinados".
                        const rc = resumoContratosFamilia(pasta);
                        return (
                          <div className="px-2.5 pb-2 -mt-1 rounded-b-lg" style={{ background: "var(--card)", border: "1px solid var(--line)", borderTop: "none" }}>
                            <button type="button" aria-expanded={aberta} className="w-full text-left text-[12px] font-semibold pt-1.5 flex items-center gap-1.5"
                              style={{ color: "var(--rel-ink)" }}
                              onClick={() => setPastaAberta((s) => { const c = new Set(s); if (c.has(n.id)) c.delete(n.id); else c.add(n.id); return c; })}>
                              <span aria-hidden>{aberta ? "▾" : "▸"}</span> 👨‍👩‍👧 {r.texto}
                              {r.menores > 0 && <span style={{ color: "var(--ink3)", fontWeight: 400 }}> · {r.menores} menor{r.menores > 1 ? "es" : ""}</span>}
                              {r.incompletas > 0 && <span style={{ color: "var(--err-ink)", fontWeight: 400 }}> · {r.incompletas} sem dados</span>}
                              {rc.texto && <span style={{ color: rc.assinados === rc.total ? "var(--rel-ink)" : "var(--ink3)", fontWeight: 400 }}> · {rc.texto}</span>}
                            </button>
                            {aberta && (
                              <ul className="mt-1 space-y-0.5">
                                {ativas(pasta.pessoas).map((p) => (
                                  <li key={p.id} className="text-[12px] truncate" style={{ color: p.comprador ? "var(--ink)" : "var(--ink2)" }} title={linhaCurta(p)}>
                                    {p.comprador ? "★ " : "• "}{linhaCurta(p)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })()}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal aberto={!!perdendo} titulo={perdendo?.etapa === "venda_cancelada" ? "Cancelar a venda" : "Marcar como perdido"} onFechar={() => setPerdendo(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setPerdendo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={!perdendo?.motivo.trim()} onClick={async () => {
            if (!perdendo) return;
            const { id, etapa, motivo } = perdendo;
            setPerdendo(null);
            await mover(id, etapa, motivo);
          }}>{perdendo?.etapa === "venda_cancelada" ? "Cancelar venda" : "Marcar perdido"}</Botao>
        </>}>
        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="motivo-perda">{perdendo?.etapa === "venda_cancelada" ? "Por que a venda foi cancelada?" : "Por que não fechou?"}</label>
        <textarea id="motivo-perda" className="rel-input" rows={3} value={perdendo?.motivo ?? ""} onChange={(e) => perdendo && setPerdendo({ ...perdendo, motivo: e.target.value })} />
      </Modal>

      <Modal aberto={!!trazendo} titulo="Trazer cliente do Bitrix" onFechar={() => setTrazendo(null)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setTrazendo(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={!trazendo?.dealId.trim() || trazendo?.ocupado || (gestao && !trazendo?.closerId)} onClick={() => void trazer()}>
            {trazendo?.ocupado ? "Buscando…" : "Trazer"}
          </Botao>
        </>}>
        <p className="text-[13px] mb-3" style={{ color: "var(--ink2)" }}>
          Pra quem já tinha card no Bitrix antes do quadro novo. Cole o ID do negócio (o número no endereço do card).
          O cartão entra na coluna em que o negócio está no Bitrix.
        </p>
        {gestao && (
          <>
            {/* 09/11: trazido pela conta Master sem escolher closer, o Fabrício ficou no nome do Master. */}
            <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="trazer-closer">Closer responsável</label>
            <select id="trazer-closer" className="rel-input mb-3" value={trazendo?.closerId ?? ""}
              onChange={(e) => trazendo && setTrazendo({ ...trazendo, closerId: e.target.value })}>
              <option value="">Escolha o closer…</option>
              {closers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
        <label className="block text-[13px] font-semibold mb-1" style={{ color: "var(--ink2)" }} htmlFor="deal-id">ID do negócio no Bitrix</label>
        <input id="deal-id" className="rel-input" inputMode="numeric" autoFocus value={trazendo?.dealId ?? ""}
          onChange={(e) => trazendo && setTrazendo({ ...trazendo, dealId: e.target.value.replace(/\D/g, "") })}
          onKeyDown={(e) => { if (e.key === "Enter") void trazer(); }} />
        {trazendo?.erro && <div className="mt-2"><Aviso tom="erro">{trazendo.erro}</Aviso></div>}
      </Modal>
    </div>
  );
}
