import { useEffect, useCallback, useState } from 'react';
import { wsClient } from '../net/WebSocketClient';

/**
 * WebSocket 连接 Hook。
 * 自动在挂载时连接，卸载时断开。
 */
export function useWebSocket() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    wsClient.connect().then(() => setConnected(true)).catch(() => {});

    const unsub = wsClient.on('connected', () => setConnected(true));

    return () => {
      unsub();
      // don't disconnect on unmount — keep connection alive across pages
    };
  }, []);

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    wsClient.send(type, payload);
  }, []);

  const onMessage = useCallback((type: string, handler: (payload: any) => void) => {
    return wsClient.on(type, handler);
  }, []);

  return { connected, send, onMessage };
}
