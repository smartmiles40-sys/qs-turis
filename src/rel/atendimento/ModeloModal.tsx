// src/rel/atendimento/ModeloModal.tsx
// Mandar um MODELO aprovado pela Meta — o único jeito de falar com quem não
// escreve há mais de 24h (e de puxar conversa com um cliente pela ficha).
import { useEffect, useMemo, useState } from "react";
import { enviarModelo, enviarModeloParaTelefone, listarModelos, type Modelo } from "../lib/whatsapp";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";
import { carregarCampos, rotuloDoCampo, trechoDaVariavel, variaveisVazias, type CamposDoModelo } from "../../lib/qs/modeloCampos";

/** Modelos com nome "fin_…" são do Financeiro: só aparecem pra ele (Bruno, 14/10). */
export const ehModeloDoFinanceiro = (nome: string) => nome.startsWith("fin_");

export default function ModeloModal({ aberto, alvo, nomeCliente, onFechar, onEnviado, area = "relacionamento" }: {
  aberto: boolean;
  /** Quem está mandando: o Financeiro vê só os "fin_…"; o Relacionamento, os outros. */
  area?: "relacionamento" | "financeiro";
  /** telefone = Nova conversa com um número que ainda não escreveu (14/10). */
  alvo: { conversaId?: string; clienteId?: string; telefone?: string };
  nomeCliente: string | null;
  onFechar: () => void;
  onEnviado: (conversaId?: string) => void;
}) {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [escolhido, setEscolhido] = useState<Modelo | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState<CamposDoModelo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setEscolhido(null); setErro(null); setModelos(null);
    listarModelos().then(setModelos).catch((e) => { setModelos([]); setErro(e instanceof Error ? e.message : "Não consegui ler os modelos."); });
  }, [aberto]);

  // As variáveis do corpo ({{1}}, {{2}}…). A {{1}} já vem com o primeiro nome.
  const variaveis = useMemo(() => {
    if (!escolhido) return [];
    const achadas = [...escolhido.corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((m) => m[1]);
    return [...new Set(achadas)];
  }, [escolhido]);

  function escolher(m: Modelo) {
    setEscolhido(m);
    const primeiro = (nomeCliente || "").trim().split(/\s+/)[0] || "";
    const vars = [...new Set([...m.corpo.matchAll(/{{\s*([^}]+?)\s*}}/g)].map((x) => x[1]))];
    setParams(Object.fromEntries(vars.map((v) => [v, v === "1" ? primeiro : ""])));
    setCampos(null);
    // O que é cada {{n}} (qs_wa_modelo_campos) — só pra mostrar o rótulo.
    void carregarCampos(m.nome).then((c) => setCampos(c)).catch(() => null);
  }

  const vazias = variaveisVazias(variaveis, params);

  const visiveis = (modelos ?? []).filter((m) => !m.precisaMidia && ehModeloDoFinanceiro(m.nome) === (area === "financeiro"));

  const previa = escolhido?.corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => params[k] || `[${k}]`) ?? "";

  async function enviar() {
    if (!escolhido) return;
    if (vazias.length) { setErro(`Preencha ${vazias.map((v) => `{{${v}}}`).join(", ")} antes de enviar.`); return; }
    setEnviando(true);
    setErro(null);
    try {
      const modelo = { nome: escolhido.nome, idioma: escolhido.idioma, params };
      const r = alvo.telefone ? await enviarModeloParaTelefone(alvo.telefone, modelo) : await enviarModelo(alvo, modelo);
      onEnviado(r?.conversaId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não enviou.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Mandar modelo"
      onFechar={onFechar}
      rodape={escolhido ? (
        <>
          <Botao variante="fantasma" onClick={() => setEscolhido(null)}>Voltar</Botao>
          <Botao variante="primario" onClick={enviar} disabled={enviando || vazias.length > 0}>{enviando ? "Enviando…" : "Enviar"}</Botao>
        </>
      ) : undefined}
    >
      {modelos === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando modelos…</p>
      ) : !escolhido ? (
        <div className="space-y-2">
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {visiveis.length === 0 && !erro && (
            <Aviso>
              {area === "financeiro" ? "Ainda não há modelo do Financeiro aprovado (nome começando com fin_)." : "Ainda não há modelo aprovado no número do Relacionamento."}
              {" "}A gestora cria em <b>Atendimento → Modelos → Modelos da Meta</b> — a Meta aprova em minutos ou horas.
            </Aviso>
          )}
          {visiveis.map((m) => (
            <button key={`${m.nome}-${m.idioma}`} onClick={() => escolher(m)} className="rel-card rel-linha w-full text-left p-3">
              <span className="block text-[13px] font-bold" style={{ color: "var(--ink)" }}>{m.nome}</span>
              <span className="block text-[12px] mt-0.5 line-clamp-2" style={{ color: "var(--ink3)" }}>{m.corpo}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {variaveis.length > 0 && (
            <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              Este modelo tem {variaveis.length === 1 ? "1 campo" : `${variaveis.length} campos`} pra completar. Todos são obrigatórios — o botão Enviar só libera com tudo preenchido.
            </p>
          )}
          {variaveis.map((v) => {
            const rotulo = rotuloDoCampo(campos?.[v]) ?? (v === "1" ? "Primeiro nome do cliente" : null);
            // A Meta guarda os exemplos na ordem {{1}}, {{2}}…
            const exemplo = /^d+$/.test(v) ? escolhido.exemplos?.[Number(v) - 1] : undefined;
            const vazio = vazias.includes(v);
            return (
              <Campo key={v} rotulo={`{{${v}}}${rotulo ? ` · ${rotulo}` : ""}`}
                dica={`No texto: “${trechoDaVariavel(escolhido.corpo, v)}”${exemplo ? ` · Ex.: ${exemplo}` : ""}`}>
                <Entrada value={params[v] || ""} onChange={(e) => setParams((p) => ({ ...p, [v]: e.target.value }))}
                  placeholder={exemplo ? `Ex.: ${exemplo}` : "Obrigatório"} aria-invalid={vazio}
                  style={vazio ? { borderColor: "var(--warn-ink)" } : undefined} />
              </Campo>
            );
          })}
          {vazias.length > 0 && <Aviso>Falta preencher {vazias.map((v) => `{{${v}}}`).join(", ")}.</Aviso>}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Como o cliente vai ler</p>
            <div className="rounded-2xl px-3 py-2 text-[14px] whitespace-pre-wrap" style={{ background: "var(--wa-soft)", color: "var(--wa-ink)" }}>{previa}</div>
          </div>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
        </div>
      )}
    </Modal>
  );
}
