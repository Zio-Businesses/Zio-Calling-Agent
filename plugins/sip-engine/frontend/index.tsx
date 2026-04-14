/**
 * SIP Engine Plugin Frontend Entry
 * Self-registers UI components via the global plugin registry
 */

import UserSipTrunksTab from '../ui/UserSipTrunksTab';
import AdminSipSettingsTab from '../ui/AdminSipSettingsTab';

(function registerSipEnginePlugin() {
  const registry = (window as any).__AGENTLABS_PLUGIN_REGISTRY__;
  
  if (!registry) {
    console.error('[SIP Engine Plugin] Plugin registry not found');
    return;
  }

  registry.registerPhoneNumbersTab({
    id: 'sip-trunks',
    pluginName: 'sip-engine',
    label: 'SIP Trunks',
    icon: 'Server',
    component: UserSipTrunksTab,
    order: 100,
  });

  registry.registerAdminSettingsTab({
    id: 'sip-settings',
    pluginName: 'sip-engine',
    label: 'SIP Settings',
    icon: 'Server',
    component: AdminSipSettingsTab,
    order: 90,
  });

  registry.markPluginLoaded('sip-engine');
  
  console.log('[SIP Engine Plugin] Registered UI components');
})();
