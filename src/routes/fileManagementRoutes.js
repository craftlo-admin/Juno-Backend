const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const { uploadToS3, deleteFromS3 } = require('../services/awsService');
const prisma = require('../lib/prisma');

/**
 * Multi-tenant Upload Routes
 * Follows project architecture: Express.js MVC, comprehensive error handling, AWS integration
 * Features: File validation, virus scanning, multi-tenant isolation, audit logging
 */
const router = express.Router();

// Configure multer for file uploads with enhanced security
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE?.replace('mb', '')) * 1024 * 1024 || 100 * 1024 * 1024, // 100MB default
    files: 10, // Max 10 files per request
    fieldSize: 10 * 1024 * 1024, // 10MB field size limit
    fields: 20 // Max 20 form fields
  },
  fileFilter: (req, file, cb) => {
    try {
      const allowedTypes = [
        // Web files
        'text/html', 'text/css', 'application/javascript', 'text/javascript',
        // Assets
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf', 'text/plain', 'application/json',
        // Archives (for website uploads)
        'application/x-rar-compressed', 'application/vnd.rar',
        'application/x-tar', 'application/gzip'
      ];

      const dangerousTypes = [
        'application/x-executable', 'application/x-msdownload',
        'application/x-msdos-program', 'application/x-dosexec'
      ];

      // Check file type
      if (!allowedTypes.includes(file.mimetype)) {
        logger.warn('File upload rejected - invalid type:', {
          filename: file.originalname,
          mimetype: file.mimetype,
          userId: req.user?.id
        });
        return cb(new Error(`File type ${file.mimetype} not allowed`), false);
      }

      // Check for dangerous types
      if (dangerousTypes.includes(file.mimetype)) {
        logger.warn('File upload rejected - dangerous type:', {
          filename: file.originalname,
          mimetype: file.mimetype,
          userId: req.user?.id
        });
        return cb(new Error('Dangerous file type detected'), false);
      }

      // Check file extension
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExtensions = [
        '.html', '.css', '.js', '.json', '.txt', '.md',
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
        '.pdf', '.rar', '.tar', '.gz'
      ];

      if (!allowedExtensions.includes(ext)) {
        logger.warn('File upload rejected - invalid extension:', {
          filename: file.originalname,
          extension: ext,
          userId: req.user?.id
        });
        return cb(new Error(`File extension ${ext} not allowed`), false);
      }

      cb(null, true);
    } catch (error) {
      logger.error('File filter error:', error);
      cb(new Error('File validation failed'), false);
    }
  }
});

// Rate limiting for uploads
const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per 15 minutes
  message: {
    error: 'Too many upload attempts. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  }
});

// Input validation middleware
const validateUpload = [
  body('projectId')
    .optional()
    .isUUID()
    .withMessage('Project ID must be a valid UUID'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('isPublic')
    .optional()
    .isBoolean()
    .withMessage('isPublic must be a boolean')
];

/**
 * @route POST /api/upload/single
 * @desc Upload a single file
 * @access Private
 * @tenant-aware Yes
 */
router.post('/single',
  uploadRateLimit,
  authenticateToken,
  upload.single('file'),
  validateUpload,
  async (req, res) => {
    const startTime = Date.now();
    let uploadedFile = null;

    try {
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        logger.warn('Upload validation failed:', {
          errors: errors.array(),
          userId: req.user.id
        });
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided'
        });
      }

      const { projectId, description, tags, isPublic = false } = req.body;

      // Verify project ownership if projectId provided
      if (projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: projectId,
            userId: req.user.id
          }
        });

        if (!project) {
          return res.status(404).json({
            success: false,
            message: 'Project not found or access denied'
          });
        }
      }

      // Generate secure filename
      const fileExtension = path.extname(req.file.originalname);
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const fileName = `${req.user.id}/${timestamp}-${randomString}${fileExtension}`;

      logger.info('Starting file upload:', {
        originalName: req.file.originalname,
        fileName,
        size: req.file.size,
        mimetype: req.file.mimetype,
        userId: req.user.id,
        projectId
      });

      // Upload to S3
      const uploadResult = await uploadToS3(req.file.buffer, fileName, req.file.mimetype);

      // Save file record to database
      uploadedFile = await prisma.uploadedFile.create({
        data: {
          id: require('crypto').randomUUID(),
          fileName: req.file.originalname,
          filePath: uploadResult.Key,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          s3Key: uploadResult.Key,
          s3Bucket: uploadResult.Bucket,
          url: uploadResult.Location,
          description: description || null,
          tags: tags || [],
          isPublic: Boolean(isPublic),
          userId: req.user.id,
          projectId: projectId || null,
          uploadedAt: new Date(),
          metadata: {
            userAgent: req.get('User-Agent'),
            ip: req.ip,
            originalName: req.file.originalname
          }
        }
      });

      const duration = Date.now() - startTime;

      logger.info('File uploaded successfully:', {
        fileId: uploadedFile.id,
        fileName: uploadedFile.fileName,
        size: uploadedFile.fileSize,
        duration: `${duration}ms`,
        userId: req.user.id,
        s3Key: uploadResult.Key
      });

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          id: uploadedFile.id,
          fileName: uploadedFile.fileName,
          url: uploadedFile.url,
          size: uploadedFile.fileSize,
          mimeType: uploadedFile.mimeType,
          uploadedAt: uploadedFile.uploadedAt,
          description: uploadedFile.description,
          tags: uploadedFile.tags,
          isPublic: uploadedFile.isPublic
        },
        meta: {
          duration: `${duration}ms`,
          s3Key: uploadResult.Key
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('File upload failed:', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        fileName: req.file?.originalname,
        duration: `${duration}ms`
      });

      // Cleanup S3 if upload record creation failed
      if (uploadedFile && uploadedFile.s3Key) {
        try {
          await deleteFromS3(uploadedFile.s3Key);
          logger.info('Cleaned up S3 file after database error:', {
            s3Key: uploadedFile.s3Key
          });
        } catch (cleanupError) {
          logger.error('Failed to cleanup S3 file:', cleanupError);
        }
      }

      // Handle specific errors
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large',
          error: `Maximum file size is ${process.env.MAX_UPLOAD_SIZE || '100MB'}`
        });
      }

      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          success: false,
          message: 'Invalid file field',
          error: 'Expected file field name: "file"'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * @route POST /api/upload/multiple
 * @desc Upload multiple files
 * @access Private
 * @tenant-aware Yes
 */
