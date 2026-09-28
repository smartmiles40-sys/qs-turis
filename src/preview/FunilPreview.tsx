// Preview isolado da Visão Geral (funil) — retrato REAL de 01–28/09 congelado,
// sem banco. Rode:  npm run dev  →  /funil-preview.html   (?modo=sdr = visão da Yanca)
import { createRoot } from "react-dom/client";
import VisaoGeralFunil from "../components/sdr/dashboard/VisaoGeralFunil";
import RelogioPrimeiroContato from "../components/sdr/tasks/RelogioPrimeiroContato";
import { supabase } from "../lib/supabase";
import "../index.css";
/* eslint-disable @typescript-eslint/no-explicit-any */

const GESTOR = {"de": "2026-09-01", "eu": {"atrasadas": 0, "fila_hoje": 0}, "ate": "2026-09-28", "sdrs": [{"nome": "Mariana", "falou": 195, "novos": 274, "em_fup": 233, "fontes": {"live": {"n": 50, "marcou": 15}, "outros": {"n": 65, "marcou": 10}, "trafego": {"n": 280, "marcou": 16}, "organico": {"n": 50, "marcou": 9}}, "futura": 5, "marcou": 50, "noshow": 3, "sdr_id": "7951a5fe-44f4-4ec1-9038-fb17d7593038", "ate5min": 32, "cancelou": 7, "perdidos": 159, "retornos": 171, "aconteceu": 35, "atrasadas": 0, "fila_hoje": 103, "recebidos": 445, "trabalhou": 432, "medidos_1o": 261, "tent_media": 7.5, "temperatura": {"sem": {"n": 1, "marcou": 1}, "frio": {"n": 331, "marcou": 25}, "morno": {"n": 85, "marcou": 8}, "quente": {"n": 28, "marcou": 16}}, "mediana_1o_min": 93}, {"nome": "Victor Hugo", "falou": 246, "novos": 274, "em_fup": 229, "fontes": {"live": {"n": 43, "marcou": 21}, "outros": {"n": 73, "marcou": 11}, "trafego": {"n": 303, "marcou": 17}, "organico": {"n": 58, "marcou": 13}}, "futura": 6, "marcou": 62, "noshow": 8, "sdr_id": "da6e63c2-169a-4545-9022-3e87c7510680", "ate5min": 41, "cancelou": 21, "perdidos": 188, "retornos": 203, "aconteceu": 27, "atrasadas": 0, "fila_hoje": 58, "recebidos": 477, "trabalhou": 463, "medidos_1o": 260, "tent_media": 7.0, "temperatura": {"sem": {"n": 3, "marcou": 1}, "frio": {"n": 343, "marcou": 33}, "morno": {"n": 87, "marcou": 9}, "quente": {"n": 44, "marcou": 19}}, "mediana_1o_min": 72}, {"nome": "Yanca Manuella Ruivo", "falou": 171, "novos": 278, "em_fup": 258, "fontes": {"live": {"n": 56, "marcou": 23}, "outros": {"n": 53, "marcou": 9}, "trafego": {"n": 272, "marcou": 21}, "organico": {"n": 60, "marcou": 15}}, "futura": 9, "marcou": 68, "noshow": 8, "sdr_id": "634c4ab3-fc68-4843-a493-578f04ec3b36", "ate5min": 23, "cancelou": 13, "perdidos": 120, "retornos": 163, "aconteceu": 38, "atrasadas": 18, "fila_hoje": 96, "recebidos": 441, "trabalhou": 424, "medidos_1o": 263, "tent_media": 6.4, "temperatura": {"sem": {"n": 1, "marcou": 1}, "frio": {"n": 321, "marcou": 36}, "morno": {"n": 82, "marcou": 9}, "quente": {"n": 37, "marcou": 22}}, "mediana_1o_min": 123}], "time": {"falou": 612, "novos": 826, "em_fup": 720, "fontes": {"live": {"n": 149, "marcou": 59}, "outros": {"n": 191, "marcou": 30}, "trafego": {"n": 855, "marcou": 54}, "organico": {"n": 168, "marcou": 37}}, "futura": 20, "marcou": 180, "noshow": 19, "ate5min": 96, "cancelou": 41, "perdidos": 467, "retornos": 537, "aconteceu": 100, "recebidos": 1363, "trabalhou": 1319, "medidos_1o": 784, "tent_media": 7.0, "temperatura": {"sem": {"n": 5, "marcou": 3}, "frio": {"n": 995, "marcou": 94}, "morno": {"n": 254, "marcou": 26}, "quente": {"n": 109, "marcou": 57}}, "mediana_1o_min": 97}, "gestor": true, "closers": [{"nome": "Bruno Matheus", "desfechos_atrasados": 16}, {"nome": "Talita Carvalho", "desfechos_atrasados": 32}, {"nome": "Z John Italo (closer) ", "desfechos_atrasados": 0}], "velocidade": [{"faixa": "até 5 min", "leads": 96, "ordem": 1, "marcou": 23}, {"faixa": "5 a 30 min", "leads": 110, "ordem": 2, "marcou": 18}, {"faixa": "30 min a 2h", "leads": 241, "ordem": 3, "marcou": 50}, {"faixa": "mais de 2h", "leads": 337, "ordem": 4, "marcou": 51}, {"faixa": "sem contato", "leads": 42, "ordem": 5, "marcou": 20}]} as any;

const modoSdr = new URLSearchParams(location.search).get("modo") === "sdr";
const yanca = GESTOR.sdrs.find((s: { nome: string }) => s.nome.startsWith("Yanca"));
const SDR = { ...GESTOR, gestor: false, closers: [], sdrs: [yanca], eu: { atrasadas: 18, fila_hoje: 96 } };

supabase.rpc = (async () => ({ data: modoSdr ? SDR : GESTOR, error: null })) as unknown as typeof supabase.rpc;

const agora = Date.now();
createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 32, background: "#F4F5F8", minHeight: "100vh" }}>
    {modoSdr && (
      <RelogioPrimeiroContato
        esperando={[
          { taskId: "a", nome: "Carla Mendes", chegouEm: new Date(agora - 7 * 60_000).toISOString() },
          { taskId: "b", nome: "João Pedro", chegouEm: new Date(agora - 2 * 60_000).toISOString() },
        ]}
        onAtender={() => {}}
      />
    )}
    <VisaoGeralFunil onIrParaPainel={() => {}} />
  </div>
);
