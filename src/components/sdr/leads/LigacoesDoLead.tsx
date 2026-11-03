// Aba "Ligações" da ficha do lead: o áudio das ligações atendidas pelo webfone
// (0233). O SDR ouve as próprias; gestão comercial ouve todas (RLS).
import { useEffect, useState } from "react";
import { listarGravacoesDoLead, linkDaGravacao, type GravacaoLigacao } from "@/lib/gravacaoLigacao";

function duracao(seg: number): string {
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return m ? `${m}min ${String(s).padStart(2, "0")}s` : `${s}s`;
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function Player({ g }: { g: GravacaoLigacao }) {
  const [url, setUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);

  async function abrir() {
    setCarregando(true);
    setFalhou(false);
    const link = await linkDaGravacao(g.storage_path);
    setCarregando(false);
    if (link) setUrl(link);
    else setFalhou(true);
  }

  if (url) return <audio src={url} controls autoPlay className="w-full h-9" />;
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={abrir}
        disabled={carregando}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0147FF] text-white hover:bg-[#0136cc] disabled:opacity-60"
      >
        {carregando ? "Abrindo…" : "▶ Ouvir"}
      </button>
      {falhou && <span className="text-xs text-red-600">Não deu pra abrir o áudio. Tente de novo.</span>}
    </div>
  );
}

export default function LigacoesDoLead({ leadId }: { leadId: string }) {
  const [lista, setLista] = useState<GravacaoLigacao[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    void listarGravacoesDoLead(leadId).then((r) => { if (vivo) setLista(r); });
    return () => { vivo = false; };
  }, [leadId]);

  if (lista === null) return <p className="text-sm text-gray-400 py-6 text-center">Carregando ligações…</p>;
  if (!lista.length) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-6 text-center">
        <p className="text-sm font-medium text-gray-700">Nenhuma ligação gravada com este cliente.</p>
        <p className="text-xs text-gray-400 mt-1">
          As ligações atendidas pelo webfone do QS ficam gravadas aqui. Você vê as suas; a gestão vê todas.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lista.map((g) => (
        <div key={g.id} className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <div className="text-sm">
              <span className="font-semibold text-gray-900">{quando(g.inicio)}</span>
              <span className="text-gray-400"> · {duracao(g.duracao_seg)}</span>
              {g.origem === "discador" && <span className="text-gray-400"> · discador</span>}
            </div>
            <span className="text-xs text-gray-500">
              {g.sdr?.name ?? "SDR"}{g.telefone ? ` · ${g.telefone}` : ""}
            </span>
          </div>
          <Player g={g} />
        </div>
      ))}
    </div>
  );
}
