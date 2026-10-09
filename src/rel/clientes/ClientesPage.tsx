// src/rel/clientes/ClientesPage.tsx
// Lista de clientes com busca por nome, CPF, telefone, e-mail ou passaporte.
import { useEffect, useState } from "react";
import { buscarClientes, formatarCpf, formatarTelefone, mesesParaVencer, type Cliente } from "../lib/clientes";
import { Avatar, Botao, Entrada, Etiqueta, Vazio } from "../ui";
import ClienteForm from "./ClienteForm";

export default function ClientesPage({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const r = await buscarClientes(termo);
        if (vivo) { setLista(r); setErro(null); }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não consegui carregar os clientes.");
      } finally {
        if (vivo) setCarregando(false);
      }
    }, termo ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [termo]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Clientes</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Uma ficha por pessoa — documentos, contato e família.</p>
        </div>
        <Botao variante="primario" onClick={() => setNovo(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Novo cliente
        </Botao>
      </div>

      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <Entrada
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar por nome, CPF, telefone, e-mail ou passaporte"
          style={{ paddingLeft: 36 }}
          aria-label="Buscar clientes"
        />
      </div>

      <div className="rel-card overflow-hidden">
        {erro ? (
          <p className="p-5 text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>
        ) : carregando && lista.length === 0 ? (
          <p className="p-5 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : lista.length === 0 ? (
          termo ? (
            <Vazio titulo="Ninguém encontrado" texto={`Nenhuma ficha bate com "${termo}".`} acao={<Botao variante="primario" onClick={() => setNovo(true)}>Criar ficha</Botao>} />
          ) : (
            <Vazio
              titulo="Nenhum cliente ainda"
              texto="Cadastre o primeiro cliente. Cada pessoa tem UMA ficha — o sistema avisa se você tentar criar alguém que já existe."
              acao={<Botao variante="primario" onClick={() => setNovo(true)}>Novo cliente</Botao>}
            />
          )
        ) : (
          <ul>
            {lista.map((c, i) => {
              const meses = mesesParaVencer(c.passaporte_validade);
              return (
                <li key={c.id} style={{ borderTop: i ? "1px solid var(--line2)" : undefined }}>
                  <button onClick={() => onAbrir(c.id)} className="rel-linha w-full flex items-center gap-3 px-4 py-3 text-left transition-colors">
                    <Avatar nome={c.nome} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{c.nome}</span>
                      <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                        {[c.cpf && formatarCpf(c.cpf), c.telefone && formatarTelefone(c.telefone), c.email].filter(Boolean).join(" · ") || "Sem documento nem contato"}
                      </span>
                    </span>
                    <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
                      {c.titular_id && <Etiqueta tom="rel">Família</Etiqueta>}
                      {meses !== null && meses < 0 && <Etiqueta tom="erro">Passaporte vencido</Etiqueta>}
                      {meses !== null && meses >= 0 && meses < 6 && <Etiqueta tom="aviso">Passaporte vence em {meses || "<1"} mês{meses > 1 ? "es" : ""}</Etiqueta>}
                      {!c.lgpd_consentimento_em && <Etiqueta>Sem LGPD</Etiqueta>}
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {lista.length >= 100 && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Mostrando os 100 primeiros em ordem alfabética — use a busca para achar alguém.</p>
      )}

      <ClienteForm
        aberto={novo}
        onFechar={() => setNovo(false)}
        onSalvo={(c) => { setNovo(false); onAbrir(c.id); }}
        onAbrirFicha={(id) => { setNovo(false); onAbrir(id); }}
      />
    </div>
  );
}
