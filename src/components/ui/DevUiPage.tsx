// src/components/ui/DevUiPage.tsx
// Vitrine das peças base do redesign (HANDOFF.md, etapa 2): /dev/ui, só no
// `vite dev` (não entra no build de produção — ver App.tsx). Dados fictícios.
import { useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Alert, Avatar, Badge, Board, BoardCard, BoardColumn, Button, DataTable, EmptyState, KpiCard,
  ListRow, Page, PageHeader, ProgressBar, SearchInput, Segmented, StatusDot, Stepper,
} from "./index";
import { Icon } from "./icons";

const LINHAS = [
  { id: "1", nome: "Ana Lima", cpf: "•••.•••.938-43", cat: "Silver", ltv: "R$ 96.300", tone: "ok" as const },
  { id: "2", nome: "Bruno Costa", cpf: "•••.•••.112-07", cat: "Bronze", ltv: "R$ 40.900", tone: "danger" as const },
  { id: "3", nome: "Carla Mendes", cpf: "•••.•••.551-90", cat: "Sem categoria", ltv: "R$ 0", tone: "warn" as const },
];

export default function DevUiPage() {
  const { isDark, toggleTheme } = useTheme();
  const [aba, setAba] = useState<"todos" | "ativos" | "arquivo">("todos");
  return (
    <div style={{ background: "var(--bg)", minHeight: "100dvh" }}>
      <Page>
        <PageHeader crumb="Dev · Componentes" title="Peças base do redesign" subtitle="Tudo em tokens. Troque o tema pra conferir o contraste."
          actions={<>
            <Button onClick={toggleTheme} icon={isDark ? Icon.sol : Icon.lua}>{isDark ? "Modo claro" : "Modo noite"}</Button>
            <Button variant="primary" icon={Icon.mais}>Ação principal</Button>
          </>} />

        <section className="qs-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <span className="qs-label">Button</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary">Primário</Button><Button>Secundário</Button><Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Excluir</Button><Button icon={Icon.telefone}>Com ícone</Button>
            <Button size="sm">Pequeno</Button><Button disabled>Desligado</Button><Button aria-label="Mais ações" icon={Icon.tres} />
          </div>
          <span className="qs-label">Badge e StatusDot</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Badge>Neutro</Badge><Badge tone="danger">Atrasado</Badge><Badge tone="warn">Conferir</Badge>
            <Badge tone="ok">Pago</Badge><Badge tone="info">Agendado</Badge><Badge tone="ok" dot>Com pontinho</Badge>
            <StatusDot tone="danger" label="Atrasado" /><StatusDot tone="warn" label="Vence logo" /><StatusDot tone="ok" label="Pronto" /><StatusDot tone="info" label="Em andamento" />
          </div>
          <span className="qs-label">Segmented e SearchInput</span>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <Segmented label="Filtro" value={aba} onChange={setAba}
              options={[{ value: "todos", label: "Todos", count: 128 }, { value: "ativos", label: "Ativos", count: 97 }, { value: "arquivo", label: "Arquivados", count: 31 }]} />
            <SearchInput placeholder="Nome, CPF, telefone, e-mail ou passaporte" />
          </div>
          <span className="qs-label">ProgressBar, Stepper, Avatar</span>
          <ProgressBar value={44} label="Meta do mês" />
          <ProgressBar value={92} tone="ok" label="Cadastro" />
          <Stepper current={3} />
          <div style={{ display: "flex", gap: 8 }}><Avatar name="Master" /><Avatar name="Victor Hugo" /><Avatar name="Talita Carvalho" size={40} /></div>
        </section>

        <Alert tone="danger" action={<Button>Atender agora</Button>}><b>18 leads novos</b> esperando o primeiro contato. O mais antigo chegou há 23h52.</Alert>
        <Alert tone="warn">3 viagens embarcam em 7 dias com documento pendente.</Alert>

        <div className="qs-kpis">
          <KpiCard label="Clientes ativos" value="1.284" hint="+32 este mês" onClick={() => undefined} />
          <KpiCard label="Viagens sem dono" value="38" tone="danger" hint="Assumir agora" onClick={() => undefined} />
          <KpiCard label="Cadastro completo" value="71%" tone="warn" hint="meta 90%" />
          <KpiCard label="Pagos hoje" value="R$ 48.200" tone="ok" />
        </div>

        <DataTable minWidth={640} rowKey={(r) => r.id} onRowClick={() => undefined} rows={LINHAS}
          footer={<><span>3 de 1.284</span><span style={{ display: "flex", gap: 6 }}><Button size="sm">Anterior</Button><Button size="sm">Próxima</Button></span></>}
          columns={[
            { key: "n", header: "Cliente", render: (r) => <span style={{ display: "flex", gap: 10, alignItems: "center" }}><Avatar name={r.nome} /><span style={{ fontWeight: 600 }}>{r.nome}</span></span> },
            { key: "c", header: "CPF", render: (r) => <span className="qs-num qs-tone-muted">{r.cpf}</span> },
            { key: "k", header: "Categoria", render: (r) => <Badge>{r.cat}</Badge> },
            { key: "s", header: "Status", render: (r) => <StatusDot tone={r.tone} label={r.tone} /> },
            { key: "l", header: "LTV", align: "right", render: (r) => <span className="qs-num">{r.ltv}</span> },
          ]} />

        <section className="qs-card">
          <ListRow tone="danger" title="Confirmar hotel em Reykjavik" meta="Islândia · Camila Torres" due="venceu ontem" dueTone="danger" action={<Button size="sm">Resolver</Button>} />
          <ListRow tone="warn" title="Conferir passaporte" meta="Marrocos · Juliana Prado" due="em 2 dias" dueTone="warn" action={<Button size="sm">Abrir</Button>} />
          <ListRow tone="info" title="Check-in online" meta="Japão · Gustavo Lins" due="sex, 30/10" action={<Button size="sm">Abrir</Button>} />
        </section>

        <Board>
          <BoardColumn title="Novos" count={2} hint="Ninguém pegou ainda">
            <BoardCard number="#1042" origin="Comercial" title="Cotação de pacote Japão" client="Ana Lima" due="hoje 17h" dueTone="warn" owner={null} />
            <BoardCard number="#1043" origin="Rel" title="Segunda via de boleto" client="Bruno Costa" due="há 2 dias" dueTone="danger" owner="Talita" />
          </BoardColumn>
          <BoardColumn title="Em andamento" count={1}>
            <BoardCard number="#1038" origin="Financeiro" title="Reembolso de taxa" client="Carla Mendes" due="amanhã" owner="Victor" />
          </BoardColumn>
          <BoardColumn title="Aguardando ajustes" count={0} empty="Nada aguardando ajustes" />
        </Board>

        <section className="qs-card">
          <EmptyState title="Nenhuma viagem sem dono" description="Quando uma venda nova chegar sem responsável, ela aparece aqui." action={<Button>Assumir viagens sem dono</Button>} />
        </section>
      </Page>
    </div>
  );
}
