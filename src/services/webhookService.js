/**
 * Webhook Service
 * Handles outgoing webhooks for build/deployment events and incoming webhooks from external services
 */

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const analyticsService = require('./analyticsService');

class WebhookService {
  constructor() {
    this.webhooks = new Map(); // tenantId -> webhook configs
    this.retryQueue = [];
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    
    this.setupRetryProcessor();
  }

  // Register webhook for a tenant
  registerWebhook(tenantId, config) {
    if (!this.webhooks.has(tenantId)) {
      this.webhooks.set(tenantId, []);
    }
    
    const webhook = {
      id: this.generateWebhookId(),
      url: config.url,
      events: config.events || ['build.completed', 'deployment.completed'],
      secret: config.secret || this.generateSecret(),
      enabled: config.enabled !== false,
      headers: config.headers || {},
      timeout: config.timeout || 30000,
      created_at: new Date().toISOString()
    };
    
    this.webhooks.get(tenantId).push(webhook);
    
    logger.info(`Webhook registered for tenant ${tenantId}: ${webhook.url}`);
    return webhook;
  }

  // Remove webhook
  removeWebhook(tenantId, webhookId) {
    const tenantWebhooks = this.webhooks.get(tenantId);
    if (tenantWebhooks) {
      const index = tenantWebhooks.findIndex(w => w.id === webhookId);
      if (index > -1) {
        tenantWebhooks.splice(index, 1);
        logger.info(`Webhook removed for tenant ${tenantId}: ${webhookId}`);
        return true;
      }
    }
    return false;
  }

  // Get webhooks for tenant
  getWebhooks(tenantId) {
    return this.webhooks.get(tenantId) || [];
  }

  // Update webhook
  updateWebhook(tenantId, webhookId, updates) {
    const tenantWebhooks = this.webhooks.get(tenantId);
    if (tenantWebhooks) {
      const webhook = tenantWebhooks.find(w => w.id === webhookId);
      if (webhook) {
        Object.assign(webhook, updates, { updated_at: new Date().toISOString() });
        return webhook;
      }
    }
    return null;
  }

  // Trigger webhook for event
  async triggerWebhook(tenantId, eventType, payload) {
    const tenantWebhooks = this.webhooks.get(tenantId);
    if (!tenantWebhooks) return;

    const triggeredWebhooks = tenantWebhooks.filter(
      webhook => webhook.enabled && webhook.events.includes(eventType)
    );

    for (const webhook of triggeredWebhooks) {
      await this.sendWebhook(webhook, eventType, payload, tenantId);
    }
  }

