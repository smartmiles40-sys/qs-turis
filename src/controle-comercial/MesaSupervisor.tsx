// src/controle-comercial/MesaSupervisor.tsx
// -----------------------------------------------------------------------------
// MESA DO SUPERVISOR — Configurações › Supervisão › Mesa (Bruno, 28/10/2026:
// "temos que ter a parte de mesa, para vermos quem está online e o que estão
// fazendo, e ter um controle maior").
//
// Um cartão por SDR/closer: online/ausente/offline (pela batida do
// ./Presenca), a tela em que está, a ligação em curso, atividades de hoje,
// atrasadas, próximas reuniões. Dali sai o "Afastar / desativar".
//
// Atualiza sozinha a cada 30 s, só com a aba visível, por UMA RPC que já vem
// somada (qs_mesa_comercial, 0215). Sem Realtime de propósito (egress).
// Só admin e gestor do Comercial (o banco recusa os outros).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { SdrUser } from "@/components/sdr/types";
import { Alert, Avatar, Badge, Button, EmptyState, Segmented, StatusDot, type Tone } from "@/components/ui";
import { rotuloDaTela } from "./Presenca";
import {
  NOME_SITUACAO, SemMigration, carregarMesa, dataHoraCurta, duracao, haQuanto, historicoAfastamentos, horaBr, situacao,
  type Mesa, type PessoaMesa, type RegistroAfastamento, type Situacao,
} from "./mesa";
import AfastarPessoa from "./AfastarPessoa";

/** Mesmo critério do qs_is_manager() do banco: admin, ou gestor com o Comercial. */
export function podeVerMesa(u: Pick<SdrUser, "role" | "setores"> | null | undefined): boolean {
  if (!u) return false;
  return u.role === "admin" || (u.role === "gestor" && (u.setores ?? []).includes("comercial"));
}

const POLL_MS = 30_000;
const TOM: Record<Situacao, Tone | "text" | undefined> = {
  ligacao: "info", online: "ok", ausente: "warn", offline: undefined, afastado: "warn", inativo: "danger",
};
const ORDEM: Record<Situacao, number> = { ligacao: 0, online: 1, ausente: 2, offline: 3, afastado: 4, inativo: 5 };
const CANAL: Record<string, string> = { ligacao: "ligação", whatsapp: "WhatsApp", email: "e-mail", ligacao_whatsapp: "ligação no WhatsApp", linkedin: "LinkedIn", instagram: "Instagram" };

type Filtro = "todos" | "sdr" | "closer";

