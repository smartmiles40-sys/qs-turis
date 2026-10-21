/**
 * Motor de alertas operacionais por passageiro.
 *
 * Em cima do motor de Prontidão (lib/prontidao/regras.ts): cada exigência que
 * está pendente (semáforo laranja/vermelho) vira um AVISO quando a expedição
 * entra na "janela" daquele tipo (ex.: passaporte a 60 dias do embarque).
 *
 * A tabela ALERTA_REGRAS é o ponto de configuração — ajuste as janelas aqui.
 */
import type { TipoRequisito } from "@/expedicoes/lib/database";
import type { Semaforo } from "@/expedicoes/lib/prontidao/regras";

export type SeveridadeAlerta = "critico" | "atencao";

export type RegraAlerta = {
  tipo: TipoRequisito;
  /** O aviso fica ativo quando faltam ≤ janelaDias para o embarque. */
  janelaDias: number;
  rotulo: string;
};

/**
 * Janelas padrão (dias antes do embarque). Quanto mais "demorado" de resolver,
 * maior a antecedência. Edite à vontade — é a configuração dos avisos.
 */
export const ALERTA_REGRAS: RegraAlerta[] = [
  // Passaporte NÃO espera a janela: aparece assim que estiver ausente ou
  // vencendo em ≤6 meses do último dia da viagem (emissão/renovação demora).
  { tipo: "Passaporte", janelaDias: Infinity, rotulo: "Passaporte ausente ou vence em ≤6 meses do retorno" },
  { tipo: "Visto", janelaDias: 60, rotulo: "Visto pendente" },
  { tipo: "Dados Pessoais", janelaDias: 60, rotulo: "Cadastro incompleto" },
  { tipo: "Aéreo Internacional", janelaDias: 60, rotulo: "Bilhete internacional não emitido" },
  { tipo: "Vacina", janelaDias: 45, rotulo: "Vacina / certificado pendente" },
  { tipo: "Seguro", janelaDias: 45, rotulo: "Seguro viagem pendente" },
  { tipo: "Aéreo Doméstico", janelaDias: 30, rotulo: "Trecho doméstico pendente" },
  { tipo: "RG", janelaDias: 30, rotulo: "RG pendente" },
  { tipo: "Contrato", janelaDias: 90, rotulo: "Contrato não assinado" },
  { tipo: "Autorização de Menor", janelaDias: 60, rotulo: "Autorização de menor pendente" },
];

const REGRA_POR_TIPO = new Map(ALERTA_REGRAS.map((r) => [r.tipo, r]));

export function regraDoTipo(tipo: TipoRequisito): RegraAlerta | undefined {
  return REGRA_POR_TIPO.get(tipo);
}

/**
 * Decide se uma exigência vira aviso agora. Retorna a severidade, ou null se
 * não há aviso (resolvido, fora da janela, ou sem regra para o tipo).
 */
export function avaliarAlerta(
  tipo: TipoRequisito,
  semaforo: Semaforo,
  diasAteEmbarque: number | null,
): SeveridadeAlerta | null {
  if (semaforo === "ok" || semaforo === "na") return null;
  if (diasAteEmbarque == null || diasAteEmbarque < 0) return null; // só futuras
  const regra = REGRA_POR_TIPO.get(tipo);
  if (!regra) return null;
  if (diasAteEmbarque > regra.janelaDias) return null; // ainda fora da janela
  return semaforo === "bloqueio" ? "critico" : "atencao";
}
