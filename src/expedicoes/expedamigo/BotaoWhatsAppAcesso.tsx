// src/expedicoes/expedamigo/BotaoWhatsAppAcesso.tsx
// -----------------------------------------------------------------------------
// Botão "WhatsApp" do acesso ao portal (porte do e3816fa do app antigo, fila de
// Novas vendas): 1 clique gera o LINK MÁGICO no servidor (libera o portal da
// viagem), monta a mensagem de boas-vindas e abre o WhatsApp da pessoa com tudo
// pronto. Depois ficam "Abrir WhatsApp", "Copiar mensagem" e "Copiar link".
// Sem telefone: copia a mensagem pra colar à mão.
//
// Reutilizável (Acessos ExpedAmigo, ficha do passageiro, ficha do cliente, e a
// fila de Novas vendas — que pluga este mesmo componente). Não usa useExp (a ficha
// do cliente fica fora do ExpProvider): o aviso vai por `onAviso` ou aparece aqui.
//
// MODO VALIDAÇÃO (EXP_ESPELHO_LIGADO=1 no servidor, ou `modoValidacao` vindo da
// tela): GERAR fica desligado — um código gravado só no QS não abre no portal,
// que ainda lê o banco antigo. Com `linkExistente` (um link que já existe), abrir
// o WhatsApp e copiar continuam liberados.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Botao } from "@/rel/ui";
import { montarLinkWhatsapp, montarMensagemOnboarding, type ViagemDaMensagem } from "./acessoAmigo";
import { ModoValidacaoErro, pedirLinkAmigo, useModoValidacaoAmigo, type LinkAmigo } from "./servidor";

export interface BotaoWhatsAppAcessoProps {
  /** Reserva (linha de passageiros) — o link mágico é por reserva, igual ao antigo. */
  passageiroId: string;
  nome: string;
  telefone?: string | null;
  /** Viagem da reserva (nome + tipo: pacote fala "viagem"). Se faltar, usa a que o servidor devolver. */
  viagem?: ViagemDaMensagem;
  /** Link /a/<codigo> que já existe: copiar/abrir funciona mesmo no modo validação. */
  linkExistente?: string | null;
  /** Força o modo validação (ex.: o modo só-leitura do useExp). Sem isto, pergunta ao servidor. */
  modoValidacao?: boolean;
  /** Rótulo do botão principal. */
  rotulo?: string;
  onGerado?: (r: LinkAmigo) => void;
  onAviso?: (texto: string, tom: "ok" | "erro") => void;
}

const PEQ = { padding: "6px 12px", fontSize: 12.5 } as const;

async function copiarTexto(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    const el = document.createElement("textarea");
    el.value = t; document.body.appendChild(el); el.select();
    const ok = document.execCommand("copy"); el.remove(); return ok;
  }
}

export default function BotaoWhatsAppAcesso({
  passageiroId, nome, telefone, viagem, linkExistente, modoValidacao, rotulo = "WhatsApp", onGerado, onAviso,
}: BotaoWhatsAppAcessoProps) {
  const validacao = useModoValidacaoAmigo(modoValidacao);
  const [gerado, setGerado] = useState<{ link: string; viagem: ViagemDaMensagem; telefone: string | null } | null>(
    linkExistente ? { link: linkExistente, viagem, telefone: telefone ?? null } : null,
  );
  const [indo, setIndo] = useState(false);
  const [nota, setNota] = useState<{ texto: string; tom: "ok" | "erro" } | null>(null);

  const avisar = (texto: string, tom: "ok" | "erro" = "ok") => { if (onAviso) onAviso(texto, tom); else setNota({ texto, tom }); };
  const mensagemDe = (g: NonNullable<typeof gerado>) => montarMensagemOnboarding(nome, g.viagem ?? viagem, g.link);
  const waDe = (g: NonNullable<typeof gerado>) => montarLinkWhatsapp(g.telefone ?? telefone, mensagemDe(g));

  async function gerarEAbrir() {
    // Abre a aba JÁ no clique (senão o navegador bloqueia o popup depois do await).
    const temFone = !!montarLinkWhatsapp(telefone, "x");
    const aba = temFone ? window.open("about:blank", "_blank") : null;
    setIndo(true); setNota(null);
    try {
      const r = await pedirLinkAmigo({ passageiroId });
      const g = { link: r.link, viagem: viagem ?? r.expedicao, telefone: telefone ?? r.passageiro.telefone };
      setGerado(g);
      onGerado?.(r);
      const wa = waDe(g);
      if (wa) {
        if (aba) aba.location.href = wa; else window.open(wa, "_blank", "noopener");
        avisar(`Link mágico ${r.reaproveitado ? "reaproveitado" : "gerado"} — abrindo o WhatsApp de ${nome.split(" ")[0]}`);
      } else {
        aba?.close();
        avisar((await copiarTexto(mensagemDe(g))) ? "Sem telefone no cadastro — mensagem copiada, cole no WhatsApp." : "Sem telefone e não consegui copiar.", "ok");
      }
    } catch (e) {
      aba?.close();
      avisar(e instanceof ModoValidacaoErro ? e.message : e instanceof Error ? e.message : "Não consegui gerar o link.", "erro");
    } finally { setIndo(false); }
  }

  const travado = validacao !== false; // carregando ou modo validação
  const dicaTravado = validacao === undefined ? "Conferindo o modo do sistema…"
    : "Modo validação: o portal ainda lê o banco antigo — gere o link pelo sistema antigo até a virada.";

  return (
    <div className="inline-flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {gerado ? (
          <>
            {waDe(gerado) && (
              <a href={waDe(gerado)!} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold"
                style={{ background: "#16a34a", color: "#fff" }}>
                Abrir WhatsApp
              </a>
            )}
            <Botao style={PEQ} onClick={async () => avisar((await copiarTexto(mensagemDe(gerado))) ? "Mensagem copiada — cole no WhatsApp." : "Não consegui copiar.", "ok")}>Copiar mensagem</Botao>
            <Botao variante="fantasma" style={PEQ} onClick={async () => avisar((await copiarTexto(gerado.link)) ? "Link copiado." : "Não consegui copiar.", "ok")}>Copiar link</Botao>
          </>
        ) : (
          <Botao variante="primario" style={PEQ} disabled={indo || travado}
            title={travado ? dicaTravado : "Gera o link mágico, libera o portal e abre o WhatsApp com a mensagem pronta"}
            onClick={() => void gerarEAbrir()}>
            {indo ? "Gerando…" : rotulo}
          </Botao>
        )}
      </div>
      {!gerado && validacao === true && <span className="text-[11px]" style={{ color: "var(--warn-ink)" }}>Modo validação — link só pelo sistema antigo.</span>}
      {nota && <span className="text-[11.5px]" style={{ color: nota.tom === "erro" ? "var(--err-ink)" : "var(--ink3)" }}>{nota.texto}</span>}
    </div>
  );
}
