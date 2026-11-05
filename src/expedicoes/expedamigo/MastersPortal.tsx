// src/expedicoes/expedamigo/MastersPortal.tsx
// Masters do portal do viajante (0319). No app antigo era lista fixa no código
// (ADMINS_AMIGO em app/amigo/actions.ts e MASTERS em app/lider/actions.ts) — cada
// pessoa nova era um commit. Aqui o admin das Expedições edita na tela.
//   · "Portal": no ExpedAmigo (/amigo) vê TODAS as expedições futuras.
//   · "Área do Líder": no /lider vê TODAS as expedições.
// A senha é a do próprio CPF (acesso_senhas) — dá pra mandar o link mágico pela
// aba "Link de acesso" se a pessoa ainda não tem.
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao } from "@/rel/ui";
import { supabase } from "../lib/banco";
import { formatarCpf } from "../lib/cpf";
import { cpfMaster } from "./acessoAmigo";

export interface Master { cpf: string; nome: string; portal: boolean; lider: boolean; ativo: boolean; observacao: string | null; updated_at: string }

const semTabela = (m: string) => /exp_acesso_masters|does not exist|PGRST205|schema cache/i.test(m);

export default function MastersPortal({ podeEditar }: { podeEditar: boolean }) {
  const [lista, setLista] = useState<Master[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [falta, setFalta] = useState(false);
  const [indo, setIndo] = useState<string | null>(null);
  const [novo, setNovo] = useState({ cpf: "", nome: "", portal: true, lider: false });
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from("exp_acesso_masters").select("cpf,nome,portal,lider,ativo,observacao,updated_at").order("nome");
    if (error) { if (semTabela(error.message)) setFalta(true); else setErro(error.message); setLista([]); return; }
    setLista((data ?? []) as Master[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function salvar(cpf: string, patch: Partial<Master>) {
    setIndo(cpf); setMsg(null);
    const { error } = await supabase.from("exp_acesso_masters").update(patch).eq("cpf", cpf);
    setIndo(null);
    if (error) { setMsg({ tom: "erro", texto: `Não salvou: ${error.message}` }); return; }
    setLista((l) => (l ?? []).map((m) => (m.cpf === cpf ? { ...m, ...patch } : m)));
  }

  async function adicionar() {
    const cpf = cpfMaster(novo.cpf);
    if (!cpf) { setMsg({ tom: "erro", texto: "CPF precisa ter 11 dígitos." }); return; }
    if (!novo.nome.trim()) { setMsg({ tom: "erro", texto: "Informe o nome." }); return; }
    if (!novo.portal && !novo.lider) { setMsg({ tom: "erro", texto: "Marque Portal e/ou Área do Líder." }); return; }
    setIndo("novo"); setMsg(null);
    const { error } = await supabase.from("exp_acesso_masters")
      .upsert({ cpf, nome: novo.nome.trim(), portal: novo.portal, lider: novo.lider, ativo: true }, { onConflict: "cpf" });
    setIndo(null);
    if (error) { setMsg({ tom: "erro", texto: `Não salvou: ${error.message}` }); return; }
    setNovo({ cpf: "", nome: "", portal: true, lider: false });
    setMsg({ tom: "ok", texto: "Master salvo." });
    void carregar();
  }

  async function remover(m: Master) {
    if (!window.confirm(`Tirar ${m.nome} da lista de masters?`)) return;
    setIndo(m.cpf);
    const { error } = await supabase.from("exp_acesso_masters").delete().eq("cpf", m.cpf);
    setIndo(null);
    if (error) { setMsg({ tom: "erro", texto: `Não removeu: ${error.message}` }); return; }
    setLista((l) => (l ?? []).filter((x) => x.cpf !== m.cpf));
  }

  if (falta) return <Aviso>A lista de masters ainda não existe no banco (migration 0319 não aplicada). Hoje os masters estão fixos no código do portal antigo.</Aviso>;
  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!lista) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;

  const marca = (m: Master, campo: "portal" | "lider" | "ativo") => (
    <input type="checkbox" checked={m[campo]} disabled={!podeEditar || indo === m.cpf} onChange={(e) => void salvar(m.cpf, { [campo]: e.target.checked })} />
  );

  return (
    <div className="space-y-3">
      <Aviso>
        <b>Masters</b> entram no portal com o próprio CPF e senha e veem <b>todas</b> as viagens (no ExpedAmigo, as futuras; na Área do Líder, todas).
        O portal no ar (app antigo) ainda usa a lista do código dele — esta tabela passa a valer quando o portal ler daqui (virada).
      </Aviso>
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}
      <div className="rel-card overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left" style={{ color: "var(--ink3)" }}>
            {["Pessoa", "Portal (/amigo)", "Área do Líder", "Ativo", ""].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>
            {lista.map((m) => (
              <tr key={m.cpf} className="border-t" style={{ borderColor: "var(--line)", opacity: m.ativo ? 1 : 0.55 }}>
                <td className="px-3 py-1.5">
                  <div style={{ color: "var(--ink)" }}>{m.nome}</div>
                  <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{formatarCpf(m.cpf)}</div>
                </td>
                <td className="px-3 py-1.5">{marca(m, "portal")}</td>
                <td className="px-3 py-1.5">{marca(m, "lider")}</td>
                <td className="px-3 py-1.5">{marca(m, "ativo")}</td>
                <td className="px-3 py-1.5 text-right">
                  {podeEditar && <Botao variante="fantasma" disabled={indo === m.cpf} onClick={() => void remover(m)}>Remover</Botao>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {podeEditar ? (
        <div className="rel-card p-3 flex flex-wrap items-end gap-2">
          <label className="text-[12px]" style={{ color: "var(--ink2)" }}>CPF
            <input className="rel-input block mt-0.5 w-[150px]" value={novo.cpf} onChange={(e) => setNovo({ ...novo, cpf: e.target.value })} placeholder="000.000.000-00" />
          </label>
          <label className="text-[12px] flex-1 min-w-[200px]" style={{ color: "var(--ink2)" }}>Nome
            <input className="rel-input block mt-0.5 w-full" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </label>
          <label className="text-[12.5px] flex items-center gap-1"><input type="checkbox" checked={novo.portal} onChange={(e) => setNovo({ ...novo, portal: e.target.checked })} /> Portal</label>
          <label className="text-[12.5px] flex items-center gap-1"><input type="checkbox" checked={novo.lider} onChange={(e) => setNovo({ ...novo, lider: e.target.checked })} /> Área do Líder</label>
          <Botao variante="primario" disabled={indo === "novo"} onClick={() => void adicionar()}>{indo === "novo" ? "Salvando…" : "Adicionar master"}</Botao>
        </div>
      ) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só admin das Expedições muda esta lista.</p>}
    </div>
  );
}
