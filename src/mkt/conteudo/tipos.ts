// src/mkt/conteudo/tipos.ts — formato das linhas das tabelas mkt_* (0240).

export type TipoColuna = "livre" | "entrada" | "aprovacao" | "ajustes" | "aprovado" | "publicado";
export type TipoConteudo = "reels" | "carrossel" | "story" | "video_longo" | "post" | "criativo_anuncio" | "campanha" | "outro";
export type Origem = "organico" | "trafego";
export type StatusAprovacao = "sem" | "pendente" | "aprovado" | "devolvido";

export interface Coluna {
  id: string;
  nome: string;
  ordem: number;
  cor: string | null;
  tipo: TipoColuna;
}

export interface ItemChecklist { id: string; texto: string; feito: boolean }

export interface CardMkt {
  id: string;
  titulo: string;
  descricao: string | null;
  tipo: TipoConteudo;
  origem: Origem;
  eh_pedido: boolean;
  coluna_id: string;
  ordem: number;
  responsavel_id: string | null;
  solicitante_id: string | null;
  prazo: string | null;            // "AAAA-MM-DD"
  data_publicacao: string | null;  // "AAAA-MM-DD"
  expedicao_id: string | null;
  destino: string | null;
  tags: string[];
  checklist: ItemChecklist[];
  link_publicacao: string | null;
  /** Planejamento (0395): horário de postar, perfis onde vai, origem e link do Canva da agência. */
  horario?: string | null;
  perfil_ids?: string[];
  planejamento_item_id?: string | null;
  da_agencia?: boolean;
  link_producao?: string | null;
  original_id: string | null;
  rodada: number;
  status_aprovacao: StatusAprovacao;
  aprovado_por: string | null;
  aprovado_em: string | null;
  arquivado: boolean;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  /** Contagens que a lista traz junto (não são colunas). */
  n_anexos?: number;
  n_comentarios?: number;
  thumb?: string | null;
}

export interface Comentario { id: string; card_id: string; autor_id: string | null; texto: string; tipo: "comentario" | "devolucao" | "aprovacao"; criado_em: string }
export interface Anexo { id: string; card_id: string; drive_file_id: string | null; nome: string; mime: string | null; url: string | null; thumb: string | null; criado_por: string | null; criado_em: string }
export interface Historico { id: number; card_id: string; user_id: string | null; acao: string; detalhe: string | null; criado_em: string }
export interface Aprovacao { id: string; card_id: string; rodada: number; enviado_por: string | null; enviado_em: string; decisao: "aprovado" | "devolvido" | null; decidido_por: string | null; decidido_em: string | null; comentario: string | null }
export interface DestinoExp { id: string; nome: string; destino: string | null; tipo: string | null; data_embarque: string | null }

export const NOME_TIPO: Record<TipoConteudo, string> = {
  reels: "Reels",
  carrossel: "Carrossel",
  story: "Story",
  video_longo: "Vídeo longo",
  post: "Post",
  criativo_anuncio: "Criativo de anúncio",
  campanha: "Campanha",
  outro: "Outro",
};
export const TIPOS: TipoConteudo[] = ["reels", "carrossel", "story", "video_longo", "post", "criativo_anuncio", "campanha", "outro"];

export const NOME_ORIGEM: Record<Origem, string> = { organico: "Orgânico", trafego: "Tráfego" };

export const NOME_TIPO_COLUNA: Record<TipoColuna, string> = {
  livre: "Etapa de trabalho",
  entrada: "Entrada (cards novos e pedidos)",
  aprovacao: "Em aprovação",
  ajustes: "Ajustes (devolvidos)",
  aprovado: "Aprovado",
  publicado: "Publicado / Entregue",
};
