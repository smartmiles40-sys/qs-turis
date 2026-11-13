// src/mkt/planejamento/PerfisPage.tsx — Ajustes › Perfis e redes (0395).
// A lista de "onde vai ser postado" do planejamento. Só o gestor muda (RLS).
// Desativar (em vez de apagar) mantém o histórico dos planejamentos antigos.
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Entrada } from "@/rel/ui";
import { useMkt } from "../contexto";
import { erroDePlano, listarPerfis, salvarPerfil, type Perfil, type Rede } from "./dados";

const REDES: Rede[] = ["instagram", "tiktok", "linkedin", "youtube", "facebook", "outra"];
const NOME_REDE: Record<Rede, string> = { instagram: "Instagram", tiktok: "TikTok", linkedin: "LinkedIn", youtube: "YouTube", facebook: "Facebook", outra: "Outra" };

export default function PerfisPage() {
  const { gestor } = useMkt();
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ nome: string; rede: Rede; dono: "stfv" | "jacque"; usuario: string }>({ nome: "", rede: "instagram", dono: "stfv", usuario: "" });

  const carregar = useCallback(async () => {
    try { setPerfis(await listarPerfis(true)); setErro(null); } catch (e) { setErro(erroDePlano(e)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function salvar(p: Parameters<typeof salvarPerfil>[0]) {
    try { await salvarPerfil(p); await carregar(); } catch (e) { setErro(erroDePlano(e)); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        Os perfis aparecem em "Onde vai ser postado" nos planejamentos (da agência e do time). De quem é: STFV ou Jacque.
      </p>
      {!gestor && <Aviso>Só o gestor de Marketing muda essa lista.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
        {perfis.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ opacity: p.ativo ? 1 : 0.55 }}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[14px]" style={{ color: "var(--ink)" }}>{p.nome}</div>
              <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{NOME_REDE[p.rede]} · {p.dono === "stfv" ? "STFV" : "Jacque"}{p.usuario ? ` · ${p.usuario}` : ""}{p.ativo ? "" : " · desativado"}</div>
            </div>
            {gestor && <Botao variante="fantasma" onClick={() => salvar({ ...p, ativo: !p.ativo })}>{p.ativo ? "Desativar" : "Reativar"}</Botao>}
          </li>
        ))}
      </ul>
      {gestor && (
        <form className="rel-card p-4 grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); if (novo.nome.trim()) void salvar({ ...novo, ordem: (perfis.at(-1)?.ordem ?? 0) + 10 }).then(() => setNovo({ ...novo, nome: "", usuario: "" })); }}>
          <label className="sm:col-span-2 text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Nome
            <Entrada value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Instagram Expedições" maxLength={60} />
          </label>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Rede
            <select className="rel-input" value={novo.rede} onChange={(e) => setNovo({ ...novo, rede: e.target.value as Rede })}>
              {REDES.map((r) => <option key={r} value={r}>{NOME_REDE[r]}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>De quem
            <select className="rel-input" value={novo.dono} onChange={(e) => setNovo({ ...novo, dono: e.target.value as "stfv" | "jacque" })}>
              <option value="stfv">STFV</option><option value="jacque">Jacque</option>
            </select>
          </label>
          <label className="sm:col-span-3 text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>@ (opcional)
            <Entrada value={novo.usuario} onChange={(e) => setNovo({ ...novo, usuario: e.target.value })} placeholder="@setuforeuvou" maxLength={80} />
          </label>
          <div className="flex items-end"><Botao variante="primario" type="submit" className="w-full" disabled={!novo.nome.trim()}>Adicionar perfil</Botao></div>
        </form>
      )}
    </div>
  );
}
