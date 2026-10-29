// src/expedicoes/detalhe/abas/AbaFinanceiro.tsx
// Aba "Financeiro" do cockpit (era "Valores"; redesign 29/10, spec §3.2).
// Valor de cada cliente, condição, pago e saldo (migration 0220) + faixa âmbar de
// quem está sem valor com "Definir preço padrão". Tudo mora em src/expedicoes/valores/.
import type { PropsAba } from "../ExpedicaoDetalhe";
import PainelValores from "../../valores/PainelValores";

export default function AbaFinanceiro({ exp, onMudou, cockpit }: PropsAba) {
  return <PainelValores exp={exp} onMudou={() => { onMudou(); cockpit?.recarregarResumo(); }} />;
}
