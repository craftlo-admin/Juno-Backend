const { body, validationResult } = require('express-validator');
const { prisma } = require('../lib/prisma');
const logger = require('../utils/logger');
const storageService = require('../services/storageService');
const { isAwsConfigured } = require('../config/aws');

class StorageController {
  /**
   * List S3 objects for a specific tenant
   */
  static async listObjects(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { prefix = '', maxKeys = 100, startAfter = '' } = req.query;

      const s3Prefix = `tenants/${tenantId}/${prefix}`;

      // Determine which bucket to use based on prefix
      const bucket = prefix && prefix.startsWith('builds/') 
        ? process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME
        : process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME;

      const objects = await storageService.listS3Objects({
        bucket: bucket,
        prefix: s3Prefix,
        maxKeys: parseInt(maxKeys),
        startAfter: startAfter
      });

      // Transform objects to include useful metadata
      const transformedObjects = objects.map(obj => {
        // Determine correct bucket for URL generation
        const relativePath = obj.Key.replace(`tenants/${tenantId}/`, '');
        let objectBucket = bucket;
        if (relativePath.startsWith('builds/')) {
          objectBucket = process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME;
        } else if (relativePath.startsWith('deployments/')) {
          objectBucket = process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME;
        }

        return {
          key: obj.Key,
          relativePath: relativePath,
          size: obj.Size,
          lastModified: obj.LastModified,
          storageClass: obj.StorageClass,
          etag: obj.ETag?.replace(/"/g, ''), // Remove quotes
          url: isAwsConfigured ? `https://${objectBucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}` : null
        };
      });

      // Group by type (builds, deployments, etc.)
      const groupedObjects = {
        builds: transformedObjects.filter(obj => obj.relativePath.startsWith('builds/')),
        deployments: transformedObjects.filter(obj => obj.relativePath.startsWith('deployments/')),
        assets: transformedObjects.filter(obj => obj.relativePath.startsWith('assets/')),
        other: transformedObjects.filter(obj => 
          !obj.relativePath.startsWith('builds/') && 
          !obj.relativePath.startsWith('deployments/') && 
          !obj.relativePath.startsWith('assets/')
        )
      };

      // Calculate total size
      const totalSize = transformedObjects.reduce((sum, obj) => sum + obj.size, 0);

      res.json({
        success: true,
        data: {
          objects: transformedObjects,
          grouped: groupedObjects,
          stats: {
            totalFiles: transformedObjects.length,
            totalSize: totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            builds: groupedObjects.builds.length,
            deployments: groupedObjects.deployments.length,
            assets: groupedObjects.assets.length,
            other: groupedObjects.other.length
          }
        },
        meta: {
          tenantId: tenantId,
          prefix: s3Prefix,
          maxKeys: parseInt(maxKeys),
          awsConfigured: isAwsConfigured
        }
      });

    } catch (error) {
      logger.error('List S3 objects error:', error);
      next(error);
    }
  }

