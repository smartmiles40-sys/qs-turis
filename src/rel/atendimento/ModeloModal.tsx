// src/rel/atendimento/ModeloModal.tsx
// Mandar um MODELO aprovado pela Meta — o único jeito de falar com quem não
// escreve há mais de 24h (e de puxar conversa com um cliente pela ficha).
import { useEffect, useMemo, useState } from "react";
import { enviarModelo, listarModelos, type Modelo } from "../lib/whatsapp";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

export default function ModeloModal({ aberto, alvo, nomeCliente, onFechar, onEnviado }: {
  aberto: boolean;
  alvo: { conversaId?: string; clienteId?: string };
  nomeCliente: string | null;
  onFechar: () => void;
  onEnviado: (conversaId?: string) => void;
}) {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [escolhido, setEscolhido] = useState<Modelo | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
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
  }

  const previa = escolhido?.corpo.replace(/{{\s*([^}]+?)\s*}}/g, (_, k) => params[k] || `[${k}]`) ?? "";

  async function enviar() {
    if (!escolhido) return;
    const vazia = variaveis.find((v) => !String(params[v] || "").trim());
    if (vazia) { setErro(`Preencha a variável {{${vazia}}}.`); return; }
    setEnviando(true);
    setErro(null);
    try {
      const r = await enviarModelo(alvo, { nome: escolhido.nome, idioma: escolhido.idioma, params });
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
          <Botao variante="primario" onClick={enviar} disabled={enviando}>{enviando ? "Enviando…" : "Enviar"}</Botao>
        </>
      ) : undefined}
    >
      {modelos === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando modelos…</p>
      ) : !escolhido ? (
        <div className="space-y-2">
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          {modelos.length === 0 && !erro && (
            <Aviso>
              Ainda não há modelo aprovado no número do Relacionamento. O admin cria em
              <b> Comercial → Configurações → Modelos da Meta → "Mensagens de: Relacionamento"</b> — a Meta aprova em minutos ou horas.
            </Aviso>
          )}
          {modelos.filter((m) => !m.precisaMidia).map((m) => (
            <button key={`${m.nome}-${m.idioma}`} onClick={() => escolher(m)} className="rel-card rel-linha w-full text-left p-3">
              <span className="block text-[13px] font-bold" style={{ color: "var(--ink)" }}>{m.nome}</span>
              <span className="block text-[12px] mt-0.5 line-clamp-2" style={{ color: "var(--ink3)" }}>{m.corpo}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {variaveis.map((v) => (
            <Campo key={v} rotulo={`Variável {{${v}}}`} dica={v === "1" ? "Normalmente o primeiro nome do cliente." : undefined}>
              <Entrada value={params[v] || ""} onChange={(e) => setParams((p) => ({ ...p, [v]: e.target.value }))} />
            </Campo>
          ))}
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
