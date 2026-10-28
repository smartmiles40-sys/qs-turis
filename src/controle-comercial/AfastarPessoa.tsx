// src/controle-comercial/AfastarPessoa.tsx
// -----------------------------------------------------------------------------
// "AFASTAR / DESATIVAR" da Mesa (Bruno, 28/10/2026).
//
//   • Ausência com data: tira a pessoa do rodízio de leads NOVOS até a data
//     (ausente_ate, mesmo campo que o gatilho da 0099 já respeita). Pode, se
//     quiser, também passar o que está aberto.
//   • Desativar: is_active=false e TUDO o que está aberto sai dela —
//     leads + atividades (+ reservas da carteira) vão "divididos no rodízio
//     entre os ativos" (padrão) ou "tudo pra fulano"; as reuniões futuras do
//     closer precisam de um closer novo cada uma; os cartões abertos do
//     pipeline vão pra quem você escolher.
//   • Reativar / encerrar ausência.
//
// Uma RPC só (qs_comercial_afastar, 0215): ou faz tudo, ou não faz nada, e
// grava quem fez em qs_comercial_afastamentos.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { notifySuccess } from "@/lib/qs/notify";
import { Campo, Janela, estiloEntrada } from "./pecas";
import { afastar, dataHoraCurta, previaAfastar, type PessoaMesa, type Previa } from "./mesa";