  /**
   * List S3 objects for user's first tenant
   */
  static async listObjectsForUser(req, res, next) {
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
          joinedAt: 'asc'
        }
      });

      if (!tenantMembership) {
        return res.status(404).json({
          error: 'No active tenant membership found',
          message: 'User is not a member of any active tenant'
        });
      }

      // Attach tenant to request and call listObjects
      req.tenant = tenantMembership.tenant;
      req.params.tenantId = tenantMembership.tenant.tenantId;

      return await StorageController.listObjects(req, res, next);
    } catch (error) {
      logger.error('List objects for user error:', error);
      next(error);
    }
  }

  /**
   * Get details of a specific S3 object
   */
  static async getObjectDetails(req, res, next) {
    try {
      const { tenantId } = req.params;
      const objectPath = req.params[0]; // Capture the wildcard path

      if (!objectPath) {
        return res.status(400).json({
          error: 'Object path required',
          message: 'Please specify the S3 object path'
        });
      }

      const s3Key = `tenants/${tenantId}/${objectPath}`;

      // Determine which bucket to use based on object path
      let bucket;
      if (objectPath.startsWith('builds/')) {
        bucket = process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME;
      } else if (objectPath.startsWith('deployments/')) {
        bucket = process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME;
      } else {
        bucket = process.env.AWS_S3_BUCKET_NAME;
      }

      // Get object metadata from S3
      const objectDetails = await storageService.getFromS3({
        bucket: bucket,
        key: s3Key
      });

      res.json({
        success: true,
        data: {
          key: s3Key,
          relativePath: objectPath,
          size: objectDetails.ContentLength,
          contentType: objectDetails.ContentType,
          lastModified: objectDetails.LastModified,
          metadata: objectDetails.Metadata,
          etag: objectDetails.ETag?.replace(/"/g, ''),
          url: isAwsConfigured ? `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}` : null
        },
        meta: {
          tenantId: tenantId,
          bucket: bucket,
          awsConfigured: isAwsConfigured
        }
      });

    } catch (error) {
      if (error.message.includes('File not found')) {
        return res.status(404).json({
          error: 'Object not found',
          message: 'The specified S3 object does not exist'
        });
      }
      logger.error('Get object details error:', error);
      next(error);
    }
  }

  /**
   * Delete a specific S3 object - Enhanced with multi-bucket support
   */
  static async deleteObject(req, res, next) {
    try {
      const { tenantId } = req.params;
      const objectPath = req.params[0];

      if (!objectPath) {
        return res.status(400).json({
          error: 'Object path required',
          message: 'Please specify the S3 object path to delete'
        });
      }

      const s3Key = `tenants/${tenantId}/${objectPath}`;

      // Define all possible buckets to search
      const bucketsToSearch = [
        {
          name: 'UPLOADS',
          bucket: process.env.AWS_S3_BUCKET_UPLOADS,
          description: 'Source files and build artifacts'
        },
        {
          name: 'STATIC', 
          bucket: process.env.AWS_S3_BUCKET_STATIC,
          description: 'Deployed website files'
        },
        {
          name: 'DEFAULT',
          bucket: process.env.AWS_S3_BUCKET_NAME,
          description: 'Default storage bucket'
        }
      ].filter(b => b.bucket); // Only include configured buckets

      logger.info(`Attempting to delete S3 object:`, {
        tenantId: tenantId,
        objectPath: objectPath,
        s3Key: s3Key,
        bucketsToSearch: bucketsToSearch.map(b => `${b.name}:${b.bucket}`),
        userId: req.user.userId
      });

      let foundBucket = null;
      let objectExists = false;

      // Search across all buckets to find the object
      for (const bucketInfo of bucketsToSearch) {
        try {
          await storageService.getFromS3({
            bucket: bucketInfo.bucket,
            key: s3Key
          });
          
          foundBucket = bucketInfo;
          objectExists = true;
          logger.info(`Object found in ${bucketInfo.name} bucket: ${bucketInfo.bucket}`);
          break;
        } catch (error) {
          logger.debug(`Object not found in ${bucketInfo.name} bucket (${bucketInfo.bucket}):`, error.message);
          continue;
        }
      }

      // If object not found in any bucket, return detailed 404
      if (!objectExists) {
        logger.error(`Object not found in any bucket: ${s3Key}`);
        return res.status(404).json({
          error: 'Object not found',
          message: 'The specified S3 object does not exist in any configured bucket',
          debug: {
            s3Key: s3Key,
            objectPath: objectPath,
            tenantId: tenantId,
            searchedBuckets: bucketsToSearch.map(b => ({
              name: b.name,
              bucket: b.bucket,
              description: b.description
            })),
            suggestion: 'Use GET /api/storage/debug/:tenantId to see all available objects'
          }
        });
      }

      // Delete the object from the found bucket
      await storageService.deleteFromS3({
        bucket: foundBucket.bucket,
        key: s3Key
      });

      // If this is a build source file, update the build record
      let databaseUpdates = {
        buildRecordUpdated: false,
        action: 'none'
      };

      if (objectPath.includes('/builds/') && objectPath.endsWith('/source.rar')) {
        const buildIdMatch = objectPath.match(/builds\/([^\/]+)\/source\.rar$/);
        if (buildIdMatch) {
          const buildId = buildIdMatch[1];
          try {
            const updatedBuild = await prisma.build.update({
              where: { id: buildId },
              data: { 
                sourceFile: null,
                status: 'source_deleted',
                updatedAt: new Date()
              }
            });
            
            databaseUpdates = {
              buildRecordUpdated: true,
              buildId: buildId,
              action: 'source_file_deleted',
              previousStatus: updatedBuild.status,
              newStatus: 'source_deleted'
            };
            
            logger.info(`Updated build ${buildId} status after source deletion`);
          } catch (dbError) {
            logger.warn(`Failed to update build ${buildId} after source deletion:`, dbError);
            databaseUpdates.error = `Database update failed: ${dbError.message}`;
          }
        }
      }

      logger.info(`S3 object deleted successfully: ${s3Key}`, {
        tenantId: tenantId,
        userId: req.user.userId,
        objectPath: objectPath,
        bucket: foundBucket.bucket,
        bucketType: foundBucket.name
      });

      res.json({
        success: true,
        message: 'Object deleted successfully',
        data: {
          deletedObject: {
            key: s3Key,
            relativePath: objectPath,
            tenantId: tenantId
          },
          storageInfo: {
            bucket: foundBucket.bucket,
            bucketType: foundBucket.name,
            bucketDescription: foundBucket.description,
            deletedAt: new Date().toISOString()
          },
          databaseUpdates: databaseUpdates
        }
      });

    } catch (error) {
      logger.error('Delete S3 object error:', error);
      next(error);
    }
  }

  /**
   * Bulk delete multiple S3 objects
   */
  static async bulkDeleteObjects(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { objectPaths, prefix } = req.body;

      if (!objectPaths && !prefix) {
        return res.status(400).json({
          error: 'Object paths or prefix required',
          message: 'Please specify either objectPaths array or prefix to delete'
        });
      }

      let keysToDelete = [];

      if (prefix) {
        // Delete by prefix
        const s3Prefix = `tenants/${tenantId}/${prefix}`;
        const objects = await storageService.listS3Objects({
          bucket: process.env.AWS_S3_BUCKET_NAME,
          prefix: s3Prefix,
          maxKeys: 1000
        });

        keysToDelete = objects.map(obj => ({ Key: obj.Key }));
      } else {
        // Delete specific objects
        keysToDelete = objectPaths.map(path => ({
          Key: `tenants/${tenantId}/${path}`
        }));
      }

      if (keysToDelete.length === 0) {
        return res.json({
          success: true,
          message: 'No objects found to delete',
          data: { deletedCount: 0 }
        });
      }

      // Perform bulk delete
      const result = await storageService.deleteMultipleFromS3({
        bucket: process.env.AWS_S3_BUCKET_NAME,
        keys: keysToDelete
      });

      res.json({
        success: true,
        message: `${result.deleted.length} objects deleted successfully`,
        data: {
          deletedCount: result.deleted.length,
          deletedObjects: result.deleted,
          errors: result.errors
        }
      });

      logger.info(`Bulk S3 objects deleted for tenant ${tenantId}`, {
        tenantId: tenantId,
        userId: req.user.userId,
        objectPaths: objectPaths,
        prefix: prefix
      });

    } catch (error) {
      logger.error('Bulk delete S3 objects error:', error);
      next(error);
    }
  }

  /**
   * Get storage usage statistics for tenant
   */
  static async getStorageStats(req, res, next) {
    try {
      const { tenantId } = req.params;
      
      const s3Prefix = `tenants/${tenantId}/`;
      
      // Get objects from all buckets
      const buckets = [
        { name: 'uploads', bucket: process.env.AWS_S3_BUCKET_UPLOADS },
        { name: 'static', bucket: process.env.AWS_S3_BUCKET_STATIC },
        { name: 'default', bucket: process.env.AWS_S3_BUCKET_NAME }
      ].filter(b => b.bucket);

      const stats = {
        totalFiles: 0,
        totalSize: 0,
        buckets: {},
        fileTypes: {},
        folders: {
          builds: { count: 0, size: 0 },
          deployments: { count: 0, size: 0 },
          assets: { count: 0, size: 0 },
          other: { count: 0, size: 0 }
        }
      };

      for (const bucketInfo of buckets) {
        try {
          const objects = await storageService.listS3Objects({
            bucket: bucketInfo.bucket,
            prefix: s3Prefix,
            maxKeys: 10000
          });

          const bucketSize = objects.reduce((sum, obj) => sum + obj.Size, 0);
          
          stats.buckets[bucketInfo.name] = {
            count: objects.length,
            size: bucketSize,
            sizeFormatted: formatBytes(bucketSize)
          };

          stats.totalFiles += objects.length;
          stats.totalSize += bucketSize;

          // Categorize by folder and file type
          objects.forEach(obj => {
            const relativePath = obj.Key.replace(s3Prefix, '');
            const extension = relativePath.split('.').pop()?.toLowerCase() || 'no-extension';
            
            // Update file type stats
            if (!stats.fileTypes[extension]) {
              stats.fileTypes[extension] = { count: 0, size: 0 };
            }
            stats.fileTypes[extension].count++;
            stats.fileTypes[extension].size += obj.Size;

            // Update folder stats
            if (relativePath.startsWith('builds/')) {
              stats.folders.builds.count++;
              stats.folders.builds.size += obj.Size;
            } else if (relativePath.startsWith('deployments/')) {
              stats.folders.deployments.count++;
              stats.folders.deployments.size += obj.Size;
            } else if (relativePath.startsWith('assets/')) {
              stats.folders.assets.count++;
              stats.folders.assets.size += obj.Size;
            } else {
              stats.folders.other.count++;
              stats.folders.other.size += obj.Size;
            }
          });

        } catch (error) {
          logger.error(`Error getting stats from bucket ${bucketInfo.name}:`, error);
          stats.buckets[bucketInfo.name] = {
            error: error.message
          };
        }
      }

      // Format folder sizes
      Object.keys(stats.folders).forEach(folder => {
        stats.folders[folder].sizeFormatted = formatBytes(stats.folders[folder].size);
      });

      // Format file type sizes
      Object.keys(stats.fileTypes).forEach(type => {
        stats.fileTypes[type].sizeFormatted = formatBytes(stats.fileTypes[type].size);
      });

      res.json({
        success: true,
        data: {
          ...stats,
          totalSizeFormatted: formatBytes(stats.totalSize),
          tenantId: tenantId
        }
      });

    } catch (error) {
      logger.error('Get storage stats error:', error);
      next(error);
    }
  }

  /**
   * Check S3 connectivity and configuration status
   */
  static async getStorageStatus(req, res, next) {
    try {
      const status = {
        configured: isAwsConfigured,
        buckets: {},
        connectivity: 'unknown'
      };

      if (!isAwsConfigured) {
        return res.json({
          success: true,
          data: status
        });
      }

      // Test connectivity to each bucket
      const buckets = [
        { name: 'uploads', bucket: process.env.AWS_S3_BUCKET_UPLOADS },
        { name: 'static', bucket: process.env.AWS_S3_BUCKET_STATIC },
        { name: 'default', bucket: process.env.AWS_S3_BUCKET_NAME }
      ].filter(b => b.bucket);

      let allConnected = true;

      for (const bucketInfo of buckets) {
        try {
          await storageService.listS3Objects({
            bucket: bucketInfo.bucket,
            prefix: 'test-connectivity',
            maxKeys: 1
          });
          
          status.buckets[bucketInfo.name] = {
            bucket: bucketInfo.bucket,
            status: 'connected'
          };
        } catch (error) {
          status.buckets[bucketInfo.name] = {
            bucket: bucketInfo.bucket,
            status: 'error',
            error: error.message
          };
          allConnected = false;
        }
      }

      status.connectivity = allConnected ? 'connected' : 'partial';

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      logger.error('Get storage status error:', error);
      next(error);
    }
  }

  /**
   * Debug endpoint to list objects across all buckets
   */
  static async debugListAllBuckets(req, res, next) {
    try {
      const { tenantId } = req.params;
      const tenantPrefix = `tenants/${tenantId}/`;

      const buckets = [
        { 
          name: 'UPLOADS', 
          env: 'AWS_S3_BUCKET_UPLOADS',
          bucket: process.env.AWS_S3_BUCKET_UPLOADS 
        },
        { 
          name: 'STATIC', 
          env: 'AWS_S3_BUCKET_STATIC',
          bucket: process.env.AWS_S3_BUCKET_STATIC 
        },
        { 
          name: 'DEFAULT', 
          env: 'AWS_S3_BUCKET_NAME',
          bucket: process.env.AWS_S3_BUCKET_NAME 
        }
      ];

      const results = {};

      for (const bucketInfo of buckets) {
        if (!bucketInfo.bucket) {
          results[bucketInfo.name] = {
            configured: false,
            error: `Environment variable ${bucketInfo.env} not set`
          };
          continue;
        }

        try {
          const objects = await storageService.listS3Objects({
            bucket: bucketInfo.bucket,
            prefix: tenantPrefix,
            maxKeys: 100
          });

          results[bucketInfo.name] = {
            configured: true,
            bucket: bucketInfo.bucket,
            objectCount: objects.length,
            objects: objects.slice(0, 10).map(obj => ({
              key: obj.Key,
              size: obj.Size,
              lastModified: obj.LastModified
            })),
            truncated: objects.length > 10
          };
        } catch (error) {
          results[bucketInfo.name] = {
            configured: true,
            bucket: bucketInfo.bucket,
            error: error.message
          };
        }
      }

      res.json({
        success: true,
        debug: true,
        data: {
          tenantId: tenantId,
          bucketResults: results,
          summary: {
            totalConfiguredBuckets: buckets.filter(b => b.bucket).length,
            totalObjects: Object.values(results).reduce((sum, result) => {
              return sum + (result.objectCount || 0);
            }, 0)
          }
        }
      });

    } catch (error) {
      logger.error('Debug list all buckets error:', error);
      next(error);
    }
  }

  /**
   * Debug endpoint to show environment configuration
   */
  static async debugEnvironment(req, res, next) {
    try {
      res.json({
        success: true,
        environment: {
          AWS_S3_BUCKET_NAME: process.env.AWS_S3_BUCKET_NAME || 'NOT SET',
          AWS_S3_BUCKET_UPLOADS: process.env.AWS_S3_BUCKET_UPLOADS || 'NOT SET',
          AWS_S3_BUCKET_STATIC: process.env.AWS_S3_BUCKET_STATIC || 'NOT SET',
          AWS_REGION: process.env.AWS_REGION || 'NOT SET',
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ? 'SET (hidden)' : 'NOT SET',
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ? 'SET (hidden)' : 'NOT SET',
          AWS_CONFIGURED: isAwsConfigured,
          NODE_ENV: process.env.NODE_ENV
        }
      });
    } catch (error) {
      logger.error('Debug environment error:', error);
      next(error);
    }
  }
}

/**
 * Helper function to format bytes into human readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
  StorageController
};