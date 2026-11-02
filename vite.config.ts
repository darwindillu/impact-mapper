import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// In dev, serve /api/analyze from the same handler the Vercel function uses.
function devApi(): Plugin {
  return {
    name: "dev-api",
    configureServer(server) {
      server.middlewares.use("/api/analyze", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const { handleAnalyze } = await server.ssrLoadModule("/server/handler.ts");
        const { status, body } = await handleAnalyze(raw, headers, req.socket.remoteAddress ?? "local");
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose ANTHROPIC_API_KEY from .env.local to the dev API only (no VITE_ prefix, so never to the browser).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));
  return { plugins: [react(), devApi()] };
});
