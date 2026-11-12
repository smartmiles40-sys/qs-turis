// src/mkt/conteudo/EquipeMktPage.tsx
// -----------------------------------------------------------------------------
// EQUIPE DO MARKETING (0240) — aba "Equipe" de Ajustes (AjustesPage.tsx): quem é do Orgânico, do Tráfego e quem aprova.
// Só quem aprova muda — a RPC mkt_definir_papeis confere. Com a 0266 (04/11/2026)
// todo o time do Marketing aprova; o papel aqui só arruma o menu e os avisos.
// Quem aparece aqui: quem tem a porta do Marketing (papel marketing, setor
// Marketing marcado em Configurações › Usuários, gestor com a área, admin).
//
// 11/11/2026 (Bruno: "uma parte de gestão de users do marketing, assim consigo
// adicionar novas pessoas"): o ADMIN cadastra gente nova direto daqui (mesmo
// perfil da Carol/Giovanna: papel marketing + setores Comercial e Marketing),
// troca a senha e desativa/reativa. Tudo pela /api/admin-user (só admin passa).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Aviso, Avatar, Botao, Vazio } from "@/rel/ui";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import { createQsAuthUser, updateQsAuthUser } from "@/lib/adminUsers";
import { useMkt } from "../contexto";
import { NOME_PAPEL_MKT, PAPEIS_MKT, type PapelMkt } from "../menu";
import { definirPapeis, erroDe } from "./dados";

interface Conta { id: string; name: string; email: string | null; role: string; is_active: boolean }

