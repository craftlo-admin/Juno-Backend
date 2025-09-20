const { body, validationResult } = require('express-validator');
const { prisma } = require('../lib/prisma');
const logger = require('../utils/logger');
const storageService = require('../services/storageService');
const { isAwsConfigured } = require('../config/aws');

/**
 * Utility function to determine the correct S3 bucket based on prefix/path
 * @param {string} prefix - The file prefix or path
 * @returns {string} - The appropriate bucket name
 */
function getBucketForPrefix(prefix) {
  if (prefix && prefix.startsWith('builds/')) {
    return process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME;
  } else if (prefix && prefix.startsWith('deployments/')) {
    return process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME;
  }
  return process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME;
}

/**
 * Utility function to transform S3 objects with metadata
 * @param {Array} objects - Raw S3 objects
 * @param {string} tenantId - Tenant ID for path calculation
 * @param {Object} tenantInfo - Optional tenant info for aggregation
 * @returns {Array} - Transformed objects
 */
function transformS3Objects(objects, tenantId, tenantInfo = null) {
  return (objects || []).map(obj => {
    const relativePath = obj.Key.replace(`tenants/${tenantId}/`, '');
    const objectBucket = getBucketForPrefix(relativePath);

    const result = {
      key: obj.Key,
      relativePath: relativePath,
      size: obj.Size,
      lastModified: obj.LastModified,
      storageClass: obj.StorageClass,
      etag: obj.ETag?.replace(/"/g, ''), // Remove quotes
      url: isAwsConfigured ? `https://${objectBucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}` : null
    };

    // Add tenant info for multi-tenant aggregation
    if (tenantInfo) {
      result.tenantId = tenantId;
      result.tenantName = tenantInfo.name;
    }

    return result;
  });
}

class StorageController {
  /**
   * List S3 objects for a specific tenant
   */
  static async listObjects(req, res, next) {
    try {
      const { tenantId } = req.params;
      const { prefix = '', maxKeys = 100, startAfter = '' } = req.query;

      logger.info('📁 Listing storage objects', {
        tenantId,
        prefix,
        maxKeys,
        startAfter
      });

      const s3Prefix = `tenants/${tenantId}/${prefix}`;

      // Use optimized bucket determination
      const bucket = getBucketForPrefix(prefix);

      logger.info('📦 Storage service call', {
        bucket,
        s3Prefix,
        awsConfigured: isAwsConfigured
      });

      const objects = await storageService.listS3Objects({
        bucket: bucket,
        prefix: s3Prefix,
        maxKeys: Math.max(1, Math.min(parseInt(maxKeys) || 100, 1000)), // Validate and limit
        startAfter: startAfter
      });

      logger.info('📋 Storage service response', {
        objectsCount: objects?.length || 0,
        objectsType: typeof objects,
        firstObject: objects?.[0] || null
      });

      // Transform objects using utility function
      const transformedObjects = transformS3Objects(objects, tenantId);

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

      const responseData = {
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
      };

      logger.info('📤 Sending storage response', {
        totalFiles: transformedObjects.length,
        builds: groupedObjects.builds.length,
        deployments: groupedObjects.deployments.length,
        hasData: transformedObjects.length > 0
      });

      res.json(responseData);

    } catch (error) {
      logger.error('List S3 objects error:', error);
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

      logger.info(`🗑️ Attempting comprehensive deletion for S3 object:`, {
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
          logger.info(`📦 Object found in ${bucketInfo.name} bucket: ${bucketInfo.bucket}`);
          break;
        } catch (error) {
          logger.debug(`Object not found in ${bucketInfo.name} bucket (${bucketInfo.bucket}):`, error.message);
          continue;
        }
      }

      // If object not found in any bucket, return detailed 404
      if (!objectExists) {
        logger.error(`❌ Object not found in any bucket: ${s3Key}`);
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

      // ✅ ENHANCED: Comprehensive cleanup logic
      const cleanupResults = {
        s3Deletion: false,
        buildCleanup: { performed: false, details: [] },
        deploymentCleanup: { performed: false, details: [] },
        cloudfrontInvalidation: { performed: false, details: [] },
        domainCleanup: { performed: false, details: [] },
        relatedFilesCleanup: { performed: false, details: [] }
      };

      // 1. Delete the primary S3 object
      try {
        await storageService.deleteFromS3({
          bucket: foundBucket.bucket,
          key: s3Key
        });
        cleanupResults.s3Deletion = true;
        logger.info(`✅ Primary S3 object deleted: ${s3Key}`);
      } catch (s3Error) {
        logger.error(`❌ Failed to delete S3 object:`, s3Error);
        throw new Error(`S3 deletion failed: ${s3Error.message}`);
      }

      // 2. ✅ ENHANCED: Handle build-related deletions
      logger.info(`🔍 DEBUG: About to check build path conditions for: ${objectPath}`);
      logger.info(`🔍 DEBUG: includes('/builds/'): ${objectPath.includes('/builds/')}`);
      logger.info(`🔍 DEBUG: includes('builds/'): ${objectPath.includes('builds/')}`);
      logger.info(`🔍 DEBUG: Combined condition: ${objectPath.includes('/builds/') || objectPath.includes('builds/')}`);
      
      if (objectPath.includes('/builds/') || objectPath.includes('builds/')) {
        logger.info(`🎯 DEBUG: ENTERED BUILD DELETION LOGIC!`);
        const buildIdMatch = objectPath.match(/builds\/([^\/]+)/);
        logger.info(`🔍 Build ID regex match result:`, buildIdMatch);
        
        if (buildIdMatch) {
          const buildId = buildIdMatch[1];
          
          logger.info(`🔍 Processing build deletion for buildId: ${buildId}`);
          logger.info(`🔍 Extracted tenantId: ${tenantId}`);
          logger.info(`🔍 Full object path: ${objectPath}`);
          logger.info(`🔍 Full S3 key: ${s3Key}`);
          
          try {
            // Find the build record (might not exist)
            const build = await prisma.build.findUnique({
              where: { id: buildId },
              include: {
                deployments: true,
                project: true
              }
            });

            // ✅ ALWAYS perform complete tenant deletion regardless of build record existence
            logger.info(`🗑️ Starting complete tenant deletion for: ${tenantId} (triggered by build deletion)`);
            
            // Get full tenant information before deletion
            const tenant = await prisma.tenant.findUnique({
              where: { tenantId: tenantId },
              include: {
                builds: true,
                deployments: true,
                projects: true,
                members: true,
                auditLogs: true
              }
            });

            if (tenant) {
              const deletionSummary = {
                tenantInfo: {
                  tenantId: tenant.tenantId,
                  name: tenant.name,
                  domain: tenant.domain,
                  customDomain: tenant.customDomain,
                  cloudfrontDistributionId: tenant.cloudfrontDistributionId,
                  cloudfrontDomain: tenant.cloudfrontDomain
                },
                counts: {
                  builds: tenant.builds.length,
                  deployments: tenant.deployments.length,
                  projects: tenant.projects.length,
                  members: tenant.members.length,
                  auditLogs: tenant.auditLogs.length
                }
              };

              // Delete ALL S3 objects for this tenant across all buckets
              logger.info(`🗂️ Deleting ALL S3 objects for tenant: ${tenantId}`);
              const tenantS3Prefix = `tenants/${tenantId}/`;
              
              // CRITICAL: Also delete root-level tenant files (like the deployed website)
              const rootTenantPrefix = `${tenantId}/`; // For files stored directly under tenantId/
              
              for (const bucketInfo of bucketsToSearch) {
                try {
                  // Delete files under tenants/tenantId/ prefix
                  const allTenantObjects = await storageService.listS3Objects({
                    bucket: bucketInfo.bucket,
                    prefix: tenantS3Prefix,
                    maxKeys: 1000 // Get all objects
                  });

                  // Delete files under tenantId/ prefix (root level)
                  const rootTenantObjects = await storageService.listS3Objects({
                    bucket: bucketInfo.bucket,
                    prefix: rootTenantPrefix,
                    maxKeys: 1000 // Get all objects
                  });

                  const allObjectsToDelete = [
                    ...(allTenantObjects || []),
                    ...(rootTenantObjects || [])
                  ];

                  // Delete all objects in efficient batches (up to 1000 per batch)
                  if (allObjectsToDelete && allObjectsToDelete.length > 0) {
                    logger.info(`📦 Found ${allObjectsToDelete.length} objects in ${bucketInfo.name} bucket to delete`);
                    
                    // Use batch deletion for efficiency (AWS supports up to 1000 objects per batch)
                    const batchSize = 1000;
                    const batches = [];
                    
                    for (let i = 0; i < allObjectsToDelete.length; i += batchSize) {
                      batches.push(allObjectsToDelete.slice(i, i + batchSize));
                    }

                    logger.info(`🚀 Deleting ${allObjectsToDelete.length} objects in ${batches.length} batch(es)`);

                    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                      const batch = batches[batchIndex];
                      try {
                        // Prepare batch delete request
                        const deleteObjects = batch.map(obj => ({ Key: obj.Key }));
                        
                        // Use AWS SDK batch delete (much faster than individual deletes)
                        const deleteResult = await storageService.batchDeleteFromS3({
                          bucket: bucketInfo.bucket,
                          objects: deleteObjects
                        });

                        logger.info(`✅ Batch ${batchIndex + 1}/${batches.length}: Deleted ${batch.length} objects from ${bucketInfo.name}`);
                        
                        // Add to cleanup results (summarized, not individual files)
                        cleanupResults.relatedFilesCleanup.details.push({
                          batch: batchIndex + 1,
                          bucket: bucketInfo.bucket,
                          objectsDeleted: batch.length,
                          totalSize: batch.reduce((sum, obj) => sum + (obj.Size || 0), 0),
                          status: 'batch_deleted'
                        });

                      } catch (batchError) {
                        logger.error(`❌ Batch ${batchIndex + 1} deletion failed for ${bucketInfo.name}:`, batchError);
                        
                        // Fallback to individual deletion for this batch
                        logger.info(`🔄 Falling back to individual deletion for batch ${batchIndex + 1}`);
                        for (const obj of batch) {
                          try {
                            await storageService.deleteFromS3({
                              bucket: bucketInfo.bucket,
                              key: obj.Key
                            });
                          } catch (individualError) {
                            logger.warn(`❌ Failed to delete individual object ${obj.Key}:`, individualError.message);
                          }
                        }
                        
                        cleanupResults.relatedFilesCleanup.details.push({
                          batch: batchIndex + 1,
                          bucket: bucketInfo.bucket,
                          objectsDeleted: batch.length,
                          status: 'individual_fallback',
                          error: batchError.message
                        });
                      }
                    }
                    logger.info(`✅ Processed all ${allObjectsToDelete.length} objects from ${bucketInfo.name} bucket`);
                  }
                } catch (listError) {
                  logger.warn(`⚠️ Failed to list objects in ${bucketInfo.name} bucket:`, listError);
                }
              }
              cleanupResults.relatedFilesCleanup.performed = true;

              // CloudFront cleanup
              if (tenant.cloudfrontDistributionId) {
                logger.info(`☁️ Processing CloudFront distribution: ${tenant.cloudfrontDistributionId}`);
                
                try {
                  // 1. Create CloudFront invalidation to clear all cached content
                  logger.info(`🔄 Creating CloudFront invalidation for distribution: ${tenant.cloudfrontDistributionId}`);
                  
                  const invalidationResult = await storageService.createCloudfrontInvalidation({
                    distributionId: tenant.cloudfrontDistributionId,
                    paths: ['/*'] // Invalidate all paths
                  });
                  
                  logger.info(`✅ CloudFront invalidation created: ${invalidationResult.invalidationId}`);
                  
                  // 2. Disable the CloudFront distribution to stop serving content
                  logger.info(`🚫 Disabling CloudFront distribution: ${tenant.cloudfrontDistributionId}`);
                  
                  const disableResult = await storageService.disableCloudfrontDistribution({
                    distributionId: tenant.cloudfrontDistributionId
                  });
                  
                  logger.info(`✅ CloudFront distribution disabled: ${tenant.cloudfrontDistributionId}`);
                  
                  cleanupResults.cloudfrontInvalidation.details.push({
                    distributionId: tenant.cloudfrontDistributionId,
                    domain: tenant.cloudfrontDomain,
                    customDomain: tenant.customDomain,
                    invalidationId: invalidationResult.invalidationId,
                    action: 'invalidated_and_disabled',
                    status: 'success'
                  });
                  
                } catch (cloudfrontError) {
                  logger.error(`❌ CloudFront cleanup failed for ${tenant.cloudfrontDistributionId}:`, cloudfrontError);
                  
                  cleanupResults.cloudfrontInvalidation.details.push({
                    distributionId: tenant.cloudfrontDistributionId,
                    domain: tenant.cloudfrontDomain,
                    customDomain: tenant.customDomain,
                    action: 'cleanup_failed',
                    error: cloudfrontError.message,
                    status: 'error'
                  });
                }
                cleanupResults.cloudfrontInvalidation.performed = true;
              }

              // Database cascade deletion (in proper order to handle foreign keys)
              logger.info(`🗄️ Starting database cascade deletion for tenant: ${tenantId}`);

              // Delete audit logs first (no dependencies)
              if (tenant.auditLogs.length > 0) {
                const deletedAuditLogs = await prisma.auditLog.deleteMany({
                  where: { tenantId: tenantId }
                });
                logger.info(`✅ Deleted ${deletedAuditLogs.count} audit logs`);
              }

              // Delete deployments (depend on builds)
              if (tenant.deployments.length > 0) {
                const deletedDeployments = await prisma.deployment.deleteMany({
                  where: { tenantId: tenantId }
                });
                cleanupResults.deploymentCleanup.details = tenant.deployments.map(d => ({
                  deploymentId: d.id,
                  version: d.version,
                  status: 'deleted'
                }));
                cleanupResults.deploymentCleanup.performed = true;
                logger.info(`✅ Deleted ${deletedDeployments.count} deployments`);
              }

              // Delete builds
              if (tenant.builds.length > 0) {
                const deletedBuilds = await prisma.build.deleteMany({
                  where: { tenantId: tenantId }
                });
                cleanupResults.buildCleanup.details = tenant.builds.map(b => ({
                  buildId: b.id,
                  version: b.version,
                  status: 'deleted',
                  action: 'full_tenant_deletion'
                }));
                cleanupResults.buildCleanup.performed = true;
                logger.info(`✅ Deleted ${deletedBuilds.count} builds`);
              }

              // Delete uploaded files associated with tenant projects
              const uploadedFilesCount = await prisma.uploadedFile.deleteMany({
                where: {
                  project: {
                    tenantId: tenantId
                  }
                }
              });
              if (uploadedFilesCount.count > 0) {
                logger.info(`✅ Deleted ${uploadedFilesCount.count} uploaded files`);
              }

              // Delete projects
              if (tenant.projects.length > 0) {
                const deletedProjects = await prisma.project.deleteMany({
                  where: { tenantId: tenantId }
                });
                logger.info(`✅ Deleted ${deletedProjects.count} projects`);
              }

              // Delete tenant members
              if (tenant.members.length > 0) {
                const deletedMembers = await prisma.tenantMember.deleteMany({
                  where: { tenantId: tenantId }
                });
                logger.info(`✅ Deleted ${deletedMembers.count} tenant members`);
              }

              // Finally, delete the tenant itself
              await prisma.tenant.delete({
                where: { tenantId: tenantId }
              });
              logger.info(`🎯 TENANT RECORD DELETED: ${tenantId}`);

              cleanupResults.domainCleanup.performed = true;
              cleanupResults.domainCleanup.details.push({
                action: 'complete_tenant_deletion',
                tenantId: tenantId,
                domain: tenant.domain,
                customDomain: tenant.customDomain,
                deletionSummary: deletionSummary
              });

              logger.info(`🎉 COMPLETE TENANT DELETION SUCCESSFUL`, {
                tenantId: tenantId,
                domain: tenant.domain,
                customDomain: tenant.customDomain,
                cloudfrontDistribution: tenant.cloudfrontDistributionId,
                totalBuilds: deletionSummary.counts.builds,
                totalDeployments: deletionSummary.counts.deployments,
                totalProjects: deletionSummary.counts.projects,
                totalMembers: deletionSummary.counts.members,
                s3ObjectsDeleted: cleanupResults.relatedFilesCleanup.details.length
              });

            } else {
              logger.warn(`⚠️ Tenant ${tenantId} not found in database during deletion`);
            }

          } catch (tenantDeletionError) {
            logger.error(`❌ CRITICAL: Complete tenant deletion failed for ${tenantId}:`, tenantDeletionError);
            cleanupResults.domainCleanup.details.push({
              action: 'tenant_deletion_failed',
              tenantId: tenantId,
              error: tenantDeletionError.message,
              critical: true
            });
            
            // Don't throw here - we want to return partial success info
          }
        }
      }

      // 3. ✅ ENHANCED: Handle deployment-related deletions
      if (objectPath.includes('/deployments/')) {
        const deploymentMatch = objectPath.match(/deployments\/([^\/]+)/);
        if (deploymentMatch) {
          const deploymentId = deploymentMatch[1];
          
          try {
            const deployment = await prisma.deployment.findUnique({
              where: { id: deploymentId }
            });

            if (deployment) {
              // Delete deployment record
              await prisma.deployment.delete({
                where: { id: deploymentId }
              });

              cleanupResults.deploymentCleanup.performed = true;
              cleanupResults.deploymentCleanup.details.push({
                deploymentId: deploymentId,
                version: deployment.version,
                status: 'deleted'
              });

              // CloudFront invalidation
              if (deployment.cloudfrontInvalidationId) {
                cleanupResults.cloudfrontInvalidation.performed = true;
                cleanupResults.cloudfrontInvalidation.details.push({
                  deploymentId: deploymentId,
                  invalidationId: deployment.cloudfrontInvalidationId,
                  status: 'invalidation_recorded'
                });
              }
            }
          } catch (deploymentError) {
            logger.error(`Deployment cleanup failed:`, deploymentError);
            cleanupResults.deploymentCleanup.details.push({
              deploymentId: deploymentId,
              status: 'error',
              error: deploymentError.message
            });
          }
        }
      }

      logger.info(`🎉 Comprehensive deletion completed for: ${s3Key}`, {
        tenantId: tenantId,
        userId: req.user.userId,
        objectPath: objectPath,
        bucket: foundBucket.bucket,
        bucketType: foundBucket.name,
        cleanupSummary: {
          s3Deletion: cleanupResults.s3Deletion,
          buildsAffected: cleanupResults.buildCleanup.details.length,
          deploymentsAffected: cleanupResults.deploymentCleanup.details.length,
          relatedFilesDeleted: cleanupResults.relatedFilesCleanup.details.length,
          cloudfrontInvalidations: cleanupResults.cloudfrontInvalidation.details.length
        }
      });

      res.json({
        success: true,
        message: 'Object and related resources deleted successfully',
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
          cleanupResults: cleanupResults,
          summary: {
            totalOperations: [
              cleanupResults.s3Deletion ? 1 : 0,
              cleanupResults.buildCleanup.details.length,
              cleanupResults.deploymentCleanup.details.length,
              cleanupResults.relatedFilesCleanup.details.length
            ].reduce((a, b) => a + b, 0),
            message: 'Comprehensive cleanup performed including S3 files, database records, and related resources'
          }
        }
      });

    } catch (error) {
      logger.error('🚨 Comprehensive delete operation failed:', error);
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

  /**
   * TEMPORARY: Backward compatibility for old frontend calls without tenant ID
   * TODO: Remove once frontend is updated to use tenant-specific routes
   * PERFORMANCE: Limited to prevent abuse - max 5 tenants, 50 objects per tenant
   */
  static async listObjectsCompatibility(req, res, next) {
    try {
      const { userId } = req.user;
      const { prefix = '', maxKeys = 100, startAfter = '' } = req.query;

      // Performance and security limits
      const maxTenantsToProcess = 5; // Reduced from 10 for better performance
      const maxKeysPerTenant = 50; // Limit per tenant
      const maxTotalKeys = Math.min(parseInt(maxKeys), 250); // Overall limit

      // Find user's active tenants with optimized query
      const tenantMemberships = await prisma.tenantMember.findMany({
        where: { 
          userId: userId,
          status: 'active'
        },
        include: {
          tenant: {
            select: {
              tenantId: true,
              name: true,
              status: true
            }
          }
        },
        orderBy: {
          joinedAt: 'asc'
        },
        take: maxTenantsToProcess // Limit at database level
      });

      if (!tenantMemberships || tenantMemberships.length === 0) {
        // No tenant found - return empty list with same structure as main method
        logger.info('No tenant found for user, returning empty storage list', { userId });
        return res.json({
          success: true,
          data: {
            objects: [],
            grouped: {
              builds: [],
              deployments: [],
              assets: [],
              other: []
            },
            stats: {
              totalFiles: 0,
              totalSize: 0,
              totalSizeFormatted: '0 B',
              builds: 0,
              deployments: 0,
              assets: 0,
              other: 0
            }
          },
          meta: {
            tenantId: null,
            prefix: '',
            maxKeys: 100,
            awsConfigured: isAwsConfigured
          },
          message: 'No tenants available - storage list is empty'
        });
      }

      logger.info('📁 Aggregating storage from multiple tenants', {
        userId,
        tenantCount: tenantMemberships.length,
        tenantIds: tenantMemberships.map(t => t.tenant.tenantId),
        limits: { maxTenantsToProcess, maxKeysPerTenant, maxTotalKeys }
      });

      // Aggregate objects from all tenants with proper limits
      let allObjects = [];
      let totalProcessed = 0;

      // Use optimized bucket determination
      const bucket = getBucketForPrefix(prefix);

      for (const tenantMembership of tenantMemberships) {
        if (totalProcessed >= maxTotalKeys) break;

        const tenantId = tenantMembership.tenant.tenantId;
        const s3Prefix = `tenants/${tenantId}/${prefix}`;

        try {
          const remainingKeys = maxTotalKeys - totalProcessed;
          const objects = await storageService.listS3Objects({
            bucket: bucket,
            prefix: s3Prefix,
            maxKeys: Math.min(remainingKeys, maxKeysPerTenant),
            startAfter: startAfter
          });

          logger.debug('📦 Fetched objects from tenant', {
            tenantId,
            objectCount: objects?.length || 0,
            bucket,
            s3Prefix
          });

          // Transform objects using utility function with tenant info
          const transformedObjects = transformS3Objects(objects, tenantId, tenantMembership.tenant);

          allObjects = allObjects.concat(transformedObjects);
          totalProcessed += transformedObjects.length;

        } catch (tenantError) {
          logger.warn('Failed to fetch objects from tenant', {
            tenantId,
            error: tenantError.message
          });
          // Continue with other tenants
        }
      }

      // Sort by lastModified descending (newest first)
      allObjects.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));

      // Group by type (builds, deployments, etc.)
      const groupedObjects = {
        builds: allObjects.filter(obj => obj.relativePath.startsWith('builds/')),
        deployments: allObjects.filter(obj => obj.relativePath.startsWith('deployments/')),
        assets: allObjects.filter(obj => obj.relativePath.startsWith('assets/')),
        other: allObjects.filter(obj => 
          !obj.relativePath.startsWith('builds/') && 
          !obj.relativePath.startsWith('deployments/') && 
          !obj.relativePath.startsWith('assets/')
        )
      };

      // Calculate total size
      const totalSize = allObjects.reduce((sum, obj) => sum + obj.size, 0);

      const responseData = {
        success: true,
        data: {
          objects: allObjects,
          grouped: groupedObjects,
          stats: {
            totalFiles: allObjects.length,
            totalSize: totalSize,
            totalSizeFormatted: formatBytes(totalSize),
            builds: groupedObjects.builds.length,
            deployments: groupedObjects.deployments.length,
            assets: groupedObjects.assets.length,
            other: groupedObjects.other.length
          }
        },
        meta: {
          tenantIds: tenantMemberships.map(t => t.tenant.tenantId), // Multiple tenants
          tenantCount: tenantMemberships.length,
          prefix: prefix,
          maxKeys: maxTotalKeys,
          awsConfigured: isAwsConfigured,
          aggregated: true // Flag to indicate this is aggregated data
        }
      };

      logger.info('📤 Sending aggregated storage response', {
        totalFiles: allObjects.length,
        builds: groupedObjects.builds.length,
        deployments: groupedObjects.deployments.length,
        tenantsProcessed: tenantMemberships.length,
        hasData: allObjects.length > 0
      });

      // Add cache-busting headers to prevent 304 responses
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': `"${Date.now()}-${allObjects.length}"`
      });

      res.json(responseData);
    } catch (error) {
      logger.error('Storage compatibility list error:', error);
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