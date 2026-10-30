// src/rel/clientes/ficha/Passaportes.tsx
// -----------------------------------------------------------------------------
// Aba Documentos › "Passaportes": TODOS os números que a pessoa já passou (ficha,
// cada ida em expedição/pacote), com a validade e o alerta da regra dos 6 meses
// (vale 6 meses depois da VOLTA da próxima viagem; sem viagem, a partir de hoje).
// O atual é o da ficha (é o que o banco sincroniza com as viagens, 0172).
// -----------------------------------------------------------------------------
import { Card, StatusChip } from "@/components/ui";
import { formatarData, type Cliente } from "../../lib/clientes";
import { alertaSeisMeses, passaportesDaPessoa, type IdaCompleta } from "./fontes";

export default function Passaportes({ c, idas, voltaProxima, onPreencher }: {
  c: Cliente; idas: IdaCompleta[]; voltaProxima: string | null; onPreencher?: () => void;
}) {
  const lista = passaportesDaPessoa(c, idas);
  return (
    <Card title="Passaportes" action={onPreencher ? <button type="button" className="fc-link fc-link--btn" onClick={onPreencher}>Atualizar</button> : undefined}>
      {lista.length === 0 ? (
        <p className="fc-p">Nenhum passaporte informado ainda — nem na ficha, nem nas inscrições das viagens.</p>
      ) : (
        <ul className="fc-pessoas" aria-label="Passaportes informados">
          {lista.map((p) => {
            const a = alertaSeisMeses(p.validade, voltaProxima);
            return (
              <li key={p.numero} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="qs-num" style={{ fontWeight: 600 }}>{p.numero}</span>
                {p.atual && <StatusChip tone="ok">atual</StatusChip>}
                <span className="fc-bloco__s">{p.validade ? `vale até ${formatarData(p.validade)}` : "sem validade informada"}</span>
                {a && a.tom !== "ok" && <StatusChip tone={a.tom}>{a.texto}</StatusChip>}
                <span className="fc-bloco__s" style={{ flexBasis: "100%" }}>informado em: {p.fontes.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
