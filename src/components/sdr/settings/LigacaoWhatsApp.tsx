// src/components/sdr/settings/LigacaoWhatsApp.tsx
// -----------------------------------------------------------------------------
// LIGAÇÃO PELO WHATSAPP (Cloud API Calling) — diagnóstico e teste.
//
// Esta tela NÃO liga pra ninguém. Ela existe pra responder, sem SSH e sem curl,
// as duas perguntas que travam qualquer teste:
//
//   1. As chamadas estão MESMO ligadas neste número? (a Meta só conta a
//      verdade em GET /{phone_number_id}/settings)
//   2. O pedido de permissão chega no aparelho, e como aparece?
//
// A LIGAÇÃO EM SI AINDA NÃO EXISTE no QS. Ela precisa de troca de SDP e
// WebRTC no navegador — o `WebphoneWidget` de hoje fala SIP (JsSIP), que não
// serve pra Cloud API. É o próximo passo, e só vale a pena depois que o teste
// de permissão mostrar que o fluxo comercial fecha.
//
// AS REGRAS DA META QUE DECIDEM SE ISSO SERVE (e que a tela repete, porque
// esquecer delas é como se perde uma tarde):
//   • o pedido exige CONVERSA ABERTA — quem nunca respondeu não pode receber;
//   • 1 pedido por 24h e 2 por semana, por pessoa;
//   • permissão concedida vale 7 dias e 5 ligações atendidas;
//   • 4 ligações não atendidas seguidas revogam a permissão sozinhas.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { lerChamadas, ativarChamadasNaMeta, pedirPermissaoLigacao, lerDiagnosticoChamadas,
         lerPermissaoDeLigacao, type ConfigChamadas, type DiagnosticoChamadas } from "@/lib/qs/waInbox";
import { ligarPeloWhatsApp, type Ligacao, type PassoLigacao } from "@/lib/qs/waCall";
import { useQsAuth } from "@/contexts/QsAuthContext";

