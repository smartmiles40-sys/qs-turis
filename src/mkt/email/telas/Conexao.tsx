// Marketing › E-mail › Conexão (Resend). Não é mais tela do menu: é o selo no
// canto da página E-mail ("E-mail conectado ●" / "Conectar e-mail") que abre este
// painel num Modal, em 4 passos com ✓. A chave vai pro Vault e nunca volta pra tela.
// Quando falta conectar, as abas mostram <ComoConectar/> (passo a passo) em vez de erro.
import { useEffect, useState, type ReactNode } from "react";
import { chamar, dataHora, type RegistroDns } from "../lib/api";
import { useEmail } from "../contexto";
import { Aviso, Bolinha, Botao, Campo, Entrada, Etiqueta } from "../ui";

/** O selo do canto (vai no `acoes` do PaginaComAbas). */
export function SeloConexao() {
  const { carregando, conectado, pronto, cfg, abrirConexao } = useEmail();
  if (carregando) return <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Conferindo o e-mail…</span>;
  if (!conectado) return <Botao variante="primario" onClick={abrirConexao}>Conectar e-mail</Botao>;
  const falta = cfg?.faltando.length ?? 0;
  return (
    <button type="button" onClick={abrirConexao} title="Configuração do e-mail"
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold"
      style={pronto
        ? { background: "var(--rel-soft)", color: "var(--rel-ink)", border: "1px solid transparent" }
        : { background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-line)" }}>
      {pronto ? "E-mail conectado" : `E-mail: ${falta} ${falta === 1 ? "passo falta" : "passos faltam"}`}
      <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: pronto ? "var(--green)" : "var(--amber)" }} />
    </button>
  );
}