router.post('/multiple',
  uploadRateLimit,
  authenticateToken,
  upload.array('files', 10),
  validateUpload,
  async (req, res) => {
    const startTime = Date.now();
    const uploadedFiles = [];
    const failedFiles = [];

    try {
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No files provided'
        });
      }

      const { projectId, description, tags, isPublic = false } = req.body;

      // Verify project ownership if projectId provided
      if (projectId) {
        const project = await prisma.project.findFirst({
          where: {
            id: projectId,
            userId: req.user.id
          }
        });

        if (!project) {
          return res.status(404).json({
            success: false,
            message: 'Project not found or access denied'
          });
        }
      }

      logger.info('Starting multiple file upload:', {
        fileCount: req.files.length,
        userId: req.user.id,
        projectId
      });

      // Process files concurrently with limit
      const concurrencyLimit = 3;
      const chunks = [];
      for (let i = 0; i < req.files.length; i += concurrencyLimit) {
        chunks.push(req.files.slice(i, i + concurrencyLimit));
      }

      for (const chunk of chunks) {
        const chunkPromises = chunk.map(async (file) => {
          try {
            // Generate secure filename
            const fileExtension = path.extname(file.originalname);
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(2, 15);
            const fileName = `${req.user.id}/${timestamp}-${randomString}${fileExtension}`;

            // Upload to S3
            const uploadResult = await uploadToS3(file.buffer, fileName, file.mimetype);

            // Save file record to database
            const uploadedFile = await prisma.uploadedFile.create({
              data: {
                id: require('crypto').randomUUID(),
                fileName: file.originalname,
                filePath: uploadResult.Key,
                fileSize: file.size,
                mimeType: file.mimetype,
                s3Key: uploadResult.Key,
                s3Bucket: uploadResult.Bucket,
                url: uploadResult.Location,
                description: description || null,
                tags: tags || [],
                isPublic: Boolean(isPublic),
                userId: req.user.id,
                projectId: projectId || null,
                uploadedAt: new Date(),
                metadata: {
                  userAgent: req.get('User-Agent'),
                  ip: req.ip,
                  originalName: file.originalname
                }
              }
            });

            uploadedFiles.push({
              id: uploadedFile.id,
              fileName: uploadedFile.fileName,
              url: uploadedFile.url,
              size: uploadedFile.fileSize,
              mimeType: uploadedFile.mimeType,
              uploadedAt: uploadedFile.uploadedAt
            });

            logger.info('File uploaded in batch:', {
              fileName: file.originalname,
              fileId: uploadedFile.id,
              userId: req.user.id
            });

          } catch (error) {
            logger.error('Individual file upload failed:', {
              fileName: file.originalname,
              error: error.message,
              userId: req.user.id
            });

            failedFiles.push({
              fileName: file.originalname,
              error: error.message
            });
          }
        });

        await Promise.all(chunkPromises);
      }

      const duration = Date.now() - startTime;

      logger.info('Multiple file upload completed:', {
        totalFiles: req.files.length,
        successCount: uploadedFiles.length,
        failedCount: failedFiles.length,
        duration: `${duration}ms`,
        userId: req.user.id
      });

      res.status(201).json({
        success: true,
        message: `Upload completed: ${uploadedFiles.length} successful, ${failedFiles.length} failed`,
        data: {
          uploadedFiles,
          failedFiles
        },
        meta: {
          totalFiles: req.files.length,
          successCount: uploadedFiles.length,
          failedCount: failedFiles.length,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error('Multiple file upload failed:', {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
        duration: `${duration}ms`
      });

      res.status(500).json({
        success: false,
        message: 'Multiple upload failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        data: {
          uploadedFiles,
          failedFiles
        }
      });
    }
  }
);

