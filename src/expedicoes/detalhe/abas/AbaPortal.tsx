// Aba "ExpedAmigo" — editor do portal do viajante (app antigo:
// expedicoes/[id]/portal/PortalEditor.tsx + actions.ts). O que se preenche
// aqui aparece pro passageiro em /amigo, que continua no app antigo lendo ESTE
// banco — por isso as colunas e convenções são as mesmas (ver portal/dados.ts).
// Seções: liberar para todos (admin), voucher da hospedagem, extensões, roteiro
// dia a dia (fotos + passeios opcionais), voos de grupo, passeios e ingressos,
// informações do destino e avisos. Perfil só leitura vê só o aviso (como no antigo).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PropsAba } from "../ExpedicaoDetalhe";
import { useExp } from "../../contexto";
import { Carregando, Selo } from "../../ui";
import { supabase } from "../../lib/banco";
import { ordenarVoosCronologico } from "../../lib/portal-voos";
import { formatDate } from "../../lib/utils";
import { linksEmLote } from "../../drive/arquivos";
import { IconeSvg } from "../../drive/icones";
import { carregarPortal, SEG_BASE, type ConteudoPortal } from "../../portal/dados";
import { Secao, type CampoPortal } from "../../portal/Secao";
import { VoucherAnexo, VoucherHospedagem } from "../../portal/Anexos";
import { RoteiroInline, type Par } from "../../portal/RoteiroInline";
import { LiberarTodos } from "../../portal/LiberarTodos";

