// src/mkt/grupos/Chip.tsx — o chip do Marketing (instância Evolution PRÓPRIA) vira um selo
// no canto da página ("Chip conectado ●" / "Envio pausado") que abre a configuração num Modal.
// TRAVAS (não tirar): o Relacionamento e os SDRs nunca enviam por aqui (servidor + banco);
// envio só com MKT_GRUPOS_ENVIO=1 na Vercel E "envio ligado" aqui; ligar/desligar,
// trocar a instância e desconectar: só admin (o servidor recusa os outros).
// 04/11/2026: "Ler QR Code" (reconectar) e "Apontar webhook" passam pro time todo.
import { useEffect, useState } from "react";
import { Modal } from "@/rel/ui";
import { api, quando } from "./lib";
import { useChip } from "./contexto";
import { useParam } from "./navegar";
import { BotaoGrande, Campo, Nota, SeloBolinha, cor } from "./pecas";

type Situacao = { tom: "ok" | "aviso" | "erro" | "neutro"; rotulo: string };

export function situacaoDoChip(st: ReturnType<typeof useChip>["estado"], erro: string | null): Situacao {
  if (erro && !st) return { tom: "erro", rotulo: "Chip sem leitura" };
  if (!st) return { tom: "neutro", rotulo: "Lendo o chip…" };
  if (!st.conexao) return { tom: "aviso", rotulo: "Chip não configurado" };
  if (st.estado !== "open") return { tom: "erro", rotulo: "Chip desconectado" };
  if (!st.envioAmbiente || !st.conexao.envio_ligado) return { tom: "aviso", rotulo: "Chip conectado · envio pausado" };
  return { tom: "ok", rotulo: "Chip conectado" };
}

/** O selo do canto. Clicar abre a configuração. */
export function SeloChip() {
  const { estado, erro } = useChip();
  const [aberto, setAberto] = useParam("chip");
  const s = situacaoDoChip(estado, erro);
  return (
    <>
      <button type="button" onClick={() => setAberto("1")} title="Ver e configurar o chip do Marketing"
        className="inline-flex items-center gap-2 rounded-full px-1 py-0.5 transition-opacity hover:opacity-85" aria-haspopup="dialog">
        <SeloBolinha tom={s.tom} pulso={s.tom === "ok"}>{s.rotulo}</SeloBolinha>
        <span aria-hidden className="text-[15px]" style={{ color: cor.ink3 }}>⚙</span>
      </button>
      <Modal aberto={aberto === "1"} titulo="Chip do Marketing" onFechar={() => setAberto(null)} largura={720}>
        <PainelChip />
      </Modal>
    </>
  );
}

