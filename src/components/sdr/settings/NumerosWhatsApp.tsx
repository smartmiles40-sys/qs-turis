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
  carregarNumeros, desativarNumero, trocarPorReserva, afastarSdr, numeroBonito,
  type PainelNumeros, type CardSdr,
} from "@/lib/qs/sdrPool";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

const AZUL = "#0147FF";

// ── Datas do afastamento, sempre no dia de São Paulo ─────────────────────────
// "Hoje" do navegador pode ser outro se o supervisor estiver fora do Brasil; o
// servidor usa o dia de SP, então a tela também.
function hojeSP(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}
function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}` : iso;
}
function voltaEm(ate: string): string {
  const volta = somarDias(ate, 1);
  return volta === somarDias(hojeSP(), 1) ? "volta amanhã" : `volta em ${dataBr(volta)}`;
}

/** Atalhos do afastamento: quantos dias ALÉM de hoje. */
const PRAZOS = [
  { rotulo: "Só hoje", extra: 0 },
  { rotulo: "Hoje e amanhã", extra: 1 },
  { rotulo: "3 dias", extra: 2 },
  { rotulo: "1 semana", extra: 6 },
];
const MOTIVOS = ["Atestado", "Folga", "Férias", "Outro"];

function Pill({ status, ausenteAte }: { status: CardSdr["status"]; ausenteAte?: string | null }) {
  const e = ausenteAte
    ? { txt: `afastado até ${dataBr(ausenteAte)}`, fg: "#B54708", bg: "#FEF0C7" }
    : status === "ativo"
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
  // Janela "Afastar": pra quem, até quando e por quê.
  const [afastando, setAfastando] = useState<CardSdr | null>(null);
  const [ateData, setAteData] = useState<string>(hojeSP());
  const [motivo, setMotivo] = useState<string>("Atestado");

  function abrirAfastar(s: CardSdr) {
    setAteData(hojeSP());
    setMotivo("Atestado");
    setAfastando(s);
  }

  async function salvarAfastamento() {
    if (!afastando) return;
    if (!ateData || ateData < hojeSP()) {
      notifyError("Escolha hoje ou uma data futura.");
      return;
    }
    setExecutando(true);
    try {
      setPainel(await afastarSdr(afastando.sdr_id, ateData, motivo));
      notifySuccess(`${afastando.nome} está fora até ${dataBr(ateData)}. Os leads vão pros outros SDRs.`);
      setAfastando(null);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui afastar.");
    } finally {
      setExecutando(false);
    }
  }

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
          const proximo = s.sdr_id === painel.proximo_sdr_id && !s.ausente_ate;
          return (
            <div key={s.sdr_id}
              className="rounded-xl border p-4 flex flex-col gap-3"
              style={{ borderColor: proximo ? AZUL : "#E5E7EB", background: proximo ? "#F5F8FF" : "#fff" }}>

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{s.nome}</div>
                  <div className="text-[11px] text-gray-400 truncate">{s.email}</div>
                </div>
                <Pill status={s.status} ausenteAte={s.ausente_ate} />
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
                {s.status === "sem-numero" && !s.ausente_ate && (
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    fora do rodízio — os leads estão sendo divididos entre os outros
                  </div>
                )}
                {s.ausente_ate && (
                  <div className="text-[11px] mt-0.5" style={{ color: "#B54708" }}>
                    {s.ausente_motivo ? `${s.ausente_motivo} · ` : ""}{voltaEm(s.ausente_ate)} sozinho(a) —
                    até lá os leads vão pros outros
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

              {/* Afastamento: atestado, folga — volta sozinho no dia seguinte ao fim. */}
              {s.ausente_ate ? (
                <button
                  onClick={() => setConfirmacao({
                    titulo: `Trazer ${s.nome} de volta agora?`,
                    botao: "Voltar agora",
                    corpo: (
                      <p>
                        {s.nome} volta a receber leads das landing pages, do QS e da agenda de
                        ligação a partir do próximo lead.
                      </p>
                    ),
                    executar: () => afastarSdr(s.sdr_id, null),
                  })}
                  className="w-full px-3 py-2 text-sm rounded-lg font-medium"
                  style={{ background: "#FEF0C7", color: "#B54708" }}>
                  Voltar agora
                </button>
              ) : (
                <button
                  onClick={() => abrirAfastar(s)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                  Afastar (atestado, folga…)
                </button>
              )}
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

      {/* ── Afastar ───────────────────────────────────────────────────────── */}
      {afastando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          onClick={() => !executando && setAfastando(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h4 className="text-base font-bold text-gray-900">Afastar {afastando.nome}</h4>
              <p className="text-sm text-gray-500 mt-1">
                Enquanto estiver fora, não recebe lead nenhum: nem WhatsApp das landing pages, nem
                lead novo no QS, nem ligação marcada pela agenda. Volta sozinho(a) no dia seguinte.
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700">Até quando?</div>
              <div className="grid grid-cols-2 gap-2">
                {PRAZOS.map((p) => {
                  const alvo = somarDias(hojeSP(), p.extra);
                  const ativo = ateData === alvo;
                  return (
                    <button key={p.rotulo} type="button" onClick={() => setAteData(alvo)}
                      className="px-3 py-2 text-sm rounded-lg border text-left"
                      style={{ borderColor: ativo ? AZUL : "#E5E7EB", background: ativo ? "#F5F8FF" : "#fff", color: ativo ? AZUL : "#374151" }}>
                      <span className="font-medium">{p.rotulo}</span>
                      <span className="block text-[11px] text-gray-400">até {dataBr(alvo)}</span>
                    </button>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <span className="text-xs text-gray-500">ou até o dia</span>
                <input type="date" value={ateData} min={hojeSP()} max={somarDias(hojeSP(), 60)}
                  onChange={(e) => setAteData(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border border-gray-200 text-sm" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-700">Motivo</div>
              <div className="flex flex-wrap gap-2">
                {MOTIVOS.map((m) => (
                  <button key={m} type="button" onClick={() => setMotivo(m)}
                    className="px-3 py-1.5 text-sm rounded-full border"
                    style={{ borderColor: motivo === m ? AZUL : "#E5E7EB", color: motivo === m ? AZUL : "#374151", background: motivo === m ? "#F5F8FF" : "#fff" }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-gray-400">
              Os leads que já são de {afastando.nome} continuam com ele(a).
            </p>

            <div className="flex gap-2 justify-end pt-1">
              <button disabled={executando} onClick={() => setAfastando(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                Cancelar
              </button>
              <button disabled={executando} onClick={() => void salvarAfastamento()}
                className="px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-60"
                style={{ background: "#B54708" }}>
                {executando ? "Aplicando…" : `Afastar até ${dataBr(ateData)}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