const ABC = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
function senhaNova(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return "Setur@" + Array.from(b, (x) => ABC[x % ABC.length]).join("");
}
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function EquipeMktPage() {
  const { pessoas, aprovador, recarregar, carregando, erro } = useMkt();
  const { currentUser } = useQsAuth();
  const souAdmin = currentUser?.role === "admin";
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [novo, setNovo] = useState<{ nome: string; email: string; senha: string; papeis: PapelMkt[] } | null>(null);

  // Admin: e-mail e situação (ativo/desativado) de quem é do Marketing — o mkt_pessoas só traz os ativos.
  const carregarContas = useCallback(async () => {
    if (!souAdmin) return;
    const { data } = await supabase.from("qs_users").select("id, name, email, role, is_active")
      .or("role.eq.marketing,setores.cs.{marketing}").neq("role", "admin").order("name");
    setContas((data ?? []) as Conta[]);
  }, [souAdmin]);
  useEffect(() => { void carregarContas(); }, [carregarContas]);

  async function tudo() { await Promise.all([recarregar(), carregarContas()]); }

  async function alternar(id: string, atuais: PapelMkt[], p: PapelMkt) {
    const novos = atuais.includes(p) ? atuais.filter((x) => x !== p) : [...atuais, p];
    setSalvando(id); setErroAcao(null);
    try { await definirPapeis(id, novos); await recarregar(); }
    catch (e) { setErroAcao(erroDe(e)); }
    finally { setSalvando(null); }
  }

  async function cadastrar() {
    if (!novo) return;
    const nome = novo.nome.trim();
    const email = novo.email.trim().toLowerCase();
    if (!nome) return setErroAcao("Informe o nome.");
    if (!EMAIL_OK.test(email)) return setErroAcao("E-mail inválido.");
    if (novo.senha.length < 8) return setErroAcao("A senha precisa de pelo menos 8 caracteres.");
    const { senha, papeis } = novo;
    setSalvando("novo"); setErroAcao(null); setOk(null);
    let criada = false;
    try {
      const r = await createQsAuthUser({ name: nome, email, password: senha, role: "marketing", setores: ["comercial", "marketing"], is_active: true });
      if (!r.success) throw new Error(/already|registered|duplicate/i.test(r.error ?? "") ? "Esse e-mail já tem conta no QS." : r.error || "Não consegui criar a conta.");
      // 12/11/2026: a conta JÁ existe a partir daqui. Antes, se os papéis falhassem, o
      // erro caía no catch com o formulário aberto e a senha nunca aparecia — e o
      // "Criar acesso" de novo só dizia "Esse e-mail já tem conta". Agora a senha
      // sempre aparece e a falha dos papéis vira um aviso à parte.
      criada = true;
      setOk(`Conta criada. Passe pra ${nome}: e-mail ${email} · senha ${senha} (peça pra trocar no 1º acesso).`);
      setNovo(null);
      const id = (r.user as { id?: string } | undefined)?.id;
      if (papeis.length) {
        try {
          if (!id) throw new Error("o servidor não devolveu o id da conta");
          await definirPapeis(id, papeis);
        } catch (e) {
          setErroAcao(`A conta foi criada, mas os papéis (${papeis.map((p) => (p === "gestor" ? "Gestor" : NOME_PAPEL_MKT[p])).join(", ")}) não foram salvos: ${erroDe(e)} Marque-os na lista abaixo.`);
        }
      }
    } catch (e) { setErroAcao(erroDe(e)); }
    finally {
      if (criada) await tudo().catch(() => undefined);
      setSalvando(null);
    }
  }

  async function trocarSenha(c: Conta) {
    const s = senhaNova();
    setSalvando(c.id); setErroAcao(null); setOk(null);
    try {
      const r = await updateQsAuthUser({ id: c.id, password: s });
      if (!r.success) throw new Error(r.error || "Não consegui trocar a senha.");
      setOk(`Nova senha de ${c.name}: ${s}`);
    } catch (e) { setErroAcao(erroDe(e)); }
    finally { setSalvando(null); }
  }

  async function ativar(c: Conta, ativo: boolean) {
    setSalvando(c.id); setErroAcao(null); setOk(null);
    try {
      const r = await updateQsAuthUser({ id: c.id, is_active: ativo });
      if (!r.success) throw new Error(r.error || "Não consegui mudar a conta.");
      setOk(ativo ? `${c.name} voltou a ter acesso.` : `${c.name} não entra mais no QS (a conta fica guardada, dá pra reativar).`);
      await tudo();
    } catch (e) { setErroAcao(erroDe(e)); }
    finally { setSalvando(null); }
  }

  const contaDe = new Map(contas.map((c) => [c.id, c]));
  const desativados = contas.filter((c) => !c.is_active && c.role === "marketing");

  if (carregando) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  return (
    <div>
      <div className="flex flex-wrap items-start gap-3 mb-3">
        <p className="text-[13px] flex-1 min-w-[240px]" style={{ color: "var(--ink3)" }}>
          Orgânico e Tráfego mudam o menu de cada um (quem aprova vê tudo).
          {souAdmin ? " Pra pôr alguém novo no Marketing, use “Adicionar pessoa”." : " Pra pôr alguém novo na área, peça ao admin."}
        </p>
        {souAdmin && !novo && (
          <Botao variante="primario" onClick={() => { setOk(null); setErroAcao(null); setNovo({ nome: "", email: "", senha: senhaNova(), papeis: ["organico"] }); }}>
            + Adicionar pessoa
          </Botao>
        )}
      </div>
      {erro && <Aviso tom="erro">{erroDe(new Error(erro))}</Aviso>}
      {erroAcao && <div className="mb-3"><Aviso tom="erro">{erroAcao}</Aviso></div>}
      {ok && <div className="mb-3"><Aviso tom="ok">{ok}</Aviso></div>}
      {!aprovador && <div className="mb-3"><Aviso>Só o gestor de Marketing muda os papéis. Aqui você vê quem é quem.</Aviso></div>}

      {souAdmin && novo && (
        <div className="rel-card p-3 sm:p-4 mb-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px]" style={{ color: "var(--ink3)" }}>Nome
            <input className="rel-input w-full mt-1" value={novo.nome} autoFocus onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </label>
          <label className="text-[12px]" style={{ color: "var(--ink3)" }}>E-mail
            <input className="rel-input w-full mt-1" type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
          </label>
          <label className="text-[12px]" style={{ color: "var(--ink3)" }}>Senha (anote e passe pra pessoa)
            <span className="flex gap-2 mt-1">
              <input className="rel-input w-full font-mono" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              <Botao onClick={() => setNovo({ ...novo, senha: senhaNova() })}>Gerar</Botao>
            </span>
          </label>
          <div className="text-[12px]" style={{ color: "var(--ink3)" }}>O que a pessoa faz
            <span className="flex flex-wrap gap-3 mt-2">
              {PAPEIS_MKT.map((pp) => (
                <label key={pp} className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: "var(--ink2)" }}>
                  <input type="checkbox" checked={novo.papeis.includes(pp)}
                    onChange={() => setNovo({ ...novo, papeis: novo.papeis.includes(pp) ? novo.papeis.filter((x) => x !== pp) : [...novo.papeis, pp] })} />
                  {pp === "gestor" ? "Gestor" : NOME_PAPEL_MKT[pp]}
                </label>
              ))}
            </span>
          </div>
          <div className="sm:col-span-2 flex flex-wrap gap-2 justify-end">
            <Botao onClick={() => { setNovo(null); setErroAcao(null); }} disabled={salvando === "novo"}>Cancelar</Botao>
            <Botao variante="primario" onClick={() => void cadastrar()} disabled={salvando === "novo"}>{salvando === "novo" ? "Criando…" : "Criar acesso"}</Botao>
          </div>
        </div>
      )}

      {pessoas.length === 0 ? <div className="rel-card"><Vazio titulo="Ninguém na área ainda" /></div> : (
        <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
          {pessoas.map((p) => {
            const c = contaDe.get(p.id);
            return (
              <li key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 sm:px-4 py-3">
                <span className="flex items-center gap-2.5 flex-1 min-w-0">
                  <Avatar nome={p.nome} tamanho={32} />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.nome}</span>
                    <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                      {souAdmin && c?.email ? c.email + " · " : ""}
                      {p.role === "admin" ? "Admin (aprova sempre)" : p.role === "gestor" ? "Gestor com a área Marketing (aprova sempre)" : p.aprovador ? "Aprova" : p.papeis.length ? "" : "Sem papel definido (vê tudo, não aprova)"}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  {PAPEIS_MKT.map((pp) => (
                    <label key={pp} className="inline-flex items-center gap-1.5 text-[13px] cursor-pointer" style={{ color: "var(--ink2)" }}>
                      <input type="checkbox" checked={p.papeis.includes(pp)} disabled={!aprovador || salvando === p.id} onChange={() => void alternar(p.id, p.papeis, pp)} />
                      {pp === "gestor" ? "Gestor" : NOME_PAPEL_MKT[pp]}
                    </label>
                  ))}
                  {/* Só a conta que é do Marketing (papel marketing): gestor/SDR com a área marcada tem outras portas — mexe em Configurações › Usuários. */}
                  {souAdmin && c && c.role === "marketing" && c.id !== currentUser?.id && (
                    <span className="flex gap-2">
                      <Botao className="text-[12px]" disabled={salvando === c.id} onClick={() => void trocarSenha(c)}>Nova senha</Botao>
                      <Botao className="text-[12px]" disabled={salvando === c.id} onClick={() => void ativar(c, false)}>Desativar</Botao>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {souAdmin && desativados.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-semibold mb-2" style={{ color: "var(--ink3)" }}>Desativados (não entram no QS)</p>
          <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
            {desativados.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5">
                <Avatar nome={c.name} tamanho={28} />
                <span className="flex-1 min-w-0 text-[13px] truncate" style={{ color: "var(--ink2)" }}>{c.name}{c.email ? ` · ${c.email}` : ""}</span>
                <Botao className="text-[12px]" disabled={salvando === c.id} onClick={() => void ativar(c, true)}>Reativar</Botao>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
