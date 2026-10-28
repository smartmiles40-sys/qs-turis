// src/rel/pos/RecompraBotao.tsx
// -----------------------------------------------------------------------------
// "Nova oportunidade" (0218): o cliente quer viajar de novo e o Relacionamento
// VENDE — o cartão nasce no Pipeline de vendas do Rel. Antes (até 27/10) este
// botão mandava o cliente pro SDR; o Bruno decidiu que o cliente da casa fica
// 100% com o Relacionamento (api/rel-recompra agora responde 410).
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Botao } from "../ui";
import NovaOportunidade from "../vendas/NovaOportunidade";

export default function RecompraBotao({ clienteId, clienteNome, viagemId, compacto, sugestao, onCriada }: {
  clienteId: string;
  clienteNome?: string;
  viagemId?: string | null;
  compacto?: boolean;
  /** Texto inicial do interesse (ex.: o "próximo destino" da pesquisa). */
  sugestao?: string | null;
  onCriada?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [ok, setOk] = useState(false);

  return (
    <>
      <Botao variante={compacto ? "fantasma" : "primario"} onClick={() => { setOk(false); setAberto(true); }} style={compacto ? { color: "var(--rel-ink)" } : undefined}>
        {compacto ? "+ Oportunidade de venda" : "Criar oportunidade de venda"}
      </Botao>
      {ok && <span className="text-[12px]" style={{ color: "var(--rel-ink)" }}>no pipeline ✓</span>}
      <NovaOportunidade
        aberto={aberto} onFechar={() => setAberto(false)}
        cliente={{ id: clienteId, nome: clienteNome ?? "este cliente" }}
        viagemId={viagemId} origem={viagemId ? "recompra" : "manual"} sugestao={sugestao}
        onCriada={() => { setAberto(false); setOk(true); onCriada?.(); }}
      />
    </>
  );
}

