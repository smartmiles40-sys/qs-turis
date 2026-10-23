// src/rel/clientes/ExpedicoesDaFicha.tsx
// -----------------------------------------------------------------------------
// CADASTRO ÚNICO (0172) na ficha: as idas da pessoa em expedições/pacotes, AO
// VIVO do Operações (passageiros.cliente_id) — reserva, financeiro, prontidão
// de embarque (mesmas regras do Operações: Apto/Atenção/Bloqueado e o que
// falta) e quarto. Embaixo, "Para a viagem": saúde, alimentação, contato de
// emergência, endereço e preferências da inscrição mais recente. Sem ida ligada
// (ou com a 0172 ainda não aplicada) mostra o retrato salvo em 13/10.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { IdaEmExpedicao } from "@/clientes/cadastroUnico";
import { detalharIdas, retratoExpedicoes, type IdaDetalhada } from "@/clientes/idasDetalhe";
import { resumoSaude } from "@/expedicoes/lib/saude";
import type { PassageiroRow } from "@/expedicoes/lib/database";
import { formatarData, formatarTelefone, moeda } from "../lib/clientes";
import { Aviso, Botao, Etiqueta } from "../ui";

export type AbrirExpedicao = (expedicaoId: string, tipo: string | null | undefined, passageiroId?: string) => void;

/** Estado das idas carregado pela ficha. ativo=false: a 0172 ainda não foi aplicada. */
export interface EstadoIdas { ativo: boolean; idas: IdaEmExpedicao[]; erro?: string | null }

const COR_PRONTIDAO = { Apto: "var(--green)", "Atenção": "#E0A100", Bloqueado: "var(--red)" } as const;

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-1.5">
      <dt className="text-[12px] sm:w-44 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[13.5px] min-w-0 break-words" style={{ color: "var(--ink)" }}>{children}</dd>
    </div>
  );
}

const periodo = (a: string | null | undefined, b: string | null | undefined) =>
  a ? `${formatarData(a)}${b ? ` – ${formatarData(b)}` : ""}` : "sem data";

function tomReserva(s: string): "rel" | "aviso" | "erro" | "neutro" {
  if (s === "Confirmado") return "rel";
  if (s === "Cancelado") return "erro";
  if (s === "Lead" || s === "Pré-reserva" || s === "Pendente") return "aviso";
  return "neutro";
}

