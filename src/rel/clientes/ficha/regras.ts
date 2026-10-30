// src/rel/clientes/ficha/regras.ts
// -----------------------------------------------------------------------------
// Regras PURAS da ficha (sem banco, sem React) — testadas em tests/ficha/.
//   • datas no fuso de São Paulo, somar meses sem estourar o fim do mês
//   • regra dos 6 meses do passaporte
//   • completude ÚNICA (card "Cadastro", checklist "Pronta para embarcar?",
//     faixa "% pra próxima viagem" e o "Preencher por telefone" usam esta)
//   • histórico: trocas de passaporte (rel_auditoria), resumo do audit_log das
//     idas e o agrupamento de gravações seguidas da mesma pessoa
// Só imports de tipo aqui (o carregador dos testes não resolve "@/").
// -----------------------------------------------------------------------------

export const FUSO = "America/Sao_Paulo";

/** "AAAA-MM-DD" de hoje (ou de um instante) em São Paulo. */
export const dataSP = (d: Date = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: FUSO });

/** É uma data "AAAA-MM-DD" que existe no calendário? */
export function dataValida(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split("-").map(Number);
  if (a < 1900 || a > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= diasNoMes(a, m);
}

const diasNoMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const dois = (n: number) => String(n).padStart(2, "0");

/** Soma meses a "AAAA-MM-DD" sem estourar o fim do mês (31/08 + 6 = 28/02 ou 29/02). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  const na = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${na}-${dois(nm)}-${dois(Math.min(d, diasNoMes(na, nm)))}`;
}

/** Soma dias a "AAAA-MM-DD" (calendário puro, sem fuso). */
export function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;
}

/** "dd/mm/aaaa" de um timestamptz no fuso de SP (ou de uma data pura). */
export function dataBRSP(iso: string | null | undefined): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; }
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: FUSO });
}

// ── Regra dos 6 meses ───────────────────────────────────────────────────────

export type AlertaPassaporte = { tom: "danger" | "warn" | "ok"; texto: string };

/**
 * O passaporte tem que valer 6 meses DEPOIS da volta da viagem de referência
 * (em andamento ou a próxima); sem viagem, 6 meses a partir de hoje.
 */
export function alertaSeisMeses(validade: string | null | undefined, voltaReferencia: string | null | undefined, hoje: string = dataSP()): AlertaPassaporte | null {
  if (!validade) return null;
  const v = validade.slice(0, 10);
  if (v < hoje) return { tom: "danger", texto: "Vencido" };
  const temViagem = !!voltaReferencia && voltaReferencia.slice(0, 10) >= hoje;
  const base = temViagem ? voltaReferencia!.slice(0, 10) : hoje;
  if (v < somarMeses(base, 6)) {
    return { tom: "warn", texto: temViagem ? "Vence menos de 6 meses depois da volta da viagem" : "Vence em menos de 6 meses" };
  }
  return { tom: "ok", texto: "Válido (mais de 6 meses)" };
}

/** Datas de uma viagem (expedição/pacote ou do Rel). */
export interface DatasViagem { ida: string | null; volta: string | null }

/**
 * A viagem que vale pro alerta de 6 meses: a que está EM ANDAMENTO (embarcou e
 * ainda não voltou) ou, sem ela, a próxima. Devolve a data da volta (ou da ida,
 * sem volta).
 */
export function voltaDeReferencia(viagens: DatasViagem[], hoje: string = dataSP()): string | null {
  const vivas = viagens.filter((v) => v.ida);
  const andamento = vivas
    .filter((v) => v.ida!.slice(0, 10) <= hoje && (v.volta ?? "").slice(0, 10) >= hoje)
    .sort((a, b) => (a.volta ?? "").localeCompare(b.volta ?? ""));
  if (andamento.length) return andamento[0].volta!.slice(0, 10);
  const prox = vivas.filter((v) => v.ida!.slice(0, 10) >= hoje).sort((a, b) => a.ida!.localeCompare(b.ida!));
  return prox.length ? (prox[0].volta ?? prox[0].ida)!.slice(0, 10) : null;
}

