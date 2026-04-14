import { Router } from "express";
import { OpenAISipService } from "../services/openai-sip.service.js";
const router = Router();
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;
const processedWebhookIds = /* @__PURE__ */ new Map();
const WEBHOOK_DEDUP_WINDOW_MS = 3e5;
const WEBHOOK_DEDUP_MAX_ENTRIES = 1e4;
function cleanupExpiredWebhookIds() {
  const cutoff = Date.now() - WEBHOOK_DEDUP_WINDOW_MS;
  for (const [id, ts] of processedWebhookIds) {
    if (ts < cutoff) processedWebhookIds.delete(id);
  }
}
setInterval(cleanupExpiredWebhookIds, 6e4);
async function verifyWebhookSignature(req) {
  const webhookId = req.headers["webhook-id"];
  const webhookTimestamp = req.headers["webhook-timestamp"];
  const webhookSignature = req.headers["webhook-signature"];
  const secret = await OpenAISipService.getWebhookSecret();
  if (!secret) {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction) {
      console.error("[OpenAI SIP] SECURITY: Rejecting webhook - no secret configured in production");
      return { valid: false, reason: "Webhook secret not configured. Configure in Admin > Plugins > SIP Engine." };
    }
    console.warn("[OpenAI SIP] SECURITY WARNING: No webhook secret configured - accepting in development mode only");
    return { valid: true, reason: "No secret configured (development mode)" };
  }
  if (!webhookSignature) {
    return { valid: false, reason: "Missing webhook-signature header" };
  }
  if (!webhookId) {
    return { valid: false, reason: "Missing webhook-id header" };
  }
  if (!webhookTimestamp) {
    return { valid: false, reason: "Missing webhook-timestamp header" };
  }
  const timestampNum = parseInt(webhookTimestamp, 10);
  if (isNaN(timestampNum)) {
    return { valid: false, reason: "Invalid webhook-timestamp format" };
  }
  const now = Math.floor(Date.now() / 1e3);
  if (Math.abs(now - timestampNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    console.error(`[OpenAI SIP] Webhook timestamp outside tolerance: ${timestampNum} vs now ${now}`);
    return { valid: false, reason: "Webhook timestamp outside acceptable window (possible replay attack)" };
  }
  cleanupExpiredWebhookIds();
  if (processedWebhookIds.has(webhookId)) {
    console.warn(`[OpenAI SIP] Duplicate webhook-id rejected: ${webhookId}`);
    return { valid: false, reason: "Duplicate webhook-id (replay rejected)" };
  }
  if (processedWebhookIds.size >= WEBHOOK_DEDUP_MAX_ENTRIES) {
    const oldest = [...processedWebhookIds.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = oldest.slice(0, Math.floor(WEBHOOK_DEDUP_MAX_ENTRIES * 0.2));
    for (const [id] of toRemove) processedWebhookIds.delete(id);
  }
  const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body);
  const isValid = await OpenAISipService.verifyWebhookSignature(
    rawBody,
    webhookSignature,
    webhookId,
    webhookTimestamp
  );
  if (isValid) {
    processedWebhookIds.set(webhookId, Date.now());
  }
  return { valid: isValid, reason: isValid ? void 0 : "Signature verification failed" };
}
router.post("/webhook", async (req, res) => {
  try {
    const verification = await verifyWebhookSignature(req);
    if (!verification.valid) {
      console.error(`[OpenAI SIP] Webhook rejected: ${verification.reason}`);
      return res.status(401).json({ success: false, message: verification.reason || "Invalid signature" });
    }
    const event = req.body;
    console.log(`[OpenAI SIP] Webhook received: ${event.type}`);
    switch (event.type) {
      case "realtime.call.incoming": {
        const result = await OpenAISipService.handleIncomingCall(event);
        if (result.action === "accept" && result.config) {
          const { checkUserCreditBalance } = (await import("../service-registry.js")).getSipServices();
          const userId = result.userId;
          if (userId) {
            const creditCheck = await checkUserCreditBalance(userId);
            if (!creditCheck.hasCredits) {
              console.error(`\u{1F6AB} [OpenAI SIP] User ${userId} has 0 credits - rejecting incoming call ${event.data.call_id}`);
              await OpenAISipService.rejectCall(event.data.call_id, "Insufficient credits");
              break;
            }
          }
          const acceptResult = await OpenAISipService.acceptCall(event.data.call_id, result.config);
          if (!acceptResult.success) {
            console.error(`[OpenAI SIP] Failed to accept call: ${acceptResult.error}`);
          }
        } else {
          await OpenAISipService.rejectCall(event.data.call_id, result.reason || "Call rejected");
        }
        break;
      }
      case "realtime.call.completed": {
        await OpenAISipService.handleCallCompleted(
          event.data.call_id,
          event.data.duration_seconds,
          event.data.transcript
        );
        break;
      }
      case "realtime.call.failed": {
        await OpenAISipService.handleCallFailed(
          event.data.call_id,
          event.data.reason || "Unknown error"
        );
        break;
      }
      default:
        console.log(`[OpenAI SIP] Unhandled event type: ${event.type}`);
    }
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[OpenAI SIP] Error handling webhook:", error);
    res.status(500).json({ success: false, message: "Internal webhook processing error" });
  }
});
router.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      engine: "openai-sip",
      status: "healthy",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
});
router.get("/config", async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }
  try {
    const projectId = await OpenAISipService.getOpenAIProjectId();
    const sipEndpoint = OpenAISipService.getSipEndpoint(projectId);
    res.json({
      success: true,
      data: {
        sipEndpoint,
        projectId,
        webhookUrl: `${process.env.BASE_URL || "https://your-domain.com"}/api/openai-sip/webhook`,
        instructions: [
          "1. Configure your SIP trunk to point to the sipEndpoint above",
          "2. Set the webhookUrl in your OpenAI Platform project settings",
          "3. Import phone numbers and assign agents in AgentLabs",
          "4. Incoming calls will be handled by the assigned AI agent"
        ]
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch SIP configuration" });
  }
});
var openai_sip_webhooks_routes_default = router;
export {
  openai_sip_webhooks_routes_default as default
};
