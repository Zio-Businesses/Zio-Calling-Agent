'use strict';
import { db } from '../db';
import { isNotNull, eq } from 'drizzle-orm';
import { phoneNumbers } from '@shared/schema';
import { ElevenLabsPoolService } from './elevenlabs-pool';
import { ElevenLabsService } from './elevenlabs';
import { storage } from '../storage';

/**
 * Re-syncs all ElevenLabs-registered phone numbers with the current Twilio credentials.
 *
 * This is needed when the Twilio Account SID or Auth Token is rotated.
 * ElevenLabs stores those credentials internally for SIP authentication on outbound calls.
 * If they go stale, every outbound call fails with "max auth retry attempts reached".
 *
 * Strategy for each number:
 *   1. Resolve the ElevenLabs credential — prefer the phone row's elevenLabsCredentialId
 *      for deterministic behaviour in multi-key setups, falling back to user/pool lookup.
 *   2. Delete the old ElevenLabs registration using that credential's API key.
 *   3. Re-register with the current Twilio credentials.
 *   4. Update BOTH elevenLabsPhoneNumberId and elevenLabsCredentialId in the DB row.
 *
 * Runs all numbers concurrently (Promise.allSettled) — partial failures do not block others.
 */
export async function resyncElevenLabsPhoneCredentials(): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const dbSid = await storage.getGlobalSetting('twilio_account_sid');
  const dbToken = await storage.getGlobalSetting('twilio_auth_token');
  const twilioAccountSid = (dbSid?.value as string) || process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = (dbToken?.value as string) || process.env.TWILIO_AUTH_TOKEN;

  if (!twilioAccountSid || !twilioAuthToken) {
    throw new Error('Twilio credentials not configured');
  }

  const registered = await db
    .select()
    .from(phoneNumbers)
    .where(isNotNull(phoneNumbers.elevenLabsPhoneNumberId));

  if (registered.length === 0) {
    return { synced: 0, failed: 0, errors: [] };
  }

  console.log(`[ElevenLabs Resync] Re-syncing Twilio credentials for ${registered.length} phone number(s)`);

  const results = await Promise.allSettled(
    registered.map(async (phone) => {
      const oldId = phone.elevenLabsPhoneNumberId!;

      let credential =
        phone.elevenLabsCredentialId
          ? await ElevenLabsPoolService.getCredentialById(phone.elevenLabsCredentialId)
          : null;

      if (!credential) {
        if (phone.userId) {
          credential = await ElevenLabsPoolService.getUserCredential(phone.userId);
        } else {
          credential = await ElevenLabsPoolService.getAvailableCredential();
        }
      }

      if (!credential) {
        throw new Error(`No ElevenLabs credential for ${phone.phoneNumber}`);
      }

      const elevenLabsService = new ElevenLabsService(credential.apiKey);

      console.log(`[ElevenLabs Resync] Deleting old registration ${oldId} for ${phone.phoneNumber} (cred: ${credential.id})`);
      try {
        await elevenLabsService.deletePhoneNumber(oldId);
      } catch (deleteErr: any) {
        console.warn(`[ElevenLabs Resync] Delete failed (continuing): ${deleteErr.message}`);
      }

      console.log(`[ElevenLabs Resync] Re-registering ${phone.phoneNumber} with fresh Twilio credentials`);
      const result = await elevenLabsService.syncPhoneNumberToElevenLabs({
        phoneNumber: phone.phoneNumber,
        twilioAccountSid,
        twilioAuthToken,
        label: phone.phoneNumber,
        enableOutbound: true,
      });

      await db
        .update(phoneNumbers)
        .set({
          elevenLabsPhoneNumberId: result.phone_number_id,
          elevenLabsCredentialId: credential.id,
        })
        .where(eq(phoneNumbers.id, phone.id));

      console.log(`[ElevenLabs Resync] ✅ ${phone.phoneNumber} -> new id ${result.phone_number_id} (cred: ${credential.id})`);
    })
  );

  let synced = 0;
  const errors: string[] = [];

  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      synced++;
    } else {
      const msg = `${registered[i].phoneNumber}: ${r.reason?.message ?? r.reason}`;
      errors.push(msg);
      console.error(`[ElevenLabs Resync] ❌ ${msg}`);
    }
  });

  console.log(`[ElevenLabs Resync] Done — synced ${synced}, failed ${errors.length}`);
  return { synced, failed: errors.length, errors };
}
