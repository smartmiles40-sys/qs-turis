// src/expedicoes/paginas/Config.tsx
// "Usuários das Expedições" (app antigo: app/(app)/configuracoes — lista de
// usuários e papéis, trocar papel, resetar senha + constantes do negócio).
// A conta de login é a MESMA do QS (usuarios.id = qs_users.id = auth). Daqui:
//   · trocar papel → exp_definir_papel (0165; não deixa mudar o próprio)
//   · dar acesso a quem já usa o QS → exp_dar_acesso (0165)
//   · criar login novo / resetar senha → /api/admin-user (ação exp_usuarios), senha forte
// Só admin das Expedições (admin do app antigo ou admin do QS) vê as ações.
// Ficaram de fora os cartões estáticos "Templates de checklist" e "Integrações"
// do antigo (eram só texto, sem função).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Botao, Campo, Entrada, Modal, Aviso } from "@/rel/ui";
import { useExp } from "../contexto";
import { Cartao, Selo } from "../ui";
import { supabase, lerPorIds } from "../lib/banco";
import { MARGEM_IDEAL, MARGEM_MINIMA, PAPEL_LABEL, PROVISAO_EXTRA_PADRAO } from "../lib/constants";
import type { PapelUsuario, UsuarioRow } from "../lib/database";
import { chamarRotaAdmin, copiar, rpc, useEhAdminExp } from "./_admin/comum";

const ATRIBUIVEIS: PapelUsuario[] = ["admin", "operacional", "relacionamento", "leitura"];
const DICA_PAPEL: Record<string, string> = {
  admin: "edita tudo e mexe nos usuários",
  operacional: "edita as Expedições",
  relacionamento: "só vê; aprova/recusa inscrições",
  leitura: "só vê",
};
type QsInfo = { id: string; role: string; setores: string[] | null; is_active: boolean };
type SemAcesso = { id: string; nome: string | null; email: string; papel_qs: string; setores: string[] | null };

