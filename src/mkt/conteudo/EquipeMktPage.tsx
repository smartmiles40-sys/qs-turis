// src/mkt/conteudo/EquipeMktPage.tsx
// -----------------------------------------------------------------------------
// EQUIPE DO MARKETING (0240): quem é do Orgânico, do Tráfego e quem aprova.
// Só o gestor de Marketing (ou admin) muda — a RPC mkt_definir_papeis confere.
// Quem aparece aqui: quem tem a porta do Marketing (papel marketing, setor
// Marketing marcado em Configurações › Usuários, gestor com a área, admin).
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Aviso, Avatar, Vazio } from "@/rel/ui";
import { useMkt } from "../contexto";
import { NOME_PAPEL_MKT, PAPEIS_MKT, type PapelMkt } from "../menu";
import { definirPapeis, erroDe } from "./dados";
import { Cabecalho } from "./ui";

export default function EquipeMktPage() {
  const { pessoas, aprovador, recarregar, carregando, erro } = useMkt();
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alternar(id: string, atuais: PapelMkt[], p: PapelMkt) {
    const novos = atuais.includes(p) ? atuais.filter((x) => x !== p) : [...atuais, p];
    setSalvando(id); setErroAcao(null);
    try { await definirPapeis(id, novos); await recarregar(); }
    catch (e) { setErroAcao(erroDe(e)); }
    finally { setSalvando(null); }
  }

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div className="max-w-3xl mx-auto">
      <Cabecalho titulo="Equipe do Marketing"
        texto="Orgânico e Tráfego mudam o menu de cada um; Gestor aprova os conteúdos e configura o quadro. Pra pôr alguém novo na área, o admin marca “Marketing” na pessoa em Configurações › Usuários." />
      {erro && <Aviso tom="erro">{erroDe(new Error(erro))}</Aviso>}
      {erroAcao && <div className="mb-3"><Aviso tom="erro">{erroAcao}</Aviso></div>}
      {!aprovador && <div className="mb-3"><Aviso>Só o gestor de Marketing muda os papéis. Aqui você vê quem é quem.</Aviso></div>}
      {pessoas.length === 0 ? <div className="rel-card"><Vazio titulo="Ninguém na área ainda" /></div> : (
        <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
          {pessoas.map((p) => (
            <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 sm:px-4 py-3">
              <span className="flex items-center gap-2.5 flex-1 min-w-0">
                <Avatar nome={p.nome} tamanho={32} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.nome}</span>
                  <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>
                    {p.role === "admin" ? "Admin (aprova sempre)" : p.role === "gestor" ? "Gestor com a área Marketing (aprova sempre)" : p.aprovador ? "Aprova" : p.papeis.length ? "" : "Sem papel definido (vê tudo, não aprova)"}
                  </span>
                </span>
              </span>
              <span className="flex flex-wrap gap-3">
                {PAPEIS_MKT.map((pp) => (
                  <label key={pp} className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: "var(--ink2)" }}>
                    <input type="checkbox" checked={p.papeis.includes(pp)} disabled={!aprovador || salvando === p.id} onChange={() => void alternar(p.id, p.papeis, pp)} />
                    {pp === "gestor" ? "Gestor" : NOME_PAPEL_MKT[pp]}
                  </label>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
