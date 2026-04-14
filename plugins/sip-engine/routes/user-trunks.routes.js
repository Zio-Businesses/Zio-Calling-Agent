import { Router } from "express";
import { SipTrunkService } from "../services/sip-trunk.service.js";
import { ElevenLabsSipService } from "../services/elevenlabs-sip.service.js";
import { OpenAISipService } from "../services/openai-sip.service.js";
import { SIP_PROVIDER_INFO } from "../types.js";
import { db } from "../../../server/db.js";
import { sql } from "drizzle-orm";
const router = Router();
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunks = await SipTrunkService.getUserTrunks(userId);
    res.json({ success: true, data: trunks });
  } catch (error) {
    console.error("[SIP Trunks] Error fetching trunks:", error);
    res.status(500).json({ success: false, message: "Failed to fetch SIP trunks" });
  }
});
router.get("/providers", (req, res) => {
  res.json({
    success: true,
    data: SIP_PROVIDER_INFO
  });
});
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunk = await SipTrunkService.getTrunkById(id, userId);
    if (!trunk) {
      return res.status(404).json({ success: false, message: "SIP trunk not found" });
    }
    res.json({ success: true, data: trunk });
  } catch (error) {
    console.error("[SIP Trunks] Error fetching trunk:", error);
    res.status(500).json({ success: false, message: "Failed to fetch SIP trunk" });
  }
});
router.post("/", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { name, engine, provider, sipHost, sipPort, transport, inboundTransport, inboundPort, mediaEncryption, username, password } = req.body;
    if (!name || !engine || !provider) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, engine, provider"
      });
    }
    const validEngines = ["elevenlabs-sip", "openai-sip"];
    if (!validEngines.includes(engine)) {
      return res.status(400).json({
        success: false,
        message: `Invalid engine. Must be one of: ${validEngines.join(", ")}`
      });
    }
    const validProviders = Object.keys(SIP_PROVIDER_INFO);
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: `Invalid provider. Must be one of: ${validProviders.join(", ")}`
      });
    }
    const providerInfo = SIP_PROVIDER_INFO[provider];
    const finalSipHost = sipHost || providerInfo.defaultHost;
    if (!providerInfo.defaultHost && !sipHost) {
      const providerName = providerInfo.name || provider;
      return res.status(400).json({
        success: false,
        message: `SIP Host is required for ${providerName}. Please enter your termination URI from your ${providerName} console.`
      });
    }
    if (finalSipHost) {
      let hostToValidate = finalSipHost;
      const atIndex = hostToValidate.indexOf("@");
      if (atIndex > -1) {
        hostToValidate = hostToValidate.substring(atIndex + 1);
      }
      let portFromHost = null;
      if (hostToValidate.startsWith("[")) {
        const bracketEnd = hostToValidate.indexOf("]");
        if (bracketEnd < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host. Malformed IPv6 address (missing closing bracket)."
          });
        }
        const ipv6Part = hostToValidate.substring(1, bracketEnd);
        const ipv6Regex2 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
        if (!ipv6Regex2.test(ipv6Part)) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host. Must be a valid IPv6 address inside brackets."
          });
        }
        const afterBracket = hostToValidate.substring(bracketEnd + 1);
        if (afterBracket.startsWith(":")) {
          portFromHost = parseInt(afterBracket.substring(1), 10);
          if (isNaN(portFromHost) || portFromHost < 1 || portFromHost > 65535) {
            return res.status(400).json({
              success: false,
              message: "Invalid port in SIP Host. Must be between 1 and 65535."
            });
          }
        }
        hostToValidate = ipv6Part;
      } else {
        const lastColon = hostToValidate.lastIndexOf(":");
        if (lastColon > -1) {
          const possiblePort = hostToValidate.substring(lastColon + 1);
          const parsed = parseInt(possiblePort, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
            portFromHost = parsed;
            hostToValidate = hostToValidate.substring(0, lastColon);
          }
        }
      }
      const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
      if (!hostnameRegex.test(hostToValidate) && !ipv4Regex.test(hostToValidate) && !ipv6Regex.test(hostToValidate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid SIP Host. Must be a valid hostname (e.g., sip.provider.com), IPv4, or IPv6 address. You may include user@host:port format."
        });
      }
      if (ipv4Regex.test(hostToValidate)) {
        const parts = hostToValidate.split(".").map(Number);
        if (parts.some((p) => p < 0 || p > 255)) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host IP address. Each octet must be between 0 and 255."
          });
        }
      }
      if (providerInfo.hostPattern && !ipv4Regex.test(hostToValidate) && !ipv6Regex.test(hostToValidate)) {
        if (!providerInfo.hostPattern.test(hostToValidate)) {
          return res.status(400).json({
            success: false,
            message: `Invalid SIP Host for ${providerInfo.name}. The hostname must match the ${providerInfo.name} format (e.g., ${providerInfo.hostExample || "check your provider console"}). If using a custom domain, select "Generic SIP" as provider.`
          });
        }
      }
    }
    const finalPort = sipPort || providerInfo.defaultPort;
    if (finalPort && (finalPort < 1 || finalPort > 65535)) {
      return res.status(400).json({
        success: false,
        message: "Invalid SIP port. Must be between 1 and 65535."
      });
    }
    if (engine === "openai-sip") {
      const openaiResult = await db.execute(sql`
        SELECT value FROM global_settings 
        WHERE key = 'openai_sip_project_id' 
        LIMIT 1
      `);
      const openaiSetting = openaiResult.rows[0];
      if (!openaiSetting?.value) {
        return res.status(400).json({
          success: false,
          message: "OpenAI SIP requires admin to configure OpenAI Project ID first"
        });
      }
    }
    const accessCheck = await SipTrunkService.checkSipAccess(userId, engine);
    if (!accessCheck.allowed) {
      return res.status(403).json({ success: false, message: accessCheck.reason });
    }
    const defaultInboundTransport = provider === "twilio" ? "tcp" : transport || providerInfo.transport;
    const defaultInboundPort = provider === "twilio" ? 5060 : sipPort || providerInfo.defaultPort;
    const trunkData = {
      name,
      engine,
      provider,
      sipHost: sipHost || providerInfo.defaultHost,
      sipPort: sipPort || providerInfo.defaultPort,
      transport: transport || providerInfo.transport,
      inboundTransport: inboundTransport || defaultInboundTransport,
      inboundPort: inboundPort || defaultInboundPort,
      mediaEncryption: mediaEncryption || "disable",
      // Disabled by default for compatibility
      username,
      password
    };
    let trunk = await SipTrunkService.createTrunk(userId, trunkData);
    if (engine === "openai-sip") {
      const provisionResult = await OpenAISipService.provisionTrunk(userId, trunk);
      if (!provisionResult.success) {
        console.warn(`[SIP Trunks] OpenAI SIP provisioning warning: ${provisionResult.error}`);
      } else {
        trunk = await SipTrunkService.getTrunkById(trunk.id, userId) || trunk;
      }
    } else if (engine === "elevenlabs-sip") {
      console.log(`[SIP Trunks] ElevenLabs trunk created - provisioning occurs during phone number import`);
    }
    res.status(201).json({ success: true, data: trunk });
  } catch (error) {
    console.error("[SIP Trunks] Error creating trunk:", error);
    res.status(500).json({ success: false, message: "Failed to create SIP trunk" });
  }
});
router.put("/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunk = await SipTrunkService.getTrunkById(id, userId);
    if (!trunk) {
      return res.status(404).json({ success: false, message: "SIP trunk not found" });
    }
    const updates = req.body;
    const validTransports = ["tcp", "tls", "udp"];
    if (updates.transport !== void 0 && !validTransports.includes(updates.transport)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transport. Must be one of: ${validTransports.join(", ")}`
      });
    }
    if (updates.inboundTransport !== void 0 && !validTransports.includes(updates.inboundTransport)) {
      return res.status(400).json({
        success: false,
        message: `Invalid inbound transport. Must be one of: ${validTransports.join(", ")}`
      });
    }
    const validMediaEncryption = ["disable", "allow", "require"];
    if (updates.mediaEncryption !== void 0 && !validMediaEncryption.includes(updates.mediaEncryption)) {
      return res.status(400).json({
        success: false,
        message: `Invalid media encryption. Must be one of: ${validMediaEncryption.join(", ")}`
      });
    }
    if (updates.sipPort !== void 0) {
      const port = parseInt(updates.sipPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({
          success: false,
          message: "Invalid SIP port. Must be between 1 and 65535."
        });
      }
      updates.sipPort = port;
    }
    if (updates.inboundPort !== void 0) {
      const port = parseInt(updates.inboundPort, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({
          success: false,
          message: "Invalid inbound port. Must be between 1 and 65535."
        });
      }
      updates.inboundPort = port;
    }
    if (updates.sipHost !== void 0) {
      let hostToValidate = updates.sipHost;
      const atIndex = hostToValidate.indexOf("@");
      if (atIndex > -1) {
        hostToValidate = hostToValidate.substring(atIndex + 1);
      }
      if (hostToValidate.startsWith("[")) {
        const bracketEnd = hostToValidate.indexOf("]");
        if (bracketEnd < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host. Malformed IPv6 address (missing closing bracket)."
          });
        }
        const ipv6Part = hostToValidate.substring(1, bracketEnd);
        const ipv6Regex2 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
        if (!ipv6Regex2.test(ipv6Part)) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host. Must be a valid IPv6 address inside brackets."
          });
        }
        const afterBracket = hostToValidate.substring(bracketEnd + 1);
        if (afterBracket.startsWith(":")) {
          const portFromHost = parseInt(afterBracket.substring(1), 10);
          if (isNaN(portFromHost) || portFromHost < 1 || portFromHost > 65535) {
            return res.status(400).json({
              success: false,
              message: "Invalid port in SIP Host. Must be between 1 and 65535."
            });
          }
        }
        hostToValidate = ipv6Part;
      } else {
        const lastColon = hostToValidate.lastIndexOf(":");
        if (lastColon > -1) {
          const possiblePort = hostToValidate.substring(lastColon + 1);
          const parsed = parseInt(possiblePort, 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
            hostToValidate = hostToValidate.substring(0, lastColon);
          }
        }
      }
      const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
      if (!hostnameRegex.test(hostToValidate) && !ipv4Regex.test(hostToValidate) && !ipv6Regex.test(hostToValidate)) {
        return res.status(400).json({
          success: false,
          message: "Invalid SIP Host. Must be a valid hostname (e.g., sip.provider.com), IPv4, or IPv6 address."
        });
      }
      if (ipv4Regex.test(hostToValidate)) {
        const parts = hostToValidate.split(".").map(Number);
        if (parts.some((p) => p < 0 || p > 255)) {
          return res.status(400).json({
            success: false,
            message: "Invalid SIP Host IP address. Each octet must be between 0 and 255."
          });
        }
      }
    }
    const updatedTrunk = await SipTrunkService.updateTrunk(id, userId, updates);
    res.json({ success: true, data: updatedTrunk });
  } catch (error) {
    console.error("[SIP Trunks] Error updating trunk:", error);
    res.status(500).json({ success: false, message: "Failed to update SIP trunk" });
  }
});
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunk = await SipTrunkService.getTrunkById(id, userId);
    if (!trunk) {
      return res.status(404).json({ success: false, message: "SIP trunk not found" });
    }
    await SipTrunkService.deleteTrunk(id, userId);
    res.json({ success: true, message: "SIP trunk deleted successfully" });
  } catch (error) {
    console.error("[SIP Trunks] Error deleting trunk:", error);
    res.status(500).json({ success: false, message: "Failed to delete SIP trunk" });
  }
});
router.post("/:id/test", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunk = await SipTrunkService.getTrunkById(id, userId);
    if (!trunk) {
      return res.status(404).json({ success: false, message: "SIP trunk not found" });
    }
    const result = await SipTrunkService.testTrunkConnection(id);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("[SIP Trunks] Error testing trunk:", error);
    res.status(500).json({ success: false, message: "Failed to test SIP trunk connection" });
  }
});
router.post("/:id/reprovision-all", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const trunk = await SipTrunkService.getTrunkById(id, userId);
    if (!trunk) {
      return res.status(404).json({ success: false, message: "SIP trunk not found" });
    }
    if (trunk.engine !== "elevenlabs-sip") {
      return res.status(400).json({
        success: false,
        message: "Re-provisioning is only available for ElevenLabs SIP trunks"
      });
    }
    const phoneNumbersResult = await db.execute(sql`
      SELECT id, phone_number, external_elevenlabs_phone_id
      FROM sip_phone_numbers
      WHERE sip_trunk_id = ${id} AND user_id = ${userId} AND engine = 'elevenlabs-sip'
    `);
    const phoneNumbers = phoneNumbersResult.rows;
    if (phoneNumbers.length === 0) {
      return res.json({
        success: true,
        message: "No phone numbers to re-provision",
        data: { updated: 0, failed: 0, total: 0 }
      });
    }
    let updated = 0;
    let failed = 0;
    const errors = [];
    for (const phone of phoneNumbers) {
      if (!phone.external_elevenlabs_phone_id) {
        console.log(`[SIP Trunks] Skipping ${phone.phone_number} - no ElevenLabs ID`);
        continue;
      }
      try {
        await ElevenLabsSipService.updatePhoneNumberSipConfig(
          userId,
          phone.external_elevenlabs_phone_id,
          trunk,
          phone.phone_number
        );
        updated++;
        console.log(`[SIP Trunks] Re-provisioned ${phone.phone_number}`);
      } catch (err) {
        failed++;
        errors.push(`${phone.phone_number}: ${err.message}`);
        console.error(`[SIP Trunks] Failed to re-provision ${phone.phone_number}:`, err.message);
      }
    }
    res.json({
      success: true,
      message: `Re-provisioned ${updated} of ${phoneNumbers.length} phone numbers`,
      data: {
        updated,
        failed,
        total: phoneNumbers.length,
        errors: errors.length > 0 ? errors : void 0
      }
    });
  } catch (error) {
    console.error("[SIP Trunks] Error re-provisioning trunk:", error);
    res.status(500).json({ success: false, message: "Failed to re-provision SIP trunk" });
  }
});
var user_trunks_routes_default = router;
export {
  user_trunks_routes_default as default
};
