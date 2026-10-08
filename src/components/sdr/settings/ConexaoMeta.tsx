// src/components/sdr/settings/ConexaoMeta.tsx
// -----------------------------------------------------------------------------
// WHATSAPP (META) — o painel de conexão da Cloud API, "igual ManyChat"
// (Bruno, 23/09/2026). Conecta número clicando num botão (a janela é da própria
// Meta), mostra se cada número está saudável e se as mensagens estão chegando.
//
// Conexão SÓ por Coexistência (Bruno, 08/10/2026): o número continua no
// WhatsApp Business do celular e as conversas também aparecem no QS. Cada
// número tem um dono (SDR/closer) ou é o NÚMERO DO TIME — o padrão, por onde
// os closers falam (o 1935). O cadastro de "número só da API" saiu: com número
// que está no celular a janela da Meta quebrava com HTTP 500.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  carregarPainelMeta, conectarPelaMeta, copiarModelosDoOficial, desconectarNumeroMeta, registrarNumeroMeta, salvarConfigId,
  type NumeroMeta, type PainelMeta,
} from "@/lib/qs/metaConexao";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { apontarWebhookDaMeta } from "@/lib/qs/waInbox";

const AZUL = "#0147FF";

const QUALIDADE: Record<string, { txt: string; cor: string }> = {
  GREEN: { txt: "Qualidade alta", cor: "#0F7B34" },
  YELLOW: { txt: "Qualidade média", cor: "#B54708" },
  RED: { txt: "Qualidade baixa — risco de bloqueio", cor: "#B42318" },
};

const LIMITE: Record<string, string> = {
  TIER_50: "50 conversas novas/dia", TIER_250: "250 conversas novas/dia", TIER_1K: "1.000 conversas novas/dia",
  TIER_10K: "10.000 conversas novas/dia", TIER_100K: "100.000 conversas novas/dia", TIER_UNLIMITED: "sem limite",
};

const MODO: Record<NumeroMeta["modo"], string> = {
  env: "Número oficial (configurado na Vercel)",
  cloud: "Número oficial (Cloud API)",
  coexistencia: "WhatsApp Business no celular + QS",
};

