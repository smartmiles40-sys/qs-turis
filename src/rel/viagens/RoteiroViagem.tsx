// src/rel/viagens/RoteiroViagem.tsx
// -----------------------------------------------------------------------------
// ROTEIRO da viagem (15/10/2026) — substitui a lista simples de trechos.
//
// Bruno: "todos os voos: voo principal, voo interno, trens, transfers" e
// "enquanto o passageiro está em viagem temos que ter tudo de fácil acesso,
// até se ele for pegar um transfer, saber que horas". Por isso:
//   • os trechos vêm separados por tipo, cada um com tudo que estava no
//     bilhete/voucher (terminal, assento, e-ticket, ponto de encontro, contato);
//   • a hora é a LOCAL do lugar quando o fuso é conhecido (a do bilhete);
//   • em cima, "Agora e próximo": o que o passageiro faz nas próximas 48h.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { TIPOS_TRECHO, apagarTrecho, horaDoLugar, listarTrechos, marcarCheckin, type TipoTrecho, type Trecho } from "../lib/viagens";
import { Aviso, Botao, Etiqueta } from "../ui";
import { EditarTrecho } from "./TrechosViagem";

const GRUPOS: { id: string; titulo: string; tipos: TipoTrecho[]; cor: string }[] = [
  { id: "principal", titulo: "Voo principal", tipos: ["voo_internacional"], cor: "#2563EB" },
  { id: "interno", titulo: "Voos internos", tipos: ["voo_interno"], cor: "#0E7C6A" },
  { id: "trem", titulo: "Trens", tipos: ["trem"], cor: "#7C3AED" },
  { id: "transfer", titulo: "Transfers", tipos: ["transfer"], cor: "#B45309" },
  { id: "hotel", titulo: "Hospedagem", tipos: ["hospedagem"], cor: "#BE185D" },
  { id: "passeio", titulo: "Passeios e outros", tipos: ["passeio", "outro"], cor: "#0369A1" },
];
const COR_DO_TIPO = Object.fromEntries(GRUPOS.flatMap((g) => g.tipos.map((t) => [t, g.cor]))) as Record<TipoTrecho, string>;

const ICONE: Record<TipoTrecho, ReactNode> = {
  voo_internacional: <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  voo_interno: <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />,
  trem: <><rect x="4" y="3" width="16" height="14" rx="3" /><path d="M4 11h16M8 21l2-4M16 21l-2-4" /></>,
  transfer: <><rect x="1" y="6" width="22" height="11" rx="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
  hospedagem: <><path d="M2 20V8M22 20v-6a3 3 0 0 0-3-3H10v6M2 17h20" /><circle cx="6.5" cy="11.5" r="2" /></>,
  passeio: <><circle cx="12" cy="10" r="3" /><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z" /></>,
  outro: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></>,
};

export function Icone({ tipo, tamanho = 34 }: { tipo: TipoTrecho; tamanho?: number }) {
  const cor = COR_DO_TIPO[tipo];
  return (
    <span className="rounded-full flex items-center justify-center flex-shrink-0" style={{ width: tamanho, height: tamanho, background: `${cor}1A`, color: cor }} aria-hidden="true">
      <svg width={tamanho * 0.5} height={tamanho * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONE[tipo]}</svg>
    </span>
  );
}

const soDigitos = (s: string) => s.replace(/[^\d+]/g, "");
/** Trecho do Pós-Venda do Bitrix (0134b) só tem o DIA — a hora (00:00) é de mentira. */
const soDia = (t: Trecho) => t.fonte === "bitrix";

