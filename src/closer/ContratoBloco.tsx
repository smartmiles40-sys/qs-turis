// src/closer/ContratoBloco.tsx
// -----------------------------------------------------------------------------
// O CONTRATO dentro do cartão do closer (0180, 22/10/2026 — sem n8n).
//
//   • "Enviar contrato" abre a PRÉVIA: os campos que vão no contrato, puxados
//     da venda registrada (09/11: manda na viagem) + cadastro do cliente (manda
//     na pessoa, com RG e endereço) + ficha/proposta + lead + Bitrix (cada um
//     diz de onde veio). O closer corrige o que faltar e manda; o que ele
//     corrigir da pessoa volta pro cadastro (o servidor grava ao gerar/enviar).
//   • O SERVIDOR monta o PDF pelo modelo do próprio QS (sem Google), guarda
//     no Storage (bucket contratos, 0212) e cria no ZapSign.
//     O webhook do ZapSign devolve: cliente abriu → assinou / recusou — e o
//     cartão anda sozinho.
//   • Sem ZapSign configurado (29/10, Bruno: "quero por dentro do card"): o
//     bloco FICA no cartão em modo manual — "Montar contrato" abre a mesma
//     prévia, o "Ver PDF" baixa o contrato pronto, e o closer manda por fora e
//     marca aqui. Com ZapSign, o mesmo botão já envia.
//   • O contrato é À PARTE da venda (29/10): sai a qualquer momento — antes de
//     registrar, depois de consolidar. Cartão consolidado não muda de etapa
//     (closer_recalcular_etapa ignora 'consolidada'); só o status do contrato.
//   • 0352 (Bruno 09/11): venda com FAMÍLIA → UM CONTRATO POR PESSOA. O bloco
//     lista quem vai com caixinhas "quem recebe contrato" (todos marcados; o
//     comprador sempre), o valor de cada um, quem assina (o próprio ou o
//     responsável, no menor), o que falta (bloqueia só aquela pessoa) e o
//     status/link de cada contrato. Venda de 1 pessoa: exatamente como antes.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { brl, dataHoraBr, useConfigDaArea, type Negocio } from "./lib";
import { rotuloVinculo } from "@/venda/familiaRegras";
import {
  NOME_STATUS_CONTRATO, ROTULOS, TOM_STATUS_CONTRATO, atualizarContrato, cancelarContrato, contratoManual, enviarContrato,
  enviarContratosDaFamilia, enviosDoCartao, errosDoContrato, familiaDoContrato, linkDoPdf, pdfDeTeste, previaDoContrato, textoDoCadastro,
  type CamposContrato, type EnvioContrato, type FamiliaContrato, type PessoaContrato, type Previa, type ResultadoPessoa,
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

/** PDF guardado no QS: o link é temporário (10 min), então é pedido na hora do clique.
 *  A aba abre ANTES do await pra o navegador não bloquear como popup. */
function BotaoPdf({ contratoId, qual, rotulo }: { contratoId: string; qual: "gerado" | "assinado"; rotulo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <button type="button" className="font-semibold underline" style={{ color: "var(--rel-ink)" }}
        onClick={() => {
          setErro(null);
          const aba = window.open("about:blank", "_blank");
          linkDoPdf(contratoId, qual)
            .then((url) => { if (aba) aba.location.href = url; else window.open(url, "_blank"); })
            .catch((e) => { aba?.close(); setErro((e as Error).message); });
        }}>{rotulo}</button>
      {erro && <span style={{ color: "var(--danger, #b42318)" }}>{erro}</span>}
    </span>
  );
}

export default function ContratoBloco({ negocio, onMudou }: { negocio: Negocio; onMudou: () => void }) {
  const [envios, setEnvios] = useState<EnvioContrato[] | null>(null);
  // 0352: família → contrato por pessoa (familia=false: venda de 1 pessoa, o bloco de sempre).
  const [familia, setFamilia] = useState<FamiliaContrato | null>(null);
  const config = useConfigDaArea();
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previaAberta, setPreviaAberta] = useState(false);
  const [manual, setManual] = useState<null | "enviado" | "assinado" | "cancelar">(null);
  const [texto, setTexto] = useState("");

  const carregar = useCallback(async () => {
    const fam = familiaDoContrato(negocio.id).catch(() => ({ familia: false }) as FamiliaContrato);
    try { setEnvios(await enviosDoCartao(negocio.id)); } catch (e) { setEnvios([]); setAviso({ tom: "erro", t: (e as Error).message }); }
    setFamilia(await fam);
  }, [negocio.id]);
  useEffect(() => { void carregar(); }, [carregar, negocio.status_contrato]);

  const lista = envios ?? [];
  const atual = lista.find((e) => !["erro", "cancelado"].includes(e.status)) ?? null;
  const ultimoErro = lista[0]?.status === "erro" ? lista[0] : null;
  const automatico = config?.contrato === true;
  const perdido = negocio.etapa === "perdido" || negocio.etapa === "venda_cancelada";

  async function rodar(f: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    setAviso(null);
    try { await f(); if (ok) setAviso({ tom: "ok", t: ok }); await carregar(); onMudou(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  if (!config || envios === null || familia === null) return null;

  if (familia.familia) {
    return (
      <ContratosDaFamilia negocio={negocio} fam={familia} automatico={familia.modo ? familia.modo === "automatico" : automatico} perdido={perdido}
        onRecarregar={async () => { await carregar(); onMudou(); }} />
    );
  }

  return (
    <section className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Contrato</h2>
        {!perdido && atual?.status !== "assinado" && (
          <Botao variante={atual ? "secundario" : "primario"} disabled={ocupado} onClick={() => setPreviaAberta(true)}>
            {automatico ? (atual ? "Reenviar contrato" : "Enviar contrato") : "Montar contrato"}
          </Botao>
        )}
      </div>
      {aviso && <div className="mb-2"><Aviso tom={aviso.tom}>{aviso.t}</Aviso></div>}

      {!atual && !ultimoErro && (
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          {automatico
            ? "Nenhum contrato enviado. O QS gera o contrato pelo modelo, guarda o PDF e manda pelo ZapSign — o cliente recebe por e-mail."
            : "Nenhum contrato ainda. \"Montar contrato\" junta os dados e gera o PDF pelo modelo; mande ao cliente e marque aqui embaixo."}
        </p>
      )}

      {ultimoErro && (
        <div className="mb-3">
          <Aviso tom="erro">
            <b>O último envio falhou ({dataHoraBr(ultimoErro.criado_em)}):</b> {ultimoErro.erro}
            {ultimoErro.drive_pdf_url && <> · <BotaoPdf contratoId={ultimoErro.id} qual="gerado" rotulo="PDF gerado" /></>}
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
          {(atual.drive_pdf_url || atual.pdf_assinado_url) && (
            <div className="flex flex-wrap items-center gap-3">
              {atual.drive_pdf_url && <BotaoPdf contratoId={atual.id} qual="gerado" rotulo="Ver PDF enviado" />}
              {atual.pdf_assinado_url && <BotaoPdf contratoId={atual.id} qual="assinado" rotulo="Ver PDF assinado" />}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {automatico && atual.zapsign_token && atual.status !== "assinado" && (
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

      {lista.length > 1 && (
        <details className="mt-3">
          <summary className="text-[12px] cursor-pointer" style={{ color: "var(--ink3)" }}>Envios anteriores ({lista.length - 1})</summary>
          <ul className="mt-1 space-y-1">
            {lista.filter((e) => e.id !== atual?.id).map((e) => (
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
        <Campo rotulo={manual === "enviado" ? "Link de assinatura que você mandou ao cliente" : manual === "assinado" ? "Link do PDF assinado (opcional)" : "Motivo (opcional)"}>
          <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={manual === "cancelar" ? "Ex.: valores mudaram" : "https://"} autoFocus />
        </Campo>
        {manual === "assinado" && <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>O cartão vai para "Contrato assinado".</p>}
      </Modal>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 0352 — FAMÍLIA: UM CONTRATO POR PESSOA
// ═════════════════════════════════════════════════════════════════════════════
const NOME_RESULTADO: Record<ResultadoPessoa["resultado"], string> = {
  enviado: "enviado", pulado: "já tinha", bloqueado: "bloqueado", erro: "falhou", adiado: "ficou pra depois",
};

function ContratosDaFamilia({ negocio, fam, automatico, perdido, onRecarregar }: {
  negocio: Negocio; fam: FamiliaContrato; automatico: boolean; perdido: boolean; onRecarregar: () => Promise<void>;
}) {
  const pessoas = useMemo(() => fam.pessoas ?? [], [fam.pessoas]);
  // Quem PODE receber agora: sem bloqueio e sem contrato vivo.
  const podeReceber = (p: PessoaContrato) => p.bloqueios.length === 0 && !p.ativo;
  // Todos marcados por padrão (guarda só quem o closer DESMARCOU); o comprador sempre (caixinha travada).
  const [desmarcados, setDesmarcados] = useState<Set<string>>(() => new Set());
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "aviso" | "erro"; t: string } | null>(null);
  const [resultados, setResultados] = useState<ResultadoPessoa[] | null>(null);
  const [previaDe, setPreviaDe] = useState<PessoaContrato | null>(null);
  const [manual, setManual] = useState<null | { acao: "enviado" | "assinado" | "cancelar"; p: PessoaContrato }>(null);
  const [texto, setTexto] = useState("");

  const aEnviar = pessoas.filter((p) => (p.comprador || !desmarcados.has(p.venda_pessoa_id)) && podeReceber(p));
  const resumo = fam.resumo;

  async function rodar(f: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    setAviso(null);
    try { await f(); if (ok) setAviso({ tom: "ok", t: ok }); await onRecarregar(); }
    catch (e) { setAviso({ tom: "erro", t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  async function enviarTodos() {
    setOcupado(true);
    setAviso(null);
    setResultados(null);
    try {
      const r = await enviarContratosDaFamilia(negocio.id, aEnviar.map((p) => p.venda_pessoa_id));
      setResultados(r.resultados);
      const env = r.resultados.filter((x) => x.resultado === "enviado").length;
      setAviso(r.ok
        ? { tom: "ok", t: `${env} contrato${env === 1 ? "" : "s"} enviado${env === 1 ? "" : "s"} pelo ZapSign — cada um recebe o seu por e-mail.` }
        : { tom: "aviso", t: `${env} enviado${env === 1 ? "" : "s"}; veja abaixo quem ficou de fora e por quê. Os outros não foram afetados.` });
      await onRecarregar();
    } catch (e) {
      setAviso({ tom: "erro", t: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="rel-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--ink)" }}>Contratos — um por pessoa</h2>
        {resumo?.texto && <Etiqueta tom={resumo.assinados === resumo.total ? "rel" : "aviso"}>{resumo.texto}</Etiqueta>}
      </div>
      <p className="text-[12.5px] mb-2" style={{ color: "var(--ink2)" }}>
        Cada pessoa recebe o contrato dela, com o valor dela. Menor de idade: quem assina é o responsável (pai/mãe).
        {automatico ? " Marque quem recebe e envie — quem já tem contrato não recebe de novo." : " Monte o contrato de cada pessoa, mande por fora e marque aqui."}
      </p>
      {aviso && <div className="mb-2"><Aviso tom={aviso.tom}>{aviso.t}</Aviso></div>}

      <ul className="space-y-2">
        {pessoas.map((p) => {
          const marcado = p.comprador || !desmarcados.has(p.venda_pessoa_id);
          const bloqueado = p.bloqueios.length > 0;
          const k = p.atual;
          const res = resultados?.find((x) => x.vendaPessoaId === p.venda_pessoa_id);
          return (
            <li key={p.venda_pessoa_id} className="rounded-lg p-2.5" style={{ background: "var(--card2)", border: p.menor ? "1px solid var(--aviso, #d97706)" : "1px solid transparent" }}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 flex-1 min-w-[180px] cursor-pointer">
                  <input type="checkbox" checked={marcado && !bloqueado && !p.ativo} disabled={p.comprador || bloqueado || Boolean(p.ativo) || perdido}
                    aria-label={`${p.nome ?? "Pessoa"} recebe contrato`}
                    onChange={(e) => setDesmarcados((s) => { const c = new Set(s); if (e.target.checked) c.delete(p.venda_pessoa_id); else c.add(p.venda_pessoa_id); return c; })} />
                  <span className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{p.nome ?? "Sem nome"}</span>
                </label>
                <Etiqueta tom={p.comprador ? "rel" : "neutro"}>{rotuloVinculo(p)}</Etiqueta>
                {p.menor && <Etiqueta tom="aviso">Menor{p.idade != null ? ` · ${p.idade} anos` : ""}</Etiqueta>}
                <span className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{p.valor != null ? brl(p.valor) : "sem valor"}</span>
              </div>
              <p className="text-[12px] mt-1" style={{ color: "var(--ink2)" }}>
                Assina: {p.assina.proprio ? <b>o próprio</b> : <>responsável: <b>{p.assina.nome ?? "—"}</b></>}
                {p.assina.email ? ` · ${p.assina.email}` : ""}
              </p>
              {bloqueado && <p className="text-[12px] mt-1" style={{ color: "var(--err-ink)", fontWeight: 600 }}>Não dá pra gerar: {p.bloqueios.join(" ")}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[12.5px]">
                {k ? (
                  <>
                    <Etiqueta tom={TOM_STATUS_CONTRATO[k.status]}>{NOME_STATUS_CONTRATO[k.status]}</Etiqueta>
                    <span style={{ color: "var(--ink3)" }}>
                      {k.modo === "manual" ? "por fora" : "ZapSign"}
                      {k.enviado_em ? ` · enviado ${dataHoraBr(k.enviado_em)}` : ""}
                      {k.assinado_em ? ` · assinou ${dataHoraBr(k.assinado_em)}` : ""}
                    </span>
                    {k.status === "erro" && k.erro && <span style={{ color: "var(--err-ink)" }}>{k.erro.slice(0, 160)}</span>}
                    {p.ativo && k.link_assinatura && k.status !== "assinado" && <LinkCopiavel rotulo="Link de assinatura" url={k.link_assinatura} />}
                    {k.drive_pdf_url && <BotaoPdf contratoId={k.id} qual="gerado" rotulo="PDF enviado" />}
                    {k.pdf_assinado_url && <BotaoPdf contratoId={k.id} qual="assinado" rotulo="PDF assinado" />}
                  </>
                ) : <span style={{ color: "var(--ink3)" }}>Sem contrato ainda.</span>}
                {res && res.resultado !== "enviado" && (
                  <span style={{ color: res.resultado === "pulado" ? "var(--ink3)" : "var(--err-ink)" }}>
                    Último envio: {NOME_RESULTADO[res.resultado]}{res.motivo ? ` — ${res.motivo}` : ""}
                  </span>
                )}
              </div>
              {!perdido && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {!bloqueado && k?.status !== "assinado" && (
                    <Botao variante="fantasma" disabled={ocupado} onClick={() => setPreviaDe(p)}>
                      {automatico ? (p.ativo ? "Reenviar / editar" : "Ver e editar") : "Montar contrato"}
                    </Botao>
                  )}
                  {automatico && p.ativo?.zapsign_token && p.ativo.status !== "assinado" && (
                    <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(async () => { await atualizarContrato(p.ativo!.id); }, "Status conferido no ZapSign.")}>Atualizar status</Botao>
                  )}
                  {!p.ativo && (
                    <Botao variante="fantasma" disabled={ocupado} onClick={() => { setTexto(""); setManual({ acao: "enviado", p }); }}>Mandei por fora</Botao>
                  )}
                  {p.ativo?.status !== "assinado" && (
                    <Botao variante="fantasma" disabled={ocupado} onClick={() => { setTexto(""); setManual({ acao: "assinado", p }); }}>{p.ativo ? "Assinou por fora" : "Já está assinado"}</Botao>
                  )}
                  {p.ativo && p.ativo.status !== "assinado" && p.ativo.status !== "gerando" && (
                    <Botao variante="perigo" disabled={ocupado} onClick={() => { setTexto(""); setManual({ acao: "cancelar", p }); }}>Cancelar</Botao>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {automatico && !perdido && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Botao variante="primario" disabled={ocupado || aEnviar.length === 0} onClick={() => void enviarTodos()}>
            {ocupado ? "Gerando e enviando… (pode levar 1 min)" : aEnviar.length ? `Enviar ${aEnviar.length} contrato${aEnviar.length === 1 ? "" : "s"} pelo ZapSign` : "Ninguém a enviar"}
          </Botao>
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {aEnviar.length ? `Vai: ${aEnviar.map((p) => p.nome?.split(" ")[0] ?? "—").join(", ")}.` : "Todos já têm contrato ou estão bloqueados."}
          </span>
        </div>
      )}

      {previaDe && (
        <PreviaContrato negocio={negocio} pessoa={previaDe} jaTemAtivo={Boolean(previaDe.ativo)} onFechar={() => setPreviaDe(null)}
          onEnviado={(msg, tom) => { setPreviaDe(null); setAviso({ tom, t: msg }); void onRecarregar(); }} />
      )}

      <Modal aberto={manual !== null} onFechar={() => setManual(null)}
        titulo={`${manual?.acao === "enviado" ? "Contrato enviado por fora" : manual?.acao === "assinado" ? "Contrato assinado" : "Cancelar contrato"}${manual ? ` — ${manual.p.nome ?? "viajante"}` : ""}`}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setManual(null)}>Voltar</Botao>
          <Botao variante={manual?.acao === "cancelar" ? "perigo" : "primario"} disabled={ocupado || (manual?.acao === "enviado" && !/^https?:\/\//i.test(texto.trim()))}
            onClick={() => {
              const m = manual!;
              const t = texto.trim();
              setManual(null);
              if (m.acao === "cancelar" && m.p.ativo?.zapsign_token) void rodar(() => cancelarContrato(m.p.ativo!.id, t), "Contrato cancelado (e apagado no ZapSign).");
              else void rodar(() => contratoManual(negocio.id, m.acao, t || undefined, m.p.venda_pessoa_id),
                m.acao === "enviado" ? "Contrato marcado como enviado." : m.acao === "assinado" ? "Contrato marcado como assinado." : "Contrato cancelado.");
            }}>
            {manual?.acao === "enviado" ? "Marcar como enviado" : manual?.acao === "assinado" ? "Marcar assinado" : "Cancelar contrato"}
          </Botao>
        </>}>
        <Campo rotulo={manual?.acao === "enviado" ? "Link de assinatura que você mandou" : manual?.acao === "assinado" ? "Link do PDF assinado (opcional)" : "Motivo (opcional)"}>
          <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={manual?.acao === "cancelar" ? "Ex.: valores mudaram" : "https://"} autoFocus />
        </Campo>
        {manual?.acao === "assinado" && (
          <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>O cartão só vai para "Contrato assinado" quando todos os contratos enviados estiverem assinados.</p>
        )}
      </Modal>
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PRÉVIA E ENVIO
// ═════════════════════════════════════════════════════════════════════════════
function PreviaContrato({ negocio, jaTemAtivo, onFechar, onEnviado, pessoa = null }: {
  negocio: Negocio; jaTemAtivo: boolean; onFechar: () => void; onEnviado: (msg: string, tom: "ok" | "aviso" | "erro") => void;
  /** 0352: o contrato DESTA pessoa da família (sem = o contrato do cartão). */
  pessoa?: PessoaContrato | null;
}) {
  const vpId = pessoa?.venda_pessoa_id ?? null;
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [c, setC] = useState<CamposContrato | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmarSubstituir, setConfirmarSubstituir] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [cadastroMsg, setCadastroMsg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    previaDoContrato(negocio.id, vpId)
      .then((p) => { if (vivo) { setPrevia(p); setC(p.campos); } })
      .catch((e) => { if (vivo) setErroCarga((e as Error).message); });
    return () => { vivo = false; };
  }, [negocio.id, vpId]);

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
      const r = await enviarContrato(negocio.id, c, substituir, previa, vpId);
      const cad = textoDoCadastro(r.cadastro);
      if (r.ok && pessoa) onEnviado(`Contrato de ${pessoa.nome ?? "viajante"} enviado! ${pessoa.menor ? `O responsável (${c.nome})` : "A pessoa"} recebe o link do ZapSign por e-mail.${cad ? ` ${cad}` : ""}`, "ok");
      else if (r.ok) onEnviado(`Contrato enviado! O cliente recebe o link do ZapSign por e-mail. O cartão foi para "Contrato enviado".${cad ? ` ${cad}` : ""}`, "ok");
      else setErro([r.erro || "Não deu certo.", cad].filter(Boolean).join(" "));
    } catch (e) {
      const d = (e as Error & { dados?: { precisaConfirmar?: boolean } }).dados;
      if (d?.precisaConfirmar) setConfirmarSubstituir(true);
      else setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  // "Ver PDF": o contrato exatamente como vai sair, sem enviar nada (funciona no modo manual também).
  async function verPdf() {
    if (!c) return;
    setErro(null);
    const aba = window.open("about:blank", "_blank");
    setGerandoPdf(true);
    try {
      const r = await pdfDeTeste(c, negocio.id, previa, vpId);
      setCadastroMsg(textoDoCadastro(r.cadastro) || null);
      const url = URL.createObjectURL(r.blob);
      if (aba) aba.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      aba?.close();
      setErro((e as Error).message);
    } finally {
      setGerandoPdf(false);
    }
  }

  const mudar = (k: keyof CamposContrato, v: string) => setC((x) => (x ? { ...x, [k]: v } : x));

  return (
    <Modal aberto titulo={`${previa && !automatico ? "Montar contrato" : "Enviar contrato"}${pessoa ? ` — ${pessoa.nome ?? "viajante"}` : ""}`} onFechar={onFechar} largura={820}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar} disabled={enviando}>Fechar</Botao>
        <Botao variante={previa && !automatico ? "primario" : "secundario"} onClick={() => void verPdf()} disabled={enviando || gerandoPdf || !c}>
          {gerandoPdf ? "Montando o PDF…" : previa && !automatico ? "Gerar o PDF do contrato" : "Ver PDF"}
        </Botao>
        {previa && !automatico ? null : confirmarSubstituir ? (
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
              Confira os dados e clique em <b>"Gerar o PDF do contrato"</b>. Mande o PDF ao cliente e, no cartão, use "Mandei por
              fora" e depois "Assinou por fora". (O envio direto pelo ZapSign liga quando o token for configurado.)
            </Aviso>
          )}
          {previa.avisoBitrix && <Aviso>{previa.avisoBitrix} Os campos do Bitrix ficaram de fora — preencha à mão.</Aviso>}
          {confirmarSubstituir && <Aviso tom="erro">Este cliente já tem um contrato {negocio.status_contrato === "assinado" ? "ASSINADO" : "aguardando assinatura"}. Enviar de novo cancela o anterior (no ZapSign também).</Aviso>}
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {cadastroMsg && <Aviso tom="ok">{cadastroMsg}</Aviso>}
          {!pessoa && (previa.viajantes?.length ?? 0) > 1 && (
            <Aviso>
              A venda tem {previa.viajantes!.length} viajantes ({previa.viajantes!.map((v) => v.nome).filter(Boolean).join(", ")}). Aqui sai
              um contrato só, com o valor total. Pra um contrato por pessoa, a venda precisa da lista de quem vai ("Editar quem vai").
            </Aviso>
          )}
          {pessoa && (
            <Aviso>
              Contrato de <b>{pessoa.nome ?? "viajante"}</b> com o valor dele(a){pessoa.valor != null ? ` (${brl(pessoa.valor)})` : ""}.
              {pessoa.menor
                ? <> É menor de idade: quem assina (e recebe o ZapSign) é o responsável{pessoa.assina.nome ? <> <b>{pessoa.assina.nome}</b></> : ""}; o menor sai como VIAJANTE no quadro.</>
                : " Quem assina é a própria pessoa."}
              {" "}O que você corrigir dos dados de quem assina volta pro cadastro dele(a).
            </Aviso>
          )}
          {(previa.bloqueios?.length ?? 0) > 0 && <Aviso tom="erro">{previa.bloqueios!.join(" ")}</Aviso>}
          {(previa.avisos?.length ?? 0) > 0 && <Aviso>{previa.avisos!.join(" ")}</Aviso>}

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
                  <Campo rotulo={`${pessoa && r.k === "valor_total" ? `Valor de ${pessoa.nome?.split(" ")[0] ?? "esta pessoa"}` : pessoa && pessoa.menor && r.k === "nome" ? "Nome do responsável (contratante)" : r.rotulo}${r.obrigatorio ? " *" : ""}`} erro={msgErro} dica={dica}>
                    {r.longo ? (
                      <textarea className="rel-input" rows={r.k === "roteiro" ? 10 : r.k === "inclusos" ? 7 : r.k === "destino" || r.k === "nao_inclusos" ? 3 : 2} value={c[r.k]} onChange={(e) => mudar(r.k, e.target.value)} />
                    ) : (
                      <Entrada value={c[r.k]} onChange={(e) => mudar(r.k, e.target.value)} />
                    )}
                  </Campo>
                </div>
              );
            })}
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            O cliente e o assinante da agência recebem o link por e-mail. Campo vazio vira "-" no contrato. O texto jurídico é o
            do modelo aprovado — aqui só mudam os dados. Use "Ver PDF" pra conferir antes de enviar.
          </p>
        </div>
      )}
    </Modal>
  );
}
