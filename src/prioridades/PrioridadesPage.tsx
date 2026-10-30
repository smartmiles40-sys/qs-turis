// src/prioridades/PrioridadesPage.tsx
// -----------------------------------------------------------------------------
// PRIORIDADES · ACOMPANHAMENTO DIÁRIO (V2, 30/10/2026 — 0226).
// A MESMA tela no Relacionamento (#rel/prioridades) e em Operações (#ops/prioridades).
//
// Um cartão por acompanhamento prioritário (pacote ou grupo):
//   · onde está hoje (em viagem / embarca em X dias / voltou) — pela fase da view;
//   · quem viaja, telefone, o que está no Bitrix;
//   · o trecho de HOJE (voo, transfer, passeio, check-in) e o próximo — rel_trechos_v;
//   · pendências: tarefas da esteira + alterações a fazer;
//   · CHECK DO DIA: quem acompanhou, "tudo ok / tem problema", nota, histórico por dia.
//     Quem ainda não teve o check de hoje fica em VERMELHO, no topo.
// Embaixo: SUGESTÕES (grupo grande / valor alto) que ninguém marcou — a decisão é humana.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { useAoVivo } from "@/expedicoes/ui";
import { dataBR, hojeSP, horaDoLugar, periodo, proximoVoo, TIPOS_TRECHO, type Trecho } from "@/rel/lib/viagens";
import { formatarTelefone } from "@/rel/lib/clientes";
import { Aviso, Botao, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import {
  MOTIVOS, SemMigration, apagarAlteracao, apagarCheck, buscarPacotes, carregarPainel, carregarSugestoes, criarAlteracao, desmarcarPrioridade,
  doSetor, incluirViagens, marcarAlteracao, pedeCheck, primeiroNome, reais, recarregarSelos, registrarCheck, salvarConfig, salvarPrioridade, tirarViagem,
  type Cartao, type Check, type Config, type Painel, type Pessoa, type Setor, type Sugestao, type ViagemP,
} from "./lib";
import { MarcarPrioridade } from "./SeloPrioridade";

const VERMELHO = { bg: "var(--err-bg)", fg: "var(--err-ink)", borda: "var(--err-line)" };
const abrirViagem = (id: string) => {
  const area = window.location.hash.startsWith("#ops") ? "ops" : "rel";
  window.location.hash = `#${area}/viagem/${encodeURIComponent(id)}`;
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export default function PrioridadesPage({ setor }: { setor: Setor }) {
  const { currentUser } = useQsAuth();
  const [painel, setPainel] = useState<Painel | null>(null);
  const [sugestoes, setSugestoes] = useState<Sugestao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semMigration, setSemMigration] = useState(false);
  const [novo, setNovo] = useState(false);
  const [marcar, setMarcar] = useState<{ v: ViagemP; juntar: string[] } | null>(null);
  const [verEncerrados, setVerEncerrados] = useState(false);
  const [verConfig, setVerConfig] = useState(false);

  const carregar = useCallback(() => {
    carregarPainel()
      .then((p) => {
        setPainel(p); setErro(null); setSemMigration(false);
        carregarSugestoes(p.config).then(setSugestoes).catch(() => setSugestoes([]));
      })
      .catch((e) => {
        if (e instanceof SemMigration) { setSemMigration(true); setPainel({ cartoes: [], encerrados: [], pessoas: [], config: { grupo_minimo: 6, valor_vip: 50000 } }); return; }
        setErro(e instanceof Error ? e.message : "Não carregou.");
      });
  }, []);
  useEffect(carregar, [carregar]);
  // o check que Operações registra aparece na hora no Relacionamento (e vice-versa)
  useAoVivo([{ tabela: "rel_prioridades" }, { tabela: "rel_prioridade_viagens" }, { tabela: "rel_prioridade_checks" }, { tabela: "rel_prioridade_alteracoes" }], carregar, 800);

  const semCheck = useMemo(() => (painel?.cartoes ?? []).filter((c) => pedeCheck(c.situacao) && !c.checkHoje.length), [painel]);
  const comProblema = useMemo(() => (painel?.cartoes ?? []).filter((c) => c.checkHoje.some((x) => x.situacao === "problema")), [painel]);
  const emViagem = (painel?.cartoes ?? []).filter((c) => c.situacao.tipo === "em_viagem").length;

  if (!currentUser) return null;
  const uid = currentUser.id;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Prioridades · acompanhamento diário</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Pacotes VIP, com influenciador ou grupos grandes. A mesma tela no Relacionamento e em Operações. Hoje é {dataBR(hojeSP())}.
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="fantasma" onClick={() => setVerConfig(true)}>Regras da sugestão</Botao>
          <Botao variante="primario" disabled={semMigration} onClick={() => setNovo(true)}>+ Marcar pacote</Botao>
        </div>
      </header>

      {semMigration && <Aviso>O painel está pronto, mas falta aplicar a migration <b>0226</b> no banco. Até lá não dá pra marcar prioridade nem registrar o check do dia.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {painel && !semMigration && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Numero rotulo="Acompanhamentos" valor={painel.cartoes.length} />
          <Numero rotulo="Em viagem agora" valor={emViagem} />
          <Numero rotulo="Sem check hoje" valor={semCheck.length} alerta={semCheck.length > 0} />
          <Numero rotulo="Com problema hoje" valor={comProblema.length} alerta={comProblema.length > 0} />
        </div>
      )}

      {!painel ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : (
        <>
          {!semMigration && !painel.cartoes.length && (
            <div className="rel-card"><Vazio titulo="Nenhum pacote prioritário ainda" texto="Marque pelo botão acima, pela ficha da viagem ou pelas sugestões aqui embaixo." /></div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {painel.cartoes.map((c) => <CartaoPrioridade key={c.p.id} c={c} pessoas={painel.pessoas} setor={setor} uid={uid} onMudou={carregar} />)}
          </div>

          {sugestoes && sugestoes.length > 0 && !semMigration && (
            <section className="rel-card p-4">
              <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Sugestões · ainda ninguém marcou</h2>
              <p className="text-[12px] mb-2" style={{ color: "var(--ink3)" }}>
                Pacotes que vão viajar ou estão viajando com ≥ {painel.config.grupo_minimo} pessoas ou ≥ {reais(painel.config.valor_vip)} (viagens com a mesma ida e volta contam juntas). Só sugestão: quem decide é o time.
              </p>
              <ul>
                {sugestoes.map((s) => (
                  <li key={s.chave} className="flex flex-wrap items-center gap-3 py-2" style={{ borderTop: "1px solid var(--line2)" }}>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{s.nome}</p>
                      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                        {periodo(s.viagens[0])} · {s.viagens.length} negócio{s.viagens.length > 1 ? "s" : ""} · ≈{s.pax} pessoas · {reais(s.valor)} · {s.motivos.map((m) => m.porque).join(" · ")}
                      </p>
                    </div>
                    <Botao onClick={() => setMarcar({ v: s.viagens[0], juntar: s.viagens.slice(1).map((x) => x.id) })}>Conferir e marcar</Botao>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {painel.encerrados.length > 0 && (
            <section className="rel-card p-4">
              <button type="button" className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }} onClick={() => setVerEncerrados((x) => !x)}>
                Já voltaram há mais de 7 dias ({painel.encerrados.length}) {verEncerrados ? "▾" : "▸"}
              </button>
              {verEncerrados && (
                <div className="grid gap-3 lg:grid-cols-2 mt-3">
                  {painel.encerrados.map((c) => <CartaoPrioridade key={c.p.id} c={c} pessoas={painel.pessoas} setor={setor} uid={uid} onMudou={carregar} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {novo && <BuscarPacote onFechar={() => setNovo(false)} onEscolher={(v) => { setNovo(false); setMarcar({ v, juntar: [] }); }} />}
      {marcar && <MarcarPrioridade viagem={marcar.v} juntarIds={marcar.juntar} onFechar={() => setMarcar(null)} onMarcou={() => { void recarregarSelos(); carregar(); }} />}
      {verConfig && painel && <RegrasSugestao config={painel.config} uid={uid} onFechar={() => setVerConfig(false)} onSalvou={carregar} />}
    </div>
  );
}

function Numero({ rotulo, valor, alerta }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className="rel-card px-4 py-3" style={alerta ? { background: VERMELHO.bg, borderColor: VERMELHO.borda } : undefined}>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: alerta ? VERMELHO.fg : "var(--ink3)" }}>{rotulo}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: alerta ? VERMELHO.fg : "var(--ink)" }}>{valor}</p>
    </div>
  );
}

function Bloco({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="pt-2 mt-2" style={{ borderTop: "1px solid var(--line2)" }}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{titulo}</h3>
        {acao}
      </div>
      {children}
    </div>
  );
}

function descreverTrecho(t: Trecho): string {
  const de = t.origem_codigo || t.origem;
  const para = t.destino_codigo || t.destino;
  const rota = de || para ? `${de ?? "?"}→${para ?? "?"}` : "";
  return [TIPOS_TRECHO[t.tipo] ?? t.tipo, rota, [t.companhia, t.numero].filter(Boolean).join(" "), t.descricao].filter(Boolean).join(" · ");
}

function CartaoPrioridade({ c, pessoas, setor, uid, onMudou }: { c: Cartao; pessoas: Pessoa[]; setor: Setor; uid: string; onMudou: () => void }) {
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState(false);
  const [novaAlt, setNovaAlt] = useState("");
  const [respAlt, setRespAlt] = useState("");
  const [prazoAlt, setPrazoAlt] = useState("");
  const [addViagem, setAddViagem] = useState(false);

  const nomeDe = (id: string | null) => (id ? pessoas.find((p) => p.id === id)?.name ?? "alguém" : "—");
  const falta = pedeCheck(c.situacao) && !c.checkHoje.length;
  const problemaHoje = c.checkHoje.some((x) => x.situacao === "problema");
  const altPendentes = c.alteracoes.filter((a) => !a.feita_em);
  const tarefasAtrasadas = c.viagens.reduce((s, v) => s + (v.tarefas_atrasadas || 0), 0);
  const tarefasPendentes = c.viagens.reduce((s, v) => s + (v.tarefas_pendentes || 0), 0);
  const semVoos = c.viagens.filter((v) => !(v.voos_total ?? 0)).length;
  const chip = c.situacao.tipo === "em_viagem" ? { bg: "var(--info-bg, #E0F2FE)", fg: "var(--info, #075985)" }
    : c.situacao.tipo === "antes" && c.situacao.dias <= 7 ? { bg: "var(--warn-bg)", fg: "var(--warn-ink)" }
    : { bg: "var(--card2)", fg: "var(--ink2)" };
  const v0 = c.viagens[0];
  const voo = v0 ? proximoVoo(v0) : null;

  async function fazer(fn: () => Promise<unknown>) {
    setOcupado(true); setErro(null);
    try { await fn(); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    setOcupado(false);
  }
  const check = (s: "ok" | "problema") => {
    if (s === "problema" && !nota.trim()) { setErro("Conte em poucas palavras qual é o problema."); return; }
    void fazer(async () => { await registrarCheck(c.p.id, s, nota, setor, uid); setNota(""); });
  };

  // histórico: os últimos 7 dias, com o dia sem check à mostra
  const dias = useMemo(() => {
    const out: { dia: string; checks: Check[] }[] = [];
    const base = new Date(`${hojeSP()}T12:00:00-03:00`).getTime();
    for (let i = 0; i < 7; i++) {
      const d = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ dia: d, checks: c.checks.filter((x) => x.dia === d) });
    }
    return out;
  }, [c.checks]);

  return (
    <article className="rel-card p-4" style={falta ? { borderColor: VERMELHO.borda, boxShadow: `0 0 0 2px ${VERMELHO.borda}` } : undefined}
      aria-label={`${c.p.nome}${falta ? ", sem check hoje" : ""}`}>
      {falta && (
        <p className="text-[12px] font-bold mb-2 px-2 py-1 rounded-md" style={{ background: VERMELHO.bg, color: VERMELHO.fg }}>
          SEM CHECK HOJE · ninguém acompanhou {c.situacao.tipo === "em_viagem" ? "o grupo em viagem" : "este pacote"} ainda
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[16px] font-bold leading-tight" style={{ color: "var(--ink)" }}>{c.p.nome}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {c.p.motivos.map((m) => <span key={m} className="pr-selo">{m === "outro" && c.p.motivo_outro ? c.p.motivo_outro : MOTIVOS[m]}</span>)}
            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: chip.bg, color: chip.fg }}>{c.situacao.texto}</span>
            {problemaHoje && <Etiqueta tom="erro">problema hoje</Etiqueta>}
          </div>
        </div>
        <div className="text-right text-[12px]" style={{ color: "var(--ink3)" }}>
          <div><b style={{ color: "var(--ink)" }}>≈{c.pax}</b> pessoa{c.pax > 1 ? "s" : ""} · {c.viagens.length} viage{c.viagens.length > 1 ? "ns" : "m"}</div>
          {v0 && <div>{periodo(v0)}</div>}
          {c.valor > 0 && <div>{reais(c.valor)}</div>}
        </div>
      </div>

      {/* responsáveis — dá pra trocar aqui mesmo */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {(["relacionamento", "operacional"] as Setor[]).map((s) => {
          const campo = s === "relacionamento" ? "resp_rel_id" : "resp_ops_id";
          const atual = c.p[campo];
          return (
            <label key={s} className="text-[12px]" style={{ color: "var(--ink3)" }}>
              {s === "relacionamento" ? "Rel" : "Ops"}:{" "}
              <select className="rel-input" style={{ padding: "2px 6px", fontSize: 12, width: "auto", display: "inline-block", ...(atual ? {} : { borderColor: "var(--warn-line)" }) }}
                value={atual ?? ""} disabled={ocupado} onChange={(e) => void fazer(() => salvarPrioridade(c.p.id, { [campo]: e.target.value || null }))}>
                <option value="">— sem responsável —</option>
                {doSetor(pessoas, s).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          );
        })}
      </div>
      {c.p.observacoes && <p className="text-[12px] mt-2 px-2 py-1 rounded-md" style={{ background: "var(--card2)", color: "var(--ink2)" }}>{c.p.observacoes}</p>}

      <Bloco titulo="Hoje">
        {c.trechosHoje.length ? (
          <ul className="space-y-0.5">
            {c.trechosHoje.map((t) => (
              <li key={t.id} className="text-[13px]" style={{ color: "var(--ink)" }}>
                <b className="tabular-nums">{horaDoLugar(t.partida_em, t.partida_fuso).texto.slice(6) || hora(t.partida_em)}</b> {descreverTrecho(t)}
                {t.checkin_em && !t.checkin_feito_em && <span style={{ color: "var(--warn-ink)" }}> · check-in pendente</span>}
                {t.checkin_feito_em && <span style={{ color: "var(--ink3)" }}> · check-in feito</span>}
                {t.localizador && <span style={{ color: "var(--ink3)" }}> · loc. {t.localizador}</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum voo, transfer ou passeio marcado pra hoje.</p>}
        {c.proximoTrecho ? (
          <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>Próximo: <b style={{ color: "var(--ink2)" }}>{horaDoLugar(c.proximoTrecho.partida_em, c.proximoTrecho.partida_fuso).texto}</b> · {descreverTrecho(c.proximoTrecho)}</p>
        ) : voo && voo.situacao === "proximo" ? (
          <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>Próximo voo: <b style={{ color: "var(--ink2)" }}>{voo.quando}</b> {voo.trecho}</p>
        ) : null}
      </Bloco>

      <Bloco titulo="Pendências">
        <div className="flex flex-wrap gap-1.5">
          {tarefasAtrasadas > 0 && <Etiqueta tom="erro">{tarefasAtrasadas} tarefa{tarefasAtrasadas > 1 ? "s" : ""} atrasada{tarefasAtrasadas > 1 ? "s" : ""}</Etiqueta>}
          {tarefasPendentes > 0 && <Etiqueta>{tarefasPendentes} tarefa{tarefasPendentes > 1 ? "s" : ""} da esteira</Etiqueta>}
          {altPendentes.length > 0 && <Etiqueta tom="aviso">{altPendentes.length} alteraç{altPendentes.length > 1 ? "ões" : "ão"} a fazer</Etiqueta>}
          {semVoos > 0 && <Etiqueta tom="aviso">{semVoos} viage{semVoos > 1 ? "ns" : "m"} sem voo cadastrado</Etiqueta>}
          {(!c.p.resp_rel_id || !c.p.resp_ops_id) && <Etiqueta tom="aviso">falta responsável {!c.p.resp_rel_id && !c.p.resp_ops_id ? "no Rel e em Ops" : !c.p.resp_rel_id ? "no Rel" : "em Ops"}</Etiqueta>}
          {!tarefasAtrasadas && !tarefasPendentes && !altPendentes.length && !semVoos && c.p.resp_rel_id && c.p.resp_ops_id && <span className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada pendente.</span>}
        </div>
      </Bloco>

      <Bloco titulo={`Alterações a fazer${altPendentes.length ? ` (${altPendentes.length})` : ""}`}>
        <ul className="space-y-1">
          {c.alteracoes.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={!!a.feita_em} disabled={ocupado} style={{ accentColor: "var(--rel)" }}
                aria-label={`Feito: ${a.descricao}`} onChange={(e) => void fazer(() => marcarAlteracao(a.id, e.target.checked, uid))} />
              <span className="flex-1 min-w-0" style={{ color: a.feita_em ? "var(--ink3)" : "var(--ink)", textDecoration: a.feita_em ? "line-through" : undefined }}>
                {a.descricao}
                <span className="block text-[11px]" style={{ color: "var(--ink3)", textDecoration: "none" }}>
                  {a.responsavel_id ? primeiroNome(nomeDe(a.responsavel_id)) : "sem responsável"}
                  {a.prazo ? ` · até ${dataBR(a.prazo)}` : ""}
                  {a.feita_em ? ` · feito por ${primeiroNome(nomeDe(a.feita_por))} em ${new Date(a.feita_em).toLocaleDateString("pt-BR")}` : ""}
                </span>
              </span>
              <button type="button" className="text-[11px] underline" style={{ color: "var(--ink3)" }} disabled={ocupado}
                onClick={() => { if (window.confirm("Apagar esta alteração?")) void fazer(() => apagarAlteracao(a.id)); }}>apagar</button>
            </li>
          ))}
        </ul>
        <form className="flex flex-wrap gap-1.5 mt-1.5" onSubmit={(e) => {
          e.preventDefault();
          if (!novaAlt.trim()) return;
          void fazer(async () => { await criarAlteracao({ prioridade_id: c.p.id, descricao: novaAlt, responsavel_id: respAlt || null, prazo: prazoAlt || null }, uid); setNovaAlt(""); setPrazoAlt(""); });
        }}>
          <Entrada value={novaAlt} onChange={(e) => setNovaAlt(e.target.value)} placeholder="Nova alteração (ex.: trocar quarto pra twin)" style={{ flex: "1 1 200px", padding: "6px 10px", fontSize: 13 }} maxLength={2000} />
          <select className="rel-input" style={{ width: "auto", padding: "6px 8px", fontSize: 13 }} value={respAlt} onChange={(e) => setRespAlt(e.target.value)} aria-label="Responsável">
            <option value="">responsável…</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" className="rel-input" style={{ width: "auto", padding: "6px 8px", fontSize: 13 }} value={prazoAlt} onChange={(e) => setPrazoAlt(e.target.value)} aria-label="Prazo" />
          <Botao type="submit" disabled={ocupado || !novaAlt.trim()}>Pôr</Botao>
        </form>
      </Bloco>

      <Bloco titulo="Check do dia">
        {c.checkHoje.length > 0 && (
          <ul className="space-y-0.5 mb-1.5">
            {c.checkHoje.map((x) => <LinhaCheck key={x.id} x={x} nome={nomeDe(x.feito_por)} podeApagar={x.feito_por === uid} onApagar={() => void fazer(() => apagarCheck(x.id))} />)}
          </ul>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Entrada value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota rápida (ex.: falei com a Ana, chegaram bem no hotel)" style={{ flex: "1 1 220px", padding: "6px 10px", fontSize: 13 }} maxLength={2000} />
          <Botao variante="primario" disabled={ocupado} onClick={() => check("ok")}>Tudo ok</Botao>
          <Botao variante="perigo" disabled={ocupado} onClick={() => check("problema")}>Tem problema</Botao>
        </div>
      </Bloco>

      {erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}

      <button type="button" className="mt-3 text-[12px] font-semibold underline" style={{ color: "var(--rel-ink)" }} onClick={() => setDetalhes((x) => !x)}>
        {detalhes ? "esconder detalhes" : "quem viaja, histórico dos checks e mais"}
      </button>
      {detalhes && (
        <>
          <Bloco titulo={`Quem viaja (${c.viagens.length} viage${c.viagens.length > 1 ? "ns" : "m"})`} acao={
            <button type="button" className="text-[12px] underline" style={{ color: "var(--rel-ink)" }} onClick={() => setAddViagem(true)}>+ pôr viagem</button>
          }>
            <ul>
              {c.viagens.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-1 text-[13px]" style={{ borderTop: "1px solid var(--line2)" }}>
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => abrirViagem(v.id)}>
                    <span className="font-semibold" style={{ color: "var(--ink)" }}>{v.cliente_nome ?? "sem cliente"}</span>
                    <span style={{ color: "var(--ink3)" }}>
                      {v.cliente_telefone ? ` · ${formatarTelefone(v.cliente_telefone)}` : ""} · {v.destino || v.titulo} · {periodo(v)}
                      {v.qtd_passageiros ? ` · ${v.qtd_passageiros} pax` : ""}{v.responsavel_nome ? ` · Rel: ${primeiroNome(v.responsavel_nome)}` : ""}
                      {v.bitrix_deal_id ? ` · #${v.bitrix_deal_id}` : ""}
                    </span>
                  </button>
                  {c.viagens.length > 1 && (
                    <button type="button" className="text-[11px] underline" style={{ color: "var(--ink3)" }} disabled={ocupado}
                      onClick={() => { if (window.confirm(`Tirar a viagem de ${v.cliente_nome ?? "sem cliente"} deste acompanhamento?`)) void fazer(() => tirarViagem(c.p.id, v.id)); }}>tirar</button>
                  )}
                </li>
              ))}
            </ul>
          </Bloco>
          <Bloco titulo="Histórico dos checks (7 dias)">
            <ul className="space-y-1">
              {dias.map((d) => (
                <li key={d.dia} className="text-[12px]">
                  <b className="tabular-nums" style={{ color: "var(--ink2)" }}>{dataBR(d.dia).slice(0, 5)}</b>{" "}
                  {d.checks.length ? (
                    <ul className="inline">
                      {d.checks.map((x) => <LinhaCheck key={x.id} x={x} nome={nomeDe(x.feito_por)} inline />)}
                    </ul>
                  ) : <span style={{ color: VERMELHO.fg }}>sem check</span>}
                </li>
              ))}
            </ul>
          </Bloco>
          <Bloco titulo="Marcação">
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              Marcado por {nomeDe(c.p.marcado_por)} em {new Date(c.p.marcado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.
            </p>
            <Botao variante="perigo" className="mt-1.5" disabled={ocupado}
              onClick={() => { if (window.confirm(`Desmarcar a prioridade de "${c.p.nome}"? O histórico fica guardado.`)) void fazer(() => desmarcarPrioridade(c.p.id, uid)); }}>
              Desmarcar prioridade
            </Botao>
          </Bloco>
        </>
      )}
      {addViagem && <BuscarPacote titulo={`Pôr viagem em "${c.p.nome}"`} onFechar={() => setAddViagem(false)}
        onEscolher={(v) => { setAddViagem(false); void fazer(async () => { await incluirViagens(c.p.id, [v.id], uid); await recarregarSelos(); }); }} />}
    </article>
  );
}

function LinhaCheck({ x, nome, inline, podeApagar, onApagar }: { x: Check; nome: string; inline?: boolean; podeApagar?: boolean; onApagar?: () => void }) {
  const ok = x.situacao === "ok";
  return (
    <li className={inline ? "inline mr-2" : "text-[13px]"} style={{ color: "var(--ink)" }}>
      <span className="font-semibold" style={{ color: ok ? "var(--rel-ink)" : VERMELHO.fg }}>{ok ? "✓ ok" : "⚠ problema"}</span>{" "}
      <span style={{ color: "var(--ink3)" }}>{primeiroNome(nome)}{x.setor ? ` (${x.setor === "operacional" ? "Ops" : "Rel"})` : ""} {hora(x.criado_em)}</span>
      {x.nota && <span> · {x.nota}</span>}
      {podeApagar && onApagar && <button type="button" className="ml-1 text-[11px] underline" style={{ color: "var(--ink3)" }} onClick={onApagar}>desfazer</button>}
    </li>
  );
}

function BuscarPacote({ titulo = "Marcar pacote como prioridade", onFechar, onEscolher }: { titulo?: string; onFechar: () => void; onEscolher: (v: ViagemP) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ViagemP[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(() => { buscarPacotes(q).then(setRes).catch(() => setRes([])); }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Modal aberto titulo={titulo} onFechar={onFechar}>
      <Entrada autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente, destino, pacote ou nº do Bitrix" />
      <ul className="mt-2">
        {res?.length === 0 && <li className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nada encontrado.</li>}
        {res?.map((v) => (
          <li key={v.id} style={{ borderTop: "1px solid var(--line2)" }}>
            <button type="button" className="w-full text-left py-2 rel-linha px-1" onClick={() => onEscolher(v)}>
              <span className="block text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{v.cliente_nome ?? "sem cliente"} · {v.destino || v.titulo}</span>
              <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{periodo(v)}{v.qtd_passageiros ? ` · ${v.qtd_passageiros} pax` : ""}{v.valor ? ` · ${reais(Number(v.valor))}` : ""}{v.servico && v.servico !== "pacote" ? ` · ${v.servico}` : ""}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function RegrasSugestao({ config, uid, onFechar, onSalvou }: { config: Config; uid: string; onFechar: () => void; onSalvou: () => void }) {
  const [n, setN] = useState(String(config.grupo_minimo));
  const [vip, setVip] = useState(String(config.valor_vip));
  const [erro, setErro] = useState<string | null>(null);
  async function salvar() {
    const g = Number(n), v = Number(vip.replace(/\./g, "").replace(",", "."));
    if (!Number.isInteger(g) || g < 2 || g > 200) { setErro("Grupo grande: um número entre 2 e 200."); return; }
    if (!Number.isFinite(v) || v < 0) { setErro("Valor inválido."); return; }
    try { await salvarConfig({ grupo_minimo: g, valor_vip: v }, uid); onSalvou(); onFechar(); }
    catch (e) { setErro(e instanceof Error ? `${e.message} (só quem configura o Relacionamento ou Operações muda as regras)` : "Não salvou."); }
  }
  return (
    <Modal aberto titulo="Regras da sugestão" onFechar={onFechar}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-3 text-[13px]" style={{ color: "var(--ink2)" }}>
        <p>O sistema só <b>sugere</b>. Quem marca a prioridade é sempre uma pessoa do Relacionamento ou de Operações.</p>
        <label className="block">Sugerir <b>grupo grande</b> a partir de quantas pessoas?
          <Entrada type="number" min={2} max={200} value={n} onChange={(e) => setN(e.target.value)} />
        </label>
        <label className="block">Sugerir <b>VIP / valor alto</b> a partir de quanto vendido (R$)? <span style={{ color: "var(--ink3)" }}>0 desliga</span>
          <Entrada inputMode="decimal" value={vip} onChange={(e) => setVip(e.target.value)} />
        </label>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
