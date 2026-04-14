import { Router } from "express";
import userTrunksRoutes from "./routes/user-trunks.routes.js";
import userPhoneNumbersRoutes from "./routes/user-phone-numbers.routes.js";
import adminSipRoutes from "./routes/admin-sip.routes.js";
import openaiSipWebhooksRoutes from "./routes/openai-sip-webhooks.routes.js";
import { setupOpenAISipStream } from "./routes/openai-sip-stream.js";
import { setSipServices } from "./service-registry.js";
import { ElevenLabsSipService } from "./services/elevenlabs-sip.service.js";
import { OpenAISipService } from "./services/openai-sip.service.js";
import { SipTrunkService } from "./services/sip-trunk.service.js";
import { setupOpenAISipStream as setupOpenAISipStream2 } from "./routes/openai-sip-stream.js";
export * from "./types.js";
const PLUGIN_VERSION = "2.0.0";
const PLUGIN_NAME = "sip-engine";
function createUserSipRouter() {
  const router = Router();
  router.use("/trunks", userTrunksRoutes);
  router.use("/phone-numbers", userPhoneNumbersRoutes);
  return router;
}
function createAdminSipRouter() {
  const router = Router();
  router.use("/", adminSipRoutes);
  return router;
}
function createOpenAISipWebhookRouter() {
  const router = Router();
  router.use("/", openaiSipWebhooksRoutes);
  return router;
}
function registerSipEngineRoutes(app, options) {
  const { sessionAuthMiddleware, adminAuthMiddleware, httpServer, sipServices } = options;
  if (sipServices) {
    setSipServices(sipServices);
    console.log("[SIP Engine] Services injected via service registry");
  }
  app.use("/api/sip", sessionAuthMiddleware, createUserSipRouter());
  app.use("/api/admin/sip", adminAuthMiddleware, createAdminSipRouter());
  app.use("/api/openai-sip", createOpenAISipWebhookRouter());
  if (httpServer) {
    setupOpenAISipStream(httpServer);
    console.log("[SIP Engine]   - /api/openai-sip/stream/:callId (WebSocket)");
  }
  console.log("[SIP Engine] Plugin registered (v2.0)");
  console.log("[SIP Engine] Endpoints:");
  console.log("  - /api/sip/trunks (user auth)");
  console.log("  - /api/sip/phone-numbers (user auth)");
  console.log("  - /api/admin/sip (admin auth)");
  console.log("  - /api/openai-sip (webhooks)");
  console.log("  - /api/openai-sip/stream/:callId (WebSocket)");
  console.log("[SIP Engine] Engines: ElevenLabs SIP, OpenAI SIP");
  console.log("\u2705 SIP Engine Plugin initialized");
}
function registerSipEngineWebSockets(httpServer) {
  setupOpenAISipStream(httpServer);
  console.log("[SIP Engine] WebSocket handlers registered");
}
var index_default = {
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  register: registerSipEngineRoutes,
  registerWebSockets: registerSipEngineWebSockets
};
export {
  ElevenLabsSipService,
  OpenAISipService,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  SipTrunkService,
  createAdminSipRouter,
  createOpenAISipWebhookRouter,
  createUserSipRouter,
  index_default as default,
  registerSipEngineRoutes,
  registerSipEngineWebSockets,
  setupOpenAISipStream2 as setupOpenAISipStream
};
