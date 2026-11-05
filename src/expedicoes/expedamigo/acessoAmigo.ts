// src/expedicoes/expedamigo/acessoAmigo.ts
// -----------------------------------------------------------------------------
// Peças PURAS do acesso ao ExpedAmigo (portal do viajante), sem React nem banco —
// por isso dá pra testar (tests/expedicoes/acessoAmigo.test.ts).
//
// Como o app antigo faz (sistema-expedicoes, f6326c6 / e3816fa, 04/11):
//   · O 1º acesso e o RESET são por LINK MÁGICO: grava um código em `acesso_links`
//     (codigo, passageiro_id, expira_em = +30 dias) e manda `<portal>/a/<codigo>`.
//     A rota /a/<codigo> do portal acha o passageiro, assina um token e redireciona
//     pro /amigo/acesso?t=…, onde a pessoa cria a própria senha (acesso_senhas).
//   · Reset = zera senha_hash + senha_provisoria do CPF (a senha atual cai na hora)
//     e gera um link novo. A senha provisória aleatória foi APOSENTADA.
//   · A mensagem de boas-vindas (lib/expedamigo/onboarding.ts) e o wa.me
//     (novas-vendas/actions.ts → montarWhatsapp) estão abaixo, iguais ao antigo.
// A geração do código fica no servidor (api/_expAcesso.js); aqui só se monta texto.
// -----------------------------------------------------------------------------

/** Validade do link mágico (igual ao antigo: 30 dias). */
export const DIAS_VALIDADE_LINK = 30;
/** Link que ainda vale por mais que isto é reaproveitado (igual à exp_amigo_gerar_link, 0164). */
export const DIAS_REAPROVEITAR_LINK = 7;
/** Alfabeto do código curto (sem caracteres ambíguos — igual ao antigo). */
export const ALFABETO_CODIGO = "abcdefghjkmnpqrstuvwxyz23456789";
/** Tamanho do código curto do antigo (gerarCodigoCurto(10)). */
export const TAMANHO_CODIGO = 10;

/** Texto de boas-vindas do onboarding — verbatim do app antigo (lib/expedamigo/onboarding.ts). */
export const MENSAGEM_ONBOARDING_PADRAO = `Oiii {nome}! Que alegria ter você na {rotulo_viagem} {expedição} 💚

Aqui é o time de Relacionamento da Se Tu For — a partir de agora somos nós que vamos cuidar de você em cada detalhe até o embarque (e durante a viagem também).

Já liberamos o seu acesso ao *Portal do Viajante* 🎉 É nele que você acompanha tudo da sua viagem em um só lugar: o *roteiro dia a dia*, seus *voos*, a *hospedagem*, vouchers, informações do destino e avisos importantes.

👉 {link}

É só clicar no link pra criar sua senha e entrar.

📝 Importante: ao abrir o *roteiro dia a dia* no portal, vai aparecer um *formulário de inscrição* pra você preencher — é onde a gente te conhece melhor e já organiza sua documentação com antecedência, pra tudo fluir tranquilo lá na frente.

E o próximo passo é um *encontro rápido de boas-vindas*: online, leve, uns 20 minutinhos. Ali o nosso time se apresenta, te conta como funciona o acompanhamento daqui pra frente e alinha os próximos passos da sua {termo_viagem}.

Conta pra gente: qual o melhor dia e horário pra você nos próximos 7 dias, de segunda a sexta? 💚`;

export type ViagemDaMensagem = { nome: string; tipo?: string | null } | null | undefined;

/** Primeiro nome (a mensagem fica mais pessoal). */
export function primeiroNome(nome: string | null | undefined): string {
  const n = String(nome ?? "").trim();
  return n.split(/\s+/)[0] || n;
}

