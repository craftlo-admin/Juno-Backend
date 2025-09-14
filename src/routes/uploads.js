const express = require('express');
const router = express.Router();
const { UploadController, upload } = require('../controllers/UploadController');
const { authenticateToken } = require('../middleware/auth');
const authorizeTenantAccess = require('../middleware/tenantAuth');

// Upload routes (require tenant membership)
router.post('/:tenantId', 
  authenticateToken, 
  authorizeTenantAccess(['owner', 'admin', 'member']), 
  upload,
  UploadController.uploadFile
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

module.exports = router;
