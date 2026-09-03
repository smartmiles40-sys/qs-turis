// src/lib/qs/waApp.ts
// -----------------------------------------------------------------------------
// MODO APARELHO: a conversa do lead abre no WhatsApp do CELULAR do atendente,
// não no inbox de dentro do QS.
//
// Por que existe: em 2026-09-03 a API oficial (Cloud API da Meta) caiu, e a
// decisão do Bruno foi dar UM CELULAR PRA CADA SDR. Um telefone com WhatsApp
// comum não tem API — ninguém consegue mandar mensagem por ele a partir de um
// servidor. Então o QS para de tentar enviar e volta a fazer o que sempre
// funcionou: entregar o SDR dentro da conversa certa, com o texto certo já
// escrito, no aparelho dele. É o `wa.me`, que o WhatsApp abre no app instalado.
//
// O QUE ESTE MÓDULO **NÃO** MUDA: o closer. Ele atende pelo 1935, que é
// Evolution conectada por QR — essa linha não passa pela Meta e não caiu. Por
// isso o modo é POR PAPEL, e não uma chave global: virar tudo de uma vez
// derrubaria o inbox de quem está trabalhando bem.
//
// A configuração mora em qs_settings.wa_modo_app e é editável em
// Configurações → Atendimento. O PADRÃO (sem linha no banco) já é "SDR no
// aparelho": quando a API voltar, é um clique pra desligar — não um deploy.
//
// Ver também: `chatProvider.ts` (qual cockpit o inbox usa) — são perguntas
// diferentes. Este aqui decide se o SDR usa cockpit ALGUM.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/qsSettings";
import { useQsAuth } from "@/contexts/QsAuthContext";
import type { UserRole } from "@/components/sdr/types";
import { normalizePhoneBR, waChatLink, logWhatsApp } from "@/lib/whatsapp";
import { assinarTexto, loadSignatureName } from "@/lib/qs/waSignature";

export const WA_MODO_APP_KEY = "wa_modo_app";

export interface WaModoApp {
  /** Chave-mestra. `false` devolve todo mundo pro atendimento de dentro do QS. */
  ativo: boolean;
  /** Papéis que falam pelo aparelho. */
  papeis: UserRole[];
  /** uuids que vão pro aparelho MESMO fora dos papéis acima. */
  usuarios: string[];
  /** uuids que ficam no inbox nativo MESMO dentro dos papéis acima. */
  excecoes: string[];
}

/**
 * O padrão vale quando não existe linha em qs_settings — e ele já é o mundo de
 * hoje, de propósito: a API caiu antes de alguém poder configurar nada, e o
 * SDR não pode ficar sem caminho pro cliente esperando um admin abrir a tela.
 */
export const WA_MODO_APP_PADRAO: WaModoApp = {
  ativo: true,
  papeis: ["sdr"],
  usuarios: [],
  excecoes: [],
};

