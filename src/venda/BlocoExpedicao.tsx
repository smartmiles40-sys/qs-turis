// src/venda/BlocoExpedicao.tsx
// -----------------------------------------------------------------------------
// O item EXPEDIÇÃO da venda (0214). Regras do Bruno (28/10):
//   • só dá pra vender expedição COM VAGA (vagas = pax_planejados − pagantes
//     ativos). Lotada aparece, mas trava: "peça pro Operacional abrir vaga";
//   • quem viaja: o comprador e quem vai junto, cada um com o SEU valor
//     (sem aéreo é outro valor) e quanto já pagou;
//   • quarto: tipo e com quem divide. Se a outra pessoa também está comprando
//     (aqui ou numa venda anterior), as vendas ficam ligadas e o quarto já
//     nasce montado pro Ops (passageiros.quarto_par_id).
// O valor do item é a soma dos valores de quem viaja.
//
// Bruno 09/11: o Operacional cadastra o preço da tabela COM aéreo
// (preco_venda_brl) e SEM aéreo (preco_sem_aereo_brl, 0220); o closer pode
// ajustar. A tela sugere o da tabela conforme "aéreo incluso", mostra os dois
// valores do Operacional e marca quando o valor foi ajustado. Cada acompanhante
// tem, opcional e recolhido, o que o contrato e o Ops vão precisar: vínculo com
// o comprador, CPF, nascimento e e-mail (prepara a fase "família": contrato por
// pessoa; menor de idade é assinado pelo pai/mãe).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta } from "@/rel/ui";
import { QUARTOS_EXPEDICAO } from "@/propostas/lib";
import type { ItemVenda } from "@/closer/vendaItens";
import { brl, dataBr } from "@/closer/lib";
import { lerValor, passageirosParaQuarto, viajanteNovo, type ExpedicaoVaga, type PaxParaQuarto, type Viajante } from "./api";
import { VINCULOS_VIAJANTE, menorDeIdade, mostrarValor, precoTabela, sugerirValor, trocarAereo, valorAjustado, type VinculoViajante } from "./vendaRegras";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const mesAno = (iso: string | null) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");

