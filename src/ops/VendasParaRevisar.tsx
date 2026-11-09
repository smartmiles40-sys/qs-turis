// src/ops/VendasParaRevisar.tsx
// -----------------------------------------------------------------------------
// OPERAÇÕES › VENDAS PARA REVISAR (0338, Bruno 09/11/2026)
//   "O operacional não tem que aprovar nenhuma venda... fica responsável por
//    sempre revisar todas as vendas mas não tem que aprovar nada."
//
// Só LEITURA do que o closer registrou (qs_vendas + qs_venda_itens + viajantes
// da expedição): cliente, closer, itens, viajantes (nome, CPF, nascimento, valor,
// aéreo incluso), total e pagamento. "Revisado" (+ observação) grava a revisão
// (venda_marcar_revisada, 0329) — não é aprovação e nada trava sem ela.
// Valor errado numa expedição: o atalho abre a aba Financeiro (Valores) da
// expedição; o valor que o Ops corrige lá volta pra venda, a ficha, a viagem e o
// Bitrix sozinho (gatilho da 0338).
// 0351: "Quem vai" — TODAS as pessoas da venda (qs_venda_pessoas): vínculo, idade
// (menor + quem assina), CPF/nascimento/passaporte (falta em vermelho), valor,
// aéreo e, por expedição, se a pessoa já está na lista de passageiros, se está
// NA FILA do espelho do sistema antigo (exp_venda_pax_pendentes) ou FALTANDO.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Entrada, Etiqueta, Vazio } from "@/rel/ui";
import { TIPOS, type TipoItem } from "@/propostas/lib";
import { FORMAS_PAGAMENTO, brl, dataBr, dataHoraBr, type FormaPagamento } from "@/closer/lib";

interface Viajante {
  passageiro_id: string | null; nome: string | null; cpf: string | null; nascimento: string | null;
  valor: number | null; pago: number | null; aereo_incluso: boolean | null; status: string | null; pendente: boolean;
}
interface ItemRevisao {
  id: string; tipo: string; nome: string; data_inicio: string | null; data_fim: string | null;
  valor: number | null; custo: number | null; status: string; fornecedor: string | null;
  expedicao_id: string | null; expedicao_tipo: string | null; expedicao_nome: string | null;
  viajantes: Viajante[];
}
/** 0351: cada pessoa da venda (titular + família) e onde ela está em cada expedição. */
interface PessoaRevisao {
  id: string; cliente_id: string; comprador: boolean; vinculo: string | null;
  nome: string | null; cpf: string | null; nascimento: string | null; telefone: string | null; email: string | null;
  passaporte: string | null; passaporte_validade: string | null; idade: number | null; menor: boolean | null; responsavel_nome: string | null;
  valor: number | null; aereo_incluso: boolean | null; removida_em: string | null;
  bitrix_deal_id: string | null; bitrix_status: string; contrato_status: string | null; falta: string[];
  expedicoes: { item_id: string; expedicao_id: string | null; expedicao_nome: string | null; passageiro_id: string | null; status_reserva: string | null; na_fila: boolean; situacao: "na_expedicao" | "na_fila" | "falta" }[];
}
interface VendaRevisao {
  id: string; origem: string; criado_em: string; atualizado_em: string; negocio_id: string | null;
  valor_total: number | null;
  pagamento: { forma?: string; condicao?: string; entrada?: number | null; entrada_data?: string | null; parcelas?: number | null; primeira_parcela?: string | null; obs?: string | null } | null;
  condicao_especial: boolean; condicao_obs: string | null; observacoes: string | null;
  revisado_em: string | null; revisao_obs: string | null; revisado_por_nome: string | null;
  closer_nome: string | null; etapa: string | null; consolidada_em: string | null;
  cliente: { id: string | null; nome: string | null; cpf: string | null; nascimento: string | null; telefone: string | null; email: string | null };
  itens: ItemRevisao[];
  /** 0351 (sem a 0351 no banco: undefined). */
  pessoas?: PessoaRevisao[];
  espelho_ligado?: boolean;
}

