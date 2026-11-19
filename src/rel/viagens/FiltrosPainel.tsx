// src/rel/viagens/FiltrosPainel.tsx
// -----------------------------------------------------------------------------
// Os filtros que ficam no topo do PAINEL de Viagens (Bruno, 19/11: "deve ficar
// no filtro do painel mesmo"). A DATA fica sempre à mostra (é o principal);
// serviço, o que tem no roteiro, situação, dono e busca abrem em "Mais filtros".
// Regras em src/rel/lib/filtroViagens.ts.
// -----------------------------------------------------------------------------
import { useState, type ReactNode } from "react";
import {
  CAMPOS_DATA, FILTRO_PADRAO, PERIODOS, SERVICOS_FILTRO, SITUACOES, TEM_NO_ROTEIRO, alternarTem, intervaloDoPeriodo, quantosAtivos, somaDias,
  type FiltroPainel,
} from "../lib/filtroViagens";
import { FASES, SERVICOS, TIPOS_VIAGEM, dataBR, hojeSP, proximoVoo, type Servico, type Viagem } from "../lib/viagens";
import { Entrada } from "../ui";

function Chip({ ativo, onClick, children, title }: { ativo: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} title={title}
      className="rel-linha px-2.5 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
      style={ativo ? { background: "var(--rel-soft)", color: "var(--rel-ink)", boxShadow: "inset 0 0 0 1px var(--rel)" } : { color: "var(--ink2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
      {children}
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 py-2" style={{ borderTop: "1px solid var(--line2)" }}>
      <span className="text-[11px] font-bold uppercase tracking-wide sm:w-[110px] sm:pt-2 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">{children}</div>
    </div>
  );
}

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const servicoDe = (v: Viagem) => (v.servico ? SERVICOS[v.servico] : TIPOS_VIAGEM[v.tipo]);

/** Planilha das viagens filtradas (";" + BOM: o Excel em pt-BR abre certinho). */
export function baixarCsv(lista: Viagem[]) {
  const cab = ["Cliente", "Viagem", "Serviço", "Ida", "Volta", "Próximo voo", "Voos internos", "Voos", "Passageiros", "Dono", "Situação", "Venda", "Nº Bitrix"];
  const esc = (x: unknown) => { const s = x == null ? "" : String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = lista.map((v) => [
    v.cliente_nome, v.titulo, servicoDe(v), dataBR(v.data_embarque), dataBR(v.data_retorno), v.proximo_voo_em ? proximoVoo(v).quando : "",
    v.voos_internos ?? 0, v.voos_total ?? 0, v.passageiros, v.responsavel_nome ?? "", FASES[v.fase], dataBR(v.data_venda), v.bitrix_deal_id ?? "",
  ].map(esc).join(";"));
  const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `viagens-${hojeSP()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function FiltrosPainel({ f, onMudar, equipe }: {
  f: FiltroPainel; onMudar: (f: FiltroPainel) => void; equipe: { id: string; name: string }[];
}) {
  const hoje = hojeSP();
  const mudar = (p: Partial<FiltroPainel>) => onMudar({ ...f, ...p });
  const intervalo = intervaloDoPeriodo(f, hoje);
  const ativos = quantosAtivos(f);
  const extras = ativos - (f.periodo !== "tudo" ? 1 : 0); // os que ficam dentro de "Mais filtros"
  const [mais, setMais] = useState(extras > 0);

  return (
    <section className="rel-card px-3.5 py-2.5" aria-label="Filtrar o painel">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}>Data</span>
        <select className="rel-input" style={{ width: "auto", paddingTop: 6, paddingBottom: 6 }} value={f.campo} aria-label="Qual data"
          onChange={(e) => mudar({ campo: e.target.value as FiltroPainel["campo"] })} title={CAMPOS_DATA.find((c) => c.id === f.campo)?.dica}>
          {CAMPOS_DATA.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
        </select>
        {PERIODOS.map((p) => (
          <Chip key={p.id} ativo={f.periodo === p.id}
            onClick={() => mudar(p.id === "livre" && !f.de ? { periodo: p.id, de: intervalo.de ?? hoje, ate: intervalo.ate ?? somaDias(hoje, 29) } : { periodo: p.id })}>
            {p.rotulo}
          </Chip>
        ))}
        {f.periodo === "livre" && (
          <span className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
            de <input type="date" className="rel-input" style={{ width: 145, paddingTop: 6, paddingBottom: 6 }} value={f.de} onChange={(e) => mudar({ de: e.target.value })} aria-label="De" />
            até <input type="date" className="rel-input" style={{ width: 145, paddingTop: 6, paddingBottom: 6 }} value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} aria-label="Até" />
          </span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => setMais((x) => !x)} aria-expanded={mais}
          className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold" style={{ color: extras ? "var(--rel-ink)" : "var(--ink2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
          {mais ? "▾" : "▸"} Mais filtros{extras > 0 ? ` (${extras})` : ""}
        </button>
        {ativos > 0 && <button type="button" className="underline text-[12px] px-1" style={{ color: "var(--ink3)" }} onClick={() => onMudar(FILTRO_PADRAO)}>Limpar</button>}
      </div>
      {f.periodo !== "tudo" && (
        <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>
          {CAMPOS_DATA.find((c) => c.id === f.campo)?.dica} · {intervalo.de ? dataBR(intervalo.de) : "…"} a {intervalo.ate ? dataBR(intervalo.ate) : "…"}
          {intervalo.de && intervalo.ate && intervalo.ate < intervalo.de && <b style={{ color: "#DC2626" }}> · o "até" está antes do "de"</b>}
        </p>
      )}

      {mais && (
        <div className="mt-2">
          <Linha rotulo="Serviço">
            <Chip ativo={!f.servicos.length} onClick={() => mudar({ servicos: [] })}>Todos</Chip>
            {SERVICOS_FILTRO.map((s) => (
              <Chip key={s.id} ativo={f.servicos.includes(s.id)} onClick={() => mudar({ servicos: alternar<Servico>(f.servicos, s.id) })}>{s.rotulo}</Chip>
            ))}
          </Linha>
          <Linha rotulo="Tem no roteiro">
            <Chip ativo={!f.tem.length} onClick={() => mudar({ tem: [] })}>Tanto faz</Chip>
            {TEM_NO_ROTEIRO.map((t) => (
              <Chip key={t.id} ativo={f.tem.includes(t.id)} title={t.dica} onClick={() => mudar({ tem: alternarTem(f.tem, t.id) })}>{t.rotulo}</Chip>
            ))}
            {f.tem.length > 1 && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>precisa ter todos os marcados</span>}
          </Linha>
          <Linha rotulo="Situação · dono">
            <select className="rel-input" style={{ width: "auto" }} value={f.situacao} aria-label="Situação" onChange={(e) => mudar({ situacao: e.target.value as FiltroPainel["situacao"] })}>
              {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
            </select>
            <select className="rel-input" style={{ width: "auto" }} value={f.dono} aria-label="Quem cuida" onChange={(e) => mudar({ dono: e.target.value })}>
              <option value="todos">Qualquer dono</option>
              <option value="minhas">As minhas</option>
              <option value="sem_dono">Sem dono</option>
              {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Linha>
          <Linha rotulo="Buscar">
            <div className="w-full sm:w-[420px]">
              <Entrada value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} aria-label="Buscar viagens" placeholder="Cliente, viagem, destino, expedição ou nº do Bitrix" />
            </div>
          </Linha>
        </div>
      )}
    </section>
  );
}
