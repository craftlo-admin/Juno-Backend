const logger = require('../utils/logger');

// Import enhanced Prisma client with retry mechanism
let prisma, executeWithRetry;
try {
  const dbModule = require('../lib/prisma');
  prisma = dbModule.prisma;
  executeWithRetry = dbModule.executeWithRetry;
  logger.info('✅ Enhanced Prisma client imported successfully in tenant middleware');
} catch (error) {
  logger.error('❌ Failed to import enhanced Prisma client in tenant middleware:', error);
  // Fallback to basic import for backward compatibility
  prisma = require('../lib/prisma');
}

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

    // Input validation for tenantId
    if (typeof tenantId !== 'string' || tenantId.length === 0 || tenantId.length > 50) {
      return res.status(400).json({
        error: 'Invalid tenant ID',
        message: 'Tenant ID must be a non-empty string with maximum 50 characters'
      });
    }

    // Sanitize tenant ID (remove any potentially harmful characters)
    const sanitizedTenantId = tenantId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sanitizedTenantId !== tenantId) {
      return res.status(400).json({
        error: 'Invalid tenant ID format',
        message: 'Tenant ID can only contain alphanumeric characters, underscores, and hyphens'
      });
    }
    
    // ✅ FIXED: Use enhanced Prisma client with retry mechanism
    const tenant = await (executeWithRetry ? executeWithRetry(
      () => prisma.tenant.findFirst({
        where: {
          tenantId: sanitizedTenantId,
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
      }),
      3
    ) : prisma.tenant.findFirst({
      where: {
        tenantId: sanitizedTenantId,
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
    }));
    
    if (!tenant) {
      logger.warn('Unauthorized tenant access attempt:', {
        userId: req.user.userId,
        requestedTenantId: sanitizedTenantId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      
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

/**
 * SECURITY FIXES APPLIED TO TENANT MIDDLEWARE:
 * 
 * 1. ✅ Enhanced Prisma client with retry mechanism for database resilience
 * 2. ✅ Added input validation for tenantId (type, length, and format validation)
 * 3. ✅ Added input sanitization to prevent injection attacks
 * 4. ✅ Enhanced security logging with IP address and user agent tracking
 * 5. ✅ Proper error handling with security context
 * 6. ✅ Fallback handling for Prisma client import
 * 
 * SECURITY IMPROVEMENTS:
 * - Validates tenant ID format to prevent malicious input
 * - Logs unauthorized access attempts for security monitoring
 * - Uses database retry mechanism for better reliability
 * - Sanitizes input to prevent potential injection attacks
 * - Tracks suspicious activity with IP and user agent logging
 */