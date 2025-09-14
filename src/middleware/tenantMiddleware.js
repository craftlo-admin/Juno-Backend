const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

/**
 * Multi-tenant isolation middleware
 * Ensures tenant data isolation following project architecture
 */
const tenantMiddleware = async (req, res, next) => {
  try {
    const tenantId = req.headers['x-tenant-id'] || req.query.tenantId;
    
    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID required',
        message: 'Please provide x-tenant-id header or tenantId query parameter'
      });
    }
    
    // Verify tenant exists and user has access
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        userId: req.user.id,
        isActive: true
      }
    });
    
    if (!tenant) {
      return res.status(403).json({
        error: 'Tenant access denied',
        message: 'Invalid tenant or insufficient permissions'
      });
    }
    
    req.tenant = tenant;
    next();
  } catch (error) {
    logger.error('Tenant middleware error:', error);
    res.status(500).json({
      error: 'Tenant validation failed',
      message: 'Internal server error'
    });
  }
};

module.exports = tenantMiddleware;