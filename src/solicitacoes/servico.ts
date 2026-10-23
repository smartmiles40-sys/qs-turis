// src/solicitacoes/servico.ts
// -----------------------------------------------------------------------------
// O FORMULÁRIO DE SERVIÇO (0203, Bruno 23/10/2026: "tudo está voltado pra cotação,
// mas eu queria que fosse pro geral — alteração de assento, cotação de passagem…").
//
// Cada tipo de pedido do Operações que NÃO é cotação (assento, remarcação, bagagem,
// nome, check-in, emissão, alteração, cancelamento, documentos) pede só os campos
// dele. Os campos ficam aqui (CAMPOS_DO_TIPO); o banco só guarda as respostas em
// qs_solicitacoes.formulario = { v: 1, kind: "servico", campos: {...} }.
// Título e descrição saem daqui (busca, cartão e histórico seguem funcionando).
// Tipo novo criado pelo gestor em "Tipos e prazos" sem campos aqui = texto livre.
// -----------------------------------------------------------------------------

export type ValorCampo = string | string[];
export interface FormServico { v: 1; kind: "servico"; campos: Record<string, ValorCampo> }

export interface CampoServico {
  id: string;
  rotulo: string;
  tipo: "texto" | "textarea" | "data" | "escolha" | "varios";
  opcoes?: string[];
  obrigatorio?: boolean;
  dica?: string;
  placeholder?: string;
  /** Linha inteira no formulário (os outros ficam 2 por linha no computador). */
  largo?: boolean;
}

const PASSAGEIROS: CampoServico = { id: "passageiros", rotulo: "Passageiro(s)", tipo: "textarea", obrigatorio: true, largo: true, placeholder: "Nome como está no passaporte — um por linha" };
const LOCALIZADOR: CampoServico = { id: "localizador", rotulo: "Localizador / nº da reserva", tipo: "texto", obrigatorio: true, placeholder: "Ex.: ABC123" };
const CIA: CampoServico = { id: "cia", rotulo: "Companhia aérea", tipo: "texto", placeholder: "Ex.: LATAM, TAP, Azul" };
const VOOS: CampoServico = { id: "voos", rotulo: "Voo(s) e data", tipo: "texto", placeholder: "Ex.: LA8084 · 12/03 · GRU→LIS", largo: true };
const TRECHOS: CampoServico = { id: "trechos", rotulo: "Em quais trechos", tipo: "escolha", obrigatorio: true, opcoes: ["Só ida", "Só volta", "Ida e volta", "Todos os trechos"] };
const CUSTO: CampoServico = {
  id: "custo", rotulo: "Se tiver custo", tipo: "escolha", obrigatorio: true,
  opcoes: ["Cliente paga", "Empresa paga", "Só se for sem custo", "Consultar antes de fazer"],
  dica: "Pra quem faz não precisar voltar perguntando.",
};
const SERVICO: CampoServico = { id: "servico", rotulo: "Qual serviço", tipo: "escolha", obrigatorio: true, opcoes: ["Aéreo", "Hotel", "Seguro viagem", "Passeio / ingresso", "Transfer", "Trem", "Aluguel de carro", "Outro"] };
const DETALHE: CampoServico = { id: "detalhe", rotulo: "Mais alguma coisa?", tipo: "textarea", largo: true, placeholder: "Tudo que ajuda quem vai fazer (opcional)" };

