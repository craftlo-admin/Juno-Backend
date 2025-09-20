const logger = require('../utils/logger');
const prisma = require('../lib/prisma');

/**
 * Multi-tenant isolation middleware
 * Ensures tenant data isolation and checks user access to tenant
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
    
    // Verify tenant exists and user has access (either as owner or member)
    const tenant = await prisma.tenant.findFirst({
      where: {
        tenantId: tenantId,
        OR: [
          // User is the owner
          { ownerId: req.user.userId },
          // User is a member
          { 
            members: {
              some: {
                userId: req.user.userId,
                status: 'active'
              }
            }
          }
        ]
      },
      include: {
        members: {
          where: {
            userId: req.user.userId
          },
          select: {
            role: true,
            status: true
          }
        }
      }
    });
    
    if (!tenant) {
      return res.status(403).json({
        error: 'Tenant access denied',
        message: 'Invalid tenant or insufficient permissions'
      });
    }
    
    // Determine user's role in this tenant
    const userRole = tenant.ownerId === req.user.userId ? 'owner' : tenant.members[0]?.role || 'member';
    
    req.tenant = {
      ...tenant,
      userRole: userRole
    };
    
    logger.debug('Tenant access granted', {
      userId: req.user.userId,
      tenantId: tenant.tenantId,
      userRole: userRole
    });
    
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