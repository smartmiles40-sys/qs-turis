// src/rel/clientes/ficha/AbaSaude.tsx
// -----------------------------------------------------------------------------
// Aba "Saúde" (Bruno, 30/10): o declarado + os laudos + as RECEITAS, com histórico.
//   Declarado ....... perfil da ficha (0228) ou, sem ele, a inscrição mais recente
//                     (passageiros.saude — o mesmo questionário das Inscrições)
//   Laudos .......... cad_laudos_medicos (agente v2-saude) — sem a tabela: "ainda
//                     não disponível"
//   Receitas ........ 0223 por ida (passageiros.receita_pendente/enviada_em). Aqui
//                     se marca "enviada" / "não precisa" (exp_receita_definir) —
//                     a tela solta "Receitas" saiu do menu
//   Por viagem ...... o que foi declarado em cada inscrição (histórico)
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Btn, Card, StatusChip } from "@/components/ui";
import { Aviso } from "../../ui";
import { formatarData } from "../../lib/clientes";
import { resumoSaude } from "@/expedicoes/lib/saude";
import { definirReceita } from "@/expedicoes/lib/receitas";
import type { AbrirExpedicao } from "../ExpedicoesDaFicha";
import {
  linkLaudo, situacaoReceita, DIAS_RECEITA, ROTULO_STATUS_LAUDO, SELO_APTO, type laudosDoCliente,
  type IdaCompleta, type LaudoMedico, type PerfilEfetivo,
} from "./fontes";
import { dataBRSP, dataSP } from "./regras";

const quando = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }) : "");

function ListaSaude({ saude }: { saude: Parameters<typeof resumoSaude>[0] }) {
  const itens = resumoSaude(saude);
  if (!itens.length) return <p className="fc-p">Respondeu "Não" a tudo (nada a sinalizar).</p>;
  return (
    <ul className="fc-notas" aria-label="Itens de saúde sinalizados">
      {itens.map((s) => (
        <li key={s.curto}>
          {s.alerta ? <StatusChip tone="warn">{s.curto}</StatusChip> : <StatusChip tone="ok">{s.curto}</StatusChip>}
          {s.detalhe && <span className="fc-bloco__s" style={{ display: "block", marginTop: 4 }}>{s.detalhe}</span>}
        </li>
      ))}
    </ul>
  );
}

export type EstadoLaudos = Awaited<ReturnType<typeof laudosDoCliente>>;

