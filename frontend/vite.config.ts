import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Removes crossorigin="anonymous" from <script> and <link> tags injected by Vite.
// The attribute is added for module preloading but breaks loading through HTTPS
// proxies (e.g. Cloudflare Tunnel) on some mobile browsers / WebViews.
function removeCrossOrigin() {
  return {
    name: "remove-crossorigin",
    transformIndexHtml(html: string): string {
      return html.replace(/ crossorigin(="[^"]*")?/g, "");
    },
  };
}

export default defineConfig({
  plugins: [react(), removeCrossOrigin()],
  build: {
    target: "es2019",       // broader mobile browser support
    modulePreload: false,   // no <link rel="modulepreload"> tags
  },
  server: {
    host: "0.0.0.0",   // raggiungibile da altri dispositivi sulla stessa rete
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  preview: {
    host: "0.0.0.0",   // uguale per il server di preview (build di produzione)
    port: 4173,
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