/** Mensagem de boas-vindas pronta (pacote fala "viagem"; expedição, "Expedição"). */
export function montarMensagemOnboarding(nome: string | null | undefined, viagem: ViagemDaMensagem, link: string, modelo?: string | null): string {
  const t = (modelo && modelo.trim()) || MENSAGEM_ONBOARDING_PADRAO;
  const pacote = viagem?.tipo === "pacote";
  const nomeViagem = viagem?.nome ?? "";
  return t
    .replaceAll("{nome}", primeiroNome(nome))
    .replaceAll("{rotulo_viagem}", pacote ? "sua viagem" : "Expedição")
    .replaceAll("{termo_viagem}", pacote ? "viagem" : "expedição")
    .replaceAll("{expedição}", nomeViagem)
    .replaceAll("{expedicao}", nomeViagem)
    .replaceAll("{link}", link);
}

/** Endereço do portal sem barra no fim (VITE_EXP_PORTAL_URL / EXP_PORTAL_URL). */
export function normalizarBasePortal(base: string | null | undefined, padrao = "https://sistema-expedicoes.vercel.app"): string {
  const b = String(base ?? "").trim().replace(/\/+$/, "");
  return b || padrao;
}

/** Código no formato que o portal antigo aceita em /a/<codigo>? */
export function codigoValido(codigo: string | null | undefined): boolean {
  return new RegExp(`^[${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}}$`).test(String(codigo ?? ""));
}

/** Link curto que o portal consome: <base>/a/<codigo>. */
export function montarLinkCurto(base: string, codigo: string): string {
  if (!codigoValido(codigo)) throw new Error("Código de acesso inválido.");
  return `${normalizarBasePortal(base)}/a/${codigo}`;
}

/** Tira o código de um link /a/<codigo> (pra reaproveitar um link já gerado). */
export function codigoDoLink(link: string | null | undefined): string | null {
  const m = String(link ?? "").match(/\/a\/([a-z0-9]+)\/?(?:[?#].*)?$/);
  return m && codigoValido(m[1]) ? m[1] : null;
}

/** Data de expiração de um link criado em `agora` (ISO). */
export function expiracaoDoLink(agora: Date = new Date(), dias = DIAS_VALIDADE_LINK): string {
  return new Date(agora.getTime() + dias * 86_400_000).toISOString();
}

/** O link já venceu? (sem data = vencido; o portal manda pra /amigo?e=link) */
export function linkExpirado(expiraEm: string | null | undefined, agora: Date = new Date()): boolean {
  const t = expiraEm ? new Date(expiraEm).getTime() : NaN;
  return !Number.isFinite(t) || t < agora.getTime();
}

/** Ainda vale por mais de 7 dias? Então dá pra reaproveitar em vez de criar outro. */
export function linkReaproveitavel(expiraEm: string | null | undefined, agora: Date = new Date()): boolean {
  if (linkExpirado(expiraEm, agora)) return false;
  return new Date(expiraEm as string).getTime() > agora.getTime() + DIAS_REAPROVEITAR_LINK * 86_400_000;
}

/** Dias inteiros que faltam pro link vencer (0 = vence hoje / já venceu). */
export function diasRestantesLink(expiraEm: string | null | undefined, agora: Date = new Date()): number {
  if (linkExpirado(expiraEm, agora)) return 0;
  return Math.floor((new Date(expiraEm as string).getTime() - agora.getTime()) / 86_400_000);
}

/** Telefone → só dígitos com DDI 55 (null se não dá pra mandar WhatsApp). Igual ao antigo. */
export function telefoneWhatsapp(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}

/** wa.me com o texto já codificado (null sem telefone). */
export function montarLinkWhatsapp(telefone: string | null | undefined, texto: string): string | null {
  const fone = telefoneWhatsapp(telefone);
  return fone ? `https://wa.me/${fone}?text=${encodeURIComponent(texto)}` : null;
}

/** CPF → 11 dígitos (ou null). Chave da lista de masters e de acesso_senhas. */
export function cpfMaster(cpf: string | null | undefined): string | null {
  const d = String(cpf ?? "").replace(/\D/g, "");
  return d.length === 11 ? d : null;
}
