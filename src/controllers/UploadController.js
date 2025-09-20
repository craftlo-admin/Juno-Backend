const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { prisma } = require('../lib/prisma');
const logger = require('../utils/logger');
const { buildQueue } = require('../services/buildService');
const storageService = require('../services/storageService');

// Ensure temp upload directory exists
const tempUploadDir = 'temp/uploads/';
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
  logger.info('Created temp upload directory:', tempUploadDir);
}

// Configure multer for file uploads
const upload = multer({
  dest: 'temp/uploads/',
  limits: {
    fileSize: (() => {
      const maxSize = process.env.MAX_UPLOAD_SIZE || '100mb';
      const sizeInMB = parseInt(maxSize.replace(/mb|MB/i, ''));
      return sizeInMB * 1024 * 1024; // Convert MB to bytes
    })()
  },
  fileFilter: (req, file, cb) => {
    // More secure file validation
    const allowedMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip',
      'application/octet-stream'
    ];
    
    const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
    const isValidExtension = file.originalname?.toLowerCase().endsWith('.zip');
    
    if (isValidMimeType && isValidExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed. Please upload a valid ZIP file.'), false);
    }
  }
});

class UploadController {
  // Validation middleware
  static validateBuildConfig = [
    body('buildConfig').optional().isJSON(),
    body('framework').optional().isIn(['nextjs', 'react', 'vue', 'static']),
    body('nodeVersion').optional().isIn(['14', '16', '18', '20'])
  ];

