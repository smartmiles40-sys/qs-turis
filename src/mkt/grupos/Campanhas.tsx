// src/mkt/grupos/Campanhas.tsx — aba "Campanhas": a lista (igual à do SendFlow), a linha
// com status colorido e os botões, e quem abre o compositor e o resultado.
//   #mkt/grupos                     → lista
//   #mkt/grupos?campanha=nova       → nova (&copiar=<id> = duplicar)
//   #mkt/grupos?editar=<id>         → editar
//   #mkt/grupos?campanha=<id>       → resultado da campanha
import { useCallback, useEffect, useMemo, useState } from "react";
import { Vazio } from "@/rel/ui";
import { apagarCampanha, lerCampanhas, mudarStatus, type Campanha, type Tag } from "./lib";
import {
  abaDoStatus, acoesDaCampanha, avisoPausadaDeProposito, quandoSP, veioDoSendFlow, type AbaCampanhas, type AcaoCamp,
} from "./datas";
import { useBases } from "./useBases";
import { useParam } from "./navegar";
import { agendarNoServidor, useConfirmarRetomada } from "./Retomar";
import { resumoPublico } from "./SeletorPublico";
import { BotaoGrande, ICONE_TIPO, Nota, ROTULO_TIPO, SeloStatus, cor } from "./pecas";
import { Compositor } from "./Compositor";
import { DetalheCampanha } from "./DetalheCampanha";

export default function CampanhasAba() {
  const [campanha, setCampanha] = useParam("campanha");
  const [editar, setEditar] = useParam("editar");
  const [copiar, setCopiar] = useParam("copiar");
  const bases = useBases();
  const voltar = () => { setCampanha(null); setEditar(null); setCopiar(null); window.scrollTo(0, 0); };

  if (editar) return <Compositor bases={bases} editarId={editar} onPronto={voltar} onCancelar={voltar} />;
  if (campanha === "nova") return <Compositor bases={bases} copiarId={copiar} onPronto={voltar} onCancelar={voltar} />;
  if (campanha) return <DetalheCampanha id={campanha} bases={bases} onVoltar={voltar} />;
  return <ListaCampanhas tags={bases.tags} erroBases={bases.erro} />;
}

type Origem = "todas" | "avulsas" | "cadencias" | "recorrentes";
const ORIGENS: { v: Origem; r: string }[] = [{ v: "todas", r: "Todas" }, { v: "avulsas", r: "Avulsas" }, { v: "cadencias", r: "Cadências" }, { v: "recorrentes", r: "Recorrentes" }];
const origemDe = (c: Campanha): Origem => (c.recorrencia_id ? "recorrentes" : c.cadencia_id ? "cadencias" : "avulsas");

const ABAS: { v: AbaCampanhas; r: string }[] = [
  { v: "agendadas", r: "Agendadas" }, { v: "pausadas", r: "Pausadas" }, { v: "historico", r: "Histórico" }, { v: "rascunhos", r: "Rascunhos" },
];
const VAZIO: Record<AbaCampanhas, string> = {
  agendadas: "Nenhuma campanha agendada. Crie a primeira em “Nova campanha”.",
  pausadas: "Nenhuma campanha pausada.",
  historico: "Nada enviado ainda. O que sair vai aparecer aqui.",
  rascunhos: "Sem rascunhos salvos.",
};

