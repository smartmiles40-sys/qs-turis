// api/_expChecklist.js
// -----------------------------------------------------------------------------
// Checklist padrão das EXPEDIÇÕES (23 processos operacionais + subtarefas) do
// lado do servidor — usado quando o Bitrix cria uma expedição nova pelo
// webhook (api/expedicoes.js ?acao=expedicao-sync). No portal antigo isso
// falhava calado (rodava sem sessão e a RLS barrava); aqui grava de verdade
// com a service_role, pela mesma função do banco que a tela usa
// (exp_gerar_checklist, 0162).
//
// ⚠️ CÓPIA da lista de src/expedicoes/lib/processos/template.ts (as funções da
// Vercel não importam o TS do front). Mudou lá? Mude aqui também.
// Prazo = embarque − (referência da fase − 2 dias por processo seguinte da fase);
// subtarefa herda o prazo do pai. Mesma conta de src/expedicoes/checklist/dados.ts.
// -----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

// Dias de referência por fase (FASES_CHECKLIST em src/expedicoes/lib/constants.ts).
const REFERENCIA = {
  'Após o fechamento': 300,
  '12 a 6 meses': 240,
  '6 a 2 meses': 120,
  '2 meses a 15 dias': 35,
  'Na semana': 5,
  'Pós-viagem': -7,
};

const P = (etapa, tarefa, prioridade, subtarefas = []) => ({ etapa, tarefa, prioridade, subtarefas });

export const PROCESSOS_EXPEDICAO = [
  P('Após o fechamento', 'Atualizar Planilha de Controle da Expedição', 'Média'),

  P('12 a 6 meses', 'Criar alerta do voo principal e fazer emissão', 'Crítica',
    ['Criar alerta de preço do voo principal', 'Acompanhar variação de tarifa', 'Definir melhor data de emissão', 'Emitir bilhetes do voo principal', 'Conferir localizadores']),
  P('12 a 6 meses', 'Monitorar e reservar hotéis', 'Alta',
    ['Levantar opções de hotel por cidade', 'Comparar tarifas e política de cancelamento', 'Fazer pré-reserva', 'Confirmar reserva', 'Salvar confirmação']),
  P('12 a 6 meses', 'Falar com fornecedores para reservar passeios', 'Alta',
    ['Listar passeios do roteiro', 'Cotar com fornecedores/DMC', 'Reservar passeios', 'Confirmar disponibilidade']),
  P('12 a 6 meses', 'Comprar voos internos', 'Alta',
    ['Mapear trechos internos do roteiro', 'Emitir voos internos']),
  P('12 a 6 meses', 'Alimentar Planilha Controle de Expedições', 'Média',
    ['Lançar custos reservados', 'Atualizar status de cada item']),
  P('12 a 6 meses', 'Checar hospedagens mais baratas', 'Média',
    ['Revisar tarifas atuais', 'Comparar alternativas', 'Trocar se houver economia']),

  P('6 a 2 meses', 'Conferir se todos os voos estão confirmados', 'Crítica',
    ['Conferir voo principal', 'Conferir voos internos', 'Validar localizadores', 'Conferir bagagem incluída', 'Conferir assentos']),
  P('6 a 2 meses', 'Salvar nova confirmação de hospedagem', 'Alta',
    ['Solicitar reconfirmação aos hotéis', 'Salvar vouchers atualizados']),
  P('6 a 2 meses', 'Confirmar passeios e horários dos transfers', 'Alta',
    ['Confirmar horários de transfer com DMC']),
  P('6 a 2 meses', 'Travel Design', 'Média',
    ['Montar roteiro visual day-by-day', 'Revisar com o time']),
  P('6 a 2 meses', 'Confirmar com clientes documentação', 'Alta',
    ['Conferir validade de passaportes', 'Conferir necessidade de visto']),
  P('6 a 2 meses', 'Caixa Brinde e Logomarca', 'Baixa',
    ['Definir itens da caixa de brinde', 'Aprovar arte da logomarca', 'Solicitar produção', 'Conferir recebimento', 'Separar por passageiro']),

  P('2 meses a 15 dias', 'Conferir se todos os voos estão confirmados', 'Crítica',
    ['Reconferir voo principal', 'Reconferir voos internos', 'Validar localizadores', 'Conferir alterações de malha', 'Conferir assentos']),
  P('2 meses a 15 dias', 'Verificar última possibilidade de troca de hospedagens', 'Média',
    ['Revisar tarifas finais', 'Trocar se houver ganho real', 'Atualizar vouchers']),
  P('2 meses a 15 dias', 'Confirmar passeios e horários dos Transfers', 'Alta',
    ['Reconfirmar horários com DMC']),
  P('2 meses a 15 dias', 'Receber Travel Design', 'Média',
    ['Receber arte final do Travel Design', 'Revisar conteúdo']),
  P('2 meses a 15 dias', 'Colocar todas as informações no app', 'Alta'),
  P('2 meses a 15 dias', 'Checar restrições alimentares para voo e preferência de assentos pagos', 'Média'),

  P('Na semana', 'Imprimir todas as reservas de passagens pra Luis', 'Alta', ['Imprimir bilhetes aéreos']),
  P('Na semana', 'Imprimir todas as hospedagens por pessoa', 'Alta', ['Imprimir vouchers de hospedagem por passageiro']),
  P('Na semana', 'Imprimir os vouchers dos passeios para líderes', 'Alta'),
  P('Na semana', 'Reunião de apresentação da Expedição', 'Crítica'),
];

/** "AAAA-MM-DD" menos N dias (data pura, sem fuso). */
function menosDias(iso, dias) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() - dias);
  return t.toISOString().slice(0, 10);
}

/**
 * Monta os itens no formato que exp_gerar_checklist(p_expedicao, p_itens) espera.
 * `responsavelId` = quem fica com as tarefas (o operacional padrão), ou null.
 */
export function montarChecklistPadrao(dataEmbarque, responsavelId) {
  const itens = [];
  const ordemPorFase = new Map();
  for (const proc of PROCESSOS_EXPEDICAO) {
    const ordem = (ordemPorFase.get(proc.etapa) || 0) + 1;
    ordemPorFase.set(proc.etapa, ordem);
    const base = REFERENCIA[proc.etapa] ?? 30;
    const prazo = dataEmbarque ? menosDias(dataEmbarque, base - (ordem - 1) * 2) : null;
    const pai = randomUUID();
    itens.push({ id: pai, etapa: proc.etapa, tarefa: proc.tarefa, responsavel_id: responsavelId || null, prazo, prioridade: proc.prioridade, parent_id: null, ordem });
    proc.subtarefas.forEach((sub, i) => {
      itens.push({ id: randomUUID(), etapa: proc.etapa, tarefa: sub, responsavel_id: responsavelId || null, prazo, prioridade: proc.prioridade, parent_id: pai, ordem: i + 1 });
    });
  }
  return itens;
}
