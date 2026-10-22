// src/expedicoes/paginas/_globais/PessoaGaveta.tsx
// Perfil da pessoa no "Clube de viajantes" (app antigo: PassageirosGlobalTabela →
// PessoaDrawer + SenhaExpedamigoPessoa). Abas Passageiro / Saúde / Expedições.
// Os dados pessoais valem pra TODAS as expedições da pessoa (gravados de uma vez
// pela função exp_pessoa_propagar). Documentos (passaporte + Drive), perfil &
// conexões, senha do ExpedAmigo (só admin) e excluir a pessoa da base.
import { useEffect, useMemo, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../../contexto";
import { BotaoExcluir, Gaveta, Selo, type Tom } from "../../ui";
import Drive from "../../drive/Drive";
import { formatDate } from "../../lib/utils";
import { mascaraCpf } from "../../lib/cpf";
import type { PessoaAgregada } from "../../lib/pessoas";
import type { ArquivoRow, StatusReserva } from "../../lib/database";
import { idadeDe } from "./excel";
import { SaudeCampos } from "./SaudeCampos";
import {
  abrirArquivo, anexarPassaporte, estadoSenhaCpf, excluirPessoa, gerarNovaSenhaCpf, propagarPessoais, removerPassaporte, type EstadoSenha,
} from "./pessoaAcoes";

export const TOM_RESERVA: Record<StatusReserva, Tom> = { Confirmado: "ok", "Pré-reserva": "aviso", Lead: "neutro", Cancelado: "erro" };

const CAMPOS = ["nome_completo", "cpf", "data_nascimento", "passaporte", "validade_passaporte", "email", "telefone",
  "contato_emergencia_nome", "contato_emergencia_fone", "restricoes_alimentares", "condicoes_medicas"] as const;
type CampoForm = (typeof CAMPOS)[number];
type Form = Record<CampoForm, string> & { saude: Record<string, string> };

function formDe(p: PessoaAgregada): Form {
  const f = {} as Form;
  for (const c of CAMPOS) {
    const v = p[c as keyof PessoaAgregada] as string | null;
    f[c] = c === "data_nascimento" || c === "validade_passaporte" ? (v ?? "").slice(0, 10) : (v ?? "");
  }
  f.saude = Object.fromEntries(Object.entries((p.saude ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v == null ? "" : String(v)]));
  return f;
}

export function PessoaGaveta({ pessoa, arquivos, fotoUrl, onFechar, onMudou, abrirExp }: {
  pessoa: PessoaAgregada;
  /** Arquivos de todas as linhas da pessoa. */
  arquivos: ArquivoRow[];
  fotoUrl?: string | null;
  onFechar: () => void;
  onMudou: () => void;
  abrirExp: (expedicaoId: string, passageiroId?: string) => void;
}) {
  const { somenteLeitura, avisar } = useExp();
  const [aba, setAba] = useState<"passageiro" | "saude" | "expedicoes">("passageiro");
  const inicial = useMemo(() => formDe(pessoa), [pessoa]);
  const [form, setForm] = useState<Form>(inicial);
  const [erros, setErros] = useState<Partial<Record<CampoForm, string>>>({});
  const [salvando, setSalvando] = useState(false);
  const refId = pessoa.idsPassageiros[0];
  useEffect(() => { setForm(inicial); setErros({}); }, [inicial]);

  const mudou = JSON.stringify(form) !== JSON.stringify(inicial);
  const idade = idadeDe(pessoa.data_nascimento);
  const set = (c: CampoForm, v: string) => setForm((s) => ({ ...s, [c]: v }));

  const salvar = async () => {
    const e: Partial<Record<CampoForm, string>> = {};
    if (form.nome_completo.trim().length < 2) e.nome_completo = "Mínimo 2 caracteres";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = "E-mail inválido";
    setErros(e);
    if (Object.keys(e).length) { setAba("passageiro"); return; }
    if (!refId) { avisar("Pessoa sem vínculo de expedição", "erro"); return; }
    // Só o que mudou vai pro banco (o resto de cada expedição fica como está).
    const patch: Record<string, unknown> = {};
    for (const c of CAMPOS) if (form[c] !== inicial[c]) patch[c] = c === "nome_completo" ? form[c].trim() : (form[c].trim() || null);
    const chaves = new Set([...Object.keys(form.saude), ...Object.keys(inicial.saude)]);
    const saude: Record<string, string | null> = {};
    for (const k of chaves) {
      const novo = (form.saude[k] ?? "").trim();
      if (novo !== (inicial.saude[k] ?? "").trim()) saude[k] = novo || null; // null = apagar a resposta
    }
    if (Object.keys(saude).length) patch.saude = saude;
    if (!Object.keys(patch).length) return;
    setSalvando(true);
    try {
      await propagarPessoais(refId, patch);
      avisar(pessoa.totalExpedicoes > 1 ? `Dados atualizados em ${pessoa.expedicoes.length} expedições` : "Dados atualizados");
      onMudou(); onFechar();
    } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao salvar", "erro"); }
    finally { setSalvando(false); }
  };

  const ancoraExp = pessoa.expedicaoIdAncora, ancoraPax = pessoa.passageiroIdAncora;
  const outrosArquivos = arquivos.filter((a) => a.passageiro_id !== ancoraPax);
  const pv = pessoa.perfil_viajante ?? null;
  const temPerfil = pv && [pv.profissao, pv.descricao_grupo, pv.anima_expedicao, pv.significado, pv.instagram, pv.camiseta, pv.musica].some((v) => v && String(v).trim());

  return (
    <Gaveta aberta titulo={pessoa.nome_completo} largura={640} onFechar={onFechar}
      subtitulo={`${pessoa.totalExpedicoes} expediç${pessoa.totalExpedicoes === 1 ? "ão" : "ões"} · ${idade != null ? `${idade} anos` : "idade não informada"} · alterações refletem em todas as expedições`}
      rodape={<>
        {!somenteLeitura && refId && (
          <span className="mr-auto">
            <BotaoExcluir icone={false} rotulo="Excluir passageiro" titulo={`Excluir "${pessoa.nome_completo}" da base?`} sucesso="Passageiro excluído da base"
              descricao={pessoa.totalExpedicoes > 0
                ? `Esta pessoa está em ${pessoa.totalExpedicoes} expediç${pessoa.totalExpedicoes === 1 ? "ão" : "ões"}. Excluir remove TODOS os registros dela do sistema, inclusive dessas expedições. Esta ação não pode ser desfeita.`
                : "Remove o passageiro da base operacional. Esta ação não pode ser desfeita."}
              onConfirmar={async () => { await excluirPessoa(refId); onMudou(); onFechar(); }} />
          </span>
        )}
        <Botao onClick={onFechar}>Fechar</Botao>
        {!somenteLeitura && <Botao variante="primario" disabled={salvando || !mudou} onClick={salvar}>{salvando ? "Salvando…" : "Salvar alterações"}</Botao>}
      </>}>
      <div className="flex flex-col sm:flex-row gap-3">
        <nav className="flex sm:flex-col gap-1 sm:w-32 flex-shrink-0 sm:self-start" aria-label="Seções do perfil">
          {([["passageiro", "Passageiro"], ["saude", "Saúde"], ["expedicoes", `Expedições (${pessoa.totalExpedicoes})`]] as const).map(([id, rot]) => (
            <button key={id} onClick={() => setAba(id)} aria-current={aba === id ? "page" : undefined}
              className="text-left rounded-md px-2.5 py-1.5 text-[13px] font-semibold"
              style={aba === id ? { background: "var(--ink)", color: "var(--bg)" } : { color: "var(--ink2)" }}>{rot}</button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {aba === "passageiro" && (
            <div className="space-y-5">
              <fieldset disabled={somenteLeitura} className="space-y-3">
                <Campo rotulo="Nome completo" erro={erros.nome_completo}><Entrada value={form.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} /></Campo>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="CPF"><Entrada value={form.cpf} onChange={(e) => set("cpf", mascaraCpf(e.target.value))} inputMode="numeric" /></Campo>
                  <Campo rotulo="Nascimento"><Entrada type="date" value={form.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></Campo>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Passaporte"><Entrada value={form.passaporte} onChange={(e) => set("passaporte", e.target.value)} /></Campo>
                  <Campo rotulo="Validade passaporte"><Entrada type="date" value={form.validade_passaporte} onChange={(e) => set("validade_passaporte", e.target.value)} /></Campo>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="E-mail" erro={erros.email}><Entrada type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Campo>
                  <Campo rotulo="Telefone"><Entrada value={form.telefone} onChange={(e) => set("telefone", e.target.value)} /></Campo>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Campo rotulo="Contato de emergência"><Entrada placeholder="Nome" value={form.contato_emergencia_nome} onChange={(e) => set("contato_emergencia_nome", e.target.value)} /></Campo>
                  <Campo rotulo="Fone de emergência"><Entrada value={form.contato_emergencia_fone} onChange={(e) => set("contato_emergencia_fone", e.target.value)} /></Campo>
                </div>
                <Campo rotulo="Restrições alimentares"><Entrada value={form.restricoes_alimentares} onChange={(e) => set("restricoes_alimentares", e.target.value)} /></Campo>
                <Campo rotulo="Condições médicas"><Entrada value={form.condicoes_medicas} onChange={(e) => set("condicoes_medicas", e.target.value)} /></Campo>
              </fieldset>

              <section className="pt-4 border-t space-y-2" style={{ borderColor: "var(--line)" }}>
                <div>
                  <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Documentos do passageiro</h3>
                  <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Passaporte e demais documentos — compartilhados por todas as expedições.</p>
                </div>
                {ancoraExp && ancoraPax ? (
                  <>
                    <PassaporteAnexo expedicaoId={ancoraExp} passageiroId={ancoraPax} arquivoId={pessoa.passaporte_arquivo_id} onMudou={onMudou} />
                    <Drive expedicaoId={ancoraExp} passageiroId={ancoraPax} somenteLeitura={somenteLeitura} />
                    {outrosArquivos.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11.5px] font-semibold" style={{ color: "var(--ink3)" }}>Arquivos guardados em outras expedições da pessoa</p>
                        <ul className="space-y-1">
                          {outrosArquivos.map((a) => (
                            <li key={a.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px]" style={{ borderColor: "var(--line)" }}>
                              <span className="flex-1 min-w-0 truncate" title={a.descricao ?? a.nome}>{a.nome}</span>
                              <Selo>{a.categoria}</Selo>
                              <button className="font-semibold hover:underline" style={{ color: "var(--rel-ink)" }} onClick={() => abrirArquivo(a.id).catch((e) => avisar(e.message, "erro"))}>Abrir</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : <p className="text-[12.5px] italic" style={{ color: "var(--ink3)" }}>Vincule a pessoa a uma expedição para anexar documentos.</p>}
              </section>

              {(temPerfil || fotoUrl) && (
                <section className="pt-4 border-t space-y-2" style={{ borderColor: "var(--line)" }}>
                  <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Perfil &amp; conexões</h3>
                  {fotoUrl && <img src={fotoUrl} alt="Foto do viajante" className="w-24 h-24 rounded-lg object-cover" />}
                  {pv && (
                    <div className="grid gap-2 sm:grid-cols-2 text-[12.5px]">
                      <LinhaPerfil rotulo="Profissão" valor={pv.profissao} />
                      <LinhaPerfil rotulo="Como se descreve em grupo" valor={pv.descricao_grupo} />
                      <LinhaPerfil rotulo="O que mais te anima" valor={pv.anima_expedicao} />
                      <LinhaPerfil rotulo="Significado" valor={pv.significado} />
                      <LinhaPerfil rotulo="Instagram" valor={pv.instagram} />
                      <LinhaPerfil rotulo="Camiseta" valor={pv.camiseta} />
                      <LinhaPerfil rotulo="Música" valor={pv.musica} />
                    </div>
                  )}
                </section>
              )}

              <SenhaExpedamigo cpf={pessoa.cpf} />
            </div>
          )}

          {aba === "saude" && (
            <div className="space-y-3">
              <div>
                <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Saúde</h3>
                <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Questionário de saúde — compartilhado entre todas as expedições da pessoa.</p>
              </div>
              <SaudeCampos valor={form.saude} onMudar={(s) => setForm((f) => ({ ...f, saude: s }))} expedicaoId={ancoraExp} passageiroId={ancoraPax} leitura={somenteLeitura} />
            </div>
          )}

          {aba === "expedicoes" && (
            <ListaExpedicoes pessoa={pessoa} abrirExp={abrirExp} />
          )}
        </div>
      </div>
    </Gaveta>
  );
}

export function ListaExpedicoes({ pessoa, abrirExp }: { pessoa: PessoaAgregada; abrirExp: (expedicaoId: string, passageiroId?: string) => void }) {
  if (pessoa.expedicoes.length === 0) return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Sem expedições.</p>;
  return (
    <ul className="space-y-1.5">
      {pessoa.expedicoes.map((e, i) => (
        <li key={`${e.expedicao_id}-${i}`}>
          <button onClick={() => abrirExp(e.expedicao_id, e.passageiro_id)} className="w-full flex items-center gap-2 rounded-lg border p-2.5 text-left rel-linha" style={{ borderColor: "var(--line)" }}>
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{e.nome}</span>
              <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{e.destino} · {formatDate(e.data_embarque)}{e.tipo !== "Pagante" && ` · ${e.tipo}`}</span>
            </span>
            <Selo tom={TOM_RESERVA[e.status_reserva] ?? "neutro"}>{e.status_reserva}</Selo>
          </button>
        </li>
      ))}
    </ul>
  );
}

function LinhaPerfil({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor || !String(valor).trim()) return null;
  return <div><span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{rotulo}</span><span className="font-semibold break-words" style={{ color: "var(--ink)" }}>{valor}</span></div>;
}

function PassaporteAnexo({ expedicaoId, passageiroId, arquivoId, onMudou }: { expedicaoId: string; passageiroId: string; arquivoId: string | null; onMudou: () => void }) {
  const { somenteLeitura, avisar } = useExp();
  const [indo, setIndo] = useState(false);
  const rodar = async (fn: () => Promise<void>, ok: string) => {
    setIndo(true);
    try { await fn(); avisar(ok); onMudou(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setIndo(false); }
  };
  return (
    <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
      <p className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Passaporte</p>
      {arquivoId ? (
        <div className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          <span className="flex-1 text-[13px] font-semibold" style={{ color: "#16A34A" }}>✓ Anexado</span>
          <button className="text-[12.5px] font-semibold hover:underline" style={{ color: "var(--rel-ink)" }} onClick={() => abrirArquivo(arquivoId).catch((e) => avisar(e.message, "erro"))}>Ver</button>
          {!somenteLeitura && <button disabled={indo} className="text-[12.5px] font-semibold hover:underline" style={{ color: "var(--err-ink)" }} onClick={() => rodar(() => removerPassaporte(passageiroId), "Passaporte removido")}>Remover</button>}
        </div>
      ) : somenteLeitura ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Sem anexo.</p> : (
        <label className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold cursor-pointer rel-linha" style={{ borderColor: "var(--line)", background: "var(--card)", opacity: indo ? 0.6 : 1 }}>
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={indo}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void rodar(() => anexarPassaporte(expedicaoId, passageiroId, f), "Passaporte anexado — vale para todas as expedições do passageiro"); }} />
          {indo ? "Enviando…" : "⬆ Anexar passaporte"}
        </label>
      )}
      <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Foto ou PDF. Fica disponível em todas as expedições do passageiro.</p>
    </div>
  );
}

/** Senha do ExpedAmigo da PESSOA (por CPF). Só aparece pra admin. */
export function SenhaExpedamigo({ cpf, recarga = 0 }: { cpf: string | null; recarga?: number }) {
  const { avisar } = useExp();
  const [estado, setEstado] = useState<EstadoSenha | null>(null);
  const [indo, setIndo] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (cpf) estadoSenhaCpf(cpf).then((s) => { if (vivo) setEstado(s); });
    return () => { vivo = false; };
  }, [cpf, recarga]);
  if (!cpf || !estado?.admin) return null;

  const nova = async () => {
    setIndo(true);
    try { const s = await gerarNovaSenhaCpf(cpf); setEstado({ admin: true, tem_hash: false, senha_provisoria: s }); avisar("Nova senha provisória gerada"); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao gerar senha", "erro"); }
    finally { setIndo(false); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(`Login: ${mascaraCpf(cpf)}\nSenha: ${estado.senha_provisoria}`); avisar("Login e senha copiados"); }
    catch { avisar("Não consegui copiar — selecione e copie à mão", "erro"); }
  };

  return (
    <section className="pt-4 border-t space-y-2" style={{ borderColor: "var(--line)" }}>
      <div>
        <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Acesso ao portal</h3>
        <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Senha do ExpedAmigo e da Área do Líder (por CPF). "Nova" gera uma senha provisória e faz a pessoa voltar ao 1º acesso.</p>
      </div>
      <div className="rounded-lg border p-2.5 text-[13px]" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
        {estado.tem_hash ? (
          <div className="space-y-1.5">
            <p style={{ color: "var(--ink2)" }}>O viajante já criou a própria senha.</p>
            <Botao onClick={nova} disabled={indo}>↻ Resetar senha</Botao>
            <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Gera uma nova senha provisória e faz a pessoa voltar ao 1º acesso.</p>
          </div>
        ) : estado.senha_provisoria ? (
          <>
            <div className="font-mono text-[13px] space-y-0.5" style={{ color: "var(--ink)" }}>
              <div>Login: <span className="tracking-wider">{mascaraCpf(cpf)}</span></div>
              <div>Senha: <span className="tracking-wider">{estado.senha_provisoria}</span></div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Botao onClick={copiar}>Copiar login e senha</Botao>
              <Botao variante="fantasma" onClick={nova} disabled={indo}>↻ Nova</Botao>
            </div>
          </>
        ) : <p style={{ color: "var(--ink2)" }}>Libere o ExpedAmigo na página do passageiro (dentro da expedição) para gerar a senha.</p>}
      </div>
    </section>
  );
}