function CartaoIda({ d, onAbrir }: { d: IdaDetalhada; onAbrir?: AbrirExpedicao }) {
  const { ida, exp, prontidao, quartos } = d;
  const e = exp ?? ida.expedicao;
  const tipo = e?.tipo ?? ida.expedicao?.tipo;
  const concluida = e?.status === "Concluída";
  const faltas = (prontidao?.checagens ?? []).filter((c) => c.semaforo === "bloqueio" || c.semaforo === "atencao");
  const saldo = Number(ida.saldo_brl ?? 0);
  return (
    <li className="rounded-xl p-3 sm:p-3.5" style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[200px]">
          <p className="text-[14px] font-bold leading-snug" style={{ color: "var(--ink)" }}>
            {e?.nome ?? "Expedição"} {e?.codigo && <span className="font-normal" style={{ color: "var(--ink3)" }}>· {e.codigo}</span>}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>
            {periodo(e?.data_embarque, e?.data_retorno)}{e?.status ? ` · ${e.status}` : ""}{ida.tipo && ida.tipo !== "Pagante" ? ` · ${ida.tipo}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tipo === "pacote" && <Etiqueta>Pacote</Etiqueta>}
          <Etiqueta tom={tomReserva(ida.status_reserva)}>{ida.status_reserva}</Etiqueta>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <Linha rotulo="Financeiro">
          {ida.valor_contratado_brl ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{moeda(ida.valor_contratado_brl)} contratado · {moeda(ida.valor_pago_brl)} pago</span>
              {saldo > 0 ? <Etiqueta tom="aviso">falta {moeda(saldo)}</Etiqueta> : <Etiqueta tom="rel">quitado</Etiqueta>}
            </span>
          ) : <span style={{ color: "var(--ink3)" }}>{ida.status_financeiro || "sem valor"}</span>}
        </Linha>
        <Linha rotulo="Quarto">
          {quartos.length === 0 ? <span style={{ color: "var(--ink3)" }}>ainda sem quarto</span> : (
            <span className="block space-y-0.5">
              {quartos.map((q, i) => (
                <span key={i} className="block">
                  {q.numero ? `Quarto ${q.numero}` : "Quarto"}{q.tipo ? ` · ${q.tipo}` : ""}
                  {q.hotel_cidade && <span style={{ color: "var(--ink3)" }}> · {q.hotel_cidade}</span>}
                  {q.check_in && <span style={{ color: "var(--ink3)" }}> ({formatarData(q.check_in).slice(0, 5)}–{formatarData(q.check_out).slice(0, 5)})</span>}
                </span>
              ))}
            </span>
          )}
        </Linha>
      </dl>

      <div className="mt-1.5">
        {concluida ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Viagem concluída.</p>
        ) : prontidao ? (
          <div>
            <p className="text-[13px] font-semibold inline-flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
              <span aria-hidden className="w-2.5 h-2.5 rounded-full" style={{ background: COR_PRONTIDAO[prontidao.prontidao] }} />
              Embarque: {prontidao.prontidao}
              {faltas.length > 0 && <span className="font-normal" style={{ color: "var(--ink3)" }}>· {faltas.length} pendência{faltas.length > 1 ? "s" : ""}</span>}
            </p>
            {faltas.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {faltas.slice(0, 6).map((c) => (
                  <li key={c.tipo} className="text-[12.5px] flex gap-1.5" style={{ color: "var(--ink2)" }}>
                    <span aria-hidden style={{ color: c.semaforo === "bloqueio" ? "var(--red)" : "#E0A100" }}>●</span>
                    <span><b>{c.tipo}</b>{c.detalhe ? `: ${c.detalhe}` : ""}{c.semaforo === "bloqueio" ? " (bloqueia o embarque)" : ""}</span>
                  </li>
                ))}
                {faltas.length > 6 && <li className="text-[12px]" style={{ color: "var(--ink3)" }}>+ {faltas.length - 6} na expedição</li>}
              </ul>
            )}
          </div>
        ) : ida.status_reserva === "Cancelado" ? null : (
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Prontidão: não deu pra calcular (sem datas ou sem acesso aos requisitos).</p>
        )}
      </div>

      {onAbrir && ida.expedicao_id && (
        <div className="mt-2 flex justify-end">
          <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrir(ida.expedicao_id, tipo, ida.id)}>
            Abrir na expedição →
          </Botao>
        </div>
      )}
    </li>
  );
}

// ── "Para a viagem": o que só a inscrição da expedição sabe ────────────────

type Item = { rotulo: string; valor: ReactNode };

/** Pega, campo a campo, o valor mais recente preenchido (idas em ordem: mais recente primeiro). */
function primeiro<T>(pax: PassageiroRow[], ler: (p: PassageiroRow) => T | null | undefined | ""): T | null {
  for (const p of pax) { const v = ler(p); if (v !== null && v !== undefined && v !== "") return v as T; }
  return null;
}

function itensAoVivo(pax: PassageiroRow[]): Item[] {
  const out: Item[] = [];
  const saude = primeiro(pax, (p) => (p.saude && Object.keys(p.saude).length ? p.saude : null));
  const itensSaude = resumoSaude(saude);
  if (saude) out.push({ rotulo: "Saúde", valor: itensSaude.length ? (
    <span className="block space-y-0.5">
      {itensSaude.map((s) => <span key={s.curto} className="block">{s.alerta ? "⚠ " : ""}<b>{s.curto}</b>{s.detalhe ? `: ${s.detalhe}` : ""}</span>)}
    </span>
  ) : "nada sinalizado no questionário" });
  const cond = primeiro(pax, (p) => p.condicoes_medicas?.trim());
  if (cond) out.push({ rotulo: "Condições médicas", valor: cond });
  const alim = primeiro(pax, (p) => p.restricoes_alimentares?.trim());
  if (alim) out.push({ rotulo: "Restrição alimentar", valor: alim });
  const emerg = primeiro(pax, (p) => (p.contato_emergencia_nome || p.contato_emergencia_fone ? p : null));
  if (emerg) out.push({ rotulo: "Contato de emergência", valor: [emerg.contato_emergencia_nome, emerg.contato_emergencia_vinculo, emerg.contato_emergencia_fone && formatarTelefone(emerg.contato_emergencia_fone)].filter(Boolean).join(" · ") });
  const end = primeiro(pax, (p) => (p.endereco_rua || p.endereco_cidade || p.endereco_cep ? p : null));
  if (end) out.push({ rotulo: "Endereço", valor: [
    [end.endereco_rua, end.endereco_numero].filter(Boolean).join(", "), end.endereco_complemento, end.endereco_bairro,
    [end.endereco_cidade, end.endereco_estado].filter(Boolean).join("/"), end.endereco_cep,
  ].filter(Boolean).join(" · ") });
  const assento = primeiro(pax, (p) => p.pref_marcar_assento);
  const upgrade = primeiro(pax, (p) => p.pref_upgrade_classe);
  if (assento !== null || upgrade) out.push({ rotulo: "Preferências de voo", valor: [
    assento === null ? null : assento ? "quer marcar assento" : "não precisa marcar assento",
    upgrade ? `upgrade: ${upgrade}` : null,
  ].filter(Boolean).join(" · ") });
  const acomp = primeiro(pax, (p) => p.acompanhante_nome?.trim());
  if (acomp) out.push({ rotulo: "Acompanhante", valor: acomp });
  const paises = primeiro(pax, (p) => p.paises_visitados?.trim());
  const jaViajou = primeiro(pax, (p) => p.ja_viajou_internacional);
  if (paises || jaViajou !== null) out.push({ rotulo: "Já viajou pra fora", valor: paises || (jaViajou ? "sim" : "não") });
  const perfil = primeiro(pax, (p) => (p.perfil_viajante && Object.keys(p.perfil_viajante).length ? p.perfil_viajante : null));
  if (perfil) {
    const partes = [perfil.profissao, perfil.instagram, perfil.camiseta && `camiseta ${perfil.camiseta}`, perfil.anima_expedicao && `curte ${perfil.anima_expedicao.toLowerCase()}`].filter(Boolean);
    if (partes.length) out.push({ rotulo: "Perfil", valor: partes.join(" · ") });
  }
  return out;
}

/** Mesmo bloco, a partir do retrato antigo (rel_clientes.dados_expedicoes, importação de 13/10). */
function itensDoRetrato(r: Record<string, unknown>): Item[] {
  const out: Item[] = [];
  const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const saude = r.saude && typeof r.saude === "object" ? resumoSaude(r.saude as PassageiroRow["saude"]) : [];
  if (r.saude) out.push({ rotulo: "Saúde", valor: saude.length ? (
    <span className="block space-y-0.5">{saude.map((s) => <span key={s.curto} className="block">{s.alerta ? "⚠ " : ""}<b>{s.curto}</b>{s.detalhe ? `: ${s.detalhe}` : ""}</span>)}</span>
  ) : "nada sinalizado no questionário" });
  for (const [k, rotulo] of [["condicoes_medicas", "Condições médicas"], ["restricoes_alimentares", "Restrição alimentar"], ["contato_emergencia", "Contato de emergência"],
    ["endereco", "Endereço"], ["acompanhante", "Acompanhante"], ["paises_visitados", "Já viajou pra fora"]] as const) {
    const v = txt(r[k]); if (v) out.push({ rotulo, valor: v });
  }
  if (r.pref_assento !== undefined || r.pref_upgrade) out.push({ rotulo: "Preferências de voo", valor: [
    r.pref_assento === true ? "quer marcar assento" : r.pref_assento === false ? "não precisa marcar assento" : null,
    txt(r.pref_upgrade) ? `upgrade: ${txt(r.pref_upgrade)}` : null,
  ].filter(Boolean).join(" · ") });
  return out;
}

export default function ExpedicoesDaFicha({ clienteId, estado, onAbrirExpedicao }: {
  clienteId: string;
  /** null = carregando. */
  estado: EstadoIdas | null;
  onAbrirExpedicao?: AbrirExpedicao;
}) {
  const [detalhes, setDetalhes] = useState<IdaDetalhada[] | null>(null);
  const [retrato, setRetrato] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    let atual = true;
    setDetalhes(null);
    if (!estado) return;
    if (!estado.idas.length) { setDetalhes([]); return; }
    detalharIdas(estado.idas)
      .then((d) => { if (atual) setDetalhes(d); })
      .catch(() => { if (atual) setDetalhes(estado.idas.map((ida) => ({ ida, pax: null, exp: null, prontidao: null, quartos: [] }))); });
    return () => { atual = false; };
  }, [estado]);

  useEffect(() => {
    let atual = true;
    retratoExpedicoes(clienteId).then((r) => { if (atual) setRetrato(r); }).catch(() => undefined);
    return () => { atual = false; };
  }, [clienteId]);

  const paxAoVivo = useMemo(() => (detalhes ?? []).map((d) => d.pax).filter((p): p is PassageiroRow => !!p), [detalhes]);
  const itens = useMemo(() => {
    const vivos = itensAoVivo(paxAoVivo);
    return vivos.length ? { de: "vivo" as const, lista: vivos } : retrato ? { de: "retrato" as const, lista: itensDoRetrato(retrato) } : null;
  }, [paxAoVivo, retrato]);

  if (!estado) return null;
  const idas = detalhes ?? [];
  const ativas = idas.filter((d) => d.ida.status_reserva !== "Cancelado");
  const canceladas = idas.filter((d) => d.ida.status_reserva === "Cancelado");

  return (
    <>
      <Secao titulo="Expedições">
        {!estado.ativo ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
            Aguardando a ativação do cadastro único: quando estiver ligado, as expedições desta pessoa aparecem aqui ao vivo (reserva, pagamento, prontidão e quarto).
          </p>
        ) : estado.erro ? (
          <Aviso tom="erro">Não consegui carregar as expedições ({estado.erro}).</Aviso>
        ) : detalhes === null ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : idas.length === 0 ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhuma expedição ou pacote ligado a esta ficha no Operações.</p>
        ) : (
          <ul className="space-y-2 pt-1">
            {ativas.map((d) => <CartaoIda key={d.ida.id} d={d} onAbrir={onAbrirExpedicao} />)}
            {canceladas.length > 0 && (
              <li>
                <details>
                  <summary className="text-[12.5px] cursor-pointer py-1" style={{ color: "var(--ink3)" }}>{canceladas.length} reserva{canceladas.length > 1 ? "s" : ""} cancelada{canceladas.length > 1 ? "s" : ""}</summary>
                  <ul className="space-y-2 pt-1">{canceladas.map((d) => <CartaoIda key={d.ida.id} d={d} onAbrir={onAbrirExpedicao} />)}</ul>
                </details>
              </li>
            )}
          </ul>
        )}
      </Secao>

      {itens && itens.lista.length > 0 && (
        <Secao titulo="Para a viagem">
          <p className="text-[12px] mb-1" style={{ color: "var(--ink3)" }}>
            {itens.de === "vivo"
              ? "Da inscrição nas expedições (a mais recente vale). Pra mudar, edite o passageiro na expedição."
              : "Retrato salvo do sistema de Expedições em 13/10 — pode estar desatualizado."}
          </p>
          <dl>{itens.lista.map((i) => <Linha key={i.rotulo} rotulo={i.rotulo}>{i.valor}</Linha>)}</dl>
        </Secao>
      )}
    </>
  );
}
