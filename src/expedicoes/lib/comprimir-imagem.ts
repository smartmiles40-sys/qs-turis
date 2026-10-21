/**
 * Comprime/redimensiona uma imagem NO NAVEGADOR antes do upload — transparente
 * pro usuário (ele só anexa/tira a foto normal). Passaporte/selfie de celular
 * (5–15 MB, às vezes HEIC) viram ~0,5–1 MB em JPEG, evitando que o corpo da
 * inscrição estoure o limite da server action (o que aparecia como "Falha de rede").
 *
 * - Só mexe em imagem raster (image/*). PDF e demais passam intactos.
 * - Reduz o maior lado pra no máximo MAX_LADO px e re-encoda em JPEG.
 * - Qualquer falha (browser sem canvas, formato que não decodifica) devolve o
 *   arquivo ORIGINAL — nunca quebra o envio.
 */
const MAX_LADO = 2000; // resolução de sobra pra ler um passaporte
const QUALIDADE = 0.82;

export async function comprimirImagem(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/")) return file; // PDF etc. passam direto
  try {
    const bitmap = await carregarBitmap(file);
    const largura = "width" in bitmap ? bitmap.width : 0;
    const altura = "height" in bitmap ? bitmap.height : 0;
    if (!largura || !altura) return file;

    const escala = Math.min(1, MAX_LADO / Math.max(largura, altura));
    const w = Math.round(largura * escala);
    const h = Math.round(altura * escala);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALIDADE),
    );
    // Se não gerou blob ou ficou maior que o original, mantém o original.
    if (!blob || blob.size >= file.size) return file;

    const nome = file.name.replace(/\.[^./\\]+$/, "") + ".jpg";
    return new File([blob], nome, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function carregarBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // alguns formatos falham no createImageBitmap; cai no <img>
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("não foi possível decodificar a imagem"));
    };
    img.src = url;
  });
}