export const CAMPOS_DO_TIPO: Record<string, CampoServico[]> = {
  ops_assento: [
    PASSAGEIROS, LOCALIZADOR, CIA, VOOS, TRECHOS,
    { id: "preferencia", rotulo: "Preferência de assento", tipo: "varios", obrigatorio: true, largo: true,
      opcoes: ["Janela", "Corredor", "Sentar juntos", "Espaço extra pras pernas", "Mais na frente", "Saída de emergência"] },
    CUSTO, DETALHE,
  ],
  ops_remarcacao: [
    PASSAGEIROS, LOCALIZADOR, CIA, VOOS, TRECHOS,
    { id: "nova_data", rotulo: "Nova data / horário desejado", tipo: "texto", obrigatorio: true, placeholder: "Ex.: voltar 28/03 à noite" },
    { id: "motivo", rotulo: "Por que remarcar", tipo: "escolha", obrigatorio: true, opcoes: ["Pedido do cliente", "A companhia mudou o voo", "Problema de saúde", "Outro"] },
    CUSTO, DETALHE,
  ],
  ops_bagagem: [
    PASSAGEIROS, LOCALIZADOR, CIA, VOOS, TRECHOS,
    { id: "bagagem", rotulo: "Que bagagem", tipo: "escolha", obrigatorio: true, opcoes: ["1 mala de 23 kg", "2 malas de 23 kg", "1 mala de 32 kg", "Bagagem de mão extra", "Item especial (bike, prancha…)"] },
    CUSTO, DETALHE,
  ],
  ops_nome: [
    LOCALIZADOR, CIA,
    { id: "errado", rotulo: "O que está errado", tipo: "escolha", obrigatorio: true, opcoes: ["Nome", "Sobrenome", "Nome trocado com outro passageiro", "Data de nascimento", "Nº do documento", "Outro"] },
    { id: "como_esta", rotulo: "Como está hoje", tipo: "texto", placeholder: "Ex.: MARIA SILVA" },
    { id: "como_deve", rotulo: "Como deve ficar (igual ao passaporte)", tipo: "texto", obrigatorio: true, placeholder: "Ex.: MARIA APARECIDA SILVA" },
    CUSTO, DETALHE,
  ],
  ops_checkin: [
    PASSAGEIROS, LOCALIZADOR, CIA, VOOS,
    { id: "o_que", rotulo: "O que precisa", tipo: "escolha", obrigatorio: true, opcoes: ["Fazer o check-in", "Mandar o cartão de embarque", "Os dois"] },
    { id: "passaporte", rotulo: "Passaporte", tipo: "escolha", obrigatorio: true, opcoes: ["Já está no QS", "Vou mandar junto", "Falta pegar com o cliente"] },
    DETALHE,
  ],
  ops_emissao: [
    SERVICO,
    { id: "aprovado", rotulo: "O que o cliente aprovou", tipo: "textarea", obrigatorio: true, largo: true, placeholder: "Ex.: opção 2 da proposta nº 14 — TAP GRU→LIS 12/03, volta 26/03" },
    PASSAGEIROS,
    { id: "pagamento", rotulo: "Pagamento", tipo: "escolha", obrigatorio: true, opcoes: ["Cliente já pagou", "Pagamento em andamento", "Emitir e cobrar depois", "Consultar o Financeiro"] },
    { id: "ate", rotulo: "Emitir até", tipo: "data", dica: "Se a tarifa ou o bloqueio vence numa data." },
    DETALHE,
  ],
  ops_alteracao: [
    SERVICO, { ...LOCALIZADOR, obrigatorio: false },
    { id: "o_que_mudar", rotulo: "O que precisa mudar", tipo: "textarea", obrigatorio: true, largo: true, placeholder: "Ex.: trocar o quarto pra duplo com vista mar; tirar o passeio do dia 14" },
    CUSTO, DETALHE,
  ],
  ops_cancelamento: [
    SERVICO, { ...LOCALIZADOR, obrigatorio: false }, PASSAGEIROS,
    { id: "motivo", rotulo: "Motivo", tipo: "escolha", obrigatorio: true, opcoes: ["Cliente desistiu", "Problema de saúde", "Mudou as datas", "Problema com documento / visto", "Outro"] },
    { id: "devolucao", rotulo: "O cliente espera", tipo: "escolha", obrigatorio: true, opcoes: ["Reembolso em dinheiro", "Crédito pra outra viagem", "Ver o que a regra permite"] },
    DETALHE,
  ],
  ops_documentos: [
    { id: "documentos", rotulo: "Quais documentos", tipo: "varios", obrigatorio: true, largo: true,
      opcoes: ["Voucher do hotel", "Bilhete aéreo", "Apólice do seguro", "Roteiro dia a dia", "Voucher de passeio / transfer", "Carta convite / declaração", "Outro"] },
    { id: "para_quando", rotulo: "Precisa até", tipo: "data" },
    { id: "enviar", rotulo: "Mandar pra", tipo: "escolha", opcoes: ["Pra mim (eu repasso)", "Direto pro cliente", "Subir no ExpedAmigo"] },
    DETALHE,
  ],
};

export function temFormServico(tipoId: string | null | undefined): boolean {
  return !!tipoId && !!CAMPOS_DO_TIPO[tipoId];
}

export function servicoVazio(): FormServico {
  return { v: 1, kind: "servico", campos: {} };
}

/** Lê o jsonb do banco. null se não for um formulário de serviço. */
export function lerServico(x: unknown): FormServico | null {
  if (!x || typeof x !== "object" || (x as { kind?: string }).kind !== "servico") return null;
  const c = (x as { campos?: unknown }).campos;
  return { v: 1, kind: "servico", campos: c && typeof c === "object" ? (c as Record<string, ValorCampo>) : {} };
}

const vazio = (v: ValorCampo | undefined) => (Array.isArray(v) ? v.length === 0 : !(v ?? "").trim());
const dma = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
export function textoValor(c: CampoServico, v: ValorCampo | undefined): string {
  if (Array.isArray(v)) return v.join(", ");
  const t = (v ?? "").trim();
  return c.tipo === "data" ? dma(t) : t;
}

/** Primeiro problema do formulário (ou null se dá pra enviar). */
export function faltaNoServico(tipoId: string, f: FormServico): string | null {
  for (const c of CAMPOS_DO_TIPO[tipoId] ?? []) {
    if (c.obrigatorio && vazio(f.campos[c.id])) return `Preencha “${c.rotulo}”.`;
  }
  return null;
}

/** As linhas "Rótulo: valor" respondidas (tela e descrição usam as mesmas). */
export function linhasDoServico(tipoId: string, f: FormServico): [string, string][] {
  return (CAMPOS_DO_TIPO[tipoId] ?? []).map((c) => [c.rotulo, textoValor(c, f.campos[c.id])] as [string, string]).filter(([, v]) => !!v);
}

export function tituloDoServico(tipoRotulo: string, f: FormServico, cliente?: string | null): string {
  const pax = typeof f.campos.passageiros === "string" ? f.campos.passageiros.split("\n")[0].trim() : "";
  const servico = typeof f.campos.servico === "string" ? f.campos.servico : "";
  const loc = typeof f.campos.localizador === "string" ? f.campos.localizador.trim().toUpperCase() : "";
  const t = [tipoRotulo.split(" (")[0], servico, loc, pax || cliente || ""].filter(Boolean).join(" · ");
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

export function descricaoDoServico(tipoId: string, f: FormServico): string {
  return linhasDoServico(tipoId, f).map(([r, v]) => (v.includes("\n") ? `${r}:\n${v}` : `${r}: ${v}`)).join("\n");
}
