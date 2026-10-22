// src/closer/ContratoConfigPage.tsx
// -----------------------------------------------------------------------------
// CONFIGURAR CONTRATO (gestão do Comercial / admin) — 0180, 22/10/2026.
// O contrato sai 100% pelo código do QS (sem n8n). Aqui a gestão:
//   1. conecta a conta Google que tem os templates e a pasta (OAuth do QS);
//   2. informa os IDs dos templates (pacote e expedição) e da pasta do Drive;
//   3. informa o assinante fixo da agência;
//   4. vê se o ZapSign está pronto (token e segredo do webhook ficam na Vercel)
//      e copia a URL do webhook pra colar no painel do ZapSign.
// Segredos NUNCA passam por aqui: o refresh token do Google fica no banco só
// pro servidor; os tokens do ZapSign ficam nas envs da Vercel.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta } from "@/rel/ui";
import { dataHoraBr } from "./lib";
import {
  conectarGoogle, desconectarGoogle, salvarConfigContrato, situacaoDoContrato, testarZapsign,
  type ConfigContrato, type SituacaoContrato,
} from "./contrato";

const RETORNO: Record<string, { tom: "ok" | "erro"; t: string }> = {
  conectado: { tom: "ok", t: "Conta Google conectada." },
  "erro-estado": { tom: "erro", t: "O link de conexão expirou (vale 15 min). Clique em Conectar de novo." },
  "erro-negado": { tom: "erro", t: "A conexão foi cancelada na tela do Google." },
  "erro-permissao": { tom: "erro", t: "Só a gestão do Comercial conecta a conta Google." },
  "erro-google": { tom: "erro", t: "O Google recusou a conexão — veja o erro abaixo." },
};

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 items-start text-[13px]" style={{ color: "var(--ink)" }}>
      <span aria-hidden className="mt-0.5 font-bold" style={{ color: ok ? "var(--rel-ink)" : "var(--err-ink)" }}>{ok ? "✓" : "✗"}</span>
      <span>{children}</span>
    </li>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex gap-2 items-center">
      <code className="text-[12px] px-2 py-1 rounded break-all flex-1" style={{ background: "var(--card2)", color: "var(--ink)" }}>{texto}</code>
      <Botao onClick={() => void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}>{ok ? "Copiado" : "Copiar"}</Botao>
    </div>
  );
}

