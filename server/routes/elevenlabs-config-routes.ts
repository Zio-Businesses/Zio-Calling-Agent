import { Router, Request, Response } from "express";
import { RouteContext, AuthRequest } from "./common";
import { ElevenLabsPoolService } from "../services/elevenlabs-pool";
import { db } from "../db";
import { users, elevenLabsCredentials } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function createElevenLabsConfigRoutes(ctx: RouteContext): Router {
  const router = Router();
  const { authenticateToken, storage } = ctx;

  /**
   * Get current ElevenLabs configuration (masked)
   */
  router.get("/api/elevenlabs/config", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!user.elevenLabsCredentialId) {
        return res.json({ configured: false });
      }

      const [credential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(eq(elevenLabsCredentials.id, user.elevenLabsCredentialId))
        .limit(1);

      if (!credential) {
        return res.json({ configured: false });
      }

      // Mask the API key
      const maskedKey = credential.apiKey.length > 8 
        ? `${credential.apiKey.substring(0, 4)}...${credential.apiKey.substring(credential.apiKey.length - 4)}`
        : "****";

      res.json({
        configured: true,
        apiKey: maskedKey,
        webhookSecret: credential.webhookSecret ? "****" : null,
        healthStatus: credential.healthStatus,
        lastHealthCheck: credential.lastHealthCheck,
      });
    } catch (error: any) {
      console.error("Get ElevenLabs config error:", error);
      res.status(500).json({ error: "Failed to get configuration" });
    }
  });

  /**
   * Test ElevenLabs credentials
   */
  router.post("/api/elevenlabs/config/test", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { apiKey } = req.body;
      if (!apiKey) {
        return res.status(400).json({ error: "API Key is required" });
      }

      const isValid = await ElevenLabsPoolService.testCredential(apiKey);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid ElevenLabs API key" });
      }

      res.json({ success: true, message: "Connection successful" });
    } catch (error: any) {
      console.error("Test ElevenLabs config error:", error);
      res.status(500).json({ error: "Failed to test connection" });
    }
  });

  /**
   * Save ElevenLabs credentials
   */
  router.post("/api/elevenlabs/config", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const { apiKey, webhookSecret } = req.body;
      const userId = req.userId!;

      if (!apiKey) {
        return res.status(400).json({ error: "API Key is required" });
      }

      // Test the key first
      const isValid = await ElevenLabsPoolService.testCredential(apiKey);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid ElevenLabs API key" });
      }

      // Check if user already has a private credential
      const [existingCredential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(
          and(
            eq(elevenLabsCredentials.userId, userId),
            eq(elevenLabsCredentials.isShared, false)
          )
        )
        .limit(1);

      let credentialId: string;

      if (existingCredential) {
        // Update existing
        await db
          .update(elevenLabsCredentials)
          .set({
            apiKey,
            webhookSecret: webhookSecret || null,
            healthStatus: "healthy",
            lastHealthCheck: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(elevenLabsCredentials.id, existingCredential.id));
        
        credentialId = existingCredential.id;
        console.log(`✅ Updated private ElevenLabs credential for user ${userId}`);
      } else {
        // Create new private credential
        const [newCredential] = await db
          .insert(elevenLabsCredentials)
          .values({
            name: `Private Key - User ${userId}`,
            apiKey,
            webhookSecret: webhookSecret || null,
            userId,
            isShared: false,
            maxConcurrency: 10, // Lower default for private keys
            isActive: true,
            healthStatus: "healthy",
            lastHealthCheck: new Date(),
          })
          .returning();
        
        credentialId = newCredential.id;
        console.log(`✅ Created new private ElevenLabs credential for user ${userId}`);
      }

      // Assign to user
      await ElevenLabsPoolService.assignUserToCredential(userId, credentialId);

      res.json({ success: true, message: "Configuration saved successfully" });
    } catch (error: any) {
      console.error("Save ElevenLabs config error:", error);
      res.status(500).json({ error: "Failed to save configuration" });
    }
  });

  /**
   * Remove ElevenLabs credentials (revert to system pool)
   */
  router.delete("/api/elevenlabs/config", authenticateToken, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const [user] = await db
        .select({ elevenLabsCredentialId: users.elevenLabsCredentialId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user?.elevenLabsCredentialId) {
        return res.json({ success: true, message: "No custom configuration found" });
      }

      // Check if it's a private credential
      const [credential] = await db
        .select()
        .from(elevenLabsCredentials)
        .where(eq(elevenLabsCredentials.id, user.elevenLabsCredentialId))
        .limit(1);

      if (credential && credential.userId === userId) {
        // Delete the private credential
        await db
          .delete(elevenLabsCredentials)
          .where(eq(elevenLabsCredentials.id, credential.id));
        
        console.log(`🗑️ Deleted private ElevenLabs credential for user ${userId}`);
      }

      // Unset the credential ID on user - ElevenLabsPoolService.getUserCredential will reassign a system key on next use
      await db
        .update(users)
        .set({ 
          elevenLabsCredentialId: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      res.json({ success: true, message: "Custom configuration removed. System pool will be used." });
    } catch (error: any) {
      console.error("Remove ElevenLabs config error:", error);
      res.status(500).json({ error: "Failed to remove configuration" });
    }
  });

  return router;
}
