// src/components/sdr/wa/WaFigurinhas.tsx
// -----------------------------------------------------------------------------
// A galeria de figurinhas do SDR — o painel que abre em cima do campo de
// escrever, como o de emojis. Um clique manda a figurinha pra conversa.
//
// De onde vêm as figurinhas:
//   • do botão "salvar" que aparece sobre qualquer figurinha da conversa;
//   • do "+" aqui do painel: uma imagem qualquer vira figurinha (512px, webp,
//     fundo transparente) convertida no próprio navegador.
//
// A galeria é PESSOAL (RLS por dono na qs_wa_figurinhas) e carrega sob demanda:
// quem nunca abre não paga o peso.
// -----------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  listFigurinhas, salvarFigurinha, removerFigurinha, converterParaFigurinha,
  type Figurinha,
} from "@/lib/qs/waInbox";

interface Props {
  /** Chamada com a figurinha escolhida; quem envia (e fecha o painel) é a conversa. */
  onEnviar: (fig: Figurinha) => void;
  onClose: () => void;
}

export default function WaFigurinhas({ onEnviar, onClose }: Props) {
  const [figs, setFigs] = useState<Figurinha[] | null>(null);   // null = carregando
  const [erro, setErro] = useState<string | null>(null);
  const [subindo, setSubindo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const recarregar = () => listFigurinhas().then(setFigs);

  useEffect(() => { void recarregar(); }, []);

  const subir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErro(null);
    setSubindo(true);
    // .webp pronto entra como está (já é o formato de figurinha); o resto passa
    // pela conversão pra 512px transparente.
    let dado: string | undefined;
    if (f.type === "image/webp" && f.size <= 300 * 1024) {
      dado = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ""));
        fr.onerror = () => resolve("");
        fr.readAsDataURL(f);
      });
      if (!dado) { setErro("Não consegui ler o arquivo."); setSubindo(false); return; }
    } else {
      const conv = await converterParaFigurinha(f);
      if (!conv.dado) { setErro(conv.error || "Não consegui converter."); setSubindo(false); return; }
      dado = conv.dado;
    }
    const r = await salvarFigurinha(dado);
    setSubindo(false);
    if (!r.ok) { setErro(r.error || "Não consegui salvar."); return; }
    await recarregar();
  };

  const remover = async (fig: Figurinha) => {
    // Some da tela na hora; se o banco recusar, volta no recarregar.
    setFigs((prev) => (prev ? prev.filter((f) => f.id !== fig.id) : prev));
    const ok = await removerFigurinha(fig.id);
    if (!ok) await recarregar();
  };

  return (
    <div className="shrink-0 border-t flex flex-col"
         style={{ borderColor: "var(--line)", background: "var(--card)", height: 248 }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="text-[12px] font-bold" style={{ color: "var(--ink2)" }}>
          Suas figurinhas
        </span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void subir(e)} />
        <button onClick={() => fileRef.current?.click()} disabled={subindo}
                className="wa-chip text-[11px] font-semibold px-2 py-1 rounded-lg"
                style={{ background: "transparent", color: "var(--ink2)", border: "1px solid var(--line)" }}>
          {subindo ? "Convertendo…" : "+ Adicionar imagem"}
        </button>
        <button onClick={onClose} aria-label="Fechar figurinhas"
                className="wa-icon-btn ml-auto w-7 h-7 grid place-items-center rounded-lg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {erro && (
        <p className="px-3 pb-1 text-[11.5px] font-semibold" style={{ color: "var(--wa-err-ink)" }}>{erro}</p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {figs === null ? (
          <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {Array.from({ length: 8 }, (_, i) => <span key={i} className="wa-sk rounded-xl" style={{ height: 72 }} />)}
          </div>
        ) : figs.length === 0 ? (
          <div className="text-center pt-6 px-4">
            <p className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Nenhuma figurinha salva</p>
            <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: "var(--ink3)" }}>
              Passe o mouse numa figurinha da conversa e clique em <b>salvar</b> —
              ou use o <b>+ Adicionar imagem</b> aqui em cima.
            </p>
          </div>
        ) : (
          <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))" }}>
            {figs.map((fig) => (
              <div key={fig.id} className="relative group">
                <button onClick={() => onEnviar(fig)} title="Enviar figurinha"
                        className="block w-full rounded-xl overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        style={{ background: "var(--card2)" }}>
                  <img src={fig.dado} alt="Figurinha salva" loading="lazy" decoding="async"
                       className="block w-full aspect-square object-contain" />
                </button>
                <button onClick={() => void remover(fig)} aria-label="Remover figurinha"
                        className="absolute -top-1 -right-1 w-5 h-5 grid place-items-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink3)" }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
