// src/mkt/grupos/GruposArea.tsx — a página "Grupos" do Marketing, no jeito do SendFlow:
// abas Campanhas | Cadências | Grupos | Links | Celular e o selo do chip no canto.
//   #mkt/grupos                 → Campanhas
//   #mkt/grupos?aba=cadencias   · ?aba=grupos · ?aba=links · ?aba=celular · ?chip=1 (abre o chip)
import { lazy } from "react";
import { PaginaComAbas } from "../Abas";
import { ChipProvider } from "./contexto";
import { SeloChip } from "./Chip";
import { GRUPOS_CSS } from "./pecas";

const Campanhas = lazy(() => import("./Campanhas"));
const Cadencias = lazy(() => import("./Cadencias"));
const Grupos = lazy(() => import("./Grupos"));
const Links = lazy(() => import("./Links"));
const Celular = lazy(() => import("./Celular"));

export default function GruposArea() {
  return (
    <ChipProvider>
      <style>{GRUPOS_CSS}</style>
      <PaginaComAbas
        titulo="Grupos"
        subtitulo="Grupos do WhatsApp pelo chip do Marketing: campanhas, cadências, tags, links de entrada e o celular ao vivo."
        acoes={<SeloChip />}
        abas={[
          { id: "campanhas", rotulo: "Campanhas", icone: "📣", componente: Campanhas },
          { id: "cadencias", rotulo: "Cadências", icone: "🧭", componente: Cadencias },
          { id: "grupos", rotulo: "Grupos", icone: "👥", componente: Grupos },
          { id: "links", rotulo: "Links", icone: "🔗", componente: Links },
          { id: "celular", rotulo: "Celular", icone: "📱", componente: Celular },
        ]}
      />
    </ChipProvider>
  );
}
