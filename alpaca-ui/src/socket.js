import { WebSocketClient } from "./WebSocketClient";

const ENABLE_WS = process.env.REACT_APP_ENABLE_WS === "true";
const WS_URL = process.env.REACT_APP_WS_URL || "ws://localhost:8000/ws";

export function initSocket(handlers = {}) {
  const client = new WebSocketClient({ url: WS_URL, enabled: ENABLE_WS, handlers });
  const socket = client.connect();
  return {
    socket,
    close: () => client.close(),
  };
}
