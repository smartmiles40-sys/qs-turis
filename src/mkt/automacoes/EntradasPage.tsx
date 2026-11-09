// src/mkt/automacoes/EntradasPage.tsx
// -----------------------------------------------------------------------------
// LINKS E QR DE ENTRADA ("growth tools" do ManyChat), 09/11/2026.
//
// Cada link é um gatilho (WhatsApp: link_ref no wa.me com "[ref:código]";
// Instagram: ig_ref no ig.me/m/<conta>?ref=código) ligado a um fluxo. O que se
// divulga é o LINK CURTO do QS (<site>/e/<código>): ele conta o clique e
// redireciona — dá pra trocar o fluxo sem reimprimir o QR. "Conversas" = quantas
// vezes o gatilho começou o fluxo (alguém mandou a mensagem / abriu a DM).
// Mora como aba na página WhatsApp e na página Instagram (menu enxuto).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { canalDo, linkCurto, linkDeReferencia, linkIgMe, type Canal, type Fluxo, type Gatilho } from "./tipos";
import { apagarGatilho, carregarEstado, cliquesPorDia, criarFluxo, criarGatilho, listarFluxos, listarGatilhos, mudarGatilho, salvarFluxo, type EstadoMkt } from "./api";
import { grafoDeRespostaSimples } from "./modelos";
import { caminhoQr, matrizQr, baixarPng, baixarSvg } from "./qr";
import { AreaTexto, Aviso, Botao, Campo, Carregando, Chip, COR, Entrada, MKT_CSS, Modal, Selecao } from "./ui";

const NOVO = "__novo__";
const erroMsg = (e: unknown, padrao: string) => {
  const m = e instanceof Error ? e.message : "";
  if (/duplicate|unique/i.test(m)) return "Esse código já existe em outro link (WhatsApp ou Instagram).";
  if (/check constraint|ig_ref|canal/i.test(m)) return "O banco ainda não tem a migration 0343 (links do Instagram).";
  return m || padrao;
};
const codigoDe = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => notifySuccess("Copiado.")); };

export function QrSvg({ texto, tamanho = 120 }: { texto: string; tamanho?: number }) {
  const { d, lado } = useMemo(() => caminhoQr(matrizQr(texto)), [texto]);
  return (
    <svg role="img" aria-label="QR Code do link" width={tamanho} height={tamanho} viewBox={`0 0 ${lado} ${lado}`} shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 8 }}>
      <rect width={lado} height={lado} fill="#fff" /><path d={d} fill="#000" />
    </svg>
  );
}

export default function EntradasPage({ canal }: { canal: Canal }) {
  const tipo = canal === "instagram" ? "ig_ref" : "link_ref";
  const [links, setLinks] = useState<Gatilho[] | null>(null);
  const [fluxos, setFluxos] = useState<Fluxo[]>([]);
  const [estado, setEstado] = useState<EstadoMkt | null>(null);
  const [usuarioIg, setUsuarioIg] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const origem = typeof window !== "undefined" ? window.location.origin : "";

  const carregar = useCallback(async () => {
    try {
      const [g, f] = await Promise.all([listarGatilhos([tipo]), listarFluxos()]);
      setLinks(g); setFluxos(f.filter((x) => canalDo(x) === canal)); setErro(null);
    } catch (e) { setErro(erroMsg(e, "Não consegui carregar os links.")); setLinks([]); }
  }, [tipo, canal]);
  useEffect(() => {
    void carregar();
    if (canal === "whatsapp") carregarEstado().then(setEstado).catch(() => setEstado(null));
    else void supabase.from("mkt_ig_contas").select("username").eq("status", "conectada").not("username", "is", null).order("criado_em").limit(1)
      .then(({ data }) => setUsuarioIg((data?.[0] as { username?: string } | undefined)?.username ?? null));
  }, [carregar, canal]);

  const porFluxo = new Map(fluxos.map((f) => [f.id, f]));
  const destino = (g: Gatilho) => canal === "instagram"
    ? (usuarioIg ? linkIgMe(usuarioIg, g.config.codigo ?? "") : null)
    : (estado?.numero?.numero ? linkDeReferencia(estado.numero.numero, g.config.codigo ?? "", g.config.texto) : null);
  const faltaConta = canal === "instagram" ? !usuarioIg : !estado?.numero?.numero;

  async function ligar(g: Gatilho, v: boolean) {
    try {
      const f = porFluxo.get(g.fluxo_id);
      if (v && f && f.status !== "ativo") await salvarFluxo(f.id, { status: "ativo" });
      await mudarGatilho(g.id, { ativo: v });
      void carregar();
    } catch (e) { notifyError(erroMsg(e, "Falhou.")); }
  }

  return (
    <div className="mkt-raiz flex flex-col gap-4">
      <style>{MKT_CSS}</style>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-bold" style={{ color: "var(--ink)" }}>Links e QR de entrada</h2>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            {canal === "instagram" ? "Quem abre o link (ou lê o QR) cai na DM do Instagram e o fluxo começa sozinho." : "Quem abre o link (ou lê o QR) cai no WhatsApp com a mensagem pronta e o fluxo começa sozinho."}
            {" "}Use na bio, no story, no anúncio, no material impresso.
          </p>
        </div>
        <Botao variante="primario" onClick={() => setForm(formNovo(fluxos[0]?.id ?? NOVO))}>+ Novo link</Botao>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!erro && faltaConta && (
        <Aviso tom="alerta">{canal === "instagram" ? "Conecte a conta do Instagram (aba Conexão) para o link saber pra qual @ mandar." : "Conecte o número do Marketing (Automações › Configurações) para o link saber pra qual número mandar."} Dá pra criar os links já.</Aviso>
      )}
      {!links ? <Carregando /> : !links.length ? (
        <div className="mkt-card p-5 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum link ainda. Crie um pra cada lugar onde você divulga (bio, live, panfleto…) e compare qual traz mais conversa.</div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {links.map((g) => (
            <CartaoLink key={g.id} g={g} fluxo={porFluxo.get(g.fluxo_id) ?? null} curto={linkCurto(origem, g.config.codigo ?? "")}
              qr={linkCurto(origem, g.config.codigo ?? "", true)} direto={destino(g)}
              onLigar={(v) => void ligar(g, v)} onEditar={() => setForm(formDe(g))}
              onApagar={() => { if (window.confirm(`Apagar o link “${g.config.nome || g.config.codigo}”? O QR impresso para de funcionar.`)) void apagarGatilho(g.id).then(carregar).catch((e) => notifyError(erroMsg(e, "Falhou."))); }} />
          ))}
        </div>
      )}
      {form && <ModalLink canal={canal} form={form} setForm={setForm} fluxos={fluxos} onSalvo={() => { setForm(null); void carregar(); }} />}
    </div>
  );
}

