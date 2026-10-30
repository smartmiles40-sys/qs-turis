// src/mkt/conteudo/ColunasPage.tsx
// -----------------------------------------------------------------------------
// COLUNAS DO QUADRO (0240) — aba "Colunas" de Ajustes (AjustesPage.tsx): o gestor renomeia, reordena, pinta, cria e apaga.
// As 5 colunas com papel no fluxo (Entrada, Em aprovação, Ajustes, Aprovado,
// Publicado) podem ser renomeadas e mudar de lugar, mas não somem — o banco
// segura (mkt_colunas_protege).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Aviso, Botao, Entrada } from "@/rel/ui";
import { useMkt } from "../contexto";
import { apagarColuna, erroDe, listarColunas, reordenarColunas, salvarColuna } from "./dados";
import { NOME_TIPO_COLUNA, type Coluna } from "./tipos";

const CORES = ["", "#BE185D", "#0E7C6A", "#1D4ED8", "#B45309", "#6D28D9", "#DC2626", "#64748B"];

export default function ColunasPage() {
  const { aprovador } = useMkt();
  const [colunas, setColunas] = useState<Coluna[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nova, setNova] = useState("");

  const carregar = async () => { try { setColunas(await listarColunas()); } catch (e) { setErro(erroDe(e)); } };
  useEffect(() => { void carregar(); }, []);

  async function fazer(f: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await f(); await carregar(); } catch (e) { setErro(erroDe(e)); } finally { setOcupado(false); }
  }
  function mover(i: number, d: -1 | 1) {
    const l = [...colunas];
    const j = i + d;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    setColunas(l);
    void fazer(() => reordenarColunas(l.map((k) => k.id)));
  }

  return (
    <div>
      <p className="text-[13px] mb-3" style={{ color: "var(--ink3)" }}>
        Cada coluna é uma etapa do quadro. As que têm papel no fluxo de aprovação podem mudar de nome, cor e lugar, mas não podem ser apagadas.
      </p>
      {!aprovador && <div className="mb-3"><Aviso>Só o gestor de Marketing muda as colunas.</Aviso></div>}
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      <ul className="space-y-2">
        {colunas.map((k, i) => (
          <li key={k.id} className="rel-card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex gap-1">
              <Botao variante="fantasma" disabled={!aprovador || ocupado || i === 0} onClick={() => mover(i, -1)} aria-label={`Subir ${k.nome}`}>↑</Botao>
              <Botao variante="fantasma" disabled={!aprovador || ocupado || i === colunas.length - 1} onClick={() => mover(i, 1)} aria-label={`Descer ${k.nome}`}>↓</Botao>
            </div>
            <div className="flex-1 min-w-0">
              <Entrada defaultValue={k.nome} key={k.nome} disabled={!aprovador} aria-label="Nome da coluna" maxLength={60}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== k.nome) void fazer(() => salvarColuna({ ...k, nome: v })); }} />
              <p className="text-[11px] mt-1" style={{ color: k.tipo === "livre" ? "var(--ink3)" : "var(--rel-ink)" }}>{NOME_TIPO_COLUNA[k.tipo]}</p>
            </div>
            <select className="rel-input !w-auto" aria-label="Cor" value={k.cor ?? ""} disabled={!aprovador}
              onChange={(e) => void fazer(() => salvarColuna({ ...k, cor: e.target.value || null }))}>
              {CORES.map((c) => <option key={c} value={c}>{c ? c : "Sem cor"}</option>)}
            </select>
            {k.tipo === "livre" && (
              <Botao variante="perigo" disabled={!aprovador || ocupado}
                onClick={() => { if (window.confirm(`Apagar a coluna "${k.nome}"? Ela precisa estar vazia.`)) void fazer(() => apagarColuna(k.id)); }}>Apagar</Botao>
            )}
          </li>
        ))}
      </ul>
      {aprovador && (
        <form className="flex gap-2 mt-4" onSubmit={(e) => {
          e.preventDefault(); const n = nova.trim(); if (!n) return;
          const ordem = (colunas.reduce((m, k) => Math.max(m, k.ordem), 0) || 0) + 10;
          void fazer(async () => { await salvarColuna({ nome: n, ordem }); setNova(""); });
        }}>
          <Entrada placeholder="Nova etapa (ex.: Legenda)" value={nova} onChange={(e) => setNova(e.target.value)} maxLength={60} />
          <Botao type="submit" variante="primario" disabled={ocupado || !nova.trim()}>Criar coluna</Botao>
        </form>
      )}
    </div>
  );
}
