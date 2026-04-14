/**
 * SIP Trunk Service
 * Core service for managing SIP trunks, phone numbers, and calls
 */

import { db } from '../../../server/db';
import { sql } from 'drizzle-orm';
import { 
  SipTrunk, 
  SipPhoneNumber, 
  SipCall,
  CreateSipTrunkRequest, 
  ImportSipPhoneNumberRequest,
  SipEngine,
  SipProvider,
  PlanSipSettings,
  AdminSipSettings,
  SIP_PROVIDER_INFO,
} from '../types';

const SIP_MOCK_MODE = process.env.SIP_MOCK_MODE === 'true';

/**
 * Convert snake_case database column names to camelCase for frontend
 * Handles special compound words like "elevenlabs" -> "ElevenLabs"
 * 
 * After basic snake_case conversion:
 * - "external_elevenlabs_phone_id" -> "externalElevenlabsPhoneId"
 * We then need to fix "Elevenlabs" -> "ElevenLabs" (add capital L for Labs)
 */
const COMPOUND_WORD_FIXES: Array<[RegExp, string]> = [
  // Fix "Elevenlabs" (after underscore conversion) -> "ElevenLabs"
  [/Elevenlabs/g, 'ElevenLabs'],
  // Fix "elevenlabs" at start of string -> "elevenLabs" (keep first char case)
  [/^elevenlabs/g, 'elevenLabs'],
  // Fix "Openai" (after underscore conversion) -> "OpenAI"
  [/Openai/g, 'OpenAI'],
  // Fix "openai" at start of string -> "openAI"
  [/^openai/g, 'openAI'],
];

function snakeToCamel(str: string): string {
  // First, do basic snake_case to camelCase conversion
  let result = str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  
  // Then apply compound word fixes
  for (const [pattern, replacement] of COMPOUND_WORD_FIXES) {
    result = result.replace(pattern, replacement);
  }
  
  return result;
}

function transformRow<T>(row: Record<string, any>): T {
  const transformed: Record<string, any> = {};
  for (const key of Object.keys(row)) {
    transformed[snakeToCamel(key)] = row[key];
  }
  return transformed as T;
}

function transformRows<T>(rows: Record<string, any>[]): T[] {
  return rows.map(row => transformRow<T>(row));
}

export class SipTrunkService {
  static async getUserTrunks(userId: string): Promise<SipTrunk[]> {
    const result = await db.execute(sql`
      SELECT * FROM sip_trunks 
      WHERE user_id = ${userId} 
      ORDER BY created_at DESC
    `);
    return transformRows<SipTrunk>(result.rows as Record<string, any>[]);
  }

  static async getTrunkById(id: string, userId: string): Promise<SipTrunk | null> {
    const result = await db.execute(sql`
      SELECT * FROM sip_trunks 
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `);
    return result.rows[0] ? transformRow<SipTrunk>(result.rows[0] as Record<string, any>) : null;
  }

  static async checkSipAccess(userId: string, engine: SipEngine): Promise<{ allowed: boolean; reason?: string }> {
    const userResult = await db.execute(sql`
      SELECT u.*, p.sip_enabled, p.max_concurrent_sip_calls, p.sip_engines_allowed
      FROM users u
      LEFT JOIN plans p ON u.plan_type = p.name
      WHERE u.id = ${userId}
      LIMIT 1
    `);

    const user = userResult.rows[0] as any;
    if (!user) {
      return { allowed: false, reason: 'User not found' };
    }

    if (!user.sip_enabled) {
      return { allowed: false, reason: 'SIP is not enabled for your plan' };
    }

    const allowedEngines = user.sip_engines_allowed || ['elevenlabs-sip'];
    if (!allowedEngines.includes(engine)) {
      return { allowed: false, reason: `Engine ${engine} is not available for your plan` };
    }

    return { allowed: true };
  }

