const express = require('express');
const router = express.Router();
const { UploadController, upload } = require('../controllers/UploadController');
const { authenticateToken } = require('../middleware/auth');
const authorizeTenantAccess = require('../middleware/tenantAuth');

// Upload routes (require tenant selection)
router.post('/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']), 
  upload,
  UploadController.uploadFile
);

// TEMPORARY: Backward compatibility for old frontend calls
// TODO: Remove this route once frontend is updated to use tenant-specific routes
router.post('/', 
  authenticateToken,
  upload,
  UploadController.uploadFileCompatibility
);

router.get('/:tenantId/builds', 
  authenticateToken, 
  authorizeTenantAccess(), 
  UploadController.getBuilds
);

router.get('/:tenantId/builds/:buildId', 
  authenticateToken, 
  authorizeTenantAccess(), 
  UploadController.getBuild
);

router.post('/:tenantId/builds/:buildId/retry', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin']), 
  UploadController.retryBuild
);

router.delete('/:tenantId/builds/:buildId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin']), 
  UploadController.deleteBuild
);

module.exports = router;
