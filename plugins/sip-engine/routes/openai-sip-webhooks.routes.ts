/**
 * OpenAI SIP Webhook Routes
 * Handles incoming SIP calls via OpenAI Realtime API webhooks
 * 
 * Webhook URL to configure in OpenAI Platform:
 * POST https://your-domain.com/api/openai-sip/webhook
 * 
 * OpenAI webhook signature format:
 * - webhook-id: Unique ID for idempotency
 * - webhook-timestamp: Unix timestamp of delivery attempt
 * - webhook-signature: v1,<base64-encoded-hmac-sha256>
 * 
 * See: https://platform.openai.com/docs/guides/webhooks
 */

import { Router, Request, Response } from 'express';
import { OpenAISipService } from '../services/openai-sip.service';

const router = Router();

const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

const processedWebhookIds = new Map<string, number>();
const WEBHOOK_DEDUP_WINDOW_MS = 300_000;
const WEBHOOK_DEDUP_MAX_ENTRIES = 10_000;

function cleanupExpiredWebhookIds() {
  const cutoff = Date.now() - WEBHOOK_DEDUP_WINDOW_MS;
  for (const [id, ts] of processedWebhookIds) {
    if (ts < cutoff) processedWebhookIds.delete(id);
  }
}

setInterval(cleanupExpiredWebhookIds, 60_000);

async function verifyWebhookSignature(req: Request): Promise<{ valid: boolean; reason?: string }> {
  const webhookId = req.headers['webhook-id'] as string;
  const webhookTimestamp = req.headers['webhook-timestamp'] as string;
  const webhookSignature = req.headers['webhook-signature'] as string;

  const secret = await OpenAISipService.getWebhookSecret();
  
  if (!secret) {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      console.error('[OpenAI SIP] SECURITY: Rejecting webhook - no secret configured in production');
      return { valid: false, reason: 'Webhook secret not configured. Configure in Admin > Plugins > SIP Engine.' };
    }
    console.warn('[OpenAI SIP] SECURITY WARNING: No webhook secret configured - accepting in development mode only');
    return { valid: true, reason: 'No secret configured (development mode)' };
  }

  if (!webhookSignature) {
    return { valid: false, reason: 'Missing webhook-signature header' };
  }

  if (!webhookId) {
    return { valid: false, reason: 'Missing webhook-id header' };
  }

  if (!webhookTimestamp) {
    return { valid: false, reason: 'Missing webhook-timestamp header' };
  }

  const timestampNum = parseInt(webhookTimestamp, 10);
  if (isNaN(timestampNum)) {
    return { valid: false, reason: 'Invalid webhook-timestamp format' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    console.error(`[OpenAI SIP] Webhook timestamp outside tolerance: ${timestampNum} vs now ${now}`);
    return { valid: false, reason: 'Webhook timestamp outside acceptable window (possible replay attack)' };
  }

  cleanupExpiredWebhookIds();

  if (processedWebhookIds.has(webhookId)) {
    console.warn(`[OpenAI SIP] Duplicate webhook-id rejected: ${webhookId}`);
    return { valid: false, reason: 'Duplicate webhook-id (replay rejected)' };
  }

  if (processedWebhookIds.size >= WEBHOOK_DEDUP_MAX_ENTRIES) {
    const oldest = [...processedWebhookIds.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = oldest.slice(0, Math.floor(WEBHOOK_DEDUP_MAX_ENTRIES * 0.2));
    for (const [id] of toRemove) processedWebhookIds.delete(id);
  }

  const rawBody = (req as any).rawBody 
    ? (req as any).rawBody.toString('utf8') 
    : JSON.stringify(req.body);
  
  const isValid = await OpenAISipService.verifyWebhookSignature(
    rawBody,
    webhookSignature,
    webhookId,
    webhookTimestamp
  );

  if (isValid) {
    processedWebhookIds.set(webhookId, Date.now());
  }

  return { valid: isValid, reason: isValid ? undefined : 'Signature verification failed' };
}

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const verification = await verifyWebhookSignature(req);
    if (!verification.valid) {
      console.error(`[OpenAI SIP] Webhook rejected: ${verification.reason}`);
      return res.status(401).json({ success: false, message: verification.reason || 'Invalid signature' });
    }

    const event = req.body;
    console.log(`[OpenAI SIP] Webhook received: ${event.type}`);

    switch (event.type) {
      case 'realtime.call.incoming': {
        const result = await OpenAISipService.handleIncomingCall(event);
        
        if (result.action === 'accept' && result.config) {
          const { checkUserCreditBalance } = (await import('../service-registry')).getSipServices();
          const userId = result.userId;
          
          if (userId) {
            const creditCheck = await checkUserCreditBalance(userId);
            if (!creditCheck.hasCredits) {
              console.error(`🚫 [OpenAI SIP] User ${userId} has 0 credits - rejecting incoming call ${event.data.call_id}`);
              await OpenAISipService.rejectCall(event.data.call_id, 'Insufficient credits');
              break;
            }
          }
          
          const acceptResult = await OpenAISipService.acceptCall(event.data.call_id, result.config);
          if (!acceptResult.success) {
            console.error(`[OpenAI SIP] Failed to accept call: ${acceptResult.error}`);
          }
        } else {
          await OpenAISipService.rejectCall(event.data.call_id, result.reason || 'Call rejected');
        }
        break;
      }

      case 'realtime.call.completed': {
        await OpenAISipService.handleCallCompleted(
          event.data.call_id,
          event.data.duration_seconds,
          event.data.transcript
        );
        break;
      }

      case 'realtime.call.failed': {
        await OpenAISipService.handleCallFailed(
          event.data.call_id,
          event.data.reason || 'Unknown error'
        );
        break;
      }

      default:
        console.log(`[OpenAI SIP] Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    console.error('[OpenAI SIP] Error handling webhook:', error);
    res.status(500).json({ success: false, message: 'Internal webhook processing error' });
  }
});

router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      engine: 'openai-sip',
      status: 'healthy',
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/config', async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  try {
    const projectId = await OpenAISipService.getOpenAIProjectId();
    const sipEndpoint = OpenAISipService.getSipEndpoint(projectId);
    
    res.json({
      success: true,
      data: {
        sipEndpoint,
        projectId,
        webhookUrl: `${process.env.BASE_URL || 'https://your-domain.com'}/api/openai-sip/webhook`,
        instructions: [
          '1. Configure your SIP trunk to point to the sipEndpoint above',
          '2. Set the webhookUrl in your OpenAI Platform project settings',
          '3. Import phone numbers and assign agents in AgentLabs',
          '4. Incoming calls will be handled by the assigned AI agent',
        ],
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Failed to fetch SIP configuration' });
  }
});

export default router;
