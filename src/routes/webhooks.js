const express = require('express');
const router = express.Router();
const webhookService = require('../services/webhookService');
const { authenticateToken: auth } = require('../middleware/auth');
const { formatResponse, formatError, hasFeature } = require('../middleware/apiVersioning');
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');

// Rate limiting for webhook endpoints
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 webhook requests per windowMs
  message: 'Too many webhook requests',
  standardHeaders: true,
  legacyHeaders: false
});

// Get webhooks for current tenant
router.get('/', auth, async (req, res) => {
  try {
    if (!hasFeature('webhooks', req.apiVersion)) {
      return res.status(400).json(formatError(
        new Error('Webhooks not available in this API version'),
        req,
        400
      ));
    }

    const webhooks = webhookService.getWebhooks(req.user.tenantId);
    
    res.json(formatResponse({
      webhooks: webhooks.map(webhook => ({
        ...webhook,
        secret: webhook.secret ? '[REDACTED]' : undefined // Don't expose secrets
      }))
    }, req));

  } catch (error) {
    logger.error('Error getting webhooks:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Create new webhook
router.post('/', auth, async (req, res) => {
  try {
    if (!hasFeature('webhooks', req.apiVersion)) {
      return res.status(400).json(formatError(
        new Error('Webhooks not available in this API version'),
        req,
        400
      ));
    }

    const { url, events, secret, headers, timeout } = req.body;

    if (!url) {
      return res.status(400).json(formatError(
        new Error('Webhook URL is required'),
        req,
        400
      ));
    }

    // Validate URL
    try {
      new URL(url);
    } catch (urlError) {
      return res.status(400).json(formatError(
        new Error('Invalid webhook URL'),
        req,
        400
      ));
    }

    // Validate events
    const validEvents = [
      'build.started',
      'build.completed',
      'build.failed',
      'deployment.started',
      'deployment.completed',
      'deployment.failed',
      'domain.configured',
      'tenant.created'
    ];

    if (events && !Array.isArray(events)) {
      return res.status(400).json(formatError(
        new Error('Events must be an array'),
        req,
        400
      ));
    }

    const invalidEvents = events?.filter(event => !validEvents.includes(event));
    if (invalidEvents?.length > 0) {
      return res.status(400).json(formatError(
        new Error(`Invalid events: ${invalidEvents.join(', ')}`),
        req,
        400
      ));
    }

    const webhook = webhookService.registerWebhook(req.user.tenantId, {
      url,
      events,
      secret,
      headers,
      timeout
    });

    res.status(201).json(formatResponse({
      webhook: {
        ...webhook,
        secret: '[REDACTED]' // Don't expose the secret
      },
      message: 'Webhook created successfully'
    }, req));

    logger.info(`Webhook created by user ${req.user.userId} for tenant ${req.user.tenantId}: ${url}`);

  } catch (error) {
    logger.error('Error creating webhook:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Update webhook
router.put('/:webhookId', auth, async (req, res) => {
  try {
    if (!hasFeature('webhooks', req.apiVersion)) {
      return res.status(400).json(formatError(
        new Error('Webhooks not available in this API version'),
        req,
        400
      ));
    }

    const { webhookId } = req.params;
    const { url, events, enabled, headers, timeout } = req.body;

    const updates = {};
    if (url !== undefined) updates.url = url;
    if (events !== undefined) updates.events = events;
    if (enabled !== undefined) updates.enabled = enabled;
    if (headers !== undefined) updates.headers = headers;
    if (timeout !== undefined) updates.timeout = timeout;

    const updatedWebhook = webhookService.updateWebhook(
      req.user.tenantId,
      webhookId,
      updates
    );

    if (!updatedWebhook) {
      return res.status(404).json(formatError(
        new Error('Webhook not found'),
        req,
        404
      ));
    }

    res.json(formatResponse({
      webhook: {
        ...updatedWebhook,
        secret: '[REDACTED]'
      },
      message: 'Webhook updated successfully'
    }, req));

    logger.info(`Webhook ${webhookId} updated by user ${req.user.userId}`);

  } catch (error) {
    logger.error('Error updating webhook:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Delete webhook
router.delete('/:webhookId', auth, async (req, res) => {
  try {
    if (!hasFeature('webhooks', req.apiVersion)) {
      return res.status(400).json(formatError(
        new Error('Webhooks not available in this API version'),
        req,
        400
      ));
    }

    const { webhookId } = req.params;

    const deleted = webhookService.removeWebhook(req.user.tenantId, webhookId);

    if (!deleted) {
      return res.status(404).json(formatError(
        new Error('Webhook not found'),
        req,
        404
      ));
    }

    res.json(formatResponse({
      message: 'Webhook deleted successfully'
    }, req));

    logger.info(`Webhook ${webhookId} deleted by user ${req.user.userId}`);

  } catch (error) {
    logger.error('Error deleting webhook:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Test webhook
router.post('/:webhookId/test', auth, async (req, res) => {
  try {
    if (!hasFeature('webhooks', req.apiVersion)) {
      return res.status(400).json(formatError(
        new Error('Webhooks not available in this API version'),
        req,
        400
      ));
    }

    const { webhookId } = req.params;
    const webhooks = webhookService.getWebhooks(req.user.tenantId);
    const webhook = webhooks.find(w => w.id === webhookId);

    if (!webhook) {
      return res.status(404).json(formatError(
        new Error('Webhook not found'),
        req,
        404
      ));
    }

    // Send test payload
    const testPayload = {
      test: true,
      message: 'This is a test webhook delivery',
      tenant_id: req.user.tenantId,
      timestamp: new Date().toISOString()
    };

    try {
      await webhookService.sendWebhook(webhook, 'test', testPayload, req.user.tenantId);
      
      res.json(formatResponse({
        message: 'Test webhook sent successfully'
      }, req));

    } catch (webhookError) {
      res.status(400).json(formatError(
        new Error(`Webhook test failed: ${webhookError.message}`),
        req,
        400
      ));
    }

  } catch (error) {
    logger.error('Error testing webhook:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Incoming webhook endpoints

// GitHub webhook
router.post('/incoming/github', webhookLimiter, async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    
    if (!signature) {
      return res.status(401).json({
        error: 'Missing signature'
      });
    }

    const result = await webhookService.handleIncomingWebhook(
      'github',
      signature,
      req.body,
      req.headers
    );

    res.json({
      status: 'success',
      result: result
    });

    logger.info(`GitHub webhook processed: ${event}`);

  } catch (error) {
    logger.error('GitHub webhook error:', error);
    res.status(400).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// GitLab webhook
router.post('/incoming/gitlab', webhookLimiter, async (req, res) => {
  try {
    const token = req.headers['x-gitlab-token'];
    const event = req.headers['x-gitlab-event'];
    
    if (!token) {
      return res.status(401).json({
        error: 'Missing token'
      });
    }

    const result = await webhookService.handleIncomingWebhook(
      'gitlab',
      token,
      req.body,
      req.headers
    );

    res.json({
      status: 'success',
      result: result
    });

    logger.info(`GitLab webhook processed: ${event}`);

  } catch (error) {
    logger.error('GitLab webhook error:', error);
    res.status(400).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// Custom webhook endpoint
router.post('/incoming/custom/:source', webhookLimiter, async (req, res) => {
  try {
    const { source } = req.params;
    const signature = req.headers['x-webhook-signature'];

    const result = await webhookService.handleIncomingWebhook(
      'custom',
      signature,
      { ...req.body, source },
      req.headers
    );

    res.json({
      status: 'success',
      result: result
    });

    logger.info(`Custom webhook processed from ${source}`);

  } catch (error) {
    logger.error(`Custom webhook error from ${source}:`, error);
    res.status(400).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// Get webhook statistics (admin only)
router.get('/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json(formatError(
        new Error('Admin access required'),
        req,
        403
      ));
    }

    const stats = webhookService.getWebhookStats();
    
    res.json(formatResponse({
      webhook_statistics: stats
    }, req));

  } catch (error) {
    logger.error('Error getting webhook stats:', error);
    res.status(500).json(formatError(error, req, 500));
  }
});

// Get available webhook events
router.get('/events', (req, res) => {
  const events = [
    {
      name: 'build.started',
      description: 'Triggered when a build process starts'
    },
    {
      name: 'build.completed',
      description: 'Triggered when a build process completes successfully'
    },
    {
      name: 'build.failed',
      description: 'Triggered when a build process fails'
    },
    {
      name: 'deployment.started',
      description: 'Triggered when a deployment starts'
    },
    {
      name: 'deployment.completed',
      description: 'Triggered when a deployment completes successfully'
    },
    {
      name: 'deployment.failed',
      description: 'Triggered when a deployment fails'
    },
    {
      name: 'domain.configured',
      description: 'Triggered when a custom domain is configured'
    },
    {
      name: 'tenant.created',
      description: 'Triggered when a new tenant is created'
    }
  ];

  res.json(formatResponse({
    available_events: events,
    webhook_guide: {
      payload_format: {
        id: 'Unique delivery ID',
        event: 'Event name (e.g., build.completed)',
        timestamp: 'ISO 8601 timestamp',
        data: 'Event-specific payload data',
        tenant_id: 'Tenant identifier'
      },
      security: {
        signature: 'X-Webhook-Signature header contains HMAC-SHA256 signature',
        verification: 'Verify signature using your webhook secret'
      }
    }
  }, req));
});

module.exports = router;
