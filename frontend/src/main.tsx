import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

// ── Debug helper: write a message to the visible splash error box ──────────
function dbg(msg: string) {
  try {
    const el = document.getElementById("js-error");
    if (el) {
      el.style.display = "block";
      el.textContent = (el.textContent ? el.textContent + " | " : "") + msg;
    }
  } catch {}
}

dbg("main.tsx start");

let qc: QueryClient;
try {
  qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  dbg("QueryClient OK");
} catch (e) {
  dbg("QueryClient FAIL: " + String(e));
  throw e;
}

dbg("calling createRoot");

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) { dbg("root element NOT FOUND"); throw new Error("root not found"); }

  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={qc!}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>
  );
  dbg("createRoot.render() called");
} catch (e) {
  dbg("createRoot FAIL: " + String(e));
}
