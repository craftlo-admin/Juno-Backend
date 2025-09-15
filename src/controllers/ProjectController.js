const logger = require('../utils/logger');
const prisma = require('../lib/prisma');
const BuildService = require('../services/buildService');

/**
 * Multi-tenant Website Builder - Project Controller
 * Following project architecture: Express.js MVC pattern
 */
class ProjectController {
  static async createProject(req, res) {
    try {
      const { name, description, settings } = req.body;
      const { tenant } = req;
      
      if (!name) {
        return res.status(400).json({
          error: 'Project name required'
        });
      }
      
      const project = await prisma.project.create({
        data: {
          name,
          description,
          tenantId: tenant.id,
          settings: settings || {}
        }
      });
      
      logger.info('Project created:', { projectId: project.id, tenantId: tenant.id });
      
      res.status(201).json({
        success: true,
        data: { project }
      });
    } catch (error) {
      logger.error('Project creation failed:', error);
      res.status(500).json({
        error: 'Project creation failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
  
  static async getProjects(req, res) {
    try {
      const { tenant } = req;
      
      const projects = await prisma.project.findMany({
        where: { tenantId: tenant.id },
        include: {
          builds: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          deployments: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      
      res.json({
        success: true,
        data: { projects }
      });
    } catch (error) {
      logger.error('Get projects failed:', error);
      res.status(500).json({
        error: 'Failed to fetch projects'
      });
    }
  }
  
  static async buildProject(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      // Verify project belongs to tenant
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      const build = await BuildService.createBuild(projectId);
      
      // Trigger async build process here
      setImmediate(() => {
        // Mock build process - replace with actual build logic
        setTimeout(async () => {
          try {
            await BuildService.updateBuildStatus(build.id, 'SUCCESS', {
              buildLog: 'Build completed successfully'
            });
          } catch (error) {
            await BuildService.updateBuildStatus(build.id, 'FAILED', {
              buildLog: error.message
            });
          }
        }, 5000);
      });
      
      res.status(202).json({
        success: true,
        message: 'Build started',
        data: { build }
      });
    } catch (error) {
      logger.error('Project build failed:', error);
      res.status(500).json({
        error: 'Build initiation failed'
      });
    }
  }

  static async getProject(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      res.json({
        success: true,
        data: { project }
      });
    } catch (error) {
      logger.error('Failed to fetch project:', error);
      res.status(500).json({
        error: 'Failed to fetch project'
      });
    }
  }

  static async updateProject(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      const { name, description, settings } = req.body;
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      const updatedProject = await prisma.project.update({
        where: { id: projectId },
        data: {
          ...(name && { name }),
          ...(description && { description }),
          ...(settings && { settings })
        }
      });
      
      res.json({
        success: true,
        data: { project: updatedProject }
      });
    } catch (error) {
      logger.error('Failed to update project:', error);
      res.status(500).json({
        error: 'Failed to update project'
      });
    }
  }

  static async deleteProject(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      await prisma.project.delete({
        where: { id: projectId }
      });
      
      res.json({
        success: true,
        message: 'Project deleted successfully'
      });
    } catch (error) {
      logger.error('Failed to delete project:', error);
      res.status(500).json({
        error: 'Failed to delete project'
      });
    }
  }

  static async getBuilds(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      // Verify project exists and belongs to tenant
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      // This would fetch builds from a builds table
      res.json({
        success: true,
        data: { builds: [] },
        message: 'Build history feature coming soon'
      });
    } catch (error) {
      logger.error('Failed to fetch builds:', error);
      res.status(500).json({
        error: 'Failed to fetch builds'
      });
    }
  }

  static async deployProject(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      res.json({
        success: true,
        message: 'Deployment feature coming soon',
        data: { projectId }
      });
    } catch (error) {
      logger.error('Failed to deploy project:', error);
      res.status(500).json({
        error: 'Failed to deploy project'
      });
    }
  }

  static async getDeployments(req, res) {
    try {
      const { projectId } = req.params;
      const { tenant } = req;
      
      const project = await prisma.project.findFirst({
        where: { id: projectId, tenantId: tenant.id }
      });
      
      if (!project) {
        return res.status(404).json({
          error: 'Project not found'
        });
      }
      
      res.json({
        success: true,
        data: { deployments: [] },
        message: 'Deployment history feature coming soon'
      });
    } catch (error) {
      logger.error('Failed to fetch deployments:', error);
      res.status(500).json({
        error: 'Failed to fetch deployments'
      });
    }
  }
}

module.exports = ProjectController;