// src/clientes/ExpedAmigoDoCliente.tsx
// Aba "ExpedAmigo" da ficha (23/10 — cadastro único): o portal do viajante da
// pessoa num lugar só. Antes ficava espalhado em "Acessos ExpedAmigo" (senha, link,
// registro) e no passageiro de cada expedição (liberar/bloquear).
//   · Login = CPF da ficha; a senha vale pra todas as viagens (acesso_senhas).
//   · Liberar/bloquear é por viagem (passageiros.liberado_expedamigo).
//   · 05/11 (porte do f6326c6/e3816fa do antigo): 1º acesso e reset por LINK MÁGICO
//     gerado no servidor (api/_expAcesso.js) — a senha provisória aleatória foi
//     aposentada. Reset = só admin; gerar link/WhatsApp = admin ou quem decide inscrição.
//     Modo validação (espelho ligado): gerar/resetar desligados.
//   · Registro: os últimos acessos ao portal (expedamigo_acessos, por CPF).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Aviso, Botao, Etiqueta } from "@/rel/ui";
import type { IdaEmExpedicao } from "./cadastroUnico";
import { copiar, rpc, useEhAdminExp } from "@/expedicoes/paginas/_admin/comum";
import { montarMensagem } from "@/expedicoes/paginas/AcessosAmigo";
import { formatDate, formatDateTime } from "@/expedicoes/lib/utils";
import { pedirLinkAmigo, useModoValidacaoAmigo } from "@/expedicoes/expedamigo/servidor";
import BotaoWhatsAppAcesso from "@/expedicoes/expedamigo/BotaoWhatsAppAcesso";
import AvisoModoValidacao from "@/expedicoes/expedamigo/AvisoModoValidacao";

const EVENTO: Record<string, string> = {
  primeiro_acesso: "1º acesso", login: "Entrou no portal", viagem_aberta: "Abriu a viagem",
  download_pdf: "Baixou o PDF", download_voucher: "Baixou voucher",
};
type Estado = { cpf: string; tem_senha: boolean; senha_provisoria: string | null; atualizado_em: string };
type Acesso = { id: string; evento: string; expedicao_id: string | null; created_at: string };