const CONDICAO: Record<string, string> = { avista: "À vista", parcelado: "Parcelado", entrada: "Entrada + parcelas" };

function erroDaRevisao(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e ?? "");
  if (/ops_vendas_para_revisar/.test(m)) return "A lista ainda não está ligada no banco (falta aplicar a 0338).";
  if (/venda_marcar_revisada/.test(m)) return "A revisão ainda não está ligada no banco (falta aplicar a 0329).";
  if (/sem-permissao/.test(m)) return "Só o Operacional (ou a gestão) revisa vendas.";
  if (/venda-nao-encontrada/.test(m)) return "Essa venda não existe mais. Atualize a lista.";
  return m || "Não deu certo. Tente de novo.";
}

export default function VendasParaRevisar({ onAbrirExpedicao, onMudou }: {
  /** Abre a expedição na aba Financeiro (Valores). */
  onAbrirExpedicao: (expedicaoId: string, tipo: string | null) => void;
  onMudou?: () => void;
}) {
  const [todas, setTodas] = useState(false);
  const [lista, setLista] = useState<VendaRevisao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("ops_vendas_para_revisar", { p_todas: todas });
    if (error) { setErro(erroDaRevisao(error)); setLista([]); return; }
    setErro(null);
    setLista((data ?? []) as VendaRevisao[]);
  }, [todas]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function marcar(v: VendaRevisao, obs: string, desfazer: boolean) {
    const { error } = await supabase.rpc("venda_marcar_revisada", { p_venda: v.id, p_obs: obs.trim() || null, p_desfazer: desfazer });
    if (error) throw new Error(erroDaRevisao(error));
    setAviso(desfazer ? "Revisão desfeita." : `Venda de ${v.cliente?.nome ?? "cliente"} marcada como revisada.`);
    await carregar();
    onMudou?.();
  }

  const pendentes = (lista ?? []).filter((v) => !v.revisado_em).length;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Vendas para revisar</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            O que os closers registraram, do jeito que ficou gravado. Revisar <b>não é aprovar</b>: nada trava sem a revisão.
            Achou valor errado numa expedição? Corrija na aba Valores — a venda, a ficha e o Bitrix acompanham.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Mostrar as revisadas (30 dias)
        </label>
      </div>
      {aviso && <Aviso tom="ok">{aviso}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 && !erro ? (
        <Vazio titulo="Nenhuma venda esperando revisão" texto="Quando um closer registrar uma venda, ela aparece aqui." />
      ) : (
        <>
          {lista.length > 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{pendentes} sem revisão{todas ? ` · ${lista.length - pendentes} revisada(s)` : ""}.</p>}
          {lista.map((v) => <CartaoVenda key={v.id} v={v} onMarcar={marcar} onAbrirExpedicao={onAbrirExpedicao} />)}
        </>
      )}
    </div>
  );
}

