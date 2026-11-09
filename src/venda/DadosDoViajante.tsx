// src/venda/DadosDoViajante.tsx
// -----------------------------------------------------------------------------
// "Dados pro contrato e pro Operacional" de quem viaja junto: vínculo com o
// comprador, CPF, nascimento, e-mail e — se for menor de idade na viagem — quem
// assina por ele(a). Um componente só, usado pela expedição (BlocoExpedicao) e
// pelos outros itens da venda (QuemViaja, 0351). Regras: ./vendaRegras.
// -----------------------------------------------------------------------------
import { Campo, Entrada } from "@/rel/ui";
import { VINCULOS_VIAJANTE, menorDeIdade, type Viajante, type VinculoViajante } from "./vendaRegras";

/** O que falta de quem viaja junto (o comprador tem a ficha dele no passo 1). */
export function faltaDoViajante(v: Viajante): string[] {
  if (v.comprador) return [];
  return [!v.vinculo && "vínculo", !v.cpf.trim() && "CPF", !v.nascimento && "nascimento", !v.email.trim() && "e-mail"].filter((x): x is string => !!x);
}

export default function DadosDoViajante({ v, viajantes, nomeComprador, dataViagem, onMudar }: {
  v: Viajante;
  /** Todos da venda (pra escolher quem assina pelo menor). */
  viajantes: Viajante[];
  nomeComprador: string;
  /** Embarque/1ª data da viagem: menor de idade é contado nela (sem data, hoje). */
  dataViagem?: string | null;
  onMudar: (p: Partial<Viajante>) => void;
}) {
  if (v.comprador) return null;
  const menor = menorDeIdade(v.nascimento, dataViagem);
  const falta = faltaDoViajante(v);
  const adultos = viajantes.filter((x) => x.chave !== v.chave && !x.comprador && menorDeIdade(x.nascimento, dataViagem) !== true && x.nome.trim());
  return (
    <details className="sm:col-span-2 rounded-lg px-3 py-2" style={{ border: "1px dashed var(--line)" }} open={!!menor}>
      <summary className="text-[12.5px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>
        Dados pro contrato e pro Operacional (opcional)
        <span className="font-normal" style={{ color: falta.length ? "var(--err-ink)" : "var(--ink3)" }}>
          {" — "}{falta.length ? `falta: ${falta.join(", ")}` : "completo"}
        </span>
      </summary>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        <Campo rotulo={`É o quê de ${nomeComprador || "quem comprou"}?`}>
          <select className="rel-input" value={v.vinculo} onChange={(e) => onMudar({ vinculo: e.target.value as VinculoViajante })}>
            <option value="">Escolha…</option>
            {Object.entries(VINCULOS_VIAJANTE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="CPF"><Entrada inputMode="numeric" placeholder="000.000.000-00" value={v.cpf} onChange={(e) => onMudar({ cpf: e.target.value })} /></Campo>
        <Campo rotulo="Nascimento"
          dica={menor ? "Menor de idade na viagem: o contrato dele(a) é assinado pelo pai/mãe ou responsável." : undefined}>
          <Entrada type="date" value={v.nascimento} onChange={(e) => onMudar({ nascimento: e.target.value })} />
        </Campo>
        <Campo rotulo="E-mail"><Entrada type="email" value={v.email} onChange={(e) => onMudar({ email: e.target.value })} /></Campo>
        {menor && (
          <div className="sm:col-span-2">
            <Campo rotulo="Quem assina por ele(a)?" dica="Pai, mãe ou responsável legal. Vai pro contrato e pro Operacional.">
              <select className="rel-input" value={v.responsavel ?? ""} onChange={(e) => onMudar({ responsavel: e.target.value })}>
                <option value="">{nomeComprador || "Quem comprou"} (comprador)</option>
                {adultos.map((a) => <option key={a.chave} value={a.chave}>{a.nome}</option>)}
              </select>
            </Campo>
          </div>
        )}
      </div>
    </details>
  );
}
