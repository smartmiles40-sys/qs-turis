// src/mkt/drive/DrivePicker.tsx
// -----------------------------------------------------------------------------
// Escolher arquivo(s) do Drive do Marketing de qualquer tela do QS — o quadro
// de conteúdo usa nos anexos dos cards. Mesmo navegador da tela "Drive" (pastas,
// busca, filtros, subir arquivo), só que clicar num arquivo SELECIONA.
//
//   <DrivePicker aberto={x} onFechar={...} onEscolher={(arquivos) => ...} multiplo />
//
// `thumbnailLink` devolvido é um link assinado do QS (vale ~2 h): pra guardar
// no card, guarde o `id` e o `webViewLink`; a miniatura se pede de novo.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import type { ArquivoDrive, ConfigDrive, ItemDrive } from "./tipos";
import { paraArquivoDrive } from "./tipos";
import * as api from "./api";
import { Navegador } from "./Navegador";
import { Botao, Modal } from "./ui";

export type { ArquivoDrive } from "./tipos";

export interface DrivePickerProps {
  aberto: boolean;
  onFechar: () => void;
  onEscolher: (arquivos: ArquivoDrive[]) => void;
  multiplo?: boolean;
}

export function DrivePicker({ aberto, onFechar, onEscolher, multiplo = false }: DrivePickerProps) {
  const [config, setConfig] = useState<ConfigDrive | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [selecao, setSelecao] = useState<Map<string, ItemDrive>>(new Map());

  useEffect(() => {
    if (!aberto) return;
    setSelecao(new Map());
    if (!config) api.lerConfig().then(setConfig).catch((e) => setErro((e as Error).message));
  }, [aberto, config]);

  const ids = useMemo(() => new Set(selecao.keys()), [selecao]);

  const alternar = (item: ItemDrive) => {
    if (!multiplo) {
      onEscolher([paraArquivoDrive(item)]);
      onFechar();
      return;
    }
    setSelecao((m) => {
      const n = new Map(m);
      if (n.has(item.id)) n.delete(item.id); else n.set(item.id, item);
      return n;
    });
  };

  const confirmar = () => {
    onEscolher([...selecao.values()].map(paraArquivoDrive));
    onFechar();
  };

  return (
    <Modal
      aberto={aberto}
      titulo={multiplo ? "Escolher arquivos do Drive" : "Escolher arquivo do Drive"}
      onFechar={onFechar}
      largura={1100}
      cheio
      rodape={multiplo ? (
        <>
          <span className="mr-auto self-center text-[12.5px]" style={{ color: "var(--ink3)" }}>
            {selecao.size ? `${selecao.size} selecionado${selecao.size > 1 ? "s" : ""}` : "Clique nos arquivos pra selecionar"}
          </span>
          <Botao onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={confirmar} disabled={!selecao.size}>Anexar</Botao>
        </>
      ) : undefined}
    >
      {erro && <p className="text-[13px] mb-2" role="alert" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!config && !erro && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}
      {config && <Navegador modo="escolha" config={config} selecionados={ids} onAlternar={alternar} />}
    </Modal>
  );
}

export default DrivePicker;
