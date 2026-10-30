// src/rel/equipe/MenuPorPapelSecao.tsx
// -----------------------------------------------------------------------------
// ABA "MENUS POR PAPEL" do Time e cargos (V2, 30/10/2026, 0229).
// A gestão escolhe, sem código, que painéis cada papel (CX, CS, Hunter) vê no
// menu e liga/desliga o filtro do setor. Gestão e admin sempre veem tudo; quem
// não tem papel também. O que sai do menu continua em "Outros painéis".
// Sem a 0229 aplicada: mostra o padrão, só leitura, e avisa.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import type { MembroEquipe } from "@/lib/adminUsers";
import { DICA_PAPEL, NOME_PAPEL, PAPEIS, type Papel } from "@/solicitacoes/lib";
import { Aviso, Botao, Etiqueta } from "../ui";
import { BASE_REL, ESCOLHIVEIS_REL, GRUPOS_REL, ITENS_REL } from "../menu";
import { MENU_PADRAO, ligarMenuPorPapel, salvarMenuDoPapel, type MenuPorPapel } from "./menuPorPapel";

export default function MenuPorPapelSecao({ cfg, carregou, equipe, papeisDe, onMudou }: {
  cfg: MenuPorPapel | null; carregou: boolean; equipe: MembroEquipe[]; papeisDe: Record<string, Papel[]> | null; onMudou: () => void;
}) {
  const semMigration = carregou && !cfg;
  const mapa = cfg?.mapa ?? MENU_PADRAO;
  const [rascunho, setRascunho] = useState<Record<Papel, string[]>>(mapa);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  useEffect(() => { setRascunho(cfg?.mapa ?? MENU_PADRAO); }, [cfg]);

  const quem = (p: Papel) => equipe.filter((m) => m.is_active && m.role !== "admin" && (papeisDe?.[m.id] ?? []).includes(p));
  const mudou = (p: Papel) => [...rascunho[p]].sort().join() !== [...mapa[p]].sort().join();

  async function rodar(chave: string, f: () => Promise<void>, ok: string) {
    setOcupado(chave); setAviso(null);
    try { await f(); setAviso({ tom: "ok", texto: ok }); onMudou(); }
    catch (e) { setAviso({ tom: "erro", texto: e instanceof Error ? e.message : "Não salvou." }); }
    finally { setOcupado(null); }
  }

  const alternar = (p: Papel, id: string) =>
    setRascunho((r) => ({ ...r, [p]: r[p].includes(id) ? r[p].filter((x) => x !== id) : [...r[p], id] }));

  return (
    <div className="space-y-4">
      <p className="text-[13px] max-w-2xl" style={{ color: "var(--ink2)" }}>
        Cada pessoa vê no menu só os painéis do papel dela, pra quem está começando não se perder.
        Gestão e admin continuam vendo tudo. Nada fica trancado: o que sai do menu continua em
        <b> Outros painéis</b>, no fim do menu, e os links continuam abrindo.
      </p>
      {semMigration && <Aviso>Falta aplicar a migration 0229 no banco. Até lá, todo mundo vê o menu completo e esta tela mostra só o padrão.</Aviso>}
      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}

      <div className="rel-card p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="font-semibold" style={{ color: "var(--ink)" }}>Menu por papel no Relacionamento</div>
          <div className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
            {cfg?.ligado ? "Ligado: quem tem papel vê o menu do papel." : "Desligado: todo mundo vê o menu completo. Confira a prévia de cada pessoa na aba Time antes de ligar."}
          </div>
        </div>
        <Etiqueta tom={cfg?.ligado ? "rel" : "neutro"}>{cfg?.ligado ? "Ligado" : "Desligado"}</Etiqueta>
        <Botao variante={cfg?.ligado ? "secundario" : "primario"} disabled={!cfg || !!ocupado}
          onClick={() => void rodar("ligar", () => ligarMenuPorPapel(!cfg?.ligado), cfg?.ligado ? "Menu por papel desligado: todo mundo volta a ver tudo." : "Menu por papel ligado.")}>
          {ocupado === "ligar" ? "Salvando…" : cfg?.ligado ? "Desligar" : "Ligar"}
        </Botao>
      </div>

      {PAPEIS.map((p) => {
        const pessoas = quem(p);
        return (
          <section key={p} className="rel-card p-4">
            <div className="flex flex-wrap items-start gap-2 mb-2">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{NOME_PAPEL[p]}</span>
                  {cfg && !cfg.personalizados.includes(p) && <Etiqueta>padrão</Etiqueta>}
                </div>
                <div className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{DICA_PAPEL[p]}</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: "var(--ink2)" }}>
                  {pessoas.length ? `Quem é: ${pessoas.map((m) => m.name.split("|")[0].trim()).join(", ")}` : "Ninguém tem esse papel ainda."}
                </div>
              </div>
              {cfg && (
                <div className="flex gap-2">
                  {cfg.personalizados.includes(p) && (
                    <Botao disabled={!!ocupado} onClick={() => void rodar(`pad-${p}`, () => salvarMenuDoPapel(p, null), `${NOME_PAPEL[p]} voltou ao padrão.`)}>Voltar ao padrão</Botao>
                  )}
                  <Botao variante="primario" disabled={!mudou(p) || !!ocupado}
                    onClick={() => void rodar(`sal-${p}`, () => salvarMenuDoPapel(p, rascunho[p]), `Menu do ${NOME_PAPEL[p]} salvo.`)}>
                    {ocupado === `sal-${p}` ? "Salvando…" : "Salvar"}
                  </Botao>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {GRUPOS_REL.map((g) => {
                const itens = ITENS_REL.filter((i) => i.grupo === g.id && (BASE_REL.includes(i.id) || ESCOLHIVEIS_REL.includes(i)));
                if (!itens.length) return null;
                return (
                  <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-[10.5px] font-bold uppercase tracking-wide w-28" style={{ color: "var(--ink3)" }}>{g.rotulo ?? "Topo"}</span>
                    {itens.map((i) => {
                      const fixo = BASE_REL.includes(i.id);
                      return (
                        <label key={i.id} className="inline-flex items-center gap-1.5 text-[13px]" title={fixo ? "Todo mundo vê" : i.dica}
                          style={{ color: fixo ? "var(--ink3)" : "var(--ink)", cursor: fixo || !cfg ? "default" : "pointer" }}>
                          <input type="checkbox" checked={fixo || rascunho[p].includes(i.id)} disabled={fixo || !cfg}
                            onChange={() => alternar(p, i.id)} />
                          {i.label}
                        </label>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        Quem tem mais de um papel vê a soma. Faxina, Modelos de mensagem e Time e cargos são da supervisão e não entram aqui.
      </p>
    </div>
  );
}
