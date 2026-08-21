const prisma = require('../config/db');
const jiraService = require('../services/jiraService');

/**
 * Helper to mask sensitive API tokens
 */
const maskToken = (token) => {
  if (!token) return '';
  if (token.length <= 4) return '••••••••';
  return `••••••••••••${token.slice(-4)}`;
};

/**
 * GET /api/integrations/jira
 * Fetch current Jira integration status and details
 */
const getJiraConfig = async (req, res) => {
  try {
    const integration = await prisma.integration.findUnique({
      where: { name: 'JIRA' },
    });

    if (!integration || !integration.host || !integration.email || !integration.apiToken) {
      return res.json({
        name: 'JIRA',
        isConfigured: false,
        isEnabled: false,
        host: '',
        email: '',
        apiTokenMasked: '',
        hasApiToken: false,
        updatedAt: null,
        updatedBy: null,
      });
    }

    const hasApiToken = Boolean(integration.apiToken);
    const isConfigured = Boolean(integration.host && integration.email && hasApiToken);

    res.json({
      name: 'JIRA',
      isConfigured,
      isEnabled: Boolean(integration.isEnabled && isConfigured),
      host: integration.host || '',
      email: integration.email || '',
      apiTokenMasked: maskToken(integration.apiToken),
      hasApiToken,
      updatedAt: integration.updatedAt,
      updatedBy: integration.updatedBy,
    });
  } catch (error) {
    console.error('getJiraConfig error:', error);
    res.status(500).json({ error: 'Internal server error while fetching Jira configuration' });
  }
};

/**
 * POST /api/integrations/jira
 * Save and activate Jira credentials
 */
const saveJiraConfig = async (req, res) => {
  try {
    const { host, email, apiToken, isEnabled = true } = req.body;

    if (!host || !email || !apiToken) {
      return res.status(400).json({ error: 'Host URL, Email, and API Token are all required' });
    }

    const cleanHost = host.trim().replace(/\/+$/, '');
    const cleanEmail = email.trim();
    const tokenToSave = apiToken.trim();

    // Verify credentials with Jira API before saving
    const testResult = await jiraService.testJiraConnection(cleanHost, cleanEmail, tokenToSave);
    if (!testResult.success) {
      return res.status(400).json({
        error: testResult.error || 'Failed to authenticate with Jira. Please check your credentials.',
        details: testResult.details,
      });
    }

    const updated = await prisma.integration.upsert({
      where: { name: 'JIRA' },
      update: {
        host: cleanHost,
        email: cleanEmail,
        apiToken: tokenToSave,
        isEnabled: Boolean(isEnabled),
        updatedBy: req.user.name || req.user.email,
      },
      create: {
        name: 'JIRA',
        host: cleanHost,
        email: cleanEmail,
        apiToken: tokenToSave,
        isEnabled: Boolean(isEnabled),
        updatedBy: req.user.name || req.user.email,
      },
    });

    jiraService.updateJiraCache({
      host: updated.host,
      email: updated.email,
      apiToken: updated.apiToken,
      isEnabled: updated.isEnabled,
      updatedAt: updated.updatedAt,
    });

    res.json({
      message: 'Jira configuration saved and activated successfully',
      displayName: testResult.displayName,
      integration: {
        name: 'JIRA',
        isConfigured: true,
        isEnabled: updated.isEnabled,
        host: updated.host,
        email: updated.email,
        apiTokenMasked: maskToken(updated.apiToken),
        hasApiToken: true,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      },
    });
  } catch (error) {
    console.error('saveJiraConfig error:', error);
    res.status(500).json({ error: 'Internal server error while saving Jira configuration' });
  }
};

/**
 * PATCH /api/integrations/jira/toggle
 * Dynamically activate or deactivate Jira integration (toggling isEnabled boolean)
 */
const toggleJiraStatus = async (req, res) => {
  try {
    const { isEnabled } = req.body;

    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ error: 'isEnabled boolean field is required' });
    }

    const existing = await prisma.integration.findUnique({ where: { name: 'JIRA' } });

    if (!existing || !existing.host || !existing.email || !existing.apiToken) {
      return res.status(400).json({
        error: 'Jira credentials are not configured yet. Please enter host, email, and API token.',
      });
    }

    const updated = await prisma.integration.update({
      where: { name: 'JIRA' },
      data: {
        isEnabled,
        updatedBy: req.user.name || req.user.email,
      },
    });

    jiraService.updateJiraCache({
      host: updated.host,
      email: updated.email,
      apiToken: updated.apiToken,
      isEnabled: updated.isEnabled,
      updatedAt: updated.updatedAt,
    });

    res.json({
      message: isEnabled ? 'Jira integration activated successfully' : 'Jira integration deactivated successfully',
      integration: {
        name: 'JIRA',
        isConfigured: true,
        isEnabled: updated.isEnabled,
        host: updated.host,
        email: updated.email,
        apiTokenMasked: maskToken(updated.apiToken),
        hasApiToken: Boolean(updated.apiToken),
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      },
    });
  } catch (error) {
    console.error('toggleJiraStatus error:', error);
    res.status(500).json({ error: 'Internal server error while toggling Jira status' });
  }
};

/**
 * POST /api/integrations/jira/test
 * Test credentials without saving
 */
const testConnection = async (req, res) => {
  try {
    const { host, email, apiToken } = req.body;

    if (!host || !email || !apiToken) {
      return res.status(400).json({ error: 'Host URL, Email, and API Token are all required to test connection' });
    }

    const cleanHost = host.trim().replace(/\/+$/, '');
    const cleanEmail = email.trim();
    const cleanToken = apiToken.trim();

    const result = await jiraService.testJiraConnection(cleanHost, cleanEmail, cleanToken);

    if (!result.success) {
      return res.status(400).json({
        error: result.error || 'Connection failed',
        details: result.details,
      });
    }

    res.json({
      message: 'Connection successful!',
      displayName: result.displayName,
      emailAddress: result.emailAddress,
      accountId: result.accountId,
    });
  } catch (error) {
    console.error('testConnection error:', error);
    res.status(500).json({ error: 'Internal server error during connection test' });
  }
};

/**
 * DELETE /api/integrations/jira
 * Disconnect, deactivate, and remove saved credentials
 */
const deleteJiraConfig = async (req, res) => {
  try {
    await prisma.integration.deleteMany({
      where: { name: 'JIRA' },
    });

    jiraService.updateJiraCache({
      host: '',
      email: '',
      apiToken: '',
      isEnabled: false,
      updatedAt: null,
    });

    res.json({
      message: 'Jira integration deactivated and credentials removed successfully',
      integration: {
        name: 'JIRA',
        isConfigured: false,
        isEnabled: false,
        host: '',
        email: '',
        apiTokenMasked: '',
        hasApiToken: false,
        updatedAt: null,
        updatedBy: null,
      },
    });
  } catch (error) {
    console.error('deleteJiraConfig error:', error);
    res.status(500).json({ error: 'Internal server error while disconnecting Jira' });
  }
};

module.exports = {
  getJiraConfig,
  saveJiraConfig,
  toggleJiraStatus,
  testConnection,
  deleteJiraConfig,
};
