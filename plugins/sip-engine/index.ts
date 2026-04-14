/**
 * ============================================================
 * SIP Engine Plugin - Main Entry Point
 * 
 * Provides SIP telephony integration with two engines:
 * 1. ElevenLabs SIP - Native SIP support with auto-provisioning (inbound + outbound)
 * 2. OpenAI SIP - Direct SIP integration with OpenAI Realtime API (inbound only)
 * 
 * Supports multiple SIP providers:
 * - Twilio, Plivo, Telnyx, Vonage, Exotel, Bandwidth, DIDWW, Zadarma, 
 *   Cloudonix, RingCentral, Sinch, Infobip, and Generic SIP
 * 
 * Installation:
 * 1. Run database migration (migrations/001_sip_tables.sql)
 * 2. Import and register routes in main server file
 * 3. Configure SIP settings in admin panel
 * 
 * See INSTALLATION.md for detailed setup instructions.
 * ============================================================
 */

import { Router, type Express, type RequestHandler } from 'express';
import type { Server as HttpServer } from 'http';

import userTrunksRoutes from './routes/user-trunks.routes';
import userPhoneNumbersRoutes from './routes/user-phone-numbers.routes';
import adminSipRoutes from './routes/admin-sip.routes';
import openaiSipWebhooksRoutes from './routes/openai-sip-webhooks.routes';
import { setupOpenAISipStream } from './routes/openai-sip-stream';
import { setSipServices, type SipPluginServices } from './service-registry';

export { ElevenLabsSipService } from './services/elevenlabs-sip.service';
export { OpenAISipService } from './services/openai-sip.service';
export { SipTrunkService } from './services/sip-trunk.service';
export { setupOpenAISipStream } from './routes/openai-sip-stream';

export * from './types';

export const PLUGIN_VERSION = '2.0.0';
export const PLUGIN_NAME = 'sip-engine';

export function createUserSipRouter(): Router {
  const router = Router();
  
  router.use('/trunks', userTrunksRoutes);
  router.use('/phone-numbers', userPhoneNumbersRoutes);
  
  return router;
}

export function createAdminSipRouter(): Router {
  const router = Router();
  
  router.use('/', adminSipRoutes);
  
  return router;
}

export function createOpenAISipWebhookRouter(): Router {
  const router = Router();
  
  router.use('/', openaiSipWebhooksRoutes);
  
  return router;
}

interface PluginLoaderOptions {
  sessionAuthMiddleware: RequestHandler;
  adminAuthMiddleware: RequestHandler;
  httpServer?: HttpServer;
  sipServices?: SipPluginServices;
}

export function registerSipEngineRoutes(
  app: Express,
  options: PluginLoaderOptions
): void {
  const { sessionAuthMiddleware, adminAuthMiddleware, httpServer, sipServices } = options;

  if (sipServices) {
    setSipServices(sipServices);
    console.log('[SIP Engine] Services injected via service registry');
  }
  
  app.use('/api/sip', sessionAuthMiddleware, createUserSipRouter());
  
  app.use('/api/admin/sip', adminAuthMiddleware, createAdminSipRouter());
  
  app.use('/api/openai-sip', createOpenAISipWebhookRouter());
  
  if (httpServer) {
    setupOpenAISipStream(httpServer);
    console.log('[SIP Engine]   - /api/openai-sip/stream/:callId (WebSocket)');
  }
  
  console.log('[SIP Engine] Plugin registered (v2.0)');
  console.log('[SIP Engine] Endpoints:');
  console.log('  - /api/sip/trunks (user auth)');
  console.log('  - /api/sip/phone-numbers (user auth)');
  console.log('  - /api/admin/sip (admin auth)');
  console.log('  - /api/openai-sip (webhooks)');
  console.log('  - /api/openai-sip/stream/:callId (WebSocket)');
  console.log('[SIP Engine] Engines: ElevenLabs SIP, OpenAI SIP');
  console.log('✅ SIP Engine Plugin initialized');
}

export function registerSipEngineWebSockets(httpServer: HttpServer): void {
  setupOpenAISipStream(httpServer);
  console.log('[SIP Engine] WebSocket handlers registered');
}

export default {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerSipEngineRoutes,
  registerWebSockets: registerSipEngineWebSockets,
};