// ── Completude única ────────────────────────────────────────────────────────

export type SecaoCompletude = "pessoais" | "documentos" | "endereco" | "viagem" | "saude";
export interface ItemCompletude {
  chave: string;
  rotulo: string;
  ok: boolean;
  secao: SecaoCompletude;
  /** false = não dá pra preencher na ligação (ex.: foto do passaporte) → "pedir ao cliente" */
  porTelefone: boolean;
  /** por que não está ok, quando tem valor mas não serve (ex.: passaporte vencido) */
  motivo?: string;
}

export interface DadosCompletude {
  nome: string | null | undefined;
  cpf: string | null | undefined;
  nascimento: string | null | undefined;
  telefone: string | null | undefined;
  email: string | null | undefined;
  passaporte: string | null | undefined;
  passaporte_validade: string | null | undefined;
  /** null = não carregou/sem cadastro único: conta como faltando */
  endereco: { cep?: string | null; rua?: string | null; cidade?: string | null } | null;
  emergenciaNome: string | null | undefined;
  emergenciaFone: string | null | undefined;
  camiseta: string | null | undefined;
  /** todas as perguntas obrigatórias de saúde respondidas */
  saudeRespondida: boolean;
  /** true = falta a foto; null = não deu pra conferir (não conta como faltando) */
  semFoto: boolean | null;
  /** volta da viagem de referência (voltaDeReferencia) */
  voltaReferencia: string | null;
}

export interface Completude {
  pct: number;
  itens: ItemCompletude[];
  falta: ItemCompletude[];
  /** só o que dá pra resolver na ligação */
  pctTelefone: number;
  faltaTelefone: ItemCompletude[];
  /** o que não dá por telefone (pedir à cliente) */
  pedirAoCliente: ItemCompletude[];
}

const tem = (v: string | null | undefined) => !!v && String(v).trim() !== "";
const pctDe = (itens: ItemCompletude[]) => (itens.length ? Math.round((itens.filter((i) => i.ok).length / itens.length) * 100) : 100);

export function calcularCompletude(d: DadosCompletude, hoje: string = dataSP()): Completude {
  const alerta = alertaSeisMeses(d.passaporte_validade, d.voltaReferencia, hoje);
  const validadeOk = tem(d.passaporte_validade) && alerta?.tom === "ok";
  const itens: ItemCompletude[] = [
    { chave: "nome", rotulo: "nome completo", ok: (d.nome ?? "").trim().split(/\s+/).filter(Boolean).length >= 2, secao: "pessoais", porTelefone: true },
    { chave: "cpf", rotulo: "CPF", ok: tem(d.cpf), secao: "pessoais", porTelefone: true },
    { chave: "nascimento", rotulo: "nascimento", ok: tem(d.nascimento), secao: "pessoais", porTelefone: true },
    { chave: "telefone", rotulo: "telefone", ok: tem(d.telefone), secao: "pessoais", porTelefone: true },
    { chave: "email", rotulo: "e-mail", ok: tem(d.email), secao: "pessoais", porTelefone: true },
    { chave: "passaporte", rotulo: "passaporte", ok: tem(d.passaporte), secao: "documentos", porTelefone: true },
    {
      chave: "passaporte_validade", rotulo: "validade do passaporte", ok: validadeOk, secao: "documentos", porTelefone: true,
      motivo: tem(d.passaporte_validade) && alerta && alerta.tom !== "ok" ? alerta.texto : undefined,
    },
    { chave: "doc_passaporte", rotulo: "foto do passaporte", ok: d.semFoto !== true, secao: "documentos", porTelefone: false },
    { chave: "endereco", rotulo: "endereço", ok: !!(d.endereco && tem(d.endereco.cep) && tem(d.endereco.rua) && tem(d.endereco.cidade)), secao: "endereco", porTelefone: true },
    { chave: "emergencia", rotulo: "contato de emergência", ok: tem(d.emergenciaNome) && tem(d.emergenciaFone), secao: "viagem", porTelefone: true },
    { chave: "camiseta", rotulo: "tamanho de camiseta", ok: tem(d.camiseta), secao: "viagem", porTelefone: true },
    { chave: "saude", rotulo: "questionário de saúde", ok: d.saudeRespondida, secao: "saude", porTelefone: true },
  ];
  const falta = itens.filter((i) => !i.ok);
  const tel = itens.filter((i) => i.porTelefone);
  return {
    pct: pctDe(itens), itens, falta,
    pctTelefone: pctDe(tel), faltaTelefone: tel.filter((i) => !i.ok),
    pedirAoCliente: falta.filter((i) => !i.porTelefone),
  };
}

