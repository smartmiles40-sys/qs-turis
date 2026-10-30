// src/mkt/grupos/Retomar.tsx — retomar uma campanha pausada. As 10 que vieram do SendFlow
// estão pausadas DE PROPÓSITO (o SendFlow ainda manda elas): antes de retomar uma dessas,
// a tela mostra o aviso inteiro e pede confirmação explícita.
import { useCallback, useState, type ReactNode } from "react";
import { Modal } from "@/rel/ui";
import { api, type Campanha } from "./lib";
import { avisoPausadaDeProposito } from "./datas";
import { BotaoGrande, Nota, cor } from "./pecas";

/** Agenda de novo (o servidor confere tudo). Devolve a lista de erros (vazia = ok). */
export async function agendarNoServidor(id: string): Promise<string[]> {
  const r = await api<{ ok: boolean; erros?: string[] }>("agendar", { campanhaId: id });
  return r.ok ? [] : r.erros?.length ? r.erros : ["Não deu pra agendar."];
}

/**
 * `pedir(c, acao)` roda `acao` direto se a campanha não tiver o aviso de "pausada de
 * propósito"; se tiver, abre o modal e só roda depois do "Sim, retomar".
 */
export function useConfirmarRetomada(): [(c: Pick<Campanha, "nome" | "avisos">, acao: () => Promise<void> | void) => void, ReactNode] {
  const [pendente, setPendente] = useState<{ nome: string; aviso: string; acao: () => Promise<void> | void } | null>(null);
  const [entendi, setEntendi] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const pedir = useCallback((c: Pick<Campanha, "nome" | "avisos">, acao: () => Promise<void> | void) => {
    const aviso = avisoPausadaDeProposito(c.avisos);
    if (!aviso) { void acao(); return; }
    setEntendi(false);
    setPendente({ nome: c.nome, aviso, acao });
  }, []);
  const fechar = () => { if (!ocupado) setPendente(null); };
  const modal = (
    <Modal aberto={Boolean(pendente)} titulo="Retomar campanha migrada do SendFlow?" onFechar={fechar} largura={520}
      rodape={<>
        <BotaoGrande variante="secundario" pequeno onClick={fechar} disabled={ocupado}>Não, deixar pausada</BotaoGrande>
        <BotaoGrande pequeno disabled={!entendi || ocupado}
          onClick={async () => { if (!pendente) return; setOcupado(true); try { await pendente.acao(); } finally { setOcupado(false); setPendente(null); } }}>
          {ocupado ? "Retomando…" : "▶ Sim, retomar"}
        </BotaoGrande>
      </>}>
      {pendente && (
        <div className="flex flex-col gap-3 text-[14px]" style={{ color: cor.ink }}>
          <p><b>{pendente.nome}</b></p>
          <Nota tom="aviso" icone="⚠️">{pendente.aviso}</Nota>
          <p className="text-[13px]" style={{ color: cor.ink2 }}>
            Se o SendFlow ainda estiver ligado, os grupos vão receber esta mensagem <b>duas vezes</b>. Retomar agenda a campanha no QS para a data dela.
          </p>
          <label className="flex cursor-pointer items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
            Conferi: esta campanha está desligada no SendFlow.
          </label>
        </div>
      )}
    </Modal>
  );
  return [pedir, modal];
}
