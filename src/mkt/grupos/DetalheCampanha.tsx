// src/mkt/grupos/DetalheCampanha.tsx — o resultado de uma campanha (a página [id] do SendFlow):
// a mensagem, os números (grupos, chegaram, leitura "—", falharam), quem não recebeu e a
// lista grupo a grupo. Enquanto envia, atualiza sozinho a cada 15 s.
import { useCallback, useEffect, useMemo, useState } from "react";
import { lerCampanha, lerEnvios, mudarStatus, type Campanha, type Envio } from "./lib";
import { acoesDaCampanha, avisoPausadaDeProposito, quandoSP, veioDoSendFlow } from "./datas";
import type { Bases } from "./useBases";
import { useParam } from "./navegar";
import { agendarNoServidor, useConfirmarRetomada } from "./Retomar";
import { resumoPublico } from "./SeletorPublico";
import { BotaoGrande, Nota, PreviaWhatsApp, ROTULO_TIPO, SeloStatus, cor } from "./pecas";

const ROTULO_ENVIO: Record<Envio["status"], { r: string; c: string }> = {
  pendente: { r: "na fila", c: "var(--ink3)" }, enviando: { r: "enviando", c: "var(--warn-ink)" },
  enviado: { r: "chegou ao grupo", c: "var(--ink)" }, chegou: { r: "chegou ao grupo ✓", c: "var(--rel-ink)" },
  falha: { r: "falhou", c: "var(--err-ink)" }, cancelado: { r: "cancelada", c: "var(--ink3)" }, pulado: { r: "pulado", c: "var(--ink3)" },
};

