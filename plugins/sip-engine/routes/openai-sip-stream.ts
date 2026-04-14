/**
 * ============================================================
 * OpenAI SIP WebSocket Stream Endpoint
 * 
 * Note: OpenAI handles the audio streaming directly - this endpoint
 * is for receiving real-time events and transcripts from ongoing calls.
 * 
 * Unlike Fonoster, OpenAI SIP doesn't require audio bridging since
 * OpenAI's SIP integration handles G.711 natively.
 * ============================================================
 */

import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';

interface OpenAISipStreamMessage {
  type: string;
  call_id?: string;
  data?: any;
}

let sharedWss: WebSocketServer | null = null;
let isSetupComplete = false;

const activeStreams: Map<string, {
  ws: WebSocket;
  callId: string;
  transcript: Array<{ role: string; content: string; timestamp: string }>;
}> = new Map();

export function setupOpenAISipStream(httpServer: HttpServer): void {
  if (isSetupComplete) {
    console.log('[OpenAI SIP Stream] Already initialized, skipping duplicate setup');
    return;
  }
  isSetupComplete = true;
  
  if (!sharedWss) {
    sharedWss = new WebSocketServer({ noServer: true });
    console.log('[OpenAI SIP Stream] Shared WebSocketServer created');
  }
  
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url?.split('?')[0] || '';
    
    if (pathname.startsWith('/api/openai-sip/stream/')) {
      const callId = pathname.split('/api/openai-sip/stream/')[1];
      
      if (!callId) {
        console.error(`[OpenAI SIP Stream] Invalid stream URL: ${pathname}`);
        socket.destroy();
        return;
      }
      
      console.log(`[OpenAI SIP Stream] Handling WebSocket upgrade for call: ${callId}`);
      
      sharedWss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        console.log(`[OpenAI SIP Stream] WebSocket connected for call: ${callId}`);
        handleOpenAISipStreamConnection(ws, callId);
      });
    }
  });

  console.log('[OpenAI SIP Stream] WebSocket stream endpoint registered');
}

export function cleanupOpenAISipStream(): void {
  if (sharedWss) {
    sharedWss.close(() => {
      console.log('[OpenAI SIP Stream] WebSocketServer closed');
    });
    sharedWss = null;
  }
  isSetupComplete = false;
}

function handleOpenAISipStreamConnection(ws: WebSocket, callId: string): void {
  let isClosing = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let lastActivityTime = Date.now();
  const HEARTBEAT_INTERVAL = 30000;
  const INACTIVITY_TIMEOUT = 300000;

  activeStreams.set(callId, {
    ws,
    callId,
    transcript: [],
  });

  heartbeatInterval = setInterval(() => {
    if (isClosing) return;
    
    const inactiveTime = Date.now() - lastActivityTime;
    if (inactiveTime > INACTIVITY_TIMEOUT) {
      console.log(`[OpenAI SIP Stream] Closing stale connection for ${callId}`);
      cleanupAndClose();
      return;
    }
    
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (e) {
        console.error(`[OpenAI SIP Stream] Heartbeat ping failed for ${callId}`);
      }
    }
  }, HEARTBEAT_INTERVAL);

  function cleanupAndClose() {
    if (isClosing) return;
    isClosing = true;
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    const stream = activeStreams.get(callId);
    if (stream && stream.transcript.length > 0) {
      db.execute(sql`
        UPDATE sip_calls SET 
          transcript = ${JSON.stringify(stream.transcript)},
          updated_at = NOW()
        WHERE openai_call_id = ${callId}
      `).catch(err => {
        console.error(`[OpenAI SIP Stream] Error saving transcript for ${callId}:`, err);
      });
    }
    
    activeStreams.delete(callId);
    
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.close();
      } catch (e) {
        console.error(`[OpenAI SIP Stream] Error closing WebSocket for ${callId}:`, e);
      }
    }
    
    console.log(`[OpenAI SIP Stream] Cleaned up connection for ${callId}`);
  }

  ws.on('pong', () => {
    lastActivityTime = Date.now();
  });

  ws.on('message', async (data: RawData) => {
    lastActivityTime = Date.now();
    
    try {
      const rawData = typeof data === 'string' ? data : String(data);
      
      if (!rawData || rawData.trim() === '') {
        return;
      }
      
      let message: OpenAISipStreamMessage;
      try {
        message = JSON.parse(rawData);
      } catch (parseError) {
        console.warn(`[OpenAI SIP Stream] Invalid JSON for ${callId}`);
        return;
      }

      const stream = activeStreams.get(callId);
      
      switch (message.type) {
        case 'transcript.update':
          if (stream && message.data) {
            stream.transcript.push({
              role: message.data.role || 'unknown',
              content: message.data.content || '',
              timestamp: new Date().toISOString(),
            });
          }
          break;
          
        case 'call.completed':
          console.log(`[OpenAI SIP Stream] Call completed: ${callId}`);
          cleanupAndClose();
          break;
          
        default:
          console.log(`[OpenAI SIP Stream] Received: ${message.type}`);
      }
    } catch (error) {
      console.error(`[OpenAI SIP Stream] Error processing message for ${callId}:`, error);
    }
  });

  ws.on('close', () => {
    console.log(`[OpenAI SIP Stream] Connection closed for ${callId}`);
    cleanupAndClose();
  });

  ws.on('error', (error) => {
    console.error(`[OpenAI SIP Stream] WebSocket error for ${callId}:`, error);
    cleanupAndClose();
  });
}

export function getActiveStream(callId: string) {
  return activeStreams.get(callId);
}

export default { setupOpenAISipStream, cleanupOpenAISipStream, getActiveStream };