function comoLista(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

/** Aceita qualquer lixo vindo do banco e devolve uma config utilizável. */
export function normalizarModoApp(bruto: unknown): WaModoApp {
  if (!bruto || typeof bruto !== "object") return WA_MODO_APP_PADRAO;
  const o = bruto as Partial<WaModoApp>;
  const papeis = comoLista(o.papeis) as UserRole[];
  return {
    ativo: o.ativo !== false,
    papeis: papeis.length ? papeis : WA_MODO_APP_PADRAO.papeis,
    usuarios: comoLista(o.usuarios),
    excecoes: comoLista(o.excecoes),
  };
}

export async function getWaModoApp(): Promise<WaModoApp> {
  const bruto = await getSetting<unknown>(WA_MODO_APP_KEY);
  // Sem linha no banco = padrão. Erro de leitura também cai aqui, e cair no
  // aparelho é o lado seguro: o wa.me funciona mesmo com o QS meio quebrado.
  if (bruto == null) return WA_MODO_APP_PADRAO;
  return normalizarModoApp(bruto);
}

export async function setWaModoApp(cfg: WaModoApp): Promise<boolean> {
  return setSetting(WA_MODO_APP_KEY, normalizarModoApp(cfg));
}

/** Este usuário fala pelo aparelho? */
export function modoAppVale(
  cfg: WaModoApp,
  user: { id?: string | null; role?: UserRole | null } | null | undefined,
): boolean {
  if (!cfg.ativo) return false;
  const id = user?.id ?? "";
  if (id && cfg.excecoes.includes(id)) return false;   // exceção vence tudo
  if (id && cfg.usuarios.includes(id)) return true;
  return !!user?.role && cfg.papeis.includes(user.role);
}

export interface AlvoNoApp {
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  ownerId?: string | null;
  /** Roteiro da atividade / convite de reunião — já vai escrito na conversa. */
  texto?: string | null;
}

/**
 * Abre a conversa do lead no WhatsApp do aparelho e registra a interação.
 *
 * É SÍNCRONA de propósito. `window.open` depois de um `await` perde o gesto do
 * clique e o navegador do celular bloqueia a janela — por isso a assinatura
 * chega pronta por parâmetro (quem carrega é o hook, na montagem da tela) em
 * vez de ser buscada aqui.
 */
export function abrirConversaNoApp(alvo: AlvoNoApp, assinatura = ""): string | null {
  const phone = normalizePhoneBR(alvo.phone);
  if (!phone) return null;
  const texto = assinarTexto(String(alvo.texto ?? "").trim(), assinatura);
  const url = waChatLink(phone, texto || undefined);

  if (typeof window !== "undefined") {
    // Nem toda chamada consegue ser 100% síncrona (o convite de reunião, por
    // exemplo, monta o texto no banco antes). Quando o gesto do clique já se
    // perdeu, o navegador devolve `null` em vez de abrir a aba — e aí navegar
    // na própria aba é melhor que o clique não fazer nada: o wa.me entrega pro
    // app instalado e o CRM continua atrás, no histórico.
    const aba = window.open(url, "_blank", "noopener,noreferrer");
    if (!aba) window.location.href = url;
  }

  // Log best-effort. "pending" e não "sent": quem aperta enviar é a pessoa, no
  // aparelho dela — o QS só sabe que ela foi levada até lá. Dizer "enviada"
  // aqui seria inventar um envio que pode nunca ter acontecido.
  logWhatsApp({
    leadId: alvo.leadId ?? null,
    ownerId: alvo.ownerId ?? null,
    phone,
    body: texto || null,
    status: "pending",
    kind: "message",
  });

  return url;
}

/**
 * O hook que as telas usam. Devolve se o usuário está no modo aparelho e a
 * função de abrir — com a assinatura dele já carregada.
 *
 * Enquanto a config não chega do banco, vale o PADRÃO (SDR no aparelho). É o
 * lado certo pra errar: mandar o SDR pro app quando não precisava custa um
 * clique; deixá-lo num inbox que não envia custa o lead.
 */
export function useWhatsAppApp() {
  const { currentUser } = useQsAuth();
  const [cfg, setCfg] = useState<WaModoApp>(WA_MODO_APP_PADRAO);
  const [assinatura, setAssinatura] = useState("");

  useEffect(() => {
    let vivo = true;
    void getWaModoApp().then((c) => { if (vivo) setCfg(c); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    let vivo = true;
    void loadSignatureName(currentUser).then((n) => { if (vivo) setAssinatura(n); });
    return () => { vivo = false; };
  }, [currentUser]);

  const modoApp = modoAppVale(cfg, currentUser);

  const abrirNoApp = useCallback(
    (alvo: AlvoNoApp) => abrirConversaNoApp(
      { ...alvo, ownerId: alvo.ownerId ?? currentUser?.id ?? null },
      assinatura,
    ),
    [assinatura, currentUser],
  );

  return { modoApp, abrirNoApp, assinatura, config: cfg };
}