// ── Histórico: passaporte (rel_auditoria) ───────────────────────────────────

export interface AuditoriaFicha { id: number | string; acao: string; antes: Record<string, unknown> | null; depois: Record<string, unknown> | null; por: string | null; em: string }
export interface PassaporteAntigo { numero: string; validade: string | null; valeuAte: string; por: string | null }

const normPass = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Os valores ANTIGOS de passaporte/validade que a ficha já teve: cada UPDATE em
 * rel_clientes que trocou o número ou a validade vira "valia até <quando trocou>".
 */
export function passaportesAntigos(auds: AuditoriaFicha[]): PassaporteAntigo[] {
  const out: PassaporteAntigo[] = [];
  for (const a of [...auds].sort((x, y) => x.em.localeCompare(y.em))) {
    if (a.acao !== "UPDATE" || !a.antes || !a.depois) continue;
    const nA = normPass(a.antes.passaporte), nD = normPass(a.depois.passaporte);
    const vA = (a.antes.passaporte_validade as string | null) ?? null, vD = (a.depois.passaporte_validade as string | null) ?? null;
    if (!nA) continue; // antes não tinha: não é troca, é o 1º preenchimento
    if (nA === nD && vA === vD) continue;
    out.push({ numero: nA, validade: vA ? vA.slice(0, 10) : null, valeuAte: a.em, por: a.por });
  }
  return out.reverse();
}

// ── Histórico: audit_log das idas ───────────────────────────────────────────

export const ROTULO_CAMPO_IDA: Record<string, string> = {
  nome_completo: "nome", cpf: "CPF", passaporte: "passaporte", validade_passaporte: "validade do passaporte", data_nascimento: "nascimento",
  email: "e-mail", telefone: "telefone", status_reserva: "status da reserva", contato_emergencia_nome: "emergência (nome)",
  contato_emergencia_fone: "emergência (telefone)", contato_emergencia_vinculo: "emergência (vínculo)", restricoes_alimentares: "alimentação",
  condicoes_medicas: "condições médicas", contrato_assinado: "contrato assinado", checkin_online_feito: "check-in online", localizador: "localizador",
  companhia_aerea: "companhia aérea", quarto_id: "quarto", valor_contratado_brl: "valor contratado", valor_pago_brl: "valor pago",
  status_financeiro: "status financeiro", observacoes: "observações", acompanhante_nome: "acompanhante", acompanhante_vinculo: "vínculo do acompanhante",
  endereco_cep: "CEP", endereco_rua: "rua", endereco_numero: "número", endereco_cidade: "cidade", endereco_estado: "UF", endereco_bairro: "bairro",
  endereco_complemento: "complemento", receita_pendente: "receita a enviar", receita_enviada_em: "receita enviada", expedicao_id: "expedição",
  pref_marcar_assento: "marcar assento", pref_upgrade_classe: "upgrade de classe", ja_viajou_internacional: "já viajou pra fora",
  paises_visitados: "países visitados", grupo_id: "grupo", voo_nacional_necessario: "voo nacional", aereo_incluso: "aéreo incluso",
  saude: "saúde", perfil_viajante: "perfil do viajante", pagamento: "pagamento", saude_triagem_obs: "comentário da triagem de saúde",
};
/** Campos que mudam sozinhos ou são ruído (não entram no histórico). */
const IGNORAR_IDA = new Set(["updated_at", "created_at", "saldo_brl", "valor_atualizado_em", "valor_atualizado_por", "valor_atualizado_por_nome", "id", "pendente_aprovacao"]);
/** Campos sensíveis: diz que mudou, sem mostrar o valor. */
const SEM_VALOR_IDA = new Set(["saude", "perfil_viajante", "condicoes_medicas", "pagamento", "saude_triagem_obs"]);

