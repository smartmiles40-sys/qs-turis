// src/venda/DadosDaPessoaNaVenda.tsx
// -----------------------------------------------------------------------------
// Quem comprou — o mínimo pra achar (ou criar) a ficha única do cliente.
// O banco procura por CPF → telefone → e-mail antes de criar (venda_cliente_resolver,
// 0214) e só COMPLETA o que a ficha não tem: nunca sobrescreve.
//
// Ficha já conhecida (veio da ficha/viagem/oportunidade): mostra o CadastroPessoa
// (0213) pra completar ali mesmo passaporte, validade, endereço e quem viaja junto.
// Pessoa nova: o formulário curto abaixo; a ficha nasce no venda_subir.
//
// "Pedir só o que falta" (Bruno 09/11): o que já está no lead ou na ficha única
// (CPF, nascimento…) chega PREENCHIDO e editável — `daFicha` diz quais campos
// vieram da ficha, pra tela avisar e não pedir de novo.
// -----------------------------------------------------------------------------
import { Campo, Entrada } from "@/rel/ui";
import type { PessoaVenda } from "./api";
import CadastroPessoa from "@/clientes/cadastro/CadastroPessoa";

const ROTULO: Record<string, string> = { telefone: "WhatsApp", email: "e-mail", cpf: "CPF", nascimento: "nascimento" };

export default function DadosDaPessoaNaVenda({ pessoa, onMudar, travada, daFicha = [] }: {
  pessoa: PessoaVenda;
  onMudar: (p: PessoaVenda) => void;
  /** A ficha já existe (veio da ficha/viagem): só mostra. */
  travada?: boolean;
  /** Campos que vieram preenchidos da ficha única do cliente. */
  daFicha?: string[];
}) {
  const set = (k: keyof PessoaVenda) => (e: React.ChangeEvent<HTMLInputElement>) => onMudar({ ...pessoa, [k]: e.target.value });
  const falta = (["telefone", "email", "cpf", "nascimento"] as const).filter((k) => !String(pessoa[k] ?? "").trim());
  const dica = (k: keyof PessoaVenda, normal: string) => (daFicha.includes(k) ? "Veio da ficha do cliente. Confira." : normal);
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
      {daFicha.length > 0 && (
        <p className="sm:col-span-2 text-[12.5px] rounded-lg px-3 py-2" style={{ background: "var(--rel-soft)", color: "var(--ink2)" }}>
          Já trouxe da ficha do cliente: <b>{daFicha.map((k) => ROTULO[k] ?? k).join(", ")}</b>.
          {falta.length ? <> Falta só: {falta.map((k) => ROTULO[k]).join(", ")} (opcional agora).</> : " Está tudo aqui — só conferir."}
        </p>
      )}
      <div className="sm:col-span-2">
        <Campo rotulo="Nome completo *" dica="Como no documento — é o nome que vai pra expedição e pro voucher.">
          <Entrada value={pessoa.nome} onChange={set("nome")} autoComplete="off" />
        </Campo>
      </div>
      <Campo rotulo="WhatsApp" dica={dica("telefone", "Com DDD. Ajuda a achar a ficha que já existe.")}>
        <Entrada inputMode="tel" value={pessoa.telefone} onChange={set("telefone")} placeholder="(11) 99999-9999" />
      </Campo>
      <Campo rotulo="E-mail" dica={daFicha.includes("email") ? "Veio da ficha do cliente. Confira." : undefined}>
        <Entrada type="email" value={pessoa.email} onChange={set("email")} />
      </Campo>
      <Campo rotulo="CPF" dica={dica("cpf", "Opcional agora.")}>
        <Entrada inputMode="numeric" value={pessoa.cpf} onChange={set("cpf")} placeholder="000.000.000-00" />
      </Campo>
      <Campo rotulo="Nascimento" dica={dica("nascimento", "Opcional agora.")}>
        <Entrada type="date" value={pessoa.nascimento} onChange={set("nascimento")} />
      </Campo>
    </div>
  );
}
