const express = require('express');
const router = express.Router();
const ProjectController = require('../controllers/ProjectController');
const authMiddleware = require('../middleware/authMiddleware');
const tenantMiddleware = require('../middleware/tenantMiddleware');

/**
 * Multi-tenant Website Builder - Project Routes
 * Following project architecture: Express.js MVC, middleware pipeline
 */

// Apply authentication and tenant middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Project CRUD operations
router.post('/', ProjectController.createProject);
router.get('/', ProjectController.getProjects);
router.get('/:projectId', ProjectController.getProject);
router.put('/:projectId', ProjectController.updateProject);
router.delete('/:projectId', ProjectController.deleteProject);

// Build operations
router.post('/:projectId/build', ProjectController.buildProject);
router.get('/:projectId/builds', ProjectController.getBuilds);

// Deployment operations
router.post('/:projectId/deploy', ProjectController.deployProject);
router.get('/:projectId/deployments', ProjectController.getDeployments);

module.exports = router;