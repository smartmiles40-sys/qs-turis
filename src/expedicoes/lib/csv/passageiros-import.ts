/**
 * Parser e validador de CSV para importação de passageiros.
 *
 * Puro (sem I/O) pra ser testável e rodar no cliente (pré-visualização) e no
 * servidor. Aceita delimitador `;` (padrão do Excel pt-BR) ou `,`, cabeçalhos
 * com acento/caixa variável, e datas em ISO ou DD/MM/AAAA.
 */
import { TIPO_PASSAGEIRO, STATUS_RESERVA } from "@/expedicoes/lib/constants";
import { cpfValido } from "@/expedicoes/lib/cpf";
import type { TipoPassageiro, StatusReserva } from "@/expedicoes/lib/database";

export type CampoPassageiro =
  | "nome_completo"
  | "data_nascimento"
  | "cpf"
  | "passaporte"
  | "validade_passaporte"
  | "email"
  | "telefone"
  | "tipo"
  | "status_reserva"
  | "observacoes"
  | "valor_contratado_brl"
  | "valor_pago_brl"
  | "expedicao_codigo";

export type DadosImport = {
  nome_completo: string;
  data_nascimento: string | null;
  cpf: string | null;
  passaporte: string | null;
  validade_passaporte: string | null;
  email: string | null;
  telefone: string | null;
  tipo: TipoPassageiro;
  status_reserva: StatusReserva;
  observacoes: string | null;
  valor_contratado_brl: number | null;
  valor_pago_brl: number | null;
  /** Código da expedição — usado só na importação global. */
  expedicao_codigo: string | null;
};

export type LinhaImport = {
  /** Número da linha no arquivo (1-based, sem contar o cabeçalho). */
  linha: number;
  dados: DadosImport;
  erros: string[];
};

export type ResultadoParse = {
  linhas: LinhaImport[];
  /** Erro que impede a leitura inteira (ex.: falta coluna de nome). */
  erroGeral: string | null;
  /** Campos canônicos reconhecidos no cabeçalho. */
  colunasReconhecidas: CampoPassageiro[];
};

/** Normaliza texto pra comparação: sem acento, minúsculo, espaços colapsados. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES: Record<CampoPassageiro, string[]> = {
  nome_completo: ["nome completo", "nome", "passageiro", "nome do passageiro"],
  data_nascimento: ["data de nascimento", "data nascimento", "nascimento", "dt nascimento", "nasc"],
  cpf: ["cpf"],
  passaporte: ["passaporte", "passport", "numero passaporte", "num passaporte", "n passaporte"],
  validade_passaporte: ["validade passaporte", "validade do passaporte", "validade", "vencimento passaporte", "passaporte validade"],
  email: ["email", "e mail"],
  telefone: ["telefone", "celular", "whatsapp", "fone", "tel", "contato"],
  tipo: ["tipo", "tipo passageiro"],
  status_reserva: ["status reserva", "status", "situacao", "reserva"],
  observacoes: ["observacoes", "obs", "observacao", "notas"],
  valor_contratado_brl: ["valor contratado", "contratado", "valor total", "total", "valor"],
  valor_pago_brl: ["valor pago", "pago", "entrada", "valor pago brl"],
  expedicao_codigo: ["expedicao codigo", "expedicao", "expedicao cod", "cod expedicao", "codigo expedicao", "codigo da expedicao", "codigo"],
};

/** Detecta o delimitador olhando a primeira linha (`;` vs `,`). */
export function detectarDelimitador(texto: string): "," | ";" {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const ponto = (primeira.match(/;/g) ?? []).length;
  const virgula = (primeira.match(/,/g) ?? []).length;
  return ponto > virgula ? ";" : ",";
}

/** Parser CSV que respeita aspas duplas (com escape "") e campos multilinha. */
export function parseCSV(texto: string, delimitador?: string): string[][] {
  const delim = delimitador ?? detectarDelimitador(texto);
  // Remove BOM.
  const t = texto.replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "";
  let registro: string[] = [];
  let dentroAspas = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentroAspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += c;
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === delim) {
      registro.push(campo); campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      registro.push(campo); campo = "";
      // Ignora linhas totalmente vazias.
      if (registro.some((x) => x.trim() !== "")) linhas.push(registro);
      registro = [];
    } else {
      campo += c;
    }
  }
  // Último campo/registro (arquivo sem newline final).
  if (campo !== "" || registro.length > 0) {
    registro.push(campo);
    if (registro.some((x) => x.trim() !== "")) linhas.push(registro);
  }
  return linhas;
}

/** Mapeia cada coluna do cabeçalho ao campo canônico (ou null). */
function mapearCabecalho(header: string[]): (CampoPassageiro | null)[] {
  return header.map((col) => {
    const n = normalizar(col);
    for (const campo of Object.keys(ALIASES) as CampoPassageiro[]) {
      if (ALIASES[campo].includes(n)) return campo;
    }
    return null;
  });
}