function ListaCampanhas({ tags, erroBases }: { tags: Tag[]; erroBases: string | null }) {
  const [, setCampanha] = useParam("campanha");
  const [, setEditar] = useParam("editar");
  const [, setCopiar] = useParam("copiar");
  const [campanhas, setCampanhas] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [origem, setOrigem] = useState<Origem>("todas");
  const [abaP, setAbaP] = useParam("lista");
  const aba = (ABAS.some((a) => a.v === abaP) ? abaP : "agendadas") as AbaCampanhas;
  const [pedirRetomada, modalRetomada] = useConfirmarRetomada();

  const carregar = useCallback(() => { lerCampanhas().then(setCampanhas).catch((e) => setErro((e as Error).message)); }, []);
  useEffect(() => { carregar(); const t = setInterval(carregar, 30_000); return () => clearInterval(t); }, [carregar]);

  const todas = campanhas ?? [];
  const contOrigem = useMemo(() => {
    const n: Record<Origem, number> = { todas: todas.length, avulsas: 0, cadencias: 0, recorrentes: 0 };
    for (const c of todas) n[origemDe(c)]++;
    return n;
  }, [todas]);
  const daOrigem = useMemo(() => (origem === "todas" ? todas : todas.filter((c) => origemDe(c) === origem)), [todas, origem]);
  const contAba = useMemo(() => {
    const n: Record<AbaCampanhas, number> = { agendadas: 0, pausadas: 0, historico: 0, rascunhos: 0 };
    for (const c of daOrigem) n[abaDoStatus(c.status)]++;
    return n;
  }, [daOrigem]);
  const stats = useMemo(() => {
    const prox = daOrigem.filter((c) => (c.status === "agendada" || c.status === "enviando") && c.enviar_em).map((c) => c.enviar_em as string).sort()[0];
    return {
      proximo: prox ? quandoSP(prox) : "—",
      agendadas: daOrigem.filter((c) => c.status === "agendada").length,
      enviadas: daOrigem.filter((c) => c.status === "concluida").length,
      rascunhos: daOrigem.filter((c) => c.status === "rascunho").length,
    };
  }, [daOrigem]);
  const linhas = useMemo(() => {
    const l = daOrigem.filter((c) => abaDoStatus(c.status) === aba);
    const t = (c: Campanha) => c.enviar_em || c.criado_em;
    return aba === "historico" || aba === "rascunhos" ? l.sort((a, b) => t(b).localeCompare(t(a))) : l.sort((a, b) => t(a).localeCompare(t(b)));
  }, [daOrigem, aba]);
  const migradasPausadas = todas.filter((c) => c.status === "pausada" && avisoPausadaDeProposito(c.avisos)).length;

  async function acao(c: Campanha, a: AcaoCamp) {
    setErro(null);
    try {
      if (a === "editar") { setEditar(c.id); window.scrollTo(0, 0); return; }
      if (a === "duplicar") { setCopiar(c.id); setCampanha("nova"); window.scrollTo(0, 0); return; }
      if (a === "pausar") await mudarStatus(c.id, "pausada");
      if (a === "cancelar") { if (!confirm(`Cancelar “${c.nome}”? Quem ainda não recebeu sai da fila.`)) return; await mudarStatus(c.id, "cancelada"); }
      if (a === "excluir") await apagarCampanha(c.id);
      if (a === "retomar") {
        pedirRetomada(c, async () => {
          try { const e = await agendarNoServidor(c.id); if (e.length) setErro(e.join(" · ")); } catch (x) { setErro((x as Error).message); }
          carregar();
        });
        return;
      }
      carregar();
    } catch (e) { setErro((e as Error).message); }
  }

  return (
    <div>
      {modalRetomada}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Campanhas</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>Crie disparos pontuais para os grupos e acompanhe o que já saiu.</p>
        </div>
        <BotaoGrande onClick={() => { setCopiar(null); setCampanha("nova"); window.scrollTo(0, 0); }}>＋ Nova campanha</BotaoGrande>
      </div>

      <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="De onde vem">
        {ORIGENS.map((o) => {
          const on = origem === o.v;
          return (
            <button key={o.v} type="button" role="tab" aria-selected={on} onClick={() => setOrigem(o.v)}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-semibold transition-colors"
              style={on ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" } : { background: cor.card, color: cor.ink2, border: "1px solid var(--line)" }}>
              {o.r}
              <span className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                style={on ? { background: "rgba(255,255,255,.2)" } : { background: cor.card2, color: cor.ink3 }}>{contOrigem[o.v]}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Stat rotulo="Próximo disparo" valor={stats.proximo} destaque />
        <Stat rotulo="Agendadas" valor={String(stats.agendadas)} />
        <Stat rotulo="Enviadas" valor={String(stats.enviadas)} />
        <Stat rotulo="Rascunhos" valor={String(stats.rascunhos)} />
      </div>

      {migradasPausadas > 0 && (
        <div className="mb-4">
          <Nota tom="aviso" icone="⚠️">
            <b>{migradasPausadas} campanha{migradasPausadas === 1 ? "" : "s"} migrada{migradasPausadas === 1 ? "" : "s"} do SendFlow {migradasPausadas === 1 ? "está pausada" : "estão pausadas"} de propósito</b> — o SendFlow ainda manda {migradasPausadas === 1 ? "ela" : "elas"}.
            Retome só depois de desligar no SendFlow (aba <button type="button" className="underline font-semibold" onClick={() => setAbaP("pausadas")}>Pausadas</button>).
          </Nota>
        </div>
      )}

      <div className="mb-3.5 flex gap-1.5 overflow-x-auto" style={{ borderBottom: "1px solid var(--line)" }}>
        {ABAS.map((a) => {
          const on = aba === a.v;
          return (
            <button key={a.v} type="button" aria-pressed={on} onClick={() => setAbaP(a.v === "agendadas" ? null : a.v)}
              className="-mb-px shrink-0 px-3.5 py-2.5 text-[14px] font-semibold transition-colors"
              style={{ borderBottom: `2px solid ${on ? "var(--rel)" : "transparent"}`, color: on ? cor.ink : cor.ink3 }}>
              {a.r} <span className="text-[12px] font-normal tabular-nums" style={{ color: cor.ink3 }}>{contAba[a.v]}</span>
            </button>
          );
        })}
      </div>

      {(erro || erroBases) && <div className="mb-3.5"><Nota tom="erro" icone="⚠️">{erro || erroBases}</Nota></div>}

      <div className="gr-cartao overflow-hidden">
        {campanhas === null ? (
          <div className="p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando campanhas…</div>
        ) : linhas.length === 0 ? (
          todas.length === 0 ? <Vazio titulo="Nenhuma campanha ainda" texto="Crie a primeira em “Nova campanha”." /> : <div className="p-6 text-[14px]" style={{ color: cor.ink3 }}>{VAZIO[aba]}</div>
        ) : (
          <>
            <div className="hidden grid-cols-[2.4fr_1.3fr_1.1fr_0.9fr_1.3fr] gap-3 px-[18px] py-[11px] text-[12px] font-semibold uppercase tracking-[0.06em] md:grid"
              style={{ background: cor.card2, color: cor.ink3 }}>
              <div>Campanha</div><div>Quando</div><div>Público</div><div>Status</div><div className="text-right">Ações</div>
            </div>
            {linhas.map((c) => <LinhaCampanha key={c.id} c={c} tags={tags} onAbrir={() => { setCampanha(c.id); window.scrollTo(0, 0); }} onAcao={(a) => acao(c, a)} />)}
          </>
        )}
      </div>

      <p className="mt-3.5 text-[12px] leading-relaxed" style={{ color: cor.ink3 }}>
        O envio sai pelo chip do Marketing, um grupo por vez, com um intervalo aleatório entre cada grupo para o WhatsApp não bloquear o número,
        e só dentro da janela do chip. Por isso uma campanha grande fica minutos em <b>Enviando</b> — clique nela para ver quais grupos já receberam.
      </p>
    </div>
  );
}

function Stat({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-[14px] p-[18px]" style={destaque ? { border: "1px solid var(--rel)", background: cor.relSoft } : { border: "1px solid var(--line)", background: cor.card }}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: destaque ? cor.relInk : cor.ink3 }}>{rotulo}</div>
      <div className="mt-2 text-[24px] font-semibold leading-tight tabular-nums" style={{ color: cor.ink }}>{valor}</div>
    </div>
  );
}

const DICA_QUANDO: Record<Campanha["status"], string> = {
  rascunho: "não agendada", agendada: "agendada", enviando: "em andamento", pausada: "pausada",
  concluida: "concluída", cancelada: "cancelada", erro: "falhou",
};
const ACOES: Record<Exclude<AcaoCamp, "editar">, { icone: string; rotulo: string }> = {
  retomar: { icone: "▶", rotulo: "Retomar" }, pausar: { icone: "⏸", rotulo: "Pausar" }, cancelar: { icone: "✕", rotulo: "Cancelar" },
  excluir: { icone: "🗑", rotulo: "Excluir" }, duplicar: { icone: "⧉", rotulo: "Duplicar (usar de novo)" },
};

/** A linha da campanha (o CampaignRow do SendFlow). */
function LinhaCampanha({ c, tags, onAbrir, onAcao }: { c: Campanha; tags: Tag[]; onAbrir: () => void; onAcao: (a: AcaoCamp) => Promise<void> }) {
  const [ocupado, setOcupado] = useState<AcaoCamp | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const acoes = acoesDaCampanha(c);
  const pausadaDeProposito = c.status === "pausada" ? avisoPausadaDeProposito(c.avisos) : null;
  const nGrupos = c.grupo_jids.length;
  async function rodar(a: AcaoCamp) {
    if (ocupado) return;
    setOcupado(a);
    try { await onAcao(a); } finally { setOcupado(null); setConfirmando(false); }
  }
  return (
    <div className="px-[18px] py-[15px]" style={{ borderTop: "1px solid var(--line)", background: pausadaDeProposito ? "var(--warn-bg)" : undefined }}>
      <div className="flex flex-col gap-3 md:grid md:grid-cols-[2.4fr_1.3fr_1.1fr_0.9fr_1.3fr] md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] text-[16px]" style={{ border: "1px solid var(--line)", background: cor.card2 }}>{ICONE_TIPO[c.tipo]}</div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <button type="button" onClick={onAbrir} className="truncate text-left text-[14px] font-semibold hover:underline" style={{ color: cor.ink }}>{c.nome}</button>
              {c.cadencia_id && <Etq>cadência</Etq>}
              {c.recorrencia_id && <Etq>recorrente</Etq>}
              {veioDoSendFlow(c.avisos) && <Etq>veio do SendFlow</Etq>}
            </div>
            <div className="mt-0.5 truncate text-[12px]" style={{ color: cor.ink3 }}>{ROTULO_TIPO[c.tipo]}{c.mencionar_todos ? " · menção a todos" : ""}</div>
          </div>
        </div>
        <div className="text-[14px]" style={{ color: cor.ink }}>
          {quandoSP(c.enviar_em)}
          <span className="mt-0.5 block text-[12px]" style={{ color: cor.ink3 }}>{DICA_QUANDO[c.status]}</span>
        </div>
        <div className="min-w-0 text-[14px]" style={{ color: cor.ink }}>
          <span className="block truncate">{resumoPublico(c, tags)}</span>
          {c.total > 0 && <span className="text-[12px]" style={{ color: cor.ink3 }}>{c.total} grupo{c.total === 1 ? "" : "s"} na fila</span>}
          {!c.total && !c.tag_ids.length && nGrupos === 0 && <span className="text-[12px]" style={{ color: "var(--err-ink)" }}>sem público</span>}
        </div>
        <div><SeloStatus status={c.status} detalhe={c.status === "enviando" && c.total ? `${c.enviados}/${c.total}` : undefined} /></div>
        <div className="flex items-center gap-2 md:justify-end">
          <button type="button" className="gr-icone-btn" onClick={onAbrir} aria-label={`Resultados de ${c.nome}`} title="Ver quais grupos receberam">📊</button>
          {confirmando ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px]" style={{ color: cor.ink3 }}>Excluir?</span>
              <button type="button" disabled={Boolean(ocupado)} onClick={() => void rodar("excluir")} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: "var(--err-bg)", color: "var(--err-ink)", border: "1px solid var(--err-line)" }}>{ocupado === "excluir" ? "…" : "Sim"}</button>
              <button type="button" disabled={Boolean(ocupado)} onClick={() => setConfirmando(false)} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold"
                style={{ border: "1px solid var(--line)", color: cor.ink2 }}>Não</button>
            </div>
          ) : acoes.map((a) => a === "editar" ? (
            <button key={a} type="button" className="gr-icone-btn" onClick={() => void rodar(a)} aria-label={`Editar ${c.nome}`} title="Editar">✏️</button>
          ) : (
            <button key={a} type="button" className="gr-icone-btn" disabled={Boolean(ocupado)} title={ACOES[a].rotulo} aria-label={`${ACOES[a].rotulo} ${c.nome}`}
              onClick={() => (a === "excluir" ? setConfirmando(true) : void rodar(a))}
              style={a === "retomar" ? { borderColor: "var(--rel)", color: cor.relInk } : undefined}>
              {ocupado === a ? "…" : ACOES[a].icone}
            </button>
          ))}
        </div>
      </div>
      {pausadaDeProposito && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium" style={{ border: "1px solid var(--warn-line)", color: "var(--warn-ink)" }}>
          <span aria-hidden>⚠️</span><span>{pausadaDeProposito}</span>
        </div>
      )}
      {c.status === "erro" && c.erro && <div className="mt-2 text-[12px]" style={{ color: "var(--err-ink)" }}>{c.erro}</div>}
    </div>
  );
}

function Etq({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ border: "1px solid var(--line)", background: cor.card2, color: cor.ink3 }}>{children}</span>;
}
