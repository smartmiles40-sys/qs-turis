// src/components/sdr/ErroDeParte.tsx
// -----------------------------------------------------------------------------
// Cerca de contenção: mantém o estrago DENTRO da parte que quebrou.
//
// Nasceu de um caso real. O painel de WhatsApp era montado no SdrLayout sem
// nenhuma cerca, e o seletor de emoji dentro dele carrega sob demanda. Numa aba
// aberta desde antes de um deploy, o arquivo do seletor não existe mais no
// servidor: o carregamento falha, o React levanta o erro durante o render e —
// sem uma cerca no caminho — o erro sobe até a raiz e DESMONTA O APP INTEIRO.
// O sintoma que chegou pra gente não foi "o emoji não abre", foi "as SDRs não
// conseguem concluir a atividade": a tela toda tinha morrido junto.
//
// `Suspense` não resolve isso — ele cobre a ESPERA, não a FALHA. Só um error
// boundary (que precisa ser classe, é a única API que o React oferece) captura.
//
// Dois modos:
//  • "bloco"    — ocupa o espaço da parte, com botão de tentar de novo
//  • "discreto" — uma tarja fina; pra widget lateral, onde um cartaz de erro
//                 gigante atrapalharia mais que o próprio defeito
// -----------------------------------------------------------------------------

import { Component, type ReactNode } from "react";

interface Props {
  /** Nome da parte, do jeito que o usuário chama ("o WhatsApp", "o seletor de emoji"). */
  parte: string;
  modo?: "bloco" | "discreto";
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

/** Falha de carregamento de pedaço do app — quase sempre deploy novo com a aba velha. */
function ehChunkSumido(erro: Error | null): boolean {
  if (!erro) return false;
  return /dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(
    `${erro.name}: ${erro.message}`
  );
}

export default class ErroDeParte extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error) {
    console.warn(`[QS] ${this.props.parte} quebrou e foi contido:`, erro);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const versaoVelha = ehChunkSumido(erro);
    const texto = versaoVelha
      ? `Esta aba está com uma versão antiga do QS. Atualize para voltar a usar ${this.props.parte}.`
      : `${this.props.parte} teve um problema. O resto do sistema continua funcionando.`;
    const acao = versaoVelha ? "Atualizar" : "Tentar de novo";
    const executar = () => {
      if (versaoVelha) window.location.reload();
      else this.setState({ erro: null });
    };

    if (this.props.modo === "discreto") {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--ink2)" }}>
          <span className="leading-snug">{texto}</span>
          <button
            onClick={executar}
            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold"
            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
          >
            {acao}
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="max-w-[280px] text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
          {texto}
        </p>
        <button
          onClick={executar}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          {acao}
        </button>
      </div>
    );
  }
}
