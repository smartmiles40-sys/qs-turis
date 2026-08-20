// src/components/sdr/settings/LinhasDoTime.tsx
// -----------------------------------------------------------------------------
// AS LINHAS DO TIME — qual número é de quem, e qual está de fato no ar.
//
// POR QUE ESTA TELA EXISTE (Bruno, 20/08/2026). O QS tinha UM número pra empresa
// inteira, vindo de uma variável da Vercel (CHATWOOT_DEFAULT_INBOX_ID). Enquanto
// só a SDR falava, funcionava. Na virada pro closer, não: ele não tinha número
// no QS e atendia pelo CELULAR DELE — conversa que o QS não vê, não grava, não
// cobra, e que vai embora junto com a pessoa no dia em que ela sair.
//
// A tela junta as duas listas que nunca se falavam:
//   • as CAIXAS do Chatwoot   → por onde a mensagem sai;
//   • as INSTÂNCIAS da Evolution → o WhatsApp que está (ou não) conectado.
// Cruzar as duas responde a pergunta que antes exigia SSH no VPS: "o número dos
// closers está no ar, e o QS sabe usar ele?".
//
// E é daqui que sai o QR CODE. Por isso a rota só responde pra admin/gestor:
// quem vê o QR de um número pareia aquele WhatsApp no próprio celular e lê a
// conversa inteira do comercial. É o segredo mais forte deste módulo.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { setSetting } from "@/lib/qsSettings";
import {
  carregarLinhas, pedirQrCode, estadoDaLinha, desconectarLinha, reiniciarLinha,
  listUsersLite, numeroCurto, WA_CAIXAS_KEY,
  type PainelDeLinhas, type MapaDeLinhas, type CaixaDaLinha, type UserLite,
} from "@/lib/qs/waInbox";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

const AZUL = "#0147FF";

/** Os papéis que atendem no WhatsApp. Marketing não fala com lead — fica fora. */
const PAPEIS: { key: string; nome: string; ajuda: string }[] = [
  { key: "sdr", nome: "SDRs", ajuda: "prospecção — normalmente o número oficial" },
  { key: "closer", nome: "Closers", ajuda: "quem recebe o lead depois da reunião marcada" },
  { key: "gestor", nome: "Gestor", ajuda: "acompanha e entra na conversa quando precisa" },
  { key: "admin", nome: "Admin", ajuda: "acesso total" },
];

function Pill({ status }: { status: string }) {
  const mapa: Record<string, { txt: string; fg: string; bg: string }> = {
    open: { txt: "no ar", fg: "#0F7B34", bg: "#DCFCE7" },
    close: { txt: "desconectado", fg: "#B42318", bg: "#FEE4E2" },
    connecting: { txt: "esperando o QR", fg: "#B54708", bg: "#FEF0C7" },
    oficial: { txt: "API oficial (Meta)", fg: "#175CD3", bg: "#D1E9FF" },
    "sem-instancia": { txt: "sem número ligado", fg: "#475467", bg: "#EAECF0" },
    desconhecido: { txt: "não sei dizer", fg: "#475467", bg: "#EAECF0" },
  };
  const e = mapa[status] ?? mapa.desconhecido;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap"
      style={{ color: e.fg, background: e.bg }}
    >
      {e.txt}
    </span>
  );
}

/**
 * O QR na tela. Fica sozinho perguntando à Evolution se o pareamento pegou —
 * porque o WhatsApp não avisa ninguém: quem escaneia vê o celular dizer "OK" e
 * fica olhando pra uma tela parada, sem saber se deu certo.
 *
 * O QR da Evolution EXPIRA em menos de um minuto. Por isso o botão de gerar
 * outro é grande e explicado, em vez de escondido atrás de um "tente de novo".
 */