  /**
   * Upload ZIP file and create build job
   */
  static async uploadFile(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { userId } = req.user;

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded',
          message: 'Please provide a ZIP file'
        });
      }

      // Parse build configuration
      let buildConfig = {};
      if (req.body.buildConfig) {
        try {
          buildConfig = JSON.parse(req.body.buildConfig);
        } catch (error) {
          return res.status(400).json({
            error: 'Invalid build configuration',
            message: 'Build configuration must be valid JSON'
          });
        }
      }

      // Generate version
      const version = `v${Date.now()}`;

      // Create build record
      const build = await prisma.build.create({
        data: {
          tenantId: req.tenant.tenantId,
          userId: userId,
          version: version,
          status: 'pending',
          framework: buildConfig.framework || null,
          sourceFile: req.file.filename,
          buildCommand: buildConfig.buildCommand || 'npm run build',
          outputDir: buildConfig.outputDir || 'dist',
          nodeVersion: buildConfig.nodeVersion || '18'
        }
      });

      // Upload source file to storage
      const storageKey = `tenants/${tenantId}/builds/${build.id}/source.zip`;
      const uploadBucket = process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME;

      // Validate file before upload
      if (!req.file || !req.file.path) {
        throw new Error('No file uploaded or file path missing');
      }

      const fs = require('fs');
      if (!fs.existsSync(req.file.path)) {
        throw new Error(`Uploaded file not found at path: ${req.file.path}`);
      }

      logger.info('Uploading ZIP file to S3', {
        buildId: build.id,
        filePath: req.file.path,
        storageKey: storageKey,
        bucket: uploadBucket,
        fileSize: req.file.size,
        originalName: req.file.originalname
      });

      const uploadResult = await storageService.uploadFile({
        filePath: req.file.path,
        key: storageKey,
        bucket: uploadBucket,
        contentType: req.file.mimetype
      });

      // Add verification logging
      logger.info('S3 Upload Result:', {
        location: uploadResult.Location,
        bucket: uploadResult.Bucket,
        key: uploadResult.Key,
        etag: uploadResult.ETag,
        size: req.file.size
      });

      // Validate tenant information before queuing
      if (!req.tenant || !req.tenant.tenantId) {
        throw new Error('Tenant information missing - req.tenant.tenantId is required');
      }

      logger.debug('Queuing build with tenant data', {
        buildId: build.id,
        tenantId: req.tenant.tenantId,
        tenantObject: !!req.tenant,
        hasTenantId: !!req.tenant.tenantId
      });

      // Add to build queue
      await buildQueue.add('process-build', {
        buildId: build.id,
        tenantId: req.tenant.tenantId,
        userId: userId,
        storageKey: storageKey,
        buildConfig: {
          framework: buildConfig.framework,
          buildCommand: build.buildCommand,
          outputDir: build.outputDir,
          nodeVersion: build.nodeVersion,
          environmentVariables: buildConfig.environmentVariables || {}
        }
      });

      logger.info('Build job created and queued', {
        buildId: build.id,
        tenantId,
        userId,
        version,
        originalFilename: req.file.originalname
      });

      // Include S3 info in response
      res.status(201).json({
        success: true,
        message: 'File uploaded and build queued successfully',
        data: {
          build,
          s3Upload: {
            location: uploadResult.Location,
            bucket: uploadResult.Bucket,
            key: uploadResult.Key,
            uploadTime: new Date().toISOString()
          }
        }
      });

    } catch (error) {
      logger.error('File upload error:', error);
      next(error);
    }
  }

  /**
   * Get builds for tenant
   */
  static async getBuilds(req, res, next) {
    try {
      const { tenantId } = req.params;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const [builds, total] = await Promise.all([
        prisma.build.findMany({
          where: { tenantId: req.tenant.tenantId },
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit
        }),
        prisma.build.count({
          where: { tenantId: req.tenant.tenantId }
        })
      ]);

      res.json({
        success: true,
        data: { builds },
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });

    } catch (error) {
      logger.error('Get builds error:', error);
      next(error);
    }
  }

  /**
   * Get specific build details
   */
  static async getBuild(req, res, next) {
    try {
      const { buildId } = req.params;

      const build = await prisma.build.findUnique({
        where: { id: buildId },
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          deployments: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      });

      if (!build) {
        return res.status(404).json({
          error: 'Build not found',
          message: 'The requested build does not exist'
        });
      }

      // Verify tenant access
      if (build.tenantId !== req.tenant.tenantId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this build'
        });
      }

      res.json({
        success: true,
        data: { build }
      });

    } catch (error) {
      logger.error('Get build error:', error);
      next(error);
    }
  }

  /**
   * Retry failed build
   */
  static async retryBuild(req, res, next) {
    try {
      const { buildId } = req.params;
      const { userId } = req.user;

      const build = await prisma.build.findUnique({
        where: { id: buildId }
      });

      if (!build) {
        return res.status(404).json({
          error: 'Build not found',
          message: 'The requested build does not exist'
        });
      }

      // Verify tenant access
      if (build.tenantId !== req.tenant.tenantId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have access to this build'
        });
      }

      if (build.status !== 'failed') {
        return res.status(400).json({
          error: 'Invalid build status',
          message: 'Only failed builds can be retried'
        });
      }

      // Reset build status
      const updatedBuild = await prisma.build.update({
        where: { id: buildId },
        data: {
          status: 'pending',
          startedAt: null,
          finishedAt: null,
          errorMessage: null
        }
      });

      // Validate tenant information before re-queuing
      if (!req.tenant || !req.tenant.tenantId) {
        throw new Error('Tenant information missing - req.tenant.tenantId is required for retry');
      }

      // Re-queue the build
      const storageKey = `tenants/${req.tenant.tenantId}/builds/${build.id}/source.zip`;
      await buildQueue.add('process-build', {
        buildId: build.id,
        tenantId: req.tenant.tenantId,
        userId: userId,
        storageKey: storageKey,
        buildConfig: {
          framework: build.framework,
          buildCommand: build.buildCommand,
          outputDir: build.outputDir,
          nodeVersion: build.nodeVersion
        }
      });

      logger.info('Build retry queued', {
        buildId: build.id,
        tenantId: req.tenant.tenantId,
        userId
      });

      res.json({
        success: true,
        message: 'Build retry queued successfully',
        data: {
          build: {
            id: updatedBuild.id,
            status: updatedBuild.status,
            version: updatedBuild.version
          }
        }
      });

    } catch (error) {
      logger.error('Retry build error:', error);
      next(error);
    }
  }

  /**
   * TEMPORARY: Backward compatibility for old frontend calls without tenant ID
   * AUTO-CREATES NEW TENANT FOR EACH ZIP UPLOAD
   * Each upload = New tenant = New subdomain deployment
   */
  static async uploadFileCompatibility(req, res, next) {
    try {
      const { userId } = req.user;

      // Validate file upload first
      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded',
          message: 'Please provide a ZIP file'
        });
      }

      // Validate file type more strictly
      const allowedMimeTypes = [
        'application/zip',
        'application/x-zip-compressed',
        'application/x-zip',
        'application/octet-stream'
      ];
      
      if (!req.file.originalname?.toLowerCase().endsWith('.zip') || 
          !allowedMimeTypes.includes(req.file.mimetype)) {
        return res.status(400).json({
          error: 'Invalid file type',
          message: 'Only ZIP files are allowed. Please upload a valid ZIP file.',
          details: `Received: ${req.file.mimetype}, ${req.file.originalname}`
        });
      }

      // Validate file size
      const maxSizeBytes = 100 * 1024 * 1024; // 100MB
      if (req.file.size > maxSizeBytes) {
        return res.status(413).json({
          error: 'File too large',
          message: 'File size exceeds the maximum limit of 100MB',
          details: `Received: ${Math.round(req.file.size / 1024 / 1024)}MB`
        });
      }

      // Import utilities for tenant creation
      const { generateTenantId, generateTenantDomain } = require('../utils/tenantUtils');

      // Generate unique tenant name based on timestamp and file name
      const timestamp = Date.now();
      const fileName = req.file?.originalname?.replace(/\.zip$/i, '') || 'website';
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const tenantName = `${sanitizedFileName}-${timestamp}`;

      logger.info('Creating new tenant for ZIP upload', {
        userId,
        fileName: req.file?.originalname,
        tenantName,
        fileSize: req.file.size
      });

      // Create new tenant automatically using transaction with retry logic
      const maxRetries = 3;
      let attempt = 0;
      let result;

      while (attempt < maxRetries) {
        try {
          result = await prisma.$transaction(async (tx) => {
            // Generate unique tenant ID with attempt suffix for uniqueness
            const baseId = await generateTenantId(tenantName);
            const tenantId = attempt === 0 ? baseId : `${baseId}-${attempt}`;

            // Create tenant
            const tenant = await tx.tenant.create({
              data: {
                name: `${tenantName}${attempt > 0 ? `-${attempt}` : ''}`,
                description: `Auto-created for ${req.file?.originalname || 'ZIP upload'}`,
                tenantId,
                domain: generateTenantDomain(tenantId),
                ownerId: userId,
                status: 'active'
              }
            });

            // Create membership
            const membership = await tx.tenantMember.create({
              data: {
                tenantId: tenant.tenantId,
                userId: userId,
                role: 'owner',
                status: 'active',
                joinedAt: new Date()
              }
            });

            return { tenant, membership };
          });
          break; // Success, exit retry loop
        } catch (error) {
          attempt++;
          if (error.code === 'P2002' && attempt < maxRetries) {
            logger.warn(`Tenant creation conflict on attempt ${attempt}, retrying...`, {
              userId,
              tenantName,
              attempt
            });
            continue;
          }
          throw error; // Re-throw if not a uniqueness conflict or max retries reached
        }
      }

      // Set tenant context for the upload
      req.params.tenantId = result.tenant.tenantId;
      req.tenant = result.tenant;

      logger.info('New tenant created for ZIP upload', {
        userId,
        tenantId: result.tenant.tenantId,
        tenantName: result.tenant.name,
        deploymentUrl: `${result.tenant.tenantId}.junotech.in`
      });

      // Call the main upload method with new tenant context
      return await UploadController.uploadFile(req, res, next);
    } catch (error) {
      logger.error('Auto-tenant upload error:', error);
      
      // More specific error handling
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: 'Tenant creation conflict',
          message: 'A tenant with this identifier already exists. Please try again.',
          details: 'Database uniqueness constraint violation'
        });
      }

      if (error.message?.includes('file')) {
        return res.status(400).json({
          error: 'File upload error',
          message: error.message,
          details: 'Failed to process uploaded file'
        });
      }

      next(error);
    }
  }

  /**
   * Delete a specific build and cleanup associated resources
   */
  static async deleteBuild(req, res, next) {
    try {
      const { tenantId, buildId } = req.params;
      const userId = req.user.id;

      logger.info('Delete build request', { tenantId, buildId, userId });

      // Find the build
      const build = await prisma.build.findFirst({
        where: {
          id: buildId,
          tenantId: tenantId
        },
        include: {
          deployments: true,
          tenant: true
        }
      });

      if (!build) {
        return res.status(404).json({
          error: 'Build not found',
          message: 'The specified build does not exist or you do not have permission to delete it'
        });
      }

      logger.info('Found build for deletion', {
        buildId: build.id,
        version: build.version,
        status: build.status,
        deploymentsCount: build.deployments.length
      });

      // Delete associated S3 files
      const s3CleanupResults = [];
      
      // Delete versioned build files
      if (build.buildPath) {
        try {
          const versionPath = `tenants/${tenantId}/${build.version}`;
          await storageService.deleteS3Directory({
            bucket: process.env.AWS_S3_BUCKET_STATIC,
            prefix: versionPath
          });
          s3CleanupResults.push({ path: versionPath, status: 'deleted' });
          logger.info(`✅ Deleted versioned build files: ${versionPath}`);
        } catch (s3Error) {
          logger.warn(`⚠️ Failed to delete versioned files: ${s3Error.message}`);
          s3CleanupResults.push({ path: build.buildPath, status: 'error', error: s3Error.message });
        }
      }

      // If this is the current deployment, also invalidate CloudFront
      const isCurrentDeployment = build.deployments.some(d => d.status === 'active');
      let invalidationResult = null;

      if (isCurrentDeployment) {
        try {
          // Delete current deployment files
          const currentPath = `tenants/${tenantId}/deployments/current`;
          await storageService.deleteS3Directory({
            bucket: process.env.AWS_S3_BUCKET_STATIC,
            prefix: currentPath
          });
          s3CleanupResults.push({ path: currentPath, status: 'deleted' });
          logger.info(`✅ Deleted current deployment files: ${currentPath}`);

          // Invalidate CloudFront cache for shared distribution
          const SharedTenantDistributionService = require('../services/sharedTenantDistributionService');
          const sharedService = new SharedTenantDistributionService();
          
          invalidationResult = await sharedService.invalidateTenantCache(tenantId, buildId);
          logger.info(`✅ CloudFront cache invalidated: ${invalidationResult}`);

        } catch (cloudfrontError) {
          logger.warn(`⚠️ CloudFront invalidation failed: ${cloudfrontError.message}`);
          invalidationResult = { error: cloudfrontError.message };
        }
      }

      // Delete database records in proper order
      await prisma.$transaction(async (tx) => {
        // Delete deployments first
        await tx.deployment.deleteMany({
          where: { buildId: buildId }
        });

        // Delete the build
        await tx.build.delete({
          where: { id: buildId }
        });
      });

      logger.info('✅ Build deleted successfully', {
        buildId,
        tenantId,
        version: build.version,
        s3Cleanup: s3CleanupResults,
        cloudfrontInvalidation: invalidationResult
      });

      res.status(200).json({
        success: true,
        message: 'Build deleted successfully',
        data: {
          buildId,
          version: build.version,
          tenantId,
          s3Cleanup: s3CleanupResults,
          cloudfrontInvalidation: invalidationResult,
          wasCurrentDeployment: isCurrentDeployment
        }
      });

    } catch (error) {
      logger.error('Delete build error:', error);
      
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Build not found',
          message: 'The build may have already been deleted'
        });
      }

      next(error);
    }
  }
}

module.exports = {
  UploadController,
  upload: upload.single('file')
};
