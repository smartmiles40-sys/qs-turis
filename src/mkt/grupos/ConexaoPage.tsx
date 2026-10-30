// src/mkt/grupos/ConexaoPage.tsx — o chip do Marketing (instância Evolution PRÓPRIA).
import { useEffect, useState } from "react";
import { Alert, Btn, Card, Page, PageHeader, StatusChip } from "@/components/ui";
import { api, classeCampo, estiloCampo, lerEstado, quando, type EstadoChip } from "./lib";

export default function ConexaoPage() {
  const [st, setSt] = useState<EstadoChip | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qr, setQr] = useState<{ base64: string | null; pairingCode: string | null } | null>(null);
  const [form, setForm] = useState({ instancia: "", numero: "", janela_inicio: "08:00", janela_fim: "21:00", intervalo_min_seg: 20, intervalo_max_seg: 45 });
  const [ocupado, setOcupado] = useState(false);

  async function carregar() {
    setErro(null);
    try {
      const s = await lerEstado();
      setSt(s);
      if (s.conexao) setForm({
        instancia: s.conexao.instancia, numero: s.conexao.numero || "", janela_inicio: s.conexao.janela_inicio, janela_fim: s.conexao.janela_fim,
        intervalo_min_seg: s.conexao.intervalo_min_seg, intervalo_max_seg: s.conexao.intervalo_max_seg,
      });
    } catch (e) { setErro((e as Error).message); }
  }
  useEffect(() => { void carregar(); }, []);

  async function rodar(acao: string, corpo: Record<string, unknown> = {}, sucesso?: string) {
    setOcupado(true); setErro(null); setMsg(null);
    try {
      const r = await api<Record<string, unknown>>(acao, corpo);
      if (acao === "qrcode") setQr(r as { base64: string | null; pairingCode: string | null });
      if (sucesso) setMsg(sucesso);
      await carregar();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  const c = st?.conexao;
  const conectado = st?.estado === "open";
  const admin = Boolean(st?.admin);

  return (
    <Page>
      <PageHeader crumb="Marketing · Grupos" title="Chip do Marketing"
        subtitle="Grupos do WhatsApp saem só por este chip (Evolution). Mensagem em massa pra pessoas vai pela API oficial, nunca por aqui." />
      <div className="flex flex-col gap-4">
        {erro && <Alert tone="danger">{erro}</Alert>}
        {msg && <Alert tone="ok">{msg}</Alert>}
        <Alert tone="info">
          Trava: a instância do Relacionamento (<code>relacionamento-grupos-4183</code>), as dos SDRs e qualquer nome de outro setor são recusadas —
          no servidor e no banco. O nome da instância precisa ter “marketing” ou “mkt”.
        </Alert>

        <Card title="Situação" action={<Btn size="sm" onClick={() => void carregar()}>Atualizar</Btn>}>
          {!c ? <p className="text-[14px]">Nenhuma instância configurada ainda.</p> : (
            <div className="flex flex-col gap-2 text-[14px]">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{c.instancia}</strong>
                <StatusChip tone={conectado ? "ok" : "warn"}>{conectado ? "Conectado" : st?.estado || c.estado}</StatusChip>
                {c.numero && <span className="qs-tone-muted">+{c.numero}</span>}
              </div>
              {st?.erro && <span className="qs-tone-danger text-[13px]">{st.erro}</span>}
              <div>Envio das campanhas: {st?.envioAmbiente
                ? (c.envio_ligado ? <StatusChip tone="ok">ligado</StatusChip> : <StatusChip tone="warn">pausado na tela</StatusChip>)
                : <StatusChip tone="warn">desligado na Vercel (MKT_GRUPOS_ENVIO)</StatusChip>}</div>
              <div className="qs-tone-muted text-[13px]">Janela {c.janela_inicio}–{c.janela_fim} · intervalo {c.intervalo_min_seg}–{c.intervalo_max_seg}s entre grupos · próximo envio liberado {quando(c.proximo_envio_em)}</div>
              {admin && (
                <div className="flex flex-wrap gap-2 mt-1">
                  <Btn size="sm" disabled={ocupado} onClick={() => void rodar("qrcode")}>Mostrar QR code</Btn>
                  <Btn size="sm" disabled={ocupado} onClick={() => void rodar("apontar_webhook", {}, "Webhook apontado pro QS.")}>Apontar webhook</Btn>
                  <Btn size="sm" variant={c.envio_ligado ? "secondary" : "positive"} disabled={ocupado}
                    onClick={() => void rodar("ligar_envio", { ligado: !c.envio_ligado }, c.envio_ligado ? "Envio pausado." : "Envio ligado.")}>
                    {c.envio_ligado ? "Pausar envios" : "Ligar envios"}
                  </Btn>
                  <Btn size="sm" variant="ghost" disabled={ocupado}
                    onClick={() => { if (confirm("Desconectar o chip do Marketing? Vai precisar ler o QR de novo.")) void rodar("desconectar", {}, "Desconectado."); }}>Desconectar</Btn>
                </div>
              )}
              {qr && (
                <div className="flex flex-col items-start gap-1 mt-2">
                  {qr.base64 ? <img src={qr.base64} alt="QR code do WhatsApp" width={240} height={240} /> : <span>Sem QR (talvez já esteja conectado).</span>}
                  {qr.pairingCode && <span className="text-[13px]">Código de pareamento: <strong>{qr.pairingCode}</strong></span>}
                  <span className="text-[12px] qs-tone-muted">WhatsApp do chip → Aparelhos conectados → Conectar aparelho. O QR vence em ~40 s.</span>
                </div>
              )}
            </div>
          )}
        </Card>

        {admin ? (
          <Card title="Configurar a instância (só admin)">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void rodar("configurar", form, "Configuração salva. O envio fica pausado até alguém ligar."); }}>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="qs-label">Nome da instância na Evolution</span>
                <input className={classeCampo} style={estiloCampo} required value={form.instancia}
                  onChange={(e) => setForm({ ...form, instancia: e.target.value })} placeholder="ex.: numero-para-o-marketing--edmg0" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="qs-label">Número do chip (com DDI)</span>
                <input className={classeCampo} style={estiloCampo} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="5511…" />
              </label>
              <div className="flex gap-2">
                <label className="flex flex-col gap-1 flex-1"><span className="qs-label">Janela: das</span>
                  <input type="time" className={classeCampo} style={estiloCampo} value={form.janela_inicio} onChange={(e) => setForm({ ...form, janela_inicio: e.target.value })} /></label>
                <label className="flex flex-col gap-1 flex-1"><span className="qs-label">até</span>
                  <input type="time" className={classeCampo} style={estiloCampo} value={form.janela_fim} onChange={(e) => setForm({ ...form, janela_fim: e.target.value })} /></label>
              </div>
              <div className="flex gap-2 sm:col-span-2 items-end">
                <label className="flex flex-col gap-1"><span className="qs-label">Intervalo padrão (s): mín.</span>
                  <input type="number" min={5} className={classeCampo} style={estiloCampo} value={form.intervalo_min_seg} onChange={(e) => setForm({ ...form, intervalo_min_seg: Number(e.target.value) })} /></label>
                <label className="flex flex-col gap-1"><span className="qs-label">máx.</span>
                  <input type="number" min={5} className={classeCampo} style={estiloCampo} value={form.intervalo_max_seg} onChange={(e) => setForm({ ...form, intervalo_max_seg: Number(e.target.value) })} /></label>
                <Btn variant="primary" type="submit" disabled={ocupado}>Salvar</Btn>
              </div>
              <p className="text-[12px] qs-tone-muted sm:col-span-2">Trocar a instância desliga o envio. A instância é criada na Evolution Manager (veja docs/MARKETING-GRUPOS.md); aqui só se aponta pra ela.</p>
            </form>
          </Card>
        ) : <Alert tone="info">Só o admin configura o chip.</Alert>}
      </div>
    </Page>
  );
}
