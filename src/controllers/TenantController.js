const { body, validationResult } = require('express-validator');
const { prisma } = require('../lib/prisma');
const logger = require('../utils/logger');
const { generateTenantId, generateTenantDomain, generateCustomDomain, isValidTenantId } = require('../utils/tenantUtils');

class TenantController {
  // Validation middleware
  static validateCreateTenant = [
    body('name').trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 })
  ];

  static validateUpdateTenant = [
    body('name').optional().trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 })
  ];

  static validateInviteMember = [
    body('email').isEmail().normalizeEmail(),
    body('role').isIn(['admin', 'member'])
  ];

  /**
   * Get all tenants for authenticated user
   */
  static async getUserTenants(req, res, next) {
    try {
      const { userId } = req.user;

      const memberships = await prisma.tenantMember.findMany({
        where: {
          userId: userId,
          status: 'active'
        },
        include: {
          tenant: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const tenants = memberships.map(membership => ({
        id: membership.tenant.id,
        tenantId: membership.tenant.tenantId,
        name: membership.tenant.name,
        description: membership.tenant.description,
        domain: membership.tenant.domain,
        role: membership.role,
        status: membership.tenant.status,
        createdAt: membership.tenant.createdAt,
        memberCount: 0 // Will be populated separately if needed
      }));

      res.json({
        success: true,
        data: { tenants },
        meta: { total: tenants.length }
      });

    } catch (error) {
      logger.error('Get user tenants error:', error);
      next(error);
    }
  }

  /**
   * Create new tenant
   */
  static async createTenant(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { userId } = req.user;
      const { name, description } = req.body;

      // Generate unique tenant ID
      const tenantId = await generateTenantId(name);

      // Create tenant and membership in transaction
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name,
            description,
            tenantId,
            domain: generateTenantDomain(tenantId),
            ownerId: userId,
            status: 'active'
          }
        });

        const membership = await tx.tenantMember.create({
          data: {
            tenantId: tenant.tenantId, // Use tenantId (string identifier) not id (UUID)
            userId: userId,
            role: 'owner',
            status: 'active',
            joinedAt: new Date()
          }
        });

        return { tenant, membership };
      });

      logger.info('Tenant created successfully', {
        tenantId: result.tenant.tenantId,
        userId,
        name
      });

      res.status(201).json({
        success: true,
        message: 'Tenant created successfully',
        data: {
          tenant: {
            id: result.tenant.id,
            tenantId: result.tenant.tenantId,
            name: result.tenant.name,
            description: result.tenant.description,
            domain: result.tenant.domain,
            role: 'owner',
            status: result.tenant.status,
            createdAt: result.tenant.createdAt
          }
        }
      });

    } catch (error) {
      logger.error('Create tenant error:', error);
      next(error);
    }
  }

  /**
   * Get tenant details
   */
  static async getTenant(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { userId } = req.user;

      // First verify user has access to this tenant
      const userMembership = await prisma.tenantMember.findFirst({
        where: {
          tenantId: tenantId,
          userId: userId,
          status: 'active'
        }
      });

      if (!userMembership) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to access this tenant'
        });
      }

      // Now fetch tenant details
      const tenant = await prisma.tenant.findUnique({
        where: { tenantId },
        include: {
          owner: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          members: {
            where: { status: 'active' },
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, email: true }
              }
            }
          },
          _count: {
            select: {
              builds: true,
              deployments: true
            }
          }
        }
      });

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
          message: 'The requested tenant does not exist'
        });
      }

      const response = {
        id: tenant.id,
        tenantId: tenant.tenantId,
        name: tenant.name,
        description: tenant.description,
        domain: tenant.domain,
        status: tenant.status,
        userRole: userMembership.role,
        owner: tenant.owner,
        members: tenant.members.map(m => ({
          id: m.id,
          user: m.user,
          role: m.role,
          status: m.status,
          joinedAt: m.joinedAt
        })),
        stats: {
          totalBuilds: tenant._count.builds,
          totalDeployments: tenant._count.deployments,
          memberCount: tenant.members.length
        },
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt
      };

      res.json({
        success: true,
        data: { tenant: response }
      });

    } catch (error) {
      logger.error('Get tenant error:', error);
      next(error);
    }
  }

  /**
   * Update tenant
   */
  static async updateTenant(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tenantId } = req.params;
      const { userId } = req.user;
      const { name, description } = req.body;

      // Verify user has admin or owner permissions
      const userMembership = await prisma.tenantMember.findFirst({
        where: {
          tenantId: tenantId,
          userId: userId,
          status: 'active',
          role: { in: ['owner', 'admin'] }
        }
      });

      if (!userMembership) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to update this tenant'
        });
      }

      const updatedTenant = await prisma.tenant.update({
        where: { tenantId },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description })
        }
      });

      logger.info('Tenant updated successfully', {
        tenantId: updatedTenant.tenantId,
        userId: req.user.userId
      });

      res.json({
        success: true,
        message: 'Tenant updated successfully',
        data: {
          tenant: {
            id: updatedTenant.id,
            tenantId: updatedTenant.tenantId,
            name: updatedTenant.name,
            description: updatedTenant.description,
            domain: updatedTenant.domain,
            status: updatedTenant.status,
            updatedAt: updatedTenant.updatedAt
          }
        }
      });

    } catch (error) {
      logger.error('Update tenant error:', error);
      next(error);
    }
  }

  /**
   * Delete tenant (owner only)
   */
  static async deleteTenant(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { userId } = req.user;

      // Verify ownership
      const tenant = await prisma.tenant.findUnique({
        where: { tenantId },
        select: { id: true, ownerId: true, name: true }
      });

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
          message: 'The requested tenant does not exist'
        });
      }

      if (tenant.ownerId !== userId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only the owner can delete this tenant'
        });
      }

      // Soft delete by updating status
      await prisma.tenant.update({
        where: { tenantId },
        data: { status: 'deleted' }
      });

      logger.info('Tenant deleted successfully', {
        tenantId,
        userId,
        tenantName: tenant.name
      });

      res.json({
        success: true,
        message: 'Tenant deleted successfully'
      });

    } catch (error) {
      logger.error('Delete tenant error:', error);
      next(error);
    }
  }

  /**
   * Get tenant members
   */
  static async getMembers(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { userId } = req.user;

      // Verify user has access to this tenant
      const userMembership = await prisma.tenantMember.findFirst({
        where: {
          tenantId: tenantId,
          userId: userId,
          status: 'active'
        }
      });

      if (!userMembership) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to view members of this tenant'
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { tenantId },
        include: {
          members: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, email: true, createdAt: true }
              }
            },
            orderBy: { createdAt: 'asc' }
          }
        }
      });

      if (!tenant) {
        return res.status(404).json({
          error: 'Tenant not found',
          message: 'The requested tenant does not exist'
        });
      }

      const members = tenant.members.map(member => ({
        id: member.id,
        user: member.user,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
        invitedAt: member.invitedAt
      }));

      res.json({
        success: true,
        data: { members },
        meta: { total: members.length }
      });

    } catch (error) {
      logger.error('Get members error:', error);
      next(error);
    }
  }

  /**
   * Invite member to tenant
   */
  static async inviteMember(req, res, next) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { tenantId } = req.params;
      const { userId } = req.user;
      const { email, role } = req.body;

      // Verify user has admin or owner permissions to invite
      const userMembership = await prisma.tenantMember.findFirst({
        where: {
          tenantId: tenantId,
          userId: userId,
          status: 'active',
          role: { in: ['owner', 'admin'] }
        }
      });

      if (!userMembership) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have permission to invite members to this tenant'
        });
      }

      // Find user by email
      const userToInvite = await prisma.user.findUnique({
        where: { email }
      });

      if (!userToInvite) {
        return res.status(404).json({
          error: 'User not found',
          message: 'No user found with this email address'
        });
      }

      // Check if user is already a member
      const existingMembership = await prisma.tenantMember.findUnique({
        where: {
          tenantId_userId: {
            tenantId: tenantId,
            userId: userToInvite.id
          }
        }
      });

      if (existingMembership) {
        return res.status(409).json({
          error: 'User already member',
          message: 'This user is already a member of this tenant'
        });
      }

      // Create membership
      const membership = await prisma.tenantMember.create({
        data: {
          tenantId: tenantId,
          userId: userToInvite.id,
          role,
          status: 'active',
          invitedBy: userId,
          invitedAt: new Date(),
          joinedAt: new Date()
        },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      logger.info('Member invited successfully', {
        tenantId,
        invitedUserId: userToInvite.id,
        invitedBy: userId,
        role
      });

      res.status(201).json({
        success: true,
        message: 'Member invited successfully',
        data: {
          member: {
            id: membership.id,
            user: membership.user,
            role: membership.role,
            status: membership.status,
            joinedAt: membership.joinedAt
          }
        }
      });

    } catch (error) {
      logger.error('Invite member error:', error);
      next(error);
    }
  }

  /**
   * Update member role
   */
  static async updateMember(req, res, next) {
    try {
      const { tenantId, userId: targetUserId } = req.params;
      const { role } = req.body;

      if (!['admin', 'member'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role',
          message: 'Role must be either admin or member'
        });
      }

      const membership = await prisma.tenantMember.update({
        where: {
          tenantId_userId: {
            tenantId: req.tenant.tenantId,
            userId: targetUserId
          }
        },
        data: { role },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          }
        }
      });

      logger.info('Member role updated', {
        tenantId,
        targetUserId,
        newRole: role,
        updatedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Member role updated successfully',
        data: {
          member: {
            id: membership.id,
            user: membership.user,
            role: membership.role,
            status: membership.status
          }
        }
      });

    } catch (error) {
      logger.error('Update member error:', error);
      next(error);
    }
  }

  /**
   * Remove member from tenant
   */
  static async removeMember(req, res, next) {
    try {
      const { tenantId, userId: targetUserId } = req.params;

      // Cannot remove owner
      if (req.tenant.ownerId === targetUserId) {
        return res.status(400).json({
          error: 'Cannot remove owner',
          message: 'The tenant owner cannot be removed'
        });
      }

      await prisma.tenantMember.delete({
        where: {
          tenantId_userId: {
            tenantId: req.tenant.tenantId,
            userId: targetUserId
          }
        }
      });

      logger.info('Member removed successfully', {
        tenantId,
        removedUserId: targetUserId,
        removedBy: req.user.userId
      });

      res.json({
        success: true,
        message: 'Member removed successfully'
      });

    } catch (error) {
      logger.error('Remove member error:', error);
      next(error);
    }
  }
}

module.exports = TenantController;
