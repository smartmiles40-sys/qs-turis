// src/rel/clientes/ContatoModal.tsx
// "Registrar contato": quando o time fala com o cliente fora do WhatsApp do
// Relacionamento (ligação, encontro, Instagram…). Conta no índice de contato.
import { useEffect, useState } from "react";
import { CANAIS_CONTATO, registrarContato, type CanalContato } from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

const agoraLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export default function ContatoModal({ aberto, clienteId, nome, onFechar, onSalvo }: {
  aberto: boolean; clienteId: string; nome: string; onFechar: () => void; onSalvo: () => void;
}) {
  const [canal, setCanal] = useState<CanalContato>("ligacao");
  const [resumo, setResumo] = useState("");
  const [quando, setQuando] = useState(agoraLocal());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (aberto) { setCanal("ligacao"); setResumo(""); setQuando(agoraLocal()); setErro(null); } }, [aberto]);

  async function salvar() {
    // contato no futuro deixaria "dias sem contato" negativo
    if (quando && new Date(quando).getTime() > Date.now() + 60_000) { setErro("A data do contato não pode ser no futuro."); return; }
    setSalvando(true);
    setErro(null);
    try {
      await registrarContato(clienteId, canal, resumo, quando ? new Date(quando).toISOString() : undefined);
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não salvou.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo={`Registrar contato com ${nome.split(" ")[0]}`} onFechar={onFechar} largura={460}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Registrar"}</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Como foi">
          <select className="rel-input" value={canal} onChange={(e) => setCanal(e.target.value as CanalContato)}>
            {Object.entries(CANAIS_CONTATO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Quando"><Entrada type="datetime-local" value={quando} max={agoraLocal()} onChange={(e) => setQuando(e.target.value)} /></Campo>
        <Campo rotulo="Resumo" dica="O que conversaram — ex.: perguntou sobre o Japão 2027.">
          <textarea className="rel-input" rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
