const http = require("http");
const fs = require("fs");
const path = require("path");
const dist = path.join(__dirname, "dist");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  let fp = path.join(dist, req.url === "/" ? "index.html" : req.url);
  if (!fs.existsSync(fp)) fp = path.join(dist, "index.html");
  const ext = path.extname(fp);
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
}).listen(3000, "127.0.0.1", () => console.log("QS running on http://localhost:3000"));
