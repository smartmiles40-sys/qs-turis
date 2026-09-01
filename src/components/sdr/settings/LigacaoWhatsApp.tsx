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
// A LIGAÇÃO JÁ EXISTE no QS desde 31/08 (`waCall.ts`: o navegador do SDR gera o
// SDP e o áudio sai por ele). O "Ligar" desta tela é o TESTE de bancada — quem
// liga no dia a dia é o card do lead e a fila.
//
// AS REGRAS DA META QUE DECIDEM SE ISSO SERVE (e que a tela repete, porque
// esquecer delas é como se perde uma tarde):
//   • o pedido exige CONVERSA ABERTA — quem nunca respondeu não pode receber;
//   • 1 pedido por 24h e 2 por semana, por pessoa;
//   • permissão temporária vale 7 dias; "Permitir" (permanente) não expira;
//   • teto de 5 chamadas atendidas por 24h com a mesma pessoa;
//   • a pessoa pode revogar quando quiser, nas configurações do WhatsApp — e a
//     Meta NÃO avisa ninguém disso. É por isso que a permissão guardada no
//     banco é sempre uma foto, e a conferência de verdade é no clique.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { lerChamadas, ativarChamadasNaMeta, pedirPermissaoLigacao, lerDiagnosticoChamadas,
         lerPermissaoDeLigacao, type ConfigChamadas, type DiagnosticoChamadas } from "@/lib/qs/waInbox";
import { ligarPeloWhatsApp, type Ligacao, type PassoLigacao } from "@/lib/qs/waCall";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { getSetting, setSetting } from "@/lib/qsSettings";
import { supabase } from "@/lib/supabase";
import { normalizePhoneBR } from "@/lib/whatsapp";

interface LinhaPermissao {
  wa_id: string;
  status: string;
  expira_em: string | null;
  fonte: string | null;
  confirmado: boolean;
  atualizado_em: string;
  qs_leads: { full_name: string | null } | { full_name: string | null }[] | null;
}

