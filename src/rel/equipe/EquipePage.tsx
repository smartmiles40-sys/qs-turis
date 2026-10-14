// src/rel/equipe/EquipePage.tsx
// -----------------------------------------------------------------------------
// TIME DO RELACIONAMENTO (Bruno, 13/10/2026: "a Tainara poder adicionar outros
// funcionários"). Quem é do time, papel, se está ativo e o último acesso;
// adicionar, editar, desativar/reativar e redefinir senha.
//
// Quem usa: admin, ou a gestora do Relacionamento (gestor só com o setor
// Relacionamento). O servidor (/api/admin-user) trava a gestora no time dela:
// só cria/edita atendente ou gestor(a) do Relacionamento, nunca mexe em admin
// nem em quem tem o Comercial, e não exclui (desativa).
//
// 14/10 (Bruno): o NOME daqui é a ASSINATURA das mensagens no WhatsApp
// ("*Tainara Vasconcelos:*") — o servidor assina com o nome completo cadastrado.
// Só gestor(a)/admin vê esta tela. E ganhou CARGOS (0122): o nome da função de
// cada um, com permissões guardadas pro futuro (o Financeiro vai dar o status
// das atividades no QS).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { createQsAuthUser, listarEquipeRel, updateQsAuthUser, type MembroEquipe } from "@/lib/adminUsers";
import { Aviso, Avatar, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import { podeGerirRelacionamento } from "./permissao";
import { listarCargos, PERMISSOES, salvarCargo, SETORES_CARGO, type Cargo, type SetorCargo } from "./cargos";

type Papel = "relacionamento" | "gestor";
const PAPEL: Record<string, string> = { relacionamento: "Atendente", gestor: "Gestor(a)" };

/** Senha provisória legível (sem 0/O/1/l), 10 caracteres. */
function senhaProvisoria() {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => a[n % a.length]).join("");
}

