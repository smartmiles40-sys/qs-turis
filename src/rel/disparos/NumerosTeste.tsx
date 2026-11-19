// src/rel/disparos/NumerosTeste.tsx
// -----------------------------------------------------------------------------
// NÚMEROS DE TESTE do Relacionamento (19/11): até 10 WhatsApps (nome + número)
// configurados uma vez. "Mandar teste" (disparo simples) e "Testar" (fluxo)
// mandam pra todos eles de uma vez, de verdade, mesmo com a simulação ligada
// (só precisa da env REL_DISPARO_ENVIO=1). Fica em qs_settings, vale pro time.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { Botao, Entrada } from "@/rel/ui";
import { salvarNumerosTesteRel, type NumeroTeste } from "./oficialRel";

const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);
const digitos = (v: string) => v.replace(/\D/g, "");
const mostrar = (tel: string) => {
  const d = tel.replace(/^55(?=\d{10,11}$)/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : tel;
};

export default function NumerosTeste({ atuais, podeEditar, onMudou }: { atuais: NumeroTeste[]; podeEditar: boolean; onMudou: () => void }) {
  const [lista, setLista] = useState<NumeroTeste[]>(atuais);
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => setLista(atuais), [atuais]);

  async function gravar(nova: NumeroTeste[], msg: string) {
    setOcupado(true);
    try { const r = await salvarNumerosTesteRel(nova); setLista(r.numeros); notifySuccess(msg); onMudou(); }
    catch (e) { notifyError(erroDe(e, "Não salvou.")); }
    finally { setOcupado(false); }
  }
  function adicionar() {
    const d = digitos(tel);
    if (d.length < 10 || d.length > 13) return notifyError("Número inválido: DDD + número.");
    if (lista.some((n) => digitos(n.telefone).endsWith(d.slice(-8)))) return notifyError("Esse número já está na lista.");
    if (lista.length >= 10) return notifyError("No máximo 10 números de teste.");
    void gravar([...lista, { nome: nome.trim() || "Teste", telefone: d }], "Número de teste adicionado.").then(() => { setNome(""); setTel(""); });
  }

  return (
    <div className="rel-card space-y-3 p-4">
      <div>
        <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>Números de teste</p>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          O “Mandar teste” do disparo e o “Testar” do fluxo vão pra <b>todos estes números</b>, de verdade, mesmo com a simulação ligada. Cada um recebe com o próprio nome no {"{{nome}}"}.
        </p>
      </div>
      {!lista.length ? <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum ainda. Sem número aqui, o teste pergunta pra qual número mandar.</p> : (
        <ul className="space-y-1">
          {lista.map((n) => (
            <li key={n.telefone} className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
              <span className="font-medium">{n.nome}</span>
              <span className="tabular-nums" style={{ color: "var(--ink3)" }}>{mostrar(n.telefone)}</span>
              {podeEditar && (
                <button type="button" className="ml-auto px-1.5 text-[16px] leading-none" style={{ color: "var(--ink3)" }} aria-label={`Tirar ${n.nome}`} disabled={ocupado}
                  onClick={() => void gravar(lista.filter((x) => x.telefone !== n.telefone), "Número tirado.")}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeEditar ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[140px]"><Entrada value={nome} placeholder="Nome (ex.: Bruno)" aria-label="Nome" onChange={(e) => setNome(e.target.value)} /></div>
          <div className="min-w-[160px] flex-1"><Entrada value={tel} placeholder="DDD + número" aria-label="WhatsApp" inputMode="tel" onChange={(e) => setTel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") adicionar(); }} /></div>
          <Botao disabled={ocupado || digitos(tel).length < 10} onClick={adicionar}>Adicionar</Botao>
        </div>
      ) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só gestor ou admin muda a lista.</p>}
    </div>
  );
}