const mostrar = (v: unknown): string => {
  if (v == null || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 37)}…` : s;
};

/** "passaporte mudou de A pra B; telefone mudou de … pra …" (+N). */
export function resumirMudancaIda(antes: Record<string, unknown> | null, depois: Record<string, unknown> | null, max = 3): string | null {
  if (!antes || !depois) return null;
  const partes: string[] = [];
  for (const k of Object.keys(depois)) {
    if (IGNORAR_IDA.has(k)) continue;
    const a = antes[k], b = depois[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    const r = ROTULO_CAMPO_IDA[k] ?? (SEM_VALOR_IDA.has(k) ? k.replace(/_/g, " ") : null);
    if (!r && !SEM_VALOR_IDA.has(k)) { partes.push(`${k.replace(/_/g, " ")} mudou`); continue; }
    partes.push(SEM_VALOR_IDA.has(k) ? `${r} mudou` : `${r} mudou de ${mostrar(a)} pra ${mostrar(b)}`);
  }
  if (!partes.length) return null;
  return partes.length > max ? `${partes.slice(0, max).join("; ")} (+${partes.length - max})` : partes.join("; ");
}

// ── Agrupar gravações seguidas da mesma pessoa ──────────────────────────────

export interface ItemAgrupavel { id: string; em: string; title: string; grupo?: string | null }

/**
 * Junta itens SEGUIDOS (lista do mais novo pro mais antigo) com o mesmo `grupo`
 * (ex.: "ficha:<autor>") feitos em até `janelaMin` minutos um do outro. O item
 * que fica é o mais novo; o título junta os demais.
 */
export function agruparSeguidos<T extends ItemAgrupavel>(itens: T[], janelaMin = 10): T[] {
  const out: T[] = [];
  let atual: { item: T; ultimoEm: number; titulos: string[] } | null = null;
  const fecha = () => {
    if (!atual) return;
    const n = atual.titulos.length;
    out.push(n > 1 ? { ...atual.item, title: `${atual.titulos[0]} (+${n - 1} alteraç${n - 1 === 1 ? "ão" : "ões"}: ${atual.titulos.slice(1).join("; ")})` } : atual.item);
    atual = null;
  };
  for (const it of itens) {
    const t = new Date(it.em).getTime();
    if (atual && it.grupo && atual.item.grupo === it.grupo && Math.abs(atual.ultimoEm - t) <= janelaMin * 60_000) {
      if (!atual.titulos.includes(it.title)) atual.titulos.push(it.title);
      atual.ultimoEm = t;
      continue;
    }
    fecha();
    atual = { item: it, ultimoEm: t, titulos: [it.title] };
  }
  fecha();
  return out;
}

// ── Telefone de emergência (aceita exterior) ────────────────────────────────

/** Até 15 dígitos; com "+" na frente = número do exterior (sem máscara do Brasil). */
export function normalizarFoneEmergencia(v: string): string {
  const s = v.trim();
  const d = s.replace(/\D/g, "").slice(0, 15);
  return s.startsWith("+") ? `+${d}` : d;
}