function ModalQr({ instancia, aoFechar, aoConectar }: {
  instancia: string;
  aoFechar: () => void;
  aoConectar: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [segundos, setSegundos] = useState(0);
  const vivo = useRef(true);
  const contador = useRef(0);
  // O callback vai num ref de propósito: o pai o recria a cada render, e sem
  // isto o relógio abaixo seria destruído e refeito junto — perdendo a contagem
  // e disparando uma consulta extra à Evolution a cada render do pai.
  const conectou = useRef(aoConectar);
  conectou.current = aoConectar;

  const gerar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setQr(null);
    const r = await pedirQrCode(instancia);
    if (!vivo.current) return;
    setCarregando(false);
    if (!r.ok) { setErro(r.error || "Não consegui pedir o QR."); return; }
    if (r.jaConectada) { conectou.current(); return; }
    setQr(r.base64 ?? null);
    setPairing(r.pairingCode ?? null);
    contador.current = 0;
    setSegundos(0);
  }, [instancia]);

  useEffect(() => {
    vivo.current = true;
    gerar();
    return () => { vivo.current = false; };
  }, [gerar]);

  // Duas contagens no mesmo relógio: os segundos na tela (pra pessoa saber que
  // o QR envelhece) e, de 3 em 3, a pergunta "já pareou?".
  useEffect(() => {
    const t = setInterval(async () => {
      if (!vivo.current) return;
      contador.current += 1;
      setSegundos(contador.current);
      // O WhatsApp não avisa ninguém que o pareamento deu certo: quem escaneia
      // vê o celular dizer "OK" e fica olhando pra uma tela parada. Por isso
      // perguntamos — de 3 em 3 segundos, que é rápido pra pessoa e barato pro
      // servidor.
      if (contador.current % 3 !== 0) return;
      const r = await estadoDaLinha(instancia);
      if (vivo.current && r.ok && r.estado === "open") conectou.current();
    }, 1000);
    return () => clearInterval(t);
  }, [instancia]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={aoFechar}>
      <div
        className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-gray-900">Conectar {instancia}</h3>
        <p className="text-xs text-gray-500 mt-1 leading-snug">
          No celular <b>desse número</b>: WhatsApp → Configurações → <b>Aparelhos conectados</b> →
          Conectar um aparelho. Aponte pro código abaixo.
        </p>

        <div className="mt-4 flex items-center justify-center min-h-[240px]">
          {carregando && <span className="text-sm text-gray-400">gerando o código…</span>}
          {erro && <span className="text-sm text-red-600 text-center leading-snug">{erro}</span>}
          {qr && <img src={qr} alt="QR code" className="w-56 h-56 rounded-lg" />}
        </div>

        {pairing && (
          <p className="text-xs text-gray-600 text-center mt-2">
            Ou digite o código: <b className="tracking-widest">{pairing}</b>
          </p>
        )}

        {qr && (
          <p className="text-[11px] text-gray-400 text-center mt-2">
            {segundos < 40
              ? "Esperando você escanear… a tela se fecha sozinha quando conectar."
              : "Este código já passou da validade — gere outro."}
          </p>
        )}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={gerar}
            disabled={carregando}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60"
            style={{ background: AZUL }}
          >
            gerar outro código
          </button>
          <button
            onClick={aoFechar}
            className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LinhasDoTime() {
  const [painel, setPainel] = useState<PainelDeLinhas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [usuarios, setUsuarios] = useState<UserLite[]>([]);
  const [mapa, setMapa] = useState<MapaDeLinhas>({ porPapel: {}, porUsuario: {}, instancias: {} });
  const [salvando, setSalvando] = useState(false);
  const [qrDe, setQrDe] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const recarregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    const [{ painel: p, error }, us] = await Promise.all([carregarLinhas(), listUsersLite(true)]);
    setCarregando(false);
    if (error || !p) { setErro(error ?? "Não consegui carregar."); return; }
    setErro(null);
    setPainel(p);
    setMapa(p.mapa);
    setUsuarios(us.filter((u) => u.is_active));
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  async function salvar() {
    setSalvando(true);
    // Limpeza antes de gravar: entrada vazia sai do mapa em vez de virar 0 —
    // um zero aqui rotearia a mensagem pra uma caixa que não existe.
    const limpo: MapaDeLinhas = { porPapel: {}, porUsuario: {}, instancias: {} };
    for (const [k, v] of Object.entries(mapa.porPapel)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) limpo.porPapel[k] = n;
    }
    for (const [k, v] of Object.entries(mapa.porUsuario)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) limpo.porUsuario[k] = n;
    }
    for (const [k, v] of Object.entries(mapa.instancias)) {
      if (String(v || "").trim()) limpo.instancias[k] = String(v).trim();
    }
    const ok = await setSetting(WA_CAIXAS_KEY, limpo);
    setSalvando(false);
    if (!ok) { notifyError("Não consegui salvar (só admin/gestor grava configurações)."); return; }
    notifySuccess("Linhas salvas. Vale na próxima mensagem — leva até 1 minuto pro servidor pegar.");
    recarregar(true);
  }

  async function acao(tipo: "desconectar" | "reiniciar", instancia: string) {
    if (tipo === "desconectar" && !window.confirm(
      `Desconectar "${instancia}"?\n\nO número sai do ar na hora: ninguém envia nem recebe por ele até alguém escanear o QR de novo. ` +
      `Faça isso só para TROCAR o chip ou o aparelho dessa linha.`
    )) return;
    setOcupado(instancia);
    const r = tipo === "desconectar" ? await desconectarLinha(instancia) : await reiniciarLinha(instancia);
    setOcupado(null);
    if (!r.ok) { notifyError(r.error || "A Evolution não respondeu."); return; }
    notifySuccess(tipo === "desconectar" ? "Número desconectado." : "Número reiniciado.");
    recarregar(true);
  }

  function caixaNome(id: number | null | undefined): string {
    if (id == null) return "—";
    const c = painel?.caixas.find((x) => x.id === Number(id));
    if (!c) return `caixa ${id} (não existe mais)`;
    return c.nome + (numeroCurto(c.telefone) ? ` · ${numeroCurto(c.telefone)}` : "");
  }

  if (carregando) {
    return <div className="bg-white border border-gray-100 rounded-xl p-4 text-sm text-gray-400">carregando os números…</div>;
  }

  if (erro || !painel) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Linhas do time</h3>
        <p className="text-xs text-red-600 mt-1">{erro}</p>
      </div>
    );
  }

  const semMapa = Object.keys(mapa.porPapel).length === 0 && Object.keys(mapa.porUsuario).length === 0;
  const orfas = painel.instancias.filter((i) => i.orfa);

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Linhas do time (quem fala por qual número)</h3>
        <p className="text-xs text-gray-500 mt-1 leading-snug">
          Cada papel atende por um número da empresa, de dentro do QS. É o que tira o closer do
          celular pessoal: a conversa dele passa a entrar no histórico do lead, contar atividade e
          continuar existindo depois que ele sair.
        </p>
      </div>

      {semMapa && (
        <div className="rounded-lg px-3 py-2 text-[11.5px] leading-snug" style={{ background: "#FEF0C7", color: "#B54708" }}>
          <b>Ainda não configurado.</b> Enquanto este mapa estiver vazio, todo mundo continua enviando
          pelo número padrão do servidor — exatamente como era antes. Nada muda até você salvar.
        </div>
      )}

      {/* ── OS NÚMEROS ───────────────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Os números</h4>
        <div className="mt-2 space-y-2">
          {painel.caixas.map((c) => (
            <LinhaDaCaixa
              key={c.id}
              caixa={c}
              painel={painel}
              ocupado={ocupado === c.instancia}
              onInstancia={(nome) =>
                setMapa((m) => ({ ...m, instancias: { ...m.instancias, [String(c.id)]: nome } }))
              }
              onConectar={() => c.instancia && setQrDe(c.instancia)}
              onAcao={(t) => c.instancia && acao(t, c.instancia)}
            />
          ))}
          {!painel.caixas.length && (
            <p className="text-xs text-gray-400">
              O Chatwoot não devolveu nenhuma caixa de WhatsApp. Sem caixa não há por onde enviar.
            </p>
          )}
        </div>

        {!painel.evolucao && (
          <p className="text-[11px] text-gray-400 mt-2 leading-snug">
            A Evolution não está configurada aqui (<code>EVOLUTION_URL</code> / <code>EVOLUTION_APIKEY</code>),
            então não dá pra ver o estado dos números comuns nem gerar QR.
          </p>
        )}
        {painel.evolucao && !painel.evolucaoRespondeu && (
          <p className="text-[11px] mt-2 leading-snug" style={{ color: "#B42318" }}>
            A Evolution não respondeu agora. O que aparece acima é o mapa salvo, não o estado real.
          </p>
        )}

        {orfas.length > 0 && (
          <div className="mt-3 rounded-lg px-3 py-2 text-[11.5px] leading-snug" style={{ background: "#EAECF0", color: "#475467" }}>
            <b>Número ligado que o QS não usa:</b>{" "}
            {orfas.map((i) => `${i.nome}${i.numero ? ` (${i.numero})` : ""}`).join(", ")}.
            {" "}Enquanto nenhuma caixa apontar pra ele, mensagem que chegar nesse WhatsApp não entra no QS.
          </div>
        )}
      </div>

      {/* ── QUEM FALA POR QUAL ───────────────────────────────────────────── */}
      <div>
        <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Quem fala por qual</h4>
        <div className="mt-2 space-y-2">
          {PAPEIS.map((p) => (
            <div key={p.key} className="flex items-center gap-2">
              <div className="w-28 shrink-0">
                <div className="text-sm font-semibold text-gray-800">{p.nome}</div>
                <div className="text-[10.5px] text-gray-400 leading-tight">{p.ajuda}</div>
              </div>
              <select
                value={mapa.porPapel[p.key] ?? ""}
                onChange={(e) =>
                  setMapa((m) => {
                    const porPapel = { ...m.porPapel };
                    if (e.target.value === "") delete porPapel[p.key];
                    else porPapel[p.key] = Number(e.target.value);
                    return { ...m, porPapel };
                  })
                }
                className="flex-1 px-2 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none"
              >
                <option value="">— usa o padrão do servidor —</option>
                {painel.caixas.map((c) => (
                  <option key={c.id} value={c.id}>{caixaNome(c.id)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <ExcecoesPorPessoa
          usuarios={usuarios}
          caixas={painel.caixas}
          mapa={mapa}
          setMapa={setMapa}
          caixaNome={caixaNome}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={salvar}
          disabled={salvando}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-60"
          style={{ background: AZUL }}
        >
          {salvando ? "salvando…" : "Salvar linhas"}
        </button>
        <button
          onClick={() => recarregar()}
          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          conferir de novo
        </button>
      </div>

      <ul className="text-[11px] text-gray-400 space-y-1 list-disc pl-4 leading-snug">
        <li>
          <b>Cliente que escreveu nas últimas 24h é respondido no número em que ele escreveu</b>,
          seja de quem for a linha. Responder de outro número quem acabou de falar com a gente é o
          pior dos dois mundos: ele não vê resposta na conversa dele e recebe mensagem de um número
          estranho.
        </li>
        <li>
          A linha do papel vale quando a conversa é <b>nova</b> ou o cliente está calado faz mais de
          um dia — que é exatamente o momento em que o closer assume o lead.
        </li>
        <li>Quem quiser trocar de número numa conversa específica continua podendo, no seletor do topo do chat.</li>
      </ul>

      {qrDe && (
        <ModalQr
          instancia={qrDe}
          aoFechar={() => setQrDe(null)}
          aoConectar={() => {
            setQrDe(null);
            notifySuccess("Número conectado. Já dá pra atender por ele.");
            recarregar(true);
          }}
        />
      )}
    </div>
  );
}

function LinhaDaCaixa({ caixa, painel, ocupado, onInstancia, onConectar, onAcao }: {
  caixa: CaixaDaLinha;
  painel: PainelDeLinhas;
  ocupado: boolean;
  onInstancia: (nome: string) => void;
  onConectar: () => void;
  onAcao: (tipo: "desconectar" | "reiniciar") => void;
}) {
  const oficial = caixa.tipo === "oficial";
  const numero = numeroCurto(caixa.telefone) || caixa.numeroConectado;

  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {caixa.nome} <span className="text-gray-300 font-normal">#{caixa.id}</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {numero ? numero : "número não informado pelo Chatwoot"}
          </div>
        </div>
        <Pill status={caixa.status} />
      </div>

      {!oficial && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[11px] text-gray-500 shrink-0">WhatsApp na Evolution:</span>
          <select
            value={caixa.instancia ?? ""}
            onChange={(e) => onInstancia(e.target.value)}
            className="flex-1 min-w-[180px] px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none"
          >
            <option value="">— nenhum —</option>
            {painel.instancias.map((i) => (
              <option key={i.nome} value={i.nome}>
                {i.nome}{i.numero ? ` · ${i.numero}` : ""} ({i.status})
              </option>
            ))}
            {/* O nome salvo pode não existir mais na Evolution (instância
                renomeada ou apagada). Ele fica na lista pra pessoa VER o
                problema, em vez de o select mostrar "nenhum" silenciosamente. */}
            {caixa.instancia && !painel.instancias.some((i) => i.nome === caixa.instancia) && (
              <option value={caixa.instancia}>{caixa.instancia} (não existe mais)</option>
            )}
          </select>

          {caixa.instancia && (
            <div className="flex items-center gap-1.5">
              {caixa.status !== "open" && (
                <button
                  onClick={onConectar}
                  disabled={ocupado}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white disabled:opacity-60"
                  style={{ background: AZUL }}
                >
                  conectar (QR)
                </button>
              )}
              <button
                onClick={() => onAcao("reiniciar")}
                disabled={ocupado}
                className="px-2.5 py-1 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                reiniciar
              </button>
              {caixa.status === "open" && (
                <button
                  onClick={() => onAcao("desconectar")}
                  disabled={ocupado}
                  className="px-2.5 py-1 rounded-lg border border-gray-200 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  desconectar
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!oficial && !caixa.instancia && (
        <p className="text-[11px] mt-1.5 leading-snug" style={{ color: "#B54708" }}>
          Sem WhatsApp ligado a esta caixa, o QS envia às cegas: a checagem de "número caído" não
          tem o que conferir e a mensagem pode morrer entre o Chatwoot e o celular sem erro nenhum.
        </p>
      )}
    </div>
  );
}

function ExcecoesPorPessoa({ usuarios, caixas, mapa, setMapa, caixaNome }: {
  usuarios: UserLite[];
  caixas: CaixaDaLinha[];
  mapa: MapaDeLinhas;
  setMapa: React.Dispatch<React.SetStateAction<MapaDeLinhas>>;
  caixaNome: (id: number | null | undefined) => string;
}) {
  const [abrir, setAbrir] = useState(Object.keys(mapa.porUsuario).length > 0);

  return (
    <div className="mt-3">
      <button
        onClick={() => setAbrir((v) => !v)}
        className="text-[11.5px] font-semibold text-gray-500 hover:text-gray-700"
      >
        {abrir ? "▾" : "▸"} exceções por pessoa
        {Object.keys(mapa.porUsuario).length > 0 && ` (${Object.keys(mapa.porUsuario).length})`}
      </button>

      {abrir && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] text-gray-400 leading-snug">
            Vence o papel. Serve pro caso solto — o gestor que atende pelo número do comercial, ou
            alguém que herdou um número específico.
          </p>
          {usuarios.map((u) => (
            <div key={u.id} className="flex items-center gap-2">
              <div className="w-40 shrink-0 text-[12.5px] text-gray-700 truncate">
                {u.name} <span className="text-gray-400">· {u.role}</span>
              </div>
              <select
                value={mapa.porUsuario[u.id] ?? ""}
                onChange={(e) =>
                  setMapa((m) => {
                    const porUsuario = { ...m.porUsuario };
                    if (e.target.value === "") delete porUsuario[u.id];
                    else porUsuario[u.id] = Number(e.target.value);
                    return { ...m, porUsuario };
                  })
                }
                className="flex-1 px-2 py-1 rounded-lg border border-gray-200 text-xs text-gray-700 focus:outline-none"
              >
                <option value="">— segue o papel —</option>
                {caixas.map((c) => (
                  <option key={c.id} value={c.id}>{caixaNome(c.id)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