function hora(t: Trecho, qual: "partida" | "chegada") {
  const iso = qual === "partida" ? t.partida_em : t.chegada_em;
  if (!iso) return null;
  if (soDia(t)) return { texto: new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" }), local: false };
  return horaDoLugar(iso, qual === "partida" ? t.partida_fuso : (t.chegada_fuso || t.partida_fuso), true);
}

export function titulo(t: Trecho): string {
  const de = t.origem_codigo || t.origem;
  const para = t.destino_codigo || t.destino;
  if (t.tipo === "hospedagem") return t.descricao || t.destino || t.origem || "Hotel";
  if ((t.tipo === "transfer" || t.tipo === "passeio") && !de && !para) return t.descricao || TIPOS_TRECHO[t.tipo];
  return [de, para].filter(Boolean).join(" → ") || t.descricao || TIPOS_TRECHO[t.tipo];
}

/** Um dado do trecho: rótulo pequeno em cima, valor embaixo. */
function Dado({ r, children, mono }: { r: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{r}</dt>
      <dd className={`text-[13px] break-words ${mono ? "font-mono tracking-wide" : ""}`} style={{ color: "var(--ink)" }}>{children}</dd>
    </div>
  );
}

function CartaoTrecho({ t, ativa, onEditar, onMudou }: { t: Trecho; ativa: boolean; onEditar: () => void; onMudou: () => void }) {
  const { currentUser } = useQsAuth();
  const [erro, setErro] = useState<string | null>(null);
  const p = hora(t, "partida"), c = hora(t, "chegada");
  const agora = Date.now();
  const partiu = new Date(t.partida_em).getTime() < agora;
  const abre = t.checkin_em ? new Date(t.checkin_em).getTime() : null;
  const checkinAberto = abre !== null && abre <= agora && !partiu;
  const ehBusca = t.tipo === "transfer" || t.tipo === "passeio";
  const ehHotel = t.tipo === "hospedagem";
  const tel = t.contato ? soDigitos(t.contato) : "";

  async function acao(fn: () => Promise<unknown>) {
    setErro(null);
    try { await fn(); onMudou(); } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
  }

  return (
    <li className="rounded-xl p-3" style={{ border: "1px solid var(--line)", background: partiu && !ehHotel ? "var(--card2)" : "var(--card)", opacity: partiu && !ehHotel ? 0.8 : 1 }}>
      <div className="flex items-start gap-3">
        <Icone tipo={t.tipo} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{titulo(t)}</span>
            {(t.companhia || t.numero) && <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>{[t.companhia, t.numero].filter(Boolean).join(" ")}</span>}
            {t.fonte === "ia" && <Etiqueta tom="rel">lido pela IA</Etiqueta>}
            {t.fonte === "expedicoes" && <Etiqueta>do sistema de Expedições</Etiqueta>}
            {t.fonte === "bitrix" && <Etiqueta tom="aviso">do Pós-Venda · horário a confirmar</Etiqueta>}
          </div>
          {/* A hora é o principal: grande, e dizendo se é a local do lugar */}
          <p className="mt-0.5 text-[14px] tabular-nums" style={{ color: "var(--ink)" }}>
            <b>{ehBusca ? "Busca " : ehHotel ? "Check-in " : ""}{p?.texto}</b>
            {c && <> <span style={{ color: "var(--ink3)" }}>→</span> {ehHotel ? "check-out " : ""}<b>{c.texto}</b></>}
            {p && !soDia(t) && <span className="ml-1.5 text-[11px] font-normal" style={{ color: "var(--ink3)" }}>{p.local ? "hora local" : "horário de Brasília"}</span>}
          </p>
        </div>
        {ativa && (
          <div className="flex gap-1 flex-shrink-0">
            <Botao variante="fantasma" onClick={onEditar} aria-label={`Editar ${TIPOS_TRECHO[t.tipo]} ${titulo(t)}`}>Editar</Botao>
            <Botao variante="fantasma" title="Apagar trecho" aria-label={`Apagar ${TIPOS_TRECHO[t.tipo]} ${titulo(t)}`}
              onClick={() => { if (window.confirm("Apagar este trecho?")) void acao(() => apagarTrecho(t.id)); }}>×</Botao>
          </div>
        )}
      </div>

      <dl className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 pl-[46px]">
        {t.localizador && <Dado r="Localizador" mono>{t.localizador}</Dado>}
        {t.numero_bilhete && <Dado r="E-ticket" mono>{t.numero_bilhete}</Dado>}
        {(t.terminal_partida || t.terminal_chegada) && <Dado r="Terminal">{[t.terminal_partida && `embarque ${t.terminal_partida}`, t.terminal_chegada && `chegada ${t.terminal_chegada}`].filter(Boolean).join(" · ")}</Dado>}
        {t.assento && <Dado r="Assento">{t.assento}</Dado>}
        {t.classe && <Dado r="Classe">{t.classe}</Dado>}
        {t.bagagem && <Dado r="Bagagem">{t.bagagem}</Dado>}
        {t.ponto_encontro && <Dado r="Ponto de encontro">{t.ponto_encontro}</Dado>}
        {t.endereco && (
          <Dado r="Endereço">
            <a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.endereco)}`} target="_blank" rel="noreferrer">{t.endereco}</a>
          </Dado>
        )}
        {t.contato && (
          <Dado r="Contato">
            {tel.replace(/\D/g, "").length >= 8
              ? <><a className="underline" href={`tel:${tel}`}>{t.contato}</a> · <a className="underline" style={{ color: "var(--rel-ink)" }} href={`https://wa.me/${tel.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a></>
              : t.contato}
          </Dado>
        )}
        {(t.passageiros?.length ?? 0) > 0 && <Dado r="Passageiros">{t.passageiros!.join(", ")}</Dado>}
        {!ehHotel && t.descricao && titulo(t) !== t.descricao && <Dado r="Detalhe">{t.descricao}</Dado>}
      </dl>
      {t.observacoes && <p className="mt-2 pl-[46px] text-[12.5px] whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{t.observacoes}</p>}

      {t.checkin_em && !partiu && (
        <div className="mt-2 pl-[46px] flex flex-wrap items-center gap-2">
          {t.checkin_feito_em ? <Etiqueta tom="rel">check-in feito</Etiqueta>
            : checkinAberto ? <Etiqueta tom="aviso">check-in aberto agora</Etiqueta>
            : <Etiqueta>check-in abre {horaDoLugar(t.checkin_em, null).texto}</Etiqueta>}
          {ativa && (
            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" className="w-4 h-4" style={{ accentColor: "var(--rel)" }} checked={!!t.checkin_feito_em}
                onChange={(e) => void acao(() => marcarCheckin(t.id, e.target.checked, currentUser?.id ?? ""))} />
              check-in feito
            </label>
          )}
        </div>
      )}
      {erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}
    </li>
  );
}

