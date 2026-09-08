// src/components/sdr/settings/NumerosWhatsApp.tsx
// -----------------------------------------------------------------------------
// NÚMEROS DO WHATSAPP — o chip de cada SDR e o rodízio das landing pages.
//
// PRA QUEM É ESTA TELA (Bruno, 04/09/2026): o time comercial, não quem programa.
// Chip do WhatsApp cai — bloqueio, número queimado por volume — e quando cai o
// conserto tem que ser de dois cliques, num sábado, sem ninguém abrir o Supabase
// nem publicar nada. É por isso que:
//
//   • NÃO EXISTE campo de digitar número aqui. Número errado digitado às pressas
//     manda lead pago pra conversa de um estranho, e ninguém percebe até o mês
//     fechar. Cadastro de chip novo é fluxo separado (ver o rodapé da migration
//     0076), feito com calma.
//   • Trocar pede confirmação e diz, com todas as letras, qual número entra e
//     qual sai. A troca é irreversível: o chip antigo vira 'queimado'.
//   • O contador de 7 dias fica na mesma tela. É a prova de que o rodízio está
//     girando parelho — sem ele, "acho que a Mariana está recebendo mais" vira
//     discussão em vez de número.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  carregarNumeros, desativarNumero, trocarPorReserva, numeroBonito,
  type PainelNumeros, type CardSdr,
} from "@/lib/qs/sdrPool";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

const AZUL = "#0147FF";

function Pill({ status }: { status: CardSdr["status"] }) {
  const e = status === "ativo"
    ? { txt: "no rodízio", fg: "#0F7B34", bg: "#DCFCE7" }
    : { txt: "sem número", fg: "#B42318", bg: "#FEE4E2" };
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ color: e.fg, background: e.bg }}>
      {e.txt}
    </span>
  );
}

/** Barrinha de proporção — o olho pega desequilíbrio mais rápido que o número. */
function Barra({ valor, teto }: { valor: number; teto: number }) {
  const pct = teto > 0 ? Math.round((valor / teto) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: AZUL }} />
    </div>
  );
}

interface Confirmacao {
  titulo: string;
  corpo: React.ReactNode;
  botao: string;
  perigo?: boolean;
  executar: () => Promise<PainelNumeros>;
}

