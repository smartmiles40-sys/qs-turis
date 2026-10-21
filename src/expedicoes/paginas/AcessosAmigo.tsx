// src/expedicoes/paginas/AcessosAmigo.tsx
// "Acessos ao ExpedAmigo" (app antigo: app/(app)/acessos-expedamigo + as ações de
// senha por CPF e o link de 1º acesso /a/<codigo> do onboarding diário).
// Aba 1 — registro de acessos (só leitura, como no antigo, sem o corte de 1000 nos nomes).
// Aba 2 — senha e link (só admin): senha provisória por CPF (forte) e link curto de
// 1º acesso + o texto de boas-vindas do WhatsApp pra COPIAR (nada é enviado daqui).
// acesso_senhas/acesso_links não têm policy: tudo passa pelas funções da 0164.
// O link aponta pro app ANTIGO (os portais ficaram lá) — ver PORTAL_ANTIGO_URL.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao, Vazio, Aviso } from "@/rel/ui";
import { useExp } from "../contexto";
import { Abas, Busca, Carregando, Cartao, Selo, type Tom } from "../ui";
import { supabase, lerTudo, listarExpedicoes } from "../lib/banco";
import { formatDate, formatDateTime } from "../lib/utils";
import { formatarCpf, soDigitosCpf } from "../lib/cpf";
import type { ExpedamigoAcessoRow, ExpedicaoRow } from "../lib/database";
import { PORTAL_ANTIGO_URL, copiar, rpc, useEhAdminExp } from "./_admin/comum";

const EVENTOS: { id: ExpedamigoAcessoRow["evento"]; rotulo: string; tom: Tom }[] = [
  { id: "primeiro_acesso", rotulo: "1º acesso", tom: "ok" },
  { id: "login", rotulo: "Login", tom: "lista" },
  { id: "viagem_aberta", rotulo: "Abriu viagem", tom: "aviso" },
  { id: "download_pdf", rotulo: "Baixou PDF", tom: "ok" },
  { id: "download_voucher", rotulo: "Baixou voucher", tom: "ok" },
];

type Pax = { id: string; cpf: string | null; nome_completo: string; expedicao_id: string | null; telefone: string | null; liberado_expedamigo: boolean; status_reserva: string; created_at: string };

/** Texto de boas-vindas do onboarding (verbatim do app antigo, lib/expedamigo/onboarding.ts). */
const MENSAGEM_ONBOARDING = `Oiii {nome}! Que alegria ter você na {rotulo_viagem} {expedição} 💚

Aqui é o time de Relacionamento da Se Tu For — a partir de agora somos nós que vamos cuidar de você em cada detalhe até o embarque (e durante a viagem também).

Já liberamos o seu acesso ao *Portal do Viajante* 🎉 É nele que você acompanha tudo da sua viagem em um só lugar: o *roteiro dia a dia*, seus *voos*, a *hospedagem*, vouchers, informações do destino e avisos importantes.

👉 {link}

É só clicar no link pra criar sua senha e entrar.

📝 Importante: ao abrir o *roteiro dia a dia* no portal, vai aparecer um *formulário de inscrição* pra você preencher — é onde a gente te conhece melhor e já organiza sua documentação com antecedência, pra tudo fluir tranquilo lá na frente.

E o próximo passo é um *encontro rápido de boas-vindas*: online, leve, uns 20 minutinhos. Ali o nosso time se apresenta, te conta como funciona o acompanhamento daqui pra frente e alinha os próximos passos da sua {termo_viagem}.

Conta pra gente: qual o melhor dia e horário pra você nos próximos 7 dias, de segunda a sexta? 💚`;

function montarMensagem(nome: string, exp: ExpedicaoRow | undefined, link: string): string {
  const pacote = exp?.tipo === "pacote";
  const primeiro = (nome || "").trim().split(/\s+/)[0] || nome;
  return MENSAGEM_ONBOARDING
    .replaceAll("{nome}", primeiro)
    .replaceAll("{rotulo_viagem}", pacote ? "sua viagem" : "Expedição")
    .replaceAll("{termo_viagem}", pacote ? "viagem" : "expedição")
    .replaceAll("{expedição}", exp?.nome ?? "")
    .replaceAll("{expedicao}", exp?.nome ?? "")
    .replaceAll("{link}", link);
}

