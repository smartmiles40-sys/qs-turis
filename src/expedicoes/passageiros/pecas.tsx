// src/expedicoes/passageiros/pecas.tsx
// Peças pequenas da aba Passageiros: selos de status/tipo/prontidão, ponto do
// semáforo, selo de fidelidade (app antigo: FidelidadeBadge.tsx), selo "sem ficha"
// (cadastro único), avatar com foto,
// botões Sim/Não e a visualização de um arquivo (imagem em tela cheia, PDF em aba nova).
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/rel/ui";
import { Selo, type Tom } from "../ui";
import { useExp } from "../contexto";
import { MARCOS_FIDELIDADE } from "../lib/fidelidade";
import type { ArquivoRow, Prontidao, StatusReserva, TipoPassageiro } from "../lib/database";
import type { Semaforo } from "../lib/prontidao/regras";
import { urlArquivo } from "./dados";
import { CATEGORIA_ARQUIVO } from "../lib/constants";

/** Pastas do Drive do passageiro (como no antigo: sem "Documentos pessoais" — passaporte tem anexo próprio). */
export const PASTAS_PAX = CATEGORIA_ARQUIVO.filter((c) => c !== "Documentos pessoais");

const TOM_STATUS: Record<StatusReserva, Tom> = { Lead: "lista", "Pré-reserva": "aviso", Confirmado: "ok", Cancelado: "erro" };
const TOM_TIPO: Record<TipoPassageiro, Tom> = { Líder: "lista", Cortesia: "neutro", Pagante: "ok" };
export const TOM_PRONTIDAO: Record<Prontidao, Tom> = { Apto: "ok", Atenção: "aviso", Bloqueado: "erro" };
export const COR_SEMAFORO: Record<Semaforo, string> = { ok: "#16A34A", atencao: "#EA580C", bloqueio: "#DC2626", na: "#9CA3AF" };

export const SeloStatus = ({ s }: { s: StatusReserva }) => <Selo tom={TOM_STATUS[s] ?? "neutro"}>{s}</Selo>;
export const SeloTipo = ({ t }: { t: TipoPassageiro }) => <Selo tom={TOM_TIPO[t] ?? "neutro"}>{t}</Selo>;
export const SeloProntidao = ({ p }: { p: Prontidao }) => <Selo tom={TOM_PRONTIDAO[p]}>{p}</Selo>;

export function Ponto({ s, tamanho = 9 }: { s: Semaforo; tamanho?: number }) {
  return <span className="inline-block rounded-full flex-shrink-0" style={{ width: tamanho, height: tamanho, background: COR_SEMAFORO[s] }} />;
}

export function SeloFidelidade({ posicao }: { posicao?: number }) {
  if (!posicao || posicao < 2) return null;
  const titulo = `${posicao}ª expedição desta pessoa com a agência`;
  if ((MARCOS_FIDELIDADE as readonly number[]).includes(posicao)) return <Selo tom="lista" titulo={titulo}>★ {posicao}ª expedição</Selo>;
  return <span title={titulo} className="text-[11px] font-semibold" style={{ color: "var(--ink3)" }}>{posicao}ª</span>;
}

/** Cadastro único (0172): cliente que já comprou e ainda não está ligado a uma ficha do
    Relacionamento. Antes da 0172 a linha nem tem `cliente_id` — aí não aparece nada. */
export function SeloSemFicha({ pax }: { pax: { tipo: TipoPassageiro; status_reserva: StatusReserva } }) {
  if (!("cliente_id" in pax) || (pax as { cliente_id?: string | null }).cliente_id) return null;
  if (pax.tipo === "Líder" || pax.status_reserva === "Lead" || pax.status_reserva === "Cancelado") return null;
  return <Selo tom="aviso" titulo="Ainda não está ligado a uma ficha do Relacionamento — abra o passageiro, aba Cliente">sem ficha</Selo>;
}

export function FotoPax({ nome, url, tamanho = 30 }: { nome: string; url?: string | null; tamanho?: number }) {
  if (url) return <img src={url} alt="" className="rounded-full object-cover flex-shrink-0" style={{ width: tamanho, height: tamanho }} />;
  return <Avatar nome={nome} tamanho={tamanho} />;
}

export function Opcao({ ativo, cor = "sim", onClick, children, disabled }: { ativo: boolean; cor?: "sim" | "nao" | "neutro"; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  const fundo = !ativo ? "var(--card)" : cor === "sim" ? "#DCFCE7" : cor === "nao" ? "var(--err-bg)" : "var(--rel-soft)";
  const texto = !ativo ? "var(--ink2)" : cor === "sim" ? "#166534" : cor === "nao" ? "var(--err-ink)" : "var(--rel-ink)";
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={ativo}
      className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold disabled:opacity-60"
      style={{ background: fundo, color: texto, border: `1px solid ${ativo ? "transparent" : "var(--line)"}` }}>
      {children}
    </button>
  );
}

/** Abre um arquivo: imagem em tela cheia, o resto numa aba nova (link assinado de 5 min). */
export function useVerArquivo() {
  const { avisar } = useExp();
  const [img, setImg] = useState<{ url: string; erro: boolean } | null>(null);
  const ver = async (a: ArquivoRow) => {
    try {
      const url = await urlArquivo(a);
      if (a.mime?.startsWith("image/")) setImg({ url, erro: false });
      else window.open(url, "_blank", "noopener");
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível abrir", "erro"); }
  };
  const visor = img ? createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.85)" }} onClick={() => setImg(null)} role="dialog" aria-label="Arquivo">
      {img.erro ? (
        <a href={img.url} target="_blank" rel="noopener noreferrer" className="text-white underline text-[14px]" onClick={(e) => e.stopPropagation()}>Abrir arquivo em nova aba</a>
      ) : (
        <img src={img.url} alt="" className="max-w-full max-h-full rounded-lg" onError={() => setImg({ ...img, erro: true })} />
      )}
      <button className="absolute top-4 right-4 text-white text-[13px] px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,.15)" }}>Fechar</button>
    </div>, document.body) : null;
  return { ver, visor };
}

export function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  const vazio = valor == null || valor === "";
  return (
    <div className="flex gap-3 py-1 text-[13px]">
      <span className="w-40 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <span className="flex-1 min-w-0 break-words" style={{ color: vazio ? "var(--ink3)" : "var(--ink)", fontStyle: vazio ? "italic" : undefined }}>{vazio ? "—" : valor}</span>
    </div>
  );
}
