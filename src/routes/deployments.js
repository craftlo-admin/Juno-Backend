const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Deployment = require('../models/Deployment');
const Build = require('../models/Build');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');
const { auditLog } = require('../services/auditService');

const router = express.Router();

// All deployment routes require authentication
router.use(authenticateToken);

// Get deployment history for a tenant
router.get('/:tenantId', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { limit = 20, offset = 0 } = req.query;
    const ownerId = req.user.userId;

    // Check tenant access
    const tenant = await Tenant.findByTenantId(tenantId);
    if (!tenant || tenant.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const deployments = await Deployment.findByTenantId(
      tenantId,
      parseInt(limit)
    );

    res.json({
      deployments,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: deployments.length
      }
    });

  } catch (error) {
    logger.error('Get deployments error:', error);
    next(error);
  }
});

// Get current active deployment
router.get('/:tenantId/current', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const ownerId = req.user.userId;

    // Check tenant access
    const tenant = await Tenant.findByTenantId(tenantId);
    if (!tenant || tenant.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const deployment = await Deployment.getCurrentDeployment(tenantId);

    if (!deployment) {
      return res.status(404).json({
        error: 'No active deployment found'
      });
    }

    res.json({ deployment });

  } catch (error) {
    logger.error('Get current deployment error:', error);
    next(error);
  }
});

// Deploy a specific build
router.post('/:tenantId/deploy/:buildId', async (req, res, next) => {
  try {
    const { tenantId, buildId } = req.params;
    const { notes } = req.body;
    const ownerId = req.user.userId;

    // Check tenant access
    const tenant = await Tenant.findByTenantId(tenantId);
    if (!tenant || tenant.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Check build exists and belongs to tenant
    const build = await Build.findById(buildId);
    if (!build || build.tenantId !== tenantId) {
      return res.status(404).json({ error: 'Build not found' });
    }

    if (build.status !== 'completed') {
      return res.status(400).json({
        error: 'Cannot deploy',
        message: `Build status is ${build.status}. Only completed builds can be deployed.`
      });
    }

    // Deactivate current deployment
    const currentDeployment = await Deployment.getCurrentDeployment(tenantId);
    if (currentDeployment) {
      await Deployment.updateById(currentDeployment.id, { status: 'inactive' });
    }

    // Create new deployment
    const deploymentData = {
      tenantId: tenantId,
      version: build.version,
      buildId: buildId,
      status: 'active',
      deployer: req.user.email,
      notes: notes || '',
      deploymentConfig: {
        buildPath: build.buildPath,
        tenantConfig: tenant.config
      }
    };

    const deployment = await Deployment.create(deploymentData);

    // Update tenant
    await Tenant.updateById(tenant.id, {
      status: 'deployed',
      currentVersion: build.version,
      lastDeployedAt: new Date(),
      buildArtifactPath: build.buildPath
    });

    // Audit log
    await auditLog({
      tenantId: tenantId,
      userId: ownerId,
      action: 'deployment_created',
      resourceType: 'deployment',
      resourceId: deployment.id,
      details: { 
        version: build.version,
        buildId: buildId,
        notes 
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      message: 'Deployment created successfully',
      deployment
    });

  } catch (error) {
    logger.error('Deploy error:', error);
    next(error);
  }
});

module.exports = router;
