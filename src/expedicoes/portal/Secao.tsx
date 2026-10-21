// src/expedicoes/portal/Secao.tsx
// Seção genérica do editor do portal (Extensões, Voos de grupo, Passeios e
// ingressos, Informações do destino, Avisos): lista com resumo + gaveta de
// adicionar/editar. App antigo: Secao + ItemDrawer do PortalEditor.
// Regras do antigo mantidas: obrigatórios ("Preencha: X"), "" vira null, o
// seletor "Faz parte de" com o "__base__" vira apenas_sem_extensao, e os anexos
// só depois de salvar.
import { useState, type ReactNode } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Cartao, Gaveta } from "../ui";
import { IconeSvg, type NomeIcone } from "../drive/icones";
import { Titulo } from "./Anexos";
import { atualizarItem, colunasParaSegmento, criarItem, excluirItem, segmentoParaColunas, type TabelaPortal, type Valores } from "./dados";

export type CampoPortal = {
  key: string;
  label: string;
  type: "text" | "textarea" | "date" | "select";
  required?: boolean;
  full?: boolean;
  placeholder?: string;
  opcoes?: string[];
  opcoesPares?: { value: string; label: string }[];
  dica?: string;
};

type Item = { id: string } & Record<string, unknown>;

export function Secao<T extends Item>({ tabela, titulo, descricao, icone, expedicaoId, itens, campos, resumo, anexos, extra, rodape, onMudou }: {
  tabela: TabelaPortal; titulo: string; descricao: string; icone: NomeIcone; expedicaoId: string;
  itens: T[]; campos: CampoPortal[];
  resumo: (item: T) => ReactNode;
  /** ids de arquivos do item, apagados junto quando o item é excluído */
  anexos?: (item: T) => (string | null | undefined)[];
  /** bloco de anexos na gaveta (recebe o item salvo, ou null se ainda é novo) */
  extra?: (item: T | null) => ReactNode;
  rodape?: ReactNode;
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState<T | "novo" | null>(null);
  // Depois de criar, a gaveta continua aberta no item novo (pra já anexar o voucher).
  const [criadoId, setCriadoId] = useState<string | null>(null);
  const itemAberto = aberto === "novo" ? (criadoId ? itens.find((i) => i.id === criadoId) ?? null : null) : aberto;

  return (
    <Cartao titulo={<Titulo icone={icone} titulo={titulo} texto={descricao} />}
      acao={<Botao variante="primario" onClick={() => { setCriadoId(null); setAberto("novo"); }}><IconeSvg nome="mais" /> Adicionar</Botao>}>
      {itens.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-[12px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>Nada cadastrado ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAberto(item)}>{resumo(item)}</button>
              <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                <button type="button" onClick={() => setAberto(item)} aria-label="Editar" title="Editar" className="p-1.5 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}><IconeSvg nome="lapis" /></button>
                <BotaoExcluir titulo="Excluir este item?" sucesso="Item excluído"
                  descricao={anexos && anexos(item).some(Boolean) ? "Os arquivos anexados a ele também serão apagados. Não dá pra desfazer." : undefined}
                  onConfirmar={async () => { await excluirItem(tabela, item.id, anexos?.(item) ?? []); onMudou(); }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {rodape}
      {aberto && (
        <GavetaItem key={itemAberto?.id ?? "novo"} tabela={tabela} titulo={titulo} expedicaoId={expedicaoId} campos={campos} item={itemAberto} extra={extra}
          onFechar={() => { setAberto(null); setCriadoId(null); }}
          onSalvo={(id, novo) => { onMudou(); if (novo && extra) setCriadoId(id); else { setAberto(null); setCriadoId(null); } }} />
      )}
    </Cartao>
  );
}

function GavetaItem<T extends Item>({ tabela, titulo, expedicaoId, campos, item, extra, onFechar, onSalvo }: {
  tabela: TabelaPortal; titulo: string; expedicaoId: string; campos: CampoPortal[]; item: T | null;
  extra?: (item: T | null) => ReactNode; onFechar: () => void; onSalvo: (id: string, novo: boolean) => void;
}) {
  const { avisar } = useExp();
  const [salvando, setSalvando] = useState(false);
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of campos) {
      const atual = item?.[c.key];
      if (c.key === "extensao_id") o[c.key] = colunasParaSegmento(item?.extensao_id as string | null, item?.apenas_sem_extensao as boolean | null);
      else if (c.type === "date") o[c.key] = atual ? String(atual).slice(0, 10) : "";
      else if (c.type === "select") o[c.key] = atual == null ? (c.opcoes?.[0] ?? "") : String(atual);
      else o[c.key] = atual == null ? "" : String(atual);
    }
    return o;
  });

  async function salvar() {
    for (const c of campos) if (c.required && !(v[c.key] ?? "").trim()) { avisar(`Preencha: ${c.label}`, "erro"); return; }
    let payload: Valores = {};
    for (const c of campos) payload[c.key] = (v[c.key] ?? "").trim() === "" ? null : v[c.key].trim();
    if ("extensao_id" in payload) payload = { ...payload, ...segmentoParaColunas(v.extensao_id ?? "") };
    setSalvando(true);
    try {
      if (item) { await atualizarItem(tabela, item.id, payload); avisar("Atualizado"); onSalvo(item.id, false); }
      else { const id = await criarItem(tabela, expedicaoId, payload); avisar("Adicionado"); onSalvo(id, true); }
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
    finally { setSalvando(false); }
  }

  return (
    <Gaveta aberta titulo={`${item ? "Editar" : "Adicionar"} — ${titulo}`} subtitulo="Estas informações ficam visíveis para o passageiro." onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>{item ? "Fechar" : "Cancelar"}</Botao><Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao></>}>
      <div className="grid grid-cols-2 gap-3">
        {campos.map((c) => (
          <div key={c.key} className={c.full || c.type === "textarea" ? "col-span-2" : "col-span-2 sm:col-span-1"}>
            <Campo rotulo={`${c.label}${c.required ? " *" : ""}`} dica={c.dica}>
              {c.type === "textarea" ? (
                <textarea className="rel-input" rows={4} value={v[c.key] ?? ""} placeholder={c.placeholder} onChange={(e) => setV((s) => ({ ...s, [c.key]: e.target.value }))} />
              ) : c.type === "select" ? (
                <select className="rel-input" value={v[c.key] ?? ""} onChange={(e) => setV((s) => ({ ...s, [c.key]: e.target.value }))}>
                  {c.opcoesPares ? c.opcoesPares.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : (c.opcoes ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Entrada type={c.type === "date" ? "date" : "text"} value={v[c.key] ?? ""} placeholder={c.placeholder} onChange={(e) => setV((s) => ({ ...s, [c.key]: e.target.value }))} />
              )}
            </Campo>
          </div>
        ))}
      </div>
      {extra && <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: "var(--line)" }}>{extra(item)}</div>}
    </Gaveta>
  );
}