export default function MesaSupervisor() {
  const { currentUser } = useQsAuth();
  const [mesa, setMesa] = useState<Mesa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semMigration, setSemMigration] = useState(false);
  const [inativos, setInativos] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [agora, setAgora] = useState(() => Date.now());
  const [lidoEm, setLidoEm] = useState<number | null>(null);
  const [afastando, setAfastando] = useState<{ pessoa: PessoaMesa; modo: "afastar" | "reativar" } | null>(null);
  const [historico, setHistorico] = useState<RegistroAfastamento[] | null>(null);
  const [rodada, setRodada] = useState(0);

  const ler = useCallback(async () => {
    try {
      const m = await carregarMesa(inativos);
      setMesa(m); setErro(null); setLidoEm(Date.now());
    } catch (e) {
      if (e instanceof SemMigration) setSemMigration(true);
      else setErro(e instanceof Error ? e.message : "não carregou");
    }
  }, [inativos]);

  // Poll leve: 30 s com a aba visível; volta na hora quando a aba reaparece.
  useEffect(() => {
    if (semMigration) return;
    void ler();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void ler(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void ler(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [ler, semMigration, rodada]);

  // Relógio local (só redesenha "há X min" e o cronômetro da ligação; sem rede).
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (semMigration) return;
    historicoAfastamentos().then(setHistorico).catch(() => setHistorico([]));
  }, [semMigration, rodada]);

  const pessoas = useMemo(() => {
    const l = (mesa?.pessoas ?? []).filter((p) => filtro === "todos" || p.papel === filtro);
    return l.map((p) => ({ p, s: situacao(p, agora) }))
      .sort((a, b) => ORDEM[a.s] - ORDEM[b.s] || a.p.nome.localeCompare(b.p.nome, "pt-BR"));
  }, [mesa, filtro, agora]);
  const conta = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {};
    for (const x of pessoas) c[x.s] = (c[x.s] ?? 0) + 1;
    return c;
  }, [pessoas]);
  const nomeDe = (id: string | null) => (id && mesa?.pessoas.find((p) => p.id === id)?.nome) || null;

  if (!podeVerMesa(currentUser)) {
    return <Alert tone="warn">A Mesa é só para admin e gestor do Comercial.</Alert>;
  }
  if (semMigration) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Titulo />
        <Alert tone="warn">A Mesa ainda não está ligada: falta aplicar a migration 0215 (controle do comercial) no banco.</Alert>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Titulo />
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <Segmented label="Quem" value={filtro} onChange={setFiltro}
          options={[{ value: "todos", label: "Todos" }, { value: "sdr", label: "SDRs" }, { value: "closer", label: "Closers" }]} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar desativados
        </label>
        <span style={{ flex: 1 }} />
        <span className="qs-label" role="status">
          {(["ligacao", "online", "ausente", "offline", "afastado"] as Situacao[]).filter((s) => conta[s]).map((s) => `${conta[s]} ${NOME_SITUACAO[s].toLowerCase()}`).join(" · ") || "—"}
          {lidoEm ? ` · atualizado ${haQuanto(new Date(lidoEm).toISOString(), agora)}` : ""}
        </span>
        <Button size="sm" onClick={() => void ler()}>Atualizar</Button>
      </div>

      {erro && <Alert tone="danger">Não carregou: {erro}</Alert>}
      {!mesa && !erro && <div className="qs-card animate-pulse" style={{ height: 160 }} aria-busy="true" aria-label="Carregando" />}
      {mesa && !pessoas.length && <EmptyState title="Ninguém por aqui" description="Nenhum SDR ou closer ativo." />}

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {pessoas.map(({ p, s }) => (
          <Cartao key={p.id} p={p} s={s} agora={agora}
            onAfastar={() => setAfastando({ pessoa: p, modo: "afastar" })}
            onReativar={() => setAfastando({ pessoa: p, modo: "reativar" })}
            ehVoce={p.id === currentUser?.id} />
        ))}
      </div>

      <p className="qs-label" style={{ margin: 0 }}>
        Online = mexeu no QS nos últimos 3 minutos com a aba aberta. Ausente = até 30 minutos sem mexer ou aba em segundo plano.
        Atrasadas seguem a régua de dia útil do sistema. A tela atualiza sozinha a cada 30 segundos.
      </p>

      {historico && historico.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="qs-label">Últimos afastamentos e desativações</span>
          <div className="qs-card" style={{ overflow: "hidden" }}>
            {historico.map((h) => (
              <div key={h.id} className="qs-row" style={{ fontSize: 13 }}>
                <span style={{ color: "var(--subtle)", width: 96 }}>{dataHoraCurta(h.criado_em)}</span>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <b>{nomeDe(h.feito_por) ?? "Gestor"}</b>{" "}
                  {h.modo === "desativar" ? "desativou" : h.modo === "reativar" ? "reativou" : "marcou ausência de"}{" "}
                  <b>{nomeDe(h.user_id) ?? "alguém"}</b>
                  {h.modo === "ausencia" && h.ausente_ate ? ` até ${h.ausente_ate.split("-").reverse().join("/")}` : ""}
                  {h.motivo ? ` (${h.motivo})` : ""}
                  {resumoTexto(h.resumo, nomeDe)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {afastando && (
        <AfastarPessoa pessoa={afastando.pessoa} reativar={afastando.modo === "reativar"}
          onFechar={() => setAfastando(null)}
          onFeito={() => { setAfastando(null); setRodada((r) => r + 1); }} />
      )}
    </div>
  );
}

function resumoTexto(r: RegistroAfastamento["resumo"], nomeDe: (id: string | null) => string | null): string {
  const partes: string[] = [];
  if (r.leads) partes.push(`${r.leads} lead(s)`);
  if (r.tarefas) partes.push(`${r.tarefas} atividade(s)`);
  if (r.reunioes) partes.push(`${r.reunioes} reunião(ões)`);
  if (r.negocios) partes.push(`${r.negocios} cartão(ões) do pipeline`);
  if (!partes.length) return "";
  const pra = r.destino === "rodizio" ? "divididos no rodízio" : r.destino ? `para ${nomeDe(r.destino) ?? "outra pessoa"}` : "";
  return ` · ${partes.join(", ")}${pra ? ` ${pra}` : ""}`;
}

function Titulo() {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Mesa do Comercial</h2>
      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>
        Quem está online e o que está fazendo agora, SDRs e closers. Daqui você afasta ou desativa alguém e decide pra quem vai o que estava com a pessoa.
      </p>
    </div>
  );
}

function Cartao({ p, s, agora, onAfastar, onReativar, ehVoce }: {
  p: PessoaMesa; s: Situacao; agora: number; onAfastar: () => void; onReativar: () => void; ehVoce: boolean;
}) {
  const apagado = s === "offline" || s === "inativo";
  return (
    <article className="qs-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, opacity: s === "inativo" ? 0.7 : 1 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={p.nome} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.nome}</div>
          <div style={{ fontSize: 12, color: "var(--subtle)" }}>{p.papel === "closer" ? "Closer" : "SDR"}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          <StatusDot tone={TOM[s]} size={9} />{NOME_SITUACAO[s]}
        </span>
      </header>

      <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>
        {s === "afastado" && <span><Badge tone="warn">Ausente até {p.ausente_ate?.split("-").reverse().join("/")}</Badge>{p.ausente_motivo ? ` ${p.ausente_motivo}` : ""}</span>}
        {s === "ligacao" && (
          <span style={{ fontWeight: 600, color: "var(--info)" }}>
            {p.acao_atual || "Em ligação"}{p.ligacao_desde ? ` · ${duracao(p.ligacao_desde, agora)}` : ""}
          </span>
        )}
        {s !== "ligacao" && !apagado && p.tela && (
          <span>Está em: <b style={{ color: "var(--text)" }}>{rotuloDaTela(p.tela)}</b>{p.aba_visivel === false ? " (aba em segundo plano)" : ""}</span>
        )}
        {p.lead_nome && !apagado && <span>Lead aberto: {p.lead_nome}</span>}
        <span style={{ color: "var(--subtle)" }}>
          Visto {haQuanto(p.visto_em, agora)}{s === "online" && p.online_desde ? ` · online desde ${horaBr(p.online_desde)}` : ""}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        <Num rotulo="Feitas hoje" v={p.concluidas_hoje} />
        <Num rotulo="Pra hoje" v={p.pendentes_hoje} />
        <Num rotulo="Atrasadas" v={p.atrasadas} tom={p.atrasadas > 30 ? "danger" : p.atrasadas > 0 ? "warn" : undefined} />
        <Num rotulo="Leads abertos" v={p.leads_abertos} />
      </div>
      {(p.ligacoes_hoje > 0 || p.papel === "sdr") && (
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Ligações hoje: {p.ligacoes_hoje} ({p.atendidas_hoje} atendidas)</span>
      )}
      {p.ultima && (
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Última atividade: {CANAL[p.ultima.canal ?? ""] ?? p.ultima.canal ?? "atividade"}{p.ultima.lead_nome ? ` com ${p.ultima.lead_nome}` : ""} · {haQuanto(p.ultima.em, agora)}
        </span>
      )}

      {p.reunioes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="qs-label" style={{ fontSize: 12 }}>Próximas reuniões</span>
          {p.reunioes.map((r) => (
            <span key={r.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "baseline" }}>
              <b className="qs-num">{dataHoraCurta(r.em)}</b>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.lead_nome ?? "Cliente"}{r.como === "marcou" ? " (marcou)" : ""}
              </span>
              {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer" style={{ color: "var(--info)" }}>Meet</a>}
            </span>
          ))}
        </div>
      )}

      <footer style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: "auto" }}>
        {(s === "inativo" || s === "afastado")
          ? <Button size="sm" onClick={onReativar}>{s === "inativo" ? "Reativar" : "Encerrar ausência"}</Button>
          : !ehVoce && <Button size="sm" onClick={onAfastar}>Afastar / desativar</Button>}
      </footer>
    </article>
  );
}

function Num({ rotulo, v, tom }: { rotulo: string; v: number; tom?: "danger" | "warn" }) {
  return (
    <div style={{ background: "var(--surface-2)", borderRadius: 8, padding: "6px 8px", display: "flex", flexDirection: "column" }}>
      <span className={`qs-num${tom ? ` qs-tone-${tom}` : ""}`} style={{ fontSize: 17, fontWeight: 700 }}>{v.toLocaleString("pt-BR")}</span>
      <span style={{ fontSize: 11, color: "var(--subtle)" }}>{rotulo}</span>
    </div>
  );
}