/** Aceita o objeto e o array — ver o comentário do estado `quemLiberou`. */
function nomeDoLead(l: LinhaPermissao): string | null {
  const r = Array.isArray(l.qs_leads) ? l.qs_leads[0] : l.qs_leads;
  return r?.full_name ?? null;
}

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
  // A CADÊNCIA DE QUEM LIBEROU (0070). Vazia = desligado, que é como nasce.
  const [cadencias, setCadencias] = useState<{ id: string; name: string }[]>([]);
  const [cadenciaPermissao, setCadenciaPermissao] = useState<string>("");
  const [salvandoCadencia, setSalvandoCadencia] = useState(false);
  // Quem liberou, em ordem de quem liberou por último. Existe pra a pergunta
  // "está entrando alguma permissão?" ter resposta SEM abrir o Supabase — que
  // é o único jeito de saber hoje.
  // `qs_leads` vem como OBJETO no PostgREST (a relação é muitos-para-um), mas os
  // tipos gerados do supabase-js declaram array. Guardamos os dois formatos e
  // normalizamos na hora de ler — apostar num só quebra em silêncio no dia em
  // que o outro aparecer.
  const [quemLiberou, setQuemLiberou] = useState<LinhaPermissao[]>([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    // `finally` obrigatório: o `carregando` desabilita o botão de pedir
    // permissão, então qualquer exceção aqui deixaria o botão morto PRA SEMPRE,
    // sem explicação — que é exatamente o defeito que este arquivo acabou de
    // consertar. Hoje as duas leituras tratam o próprio erro e não lançam, mas
    // "hoje não lança" não é garantia de nada.
    try {
      const [r, d] = await Promise.all([lerChamadas(), lerDiagnosticoChamadas()]);
      setCfg(r.calling);
      setPhoneId(r.phoneId ?? null);
      setErro(r.error ?? null);
      setDiag(d.diag);
    } catch (e) {
      setErro((e as Error)?.message ?? "Não consegui ler a configuração de chamadas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  // Cadências disponíveis + a que está escolhida hoje.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("qs_cadences").select("id,name")
        .eq("status", "disponivel").order("name");
      setCadencias((data ?? []) as { id: string; name: string }[]);
      const atual = await getSetting<string>("cadencia_permissao_ligacao");
      setCadenciaPermissao(typeof atual === "string" ? atual : "");
    })();
  }, []);

  // Lê direto da tabela (não pela Meta): é a foto que o webhook mantém, e é
  // exatamente essa foto que pinta os botões da fila. Ver aqui o que a fila vê
  // é o ponto — se divergir da Meta, o problema é a foto, e isso é diagnóstico.
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("qs_call_permissions")
        .select("wa_id,status,expira_em,fonte,confirmado,atualizado_em,qs_leads(full_name)")
        .order("atualizado_em", { ascending: false })
        .limit(15);
      setQuemLiberou((data ?? []) as unknown as LinhaPermissao[]);
    })();
  }, []);

  const salvarCadencia = async (id: string) => {
    setSalvandoCadencia(true);
    // String vazia vira null de propósito: é assim que se DESLIGA a automação
    // sem precisar de um segundo controle na tela.
    const ok = await setSetting("cadencia_permissao_ligacao", id || null);
    setSalvandoCadencia(false);
    if (ok) { setCadenciaPermissao(id); notifySuccess(id ? "Cadência salva." : "Automação desligada."); }
    else notifyError("Não consegui salvar.");
  };

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
    // NORMALIZA em vez de recusar. Exigir 12 dígitos fazia a tela rejeitar
    // "11992221156" — um número perfeitamente válido, só sem o DDI — e o clique
    // morria aqui, sem virar requisição: foi o "não enviou" de 01/09. Quem sabe
    // prefixar o 55 é o sistema, não a pessoa que digita.
    const fone = normalizePhoneBR(telefone);
    if (fone.length < 12) { notifyError("Telefone incompleto — informe ao menos DDD e número, ex.: 11999999999."); return; }
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
    const fone = normalizePhoneBR(telefone);
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
        {/* BOTÃO DESABILITADO TEM QUE DIZER POR QUÊ. Um clique que não faz nada
            e não explica nada é indistinguível de "o sistema está quebrado" — e
            foi assim que se perdeu tempo em 01/09 tentando mandar um pedido que
            nunca virou requisição. O motivo vai no `title` (passar o mouse) e em
            texto embaixo, porque nem todo mundo passa o mouse. */}
        <button
          onClick={() => void pedir()}
          disabled={ocupado || !podeMexer || !ligado || carregando}
          title={
            carregando ? "Ainda lendo a configuração do número na Meta…"
            : !podeMexer ? "Só administrador ou gestor manda pedido de permissão."
            : !ligado ? "As chamadas não estão ativadas neste número — a Meta recusaria o pedido."
            : ocupado ? "Aguarde a operação anterior terminar."
            : "Manda a pergunta no WhatsApp da pessoa (exige conversa aberta de 24h)."
          }
          className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
        >
          Enviar pedido de permissão
        </button>
        {carregando && <p className="mt-2 text-[12px] text-gray-500">Lendo a configuração do número na Meta… o botão libera em seguida.</p>}
        {!carregando && !ligado && (
          <p className="mt-2 text-[12px] text-amber-700">
            <b>O botão está desabilitado</b> porque as chamadas não aparecem como ativadas neste
            número {erro ? `(não consegui ler a configuração: ${erro})` : `(a Meta respondeu "${cfg?.status ?? "sem status"}")`}.
            Use o botão “Ativar chamadas” acima e recarregue.
          </p>
        )}
        {!carregando && ligado && !podeMexer && (
          <p className="mt-2 text-[12px] text-amber-700">Só administrador ou gestor manda pedido de permissão.</p>
        )}
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

      {/* ── A CADÊNCIA DE QUEM LIBEROU ──────────────────────────────────────
          O pulo do gato do fluxo comercial: o cliente autoriza a ligação e o
          lead cai sozinho numa cadência de ligação, sem ninguém vigiar caixa de
          entrada. A permissão temporária dura 7 dias — quem não ligar dentro
          dela precisa pedir de novo, e o limite é 1 pedido por 24h. */}
      <div className="rounded-lg border border-gray-200 p-3">
        <h3 className="text-[13px] font-semibold text-gray-900">Cadência de quem liberou a ligação</h3>
        <p className="mt-1 text-[12px] text-gray-600">
          Quando o cliente autorizar a ligação no WhatsApp, o lead entra sozinho nesta cadência.
          As travas de sempre valem: lead ganho, com reunião marcada ou com atividade em aberto
          <b> não</b> é movido — a automação só pesca quem estava parado.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={cadenciaPermissao}
            onChange={(e) => void salvarCadencia(e.target.value)}
            disabled={!podeMexer || salvandoCadencia}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-[13px] disabled:opacity-50"
          >
            <option value="">Desligado — só registra a permissão</option>
            {cadencias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {salvandoCadencia && <span className="text-[12px] text-gray-500">salvando…</span>}
        </div>
        {!cadencias.length && (
          <p className="mt-2 text-[12px] text-amber-700">
            Nenhuma cadência com status <b>disponível</b> — crie uma em Cadências pra poder escolher aqui.
          </p>
        )}
      </div>

      {/* ── QUEM LIBEROU ────────────────────────────────────────────────────
          Sem esta lista, "está entrando permissão?" só se responde abrindo o
          Supabase. E é a pergunta que se faz todo dia no começo. */}
      <div className="rounded-lg border border-gray-200 p-3">
        <h3 className="text-[13px] font-semibold text-gray-900">Quem liberou a ligação</h3>
        <p className="mt-1 text-[12px] text-gray-600">
          As últimas 15 respostas, em ordem de quem liberou por último. É a mesma foto que
          pinta os botões de ligar na fila.
        </p>
        {!quemLiberou.length ? (
          <p className="mt-2 text-[12px] text-gray-500">
            Ninguém ainda. A permissão entra sozinha quando o cliente responde ao pedido — ou
            quando ele liga pra empresa.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {quemLiberou.map((l) => {
              const vale = l.status === "permanent"
                || (l.status === "temporary" && !!l.expira_em && new Date(l.expira_em).getTime() > Date.now());
              return (
                <li key={l.wa_id} className="flex items-center justify-between gap-3 py-1.5 text-[12px]">
                  <span className="min-w-0 truncate text-gray-800">
                    {nomeDoLead(l) || l.wa_id}
                    {/* Inferida de o cliente ter ligado: vale pra fila, mas não veio
                        de um "sim" — dizer isso evita explicar o mesmo toda semana. */}
                    {!l.confirmado && <span className="ml-1 text-gray-400">(pelo retorno da ligação)</span>}
                  </span>
                  <span className={vale ? "shrink-0 font-medium text-green-700" : "shrink-0 text-gray-400"}>
                    {l.status === "permanent" ? "sem prazo"
                      : vale ? `até ${new Date(l.expira_em!).toLocaleDateString("pt-BR")}`
                      : l.status === "temporary" ? "vencida" : "não liberou"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-md bg-gray-50 p-3 text-[12px] text-gray-600">
        <p className="font-medium text-gray-800">Os limites da Meta, pra não perder tempo:</p>
        <p className="mt-1">1 pedido por 24h e 2 por semana, por pessoa. Permissão concedida vale 7 dias e 5 ligações atendidas. 4 não atendidas seguidas revogam sozinhas.</p>
      </div>
    </div>
  );
}
