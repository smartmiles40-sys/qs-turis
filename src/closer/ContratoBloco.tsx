// src/closer/ContratoBloco.tsx
// -----------------------------------------------------------------------------
// O CONTRATO dentro do cartão do closer (0180, 22/10/2026 — sem n8n).
//
//   • "Enviar contrato" abre a PRÉVIA: os campos que vão no contrato, puxados
//     da venda consolidada + proposta aprovada + ficha do cliente + Bitrix +
//     lead (cada um diz de onde veio). O closer corrige o que faltar e manda.
//   • O SERVIDOR gera pelo Google, arquiva o PDF no Drive e cria no ZapSign.
//     O webhook do ZapSign devolve: cliente abriu → assinou / recusou — e o
//     cartão anda sozinho.
//   • Sem Google/ZapSign configurados: MODO MANUAL (colar o link de
//     assinatura, marcar assinado e colar o link do PDF).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { dataHoraBr, type Negocio } from "./lib";
import {
  NOME_STATUS_CONTRATO, ROTULOS, TOM_STATUS_CONTRATO, atualizarContrato, cancelarContrato, contratoManual, enviarContrato,
  enviosDoCartao, errosDoContrato, previaDoContrato, situacaoDoContrato,
  type CamposContrato, type EnvioContrato, type Previa, type SituacaoContrato,
} from "./contrato";

function LinkCopiavel({ rotulo, url }: { rotulo: string; url: string }) {
  const [copiou, setCopiou] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span style={{ color: "var(--ink2)" }}>{rotulo}:</span>
      <a href={url} target="_blank" rel="noreferrer" className="font-semibold underline truncate max-w-[260px]" style={{ color: "var(--rel-ink)" }}>abrir</a>
      <button type="button" className="text-[12px] underline" style={{ color: "var(--ink3)" }}
        onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopiou(true); setTimeout(() => setCopiou(false), 1500); }); }}>
        {copiou ? "copiado" : "copiar"}
      </button>
    </div>
  );
}

