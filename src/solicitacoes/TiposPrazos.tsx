// src/solicitacoes/TiposPrazos.tsx
// -----------------------------------------------------------------------------
// Tipos de pedido e o prazo de cada um (0149). Cada gestor cuida dos tipos que
// o SEU setor recebe (admin, de todos). Prazo em horas ÚTEIS (seg–sex 9h–18h:
// 9h = 1 dia útil). Tipo desligado some do "Pedir a outro setor", mas os
// pedidos antigos continuam com ele.
//
// 0159 (Bruno 21/10): um prazo pra cada prioridade — Normal · Alta · Urgente.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { setoresDe, useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Entrada, Modal } from "@/rel/ui";
import { NOME_SETOR, SETORES, horasDoTipo, listarTipos, salvarTipo, type Setor, type TipoSol } from "./lib";

export default function TiposPrazos({ onFechar }: { onFechar: () => void }) {
  const { currentUser } = useQsAuth();
  const meus: Setor[] = currentUser?.role === "admin" ? SETORES : setoresDe(currentUser);
  const [tipos, setTipos] = useState<TipoSol[]>([]);
  const [editado, setEditado] = useState<Record<string, Partial<TipoSol>>>({});
  const [novo, setNovo] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const carregar = () => listarTipos().then(setTipos).catch((e) => setErro(e instanceof Error ? e.message : "Não carregou."));
  useEffect(() => { void carregar(); }, []);

  const mudar = (id: string, campo: Partial<TipoSol>) => { setOk(false); setEditado((e) => ({ ...e, [id]: { ...e[id], ...campo } })); };

  async function salvar() {
    setSalvando(true); setErro(null);
    try {
      for (const [id, campos] of Object.entries(editado)) {
        const t = tipos.find((x) => x.id === id);
        if (t) await salvarTipo({ ...t, ...campos });
      }
      for (const [setor, rotulo] of Object.entries(novo)) {
        if (!rotulo.trim()) continue;
        const id = `${setor.slice(0, 3)}_${rotulo.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").slice(0, 30)}_${Date.now().toString(36).slice(-4)}`;
        await salvarTipo({ id, setor: setor as Setor, rotulo: rotulo.trim(), prazo_horas: 8, prazo_alta_horas: 4, prazo_urgente_horas: 2, ordem: 500, ativo: true });
      }
      setEditado({}); setNovo({}); setOk(true); await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo="Tipos de pedido e prazos" onFechar={onFechar} largura={680}
      rodape={<><Botao onClick={onFechar}>Fechar</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-5">
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Prazo em <b>horas úteis</b> (seg–sex, 9h–18h). 9h = 1 dia útil · 18h = 2 dias. Cada prioridade tem o seu prazo: quem pede escolhe a prioridade e o prazo já sai certo.</p>
        {meus.map((setor) => (
          <section key={setor} aria-label={NOME_SETOR[setor]}>
            <div className="flex items-end gap-2 mb-2">
              <h3 className="flex-1 text-[13px] font-bold" style={{ color: "var(--ink)" }}>{NOME_SETOR[setor]} recebe</h3>
              {([["Normal", "var(--ink3)"], ["Alta", "var(--warn-ink)"], ["Urgente", "var(--err-ink)"]] as const).map(([r, cor]) => (
                <span key={r} className="text-[11px] font-bold text-center" style={{ width: 64, color: cor }}>{r}</span>
              ))}
              <span style={{ width: 62 }} aria-hidden />
            </div>
            <div className="space-y-1.5">
              {tipos.filter((t) => t.setor === setor).map((t) => {
                const v = { ...t, ...editado[t.id] };
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <Entrada value={v.rotulo} onChange={(e) => mudar(t.id, { rotulo: e.target.value })} aria-label="Nome do tipo" style={{ opacity: v.ativo ? 1 : 0.5 }} />
                    {([["prazo_horas", "Normal"], ["prazo_alta_horas", "Alta"], ["prazo_urgente_horas", "Urgente"]] as const).map(([campo, r]) => (
                      <input key={campo} type="number" min={1} max={400} className="rel-input" style={{ width: 64 }} aria-label={`Prazo ${r} em horas úteis`}
                        value={horasDoTipo(v)[campo === "prazo_horas" ? "normal" : campo === "prazo_alta_horas" ? "alta" : "urgente"]}
                        onChange={(e) => mudar(t.id, { [campo]: Math.max(1, Math.min(400, Number(e.target.value) || 1)) })} />
                    ))}
                    <label className="flex items-center gap-1 text-[12px] whitespace-nowrap" style={{ color: "var(--ink2)" }}>
                      <input type="checkbox" checked={v.ativo} onChange={(e) => mudar(t.id, { ativo: e.target.checked })} /> ativo
                    </label>
                  </div>
                );
              })}
              <Entrada value={novo[setor] ?? ""} onChange={(e) => { setOk(false); setNovo((n) => ({ ...n, [setor]: e.target.value })); }} placeholder="+ novo tipo (prazo começa em 8h)" aria-label={`Novo tipo pra ${NOME_SETOR[setor]}`} />
            </div>
          </section>
        ))}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        {ok && <Aviso tom="ok">Salvo.</Aviso>}
      </div>
    </Modal>
  );
}