export default function AbaPortal({ exp }: PropsAba) {
  const { somenteLeitura, avisar } = useExp();
  const [c, setC] = useState<ConteudoPortal | null>(null);
  const [admin, setAdmin] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    try { setC(await carregarPortal(exp.id)); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao carregar o portal", "erro"); }
  }, [exp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!somenteLeitura) void carregar(); }, [carregar, somenteLeitura]);
  useEffect(() => { supabase.rpc("exp_eh_admin").then(({ data }) => setAdmin(Boolean(data))); }, []);

  // Miniaturas (fotos do roteiro e dos passeios opcionais).
  useEffect(() => {
    if (!c) return;
    const ids = [...c.fotos.map((f) => f.arquivo_id), ...c.passeiosOpcionais.map((p) => p.foto_arquivo_id)].filter(Boolean) as string[];
    const caminhos = ids.map((id) => c.arquivos.get(id)?.storage_path).filter((p): p is string => Boolean(p) && !links[p as string]);
    if (caminhos.length) linksEmLote(caminhos).then((m) => setLinks((s) => ({ ...s, ...m }))).catch(() => {});
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const extensoes = c?.extensoes ?? [];
  const grupos = c?.grupos ?? [];
  const paresExtensao: Par[] = useMemo(() => [
    { value: "", label: "Grupo principal (todos veem)" },
    { value: SEG_BASE, label: "Só quem NÃO fez extensão (ex.: último dia / volta do grupo)" },
    ...extensoes.map((e) => ({ value: e.id, label: e.nome })),
  ], [extensoes]);
  const segmentoLabel = useCallback((ext: string | null, base: boolean) => {
    if (ext) return extensoes.find((e) => e.id === ext)?.nome ?? null;
    return base ? "Só quem não estende" : null;
  }, [extensoes]);
  const nomeGrupo = useMemo(() => new Map(grupos.map((g) => [g.id, g.nome])), [grupos]);

  const cabecalho = (
    <div>
      <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Portal do ExpedAmigo</h2>
      <p className="text-[12.5px] mt-0.5" style={{ color: "var(--ink3)" }}>O que você preencher aqui aparece para o passageiro em <span className="font-mono">/amigo</span>.</p>
    </div>
  );

  if (somenteLeitura) {
    return (
      <div className="space-y-3">
        {cabecalho}
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-[13px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          <IconeSvg nome="olho" /> <span>Modo leitura — a edição do conteúdo do ExpedAmigo fica disponível apenas para perfis de edição (admin/operação).</span>
        </div>
      </div>
    );
  }
  if (!c) return <Carregando />;

  const arq = (id: string | null | undefined) => (id ? c.arquivos.get(id) : undefined);
  const voosGrupo = ordenarVoosCronologico(c.voos.filter((v) => !v.passageiro_id));
  const voosIndividuais = c.voos.filter((v) => v.passageiro_id).length;
  const temGrupos = grupos.length >= 2;
  const temExtensoes = extensoes.length > 0;
  const badgeSeg = (ext: string | null, base: boolean) => {
    const s = segmentoLabel(ext, base);
    return s ? <span className="ml-1.5"><Selo tom="lista">{s}</Selo></span> : null;
  };
  const linha2 = (t: string) => <div className="text-[11.5px] truncate" style={{ color: "var(--ink3)" }}>{t}</div>;
  const ok = (t: string) => <span style={{ color: "#16A34A" }}> · {t} ✓</span>;
  const salveAntes = (o: string) => <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Salve {o} primeiro para anexar.</p>;

  const camposVoo: CampoPortal[] = [
    { key: "trecho", label: "Trecho", type: "text", required: true, placeholder: "Ida / Volta / Interno" },
    { key: "companhia", label: "Companhia", type: "text" },
    { key: "numero_voo", label: "Nº do voo", type: "text" },
    { key: "localizador", label: "Localizador", type: "text" },
    { key: "origem", label: "Origem", type: "text", placeholder: "São Paulo (GRU)" },
    { key: "destino", label: "Destino", type: "text", placeholder: "Lima (LIM)" },
    { key: "partida", label: "Partida", type: "text", placeholder: "12/08/2026 23:50", dica: "Com dia/mês/ano o voo entra na ordem certa no portal." },
    { key: "chegada", label: "Chegada", type: "text", placeholder: "13/08/2026 03:10" },
    { key: "observacoes", label: "Observações", type: "textarea", full: true },
    ...(temGrupos ? [{ key: "grupo_id", label: "Voo de qual grupo?", type: "select" as const, full: true, opcoesPares: [{ value: "", label: "Todos os grupos" }, ...grupos.map((g) => ({ value: g.id, label: `Só ${g.nome}` }))] }] : []),
    ...(temExtensoes ? [{ key: "extensao_id", label: "Faz parte de", type: "select" as const, full: true, opcoesPares: paresExtensao }] : []),
  ];

  return (
    <div className="space-y-4">
      {cabecalho}
      {admin && <LiberarTodos expedicaoId={exp.id} />}

      <VoucherHospedagem expedicaoId={exp.id} arquivoId={c.hospedagemVoucherArquivoId} arquivo={arq(c.hospedagemVoucherArquivoId)} onMudou={carregar} />

      <Secao tabela="extensoes" titulo="Extensões da viagem" icone="rota" expedicaoId={exp.id} onMudou={carregar}
        descricao="Dias extras que só um subgrupo faz (Mar Vermelho, Alexandria…). Depois marque quem contratou no perfil do passageiro, e amarre dias/voos à extensão."
        itens={c.extensoes}
        campos={[
          { key: "nome", label: "Nome da extensão", type: "text", required: true, full: true, placeholder: "Extensão Mar Vermelho — +3 dias" },
          { key: "descricao", label: "Descrição (aparece no topo da extensão no portal)", type: "textarea", full: true },
        ]}
        anexos={(r) => [r.hospedagem_voucher_arquivo_id]}
        resumo={(r) => <>
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.nome}{r.hospedagem_voucher_arquivo_id && ok("hospedagem")}</div>
          {linha2(r.descricao ?? "Sem descrição")}
        </>}
        extra={(item) => {
          if (!item) return salveAntes("a extensão");
          const atual = c.extensoes.find((e) => e.id === item.id);
          return <VoucherAnexo tabela="extensoes" expedicaoId={exp.id} itemId={item.id} rotulo="Voucher da hospedagem" campo="hospedagem_voucher_arquivo_id"
            arquivoId={atual?.hospedagem_voucher_arquivo_id ?? null} arquivo={arq(atual?.hospedagem_voucher_arquivo_id)} onMudou={carregar} />;
        }} />

      <RoteiroInline expedicaoId={exp.id} c={c} links={links} paresExtensao={paresExtensao} segmentoLabel={segmentoLabel} onMudou={carregar} />

      <Secao tabela="expedicao_voos" titulo="Voos de grupo" icone="aviao" expedicaoId={exp.id} onMudou={carregar}
        descricao="Voos da expedição (ida, volta, internos), em ordem cronológica."
        itens={voosGrupo} campos={camposVoo}
        anexos={(r) => [r.arquivo_id]}
        resumo={(r) => <>
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
            {r.trecho}: {r.origem ?? "—"} → {r.destino ?? "—"}{r.arquivo_id && ok("voucher")}
            {r.grupo_id && nomeGrupo.get(r.grupo_id) && <span className="ml-1.5"><Selo tom="aviso">{nomeGrupo.get(r.grupo_id)}</Selo></span>}
            {badgeSeg(r.extensao_id, r.apenas_sem_extensao)}
          </div>
          {linha2([r.companhia, r.numero_voo, r.partida].filter(Boolean).join(" · ") || "sem detalhes")}
        </>}
        rodape={voosIndividuais > 0 ? <p className="mt-2 text-[11.5px]" style={{ color: "var(--ink3)" }}>
          + {voosIndividuais} voo(s) individual(is) de passageiros — esses ficam no perfil de cada passageiro (quem tem voo próprio vê só os dele no portal).</p> : undefined}
        extra={(item) => item ? <VoucherAnexo tabela="expedicao_voos" expedicaoId={exp.id} itemId={item.id}
          arquivoId={c.voos.find((v) => v.id === item.id)?.arquivo_id ?? null} arquivo={arq(c.voos.find((v) => v.id === item.id)?.arquivo_id)} onMudou={carregar} /> : salveAntes("o voo")} />

      <Secao tabela="expedicao_passeios" titulo="Passeios e ingressos" icone="ticket" expedicaoId={exp.id} onMudou={carregar}
        descricao="Atividades, passeios e entradas."
        itens={c.passeios}
        campos={[
          { key: "nome", label: "Nome", type: "text", required: true, full: true },
          { key: "data", label: "Data", type: "date" },
          { key: "horario", label: "Horário", type: "text", placeholder: "06:00" },
          { key: "local", label: "Local", type: "text", full: true },
          { key: "observacoes", label: "Observações", type: "textarea", full: true },
        ]}
        anexos={(r) => [r.arquivo_id]}
        resumo={(r) => <>
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.nome}{r.arquivo_id && ok("voucher")}</div>
          {linha2([r.data ? formatDate(r.data) : null, r.horario, r.local].filter(Boolean).join(" · ") || "sem detalhes")}
        </>}
        extra={(item) => item ? <VoucherAnexo tabela="expedicao_passeios" expedicaoId={exp.id} itemId={item.id}
          arquivoId={c.passeios.find((p) => p.id === item.id)?.arquivo_id ?? null} arquivo={arq(c.passeios.find((p) => p.id === item.id)?.arquivo_id)} onMudou={carregar} /> : salveAntes("o passeio")} />

      <Secao tabela="expedicao_info" titulo="Informações do destino" icone="info" expedicaoId={exp.id} onMudou={carregar}
        descricao="Blocos de dicas: moeda, clima, tomadas, vistos…"
        itens={c.info}
        campos={[
          { key: "titulo", label: "Título", type: "text", required: true, full: true, placeholder: "Moeda e câmbio" },
          { key: "conteudo", label: "Conteúdo", type: "textarea", required: true, full: true },
        ]}
        anexos={(r) => [r.arquivo_id, r.arquivo_id_2]}
        resumo={(r) => <>
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}{(r.arquivo_id || r.arquivo_id_2) && ok("PDF")}</div>
          {linha2(r.conteudo)}
        </>}
        extra={(item) => {
          if (!item) return salveAntes("a informação");
          const b = c.info.find((x) => x.id === item.id);
          return <>
            <VoucherAnexo tabela="expedicao_info" expedicaoId={exp.id} itemId={item.id} categoria="Outros" rotulo="PDF 1" campo="arquivo_id"
              arquivoId={b?.arquivo_id ?? null} arquivo={arq(b?.arquivo_id)} labelCampo="arquivo_label" labelValor={b?.arquivo_label ?? null} onMudou={carregar} />
            <VoucherAnexo tabela="expedicao_info" expedicaoId={exp.id} itemId={item.id} categoria="Outros" rotulo="PDF 2" campo="arquivo_id_2"
              arquivoId={b?.arquivo_id_2 ?? null} arquivo={arq(b?.arquivo_id_2)} labelCampo="arquivo_label_2" labelValor={b?.arquivo_label_2 ?? null} onMudou={carregar} />
          </>;
        }} />

      <Secao tabela="expedicao_avisos" titulo="Avisos e boas práticas" icone="megafone" expedicaoId={exp.id} onMudou={carregar}
        descricao="Substitui o PDF: avisos, boas práticas e dicas da viagem."
        itens={c.avisos}
        campos={[
          { key: "tipo", label: "Tipo", type: "select", opcoes: ["Aviso", "Boa prática", "Dica"] },
          { key: "titulo", label: "Título", type: "text", required: true, full: true },
          { key: "conteudo", label: "Conteúdo", type: "textarea", required: true, full: true },
        ]}
        resumo={(r) => <>
          <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}><span className="mr-1.5"><Selo>{r.tipo ?? "Aviso"}</Selo></span>{r.titulo}</div>
          {linha2(r.conteudo)}
        </>} />
    </div>
  );
}
