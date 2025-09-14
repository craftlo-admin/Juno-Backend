const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Middleware to verify user's membership and role within a tenant
 * @param {string[]} requiredRoles - Array of roles required (e.g., ['owner', 'admin'])
 */
const authorizeTenantAccess = (requiredRoles = []) => {
  return async (req, res, next) => {
    try {
      const { userId } = req.user;
      const { tenantId } = req.params; // This is the public tenantId from URL

      if (!tenantId) {
        return res.status(400).json({ 
          error: 'Bad Request', 
          message: 'Tenant ID is missing from request path' 
        });
      }

      // ✅ FIXED: Find tenant first, then check membership
      const tenant = await prisma.tenant.findUnique({
        where: { tenantId: tenantId }, // Use public tenantId
        include: {
          members: {
            where: { 
              userId: userId,
              status: 'active'
            }
          }
        }
      });

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
          message: 'The requested organization does not exist'
        });
      }

      const membership = tenant.members[0]; // Should be only one due to unique constraint

      if (!membership) {
        logger.warn(`Forbidden access attempt: User ${userId} to tenant ${tenantId}`);
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'You do not have access to this organization' 
        });
      }

      // Check role requirements
      if (requiredRoles.length > 0 && !requiredRoles.includes(membership.role)) {
        logger.warn(`Insufficient permissions: User ${userId} with role ${membership.role} for tenant ${tenantId}`);
        return res.status(403).json({ 
          error: 'Forbidden', 
          message: 'You do not have the required permissions for this action' 
        });
      }

      // Attach both tenant and membership to request
      req.tenant = tenant;
      req.membership = membership;

      next();
    } catch (error) {
      logger.error('Tenant authorization error:', error);
      next(error);
    }
  };
};

module.exports = authorizeTenantAccess;