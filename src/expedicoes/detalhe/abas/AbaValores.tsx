// Aba "Valores" da expedição: valor de cada cliente, condição, pago e saldo
// (migration 0220). Tudo mora em src/expedicoes/valores/.
import type { PropsAba } from "../ExpedicaoDetalhe";
import PainelValores from "../../valores/PainelValores";

export default function AbaValores({ exp, onMudou }: PropsAba) {
  return <PainelValores exp={exp} onMudou={onMudou} />;
}
