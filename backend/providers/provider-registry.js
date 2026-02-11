/**
 * Provider Registry - manages provider class registration and instantiation
 */
const database = require('../database');

// Map of type → Provider class
const providerClasses = {};

/**
 * Register a provider class by type
 */
function registerProvider(type, ProviderClass) {
  providerClasses[type] = ProviderClass;
}

/**
 * Get a provider instance by DB id
 */
async function getProviderById(id) {
  const record = await database.getProviderById(id);
  if (!record) throw new Error(`Provider with id ${id} not found`);

  const ProviderClass = providerClasses[record.type];
  if (!ProviderClass) throw new Error(`No provider class registered for type "${record.type}"`);

  return new ProviderClass(record);
}

/**
 * Get a provider instance by type ('gocardless', 'enablebanking')
 */
async function getProviderByType(type) {
  const record = await database.getProviderByType(type);
  if (!record) throw new Error(`Provider with type "${type}" not found`);

  const ProviderClass = providerClasses[type];
  if (!ProviderClass) throw new Error(`No provider class registered for type "${type}"`);

  return new ProviderClass(record);
}

/**
 * Get all configured providers (is_configured = 1) as instances
 */
async function getConfiguredProviders() {
  const allProviders = await database.getAllProviders();
  const configured = allProviders.filter(p => p.is_configured);
  return configured.map(record => {
    const ProviderClass = providerClasses[record.type];
    if (!ProviderClass) return null;
    return new ProviderClass(record);
  }).filter(Boolean);
}

/**
 * Get credential fields for a provider type
 */
function getCredentialFields(type) {
  const ProviderClass = providerClasses[type];
  if (!ProviderClass) throw new Error(`No provider class registered for type "${type}"`);
  return ProviderClass.getCredentialFields();
}

module.exports = {
  registerProvider,
  getProviderById,
  getProviderByType,
  getConfiguredProviders,
  getCredentialFields
};
