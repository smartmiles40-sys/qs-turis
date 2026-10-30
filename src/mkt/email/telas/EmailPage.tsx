// Marketing › E-mail — UMA entrada no menu (30/10/2026). Abas: Campanhas |
// Modelos | Públicos | Automações (#mkt/email?aba=…). O relatório mora dentro de
// cada campanha (+ resumo no topo de Campanhas) e a conexão do Resend é o selo
// no canto, que abre num Modal (#mkt/email?conexao=1 abre direto).
import { lazy, useState } from "react";
import { gravarParamNoHash, lerParamDoHash } from "@/lib/hashQuery";
import { PaginaComAbas } from "../../Abas";
import { EmailProvider } from "../contexto";
import { Modal } from "../ui";
import { PainelConexao, SeloConexao } from "./Conexao";

const Campanhas = lazy(() => import("./Campanhas"));
const Modelos = lazy(() => import("./Modelos"));
const Segmentos = lazy(() => import("./Segmentos"));
const Automacoes = lazy(() => import("./Automacoes"));

export default function EmailPage() {
  const [conexao, setConexao] = useState(() => lerParamDoHash("conexao") === "1");
  const abrir = () => { setConexao(true); gravarParamNoHash("conexao", "1"); };
  const fechar = () => { setConexao(false); gravarParamNoHash("conexao", null); };
  return (
    <EmailProvider onAbrirConexao={abrir}>
      <div className="max-w-6xl mx-auto">
        <PaginaComAbas
          titulo="E-mail"
          subtitulo="Campanhas e sequências automáticas por e-mail, com abertura e clique medidos pelo QS."
          acoes={<SeloConexao />}
          abas={[
            { id: "campanhas", rotulo: "Campanhas", componente: Campanhas },
            { id: "modelos", rotulo: "Modelos", componente: Modelos },
            { id: "publicos", rotulo: "Públicos", componente: Segmentos },
            { id: "automacoes", rotulo: "Automações", componente: Automacoes },
          ]}
        />
      </div>
      <Modal aberto={conexao} titulo="Conexão do e-mail (Resend)" onFechar={fechar} largura={760}>
        <PainelConexao />
      </Modal>
    </EmailProvider>
  );
}
