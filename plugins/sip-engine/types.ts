/**
 * ============================================================
 * SIP Engine Plugin - Type Definitions
 * 
 * Updated to support multiple SIP providers for ElevenLabs and OpenAI SIP engines
 * ============================================================
 */

export type SipEngine = 'elevenlabs-sip' | 'openai-sip';

export type SipProvider = 
  | 'twilio' 
  | 'plivo' 
  | 'telnyx' 
  | 'vonage' 
  | 'exotel' 
  | 'bandwidth' 
  | 'didww'
  | 'zadarma'
  | 'cloudonix'
  | 'ringcentral'
  | 'sinch'
  | 'infobip'
  | 'generic';

export type SipTransport = 'tcp' | 'tls' | 'udp';

export type MediaEncryption = 'disable' | 'allow' | 'require';

export type SipCallDirection = 'inbound' | 'outbound';

export type SipCallStatus = 
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'cancelled';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface SipProviderCredentials {
  id: string;
  userId: string;
  provider: SipProvider;
  name: string;
  sipHost: string;
  sipPort: number;
  transport: SipTransport;
  mediaEncryption: MediaEncryption;
  username?: string;
  password?: string;
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
  isActive: boolean;
  healthStatus: HealthStatus;
  lastHealthCheck?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SipTrunk {
  id: string;
  userId: string;
  name: string;
  engine: SipEngine;
  provider: SipProvider;
  sipHost: string;
  sipPort: number;
  transport: SipTransport; // Outbound transport (ElevenLabs → Provider)
  mediaEncryption: MediaEncryption;
  // Inbound-specific settings (Provider → ElevenLabs)
  // Can differ from outbound - e.g., Twilio uses TCP:5060 inbound but TLS:5061 outbound
  inboundTransport?: SipTransport;
  inboundPort?: number;
  username?: string;
  password?: string;
  elevenLabsTrunkId?: string;
  openaiProjectId?: string;
  inboundUri?: string;
  isActive: boolean;
  healthStatus: HealthStatus;
  lastHealthCheck?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SipPhoneNumber {
  id: string;
  userId: string;
  sipTrunkId: string;
  phoneNumber: string;
  label?: string;
  engine: SipEngine;
  externalElevenLabsPhoneId?: string;
  agentId?: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  isActive: boolean;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SipCall {
  id: string;
  userId: string;
  agentId?: string;
  campaignId?: string;
  contactId?: string;
  sipTrunkId?: string;
  sipPhoneNumberId?: string;
  engine: SipEngine;
  externalCallId?: string;
  openaiCallId?: string;
  elevenlabsConversationId?: string;
  fromNumber?: string;
  toNumber?: string;
  direction: SipCallDirection;
  status: SipCallStatus;
  durationSeconds: number;
  creditsUsed: number;
  recordingUrl?: string;
  transcript?: TranscriptEntry[];
  aiSummary?: string;
  sipHeaders?: Record<string, string>;
  metadata?: Record<string, unknown>;
  startedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface CreateSipTrunkRequest {
  name: string;
  engine: SipEngine;
  provider: SipProvider;
  sipHost: string;
  sipPort?: number;
  transport?: SipTransport;  // Outbound transport (ElevenLabs → Provider)
  inboundTransport?: SipTransport;  // Inbound transport (Provider → ElevenLabs)
  inboundPort?: number;  // Inbound port (ElevenLabs listens here)
  mediaEncryption?: MediaEncryption;
  username?: string;
  password?: string;
}

export interface ImportSipPhoneNumberRequest {
  sipTrunkId: string;
  phoneNumber: string;
  label?: string;
  agentId?: string;
  customHeaders?: Record<string, string>;
}

export interface ElevenLabsSipTrunkConfig {
  outbound: {
    address: string;
    transport: 'tcp' | 'tls';
    media_encryption: 'allowed' | 'disabled' | 'required';
    username?: string;
    password?: string;
  };
  inbound?: {
    transport: 'tcp' | 'tls';
    media_encryption: 'allowed' | 'disabled' | 'required';
  };
  custom_headers?: Record<string, string>;
}

export interface ElevenLabsCredentials {
  username: string;
  password?: string;
}

export interface ElevenLabsInboundTrunkConfig {
  transport?: 'auto' | 'udp' | 'tcp' | 'tls';
  media_encryption: 'allowed' | 'disabled' | 'required';
  allowed_addresses?: string[];  // IP addresses/CIDR blocks
  allowed_numbers?: string[];    // Phone numbers allowed to call
  remote_domains?: string[];     // For TLS certificate validation
  credentials?: ElevenLabsCredentials;  // Digest auth (optional for inbound)
}

export interface ElevenLabsOutboundTrunkConfig {
  address: string;
  transport?: 'auto' | 'udp' | 'tcp' | 'tls';  // ElevenLabs API uses 'transport' for outbound
  media_encryption: 'allowed' | 'disabled' | 'required';
  headers?: Record<string, string>;  // SIP X-* headers for INVITE
  credentials?: ElevenLabsCredentials;  // Digest auth for outbound calls
}

export interface ElevenLabsImportPhoneNumberRequest {
  label: string;
  phone_number: string;
  provider_type: 'sip_trunk';
  inbound_trunk_config: ElevenLabsInboundTrunkConfig;
  outbound_trunk_config: ElevenLabsOutboundTrunkConfig;
  custom_headers?: Record<string, string>;
}

export interface ElevenLabsSipConfigUpdateRequest {
  inbound_trunk_config: ElevenLabsInboundTrunkConfig;
  outbound_trunk_config: ElevenLabsOutboundTrunkConfig;
  agent_id?: string | null;
}

export interface ElevenLabsOutboundCallRequest {
  agent_id: string;
  agent_phone_number_id: string;
  to_number: string;
  conversation_initiation_client_data?: Record<string, unknown>;
}

export interface OpenAIRealtimeCallIncomingEvent {
  object: 'event';
  id: string;
  type: 'realtime.call.incoming';
  created_at: number;
  data: {
    call_id: string;
    sip_headers: Array<{
      name: string;
      value: string;
    }>;
  };
}

export interface OpenAIAcceptCallRequest {
  type: 'realtime';
  model: string;
  instructions: string;
  voice?: string;
  tools?: Array<{
    type: string;
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  }>;
  input_audio_transcription?: {
    model: string;
  };
}

export interface PlanSipSettings {
  sipEnabled: boolean;
  maxConcurrentSipCalls: number;
  sipEnginesAllowed: SipEngine[];
}

export interface AdminSipSettings {
  pluginEnabled: boolean;
  defaultMaxConcurrentCalls: number;
  mockMode: boolean;
}

export const SIP_PROVIDER_INFO: Record<SipProvider, { name: string; defaultHost: string; defaultPort: number; transport: SipTransport; hostPattern?: RegExp; hostExample?: string }> = {
  twilio: { name: 'Twilio', defaultHost: '', defaultPort: 5061, transport: 'tls', hostPattern: /\.pstn\.twilio\.com$/i, hostExample: 'yourtrunk.pstn.twilio.com' },
  plivo: { name: 'Plivo', defaultHost: '', defaultPort: 5060, transport: 'tcp', hostPattern: /\.(sip|voice)\.plivo\.com$/i, hostExample: 'yourtrunk.sip.plivo.com' },
  telnyx: { name: 'Telnyx', defaultHost: 'sip.telnyx.com', defaultPort: 5061, transport: 'tls', hostPattern: /\.telnyx\.com$/i, hostExample: 'sip.telnyx.com' },
  vonage: { name: 'Vonage', defaultHost: '', defaultPort: 5060, transport: 'tcp', hostPattern: /\.(sip|voice)\.vonage\.com$/i, hostExample: 'yourtrunk.sip.vonage.com' },
  exotel: { name: 'Exotel', defaultHost: 'sip.exotel.com', defaultPort: 5060, transport: 'tcp', hostPattern: /\.exotel\.com$/i, hostExample: 'sip.exotel.com' },
  bandwidth: { name: 'Bandwidth', defaultHost: '', defaultPort: 5060, transport: 'tcp', hostPattern: /\.(sip|voice)\.bandwidth\.com$/i, hostExample: 'yourtrunk.sip.bandwidth.com' },
  didww: { name: 'DIDWW', defaultHost: 'sip.didww.com', defaultPort: 5060, transport: 'tcp', hostPattern: /\.didww\.com$/i, hostExample: 'sip.didww.com' },
  zadarma: { name: 'Zadarma', defaultHost: 'pbx.zadarma.com', defaultPort: 5060, transport: 'tcp', hostPattern: /\.zadarma\.com$/i, hostExample: 'pbx.zadarma.com' },
  cloudonix: { name: 'Cloudonix', defaultHost: 'sip.cloudonix.io', defaultPort: 5060, transport: 'tcp', hostPattern: /\.cloudonix\.io$/i, hostExample: 'sip.cloudonix.io' },
  ringcentral: { name: 'RingCentral', defaultHost: '', defaultPort: 5060, transport: 'tcp', hostPattern: /\.(sip|pstn)\.ringcentral\.com$/i, hostExample: 'yourtrunk.sip.ringcentral.com' },
  sinch: { name: 'Sinch', defaultHost: '', defaultPort: 5060, transport: 'tcp', hostPattern: /\.(sip|voice)\.sinch\.com$/i, hostExample: 'yourtrunk.sip.sinch.com' },
  infobip: { name: 'Infobip', defaultHost: 'sip.infobip.com', defaultPort: 5060, transport: 'tcp', hostPattern: /\.infobip\.com$/i, hostExample: 'sip.infobip.com' },
  generic: { name: 'Generic SIP', defaultHost: '', defaultPort: 5060, transport: 'tcp' },
};

export const VALID_COUNTRY_CODES = [
  '1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86',
  '90','91','92','93','94','95','98',
  '211','212','213','216','218','220','221','222','223','224','225','226','227','228','229','230',
  '231','232','233','234','235','236','237','238','239','240','241','242','243','244','245','246',
  '247','248','249','250','251','252','253','254','255','256','257','258','260','261','262','263',
  '264','265','266','267','268','269','290','291','297','298','299',
  '350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375',
  '376','377','378','380','381','382','383','385','386','387','389',
  '420','421','423',
  '500','501','502','503','504','505','506','507','508','509','590','591','592','593','594','595',
  '596','597','598','599',
  '670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687',
  '688','689','690','691','692',
  '850','852','853','855','856','880','886',
  '960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976',
  '977','992','993','994','995','996','998',
];
