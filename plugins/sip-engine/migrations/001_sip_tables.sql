-- ============================================================
-- SIP Engine Plugin - Database Migration
-- Version: 2.0.0
-- 
-- Creates tables for SIP trunk management, phone numbers,
-- and call tracking. Supports multiple SIP providers.
-- ============================================================

-- SIP Trunks (User-level)
-- Each user can configure their own SIP trunk credentials
CREATE TABLE IF NOT EXISTS sip_trunks (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  engine VARCHAR(50) NOT NULL DEFAULT 'elevenlabs-sip',
  provider VARCHAR(50) NOT NULL DEFAULT 'generic',
  
  sip_host VARCHAR(255) NOT NULL,
  sip_port INTEGER DEFAULT 5060,
  transport VARCHAR(10) DEFAULT 'tls',
  media_encryption VARCHAR(20) DEFAULT 'require',
  
  username VARCHAR(255),
  password TEXT,
  
  elevenlabs_trunk_id VARCHAR(255),
  openai_project_id VARCHAR(255),
  
  inbound_uri VARCHAR(255),
  
  is_active BOOLEAN DEFAULT true,
  health_status VARCHAR(50) DEFAULT 'unknown',
  last_health_check TIMESTAMP,
  
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SIP Phone Numbers
-- Phone numbers imported via SIP trunk (ElevenLabs or OpenAI SIP)
CREATE TABLE IF NOT EXISTS sip_phone_numbers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sip_trunk_id VARCHAR NOT NULL REFERENCES sip_trunks(id) ON DELETE CASCADE,
  
  phone_number VARCHAR(50) NOT NULL,
  label VARCHAR(255),
  engine VARCHAR(50) NOT NULL,
  
  elevenlabs_phone_number_id VARCHAR(255),
  
  agent_id VARCHAR REFERENCES agents(id) ON DELETE SET NULL,
  
  inbound_enabled BOOLEAN DEFAULT true,
  outbound_enabled BOOLEAN DEFAULT true,
  
  is_active BOOLEAN DEFAULT true,
  
  custom_headers JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(user_id, phone_number)
);

-- SIP Calls (Call tracking for SIP engines)
CREATE TABLE IF NOT EXISTS sip_calls (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id VARCHAR REFERENCES agents(id) ON DELETE SET NULL,
  campaign_id VARCHAR REFERENCES campaigns(id) ON DELETE SET NULL,
  contact_id VARCHAR REFERENCES contacts(id) ON DELETE SET NULL,
  sip_trunk_id VARCHAR REFERENCES sip_trunks(id) ON DELETE SET NULL,
  sip_phone_number_id VARCHAR REFERENCES sip_phone_numbers(id) ON DELETE SET NULL,
  
  engine VARCHAR(50) NOT NULL,
  
  external_call_id VARCHAR(255),
  openai_call_id VARCHAR(255),
  elevenlabs_conversation_id VARCHAR(255),
  
  from_number VARCHAR(50),
  to_number VARCHAR(50),
  direction VARCHAR(20) NOT NULL,
  
  status VARCHAR(50) DEFAULT 'initiated',
  duration_seconds INTEGER DEFAULT 0,
  credits_used DECIMAL(10,2) DEFAULT 0,
  
  recording_url TEXT,
  transcript JSONB,
  ai_summary TEXT,
  
  sip_headers JSONB,
  metadata JSONB,
  
  started_at TIMESTAMP,
  answered_at TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add SIP-related columns to plans table (idempotent)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sip_enabled BOOLEAN DEFAULT false;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_concurrent_sip_calls INTEGER DEFAULT 0;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sip_engines_allowed TEXT[] DEFAULT ARRAY['elevenlabs-sip'];

-- Add provider column to sip_trunks if missing (for upgrades from v1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sip_trunks' AND column_name = 'provider') THEN
    ALTER TABLE sip_trunks ADD COLUMN provider VARCHAR(50) DEFAULT 'generic';
  END IF;
END $$;

-- Add openai_project_id column to sip_trunks if missing (for upgrades from v1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sip_trunks' AND column_name = 'openai_project_id') THEN
    ALTER TABLE sip_trunks ADD COLUMN openai_project_id VARCHAR(255);
  END IF;
END $$;

-- Add elevenlabs_trunk_id column to sip_trunks if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sip_trunks' AND column_name = 'elevenlabs_trunk_id') THEN
    ALTER TABLE sip_trunks ADD COLUMN elevenlabs_trunk_id VARCHAR(255);
  END IF;
END $$;

-- Insert default SIP settings into global_settings if not exists (using existing table)
INSERT INTO global_settings (id, key, value, description)
VALUES (gen_random_uuid(), 'openai_sip_project_id', '""'::jsonb, 'OpenAI Project ID for SIP integration')
ON CONFLICT (key) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sip_trunks_user_id ON sip_trunks(user_id);
CREATE INDEX IF NOT EXISTS idx_sip_trunks_engine ON sip_trunks(engine);
CREATE INDEX IF NOT EXISTS idx_sip_trunks_provider ON sip_trunks(provider);
CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_user_id ON sip_phone_numbers(user_id);
CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_trunk_id ON sip_phone_numbers(sip_trunk_id);
CREATE INDEX IF NOT EXISTS idx_sip_phone_numbers_agent_id ON sip_phone_numbers(agent_id);
CREATE INDEX IF NOT EXISTS idx_sip_calls_user_id ON sip_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_sip_calls_campaign_id ON sip_calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_sip_calls_status ON sip_calls(status);
CREATE INDEX IF NOT EXISTS idx_sip_calls_engine ON sip_calls(engine);
CREATE INDEX IF NOT EXISTS idx_sip_calls_created_at ON sip_calls(created_at);