function CartaoLink({ g, fluxo, curto, qr, direto, onLigar, onEditar, onApagar }: {
  g: Gatilho; fluxo: Fluxo | null; curto: string; qr: string; direto: string | null;
  onLigar: (v: boolean) => void; onEditar: () => void; onApagar: () => void;
}) {
  const [dias, setDias] = useState<{ dia: string; total: number }[] | null>(null);
  const cliques = g.cliques ?? 0;
  const conversas = g.disparos ?? 0;
  const taxa = cliques ? Math.round((Math.min(conversas, cliques) / cliques) * 100) : null;
  const ligado = g.ativo && fluxo?.status === "ativo";
  const nomeArq = `qr-${g.config.codigo}`;
  return (
    <article className="mkt-card flex flex-col gap-3 p-4 sm:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <QrSvg texto={qr} />
        <div className="flex gap-1">
          <Botao variante="fantasma" onClick={() => baixarPng(qr, nomeArq)}>PNG</Botao>
          <Botao variante="fantasma" onClick={() => baixarSvg(qr, nomeArq)}>SVG</Botao>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-bold" style={{ color: "var(--ink)" }}>{g.config.nome || g.config.codigo}</h3>
            <div className="mt-0.5 flex flex-wrap gap-1">
              <Chip>{g.config.codigo}</Chip>
              {!ligado && <Chip cor="#6B7280">desligado</Chip>}
            </div>
          </div>
          <button type="button" role="switch" aria-checked={ligado} aria-label={ligado ? "Desligar link" : "Ligar link"} onClick={() => onLigar(!ligado)}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full" style={{ background: ligado ? COR : "var(--line)" }}>
            <span aria-hidden className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${ligado ? 22 : 2}px)` }} />
          </button>
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>Começa: <b>{fluxo?.nome ?? "(fluxo apagado)"}</b></p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini rotulo="Cliques" valor={String(cliques)} />
          <Mini rotulo="Conversas" valor={String(conversas)} />
          <Mini rotulo="Viraram conversa" valor={taxa === null ? "—" : `${taxa}%`} />
        </div>
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: "var(--ink3)" }}>{curto}</code>
          <Botao variante="fantasma" onClick={() => copiar(curto)}>Copiar link</Botao>
        </div>
        {!direto && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>O link curto só redireciona depois que a conta/número estiver conectado.</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <Botao onClick={onEditar}>Editar</Botao>
          {direto && <Botao variante="fantasma" onClick={() => copiar(direto)} title="Sem contar clique">Copiar link direto</Botao>}
          <Botao variante="fantasma" onClick={() => { if (dias) setDias(null); else void cliquesPorDia(g.id).then(setDias).catch(() => setDias([])); }}>{dias ? "Esconder dias" : "Cliques por dia"}</Botao>
          <span className="flex-1" />
          <Botao variante="perigo" onClick={onApagar}>Apagar</Botao>
        </div>
        {dias && (dias.length ? (
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]" style={{ color: "var(--ink2)" }}>
            {dias.map((d) => <li key={d.dia}>{d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}: <b>{d.total}</b></li>)}
          </ul>
        ) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhum clique nos últimos 30 dias.</p>)}
      </div>
    </article>
  );
}

function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: "var(--card2)" }}>
      <div className="text-[16px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{valor}</div>
      <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{rotulo}</div>
    </div>
  );
}

interface Form { id?: string; nome: string; codigo: string; texto: string; fluxo_id: string; resposta: string; codigoMexido: boolean }
const formNovo = (fluxoId: string): Form => ({ nome: "", codigo: "", texto: "Olá! Quero saber mais", fluxo_id: fluxoId, resposta: "Oi, {{primeiro_nome}}! Que bom te ver por aqui 😊 Como posso ajudar?", codigoMexido: false });
const formDe = (g: Gatilho): Form => ({ id: g.id, nome: g.config.nome ?? "", codigo: g.config.codigo ?? "", texto: g.config.texto ?? "", fluxo_id: g.fluxo_id, resposta: "", codigoMexido: true });

function ModalLink({ canal, form, setForm, fluxos, onSalvo }: { canal: Canal; form: Form; setForm: (f: Form | null) => void; fluxos: Fluxo[]; onSalvo: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const novoFluxo = form.fluxo_id === NOVO;
  const codigo = form.codigoMexido ? form.codigo : codigoDe(form.nome);

  async function salvar() {
    if (salvando) return;
    if (form.nome.trim().length < 2) { notifyError("Dê um nome ao link (ex.: Bio do Instagram)."); return; }
    if (!/^[a-z0-9_-]{2,40}$/.test(codigo)) { notifyError("Código: 2 a 40 letras minúsculas, números, - ou _."); return; }
    if (novoFluxo && !form.resposta.trim()) { notifyError("Escreva a primeira resposta."); return; }
    setSalvando(true);
    try {
      let fluxoId = form.fluxo_id;
      if (novoFluxo) {
        const f = await criarFluxo(`Link: ${form.nome.trim()}`, grafoDeRespostaSimples({ texto: form.resposta.trim(), link: null }), canal);
        await salvarFluxo(f.id, { status: "ativo" });
        fluxoId = f.id;
      }
      const config = canal === "instagram" ? { codigo, nome: form.nome.trim() } : { codigo, nome: form.nome.trim(), texto: form.texto.trim().slice(0, 200) };
      if (form.id) await mudarGatilho(form.id, { fluxo_id: fluxoId, config });
      else await criarGatilho({ fluxo_id: fluxoId, tipo: canal === "instagram" ? "ig_ref" : "link_ref", config, prioridade: 10 });
      notifySuccess("Link salvo.");
      onSalvo();
    } catch (e) { notifyError(erroMsg(e, "Não consegui salvar.")); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={form.id ? "Editar link" : "Novo link de entrada"} onFechar={() => setForm(null)} largura={620}
      rodape={<><Botao onClick={() => setForm(null)}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Nome (só o time vê)"><Entrada autoFocus value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Bio do Instagram, Live Peru, Panfleto feira…" /></Campo>
        <Campo rotulo="Código" dica={form.id ? "Mudar o código quebra o QR que já foi impresso." : "Vai no link: /e/<código>. Letras, números e hífen."}>
          <Entrada value={codigo} onChange={(e) => setForm({ ...form, codigo: codigoDe(e.target.value), codigoMexido: true })} />
        </Campo>
        {canal === "whatsapp" && (
          <Campo rotulo="Mensagem que já vem escrita" dica="A pessoa só aperta enviar. O código vai junto, escondido no fim ([ref:…])."><Entrada value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} /></Campo>
        )}
        <Campo rotulo="Começa o fluxo">
          <Selecao value={form.fluxo_id} onChange={(e) => setForm({ ...form, fluxo_id: e.target.value })}>
            <option value={NOVO}>+ Novo fluxo com uma mensagem</option>
            {fluxos.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.status !== "ativo" ? ` (${f.status})` : ""}</option>)}
          </Selecao>
        </Campo>
        {novoFluxo && (
          <Campo rotulo="Primeira resposta" dica="Depois dá pra caprichar no editor de fluxo (botões, perguntas, tags)."><AreaTexto rows={3} value={form.resposta} onChange={(e) => setForm({ ...form, resposta: e.target.value })} /></Campo>
        )}
        {canal === "instagram" && <Aviso>O link abre a DM com a conta da agência. Quem já conversava também dispara o fluxo (a Meta avisa pelo evento <code>messaging_referral</code>).</Aviso>}
      </div>
    </Modal>
  );
}
