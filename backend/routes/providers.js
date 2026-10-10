const express = require('express');
const router = express.Router();
const database = require('../database');
const providerRegistry = require('../providers/provider-registry');
const { apiError } = require('./helpers');

// ===== Provider management routes =====
router.get('/', async (req, res) => {
  try {
    const providers = await database.getAllProviders();
    const safe = providers.map(p => ({
      ...p,
      credentials: undefined,
      has_credentials: p.is_configured ? true : false
    }));
    res.json(safe);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const provider = await database.getProviderById(parseInt(req.params.id));
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    res.json({
      ...provider,
      credentials: undefined,
      has_credentials: provider.is_configured ? true : false
    });
  } catch (error) {
    apiError(res, error);
  }
});

router.put('/:id/credentials', async (req, res) => {
  try {
    const { credentials } = req.body;
    if (!credentials || typeof credentials !== 'object') {
      return res.status(400).json({ error: 'Credentials object is required' });
    }
    const id = parseInt(req.params.id);
    const provider = await database.getProviderById(id);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    await database.updateProviderCredentials(id, JSON.stringify(credentials));
    await database.deleteProviderSessions(id);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

router.delete('/:id/credentials', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await database.clearProviderCredentials(id);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:id/credential-fields', async (req, res) => {
  try {
    const provider = await database.getProviderById(parseInt(req.params.id));
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    const fields = providerRegistry.getCredentialFields(provider.type);
    res.json(fields);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:id/status', async (req, res) => {
  try {
    const provider = await database.getProviderById(parseInt(req.params.id));
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const session = await database.getProviderSession(provider.id, 'access_token');
    const accounts = await database.getAccountsByProvider(provider.id);

    res.json({
      configured: !!provider.is_configured,
      hasSession: !!session,
      sessionExpires: session?.expires_at || null,
      accountCount: accounts.length
    });
  } catch (error) {
    apiError(res, error);
  }
});

// ===== Provider banking operations (abstract) =====
router.get('/:providerId/institutions', async (req, res) => {
  try {
    const provider = await providerRegistry.getProviderById(parseInt(req.params.providerId));
    const country = req.query.country || 'BG';
    const institutions = await provider.getInstitutions(country);
    res.json(institutions);
  } catch (error) {
    apiError(res, error);
  }
});

router.post('/:providerId/authorizations', async (req, res) => {
  try {
    const provider = await providerRegistry.getProviderById(parseInt(req.params.providerId));
    const { institutionId } = req.body;
    let { redirectUrl } = req.body;
    // GoCardless връща потребителя на адреса, от който е отворено приложението (не localhost —
    // приложението може да работи на друг компютър в мрежата). Enable Banking изисква регистриран адрес.
    if (!redirectUrl && provider.type === 'gocardless') {
      redirectUrl = `${req.protocol}://${req.get('host')}/`;
    }
    const result = await provider.createAuthorization(institutionId, redirectUrl);
    res.json(result);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:providerId/authorizations', async (req, res) => {
  try {
    const provider = await providerRegistry.getProviderById(parseInt(req.params.providerId));
    const authorizations = await provider.listAuthorizations();
    res.json(authorizations);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:providerId/authorizations/:authId', async (req, res) => {
  try {
    const provider = await providerRegistry.getProviderById(parseInt(req.params.providerId));
    const auth = await provider.getAuthorization(req.params.authId);
    res.json(auth);
  } catch (error) {
    apiError(res, error);
  }
});

router.delete('/:providerId/authorizations/:authId', async (req, res) => {
  try {
    const provider = await providerRegistry.getProviderById(parseInt(req.params.providerId));
    await provider.deleteAuthorization(req.params.authId);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

module.exports = router;
