import type { SaudePassageiro } from "@/expedicoes/lib/database";

type SaudeCampoKey = keyof SaudePassageiro;

export type PerguntaSaude = {
  campo: SaudeCampoKey;
  pergunta: string;
  /** Rótulo curto — usado no resumo read-only (Área do Líder). */
  curto: string;
  detalheCampo?: SaudeCampoKey;
  detalhePergunta?: string;
  /** 2º detalhe (texto) também exibido quando a resposta é "Sim". */
  detalhe2Campo?: SaudeCampoKey;
  detalhe2Pergunta?: string;
};

/** Perguntas do bloco Saúde — Sim/Não + detalhe condicional (quando "Sim"). */
export const PERGUNTAS_SAUDE: PerguntaSaude[] = [
  { campo: "problema_saude", curto: "Problema de saúde", pergunta: "Você possui algum problema de saúde relevante?", detalheCampo: "problema_saude_qual", detalhePergunta: "Qual seria o problema de saúde?" },
  { campo: "medicamento_diario", curto: "Medicamento diário", pergunta: "Você toma algum medicamento diariamente?", detalheCampo: "medicamento_diario_qual", detalhePergunta: "Qual seria o medicamento?", detalhe2Campo: "medicamento_refrigeracao", detalhe2Pergunta: "Esses medicamentos precisam de refrigeração ou do transporte de algum equipamento/seringa para aplicação? Se sim, descreva." },
  { campo: "alergia_medicamento", curto: "Alergia a medicamento", pergunta: "Possui alergia a medicamento?", detalheCampo: "alergia_medicamento_qual", detalhePergunta: "Qual medicamento você tem alergia?" },
  { campo: "anafilaxia_emergencia", curto: "Anafilaxia (já foi à emergência)", pergunta: "Já teve algum episódio de anafilaxia que precisou procurar emergência?" },
  { campo: "alergia_alimentar", curto: "Alergia alimentar", pergunta: "Possui alergia alimentar?", detalheCampo: "alergia_alimentar_qual", detalhePergunta: "Qual seria o alimento que você tem alergia?" },
  { campo: "restricao_alimentar", curto: "Restrição alimentar", pergunta: "Possui restrição alimentar?", detalheCampo: "restricao_alimentar_qual", detalhePergunta: "Qual alimento você possui restrição alimentar?" },
  { campo: "limitacao_fisica", curto: "Limitação física", pergunta: "Possui limitação física que possa impactar caminhadas ou deslocamentos?", detalheCampo: "limitacao_fisica_qual", detalhePergunta: "Qual limitação física?" },
  { campo: "cirurgia_importante", curto: "Cirurgia/internação (12 meses)", pergunta: "Já realizou alguma cirurgia importante ou teve que ficar internado nos últimos 12 meses?", detalheCampo: "cirurgia_qual", detalhePergunta: "Qual o motivo?" },
  { campo: "gravidez", curto: "Grávida", pergunta: "Está grávida?", detalheCampo: "gravidez_semanas", detalhePergunta: "De quantas semanas?" },
  { campo: "enjoo_transporte", curto: "Enjoa em avião/barco/ônibus", pergunta: "Costuma enjoar em avião, barco ou ônibus?" },
  { campo: "medo_altura", curto: "Medo de altura", pergunta: "Tem medo intenso de altura, teleférico ou atividades específicas?" },
  { campo: "ronca_cpap", curto: "Sono (ronco/CPAP/leve)", pergunta: "Tem algo no seu sono que a gente precise considerar na divisão dos quartos? (ronco, CPAP, sono muito leve)", detalheCampo: "ronca_cpap_qual", detalhePergunta: "Se sim, qual?" },
  { campo: "vacina_febre_amarela", curto: "Certificado de Febre Amarela", pergunta: "Você possui o Certificado Internacional de Vacinação contra Febre Amarela?" },
];

export type ItemSaudeResumo = { curto: string; detalhe: string | null; alerta: boolean };

/**
 * Resumo read-only da saúde: só os itens SINALIZADOS ("Sim") + os detalhes.
 * `alerta` = item de atenção clínica (tudo, menos ter o certificado de febre
 * amarela, que é um ponto positivo). Usado na Área do Líder.
 */
export function resumoSaude(saude: SaudePassageiro | null | undefined): ItemSaudeResumo[] {
  if (!saude) return [];
  const out: ItemSaudeResumo[] = [];
  for (const q of PERGUNTAS_SAUDE) {
    if ((saude[q.campo] ?? "") !== "Sim") continue;
    const partes: string[] = [];
    if (q.detalheCampo && saude[q.detalheCampo]) partes.push(String(saude[q.detalheCampo]));
    if (q.detalhe2Campo && saude[q.detalhe2Campo]) partes.push(String(saude[q.detalhe2Campo]));
    out.push({ curto: q.curto, detalhe: partes.join(" · ") || null, alerta: q.campo !== "vacina_febre_amarela" });
  }
  return out;
}
