// src/components/sdr/cadences/duplicateSource.ts
// -----------------------------------------------------------------------------
// Ponte mínima entre o botão "Duplicar" do card (CadencesPage) e o builder
// (CadenceCreatePage): guarda o id da cadência de ORIGEM por uma navegação.
// O SdrLayout roteia pro builder com cadenceId = null (modo criação) — este
// módulo evita mexer no roteamento compartilhado só pra passar um parâmetro.
//
// Em memória de propósito (não persiste reload): duplicar é uma ação imediata;
// se o usuário recarregar a página, o builder abre em branco, como sempre.
// -----------------------------------------------------------------------------

let sourceId: string | null = null;

/** Marca a cadência de origem da duplicação (chamado pelo card, antes de navegar). */
export function setDuplicateSource(id: string): void {
  sourceId = id;
}

/** Lê e LIMPA a origem (consumo único, chamado pelo builder ao montar em modo criação). */
export function consumeDuplicateSource(): string | null {
  const id = sourceId;
  sourceId = null;
  return id;
}

/**
 * Só LÊ a origem, sem limpar. Serve pro inicializador do useState do builder:
 * no StrictMode (dev) o componente monta→desmonta→remonta e o inicializador roda
 * DUAS vezes; se ele limpasse (consume), o 2º mount — o que fica — leria null e o
 * "Duplicar" abriria em branco. O builder lê com peek e limpa uma vez num effect.
 */
export function peekDuplicateSource(): string | null {
  return sourceId;
}

/** Limpa a origem (chamado pelo builder num effect, após o commit). */
export function clearDuplicateSource(): void {
  sourceId = null;
}