/** O que o passageiro faz agora e nas próximas 48h — o "manual de bolso" de quem está viajando. */
function AgoraEProximo({ trechos }: { trechos: Trecho[] }) {
  const agora = Date.now();
  const itens = trechos
    .filter((t) => {
      const ini = new Date(t.partida_em).getTime();
      const fim = t.chegada_em ? new Date(t.chegada_em).getTime() : ini + 2 * 3600_000;
      // hotel: vale enquanto o passageiro está hospedado
      if (t.tipo === "hospedagem") return ini <= agora + 48 * 3600_000 && fim >= agora;
      return fim >= agora - 30 * 60_000 && ini <= agora + 48 * 3600_000;
    })
    .slice(0, 6);
  if (!itens.length) return null;
  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: "var(--rel-soft)", border: "1px solid var(--rel)" }}>
      <p className="text-[12px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--rel-ink)" }}>Agora e nas próximas 48h</p>
      <ol className="space-y-2">
        {itens.map((t) => {
          const p = hora(t, "partida");
          const ehBusca = t.tipo === "transfer" || t.tipo === "passeio";
          const ehHotel = t.tipo === "hospedagem";
          const emCurso = new Date(t.partida_em).getTime() <= agora;
          return (
            <li key={t.id} className="flex items-start gap-2.5">
              <Icone tipo={t.tipo} tamanho={28} />
              <div className="min-w-0 text-[13px]" style={{ color: "var(--ink)" }}>
                <b className="tabular-nums">{ehHotel && emCurso ? "Hospedado" : `${ehBusca ? "Busca às " : ""}${p?.texto ?? ""}`}</b>
                {" · "}{TIPOS_TRECHO[t.tipo]} {titulo(t)}{t.numero ? ` (${[t.companhia, t.numero].filter(Boolean).join(" ")})` : ""}
                <span className="block text-[12px]" style={{ color: "var(--ink2)" }}>
                  {[t.ponto_encontro && `encontro: ${t.ponto_encontro}`, t.terminal_partida && `terminal ${t.terminal_partida}`, t.localizador && `loc. ${t.localizador}`, t.contato && `contato ${t.contato}`, ehHotel && t.endereco]
                    .filter(Boolean).join(" · ")}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function RoteiroViagem({ viagemId, ativa, versao = 0, onMudou }: { viagemId: string; ativa: boolean; versao?: number; onMudou?: () => void }) {
  const [lista, setLista] = useState<Trecho[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Trecho | null | undefined>(undefined); // undefined = fechado; null = novo

  const carregar = useCallback(() => {
    listarTrechos(viagemId).then((l) => { setLista(l); setErro(null); }).catch((e) => { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); });
  }, [viagemId]);
  useEffect(() => { carregar(); }, [carregar, versao]);

  return (
    <div>
      {lista && <AgoraEProximo trechos={lista} />}
      {lista === null ? (
        <div className="h-24 rounded-xl animate-pulse" style={{ background: "var(--card2)" }} />
      ) : lista.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Nenhum trecho ainda. Anexe os bilhetes e vouchers e clique em "Revisar com IA" — ela preenche os voos, trens, transfers e hotéis. Ou cadastre à mão.
        </p>
      ) : (
        <div className="space-y-4">
          {GRUPOS.map((g) => {
            const doGrupo = lista.filter((t) => g.tipos.includes(t.tipo));
            if (!doGrupo.length) return null;
            return (
              <section key={g.id} aria-label={g.titulo}>
                <h3 className="text-[12px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-2" style={{ color: g.cor }}>
                  {g.titulo}<span className="font-semibold" style={{ color: "var(--ink3)" }}>{doGrupo.length}</span>
                </h3>
                <ul className="space-y-2">
                  {doGrupo.map((t) => <CartaoTrecho key={t.id} t={t} ativa={ativa} onEditar={() => setEditando(t)} onMudou={() => { carregar(); onMudou?.(); }} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {ativa && <div className="mt-3"><Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setEditando(null)}>+ Trecho</Botao></div>}
      {erro && <div className="mt-2"><Aviso tom="erro">{erro}</Aviso></div>}
      <EditarTrecho aberto={editando !== undefined} viagemId={viagemId} trecho={editando ?? null}
        onFechar={() => setEditando(undefined)} onSalvo={() => { setEditando(undefined); carregar(); onMudou?.(); }} />
    </div>
  );
}
