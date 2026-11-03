// src/components/sdr/leads/ficha/CadenciaSdr.tsx
// -----------------------------------------------------------------------------
// Card "Cadência SDR" da ficha (desenho de 03/11): barra de dias + as tarefas de
// hoje marcáveis. Quem decide o que o clique faz é a LeadDetailPage (onMarcar):
// WhatsApp/e-mail/etc. concluem aqui; LIGAÇÃO pede a classificação e o próximo
// passo, que moram na Fila de hoje — o card não inventa um atalho que pule isso.
// -----------------------------------------------------------------------------
import type { Cadence, CadenceDay, Task } from "../../types";
import { CHANNEL_LABELS } from "../../types";
import { IcCheck } from "./icones";
import { diaDaCadencia, ehLigacao, horaDe, tarefaAberta, tarefasDeHoje } from "./regras";

export default function CadenciaSdr({
  cadence, cadenceDays, iniciadaEm, tasks, ocupadoId, onMarcar, onVerCompleta, onRemover, removendo, temCadencia,
}: {
  cadence: Cadence | null;
  cadenceDays: CadenceDay[];
  iniciadaEm: string | null;
  tasks: Task[];
  ocupadoId: string | null;
  onMarcar: (t: Task) => void;
  onVerCompleta: () => void;
  onRemover: () => void;
  removendo: boolean;
  temCadencia: boolean;
}) {
  const agora = new Date();
  const total = cadenceDays.reduce((m, d) => Math.max(m, d.day_number), 0);
  const dia = diaDaCadencia(iniciadaEm, total, agora);
  const hoje = tarefasDeHoje(tasks, agora);
  const feitas = hoje.filter((t) => t.status === "concluida").length;

  return (
    <section className="fl-card" aria-label="Cadência SDR">
      <div className="fl-card__topo">
        <h2>Cadência SDR</h2>
        <span className="fl-card__meta">
          {dia ? `Dia ${dia.dia} de ${dia.total}${dia.acabou ? " · terminou" : ""}` : temCadencia ? "sem data de início" : "sem cadência"}
        </span>
      </div>
      {cadence?.name && <p className="fl-mudo" style={{ marginTop: -8 }}>{cadence.name}</p>}

      {dia && (
        <div className="fl-barras" style={{ gridTemplateColumns: `repeat(${dia.total}, minmax(0, 1fr))` }}
          role="img" aria-label={`Dia ${dia.dia} de ${dia.total} da cadência`}>
          {Array.from({ length: dia.total }, (_, i) => (
            <div key={i} className={`fl-barra${i + 1 < dia.dia || dia.acabou ? " fl-barra--feito" : i + 1 === dia.dia ? " fl-barra--agora" : ""}`} />
          ))}
        </div>
      )}

      <span className="fl-rotulo">Tarefas de hoje · {feitas} de {hoje.length}</span>
      {hoje.length === 0 ? (
        <p className="fl-mudo">Nenhuma tarefa pra hoje neste lead.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hoje.map((t) => {
            const feita = t.status === "concluida";
            const ligacao = ehLigacao(t.channel_type);
            // Ligação concluída não se desfaz por aqui: a classificação gerou o follow-up na Fila.
            const travada = feita && ligacao;
            const dica = feita
              ? ligacao ? "Ligação concluída na Fila (com classificação)" : "Concluída — clique pra desfazer"
              : ligacao ? "Ligação: classifique na Fila de hoje" : "Marcar como concluída";
            return (
              <button key={t.id} type="button" title={dica} aria-pressed={feita}
                disabled={ocupadoId === t.id || travada}
                className={`fl-tarefa${feita ? " fl-tarefa--feita" : ""}`}
                onClick={() => onMarcar(t)}>
                <span className="fl-tarefa__caixa" aria-hidden="true">{feita && <IcCheck size={14} sw={3} />}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {CHANNEL_LABELS[t.channel_type] ?? t.channel_type}{t.is_extra ? " · extra" : ""}
                </span>
                <span className={`fl-tarefa__hora${t.atrasada ? " fl-tarefa__hora--atrasada" : ""}`}>
                  {t.atrasada ? `atrasada · ${new Date(t.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}` : horaDe(t.scheduled_at)}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {hoje.some((t) => tarefaAberta(t) && ehLigacao(t.channel_type)) && (
        <p className="fl-mudo">Ligação se conclui na Fila de hoje: lá vai a classificação e o próximo passo.</p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 20px" }}>
        <button type="button" className="fl-btn fl-btn--link" onClick={onVerCompleta}>Ver cadência completa</button>
        {temCadencia && (
          <button type="button" className="fl-btn fl-btn--link fl-btn--perigo" disabled={removendo} onClick={onRemover}
            title="Limpa o vínculo com a cadência e encerra as atividades abertas do plano">
            {removendo ? "Removendo…" : "Remover da cadência"}
          </button>
        )}
      </div>
    </section>
  );
}