/** Estado vazio amigável: o que fazer pra ligar o e-mail (no lugar de um erro). */
export function ComoConectar({ compacto }: { compacto?: boolean }) {
  const { podeConectar, abrirConexao, falhou } = useEmail();
  const passos = [
    ["Crie a chave no Resend", "resend.com › API Keys › Create (acesso total). Cole aqui no QS — ela fica guardada no cofre."],
    ["Diga o domínio de envio", "Um subdomínio só pro marketing (ex.: mail.setuforeuvouviagens.com.br) e publique os registros DNS que aparecerem."],
    ["Ligue o retorno dos e-mails", "Um clique cria o webhook: entregue, bounce e spam voltam pro QS sozinhos."],
    ["Confira remetente e rodapé", "Nome, e-mail de envio, CNPJ e endereço. O link de descadastro entra sempre."],
  ];
  return (
    <div className="rel-card p-5 mb-4" style={{ borderColor: "var(--rel)", background: "var(--rel-soft)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Falta conectar o e-mail</p>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--ink2)" }}>
            Enquanto isso você já pode montar modelos e rascunhos; o envio libera quando a conexão ficar pronta.
            {falhou ? ` (Não consegui conferir agora: ${falhou})` : ""}
          </p>
        </div>
        {podeConectar
          ? <Botao variante="primario" onClick={abrirConexao}>Conectar agora</Botao>
          : <span className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }}>Peça pro admin ou pra alguém do Marketing conectar.</span>}
      </div>
      {!compacto ? (
        <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {passos.map(([t, d], i) => (
            <li key={t} className="rounded-xl p-3 flex gap-2.5" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>
              <Bolinha n={i + 1} />
              <span>
                <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{t}</span>
                <span className="block text-[12px] mt-0.5 leading-snug" style={{ color: "var(--ink3)" }}>{d}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Passo({ n, feito, titulo, children, aberto: abertoInicial }: { n: number; feito: boolean; titulo: string; children: ReactNode; aberto: boolean }) {
  const [aberto, setAberto] = useState(abertoInicial);
  return (
    <section className="rel-card">
      <button type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto} className="w-full flex items-center gap-3 p-3.5 text-left">
        <Bolinha n={n} feito={feito} ativo={!feito} />
        <span className="flex-1 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{titulo}</span>
        {feito ? <Etiqueta tom="ok">pronto</Etiqueta> : <Etiqueta tom="aviso">falta</Etiqueta>}
        <span aria-hidden style={{ color: "var(--ink3)" }}>{aberto ? "▴" : "▾"}</span>
      </button>
      {aberto ? <div className="px-4 pb-4 space-y-3">{children}</div> : null}
    </section>
  );
}

/** O conteúdo do Modal de conexão. */
export function PainelConexao() {
  const { cfg: s, recarregar, podeConectar } = useEmail();
  const [msg, setMsg] = useState<{ tom: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [chave, setChave] = useState("");
  const [dominio, setDominio] = useState("");
  const [whsec, setWhsec] = useState("");
  const [rem, setRem] = useState({ remetente_nome: "", remetente_email: "", responder_para: "", rodape_texto: "", rodape_endereco: "", por_segundo: "4" });

  useEffect(() => {
    if (!s) return;
    setDominio(s.config.dominio ?? "");
    setRem({
      remetente_nome: s.config.remetente_nome ?? "", remetente_email: s.config.remetente_email ?? "",
      responder_para: s.config.responder_para ?? "", rodape_texto: s.config.rodape_texto ?? "",
      rodape_endereco: s.config.rodape_endereco ?? "", por_segundo: String(s.config.por_segundo ?? 4),
    });
  }, [s]);

  const agir = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await chamar(corpo); setMsg({ tom: "ok", texto: ok }); await recarregar(); return true; }
    catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); return false; }
    finally { setOcupado(false); }
  };

  const registros: RegistroDns[] = s?.config.dominio_registros ?? [];
  const verificado = s?.config.dominio_status === "verified";
  const remetenteOk = Boolean(s?.config.remetente_email);
  const travado = !podeConectar;

  return (
    <div className="space-y-3">
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      {s && s.faltando.length ? <Aviso>Falta: {s.faltando.join(" · ")}</Aviso> : s ? <Aviso tom="ok">Tudo pronto para enviar.</Aviso> : null}
      {travado ? <Aviso>Só admin ou alguém com o papel Marketing mexe na conexão. Aqui você vê como está.</Aviso> : null}

      <fieldset disabled={travado || ocupado} className="space-y-3">
        <Passo n={1} feito={Boolean(s?.conectado)} titulo="Chave do Resend" aberto={!s?.conectado}>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>No Resend: API Keys → Create → <b>Full access</b>. A chave fica guardada criptografada no cofre (Vault) e não aparece de novo aqui.</p>
          <Campo rotulo="Chave (re_…)"><Entrada type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} /></Campo>
          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" disabled={!chave} onClick={() => void agir({ acao: "conectar", chave }, "Chave conferida no Resend e guardada.").then((ok) => ok && setChave(""))}>Conferir e guardar</Botao>
            {s?.conectado ? <Botao variante="perigo" onClick={() => window.confirm("Desconectar? A fila para até conectar de novo.") && void agir({ acao: "desconectar" }, "Desconectado.")}>Desconectar</Botao> : null}
          </div>
        </Passo>

        <Passo n={2} feito={verificado} titulo={`Domínio de envio${s?.config.dominio ? ` · ${s.config.dominio}` : ""}`} aberto={Boolean(s?.conectado) && !verificado}>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Use um subdomínio só para marketing (ex.: <code>mail.setuforeuvouviagens.com.br</code>) — protege a reputação do e-mail do dia a dia.</p>
          <Campo rotulo="Domínio"><Entrada value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="mail.setuforeuvouviagens.com.br" /></Campo>
          <div className="flex flex-wrap gap-2">
            <Botao disabled={!dominio || !s?.conectado} onClick={() => void agir({ acao: "dominio", nome: dominio }, "Domínio registrado. Publique os registros abaixo no DNS.")}>Usar este domínio</Botao>
            <Botao disabled={!s?.config.dominio_id} onClick={() => void agir({ acao: "verificar_dominio" }, "Pedi ao Resend para conferir o DNS.")}>Conferir DNS agora</Botao>
          </div>
          {registros.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left" style={{ color: "var(--ink3)" }}><th className="p-2">Tipo</th><th className="p-2">Nome</th><th className="p-2">Valor</th><th className="p-2">Prior.</th><th className="p-2">Situação</th></tr></thead>
                <tbody>{registros.map((r, i) => (
                  <tr key={i} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                    <td className="p-2 font-mono">{r.type}</td><td className="p-2 font-mono break-all">{r.name}</td>
                    <td className="p-2 font-mono break-all">{r.value}</td><td className="p-2">{r.priority ?? "—"}</td>
                    <td className="p-2"><Etiqueta tom={r.status === "verified" ? "ok" : "aviso"}>{r.status === "verified" ? "ok" : r.status ?? "—"}</Etiqueta></td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="text-[11px] mt-2" style={{ color: "var(--ink3)" }}>Recomendado também um DMARC: TXT <code>_dmarc</code> = <code>v=DMARC1; p=none; rua=mailto:…</code> (ver docs/MARKETING-EMAIL.md).</p>
            </div>
          ) : null}
        </Passo>

        <Passo n={3} feito={Boolean(s?.webhook)} titulo="Retorno dos e-mails (webhook)" aberto={Boolean(s?.conectado) && !s?.webhook}>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Traz entregue, bounce e denúncia de spam — quem dá bounce ou marca spam sai das próximas listas sozinho. Endereço: <code className="break-all">{s?.urlWebhook ?? "defina QS_URL_PUBLICA"}</code></p>
          <Botao variante="primario" disabled={!s?.conectado || !s?.url} onClick={() => void agir({ acao: "criar_webhook" }, "Webhook criado e segredo guardado.")}>Criar webhook no Resend</Botao>
          <Campo rotulo="…ou cole o Signing secret (whsec_…)"><Entrada type="password" autoComplete="off" value={whsec} onChange={(e) => setWhsec(e.target.value)} /></Campo>
          <Botao disabled={!whsec} onClick={() => void agir({ acao: "segredo_webhook", segredo: whsec }, "Segredo guardado.").then((ok) => ok && setWhsec(""))}>Guardar segredo</Botao>
        </Passo>

        <Passo n={4} feito={remetenteOk} titulo="Remetente e rodapé" aberto={Boolean(s?.conectado) && !remetenteOk}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo rotulo="Nome que aparece"><Entrada value={rem.remetente_nome} onChange={(e) => setRem({ ...rem, remetente_nome: e.target.value })} /></Campo>
            <Campo rotulo="E-mail de envio" dica={s?.config.dominio ? `Precisa ser @${s.config.dominio}` : undefined}><Entrada type="email" value={rem.remetente_email} onChange={(e) => setRem({ ...rem, remetente_email: e.target.value })} /></Campo>
            <Campo rotulo="Responder para"><Entrada type="email" value={rem.responder_para} onChange={(e) => setRem({ ...rem, responder_para: e.target.value })} /></Campo>
            <Campo rotulo="Ritmo (e-mails por segundo)" dica="Plano grátis do Resend: 2/s. Pago: confira o seu."><Entrada type="number" min={1} max={50} value={rem.por_segundo} onChange={(e) => setRem({ ...rem, por_segundo: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Frase do rodapé"><Entrada value={rem.rodape_texto} onChange={(e) => setRem({ ...rem, rodape_texto: e.target.value })} /></Campo>
          <Campo rotulo="Dados da empresa (CNPJ e endereço)" dica="Vão no rodapé de todo e-mail, junto do link de descadastro (obrigatório)."><Entrada value={rem.rodape_endereco} onChange={(e) => setRem({ ...rem, rodape_endereco: e.target.value })} /></Campo>
          <Botao variante="primario" onClick={() => void agir({ acao: "salvar_config", config: { ...rem, por_segundo: Number(rem.por_segundo) } }, "Remetente salvo.")}>Salvar remetente</Botao>
        </Passo>
      </fieldset>

      <details className="text-[12px]" style={{ color: "var(--ink3)" }}>
        <summary className="cursor-pointer font-semibold">Detalhes técnicos</summary>
        <div className="mt-2 space-y-1">
          <div>Endereço público embutido nos e-mails: <code>{s?.url ?? "— (QS_URL_PUBLICA não definida)"}</code>. <b>Não mude depois de enviar</b>: pixel, cliques e descadastro dos e-mails antigos apontam para ele.</div>
          <div>Assinatura dos links (HMAC): {s?.hmac ? "ok (no Vault)" : "faltando — aplicar a 0245"}.</div>
          <div>Score recalculado em: {dataHora(s?.config.score_recalculado_em ?? null)}.</div>
        </div>
      </details>
    </div>
  );
}
