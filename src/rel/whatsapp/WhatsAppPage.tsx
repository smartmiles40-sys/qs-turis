// src/rel/whatsapp/WhatsAppPage.tsx
// -----------------------------------------------------------------------------
// WHATSAPP DO RELACIONAMENTO (Bruno, 13/10/2026: "Comercial e Relacionamento
// são áreas diferentes — preciso conectar o WhatsApp (COEX) dentro deste
// painel"). Aqui fica TUDO do número do pós-venda: conectar pela janela da
// Meta (Coexistência: o número segue no app WhatsApp Business do celular),
// saúde do número, PIN, desconectar e os MODELOS de mensagem dele — cada número
// COEX tem a própria conta na Meta, com os próprios modelos.
//
// O número entra sempre com setor = relacionamento: as conversas caem no
// Atendimento daqui e nunca viram lead do Comercial. A tela do Comercial não
// mostra mais este número.
//
// Quem mexe: admin, ou gestor com acesso ao Relacionamento (a mesma regra das
// Configurações). O servidor confere de novo.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth, setoresDe } from "@/contexts/QsAuthContext";
import {
  carregarPainelMeta, conectarPelaMeta, copiarModelosDoOficial, desconectarNumeroMeta, registrarNumeroMeta, salvarConfigId,
  type NumeroMeta, type PainelMeta,
} from "@/lib/qs/metaConexao";
import { apontarWebhookDaMeta, criarModeloNaMeta, excluirModeloNaMeta, listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";

const QUALIDADE: Record<string, { txt: string; tom: "rel" | "aviso" | "erro" }> = {
  GREEN: { txt: "Qualidade alta", tom: "rel" },
  YELLOW: { txt: "Qualidade média", tom: "aviso" },
  RED: { txt: "Qualidade baixa — risco de bloqueio", tom: "erro" },
};
const LIMITE: Record<string, string> = {
  TIER_50: "50 conversas novas/dia", TIER_250: "250 conversas novas/dia", TIER_1K: "1.000 conversas novas/dia",
  TIER_10K: "10.000 conversas novas/dia", TIER_100K: "100.000 conversas novas/dia", TIER_UNLIMITED: "sem limite",
};
const STATUS_MODELO: Record<string, { txt: string; tom: "rel" | "aviso" | "erro" | "neutro" }> = {
  APPROVED: { txt: "Aprovado", tom: "rel" },
  PENDING: { txt: "Em análise", tom: "aviso" },
  REJECTED: { txt: "Recusado", tom: "erro" },
  PAUSED: { txt: "Pausado", tom: "aviso" },
  DISABLED: { txt: "Desativado", tom: "erro" },
};

function quando(iso: string | null | undefined) {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const msg = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

export default function WhatsAppPage() {
  const { currentUser } = useQsAuth();
  const pode = currentUser?.role === "admin" || (currentUser?.role === "gestor" && setoresDe(currentUser).includes("relacionamento"));
  const ehAdmin = currentUser?.role === "admin";

  const [painel, setPainel] = useState<PainelMeta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [explicar, setExplicar] = useState(false);
  const [configId, setConfigId] = useState("");

  const carregar = useCallback(async () => {
    if (!pode) return;
    try {
      const p = await carregarPainelMeta();
      setPainel(p);
      setConfigId(p.cadastro.configId || "");
      setErro(null);
    } catch (e) {
      setErro(msg(e, "Não consegui carregar os números."));
    }
  }, [pode]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function rodar(fn: () => Promise<string | void>) {
    setOcupado(true);
    setAviso(null);
    try {
      const ok = await fn();
      if (ok) setAviso({ tom: "ok", texto: ok });
      await carregar();
    } catch (e) {
      setAviso({ tom: "erro", texto: msg(e, "Não deu certo.") });
    } finally {
      setOcupado(false);
    }
  }

  if (!pode) {
    return (
      <div className="max-w-3xl">
        <Cabecalho />
        <Aviso>Só o admin ou um gestor do Relacionamento conecta e cuida do número de WhatsApp. Fale com o Bruno.</Aviso>
      </div>
    );
  }
  if (erro) {
    return (
      <div className="max-w-3xl space-y-3">
        <Cabecalho />
        <Aviso tom="erro">{erro}</Aviso>
        <Botao onClick={() => void carregar()}>Tentar de novo</Botao>
      </div>
    );
  }
  if (!painel) {
    return (
      <div className="max-w-3xl space-y-3" aria-busy="true">
        <Cabecalho />
        <div className="rel-card h-40 animate-pulse" />
      </div>
    );
  }

  const numeros = painel.numeros.filter((n) => n.setor === "relacionamento");
  const pronto = Boolean(painel.cadastro.appId && painel.cadastro.configId && painel.cadastro.podeTrocarCodigo);
  const entrada = painel.entrada;

  const conectar = () => rodar(async () => {
    if (!painel.cadastro.appId || !painel.cadastro.configId) throw new Error("Falta a configuração do botão da Meta.");
    const r = await conectarPelaMeta({ appId: painel.cadastro.appId, configId: painel.cadastro.configId, userId: null, setor: "relacionamento" });
    setExplicar(false);
    return `Conectado: ${r.numero || "número"}.${r.avisos.length ? ` Avisos: ${r.avisos.join(" · ")}` : ""} Mande um "oi" de outro celular pra testar.`;
  });

  return (
    <div className="max-w-4xl space-y-5">
      <Cabecalho />

      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}

      {entrada && numeros.length > 0 && (
        entrada.ok
          ? <Aviso tom="ok">As mensagens dos clientes estão chegando (último sinal da Meta: {quando(entrada.ultimoValidoEm)}).</Aviso>
          : (
            <Aviso>
              <span className="font-semibold">A Meta não está entregando as mensagens ao QS.</span>{" "}
              {ehAdmin && (
                <Botao className="ml-2" disabled={ocupado} onClick={() => void rodar(async () => {
                  const r = await apontarWebhookDaMeta();
                  if (!r.ok) throw new Error(r.error || "A Meta recusou.");
                  return `Webhook apontado para ${r.callbackUrl}. Mande um "oi" pro número pra testar.`;
                })}>Apontar o webhook da Meta</Botao>
              )}
            </Aviso>
          )
      )}

      {!pronto && (
        <Aviso>
          O botão de conectar está travado: falta{" "}
          {!painel.cadastro.appId ? "o META_CALLS_APP_ID na Vercel"
            : !painel.cadastro.podeTrocarCodigo ? "o META_CALLS_APP_SECRET na Vercel"
            : "o ID da configuração da Meta (quadro lá embaixo)"}.
        </Aviso>
      )}

      {numeros.length === 0 ? (
        <div className="rel-card p-6">
          <Vazio
            titulo="Nenhum WhatsApp do Relacionamento conectado"
            texto="Conecte o número do pós-venda. Ele continua no app WhatsApp Business do celular, e as conversas aparecem também no Atendimento daqui."
            acao={<Botao variante="primario" disabled={!pronto || ocupado} onClick={() => setExplicar(true)}>Conectar WhatsApp (COEX)</Botao>}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {numeros.map((n) => (
            <CartaoNumero key={n.phoneId} n={n} ocupado={ocupado} pronto={pronto}
              onReconectar={() => setExplicar(true)}
              onRegistrar={() => {
                const pin = window.prompt("Crie um PIN de 6 números para este número (anote — é a verificação em duas etapas dele):") || "";
                if (!pin) return;
                if (!/^\d{6}$/.test(pin)) { setAviso({ tom: "erro", texto: "O PIN tem 6 números." }); return; }
                void rodar(async () => { await registrarNumeroMeta(n.phoneId, pin); return "Número registrado na Cloud API."; });
              }}
              onDesconectar={() => {
                if (!window.confirm(`Desconectar ${n.numero || n.phoneId} do QS? O Relacionamento para de enviar e receber por este número (o celular continua funcionando).`)) return;
                void rodar(async () => { await desconectarNumeroMeta(n.phoneId); return "Número desconectado do QS."; });
              }}
            />
          ))}
          <Botao disabled={!pronto || ocupado} onClick={() => setExplicar(true)}>+ Conectar outro número do Relacionamento</Botao>
        </div>
      )}

      {numeros.filter((n) => n.status === "conectado").map((n) => (
        <ModelosDoNumero key={`m-${n.phoneId}`} n={n} onCopiar={() => void rodar(async () => {
          const r = await copiarModelosDoOficial(n.phoneId);
          if (r.mesmaConta) return "Este número usa a mesma conta do oficial — os modelos já são os mesmos.";
          const midia = (r.pulados || []).filter((p) => p.motivo !== "já existe");
          const partes = [`${r.criados?.length || 0} modelo(s) enviados pra aprovação da Meta.`];
          if (midia.length) partes.push(`Com mídia no topo, criar à mão: ${midia.map((p) => p.nome).join(", ")}.`);
          if (r.erros?.length) partes.push(`A Meta recusou: ${r.erros.map((e) => `${e.nome} (${e.detalhe})`).join(" · ")}`);
          return partes.join(" ");
        })} ocupadoFora={ocupado} />
      ))}

      {ehAdmin && (
        <details className="rel-card p-4">
          <summary className="text-sm font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>Configuração do botão da Meta (feita uma vez, vale pras duas áreas)</summary>
          <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>
            developers.facebook.com → o app → Login do Facebook para Empresas → Configurações → configuração do tipo
            "Cadastro incorporado do WhatsApp". Cole o ID dela aqui.
          </p>
          <div className="flex gap-2 mt-2">
            <Entrada value={configId} onChange={(e) => setConfigId(e.target.value.replace(/\D/g, ""))} placeholder="ID da configuração" inputMode="numeric" />
            <Botao variante="primario" disabled={ocupado || configId === (painel.cadastro.configId || "")}
              onClick={() => void rodar(async () => { await salvarConfigId(configId); return "Configuração salva."; })}>Salvar</Botao>
          </div>
        </details>
      )}

      <Modal aberto={explicar} titulo="Conectar o WhatsApp do Relacionamento" onFechar={() => !ocupado && setExplicar(false)}
        rodape={<>
          <Botao disabled={ocupado} onClick={() => setExplicar(false)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado || !pronto} onClick={() => void conectar()}>{ocupado ? "Conectando…" : "Abrir a janela da Meta"}</Botao>
        </>}>
        <ol className="text-sm space-y-2 list-decimal pl-5" style={{ color: "var(--ink2)" }}>
          <li>O número precisa estar no app <b>WhatsApp Business</b> (não no WhatsApp comum), no celular do pós-venda.</li>
          <li>Na janela da Meta, entre com o Facebook da empresa e digite esse número.</li>
          <li>A Meta mostra um QR: leia <b>no app WhatsApp Business</b> do celular (Configurações → Dispositivos conectados).</li>
          <li>Pronto: o número segue no celular e as conversas aparecem também no Atendimento do Relacionamento.</li>
        </ol>
        <p className="text-[12px] mt-3" style={{ color: "var(--ink3)" }}>
          Este número fica só no Relacionamento — as conversas dele nunca viram lead do Comercial.
        </p>
      </Modal>
    </div>
  );
}

function Cabecalho() {
  return (
    <header className="mb-1">
      <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>WhatsApp do Relacionamento</h1>
      <p className="text-sm mt-1" style={{ color: "var(--ink2)" }}>
        Conexão oficial da Meta por Coexistência (COEX): o número continua no celular e as conversas chegam no Atendimento.
      </p>
    </header>
  );
}

function CartaoNumero({ n, ocupado, pronto, onReconectar, onRegistrar, onDesconectar }: {
  n: NumeroMeta; ocupado: boolean; pronto: boolean;
  onReconectar: () => void; onRegistrar: () => void; onDesconectar: () => void;
}) {
  const ligado = n.status === "conectado";
  const q = n.qualidade ? QUALIDADE[n.qualidade] : null;
  return (
    <div className="rel-card p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold tabular-nums" style={{ color: "var(--ink)" }}>{n.numero || n.phoneId}</div>
          <div className="text-[13px]" style={{ color: "var(--ink3)" }}>{n.nome || "—"} · WhatsApp Business no celular + QS</div>
        </div>
        <Etiqueta tom={ligado ? "rel" : "erro"}>{ligado ? "Conectado" : "Desconectado"}</Etiqueta>
      </div>
      <div className="flex flex-wrap gap-2 text-[12px]">
        {q && <Etiqueta tom={q.tom}>{q.txt}</Etiqueta>}
        {n.limite && <Etiqueta>{LIMITE[n.limite] || n.limite}</Etiqueta>}
        <Etiqueta>Última mensagem de cliente: {quando(n.ultimaEntrada)}</Etiqueta>
      </div>
      {n.metaErro && <Aviso tom="erro">A Meta respondeu: {n.metaErro}</Aviso>}
      {ligado && n.statusMeta && n.statusMeta !== "CONNECTED" && (
        <Aviso>
          Na Meta este número está <b>{n.statusMeta}</b> — ainda não envia nem recebe.{" "}
          <Botao className="ml-2" disabled={ocupado} onClick={onRegistrar}>Registrar com PIN</Botao>
        </Aviso>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao variante={ligado ? "secundario" : "primario"} disabled={!pronto || ocupado} onClick={onReconectar}>{ligado ? "Reconectar" : "Conectar"}</Botao>
        {ligado && <Botao variante="perigo" disabled={ocupado} onClick={onDesconectar}>Desconectar</Botao>}
      </div>
    </div>
  );
}

// ── Modelos de mensagem do número ───────────────────────────────────────────
// Fora da janela de 24h (ou na 1ª mensagem) a Meta só deixa enviar modelo
// APROVADO. Os disparos e automações do Relacionamento usam estes.

const NOME_OK = /^[a-z0-9_]{1,512}$/;

function ModelosDoNumero({ n, onCopiar, ocupadoFora }: { n: NumeroMeta; onCopiar: () => void; ocupadoFora: boolean }) {
  const [modelos, setModelos] = useState<WaModeloAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ nome: "", categoria: "UTILITY" as "UTILITY" | "MARKETING", corpo: "", rodape: "" });
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarModelosAdmin(n.phoneId);
    setModelos(r.modelos);
    setErro(r.error || null);
  }, [n.phoneId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    const nome = form.nome.trim().toLowerCase().replace(/\s+/g, "_");
    if (!NOME_OK.test(nome)) { setErroForm("Nome só com letras minúsculas, números e _ (ex.: lembrete_embarque)."); return; }
    if (form.corpo.trim().length < 5) { setErroForm("Escreva o texto da mensagem."); return; }
    setSalvando(true);
    setErroForm(null);
    const r = await criarModeloNaMeta({ nome, categoria: form.categoria, idioma: "pt_BR", corpo: form.corpo.trim(), rodape: form.rodape.trim() || undefined }, n.phoneId);
    setSalvando(false);
    if (!r.ok) { setErroForm(r.error || "A Meta recusou."); return; }
    setNovo(false);
    setForm({ nome: "", categoria: "UTILITY", corpo: "", rodape: "" });
    await carregar();
  }

  async function excluir(m: WaModeloAdmin) {
    if (!window.confirm(`Excluir o modelo "${m.nome}" na Meta? Disparos e automações que usam ele param de funcionar.`)) return;
    const r = await excluirModeloNaMeta(m.nome, n.phoneId);
    if (!r.ok) setErro(r.error || "Não consegui excluir.");
    await carregar();
  }

  return (
    <section className="rel-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>Modelos de mensagem — {n.numero || n.phoneId}</h2>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            Fora das 24h depois da última mensagem do cliente, a Meta só deixa enviar modelo aprovado. Use {"{{1}}"}, {"{{2}}"}… pros campos que mudam (nome, destino).
          </p>
        </div>
        <div className="flex gap-2">
          <Botao disabled={ocupadoFora} onClick={onCopiar}>Copiar modelos do Comercial</Botao>
          <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo modelo</Botao>
        </div>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {modelos === null ? <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--line)" }} /> :
        modelos.length === 0 ? <p className="text-sm" style={{ color: "var(--ink3)" }}>Nenhum modelo nesta conta ainda.</p> : (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {modelos.map((m) => {
              const s = STATUS_MODELO[m.status] || { txt: m.status, tom: "neutro" as const };
              return (
                <li key={m.id || m.nome} className="py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{m.nome}</span>
                      <Etiqueta tom={s.tom}>{s.txt}</Etiqueta>
                      <Etiqueta>{m.categoria === "MARKETING" ? "Marketing" : m.categoria === "UTILITY" ? "Utilidade" : m.categoria}</Etiqueta>
                    </div>
                    <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{m.corpo}</p>
                    {m.motivo && <p className="text-[12px] mt-1" style={{ color: "var(--err-ink)" }}>Motivo da Meta: {m.motivo}</p>}
                  </div>
                  <Botao variante="fantasma" aria-label={`Excluir o modelo ${m.nome}`} onClick={() => void excluir(m)}>Excluir</Botao>
                </li>
              );
            })}
          </ul>
        )}

      <Modal aberto={novo} titulo="Novo modelo de mensagem" onFechar={() => !salvando && setNovo(false)}
        rodape={<>
          <Botao disabled={salvando} onClick={() => setNovo(false)}>Cancelar</Botao>
          <Botao variante="primario" disabled={salvando} onClick={() => void criar()}>{salvando ? "Enviando…" : "Enviar pra aprovação da Meta"}</Botao>
        </>}>
        <div className="space-y-3">
          <Campo rotulo="Nome (só minúsculas, números e _)" dica="Ex.: lembrete_embarque, feliz_aniversario">
            <Entrada value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="lembrete_embarque" />
          </Campo>
          <Campo rotulo="Tipo" dica="Utilidade = aviso da viagem (aprova mais fácil). Marketing = oferta, data especial.">
            <select className="rel-input w-full" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value as "UTILITY" | "MARKETING" })}>
              <option value="UTILITY">Utilidade</option>
              <option value="MARKETING">Marketing</option>
            </select>
          </Campo>
          <Campo rotulo="Texto" dica={'Ex.: "Olá {{1}}! Faltam 7 dias pro seu embarque para {{2}}. Qualquer dúvida, é só chamar aqui."'}>
            <textarea className="rel-input w-full" rows={5} value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} />
          </Campo>
          <Campo rotulo="Rodapé (opcional)">
            <Entrada value={form.rodape} onChange={(e) => setForm({ ...form, rodape: e.target.value })} placeholder="Se Tu For, Eu Vou! Viagens" />
          </Campo>
          {erroForm && <Aviso tom="erro">{erroForm}</Aviso>}
        </div>
      </Modal>
    </section>
  );
}
