// src/rel/config/CategoriasConfig.tsx
// -----------------------------------------------------------------------------
// Regras das categorias do cliente (Bronze / Silver / Black / Green) e a meta
// de contato de cada uma. Fica em rel_config ('categorias' e
// 'contato_meta_dias'); a view rel_cliente_metricas recalcula na hora.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import {
  METAS_PADRAO, REGRAS_PADRAO, carregarRegras, regraDoNivel, salvarRegras,
  type MetasContato, type Nivel, type RegrasCategorias,
} from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada } from "../ui";

export default function CategoriasConfig({ pode }: { pode: boolean }) {
  const [regras, setRegras] = useState<RegrasCategorias>(REGRAS_PADRAO);
  const [metas, setMetas] = useState<MetasContato>(METAS_PADRAO);
  const [pronto, setPronto] = useState(false);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Se a leitura falhar, NÃO deixa salvar: senão o padrão da tela iria por cima da config real.
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);

  useEffect(() => {
    carregarRegras()
      .then((r) => { setRegras(r.regras); setMetas(r.metas); })
      .catch((e) => setErroLeitura(e instanceof Error ? e.message : "Não consegui ler as regras."))
      .finally(() => setPronto(true));
  }, []);

  const mudarNivel = (i: number, p: Partial<Nivel>) =>
    setRegras((r) => ({ ...r, niveis: r.niveis.map((n, j) => (j === i ? { ...n, ...p } : n)) }));

  async function salvar() {
    if (erroLeitura) return;
    // números inteiros (a view não aceita "45.5" nem negativo)
    for (const n of regras.niveis) {
      if (!Number.isInteger(n.min_viagens) || n.min_viagens < 0 || n.min_viagens > 99) {
        setMsg({ tom: "erro", t: `${n.nome}: mínimo de viagens tem que ser um número inteiro de 0 a 99.` }); return;
      }
      if (!Number.isInteger(n.min_valor) || n.min_valor < 0) {
        setMsg({ tom: "erro", t: `${n.nome}: mínimo de gasto tem que ser em reais inteiros (sem centavos), 0 ou mais.` }); return;
      }
    }
    if (Object.values(metas).some((d) => !Number.isInteger(d) || d < 1 || d > 3650)) {
      setMsg({ tom: "erro", t: "As metas de contato são em dias inteiros, de 1 a 3650." }); return;
    }
    // cada nível tem que pedir mais que o anterior, senão o de cima nunca aparece
    for (let i = 1; i < regras.niveis.length; i++) {
      const a = regras.niveis[i - 1], b = regras.niveis[i];
      const usaViagens = regras.criterio !== "valor";
      const usaValor = regras.criterio !== "viagens";
      if ((usaViagens && b.min_viagens < a.min_viagens) || (usaValor && b.min_valor < a.min_valor)) {
        setMsg({ tom: "erro", t: `${b.nome} precisa pedir pelo menos o mesmo que ${a.nome}.` });
        return;
      }
    }
    if (regras.niveis.some((n) => n.min_viagens < 1 && regras.criterio !== "valor")) {
      setMsg({ tom: "erro", t: "Toda categoria precisa de pelo menos 1 viagem." });
      return;
    }
    setSalvando(true);
    setMsg(null);
    try {
      await salvarRegras(regras, metas);
      setMsg({ tom: "ok", t: "Regras salvas — as categorias já foram recalculadas." });
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não salvou." });
    } finally {
      setSalvando(false);
    }
  }

  if (!pronto) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;
  if (erroLeitura) return <Aviso tom="erro">Não consegui ler as regras das categorias ({erroLeitura}). Recarregue a página antes de mudar — salvar agora apagaria a configuração atual.</Aviso>;

  return (
    <fieldset disabled={!pode} className="space-y-4 disabled:opacity-70">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo rotulo="O que define a categoria">
          <select className="rel-input" value={regras.criterio} onChange={(e) => setRegras({ ...regras, criterio: e.target.value as RegrasCategorias["criterio"] })}>
            <option value="viagens">Número de viagens</option>
            <option value="valor">Valor gasto</option>
            <option value="viagens_ou_valor">Viagens OU valor (o que bater primeiro)</option>
          </select>
        </Campo>
        <Campo rotulo="Quais viagens contam" dica="Compradas = toda venda não cancelada. Realizadas = só as que já voltaram.">
          <select className="rel-input" value={regras.contar} onChange={(e) => setRegras({ ...regras, contar: e.target.value as RegrasCategorias["contar"] })}>
            <option value="compradas">Compradas</option>
            <option value="realizadas">Já realizadas</option>
          </select>
        </Campo>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[11px] text-left" style={{ color: "var(--ink3)" }}>
              <th className="font-semibold py-1">Categoria</th>
              <th className="font-semibold">Mín. viagens</th>
              <th className="font-semibold">Mín. gasto (R$)</th>
              <th className="font-semibold">Meta de contato (dias)</th>
              <th className="font-semibold">Regra</th>
            </tr>
          </thead>
          <tbody>
            {regras.niveis.map((n, i) => (
              <tr key={n.id} style={{ borderTop: "1px solid var(--line2)" }}>
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: "var(--ink)" }}>
                    <input type="color" value={n.cor} onChange={(e) => mudarNivel(i, { cor: e.target.value })} aria-label={`Cor de ${n.nome}`}
                      className="w-5 h-5 rounded border-0 p-0 bg-transparent cursor-pointer" />
                    {n.nome}
                  </span>
                </td>
                <td className="pr-2"><Entrada type="number" min={1} max={99} step={1} value={n.min_viagens} style={{ width: 80 }}
                  disabled={regras.criterio === "valor"} onChange={(e) => mudarNivel(i, { min_viagens: Number(e.target.value) })} /></td>
                <td className="pr-2"><Entrada type="number" min={0} step={1000} value={n.min_valor} style={{ width: 120 }}
                  disabled={regras.criterio === "viagens"} onChange={(e) => mudarNivel(i, { min_valor: Number(e.target.value) })} /></td>
                <td className="pr-2"><Entrada type="number" min={1} max={3650} step={1} value={metas[n.id]} style={{ width: 80 }}
                  onChange={(e) => setMetas({ ...metas, [n.id]: Number(e.target.value) })} /></td>
                <td className="text-[12px]" style={{ color: "var(--ink3)" }}>{regraDoNivel(n, regras)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "1px solid var(--line2)" }}>
              <td className="py-1.5 font-semibold" style={{ color: "var(--ink2)" }}>Sem categoria</td>
              <td colSpan={2} className="text-[12px]" style={{ color: "var(--ink3)" }}>quem ainda não tem viagem</td>
              <td><Entrada type="number" min={1} max={3650} step={1} value={metas.sem_categoria} style={{ width: 80 }}
                onChange={(e) => setMetas({ ...metas, sem_categoria: Number(e.target.value) })} /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {pode && (
        <div className="flex items-center gap-3">
          <Botao type="button" variante="primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar categorias"}</Botao>
          {msg && <span className="text-[13px]" style={{ color: msg.tom === "ok" ? "var(--rel-ink)" : "var(--err-ink)" }}>{msg.t}</span>}
        </div>
      )}
    </fieldset>
  );
}
