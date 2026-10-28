// src/closer/ContratoConfigPage.tsx
// -----------------------------------------------------------------------------
// CONFIGURAR CONTRATO (gestão do Comercial / admin) — 0180, 22/10/2026.
// O contrato sai 100% pelo código do QS (sem n8n e, desde 27/10, sem Google):
// os modelos de pacote e expedição moram em api/_contratoModelo.js (texto do
// jurídico, intocado). Aqui a gestão:
//   1. informa o assinante fixo da agência;
//   2. vê se o ZapSign está pronto (token e segredo do webhook ficam na Vercel)
//      e copia a URL do webhook (já com o segredo) pra colar no ZapSign.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta } from "@/rel/ui";
import {
  salvarConfigContrato, situacaoDoContrato, testarZapsign,
  type ConfigContrato, type SituacaoContrato,
} from "./contrato";

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

export default function ContratoConfigPage() {
  const [s, setS] = useState<SituacaoContrato | null>(null);
  const [cfg, setCfg] = useState<ConfigContrato | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
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
        O QS gera o contrato sozinho, sem Google e sem n8n: monta o PDF pelo modelo aprovado pelo jurídico (pacote ou expedição),
        com os dados da venda que o closer confere na prévia, guarda uma cópia no QS e manda pelo ZapSign pro cliente e pro
        assinante da agência. Passo a passo completo em <b>docs/CONTRATO.md</b>.
      </p>

      {/* ── 1. Assinante ── */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>1. Assinante da agência</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Assinante da agência — nome"><Entrada value={cfg.assinante_nome} onChange={(e) => mudar("assinante_nome", e.target.value)} /></Campo>
          <Campo rotulo="Assinante — e-mail"><Entrada type="email" value={cfg.assinante_email} onChange={(e) => mudar("assinante_email", e.target.value)} /></Campo>
          <Campo rotulo="Assinante — telefone" dica="Com DDI: 5585987660748"><Entrada value={cfg.assinante_telefone} onChange={(e) => mudar("assinante_telefone", e.target.value)} /></Campo>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Sempre os mesmos nome, e-mail e telefone — assim o ZapSign reaproveita o contato do assinante em vez de criar outro.</p>
        <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(async () => { aplicar(await salvarConfigContrato(cfg)); setAviso({ tom: "ok", t: "Configuração salva." }); })}>Salvar</Botao>
      </section>

      {/* ── 2. ZapSign ── */}
      <section className="rel-card p-4 space-y-3">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>2. ZapSign</h2>
        <ul className="space-y-1">
          <Item ok={s.zapsign.token}>ZAPSIGN_API_TOKEN na Vercel{s.zapsign.sandbox ? " (SANDBOX — ZAPSIGN_API_URL de teste)" : ""}</Item>
          <Item ok={s.zapsign.webhookSecret}>ZAPSIGN_WEBHOOK_SECRET na Vercel</Item>
        </ul>
        <div>
          <p className="text-[12px] mb-1" style={{ color: "var(--ink3)" }}>
            No ZapSign (Configurações → Integração → Webhooks), cadastre esta URL com o evento "Todos (documentos)". O segredo já vai
            no fim (<code>&amp;s=</code>) — não precisa de header. Não compartilhe este link.
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