export function DetalheCampanha({ id, bases, onVoltar }: { id: string; bases: Bases; onVoltar: () => void }) {
  const [, setEditar] = useParam("editar");
  const [, setCampanha] = useParam("campanha");
  const [, setCopiar] = useParam("copiar");
  const [c, setC] = useState<Campanha | null | undefined>(undefined);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pedirRetomada, modalRetomada] = useConfirmarRetomada();

  const carregar = useCallback(async () => {
    try { const [x, e] = await Promise.all([lerCampanha(id), lerEnvios(id)]); setC(x); setEnvios(e); }
    catch (e) { setErro((e as Error).message); setC((v) => v ?? null); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (c?.status !== "enviando") return;
    const t = setInterval(() => void carregar(), 15_000);
    return () => clearInterval(t);
  }, [c?.status, carregar]);

  const n = useMemo(() => ({
    total: envios.length,
    chegaram: envios.filter((e) => e.status === "enviado" || e.status === "chegou").length,
    fila: envios.filter((e) => e.status === "pendente" || e.status === "enviando").length,
    falhas: envios.filter((e) => e.status === "falha"),
  }), [envios]);

  if (c === undefined) return <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando campanha…</div>;
  if (c === null) return (
    <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>
      {erro || "Campanha não encontrada."} <button type="button" className="font-semibold underline" style={{ color: cor.relInk }} onClick={onVoltar}>Voltar para a lista</button>
    </div>
  );

  const acoes = acoesDaCampanha(c);
  const pausadaDeProposito = c.status === "pausada" ? avisoPausadaDeProposito(c.avisos) : null;
  const outrosAvisos = (c.avisos || []).filter((a) => a !== pausadaDeProposito && !a.startsWith("Migrada do SendFlow"));

  async function status(s: "pausada" | "cancelada") {
    if (!c) return;
    if (s === "cancelada" && !confirm("Cancelar? Quem ainda não recebeu sai da fila.")) return;
    setOcupado(true); setErro(null);
    try { await mudarStatus(c.id, s); await carregar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  function retomar() {
    if (!c) return;
    pedirRetomada(c, async () => {
      setOcupado(true); setErro(null);
      try { const e = await agendarNoServidor(c.id); if (e.length) setErro(e.join(" · ")); await carregar(); }
      catch (x) { setErro((x as Error).message); } finally { setOcupado(false); }
    });
  }

  return (
    <div className="max-w-5xl">
      {modalRetomada}
      <button type="button" onClick={onVoltar} className="mb-2 inline-block text-[12px] font-semibold hover:underline" style={{ color: cor.ink3 }}>← Campanhas</button>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="break-words text-[24px] font-semibold" style={{ color: cor.ink }}>{c.nome}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[14px]" style={{ color: cor.ink3 }}>
            <SeloStatus status={c.status} detalhe={c.status === "enviando" && c.total ? `${c.enviados}/${c.total}` : undefined} />
            <span>{quandoSP(c.enviar_em)}</span>
            {c.concluido_em && <span>· concluída {quandoSP(c.concluido_em)}</span>}
            <span>· {resumoPublico(c, bases.tags)}</span>
            {veioDoSendFlow(c.avisos) && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ border: "1px solid var(--line)" }}>veio do SendFlow</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {acoes.includes("editar") && <BotaoGrande pequeno variante="secundario" onClick={() => { setCampanha(null); setEditar(c.id); }}>✏️ Editar</BotaoGrande>}
          {acoes.includes("retomar") && <BotaoGrande pequeno disabled={ocupado} onClick={retomar}>▶ Retomar</BotaoGrande>}
          {acoes.includes("pausar") && <BotaoGrande pequeno variante="secundario" disabled={ocupado} onClick={() => void status("pausada")}>⏸ Pausar</BotaoGrande>}
          {acoes.includes("cancelar") && <BotaoGrande pequeno variante="perigo" disabled={ocupado} onClick={() => void status("cancelada")}>Cancelar</BotaoGrande>}
          <BotaoGrande pequeno variante="secundario" onClick={() => { setCopiar(c.id); setCampanha("nova"); }}>⧉ Duplicar</BotaoGrande>
        </div>
      </header>

      <div className="mb-5 flex flex-col gap-2.5">
        {pausadaDeProposito && (
          <div className="rounded-xl px-4 py-3.5 text-[14px] font-semibold" role="alert"
            style={{ background: "var(--warn-bg)", color: "var(--warn-ink)", border: "2px solid var(--warn-line)" }}>
            ⚠️ {pausadaDeProposito}
          </div>
        )}
        {erro && <Nota tom="erro" icone="⚠️">{erro}</Nota>}
        {c.erro && <Nota tom="erro" icone="⚠️">{c.erro}</Nota>}
        {outrosAvisos.length > 0 && <Nota tom="aviso" icone="ℹ️">{outrosAvisos.join(" · ")}</Nota>}
      </div>

      <div className="mb-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="gr-cartao p-5">
          <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: cor.ink3 }}>A mensagem {c.status === "concluida" ? "enviada" : ""}</h3>
          <p className="text-[12px]" style={{ color: cor.ink3 }}>{ROTULO_TIPO[c.tipo]}{c.mencionar_todos ? " · menção a todos" : ""}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed" style={{ color: cor.ink }}>{c.texto || <span style={{ color: cor.ink3 }}>(sem texto)</span>}</p>
          {c.tipo === "enquete" && c.enquete_opcoes?.length ? <p className="mt-2 text-[13px]" style={{ color: cor.ink2 }}>{c.enquete_opcoes.join(" · ")}</p> : null}
          {c.midia_url && <a href={c.midia_url} target="_blank" rel="noreferrer" className="mt-2.5 block truncate text-[12px] underline" style={{ color: cor.relInk }}>{c.midia_nome || c.midia_url}</a>}
        </section>
        <PreviaWhatsApp tipo={c.tipo} texto={c.texto || ""} midiaUrl={c.midia_url} midiaNome={c.midia_nome} mencionarTodos={c.mencionar_todos} enqueteOpcoes={c.enquete_opcoes} enqueteMultipla={c.enquete_multipla} />
      </div>

      {n.total === 0 ? (
        <div className="gr-cartao p-6 text-[14px] leading-relaxed" style={{ color: cor.ink3 }}>
          {c.status === "agendada" || c.status === "pausada" || c.status === "rascunho"
            ? "Esta campanha ainda não saiu. A fila de grupos é montada no horário agendado — é a partir daí que os números aparecem aqui."
            : "Nenhum grupo registrado para esta campanha."}
        </div>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <Tile rotulo="Grupos" valor={String(n.total)} apoio={n.fila ? `${n.fila} ainda na fila — o envio é espaçado de propósito` : "fila concluída"} destaque />
            <Tile rotulo="Chegaram ao grupo" valor={`${n.chegaram} de ${n.total}`} apoio="o WhatsApp aceitou e a mensagem está no grupo" />
            <Tile rotulo="Leitura" valor="—" apoio="em grupo o WhatsApp não informa quem leu — confira reações e respostas na aba Celular" />
            <Tile rotulo="Falharam" valor={String(n.falhas.length)} apoio="grupos que não receberam" />
          </section>

          {n.falhas.length > 0 && (
            <section className="gr-cartao mb-6 overflow-hidden" style={{ borderColor: "var(--err-line)" }}>
              <h3 className="px-5 py-3.5 text-[15px] font-semibold" style={{ color: "var(--err-ink)", borderBottom: "1px solid var(--line)" }}>Quem não recebeu ({n.falhas.length})</h3>
              <div className="max-h-80 overflow-auto">
                {n.falhas.map((f) => (
                  <div key={f.id} className="px-5 py-2.5" style={{ borderTop: "1px solid var(--line)" }}>
                    <div className="text-[14px]" style={{ color: cor.ink }}>{f.grupo_nome || f.grupo_jid}</div>
                    {f.erro && <div className="mt-0.5 text-[12px] leading-relaxed" style={{ color: cor.ink3 }}>{f.erro}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="gr-cartao overflow-hidden">
            <h3 className="px-5 py-3.5 text-[15px] font-semibold" style={{ color: cor.ink, borderBottom: "1px solid var(--line)" }}>Grupo por grupo</h3>
            <div className="max-h-[520px] overflow-auto">
              <table className="w-full text-[14px]">
                <thead className="sticky top-0 text-[12px] uppercase tracking-[0.06em]" style={{ background: cor.card2, color: cor.ink3 }}>
                  <tr><th className="px-5 py-2.5 text-left font-semibold">Grupo</th><th className="px-3 py-2.5 text-left font-semibold">Situação</th><th className="px-5 py-2.5 text-left font-semibold">Quando</th></tr>
                </thead>
                <tbody>
                  {envios.map((e) => (
                    <tr key={e.id} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="max-w-[260px] truncate px-5 py-2.5" style={{ color: cor.ink }}>{e.grupo_nome || e.grupo_jid}</td>
                      <td className="px-3 py-2.5" style={{ color: ROTULO_ENVIO[e.status].c }}>
                        {ROTULO_ENVIO[e.status].r}
                        {e.erro && e.status !== "falha" ? <div className="text-[12px]" style={{ color: cor.ink3 }}>{e.erro}</div> : null}
                      </td>
                      <td className="px-5 py-2.5 tabular-nums" style={{ color: cor.ink3 }}>{quandoSP(e.chegou_em || e.enviado_em)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ rotulo, valor, apoio, destaque }: { rotulo: string; valor: string; apoio: string; destaque?: boolean }) {
  return (
    <div className="rounded-[14px] p-[18px]" style={destaque ? { border: "1px solid var(--rel)", background: cor.relSoft } : { border: "1px solid var(--line)", background: cor.card }}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: destaque ? cor.relInk : cor.ink3 }}>{rotulo}</div>
      <div className="mt-2 text-[24px] font-semibold leading-tight tabular-nums" style={{ color: cor.ink }}>{valor}</div>
      <div className="mt-1.5 text-[12px] leading-snug" style={{ color: cor.ink3 }}>{apoio}</div>
    </div>
  );
}
