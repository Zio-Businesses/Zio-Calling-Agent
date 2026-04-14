let _services = null;
function setSipServices(services) {
  _services = services;
}
function getSipServices() {
  if (!_services) {
    throw new Error("[SIP Engine Plugin] Services not initialized. Ensure services are injected at plugin registration.");
  }
  return _services;
}
export {
  getSipServices,
  setSipServices
};