export default function NumerosWhatsApp() {
  const [painel, setPainel] = useState<PainelNumeros | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [executando, setExecutando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setPainel(await carregarNumeros());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar os números.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function confirmar() {
    if (!confirmacao) return;
    setExecutando(true);
    try {
      // A rota devolve o painel já atualizado junto com o resultado da ação:
      // uma ida ao servidor em vez de duas, e a tela nunca mostra um estado
      // intermediário em que o chip velho ainda aparece como ativo.
      setPainel(await confirmacao.executar());
      notifySuccess("Pronto. O rodízio já está usando a configuração nova.");
      setConfirmacao(null);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui concluir.");
    } finally {
      setExecutando(false);
    }
  }

  if (carregando) {
    return <div className="text-sm text-gray-500">Carregando os números…</div>;
  }
  if (erro) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg text-sm" style={{ background: "#FEE4E2", color: "#B42318" }}>{erro}</div>
        <button onClick={() => void carregar()} className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!painel) return null;

  const temReserva = painel.reservas.length > 0;
  const tetoBarra = Math.max(1, ...painel.sdrs.map((s) => s.reservas_7d));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-bold text-gray-900">Números do WhatsApp</h2>
        <p className="text-sm text-gray-500 mt-1">
          Quem preenche o formulário de uma landing page é mandado pro WhatsApp de um SDR,
          alternando de um em um. O SDR que atende é o mesmo que fica como responsável pelo
          negócio no Bitrix.
        </p>
      </header>

      {/* ── Cards dos SDRs ────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {painel.sdrs.map((s) => {
          const proximo = s.sdr_id === painel.proximo_sdr_id;
          return (
            <div key={s.sdr_id}
              className="rounded-xl border p-4 flex flex-col gap-3"
              style={{ borderColor: proximo ? AZUL : "#E5E7EB", background: proximo ? "#F5F8FF" : "#fff" }}>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{s.nome}</div>
                  <div className="text-[11px] text-gray-400 truncate">{s.email}</div>
                </div>
                <Pill status={s.status} />
              </div>

              <div>
                <div className="text-lg font-bold tabular-nums text-gray-900">
                  {s.numero ? numeroBonito(s.numero) : "—"}
                </div>
                {proximo && (
                  <div className="text-[11px] font-semibold mt-0.5" style={{ color: AZUL }}>
                    é a vez dele no próximo lead
                  </div>
                )}
                {s.status === "sem-numero" && (
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    fora do rodízio — os leads estão sendo divididos entre os outros
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-baseline justify-between text-[11px] text-gray-500">
                  <span>últimos {painel.dias} dias</span>
                  <span className="tabular-nums">
                    <strong className="text-gray-900 text-sm">{s.reservas_7d}</strong> por LP
                    <span className="text-gray-300"> · </span>
                    {s.leads_7d} no total
                  </span>
                </div>
                <Barra valor={s.reservas_7d} teto={tetoBarra} />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  disabled={!temReserva}
                  title={temReserva ? "" : "Não há número reserva cadastrado"}
                  onClick={() => setConfirmacao({
                    titulo: `Trocar o número de ${s.nome}?`,
                    botao: "Trocar agora",
                    corpo: (
                      <>
                        <p>
                          Entra o número <strong>{numeroBonito(painel.reservas[0]?.numero)}</strong> (a
                          reserva mais antiga, portanto a mais aquecida).
                        </p>
                        {s.numero && (
                          <p className="mt-2">
                            O número atual, <strong>{numeroBonito(s.numero)}</strong>, é marcado
                            como <strong>queimado</strong> e não volta pra fila de reservas.
                          </p>
                        )}
                        <p className="mt-2 text-gray-500">
                          Vale no próximo lead. Quem já está conversando com {s.nome} continua no
                          número antigo — a conversa não se move sozinha.
                        </p>
                      </>
                    ),
                    executar: () => trocarPorReserva(s.sdr_id),
                  })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: AZUL }}>
                  Trocar por reserva
                </button>
                <button
                  disabled={s.status !== "ativo"}
                  onClick={() => setConfirmacao({
                    titulo: `Desativar o número de ${s.nome}?`,
                    botao: "Desativar",
                    perigo: true,
                    corpo: (
                      <>
                        <p>
                          O número <strong>{numeroBonito(s.numero)}</strong> sai de circulação e
                          {" "}{s.nome} deixa de receber lead das landing pages. Os leads passam a
                          ser divididos entre os outros SDRs automaticamente.
                        </p>
                        <p className="mt-2 text-gray-500">
                          Não mexe no acesso dele ao QS nem nos leads que já são dele. Pra voltar,
                          use “Trocar por reserva”.
                        </p>
                      </>
                    ),
                    executar: () => desativarNumero(s.sdr_id),
                  })}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  Desativar
                </button>
              </div>
            </div>
          );
        })}
      </section>

      {painel.sdrs.every((s) => s.status !== "ativo") && (
        <div className="p-3 rounded-lg text-sm" style={{ background: "#FEF0C7", color: "#B54708" }}>
          <strong>Nenhum SDR com número ativo.</strong> Enquanto isso, quem preencher um formulário
          é mandado pro número de emergência (a variável WHATSAPP_FALLBACK) — nenhum lead fica sem
          destino, mas todos caem no mesmo lugar.
        </div>
      )}

      {/* ── Reservas ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-bold text-gray-900">Números reserva</h3>
          <span className="text-[11px] text-gray-400">
            {painel.reservas.length} na fila · a mais antiga entra primeiro
          </span>
        </div>
        {temReserva ? (
          <ul className="divide-y divide-gray-100">
            {painel.reservas.map((r, i) => (
              <li key={r.id} className="py-2 flex items-center justify-between text-sm">
                <span className="tabular-nums text-gray-900">{numeroBonito(r.numero)}</span>
                <span className="text-[11px] text-gray-400">
                  {i === 0 ? "próxima a entrar" : `${i + 1}ª da fila`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">
            Nenhuma reserva cadastrada. Sem reserva, um chip que cair deixa o SDR fora do rodízio
            até alguém cadastrar um número novo.
          </p>
        )}
      </section>

      {/* ── Histórico curto ───────────────────────────────────────────────── */}
      {painel.queimados.length > 0 && (
        <section className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-gray-900 mb-2">Saíram de circulação</h3>
          <ul className="divide-y divide-gray-100">
            {painel.queimados.map((q) => (
              <li key={q.id} className="py-2 flex items-center justify-between text-sm">
                <span className="tabular-nums text-gray-500 line-through">{numeroBonito(q.numero)}</span>
                <span className="text-[11px] text-gray-400">
                  {q.sdr_nome || "sem dono"} · {new Date(q.updated_at).toLocaleDateString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] text-gray-400">
        Cadastro de número novo não é feito aqui, de propósito — digitar chip errado manda lead pago
        pra conversa de um estranho. O passo a passo está no rodapé de
        {" "}<code>supabase/migrations/0076_pool_de_numeros.sql</code>.
      </p>

      {/* ── Confirmação ───────────────────────────────────────────────────── */}
      {confirmacao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !executando && setConfirmacao(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-bold text-gray-900">{confirmacao.titulo}</h4>
            <div className="text-sm text-gray-700 leading-relaxed">{confirmacao.corpo}</div>
            <div className="flex gap-2 justify-end pt-2">
              <button disabled={executando} onClick={() => setConfirmacao(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button disabled={executando} onClick={() => void confirmar()}
                className="px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-60"
                style={{ background: confirmacao.perigo ? "#B42318" : AZUL }}>
                {executando ? "Aplicando…" : confirmacao.botao}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
