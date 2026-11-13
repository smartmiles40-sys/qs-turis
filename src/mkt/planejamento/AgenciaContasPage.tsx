// src/mkt/planejamento/AgenciaContasPage.tsx — Ajustes › Agência (0395).
// Quem da agência entra no portal (#agencia). A conta NÃO é usuário do QS:
// fica em mkt_agencia_contas (senha bcrypt) e só enxerga planejamento e produção
// dela. Gestor/admin cria, troca a senha e desativa (derruba a sessão na hora).
import { useCallback, useEffect, useState } from "react";
import { Aviso, Botao, Entrada } from "@/rel/ui";
import { useMkt } from "../contexto";
import { erroDePlano, listarContasAgencia, salvarContaAgencia, type ContaAgencia } from "./dados";
import { quando } from "./ItensEditor";

const ABC = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
function senhaNova(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ABC[x % ABC.length]).join("");
}

export default function AgenciaContasPage() {
  const { gestor } = useMkt();
  const [contas, setContas] = useState<ContaAgencia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [form, setForm] = useState({ agencia: "Disrupt", nome: "", email: "" });
  const [senhaMostrada, setSenhaMostrada] = useState<{ email: string; senha: string } | null>(null);

  const carregar = useCallback(async () => {
    if (!gestor) return;
    try { setContas(await listarContasAgencia()); setErro(null); } catch (e) { setErro(erroDePlano(e)); }
  }, [gestor]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (!gestor) return <Aviso>Só o gestor de Marketing (ou admin) cadastra o acesso da agência.</Aviso>;

  const link = `${window.location.origin}/#agencia`;

  async function criar() {
    const senha = senhaNova();
    setErro(null); setOk(null);
    try {
      await salvarContaAgencia({ agencia: form.agencia, nome: form.nome, email: form.email, senha });
      setSenhaMostrada({ email: form.email.trim().toLowerCase(), senha });
      setForm({ ...form, nome: "", email: "" });
      await carregar();
    } catch (e) { setErro(erroDePlano(e)); }
  }
  async function trocarSenha(c: ContaAgencia) {
    const senha = senhaNova();
    try { await salvarContaAgencia({ ...c, senha }); setSenhaMostrada({ email: c.email, senha }); await carregar(); }
    catch (e) { setErro(erroDePlano(e)); }
  }
  async function alternar(c: ContaAgencia) {
    try { await salvarContaAgencia({ ...c, ativo: !c.ativo }); setOk(c.ativo ? `${c.nome} não entra mais no portal.` : `${c.nome} reativada.`); await carregar(); }
    catch (e) { setErro(erroDePlano(e)); }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
        A agência entra em <b style={{ color: "var(--ink)" }}>{link}</b> com e-mail e senha. Lá ela sobe o planejamento (PDF ou Google Docs),
        a IA lê e confere, ela completa o que falta e manda pros supervisores. Depois de aprovado, manda o link do Canva de cada conteúdo.
        Ela não vê mais nada do QS.
      </p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="ok">{ok}</Aviso>}
      {senhaMostrada && (
        <Aviso tom="ok">
          Senha de <b>{senhaMostrada.email}</b>: <code className="px-1.5 py-0.5 rounded font-mono" style={{ background: "var(--card)" }}>{senhaMostrada.senha}</code>
          {" "}— copie e mande pra pessoa agora; ela não aparece de novo.
        </Aviso>
      )}

      <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
        {contas.length === 0 && <li className="px-4 py-3 text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma conta ainda.</li>}
        {contas.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3" style={{ opacity: c.ativo ? 1 : 0.55 }}>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[14px]" style={{ color: "var(--ink)" }}>{c.nome} <span className="font-normal" style={{ color: "var(--ink3)" }}>· {c.agencia}</span></div>
              <div className="text-[12px]" style={{ color: "var(--ink3)" }}>
                {c.email} · {c.ultimo_acesso ? `entrou ${quando(c.ultimo_acesso)}` : "nunca entrou"}
                {c.bloqueada_ate && new Date(c.bloqueada_ate) > new Date() ? " · bloqueada por tentativas" : ""}{c.ativo ? "" : " · desativada"}
              </div>
            </div>
            <Botao variante="fantasma" onClick={() => trocarSenha(c)}>Nova senha</Botao>
            <Botao variante={c.ativo ? "perigo" : "secundario"} onClick={() => alternar(c)}>{c.ativo ? "Desativar" : "Reativar"}</Botao>
          </li>
        ))}
      </ul>

      <form className="rel-card p-4 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Agência
          <Entrada value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} maxLength={80} required />
        </label>
        <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Nome da pessoa
          <Entrada value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} maxLength={80} required />
        </label>
        <label className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>E-mail
          <Entrada type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <div className="sm:col-span-3 flex justify-end">
          <Botao variante="primario" type="submit" disabled={!form.agencia.trim() || !form.nome.trim() || !form.email.trim()}>Criar acesso (gera a senha)</Botao>
        </div>
      </form>
    </div>
  );
}
