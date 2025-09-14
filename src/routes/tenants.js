const express = require('express');
const router = express.Router();
const TenantController = require('../controllers/TenantController');
const { authenticateToken } = require('../middleware/auth');
const authorizeTenantAccess = require('../middleware/tenantAuth');

// Public tenant routes
router.get('/', authenticateToken, TenantController.getUserTenants);
router.post('/', authenticateToken, TenantController.createTenant);

// Protected tenant routes (requires membership)
router.get('/:tenantId', authenticateToken, authorizeTenantAccess(), TenantController.getTenant);
router.put('/:tenantId', authenticateToken, authorizeTenantAccess(['owner', 'admin']), TenantController.updateTenant);
router.delete('/:tenantId', authenticateToken, authorizeTenantAccess(['owner']), TenantController.deleteTenant);

// Member management routes
router.get('/:tenantId/members', authenticateToken, authorizeTenantAccess(), TenantController.getMembers);
router.post('/:tenantId/members', authenticateToken, authorizeTenantAccess(['owner', 'admin']), TenantController.inviteMember);
router.put('/:tenantId/members/:userId', authenticateToken, authorizeTenantAccess(['owner', 'admin']), TenantController.updateMember);
router.delete('/:tenantId/members/:userId', authenticateToken, authorizeTenantAccess(['owner', 'admin']), TenantController.removeMember);

module.exports = router;
