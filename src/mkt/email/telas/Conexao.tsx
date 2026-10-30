// Marketing › E-mail › Conexão: chave do Resend (vai pro Vault, nunca volta pra
// tela), domínio + registros DNS, webhook de eventos, remetente e rodapé.
import { useEffect, useState } from "react";
import { chamar, dataHora, status as lerStatus, type RegistroDns, type StatusConexao } from "../lib/api";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Tela } from "../ui";

export default function Conexao() {
  const [s, setS] = useState<StatusConexao | null>(null);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro" | "aviso"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [chave, setChave] = useState("");
  const [dominio, setDominio] = useState("");
  const [whsec, setWhsec] = useState("");
  const [rem, setRem] = useState({ remetente_nome: "", remetente_email: "", responder_para: "", rodape_texto: "", rodape_endereco: "", por_segundo: "4" });

  const recarregar = () => lerStatus().then((x) => {
    setS(x);
    setDominio(x.config.dominio ?? "");
    setRem({
      remetente_nome: x.config.remetente_nome ?? "", remetente_email: x.config.remetente_email ?? "",
      responder_para: x.config.responder_para ?? "", rodape_texto: x.config.rodape_texto ?? "",
      rodape_endereco: x.config.rodape_endereco ?? "", por_segundo: String(x.config.por_segundo ?? 4),
    });
  }).catch((e) => setMsg({ tom: "erro", texto: e.message }));
  useEffect(() => { recarregar(); }, []);

  const agir = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true); setMsg(null);
    try { await chamar(corpo); setMsg({ tom: "ok", texto: ok }); await recarregar(); }
    catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
    finally { setOcupado(false); }
  };

  const registros: RegistroDns[] = s?.config.dominio_registros ?? [];
  const verificado = s?.config.dominio_status === "verified";

  return (
    <Tela titulo="Conexão do e-mail (Resend)" sub="Tudo que o e-mail marketing precisa para sair com o nome da agência e cair na caixa de entrada.">
      {msg ? <Aviso tom={msg.tom}>{msg.texto}</Aviso> : null}
      {s && s.faltando.length ? <Aviso>Falta: {s.faltando.join(" · ")}</Aviso> : s ? <Aviso tom="ok">Tudo pronto para enviar.</Aviso> : null}

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="mke-card p-4 space-y-3">
          <h2 className="font-semibold">1. Chave da API {s?.conectado ? <Etiqueta tom="ok">conectada</Etiqueta> : <Etiqueta tom="aviso">não conectada</Etiqueta>}</h2>
          <p className="text-xs" style={{ color: "var(--ink2)" }}>No Resend: API Keys → Create → <b>Full access</b>. A chave fica guardada criptografada no cofre (Vault) e não aparece de novo aqui.</p>
          <Campo rotulo="Chave (re_…)"><Entrada type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} /></Campo>
          <div className="flex gap-2">
            <Botao variante="primario" disabled={ocupado || !chave} onClick={() => agir({ acao: "conectar", chave }, "Chave conferida no Resend e guardada.").then(() => setChave(""))}>Conferir e guardar</Botao>
            {s?.conectado ? <Botao variante="perigo" disabled={ocupado} onClick={() => window.confirm("Desconectar? A fila para até conectar de novo.") && agir({ acao: "desconectar" }, "Desconectado.")}>Desconectar</Botao> : null}
          </div>
        </section>

        <section className="mke-card p-4 space-y-3">
          <h2 className="font-semibold">2. Domínio de envio {s?.config.dominio ? <Etiqueta tom={verificado ? "ok" : "aviso"}>{s.config.dominio_status ?? "pendente"}</Etiqueta> : null}</h2>
          <p className="text-xs" style={{ color: "var(--ink2)" }}>Use um subdomínio só para marketing (ex.: <code>mail.setuforeuvouviagens.com.br</code>) — protege a reputação do e-mail do dia a dia.</p>
          <Campo rotulo="Domínio"><Entrada value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="mail.setuforeuvouviagens.com.br" /></Campo>
          <div className="flex gap-2">
            <Botao disabled={ocupado || !dominio || !s?.conectado} onClick={() => agir({ acao: "dominio", nome: dominio }, "Domínio registrado. Publique os registros abaixo no DNS.")}>Usar este domínio</Botao>
            <Botao disabled={ocupado || !s?.config.dominio_id} onClick={() => agir({ acao: "verificar_dominio" }, "Pedi ao Resend para conferir o DNS.")}>Conferir DNS agora</Botao>
          </div>
        </section>
      </div>

      {registros.length ? (
        <section className="mke-card p-4 mt-4 overflow-x-auto">
          <h2 className="font-semibold mb-2">Registros DNS para publicar</h2>
          <table className="w-full text-[12px]">
            <thead><tr className="text-left" style={{ color: "var(--ink2)" }}><th className="p-2">Tipo</th><th className="p-2">Nome</th><th className="p-2">Valor</th><th className="p-2">Prioridade</th><th className="p-2">Situação</th></tr></thead>
            <tbody>{registros.map((r, i) => (
              <tr key={i} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                <td className="p-2 font-mono">{r.type}</td><td className="p-2 font-mono break-all">{r.name}</td>
                <td className="p-2 font-mono break-all">{r.value}</td><td className="p-2">{r.priority ?? "—"}</td>
                <td className="p-2"><Etiqueta tom={r.status === "verified" ? "ok" : "aviso"}>{r.status ?? "—"}</Etiqueta></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="text-xs mt-2" style={{ color: "var(--ink2)" }}>Recomendado também um DMARC: TXT <code>_dmarc</code> = <code>v=DMARC1; p=none; rua=mailto:…</code> (ver docs/MARKETING-EMAIL.md).</p>
        </section>
      ) : null}

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <section className="mke-card p-4 space-y-3">
          <h2 className="font-semibold">3. Webhook de eventos {s?.webhook ? <Etiqueta tom="ok">ok</Etiqueta> : <Etiqueta tom="aviso">falta</Etiqueta>}</h2>
          <p className="text-xs" style={{ color: "var(--ink2)" }}>Traz entregue, bounce e denúncia de spam. Sem ele, bounce não tratado derruba a reputação do domínio em silêncio. Endereço: <code className="break-all">{s?.urlWebhook ?? "defina QS_URL_PUBLICA"}</code></p>
          <Botao disabled={ocupado || !s?.conectado || !s?.url} onClick={() => agir({ acao: "criar_webhook" }, "Webhook criado e segredo guardado.")}>Criar webhook no Resend</Botao>
          <Campo rotulo="…ou cole o Signing secret (whsec_…)"><Entrada type="password" autoComplete="off" value={whsec} onChange={(e) => setWhsec(e.target.value)} /></Campo>
          <Botao disabled={ocupado || !whsec} onClick={() => agir({ acao: "segredo_webhook", segredo: whsec }, "Segredo guardado.").then(() => setWhsec(""))}>Guardar segredo</Botao>
        </section>

        <section className="mke-card p-4 space-y-3">
          <h2 className="font-semibold">4. Remetente e rodapé</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Campo rotulo="Nome"><Entrada value={rem.remetente_nome} onChange={(e) => setRem({ ...rem, remetente_nome: e.target.value })} /></Campo>
            <Campo rotulo="E-mail" dica={s?.config.dominio ? `@${s.config.dominio}` : undefined}><Entrada type="email" value={rem.remetente_email} onChange={(e) => setRem({ ...rem, remetente_email: e.target.value })} /></Campo>
            <Campo rotulo="Responder para"><Entrada type="email" value={rem.responder_para} onChange={(e) => setRem({ ...rem, responder_para: e.target.value })} /></Campo>
            <Campo rotulo="Ritmo (e-mails/s)" dica="Plano grátis do Resend: 2/s. Pago: confira o seu."><Entrada type="number" min={1} max={50} value={rem.por_segundo} onChange={(e) => setRem({ ...rem, por_segundo: e.target.value })} /></Campo>
          </div>
          <Campo rotulo="Frase do rodapé"><Entrada value={rem.rodape_texto} onChange={(e) => setRem({ ...rem, rodape_texto: e.target.value })} /></Campo>
          <Campo rotulo="Dados da empresa (CNPJ e endereço)"><Entrada value={rem.rodape_endereco} onChange={(e) => setRem({ ...rem, rodape_endereco: e.target.value })} /></Campo>
          <Botao variante="primario" disabled={ocupado} onClick={() => agir({ acao: "salvar_config", config: { ...rem, por_segundo: Number(rem.por_segundo) } }, "Remetente salvo.")}>Salvar</Botao>
        </section>
      </div>

      <section className="mke-card p-4 mt-4 text-xs space-y-1" style={{ color: "var(--ink2)" }}>
        <div>Endereço público embutido nos e-mails: <code>{s?.url ?? "— (QS_URL_PUBLICA não definida)"}</code>. <b>Não mude depois de enviar</b>: pixel, cliques e descadastro dos e-mails antigos apontam para ele.</div>
        <div>Assinatura dos links (HMAC): {s?.hmac ? "ok (no Vault)" : "faltando — aplicar a 0245"}.</div>
        <div>Score recalculado em: {dataHora(s?.config.score_recalculado_em ?? null)}.</div>
      </section>
    </Tela>
  );
}