function quando(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const MOTIVO_ENTRADA: Record<string, string> = {
  "nao-chega": "A Meta não está entregando as mensagens dos clientes ao QS.",
  assinatura: "A Meta entrega, mas o QS recusa (o app secret não bate).",
  "chega-e-ignora": "As mensagens chegam, mas nenhuma está sendo gravada.",
  "sem-pulso": "O QS ainda não recebeu nenhum sinal da Meta.",
};

/** userId: "" = ainda não escolheu · TIME = número do time (sem dono). */
const TIME = "__time__";
interface Pedido { userId: string }

export default function ConexaoMeta() {
  const [painel, setPainel] = useState<PainelMeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [configId, setConfigId] = useState("");
  const [pedido, setPedido] = useState<Pedido | null>(null);

  const carregar = useCallback(async () => {
    try {
      const p = await carregarPainelMeta();
      setPainel(p);
      setConfigId(p.cadastro.configId || "");
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar.");
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function guardarConfig() {
    setOcupado(true);
    try {
      await salvarConfigId(configId);
      notifySuccess("Configuração salva. O botão de conectar já pode ser usado.");
      await carregar();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setOcupado(false);
    }
  }

  async function conectar(p: Pedido) {
    if (!painel?.cadastro.appId || !painel.cadastro.configId) return;
    if (!p.userId) { notifyError("Escolha de quem é o número."); return; }
    setOcupado(true);
    try {
      const r = await conectarPelaMeta({
        appId: painel.cadastro.appId, configId: painel.cadastro.configId,
        userId: p.userId === TIME ? null : p.userId,
      });
      notifySuccess(`Conectado: ${r.numero || "número"}.`);
      if (r.avisos.length) notifyError(`Conectado, com avisos: ${r.avisos.join(" · ")}`);
      setPedido(null);
      await carregar();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui conectar.");
    } finally {
      setOcupado(false);
    }
  }

  async function apontar() {
    setOcupado(true);
    const r = await apontarWebhookDaMeta();
    setOcupado(false);
    if (r.ok) { notifySuccess(`Webhook apontado para ${r.callbackUrl}. Mande um "oi" pro número pra testar.`); await carregar(); }
    else notifyError(r.error || "A Meta recusou.");
  }

  async function copiarModelos(n: NumeroMeta) {
    setOcupado(true);
    try {
      const r = await copiarModelosDoOficial(n.phoneId);
      if (r.mesmaConta) { notifySuccess("Este número usa a mesma conta do oficial — os modelos já são os mesmos."); return; }
      const midia = (r.pulados || []).filter((p) => p.motivo !== "já existe");
      notifySuccess(`${r.criados?.length || 0} modelo(s) enviados pra aprovação da Meta nesta conta.`);
      if (midia.length) notifyError(`Com mídia no topo, criar à mão nesta conta: ${midia.map((p) => p.nome).join(", ")}.`);
      if (r.erros?.length) notifyError(`A Meta recusou: ${r.erros.map((e) => `${e.nome} (${e.detalhe})`).join(" · ")}`);
      await carregar();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui copiar os modelos.");
    } finally {
      setOcupado(false);
    }
  }

  async function registrar(n: NumeroMeta) {
    const pin = window.prompt("Crie um PIN de 6 números para este número (anote — é a verificação em duas etapas dele):") || "";
    if (!pin) return;
    if (!/^\d{6}$/.test(pin)) { notifyError("O PIN tem 6 números."); return; }
    setOcupado(true);
    try {
      await registrarNumeroMeta(n.phoneId, pin);
      notifySuccess("Número registrado na Cloud API.");
      await carregar();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui registrar.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar(n: NumeroMeta) {
    if (!window.confirm(`${n.origem === "vercel" ? "Desativar" : "Desconectar"} ${n.numero || n.phoneId} no QS? O QS para de enviar e receber por este número.`)) return;
    setOcupado(true);
    try {
      await desconectarNumeroMeta(n.phoneId);
      notifySuccess("Número desconectado do QS.");
      await carregar();
    } catch (e) {
      notifyError(e instanceof Error ? e.message : "Não consegui desconectar.");
    } finally {
      setOcupado(false);
    }
  }

  if (erro) {
    return (
      <div className="space-y-3">
        <div className="p-4 rounded-lg text-sm" style={{ background: "#FEE4E2", color: "#B42318" }}>{erro}</div>
        <button onClick={() => void carregar()} className="px-3 py-2 text-sm rounded-lg border border-gray-200">Tentar de novo</button>
      </div>
    );
  }
  if (!painel) return <div className="text-sm text-gray-500">Carregando…</div>;

  const pronto = Boolean(painel.cadastro.appId && painel.cadastro.configId && painel.cadastro.podeTrocarCodigo);
  const entrada = painel.entrada;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-bold text-gray-900">WhatsApp (Meta)</h2>
        <p className="text-sm text-gray-500 mt-1">
          Conecte o WhatsApp ao QS pela janela oficial da Meta — sem copiar token. Todo o envio e
          recebimento de mensagens do QS passa por aqui.
        </p>
      </header>

      {/* ── As mensagens estão chegando? ─────────────────────────────────── */}
      {entrada && (
        <div className="p-3 rounded-lg text-sm"
          style={entrada.ok ? { background: "#DCFCE7", color: "#0F7B34" } : { background: "#FEF0C7", color: "#B54708" }}>
          {entrada.ok
            ? <>Mensagens dos clientes chegando normalmente (último sinal: {quando(entrada.ultimoValidoEm ?? null)}).</>
            : <><strong>{MOTIVO_ENTRADA[entrada.motivo || ""] || "Entrada de mensagens com problema."}</strong>{" "}
                <button disabled={ocupado} onClick={() => void apontar()}
                  className="ml-1 rounded-md px-2 py-1 font-medium text-white disabled:opacity-50" style={{ background: "#B54708" }}>
                  Apontar o webhook da Meta para o QS
                </button></>}
        </div>
      )}

      {/* ── Números ──────────────────────────────────────────────────────── */}
      <section className="grid gap-3 sm:grid-cols-2">
        {painel.numeros.map((n) => {
          const q = n.qualidade ? QUALIDADE[n.qualidade] : null;
          const ligado = n.status === "conectado";
          return (
            <div key={n.phoneId} className="rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900">{n.numero || n.phoneId}</div>
                  <div className="text-[12px] text-gray-500 truncate">{n.nome || "—"}</div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
                  style={ligado ? { color: "#0F7B34", background: "#DCFCE7" } : { color: "#B42318", background: "#FEE4E2" }}>
                  {ligado ? "conectado" : "desconectado"}
                </span>
              </div>
              <div className="text-[12px] text-gray-600">
                {MODO[n.modo]}{n.dono ? ` · de ${n.dono}` : n.modo === "coexistencia" ? " · número do time (closers)" : ""}
              </div>
              {q && <div className="text-[12px] font-medium" style={{ color: q.cor }}>● {q.txt}</div>}
              {n.limite && <div className="text-[12px] text-gray-600">Limite: {LIMITE[n.limite] || n.limite}</div>}
              {n.metaErro && <div className="text-[12px]" style={{ color: "#B42318" }}>A Meta respondeu: {n.metaErro}</div>}
              {ligado && n.statusMeta && n.statusMeta !== "CONNECTED" && (
                <div className="p-2 rounded-lg text-[12px]" style={{ background: "#FEF0C7", color: "#B54708" }}>
                  Na Meta este número está <strong>{n.statusMeta}</strong> — ainda não envia nem recebe.
                  <button disabled={ocupado} onClick={() => void registrar(n)}
                    className="ml-2 rounded-md px-2 py-1 font-medium text-white" style={{ background: "#B54708" }}>
                    Registrar com PIN
                  </button>
                </div>
              )}
              {n.donoId && ligado && (
                <div className="p-2 rounded-lg text-[12px] flex items-center justify-between gap-2" style={{ background: "#F4F6FA", color: "#334155" }}>
                  <span>
                    {n.modelos?.erro ? "Modelos: não consegui ler a conta."
                      : n.modelos ? <>Modelos nesta conta: <b>{n.modelos.aprovados}</b> aprovados · <b>{n.modelos.pendentes}</b> em análise{n.modelos.recusados ? <> · <b>{n.modelos.recusados}</b> recusados</> : null}</>
                      : "Modelos: —"}
                  </span>
                  <button disabled={ocupado} onClick={() => void copiarModelos(n)}
                    className="shrink-0 rounded-md px-2 py-1 font-medium border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40">
                    Copiar modelos do oficial
                  </button>
                </div>
              )}
              <div className="text-[11px] text-gray-400">Última mensagem de cliente: {quando(n.ultimaEntrada)}</div>
              <div className="flex gap-2 pt-1">
                <button disabled={!pronto || ocupado}
                  onClick={() => setPedido({ userId: n.donoId || TIME })}
                  className="flex-1 px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-40"
                  style={{ background: AZUL }}>
                  {ligado ? "Reconectar" : "Conectar"}
                </button>
                {ligado && (
                  <button disabled={ocupado} onClick={() => void desconectar(n)}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                    {n.origem === "vercel" ? "Desativar" : "Desconectar"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {!pronto && (
        <div className="p-3 rounded-lg text-sm" style={{ background: "#EEF2FF", color: "#1E3A8A" }}>
          <strong>Os botões de conectar estão travados</strong> porque falta{" "}
          {!painel.cadastro.appId ? "o META_CALLS_APP_ID na Vercel"
            : !painel.cadastro.podeTrocarCodigo ? "o META_CALLS_APP_SECRET na Vercel"
            : "colar o ID da configuração da Meta no quadro \"Configuração do botão\", aqui embaixo"}.
          {" "}É um passo feito uma vez só.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button disabled={!pronto || ocupado} onClick={() => setPedido({ userId: "" })}
          className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-40" style={{ background: AZUL }}>
          + Conectar WhatsApp Business
        </button>
      </div>

      {/* ── Configuração do botão (uma vez só) ───────────────────────────── */}
      <section className="rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="text-sm font-bold text-gray-900">Configuração do botão (feita uma vez)</h3>
        {!painel.cadastro.appId && (
          <p className="text-[12px]" style={{ color: "#B42318" }}>Falta META_CALLS_APP_ID na Vercel.</p>
        )}
        {!painel.cadastro.podeTrocarCodigo && (
          <p className="text-[12px]" style={{ color: "#B42318" }}>Falta META_CALLS_APP_SECRET na Vercel.</p>
        )}
        <p className="text-[12px] text-gray-500">
          Na Meta: <strong>developers.facebook.com</strong> → o app → <strong>Login do Facebook para Empresas</strong> →
          <strong> Configurações</strong> → criar uma configuração do tipo <em>Cadastro incorporado do WhatsApp</em>.
          Copie o número dela (o "ID da configuração") e cole aqui. No mesmo app, cadastre o domínio
          <span className="font-mono"> qs-turis.vercel.app</span> em "Domínios permitidos para o SDK do JavaScript".
        </p>
        <div className="flex gap-2">
          <input value={configId} onChange={(e) => setConfigId(e.target.value.replace(/\D/g, ""))}
            placeholder="ID da configuração" inputMode="numeric"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 font-mono" />
          <button disabled={ocupado || configId === (painel.cadastro.configId || "")} onClick={() => void guardarConfig()}
            className="px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-40" style={{ background: AZUL }}>
            Salvar
          </button>
        </div>
        {painel.cadastro.appId && <p className="text-[11px] text-gray-400">App: {painel.cadastro.appId}</p>}
      </section>

      {/* ── Antes de abrir a janela da Meta ──────────────────────────────── */}
      {pedido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => !ocupado && setPedido(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-base font-bold text-gray-900">Conectar um WhatsApp Business</h4>
            <p className="text-sm text-gray-600">
              O número precisa estar no app <strong>WhatsApp Business</strong> (não no WhatsApp comum). Na
              janela da Meta, digite o número: ela mostra um QR para ler NO APP WhatsApp Business do celular
              dele. O número continua no celular e as conversas passam a aparecer também no QS.
            </p>
            <select value={pedido.userId} onChange={(e) => setPedido({ userId: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200">
              <option value="">De quem é o número?</option>
              <option value={TIME}>Número do time — closers (padrão)</option>
              {painel.sdrs.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
            {pedido.userId === TIME && (
              <p className="text-[12px] text-gray-500">
                Vira o número padrão do QS: os closers falam por ele, e também quem ainda não tem número próprio.
              </p>
            )}
            <div className="flex gap-2 justify-end pt-2">
              <button disabled={ocupado} onClick={() => setPedido(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700">Cancelar</button>
              <button disabled={ocupado} onClick={() => void conectar(pedido)}
                className="px-3 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-60" style={{ background: AZUL }}>
                {ocupado ? "Conectando…" : "Abrir a janela da Meta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