export default function ContratoConfigPage({ retorno }: { retorno?: string | null }) {
  const [s, setS] = useState<SituacaoContrato | null>(null);
  const [cfg, setCfg] = useState<ConfigContrato | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(retorno && RETORNO[retorno] ? RETORNO[retorno] : null);
  const [ocupado, setOcupado] = useState(false);

  const aplicar = (x: SituacaoContrato) => { setS(x); setCfg(x.config); };
  useEffect(() => { situacaoDoContrato().then(aplicar).catch((e) => setAviso({ tom: "erro", t: (e as Error).message })); }, []);

  async function rodar(f: () => Promise<void>) {
    setOcupado(true);
    setAviso(null);
    try { await f(); } catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); } finally { setOcupado(false); }
  }

  if (!s || !cfg) return <div className="max-w-3xl">{aviso ? <Aviso tom={aviso.tom}>{aviso.t}</Aviso> : <p className="text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>}</div>;
  if (!s.podeConfigurar) return <Aviso>Só a gestão do Comercial e o admin configuram o contrato.</Aviso>;

  const mudar = (k: keyof ConfigContrato, v: string) => setCfg({ ...cfg, [k]: v });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold flex-1" style={{ color: "var(--ink)" }}>Configurar contrato</h1>
        <Etiqueta tom={s.modo === "automatico" ? "rel" : "aviso"}>{s.modo === "automatico" ? "Envio automático LIGADO" : "Modo manual"}</Etiqueta>
      </div>
      {aviso && <Aviso tom={aviso.tom}>{aviso.t}</Aviso>}
      <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
        O QS gera o contrato sozinho (sem n8n): copia o modelo do Google Docs, preenche, salva o PDF na pasta do Drive e manda pelo
        ZapSign pro cliente e pro assinante da agência. Passo a passo completo em <b>docs/CONTRATO.md</b>.
      </p>

      {/* ── 1. Google ── */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>1. Conta Google (templates e pasta)</h2>
        <ul className="space-y-1">
          <Item ok={s.google.clienteConfigurado}>GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET na Vercel</Item>
          <Item ok={s.google.conectado}>
            {s.google.conectado ? <>Conectada: <b>{s.google.email || "conta sem e-mail"}</b>{s.google.conectadoEm ? ` (desde ${dataHoraBr(s.google.conectadoEm)})` : ""}</> : "Conta conectada"}
          </Item>
        </ul>
        {s.google.ultimoErro && <Aviso tom="erro">Último erro do Google: {s.google.ultimoErro}</Aviso>}
        <div>
          <p className="text-[12px] mb-1" style={{ color: "var(--ink3)" }}>URL de retorno (cadastre em "URIs de redirecionamento autorizados" do cliente OAuth no Google Cloud):</p>
          <Copiar texto={s.redirectUri} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao variante="primario" disabled={ocupado || !s.google.clienteConfigurado}
            onClick={() => void rodar(async () => { const { url } = await conectarGoogle(); window.location.href = url; })}>
            {s.google.conectado ? "Conectar outra conta Google" : "Conectar conta Google"}
          </Botao>
          {s.google.conectado && (
            <Botao variante="perigo" disabled={ocupado} onClick={() => void rodar(async () => {
              if (!window.confirm("Desconectar a conta Google? O contrato volta pro modo manual até conectar de novo.")) return;
              aplicar(await desconectarGoogle());
              setAviso({ tom: "ok", t: "Conta Google desconectada." });
            })}>Desconectar</Botao>
          )}
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Use a conta que é dona (ou editora) dos modelos e da pasta dos contratos. Na tela do Google, marque Drive e Docs.</p>
      </section>

      {/* ── 2. Templates, pasta e assinante ── */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>2. Modelos, pasta e assinante da agência</h2>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>O ID é o pedaço do link entre <code>/d/</code> e <code>/edit</code> (ou depois de <code>/folders/</code> na pasta).</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="ID do modelo de PACOTE"><Entrada value={cfg.template_pacote} onChange={(e) => mudar("template_pacote", e.target.value)} /></Campo>
          <Campo rotulo="ID do modelo de EXPEDIÇÃO"><Entrada value={cfg.template_expedicao} onChange={(e) => mudar("template_expedicao", e.target.value)} /></Campo>
          <Campo rotulo="ID da pasta dos contratos (Drive)"><Entrada value={cfg.pasta_contratos} onChange={(e) => mudar("pasta_contratos", e.target.value)} /></Campo>
          <div />
          <Campo rotulo="Assinante da agência — nome"><Entrada value={cfg.assinante_nome} onChange={(e) => mudar("assinante_nome", e.target.value)} /></Campo>
          <Campo rotulo="Assinante — e-mail"><Entrada type="email" value={cfg.assinante_email} onChange={(e) => mudar("assinante_email", e.target.value)} /></Campo>
          <Campo rotulo="Assinante — telefone" dica="Com DDI: 5585987660748"><Entrada value={cfg.assinante_telefone} onChange={(e) => mudar("assinante_telefone", e.target.value)} /></Campo>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Sempre os mesmos nome, e-mail e telefone — assim o ZapSign reaproveita o contato do assinante em vez de criar outro.</p>
        <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(async () => { aplicar(await salvarConfigContrato(cfg)); setAviso({ tom: "ok", t: "Configuração salva." }); })}>Salvar</Botao>
      </section>

      {/* ── 3. ZapSign ── */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>3. ZapSign</h2>
        <ul className="space-y-1">
          <Item ok={s.zapsign.token}>ZAPSIGN_API_TOKEN na Vercel{s.zapsign.sandbox ? " (SANDBOX — ZAPSIGN_API_URL de teste)" : ""}</Item>
          <Item ok={s.zapsign.webhookSecret}>ZAPSIGN_WEBHOOK_SECRET na Vercel</Item>
        </ul>
        <div>
          <p className="text-[12px] mb-1" style={{ color: "var(--ink3)" }}>
            No ZapSign (Configurações → Integração → Webhooks), cadastre esta URL e um header <b>X-QS-Secret</b> com o mesmo valor do ZAPSIGN_WEBHOOK_SECRET:
          </p>
          <Copiar texto={s.webhookUrl} />
        </div>
        <Botao disabled={ocupado || !s.zapsign.token} onClick={() => void rodar(async () => {
          const r = await testarZapsign();
          setAviso(r.ok ? { tom: "ok", t: "ZapSign respondeu: token OK." } : { tom: "erro", t: r.erro || "O ZapSign recusou o token." });
        })}>Testar o token do ZapSign</Botao>
      </section>

      {s.falta.length > 0 && (
        <Aviso>
          <b>Falta pra ligar o envio automático:</b>
          <ul className="list-disc ml-5 mt-1">{s.falta.map((f) => <li key={f}>{f}</li>)}</ul>
        </Aviso>
      )}
      <Aviso>
        <b>Depois que o QS estiver mandando contrato:</b> desligue o robô do Bitrix que chama o n8n de contrato (senão sai contrato em dobro) e
        revogue no ZapSign o token antigo que estava no n8n.
      </Aviso>
    </div>
  );
}
