import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
import {
  SIP_PROVIDER_INFO
} from "../types.js";
const SIP_MOCK_MODE = process.env.SIP_MOCK_MODE === "true";
const COMPOUND_WORD_FIXES = [
  // Fix "Elevenlabs" (after underscore conversion) -> "ElevenLabs"
  [/Elevenlabs/g, "ElevenLabs"],
  // Fix "elevenlabs" at start of string -> "elevenLabs" (keep first char case)
  [/^elevenlabs/g, "elevenLabs"],
  // Fix "Openai" (after underscore conversion) -> "OpenAI"
  [/Openai/g, "OpenAI"],
  // Fix "openai" at start of string -> "openAI"
  [/^openai/g, "openAI"]
];
function snakeToCamel(str) {
  let result = str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  for (const [pattern, replacement] of COMPOUND_WORD_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
function transformRow(row) {
  const transformed = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed;
}
function transformRows(rows) {
  return rows.map((row) => transformRow(row));
}
class SipTrunkService {
  static async getUserTrunks(userId) {
    const result = await db.execute(sql`
      SELECT * FROM sip_trunks 
      WHERE user_id = ${userId} 
      ORDER BY created_at DESC
    `);
    return transformRows(result.rows);
  }
  static async getTrunkById(id, userId) {
    const result = await db.execute(sql`
      SELECT * FROM sip_trunks 
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `);
    return result.rows[0] ? transformRow(result.rows[0]) : null;
  }
  static async checkSipAccess(userId, engine) {
    const userResult = await db.execute(sql`
      SELECT u.*, p.sip_enabled, p.max_concurrent_sip_calls, p.sip_engines_allowed
      FROM users u
      LEFT JOIN plans p ON u.plan_type = p.name
      WHERE u.id = ${userId}
      LIMIT 1
    `);
    const user = userResult.rows[0];
    if (!user) {
      return { allowed: false, reason: "User not found" };
    }
    if (!user.sip_enabled) {
      return { allowed: false, reason: "SIP is not enabled for your plan" };
    }
    const allowedEngines = user.sip_engines_allowed || ["elevenlabs-sip"];
    if (!allowedEngines.includes(engine)) {
      return { allowed: false, reason: `Engine ${engine} is not available for your plan` };
    }
    return { allowed: true };
  }
  static async createTrunk(userId, data) {
    const providerInfo = SIP_PROVIDER_INFO[data.provider] || SIP_PROVIDER_INFO.generic;
    const sipHost = data.sipHost || providerInfo.defaultHost;
    const sipPort = data.sipPort || providerInfo.defaultPort;
    const transport = data.transport || providerInfo.transport;
    const inboundTransport = data.inboundTransport || (data.provider === "twilio" ? "tcp" : transport);
    const inboundPort = data.inboundPort || (data.provider === "twilio" ? 5060 : sipPort);
    const result = await db.execute(sql`
      INSERT INTO sip_trunks (
        user_id, name, engine, provider, sip_host, sip_port, transport, 
        inbound_transport, inbound_port, media_encryption, username, password
      )
      VALUES (
        ${userId}, ${data.name}, ${data.engine}, ${data.provider},
        ${sipHost}, ${sipPort}, ${transport},
        ${inboundTransport}, ${inboundPort},
        ${data.mediaEncryption || "disable"}, ${data.username || null}, ${data.password || null}
      )
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async updateTrunk(id, userId, updates) {
    const setParts = [];
    if (updates.name !== void 0) {
      setParts.push(sql`name = ${updates.name}`);
    }
    if (updates.sipHost !== void 0) {
      setParts.push(sql`sip_host = ${updates.sipHost}`);
    }
    if (updates.sipPort !== void 0) {
      setParts.push(sql`sip_port = ${updates.sipPort}`);
    }
    if (updates.transport !== void 0) {
      setParts.push(sql`transport = ${updates.transport}`);
    }
    if (updates.inboundTransport !== void 0) {
      setParts.push(sql`inbound_transport = ${updates.inboundTransport}`);
    }
    if (updates.inboundPort !== void 0) {
      setParts.push(sql`inbound_port = ${updates.inboundPort}`);
    }
    if (updates.mediaEncryption !== void 0) {
      setParts.push(sql`media_encryption = ${updates.mediaEncryption}`);
    }
    if (updates.username !== void 0) {
      setParts.push(sql`username = ${updates.username}`);
    }
    if (updates.password !== void 0) {
      setParts.push(sql`password = ${updates.password}`);
    }
    if (updates.isActive !== void 0) {
      setParts.push(sql`is_active = ${updates.isActive}`);
    }
    setParts.push(sql`updated_at = NOW()`);
    const setClause = sql.join(setParts, sql`, `);
    const result = await db.execute(sql`
      UPDATE sip_trunks SET ${setClause}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async deleteTrunk(id, userId) {
    await db.transaction(async (tx) => {
      const trunkResult = await tx.execute(sql`
        SELECT id FROM sip_trunks WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
      `);
      if (trunkResult.rows.length === 0) {
        throw new Error("SIP trunk not found or access denied");
      }
      await tx.execute(sql`
        UPDATE sip_calls SET sip_phone_number_id = NULL
        WHERE sip_phone_number_id IN (
          SELECT id FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
        )
      `);
      await tx.execute(sql`
        UPDATE sip_calls SET sip_trunk_id = NULL
        WHERE sip_trunk_id = ${id}
      `);
      await tx.execute(sql`
        UPDATE agents SET sip_phone_number_id = NULL
        WHERE sip_phone_number_id IN (
          SELECT id FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
        )
      `);
      await tx.execute(sql`
        DELETE FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
      `);
      await tx.execute(sql`
        DELETE FROM sip_trunks WHERE id = ${id} AND user_id = ${userId}
      `);
    });
  }
  static async testTrunkConnection(id) {
    if (SIP_MOCK_MODE) {
      return { success: true, message: "Mock mode: Connection simulated", latency: 50 };
    }
    const result = await db.execute(sql`SELECT * FROM sip_trunks WHERE id = ${id} LIMIT 1`);
    if (result.rows.length === 0) {
      return { success: false, message: "Trunk not found" };
    }
    const trunk = transformRow(result.rows[0]);
    const host = trunk.sipHost;
    const port = trunk.sipPort || 5060;
    const transport = (trunk.transport || "udp").toLowerCase();
    const startTime = Date.now();
    try {
      if (transport === "udp") {
        const dns = await import("dns");
        await new Promise((resolve, reject) => {
          dns.lookup(host, (err) => {
            if (err) reject(new Error(`DNS resolution failed for ${host}: ${err.message}`));
            else resolve();
          });
        });
      } else {
        const net = await import("net");
        await new Promise((resolve, reject) => {
          const socket = new net.Socket();
          const timeout = 5e3;
          socket.setTimeout(timeout);
          socket.connect(port, host, () => {
            socket.destroy();
            resolve();
          });
          socket.on("timeout", () => {
            socket.destroy();
            reject(new Error(`Connection timed out after ${timeout}ms`));
          });
          socket.on("error", (err) => {
            socket.destroy();
            reject(new Error(`TCP connection failed to ${host}:${port}: ${err.message}`));
          });
        });
      }
      const latency = Date.now() - startTime;
      await db.execute(sql`
        UPDATE sip_trunks 
        SET health_status = 'healthy', last_health_check = NOW()
        WHERE id = ${id}
      `);
      return { success: true, message: "Connection successful", latency };
    } catch (err) {
      const latency = Date.now() - startTime;
      await db.execute(sql`
        UPDATE sip_trunks 
        SET health_status = 'unhealthy', last_health_check = NOW()
        WHERE id = ${id}
      `);
      return { success: false, message: err.message || "Connection failed", latency };
    }
  }
  static async getUserPhoneNumbers(userId) {
    const result = await db.execute(sql`
      SELECT spn.*, st.name as trunk_name
      FROM sip_phone_numbers spn
      JOIN sip_trunks st ON spn.sip_trunk_id = st.id
      WHERE spn.user_id = ${userId}
      ORDER BY spn.created_at DESC
    `);
    return transformRows(result.rows);
  }
  static async getPhoneNumberById(id, userId) {
    const result = await db.execute(sql`
      SELECT * FROM sip_phone_numbers 
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `);
    return result.rows[0] ? transformRow(result.rows[0]) : null;
  }
  static async importPhoneNumber(userId, trunk, data) {
    const result = await db.execute(sql`
      INSERT INTO sip_phone_numbers (
        user_id, sip_trunk_id, phone_number, label, engine,
        agent_id, custom_headers
      )
      VALUES (
        ${userId}, ${trunk.id}, ${data.phoneNumber}, ${data.label || null},
        ${trunk.engine}, ${data.agentId || null}, ${JSON.stringify(data.customHeaders || {})}
      )
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async updatePhoneNumber(id, userId, updates) {
    const result = await db.execute(sql`
      UPDATE sip_phone_numbers 
      SET 
        label = COALESCE(${updates.label}, label),
        inbound_enabled = COALESCE(${updates.inboundEnabled}, inbound_enabled),
        outbound_enabled = COALESCE(${updates.outboundEnabled}, outbound_enabled),
        is_active = COALESCE(${updates.isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async assignAgentToPhoneNumber(id, userId, agentId) {
    const result = await db.execute(sql`
      UPDATE sip_phone_numbers 
      SET agent_id = ${agentId}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async deletePhoneNumber(id, userId) {
    await db.transaction(async (tx) => {
      const phoneResult = await tx.execute(sql`
        SELECT id FROM sip_phone_numbers WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
      `);
      if (phoneResult.rows.length === 0) {
        throw new Error("SIP phone number not found or access denied");
      }
      await tx.execute(sql`
        UPDATE sip_calls SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);
      await tx.execute(sql`
        UPDATE agents SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);
      await tx.execute(sql`
        UPDATE campaigns SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);
      await tx.execute(sql`
        DELETE FROM sip_phone_numbers WHERE id = ${id} AND user_id = ${userId}
      `);
    });
  }
  static async getAllTrunks(filters) {
    let query = sql`SELECT st.*, u.name as user_name, u.email as user_email 
                    FROM sip_trunks st 
                    JOIN users u ON st.user_id = u.id 
                    WHERE 1=1`;
    if (filters?.userId) {
      query = sql`${query} AND st.user_id = ${filters.userId}`;
    }
    if (filters?.engine) {
      query = sql`${query} AND st.engine = ${filters.engine}`;
    }
    if (filters?.isActive !== void 0) {
      query = sql`${query} AND st.is_active = ${filters.isActive}`;
    }
    query = sql`${query} ORDER BY st.created_at DESC`;
    const result = await db.execute(query);
    return transformRows(result.rows);
  }
  static async getAllPhoneNumbers(filters) {
    let query = sql`SELECT spn.*, u.name as user_name, st.name as trunk_name
                    FROM sip_phone_numbers spn
                    JOIN users u ON spn.user_id = u.id
                    JOIN sip_trunks st ON spn.sip_trunk_id = st.id
                    WHERE 1=1`;
    if (filters?.userId) {
      query = sql`${query} AND spn.user_id = ${filters.userId}`;
    }
    if (filters?.engine) {
      query = sql`${query} AND spn.engine = ${filters.engine}`;
    }
    query = sql`${query} ORDER BY spn.created_at DESC`;
    const result = await db.execute(query);
    return transformRows(result.rows);
  }
  static async getSipCalls(filters) {
    let query = sql`SELECT * FROM sip_calls WHERE 1=1`;
    let countQuery = sql`SELECT COUNT(*) as total FROM sip_calls WHERE 1=1`;
    if (filters.userId) {
      query = sql`${query} AND user_id = ${filters.userId}`;
      countQuery = sql`${countQuery} AND user_id = ${filters.userId}`;
    }
    if (filters.engine) {
      query = sql`${query} AND engine = ${filters.engine}`;
      countQuery = sql`${countQuery} AND engine = ${filters.engine}`;
    }
    if (filters.status) {
      query = sql`${query} AND status = ${filters.status}`;
      countQuery = sql`${countQuery} AND status = ${filters.status}`;
    }
    if (filters.startDate) {
      query = sql`${query} AND created_at >= ${filters.startDate}`;
      countQuery = sql`${countQuery} AND created_at >= ${filters.startDate}`;
    }
    if (filters.endDate) {
      query = sql`${query} AND created_at <= ${filters.endDate}`;
      countQuery = sql`${countQuery} AND created_at <= ${filters.endDate}`;
    }
    query = sql`${query} ORDER BY created_at DESC LIMIT ${filters.limit || 50} OFFSET ${filters.offset || 0}`;
    const [callsResult, countResult] = await Promise.all([
      db.execute(query),
      db.execute(countQuery)
    ]);
    return {
      calls: transformRows(callsResult.rows),
      total: parseInt(countResult.rows[0].total)
    };
  }
  /**
   * Get a single SIP call by ID
   */
  static async getSipCall(callId) {
    const result = await db.execute(sql`
      SELECT * FROM sip_calls WHERE id = ${callId} LIMIT 1
    `);
    if (result.rows.length === 0) {
      return null;
    }
    return transformRow(result.rows[0]);
  }
  static async getPlanSipSettings(planId) {
    const result = await db.execute(sql`
      SELECT sip_enabled, max_concurrent_sip_calls, sip_engines_allowed
      FROM plans WHERE id = ${planId} OR name = ${planId}
      LIMIT 1
    `);
    const plan = result.rows[0];
    if (!plan) {
      return { sipEnabled: false, maxConcurrentSipCalls: 0, sipEnginesAllowed: [] };
    }
    return {
      sipEnabled: plan.sip_enabled || false,
      maxConcurrentSipCalls: plan.max_concurrent_sip_calls || 0,
      sipEnginesAllowed: plan.sip_engines_allowed || ["elevenlabs-sip"]
    };
  }
  static async updatePlanSipSettings(planId, settings) {
    const enginesArray = settings.sipEnginesAllowed ? `{${settings.sipEnginesAllowed.join(",")}}` : null;
    await db.execute(sql`
      UPDATE plans SET
        sip_enabled = COALESCE(${settings.sipEnabled}, sip_enabled),
        max_concurrent_sip_calls = COALESCE(${settings.maxConcurrentSipCalls}, max_concurrent_sip_calls),
        sip_engines_allowed = COALESCE(${enginesArray}::text[], sip_engines_allowed),
        updated_at = NOW()
      WHERE id = ${planId} OR name = ${planId}
    `);
    return this.getPlanSipSettings(planId);
  }
  static async getAdminSettings() {
    return {
      pluginEnabled: true,
      defaultMaxConcurrentCalls: 10,
      mockMode: SIP_MOCK_MODE
    };
  }
  static async updateAdminSettings(updates) {
    return this.getAdminSettings();
  }
  static async getAdminStats() {
    const [trunksResult, phoneNumbersResult, callsResult, activeCallsResult] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM sip_trunks`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_phone_numbers`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_calls`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_calls WHERE status = 'in-progress'`)
    ]);
    const engineResult = await db.execute(sql`
      SELECT engine, COUNT(*) as count FROM sip_trunks GROUP BY engine
    `);
    const byEngine = {};
    for (const row of engineResult.rows) {
      byEngine[row.engine] = parseInt(row.count);
    }
    return {
      totalTrunks: parseInt(trunksResult.rows[0].count),
      totalPhoneNumbers: parseInt(phoneNumbersResult.rows[0].count),
      totalCalls: parseInt(callsResult.rows[0].count),
      activeCalls: parseInt(activeCallsResult.rows[0].count),
      byEngine
    };
  }
  static async createSipCall(data) {
    const result = await db.execute(sql`
      INSERT INTO sip_calls (
        user_id, agent_id, campaign_id, contact_id, sip_trunk_id,
        sip_phone_number_id, engine, external_call_id, from_number,
        to_number, direction, status
      )
      VALUES (
        ${data.userId}, ${data.agentId || null}, ${data.campaignId || null},
        ${data.contactId || null}, ${data.sipTrunkId || null},
        ${data.sipPhoneNumberId || null}, ${data.engine}, ${data.externalCallId || null},
        ${data.fromNumber || "unknown"}, ${data.toNumber || "unknown"}, ${data.direction},
        ${data.status || "initiated"}
      )
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
  static async updateSipCall(id, updates) {
    const result = await db.execute(sql`
      UPDATE sip_calls SET
        status = COALESCE(${updates.status}, status),
        duration_seconds = COALESCE(${updates.durationSeconds}, duration_seconds),
        credits_used = COALESCE(${updates.creditsUsed}, credits_used),
        recording_url = COALESCE(${updates.recordingUrl}, recording_url),
        transcript = COALESCE(${updates.transcript ? JSON.stringify(updates.transcript) : null}, transcript),
        ai_summary = COALESCE(${updates.aiSummary}, ai_summary),
        answered_at = COALESCE(${updates.answeredAt}, answered_at),
        ended_at = COALESCE(${updates.endedAt}, ended_at),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    return transformRow(result.rows[0]);
  }
}
export {
  SipTrunkService
};
