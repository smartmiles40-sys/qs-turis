// src/propostas/PropostaParaEnviar.tsx
// -----------------------------------------------------------------------------
// O lado de QUEM PEDIU a cotação (0157, Bruno 21/10): "o link fica preso na
// solicitação e a pessoa precisa ABRIR para conseguir enviar".
//
// Tela cheia por cima de tudo (abre de dentro da solicitação ou da lista):
//   em cima — o andamento e os botões; embaixo — a proposta como o cliente vê.
// Abrir = registra que ESTA pessoa viu ESTA versão (qs_proposta_status 'aberta');
// só aí "Enviar ao cliente" funciona. Se quem monta mexer depois, precisa abrir
// de novo (o banco zera a abertura a cada salvamento).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Etiqueta, Modal } from "@/rel/ui";
import { NOME_SETOR } from "@/solicitacoes/lib";
import { ComCoresDaCentral } from "@/solicitacoes/cores";
import PropostaView from "./PropostaView";
import EnviarAoCliente from "./EnviarAoCliente";
import { STATUS_PROPOSTA, TOM_PROPOSTA, brl, carregarProposta, mudarStatus, paraVM, totaisDaOpcao, type Proposta } from "./lib";

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

export default function PropostaParaEnviar({ id, onFechar, onMudou }: { id: string; onFechar: () => void; onMudou?: () => void }) {
  const { currentUser } = useQsAuth();
  const meuId = currentUser?.id ?? "";
  const [p, setP] = useState<Proposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [envio, setEnvio] = useState(false);
  const [ajuste, setAjuste] = useState<string | null>(null);
  const [marcarAprov, setMarcarAprov] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  // No Comercial as classes rel-* só existem dentro de .cores-central (o portal sai dela).
  const [semCoresDaArea] = useState(() => !getComputedStyle(document.documentElement).getPropertyValue("--rel").trim());

  // Abrir = registrar que eu vi esta versão (só vale com a proposta "pronta").
  const abrir = useCallback(async () => {
    try {
      let x = await carregarProposta(id);
      if (x.status === "pronta" && x.aberta_por !== meuId) {
        await mudarStatus(id, "aberta").catch(() => undefined);
        x = await carregarProposta(id);
      }
      if (x.aprovada_em && !x.aprovacao_vista_em && x.enviada_por === meuId) void mudarStatus(id, "visto").catch(() => undefined);
      setP(x); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não abriu."); }
  }, [id, meuId]);
  useEffect(() => { void abrir(); }, [abrir]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3500); return () => clearTimeout(t); }, [aviso]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !envio && ajuste === null && !marcarAprov) onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar, envio, ajuste, marcarAprov]);

  async function rodar(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true); setErro(null);
    try { await fn(); await abrir(); onMudou?.(); if (ok) setAviso(ok); return true; }
    catch (e) {
      const m = e instanceof Error ? e.message : "Falhou.";
      setErro(m);
      if (m.includes("mudou depois")) await abrir();   // recarrega e marca a versão nova como aberta
      return false;
    } finally { setOcupado(false); }
  }

  async function enviar() {
    if (!p?.id) return;
    if (p.status === "pronta") { const ok = await rodar(() => mudarStatus(p.id!, "enviada")); if (!ok) return; }
    setEnvio(true);
  }

  const varias = (p?.opcoes.length ?? 0) > 1;
  const montou = p?.criado_por_nome?.split(" ")[0] ?? "o outro time";
  const doTime = p ? NOME_SETOR[p.setor] : "";
  // Quem envia aparece como consultor no link: mostro o MEU nome na prévia.
  const vm = p ? { ...paraVM(p), consultor: { nome: (p.enviada_por_nome || currentUser?.name || "").split(" ").slice(0, 2).join(" "), whatsapp: null } } : null;

  // Portal: abre de dentro do modal da solicitação, mas cobre a tela inteira.
  const tela = (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "#F8F6F7" }} role="dialog" aria-modal="true" aria-label="Proposta">
      <div className="border-b px-4 py-3 space-y-2" style={{ background: "var(--card)", borderColor: "var(--line)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="fantasma" onClick={onFechar}>← Voltar</Botao>
          <p className="flex-1 min-w-[180px] text-[15px] font-bold truncate" style={{ color: "var(--ink)" }}>
            {p ? `Proposta nº ${p.numero}${p.cliente_nome ? ` · ${p.cliente_nome}` : ""}` : "Proposta"}
          </p>
          {p && <Etiqueta tom={TOM_PROPOSTA[p.status]}>{STATUS_PROPOSTA[p.status]}</Etiqueta>}
        </div>

        {p && (
          <>
            <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              Montada por <b>{p.criado_por_nome ?? "—"}</b> ({doTime}){p.sol ? ` · pedido #${p.sol.numero} de ${NOME_SETOR[p.sol.de_setor]}` : ""}
              {p.enviada_em && <> · enviada {quando(p.enviada_em)}{p.enviada_por_nome ? ` por ${p.enviada_por_nome.split(" ")[0]}` : ""}</>}
              {p.status !== "rascunho" && p.status !== "pronta" && (p.vista_em ? ` · 👀 cliente abriu ${p.visualizacoes}×` : " · cliente ainda não abriu")}
            </p>
            {p.aprovada_em && (
              <p className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }}>
                ✅ {varias ? `Opção ${p.opcoes.findIndex((o) => o.id === p.aprovada_opcao_id) + 1}` : "Proposta"} aprovada {quando(p.aprovada_em)}{p.aprovada_nome ? ` por ${p.aprovada_nome} (pelo link)` : " (marcada pelo time)"}
              </p>
            )}
            {p.status === "rascunho" && <Aviso>{montou} ({doTime}) ainda está montando{p.pronta_em ? " / ajustando" : ""} esta proposta. Quando ficar pronta, você recebe o aviso na solicitação.</Aviso>}
            {p.status === "cancelada" && <Aviso>Proposta cancelada.</Aviso>}
            {p.status === "pronta" && p.aberta_por === meuId && (
              <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Confira a proposta abaixo. Tudo certo? Envie ao cliente. Precisa mudar algo? Peça o ajuste pra {montou}.</p>
            )}
            {erro && <Aviso tom="erro">{erro}</Aviso>}
            {aviso && <Aviso tom="ok">{aviso}</Aviso>}
            <div className="flex flex-wrap gap-2">
              {p.status === "pronta" && (
                <>
                  <Botao variante="primario" disabled={ocupado || p.aberta_por !== meuId} onClick={() => void enviar()}>Enviar ao cliente</Botao>
                  <Botao disabled={ocupado} onClick={() => setAjuste("")}>Pedir ajuste</Botao>
                </>
              )}
              {(p.status === "enviada" || p.status === "aprovada" || p.status === "recusada") && <Botao variante="primario" onClick={() => setEnvio(true)}>Link e mensagem</Botao>}
              {p.status === "enviada" && <Botao disabled={ocupado} onClick={() => setMarcarAprov(true)}>Cliente aprovou (fora do link)</Botao>}
              {p.status === "enviada" && <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(() => mudarStatus(p.id!, "recusada"), "Marcada como recusada.")}>Cliente recusou</Botao>}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {!p ? <p className="p-6 text-[14px]" style={{ color: "#5B6B6D" }}>{erro ?? "Abrindo…"}</p> : vm && <PropostaView p={vm} previa />}
      </div>

      {p && <EnviarAoCliente p={p} aberto={envio} onFechar={() => setEnvio(false)} onCopiado={setAviso} />}

      <Modal aberto={ajuste !== null} titulo="O que precisa mudar?" onFechar={() => setAjuste(null)} largura={480}>
        <div className="space-y-3">
          <textarea className="rel-input" rows={4} autoFocus value={ajuste ?? ""} onChange={(e) => setAjuste(e.target.value)} maxLength={2000}
            placeholder="Ex.: o cliente prefere voo direto; trocar o hotel de Kyoto por um ryokan; incluir seguro." />
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>A proposta volta pra {montou} e o pedido aparece na conversa da solicitação.</p>
          <div className="flex gap-2">
            <Botao variante="primario" disabled={ocupado || !ajuste?.trim()}
              onClick={() => void rodar(() => mudarStatus(p!.id!, "ajuste", null, ajuste!), "Ajuste pedido.").then((ok) => ok && setAjuste(null))}>Pedir ajuste</Botao>
            <Botao variante="fantasma" onClick={() => setAjuste(null)}>Voltar</Botao>
          </div>
        </div>
      </Modal>

      <Modal aberto={marcarAprov} titulo="Qual opção o cliente aprovou?" onFechar={() => setMarcarAprov(false)} largura={440}>
        <div className="space-y-2">
          {p?.opcoes.map((o, n) => (
            <button key={o.k} type="button" className="rel-linha w-full text-left rounded-xl border p-3" style={{ borderColor: "var(--line)" }}
              onClick={() => { setMarcarAprov(false); void rodar(() => mudarStatus(p.id!, "aprovada", o.id), "Aprovação registrada."); }}>
              <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{varias ? `Opção ${n + 1}${o.titulo ? ` · ${o.titulo}` : ""}` : "A proposta"}</p>
              <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>{brl(totaisDaOpcao(o).total)}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
  return createPortal(semCoresDaArea ? <ComCoresDaCentral>{tela}</ComCoresDaCentral> : tela, document.body);
}
