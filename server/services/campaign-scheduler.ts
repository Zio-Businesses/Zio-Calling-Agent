'use strict';
/**
 * ============================================================
 * © 2025 Diploy — a brand of Bisht Technologies Private Limited
 * Original Author: BTPL Engineering Team
 * Website: https://diploy.in
 * Contact: cs@diploy.in
 *
 * Distributed under the Envato / CodeCanyon License Agreement.
 * Licensed to the purchaser for use as defined by the
 * Envato Market (CodeCanyon) Regular or Extended License.
 *
 * You are NOT permitted to redistribute, resell, sublicense,
 * or share this source code, in whole or in part.
 * Respect the author's rights and Envato licensing terms.
 * ============================================================
 */
import { Campaign, campaigns, calls } from "@shared/schema";
import { db } from '../db';
import { eq, and, or, isNotNull, sql, lte } from 'drizzle-orm';
import { emailService } from './email-service';
import { BatchCallingService } from './batch-calling';

function isBullMQEnabled(): boolean {
  return process.env.ENABLE_BULLMQ === 'true' && !!process.env.REDIS_URL;
}

export class CampaignScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static isRunning = false;

  /**
   * Start the background scheduler that checks campaigns every minute
   * NOTE: When BullMQ is enabled, this scheduler still handles:
   * - Time window-based pause/resume (scheduleEnabled, scheduleDays, scheduleTimeStart/End)
   * - ElevenLabs batch job polling and completion
   * BullMQ's scheduler-worker handles:
   * - Starting campaigns with scheduledFor timestamp
   * - Recovery of stuck campaigns
   * - Cleanup of stale calls
   */
  static startBackgroundScheduler(): void {
    if (this.intervalId) {
      console.log('[Campaign Scheduler] Background scheduler already running');
      return;
    }

    const bullmqMode = isBullMQEnabled();
    console.log(`🕐 [Campaign Scheduler] Starting background scheduler (30s interval)${bullmqMode ? ' - BullMQ handles scheduled starts' : ''}`);
    
    // Run immediately on start
    this.checkScheduledCampaigns().catch(err => {
      console.error('[Campaign Scheduler] Initial check failed:', err);
    });
    this.pollRunningBatchJobs().catch(err => {
      console.error('[Campaign Scheduler] Initial batch poll failed:', err);
    });

    // Then run every 30 seconds for faster campaign status sync
    this.intervalId = setInterval(() => {
      this.checkScheduledCampaigns().catch(err => {
        console.error('[Campaign Scheduler] Scheduled check failed:', err);
      });
      this.pollRunningBatchJobs().catch(err => {
        console.error('[Campaign Scheduler] Batch poll failed:', err);
      });
    }, 30 * 1000);
  }

  /**
   * Stop the background scheduler
   */
  static stopBackgroundScheduler(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Campaign Scheduler] Background scheduler stopped');
    }
  }

  /**
   * Check all scheduled campaigns and auto-pause/resume based on time windows
   */
  static async checkScheduledCampaigns(): Promise<void> {
    if (this.isRunning) {
      console.log('[Campaign Scheduler] Check already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    
    try {
      // Import campaignExecutor dynamically to avoid circular dependency
      const { campaignExecutor } = await import('./campaign-executor');

      // Check for campaigns scheduled to start (only if BullMQ is NOT enabled)
      // BullMQ has its own scheduler-worker for this
      if (!isBullMQEnabled()) {
        await this.checkAndStartScheduledCampaigns(campaignExecutor);
      }

      // Find running campaigns that need to be paused (outside time window)
      const runningCampaigns = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.status, 'running'),
            eq(campaigns.scheduleEnabled, true),
            isNotNull(campaigns.batchJobId)
          )
        );

      for (const campaign of runningCampaigns) {
        const isWithinWindow = this.isWithinCallWindow(campaign);
        
        if (!isWithinWindow) {
          console.log(`⏸️ [Campaign Scheduler] Auto-pausing campaign "${campaign.name}" (outside time window)`);
          try {
            await campaignExecutor.pauseCampaign(campaign.id, 'scheduled');
          } catch (err: any) {
            console.error(`   Failed to pause: ${err.message}`);
          }
        }
      }

      // Find paused campaigns that can be resumed (inside time window)
      const pausedCampaigns = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.status, 'paused'),
            eq(campaigns.scheduleEnabled, true),
            isNotNull(campaigns.batchJobId)
          )
        );

      for (const campaign of pausedCampaigns) {
        // Only auto-resume if it was paused by the scheduler (not manually)
        const config = campaign.config as Record<string, any> || {};
        if (config.pauseReason !== 'scheduled') {
          continue;
        }

        const isWithinWindow = this.isWithinCallWindow(campaign);
        
        if (isWithinWindow) {
          console.log(`▶️ [Campaign Scheduler] Auto-resuming campaign "${campaign.name}" (inside time window)`);
          try {
            await campaignExecutor.resumeCampaign(campaign.id, 'scheduled');
          } catch (err: any) {
            console.error(`   Failed to resume: ${err.message}`);
          }
        }
      }

    } catch (error) {
      console.error('[Campaign Scheduler] Error checking campaigns:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check for campaigns with scheduledFor timestamp that are due to start
   * This is only called when BullMQ is NOT enabled
   */
  private static async checkAndStartScheduledCampaigns(campaignExecutor: any): Promise<void> {
    const now = new Date();
    
    const scheduledCampaigns = await db.select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.status, 'scheduled'),
          isNotNull(campaigns.scheduledFor),
          lte(campaigns.scheduledFor, now)
        )
      )
      .limit(10);
    
    if (scheduledCampaigns.length > 0) {
      console.log(`[Campaign Scheduler] Found ${scheduledCampaigns.length} campaigns ready to start`);
    }
    
    for (const campaign of scheduledCampaigns) {
      try {
        await db.update(campaigns)
          .set({ status: 'queued' })
          .where(
            and(
              eq(campaigns.id, campaign.id),
              eq(campaigns.status, 'scheduled')
            )
          );
        
        await campaignExecutor.executeCampaign(campaign.id);
        console.log(`[Campaign Scheduler] Started scheduled campaign ${campaign.id}`);
      } catch (error: any) {
        console.error(`[Campaign Scheduler] Failed to start campaign ${campaign.id}:`, error.message);
        
        await db.update(campaigns)
          .set({ 
            status: 'failed',
            errorMessage: error.message,
            errorCode: 'SCHEDULER_ERROR',
          })
          .where(eq(campaigns.id, campaign.id));
      }
    }
  }

  static isWithinCallWindow(campaign: Campaign): boolean {
    if (!campaign.scheduleEnabled) {
      return true;
    }

    const now = new Date();
    const timezone = campaign.scheduleTimezone || "America/New_York";
    
    const currentTimeInZone = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    const dayOfWeek = currentTimeInZone.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone }).toLowerCase();
    
    if (campaign.scheduleDays && campaign.scheduleDays.length > 0) {
      if (!campaign.scheduleDays.includes(dayOfWeek)) {
        return false;
      }
    }
    
    if (campaign.scheduleTimeStart && campaign.scheduleTimeEnd) {
      const currentHours = currentTimeInZone.getHours();
      const currentMinutes = currentTimeInZone.getMinutes();
      const currentTimeMinutes = currentHours * 60 + currentMinutes;
      
      const [startHours, startMinutes] = campaign.scheduleTimeStart.split(":").map(Number);
      const startTimeMinutes = startHours * 60 + startMinutes;
      
      const [endHours, endMinutes] = campaign.scheduleTimeEnd.split(":").map(Number);
      const endTimeMinutes = endHours * 60 + endMinutes;
      
      if (currentTimeMinutes < startTimeMinutes || currentTimeMinutes > endTimeMinutes) {
        return false;
      }
    }
    
    return true;
  }

  static getNextCallWindow(campaign: Campaign): Date | null {
    if (!campaign.scheduleEnabled) {
      return new Date();
    }

    const timezone = campaign.scheduleTimezone || "America/New_York";
    const now = new Date();
    
    for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
      const checkDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
      
      const dayOfWeek = checkDate.toLocaleDateString("en-US", { 
        weekday: "long", 
        timeZone: timezone 
      }).toLowerCase();
      
      if (campaign.scheduleDays && campaign.scheduleDays.length > 0) {
        if (!campaign.scheduleDays.includes(dayOfWeek)) {
          continue;
        }
      }
      
      if (campaign.scheduleTimeStart) {
        const [startHours, startMinutes] = campaign.scheduleTimeStart.split(":").map(Number);
        
        // NOTE: This timezone conversion uses an iterative approach to handle most cases.
        // Known limitation: May have edge cases during DST transitions (spring forward/fall back).
        // For production use with precise DST handling, consider using a library like Temporal or luxon.
        
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        
        const parts = formatter.formatToParts(checkDate);
        const targetYear = parseInt(parts.find(p => p.type === "year")!.value, 10);
        const targetMonth = parseInt(parts.find(p => p.type === "month")!.value, 10) - 1;
        const targetDay = parseInt(parts.find(p => p.type === "day")!.value, 10);
        
        let guessUTC = Date.UTC(targetYear, targetMonth, targetDay, startHours, startMinutes, 0);
        let iterations = 0;
        const maxIterations = 3;
        
        while (iterations < maxIterations) {
          const guessDate = new Date(guessUTC);
          const guessParts = formatter.formatToParts(guessDate);
          
          const guessYear = parseInt(guessParts.find(p => p.type === "year")!.value, 10);
          const guessMonth = parseInt(guessParts.find(p => p.type === "month")!.value, 10) - 1;
          const guessDay = parseInt(guessParts.find(p => p.type === "day")!.value, 10);
          const guessHour = parseInt(guessParts.find(p => p.type === "hour")!.value, 10);
          const guessMinute = parseInt(guessParts.find(p => p.type === "minute")!.value, 10);
          
          if (guessYear === targetYear && guessMonth === targetMonth && guessDay === targetDay && guessHour === startHours && guessMinute === startMinutes) {
            break;
          }
          
          const actualLocalTime = Date.UTC(guessYear, guessMonth, guessDay, guessHour, guessMinute, 0);
          const desiredLocalTime = Date.UTC(targetYear, targetMonth, targetDay, startHours, startMinutes, 0);
          const offset = actualLocalTime - guessUTC;
          
          guessUTC = desiredLocalTime - offset;
          iterations++;
        }
        
        const correctUTC = new Date(guessUTC);
        
        if (correctUTC > now) {
          return correctUTC;
        }
      } else {
        return checkDate;
      }
    }
    
    return null;
  }

  static formatTimeWindow(campaign: Campaign): string {
    if (!campaign.scheduleEnabled) {
      return "24/7 (No restrictions)";
    }

    const parts: string[] = [];
    
    if (campaign.scheduleDays && campaign.scheduleDays.length > 0) {
      const days = campaign.scheduleDays.map(d => 
        d.charAt(0).toUpperCase() + d.slice(1)
      ).join(", ");
      parts.push(days);
    }
    
    if (campaign.scheduleTimeStart && campaign.scheduleTimeEnd) {
      parts.push(`${campaign.scheduleTimeStart} - ${campaign.scheduleTimeEnd}`);
    }
    
    if (campaign.scheduleTimezone) {
      parts.push(campaign.scheduleTimezone);
    }
    
    return parts.join(" | ");
  }

  /**
   * Poll running campaigns with batch jobs and sync status from ElevenLabs
   */
  static async pollRunningBatchJobs(): Promise<void> {
    try {
      // Find running campaigns with batch job IDs
      const runningCampaigns = await db
        .select()
        .from(campaigns)
        .where(
          and(
            eq(campaigns.status, 'running'),
            isNotNull(campaigns.batchJobId)
          )
        );

      if (runningCampaigns.length === 0) {
        return;
      }

      console.log(`🔄 [Campaign Scheduler] Polling ${runningCampaigns.length} running batch jobs`);

      // Import campaignExecutor dynamically to avoid circular dependency
      const { campaignExecutor } = await import('./campaign-executor');

      for (const campaign of runningCampaigns) {
        try {
          console.log(`   Checking batch status for "${campaign.name}" (${campaign.batchJobId})`);
          
          // Get latest batch status from ElevenLabs
          const batchJob = await campaignExecutor.getBatchJobStatus(campaign.id);
          
          if (batchJob) {
            console.log(`   Batch status: ${batchJob.status}, dispatched: ${batchJob.total_calls_dispatched}/${batchJob.total_calls_scheduled}`);
            
            // Update pending call records based on recipient status
            if (batchJob.recipients && batchJob.recipients.length > 0) {
              await this.syncCallRecordsFromBatch(campaign.id, batchJob.recipients);
            }
            
            // Always check campaign completion on every poll
            // This handles cases where webhooks already updated call statuses
            // or when ElevenLabs batch is complete but recipients list is empty
            await this.checkCampaignCompletion(campaign.id);
          }
        } catch (err: any) {
          // If ElevenLabs returns 404, the batch job has been purged from their system.
          // Stop polling by marking all pending calls as failed and completing the campaign.
          const is404 = err.statusCode === 404 ||
            /404/.test(err.message) ||
            /not found/i.test(err.message);

          if (is404) {
            console.warn(`⚠️ [Campaign Scheduler] Batch job not found on ElevenLabs for "${campaign.name}" (${campaign.batchJobId}) — marking expired`);
            await this.expireBatchCampaign(campaign.id, campaign.name);
          } else {
            console.error(`   Error polling batch for "${campaign.name}": ${err.message}`);
          }
        }
      }
    } catch (error) {
      console.error('[Campaign Scheduler] Error polling batch jobs:', error);
    }
  }

  /**
   * Handle a campaign whose ElevenLabs batch job was not found (404/purged).
   * Marks all pending call records as failed, then triggers campaign completion.
   */
  private static async expireBatchCampaign(campaignId: string, campaignName: string): Promise<void> {
    try {
      // Mark all still-pending call records as failed
      const updatedCalls = await db
        .update(calls)
        .set({
          status: 'failed',
          endedAt: new Date(),
          metadata: sql`COALESCE(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({ errorMessage: 'Batch job expired or not found on ElevenLabs' })}::jsonb`,
        })
        .where(
          and(
            eq(calls.campaignId, campaignId),
            eq(calls.status, 'pending')
          )
        )
        .returning({ id: calls.id });

      console.log(`   Marked ${updatedCalls.length} pending call(s) as failed for expired campaign "${campaignName}"`);

      // Now that all calls are in a final state, complete the campaign
      await this.checkCampaignCompletion(campaignId);
    } catch (expireErr: any) {
      console.error(`   Failed to expire campaign "${campaignName}": ${expireErr.message}`);
    }
  }

  /**
   * Sync call records based on ElevenLabs batch recipient status
   */
  private static async syncCallRecordsFromBatch(
    campaignId: string, 
    recipients: Array<{
      recipient_id: string;
      phone_number: string;
      status: string;
      conversation_id?: string;
      call_duration_secs?: number;
      error_message?: string;
    }>
  ): Promise<void> {
    for (const recipient of recipients) {
      // Skip recipients that are still pending, in progress, or dispatched (call not completed yet)
      // Only sync when we have a final status: completed, failed, no_response, cancelled
      const pendingStatuses = ['pending', 'in_progress', 'dispatched', 'ringing', 'initiated'];
      if (pendingStatuses.includes(recipient.status)) {
        continue;
      }

      // Normalize the phone number from ElevenLabs before matching.
      // This handles cases where the stored phone was scientific notation
      // (e.g. "9.20E+11") that was already expanded at import time, ensuring
      // we compare apples-to-apples against what ElevenLabs returns.
      const normalizedRecipientPhone = BatchCallingService.normalizePhoneNumber(recipient.phone_number);
      const phoneWithoutPlus = normalizedRecipientPhone.replace(/^\+/, '');

      // Find matching call record by phone number (try normalized form first)
      const [callRecord] = await db
        .select()
        .from(calls)
        .where(
          and(
            eq(calls.campaignId, campaignId),
            eq(calls.phoneNumber, normalizedRecipientPhone),
            eq(calls.status, 'pending')
          )
        )
        .limit(1);

      if (!callRecord) {
        // Try without the + prefix (some records may be stored without it)
        const [altCallRecord] = await db
          .select()
          .from(calls)
          .where(
            and(
              eq(calls.campaignId, campaignId),
              eq(calls.phoneNumber, phoneWithoutPlus),
              eq(calls.status, 'pending')
            )
          )
          .limit(1);
        
        if (!altCallRecord) continue;
        
        // Update the alt record
        await this.updateCallRecordFromRecipient(altCallRecord.id, recipient);
      } else {
        await this.updateCallRecordFromRecipient(callRecord.id, recipient);
      }
    }
    // Note: checkCampaignCompletion is called in pollRunningBatchJobs after this
  }

  /**
   * Update a call record based on recipient status from ElevenLabs
   */
  private static async updateCallRecordFromRecipient(
    callId: string,
    recipient: {
      status: string;
      conversation_id?: string;
      call_duration_secs?: number;
      error_message?: string;
    }
  ): Promise<void> {
    // Map ElevenLabs recipient status to our call status
    // ElevenLabs statuses: pending, in_progress, dispatched, completed, failed, no_response, cancelled
    let callStatus: 'completed' | 'failed' | 'no-answer' | 'cancelled';
    switch (recipient.status) {
      case 'completed':
        callStatus = 'completed';
        break;
      case 'no_response':
        callStatus = 'no-answer';
        break;
      case 'cancelled':
        callStatus = 'cancelled';
        break;
      case 'failed':
      default:
        callStatus = 'failed';
        break;
    }

    const updateData: Record<string, any> = {
      status: callStatus,
      duration: recipient.call_duration_secs || 0,
    };

    if (recipient.conversation_id) {
      updateData.elevenLabsConversationId = recipient.conversation_id;
    }

    // Store error message in metadata if present
    if (recipient.error_message) {
      updateData.metadata = sql`COALESCE(${calls.metadata}, '{}'::jsonb) || ${JSON.stringify({ errorMessage: recipient.error_message })}::jsonb`;
    }

    await db
      .update(calls)
      .set(updateData)
      .where(eq(calls.id, callId));

    console.log(`   Updated call ${callId}: status=${callStatus}, conversation_id=${recipient.conversation_id || 'N/A'}`);
  }

  /**
   * Check if all calls in a campaign have reached a final status
   * If so, mark the campaign as completed and send the completion email
   */
  private static async checkCampaignCompletion(campaignId: string): Promise<void> {
    // Get all calls for this campaign
    const campaignCalls = await db
      .select()
      .from(calls)
      .where(eq(calls.campaignId, campaignId));

    if (campaignCalls.length === 0) {
      return;
    }

    // Final statuses - calls that have finished processing
    const finalStatuses = ['completed', 'failed', 'no-answer', 'busy', 'cancelled'];
    
    // Check if ALL calls have reached a final status
    const pendingCalls = campaignCalls.filter(c => !finalStatuses.includes(c.status));
    
    if (pendingCalls.length > 0) {
      console.log(`   Campaign ${campaignId}: ${pendingCalls.length}/${campaignCalls.length} calls still pending`);
      return;
    }

    // All calls are complete! Check if we already marked this campaign as completed
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign || campaign.status === 'completed') {
      return; // Already completed or not found
    }

    console.log(`✅ [Campaign Scheduler] All ${campaignCalls.length} calls complete for campaign "${campaign.name}"`);

    // Calculate final stats
    const successfulCalls = campaignCalls.filter(c => c.status === 'completed').length;
    const failedCalls = campaignCalls.filter(c => 
      ['failed', 'busy', 'no-answer', 'cancelled'].includes(c.status)
    ).length;

    // Update campaign status to completed
    await db
      .update(campaigns)
      .set({
        status: 'completed',
        completedAt: new Date(),
        completedCalls: campaignCalls.length,
        successfulCalls,
        failedCalls,
      })
      .where(eq(campaigns.id, campaignId));

    console.log(`   Campaign stats: ${successfulCalls} successful, ${failedCalls} failed`);

    // Send campaign completion email
    try {
      await emailService.sendCampaignCompleted(campaignId);
      console.log(`   ✅ Campaign completion email sent for "${campaign.name}"`);
    } catch (emailError: any) {
      console.error(`   ❌ Failed to send campaign completion email: ${emailError.message}`);
    }
  }
}
