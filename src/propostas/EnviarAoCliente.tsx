// src/propostas/EnviarAoCliente.tsx
// -----------------------------------------------------------------------------
// O modal "Enviar ao cliente": link + mensagem pronta pra colar no WhatsApp.
// Usado por quem monta (proposta do próprio time) e por quem pediu (0157).
// -----------------------------------------------------------------------------
import { Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { linkDaProposta, mensagemDaProposta, type Proposta } from "./lib";

export default function EnviarAoCliente({ p, aberto, onFechar, onCopiado }: {
  p: Proposta;
  aberto: boolean;
  onFechar: () => void;
  onCopiado: (msg: string) => void;
}) {
  const link = p.token ? linkDaProposta(p.token) : null;
  const copiar = (t: string, ok: string) => void navigator.clipboard?.writeText(t).then(() => onCopiado(ok));
  return (
    <Modal aberto={aberto} titulo="Enviar ao cliente" onFechar={onFechar} largura={520}>
      {link ? (
        <div className="space-y-3">
          <Campo rotulo="Link da proposta">
            <div className="flex gap-2"><Entrada readOnly value={link} onFocus={(e) => e.target.select()} /><Botao onClick={() => copiar(link, "Link copiado.")}>Copiar</Botao></div>
          </Campo>
          <Campo rotulo="Mensagem pronta (cole no WhatsApp do cliente)">
            <textarea className="rel-input" rows={7} readOnly value={mensagemDaProposta(p, link)} />
          </Campo>
          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" onClick={() => copiar(mensagemDaProposta(p, link), "Mensagem copiada — cole na conversa do cliente.")}>Copiar mensagem</Botao>
            <Botao onClick={() => window.open(`${link}?equipe=1`, "_blank", "noopener")}>Abrir o link</Botao>
          </div>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Quando o cliente abrir, aparece na proposta. Se ele escolher uma opção pelo link, você recebe o aviso no menu Propostas.</p>
        </div>
      ) : <p className="text-[14px]">Salve a proposta primeiro.</p>}
    </Modal>
  );
}
