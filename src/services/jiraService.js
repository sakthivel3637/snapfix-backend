const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');

// In-memory cache for Jira integration config
let jiraCache = {
  isEnabled: false,
  host: '',
  email: '',
  apiToken: '',
  updatedAt: null,
  isInitialized: false,
};

const CLIENT_URL = process.env.CLIENT_URL || 'https://snapfix.techbucket.in';

/**
 * Synchronizes Jira credentials from DB into cache
 */
const syncJiraConfigFromDb = async () => {
  try {
    const dbConfig = await prisma.integration.findUnique({ where: { name: 'JIRA' } });
    if (dbConfig && dbConfig.host && dbConfig.email && dbConfig.apiToken) {
      jiraCache = {
        isEnabled: Boolean(dbConfig.isEnabled),
        host: dbConfig.host ? dbConfig.host.replace(/\/+$/, '') : '',
        email: dbConfig.email || '',
        apiToken: dbConfig.apiToken || '',
        updatedAt: dbConfig.updatedAt,
        isInitialized: true,
      };
      return jiraCache;
    }
  } catch (err) {
    console.error('Error syncing Jira config from DB:', err.message);
  }

  jiraCache = {
    isEnabled: false,
    host: '',
    email: '',
    apiToken: '',
    updatedAt: null,
    isInitialized: true,
  };
  return jiraCache;
};

// Initial sync on module load
syncJiraConfigFromDb();

/**
 * Updates cache immediately when saved/toggled via controller
 */
const updateJiraCache = (config) => {
  jiraCache = {
    ...jiraCache,
    ...config,
    host: config.host ? config.host.replace(/\/+$/, '') : (config.host === '' ? '' : jiraCache.host),
    isEnabled: Boolean(config.isEnabled && (config.host ?? jiraCache.host) && (config.email ?? jiraCache.email) && (config.apiToken ?? jiraCache.apiToken)),
  };
};

const isJiraEnabled = () => {
  return Boolean(jiraCache.isEnabled && jiraCache.host && jiraCache.email && jiraCache.apiToken);
};

const getJiraHost = () => {
  return jiraCache.host || '';
};

const getJiraEmail = () => {
  return jiraCache.email || '';
};

const getAuthHeader = (emailOverride, tokenOverride) => {
  const email = emailOverride || jiraCache.email;
  const token = tokenOverride || jiraCache.apiToken;
  if (!email || !token) return null;
  const credentials = `${email}:${token}`;
  const base64Token = Buffer.from(credentials).toString('base64');
  return `Basic ${base64Token}`;
};

/**
 * Tests connection to Jira with given or cached credentials
 */