  // Send individual webhook
  async sendWebhook(webhook, eventType, payload, tenantId, retryCount = 0) {
    try {
      const webhookPayload = {
        id: this.generateDeliveryId(),
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload,
        tenant_id: tenantId
      };

      // Generate signature
      const signature = this.generateSignature(webhookPayload, webhook.secret);

      const headers = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Event': eventType,
        'X-Webhook-Delivery': webhookPayload.id,
        'User-Agent': 'WebsiteBuilder-Webhook/1.0',
        ...webhook.headers
      };

      const response = await axios.post(webhook.url, webhookPayload, {
        headers,
        timeout: webhook.timeout,
        validateStatus: (status) => status >= 200 && status < 300
      });

      logger.info(`Webhook delivered successfully: ${webhook.url} (${response.status})`);
      
      // Track successful delivery
      analyticsService.trackCustomEvent('webhook_delivery', {
        tenantId,
        webhookId: webhook.id,
        eventType,
        url: webhook.url,
        statusCode: response.status,
        success: true,
        retryCount
      });

    } catch (error) {
      logger.error(`Webhook delivery failed: ${webhook.url}`, error.message);
      
      // Track failed delivery
      analyticsService.trackCustomEvent('webhook_delivery', {
        tenantId,
        webhookId: webhook.id,
        eventType,
        url: webhook.url,
        error: error.message,
        success: false,
        retryCount
      });

      // Retry logic
      if (retryCount < this.maxRetries) {
        this.scheduleRetry(webhook, eventType, payload, tenantId, retryCount + 1);
      } else {
        logger.error(`Webhook delivery failed permanently after ${this.maxRetries} retries: ${webhook.url}`);
        
        // Disable webhook if it keeps failing
        if (retryCount >= this.maxRetries) {
          webhook.enabled = false;
          webhook.disabled_reason = 'Too many failed deliveries';
          webhook.disabled_at = new Date().toISOString();
        }
      }
    }
  }

  // Schedule webhook retry
  scheduleRetry(webhook, eventType, payload, tenantId, retryCount) {
    const delay = this.retryDelay * Math.pow(2, retryCount - 1); // Exponential backoff
    
    setTimeout(() => {
      this.sendWebhook(webhook, eventType, payload, tenantId, retryCount);
    }, delay);

    logger.info(`Webhook retry scheduled in ${delay}ms for: ${webhook.url} (attempt ${retryCount})`);
  }

  // Process retry queue
  setupRetryProcessor() {
    setInterval(() => {
      // Process any queued retries (placeholder for more sophisticated queuing)
      if (this.retryQueue.length > 0) {
        logger.debug(`Processing webhook retry queue: ${this.retryQueue.length} items`);
      }
    }, 60000); // Check every minute
  }

  // Handle incoming webhooks (from external services like GitHub, GitLab, etc.)
  async handleIncomingWebhook(source, signature, payload, headers = {}) {
    try {
      // Verify signature based on source
      const isValid = this.verifyIncomingSignature(source, signature, payload);
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }

      logger.info(`Incoming webhook from ${source}:`, payload.action || 'unknown action');

      // Route to appropriate handler
      switch (source) {
        case 'github':
          return await this.handleGitHubWebhook(payload, headers);
        case 'gitlab':
          return await this.handleGitLabWebhook(payload, headers);
        case 'custom':
          return await this.handleCustomWebhook(payload, headers);
        default:
          throw new Error(`Unsupported webhook source: ${source}`);
      }

    } catch (error) {
      logger.error(`Incoming webhook error from ${source}:`, error.message);
      
      analyticsService.trackCustomEvent('incoming_webhook_error', {
        source,
        error: error.message,
        payload_type: payload.action || 'unknown'
      });
      
      throw error;
    }
  }

  // GitHub webhook handler
  async handleGitHubWebhook(payload, headers) {
    const event = headers['x-github-event'];
    
    switch (event) {
      case 'push':
        return await this.handleGitPush(payload, 'github');
      case 'pull_request':
        return await this.handlePullRequest(payload, 'github');
      case 'repository':
        return await this.handleRepositoryEvent(payload, 'github');
      default:
        logger.info(`Unhandled GitHub event: ${event}`);
        return { status: 'ignored', event };
    }
  }

  // GitLab webhook handler
  async handleGitLabWebhook(payload, headers) {
    const event = headers['x-gitlab-event'];
    
    switch (event) {
      case 'Push Hook':
        return await this.handleGitPush(payload, 'gitlab');
      case 'Merge Request Hook':
        return await this.handlePullRequest(payload, 'gitlab');
      default:
        logger.info(`Unhandled GitLab event: ${event}`);
        return { status: 'ignored', event };
    }
  }

  // Handle git push events
  async handleGitPush(payload, source) {
    // Extract relevant information
    const branch = source === 'github' ? payload.ref?.replace('refs/heads/', '') : payload.ref;
    const commits = payload.commits || [];
    const repository = source === 'github' ? payload.repository : payload.project;
    
    logger.info(`Git push received from ${source}: ${repository.name} (${branch})`);
    
    // Trigger automatic builds for main/master branch
    if (['main', 'master'].includes(branch)) {
      // Here you would trigger a build
      // This is a placeholder - implement based on your build system
      analyticsService.trackCustomEvent('auto_build_triggered', {
        source,
        repository: repository.name,
        branch,
        commits: commits.length
      });
    }
    
    return {
      status: 'processed',
      action: 'push',
      repository: repository.name,
      branch,
      commits: commits.length
    };
  }

  // Handle pull/merge request events
  async handlePullRequest(payload, source) {
    const action = payload.action;
    const pr = source === 'github' ? payload.pull_request : payload.object_attributes;
    
    logger.info(`Pull request ${action} from ${source}: ${pr.title}`);
    
    // Trigger preview builds for opened/synchronized PRs
    if (['opened', 'synchronize', 'opened'].includes(action)) {
      analyticsService.trackCustomEvent('preview_build_triggered', {
        source,
        action,
        prNumber: pr.number || pr.iid,
        title: pr.title
      });
    }
    
    return {
      status: 'processed',
      action,
      pull_request: {
        number: pr.number || pr.iid,
        title: pr.title,
        state: pr.state
      }
    };
  }

  // Handle repository events
  async handleRepositoryEvent(payload, source) {
    const action = payload.action;
    const repository = payload.repository;
    
    logger.info(`Repository ${action} from ${source}: ${repository.name}`);
    
    return {
      status: 'processed',
      action,
      repository: repository.name
    };
  }

  // Custom webhook handler
  async handleCustomWebhook(payload, headers) {
    // Handle custom webhook logic here
    logger.info('Custom webhook received:', payload);
    
    return {
      status: 'processed',
      message: 'Custom webhook handled'
    };
  }

  // Verify incoming webhook signature
  verifyIncomingSignature(source, signature, payload) {
    const secret = process.env[`${source.toUpperCase()}_WEBHOOK_SECRET`];
    if (!secret) return false;

    try {
      switch (source) {
        case 'github':
          const expectedGithub = 'sha256=' + crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedGithub));
          
        case 'gitlab':
          return signature === secret; // GitLab uses simple token
          
        default:
          return false;
      }
    } catch (error) {
      logger.error('Signature verification error:', error.message);
      return false;
    }
  }

  // Generate webhook signature
  generateSignature(payload, secret) {
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  // Utility methods
  generateWebhookId() {
    return 'wh_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  generateDeliveryId() {
    return 'del_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Get webhook statistics
  getWebhookStats() {
    let totalWebhooks = 0;
    let enabledWebhooks = 0;
    const webhooksByTenant = {};

    for (const [tenantId, webhooks] of this.webhooks.entries()) {
      totalWebhooks += webhooks.length;
      enabledWebhooks += webhooks.filter(w => w.enabled).length;
      webhooksByTenant[tenantId] = {
        total: webhooks.length,
        enabled: webhooks.filter(w => w.enabled).length
      };
    }

    return {
      total_webhooks: totalWebhooks,
      enabled_webhooks: enabledWebhooks,
      by_tenant: webhooksByTenant
    };
  }
}

module.exports = new WebhookService();