export default function AcessosAmigo() {
  const ehAdmin = useEhAdminExp();
  const [aba, setAba] = useState<"registro" | "senha">("registro");
  const [acessos, setAcessos] = useState<ExpedamigoAcessoRow[] | null>(null);
  const [pax, setPax] = useState<Pax[]>([]);
  const [exps, setExps] = useState<Map<string, ExpedicaoRow>>(new Map());
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [ac, ps, ex] = await Promise.all([
        supabase.from("expedamigo_acessos").select("*").order("created_at", { ascending: false }).limit(1000),
        lerTudo<Pax>("passageiros", (q) => q.not("cpf", "is", null), "id,cpf,nome_completo,expedicao_id,telefone,liberado_expedamigo,status_reserva,created_at"),
        listarExpedicoes(),
      ]);
      if (ac.error) throw new Error(ac.error.message);
      setAcessos((ac.data ?? []) as ExpedamigoAcessoRow[]);
      setPax(ps);
      setExps(new Map(ex.map((e) => [e.id, e])));
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!acessos) return <Carregando />;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Acessos ao ExpedAmigo</h1>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>
          Registro de quem criou o acesso (1º acesso pelo link), entrou no portal, abriu uma viagem e baixou arquivos. Só CPF, evento e data/hora (sem IP/dispositivo).
        </p>
      </header>
      <Abas abas={[{ id: "registro", rotulo: "Registro de acessos" }, { id: "senha", rotulo: "Senha e link de 1º acesso" }]} ativa={aba} onTrocar={setAba} />
      {aba === "registro" ? <Registro acessos={acessos} pax={pax} exps={exps} />
        : ehAdmin === null ? <Carregando />
        : ehAdmin ? <SenhaELink pax={pax} exps={exps} onMudou={carregar} />
        : <Aviso>Só admins das Expedições geram senha e link do ExpedAmigo (igual ao sistema antigo).</Aviso>}
    </div>
  );
}

