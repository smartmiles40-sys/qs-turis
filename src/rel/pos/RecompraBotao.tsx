// src/rel/pos/RecompraBotao.tsx
// -----------------------------------------------------------------------------
// "Criar oportunidade no Comercial": o cliente quer viajar de novo e o
// Relacionamento passa a bola. O lead nasce no Comercial (carteira primeiro,
// senão rodízio; cadência padrão) — SEM card no Bitrix: o Comercial decide.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { criarRecompra } from "../lib/pos";
import { Aviso, Botao, Campo, Modal } from "../ui";

export default function RecompraBotao({ clienteId, viagemId, compacto, sugestao, onCriada }: {
  clienteId: string;
  viagemId?: string | null;
  compacto?: boolean;
  /** Texto inicial do interesse (ex.: o "próximo destino" da pesquisa). */
  sugestao?: string | null;
  onCriada?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [interesse, setInteresse] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function abrir() {
    setInteresse(sugestao ? `Quer ir para: ${sugestao}` : "");
    setErro(null);
    setOk(null);
    setAberto(true);
  }

  async function criar() {
    if (!interesse.trim()) { setErro("Conte o que o cliente quer: destino, época, quantas pessoas."); return; }
    setEnviando(true);
    setErro(null);
    try {
      const r = await criarRecompra(clienteId, interesse, viagemId);
      setOk(r.dono
        ? `Oportunidade criada no Comercial com ${r.dono}.${r.jaExistia ? " (O cliente já tinha entrado como lead hoje — usamos o mesmo card.)" : ""}`
        : "Oportunidade criada no Comercial — vai pra distribuição.");
      onCriada?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Botao variante={compacto ? "fantasma" : "primario"} onClick={abrir} style={compacto ? { color: "var(--rel-ink)" } : undefined}>
        {compacto ? "+ Oportunidade no Comercial" : "Criar oportunidade no Comercial"}
      </Botao>
      <Modal
        aberto={aberto}
        titulo="Nova oportunidade no Comercial"
        onFechar={() => setAberto(false)}
        rodape={ok
          ? <Botao variante="primario" onClick={() => setAberto(false)}>Fechar</Botao>
          : <><Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao><Botao variante="primario" onClick={criar} disabled={enviando}>{enviando ? "Criando…" : "Criar oportunidade"}</Botao></>}
      >
        {ok ? (
          <Aviso tom="ok">{ok}</Aviso>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              O cliente entra como lead no Comercial, com a fonte <b>"Recompra — Relacionamento"</b> e uma nota com a última viagem e a nota da pesquisa.
              Quem já atendeu esse telefone recebe de volta; senão, vai pro rodízio. Não abre card no Bitrix — o Comercial decide.
            </p>
            <Campo rotulo="O que o cliente quer? *">
              <textarea className="rel-input" rows={3} value={interesse} onChange={(e) => setInteresse(e.target.value)}
                placeholder="Ex.: Japão em março de 2027, casal, quer algo mais tranquilo." autoFocus />
            </Campo>
            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>
    </>
  );
}