  static async createTrunk(userId: string, data: CreateSipTrunkRequest): Promise<SipTrunk> {
    const providerInfo = SIP_PROVIDER_INFO[data.provider] || SIP_PROVIDER_INFO.generic;
    const sipHost = data.sipHost || providerInfo.defaultHost;
    const sipPort = data.sipPort || providerInfo.defaultPort;
    const transport = data.transport || providerInfo.transport;
    
    // Inbound settings - can differ from outbound (e.g., Twilio uses TCP:5060 inbound, TLS:5061 outbound)
    const inboundTransport = data.inboundTransport || (data.provider === 'twilio' ? 'tcp' : transport);
    const inboundPort = data.inboundPort || (data.provider === 'twilio' ? 5060 : sipPort);
    
    const result = await db.execute(sql`
      INSERT INTO sip_trunks (
        user_id, name, engine, provider, sip_host, sip_port, transport, 
        inbound_transport, inbound_port, media_encryption, username, password
      )
      VALUES (
        ${userId}, ${data.name}, ${data.engine}, ${data.provider},
        ${sipHost}, ${sipPort}, ${transport},
        ${inboundTransport}, ${inboundPort},
        ${data.mediaEncryption || 'disable'}, ${data.username || null}, ${data.password || null}
      )
      RETURNING *
    `);
    return transformRow<SipTrunk>(result.rows[0] as Record<string, any>);
  }

