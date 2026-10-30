// src/expedicoes/paginas/Receitas.tsx
// 30/10 (Bruno): "as Receitas têm que ficar vinculadas SOMENTE dentro da ficha do
// cliente". A tela solta saiu do menu; este endereço antigo (#ops/receitas,
// #rel/exp-receitas) só REDIRECIONA, pra link salvo não quebrar:
//   • #…/receitas/<passageiroId>  → a ficha dessa pessoa, aba Saúde;
//   • #…/receitas                 → Inscrições, onde fica o alerta "Receitas a
//                                   enviar" (cada linha abre a ficha).
// A receita em si (marcar enviada / não precisa / histórico) está na ficha:
// src/rel/clientes/ficha/AbaSaude.tsx.
import { useEffect, useState } from "react";
import { Aviso } from "@/rel/ui";
import { useExp } from "../contexto";
import { Carregando } from "../ui";
import { supabase } from "../lib/banco";
import { hashDaFicha } from "@/rel/clientes/ficha/ReceitasAEnviar";

export default function Receitas() {
  const { ir } = useExp();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const partes = window.location.hash.split("?")[0].split("/");
    const i = partes.findIndex((p) => p === "receitas" || p === "exp-receitas");
    const paxId = i >= 0 ? partes[i + 1] : undefined;
    if (!paxId) { ir("inscricoes"); return; }
    let vivo = true;
    void supabase.from("passageiros").select("cliente_id").eq("id", decodeURIComponent(paxId)).maybeSingle().then(({ data, error }) => {
      if (!vivo) return;
      const cid = (data as { cliente_id: string | null } | null)?.cliente_id;
      if (error || !cid) { setErro("Este passageiro ainda não tem ficha de cliente. As receitas a enviar estão nas Inscrições."); return; }
      window.location.replace(hashDaFicha(cid));
    });
    return () => { vivo = false; };
  }, [ir]);

  return erro ? <Aviso>{erro}</Aviso> : <Carregando />;
}
