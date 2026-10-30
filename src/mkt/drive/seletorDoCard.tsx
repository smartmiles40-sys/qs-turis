// src/mkt/drive/seletorDoCard.tsx
// -----------------------------------------------------------------------------
// Encaixe do DrivePicker nos anexos do card do quadro (integração 30/10/2026).
// O quadro fala em ArquivoEscolhido (drive_file_id, nome, mime, url, thumb); o
// Drive devolve ArquivoDrive (id, nome, mimeType, webViewLink, thumbnailLink).
// A miniatura do Drive é um link assinado que vence em ~2 h — não vai pro
// banco; o card guarda o id e o link do Drive.
// O picker só é baixado quando alguém abre "Escolher do Drive".
// -----------------------------------------------------------------------------
import { lazy, Suspense } from "react";
import type { PropsSeletorDrive } from "../conteudo/seletorDrive";
import type { ArquivoDrive } from "./tipos";

const DrivePicker = lazy(() => import("./DrivePicker"));

export function SeletorDriveDoCard({ aberto, onEscolher, onFechar, multiplo = true }: PropsSeletorDrive) {
  if (!aberto) return null;
  return (
    <Suspense fallback={null}>
      <DrivePicker
        aberto={aberto}
        multiplo={multiplo}
        onFechar={onFechar}
        onEscolher={(arquivos: ArquivoDrive[]) =>
          onEscolher(arquivos.map((a) => ({
            drive_file_id: a.id,
            nome: a.nome,
            mime: a.mimeType || null,
            url: a.webViewLink || null,
            thumb: null,
          })))
        }
      />
    </Suspense>
  );
}