const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export default function AfastarPessoa({ pessoa, reativar, onFechar, onFeito }: {
  pessoa: PessoaMesa; reativar: boolean; onFechar: () => void; onFeito: () => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<"ausencia" | "desativar">("ausencia");
  const [ate, setAte] = useState("");
  const [motivo, setMotivo] = useState("");
  const [moverNaAusencia, setMoverNaAusencia] = useState(false);
  const [destino, setDestino] = useState<"rodizio" | "pessoa">("rodizio");
  const [destinoId, setDestinoId] = useState("");
  const [reunioes, setReunioes] = useState<Record<string, string>>({});
  const [negociosPara, setNegociosPara] = useState("");

  useEffect(() => {
    if (reativar) return;
    previaAfastar(pessoa.id).then((p) => {
      setPrevia(p);
      // closer: os cartões do pipeline já sugerem o primeiro closer ativo
      if (p.negocios_abertos > 0 && p.closers[0]) setNegociosPara(p.closers[0].id);
    }).catch((e: unknown) => setErro(e instanceof Error ? e.message : "não carregou"));
  }, [pessoa.id, reativar]);

  const mover = modo === "desativar" || moverNaAusencia;
  const temAberto = !!previa && (previa.leads_abertos > 0 || previa.tarefas_abertas > 0);
  const faltamReunioes = useMemo(
    () => (previa?.reunioes_futuras ?? []).filter((r) => !reunioes[r.id]).length,
    [previa, reunioes],
  );

  async function confirmar() {
    setOcupado(true); setErro(null);
    try {
      if (reativar) {
        await afastar({ userId: pessoa.id, modo: "reativar" });
        notifySuccess(`${pessoa.nome} voltou para o time.`);
        onFeito();
        return;
      }
      const r = await afastar({
        userId: pessoa.id, modo, ausenteAte: modo === "ausencia" ? ate : null, motivo,
        mover, destino: mover && destino === "pessoa" ? destinoId : null,
        reunioes: Object.entries(reunioes).filter(([, c]) => c).map(([id, closer_id]) => ({ id, closer_id })),
        negociosPara: negociosPara || null,
      });
      const partes = [
        r.leads ? `${r.leads} lead(s)` : "", r.tarefas ? `${r.tarefas} atividade(s)` : "",
        r.reunioes ? `${r.reunioes} reunião(ões)` : "", r.negocios ? `${r.negocios} cartão(ões)` : "",
      ].filter(Boolean);
      notifySuccess(`${pessoa.nome} ${modo === "desativar" ? "desativado(a)" : "marcado(a) como ausente"}${partes.length ? `. Repassados: ${partes.join(", ")}.` : "."}`);
      onFeito();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "não deu certo");
    } finally {
      setOcupado(false);
    }
  }

  if (reativar) {
    const desativado = !pessoa.ativo;
    return (
      <Janela aberta titulo={desativado ? `Reativar ${pessoa.nome}` : `Encerrar a ausência de ${pessoa.nome}`} onFechar={onFechar} largura={460}
        rodape={<><Button variant="ghost" onClick={onFechar}>Cancelar</Button><Button variant="primary" disabled={ocupado} onClick={() => void confirmar()}>{desativado ? "Reativar" : "Encerrar ausência"}</Button></>}>
        <p style={{ margin: 0, fontSize: 14 }}>
          {desativado
            ? "A pessoa volta a entrar no QS e no rodízio de leads novos. O que foi repassado na desativação continua com quem recebeu."
            : "A pessoa volta para o rodízio de leads novos a partir de agora."}
        </p>
        {erro && <Alert tone="danger">{erro}</Alert>}
      </Janela>
    );
  }

  const podeConfirmar = !!previa && !ocupado
    && (modo !== "ausencia" || (!!ate && ate >= hojeSP()))
    && (!mover || destino === "rodizio" || !!destinoId)
    && (modo !== "desativar" || faltamReunioes === 0)
    && (!mover || !temAberto || destino === "pessoa" || (previa?.rodizio.length ?? 0) > 0);

  return (
    <Janela aberta titulo={`Afastar ou desativar ${pessoa.nome}`} onFechar={onFechar}
      rodape={<>
        <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
        <Button variant={modo === "desativar" ? "destructive" : "primary"} disabled={!podeConfirmar} onClick={() => void confirmar()}>
          {ocupado ? "Salvando…" : modo === "desativar" ? "Desativar e repassar" : "Marcar ausência"}
        </Button>
      </>}>
      {!previa && !erro && <p style={{ margin: 0, color: "var(--subtle)" }}>Carregando o que está com a pessoa…</p>}
      {previa && (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>O que fazer</legend>
            <Opcao nome="modo" marcado={modo === "ausencia"} onEscolher={() => setModo("ausencia")}
              titulo="Ausência com data" texto="Férias, atestado, folga. Sai do rodízio de leads novos até a data e volta sozinha." />
            <Opcao nome="modo" marcado={modo === "desativar"} onEscolher={() => setModo("desativar")}
              titulo="Desativar" texto="Saiu da equipe. Perde o acesso e tudo o que está aberto passa para outras pessoas." />
          </fieldset>

          {modo === "ausencia" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 10 }}>
              <Campo rotulo="Ausente até (inclusive)"><input type="date" min={hojeSP()} value={ate} onChange={(e) => setAte(e.target.value)} style={estiloEntrada} /></Campo>
              <Campo rotulo="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: férias" style={estiloEntrada} /></Campo>
            </div>
          )}
          {modo === "desativar" && (
            <Campo rotulo="Motivo (opcional)"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: saiu da empresa" style={estiloEntrada} /></Campo>
          )}

          <div className="qs-card" style={{ padding: 12, fontSize: 13, display: "flex", flexDirection: "column", gap: 4, background: "var(--surface-2)" }}>
            <b>Está com {pessoa.nome.split(" ")[0]} agora</b>
            <span>{previa.leads_abertos} lead(s) em aberto · {previa.tarefas_abertas} atividade(s) abertas
              {previa.reservas_30d ? ` · ${previa.reservas_30d} reserva(s) da carteira (30 dias)` : ""}</span>
            {(previa.reunioes_futuras.length > 0 || previa.negocios_abertos > 0) && (
              <span>{previa.reunioes_futuras.length} reunião(ões) futura(s) como closer · {previa.negocios_abertos} cartão(ões) aberto(s) no pipeline</span>
            )}
          </div>

          {modo === "ausencia" && temAberto && (
            <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "flex-start" }}>
              <input type="checkbox" checked={moverNaAusencia} onChange={(e) => setMoverNaAusencia(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Também passar os leads e atividades abertas (se a ausência for longa). Sem marcar, ficam esperando a pessoa voltar.</span>
            </label>
          )}

          {mover && temAberto && (
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Pra onde vão os leads e as atividades</legend>
              <Opcao nome="destino" marcado={destino === "rodizio"} onEscolher={() => setDestino("rodizio")}
                titulo="Dividir no rodízio entre os ativos (padrão)"
                texto={previa.rodizio.length
                  ? `Em roda, começando por quem tem menos leads: ${previa.rodizio.map((r) => `${r.nome.split(" ")[0]} (${r.leads_abertos})`).join(", ")}. Não conta como lead novo no rodízio do dia.`
                  : "Não há SDR ativo e sem ausência agora. Escolha uma pessoa."} />
              <Opcao nome="destino" marcado={destino === "pessoa"} onEscolher={() => setDestino("pessoa")} titulo="Passar tudo para uma pessoa" />
              {destino === "pessoa" && (
                <select value={destinoId} onChange={(e) => setDestinoId(e.target.value)} style={estiloEntrada} aria-label="Pessoa que recebe">
                  <option value="">Escolha…</option>
                  {previa.pessoas.map((u) => <option key={u.id} value={u.id}>{u.nome} ({u.papel})</option>)}
                </select>
              )}
            </fieldset>
          )}

          {previa.reunioes_futuras.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <b style={{ fontSize: 13, flex: 1 }}>
                  Reuniões futuras: novo closer {modo === "desativar" ? "(obrigatório)" : "(opcional na ausência)"}
                </b>
                <select aria-label="Mesmo closer em todas" style={{ ...estiloEntrada, width: "auto" }} value=""
                  onChange={(e) => { const c = e.target.value; if (c) setReunioes(Object.fromEntries(previa.reunioes_futuras.map((r) => [r.id, c]))); }}>
                  <option value="">Mesmo closer em todas…</option>
                  {previa.closers.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              {previa.reunioes_futuras.map((r) => (
                <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
                  <span className="qs-num" style={{ width: 92 }}>{dataHoraCurta(r.em)}</span>
                  <span style={{ flex: 1, minWidth: 120 }}>{r.lead_nome ?? r.titulo ?? "Cliente"}</span>
                  <select value={reunioes[r.id] ?? ""} onChange={(e) => setReunioes({ ...reunioes, [r.id]: e.target.value })}
                    style={{ ...estiloEntrada, width: 200 }} aria-label={`Novo closer da reunião de ${dataHoraCurta(r.em)}`}>
                    <option value="">{modo === "desativar" ? "Escolha o closer…" : "Fica como está"}</option>
                    {previa.closers.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
              ))}
              <span style={{ fontSize: 12, color: "var(--subtle)" }}>
                O link do Meet continua o mesmo. O evento no Google Agenda e o card do Bitrix não mudam sozinhos: avise o novo closer.
                Se ele já tiver reunião no horário, o QS recusa e diz qual.
              </span>
            </div>
          )}

          {previa.negocios_abertos > 0 && (
            <Campo rotulo="Cartões abertos do pipeline passam para" dica="As reuniões trocadas acima já levam o cartão junto quando ele está aguardando a reunião.">
              <select value={negociosPara} onChange={(e) => setNegociosPara(e.target.value)} style={estiloEntrada}>
                <option value="">Deixar como está</option>
                {previa.closers.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </Campo>
          )}
        </>
      )}
      {erro && <Alert tone="danger">{erro}</Alert>}
    </Janela>
  );
}

function Opcao({ nome, marcado, onEscolher, titulo, texto }: { nome: string; marcado: boolean; onEscolher: () => void; titulo: string; texto?: string }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", borderRadius: 10, cursor: "pointer",
      border: `1px solid ${marcado ? "var(--text)" : "var(--border)"}` }}>
      <input type="radio" name={nome} checked={marcado} onChange={onEscolher} style={{ marginTop: 3 }} />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{titulo}</span>
        {texto && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{texto}</span>}
      </span>
    </label>
  );
}
