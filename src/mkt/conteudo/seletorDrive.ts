// src/mkt/conteudo/seletorDrive.ts
// -----------------------------------------------------------------------------
// PONTO DE ENCAIXE DO DRIVE (frente Drive, 0241).
//
// Hoje o card só aceita LINK colado. Quando o `DrivePicker` existir, a integração
// registra o seletor UMA vez (por ex. no topo de src/mkt/drive/rotas.ts):
//
//   import { registrarSeletorDrive } from "../conteudo/seletorDrive";
//   registrarSeletorDrive(DrivePicker);
//
// e o botão "Escolher do Drive" aparece sozinho nos anexos do card. O seletor
// recebe `onEscolher(arquivos)` e `onFechar()`; cada arquivo vira uma linha de
// mkt_anexos (drive_file_id, nome, mime, url, thumb).
// -----------------------------------------------------------------------------
import type { ComponentType } from "react";

export interface ArquivoEscolhido {
  drive_file_id: string;
  nome: string;
  mime?: string | null;
  url?: string | null;
  thumb?: string | null;
}

export interface PropsSeletorDrive {
  aberto: boolean;
  onEscolher: (arquivos: ArquivoEscolhido[]) => void;
  onFechar: () => void;
  /** Vários de uma vez (padrão: sim). */
  multiplo?: boolean;
}

let seletor: ComponentType<PropsSeletorDrive> | null = null;

export function registrarSeletorDrive(c: ComponentType<PropsSeletorDrive>) {
  seletor = c;
}
export function seletorDrive(): ComponentType<PropsSeletorDrive> | null {
  return seletor;
}
