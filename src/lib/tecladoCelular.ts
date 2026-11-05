// src/lib/tecladoCelular.ts
// -----------------------------------------------------------------------------
// TECLADO DO CELULAR × TELA DO WHATSAPP (04/11)
//
// Por que existe: o WhatsApp do comercial virou API e o time passa a atender
// pelo QS no celular (PWA no iPhone). No iPhone, abrir o teclado NÃO encolhe a
// página: o Safari só "empurra" a vista pra cima. O painel de conversa é
// `position: fixed; inset: 0`, então o empurrão escondia o cabeçalho (nome do
// cliente e o voltar) e, às vezes, o próprio campo de digitar ficava por baixo
// do teclado. `dvh` não resolve: ele acompanha a barra do Safari, não o teclado.
//
// O jeito confiável é ler o visualViewport (a parte que SOBROU visível acima do
// teclado) e passar pro CSS:
//   --qs-vvh    altura visível de verdade
//   --qs-vvtop  quanto o Safari deslocou a vista pra baixo
//   html.qs-teclado  teclado aberto (a vista encolheu mais de 120 px)
// Quem usa é o CSS do dock em tela cheia e do shell do Comercial (index.css),
// SEMPRE dentro de @media (max-width: 767px).
//
// Computador: não faz nada. Só liga abaixo de 768 px; acima disso as variáveis
// são removidas, então nenhuma regra do computador as enxerga.
// -----------------------------------------------------------------------------

let instalado = false;

export function instalarTecladoCelular(): void {
  if (instalado || typeof window === "undefined") return;
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia) return;
  instalado = true;

  const celular = window.matchMedia("(max-width: 767px)");
  const raiz = document.documentElement;
  let quadro = 0;

  const aplicar = () => {
    quadro = 0;
    if (!celular.matches) {
      raiz.style.removeProperty("--qs-vvh");
      raiz.style.removeProperty("--qs-vvtop");
      raiz.classList.remove("qs-teclado");
      return;
    }
    raiz.style.setProperty("--qs-vvh", `${Math.round(vv.height)}px`);
    raiz.style.setProperty("--qs-vvtop", `${Math.round(vv.offsetTop)}px`);
    raiz.classList.toggle("qs-teclado", window.innerHeight - vv.height > 120);
  };
  // Um cálculo por quadro: o Safari dispara dezenas de eventos durante a
  // animação do teclado subindo.
  const agendar = () => { if (!quadro) quadro = requestAnimationFrame(aplicar); };

  vv.addEventListener("resize", agendar);
  vv.addEventListener("scroll", agendar);
  celular.addEventListener?.("change", agendar);
  aplicar();
}
