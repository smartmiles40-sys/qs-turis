// src/expedicoes/paginas/NovasVendas.tsx
// Novas vendas (app antigo: app/(app)/novas-vendas/, 685d5f8): quem a sync do
// Bitrix trouxe NOVO pra uma expedição — o botão "Atualizar do Bitrix" ou a sync
// automática das 09:00 (api/_expBitrixSync.js). O time confere e tira da fila;
// o passageiro continua na expedição.
// Diferenças conscientes em relação ao antigo:
//  - "Entrou em" é quando entrou na FILA (nova_venda_em, 0318), não a criação da
//    linha — o avulso anexado pela sync (b1c8258) é linha antiga com venda nova;
//  - "Conferir" tem desfazer; "Conferir todas" pede confirmação e respeita o filtro;
//  - filtro por expedição e o quadro da última sync automática (no modo seco
//    mostra o que ela FARIA quando for ligada).
//  - o botão WhatsApp com link mágico (e3816fa) fica pro porte do ExpedAmigo.
// Somente leitura (perfil de leitura ou modo validação do espelho): botões desligados.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao, Modal, Vazio, Aviso } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Cartao, Selo, useAoVivo, type Tom } from "../ui";
import { formatDate, formatDateTime } from "../lib/utils";
import {
  devolverParaFila, FilaIndisponivel, listarNovasVendas, marcarConferidas, ultimaRodadaSync,
  type NovaVenda, type RodadaSync,
} from "../lib/novasVendas";

const tomStatus = (s: string): Tom => (s === "Confirmado" ? "ok" : s === "Pré-reserva" ? "lista" : s === "Cancelado" ? "erro" : "aviso");

