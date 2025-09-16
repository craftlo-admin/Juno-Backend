const express = require('express');
const router = express.Router();
const { StorageController } = require('../controllers/StorageController');
const { authenticateToken } = require('../middleware/auth');
const authorizeTenantAccess = require('../middleware/tenantAuth');

// List S3 objects for tenant (with optional prefix filtering)
router.get('/list/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']),
  StorageController.listObjects
);

// List all tenant's S3 objects (for user's first tenant)
router.get('/list', 
  authenticateToken,
  StorageController.listObjectsForUser
);

// Get S3 object details
router.get('/object/:tenantId/*', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']),
  StorageController.getObjectDetails
);

// Delete S3 object
router.delete('/object/:tenantId/*', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']),
  StorageController.deleteObject
);

// Bulk delete S3 objects
router.delete('/bulk/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin']), // Only owners and admins can bulk delete
  StorageController.bulkDeleteObjects
);

// Get S3 storage usage stats for tenant
router.get('/stats/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']),
  StorageController.getStorageStats
);

// Check S3 connectivity and status
router.get('/status', 
  authenticateToken,
  StorageController.getStorageStatus
);

// Debug endpoint to list all buckets and their contents
router.get('/debug/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin']),
  StorageController.debugListAllBuckets
);

module.exports = router;