const fmtCpf = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export default function ExpedAmigoDoCliente({ nome, cpf, idas, telefone, onMudou }: {
  nome: string; cpf: string | null; idas: IdaEmExpedicao[]; telefone: string | null; onMudou: () => void;
}) {
  const admin = useEhAdminExp();
  const validacao = useModoValidacaoAmigo();
  const travado = validacao !== false;
  const digitos = (cpf ?? "").replace(/\D/g, "");
  const cpfOk = digitos.length === 11;
  const [estado, setEstado] = useState<Estado | null | undefined>(undefined);
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [indo, setIndo] = useState<string | null>(null);
  const [link, setLink] = useState<{ idaId: string; url: string; expira: string; viagem?: { nome: string; tipo?: string | null } | null } | null>(null);
  const [liberado, setLiberado] = useState<Record<string, boolean>>({});

  useEffect(() => { setLiberado(Object.fromEntries(idas.map((i) => [i.id, Boolean(i.liberado_expedamigo)]))); }, [idas]);

  const lerEstado = useCallback(async () => {
    if (!cpfOk || !admin) { setEstado(null); return; }
    try { setEstado((await rpc<Estado[]>("exp_amigo_estado", { p_cpfs: [digitos] }))?.[0] ?? null); }
    catch { setEstado(null); }
  }, [cpfOk, admin, digitos]);
  useEffect(() => { if (admin !== null) void lerEstado(); }, [admin, lerEstado]);

  useEffect(() => {
    if (!cpfOk) { setAcessos([]); return; }
    supabase.from("expedamigo_acessos").select("id,evento,expedicao_id,created_at")
      .in("cpf", [digitos, fmtCpf(digitos)]).order("created_at", { ascending: false }).limit(40)
      .then(({ data }) => setAcessos((data ?? []) as Acesso[]));
  }, [cpfOk, digitos]);

  const ativas = idas.filter((i) => i.status_reserva !== "Cancelado");
  const nomeExp = (id: string | null) => idas.find((i) => i.expedicao_id === id)?.expedicao?.nome ?? "—";

  async function alternar(ida: IdaEmExpedicao) {
    const v = !liberado[ida.id];
    setIndo(`lib-${ida.id}`); setMsg(null);
    const { error } = await supabase.from("passageiros").update({ liberado_expedamigo: v }).eq("id", ida.id).select("id").single();
    setIndo(null);
    if (error) { setMsg({ tom: "erro", texto: `Não consegui ${v ? "liberar" : "bloquear"}: só Operações e admin mudam isso.` }); return; }
    setLiberado((l) => ({ ...l, [ida.id]: v }));
    // 05/11: liberar não gera mais senha provisória — o acesso vai pelo link mágico (botões abaixo).
    onMudou();
  }

  /** Reset (admin): a senha atual cai na hora e sai um link novo da reserva mais recente do CPF. */
  async function resetar() {
    if (!window.confirm("A senha atual deixa de valer AGORA e a pessoa só volta a entrar criando outra pelo link novo. Resetar?")) return;
    setIndo("senha"); setMsg(null);
    try {
      const r = await pedirLinkAmigo({ cpf: digitos }, { resetar: true });
      setLink({ idaId: r.passageiro.id, url: r.link, expira: r.expira_em, viagem: r.expedicao });
      await lerEstado();
      setMsg({ tom: "ok", texto: "Acesso resetado — mande o link novo (abaixo)." });
    } catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não consegui resetar." }); }
    finally { setIndo(null); }
  }

  async function gerarLink(ida: IdaEmExpedicao) {
    setIndo(`link-${ida.id}`); setMsg(null);
    try {
      const r = await pedirLinkAmigo({ passageiroId: ida.id });
      setLink({ idaId: ida.id, url: r.link, expira: r.expira_em });
      setLiberado((l) => ({ ...l, [ida.id]: true }));
    } catch (e) { setMsg({ tom: "erro", texto: e instanceof Error ? e.message : "Não consegui gerar o link." }); }
    finally { setIndo(null); }
  }

  const copiarAviso = async (t: string, ok: string) => setMsg((await copiar(t)) ? { tom: "ok", texto: ok } : { tom: "erro", texto: "Não consegui copiar." });
  const idaDoLink = link ? idas.find((i) => i.id === link.idaId) : undefined;

  return (
    <div className="space-y-4">
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}

      <section className="rel-card p-4 sm:p-5 space-y-3">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>Acesso ao portal</h2>
        {!cpfOk ? <Aviso>Sem CPF válido na ficha — o login do ExpedAmigo é o CPF. Complete o cadastro.</Aviso> : (
          <div className="text-[13.5px] space-y-2" style={{ color: "var(--ink)" }}>
            <div>Login: <b>{fmtCpf(digitos)}</b> <span style={{ color: "var(--ink3)" }}>· a senha vale pra todas as viagens</span></div>
            {admin === false ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>A senha só aparece pra admin das Expedições.</p>
              : estado === undefined ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Lendo a senha…</p>
              : (
                <div className="flex flex-wrap items-center gap-2">
                  {estado?.tem_senha ? <span>A pessoa <b>já criou a própria senha</b>.</span>
                    : estado?.senha_provisoria ? (
                      <>
                        <span>Senha provisória antiga:</span>
                        <code className="px-2 py-1 rounded-md font-bold" style={{ background: "var(--card2)" }}>{estado.senha_provisoria}</code>
                        <Botao onClick={() => copiarAviso(`Login: ${digitos}\nSenha: ${estado.senha_provisoria}`, "Login e senha copiados.")}>Copiar login e senha</Botao>
                      </>
                    ) : <span>Ainda <b>sem senha</b> — mande o link de acesso de uma viagem abaixo.</span>}
                  {(estado?.tem_senha || estado?.senha_provisoria) && (
                    <Botao variante="fantasma" disabled={indo === "senha" || travado} style={{ color: "var(--rel-ink)" }}
                      title={travado ? "Modo validação: reset só pelo sistema antigo" : "Derruba a senha atual e gera um link novo"}
                      onClick={() => void resetar()}>
                      {indo === "senha" ? "Resetando…" : "Resetar acesso (link novo)"}
                    </Botao>
                  )}
                </div>
              )}
          </div>
        )}
        <AvisoModoValidacao />
      </section>

      <section className="rel-card p-4 sm:p-5">
        <h2 className="text-[13px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>Viagens no portal</h2>
        {ativas.length === 0 ? <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhuma expedição ou pacote ativo ligado a esta ficha.</p> : (
          <ol className="divide-y" style={{ borderColor: "var(--line)" }}>
            {ativas.map((i) => (
              <li key={i.id} className="py-2.5 flex flex-wrap items-center gap-2">
                <span className="flex-1 min-w-[180px] text-[13.5px]" style={{ color: "var(--ink)" }}>
                  {i.expedicao?.nome ?? "Viagem"}
                  <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>
                    {i.expedicao?.data_embarque ? `embarque ${formatDate(i.expedicao.data_embarque)} · ` : ""}{i.status_reserva}
                  </span>
                </span>
                <Etiqueta tom={liberado[i.id] ? "rel" : "aviso"}>{liberado[i.id] ? "Liberado" : "Não liberado"}</Etiqueta>
                <Botao disabled={indo === `lib-${i.id}`} onClick={() => void alternar(i)}>{liberado[i.id] ? "Bloquear" : "Liberar"}</Botao>
                {admin && cpfOk && <Botao disabled={indo === `link-${i.id}` || travado} title={travado ? "Modo validação: link só pelo sistema antigo" : undefined}
                  onClick={() => void gerarLink(i)}>{indo === `link-${i.id}` ? "Gerando…" : "Link de acesso"}</Botao>}
                {cpfOk && <BotaoWhatsAppAcesso key={`${i.id}-${link?.idaId === i.id ? link.url : ""}`} passageiroId={i.id} nome={nome} telefone={telefone}
                  viagem={i.expedicao ?? undefined} linkExistente={link?.idaId === i.id ? link.url : null}
                  onGerado={(r) => { setLink({ idaId: i.id, url: r.link, expira: r.expira_em }); setLiberado((l) => ({ ...l, [i.id]: true })); }}
                  onAviso={(texto, tom) => setMsg({ tom, texto })} />}
              </li>
            ))}
          </ol>
        )}
        {link && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="px-2 py-1 rounded-md text-[12.5px] break-all" style={{ background: "var(--card2)" }}>{link.url}</code>
              <Botao onClick={() => copiarAviso(link.url, "Link copiado.")}>Copiar link</Botao>
              <Botao variante="primario" onClick={() => copiarAviso(montarMensagem(nome, link.viagem ?? idaDoLink?.expedicao ?? undefined, link.url), "Mensagem de boas-vindas copiada.")}>Copiar mensagem de boas-vindas</Botao>
            </div>
            <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
              Vale até {formatDateTime(link.expira)}. Nada é enviado daqui — mande pelo WhatsApp{telefone ? ` (${telefone})` : ""}.
            </p>
          </div>
        )}
      </section>

      <section className="rel-card p-4 sm:p-5">
        <h2 className="text-[13px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>Últimos acessos</h2>
        {acessos === null ? <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Carregando…</p>
          : acessos.length === 0 ? <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nunca entrou no portal.</p>
          : (
            <ol className="space-y-1 py-1">
              {acessos.map((a) => (
                <li key={a.id} className="text-[13px]" style={{ color: "var(--ink)" }}>
                  <b>{EVENTO[a.evento] ?? a.evento}</b>
                  <span style={{ color: "var(--ink3)" }}> · {formatDateTime(a.created_at)}{a.expedicao_id ? ` · ${nomeExp(a.expedicao_id)}` : ""}</span>
                </li>
              ))}
            </ol>
          )}
      </section>
    </div>
  );
}