function PainelChip() {
  const { estado: st, erro: erroLeitura, recarregar } = useChip();
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qr, setQr] = useState<{ base64: string | null; pairingCode: string | null } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [form, setForm] = useState({ instancia: "", numero: "", janela_inicio: "08:00", janela_fim: "21:00", intervalo_min_seg: 20, intervalo_max_seg: 45 });
  const c = st?.conexao;
  useEffect(() => {
    if (c) setForm({ instancia: c.instancia, numero: c.numero || "", janela_inicio: c.janela_inicio, janela_fim: c.janela_fim, intervalo_min_seg: c.intervalo_min_seg, intervalo_max_seg: c.intervalo_max_seg });
  }, [c]);

  async function rodar(acao: string, corpo: Record<string, unknown> = {}, sucesso?: string) {
    setOcupado(acao); setErro(null); setMsg(null);
    try {
      const r = await api<Record<string, unknown>>(acao, corpo);
      if (acao === "qrcode") setQr(r as { base64: string | null; pairingCode: string | null });
      if (sucesso) setMsg(sucesso);
      await recarregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); }
  }

  const conectado = st?.estado === "open";
  const admin = Boolean(st?.admin);
  const s = situacaoDoChip(st, erroLeitura);

  return (
    <div className="flex flex-col gap-4">
      {(erro || erroLeitura) && <Nota tom="erro" icone="⚠️">{erro || erroLeitura}</Nota>}
      {msg && <Nota icone="✓">{msg}</Nota>}
      <Nota tom="aviso" icone="🔒">
        Trava: a instância do Relacionamento (<code>relacionamento-grupos-4183</code>), as dos SDRs e qualquer nome de outro setor são recusadas —
        no servidor e no banco. O nome da instância precisa ter “marketing” ou “mkt”. Mensagem em massa pra pessoas vai pela API oficial, nunca por aqui.
      </Nota>

      <section className="gr-cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h3 className="truncate text-[15px] font-semibold" style={{ color: cor.ink }}>{c?.instancia || "Nenhuma instância configurada"}</h3>
              <SeloBolinha tom={s.tom} pulso={s.tom === "ok"}>{conectado ? "Conectado" : st?.estado || c?.estado || "—"}</SeloBolinha>
              <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ border: "1px solid var(--line)", color: cor.ink3 }}>Chip (QR Code)</span>
            </div>
            {c && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: cor.ink3 }}>
                <span className="tabular-nums">{c.numero ? `+${c.numero}` : "Sem número"}</span>
                <span>Janela {c.janela_inicio}–{c.janela_fim}</span>
                <span>Intervalo {c.intervalo_min_seg}–{c.intervalo_max_seg}s entre grupos</span>
                <span>Próximo envio liberado {quando(c.proximo_envio_em)}</span>
              </div>
            )}
            {st?.erro && <p className="mt-2 text-[12px]" style={{ color: "var(--err-ink)" }}>{st.erro}</p>}
            {c && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: cor.ink }}>
                Envio das campanhas:{" "}
                {!st?.envioAmbiente
                  ? <SeloBolinha tom="aviso">desligado na Vercel (MKT_GRUPOS_ENVIO)</SeloBolinha>
                  : c.envio_ligado ? <SeloBolinha tom="ok">ligado</SeloBolinha> : <SeloBolinha tom="aviso">pausado aqui</SeloBolinha>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <BotaoGrande variante="secundario" pequeno disabled={Boolean(ocupado)} onClick={() => void recarregar()}>Conferir</BotaoGrande>
            {c && (
              <>
                {!conectado && <BotaoGrande pequeno disabled={Boolean(ocupado)} onClick={() => void rodar("qrcode")}>{ocupado === "qrcode" ? "Gerando…" : "Ler QR Code"}</BotaoGrande>}
                <BotaoGrande variante="secundario" pequeno disabled={Boolean(ocupado)} onClick={() => void rodar("apontar_webhook", {}, "Webhook apontado pro QS.")}>Apontar webhook</BotaoGrande>
              </>
            )}
            {admin && c && (
              <>
                <BotaoGrande variante="secundario" pequeno disabled={Boolean(ocupado)}
                  onClick={() => void rodar("ligar_envio", { ligado: !c.envio_ligado }, c.envio_ligado ? "Envio pausado." : "Envio ligado.")}>
                  {c.envio_ligado ? "⏸ Pausar envios" : "▶ Ligar envios"}
                </BotaoGrande>
                {conectado && (
                  <BotaoGrande variante="perigo" pequeno disabled={Boolean(ocupado)}
                    onClick={() => { if (confirm("Desconectar o chip do Marketing? As campanhas param de sair e vai precisar ler o QR de novo.")) void rodar("desconectar", {}, "Desconectado."); }}>Desconectar</BotaoGrande>
                )}
              </>
            )}
          </div>
        </div>
        {qr && (
          <div className="flex flex-wrap items-center gap-6 p-6" style={{ borderTop: "1px solid var(--line)", background: cor.card2 }}>
            <div className="shrink-0">
              {qr.base64
                ? <div className="rounded-xl bg-white p-3"><img src={qr.base64} alt="QR Code para conectar o WhatsApp" width={200} height={200} /></div>
                : <div className="flex h-[224px] w-[224px] items-center justify-center rounded-xl text-[13px]" style={{ border: "1px solid var(--line)", color: cor.ink3 }}>Sem QR (talvez já esteja conectado).</div>}
            </div>
            <div className="min-w-[240px] flex-1 text-[13px] leading-relaxed" style={{ color: cor.ink2 }}>
              <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: cor.ink }}>Como conectar</h4>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>Abra o WhatsApp no celular do chip do Marketing.</li>
                <li>Toque em <b>Configurações → Aparelhos conectados</b>.</li>
                <li>Toque em <b>Conectar um aparelho</b> e aponte para o código.</li>
              </ol>
              <p className="mt-3 text-[12px]">O código vence em ~40 segundos. Assim que o celular confirmar, clique em <b>Já li o código</b>.</p>
              {qr.pairingCode && <p className="mt-3 text-[12px]">Prefere sem câmera? Código de pareamento: <b className="font-mono tracking-widest">{qr.pairingCode}</b></p>}
              <div className="mt-4 flex gap-2">
                <BotaoGrande pequeno onClick={() => { setQr(null); void recarregar(); }}>Já li o código</BotaoGrande>
                <BotaoGrande variante="secundario" pequeno onClick={() => setQr(null)}>Fechar</BotaoGrande>
              </div>
            </div>
          </div>
        )}
      </section>

      {admin ? (
        <details className="gr-cartao p-5" open={!c}>
          <summary className="cursor-pointer text-[14px] font-semibold" style={{ color: cor.ink }}>Configurar a instância <span className="font-normal" style={{ color: cor.ink3 }}>· só admin</span></summary>
          <form className="mt-4 grid gap-x-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void rodar("configurar", form, "Configuração salva. O envio fica pausado até alguém ligar."); }}>
            <Campo rotulo="Nome da instância na Evolution" className="sm:col-span-2">
              <input className="rel-input" required value={form.instancia} onChange={(e) => setForm({ ...form, instancia: e.target.value })} placeholder="ex.: numero-para-o-marketing--edmg0" />
            </Campo>
            <Campo rotulo="Número do chip" dica="· com DDI">
              <input className="rel-input" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="5511…" />
            </Campo>
            <Campo rotulo="Janela de envio" dica="· Brasília">
              <div className="flex items-center gap-2">
                <input type="time" className="rel-input" value={form.janela_inicio} onChange={(e) => setForm({ ...form, janela_inicio: e.target.value })} aria-label="Das" />
                <span style={{ color: cor.ink3 }}>até</span>
                <input type="time" className="rel-input" value={form.janela_fim} onChange={(e) => setForm({ ...form, janela_fim: e.target.value })} aria-label="Até" />
              </div>
            </Campo>
            <Campo rotulo="Intervalo padrão entre grupos" dica="· segundos (anti-bloqueio)" className="sm:col-span-2">
              <div className="flex items-center gap-2" style={{ maxWidth: 320 }}>
                <input type="number" min={5} className="rel-input" value={form.intervalo_min_seg} onChange={(e) => setForm({ ...form, intervalo_min_seg: Number(e.target.value) })} aria-label="Mínimo" />
                <span style={{ color: cor.ink3 }}>a</span>
                <input type="number" min={5} className="rel-input" value={form.intervalo_max_seg} onChange={(e) => setForm({ ...form, intervalo_max_seg: Number(e.target.value) })} aria-label="Máximo" />
              </div>
            </Campo>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <BotaoGrande type="submit" disabled={Boolean(ocupado)}>{ocupado === "configurar" ? "Salvando…" : "💾 Salvar"}</BotaoGrande>
              <span className="text-[12px]" style={{ color: cor.ink3 }}>Trocar a instância desliga o envio. A instância é criada na Evolution Manager (veja docs/MARKETING-GRUPOS.md); aqui só se aponta pra ela.</span>
            </div>
          </form>
        </details>
      ) : <Nota icone="ℹ️">Ler o QR Code (reconectar) qualquer pessoa do Marketing faz. Ligar/pausar o envio, trocar a instância e desconectar: só o admin.</Nota>}
    </div>
  );
}
