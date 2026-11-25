import { useEffect, useRef, useState } from "react";
import type { WsPayload } from "../types";

export function useWebSocket(sessionKey: number | null) {
  const [data, setData] = useState<WsPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!sessionKey) return;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${window.location.host}/ws/${sessionKey}`);
      ws.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        // Reconnect after 5s
        setTimeout(connect, 5000);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data) as WsPayload;
          if (payload.type === "update") setData(payload);
        } catch {}
      };
    };

    connect();
    return () => {
      ws.current?.close();
    };
  }, [sessionKey]);

  return { data, connected };
}
