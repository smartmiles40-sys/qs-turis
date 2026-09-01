// src/components/sdr/agenda/CampoBitrixId.tsx
// -----------------------------------------------------------------------------
// O CAMPO "ID DO NEGÓCIO NO BITRIX" DO AGENDAMENTO.
//
// Existe por causa da Beatrice Bessa (01/09): a reunião foi agendada num card
// sem `bitrix_id` e o negócio 41785 nunca saiu do lugar. Nada falhou — o
// `bitrix_error` ficou nulo porque não houve tentativa, e o comercial só ia
// descobrir quando o cliente entrasse numa call que ninguém sabia que existia.
//
// SÓ APARECE QUANDO FALTA. Lead que já tem o negócio vinculado não vê campo
// nenhum: pedir de novo o que o sistema já sabe é como se ensina o time a
// preencher qualquer coisa pra passar da tela.
//
// SÓ ENTRA NÚMERO (Bruno, 01/09). No Bitrix o negócio aparece como "#41785", e
// era questão de tempo até alguém colar o `#` junto — id com lixo não casa com
// negócio nenhum e o efeito seria o mesmo de não ter preenchido. O campo limpa
// enquanto se digita, em vez de recusar depois: colar "#41785" é a coisa certa
// feita do jeito natural, não um erro do usuário.
// -----------------------------------------------------------------------------

import { somenteDigitos } from "@/lib/qs/meetings";

interface Props {
  /** Valor atual (só dígitos). */
  value: string;
  onChange: (v: string) => void;
  /** O lead já tem negócio vinculado? Então o campo não aparece. */
  jaVinculado: boolean;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}

export default function CampoBitrixId({
  value,
  onChange,
  jaVinculado,
  disabled,
  className,
  labelClassName,
}: Props) {
  if (jaVinculado) return null;

  const inputCls =
    className ??
    "w-full px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0147FF]/20 focus:border-[#0147FF] transition-colors";
  const labelCls = labelClassName ?? "block text-xs font-medium text-gray-700 mb-1";

  return (
    <div>
      <label className={labelCls}>
        ID do negócio no Bitrix <span className="text-red-500">*</span>
      </label>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // `pattern` + inputMode fazem o teclado do celular abrir numérico. O
        // type continua "text" de propósito: com type="number" o navegador
        // aceita "e", "+" e "-", e some com zeros à esquerda.
        pattern="[0-9]*"
        maxLength={12}
        className={inputCls}
        placeholder="41785"
        value={value}
        disabled={disabled}
        // Limpa na digitação: quem colar "#41785" vê "41785" aparecer.
        onChange={(e) => onChange(somenteDigitos(e.target.value))}
      />
      <p className="mt-1 text-[11px] text-gray-500">
        Só números — sem o <code>#</code>. É o número do negócio no Bitrix; sem ele
        a reunião não chega no card e o especialista não fica sabendo.
      </p>
    </div>
  );
}
