// src/lib/qs/versaoDoApp.ts
// -----------------------------------------------------------------------------
// APOSENTADO em 27/10/2026: o vigia de versão agora é global e mora em
// src/lib/versao.ts (ligado no main.tsx, vale pra todas as áreas, compara o
// /version.json do build e recarrega SOZINHO num momento seguro, com a faixa
// "Nova versão do QS — atualizando em instantes").
//
// Esta função continua existindo só porque o AvisoDeVersao (SdrLayout e
// CloserApp) ainda a chama. Ela não consulta nada e nunca avisa: se avisasse,
// apareceriam duas faixas e dois vigias perguntando a mesma coisa ao servidor.
// Quando as frentes do SDR/Closer tirarem o <AvisoDeVersao />, apagar este arquivo.
// -----------------------------------------------------------------------------

type Listener = (novaVersao: boolean) => void;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function vigiarVersao(_onNovaVersao: Listener): () => void {
  return () => {};
}