function CartaoVenda({ v, onMarcar, onAbrirExpedicao }: {
  v: VendaRevisao;
  onMarcar: (v: VendaRevisao, obs: string, desfazer: boolean) => Promise<void>;
  onAbrirExpedicao: (expedicaoId: string, tipo: string | null) => void;
}) {
  const [revisando, setRevisando] = useState(false);
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pg = v.pagamento ?? {};
  const somaItens = v.itens.filter((i) => i.status !== "cancelado").reduce((s, i) => s + (Number(i.valor) || 0), 0);

  async function rodar(desfazer: boolean) {
    setOcupado(true); setErro(null);
    try { await onMarcar(v, obs, desfazer); setRevisando(false); setObs(""); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  return (
    <section className="rel-card p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{v.cliente?.nome || "Cliente sem nome"}</p>
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
            {v.cliente?.cpf ? `CPF ${v.cliente.cpf}` : "sem CPF"} · {v.cliente?.nascimento ? `nasc. ${dataBr(v.cliente.nascimento)}` : "sem nascimento"}
            {v.cliente?.telefone ? ` · ${v.cliente.telefone}` : ""}
          </p>
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
            Closer: <b>{v.closer_nome ?? "—"}</b> · registrada em {dataHoraBr(v.criado_em)}
            {v.atualizado_em && v.atualizado_em !== v.criado_em ? ` · mudou em ${dataHoraBr(v.atualizado_em)}` : ""}
            {v.consolidada_em ? " · fechada" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[18px] font-bold" style={{ color: "var(--rel-ink)" }}>{brl(v.valor_total)}</p>
          {Math.abs(somaItens - Number(v.valor_total || 0)) > 0.009 && (
            <p className="text-[11.5px]" style={{ color: "var(--err-ink)" }}>itens somam {brl(somaItens)}</p>
          )}
          {v.revisado_em
            ? <Etiqueta tom="rel">Revisada {dataBr(v.revisado_em)}{v.revisado_por_nome ? ` · ${v.revisado_por_nome}` : ""}</Etiqueta>
            : <Etiqueta tom="aviso">Sem revisão</Etiqueta>}
        </div>
      </div>

      {v.pessoas && v.pessoas.length > 0 && <QuemVai pessoas={v.pessoas} espelho={!!v.espelho_ligado} />}

      <div className="space-y-2">
        {v.itens.map((i) => (
          <div key={i.id} className="rounded-lg p-3" style={{ background: "var(--card2)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-0 text-[13.5px] font-semibold" style={{ color: "var(--ink)", textDecoration: i.status === "cancelado" ? "line-through" : undefined }}>
                {TIPOS[i.tipo as TipoItem]?.emoji ?? "•"} {i.nome}
                {i.expedicao_nome && i.expedicao_nome !== i.nome ? <span style={{ color: "var(--ink3)" }}> · {i.expedicao_nome}</span> : null}
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
                {i.data_inicio ? `${dataBr(i.data_inicio)}${i.data_fim ? ` → ${dataBr(i.data_fim)}` : ""}` : "sem data"}
              </span>
              <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{brl(i.valor)}</span>
              {i.status !== "vendido" && <Etiqueta tom={i.status === "cancelado" ? "erro" : "neutro"}>{i.status}</Etiqueta>}
            </div>
            {i.custo != null && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Custo {brl(i.custo)}{i.fornecedor ? ` · ${i.fornecedor}` : ""}</p>}
            {i.viajantes.length > 0 && (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-[12.5px]" style={{ color: "var(--ink)" }}>
                  <thead>
                    <tr style={{ color: "var(--ink3)" }}>
                      <th className="text-left font-semibold pr-2">Viajante</th>
                      <th className="text-left font-semibold pr-2">CPF</th>
                      <th className="text-left font-semibold pr-2">Nascimento</th>
                      {i.tipo === "expedicao" && <>
                        <th className="text-right font-semibold pr-2">Valor</th>
                        <th className="text-left font-semibold pr-2">Aéreo</th>
                        <th className="text-left font-semibold">Situação</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {i.viajantes.map((p, k) => (
                      <tr key={p.passageiro_id ?? k} className="border-t" style={{ borderColor: "var(--line)" }}>
                        <td className="pr-2 py-1">{p.nome || "—"}</td>
                        <td className="pr-2 py-1" style={{ color: p.cpf ? undefined : "var(--err-ink)" }}>{p.cpf || "falta"}</td>
                        <td className="pr-2 py-1" style={{ color: p.nascimento ? undefined : "var(--err-ink)" }}>{p.nascimento ? dataBr(p.nascimento) : "falta"}</td>
                        {i.tipo === "expedicao" && <>
                          <td className="pr-2 py-1 text-right">{p.valor != null ? brl(p.valor) : "—"}</td>
                          <td className="pr-2 py-1">{p.aereo_incluso == null ? "—" : p.aereo_incluso ? "incluso" : "sem aéreo"}</td>
                          <td className="py-1" style={{ color: "var(--ink3)" }}>{p.status ?? "—"}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {i.tipo === "expedicao" && i.expedicao_id && (
              <button type="button" className="text-[12px] underline mt-1" style={{ color: "var(--rel-ink)" }}
                onClick={() => onAbrirExpedicao(i.expedicao_id!, i.expedicao_tipo)}>
                Corrigir valor na aba Valores da expedição
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="text-[13px] space-y-0.5" style={{ color: "var(--ink2)" }}>
        <p>
          <b>Pagamento:</b> {CONDICAO[String(pg.condicao)] ?? "—"}
          {pg.forma ? ` · ${FORMAS_PAGAMENTO[pg.forma as FormaPagamento] ?? pg.forma}` : ""}
          {pg.condicao === "entrada" && pg.entrada ? ` · entrada ${brl(Number(pg.entrada))}${pg.entrada_data ? ` em ${dataBr(pg.entrada_data)}` : ""}` : ""}
          {pg.condicao !== "avista" && pg.parcelas ? ` · ${pg.parcelas}x` : ""}
          {pg.primeira_parcela ? ` · 1ª em ${dataBr(pg.primeira_parcela)}` : ""}
        </p>
        {pg.obs && <p>Peculiaridades: {pg.obs}</p>}
        {v.condicao_especial && <p><b>Condição especial:</b> {v.condicao_obs || "—"}</p>}
        {v.observacoes && <p>Observações: {v.observacoes}</p>}
        {v.revisao_obs && <p>Obs. da revisão: {v.revisao_obs}</p>}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex flex-wrap items-end gap-2">
        {!v.revisado_em && !revisando && <Botao variante="primario" onClick={() => setRevisando(true)}>Revisado</Botao>}
        {!v.revisado_em && revisando && (
          <>
            <div className="flex-1 min-w-[220px]">
              <Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (opcional): ex. CPF do 2º viajante conferido com o passaporte" autoFocus />
            </div>
            <Botao variante="fantasma" disabled={ocupado} onClick={() => setRevisando(false)}>Voltar</Botao>
            <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(false)}>{ocupado ? "Gravando…" : "Confirmar revisão"}</Botao>
          </>
        )}
        {v.revisado_em && <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(true)}>Desfazer revisão</Botao>}
      </div>
    </section>
  );
}

const VINCULO: Record<string, string> = { conjuge: "Cônjuge", filho: "Filho(a)", pai_mae: "Pai / Mãe", irmao: "Irmão(ã)", amigo: "Amigo(a)", outro: "Outro" };
const SITUACAO: Record<string, { t: string; tom: "rel" | "aviso" | "erro" }> = {
  na_expedicao: { t: "na expedição", tom: "rel" },
  na_fila: { t: "na fila do espelho", tom: "aviso" },
  falta: { t: "FALTA na expedição", tom: "erro" },
};

/** 0351: todas as pessoas da venda — o Ops confere uma por uma. */
function QuemVai({ pessoas, espelho }: { pessoas: PessoaRevisao[]; espelho: boolean }) {
  const ativas = pessoas.filter((p) => !p.removida_em);
  const saiu = pessoas.filter((p) => p.removida_em);
  const naFila = ativas.some((p) => p.expedicoes.some((e) => e.situacao === "na_fila" || e.na_fila));
  const faltando = ativas.some((p) => p.expedicoes.some((e) => e.situacao === "falta"));
  const vermelho = { color: "var(--err-ink)", fontWeight: 600 } as const;
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--card2)" }}>
      <p className="text-[13.5px] font-semibold mb-1" style={{ color: "var(--ink)" }}>
        👨‍👩‍👧 Quem vai — {ativas.length} pessoa{ativas.length === 1 ? "" : "s"}
      </p>
      {espelho && naFila && (
        <p className="text-[12px] mb-2" style={{ color: "var(--ink2)" }}>
          O espelho do sistema antigo está <b>ligado</b>: quem está "na fila do espelho" ainda NÃO entrou na lista de passageiros da
          expedição — entra quando o espelho for desligado (Aplicar fila). Confira os dados aqui.
        </p>
      )}
      {faltando && (
        <p className="text-[12px] mb-2" style={vermelho}>Tem gente da venda que não está na expedição nem na fila. Avise o closer ou inclua na expedição.</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]" style={{ color: "var(--ink)" }}>
          <thead>
            <tr style={{ color: "var(--ink3)" }}>
              <th className="text-left font-semibold pr-2">Pessoa</th>
              <th className="text-left font-semibold pr-2">Vínculo / idade</th>
              <th className="text-left font-semibold pr-2">CPF</th>
              <th className="text-left font-semibold pr-2">Nascimento</th>
              <th className="text-left font-semibold pr-2">Passaporte</th>
              <th className="text-right font-semibold pr-2">Valor</th>
              <th className="text-left font-semibold pr-2">Aéreo</th>
              <th className="text-left font-semibold">Expedição</th>
            </tr>
          </thead>
          <tbody>
            {ativas.map((p) => (
              <tr key={p.id} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                <td className="pr-2 py-1">
                  <b>{p.nome || "—"}</b>
                  {p.comprador && <span style={{ color: "var(--ink3)" }}> (titular)</span>}
                  {p.telefone || p.email ? <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{[p.telefone, p.email].filter(Boolean).join(" · ")}</span> : null}
                </td>
                <td className="pr-2 py-1">
                  {p.comprador ? "Titular" : p.vinculo ? VINCULO[p.vinculo] ?? p.vinculo : <span style={vermelho}>falta</span>}
                  {p.idade != null ? ` · ${p.idade} anos` : ""}
                  {p.menor && <span className="block"><Etiqueta tom="aviso">Menor — assina: {p.responsavel_nome ?? "titular"}</Etiqueta></span>}
                </td>
                <td className="pr-2 py-1" style={p.cpf ? undefined : vermelho}>{p.cpf || "falta"}</td>
                <td className="pr-2 py-1" style={p.nascimento ? undefined : vermelho}>{p.nascimento ? dataBr(p.nascimento) : "falta"}</td>
                <td className="pr-2 py-1" style={{ color: p.passaporte ? undefined : "var(--ink3)" }}>
                  {p.passaporte || "—"}{p.passaporte_validade ? ` (até ${dataBr(p.passaporte_validade)})` : ""}
                </td>
                <td className="pr-2 py-1 text-right">{p.valor != null ? brl(p.valor) : <span style={{ color: "var(--ink3)" }}>{p.comprador ? "o resto" : "no titular"}</span>}</td>
                <td className="pr-2 py-1">{p.aereo_incluso == null ? "—" : p.aereo_incluso ? "incluso" : "sem aéreo"}</td>
                <td className="py-1">
                  {p.expedicoes.length === 0 ? <span style={{ color: "var(--ink3)" }}>—</span> : p.expedicoes.map((e) => (
                    <span key={e.item_id} className="block">
                      <Etiqueta tom={SITUACAO[e.situacao]?.tom ?? "aviso"}>{SITUACAO[e.situacao]?.t ?? e.situacao}</Etiqueta>
                      {e.situacao === "na_expedicao" && e.na_fila ? <span style={{ color: "var(--ink3)" }}> · mudança na fila</span> : null}
                      {e.status_reserva ? <span style={{ color: "var(--ink3)" }}> · {e.status_reserva}</span> : null}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {saiu.length > 0 && (
        <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
          Saíram da venda: {saiu.map((p) => `${p.nome ?? "—"} (${dataBr(p.removida_em)})`).join(", ")}.
        </p>
      )}
    </div>
  );
}
