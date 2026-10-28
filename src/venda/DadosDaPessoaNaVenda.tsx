// src/venda/DadosDaPessoaNaVenda.tsx
// -----------------------------------------------------------------------------
// Quem comprou — o mínimo pra achar (ou criar) a ficha única do cliente.
// O banco procura por CPF → telefone → e-mail antes de criar (venda_cliente_resolver,
// 0214) e só COMPLETA o que a ficha não tem: nunca sobrescreve.
//
// Ficha já conhecida (veio da ficha/viagem/oportunidade): mostra o CadastroPessoa
// (0213) pra completar ali mesmo passaporte, validade, endereço e quem viaja junto.
// Pessoa nova: o formulário curto abaixo; a ficha nasce no venda_subir.
// -----------------------------------------------------------------------------
import { Campo, Entrada } from "@/rel/ui";
import type { PessoaVenda } from "./api";
import CadastroPessoa from "@/clientes/cadastro/CadastroPessoa";

export default function DadosDaPessoaNaVenda({ pessoa, onMudar, travada }: {
  pessoa: PessoaVenda;
  onMudar: (p: PessoaVenda) => void;
  /** A ficha já existe (veio da ficha/viagem): só mostra. */
  travada?: boolean;
}) {
  const set = (k: keyof PessoaVenda) => (e: React.ChangeEvent<HTMLInputElement>) => onMudar({ ...pessoa, [k]: e.target.value });
  if (travada && pessoa.id) return <CadastroPessoa clienteId={pessoa.id} />;
  if (travada) {
    return (
      <div className="rel-card p-4">
        <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{pessoa.nome}</p>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          {[pessoa.telefone, pessoa.email].filter(Boolean).join(" · ") || "Ficha do cliente já cadastrada"}
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <Campo rotulo="Nome completo *" dica="Como no documento — é o nome que vai pra expedição e pro voucher.">
          <Entrada value={pessoa.nome} onChange={set("nome")} autoComplete="off" />
        </Campo>
      </div>
      <Campo rotulo="WhatsApp" dica="Com DDD. Ajuda a achar a ficha que já existe.">
        <Entrada inputMode="tel" value={pessoa.telefone} onChange={set("telefone")} placeholder="(11) 99999-9999" />
      </Campo>
      <Campo rotulo="E-mail">
        <Entrada type="email" value={pessoa.email} onChange={set("email")} />
      </Campo>
      <Campo rotulo="CPF" dica="Opcional agora.">
        <Entrada inputMode="numeric" value={pessoa.cpf} onChange={set("cpf")} placeholder="000.000.000-00" />
      </Campo>
      <Campo rotulo="Nascimento" dica="Opcional agora.">
        <Entrada type="date" value={pessoa.nascimento} onChange={set("nascimento")} />
      </Campo>
    </div>
  );
}
