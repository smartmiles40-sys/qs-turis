// src/rel/publico/PesquisaPublica.tsx
// -----------------------------------------------------------------------------
// A PESQUISA que o CLIENTE abre (/pesquisa/<token>), sem login, quase sempre
// no celular, logo depois de voltar de viagem. Tem que ser rápida e calorosa:
// uma nota de 0 a 10 em botões grandes e três perguntas abertas opcionais.
//
// Quem fala com o banco é o servidor (api/rel-pesquisa) — esta página nunca
// lê nada além do primeiro nome e do nome da viagem.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { REL_CSS } from "../ui";

type Estado =
  | { fase: "carregando" }
  | { fase: "invalido" }
  | { fase: "respondida" }
  | { fase: "aberta"; nome: string | null; viagem: string | null }
  | { fase: "obrigado"; nota: number };

const PERGUNTAS = [
  { chave: "melhor_parte", rotulo: "O que foi o melhor da viagem?", ph: "Um lugar, um momento, alguém do grupo…", max: 2000 },
  { chave: "comentario", rotulo: "Algo que poderíamos fazer melhor?", ph: "Pode falar à vontade — é assim que a gente melhora.", max: 2000 },
  { chave: "proximo_destino", rotulo: "Para onde você quer ir na próxima?", ph: "Ex.: Japão, Patagônia, Egito…", max: 200 },
] as const;

function corDaNota(n: number) {
  if (n >= 9) return "#0E7C6A";
  if (n >= 7) return "#B7791F";
  return "#B4242A";
}

export default function PesquisaPublica({ token }: { token: string }) {
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });
  const [nota, setNota] = useState<number | null>(null);
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Como foi sua viagem? · Se Tu For, Eu Vou";
    fetch(`/api/rel-pesquisa?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (!r.ok) { setEstado({ fase: "invalido" }); return; }
        const j = await r.json();
        setEstado(j.respondida ? { fase: "respondida" } : { fase: "aberta", nome: j.nome, viagem: j.viagem });
      })
      .catch(() => setEstado({ fase: "invalido" }));
  }, [token]);

  async function enviar() {
    if (nota == null) { setErro("Escolha uma nota de 0 a 10."); return; }
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/rel-pesquisa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nota, ...textos }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { setEstado({ fase: "respondida" }); return; }
      if (!r.ok) throw new Error(j.error || "Não conseguimos registrar agora.");
      setEstado({ fase: "obrigado", nota });
      window.scrollTo(0, 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não conseguimos registrar agora. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-[100dvh] px-4 py-8 sm:py-14" style={{ background: "var(--bg)" }}>
      <style>{REL_CSS}</style>
      <div className="max-w-lg mx-auto">
        <p className="text-center text-[13px] font-bold tracking-wide mb-6" style={{ color: "var(--rel-ink)" }}>
          Se Tu For, Eu Vou! Viagens
        </p>

        {estado.fase === "carregando" && (
          <p className="text-center text-sm" style={{ color: "var(--ink3)" }}>Carregando…</p>
        )}

        {estado.fase === "invalido" && (
          <div className="rel-card p-6 text-center">
            <p className="text-base font-bold" style={{ color: "var(--ink)" }}>Este link não está mais valendo</p>
            <p className="text-sm mt-2" style={{ color: "var(--ink2)" }}>Se quiser contar como foi a viagem, responda a mensagem que te mandamos no WhatsApp. 💚</p>
          </div>
        )}

        {estado.fase === "respondida" && (
          <div className="rel-card p-6 text-center">
            <p className="text-3xl mb-2">💚</p>
            <p className="text-base font-bold" style={{ color: "var(--ink)" }}>Você já respondeu esta pesquisa</p>
            <p className="text-sm mt-2" style={{ color: "var(--ink2)" }}>Obrigado por contar pra gente como foi!</p>
          </div>
        )}

        {estado.fase === "obrigado" && (
          <div className="rel-card p-6 text-center space-y-3">
            <p className="text-4xl">{estado.nota >= 9 ? "🥰" : estado.nota >= 7 ? "😊" : "🙏"}</p>
            <p className="text-lg font-bold" style={{ color: "var(--ink)" }}>Muito obrigado!</p>
            {estado.nota >= 9 ? (
              <p className="text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
                Ficamos muito felizes que a viagem foi especial. Se tiver alguém que você acha que ia amar viajar com a gente,
                indica a Se Tu For, Eu Vou — e conta pra eles como foi! ✈️
              </p>
            ) : estado.nota >= 7 ? (
              <p className="text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
                Sua resposta ajuda a gente a deixar a próxima viagem ainda melhor.
              </p>
            ) : (
              <p className="text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
                Sentimos muito que a viagem não foi como você esperava. Nosso time de Relacionamento vai ler com atenção e
                pode entrar em contato pra entender melhor.
              </p>
            )}
          </div>
        )}

        {estado.fase === "aberta" && (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-bold leading-tight" style={{ color: "var(--ink)" }}>
                {estado.nome ? `${estado.nome}, como foi a viagem?` : "Como foi a viagem?"}
              </h1>
              {estado.viagem && <p className="text-sm mt-1.5" style={{ color: "var(--ink3)" }}>{estado.viagem}</p>}
            </div>

            <div className="rel-card p-5">
              <p className="text-[15px] font-semibold mb-3" style={{ color: "var(--ink)" }}>
                De 0 a 10, o quanto você recomendaria a Se Tu For, Eu Vou para um amigo?
              </p>
              <div className="grid grid-cols-6 sm:grid-cols-11 gap-1.5" role="radiogroup" aria-label="Nota de 0 a 10">
                {Array.from({ length: 11 }, (_, n) => {
                  const sel = nota === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => { setNota(n); setErro(null); }}
                      className="h-12 rounded-xl text-base font-bold transition-transform active:scale-95"
                      style={sel
                        ? { background: corDaNota(n), color: "#fff", border: `2px solid ${corDaNota(n)}` }
                        : { background: "var(--card)", color: "var(--ink)", border: "1px solid var(--line)" }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between text-[11px] mt-1.5" style={{ color: "var(--ink3)" }}>
                <span>Nada provável</span><span>Com certeza</span>
              </div>
            </div>

            {PERGUNTAS.map((p) => (
              <div key={p.chave} className="rel-card p-5">
                <label className="block">
                  <span className="block text-[15px] font-semibold mb-2" style={{ color: "var(--ink)" }}>
                    {p.rotulo} <span className="text-[12px] font-normal" style={{ color: "var(--ink3)" }}>(opcional)</span>
                  </span>
                  {p.chave === "proximo_destino" ? (
                    <input className="rel-input" maxLength={p.max} placeholder={p.ph}
                      value={textos[p.chave] || ""} onChange={(e) => setTextos((t) => ({ ...t, [p.chave]: e.target.value }))} />
                  ) : (
                    <textarea className="rel-input" rows={3} maxLength={p.max} placeholder={p.ph}
                      value={textos[p.chave] || ""} onChange={(e) => setTextos((t) => ({ ...t, [p.chave]: e.target.value }))} />
                  )}
                </label>
              </div>
            ))}

            {erro && (
              <p className="text-sm text-center" style={{ color: "var(--err-ink)" }}>{erro}</p>
            )}
            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className="w-full py-3.5 rounded-xl text-base font-bold text-white disabled:opacity-60"
              style={{ background: "var(--rel)" }}
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
            <p className="text-center text-[11px]" style={{ color: "var(--ink3)" }}>Suas respostas ficam só com o time da Se Tu For, Eu Vou.</p>
          </div>
        )}
      </div>
    </div>
  );
}
