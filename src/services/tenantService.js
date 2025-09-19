const logger = require('../utils/logger');
const { generateTenantId, generateTenantDomain } = require('../utils/tenantUtils');

/**
 * Multi-tenant Website Builder - Tenant Service
 * Following project architecture: Express.js MVC, comprehensive error handling, production-ready
 * Handles business logic related to tenant management with robust error handling
 */

// Import Prisma with comprehensive error handling
let prisma;
try {
  prisma = require('../lib/prisma');
  logger.info('✅ Prisma imported successfully in TenantService');
} catch (error) {
  logger.error('❌ Failed to import Prisma in TenantService:', error);
  throw new Error('Database connection required for tenant operations');
}

/**
 * Creates a new tenant and associates it with an owner.
 * Updated to work with current Prisma schema without primaryTenantId
 * @param {object} tx - The Prisma transactional client
 * @param {object} userData - The user data for the tenant owner
 * @returns {Promise<object>} The created tenant object
 */
const createTenant = async (tx, userData) => {
  try {
    logger.info('🏢 Creating tenant for user', { 
      userId: userData.id, 
      email: userData.email 
    });

    // Validate inputs
    logger.info('🔍 CreateTenant called with', {
      hasTransaction: !!tx,
      userData: userData,
      userDataType: typeof userData,
      userDataKeys: userData ? Object.keys(userData) : 'null',
      hasUserId: !!userData?.id,
      hasUserEmail: !!userData?.email
    });

    if (!tx) {
      throw new Error('Transaction client is required for tenant creation');
    }

    if (!userData || !userData.id || !userData.email) {
      logger.error('❌ CreateTenant validation failed', {
        userDataExists: !!userData,
        userDataType: typeof userData,
        userDataValue: userData,
        hasId: userData ? !!userData.id : false,
        idValue: userData ? userData.id : 'N/A',
        hasEmail: userData ? !!userData.email : false,
        emailValue: userData ? userData.email : 'N/A',
        userDataKeys: userData ? Object.keys(userData) : 'null',
        userDataConstructor: userData ? userData.constructor.name : 'null'
      });
      throw new Error('Valid user data with id and email is required');
    }

    // Validate transaction client has required methods
    if (typeof tx.tenant?.create !== 'function') {
      logger.error('❌ Prisma transaction client missing tenant.create method', {
        hasUserCreate: typeof tx.user?.create === 'function',
        hasTenantCreate: typeof tx.tenant?.create === 'function',
        availableMethods: Object.keys(tx).filter(key => typeof tx[key] === 'object')
      });
      throw new Error('Database schema missing required tenant model');
    }

    // Generate tenant identifiers
    const tenantName = userData.firstName 
      ? `${userData.firstName}'s Organization` 
      : `${userData.email.split('@')[0]}'s Organization`;
    
    let tenantId;
    let tenantDomain;
    
    try {
      tenantId = await generateTenantId(tenantName);
      tenantDomain = generateTenantDomain(tenantId);
      
      logger.info('🔧 Generated tenant identifiers', { 
        tenantName, 
        tenantId, 
        tenantDomain 
      });
    } catch (utilError) {
      logger.error('❌ Failed to generate tenant identifiers:', utilError);
      throw new Error(`Tenant identifier generation failed: ${utilError.message}`);
    }

    // Create tenant record with proper field mapping
    const tenantData = {
      name: tenantName,
      tenantId: tenantId,
      domain: tenantDomain,
      ownerId: userData.id,
      status: 'active'
    };

    // Only add timestamp fields if they're expected by the schema
    const currentTime = new Date();
    if (typeof tx.tenant.fields?.createdAt !== 'undefined') {
      tenantData.createdAt = currentTime;
    }
    if (typeof tx.tenant.fields?.updatedAt !== 'undefined') {
      tenantData.updatedAt = currentTime;
    }

    const tenant = await tx.tenant.create({
      data: tenantData
    });

    logger.info('✅ Tenant created successfully', { 
      tenantUUID: tenant.id, // UUID primary key
      tenantId: tenant.tenantId, // String identifier  
      ownerId: userData.id 
    });

    // Handle tenant membership if the model exists
    // This creates the many-to-many relationship between users and tenants
    if (typeof tx.tenantMember?.create === 'function') {
      try {
        const membershipData = {
          tenantId: tenant.tenantId, // Use tenantId (string identifier) not id (UUID)
          userId: userData.id,
          role: 'owner',
          status: 'active',
          joinedAt: currentTime
        };

        // Add timestamps if expected
        if (typeof tx.tenantMember.fields?.createdAt !== 'undefined') {
          membershipData.createdAt = currentTime;
        }
        if (typeof tx.tenantMember.fields?.updatedAt !== 'undefined') {
          membershipData.updatedAt = currentTime;
        }

        await tx.tenantMember.create({
          data: membershipData
        });

        logger.info('✅ Tenant membership created', { 
          tenantId: tenant.tenantId, // Use tenantId for consistency
          userId: userData.id, 
          role: 'owner' 
        });
      } catch (memberError) {
        logger.warn('⚠️ Tenant membership creation failed (non-critical):', {
          error: memberError.message,
          tenantId: tenant.tenantId, // Use tenantId for consistency
          userId: userData.id
        });
        // Don't throw here as tenant creation is the primary goal
      }
    } else {
      logger.info('ℹ️ TenantMember model not available, tenant-user relationship established via ownerId');
    }

    return tenant;

  } catch (error) {
    logger.error('❌ Tenant creation failed in service', { 
      error: error.message,
      stack: error.stack,
      userId: userData?.id,
      email: userData?.email
    });
    
    // Provide specific error messages for common issues
    if (error.message.includes('Unique constraint')) {
      throw new Error('Tenant with this identifier already exists');
    } else if (error.message.includes('Foreign key constraint')) {
      throw new Error('Invalid user reference for tenant creation');
    } else if (error.message.includes('Cannot read properties of undefined')) {
      throw new Error('Database model configuration error - check Prisma schema');
    } else {
      throw new Error(`Tenant creation failed: ${error.message}`);
    }
  }
};