  static async updateTrunk(id: string, userId: string, updates: Partial<SipTrunk>): Promise<SipTrunk> {
    const setParts: ReturnType<typeof sql>[] = [];
    
    if (updates.name !== undefined) {
      setParts.push(sql`name = ${updates.name}`);
    }
    if (updates.sipHost !== undefined) {
      setParts.push(sql`sip_host = ${updates.sipHost}`);
    }
    if (updates.sipPort !== undefined) {
      setParts.push(sql`sip_port = ${updates.sipPort}`);
    }
    if (updates.transport !== undefined) {
      setParts.push(sql`transport = ${updates.transport}`);
    }
    if (updates.inboundTransport !== undefined) {
      setParts.push(sql`inbound_transport = ${updates.inboundTransport}`);
    }
    if (updates.inboundPort !== undefined) {
      setParts.push(sql`inbound_port = ${updates.inboundPort}`);
    }
    if (updates.mediaEncryption !== undefined) {
      setParts.push(sql`media_encryption = ${updates.mediaEncryption}`);
    }
    if (updates.username !== undefined) {
      setParts.push(sql`username = ${updates.username}`);
    }
    if (updates.password !== undefined) {
      setParts.push(sql`password = ${updates.password}`);
    }
    if (updates.isActive !== undefined) {
      setParts.push(sql`is_active = ${updates.isActive}`);
    }
    
    setParts.push(sql`updated_at = NOW()`);
    
    const setClause = sql.join(setParts, sql`, `);
    
    const result = await db.execute(sql`
      UPDATE sip_trunks SET ${setClause}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    
    return transformRow<SipTrunk>(result.rows[0] as Record<string, any>);
  }

  static async deleteTrunk(id: string, userId: string): Promise<void> {
    // Use a transaction to ensure atomic deletion and prevent TOCTOU races
    await db.transaction(async (tx) => {
      // Verify ownership and lock the row
      const trunkResult = await tx.execute(sql`
        SELECT id FROM sip_trunks WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
      `);
      
      if (trunkResult.rows.length === 0) {
        throw new Error('SIP trunk not found or access denied');
      }
      
      // Nullify foreign key references in sip_calls before deleting phone numbers
      // This preserves call history while allowing phone number deletion
      await tx.execute(sql`
        UPDATE sip_calls SET sip_phone_number_id = NULL
        WHERE sip_phone_number_id IN (
          SELECT id FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
        )
      `);
      
      // Nullify trunk reference in sip_calls before deleting the trunk
      await tx.execute(sql`
        UPDATE sip_calls SET sip_trunk_id = NULL
        WHERE sip_trunk_id = ${id}
      `);
      
      // Nullify agent references to SIP phone numbers being deleted
      await tx.execute(sql`
        UPDATE agents SET sip_phone_number_id = NULL
        WHERE sip_phone_number_id IN (
          SELECT id FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
        )
      `);
      
      // Delete phone numbers scoped to both trunk AND user for security
      await tx.execute(sql`
        DELETE FROM sip_phone_numbers WHERE sip_trunk_id = ${id} AND user_id = ${userId}
      `);
      
      // Delete the trunk
      await tx.execute(sql`
        DELETE FROM sip_trunks WHERE id = ${id} AND user_id = ${userId}
      `);
    });
  }

  static async testTrunkConnection(id: string): Promise<{ success: boolean; message: string; latency?: number }> {
    if (SIP_MOCK_MODE) {
      return { success: true, message: 'Mock mode: Connection simulated', latency: 50 };
    }

    const result = await db.execute(sql`SELECT * FROM sip_trunks WHERE id = ${id} LIMIT 1`);
    
    if (result.rows.length === 0) {
      return { success: false, message: 'Trunk not found' };
    }
    
    const trunk = transformRow<SipTrunk>(result.rows[0] as Record<string, any>);
    const host = trunk.sipHost;
    const port = trunk.sipPort || 5060;
    const transport = (trunk.transport || 'udp').toLowerCase();

    const startTime = Date.now();

    try {
      if (transport === 'udp') {
        const dns = await import('dns');
        await new Promise<void>((resolve, reject) => {
          dns.lookup(host, (err) => {
            if (err) reject(new Error(`DNS resolution failed for ${host}: ${err.message}`));
            else resolve();
          });
        });
      } else {
        const net = await import('net');
        await new Promise<void>((resolve, reject) => {
          const socket = new net.Socket();
          const timeout = 5000;
          socket.setTimeout(timeout);
          socket.connect(port, host, () => {
            socket.destroy();
            resolve();
          });
          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error(`Connection timed out after ${timeout}ms`));
          });
          socket.on('error', (err) => {
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

      return { success: true, message: 'Connection successful', latency };
    } catch (err: any) {
      const latency = Date.now() - startTime;

      await db.execute(sql`
        UPDATE sip_trunks 
        SET health_status = 'unhealthy', last_health_check = NOW()
        WHERE id = ${id}
      `);

      return { success: false, message: err.message || 'Connection failed', latency };
    }
  }

  static async getUserPhoneNumbers(userId: string): Promise<SipPhoneNumber[]> {
    const result = await db.execute(sql`
      SELECT spn.*, st.name as trunk_name
      FROM sip_phone_numbers spn
      JOIN sip_trunks st ON spn.sip_trunk_id = st.id
      WHERE spn.user_id = ${userId}
      ORDER BY spn.created_at DESC
    `);
    return transformRows<SipPhoneNumber>(result.rows as Record<string, any>[]);
  }

  static async getPhoneNumberById(id: string, userId: string): Promise<SipPhoneNumber | null> {
    const result = await db.execute(sql`
      SELECT * FROM sip_phone_numbers 
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `);
    return result.rows[0] ? transformRow<SipPhoneNumber>(result.rows[0] as Record<string, any>) : null;
  }

  static async importPhoneNumber(
    userId: string, 
    trunk: SipTrunk, 
    data: ImportSipPhoneNumberRequest
  ): Promise<SipPhoneNumber> {
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
    return transformRow<SipPhoneNumber>(result.rows[0] as Record<string, any>);
  }

  static async updatePhoneNumber(id: string, userId: string, updates: Partial<SipPhoneNumber>): Promise<SipPhoneNumber> {
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
    return transformRow<SipPhoneNumber>(result.rows[0] as Record<string, any>);
  }

  static async assignAgentToPhoneNumber(id: string, userId: string, agentId: string | null): Promise<SipPhoneNumber> {
    const result = await db.execute(sql`
      UPDATE sip_phone_numbers 
      SET agent_id = ${agentId}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `);
    return transformRow<SipPhoneNumber>(result.rows[0] as Record<string, any>);
  }

  static async deletePhoneNumber(id: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Verify ownership before nullifying references
      const phoneResult = await tx.execute(sql`
        SELECT id FROM sip_phone_numbers WHERE id = ${id} AND user_id = ${userId} FOR UPDATE
      `);
      if (phoneResult.rows.length === 0) {
        throw new Error('SIP phone number not found or access denied');
      }

      // Nullify all referencing tables before deleting the phone number record
      await tx.execute(sql`
        UPDATE sip_calls SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);

      await tx.execute(sql`
        UPDATE agents SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);

      await tx.execute(sql`
        UPDATE campaigns SET sip_phone_number_id = NULL WHERE sip_phone_number_id = ${id}
      `);

      // Now safe to delete the phone number record
      await tx.execute(sql`
        DELETE FROM sip_phone_numbers WHERE id = ${id} AND user_id = ${userId}
      `);
    });
  }

  static async getAllTrunks(filters?: { userId?: string; engine?: string; isActive?: boolean }): Promise<SipTrunk[]> {
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
    if (filters?.isActive !== undefined) {
      query = sql`${query} AND st.is_active = ${filters.isActive}`;
    }
    
    query = sql`${query} ORDER BY st.created_at DESC`;
    
    const result = await db.execute(query);
    return transformRows<SipTrunk>(result.rows as Record<string, any>[]);
  }

  static async getAllPhoneNumbers(filters?: { userId?: string; engine?: string }): Promise<SipPhoneNumber[]> {
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
    return transformRows<SipPhoneNumber>(result.rows as Record<string, any>[]);
  }

  static async getSipCalls(filters: {
    userId?: string;
    engine?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ calls: SipCall[]; total: number }> {
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
      db.execute(countQuery),
    ]);
    
    return {
      calls: transformRows<SipCall>(callsResult.rows as Record<string, any>[]),
      total: parseInt((countResult.rows[0] as any).total),
    };
  }

  /**
   * Get a single SIP call by ID
   */
  static async getSipCall(callId: string): Promise<SipCall | null> {
    const result = await db.execute(sql`
      SELECT * FROM sip_calls WHERE id = ${callId} LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return transformRow<SipCall>(result.rows[0] as Record<string, any>);
  }

  static async getPlanSipSettings(planId: string): Promise<PlanSipSettings> {
    const result = await db.execute(sql`
      SELECT sip_enabled, max_concurrent_sip_calls, sip_engines_allowed
      FROM plans WHERE id = ${planId} OR name = ${planId}
      LIMIT 1
    `);
    
    const plan = result.rows[0] as any;
    if (!plan) {
      return { sipEnabled: false, maxConcurrentSipCalls: 0, sipEnginesAllowed: [] };
    }
    
    return {
      sipEnabled: plan.sip_enabled || false,
      maxConcurrentSipCalls: plan.max_concurrent_sip_calls || 0,
      sipEnginesAllowed: plan.sip_engines_allowed || ['elevenlabs-sip'],
    };
  }

  static async updatePlanSipSettings(planId: string, settings: Partial<PlanSipSettings>): Promise<PlanSipSettings> {
    const enginesArray = settings.sipEnginesAllowed 
      ? `{${settings.sipEnginesAllowed.join(',')}}` 
      : null;
    
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

  static async getAdminSettings(): Promise<AdminSipSettings> {
    return {
      pluginEnabled: true,
      defaultMaxConcurrentCalls: 10,
      mockMode: SIP_MOCK_MODE,
    };
  }

  static async updateAdminSettings(updates: Partial<AdminSipSettings>): Promise<AdminSipSettings> {
    return this.getAdminSettings();
  }

  static async getAdminStats(): Promise<{
    totalTrunks: number;
    totalPhoneNumbers: number;
    totalCalls: number;
    activeCalls: number;
    byEngine: Record<string, number>;
  }> {
    const [trunksResult, phoneNumbersResult, callsResult, activeCallsResult] = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM sip_trunks`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_phone_numbers`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_calls`),
      db.execute(sql`SELECT COUNT(*) as count FROM sip_calls WHERE status = 'in-progress'`),
    ]);

    const engineResult = await db.execute(sql`
      SELECT engine, COUNT(*) as count FROM sip_trunks GROUP BY engine
    `);

    const byEngine: Record<string, number> = {};
    for (const row of engineResult.rows as any[]) {
      byEngine[row.engine] = parseInt(row.count);
    }

    return {
      totalTrunks: parseInt((trunksResult.rows[0] as any).count),
      totalPhoneNumbers: parseInt((phoneNumbersResult.rows[0] as any).count),
      totalCalls: parseInt((callsResult.rows[0] as any).count),
      activeCalls: parseInt((activeCallsResult.rows[0] as any).count),
      byEngine,
    };
  }

  static async createSipCall(data: Partial<SipCall>): Promise<SipCall> {
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
        ${data.fromNumber || 'unknown'}, ${data.toNumber || 'unknown'}, ${data.direction},
        ${data.status || 'initiated'}
      )
      RETURNING *
    `);
    return transformRow<SipCall>(result.rows[0] as Record<string, any>);
  }

  static async updateSipCall(id: string, updates: Partial<SipCall>): Promise<SipCall> {
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
    return transformRow<SipCall>(result.rows[0] as Record<string, any>);
  }
}
