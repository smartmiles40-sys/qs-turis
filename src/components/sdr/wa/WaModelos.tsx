// Painel de MODELOS aprovados da Meta (número oficial).
// -----------------------------------------------------------------------------
// É por aqui que o SDR fala quando a janela de 24h fechou — ou manda a PRIMEIRA
// mensagem pra quem nunca respondeu. Duas telas no mesmo espaço do seletor de
// emoji: a lista de modelos e, se o escolhido tiver {{variáveis}}, o formulário
// pra preencher uma a uma com pré-visualização do texto final.
//
// O texto que sai é SEMPRE o aprovado na Meta (o servidor resolve o corpo);
// aqui só se escolhe o modelo e se preenchem os buracos.
//
// 14/10 (0130): o QS sabe o que é cada {{n}} (qs_wa_modelo_campos) e já
// preenche nome do lead, seu nome, destino (pela Fonte) e os dados da reunião.
// Tudo continua editável; ao lado de cada campo aparece o que ele é.
// -----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { previewModelo, type WaModelo } from "../../../lib/qs/waInbox";
import {
  ACEITA_DO_TOPO, ROTULO_DO_TOPO, TIPOS_CAMPO, carregarCampos, contextoDoLead, problemaDoArquivoDoTopo, rotuloDoCampo,
  trechoDaVariavel, valorDoCampo, variaveisVazias,
  type CamposDoModelo, type ContextoDoLead,
} from "../../../lib/qs/modeloCampos";

interface Props {
  modelos: WaModelo[];
  /** Lead da conversa — pra preencher destino e reunião (0130). */
  leadId?: string | null;
  /** Nome do lead — pré-preenche variáveis que pedem nome (nome/name/1). */
  leadName?: string | null;
  enviando: boolean;
  /** `arquivo` = o do topo, quando o modelo tem imagem/vídeo/PDF (14/10). */
  onEnviar: (modelo: WaModelo, valores: Record<string, string>, arquivo?: File | null) => void;
  onClose: () => void;
}

/** Chute educado pro valor inicial de uma variável: nome do cliente quando o
 *  buraco parece pedir isso (primeira variável e variáveis chamadas nome/name). */
function valorInicial(chave: string, indice: number, leadName?: string | null) {
  const primeiro = (leadName || "").trim().split(/\s+/)[0] || "";
  if (!primeiro) return "";
  const c = chave.toLowerCase();
  if (c === "nome" || c === "name" || c === "cliente" || (indice === 0 && /^\d+$/.test(chave))) return primeiro;
  return "";
}

