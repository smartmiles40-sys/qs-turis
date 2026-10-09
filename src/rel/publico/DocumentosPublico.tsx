// src/rel/publico/DocumentosPublico.tsx
// -----------------------------------------------------------------------------
// PÁGINA PÚBLICA DO LINK DE DOCUMENTOS (/documentos/<token>) — Fase 3.
//
// O cliente abre no celular, SEM login, e manda o que a agência pediu. Feita
// pra quem não é técnico: um botão por documento, foto direto da câmera,
// progresso e um ✓ quando chegou. Foto grande (> 2 MB) é reduzida no próprio
// celular antes de subir — passaporte não precisa de 12 MB e o 4G agradece.
//
// O arquivo sobe direto pro Storage por um endereço assinado que o servidor
// entrega (/api/rel-docs); a página nunca vê nada além do primeiro nome.
// -----------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { TIPOS_DOC, concluirPeloLink, enviarPeloLink, lerPedidoPublico, type PedidoPublico, type TipoDocumento } from "../lib/viagens";
import { REL_CSS } from "../ui";

const LIMITE_SEM_REDUZIR = 2 * 1024 * 1024;

/** Reduz foto grande pra JPEG (lado maior 2400px). HEIC e PDF passam como estão. */
async function reduzir(arquivo: File): Promise<{ blob: Blob; nome: string }> {
  if (arquivo.size <= LIMITE_SEM_REDUZIR || !/^image\/(jpeg|png|webp)$/.test(arquivo.type)) {
    return { blob: arquivo, nome: arquivo.name };
  }
  try {
    const url = URL.createObjectURL(arquivo);
    const img = await new Promise<HTMLImageElement>((ok, falha) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => falha(new Error("imagem"));
      i.src = url;
    });
    const escala = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    if (!blob) return { blob: arquivo, nome: arquivo.name };
    return { blob, nome: arquivo.name.replace(/\.\w+$/, "") + ".jpg" };
  } catch {
    return { blob: arquivo, nome: arquivo.name };
  }
}

type Estado = "parado" | "enviando" | "enviado" | "erro";

