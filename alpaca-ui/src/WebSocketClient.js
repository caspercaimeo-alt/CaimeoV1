const DEFAULT_URL = process.env.REACT_APP_WS_URL || "ws://localhost:8000/ws";

export class WebSocketClient {
  constructor({ url = DEFAULT_URL, enabled = false, handlers = {}, logger = console } = {}) {
    this.url = url;
    this.enabled = enabled;
    this.handlers = handlers;
    this.logger = logger;
    this.socket = null;
    this._warnedDisabled = false;
  }

  connect() {
    if (!this.enabled) {
      if (!this._warnedDisabled) {
        this.logger?.info?.("WebSocket client disabled (REACT_APP_ENABLE_WS not set to true); skipping connection.");
        this._warnedDisabled = true;
      }
      return null;
    }

    try {
      const socket = new WebSocket(this.url);
      const { onOpen, onMessage, onClose, onError } = this.handlers;

      if (onOpen) socket.addEventListener("open", onOpen);
      if (onMessage) socket.addEventListener("message", onMessage);
      if (onClose) socket.addEventListener("close", onClose);
      socket.addEventListener("error", (event) => {
        this.logger?.warn?.(`WebSocket error at ${this.url}; closing connection.`, event);
        if (onError) onError(event);
      });

      this.socket = socket;
      return socket;
    } catch (err) {
      this.logger?.warn?.(`WebSocket initialization failed for ${this.url}: ${err?.message || err}`);
      return null;
    }
  }

  close() {
    try {
      if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
        this.socket.close();
      }
    } catch (err) {
      this.logger?.warn?.(`WebSocket close failed for ${this.url}: ${err?.message || err}`);
    }
  }
}