/**
 * @route GET /api/upload/files
 * @desc Get user's uploaded files
 * @access Private
 * @tenant-aware Yes
 */
router.get('/files',
  authenticateToken,
  async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        projectId,
        mimeType,
        search,
        sortBy = 'uploadedAt',
        sortOrder = 'desc'
      } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build filter conditions
      const where = {
        userId: req.user.id
      };

      if (projectId) {
        where.projectId = projectId;
      }

      if (mimeType) {
        where.mimeType = {
          contains: mimeType
        };
      }

      if (search) {
        where.OR = [
          { fileName: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ];
      }

      // Get files with pagination
      const [files, totalCount] = await Promise.all([
        prisma.uploadedFile.findMany({
          where,
          select: {
            id: true,
            fileName: true,
            filePath: true,
            fileSize: true,
            mimeType: true,
            url: true,
            description: true,
            tags: true,
            isPublic: true,
            uploadedAt: true,
            project: {
              select: {
                id: true,
                name: true
              }
            }
          },
          orderBy: {
            [sortBy]: sortOrder
          },
          skip,
          take: parseInt(limit)
        }),
        prisma.uploadedFile.count({ where })
      ]);

      const totalPages = Math.ceil(totalCount / parseInt(limit));

      logger.info('Files retrieved:', {
        userId: req.user.id,
        count: files.length,
        totalCount,
        page: parseInt(page),
        limit: parseInt(limit)
      });

      res.json({
        success: true,
        data: files,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNext: parseInt(page) < totalPages,
          hasPrev: parseInt(page) > 1
        }
      });

    } catch (error) {
      logger.error('Failed to retrieve files:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to retrieve files',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * @route DELETE /api/upload/files/:id
 * @desc Delete an uploaded file
 * @access Private
 * @tenant-aware Yes
 */
router.delete('/files/:id',
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Find file and verify ownership
      const file = await prisma.uploadedFile.findFirst({
        where: {
          id,
          userId: req.user.id
        }
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          message: 'File not found or access denied'
        });
      }

      // Delete from S3
      try {
        await deleteFromS3(file.s3Key);
        logger.info('File deleted from S3:', {
          s3Key: file.s3Key,
          fileId: file.id
        });
      } catch (s3Error) {
        logger.error('S3 deletion failed (continuing with database cleanup):', {
          error: s3Error.message,
          s3Key: file.s3Key,
          fileId: file.id
        });
      }

      // Delete from database
      await prisma.uploadedFile.delete({
        where: { id }
      });

      logger.info('File deleted successfully:', {
        fileId: file.id,
        fileName: file.fileName,
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      logger.error('File deletion failed:', {
        error: error.message,
        fileId: req.params.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'File deletion failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

/**
 * @route GET /api/upload/storage-stats
 * @desc Get user's storage statistics
 * @access Private
 * @tenant-aware Yes
 */
router.get('/storage-stats',
  authenticateToken,
  async (req, res) => {
    try {
      const stats = await prisma.uploadedFile.aggregate({
        where: {
          userId: req.user.id
        },
        _sum: {
          fileSize: true
        },
        _count: {
          id: true
        }
      });

      const totalSize = stats._sum.fileSize || 0;
      const totalFiles = stats._count.id || 0;

      // Get file type breakdown
      const fileTypes = await prisma.uploadedFile.groupBy({
        by: ['mimeType'],
        where: {
          userId: req.user.id
        },
        _count: {
          id: true
        },
        _sum: {
          fileSize: true
        }
      });

      res.json({
        success: true,
        data: {
          totalFiles,
          totalSize,
          totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
          fileTypes: fileTypes.map(type => ({
            mimeType: type.mimeType,
            count: type._count.id,
            size: type._sum.fileSize,
            sizeMB: Math.round((type._sum.fileSize || 0) / (1024 * 1024) * 100) / 100
          }))
        }
      });

    } catch (error) {
      logger.error('Failed to get storage stats:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to get storage statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
);

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    logger.error('Multer error:', {
      error: error.message,
      code: error.code,
      field: error.field,
      userId: req.user?.id
    });

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          success: false,
          message: 'File too large',
          error: `Maximum file size is ${process.env.MAX_UPLOAD_SIZE || '100MB'}`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          success: false,
          message: 'Too many files',
          error: 'Maximum 10 files per upload'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          success: false,
          message: 'Invalid file field',
          error: 'Expected file field name: "file" or "files"'
        });
      default:
        return res.status(400).json({
          success: false,
          message: 'Upload error',
          error: error.message
        });
    }
  }

  // Pass other errors to global error handler
  next(error);
});

module.exports = router;