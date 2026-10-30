// src/mkt/drive/tipos.ts — formatos do Drive do Marketing (0241).

/** O que o DrivePicker devolve (contrato com o quadro de conteúdo). */
export interface ArquivoDrive {
  id: string;
  nome: string;
  mimeType: string;
  webViewLink: string;
  thumbnailLink?: string;
  tamanho?: number;
}

export type TipoArquivo = "pasta" | "video" | "imagem" | "audio" | "pdf" | "documento" | "outro";

/** Item como o servidor (api/mkt-drive.js) devolve. */
export interface ItemDrive {
  id: string;
  nome: string;
  mimeType: string;
  tipo: TipoArquivo;
  pastaId: string | null;
  webViewLink: string;
  previewLink: string;
  temMiniatura: boolean;
  miniaturaUrl: string | null;
  midiaUrl: string | null;
  tamanho?: number;
  duracaoMs?: number;
  criadoEm: string | null;
  modificadoEm: string | null;
  modificadoPor: string | null;
  naLixeira: boolean;
  tags: string[];
  destino: string | null;
  expedicaoId: string | null;
  observacao: string | null;
  subidoPor: string | null;
  descricao?: string | null;
  miniaturaGrandeUrl?: string | null;
}

export interface Migalha { id: string; nome: string }

export interface ExpedicaoOpcao { id: string; nome: string; destino: string | null; data_embarque: string | null }

export interface ConfigDrive {
  configurado: boolean;
  falta: string | null;
  estado: { ultima_sync: string | null; varrendo: boolean; ultimo_erro: string | null; arquivos_vistos: number } | null;
  tags: { tag: string; quantos: number }[];
  expedicoes: ExpedicaoOpcao[];
  raiz: Migalha | null;
}

export interface FiltrosBusca {
  texto: string;
  tipo: "" | Exclude<TipoArquivo, "outro">;
  desde: string;
  ate: string;
  tags: string[];
  expedicaoId: string;
  soNestaPasta: boolean;
}

export const FILTROS_VAZIOS: FiltrosBusca = { texto: "", tipo: "", desde: "", ate: "", tags: [], expedicaoId: "", soNestaPasta: false };

export function paraArquivoDrive(i: ItemDrive): ArquivoDrive {
  return {
    id: i.id,
    nome: i.nome,
    mimeType: i.mimeType,
    webViewLink: i.webViewLink,
    // Link do QS (assinado, vale ~2 h). Pra guardar em card, prefira o `id` e
    // peça a miniatura de novo ao mostrar.
    thumbnailLink: i.miniaturaUrl ?? undefined,
    tamanho: i.tamanho,
  };
}