function Registro({ acessos, pax, exps }: { acessos: ExpedamigoAcessoRow[]; pax: Pax[]; exps: Map<string, ExpedicaoRow> }) {
  const [busca, setBusca] = useState("");
  const [evento, setEvento] = useState<string | null>(null);
  const nomePorCpf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of [...pax].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const c = soDigitosCpf(p.cpf);
      if (c && !m.has(c)) m.set(c, p.nome_completo);
    }
    return m;
  }, [pax]);
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of acessos) c[a.evento] = (c[a.evento] ?? 0) + 1;
    return c;
  }, [acessos]);
  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return acessos.filter((a) => {
      if (evento && a.evento !== evento) return false;
      if (!q) return true;
      const nome = nomePorCpf.get(soDigitosCpf(a.cpf)) ?? "";
      const exp = a.expedicao_id ? exps.get(a.expedicao_id)?.nome ?? "" : "";
      return `${nome} ${a.cpf} ${formatarCpf(a.cpf)} ${exp}`.toLowerCase().includes(q);
    });
  }, [acessos, busca, evento, nomePorCpf, exps]);

  if (acessos.length === 0) return <Vazio titulo="Nenhum acesso registrado ainda" />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Selo tom="neutro">Total: {acessos.length}</Selo>
        {EVENTOS.map((e) => <Selo key={e.id} tom={e.tom}>{e.rotulo}: {contagem[e.id] ?? 0}</Selo>)}
      </div>
      <Busca valor={busca} onMudar={setBusca} placeholder="Buscar por nome, CPF ou expedição…" />
      <div className="flex flex-wrap gap-1.5">
        {[{ id: null as string | null, rotulo: "Todos" }, ...EVENTOS].map((e) => (
          <button key={e.id ?? "todos"} type="button" onClick={() => setEvento(e.id)}
            className="px-2.5 py-1 rounded-full text-[12px] font-semibold border"
            style={evento === e.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "transparent" } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
            {e.rotulo}
          </button>
        ))}
      </div>
      {linhas.length === 0 ? <p className="text-[13px] py-6 text-center" style={{ color: "var(--ink3)" }}>Nenhum acesso no filtro atual.</p> : (
        <div className="rel-card overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left" style={{ color: "var(--ink3)" }}>
              {["Data / hora", "Pessoa", "Evento", "Expedição"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {linhas.map((a) => {
                const ev = EVENTOS.find((e) => e.id === a.evento);
                return (
                  <tr key={a.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(a.created_at)}</td>
                    <td className="px-3 py-1.5">
                      <div style={{ color: "var(--ink)" }}>{nomePorCpf.get(soDigitosCpf(a.cpf)) ?? "—"}</div>
                      <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{formatarCpf(a.cpf)}</div>
                    </td>
                    <td className="px-3 py-1.5"><Selo tom={ev?.tom ?? "neutro"}>{ev?.rotulo ?? a.evento}</Selo></td>
                    <td className="px-3 py-1.5">{a.expedicao_id ? exps.get(a.expedicao_id)?.nome ?? "—" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Estado = { cpf: string; tem_senha: boolean; senha_provisoria: string | null; atualizado_em: string };

function SenhaELink({ pax, exps, onMudou }: { pax: Pax[]; exps: Map<string, ExpedicaoRow>; onMudou: () => void }) {
  const { avisar } = useExp();
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Pax | null>(null);
  const [estado, setEstado] = useState<Estado | null | undefined>(undefined);
  const [link, setLink] = useState<{ url: string; expira: string } | null>(null);
  const [indo, setIndo] = useState<string | null>(null);
  const [confirmarSenha, setConfirmarSenha] = useState(false);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = soDigitosCpf(q);
    if (q.length < 2) return [];
    return pax.filter((p) => p.expedicao_id && (p.nome_completo.toLowerCase().includes(q) || (qd.length >= 3 && soDigitosCpf(p.cpf).includes(qd))))
      .sort((a, b) => (exps.get(b.expedicao_id!)?.data_embarque ?? "").localeCompare(exps.get(a.expedicao_id!)?.data_embarque ?? ""))
      .slice(0, 30);
  }, [busca, pax, exps]);

  const lerEstado = useCallback(async (p: Pax) => {
    setEstado(undefined);
    try {
      const r = await rpc<Estado[]>("exp_amigo_estado", { p_cpfs: [soDigitosCpf(p.cpf)] });
      setEstado(r?.[0] ?? null);
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); setEstado(null); }
  }, [avisar]);

  function escolher(p: Pax) { setSel(p); setLink(null); setConfirmarSenha(false); void lerEstado(p); }

  const cpf = sel ? soDigitosCpf(sel.cpf) : "";
  const exp = sel?.expedicao_id ? exps.get(sel.expedicao_id) : undefined;

  async function novaSenha() {
    if (!sel) return;
    setIndo("senha");
    try {
      await rpc<string>("exp_amigo_nova_senha", { p_cpf: cpf });
      setConfirmarSenha(false);
      avisar("Senha provisória nova gerada");
      await lerEstado(sel);
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível gerar", "erro"); }
    finally { setIndo(null); }
  }

  async function gerarLink() {
    if (!sel) return;
    setIndo("link");
    try {
      const r = await rpc<{ codigo: string; expira_em: string }>("exp_amigo_gerar_link", { p_passageiro_id: sel.id, p_liberar: true });
      setLink({ url: `${PORTAL_ANTIGO_URL}/a/${r.codigo}`, expira: r.expira_em });
      if (!sel.liberado_expedamigo) { setSel({ ...sel, liberado_expedamigo: true }); onMudou(); }
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível gerar o link", "erro"); }
    finally { setIndo(null); }
  }

  const copiarAviso = async (t: string, ok: string) => avisar((await copiar(t)) ? ok : "Não consegui copiar", "ok");

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Cartao titulo="Escolha o passageiro">
        <Busca valor={busca} onMudar={setBusca} placeholder="Nome ou CPF…" />
        <div className="mt-3 space-y-1 max-h-[60vh] overflow-y-auto">
          {busca.trim().length < 2 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Digite ao menos 2 letras.</p>}
          {busca.trim().length >= 2 && resultados.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Ninguém encontrado.</p>}
          {resultados.map((p) => {
            const e = exps.get(p.expedicao_id!);
            return (
              <button key={p.id} type="button" onClick={() => escolher(p)} className="w-full text-left px-2.5 py-2 rounded-lg rel-linha"
                style={sel?.id === p.id ? { background: "var(--rel-soft)" } : undefined}>
                <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{p.nome_completo}</div>
                <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  {formatarCpf(p.cpf)} · {e?.nome ?? "—"}{e?.data_embarque ? ` · ${formatDate(e.data_embarque)}` : ""} · {p.status_reserva}
                </div>
              </button>
            );
          })}
        </div>
      </Cartao>

      {!sel ? <Cartao><p className="text-[13px] py-8 text-center" style={{ color: "var(--ink3)" }}>Escolha um passageiro à esquerda.</p></Cartao> : (
        <div className="space-y-4">
          <Cartao titulo={sel.nome_completo}>
            <div className="text-[12.5px] space-y-1" style={{ color: "var(--ink2)" }}>
              <div>CPF (login): <strong>{formatarCpf(sel.cpf)}</strong></div>
              <div>Viagem: {exp?.nome ?? "—"} · {sel.status_reserva}</div>
              <div>Portal nesta viagem: {sel.liberado_expedamigo ? <Selo tom="ok">Liberado</Selo> : <Selo tom="aviso">Não liberado</Selo>}</div>
            </div>
          </Cartao>

          <Cartao titulo="Senha do portal (vale pra todas as viagens da pessoa)">
            {cpf.length !== 11 ? <Aviso>Passageiro sem CPF válido — não dá pra ter senha.</Aviso>
              : estado === undefined ? <Carregando />
              : (
                <div className="space-y-3 text-[13px]">
                  {estado?.tem_senha ? <p style={{ color: "var(--ink2)" }}>A pessoa <strong>já criou a própria senha</strong> (não dá pra ver). Se ela esqueceu, gere uma provisória nova.</p>
                    : estado?.senha_provisoria ? (
                      <div className="space-y-2">
                        <p style={{ color: "var(--ink2)" }}>Senha provisória (a pessoa ainda não trocou):</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="px-2.5 py-1.5 rounded-md text-[14px] font-bold" style={{ background: "var(--card2)", color: "var(--ink)" }}>{estado.senha_provisoria}</code>
                          <Botao onClick={() => copiarAviso(`Login: ${cpf}\nSenha: ${estado.senha_provisoria}`, "Login e senha copiados")}>Copiar login e senha</Botao>
                        </div>
                      </div>
                    ) : <p style={{ color: "var(--ink2)" }}>Ainda <strong>sem senha</strong>. Pode gerar uma provisória ou mandar o link de 1º acesso (aí a pessoa cria a dela).</p>}
                  {!confirmarSenha ? <Botao onClick={() => setConfirmarSenha(true)}>{estado?.tem_senha || estado?.senha_provisoria ? "Gerar senha provisória nova" : "Gerar senha provisória"}</Botao> : (
                    <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
                      <p>A senha atual deixa de valer e a pessoa volta ao 1º acesso (troca no próximo login). Confirma?</p>
                      <div className="flex gap-2">
                        <Botao onClick={() => setConfirmarSenha(false)}>Cancelar</Botao>
                        <Botao variante="primario" disabled={indo === "senha"} onClick={novaSenha}>{indo === "senha" ? "Gerando…" : "Gerar"}</Botao>
                      </div>
                    </div>
                  )}
                </div>
              )}
          </Cartao>

          <Cartao titulo="Link de 1º acesso + mensagem de boas-vindas">
            <div className="space-y-3 text-[13px]">
              <p style={{ color: "var(--ink2)" }}>
                Gera o link curto (vale 30 dias; se já houver um válido, reaproveita) e <strong>libera o portal desta viagem</strong>.
                Nada é enviado daqui — copie e mande pelo WhatsApp.
              </p>
              {!link ? <Botao variante="primario" disabled={indo === "link"} onClick={gerarLink}>{indo === "link" ? "Gerando…" : "Gerar link de 1º acesso"}</Botao> : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="px-2.5 py-1.5 rounded-md text-[13px] break-all" style={{ background: "var(--card2)", color: "var(--ink)" }}>{link.url}</code>
                    <Botao onClick={() => copiarAviso(link.url, "Link copiado")}>Copiar link</Botao>
                  </div>
                  <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Vale até {formatDateTime(link.expira)}.</p>
                  <textarea className="rel-input text-[12.5px]" rows={12} readOnly value={montarMensagem(sel.nome_completo, exp, link.url)} />
                  <div className="flex flex-wrap gap-2">
                    <Botao variante="primario" onClick={() => copiarAviso(montarMensagem(sel.nome_completo, exp, link.url), "Mensagem copiada")}>Copiar mensagem</Botao>
                    {sel.telefone && <span className="text-[12px] self-center" style={{ color: "var(--ink3)" }}>Telefone no cadastro: {sel.telefone}</span>}
                  </div>
                </>
              )}
            </div>
          </Cartao>
        </div>
      )}
    </div>
  );
}
