// src/mkt/conteudo/ui.tsx — peças pequenas das telas de conteúdo (chips, selects).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Etiqueta } from "@/rel/ui";
import { useMkt } from "../contexto";
import { listarCards, listarColunas, erroDe } from "./dados";
import { NOME_ORIGEM, NOME_TIPO, type CardMkt, type Coluna, type Origem, type StatusAprovacao, type TipoConteudo } from "./tipos";

export function ChipTipo({ tipo }: { tipo: TipoConteudo }) {
  return <Etiqueta>{NOME_TIPO[tipo] ?? tipo}</Etiqueta>;
}

/** Orgânico = cor da área; Tráfego = azul (os dois lados no mesmo quadro). */
export function ChipOrigem({ origem, pedido }: { origem: Origem; pedido?: boolean }) {
  const st = origem === "trafego"
    ? { background: "var(--info-bg)", color: "var(--info)", border: "1px solid transparent" }
    : { background: "var(--rel-soft)", color: "var(--rel-ink)", border: "1px solid transparent" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap" style={st}>
      {NOME_ORIGEM[origem]}{pedido ? " · pedido" : ""}
    </span>
  );
}

export function ChipStatus({ status, rodada }: { status: StatusAprovacao; rodada: number }) {
  if (status === "sem") return null;
  const r = rodada > 1 ? ` · ${rodada}ª rodada` : "";
  if (status === "pendente") return <Etiqueta tom="aviso">Aguardando aprovação{r}</Etiqueta>;
  if (status === "devolvido") return <Etiqueta tom="erro">Devolvido{r}</Etiqueta>;
  return <Etiqueta tom="rel">Aprovado{r}</Etiqueta>;
}

/** Escolher a pessoa (responsável) entre as do Marketing. */
export function SelectPessoa({ valor, onMudar, vazio = "Ninguém", id }: { valor: string | null; onMudar: (v: string | null) => void; vazio?: string; id?: string }) {
  const { pessoas } = useMkt();
  return (
    <select id={id} className="rel-input" value={valor ?? ""} onChange={(e) => onMudar(e.target.value || null)}>
      <option value="">{vazio}</option>
      {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
    </select>
  );
}

export function Cabecalho({ titulo, texto, acoes }: { titulo: string; texto?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>{titulo}</h1>
        {texto && <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>{texto}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

/** Colunas + cards (com recarga), usado pelas telas do conteúdo. */
export function useQuadro(opts: { arquivados?: boolean } = {}) {
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [cards, setCards] = useState<CardMkt[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const arquivados = !!opts.arquivados;
  const recarregar = useCallback(async () => {
    try {
      const [c, k] = await Promise.all([listarColunas(), listarCards({ arquivados })]);
      setColunas(c); setCards(k); setErro(null);
    } catch (e) { setErro(erroDe(e)); }
    finally { setCarregando(false); }
  }, [arquivados]);
  useEffect(() => {
    void recarregar();
    // Volta pra aba: atualiza (o quadro é compartilhado entre Orgânico e Tráfego).
    const onFoco = () => { if (document.visibilityState === "visible") void recarregar(); };
    document.addEventListener("visibilitychange", onFoco);
    return () => document.removeEventListener("visibilitychange", onFoco);
  }, [recarregar]);
  return { colunas, cards, setCards, carregando, erro, recarregar };
}
