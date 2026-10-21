// Aba "Passageiros" da expedição (app antigo: app/(app)/expedicoes/[id]/passageiros/).
// Tudo mora em src/expedicoes/passageiros/ — aqui só liga a aba ao painel.
// Endereços: sub = ["pax", id] (gaveta do pax), ["pax", id, "perfil"] (página
// completa) e ["prontidao", id] (gaveta de prontidão).
import type { PropsAba } from "../ExpedicaoDetalhe";
import PainelPassageiros from "../../passageiros/PainelPassageiros";

export default function AbaPassageiros({ exp, sub, onMudou }: PropsAba) {
  return <PainelPassageiros exp={exp} sub={sub} onMudou={onMudou} />;
}