function quando(iso: string | null) {
  if (!iso) return "nunca entrou";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface Form { id?: string; name: string; email: string; papel: Papel; senha: string; whatsapp: string; cargo_id: string; /** Cargo de quando abriu (só manda cargo_id se mudou). */ cargo_antes?: string }
const VAZIO: Form = { name: "", email: "", papel: "relacionamento", senha: "", whatsapp: "", cargo_id: "" };

/** Como o nome sai no topo da mensagem do WhatsApp (igual ao servidor). */
const assinaturaDe = (nome: string) => `*${nome.trim().replace(/\s+/g, " ") || "Nome"}:*`;

export default function EquipePage() {
  const { currentUser } = useQsAuth();
  const pode = podeGerirRelacionamento(currentUser);
  const ehAdmin = currentUser?.role === "admin";

  const [equipe, setEquipe] = useState<MembroEquipe[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [senhaNova, setSenhaNova] = useState<{ nome: string; email: string; senha: string } | null>(null);
  const [aba, setAba] = useState<"time" | "cargos">("time");
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const carregarCargos = useCallback(() => { listarCargos().then(setCargos).catch(() => setCargos([])); }, []);

  const carregar = useCallback(async () => {
    try {
      const r = await listarEquipeRel();
      if (!r.success) throw new Error(r.error || "Não consegui carregar o time.");
      setEquipe(r.equipe ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar o time.");
    }
  }, []);
  useEffect(() => { if (pode) { void carregar(); carregarCargos(); } }, [pode, carregar, carregarCargos]);

  if (!pode) {
    return (
      <div className="max-w-3xl">
        <Cabecalho />
        <Aviso>Só o admin ou a gestora do Relacionamento vê e cuida do time.</Aviso>
      </div>
    );
  }

  async function salvar() {
    if (!form) return;
    const nome = form.name.trim(), email = form.email.trim().toLowerCase();
    if (nome.length < 2) { setErroForm("Escreva o nome."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErroForm("E-mail inválido."); return; }
    if (!form.id && form.senha.length < 8) { setErroForm("A senha provisória precisa de 8+ caracteres."); return; }
    setSalvando(true); setErroForm(null);
    const mudouCargo = !form.id || (form.cargo_id || "") !== (form.cargo_antes || "");
    const base = { name: nome, email, role: form.papel, setores: ["relacionamento" as const], whatsapp_number: form.whatsapp.trim() || null, ...(mudouCargo ? { cargo_id: form.cargo_id || null } : {}) };
    const r = form.id
      ? await updateQsAuthUser({ id: form.id, ...base })
      : await createQsAuthUser({ ...base, password: form.senha, is_active: true });
    setSalvando(false);
    if (!r.success) { setErroForm(r.error || "Não consegui salvar."); return; }
    if (!form.id) setSenhaNova({ nome, email, senha: form.senha });
    else setAviso({ tom: "ok", texto: `${nome} atualizado(a).` });
    setForm(null);
    await carregar();
  }

  async function alternarAtivo(m: MembroEquipe) {
    const ativar = !m.is_active;
    if (!ativar && !window.confirm(`Desativar ${m.name}? A pessoa não consegue mais entrar no QS (dá pra reativar depois).`)) return;
    const r = await updateQsAuthUser({ id: m.id, is_active: ativar });
    setAviso(r.success ? { tom: "ok", texto: `${m.name} ${ativar ? "reativado(a)" : "desativado(a)"}.` } : { tom: "erro", texto: r.error || "Não consegui." });
    await carregar();
  }

  async function redefinirSenha(m: MembroEquipe) {
    if (!window.confirm(`Gerar uma senha provisória nova pra ${m.name}? A senha atual deixa de funcionar.`)) return;
    const senha = senhaProvisoria();
    const r = await updateQsAuthUser({ id: m.id, password: senha });
    if (!r.success) { setAviso({ tom: "erro", texto: r.error || "Não consegui trocar a senha." }); return; }
    setSenhaNova({ nome: m.name, email: m.email || "", senha });
  }

  const podeMexer = (m: MembroEquipe) => ehAdmin || m.so_relacionamento;
  const nomeDoCargo = (id?: string | null) => cargos.find((c) => c.id === id)?.nome;
  // Cargos que dá pra dar: ativos; a gestora só os do Relacionamento e do Financeiro.
  const cargosDisponiveis = cargos.filter((c) => c.ativo && (ehAdmin || c.setor === "relacionamento" || c.setor === "financeiro"));

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Cabecalho />
        {aba === "time" && <Botao variante="primario" onClick={() => { setErroForm(null); setForm({ ...VAZIO, senha: senhaProvisoria() }); }}>+ Adicionar funcionário</Botao>}
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--line)" }} role="tablist" aria-label="Equipe">
        {([["time", "Time"], ["cargos", "Cargos"]] as const).map(([v, r]) => (
          <button key={v} role="tab" aria-selected={aba === v} onClick={() => setAba(v)}
            className="h-10 px-3 text-[13px] font-semibold -mb-px"
            style={aba === v ? { color: "var(--rel-ink)", borderBottom: "2px solid var(--rel)" } : { color: "var(--ink2)", borderBottom: "2px solid transparent" }}>{r}</button>
        ))}
      </div>

      {aba === "cargos" ? <CargosSecao cargos={cargos} ehAdmin={ehAdmin} onMudou={carregarCargos} /> : <>

      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}
      {erro && <Aviso tom="erro">{erro} <Botao className="ml-2" onClick={() => void carregar()}>Tentar de novo</Botao></Aviso>}

      {equipe === null && !erro ? (
        <div className="rel-card h-40 animate-pulse" aria-busy="true" />
      ) : equipe && equipe.length === 0 ? (
        <div className="rel-card p-6"><Vazio titulo="Ninguém no time ainda" texto="Adicione quem atende o pós-venda." /></div>
      ) : equipe && (
        <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
          {equipe.map((m) => (
            <li key={m.id} className="p-4 flex flex-wrap items-center gap-3" style={{ opacity: m.is_active ? 1 : 0.6 }}>
              <Avatar nome={m.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{m.name}</span>
                  <Etiqueta tom={m.role === "gestor" ? "rel" : "neutro"}>{PAPEL[m.role] || m.role}</Etiqueta>
                  {!m.is_active && <Etiqueta tom="erro">Desativado</Etiqueta>}
                  {!m.so_relacionamento && <Etiqueta>Também no Comercial</Etiqueta>}
                  {m.id === currentUser?.id && <Etiqueta>Você</Etiqueta>}
                  {nomeDoCargo(m.cargo_id) && <Etiqueta tom="neutro">{nomeDoCargo(m.cargo_id)}</Etiqueta>}
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>
                  {m.email || "sem e-mail"} · último acesso: {quando(m.ultimo_acesso)}
                </div>
                <div className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>
                  Assina no WhatsApp como <b style={{ color: "var(--ink2)" }}>{assinaturaDe(m.name)}</b>
                </div>
              </div>
              {podeMexer(m) ? (
                <div className="flex flex-wrap gap-2">
                  <Botao onClick={() => { setErroForm(null); setForm({ id: m.id, name: m.name, email: m.email || "", papel: (m.role === "gestor" ? "gestor" : "relacionamento"), senha: "", whatsapp: m.whatsapp_number || "", cargo_id: m.cargo_id || "", cargo_antes: m.cargo_id || "" }); }}>Editar</Botao>
                  <Botao onClick={() => void redefinirSenha(m)}>Nova senha</Botao>
                  {m.id !== currentUser?.id && (
                    <Botao variante={m.is_active ? "perigo" : "secundario"} onClick={() => void alternarAtivo(m)}>{m.is_active ? "Desativar" : "Reativar"}</Botao>
                  )}
                </div>
              ) : (
                <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Só o admin edita</span>
              )}
            </li>
          ))}
        </ul>
      )}
      </>}

      <Modal aberto={!!form} titulo={form?.id ? "Editar funcionário" : "Adicionar funcionário"} onFechar={() => !salvando && setForm(null)}
        rodape={<>
          <Botao disabled={salvando} onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        </>}>
        {form && (
          <div className="space-y-3">
            <Campo rotulo="Nome" dica="É a assinatura das mensagens no WhatsApp: sai em negrito no topo de tudo que a pessoa mandar.">
              <Entrada value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Campo>
            <div className="rounded-lg px-3 py-2 text-[13px]" style={{ background: "var(--rel-soft)", color: "var(--ink2)" }}>
              Como sai no WhatsApp: <b style={{ color: "var(--ink)" }}>{assinaturaDe(form.name)}</b>
            </div>
            <Campo rotulo="E-mail (é o login)"><Entrada type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Campo>
            <Campo rotulo="Papel" dica="Atendente: atende, cuida das fichas e viagens. Gestor(a): também configura o Relacionamento e cuida do time.">
              <select className="rel-input w-full" value={form.papel} disabled={form.id === currentUser?.id}
                onChange={(e) => setForm({ ...form, papel: e.target.value as Papel })}>
                <option value="relacionamento">Atendente</option>
                <option value="gestor">Gestor(a) do Relacionamento</option>
              </select>
            </Campo>
            <Campo rotulo="Cargo" dica="O nome da função. Crie novos na aba Cargos.">
              <select className="rel-input w-full" value={form.cargo_id} onChange={(e) => setForm({ ...form, cargo_id: e.target.value })}>
                <option value="">Sem cargo</option>
                {cargosDisponiveis.map((c) => <option key={c.id} value={c.id}>{c.nome} · {SETORES_CARGO[c.setor]}</option>)}
                {/* O cargo atual aparece mesmo desativado ou fora da alçada — senão o select mostraria "Sem cargo". */}
                {form.cargo_id && !cargosDisponiveis.some((c) => c.id === form.cargo_id) && (() => { const c = cargos.find((x) => x.id === form.cargo_id); return <option value={form.cargo_id}>{c ? `${c.nome} · ${SETORES_CARGO[c.setor]}${c.ativo ? "" : " (desativado)"}` : "Cargo atual"}</option>; })()}
              </select>
            </Campo>
            <Campo rotulo="WhatsApp (opcional)"><Entrada value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="11 99999-9999" /></Campo>
            {!form.id && (
              <Campo rotulo="Senha provisória" dica="A pessoa entra com ela e troca depois.">
                <div className="flex gap-2">
                  <Entrada value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} className="font-mono" />
                  <Botao onClick={() => setForm({ ...form, senha: senhaProvisoria() })}>Gerar</Botao>
                </div>
              </Campo>
            )}
            {erroForm && <Aviso tom="erro">{erroForm}</Aviso>}
          </div>
        )}
      </Modal>

      <Modal aberto={!!senhaNova} titulo="Acesso pronto" onFechar={() => setSenhaNova(null)}
        rodape={<Botao variante="primario" onClick={() => setSenhaNova(null)}>Feito</Botao>}>
        {senhaNova && (
          <div className="space-y-3 text-sm" style={{ color: "var(--ink2)" }}>
            <p>Mande pra <b>{senhaNova.nome}</b> (a senha não aparece de novo):</p>
            <pre className="rel-card p-3 text-[13px] whitespace-pre-wrap font-mono" style={{ color: "var(--ink)" }}>
{`Endereço: ${window.location.origin}\nLogin: ${senhaNova.email}\nSenha provisória: ${senhaNova.senha}\nNa entrada, escolha a porta "Relacionamento".`}
            </pre>
            <Botao onClick={() => void navigator.clipboard.writeText(`Endereço: ${window.location.origin}\nLogin: ${senhaNova.email}\nSenha provisória: ${senhaNova.senha}\nNa entrada, escolha a porta "Relacionamento".`)}>Copiar</Botao>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ── Cargos ──────────────────────────────────────────────────────────────────

interface FormCargo { id?: string; nome: string; setor: SetorCargo; descricao: string; permissoes: string[] }

function CargosSecao({ cargos, ehAdmin, onMudou }: { cargos: Cargo[]; ehAdmin: boolean; onMudou: () => void }) {
  const [form, setForm] = useState<FormCargo | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  // A gestora mexe só nos setores dela; o banco confere de novo.
  const setoresQuePode: SetorCargo[] = ehAdmin ? ["relacionamento", "financeiro", "comercial", "operacional"] : ["relacionamento", "financeiro"];
  const podeMexer = (c: Cargo) => setoresQuePode.includes(c.setor);

  async function salvar() {
    if (!form) return;
    if (form.nome.trim().length < 2) { setErro("Escreva o nome do cargo."); return; }
    setSalvando(true); setErro(null);
    try {
      await salvarCargo({ id: form.id, nome: form.nome, setor: form.setor, descricao: form.descricao, permissoes: form.permissoes });
      setAviso({ tom: "ok", texto: `Cargo "${form.nome.trim()}" salvo.` });
      setForm(null);
      onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui salvar."); }
    finally { setSalvando(false); }
  }

  async function alternar(c: Cargo) {
    try {
      await salvarCargo({ ...c, ativo: !c.ativo });
      setAviso({ tom: "ok", texto: `"${c.nome}" ${c.ativo ? "desativado — some da lista de escolha; quem já tem continua com ele" : "reativado"}.` });
      onMudou();
    } catch (e) { setAviso({ tom: "erro", texto: e instanceof Error ? e.message : "Não consegui." }); }
  }

  const porSetor = (Object.keys(SETORES_CARGO) as SetorCargo[])
    .map((s) => ({ setor: s, lista: cargos.filter((c) => c.setor === s) }))
    .filter((g) => g.lista.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] max-w-xl" style={{ color: "var(--ink2)" }}>
          O cargo é o nome da função de cada pessoa. O que libera o acesso continua sendo o papel (atendente ou gestor).
          As permissões ficam guardadas pro futuro — ainda não travam nada.
        </p>
        <Botao variante="primario" onClick={() => { setErro(null); setForm({ nome: "", setor: "relacionamento", descricao: "", permissoes: [] }); }}>+ Novo cargo</Botao>
      </div>
      {aviso && <Aviso tom={aviso.tom}>{aviso.texto}</Aviso>}
      {porSetor.length === 0 && <div className="rel-card p-6"><Vazio titulo="Nenhum cargo ainda" texto="Crie o primeiro no botão acima." /></div>}
      {porSetor.map((g) => (
        <section key={g.setor}>
          <h2 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>{SETORES_CARGO[g.setor]}</h2>
          <ul className="rel-card divide-y" style={{ borderColor: "var(--line)" }}>
            {g.lista.map((c) => (
              <li key={c.id} className="p-3 flex flex-wrap items-center gap-3" style={{ opacity: c.ativo ? 1 : 0.6 }}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" style={{ color: "var(--ink)" }}>{c.nome}</span>
                    {!c.ativo && <Etiqueta tom="erro">Desativado</Etiqueta>}
                    {c.permissoes.length > 0 && <Etiqueta>{c.permissoes.length} permiss{c.permissoes.length === 1 ? "ão" : "ões"}</Etiqueta>}
                  </div>
                  {c.descricao && <div className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{c.descricao}</div>}
                </div>
                {podeMexer(c) ? (
                  <div className="flex gap-2">
                    <Botao onClick={() => { setErro(null); setForm({ id: c.id, nome: c.nome, setor: c.setor, descricao: c.descricao || "", permissoes: c.permissoes }); }}>Editar</Botao>
                    <Botao variante={c.ativo ? "perigo" : "secundario"} onClick={() => void alternar(c)}>{c.ativo ? "Desativar" : "Reativar"}</Botao>
                  </div>
                ) : <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Só o admin edita</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Modal aberto={!!form} titulo={form?.id ? "Editar cargo" : "Novo cargo"} onFechar={() => !salvando && setForm(null)}
        rodape={<>
          <Botao disabled={salvando} onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        </>}>
        {form && (
          <div className="space-y-3">
            <Campo rotulo="Nome do cargo"><Entrada value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Analista financeiro" autoFocus /></Campo>
            <Campo rotulo="Setor">
              <select className="rel-input w-full" value={form.setor} onChange={(e) => setForm({ ...form, setor: e.target.value as SetorCargo })}>
                {setoresQuePode.map((s) => <option key={s} value={s}>{SETORES_CARGO[s]}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Descrição (opcional)"><Entrada value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="O que essa pessoa faz" /></Campo>
            <fieldset>
              <legend className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Permissões (preparadas pro futuro — ainda não travam nada)</legend>
              <div className="space-y-1.5">
                {PERMISSOES.map((p) => (
                  <label key={p.chave} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--ink)" }}>
                    <input type="checkbox" checked={form.permissoes.includes(p.chave)}
                      onChange={(e) => setForm({ ...form, permissoes: e.target.checked ? [...form.permissoes, p.chave] : form.permissoes.filter((x) => x !== p.chave) })} />
                    {p.rotulo} <span className="text-[11px]" style={{ color: "var(--ink3)" }}>· {SETORES_CARGO[p.setor]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {erro && <Aviso tom="erro">{erro}</Aviso>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Cabecalho() {
  return (
    <header>
      <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Time do Relacionamento</h1>
      <p className="text-sm mt-1" style={{ color: "var(--ink2)" }}>Quem atende o pós-venda, o cargo, a assinatura no WhatsApp e o último acesso.</p>
    </header>
  );
}