const testJiraConnection = async (hostParam, emailParam, tokenParam) => {
  const host = (hostParam || jiraCache.host || '').replace(/\/+$/, '');
  const email = emailParam || jiraCache.email;
  const token = tokenParam || jiraCache.apiToken;

  if (!host || !email || !token) {
    return {
      success: false,
      error: 'Host, Email, and API Token are all required.',
    };
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    const response = await fetch(`${host}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `Jira API returned HTTP ${response.status}`;
      if (response.status === 401) {
        errorMsg = 'Authentication failed. Please verify your Jira Email and API Token.';
      } else if (response.status === 404) {
        errorMsg = 'Jira host URL not found. Please verify the domain (e.g. https://your-domain.atlassian.net).';
      }
      return {
        success: false,
        status: response.status,
        error: errorMsg,
        details: errorText,
      };
    }

    const data = await response.json();
    return {
      success: true,
      displayName: data.displayName,
      emailAddress: data.emailAddress,
      accountId: data.accountId,
    };
  } catch (error) {
    return {
      success: false,
      error: `Could not connect to Jira Host: ${error.message}`,
    };
  }
};

/**
 * Fetches the current Atlassian user profile to obtain their accountId.
 * Required for project creation.
 */
const getMyselfAccountId = async () => {
  if (!isJiraEnabled()) return null;
  try {
    const response = await fetch(`${jiraCache.host}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch myself. Status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.accountId || null;
  } catch (error) {
    console.error('Error fetching myself from Jira:', error);
    return null;
  }
};

/**
 * Verifies if a project exists in Jira.
 */
const getProject = async (projectKey) => {
  if (!isJiraEnabled()) return null;
  try {
    const response = await fetch(`${jiraCache.host}/rest/api/3/project/${projectKey}`, {
      method: 'GET',
      headers: {
        'Authorization': getAuthHeader(),
        'Accept': 'application/json',
      },
    });

    if (response.status === 200) {
      return await response.json();
    }
    return null;
  } catch (error) {
    console.error(`Error fetching project ${projectKey} from Jira:`, error);
    return null;
  }
};

/**
 * Creates a project in Jira.
 */
const createJiraProject = async (key, name, description) => {
  if (!isJiraEnabled()) {
    console.log('Jira integration is disabled or not fully configured.');
    return { success: false, error: 'Jira integration not configured or deactivated' };
  }

  try {
    // 1. Check if the project already exists in Jira
    const existing = await getProject(key);
    if (existing) {
      console.log(`Jira project with key "${key}" already exists. Mapping to it.`);
      return { success: true, key, alreadyExists: true };
    }

    // 2. Fetch the account ID to set as lead
    const leadAccountId = await getMyselfAccountId();
    if (!leadAccountId) {
      throw new Error('Unable to retrieve leadAccountId for Jira project creation.');
    }

    // 3. Create the project
    const payload = {
      key,
      name,
      description: description || `Created via Testing Tool Sync`,
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-kanban-template',
      leadAccountId,
    };

    console.log(`Attempting to create Jira project: ${JSON.stringify(payload)}`);

    const response = await fetch(`${jiraCache.host}/rest/api/3/project`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Jira Project Creation status ${response.status}:`, errorText);
      return { success: false, error: `Jira API error ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    console.log(`Successfully created Jira project with key: ${result.key}`);
    return { success: true, key: result.key };
  } catch (error) {
    console.error('Error creating Jira project:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Creates a Bug/Issue in Jira.
 */
const createJiraIssue = async (projectKey, summary, details) => {
  if (!isJiraEnabled()) {
    console.log('Jira integration is deactivated or disabled.');
    return null;
  }

  try {
    const descriptionLines = [
      `*Testing Tool Bug Report*`,
      ``,
      `*Reporter:* ${details.creatorName} (${details.creatorEmail})`,
      `*Source URL:* ${details.url || 'N/A'}`,
      `*Environment:* OS: ${details.os || 'N/A'}, Browser: ${details.browser || 'N/A'}`,
      `*Viewport:* ${details.viewportWidth || 'N/A'}x${details.viewportHeight || 'N/A'} (DPR: ${details.devicePixelRatio || 'N/A'})`,
      ``,
      `h3. Description`,
      details.description || '_No description provided._',
      ``,
      `h3. Expected Result`,
      details.expectedResult || '_No expected result provided._',
      ``,
      `h3. Actual Result`,
      details.actualResult || '_No actual result provided._',
      ``,
      `h3. Steps to Reproduce`,
      details.stepsToReproduce || '_No steps provided._',
      ``,
      `----`,
      `[View Original Bug in Testing Tool Dashboard|${CLIENT_URL}/#/feedback/${details.feedbackId}]`
    ];

    const description = descriptionLines.join('\n');

    const payload = {
      fields: {
        project: {
          key: projectKey,
        },
        summary: summary,
        description: description,
        issuetype: {
          name: 'Bug',
        },
      },
    };

    const response = await fetch(`${jiraCache.host}/rest/api/2/issue`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Jira Issue Creation status ${response.status}:`, errorText);
      return null;
    }

    const data = await response.json();
    console.log(`Successfully created Jira issue: ${data.key}`);
    return data.key;
  } catch (error) {
    console.error('Error creating Jira issue:', error);
    return null;
  }
};

/**
 * Uploads local file to Jira as attachment.
 */
const uploadAttachment = async (issueKey, relativeFilePath) => {
  if (!isJiraEnabled() || !relativeFilePath) return;

  try {
    const uploadDir = process.env.UPLOAD_DIR
      ? path.resolve(process.env.UPLOAD_DIR)
      : path.resolve(__dirname, '..', '..', 'uploads');
    const cleanPath = relativeFilePath.replace(/^\/?uploads\//, '');
    const absolutePath = path.resolve(uploadDir, cleanPath);

    if (!fs.existsSync(absolutePath)) {
      console.warn(`File not found for Jira upload: ${absolutePath}`);
      return;
    }

    const fileBuffer = fs.readFileSync(absolutePath);
    const fileBlob = new Blob([fileBuffer]);
    const formData = new FormData();
    formData.append('file', fileBlob, path.basename(absolutePath));

    const response = await fetch(`${jiraCache.host}/rest/api/2/issue/${issueKey}/attachments`, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(),
        'X-Atlassian-Token': 'no-check',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Jira upload attachment status ${response.status}:`, errorText);
    } else {
      console.log(`Uploaded file ${path.basename(absolutePath)} to Jira issue ${issueKey}`);
    }
  } catch (error) {
    console.error('Error uploading file to Jira:', error);
  }
};

module.exports = {
  isJiraEnabled,
  getJiraHost,
  getJiraEmail,
  syncJiraConfigFromDb,
  updateJiraCache,
  testJiraConnection,
  createJiraProject,
  createJiraIssue,
  uploadAttachment,
};