export default function NovasVendas() {
  const ctx = useExp();
  const { ir, avisar } = ctx;
  // O modo validação (espelho ligado) vem do contexto quando existir; o perfil de leitura sempre.
  const bloqueado = ctx.somenteLeitura || Boolean((ctx as unknown as { modoValidacao?: boolean }).modoValidacao);
  const motivoBloqueio = ctx.somenteLeitura ? "Seu perfil é só de leitura nas Expedições." : "Modo validação: as telas estão só leitura enquanto o espelho do sistema antigo está ligado.";

  const [itens, setItens] = useState<NovaVenda[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [rodada, setRodada] = useState<RodadaSync | null>(null);
  const [busca, setBusca] = useState("");
  const [exp, setExp] = useState("");
  const [indo, setIndo] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<NovaVenda | null>(null);
  const [confirmarTodas, setConfirmarTodas] = useState(false);

  const carregar = useCallback(async () => {
    try { setItens(await listarNovasVendas()); setErro(null); setIndisponivel(null); }
    catch (e) {
      if (e instanceof FilaIndisponivel) { setIndisponivel(e.message); setItens([]); }
      else setErro(e instanceof Error ? e.message : "Erro ao carregar");
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { void ultimaRodadaSync().then(setRodada); }, []);
  useAoVivo([{ tabela: "passageiros" }], carregar, 2000);

  const expedicoes = useMemo(() => {
    const m = new Map<string, { id: string; nome: string; n: number }>();
    for (const r of itens ?? []) {
      const e = m.get(r.expedicao_id) ?? { id: r.expedicao_id, nome: r.expedicao_nome, n: 0 };
      e.n++; m.set(r.expedicao_id, e);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [itens]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return (itens ?? []).filter((r) => (!exp || r.expedicao_id === exp) && (!q
      || r.nome.toLowerCase().includes(q) || r.expedicao_nome.toLowerCase().includes(q) || r.expedicao_codigo.toLowerCase().includes(q)
      || (qd.length >= 3 && ((r.cpf ?? "").replace(/\D/g, "").includes(qd) || (r.bitrix_deal_id ?? "").includes(qd)))));
  }, [itens, busca, exp]);

  const conferir = async (r: NovaVenda) => {
    setIndo(r.passageiro_id);
    try {
      await marcarConferidas([r.passageiro_id]);
      setItens((xs) => (xs ?? []).filter((x) => x.passageiro_id !== r.passageiro_id));
      setDesfazer(r);
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível conferir", "erro"); }
    finally { setIndo(null); }
  };
  const voltar = async (r: NovaVenda) => {
    setDesfazer(null);
    try { await devolverParaFila(r.passageiro_id); await carregar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível desfazer", "erro"); }
  };
  const conferirTodas = async () => {
    setIndo("__todas__");
    try {
      await marcarConferidas(filtrados.map((r) => r.passageiro_id));
      avisar(`${filtrados.length} venda(s) conferida(s)`);
      setConfirmarTodas(false); setDesfazer(null);
      await carregar();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível conferir", "erro"); }
    finally { setIndo(null); }
  };
  const abrir = (r: NovaVenda) => ir(r.expedicao_tipo === "pacote" ? "pacotes" : "expedicoes", `${r.expedicao_id}/passageiros/pax/${r.passageiro_id}`);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-[22px] font-bold flex items-center gap-2" style={{ color: "var(--ink)" }}>
            Novas vendas {itens && itens.length > 0 && <Selo tom="ok">{itens.length}</Selo>}
          </h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Passageiros que entraram novos pela sincronização do Bitrix. Confira cada um (dados, grupo, quarto) e tire da fila.
          </p>
        </div>
        {filtrados.length > 0 && (
          <Botao disabled={bloqueado || indo === "__todas__"} title={bloqueado ? motivoBloqueio : undefined} onClick={() => setConfirmarTodas(true)}>
            ✓ Conferir {exp || busca ? "as filtradas" : "todas"} ({filtrados.length})
          </Botao>
        )}
      </header>

      {bloqueado && itens && itens.length > 0 && <Aviso>{motivoBloqueio} Dá pra ver a fila, mas não conferir.</Aviso>}
      {indisponivel && <Aviso>{indisponivel}</Aviso>}
      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}

      {desfazer && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg text-[13px]" style={{ background: "var(--card2)", color: "var(--ink2)" }} role="status">
          <span className="flex-1"><b>{desfazer.nome}</b> conferida — saiu da fila.</span>
          <Botao variante="fantasma" onClick={() => void voltar(desfazer)}>Desfazer</Botao>
          <button aria-label="Fechar" className="px-1" style={{ color: "var(--ink3)" }} onClick={() => setDesfazer(null)}>×</button>
        </div>
      )}

      {itens && itens.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="rel-input" style={{ maxWidth: 320 }} value={exp} onChange={(e) => setExp(e.target.value)} aria-label="Filtrar por expedição">
            <option value="">Todas as expedições ({itens.length})</option>
            {expedicoes.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.n})</option>)}
          </select>
          <div className="flex-1 min-w-[220px] max-w-sm ml-auto"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar nome, expedição, CPF ou nº do negócio…  [/]" /></div>
        </div>
      )}

      {!itens ? <Carregando texto="Carregando a fila…" /> : filtrados.length === 0 ? (
        itens.length === 0
          ? !indisponivel && <div className="rel-card"><Vazio titulo="Nenhuma venda nova por enquanto" texto="Quando a sincronização do Bitrix trouxer alguém novo pra uma expedição, a pessoa aparece aqui. 🎉" /></div>
          : <div className="rel-card py-10 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nada encontrado para o filtro/busca.</div>
      ) : (
        <section className="rel-card overflow-hidden">
          <ul>
            {filtrados.map((r) => (
              <li key={r.passageiro_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                <button onClick={() => abrir(r)} className="flex-1 min-w-[200px] text-left rel-linha" title="Abrir o passageiro na expedição">
                  <span className="block text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{r.nome}</span>
                  <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {[r.cpf, r.telefone, r.bitrix_deal_id ? `negócio ${r.bitrix_deal_id}` : null].filter(Boolean).join(" · ") || "—"}
                  </span>
                </button>
                <button onClick={() => ir(r.expedicao_tipo === "pacote" ? "pacotes" : "expedicoes", `${r.expedicao_id}/passageiros`)}
                  className="min-w-[180px] text-left hover:underline" title="Abrir a expedição">
                  <span className="block text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}>{r.expedicao_nome}</span>
                  <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{r.destino}{r.data_embarque ? ` · embarque ${formatDate(r.data_embarque)}` : ""}</span>
                </button>
                <Selo tom={tomStatus(r.status_reserva)}>{r.status_reserva}</Selo>
                <span className="text-[12px] whitespace-nowrap" style={{ color: "var(--ink3)" }} title="Quando entrou na fila">{r.entrou_em ? formatDateTime(r.entrou_em) : "—"}</span>
                <span className="flex gap-1.5 ml-auto">
                  <Botao variante="fantasma" onClick={() => abrir(r)}>Abrir</Botao>
                  <Botao variante="primario" disabled={bloqueado || indo === r.passageiro_id} title={bloqueado ? motivoBloqueio : "Conferido — tirar da fila"}
                    onClick={() => void conferir(r)}>{indo === r.passageiro_id ? "…" : "✓ Conferir"}</Botao>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rodada && <QuadroSync rodada={rodada} />}

      <Modal aberto={confirmarTodas} titulo="Conferir as vendas da lista?" onFechar={() => setConfirmarTodas(false)} largura={440}
        rodape={<>
          <Botao onClick={() => setConfirmarTodas(false)}>Cancelar</Botao>
          <Botao variante="primario" disabled={indo === "__todas__"} onClick={() => void conferirTodas()}>{indo === "__todas__" ? "Conferindo…" : `Conferir ${filtrados.length}`}</Botao>
        </>}>
        <p className="text-[13.5px]" style={{ color: "var(--ink2)" }}>
          {filtrados.length} passageiro(s) saem da fila{exp || busca ? " (só os do filtro atual)" : ""}. Eles continuam nas expedições.
        </p>
      </Modal>
    </div>
  );
}

/** Última rodada da sync automática: no modo seco, o que ela FARIA quando for ligada. */
function QuadroSync({ rodada }: { rodada: RodadaSync }) {
  const [aberto, setAberto] = useState(false);
  const exps = Object.values(rodada.resumo ?? {});
  const soma = (k: "criados" | "anexados" | "atualizados") => exps.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const seco = rodada.modo === "seco";
  const comAlgo = exps.filter((r) => !r.ok || (r.criados ?? 0) + (r.anexados ?? 0) + (r.atualizados ?? 0) + (r.sem_grupo?.length ?? 0) + (r.erros?.length ?? 0) > 0);
  return (
    <Cartao titulo={`Sync automática do Bitrix — ${formatDate(rodada.dia)}${seco ? " (modo seco: nada foi gravado)" : ""}`}
      acao={comAlgo.length > 0 ? <Botao variante="fantasma" onClick={() => setAberto((v) => !v)}>{aberto ? "Esconder" : "Ver detalhes"}</Botao> : undefined}>
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        {exps.length} expedição(ões) lidas · {soma("criados")} {seco ? "seriam criados" : "novos"} · {soma("anexados")} {seco ? "seriam anexados" : "anexados"} · {soma("atualizados")} {seco ? "seriam completados" : "completados"}
        {rodada.terminado_em ? ` · terminou ${formatDateTime(rodada.terminado_em)}` : ` · em andamento (última leitura ${formatDateTime(rodada.atualizado_em)})`}
      </p>
      {aberto && (
        <ul className="mt-3 space-y-2">
          {comAlgo.map((r) => (
            <li key={r.codigo} className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              <b style={{ color: "var(--ink)" }}>{r.codigo}</b>{r.coluna ? <span style={{ color: "var(--ink3)" }}> · {r.coluna}</span> : null}
              {!r.ok && <span style={{ color: "var(--err-ink)" }}> — {r.error}</span>}
              {(r.previa ?? []).length > 0 && (
                <ul className="ml-4 list-disc">
                  {(r.previa ?? []).map((p) => (
                    <li key={`${p.acao}-${p.deal}`}>{p.acao === "criar" ? "novo" : p.acao === "anexar" ? "entra (estava avulso)" : `completa ${(p.campos ?? []).join(", ")}`}: {p.nome} <span style={{ color: "var(--ink3)" }}>(negócio {p.deal})</span></li>
                  ))}
                </ul>
              )}
              {(r.sem_grupo ?? []).length > 0 && <div className="ml-4">Sem grupo definido (coluna de mais de uma expedição): {r.sem_grupo!.map((x) => x.nome || x.deal).join(", ")}</div>}
              {(r.erros ?? []).length > 0 && <div className="ml-4" style={{ color: "var(--err-ink)" }}>{r.erros!.length} com erro: {r.erros!.slice(0, 3).map((x) => `${x.deal} (${x.erro})`).join("; ")}</div>}
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