export default function LigacaoWhatsApp() {
  const { currentUser } = useQsAuth();
  const podeMexer = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [cfg, setCfg] = useState<ConfigChamadas | null>(null);
  const [diag, setDiag] = useState<DiagnosticoChamadas | null>(null);
  const [ligacao, setLigacao] = useState<Ligacao | null>(null);
  const [passo, setPasso] = useState<PassoLigacao | null>(null);
  const [calado, setCalado] = useState(false);
  const [phoneId, setPhoneId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [texto, setTexto] = useState("Podemos te ligar por aqui pelo WhatsApp?");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [r, d] = await Promise.all([lerChamadas(), lerDiagnosticoChamadas()]);
    setCfg(r.calling);
    setPhoneId(r.phoneId ?? null);
    setErro(r.error ?? null);
    setDiag(d.diag);
    setCarregando(false);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const ligado = String(cfg?.status || "").toUpperCase() === "ENABLED";

  const ativar = async () => {
    setOcupado(true);
    const r = await ativarChamadasNaMeta();
    setOcupado(false);
    if (r.ok) { notifySuccess("Chamadas ativadas na Meta."); void carregar(); }
    // A Meta exige limite de 2.000 destinatários/24h. Abaixo disso ela recusa —
    // e a mensagem dela não diz isso, por isso a dica vai junto.
    else notifyError(`${r.error} — confira se o número tem limite de 2.000/24h.`);
  };

  const pedir = async () => {
    const fone = telefone.replace(/\D/g, "");
    if (fone.length < 12) { notifyError("Telefone com DDI e DDD, ex.: 5511999999999."); return; }
    setOcupado(true);
    const r = await pedirPermissaoLigacao(fone, texto);
    setOcupado(false);
    if (r.ok) notifySuccess("Pedido enviado. Veja no aparelho.");
    else notifyError(r.error ?? "Não consegui enviar.");
  };

  // ── A VOLTA: ligar pro cliente ─────────────────────────────────────────────
  // O microfone é pedido aqui e não no carregamento da tela de propósito: o
  // navegador só concede a permissão em resposta a um clique, e pedir antes da
  // hora treina a pessoa a dizer "bloquear".
  const ligar = async () => {
    const fone = telefone.replace(/\D/g, "");
    setPasso(null);
    setCalado(false);
    try {
      const l = await ligarPeloWhatsApp(fone, (p) => setPasso(p));
      setLigacao(l);
    } catch (e) {
      notifyError((e as Error)?.message ?? "Não consegui ligar.");
      setLigacao(null);
    }
  };

  const desligar = async () => {
    await ligacao?.desligar();
    setLigacao(null);
    setPasso({ estado: "encerrada" });
  };

  const conferirPermissao = async () => {
    const r = await lerPermissaoDeLigacao(telefone.replace(/\D/g, ""));
    if (r.error) notifyError(r.error);
    else notifySuccess(`Permissão: ${r.status ?? "sem resposta"}`);
  };

  if (carregando) return <p className="text-sm text-gray-500">Carregando…</p>;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Ligação pelo WhatsApp</h2>
        <p className="mt-1 text-[13px] text-gray-600">
          Diagnóstico e teste da Cloud API Calling. <strong>Esta tela ainda não faz ligações</strong> —
          serve pra confirmar que o número está habilitado e que o pedido de permissão chega no aparelho.
        </p>
      </div>

      {erro && <p className="rounded-md bg-amber-50 p-2 text-[13px] text-amber-800">{erro}</p>}

      {/* Estado real, direto da Meta */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-[13px] font-semibold text-gray-900">Estado na Meta</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-gray-600">Chamadas</dt>
          <dd className={ligado ? "font-medium text-green-700" : "font-medium text-gray-900"}>
            {cfg?.status ?? "—"}
          </dd>
          <dt className="text-gray-600">Ícone de ligar</dt>
          <dd className="text-gray-900">{cfg?.call_icon_visibility ?? "—"}</dd>
          <dt className="text-gray-600">Pedido de permissão</dt>
          <dd className="text-gray-900">{cfg?.callback_permission_status ?? "—"}</dd>
          <dt className="text-gray-600">phone_number_id</dt>
          <dd className="font-mono text-[12px] text-gray-900">{phoneId ?? "—"}</dd>
        </dl>
        {podeMexer && !ligado && (
          <button
            onClick={() => void ativar()}
            disabled={ocupado}
            className="mt-3 rounded-md bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            Ativar chamadas neste número
          </button>
        )}
      </div>

      {/* Teste do pedido de permissão */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-[13px] font-semibold text-gray-900">Testar pedido de permissão</p>
        <p className="mt-1 text-[12px] text-gray-600">
          Só funciona com <strong>conversa aberta</strong>: a pessoa precisa ter escrito nas últimas 24h.
          Mande uma mensagem do seu celular pro número da empresa antes de testar.
        </p>
        <input
          className="mt-2 w-full rounded-md border border-gray-300 p-2 text-sm"
          placeholder="5511999999999"
          value={telefone}
          disabled={!podeMexer}
          onChange={(e) => setTelefone(e.target.value)}
        />
        <input
          className="mt-2 w-full rounded-md border border-gray-300 p-2 text-sm"
          value={texto}
          disabled={!podeMexer}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button
          onClick={() => void pedir()}
          disabled={ocupado || !podeMexer || !ligado}
          className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          Enviar pedido de permissão
        </button>
        {!ligado && <p className="mt-2 text-[12px] text-amber-700">Ative as chamadas antes — sem isso a Meta recusa o pedido.</p>}
      </div>

      {/* ── POR QUE O EVENTO NÃO CHEGA ────────────────────────────────────
          Cada linha aqui é uma pergunta que custou uma ida ao Graph Explorer no
          dia 31/08. A de baixo — quais CAMPOS o app assina — é a que o
          `subscribed_apps` não responde, e é onde a configuração costuma mentir:
          o toggle aparece aceso e a assinatura não foi gravada. */}
      <div className="rounded-md border border-gray-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-gray-900">Por que o evento não chega</p>
          <button onClick={() => void carregar()} className="text-[12px] text-gray-600 underline">Atualizar</button>
        </div>

        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-gray-600">Número lido</dt>
          <dd className="text-gray-900">
            {diag?.numeros?.find((n) => n.id === diag?.phoneId)?.numero ?? "—"}
            <span className="ml-1 font-mono text-[11px] text-gray-500">{diag?.phoneId ?? ""}</span>
          </dd>

          <dt className="text-gray-600">Modo de conexão</dt>
          <dd className={String((diag?.calling as { connection_mode?: string } | null)?.connection_mode || "").toUpperCase() === "SIP"
            ? "font-medium text-red-700" : "text-gray-900"}>
            {(diag?.calling as { connection_mode?: string } | null)?.connection_mode ?? "—"}
          </dd>

          <dt className="text-gray-600">Apps na WABA</dt>
          <dd className="text-gray-900">
            {diag?.apps?.length ? diag.apps.map((a) => a.nome || a.id).join(", ") : (diag?.appsErro ?? "—")}
          </dd>

          <dt className="text-gray-600">App de chamadas assina</dt>
          <dd>
            {diag?.camposErro
              ? <span className="text-amber-700">{diag.camposErro === "sem-META_CALLS_APP_ID"
                  ? "falta a env META_CALLS_APP_ID (o id do app, não é segredo)"
                  : diag.camposErro}</span>
              : <>
                  <span className={diag?.assinaCalls ? "font-medium text-green-700" : "font-medium text-red-700"}>
                    {diag?.assinaCalls ? "calls ✓" : "calls NÃO está assinado"}
                  </span>
                  <span className="ml-2 text-gray-500">{(diag?.campos ?? []).join(", ") || "nenhum campo"}</span>
                </>}
          </dd>

          <dt className="text-gray-600">Callback do app</dt>
          <dd className="break-all font-mono text-[11px] text-gray-700">{diag?.callbackUrl ?? "—"}</dd>
        </dl>

        {/* O placar que responde "chegou algo?" sem ninguém abrir o Supabase. */}
        <div className="mt-3 border-t border-gray-100 pt-2 text-[12px]">
          {diag?.eventos?.length
            ? <ul className="space-y-0.5">
                {diag.eventos.map((e, i) => (
                  <li key={i} className="text-gray-700">
                    <span className="font-mono text-[11px] text-gray-500">
                      {new Date(e.recebido_em).toLocaleString("pt-BR")}
                    </span>{" "}
                    {e.evento ?? "?"} {e.direcao ? `(${e.direcao})` : ""} {e.de ? `de ${e.de}` : ""}
                  </li>
                ))}
              </ul>
            : <p className="text-gray-600">Nenhum evento de chamada recebido ainda.</p>}
        </div>
      </div>

      {/* ── LIGAR PRO CLIENTE ────────────────────────────────────────────────
          Quem liga é ESTE navegador: a Meta exige um SDP offer, e SDP só sai de
          um ponto de áudio real. O servidor é o carteiro. */}
      <div className="rounded-md border border-gray-200 p-3">
        <p className="text-[13px] font-semibold text-gray-900">Ligar pro cliente</p>
        <p className="mt-1 text-[12px] text-gray-600">
          Usa o número do campo acima. O áudio sai e entra por este navegador — fone de ouvido evita microfonia.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!ligacao ? (
            <button
              onClick={() => void ligar()}
              disabled={!podeMexer || !ligado}
              className="rounded-md bg-green-700 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              Ligar
            </button>
          ) : (
            <>
              <button
                onClick={() => void desligar()}
                className="rounded-md bg-red-700 px-3 py-1.5 text-[13px] font-medium text-white"
              >
                Desligar
              </button>
              <button
                onClick={() => { const c = !calado; setCalado(c); ligacao.mudo(c); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-[13px] text-gray-800"
              >
                {calado ? "Voltar a falar" : "Mudo"}
              </button>
            </>
          )}
          <button
            onClick={() => void conferirPermissao()}
            disabled={!podeMexer}
            className="text-[12px] text-gray-600 underline disabled:opacity-50"
          >
            Posso ligar pra esse número?
          </button>
        </div>

        {passo && (
          <p className="mt-2 text-[13px] text-gray-800">
            {passo.estado === "pedindo-microfone" && "Liberando o microfone…"}
            {passo.estado === "discando" && "Discando… (a Meta está montando a chamada)"}
            {passo.estado === "tocando" && "Tocando no aparelho do cliente…"}
            {passo.estado === "falando" && "Falando — o áudio está conectado."}
            {passo.estado === "recusada" && "O cliente recusou."}
            {passo.estado === "encerrada" && "Chamada encerrada."}
            {passo.estado === "erro" && `Falhou: ${passo.detalhe ?? "erro no áudio"}`}
          </p>
        )}
      </div>

      <div className="rounded-md bg-gray-50 p-3 text-[12px] text-gray-600">
        <p className="font-medium text-gray-800">Os limites da Meta, pra não perder tempo:</p>
        <p className="mt-1">1 pedido por 24h e 2 por semana, por pessoa. Permissão concedida vale 7 dias e 5 ligações atendidas. 4 não atendidas seguidas revogam sozinhas.</p>
      </div>
    </div>
  );
}
