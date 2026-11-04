// src/lib/useCelular.ts
// -----------------------------------------------------------------------------
// "Estou no celular?" — mesma régua da base mobile de julho: abaixo de 768 px.
//
// Só pra o que CSS não alcança (texto de placeholder, rótulo encurtado). Layout
// continua em classe/media query; este hook existe pra não espalhar
// window.matchMedia solto pelos componentes (04/11).
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";

const CONSULTA = "(max-width: 767px)";

export function useCelular(): boolean {
  const [celular, setCelular] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(CONSULTA).matches
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(CONSULTA);
    const on = () => setCelular(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return celular;
}
