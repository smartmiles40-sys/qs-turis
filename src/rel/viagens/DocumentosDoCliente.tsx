// src/rel/viagens/DocumentosDoCliente.tsx
// A seção "Documentos" da ficha: tudo do cliente (de todas as viagens), envio
// pelo time e o link pra ele mandar sozinho.
import { useEffect, useState } from "react";
import { carregarCliente } from "../lib/clientes";
import DocumentosPainel, { type Pessoa } from "./DocumentosPainel";

export default function DocumentosDoCliente({ clienteId }: { clienteId: string }) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  useEffect(() => {
    carregarCliente(clienteId)
      .then((c) => setPessoas(c ? [{ id: c.id, nome: c.nome }] : []))
      .catch(() => setPessoas([]));
  }, [clienteId]);
  return <DocumentosPainel pessoas={pessoas} clienteId={clienteId} />;
}
