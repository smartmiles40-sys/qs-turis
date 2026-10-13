// src/rel/config/GoogleConfig.tsx
// Place ID da agência no Google (KPIs → NPS & Google). Com a chave
// GOOGLE_PLACES_API_KEY na Vercel, a nota e o nº de avaliações vêm sozinhos.
import { useEffect, useState } from "react";
import { lerGoogle, salvarPlaceId } from "../lib/kpis";
import { Aviso, Botao, Entrada } from "../ui";

export default function GoogleConfig({ pode }: { pode: boolean }) {
  const [placeId, setPlaceId] = useState("");
  const [original, setOriginal] = useState("");
  const [temChave, setTemChave] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    lerGoogle().then((g) => { setPlaceId(g.place_id ?? ""); setOriginal(g.place_id ?? ""); setTemChave(g.temChave); })
      .catch((e) => setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não carregou." }));
  }, []);

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      await salvarPlaceId(placeId.trim());
      setOriginal(placeId.trim());
      setMsg({ tom: "ok", t: "Place ID salvo. A nota aparece em KPIs → NPS & Google." });
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não salvou." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Ache o Place ID da agência em{" "}
        <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer" className="underline font-semibold" style={{ color: "var(--rel-ink)" }}>
          Place ID Finder do Google
        </a>{" "}
        (começa com "ChIJ"). Sem chave do Google, dá pra digitar a nota à mão na própria aba de KPIs.
      </p>
      {temChave === false && <Aviso>Falta a chave <b>GOOGLE_PLACES_API_KEY</b> na Vercel (Places API New ativada no Google Cloud). Sem ela, a nota é digitada à mão.</Aviso>}
      <div className="flex gap-2">
        <Entrada value={placeId} onChange={(e) => setPlaceId(e.target.value)} placeholder="ChIJ..." disabled={!pode} aria-label="Place ID do Google" />
        <Botao variante="primario" disabled={!pode || salvando || placeId.trim() === original} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
      </div>
      {msg && <p className="text-[13px]" style={{ color: msg.tom === "ok" ? "var(--rel-ink)" : "var(--err-ink)" }}>{msg.t}</p>}
    </div>
  );
}
