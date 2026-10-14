// src/components/TrocarArea.tsx
// -----------------------------------------------------------------------------
// "IR PARA OUTRA ÁREA" — um botão por área que a pessoa tem, menos a aberta.
//
// Antes (09/10) eram dois botões soltos: "Ir para o Relacionamento" no Comercial
// e "Ir para o Comercial" no Relacionamento. Com Financeiro e Operações (0126,
// 14/10) a troca virou uma peça só, usada em todas as áreas, com a cor de cada
// porta do login.
//
// variante "menu"  → itens de lista (menu do usuário no Comercial)
// variante "bloco" → botões cheios na cor da área (barra lateral, celular)
// -----------------------------------------------------------------------------
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { NOME_SETOR, type Setor } from "@/components/sdr/types";

/** A cor de cada área (a mesma das portas do login). Texto branco em cima passa no AA. */
export const COR_AREA: Record<Setor, string> = {
  comercial: "#0147FF",
  relacionamento: "#0E7C6A",
  financeiro: "#3730A3",
  operacional: "#B45309",
};

/** O "de/da" certo antes do nome da área. */
const PARA: Record<Setor, string> = {
  comercial: "o Comercial",
  relacionamento: "o Relacionamento",
  financeiro: "o Financeiro",
  operacional: "Operações",
};

export default function TrocarArea({ atual, variante, onAntes }: {
  atual: Setor;
  variante: "menu" | "bloco";
  /** Roda antes de trocar (fechar menu, limpar o endereço da área…). */
  onAntes?: () => void;
}) {
  const { currentUser, trocarArea } = useQsAuth();
  const outras = setoresDe(currentUser).filter((s) => s !== atual);
  if (!outras.length) return null;

  if (variante === "menu") {
    return (
      <>
        {outras.map((s) => (
          <button key={s} onClick={() => { onAntes?.(); trocarArea(s); }}
            className="w-full text-left px-4 py-2.5 text-[13px] font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
            style={{ color: COR_AREA[s] }}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COR_AREA[s] }} aria-hidden />
            Ir para {PARA[s]}
          </button>
        ))}
      </>
    );
  }
  return (
    <div className="space-y-1.5" role="group" aria-label="Trocar de área">
      {outras.map((s) => (
        <button key={s} onClick={() => { onAntes?.(); trocarArea(s); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: COR_AREA[s] }} title={`Abrir a área ${NOME_SETOR[s]}`}>
          Ir para {PARA[s]}
        </button>
      ))}
    </div>
  );
}