export default function WaModelos({ modelos, leadId, leadName, enviando, onEnviar, onClose }: Props) {
  const [escolhido, setEscolhido] = useState<WaModelo | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState<CamposDoModelo | null>(null);
  // Topo com imagem/vídeo/PDF (14/10): obrigatório, como as variáveis.
  const [arquivo, setArquivo] = useState<File | null>(null);
  const ctxRef = useRef<Promise<ContextoDoLead | null> | null>(null);
  // O que o QS sabe do lead: carrega 1x quando o painel abre.
  useEffect(() => { ctxRef.current = leadId ? contextoDoLead(leadId, leadName).catch(() => null) : Promise.resolve(null); }, [leadId, leadName]);

  // Escolher NUNCA envia direto — mostra o texto e espera a confirmação. Os
  // modelos aprovados hoje são de texto fixo (sem variáveis), então sem esta
  // parada um clique errado na lista já sairia pro cliente, sem volta.
  const escolher = (m: WaModelo) => {
    const iniciais: Record<string, string> = {};
    m.variaveis.forEach((v, i) => { iniciais[v] = valorInicial(v, i, leadName); });
    setValores(iniciais);
    setCampos(null);
    setArquivo(null);
    setEscolhido(m);
    // Preenche o que der, sem apagar o que a pessoa já digitou.
    void Promise.all([carregarCampos(m.nome).catch(() => null), ctxRef.current ?? Promise.resolve(null)]).then(([cs, ctx]) => {
      if (!cs) return;
      setCampos(cs);
      setValores((prev) => {
        const n = { ...prev };
        for (const v of m.variaveis) { const sug = valorDoCampo(cs[v], ctx, m.nome); if (sug && !String(n[v] || "").trim()) n[v] = sug; }
        return n;
      });
    });
  };

  const problemaArquivo = escolhido?.precisaMidia ? problemaDoArquivoDoTopo(escolhido.headerFormato, arquivo) : null;
  const completo = useMemo(
    () => !!escolhido && escolhido.variaveis.every((v) => valores[v]?.trim()) && !problemaArquivo,
    [escolhido, valores, problemaArquivo]
  );

  return (
    <div className="shrink-0 border-t overflow-y-auto"
         style={{ borderColor: "var(--line)", background: "var(--card)", maxHeight: 300 }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        {escolhido && (
          <button onClick={() => setEscolhido(null)} aria-label="Voltar aos modelos"
                  className="wa-icon-btn w-7 h-7 grid place-items-center rounded-lg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round"><path d="M15 18 9 12l6-6" /></svg>
          </button>
        )}
        <p className="text-[12px] font-bold flex-1 min-w-0 truncate" style={{ color: "var(--ink2)" }}>
          {escolhido
            ? (escolhido.variaveis.length ? `Preencher "${escolhido.nome}"` : `Confira antes de enviar`)
            : "Modelos aprovados na Meta"}
        </p>
        <button onClick={onClose} aria-label="Fechar modelos"
                className="wa-icon-btn w-7 h-7 grid place-items-center rounded-lg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {!escolhido && (
        <div className="px-3 pb-3 grid gap-2">
          {modelos.length === 0 && (
            <p className="text-[12px] py-2" style={{ color: "var(--ink3)" }}>
              Nenhum modelo aprovado na Meta ainda. Crie os modelos no Gerenciador
              do WhatsApp Business — depois de aprovados, eles aparecem aqui.
            </p>
          )}
          {modelos.map((m) => (
            <button key={`${m.nome}:${m.idioma}`} onClick={() => escolher(m)} disabled={enviando}
                    className="text-left rounded-xl px-3 py-2 transition-colors"
                    style={{ border: "1px solid var(--line)", background: "var(--card2)" }}>
              <span className="flex items-center gap-2">
                <b className="text-[12px]" style={{ color: "var(--ink)" }}>{m.nome}</b>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                      style={{ background: "var(--wa-ok-bg)", color: "var(--wa-ok-ink)" }}>
                  {m.categoria || "aprovado"}
                </span>
                {m.precisaMidia && (
                  <span className="text-[10px]" style={{ color: "var(--ink3)" }}>
                    📎 {ROTULO_DO_TOPO[m.headerFormato || ""] ?? "mídia"} no topo
                  </span>
                )}
                {m.variaveis.length > 0 && (
                  <span className="text-[10px]" style={{ color: "var(--ink3)" }}>
                    {m.variaveis.length} campo{m.variaveis.length > 1 ? "s" : ""}
                  </span>
                )}
              </span>
              <span className="block text-[12px] mt-1 whitespace-pre-line" style={{ color: "var(--ink2)" }}>
                {m.corpo.length > 220 ? m.corpo.slice(0, 220) + "…" : m.corpo}
              </span>
            </button>
          ))}
        </div>
      )}

      {escolhido && (
        <div className="px-3 pb-3 grid gap-2">
          {escolhido.precisaMidia && (
            <label className="grid gap-0.5">
              <span className="text-[11px] font-semibold" style={{ color: "var(--ink2)" }}>
                Topo · {ROTULO_DO_TOPO[escolhido.headerFormato || ""] ?? "arquivo"} (obrigatório, até 3 MB)
              </span>
              <input type="file" accept={ACEITA_DO_TOPO[escolhido.headerFormato || ""] || undefined}
                     onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                     className="text-[12px]" style={{ color: "var(--ink2)" }} />
              {arquivo && problemaArquivo && <span className="text-[11px] font-semibold" style={{ color: "var(--wa-err-ink, #B42318)" }}>{problemaArquivo}</span>}
            </label>
          )}
          {[...new Set(escolhido.variaveis)].map((v) => {
            const rotulo = rotuloDoCampo(campos?.[v]);
            // A Meta guarda os exemplos na ordem {{1}}, {{2}}…
            const exemplo = /^\d+$/.test(v) ? escolhido.exemplos?.[Number(v) - 1] : undefined;
            const vazio = !valores[v]?.trim();
            return (
              <label key={v} className="grid gap-0.5">
                <span className="text-[11px] font-semibold" style={{ color: "var(--ink2)" }}>
                  {/^\d+$/.test(v) ? `Campo {{${v}}}` : v}
                  {rotulo && <span style={{ color: "var(--ink)" }}>{" · "}{rotulo}</span>}
                  {rotulo && campos?.[v] && campos[v] in TIPOS_CAMPO && vazio ? <span className="font-normal" style={{ color: "var(--ink3)" }}> (não achei — digite)</span> : null}
                </span>
                {/* Onde a variável entra no texto — diz o que vai ali mesmo sem rótulo. */}
                <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
                  “{trechoDaVariavel(escolhido.corpo, v)}”{exemplo ? ` · Ex.: ${exemplo}` : ""}
                </span>
                <input
                  value={valores[v] ?? ""}
                  onChange={(e) => setValores((prev) => ({ ...prev, [v]: e.target.value }))}
                  placeholder={exemplo ? `Ex.: ${exemplo}` : "Obrigatório"}
                  aria-invalid={vazio}
                  className="rounded-lg px-2.5 py-1.5 text-[13px] outline-none"
                  style={{ border: `1px solid ${vazio ? "var(--wa-warn-line, #E5A33B)" : "var(--line)"}`, background: "var(--card2)", color: "var(--ink)" }}
                />
              </label>
            );
          })}
          {/* O SDR vê EXATAMENTE o que o cliente vai receber antes de enviar. */}
          <div className="rounded-xl px-3 py-2 text-[12px] whitespace-pre-line"
               style={{ background: "var(--card2)", border: "1px dashed var(--line)", color: "var(--ink2)" }}>
            {previewModelo(escolhido, valores)}
          </div>
          {!completo && (
            <p className="text-[11.5px] font-semibold" style={{ color: "var(--ink2)" }}>
              {variaveisVazias([...new Set(escolhido.variaveis)], valores).length > 0
                ? <>Preencha {variaveisVazias([...new Set(escolhido.variaveis)], valores).map((v) => `{{${v}}}`).join(", ")} pra poder enviar.</>
                : <>{problemaArquivo}</>}
            </p>
          )}
          <button
            onClick={() => { if (completo) onEnviar(escolhido, valores, escolhido.precisaMidia ? arquivo : null); }}
            disabled={!completo || enviando}
            className="wa-send h-9 rounded-xl text-white text-[13px] font-semibold disabled:opacity-50"
          >
            {enviando ? "Enviando…" : "Enviar modelo"}
          </button>
        </div>
      )}
    </div>
  );
}