/** Normaliza data ISO ou DD/MM/AAAA → "AAAA-MM-DD". Retorna null se vazio. */
export function normalizarData(valor: string): { iso: string | null; erro?: string } {
  const v = valor.trim();
  if (!v) return { iso: null };
  // ISO (com ou sem hora)
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}` };
  // DD/MM/AAAA com separadores / - .
  const br = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (br) {
    const [, d, m, aRaw] = br;
    const a = aRaw.length === 2 ? (Number(aRaw) > 50 ? "19" : "20") + aRaw : aRaw;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    const dia = Number(dd), mes = Number(mm);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { iso: null, erro: `data inválida "${valor}"` };
    return { iso: `${a}-${mm}-${dd}` };
  }
  return { iso: null, erro: `data não reconhecida "${valor}"` };
}

/** Converte valor monetário em número. Aceita "1.234,56" (BR) e "1234.56" (US). */
export function parseNumeroBR(valor: string): { num: number | null; erro?: string } {
  let s = valor.trim().replace(/r\$\s?/i, "").replace(/\s/g, "");
  if (!s) return { num: null };
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  if (Number.isNaN(n)) return { num: null, erro: `valor numérico inválido "${valor}"` };
  if (n < 0) return { num: null, erro: "valor negativo" };
  return { num: n };
}

function coerceTipo(valor: string): TipoPassageiro {
  const n = normalizar(valor);
  const achado = TIPO_PASSAGEIRO.find((t) => normalizar(t) === n);
  return achado ?? "Pagante";
}

function coerceStatus(valor: string, padrao: StatusReserva = "Lead"): StatusReserva {
  const n = normalizar(valor);
  const achado = STATUS_RESERVA.find((s) => normalizar(s) === n);
  return achado ?? padrao;
}

/**
 * Lê o CSV inteiro e devolve uma linha estruturada por registro, com os erros
 * de validação de cada uma (nome é o único campo obrigatório).
 */
export function parsePassageirosCSV(
  texto: string,
  opcoes?: { exigirObrigatorios?: boolean; statusPadrao?: StatusReserva },
): ResultadoParse {
  const exigir = opcoes?.exigirObrigatorios ?? false;
  const statusPadrao = opcoes?.statusPadrao ?? "Lead";
  const grade = parseCSV(texto);
  if (grade.length === 0) {
    return { linhas: [], erroGeral: "Arquivo vazio.", colunasReconhecidas: [] };
  }
  const [header, ...corpo] = grade;
  const mapa = mapearCabecalho(header);
  const colunasReconhecidas = mapa.filter((c): c is CampoPassageiro => c !== null);

  if (!colunasReconhecidas.includes("nome_completo")) {
    return {
      linhas: [],
      erroGeral: 'Não encontrei a coluna de nome. O cabeçalho precisa ter "nome completo" (ou "nome").',
      colunasReconhecidas,
    };
  }

  const linhas: LinhaImport[] = corpo.map((registro, idx) => {
    const get = (campo: CampoPassageiro): string => {
      const col = mapa.indexOf(campo);
      return col >= 0 ? (registro[col] ?? "").trim() : "";
    };
    const erros: string[] = [];

    const nome_completo = get("nome_completo");
    if (nome_completo.length < 2) erros.push("nome ausente ou muito curto");

    const nasc = normalizarData(get("data_nascimento"));
    if (nasc.erro) erros.push(`nascimento: ${nasc.erro}`);
    else if (exigir && !nasc.iso) erros.push("data de nascimento obrigatória");
    const val = normalizarData(get("validade_passaporte"));
    if (val.erro) erros.push(`validade passaporte: ${val.erro}`);

    const cpfRaw = get("cpf");
    if (exigir) {
      if (!cpfRaw) erros.push("CPF obrigatório");
      else if (!cpfValido(cpfRaw)) erros.push("CPF inválido");
    } else if (cpfRaw && cpfRaw.replace(/\D/g, "").length !== 11) {
      erros.push("CPF não tem 11 dígitos");
    }

    const emailRaw = get("email");
    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) erros.push("e-mail inválido");

    const contratado = parseNumeroBR(get("valor_contratado_brl"));
    if (contratado.erro) erros.push(`valor contratado: ${contratado.erro}`);
    const pago = parseNumeroBR(get("valor_pago_brl"));
    if (pago.erro) erros.push(`valor pago: ${pago.erro}`);

    const dados: DadosImport = {
      nome_completo,
      data_nascimento: nasc.iso,
      cpf: cpfRaw || null,
      passaporte: get("passaporte") || null,
      validade_passaporte: val.iso,
      email: emailRaw || null,
      telefone: get("telefone") || null,
      tipo: coerceTipo(get("tipo")),
      status_reserva: coerceStatus(get("status_reserva"), statusPadrao),
      observacoes: get("observacoes") || null,
      valor_contratado_brl: contratado.num,
      valor_pago_brl: pago.num,
      expedicao_codigo: get("expedicao_codigo") || null,
    };

    return { linha: idx + 1, dados, erros };
  });

  return { linhas, erroGeral: null, colunasReconhecidas };
}

/** Só os dígitos do CPF (pra deduplicação). */
export function cpfDigitos(cpf: string | null): string | null {
  if (!cpf) return null;
  const d = cpf.replace(/\D/g, "");
  return d.length === 11 ? d : null;
}