export default function ContratoBloco({ negocio, onMudou }: { negocio: Negocio; onMudou: () => void }) {
  const [envios, setEnvios] = useState<EnvioContrato[]>([]);
  const [sit, setSit] = useState<SituacaoContrato | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previaAberta, setPreviaAberta] = useState(false);
  const [manual, setManual] = useState<null | "enviado" | "assinado" | "cancelar">(null);
  const [texto, setTexto] = useState("");

  const carregar = useCallback(async () => {
    try { setEnvios(await enviosDoCartao(negocio.id)); } catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
  }, [negocio.id]);
  useEffect(() => { void carregar(); }, [carregar, negocio.status_contrato]);
  useEffect(() => { void situacaoDoContrato().then(setSit).catch(() => setSit(null)); }, []);

  const atual = envios.find((e) => !["erro", "cancelado"].includes(e.status)) ?? null;
  const ultimoErro = envios[0]?.status === "erro" ? envios[0] : null;
  const automatico = sit?.modo === "automatico";
  const perdido = negocio.etapa === "perdido";

  async function rodar(f: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    setAviso(null);
    try { await f(); if (ok) setAviso({ tom: "ok", t: ok }); await carregar(); onMudou(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  return (
    <section className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Contrato</h2>
        {!perdido && atual?.status !== "assinado" && (
          <Botao variante={atual ? "secundario" : "primario"} disabled={ocupado} onClick={() => setPreviaAberta(true)}>
            {atual ? "Reenviar contrato" : "Enviar contrato"}
          </Botao>
        )}
      </div>
      {aviso && <div className="mb-2"><Aviso tom={aviso.tom}>{aviso.t}</Aviso></div>}

      {sit && !automatico && (
        <div className="mb-3">
          <Aviso>
            <b>Envio automático ainda não configurado — use o modo manual.</b>
            <ul className="list-disc ml-5 mt-1">{sit.falta.map((f) => <li key={f}>{f}</li>)}</ul>
            {sit.podeConfigurar && <a href="#closer/contrato" className="underline font-semibold">Configurar contrato</a>}
          </Aviso>
        </div>
      )}

      {!atual && !ultimoErro && (
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Nenhum contrato enviado. {automatico ? "O QS gera o contrato pelo modelo, guarda o PDF no Drive e manda pelo ZapSign — o cliente recebe por e-mail." : ""}
        </p>
      )}

      {ultimoErro && (
        <div className="mb-3">
          <Aviso tom="erro">
            <b>O último envio falhou ({dataHoraBr(ultimoErro.criado_em)}):</b> {ultimoErro.erro}
            {ultimoErro.drive_pdf_url && <> · <a className="underline" href={ultimoErro.drive_pdf_url} target="_blank" rel="noreferrer">PDF gerado</a></>}
          </Aviso>
        </div>
      )}

      {atual && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Etiqueta tom={TOM_STATUS_CONTRATO[atual.status]}>{NOME_STATUS_CONTRATO[atual.status]}</Etiqueta>
            <span style={{ color: "var(--ink2)" }}>
              {atual.tipo === "expedicao" ? "Expedição" : "Pacote"} · {atual.modo === "manual" ? "enviado por fora" : "ZapSign"}
              {atual.enviado_em ? ` · enviado ${dataHoraBr(atual.enviado_em)}` : ""}
              {atual.enviado_por_user?.name ? ` por ${atual.enviado_por_user.name.split(" ")[0]}` : ""}
            </span>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {atual.visualizado_em ? `Cliente abriu ${atual.visualizacoes > 1 ? `${atual.visualizacoes}x` : ""} (última ${dataHoraBr(atual.visualizado_em)})` : atual.status !== "assinado" ? "O cliente ainda não abriu." : ""}
            {atual.assinado_em ? ` · assinou ${dataHoraBr(atual.assinado_em)}` : ""}
            {atual.recusado_em ? ` · recusou ${dataHoraBr(atual.recusado_em)}` : ""}
          </p>
          {atual.link_assinatura && <LinkCopiavel rotulo="Link de assinatura do cliente" url={atual.link_assinatura} />}
          {atual.drive_pdf_url && <LinkCopiavel rotulo="PDF no Drive" url={atual.drive_pdf_url} />}
          {atual.pdf_assinado_url && <LinkCopiavel rotulo="PDF assinado" url={atual.pdf_assinado_url} />}
          <div className="flex flex-wrap gap-2 pt-1">
            {atual.zapsign_token && atual.status !== "assinado" && (
              <Botao disabled={ocupado} onClick={() => void rodar(async () => { await atualizarContrato(atual.id); }, "Status conferido no ZapSign.")}>Atualizar status</Botao>
            )}
            {atual.status !== "assinado" && !perdido && (
              <Botao variante="fantasma" disabled={ocupado} onClick={() => { setTexto(""); setManual("assinado"); }}>Assinou por fora</Botao>
            )}
            {atual.status !== "assinado" && (
              <Botao variante="perigo" disabled={ocupado} onClick={() => { setTexto(""); setManual("cancelar"); }}>Cancelar contrato</Botao>
            )}
          </div>
        </div>
      )}

      {!perdido && !atual && (
        <div className="flex flex-wrap gap-2 mt-3">
          <Botao variante="fantasma" disabled={ocupado} onClick={() => { setTexto(""); setManual("enviado"); }}>Mandei por fora (colar link)</Botao>
          <Botao variante="fantasma" disabled={ocupado} onClick={() => { setTexto(""); setManual("assinado"); }}>Já está assinado</Botao>
        </div>
      )}

      {envios.length > 1 && (
        <details className="mt-3">
          <summary className="text-[12px] cursor-pointer" style={{ color: "var(--ink3)" }}>Envios anteriores ({envios.length - 1})</summary>
          <ul className="mt-1 space-y-1">
            {envios.filter((e) => e.id !== atual?.id).map((e) => (
              <li key={e.id} className="text-[12px]" style={{ color: "var(--ink2)" }}>
                {dataHoraBr(e.criado_em)} · {NOME_STATUS_CONTRATO[e.status]} · {e.modo === "manual" ? "por fora" : "ZapSign"}{e.erro ? ` — ${e.erro.slice(0, 160)}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {previaAberta && (
        <PreviaContrato negocio={negocio} jaTemAtivo={Boolean(atual)} onFechar={() => setPreviaAberta(false)}
          onEnviado={(msg, tom) => { setPreviaAberta(false); setAviso({ tom, t: msg }); void carregar(); onMudou(); }} />
      )}

      <Modal aberto={manual !== null} onFechar={() => setManual(null)}
        titulo={manual === "enviado" ? "Contrato enviado por fora" : manual === "assinado" ? "Contrato assinado" : "Cancelar contrato"}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setManual(null)}>Voltar</Botao>
          <Botao variante={manual === "cancelar" ? "perigo" : "primario"} disabled={ocupado || (manual === "enviado" && !/^https?:\/\//i.test(texto.trim()))}
            onClick={() => {
              const acao = manual!;
              const t = texto.trim();
              setManual(null);
              if (acao === "cancelar" && atual?.zapsign_token) void rodar(() => cancelarContrato(atual.id, t), "Contrato cancelado (e apagado no ZapSign).");
              else void rodar(() => contratoManual(negocio.id, acao, t || undefined),
                acao === "enviado" ? "Contrato marcado como enviado." : acao === "assinado" ? "Contrato marcado como assinado." : "Contrato cancelado.");
            }}>
            {manual === "enviado" ? "Marcar como enviado" : manual === "assinado" ? "Marcar assinado" : "Cancelar contrato"}
          </Botao>
        </>}>
        <Campo rotulo={manual === "enviado" ? "Link de assinatura que você mandou ao cliente" : manual === "assinado" ? "Link do PDF assinado (opcional — Drive, ZapSign…)" : "Motivo (opcional)"}>
          <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={manual === "cancelar" ? "Ex.: valores mudaram" : "https://"} autoFocus />
        </Campo>
        {manual === "assinado" && <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>O cartão vai para "Contrato assinado".</p>}
      </Modal>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PRÉVIA E ENVIO
// ═════════════════════════════════════════════════════════════════════════════
function PreviaContrato({ negocio, jaTemAtivo, onFechar, onEnviado }: {
  negocio: Negocio; jaTemAtivo: boolean; onFechar: () => void; onEnviado: (msg: string, tom: "ok" | "aviso" | "erro") => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [c, setC] = useState<CamposContrato | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmarSubstituir, setConfirmarSubstituir] = useState(false);

  useEffect(() => {
    let vivo = true;
    previaDoContrato(negocio.id)
      .then((p) => { if (vivo) { setPrevia(p); setC(p.campos); } })
      .catch((e) => { if (vivo) setErroCarga((e as Error).message); });
    return () => { vivo = false; };
  }, [negocio.id]);

  const erros = useMemo(() => (c ? errosDoContrato(c) : {}), [c]);
  const temErro = Object.keys(erros).length > 0;
  const automatico = previa?.modo === "automatico";

  async function enviar(substituir: boolean) {
    if (!c) return;
    setMostrarErros(true);
    setErro(null);
    if (temErro) { setErro("Corrija os campos marcados antes de enviar."); return; }
    if (jaTemAtivo && !substituir) { setConfirmarSubstituir(true); return; }
    setEnviando(true);
    try {
      const r = await enviarContrato(negocio.id, c, substituir);
      if (r.ok) onEnviado("Contrato enviado! O cliente recebe o link do ZapSign por e-mail. O cartão foi para \"Contrato enviado\".", "ok");
      else setErro(r.sobraram?.length ? `${r.erro}` : (r.erro || "Não deu certo."));
    } catch (e) {
      const d = (e as Error & { dados?: { precisaConfirmar?: boolean } }).dados;
      if (d?.precisaConfirmar) setConfirmarSubstituir(true);
      else setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const mudar = (k: keyof CamposContrato, v: string) => setC((x) => (x ? { ...x, [k]: v } : x));

  return (
    <Modal aberto titulo="Enviar contrato" onFechar={onFechar} largura={820}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar} disabled={enviando}>Fechar</Botao>
        {confirmarSubstituir ? (
          <Botao variante="perigo" disabled={enviando} onClick={() => void enviar(true)}>{enviando ? "Gerando e enviando…" : "Sim, cancelar o anterior e enviar este"}</Botao>
        ) : (
          <Botao variante="primario" disabled={enviando || !c || !automatico} onClick={() => void enviar(false)}
            title={automatico ? undefined : "O envio automático não está configurado."}>
            {enviando ? "Gerando e enviando… (até 1 min)" : "Gerar e enviar pelo ZapSign"}
          </Botao>
        )}
      </>}>
      {erroCarga && <Aviso tom="erro">{erroCarga}</Aviso>}
      {!c && !erroCarga && <p className="text-sm" style={{ color: "var(--ink3)" }}>Juntando os dados da venda, do cliente e do Bitrix…</p>}
      {c && previa && (
        <div className="space-y-3">
          {!automatico && (
            <Aviso>
              <b>O envio automático não está configurado</b> — confira os dados aqui e use "Mandei por fora" no cartão.
              <ul className="list-disc ml-5 mt-1">{previa.falta.map((f) => <li key={f}>{f}</li>)}</ul>
            </Aviso>
          )}
          {previa.avisoBitrix && <Aviso>{previa.avisoBitrix} Os campos do Bitrix ficaram de fora — preencha à mão.</Aviso>}
          {confirmarSubstituir && <Aviso tom="erro">Este cliente já tem um contrato {negocio.status_contrato === "assinado" ? "ASSINADO" : "aguardando assinatura"}. Enviar de novo cancela o anterior (no ZapSign também).</Aviso>}
          {erro && <Aviso tom="erro">{erro}</Aviso>}

          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Modelo:</span>
            {(["pacote", "expedicao"] as const).map((t) => (
              <Botao key={t} variante={c.tipo === t ? "primario" : "secundario"} onClick={() => mudar("tipo", t)}>
                {t === "pacote" ? "Contrato de pacote" : "Contrato de expedição"}
              </Botao>
            ))}
            {previa.origem.tipo && <span className="text-[11px]" style={{ color: "var(--ink3)" }}>sugerido por: {previa.origem.tipo}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ROTULOS.filter((r) => !r.so || r.so === c.tipo).map((r) => {
              const origem = previa.origem[r.k];
              const msgErro = mostrarErros ? erros[r.k] : undefined;
              const dica = msgErro ? undefined : [r.dica, origem ? `veio de: ${origem}` : c[r.k] ? undefined : r.obrigatorio ? "obrigatório" : "vazio sai \"-\" no contrato"].filter(Boolean).join(" · ");
              return (
                <div key={r.k} className={r.longo ? "sm:col-span-2" : ""}>
                  <Campo rotulo={`${r.rotulo}${r.obrigatorio ? " *" : ""}`} erro={msgErro} dica={dica}>
                    {r.longo ? (
                      <textarea className="rel-input" rows={r.k === "destino" ? 4 : 2} value={c[r.k]} onChange={(e) => mudar(r.k, e.target.value)} />
                    ) : (
                      <Entrada value={c[r.k]} onChange={(e) => mudar(r.k, e.target.value)} />
                    )}
                  </Campo>
                </div>
              );
            })}
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            O cliente e o assinante da agência recebem o link por e-mail. Campo vazio vira "-" no contrato. Se o modelo tiver alguma
            {" {{tag}} "}que o QS não conhece, nada é enviado e a tela mostra qual.
          </p>
        </div>
      )}
    </Modal>
  );
}
