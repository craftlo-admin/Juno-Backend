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
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' || 
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
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
   * Upload ZIP file using user's first tenant (auto-tenant detection)
   */
  static async uploadFileForUser(req, res, next) {
    try {
      const { userId } = req.user;

      // Find user's first tenant
      const tenantMembership = await prisma.tenantMember.findFirst({
        where: { 
          userId: userId,
          status: 'active'
        },
        include: {
          tenant: true
        },
        orderBy: {
          joinedAt: 'asc' // Get the first tenant they joined
        }
      });

      if (!tenantMembership) {
        return res.status(404).json({
          success: false,
          error: 'No tenant found',
          message: 'User is not a member of any active tenant'
        });
      }

      // Attach tenant info to request (similar to tenantAuth middleware)
      req.tenant = tenantMembership.tenant;
      
      // Validate tenant data before proceeding
      if (!tenantMembership.tenant || !tenantMembership.tenant.tenantId) {
        logger.error('Invalid tenant data from membership query', {
          tenantMembership,
          hasTenant: !!tenantMembership.tenant,
          tenantKeys: tenantMembership.tenant ? Object.keys(tenantMembership.tenant) : 'none'
        });
        return res.status(500).json({
          success: false,
          error: 'Invalid tenant data',
          message: 'Tenant information is incomplete'
        });
      }
      
      req.params.tenantId = tenantMembership.tenant.tenantId;

      // Call the existing uploadFile method
      return await UploadController.uploadFile(req, res, next);
    } catch (error) {
      logger.error('Upload file for user error:', error);
      next(error);
    }
  }

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
      console.log('✅ S3 Upload Result:', {
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
}

module.exports = {
  UploadController,
  upload: upload.single('file')
};
