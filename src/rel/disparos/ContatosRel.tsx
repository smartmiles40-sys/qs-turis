// src/rel/disparos/ContatosRel.tsx
// -----------------------------------------------------------------------------
// CONTATOS E ETIQUETAS do disparo do Relacionamento (0408) — as "tags" do
// ManyChat em cima da ficha do cliente (rel_clientes):
//   • as etiquetas com quantos clientes têm cada uma (renomear/apagar: gestora);
//   • etiquetar colando uma planilha (telefone, CPF ou e-mail + etiquetas);
//   • etiquetar todo mundo de um filtro (ex.: quem foi pro Japão → "japão");
//   • achar um cliente e mexer nas etiquetas dele.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { previa as pedirPrevia, type PublicoRel } from "@/lib/qs/disparos";
import { Aviso, Botao, Campo, Entrada, Modal, Vazio } from "@/rel/ui";
import {
  apagarEtiqueta, buscarClientes, etiquetarEmMassa, etiquetasDoCliente, porEtiqueta, renomearEtiqueta, tirarEtiqueta,
} from "./oficialRel";
import { CampoEtiquetas, limparPublico, PublicoRelForm, useEtiquetas } from "./PublicoRel";

const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

function Importar({ existentes, onFechar, onFeito }: { existentes: { etiqueta: string; n: number }[]; onFechar: () => void; onFeito: () => void }) {
  const [planilha, setPlanilha] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [tirar, setTirar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  async function ir() {
    setOcupado(true);
    try {
      const r = await etiquetarEmMassa({ planilha, etiquetas, tirar });
      notifySuccess(`${r.clientes} cliente(s) ${tirar ? "perderam" : "ganharam"} etiqueta.${r.sem_ficha ? ` ${r.sem_ficha} linha(s) sem ficha no QS.` : ""}${r.linhas_invalidas ? ` ${r.linhas_invalidas} linha(s) ilegíveis.` : ""}`);
      onFeito();
    } catch (e) { notifyError(erroDe(e, "Não importou.")); } finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo="Etiquetar colando uma planilha" onFechar={onFechar} largura={640}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={ocupado || !planilha.trim()} onClick={() => void ir()}>{ocupado ? "Etiquetando…" : tirar ? "Tirar etiquetas" : "Etiquetar"}</Botao></>}>
      <div className="space-y-3">
        <Campo rotulo="Cole as linhas (do Excel/Sheets)" dica="Uma pessoa por linha: telefone, CPF ou e-mail na 1ª coluna e as etiquetas na 2ª (separadas por vírgula). Pode ter cabeçalho (telefone, cpf, email, etiquetas).">
          <textarea className="rel-input min-h-[160px] font-mono text-[12.5px]" value={planilha} placeholder={"11999990001;vip, japão\nana@email.com;vip\n123.456.789-09"} onChange={(e) => setPlanilha(e.target.value)} />
        </Campo>
        <Campo rotulo="Etiquetas pra todas as linhas (opcional)"><CampoEtiquetas valor={etiquetas} onChange={setEtiquetas} existentes={existentes} /></Campo>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}><input type="checkbox" checked={tirar} onChange={(e) => setTirar(e.target.checked)} /> Tirar em vez de pôr</label>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só etiqueta quem já tem ficha no QS. Quem não tem aparece na contagem “sem ficha”.</p>
      </div>
    </Modal>
  );
}

function PorFiltro({ existentes, onFechar, onFeito }: { existentes: { etiqueta: string; n: number }[]; onFechar: () => void; onFeito: () => void }) {
  const [p, setP] = useState<PublicoRel>({});
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [n, setN] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => { void pedirPrevia("relacionamento", limparPublico(p)).then((r) => { if (vivo) setN(r.total + r.excluidos.reduce((s, x) => s + x.n, 0)); }).catch(() => { if (vivo) setN(null); }); }, 500);
    return () => { vivo = false; clearTimeout(t); };
  }, [p]);
  async function ir() {
    setOcupado(true);
    try { const r = await etiquetarEmMassa({ etiquetas, publico: limparPublico(p) }); notifySuccess(`${r.clientes} cliente(s) etiquetados.`); onFeito(); }
    catch (e) { notifyError(erroDe(e, "Não etiquetou.")); } finally { setOcupado(false); }
  }
  return (
    <Modal aberto titulo="Etiquetar todo mundo de um filtro" onFechar={onFechar} largura={760}
      rodape={<><span className="mr-auto text-[12.5px]" style={{ color: "var(--ink3)" }}>{n === null ? "Contando…" : `~${n} cliente(s) com telefone`}</span><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={ocupado || !etiquetas.length} onClick={() => void ir()}>{ocupado ? "Etiquetando…" : "Etiquetar"}</Botao></>}>
      <div className="space-y-4">
        <Campo rotulo="Etiqueta a pôr"><CampoEtiquetas valor={etiquetas} onChange={setEtiquetas} existentes={existentes} /></Campo>
        <PublicoRelForm p={p} set={setP} etiquetas={existentes} />
      </div>
    </Modal>
  );
}

