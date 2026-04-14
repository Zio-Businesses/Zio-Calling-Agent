import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
const SIP_MOCK_MODE = process.env.SIP_MOCK_MODE === "true";
const OPENAI_API_BASE = "https://api.openai.com/v1";
import * as crypto from "crypto";
class OpenAISipService {
  static async getOpenAIApiKey() {
    const result = await db.execute(sql`
      SELECT api_key FROM openai_keys 
      WHERE is_active = true 
      ORDER BY RANDOM() 
      LIMIT 1
    `);
    const row = result.rows[0];
    if (row?.api_key) {
      return row.api_key;
    }
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) {
      return envKey;
    }
    throw new Error("No OpenAI API key configured");
  }
  /**
   * Get webhook secret from database for signature verification
   */
  static async getWebhookSecret() {
    try {
      const result = await db.execute(sql`
        SELECT value FROM global_settings 
        WHERE key = 'openai_sip_webhook_secret' 
        LIMIT 1
      `);
      const row = result.rows[0];
      if (!row?.value) return null;
      const val = row.value;
      if (typeof val === "string") {
        return val.replace(/^"|"$/g, "");
      }
      return String(val);
    } catch (e) {
      return null;
    }
  }
  /**
   * Verify OpenAI webhook signature
   * Based on: https://platform.openai.com/docs/guides/webhooks
   * 
   * OpenAI uses a standard webhook signature format:
   * - webhook-id: unique ID for idempotency
   * - webhook-timestamp: Unix timestamp of delivery attempt
   * - webhook-signature: v1,<base64-encoded-hmac-sha256>
   * 
   * IMPORTANT: This method assumes the secret is already retrieved by the caller.
   * It should only be called after verifying that a secret exists.
   */
  static async verifyWebhookSignature(payload, signature, webhookId, timestamp) {
    const secret = await this.getWebhookSecret();
    if (!secret) {
      console.error("[OpenAI SIP] Cannot verify signature: No webhook secret configured");
      return false;
    }
    try {
      const parts = signature.split(",");
      if (parts.length < 2 || !parts[0].startsWith("v1")) {
        console.error("[OpenAI SIP] Invalid signature format - expected v1,<signature>");
        return false;
      }
      const expectedSignature = parts[1];
      const signedPayload = `${webhookId}.${timestamp}.${payload}`;
      const computedSignature = crypto.createHmac("sha256", secret).update(signedPayload).digest("base64");
      try {
        const isValid = crypto.timingSafeEqual(
          Buffer.from(expectedSignature, "base64"),
          Buffer.from(computedSignature, "base64")
        );
        if (!isValid) {
          console.error("[OpenAI SIP] Webhook signature verification failed");
        }
        return isValid;
      } catch (e) {
        console.error("[OpenAI SIP] Signature length mismatch");
        return false;
      }
    } catch (error) {
      console.error("[OpenAI SIP] Error verifying webhook signature:", error);
      return false;
    }
  }
  static async getOpenAIProjectId() {
    const result = await db.execute(sql`
      SELECT value FROM global_settings 
      WHERE key = 'openai_sip_project_id' 
      LIMIT 1
    `);
    const setting = result.rows[0];
    if (setting?.value) {
      const val = setting.value;
      if (typeof val === "string") {
        return val.replace(/^"|"$/g, "");
      }
      return String(val);
    }
    const envProjectId = process.env.OPENAI_PROJECT_ID;
    if (envProjectId) {
      return envProjectId;
    }
    throw new Error("OpenAI Project ID not configured. Set it in Admin Settings.");
  }
  static getSipEndpoint(projectId) {
    return `sip:${projectId}@sip.api.openai.com;transport=tls`;
  }
  static async handleIncomingCall(event) {
    console.log(`[OpenAI SIP] Incoming call: ${event.data.call_id}`);
    const fromHeader = event.data.sip_headers.find((h) => h.name.toLowerCase() === "from");
    const toHeader = event.data.sip_headers.find((h) => h.name.toLowerCase() === "to");
    const fromNumber = this.extractPhoneNumber(fromHeader?.value || "");
    const toNumber = this.extractPhoneNumber(toHeader?.value || "");
    console.log(`[OpenAI SIP] Call from ${fromNumber} to ${toNumber}`);
    const toNumberDigits = toNumber.replace(/[^\d]/g, "");
    const toNumberWithPlus = toNumber.startsWith("+") ? toNumber : `+${toNumber}`;
    const toNumberWithoutPlus = toNumber.replace(/^\+/, "");
    console.log(`[OpenAI SIP] Looking up phone number: digits=${toNumberDigits}, withPlus=${toNumberWithPlus}, withoutPlus=${toNumberWithoutPlus}`);
    const phoneResult = await db.execute(sql`
      SELECT spn.*, a.id as agent_id, a.system_prompt, a.first_message, 
             a.openai_voice, a.temperature, a.name as agent_name,
             st.user_id
      FROM sip_phone_numbers spn
      JOIN sip_trunks st ON spn.sip_trunk_id = st.id
      LEFT JOIN agents a ON spn.agent_id = a.id
      WHERE (
        spn.phone_number = ${toNumber}
        OR spn.phone_number = ${toNumberWithPlus}
        OR spn.phone_number = ${toNumberWithoutPlus}
        OR REGEXP_REPLACE(spn.phone_number, '[^0-9]', '', 'g') = ${toNumberDigits}
      )
        AND spn.engine = 'openai-sip'
        AND spn.is_active = true
        AND spn.inbound_enabled = true
      LIMIT 1
    `);
    const phoneNumber = phoneResult.rows[0];
    if (!phoneNumber || !phoneNumber.agent_id) {
      console.log(`[OpenAI SIP] No agent assigned to ${toNumber}`);
      return { action: "reject", reason: "No agent configured for this number" };
    }
    await db.execute(sql`
      INSERT INTO sip_calls (
        user_id, agent_id, sip_trunk_id, sip_phone_number_id, engine,
        external_call_id, openai_call_id, from_number, to_number, direction, status
      )
      VALUES (
        ${phoneNumber.user_id}, ${phoneNumber.agent_id}, ${phoneNumber.sip_trunk_id},
        ${phoneNumber.id}, 'openai-sip', ${event.data.call_id}, ${event.data.call_id},
        ${fromNumber}, ${toNumber}, 'inbound', 'ringing'
      )
    `);
    const acceptConfig = {
      type: "realtime",
      model: "gpt-realtime-1.5",
      instructions: phoneNumber.system_prompt || "You are a helpful AI assistant answering phone calls.",
      voice: phoneNumber.openai_voice || "alloy",
      input_audio_transcription: {
        model: "whisper-1"
      }
    };
    console.log(`[OpenAI SIP] Accepting call with agent: ${phoneNumber.agent_name}`);
    return { action: "accept", config: acceptConfig, userId: phoneNumber.user_id };
  }
  static async acceptCall(callId, config) {
    if (SIP_MOCK_MODE) {
      console.log(`[OpenAI SIP] Mock mode: Simulating call accept for ${callId}`);
      return { success: true };
    }
    try {
      const apiKey = await this.getOpenAIApiKey();
      const response = await fetch(`${OPENAI_API_BASE}/realtime/calls/${callId}/accept`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session: {
            voice: config.voice,
            instructions: config.instructions,
            model: config.model,
            input_audio_transcription: config.input_audio_transcription,
            tools: config.tools
          }
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAI SIP] Accept call failed: ${response.status} - ${errorText}`);
        return { success: false, error: errorText };
      }
      console.log(`[OpenAI SIP] Call ${callId} accepted`);
      await db.execute(sql`
        UPDATE sip_calls SET status = 'in-progress', answered_at = NOW(), updated_at = NOW()
        WHERE openai_call_id = ${callId}
      `);
      return { success: true };
    } catch (error) {
      console.error(`[OpenAI SIP] Error accepting call ${callId}:`, error);
      return { success: false, error: error.message };
    }
  }
  static async rejectCall(callId, reason) {
    if (SIP_MOCK_MODE) {
      console.log(`[OpenAI SIP] Mock mode: Simulating call reject for ${callId}`);
      return { success: true };
    }
    try {
      const apiKey = await this.getOpenAIApiKey();
      const response = await fetch(`${OPENAI_API_BASE}/realtime/calls/${callId}/reject`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reason })
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenAI SIP] Reject call failed: ${response.status} - ${errorText}`);
        return { success: false, error: errorText };
      }
      console.log(`[OpenAI SIP] Call ${callId} rejected: ${reason}`);
      await db.execute(sql`
        UPDATE sip_calls SET status = 'cancelled', ended_at = NOW(), updated_at = NOW()
        WHERE openai_call_id = ${callId}
      `);
      return { success: true };
    } catch (error) {
      console.error(`[OpenAI SIP] Error rejecting call ${callId}:`, error);
      return { success: false, error: error.message };
    }
  }
  static async handleCallCompleted(callId, duration, transcript) {
    console.log(`[OpenAI SIP] Call ${callId} completed`);
    const sipCallResult = await db.execute(sql`
      SELECT id, user_id, from_number, to_number FROM sip_calls 
      WHERE openai_call_id = ${callId} LIMIT 1
    `);
    const sipCall = sipCallResult.rows[0];
    await db.execute(sql`
      UPDATE sip_calls SET 
        status = 'completed',
        duration_seconds = ${duration || 0},
        transcript = ${JSON.stringify(transcript || [])},
        ended_at = NOW(),
        updated_at = NOW()
      WHERE openai_call_id = ${callId}
    `);
    if (sipCall && duration && duration > 0) {
      try {
        const { deductSipCallCredits } = (await import("../service-registry.js")).getSipServices();
        console.log(`\u{1F4B3} [OpenAI SIP] Processing credit deduction for ${duration}s call`);
        const creditResult = await deductSipCallCredits(sipCall.id, duration, "openai-sip");
        if (creditResult.success) {
          console.log(`\u2705 [OpenAI SIP] Credits deducted: ${creditResult.creditsDeducted}`);
        } else {
          console.error(`\u274C [OpenAI SIP] Credit deduction failed: ${creditResult.error}`);
        }
      } catch (creditError) {
        console.error(`\u274C [OpenAI SIP] Credit deduction error:`, creditError.message);
      }
    }
    try {
      if (sipCall) {
        await db.execute(sql`
          UPDATE flow_executions SET 
            status = 'completed',
            completed_at = NOW()
          WHERE call_id = ${sipCall.id} 
            AND (status = 'running' OR status = 'pending')
        `);
        console.log(`[OpenAI SIP] Updated flow execution for call ${sipCall.id} to completed`);
      }
    } catch (flowExecError) {
      console.warn(`[OpenAI SIP] Failed to update flow execution status: ${flowExecError.message}`);
    }
  }
  static async handleCallFailed(callId, reason) {
    console.log(`[OpenAI SIP] Call ${callId} failed: ${reason}`);
    await db.execute(sql`
      UPDATE sip_calls SET 
        status = 'failed',
        metadata = jsonb_set(COALESCE(metadata, '{}')::jsonb, '{failureReason}', ${JSON.stringify(reason)}::jsonb),
        ended_at = NOW(),
        updated_at = NOW()
      WHERE openai_call_id = ${callId}
    `);
    try {
      const sipCallResult = await db.execute(sql`
        SELECT id FROM sip_calls WHERE openai_call_id = ${callId} LIMIT 1
      `);
      const sipCall = sipCallResult.rows[0];
      if (sipCall) {
        await db.execute(sql`
          UPDATE flow_executions SET 
            status = 'failed',
            completed_at = NOW(),
            error = ${`Call failed: ${reason}`}
          WHERE call_id = ${sipCall.id} 
            AND (status = 'running' OR status = 'pending')
        `);
        console.log(`[OpenAI SIP] Updated flow execution for call ${sipCall.id} to failed`);
      }
    } catch (flowExecError) {
      console.warn(`[OpenAI SIP] Failed to update flow execution status: ${flowExecError.message}`);
    }
  }
  static async provisionTrunk(userId, trunk) {
    try {
      const projectId = await this.getOpenAIProjectId();
      const sipEndpoint = this.getSipEndpoint(projectId);
      await db.execute(sql`
        UPDATE sip_trunks SET 
          openai_project_id = ${projectId},
          inbound_uri = ${sipEndpoint},
          updated_at = NOW()
        WHERE id = ${trunk.id}
      `);
      console.log(`[OpenAI SIP] Trunk provisioned with endpoint: ${sipEndpoint}`);
      return { success: true, sipEndpoint };
    } catch (error) {
      console.error(`[OpenAI SIP] Error provisioning trunk:`, error);
      return { success: false, error: error.message };
    }
  }
  static async importPhoneNumber(userId, trunk, phoneNumber, label, agentId) {
    console.log(`[OpenAI SIP] Importing phone number: ${phoneNumber}`);
    const result = await db.execute(sql`
      INSERT INTO sip_phone_numbers (
        user_id, sip_trunk_id, phone_number, label, engine,
        agent_id, inbound_enabled, outbound_enabled
      )
      VALUES (
        ${userId}, ${trunk.id}, ${phoneNumber}, ${label || null},
        'openai-sip', ${agentId || null}, true, false
      )
      RETURNING *
    `);
    return result.rows[0];
  }
  static extractPhoneNumber(sipUri) {
    const match = sipUri.match(/sip:([^@]+)@/);
    if (match) {
      return match[1].replace(/[^\d+]/g, "");
    }
    return sipUri.replace(/[^\d+]/g, "");
  }
}
export {
  OpenAISipService
};
