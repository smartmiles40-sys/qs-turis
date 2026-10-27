// src/components/sdr/telefone/DiscadorPainel.tsx
// -----------------------------------------------------------------------------
// Painel do DISCADOR na Fila de hoje: lote atual com o status de cada número,
// contadores da sessão, N atual e os botões (Parar sempre visível).
// A lógica está em src/lib/discador (motor = decide, controlador = executa).
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { criarDiscador, type Discador, type DiscadorDeps, type EstadoDiscador } from "@/lib/discador/controlador";
import { ROTULO_STATUS, taxaAbandono, type StatusPerna } from "@/lib/discador/motor";
import { formatPhoneDisplay } from "@/lib/whatsapp";

const COR_STATUS: Record<StatusPerna, string> = {
  discando: "var(--subtle)",
  tocando: "var(--info)",
  vencedora: "var(--ok)",
  derrubada: "var(--danger)",
  nao_atendeu: "var(--subtle)",
  ocupado: "var(--warn, #b45309)",
  invalido: "var(--danger)",
  recusado_canal: "var(--warn, #b45309)",
  cancelada: "var(--subtle)",
  erro: "var(--danger)",
};

const ROTULO_FASE: Record<EstadoDiscador["fase"], string> = {
  parado: "Parado",
  preparando: "Preparando…",
  discando: "Discando",
  processando: "Registrando o lote…",
  em_chamada: "Em ligação",
  aguardando_sdr: "Dê o desfecho e clique em Continuar",
  pausado: "Pausado",
  fim: "Fila terminada",
  bloqueado: "Parado pela central",
};

interface Props {
  deps: Omit<DiscadorDeps, "ownerId">;
  ownerId: string;
  onFechar(): void;
}

export default function DiscadorPainel({ deps, ownerId, onFechar }: Props) {
  // Os callbacks da Fila mudam a cada render; o discador lê sempre os atuais.
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const discadorRef = useRef<Discador | null>(null);
  if (!discadorRef.current) {
    discadorRef.current = criarDiscador({
      ownerId,
      montarFila: () => depsRef.current.montarFila(),
      aplicarDesfecho: (i, r, d) => depsRef.current.aplicarDesfecho(i, r, d),
      retornoUrgente: (i) => depsRef.current.retornoUrgente(i),
      abrirAtendida: (i) => depsRef.current.abrirAtendida(i),
      dentroDoHorario: () => depsRef.current.dentroDoHorario(),
      aposLote: () => depsRef.current.aposLote(),
    });
  }
  const d = discadorRef.current;
  const [est, setEst] = useState<EstadoDiscador>(d.estado());

  useEffect(() => {
    const off = d.subscribe(setEst);
    void d.iniciar();
    // Saiu da tela = para (nada de chamada tocando sem o painel à vista).
    return () => { off(); d.parar(); };
  }, [d]);

  const s = est.sessao;
  const taxa = s ? taxaAbandono(s) : 0;
  const rodando = est.fase !== "parado" && est.fase !== "fim" && est.fase !== "bloqueado";

  return (
    <div
      className="rounded-2xl p-4 mb-3"
      style={{ background: "var(--card)", border: "1px solid var(--line)" }}
      role="region"
      aria-label="Discador"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <strong className="text-[14px]" style={{ color: "var(--ink)" }}>Discador</strong>
        <span className="qsx-chip">{ROTULO_FASE[est.fase]}</span>
        {s && <span className="qsx-chip" title="Quantas chamadas saem ao mesmo tempo">{s.nAtual} por vez</span>}
        <span className="flex-1" />
        {(est.fase === "aguardando_sdr" || est.fase === "pausado") && (
          <button className="qsx-btn qsx-btn-green" style={{ height: 32 }} onClick={() => d.continuar()}>Continuar</button>
        )}
        {(est.fase === "discando" || est.fase === "processando" || est.fase === "em_chamada") && (
          <button className="qsx-btn qsx-btn-ghost" style={{ height: 32 }} onClick={() => d.pausar()}>Pausar</button>
        )}
        {rodando ? (
          <button
            className="qsx-btn"
            style={{ height: 32, background: "var(--danger)", color: "#fff" }}
            onClick={() => d.parar()}
          >
            Parar
          </button>
        ) : (
          <button className="qsx-btn qsx-btn-ghost" style={{ height: 32 }} onClick={onFechar}>Fechar</button>
        )}
      </div>

      {est.mensagem && (
        <div className="mt-2 text-[12.5px]" style={{ color: est.fase === "bloqueado" ? "var(--danger)" : "var(--ink2)" }}>
          {est.mensagem}
        </div>
      )}

      {s && (
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          <span className="qsx-chip">{s.discadas} discadas</span>
          <span className="qsx-chip" style={{ color: "var(--ok)" }}>{s.atendidas} atendidas</span>
          <span className="qsx-chip" style={{ color: s.abandonadas ? "var(--danger)" : undefined }} title="Atenderam, mas outro lead atendeu antes — viraram retorno urgente">
            {s.abandonadas} derrubadas · {(taxa * 100).toFixed(1)}%
          </span>
          <span className="qsx-chip">{s.naoAtendidas} não atenderam</span>
          {s.ocupados > 0 && <span className="qsx-chip">{s.ocupados} ocupados</span>}
          {s.invalidos > 0 && <span className="qsx-chip">{s.invalidos} inválidos</span>}
          {s.capacidadeCentral !== null && <span className="qsx-chip" title="Limite descoberto na central">central: {s.capacidadeCentral} por vez</span>}
          <span className="qsx-chip">{est.naFila} na fila</span>
        </div>
      )}

      {est.lote && (
        <ul className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {est.lote.pernas.map((p) => (
            <li
              key={p.idx}
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[12.5px]"
              style={{ border: "1px solid var(--line)", background: p.status === "vencedora" ? "var(--surface-2)" : undefined }}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold" style={{ color: "var(--ink)" }}>{p.item.nome || "Lead"}</span>
                <span className="block" style={{ color: "var(--subtle)" }}>{formatPhoneDisplay(p.item.telefone)}</span>
              </span>
              <span className="shrink-0 font-semibold" style={{ color: COR_STATUS[p.status] }}>
                {ROTULO_STATUS[p.status]}{p.sipCode ? ` · ${p.sipCode}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {s && s.avisos.length > 1 && (
        <details className="mt-2 text-[12px]" style={{ color: "var(--subtle)" }}>
          <summary>Avisos da sessão ({s.avisos.length})</summary>
          <ul className="mt-1 list-disc pl-5">{s.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
