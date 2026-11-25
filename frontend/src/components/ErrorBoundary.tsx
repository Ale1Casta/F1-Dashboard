import { Component, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(e: Error): State {
    return { error: e };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100vh", gap: 12,
          color: "#e10600", fontFamily: "JetBrains Mono, monospace", padding: 32,
          background: "#0d0d0d",
        }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>Errore di rendering</span>
          <code style={{ fontSize: 12, color: "#888", whiteSpace: "pre-wrap", maxWidth: 600 }}>
            {this.state.error.message}
          </code>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ padding: "6px 16px", background: "#e10600", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Riprova
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
