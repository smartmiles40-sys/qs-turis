import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";

// -----------------------------------------------------------------------------
// Ponte de /api no `vite dev`.
// Na Vercel, os arquivos em /api/*.js viram funções serverless. Em desenvolvimento
// o Vite não executa isso, então /api/chatapp-send daria 404. Este plugin importa
// o handler correspondente e o executa como middleware, com um shim de req/res no
// estilo Vercel (req.body já parseado, res.status().json()).
// -----------------------------------------------------------------------------
function devApiBridge(): Plugin {
  return {
    name: "dev-api-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api/")) return next();

        const route = req.url.split("?")[0].replace(/^\/api\//, "").replace(/\/+$/, "");
        const file = path.resolve(__dirname, "api", `${route}.js`);
        if (!fs.existsSync(file)) return next();

        // Lê o corpo (JSON).
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          (req as any).body = raw ? JSON.parse(raw) : {};
        } catch {
          (req as any).body = raw;
        }

        // Shim das helpers que a Vercel adiciona no res.
        const anyRes = res as any;
        anyRes.status = (code: number) => {
          res.statusCode = code;
          return anyRes;
        };
        anyRes.json = (obj: unknown) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
          return anyRes;
        };

        try {
          const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
          await mod.default(req, res);
        } catch (err) {
          console.error("[dev-api-bridge]", route, err);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ success: false, error: String((err as Error)?.message || err) }));
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Carrega TODAS as env vars (inclusive as sem prefixo VITE_ e o .env.chatapp.local)
  // para dentro de process.env, para os handlers de /api enxergarem as CHATAPP_*.
  const env = {
    ...loadEnv(mode, process.cwd(), ""),
    ...loadEnv(mode, process.cwd(), "CHATAPP_"),
  };
  for (const [k, v] of Object.entries(env)) {
    if (!(k in process.env)) process.env[k] = v as string;
  }
  // .env.chatapp.local não é lido pelo loadEnv por padrão — carrega manualmente.
  const chatappLocal = path.resolve(process.cwd(), ".env.chatapp.local");
  if (fs.existsSync(chatappLocal)) {
    for (const line of fs.readFileSync(chatappLocal, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }

  return {
    plugins: [react(), devApiBridge()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 3000,
    },
  };
});
