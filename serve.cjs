// Servidor estático mínimo do build local (dist/) — SÓ para dev/preview local.
// Produção é a Vercel. Segurança: o path da URL é decodificado e NORMALIZADO, e
// qualquer tentativa de sair de dist/ ("../", %2e%2e etc.) cai no index.html —
// antes dava pra ler qualquer arquivo do disco via path traversal.
const http = require("http");
const fs = require("fs");
const path = require("path");
const dist = path.join(__dirname, "dist");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  // Só o pathname (sem querystring), decodificado — %2e%2e vira ".." AQUI, antes da checagem.
  let urlPath = "/";
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    urlPath = "/"; // percent-encoding inválido → home
  }
  let fp = path.normalize(path.join(dist, urlPath === "/" ? "index.html" : urlPath));
  // Trava anti-traversal: o caminho resolvido TEM que continuar dentro de dist/.
  if (fp !== dist && !fp.startsWith(dist + path.sep)) fp = path.join(dist, "index.html");
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) fp = path.join(dist, "index.html");
  const ext = path.extname(fp);
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
}).listen(3000, "127.0.0.1", () => console.log("QS running on http://localhost:3000"));