/** A ficha carrega os laudos (laudosDoCliente) e passa — a linha do tempo usa os mesmos. */
export default function AbaSaude({ laudos, pe, idas, bloqueado, usuarios, onPreencher, onMudou, onAbrirExpedicao }: {
  laudos: EstadoLaudos | null; pe: PerfilEfetivo; idas: IdaCompleta[]; bloqueado: boolean; usuarios: Record<string, string>;
  onPreencher: () => void; onMudou: () => void; onAbrirExpedicao?: AbrirExpedicao;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  async function receita(i: IdaCompleta, m: { pendente?: boolean; enviada?: boolean }, ok: string) {
    setOcupado(i.id); setMsg(null);
    try { await definirReceita(i.id, m); setMsg({ tom: "ok", texto: ok }); onMudou(); }
    catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não salvou." }); }
    finally { setOcupado(null); }
  }

  async function abrirLaudo(l: LaudoMedico) {
    if (!l.arquivo_path) return;
    try { window.open(await linkLaudo(l.arquivo_path), "_blank", "noopener"); }
    catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não abriu o laudo." }); }
  }

  const comReceita = idas.filter((i) => situacaoReceita(i));
  const comSaude = idas.filter((i) => (i.saude && Object.keys(i.saude).length) || i.condicoes_medicas || i.restricoes_alimentares || i.saude_triagem_obs);
  const temColunaReceita = idas.some((i) => "receita_pendente" in i);
  const hoje = dataSP();
  const triagens = idas.filter((i) => i.saude_triagem_obs?.trim());

  return (
    <div className="fc-main">
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}

      <Card title="Saúde declarada (vale pra próxima viagem)"
        action={!bloqueado ? <Btn size="sm" onClick={onPreencher}>Atualizar</Btn> : undefined}>
        {pe.saude.origem === null ? (
          <p className="fc-p">Ainda não respondeu o questionário de saúde. Use "Preencher por telefone" pra perguntar agora.</p>
        ) : (
          <>
            <p className="fc-bloco__s" style={{ margin: "0 0 8px" }}>
              {pe.saude.origem === "ficha" ? "Gravado na ficha." : `Veio da inscrição de ${pe.saude.ida?.expedicao?.nome ?? "uma viagem"} — confirme com a cliente e grave na ficha.`}
            </p>
            <ListaSaude saude={pe.saude.valor} />
          </>
        )}
        {triagens.length > 0 && (
          <div className="fc-bloco">
            <span className="fc-bloco__t">Comentário da triagem de saúde</span>
            {triagens.map((i) => (
              <span key={i.id} className="fc-bloco__s" style={{ display: "block" }}>{i.expedicao?.nome ?? "Viagem"}: {i.saude_triagem_obs}</span>
            ))}
          </div>
        )}
        {pe.restricoes_alimentares && (
          <div className="fc-bloco"><span className="fc-bloco__t">Alimentação (observação)</span><span className="fc-bloco__s">{pe.restricoes_alimentares.valor}</span></div>
        )}
      </Card>

      {/* Contrato dos laudos (v2-saude): sem a tabela → bloco escondido; quem não pode ver saúde recebe lista vazia */}
      {laudos?.ativo !== false ? (
        <Card title="Laudos médicos">
          {!laudos ? <p className="fc-p">Carregando…</p>
            : laudos.lista.length === 0 ? <p className="fc-p">Nenhum laudo médico registrado (ou você não tem acesso à saúde).</p>
              : (
                <ul className="fc-pessoas" aria-label="Laudos médicos">
                  {laudos.lista.map((l) => {
                    const valido = l.status === "emitido";
                    const selo = valido && l.apto ? SELO_APTO[l.apto] : null;
                    return (
                      <li key={l.id} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <span style={{ display: "flex", flexDirection: "column", flex: "1 1 220px", minWidth: 0 }}>
                          <span className="fc-bloco__t">{l.expedicao?.nome ?? "Laudo"}{l.expedicao?.data_embarque ? ` · ${formatarData(l.expedicao.data_embarque)}` : ""}</span>
                          <span className="fc-bloco__s">
                            {[valido && l.emitido_em ? `emitido ${dataBRSP(l.emitido_em)}` : ROTULO_STATUS_LAUDO[l.status ?? ""] ?? l.status,
                              l.emitido_por_nome, l.ressalvas, l.parecer].filter(Boolean).join(" · ") || "—"}
                          </span>
                        </span>
                        {selo ? <StatusChip tone={selo.tom}>{selo.texto}</StatusChip>
                          : <StatusChip tone="neutral">{valido ? "emitido" : "em curso com o médico"}</StatusChip>}
                        {l.arquivo_path && <button type="button" className="fc-link fc-link--btn" onClick={() => void abrirLaudo(l)}>Abrir PDF</button>}
                      </li>
                    );
                  })}
                </ul>
              )}
        </Card>
      ) : (
        <p className="fc-p">Laudos médicos: ainda não disponível (a migration 0225 do médico não está no banco).</p>
      )}

      <Card title="Receitas">
        {!temColunaReceita && idas.length > 0 ? (
          <p className="fc-p">As receitas ainda não estão ligadas no banco (migration 0223).</p>
        ) : comReceita.length === 0 ? (
          <p className="fc-p">Nenhuma receita marcada. Ela é marcada na triagem de saúde da inscrição ("Preciso emitir e enviar a receita") e aparece aqui {DIAS_RECEITA} dias antes do embarque.</p>
        ) : (
          <ul className="fc-pessoas" aria-label="Receitas por viagem">
            {comReceita.map((i) => {
              const s = situacaoReceita(i)!;
              const meds = [i.saude?.medicamento_diario_qual, i.saude?.problema_saude_qual].filter(Boolean).join(" · ");
              return (
                <li key={i.id} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "flex", flexDirection: "column", flex: "1 1 220px", minWidth: 0 }}>
                    <span className="fc-bloco__t">{i.expedicao?.nome ?? "Viagem"}</span>
                    <span className="fc-bloco__s">
                      {[i.expedicao?.data_embarque ? `embarque ${formatarData(i.expedicao.data_embarque)}` : null,
                        s.limite && !i.receita_enviada_em ? `enviar até ${formatarData(s.limite)}` : null,
                        i.receita_enviada_em ? `enviada ${quando(i.receita_enviada_em)}${i.receita_enviada_por && usuarios[i.receita_enviada_por] ? ` por ${usuarios[i.receita_enviada_por].split(" ")[0]}` : ""}` : null,
                        meds || null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <StatusChip tone={s.tom}>{s.texto}</StatusChip>
                  {!bloqueado && (i.receita_enviada_em
                    ? <Btn size="sm" disabled={ocupado === i.id} onClick={() => void receita(i, { enviada: false }, "Receita voltou pra lista de envio.")}>Desfazer</Btn>
                    : <>
                      <Btn size="sm" variant="ghost" disabled={ocupado === i.id} onClick={() => void receita(i, { pendente: false }, "Receita tirada (não precisa).")}>Não precisa</Btn>
                      <Btn size="sm" variant="positive" disabled={ocupado === i.id} onClick={() => void receita(i, { enviada: true }, "Receita marcada como enviada.")}>Marcar enviada</Btn>
                    </>)}
                </li>
              );
            })}
          </ul>
        )}
        {!bloqueado && temColunaReceita && idas.some((i) => !situacaoReceita(i) && i.status_reserva !== "Cancelado" && (i.expedicao?.data_embarque ?? "") >= hoje) && (
          <div className="fc-acoes" style={{ marginTop: 10 }}>
            {idas.filter((i) => !situacaoReceita(i) && i.status_reserva !== "Cancelado" && (i.expedicao?.data_embarque ?? "") >= hoje).map((i) => (
              <Btn key={i.id} size="sm" disabled={ocupado === i.id} onClick={() => void receita(i, { pendente: true }, "Receita marcada pra emitir e enviar.")}>
                Precisa de receita em {i.expedicao?.nome ?? "viagem"}
              </Btn>
            ))}
          </div>
        )}
      </Card>

      <Card title="Histórico por viagem" action={<span className="qs-num qs-tone-subtle" style={{ fontSize: 13 }}>{comSaude.length}</span>}>
        {comSaude.length === 0 ? <p className="fc-p">Nenhuma inscrição com dados de saúde.</p> : (
          <ul className="fc-notas" aria-label="Saúde declarada em cada viagem">
            {comSaude.map((i) => (
              <li key={i.id}>
                <span className="fc-bloco__t" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {i.expedicao?.nome ?? "Viagem"}
                  <span className="fc-bloco__s">{i.expedicao?.data_embarque ? formatarData(i.expedicao.data_embarque) : ""} · {i.status_reserva}</span>
                  {onAbrirExpedicao && i.expedicao && (
                    <button type="button" className="fc-link fc-link--btn" onClick={() => onAbrirExpedicao(i.expedicao_id, i.expedicao!.tipo, i.id)}>Abrir</button>
                  )}
                </span>
                {i.saude && Object.keys(i.saude).length > 0 && <div style={{ marginTop: 6 }}><ListaSaude saude={i.saude} /></div>}
                {i.saude_triagem_obs && <span className="fc-bloco__s" style={{ display: "block" }}>Triagem de saúde: {i.saude_triagem_obs}</span>}
                {i.condicoes_medicas && <span className="fc-bloco__s" style={{ display: "block" }}>Condições médicas: {i.condicoes_medicas}</span>}
                {i.restricoes_alimentares && <span className="fc-bloco__s" style={{ display: "block" }}>Alimentação: {i.restricoes_alimentares}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
