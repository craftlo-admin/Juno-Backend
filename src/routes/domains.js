const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Tenant = require('../models/Tenant');
const logger = require('../utils/logger');

const router = express.Router();

// All domain routes require authentication
router.use(authenticateToken);

// Add custom domain to tenant
router.post('/:tenantId/custom-domain', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const { domain } = req.body;
    const ownerId = req.user.userId;

    // Validate domain format
    if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/.test(domain)) {
      return res.status(400).json({
        error: 'Invalid domain format'
      });
    }

    // Check tenant access
    const tenant = await Tenant.findByTenantId(tenantId);
    if (!tenant || tenant.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Update tenant with custom domain
    await Tenant.updateById(tenant.id, {
      customDomain: domain
    });

    // TODO: Implement DNS validation and SSL certificate provisioning
    // This would involve:
    // 1. Creating DNS validation records
    // 2. Provisioning SSL certificate via ACM
    // 3. Updating CloudFront distribution

    res.json({
      message: 'Custom domain added. DNS validation required.',
      domain,
      instructions: [
        `Add a CNAME record for ${domain} pointing to ${tenant.domain}`,
        'SSL certificate will be provisioned automatically after DNS validation'
      ]
    });

  } catch (error) {
    logger.error('Add custom domain error:', error);
    next(error);
  }
});

// Remove custom domain
router.delete('/:tenantId/custom-domain', async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    const ownerId = req.user.userId;

    // Check tenant access
    const tenant = await Tenant.findByTenantId(tenantId);
    if (!tenant || tenant.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Remove custom domain
    await Tenant.updateById(tenant.id, {
      customDomain: null
    });

    res.json({
      message: 'Custom domain removed successfully'
    });

  } catch (error) {
    logger.error('Remove custom domain error:', error);
    next(error);
  }
});

module.exports = router;
