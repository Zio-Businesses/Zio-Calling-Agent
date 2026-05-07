/**
 * Admin SIP Settings Tab
 * Manages SIP engine settings and plan SIP configurations
 * Updated to support ElevenLabs SIP and OpenAI SIP engines
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Phone, 
  Settings2, 
  Shield, 
  Loader2,
  Server,
  Users,
  Info,
  HelpCircle,
  Copy,
  CheckCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SipTrunk {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  name: string;
  engine: string;
  provider: string;
  sipHost: string;
  sipPort: number;
  isActive: boolean;
  healthStatus: string;
  createdAt: string;
}

interface AdminStats {
  totalTrunks: number;
  totalPhoneNumbers: number;
  totalCalls: number;
  activeCalls: number;
  byEngine: Record<string, number>;
}

interface Plan {
  id: string;
  name: string;
  displayName: string;
  sipEnabled?: boolean;
  maxConcurrentSipCalls?: number;
  sipEnginesAllowed?: string[];
}

interface PlanSipSettings {
  sipEnabled: boolean;
  maxConcurrentSipCalls: number;
  sipEnginesAllowed: string[];
}

interface OpenAISipConfig {
  sipEndpoint: string;
  projectId: string;
  webhookUrl: string;
  webhookSecretSet: boolean;
  instructions: string[];
}

function OpenAISipSetup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: config, isLoading } = useQuery<{ success: boolean; data: OpenAISipConfig }>({
    queryKey: ["/api/admin/sip/openai-sip/config"],
    staleTime: 60000,
    retry: false,
  });

  useEffect(() => {
    if (config?.data?.projectId && projectId === "") {
      setProjectId(config.data.projectId);
    }
  }, [config?.data?.projectId]);

  const saveProjectIdMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", "/api/admin/sip/openai-sip/project-id", { projectId: id });
    },
    onSuccess: () => {
      toast({ title: "OpenAI Project ID saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sip/openai-sip/config"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save Project ID", description: error.message, variant: "destructive" });
    },
  });

  const saveWebhookSecretMutation = useMutation({
    mutationFn: async (secret: string) => {
      return apiRequest("POST", "/api/admin/sip/openai-sip/webhook-secret", { webhookSecret: secret });
    },
    onSuccess: () => {
      toast({ title: "Webhook secret saved" });
      setWebhookSecret("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sip/openai-sip/config"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save webhook secret", description: error.message, variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Important Notice */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-700 dark:text-blue-400">OpenAI SIP supports incoming calls only</p>
              <p className="text-blue-600 dark:text-blue-300 mt-1">
                When a call comes in, OpenAI handles the AI conversation directly using their native SIP integration.
                For outbound calling, use ElevenLabs SIP engine instead.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Required Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Required Configuration
            <Badge variant="outline" className="ml-2">Step 1</Badge>
          </CardTitle>
          <CardDescription>
            Enter your OpenAI credentials to enable SIP integration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Project ID */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>OpenAI Project ID</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-medium mb-1">Where to find this:</p>
                  <ol className="text-xs space-y-1 list-decimal list-inside">
                    <li>Go to platform.openai.com</li>
                    <li>Navigate to Settings &gt; Project &gt; General</li>
                    <li>Copy the Project ID (starts with proj_)</li>
                  </ol>
                </TooltipContent>
              </Tooltip>
              {config?.data?.projectId && (
                <Badge variant="default" className="text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Configured
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="proj_xxxxxxxxxxxxxxxx"
                value={projectId || config?.data?.projectId || ""}
                onChange={(e) => setProjectId(e.target.value)}
                className="font-mono"
                data-testid="input-openai-project-id"
              />
              <Button
                onClick={() => saveProjectIdMutation.mutate(projectId)}
                disabled={!projectId || saveProjectIdMutation.isPending}
                data-testid="btn-save-project-id"
              >
                {saveProjectIdMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          </div>

          {/* Webhook Secret */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label>Webhook Secret</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-medium mb-1">Where to find this:</p>
                  <ol className="text-xs space-y-1 list-decimal list-inside">
                    <li>Go to platform.openai.com</li>
                    <li>Navigate to Settings &gt; Project &gt; Webhooks</li>
                    <li>Create a webhook with the URL below</li>
                    <li>Copy the signing secret shown</li>
                  </ol>
                  <p className="mt-2 text-xs">Used to verify incoming webhook requests from OpenAI.</p>
                </TooltipContent>
              </Tooltip>
              {config?.data?.webhookSecretSet ? (
                <Badge variant="default" className="text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Configured
                </Badge>
              ) : config?.data?.projectId && (
                <Badge variant="destructive" className="text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  Required for Security
                </Badge>
              )}
            </div>
            {/* Security Warning when webhook secret is not set */}
            {config?.data?.projectId && !config?.data?.webhookSecretSet && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-3 text-sm">
                <div className="flex gap-2">
                  <Shield className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-700 dark:text-red-400">Security Warning: Webhook secret not configured</p>
                    <p className="text-red-600 dark:text-red-300 text-xs mt-1">
                      Without a webhook secret, incoming webhook requests cannot be verified. 
                      This could allow unauthorized parties to trigger fake call events. 
                      Configure the webhook secret before going to production.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  placeholder={config?.data?.webhookSecretSet ? "••••••••••••••••" : "whsec_xxxxxxxxxxxxxxxx"}
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  className="font-mono pr-10"
                  data-testid="input-webhook-secret"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-7 w-7"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </Button>
              </div>
              <Button
                onClick={() => saveWebhookSecretMutation.mutate(webhookSecret)}
                disabled={!webhookSecret || saveWebhookSecretMutation.isPending}
                data-testid="btn-save-webhook-secret"
              >
                {saveWebhookSecretMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generated Endpoints */}
      {config?.data?.projectId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Generated Endpoints
              <Badge variant="outline" className="ml-2">Step 2</Badge>
            </CardTitle>
            <CardDescription>
              Configure these in OpenAI Platform and your SIP provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* SIP Endpoint */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>SIP Endpoint</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium mb-1">Configure in your SIP provider:</p>
                    <p className="text-xs">Set this as the termination/destination URI in your SIP trunk settings (Twilio, Plivo, Telnyx, etc.)</p>
                    <p className="text-xs mt-2">This tells your SIP provider to route calls to OpenAI.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Input value={config.data.sipEndpoint} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(config.data.sipEndpoint, 'sipEndpoint')}
                >
                  {copied === 'sipEndpoint' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {/* Webhook URL */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Webhook URL</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium mb-1">Configure in OpenAI Platform:</p>
                    <ol className="text-xs space-y-1 list-decimal list-inside">
                      <li>Go to Settings &gt; Project &gt; Webhooks</li>
                      <li>Click "Add Webhook"</li>
                      <li>Paste this URL</li>
                      <li>Select event: realtime.call.incoming</li>
                    </ol>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Input value={config.data.webhookUrl} readOnly className="font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(config.data.webhookUrl, 'webhookUrl')}
                >
                  {copied === 'webhookUrl' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Instructions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Setup Instructions
            <Badge variant="outline" className="ml-2">Step by Step</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {config?.data?.instructions?.map((instruction, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <span className="text-sm text-muted-foreground pt-0.5">{instruction}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function ElevenLabsSipGuide() {
  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-green-700 dark:text-green-400">ElevenLabs SIP supports inbound and outbound calls</p>
              <p className="text-green-600 dark:text-green-300 mt-1">
                Connect your SIP trunk to ElevenLabs for full-featured AI calling including campaigns and batch dialing.
                Works with Natural, Flow, and Incoming agent types.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Capabilities */}
      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="h-4 w-4 text-green-500" />
                <span className="font-medium">Inbound Calls</span>
                <Badge variant="default" className="text-xs">Supported</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Receive calls on your phone numbers. Callers connect directly to your AI agents.
              </p>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Phone className="h-4 w-4 text-green-500" />
                <span className="font-medium">Outbound Calls</span>
                <Badge variant="default" className="text-xs">Supported</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                AI agents can dial out to contacts. Supports bulk campaigns with scheduling.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Supported Providers */}
      <Card>
        <CardHeader>
          <CardTitle>Supported SIP Providers</CardTitle>
          <CardDescription>
            13 pre-configured providers with auto-fill defaults. Select your provider when creating a trunk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { name: 'Twilio', port: 5061, transport: 'TLS' },
              { name: 'Plivo', port: 5060, transport: 'TCP' },
              { name: 'Telnyx', port: 5061, transport: 'TLS' },
              { name: 'Vonage', port: 5060, transport: 'TCP' },
              { name: 'Exotel', port: 5060, transport: 'TCP' },
              { name: 'Bandwidth', port: 5060, transport: 'TCP' },
              { name: 'DIDWW', port: 5060, transport: 'TCP' },
              { name: 'Zadarma', port: 5060, transport: 'TCP' },
              { name: 'Cloudonix', port: 5060, transport: 'TCP' },
              { name: 'RingCentral', port: 5060, transport: 'TCP' },
              { name: 'Sinch', port: 5060, transport: 'TCP' },
              { name: 'Infobip', port: 5060, transport: 'TCP' },
              { name: 'Generic', port: 5060, transport: 'TCP' },
            ].map((provider) => (
              <div key={provider.name} className="p-2 border rounded text-sm">
                <span className="font-medium">{provider.name}</span>
                <span className="text-muted-foreground text-xs block">
                  Port {provider.port} / {provider.transport}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Setup Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Setup Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {[
              'Ensure ElevenLabs API key is configured in Admin Settings > ElevenLabs',
              'Create a SIP Trunk: Go to Phone Numbers > SIP Trunks and click "Add SIP Trunk"',
              'Select "ElevenLabs SIP" as the engine and choose your SIP provider',
              'Enter your SIP credentials (host, username, password from your provider)',
              'Import phone numbers and assign AI agents to handle calls',
              'Configure inbound routing in your SIP provider to the ElevenLabs inbound URI',
              'Test by making an inbound call to one of your imported numbers',
            ].map((instruction, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-sm flex items-center justify-center font-medium">
                  {i + 1}
                </span>
                <span className="text-sm text-muted-foreground pt-0.5">{instruction}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanSipSettingsManager() {
  const { data: plans, isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["/api/admin/plans"],
    staleTime: 60000,
  });

  if (plansLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-blue-700 dark:text-blue-400">SIP settings are managed per plan</p>
              <p className="text-blue-600 dark:text-blue-300 mt-1">
                To enable or configure SIP access for a plan, go to <strong>Billing &gt; Plans</strong> and edit the plan settings.
                This overview shows current SIP configuration across all plans.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Read-only Plan Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {plans?.map((plan) => (
          <Card key={plan.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">{plan.displayName}</CardTitle>
                <Badge variant={plan.sipEnabled ? "default" : "secondary"}>
                  {plan.sipEnabled ? "SIP Enabled" : "SIP Disabled"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Max Concurrent Calls:</span>
                  <span>{plan.sipEnabled ? (plan.maxConcurrentSipCalls ?? 5) : 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Allowed Engines:</span>
                  <div className="flex gap-1">
                    {plan.sipEnabled && (plan.sipEnginesAllowed?.length ?? 0) > 0 ? (
                      plan.sipEnginesAllowed?.map(engine => (
                        <Badge key={engine} variant="outline" className="text-xs">
                          {engine === 'elevenlabs-sip' ? 'ElevenLabs' : 'OpenAI'}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </div>
                </div>
              </div>
              <a
                href="/admin?tab=billing"
                className="flex items-center justify-center gap-2 w-full text-sm text-primary hover:underline py-2 border rounded-md hover-elevate"
                data-testid={`link-edit-plan-${plan.id}`}
              >
                <Settings2 className="h-4 w-4" />
                Edit in Plans
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdminSipSettingsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");

  const { data: stats, isLoading: statsLoading } = useQuery<{ success: boolean; data: AdminStats }>({
    queryKey: ["/api/admin/sip/stats"],
    staleTime: 30000,
  });

  const { data: trunks, isLoading: trunksLoading } = useQuery<{ success: boolean; data: SipTrunk[] }>({
    queryKey: ["/api/admin/sip/trunks"],
    staleTime: 60000,
  });

  const statCards = [
    { label: "Total SIP Trunks", value: stats?.data?.totalTrunks || 0, icon: Server },
    { label: "Phone Numbers", value: stats?.data?.totalPhoneNumbers || 0, icon: Phone },
    { label: "Total Calls", value: stats?.data?.totalCalls || 0, icon: Users },
    { label: "Active Calls", value: stats?.data?.activeCalls || 0, icon: Phone },
  ];

  const getEngineBadge = (engine: string) => {
    if (engine === 'elevenlabs-sip') return 'ElevenLabs SIP';
    if (engine === 'openai-sip') return 'OpenAI SIP';
    return engine;
  };

  return (
    <TooltipProvider>
    <div className="space-y-6" data-testid="admin-sip-settings">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">SIP Engine Settings</h2>
          <p className="text-muted-foreground">Manage SIP trunk integrations and engine configurations</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Settings2 className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="plans" data-testid="tab-plans">
            <Shield className="h-4 w-4 mr-2" />
            Plan Settings
          </TabsTrigger>
          <TabsTrigger value="elevenlabs-sip" data-testid="tab-elevenlabs-sip">
            <Phone className="h-4 w-4 mr-2" />
            ElevenLabs SIP Guide
          </TabsTrigger>
          <TabsTrigger value="openai-sip" data-testid="tab-openai-sip">
            <Server className="h-4 w-4 mr-2" />
            OpenAI SIP Setup
          </TabsTrigger>
          <TabsTrigger value="trunks" data-testid="tab-trunks">
            <Server className="h-4 w-4 mr-2" />
            All Trunks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {statCards.map((stat, index) => (
              <Card key={index}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium">{stat.label}</CardTitle>
                  <stat.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : stat.value}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Engine Distribution</CardTitle>
              <CardDescription>SIP trunks by engine type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4">
                {stats?.data?.byEngine && Object.entries(stats.data.byEngine).map(([engine, count]) => (
                  <Badge key={engine} variant="secondary" className="text-sm px-3 py-1">
                    {getEngineBadge(engine)}: {count}
                  </Badge>
                ))}
                {(!stats?.data?.byEngine || Object.keys(stats.data.byEngine).length === 0) && (
                  <p className="text-muted-foreground">No trunks configured yet</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">SIP Access by Plan</h3>
            <p className="text-sm text-muted-foreground">
              Configure which subscription plans have access to SIP features and which engines they can use
            </p>
          </div>
          <PlanSipSettingsManager />
        </TabsContent>

        <TabsContent value="elevenlabs-sip" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">ElevenLabs SIP Setup Guide</h3>
            <p className="text-sm text-muted-foreground">
              Connect your SIP trunk to ElevenLabs for inbound and outbound AI calling
            </p>
          </div>
          <ElevenLabsSipGuide />
        </TabsContent>

        <TabsContent value="openai-sip" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">OpenAI SIP Configuration</h3>
            <p className="text-sm text-muted-foreground">
              Configure your OpenAI project for direct SIP integration (incoming calls only)
            </p>
          </div>
          <OpenAISipSetup />
        </TabsContent>

        <TabsContent value="trunks" className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">All User SIP Trunks</h3>
            <p className="text-sm text-muted-foreground">
              View and monitor all SIP trunks configured by users
            </p>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Trunk Name</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>SIP Host</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trunksLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : trunks?.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No SIP trunks configured by users
                    </TableCell>
                  </TableRow>
                ) : (
                  trunks?.data?.map((trunk) => (
                    <TableRow key={trunk.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{trunk.userName || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground">{trunk.userEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{trunk.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getEngineBadge(trunk.engine)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{trunk.provider || 'generic'}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {trunk.sipHost}:{trunk.sipPort}
                      </TableCell>
                      <TableCell>
                        <Badge variant={trunk.healthStatus === "healthy" ? "default" : "secondary"}>
                          {trunk.healthStatus}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </TooltipProvider>
  );
}