export default function Config() {
  const { usuarios, recarregarUsuarios, avisar } = useExp();
  const ehAdmin = useEhAdminExp();
  const [eu, setEu] = useState<string | null>(null);
  const [qs, setQs] = useState<Map<string, QsInfo>>(new Map());
  const [senhaMostrada, setSenhaMostrada] = useState<{ nome: string; senha: string; email?: string } | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [darAcesso, setDarAcesso] = useState(false);
  const [criar, setCriar] = useState(false);

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setEu(data.user?.id ?? null)); }, []);
  const carregarQs = useCallback(async () => {
    try {
      const l = await lerPorIds<QsInfo>("qs_users", "id", usuarios.map((u) => u.id), "id,role,setores,is_active");
      setQs(new Map(l.map((x) => [x.id, x])));
    } catch { setQs(new Map()); }
  }, [usuarios]);
  useEffect(() => { if (usuarios.length) void carregarQs(); }, [usuarios, carregarQs]);

  const ordenados = useMemo(() => [...usuarios].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [usuarios]);

  async function trocarPapel(u: UsuarioRow, papel: string) {
    setOcupado(u.id);
    try {
      await rpc("exp_definir_papel", { p_usuario: u.id, p_papel: papel });
      avisar(`Papel alterado para ${PAPEL_LABEL[papel as PapelUsuario] ?? papel}`);
      recarregarUsuarios();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível alterar", "erro"); }
    finally { setOcupado(null); }
  }

  async function resetar(u: UsuarioRow) {
    setOcupado(u.id);
    try {
      const r = await chamarRotaAdmin<{ senha: string }>("exp_usuarios", { op: "resetar_senha", usuario_id: u.id });
      setSenhaMostrada({ nome: u.nome, senha: r.senha, email: u.email });
      setConfirmandoReset(null);
      recarregarUsuarios();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível resetar", "erro"); }
    finally { setOcupado(null); }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Usuários das Expedições</h1>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>
          O login é o mesmo do QS. O papel daqui vale só dentro das Expedições.
        </p>
      </header>

      <Cartao titulo={`Usuários (${usuarios.length})`} acao={ehAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => setDarAcesso(true)}>Dar acesso a quem já usa o QS</Botao>
          <Botao variante="primario" onClick={() => setCriar(true)}>Criar login novo</Botao>
        </div>
      ) : undefined}>
        {ehAdmin === false && <div className="mb-3"><Aviso>Apenas admins podem promover/demover usuários.</Aviso></div>}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {ordenados.map((u) => {
            const info = qs.get(u.id);
            const souEu = u.id === eu;
            const opcoes = ATRIBUIVEIS.includes(u.papel) ? ATRIBUIVEIS : [u.papel, ...ATRIBUIVEIS];
            return (
              <li key={u.id} className="py-3 flex flex-wrap items-center gap-3" style={{ borderColor: "var(--line)" }}>
                <Avatar nome={u.nome} />
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{u.nome}{souEu && <span style={{ color: "var(--ink3)" }}> (você)</span>}</div>
                  <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{u.email}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {!info ? <Selo tom="aviso" titulo="Sem perfil no QS: não consegue entrar até ter login">sem login no QS</Selo>
                      : info.is_active === false ? <Selo tom="erro">desativado no QS</Selo>
                      : <Selo tom="neutro" titulo="Papel no QS">QS: {info.role}</Selo>}
                    {u.senha_provisoria && <Selo tom="neutro" titulo="Recebeu senha provisória">senha provisória</Selo>}
                  </div>
                </div>
                {ehAdmin && !souEu ? (
                  <select className="rel-input" style={{ width: "auto" }} aria-label={`Papel de ${u.nome}`} value={u.papel} disabled={ocupado === u.id}
                    onChange={(e) => trocarPapel(u, e.target.value)}>
                    {opcoes.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]}</option>)}
                  </select>
                ) : <Selo tom={u.papel === "admin" ? "lista" : "neutro"}>{PAPEL_LABEL[u.papel] ?? u.papel}</Selo>}
                {ehAdmin && !souEu && info && (confirmandoReset === u.id ? (
                  <span className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink2)" }}>
                    Resetar a senha de {u.nome.split(" ")[0]}?
                    <Botao onClick={() => setConfirmandoReset(null)}>Não</Botao>
                    <Botao variante="perigo" disabled={ocupado === u.id} onClick={() => resetar(u)}>{ocupado === u.id ? "…" : "Sim"}</Botao>
                  </span>
                ) : <Botao variante="fantasma" onClick={() => setConfirmandoReset(u.id)}>Resetar senha</Botao>)}
              </li>
            );
          })}
        </ul>
        {ehAdmin && (
          <p className="mt-3 text-[11.5px]" style={{ color: "var(--ink3)" }}>
            Papéis: {ATRIBUIVEIS.map((p) => `${PAPEL_LABEL[p]} (${DICA_PAPEL[p]})`).join(" · ")}. Quem tem login no QS em Operações/Financeiro/Relacionamento
            já enxerga as Expedições mesmo sem estar nesta lista; estar aqui define o papel.
          </p>
        )}
      </Cartao>

      <Cartao titulo="Constantes do negócio">
        <dl className="grid gap-3 sm:grid-cols-3 text-[13px]">
          {[
            { r: "Margem mínima", v: MARGEM_MINIMA, d: "Abaixo disso a expedição é marcada em vermelho." },
            { r: "Margem ideal", v: MARGEM_IDEAL, d: "Meta. Verde a partir desse valor." },
            { r: "Provisão extra padrão", v: PROVISAO_EXTRA_PADRAO, d: "Reserva sobre custos planejados." },
          ].map((c) => (
            <div key={c.r} className="rounded-lg p-3" style={{ background: "var(--card2)" }}>
              <dt className="text-[12px]" style={{ color: "var(--ink3)" }}>{c.r}</dt>
              <dd className="text-[18px] font-bold" style={{ color: "var(--ink)" }}>{Math.round(c.v * 100)}%</dd>
              <dd className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{c.d}</dd>
            </div>
          ))}
        </dl>
      </Cartao>

      <ModalSenha dados={senhaMostrada} onFechar={() => setSenhaMostrada(null)} />
      {darAcesso && <ModalDarAcesso onFechar={() => setDarAcesso(false)} onFeito={() => { setDarAcesso(false); recarregarUsuarios(); }} />}
      {criar && <ModalCriar onFechar={() => setCriar(false)} onFeito={(d) => { setCriar(false); setSenhaMostrada(d); recarregarUsuarios(); }} />}
    </div>
  );
}