function ItemDocumento({ token, tipo, jaEnviados, onEnviado }: {
  token: string; tipo: TipoDocumento; jaEnviados: number; onEnviado: () => void;
}) {
  const [estado, setEstado] = useState<Estado>(jaEnviados ? "enviado" : "parado");
  const [msg, setMsg] = useState<string | null>(null);
  const [validade, setValidade] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function escolher(f: File | undefined) {
    if (!f) return;
    if (!/^(image\/(jpeg|png|heic|heif|webp)|application\/pdf)$/.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) {
      setEstado("erro"); setMsg("Envie uma foto ou um PDF."); return;
    }
    setEstado("enviando"); setMsg(null);
    try {
      const { blob, nome } = await reduzir(f);
      // HEIC às vezes chega sem tipo no navegador.
      const comTipo = blob.type ? blob : new Blob([blob], { type: /\.heif$/i.test(nome) ? "image/heif" : "image/heic" });
      if (comTipo.size > 15 * 1024 * 1024) throw new Error("Arquivo maior que 15 MB. Tire uma foto em vez de enviar o arquivo original.");
      await enviarPeloLink(token, tipo, comTipo, nome, tipo === "passaporte" ? validade || null : null);
      setEstado("enviado");
      onEnviado();
    } catch (e) {
      setEstado("erro");
      setMsg(e instanceof Error ? e.message : "Não foi. Tente de novo.");
    } finally {
      if (ref.current) ref.current.value = "";
    }
  }

  const feito = estado === "enviado";
  return (
    <li className="rounded-2xl p-4" style={{ background: "var(--card)", border: `1.5px solid ${feito ? "var(--rel)" : "var(--line)"}` }}>
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 text-[15px] font-bold"
          style={feito ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}>
          {feito ? "✓" : "·"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{TIPOS_DOC[tipo]}</p>
          <p className="text-[12px]" style={{ color: estado === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>
            {estado === "enviando" ? "Enviando…" : feito ? "Recebido. Quer mandar mais uma página? Envie de novo." : msg || "Foto nítida ou PDF."}
          </p>
        </div>
      </div>
      {tipo === "passaporte" && !feito && (
        <label className="block mt-3">
          <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Validade do passaporte (opcional)</span>
          <input type="date" className="rel-input" value={validade} onChange={(e) => setValidade(e.target.value)} />
        </label>
      )}
      <button
        onClick={() => ref.current?.click()}
        disabled={estado === "enviando"}
        className="mt-3 w-full py-3 rounded-xl text-[15px] font-bold disabled:opacity-60"
        style={feito ? { background: "var(--card2)", color: "var(--ink)", border: "1px solid var(--line)" } : { background: "var(--rel)", color: "#fff" }}
      >
        {estado === "enviando" ? "Enviando…" : feito ? "Enviar outra página" : "Enviar foto ou PDF"}
      </button>
      <input ref={ref} type="file" hidden accept="image/*,application/pdf,.heic,.heif" onChange={(e) => void escolher(e.target.files?.[0])} />
    </li>
  );
}

export default function DocumentosPublico({ token }: { token: string }) {
  const [pedido, setPedido] = useState<PedidoPublico | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [concluido, setConcluido] = useState(false);
  const [enviadosAgora, setEnviadosAgora] = useState(0);

  useEffect(() => {
    document.title = "Envio de documentos · Se Tu For, Eu Vou";
    lerPedidoPublico(token).then((p) => { setPedido(p); setConcluido(p.concluido); }).catch((e) => setErro(e instanceof Error ? e.message : "Link inválido."));
  }, [token]);

  const enviadosPorTipo = (t: TipoDocumento) => (pedido?.enviados ?? []).filter((e) => e.tipo === t).length;
  const temAlgum = enviadosAgora > 0 || (pedido?.enviados.length ?? 0) > 0;

  async function concluir() {
    try { await concluirPeloLink(token); } catch { /* o que importa já foi: os arquivos */ }
    setConcluido(true);
  }

  return (
    <div className="min-h-screen px-4 py-8" style={{ background: "var(--bg)" }}>
      <style>{REL_CSS}</style>
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl text-white font-black text-lg mb-3" style={{ background: "var(--rel)" }}>✈</span>
          <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--rel-ink)" }}>Se Tu For, Eu Vou! Viagens</p>
        </div>

        {erro ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <p className="text-[17px] font-bold" style={{ color: "var(--ink)" }}>Este link não está mais valendo</p>
            <p className="text-[14px] mt-2" style={{ color: "var(--ink3)" }}>{erro} Peça um novo link para o nosso time no WhatsApp.</p>
          </div>
        ) : !pedido ? (
          <p className="text-center text-[14px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : pedido.expirado ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <p className="text-[17px] font-bold" style={{ color: "var(--ink)" }}>Este link expirou</p>
            <p className="text-[14px] mt-2" style={{ color: "var(--ink3)" }}>Por segurança ele vale 30 dias. Peça um novo para o nosso time no WhatsApp.</p>
          </div>
        ) : concluido ? (
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
            <p className="text-3xl mb-2">🎉</p>
            <p className="text-[17px] font-bold" style={{ color: "var(--ink)" }}>Tudo certo{pedido.nome ? `, ${pedido.nome}` : ""}!</p>
            <p className="text-[14px] mt-2" style={{ color: "var(--ink3)" }}>Recebemos seus documentos. Nosso time confere e, se precisar de algo, fala com você pelo WhatsApp.</p>
            <button className="mt-4 text-[13px] font-semibold underline" style={{ color: "var(--rel-ink)" }} onClick={() => setConcluido(false)}>Enviar mais alguma coisa</button>
          </div>
        ) : (
          <>
            <h1 className="text-[22px] font-bold leading-tight" style={{ color: "var(--ink)" }}>
              Oi{pedido.nome ? `, ${pedido.nome}` : ""}! Envie seus documentos da viagem
            </h1>
            <p className="text-[14px] mt-2" style={{ color: "var(--ink2)" }}>
              Leva um minutinho: toque em cada item e tire a foto (ou escolha um PDF).
            </p>
            {pedido.mensagem && (
              <div className="mt-4 rounded-xl p-3 text-[14px] whitespace-pre-wrap" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
                {pedido.mensagem}
              </div>
            )}
            <ul className="mt-5 space-y-3">
              {pedido.tipos.map((t) => (
                <ItemDocumento key={t} token={token} tipo={t} jaEnviados={enviadosPorTipo(t)} onEnviado={() => setEnviadosAgora((x) => x + 1)} />
              ))}
            </ul>
            <button
              onClick={concluir}
              disabled={!temAlgum}
              className="mt-6 w-full py-3.5 rounded-xl text-[16px] font-bold disabled:opacity-40"
              style={{ background: "var(--ink)", color: "var(--bg)" }}
            >
              Terminei
            </button>
            <p className="mt-4 text-[12px] text-center leading-snug" style={{ color: "var(--ink3)" }}>
              🔒 Seus documentos ficam guardados com segurança e só o time da agência vê. Usamos apenas para organizar a sua viagem (LGPD).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
