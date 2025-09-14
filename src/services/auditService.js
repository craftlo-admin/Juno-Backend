const { prisma } = require('../lib/prisma');
const logger = require('../utils/logger');

async function auditLog(logData) {
  try {
    const auditEntry = {
      tenantId: logData.tenant_id || null,
      userId: logData.user_id || null,
      action: logData.action,
      resourceType: logData.resource_type || null,
      resourceId: logData.resource_id || null,
      details: logData.details || {},
      ipAddress: logData.ip_address || null,
      userAgent: logData.user_agent || null,
    };

    await prisma.auditLog.create({
      data: auditEntry,
    });
    
    logger.info('Audit log created:', { action: logData.action, user: logData.user_id });
  } catch (error) {
    logger.error('Failed to create audit log:', error);
    // Don't throw error to prevent breaking main functionality
  }
}

async function getAuditLogs(filters = {}, limit = 100, offset = 0) {
  try {
    const where = {};
    
    if (filters.tenant_id) where.tenantId = filters.tenant_id;
    if (filters.user_id) where.userId = filters.user_id;
    if (filters.action) where.action = filters.action;
    if (filters.resource_type) where.resourceType = filters.resource_type;

    return await prisma.auditLog.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        tenant: {
          select: {
            id: true,
            tenantId: true,
            name: true,
          },
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get audit logs:', error);
    throw error;
  }
}

async function getAuditLogStats(tenantId = null, days = 30) {
  try {
    const where = {
      createdAt: {
        gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      },
    };
    
    if (tenantId) where.tenantId = tenantId;

    const stats = await prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: {
        action: true,
      },
    });

    return stats.map(stat => ({
      action: stat.action,
      count: stat._count.action,
    }));
  } catch (error) {
    logger.error('Failed to get audit log stats:', error);
    throw error;
  }
}

module.exports = {
  auditLog,
  getAuditLogs,
  getAuditLogStats
};
