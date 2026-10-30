// src/rel/equipe/OQueAPessoaVe.tsx
// -----------------------------------------------------------------------------
// TIME E CARGOS (V2, 30/10/2026): por pessoa, numa linha só, o que hoje estava
// espalhado em 3 lugares (cargo, papéis da 0222 e "Tipos e prazos"):
//   • QUAIS SOLICITAÇÕES chegam pra ela no rodízio (pelo papel do tipo);
//   • O MENU DELA, com a pré-visualização "o menu dela fica assim".
//
// A regra de quem recebe é a mesma do servidor (qs_sol_proximo, 0222): tipo com
// papel vai pra quem tem o papel; papel sem ninguém → gestores do setor; tipo
// sem papel → o setor todo. Admin não entra no rodízio.
// -----------------------------------------------------------------------------
import type { MembroEquipe } from "@/lib/adminUsers";
import { NOME_PAPEL, type Papel, type TipoSol } from "@/solicitacoes/lib";
import { montarMenuRel } from "../menu";
import { MENU_PADRAO, filtroDoMenu, type MenuPorPapel } from "./menuPorPapel";

/** Tipos de solicitação do Relacionamento que caem pra esta pessoa. */
export function tiposQueRecebe(m: MembroEquipe, papeis: Papel[], tipos: TipoSol[], equipe: MembroEquipe[], papeisDe: Record<string, Papel[]>): TipoSol[] {
  if (!m.is_active || m.role === "admin" || m.role === "marketing") return [];
  const temGente = (p: Papel) => equipe.some((x) => x.is_active && x.role !== "admin" && x.role !== "marketing" && (papeisDe[x.id] ?? []).includes(p));
  return tipos.filter((t) => t.ativo && t.setor === "relacionamento" && (
    !t.papel || papeis.includes(t.papel) || (m.role === "gestor" && !temGente(t.papel))
  ));
}

export default function OQueAPessoaVe({ m, papeis, tipos, equipe, papeisDe, cfg, cfgCarregou, distribuicaoLigada, verKpis }: {
  m: MembroEquipe; papeis: Papel[]; tipos: TipoSol[] | null; equipe: MembroEquipe[]; papeisDe: Record<string, Papel[]>;
  /** null com cfgCarregou = a 0229 não está aplicada (usa o padrão do código). */
  cfg: MenuPorPapel | null; cfgCarregou: boolean;
  distribuicaoLigada: boolean | null; verKpis: boolean;
}) {
  const gestao = m.role === "gestor" || m.role === "admin";
  const recebe = tipos ? tiposQueRecebe(m, papeis, tipos, equipe, papeisDe) : null;

  // Pré-visualização: mesmo se o menu por papel estiver desligado, mostra como FICARIA.
  // Sem a 0229 (cfg null) a prévia usa o padrão do código.
  const efetivo: MenuPorPapel = cfg ?? { ligado: false, mapa: MENU_PADRAO, personalizados: [] };
  const filtro = gestao ? null : filtroDoMenu(efetivo, papeis, true);
  const grupos = montarMenuRel({ supervisao: m.role === "gestor" || m.role === "admin", verTime: gestao, verKpis }, filtro);
  const nItens = grupos.reduce((s, g) => s + g.items.filter((i) => i.id !== "mais").length, 0);
  const vale = !!cfg?.ligado && !!filtro;

  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
        <div className="font-semibold mb-0.5" style={{ color: "var(--ink)" }}>Solicitações que chegam pra ela</div>
        {m.role === "admin" ? <span>Admin não entra no rodízio.</span>
          : !m.is_active ? <span>Desativada: não recebe.</span>
          : recebe === null ? <span>Carregando…</span>
          : recebe.length === 0 ? <span>Nenhum tipo. Dê um papel (CX, CS ou Hunter) acima.</span>
          : (
            <ul className="list-disc pl-4">
              {recebe.map((t) => (
                <li key={t.id}>{t.rotulo}
                  {!t.papel ? <span style={{ color: "var(--ink3)" }}> · setor todo</span>
                    : !papeis.includes(t.papel) ? <span style={{ color: "var(--ink3)" }}> · ninguém é {NOME_PAPEL[t.papel]}, cai na gestão</span> : null}
                </li>
              ))}
            </ul>
          )}
        {distribuicaoLigada === false && <div className="mt-1" style={{ color: "var(--warn-ink)" }}>A distribuição automática está desligada: os pedidos chegam pro setor todo.</div>}
      </div>
      <details className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
        <summary className="cursor-pointer font-semibold" style={{ color: "var(--ink)" }}>
          O menu dela fica assim · {gestao ? "completo (gestão)" : filtro ? `${nItens} painéis` : "completo"}
        </summary>
        <p className="mt-1" style={{ color: "var(--ink3)" }}>
          {gestao ? "Gestão e admin veem tudo."
            : !filtro ? "Sem papel no setor: vê o menu completo."
            : vale ? "Valendo agora."
            : cfgCarregou && !cfg ? "Prévia. Ainda não vale: falta aplicar a migration 0229."
            : "Prévia. Ainda não vale: ligue \"Menu por papel\" na aba Menus por papel."}
          {filtro ? " O que não está aqui ela abre em \"Outros painéis\"." : ""}
        </p>
        <div className="mt-1.5 space-y-1">
          {grupos.map((g, gi) => (
            <div key={g.label ?? gi} className="flex flex-wrap items-center gap-1">
              {g.label && <span className="text-[10.5px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}>{g.label}</span>}
              {g.items.map((i) => (
                <span key={i.id} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[12px]"
                  style={{ borderColor: "var(--line)", background: "var(--card)", color: i.id === "mais" ? "var(--ink3)" : "var(--ink)" }}>
                  {i.icon}{i.label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