function FichaEtiquetas({ existentes, onMudou }: { existentes: { etiqueta: string; n: number }[]; onMudou: () => void }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState<{ id: string; nome: string; telefone: string | null }[]>([]);
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => { const t = setTimeout(() => void buscarClientes(termo).then(setAchados).catch(() => setAchados([])), 300); return () => clearTimeout(t); }, [termo]);
  useEffect(() => { if (cliente) void etiquetasDoCliente(cliente.id).then(setTags); }, [cliente]);
  async function mudar(novas: string[]) {
    if (!cliente) return;
    try {
      for (const e of novas.filter((x) => !tags.includes(x))) await porEtiqueta(cliente.id, e);
      for (const e of tags.filter((x) => !novas.includes(x))) await tirarEtiqueta(cliente.id, e);
      setTags(novas); onMudou();
    } catch (e) { notifyError(erroDe(e, "Não salvou.")); }
  }
  return (
    <div className="rel-card space-y-3 p-4">
      <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Etiquetas de um cliente</p>
      <Entrada value={termo} placeholder="Buscar por nome ou telefone…" onChange={(e) => setTermo(e.target.value)} />
      {achados.length > 0 && !cliente && (
        <ul className="max-h-[180px] overflow-y-auto rounded-lg border text-[13px]" style={{ borderColor: "var(--line)" }}>
          {achados.map((c) => <li key={c.id}><button type="button" className="rel-linha w-full px-3 py-1.5 text-left" style={{ color: "var(--ink)" }} onClick={() => { setCliente(c); setTermo(""); setAchados([]); }}>{c.nome}</button></li>)}
        </ul>
      )}
      {cliente && (
        <div className="space-y-2">
          <div className="flex items-center justify-between"><b className="text-[13.5px]" style={{ color: "var(--ink)" }}>{cliente.nome}</b><Botao variante="fantasma" onClick={() => setCliente(null)}>Trocar</Botao></div>
          <CampoEtiquetas valor={tags} onChange={(v) => void mudar(v)} existentes={existentes} />
        </div>
      )}
    </div>
  );
}

export default function ContatosRel({ ehGestor }: { ehGestor: boolean }) {
  const [versao, setVersao] = useState(0);
  const etiquetas = useEtiquetas(versao);
  const [modal, setModal] = useState<"" | "importar" | "filtro">("");
  const mudou = () => setVersao((v) => v + 1);

  async function renomear(de: string) {
    const para = window.prompt(`Novo nome pra etiqueta "${de}":`, de);
    if (!para || para.trim().toLowerCase() === de) return;
    try { const r = await renomearEtiqueta(de, para); notifySuccess(`${r.clientes} cliente(s) atualizados.`); mudou(); } catch (e) { notifyError(erroDe(e, "Não renomeou.")); }
  }
  async function apagar(e: string) {
    if (!window.confirm(`Tirar a etiqueta "${e}" de todos os clientes?`)) return;
    try { await apagarEtiqueta(e); mudou(); } catch (er) { notifyError(erroDe(er, "Não apagou.")); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" onClick={() => setModal("importar")}>Colar planilha</Botao>
        <Botao onClick={() => setModal("filtro")}>Etiquetar por filtro</Botao>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rel-card p-4">
          <p className="mb-3 text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Etiquetas ({etiquetas.length})</p>
          {!etiquetas.length ? (
            <Vazio titulo="Nenhuma etiqueta ainda" texto="Etiquete colando uma planilha, por filtro, num cliente, ou deixe os botões dos disparos etiquetarem sozinhos." />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {etiquetas.map((e) => (
                <li key={e.etiqueta} className="flex items-center gap-2 py-2">
                  <span className="rounded-full px-2.5 py-0.5 text-[12.5px] font-medium" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>{e.etiqueta}</span>
                  <span className="mr-auto text-[12.5px] tabular-nums" style={{ color: "var(--ink3)" }}>{e.n} cliente(s)</span>
                  {ehGestor && <><Botao variante="fantasma" onClick={() => void renomear(e.etiqueta)}>Renomear</Botao><Botao variante="fantasma" onClick={() => void apagar(e.etiqueta)}>Apagar</Botao></>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <FichaEtiquetas existentes={etiquetas} onMudou={mudou} />
          <Aviso tom="ok">No disparo, filtre por etiqueta (“com” ou “sem”). Nos botões do modelo, escolha a etiqueta que quem tocar ganha.</Aviso>
        </div>
      </div>
      {modal === "importar" && <Importar existentes={etiquetas} onFechar={() => setModal("")} onFeito={() => { setModal(""); mudou(); }} />}
      {modal === "filtro" && <PorFiltro existentes={etiquetas} onFechar={() => setModal("")} onFeito={() => { setModal(""); mudou(); }} />}
    </div>
  );
}
