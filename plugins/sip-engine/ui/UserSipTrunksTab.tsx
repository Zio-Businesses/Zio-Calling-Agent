/**
 * User SIP Trunks Tab
 * Allows users to manage their SIP trunks and phone numbers
 * Supports ElevenLabs SIP and OpenAI SIP engines with multiple providers
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Phone, 
  Server, 
  Plus, 
  Trash2, 
  CheckCircle, 
  XCircle,
  RefreshCw,
  Loader2,
  Link,
  Unlink,
  AlertCircle,
  Info,
  HelpCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";
function useGlobalToast() {
  return {
    toast: (props: any) => {
      const globalToast = typeof window !== 'undefined' ? (window as any).__AGENTLABS_TOAST__ : null;
      if (globalToast) {
        return globalToast(props);
      }
      console.warn('[SIP Plugin] Toast not available yet, retrying...', props?.title);
      setTimeout(() => {
        const retryToast = typeof window !== 'undefined' ? (window as any).__AGENTLABS_TOAST__ : null;
        if (retryToast) {
          retryToast(props);
        }
      }, 500);
    },
  };
}
import { usePluginStatus } from "@/hooks/use-plugin-status";

interface SipTrunk {
  id: string;
  name: string;
  engine: string;
  provider: string;
  sipHost: string;
  sipPort: number;
  transport: string;
  inboundTransport?: string;
  inboundPort?: number;
  isActive: boolean;
  healthStatus: string;
  createdAt: string;
}

interface SipPhoneNumber {
  id: string;
  sipTrunkId: string;
  trunkName?: string;
  phoneNumber: string;
  label?: string;
  engine: string;
  agentId?: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

interface Agent {
  id: string;
  name: string;
  type: string;
  telephonyProvider?: string;
}

interface ProviderInfo {
  name: string;
  defaultHost: string;
  defaultPort: number;
  transport: string;
}

interface ProviderInfoExtended extends ProviderInfo {
  requiresUserHost: boolean;
  placeholder: string;
  // Inbound settings - for receiving calls FROM provider TO ElevenLabs
  inboundTransport: string;
  inboundPort: number;
}

// SIP Provider Configuration
// OUTBOUND: Settings for calls FROM ElevenLabs TO your provider (campaigns, outgoing calls)
// INBOUND: Settings for calls FROM your provider TO ElevenLabs (incoming calls to your agent)
// Note: These can differ! E.g., Twilio uses TLS:5061 for outbound but TCP:5060 for inbound
const SIP_PROVIDERS: Record<string, ProviderInfoExtended> = {
  // Twilio: TLS:5061 outbound, TCP:5060 inbound (Twilio Origination sends via TCP)
  twilio: { name: 'Twilio', defaultHost: '', defaultPort: 5061, transport: 'tls', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.pstn.twilio.com' },
  plivo: { name: 'Plivo', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.sip.plivo.com' },
  vonage: { name: 'Vonage', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.sip.vonage.com' },
  bandwidth: { name: 'Bandwidth', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.sip.bandwidth.com' },
  ringcentral: { name: 'RingCentral', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.sip.ringcentral.com' },
  sinch: { name: 'Sinch', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'yourtrunk.sip.sinch.com' },
  
  // Providers with universal SIP domains
  telnyx: { name: 'Telnyx', defaultHost: 'sip.telnyx.com', defaultPort: 5061, transport: 'tls', inboundTransport: 'tls', inboundPort: 5061, requiresUserHost: false, placeholder: 'sip.telnyx.com' },
  exotel: { name: 'Exotel', defaultHost: 'sip.exotel.com', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: false, placeholder: 'sip.exotel.com' },
  didww: { name: 'DIDWW', defaultHost: 'sip.didww.com', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: false, placeholder: 'sip.didww.com' },
  zadarma: { name: 'Zadarma', defaultHost: 'pbx.zadarma.com', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: false, placeholder: 'pbx.zadarma.com' },
  cloudonix: { name: 'Cloudonix', defaultHost: 'sip.cloudonix.io', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: false, placeholder: 'sip.cloudonix.io' },
  infobip: { name: 'Infobip', defaultHost: 'sip.infobip.com', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: false, placeholder: 'sip.infobip.com' },
  generic: { name: 'Generic SIP', defaultHost: '', defaultPort: 5060, transport: 'tcp', inboundTransport: 'tcp', inboundPort: 5060, requiresUserHost: true, placeholder: 'your-sip-server.com' },
};

export default function UserSipTrunksTab() {
  const { t } = useTranslation();
  const { toast } = useGlobalToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("trunks");
  const { isSipPluginEnabled, sipPluginInstalled, isLoading: pluginLoading } = usePluginStatus();
  
  const [addTrunkOpen, setAddTrunkOpen] = useState(false);
  const [importNumberOpen, setImportNumberOpen] = useState(false);
  const [assignAgentOpen, setAssignAgentOpen] = useState(false);
  const [selectedPhoneNumber, setSelectedPhoneNumber] = useState<SipPhoneNumber | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [deletingNumberId, setDeletingNumberId] = useState<string | null>(null);
  
  const [newTrunk, setNewTrunk] = useState({
    name: "",
    engine: "elevenlabs-sip" as "elevenlabs-sip" | "openai-sip",
    provider: "twilio",
    sipHost: "",  // Empty - user must provide their own termination URI for Twilio
    sipPort: 5061,  // TLS uses 5061, TCP uses 5060 - OUTBOUND port
    transport: "tls",  // OUTBOUND transport
    inboundTransport: "tcp",  // INBOUND transport - Twilio Origination uses TCP
    inboundPort: 5060,  // INBOUND port - ElevenLabs listens here
    mediaEncryption: "disable",  // Disabled for compatibility with most providers
    username: "",
    password: "",
  });

  const [newPhoneNumber, setNewPhoneNumber] = useState({
    sipTrunkId: "",
    phoneNumber: "",
    label: "",
  });

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string; latency?: number } | null>>({});
  const [reprovisionResult, setReprovisionResult] = useState<Record<string, { message: string; variant: 'success' | 'error' } | null>>({});
  const [reprovisionNumberResult, setReprovisionNumberResult] = useState<Record<string, { message: string; variant: 'success' | 'error' } | null>>({});
  const [testingTrunkId, setTestingTrunkId] = useState<string | null>(null);
  const [reprovisioningTrunkId, setReprovisioningTrunkId] = useState<string | null>(null);
  const [reprovisioningNumberId, setReprovisioningNumberId] = useState<string | null>(null);

  const [createTrunkFeedback, setCreateTrunkFeedback] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
  const [importNumberFeedback, setImportNumberFeedback] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const provider = SIP_PROVIDERS[newTrunk.provider];
    if (provider) {
      setNewTrunk(prev => ({
        ...prev,
        sipHost: provider.defaultHost,
        sipPort: provider.defaultPort,
        transport: provider.transport,
        inboundTransport: provider.inboundTransport,
        inboundPort: provider.inboundPort,
      }));
    }
  }, [newTrunk.provider]);

  // Auto-update outbound port when outbound transport changes
  useEffect(() => {
    setNewTrunk(prev => ({
      ...prev,
      sipPort: prev.transport === 'tls' ? 5061 : 5060,
    }));
  }, [newTrunk.transport]);

  // Auto-update inbound port when inbound transport changes
  useEffect(() => {
    setNewTrunk(prev => ({
      ...prev,
      inboundPort: prev.inboundTransport === 'tls' ? 5061 : 5060,
    }));
  }, [newTrunk.inboundTransport]);

  const { data: trunks, isLoading: trunksLoading } = useQuery<{ success: boolean; data: SipTrunk[] }>({
    queryKey: ["/api/sip/trunks"],
    staleTime: 30000,
  });

  const { data: phoneNumbers, isLoading: phoneNumbersLoading } = useQuery<{ success: boolean; data: SipPhoneNumber[] }>({
    queryKey: ["/api/sip/phone-numbers"],
    staleTime: 30000,
  });

  const { data: agents } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    staleTime: 60000,
  });

  const createTrunkMutation = useMutation({
    mutationFn: async (data: typeof newTrunk) => {
      setCreateTrunkFeedback(null);
      return apiRequest("POST", "/api/sip/trunks", data);
    },
    onSuccess: () => {
      setCreateTrunkFeedback({ message: "SIP trunk created successfully!", variant: "success" });
      toast({ title: "SIP trunk created successfully" });
      setTimeout(() => {
        setAddTrunkOpen(false);
        setCreateTrunkFeedback(null);
        setNewTrunk({
          name: "",
          engine: "elevenlabs-sip",
          provider: "twilio",
          sipHost: "",
          sipPort: 5061,
          transport: "tls",
          inboundTransport: "tcp",
          inboundPort: 5060,
          mediaEncryption: "disable",
          username: "",
          password: "",
        });
      }, 1200);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/trunks"] });
    },
    onError: (error: any) => {
      setCreateTrunkFeedback({ message: error.message || "Failed to create trunk", variant: "error" });
      toast({ title: "Failed to create trunk", description: error.message, variant: "destructive" });
    },
  });

  const deleteTrunkMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/sip/trunks/${id}`);
    },
    onSuccess: () => {
      toast({ title: "SIP trunk deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sip/trunks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete trunk", description: error.message, variant: "destructive" });
    },
  });

  const testTrunkMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingTrunkId(id);
      const response = await apiRequest("POST", `/api/sip/trunks/${id}/test`);
      const result = await response.json();
      return { ...result, _trunkId: id };
    },
    onSuccess: (data: any) => {
      const trunkId = data._trunkId;
      if (data.data?.success) {
        toast({ title: "Connection successful", description: `Latency: ${data.data.latency}ms` });
        setTestResult(prev => ({ ...prev, [trunkId]: { success: true, message: `Healthy - ${data.data.latency}ms latency`, latency: data.data.latency } }));
      } else {
        toast({ title: "Connection failed", description: data.data?.message || data.message, variant: "destructive" });
        setTestResult(prev => ({ ...prev, [trunkId]: { success: false, message: data.data?.message || 'Connection failed' } }));
      }
      setTestingTrunkId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/trunks"] });
    },
    onError: (error: any) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
      if (testingTrunkId) {
        setTestResult(prev => ({ ...prev, [testingTrunkId]: { success: false, message: error.message } }));
      }
      setTestingTrunkId(null);
    },
  });

  const importNumberMutation = useMutation({
    mutationFn: async (data: typeof newPhoneNumber) => {
      setImportNumberFeedback(null);
      return apiRequest("POST", "/api/sip/phone-numbers/import", data);
    },
    onSuccess: () => {
      setImportNumberFeedback({ message: "Phone number imported successfully!", variant: "success" });
      toast({ title: "Phone number imported successfully" });
      setTimeout(() => {
        setImportNumberOpen(false);
        setImportNumberFeedback(null);
        setNewPhoneNumber({ sipTrunkId: "", phoneNumber: "", label: "" });
      }, 1200);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      setImportNumberFeedback({ message: error.message || "Failed to import phone number", variant: "error" });
      toast({ title: "Failed to import number", description: error.message, variant: "destructive" });
    },
  });

  const deleteNumberMutation = useMutation({
    mutationFn: async (id: string) => {
      setDeletingNumberId(id);
      return apiRequest("DELETE", `/api/sip/phone-numbers/${id}`);
    },
    onSuccess: () => {
      setDeletingNumberId(null);
      toast({ title: "Phone number deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
      queryClient.refetchQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      setDeletingNumberId(null);
      toast({ title: "Failed to delete number", description: error.message, variant: "destructive" });
    },
  });

  const reprovisionMutation = useMutation({
    mutationFn: async (id: string) => {
      setReprovisioningNumberId(id);
      const response = await apiRequest("POST", `/api/sip/phone-numbers/${id}/reprovision`);
      const result = await response.json();
      return { ...result, _numberId: id };
    },
    onSuccess: (data: any) => {
      const numberId = data._numberId;
      toast({ 
        title: "Phone number re-provisioned", 
        description: "SIP configuration updated. Inbound calls should now work." 
      });
      setReprovisionNumberResult(prev => ({ ...prev, [numberId]: { message: "SIP config updated successfully", variant: 'success' as const } }));
      setReprovisioningNumberId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to re-provision", description: error.message, variant: "destructive" });
      if (reprovisioningNumberId) {
        setReprovisionNumberResult(prev => ({ ...prev, [reprovisioningNumberId]: { message: error.message, variant: 'error' as const } }));
      }
      setReprovisioningNumberId(null);
    },
  });

  const reprovisionAllMutation = useMutation({
    mutationFn: async (trunkId: string) => {
      setReprovisioningTrunkId(trunkId);
      const response = await apiRequest("POST", `/api/sip/trunks/${trunkId}/reprovision-all`);
      const result = await response.json();
      return { ...result, _trunkId: trunkId };
    },
    onSuccess: (data: any) => {
      const trunkId = data._trunkId;
      const result = data.data;
      if (result.total === 0) {
        toast({ title: "No phone numbers to re-provision", description: "Import phone numbers first, then re-provision." });
        setReprovisionResult(prev => ({ ...prev, [trunkId]: { message: "No phone numbers to re-provision", variant: 'error' as const } }));
      } else if (result.failed > 0) {
        toast({ 
          title: "Re-provisioning partially complete", 
          description: `Updated ${result.updated} of ${result.total} phone numbers. ${result.failed} failed.`,
          variant: "destructive"
        });
        setReprovisionResult(prev => ({ ...prev, [trunkId]: { message: `${result.updated}/${result.total} updated, ${result.failed} failed`, variant: 'error' as const } }));
      } else {
        toast({ 
          title: "All phone numbers re-provisioned", 
          description: `Updated SIP configuration for ${result.updated} phone numbers.`
        });
        setReprovisionResult(prev => ({ ...prev, [trunkId]: { message: `${result.updated} phone numbers updated`, variant: 'success' as const } }));
      }
      setReprovisioningTrunkId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      toast({ title: "Failed to re-provision trunk", description: error.message, variant: "destructive" });
      if (reprovisioningTrunkId) {
        setReprovisionResult(prev => ({ ...prev, [reprovisioningTrunkId]: { message: error.message, variant: 'error' as const } }));
      }
      setReprovisioningTrunkId(null);
    },
  });

  const assignAgentMutation = useMutation({
    mutationFn: async ({ phoneNumberId, agentId }: { phoneNumberId: string; agentId: string | null }) => {
      setAssignError(null);
      return apiRequest("POST", `/api/sip/phone-numbers/${phoneNumberId}/assign-agent`, { agentId });
    },
    onSuccess: () => {
      toast({ title: "Agent assigned successfully" });
      setAssignAgentOpen(false);
      setSelectedPhoneNumber(null);
      setSelectedAgentId("");
      setAssignError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sip/phone-numbers"] });
    },
    onError: (error: any) => {
      setAssignError(error.message || "Failed to assign agent");
      toast({ title: "Failed to assign agent", description: error.message, variant: "destructive" });
    },
  });

  const handleAssignAgent = (phoneNumber: SipPhoneNumber) => {
    setSelectedPhoneNumber(phoneNumber);
    setSelectedAgentId(phoneNumber.agentId || "");
    setAssignError(null);
    setAssignAgentOpen(true);
  };

  // All SIP incoming agents (for displaying names in the table)
  const allSipIncomingAgents = agents?.filter(a => 
    a.type === 'incoming' && (a.telephonyProvider === 'elevenlabs-sip' || a.telephonyProvider === 'openai-sip')
  ) || [];
  
  // Filtered agents for assignment dialog (based on selected phone number's engine)
  const eligibleAgentsForAssignment = selectedPhoneNumber 
    ? allSipIncomingAgents.filter(a => a.telephonyProvider === selectedPhoneNumber.engine)
    : [];

  const getEngineBadge = (engine: string) => {
    if (engine === 'elevenlabs-sip') return 'ElevenLabs SIP';
    if (engine === 'openai-sip') return 'OpenAI SIP';
    return engine;
  };

  const getProviderName = (provider: string) => {
    return SIP_PROVIDERS[provider]?.name || provider;
  };

  if (pluginLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="sip-loading">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!isSipPluginEnabled) {
    return (
      <Card className="p-6" data-testid="sip-not-available">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <div>
            {sipPluginInstalled ? (
              <>
                <h3 className="text-lg font-semibold">Upgrade Your Plan</h3>
                <p className="text-muted-foreground mt-1">
                  SIP Trunk functionality is not included in your current plan.
                  Upgrade to a plan that includes SIP access to use this feature.
                </p>
                <Button className="mt-4" onClick={() => window.location.href = '/app/upgrade'} data-testid="button-upgrade-sip">
                  Upgrade Plan
                </Button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">SIP Engine Not Available</h3>
                <p className="text-muted-foreground mt-1">
                  The SIP Engine Plugin is not installed or enabled on this platform.
                  Contact your administrator to enable SIP trunk functionality.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <TooltipProvider>
    <div className="space-y-6" data-testid="user-sip-trunks">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">SIP Trunks</h2>
          <p className="text-muted-foreground">Manage your SIP trunks and phone numbers for AI calls</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="trunks" data-testid="tab-trunks">
            <Server className="h-4 w-4 mr-2" />
            My Trunks
          </TabsTrigger>
          <TabsTrigger value="numbers" data-testid="tab-numbers">
            <Phone className="h-4 w-4 mr-2" />
            Phone Numbers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trunks" className="space-y-4">
          {/* Setup Instructions Card */}
          <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                SIP Trunk Setup Instructions
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p className="text-muted-foreground">
                To receive incoming calls via SIP, configure your provider's SIP trunk with the following <strong>Origination URI</strong>:
              </p>
              <div className="bg-background rounded-md p-3 border space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground">TLS (Port 5061 - Recommended):</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">sip:sip.rtc.elevenlabs.io:5061;transport=tls</code>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground">TCP (Port 5060):</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded font-mono">sip:sip.rtc.elevenlabs.io:5060;transport=tcp</code>
                </div>
              </div>
              <div className="text-xs space-y-1">
                <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  <strong>Important:</strong> Your Origination URI transport (TLS/TCP) must match your trunk's Transport setting below!
                </p>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Twilio:</strong> Go to Elastic SIP Trunking → Your Trunk → Origination → Add URI</p>
                <p><strong>Plivo:</strong> Go to SIP Trunking → Your Trunk → Inbound Settings → Add Origination URI</p>
                <p><strong>Other providers:</strong> Add the Origination URI in your SIP trunk's inbound/origination settings</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Configure your SIP trunk connections</p>
            <Button onClick={() => { setCreateTrunkFeedback(null); setAddTrunkOpen(true); }} data-testid="btn-add-trunk">
              <Plus className="h-4 w-4 mr-2" />
              Add SIP Trunk
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>SIP Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                      No SIP trunks configured. Add one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  trunks?.data?.map((trunk) => (
                    <TableRow key={trunk.id}>
                      <TableCell className="font-medium">{trunk.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{getEngineBadge(trunk.engine)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{getProviderName(trunk.provider)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {trunk.sipHost}:{trunk.sipPort}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge variant={trunk.healthStatus === "healthy" ? "default" : "secondary"}>
                            {trunk.healthStatus === "healthy" ? (
                              <CheckCircle className="h-3 w-3 mr-1" />
                            ) : (
                              <XCircle className="h-3 w-3 mr-1" />
                            )}
                            {trunk.healthStatus}
                          </Badge>
                          {testResult[trunk.id] && (
                            <p className={`text-xs ${testResult[trunk.id]!.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {testResult[trunk.id]!.message}
                            </p>
                          )}
                          {reprovisionResult[trunk.id] && (
                            <p className={`text-xs ${reprovisionResult[trunk.id]!.variant === 'success' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                              {reprovisionResult[trunk.id]!.message}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => testTrunkMutation.mutate(trunk.id)}
                            disabled={testTrunkMutation.isPending}
                            data-testid={`btn-test-trunk-${trunk.id}`}
                          >
                            {testTrunkMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          {trunk.engine === 'elevenlabs-sip' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => reprovisionAllMutation.mutate(trunk.id)}
                                  disabled={reprovisionAllMutation.isPending}
                                  data-testid={`btn-reprovision-all-${trunk.id}`}
                                >
                                  {reprovisionAllMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Server className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Re-provision all phone numbers (sync SIP config)</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteTrunkMutation.mutate(trunk.id)}
                            disabled={deleteTrunkMutation.isPending}
                            data-testid={`btn-delete-trunk-${trunk.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="numbers" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Phone numbers imported from your SIP trunks</p>
            <Button 
              onClick={() => { setImportNumberFeedback(null); setImportNumberOpen(true); }} 
              disabled={!trunks?.data?.length}
              data-testid="btn-import-number"
            >
              <Plus className="h-4 w-4 mr-2" />
              Import Number
            </Button>
          </div>

          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Trunk</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Capabilities</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {phoneNumbersLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : phoneNumbers?.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No phone numbers imported. Import one from your SIP trunk.
                    </TableCell>
                  </TableRow>
                ) : (
                  phoneNumbers?.data?.map((number) => (
                    <TableRow key={number.id}>
                      <TableCell className="font-mono font-medium">{number.phoneNumber}</TableCell>
                      <TableCell>{number.label || "-"}</TableCell>
                      <TableCell>{number.trunkName || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {number.engine === 'elevenlabs-sip' ? 'EL SIP' : 'OAI SIP'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {number.engine === 'openai-sip' ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                                Incoming Only
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>OpenAI SIP only supports receiving incoming calls. For outbound calling, use ElevenLabs SIP instead.</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <div className="flex gap-1">
                            <Badge variant="secondary" className="text-xs">Inbound</Badge>
                            <Badge variant="secondary" className="text-xs">Outbound</Badge>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {number.agentId ? (
                          <Badge variant="secondary">
                            {allSipIncomingAgents.find(a => a.id === number.agentId)?.name || "Assigned"}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAssignAgent(number)}
                            data-testid={`btn-assign-agent-${number.id}`}
                          >
                            {number.agentId ? <Unlink className="h-4 w-4" /> : <Link className="h-4 w-4" />}
                          </Button>
                          {number.engine === 'elevenlabs-sip' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => reprovisionMutation.mutate(number.id)}
                                  disabled={reprovisionMutation.isPending}
                                  data-testid={`btn-reprovision-${number.id}`}
                                >
                                  {reprovisionMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Re-provision SIP config (fix inbound calls)</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteNumberMutation.mutate(number.id)}
                            disabled={deletingNumberId === number.id}
                            data-testid={`btn-delete-number-${number.id}`}
                          >
                            {deletingNumberId === number.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {reprovisionNumberResult[number.id] && (
                          <p className={`text-xs mt-1 ${reprovisionNumberResult[number.id]!.variant === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {reprovisionNumberResult[number.id]!.message}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={addTrunkOpen} onOpenChange={setAddTrunkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add SIP Trunk</DialogTitle>
            <DialogDescription>Connect your SIP provider to make AI-powered calls</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g., My SIP Provider"
                value={newTrunk.name}
                onChange={(e) => setNewTrunk(prev => ({ ...prev, name: e.target.value }))}
                data-testid="input-trunk-name"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label>Engine</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium mb-1">Choose your AI engine:</p>
                    <ul className="text-xs space-y-1">
                      <li><span className="font-medium">ElevenLabs SIP:</span> Uses ElevenLabs Conversational AI. Supports inbound + outbound calls.</li>
                      <li><span className="font-medium">OpenAI SIP:</span> Uses OpenAI Realtime API. Incoming calls only.</li>
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={newTrunk.engine}
                onValueChange={(value: "elevenlabs-sip" | "openai-sip") => 
                  setNewTrunk(prev => ({ ...prev, engine: value }))
                }
              >
                <SelectTrigger data-testid="select-trunk-engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elevenlabs-sip">ElevenLabs SIP (Inbound + Outbound)</SelectItem>
                  <SelectItem value="openai-sip">OpenAI SIP (Incoming Only)</SelectItem>
                </SelectContent>
              </Select>
              {newTrunk.engine === 'elevenlabs-sip' && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Uses your ElevenLabs agents directly. Full inbound and outbound support.
                </p>
              )}
              {newTrunk.engine === 'openai-sip' && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Uses OpenAI Realtime API. Supports incoming calls only.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>SIP Provider</Label>
              <Select
                value={newTrunk.provider}
                onValueChange={(value) => setNewTrunk(prev => ({ ...prev, provider: value }))}
              >
                <SelectTrigger data-testid="select-trunk-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SIP_PROVIDERS).map(([key, info]) => (
                    <SelectItem key={key} value={key}>{info.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>SIP Host <span className="text-destructive">*</span></Label>
              <Input
                placeholder={SIP_PROVIDERS[newTrunk.provider]?.placeholder || 'sip.provider.com'}
                value={newTrunk.sipHost}
                onChange={(e) => setNewTrunk(prev => ({ ...prev, sipHost: e.target.value }))}
                data-testid="input-trunk-host"
              />
              {SIP_PROVIDERS[newTrunk.provider]?.requiresUserHost && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Get this from your {SIP_PROVIDERS[newTrunk.provider]?.name} console (SIP Trunk settings)
                </p>
              )}
            </div>

            {/* OUTBOUND Settings - for campaigns/outgoing calls */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">Outbound Settings</h4>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>For outgoing calls from ElevenLabs to your provider (campaigns, outbound calls)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">Used when making outgoing calls via campaigns</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={newTrunk.sipPort}
                    onChange={(e) => setNewTrunk(prev => ({ ...prev, sipPort: parseInt(e.target.value) || 5060 }))}
                    data-testid="input-trunk-port"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Transport</Label>
                  <Select
                    value={newTrunk.transport}
                    onValueChange={(value) => setNewTrunk(prev => ({ ...prev, transport: value }))}
                  >
                    <SelectTrigger data-testid="select-trunk-transport">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tls">TLS (Encrypted)</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* INBOUND Settings - for receiving incoming calls */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">Inbound Settings</h4>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>For incoming calls from your provider to ElevenLabs (receiving calls on your number)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">Used when receiving incoming calls to your AI agent</p>
              {newTrunk.provider === 'twilio' && (
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-md p-3 text-xs space-y-1">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Twilio uses TCP for inbound calls</p>
                  <p className="text-amber-600 dark:text-amber-500">Twilio Origination sends via TCP:5060 even if your termination uses TLS:5061</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Port</Label>
                  <Input
                    type="number"
                    value={newTrunk.inboundPort}
                    onChange={(e) => setNewTrunk(prev => ({ ...prev, inboundPort: parseInt(e.target.value) || 5060 }))}
                    data-testid="input-trunk-inbound-port"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Transport</Label>
                  <Select
                    value={newTrunk.inboundTransport}
                    onValueChange={(value) => setNewTrunk(prev => ({ ...prev, inboundTransport: value }))}
                  >
                    <SelectTrigger data-testid="select-trunk-inbound-transport">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tls">TLS (Encrypted)</SelectItem>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Authentication - for outbound calls */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm">Outbound Authentication</h4>
                <Tooltip>
                  <TooltipTrigger>
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Credentials for authenticating outbound calls to your provider. Get these from your Twilio/provider console.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-xs text-muted-foreground">Required for making outbound calls via campaigns</p>
              <div className="space-y-2">
                <Label>SIP Username</Label>
                <Input
                  placeholder="username"
                  value={newTrunk.username}
                  onChange={(e) => setNewTrunk(prev => ({ ...prev, username: e.target.value }))}
                  data-testid="input-trunk-username"
                />
              </div>
              <div className="space-y-2">
                <Label>SIP Password</Label>
                <Input
                  type="password"
                  placeholder="password"
                  value={newTrunk.password}
                  onChange={(e) => setNewTrunk(prev => ({ ...prev, password: e.target.value }))}
                  data-testid="input-trunk-password"
                />
              </div>
              {newTrunk.provider === 'twilio' && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md p-3 text-xs space-y-1">
                  <p className="font-medium text-blue-700 dark:text-blue-400">Where to find Twilio credentials:</p>
                  <p className="text-blue-600 dark:text-blue-500">Go to Twilio Console → Elastic SIP Trunking → Your Trunk → Authentication → Credential Lists</p>
                </div>
              )}
            </div>
          </div>
          <div className={`rounded-md p-3 text-sm flex items-center gap-2 ${
            !createTrunkFeedback ? 'hidden' :
            createTrunkFeedback.variant === 'error' 
              ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800' 
              : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
          }`} data-testid="feedback-create-trunk">
            {createTrunkFeedback?.variant === 'error' 
              ? <AlertCircle className="h-4 w-4 shrink-0" /> 
              : <CheckCircle className="h-4 w-4 shrink-0" />}
            {createTrunkFeedback?.message}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTrunkOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => createTrunkMutation.mutate(newTrunk)}
              disabled={!newTrunk.name || !newTrunk.sipHost || createTrunkMutation.isPending}
              data-testid="btn-create-trunk"
            >
              {createTrunkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Trunk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importNumberOpen} onOpenChange={setImportNumberOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Phone Number</DialogTitle>
            <DialogDescription>Import a phone number from your SIP trunk</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Trunk</Label>
              <Select
                value={newPhoneNumber.sipTrunkId}
                onValueChange={(value) => setNewPhoneNumber(prev => ({ ...prev, sipTrunkId: value }))}
              >
                <SelectTrigger data-testid="select-import-trunk">
                  <SelectValue placeholder="Select a trunk" />
                </SelectTrigger>
                <SelectContent>
                  {trunks?.data?.map((trunk) => (
                    <SelectItem key={trunk.id} value={trunk.id}>
                      {trunk.name} ({getEngineBadge(trunk.engine)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Phone Number</Label>
              <Input
                placeholder="+1234567890"
                value={newPhoneNumber.phoneNumber}
                onChange={(e) => setNewPhoneNumber(prev => ({ ...prev, phoneNumber: e.target.value }))}
                data-testid="input-import-number"
              />
              <p className="text-xs text-muted-foreground">Enter in E.164 format (e.g., +1234567890)</p>
            </div>

            <div className="space-y-2">
              <Label>Label (Optional)</Label>
              <Input
                placeholder="e.g., Main Line"
                value={newPhoneNumber.label}
                onChange={(e) => setNewPhoneNumber(prev => ({ ...prev, label: e.target.value }))}
                data-testid="input-import-label"
              />
            </div>
          </div>
          <div className={`rounded-md p-3 text-sm flex items-center gap-2 ${
            !importNumberFeedback ? 'hidden' :
            importNumberFeedback.variant === 'error' 
              ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800' 
              : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
          }`} data-testid="feedback-import-number">
            {importNumberFeedback?.variant === 'error' 
              ? <AlertCircle className="h-4 w-4 shrink-0" /> 
              : <CheckCircle className="h-4 w-4 shrink-0" />}
            {importNumberFeedback?.message}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportNumberOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => importNumberMutation.mutate(newPhoneNumber)}
              disabled={!newPhoneNumber.sipTrunkId || !newPhoneNumber.phoneNumber || importNumberMutation.isPending}
              data-testid="btn-import-confirm"
            >
              {importNumberMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignAgentOpen} onOpenChange={setAssignAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Agent</DialogTitle>
            <DialogDescription>
              Select an incoming agent to handle calls to {selectedPhoneNumber?.phoneNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select
              value={selectedAgentId}
              onValueChange={setSelectedAgentId}
            >
              <SelectTrigger data-testid="select-agent">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Agent (Unassign)</SelectItem>
                {eligibleAgentsForAssignment.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {eligibleAgentsForAssignment.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No {selectedPhoneNumber?.engine === 'openai-sip' ? 'OpenAI SIP' : 'ElevenLabs SIP'} incoming agents found. Create an "Incoming" type agent with {selectedPhoneNumber?.engine === 'openai-sip' ? 'OpenAI SIP' : 'ElevenLabs SIP'} engine first.
              </p>
            )}
            {assignError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3" data-testid="assign-error-message">
                <p className="text-sm text-destructive font-medium">{assignError}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignAgentOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => {
                if (selectedPhoneNumber) {
                  assignAgentMutation.mutate({
                    phoneNumberId: selectedPhoneNumber.id,
                    agentId: selectedAgentId === "__none__" ? null : selectedAgentId || null,
                  });
                }
              }}
              disabled={assignAgentMutation.isPending}
              data-testid="btn-assign-confirm"
            >
              {assignAgentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {selectedAgentId && selectedAgentId !== "__none__" ? "Assign" : "Unassign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}
