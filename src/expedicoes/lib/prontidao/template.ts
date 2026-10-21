/**
 * Builder de requisitos por passageiro.
 *
 * Instancia, a partir do catálogo do destino, as exigências que precisam de
 * acompanhamento manual/evidência (Seguro, Visto, Vacina, RG, Aéreo…). Os tipos
 * derivados de coluna (Passaporte, Pagamento, Contrato, Dados Pessoais —
 * REQUISITOS_DE_COLUNA) NÃO viram instância: a prontidão deles é calculada
 * direto dos campos do passageiro em lib/prontidao/regras.ts.
 *
 * Espelha o builder de checklist (lib/processos/template.ts): puro, sem I/O,
 * devolve linhas prontas pra inserir.
 */
import type { PassageiroRow, PassageiroRequisitoRow } from "@/expedicoes/lib/database";
import { requisitosDoDestino } from "@/expedicoes/lib/prontidao/requisitos-destino";
import { REQUISITOS_DE_COLUNA } from "@/expedicoes/lib/prontidao/regras";

export type RequisitosPadraoParams = {
  passageiro: PassageiroRow;
  destino: string;
  idPrefix?: string;
  createdAt?: string;
};

export function construirRequisitosPadrao(
  params: RequisitosPadraoParams,
): PassageiroRequisitoRow[] {
  const { passageiro, destino, idPrefix, createdAt } = params;
  const now = createdAt ?? new Date().toISOString();
  let seq = 0;
  const mkId = () =>
    idPrefix
      ? `${idPrefix}-${String(++seq).padStart(3, "0")}`
      : `pr${Math.random().toString(36).slice(2, 14).padEnd(12, "0")}`;

  return requisitosDoDestino(destino)
    .filter((t) => !REQUISITOS_DE_COLUNA.has(t.tipo))
    .map((t) => {
      // Pré-preenche o que já se sabe do passageiro.
      let status: PassageiroRequisitoRow["status"] = "Pendente";
      let numero: string | null = null;

      if (t.tipo === "Aéreo Internacional") {
        numero = passageiro.localizador;
        status = passageiro.localizador ? "Aprovado" : "Pendente";
      } else if (t.tipo === "Aéreo Doméstico") {
        // Sem voo doméstico no roteiro → dispensa a exigência.
        status = passageiro.voo_nacional_necessario ? "Pendente" : "Dispensado";
      }

      return {
        id: mkId(),
        passageiro_id: passageiro.id,
        tipo: t.tipo,
        descricao: t.descricao,
        status,
        obrigatoriedade: t.obrigatoriedade,
        bloqueia_embarque: t.bloqueia_embarque,
        validade: null,
        numero,
        arquivo_id: null,
        responsavel_id: null,
        verificado_em: null,
        verificado_por: null,
        observacoes: t.observacoes ?? null,
        created_at: now,
        updated_at: now,
      };
    });
}