export default function BlocoExpedicao({ item, viajantes, expedicoes, carregandoExp, nomeComprador, onItem, onViajantes, podeAbrirVaga }: {
  item: ItemVenda;
  viajantes: Viajante[];
  expedicoes: ExpedicaoVaga[] | null;
  carregandoExp: boolean;
  nomeComprador: string;
  onItem: (p: Partial<ItemVenda>) => void;
  onViajantes: (v: Viajante[]) => void;
  /** Ops vê o atalho pra tela de vagas. */
  podeAbrirVaga?: boolean;
}) {
  const expId = item.dados.expedicao_id ?? "";
  const exp = expedicoes?.find((e) => e.id === expId) ?? null;
  const [jaNaExp, setJaNaExp] = useState<PaxParaQuarto[]>([]);

  useEffect(() => {
    if (!expId) { setJaNaExp([]); return; }
    let vivo = true;
    void passageirosParaQuarto(expId).then((l) => vivo && setJaNaExp(l));
    return () => { vivo = false; };
  }, [expId]);

  // Valor do item = soma de quem viaja.
  const soma = useMemo(() => Math.round(viajantes.reduce((s, v) => s + (lerValor(v.valor_contratado) ?? 0), 0) * 100) / 100, [viajantes]);
  useEffect(() => { if ((item.valor ?? 0) !== soma) onItem({ valor: soma }); }, [soma]); // eslint-disable-line react-hooks/exhaustive-deps

  function escolher(e: ExpedicaoVaga | null) {
    if (!e) { onItem({ dados: { ...item.dados, expedicao_id: "" } }); return; }
    onItem({
      nome: item.nome || `Expedição ${e.nome}`,
      data_inicio: e.data_embarque ?? "", data_fim: e.data_retorno ?? "",
      dados: { ...item.dados, expedicao_id: e.id, expedicao: e.nome, codigo: e.codigo, edicao: mesAno(e.data_embarque) },
    });
    // Sugere o preço de tabela (com ou sem aéreo) pra quem ainda não tem valor.
    onViajantes(viajantes.map((v) => (v.valor_contratado ? v : { ...v, valor_contratado: sugerirValor(v, e) })));
  }

  const mudar = (chave: string, p: Partial<Viajante>) => onViajantes(viajantes.map((v) => (v.chave === chave ? { ...v, ...p } : v)));
  const lotada = exp && exp.vagas <= 0;
  const faltaVaga = exp && viajantes.length > exp.vagas;

  return (
    <div className="space-y-4">
      <Campo rotulo="Qual expedição? *" dica="Só dá pra vender as que têm vaga.">
        <select className="rel-input" value={expId} disabled={carregandoExp}
          onChange={(ev) => escolher(expedicoes?.find((x) => x.id === ev.target.value) ?? null)}>
          <option value="">{carregandoExp ? "Carregando…" : "Escolha a expedição e a data…"}</option>
          {(expedicoes ?? []).map((e) => (
            <option key={e.id} value={e.id} disabled={e.vagas <= 0}>
              {e.nome} — {dataBr(e.data_embarque)} · {e.vagas > 0 ? `${e.vagas} vaga${e.vagas > 1 ? "s" : ""}` : "LOTADA"}
            </option>
          ))}
        </select>
      </Campo>
      {expedicoes && !expedicoes.some((e) => e.vagas > 0) && !carregandoExp && (
        <Aviso>Nenhuma expedição com vaga agora. Peça pro <b>Operacional abrir vaga</b> (menu Operações › Subir venda › Vagas).</Aviso>
      )}
      {exp && (
        <p className="text-[12.5px] flex flex-wrap gap-1.5 items-center" style={{ color: "var(--ink3)" }}>
          <Etiqueta tom={exp.vagas > 2 ? "rel" : "aviso"}>{exp.vagas} de {exp.pax_planejados} vagas livres</Etiqueta>
          {exp.codigo} · embarque {dataBr(exp.data_embarque)}{exp.data_retorno ? ` · volta ${dataBr(exp.data_retorno)}` : ""}
          {exp.preco_venda_brl || exp.preco_sem_aereo_brl
            ? ` · tabela do Operacional: ${exp.preco_venda_brl ? `${brl(exp.preco_venda_brl)} com aéreo` : "com aéreo não cadastrado"}${exp.preco_sem_aereo_brl ? ` / ${brl(exp.preco_sem_aereo_brl)} sem aéreo` : ""}`
            : " · o Operacional ainda não cadastrou o preço"}
        </p>
      )}
      {(lotada || faltaVaga) && (
        <Aviso tom="erro">
          {lotada ? "Esta expedição está lotada." : `Só ${exp!.vagas} vaga${exp!.vagas === 1 ? "" : "s"} e você pôs ${viajantes.length} pessoas.`}{" "}
          <b>Peça pro Operacional abrir vaga</b> antes de fechar.{podeAbrirVaga ? " (Você é do Ops: abra em Subir venda › Vagas.)" : ""}
        </Aviso>
      )}

      {/* ── Quem viaja ── */}
      <div className="space-y-3">
        {viajantes.map((v, n) => {
          const outros = viajantes.filter((x) => x.chave !== v.chave);
          const tab = precoTabela(exp, v.aereo_incluso);
          const ajustado = valorAjustado(v, exp);
          const menor = !v.comprador ? menorDeIdade(v.nascimento, exp?.data_embarque) : null;
          const faltaDoc = v.comprador ? [] : [!v.vinculo && "vínculo", !v.cpf.trim() && "CPF", !v.nascimento && "nascimento", !v.email.trim() && "e-mail"].filter((x): x is string => !!x);
          return (
            <div key={v.chave} className="rounded-xl p-3" style={{ border: "1px solid var(--line)", background: "var(--bg, transparent)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13.5px] font-bold flex-1" style={{ color: "var(--ink)" }}>
                  {v.comprador ? `${nomeComprador || "Quem comprou"} (comprador)` : `Acompanhante ${n}`}
                </span>
                {!v.comprador && <Botao variante="fantasma" onClick={() => onViajantes(viajantes.filter((x) => x.chave !== v.chave).map((x) => (x.divide === `v:${v.chave}` ? { ...x, divide: "" } : x)))}>Tirar</Botao>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!v.comprador && <>
                  <Campo rotulo="Nome completo *"><Entrada value={v.nome} onChange={(e) => mudar(v.chave, { nome: e.target.value })} /></Campo>
                  <Campo rotulo="WhatsApp" dica="Ajuda a achar a ficha dela."><Entrada inputMode="tel" value={v.telefone} onChange={(e) => mudar(v.chave, { telefone: e.target.value })} /></Campo>
                </>}
                <Campo rotulo="Valor que esta pessoa paga *"
                  dica={exp ? <>
                    Valor do Operacional: {exp.preco_venda_brl ? brl(exp.preco_venda_brl) : "—"} (com aéreo) / {exp.preco_sem_aereo_brl ? brl(exp.preco_sem_aereo_brl) : "—"} (sem aéreo).
                    {!v.aereo_incluso && !exp.preco_sem_aereo_brl && " Sem o preço sem aéreo cadastrado: digite o combinado."}
                  </> : "Preço dela (sem aéreo costuma ser outro)."}>
                  <div className="flex items-center gap-2">
                    <Entrada inputMode="decimal" placeholder="R$ 0,00" value={v.valor_contratado} onChange={(e) => mudar(v.chave, { valor_contratado: e.target.value })}
                      style={ajustado ? { borderColor: "var(--aviso, #d97706)" } : undefined} />
                    {ajustado === true && (
                      <span className="shrink-0 flex items-center gap-1">
                        <Etiqueta tom="aviso">Ajustado</Etiqueta>
                        {tab != null && (
                          <button type="button" className="text-[12px] font-semibold underline" style={{ color: "var(--rel-ink)" }}
                            title={`Voltar pro valor do Operacional (${brl(tab)})`} onClick={() => mudar(v.chave, { valor_contratado: mostrarValor(tab) })}>
                            tabela
                          </button>
                        )}
                      </span>
                    )}
                    {ajustado === false && <span className="shrink-0"><Etiqueta tom="rel">Tabela</Etiqueta></span>}
                  </div>
                </Campo>
                <Campo rotulo="Já pagou" dica="Entrada/sinal já recebido. Pode ficar 0.">
                  <Entrada inputMode="decimal" placeholder="R$ 0,00" value={v.valor_pago} onChange={(e) => mudar(v.chave, { valor_pago: e.target.value })} />
                </Campo>
                <Campo rotulo="Aéreo incluso?">
                  <div className="flex gap-2">
                    {[true, false].map((b) => (
                      <button key={String(b)} type="button" aria-pressed={v.aereo_incluso === b}
                        onClick={() => onViajantes(viajantes.map((x) => (x.chave === v.chave ? trocarAereo(x, b, exp) : x)))}
                        className="flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold"
                        style={{ border: `2px solid ${v.aereo_incluso === b ? "var(--rel)" : "var(--line)"}`, background: v.aereo_incluso === b ? "var(--rel-soft)" : "var(--card)", color: "var(--ink)" }}>
                        {b ? "Sim, com aéreo" : "Não, só terrestre"}
                      </button>
                    ))}
                  </div>
                </Campo>
                <Campo rotulo="Quarto">
                  <select className="rel-input" value={v.quarto_desejado} onChange={(e) => mudar(v.chave, { quarto_desejado: e.target.value })}>
                    {["", ...QUARTOS_EXPEDICAO].map((o) => <option key={o} value={o}>{o || "Escolha…"}</option>)}
                  </select>
                </Campo>
                <div className="sm:col-span-2">
                  <Campo rotulo="Divide o quarto com" dica="Se a outra pessoa também comprou, o quarto já nasce montado pro Operacional.">
                    <select className="rel-input" value={v.divide} onChange={(e) => mudar(v.chave, { divide: e.target.value })}>
                      <option value="">Ninguém / ainda não sabe</option>
                      {outros.length > 0 && <optgroup label="Nesta venda">
                        {outros.map((o) => <option key={o.chave} value={`v:${o.chave}`}>{o.comprador ? nomeComprador || "Comprador" : o.nome || "Acompanhante sem nome"}</option>)}
                      </optgroup>}
                      {jaNaExp.length > 0 && <optgroup label="Já comprou esta expedição">
                        {jaNaExp.map((p) => <option key={p.id} value={`p:${p.id}`} disabled={p.tem_par}>{p.nome}{p.tem_par ? " (já tem par)" : ""}</option>)}
                      </optgroup>}
                      <option value="t">Outra pessoa (só escrever o nome)</option>
                    </select>
                  </Campo>
                  {v.divide === "t" && (
                    <div className="mt-2"><Entrada placeholder="Nome de quem divide" value={v.divide_nome} onChange={(e) => mudar(v.chave, { divide_nome: e.target.value })} /></div>
                  )}
                </div>
                {!v.comprador && (
                  <details className="sm:col-span-2 rounded-lg px-3 py-2" style={{ border: "1px dashed var(--line)" }} open={!!menor}>
                    <summary className="text-[12.5px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>
                      Dados pro contrato e pro Operacional (opcional)
                      <span className="font-normal" style={{ color: "var(--ink3)" }}>
                        {" — "}{faltaDoc.length ? `falta: ${faltaDoc.join(", ")}` : "completo"}
                      </span>
                    </summary>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                      <Campo rotulo={`É o quê de ${nomeComprador || "quem comprou"}?`}>
                        <select className="rel-input" value={v.vinculo} onChange={(e) => mudar(v.chave, { vinculo: e.target.value as VinculoViajante })}>
                          <option value="">Escolha…</option>
                          {Object.entries(VINCULOS_VIAJANTE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                        </select>
                      </Campo>
                      <Campo rotulo="CPF"><Entrada inputMode="numeric" placeholder="000.000.000-00" value={v.cpf} onChange={(e) => mudar(v.chave, { cpf: e.target.value })} /></Campo>
                      <Campo rotulo="Nascimento"
                        dica={menor ? "Menor de idade no embarque: o contrato dele(a) é assinado pelo pai/mãe ou responsável." : undefined}>
                        <Entrada type="date" value={v.nascimento} onChange={(e) => mudar(v.chave, { nascimento: e.target.value })} />
                      </Campo>
                      <Campo rotulo="E-mail"><Entrada type="email" value={v.email} onChange={(e) => mudar(v.chave, { email: e.target.value })} /></Campo>
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })}
        <button type="button" className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}
          onClick={() => { const n = viajanteNovo(false); onViajantes([...viajantes, { ...n, valor_contratado: sugerirValor(n, exp) }]); }}>
          + Vai acompanhado? Adicionar quem viaja junto
        </button>
        <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>Valor da expedição nesta venda: {brl(soma)}</p>
      </div>
    </div>
  );
}
