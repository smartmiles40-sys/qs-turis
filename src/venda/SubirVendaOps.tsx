// src/venda/SubirVendaOps.tsx
// -----------------------------------------------------------------------------
// OPERAÇÕES › SUBIR VENDA (0214). "Ops sobe venda, mas sem pipeline, só subir a
// venda facilitando" (Bruno 28/10). A mesma tela de venda dos outros setores
// + as VAGAS das expedições: quem vende vê "peça pro Operacional abrir vaga",
// e é aqui que o Ops abre — muda pax_planejados com o motivo registrado
// (exp_vagas_ajustar → exp_vagas_ajustes).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "@/rel/ui";
import { dataBr } from "@/closer/lib";
import type { ResultadoPreVenda } from "@/closer/vendaItens";
import { ajustarVagas, listarExpedicoesParaVenda, type ExpedicaoVaga } from "./api";
import { BotaoSubirVenda } from "./SubirVenda";

export default function SubirVendaOps() {
  const [lista, setLista] = useState<ExpedicaoVaga[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<ResultadoPreVenda | null>(null);
  const [abrindo, setAbrindo] = useState<ExpedicaoVaga | null>(null);

  const carregar = useCallback(() => {
    listarExpedicoesParaVenda().then((l) => { setLista(l); setErro(null); }).catch((e) => { setLista([]); setErro((e as Error).message); });
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Subir venda</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
            Expedição, aéreo, seguro, hospedagem… numa tela só. O Relacionamento e o Financeiro já veem.
          </p>
        </div>
        <BotaoSubirVenda origem="ops" variante="primario" rotulo="Subir uma venda" onSalvo={(r) => { setAviso(r); carregar(); }} />
      </div>
      {aviso && <Aviso tom={aviso.tom}>{aviso.mensagem}</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <section className="rel-card p-4">
        <h2 className="text-[15px] font-bold mb-1" style={{ color: "var(--ink)" }}>Vagas das expedições</h2>
        <p className="text-[12.5px] mb-3" style={{ color: "var(--ink3)" }}>
          Vaga = pax planejados − pagantes em pré-reserva ou confirmados. Sem vaga, ninguém consegue vender: abra aqui (fica registrado quem abriu e por quê).
        </p>
        {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left" style={{ color: "var(--ink3)" }}>
                  <th className="py-2 pr-3 font-semibold">Expedição</th>
                  <th className="py-2 pr-3 font-semibold">Embarque</th>
                  <th className="py-2 pr-3 font-semibold">Ocupados</th>
                  <th className="py-2 pr-3 font-semibold">Vagas</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-2 pr-3" style={{ color: "var(--ink)" }}><b>{e.nome}</b> <span style={{ color: "var(--ink3)" }}>{e.codigo}</span></td>
                    <td className="py-2 pr-3" style={{ color: "var(--ink2)" }}>{dataBr(e.data_embarque)}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--ink2)" }}>{e.ocupados}/{e.pax_planejados}</td>
                    <td className="py-2 pr-3">{e.vagas > 0 ? <Etiqueta tom={e.vagas > 2 ? "rel" : "aviso"}>{e.vagas}</Etiqueta> : <Etiqueta tom="erro">lotada</Etiqueta>}</td>
                    <td className="py-2 text-right"><Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setAbrindo(e)}>Mudar vagas</Botao></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!lista.length && !erro && <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhuma expedição à venda.</p>}
          </div>
        )}
      </section>

      {abrindo && <AbrirVaga exp={abrindo} onFechar={() => setAbrindo(null)} onFeito={(t) => { setAbrindo(null); setAviso({ tom: "ok", mensagem: t }); carregar(); }} />}
    </div>
  );
}

function AbrirVaga({ exp, onFechar, onFeito }: { exp: ExpedicaoVaga; onFechar: () => void; onFeito: (t: string) => void }) {
  const [novo, setNovo] = useState(String(exp.pax_planejados + 1));
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const n = Number(novo);
  async function salvar() {
    if (!Number.isInteger(n) || n < exp.ocupados) { setErro(`Coloque um número inteiro a partir de ${exp.ocupados} (já vendidos).`); return; }
    if (motivo.trim().length < 3) { setErro("Escreva o motivo (fica registrado)."); return; }
    setOcupado(true); setErro(null);
    try {
      const r = await ajustarVagas(exp.id, n, motivo.trim());
      onFeito(`${exp.nome}: agora são ${n} lugares (${r.vagas} vaga${r.vagas === 1 ? "" : "s"} livre${r.vagas === 1 ? "" : "s"}).`);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo={`Vagas — ${exp.nome}`} onFechar={onFechar}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={() => void salvar()} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Hoje: {exp.pax_planejados} lugares, {exp.ocupados} vendidos, {exp.vagas} livres.</p>
        <Campo rotulo="Total de lugares (pax planejados)" dica={Number.isInteger(n) && n >= exp.ocupados ? `Vai ficar com ${n - exp.ocupados} vaga(s) livre(s).` : undefined}>
          <Entrada type="number" min={exp.ocupados} value={novo} onChange={(e) => setNovo(e.target.value)} />
        </Campo>
        <Campo rotulo="Motivo *" dica="Ex.: hotel liberou mais 2 quartos; ônibus maior.">
          <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