function ModalSenha({ dados, onFechar }: { dados: { nome: string; senha: string; email?: string } | null; onFechar: () => void }) {
  const { avisar } = useExp();
  if (!dados) return null;
  const texto = `${dados.email ? `Login: ${dados.email}\n` : ""}Senha: ${dados.senha}`;
  return (
    <Modal aberto titulo={`Senha de ${dados.nome.split(" ")[0]}`} onFechar={onFechar} largura={460}
      rodape={<>
        <Botao onClick={async () => avisar((await copiar(texto)) ? "Copiado" : "Não consegui copiar")}>Copiar</Botao>
        <Botao variante="primario" onClick={onFechar}>Fechar</Botao>
      </>}>
      <div className="space-y-3 text-[13px]" style={{ color: "var(--ink2)" }}>
        <code className="block px-3 py-2 rounded-md text-[16px] font-bold text-center" style={{ background: "var(--card2)", color: "var(--ink)" }}>{dados.senha}</code>
        <p>Repasse à pessoa por um canal seguro. Ela entra no QS (e no sistema antigo) com o e-mail e esta senha. Esta senha não aparece de novo.</p>
      </div>
    </Modal>
  );
}

function ModalDarAcesso({ onFechar, onFeito }: { onFechar: () => void; onFeito: () => void }) {
  const { avisar } = useExp();
  const [lista, setLista] = useState<SemAcesso[] | null>(null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<string>("");
  const [papel, setPapel] = useState<PapelUsuario>("operacional");
  const [indo, setIndo] = useState(false);
  useEffect(() => {
    rpc<SemAcesso[]>("exp_pessoas_sem_acesso").then(setLista).catch((e) => { avisar(e instanceof Error ? e.message : "Erro", "erro"); setLista([]); });
  }, [avisar]);
  const filtrada = (lista ?? []).filter((p) => `${p.nome ?? ""} ${p.email}`.toLowerCase().includes(busca.trim().toLowerCase()));
  return (
    <Modal aberto titulo="Dar acesso às Expedições" onFechar={onFechar} largura={520}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!escolhido || indo} onClick={async () => {
          setIndo(true);
          try { await rpc("exp_dar_acesso", { p_qs_user: escolhido, p_papel: papel }); avisar("Acesso dado"); onFeito(); }
          catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível", "erro"); }
          finally { setIndo(false); }
        }}>{indo ? "Salvando…" : "Dar acesso"}</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Pessoas que já entram no QS e ainda não estão na lista das Expedições.</p>
        <Entrada placeholder="Buscar por nome ou e-mail…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="max-h-[40vh] overflow-y-auto space-y-1">
          {lista === null ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
            : filtrada.length === 0 ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Ninguém encontrado.</p>
            : filtrada.map((p) => (
              <button key={p.id} type="button" onClick={() => setEscolhido(p.id)} className="w-full text-left px-2.5 py-2 rounded-lg rel-linha"
                style={escolhido === p.id ? { background: "var(--rel-soft)" } : undefined}>
                <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{p.nome ?? p.email}</div>
                <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{p.email} · QS: {p.papel_qs}{p.setores?.length ? ` (${p.setores.join(", ")})` : ""}</div>
              </button>
            ))}
        </div>
        <Campo rotulo="Papel nas Expedições">
          <select className="rel-input" value={papel} onChange={(e) => setPapel(e.target.value as PapelUsuario)}>
            {ATRIBUIVEIS.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]} — {DICA_PAPEL[p]}</option>)}
          </select>
        </Campo>
      </div>
    </Modal>
  );
}

function ModalCriar({ onFechar, onFeito }: { onFechar: () => void; onFeito: (d: { nome: string; senha: string; email: string }) => void }) {
  const { avisar } = useExp();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<PapelUsuario>("operacional");
  const [indo, setIndo] = useState(false);
  const valido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && nome.trim().length >= 2;
  return (
    <Modal aberto titulo="Criar login novo" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!valido || indo} onClick={async () => {
          setIndo(true);
          try {
            const r = await chamarRotaAdmin<{ senha: string }>("exp_usuarios", { op: "criar", email: email.trim(), nome: nome.trim(), papel });
            onFeito({ nome: nome.trim(), senha: r.senha, email: email.trim().toLowerCase() });
          } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível criar", "erro"); }
          finally { setIndo(false); }
        }}>{indo ? "Criando…" : "Criar"}</Botao>
      </>}>
      <div className="space-y-3">
        <Campo rotulo="Nome"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
        <Campo rotulo="E-mail" dica="Se a pessoa já entra no QS, use “Dar acesso a quem já usa o QS”."><Entrada type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo rotulo="Papel nas Expedições" dica={papel === "relacionamento" ? "No QS ela entra pelo Relacionamento." : "No QS ela entra por Operações."}>
          <select className="rel-input" value={papel} onChange={(e) => setPapel(e.target.value as PapelUsuario)}>
            {ATRIBUIVEIS.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]} — {DICA_PAPEL[p]}</option>)}
          </select>
        </Campo>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Uma senha forte é gerada e mostrada uma vez, pra você repassar.</p>
      </div>
    </Modal>
  );
}