/**
 * Validates tenant data before creation
 * @param {object} tenantData - The tenant data to validate
 * @returns {object} Validation result
 */
const validateTenantData = (tenantData) => {
  const errors = [];
  
  if (!tenantData.name || tenantData.name.trim().length < 2) {
    errors.push('Tenant name must be at least 2 characters long');
  }
  
  if (!tenantData.ownerId) {
    errors.push('Owner ID is required for tenant creation');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Gets tenant by ID with error handling
 * @param {string} tenantId - The tenant ID to lookup
 * @returns {Promise<object|null>} The tenant object or null
 */
const getTenantById = async (tenantId) => {
  try {
    if (!prisma || typeof prisma.tenant?.findUnique !== 'function') {
      throw new Error('Database connection not available');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        members: {
          select: {
            id: true,
            role: true,
            status: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    return tenant;
  } catch (error) {
    logger.error('❌ Failed to get tenant by ID:', error);
    throw new Error(`Tenant lookup failed: ${error.message}`);
  }
};

/**
 * Updates tenant information
 * @param {string} tenantId - The tenant ID to update
 * @param {object} updateData - The data to update
 * @returns {Promise<object>} The updated tenant
 */
const updateTenant = async (tenantId, updateData) => {
  try {
    if (!prisma || typeof prisma.tenant?.update !== 'function') {
      throw new Error('Database connection not available');
    }

    const validation = validateTenantData(updateData);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...updateData,
        updatedAt: new Date()
      }
    });

    logger.info('✅ Tenant updated successfully', { tenantId, updateData });
    return tenant;

  } catch (error) {
    logger.error('❌ Tenant update failed:', error);
    throw new Error(`Tenant update failed: ${error.message}`);
  }
};

module.exports = {
  createTenant,
  validateTenantData,
  getTenantById,
  updateTenant
};