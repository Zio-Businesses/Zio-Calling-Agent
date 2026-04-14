export interface SipPluginServices {
  canAssignSipAgent: (userId: string) => Promise<{ allowed: boolean; threshold: number; balance: number }>;
  deductSipCallCredits: (sipCallId: string, durationSeconds: number, engine: string) => Promise<{ success: boolean; creditsDeducted?: number; error?: string }>;
  checkUserCreditBalance: (userId: string) => Promise<{ hasCredits: boolean; balance: number }>;
  ElevenLabsService: new (apiKey: string) => any;
  getCredentialForAgent: (agentId: string) => Promise<{ id: number; apiKey: string } | null>;
}

let _services: SipPluginServices | null = null;

export function setSipServices(services: SipPluginServices): void {
  _services = services;
}

export function getSipServices(): SipPluginServices {
  if (!_services) {
    throw new Error('[SIP Engine Plugin] Services not initialized. Ensure services are injected at plugin registration.');
  }
  return _services;
}
