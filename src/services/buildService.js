const Queue = require('bull');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const AdmZip = require('adm-zip');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { prisma } = require('../lib/prisma');
const storageService = require('./storageService');

/**
 * Multi-tenant Website Builder - Build Service
 * Following project architecture: Express.js MVC, comprehensive error handling
 */
class BuildService {
  static async createBuild(projectId, options = {}) {
    try {
      const build = await prisma.build.create({
        data: {
          projectId,
          version: options.version || `v${Date.now()}`,
          status: 'PENDING'
        }
      });
      
      logger.info('Build created:', { buildId: build.id, projectId });
      return build;
    } catch (error) {
      logger.error('Build creation failed:', error);
      throw error;
    }
  }
  
  static async updateBuildStatus(buildId, status, data = {}) {
    try {
      const build = await prisma.build.update({
        where: { id: buildId },
        data: {
          status,
          ...data,
          ...(status === 'SUCCESS' || status === 'FAILED' ? { finishedAt: new Date() } : {})
        }
      });
      
      logger.info('Build status updated:', { buildId, status });
      return build;
    } catch (error) {
      logger.error('Build status update failed:', error);
      throw error;
    }
  }
  
  static async getBuildsByProject(projectId) {
    return prisma.build.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' }
    });
  }
}

// Create build queue
const buildQueue = new Queue('build processing', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined
  }
});

// Build queue processor
buildQueue.process('process-build', async (job) => {
  const { buildId, tenantId, userId, storageKey, buildConfig } = job.data;

  try {
    logger.info('Starting build process', { buildId, tenantId });

    // Update build status to building
    await prisma.build.update({
      where: { id: buildId },
      data: {
        status: 'building',
        startedAt: new Date()
      }
    });

    // Emit progress update via WebSocket (optional)
    try {
      const websocketService = require('./websocketService');
      websocketService.emitToTenant(tenantId, 'build:started', {
        buildId,
        status: 'building',
        message: 'Build process started'
      });
    } catch (error) {
      logger.warn('WebSocket service not available:', error.message);
    }

    // Process the build (implement your build logic here)
    const buildResult = await processBuild({
      buildId,
      storageKey,
      buildConfig
    });

    if (buildResult.success) {
      // Update build status to success
      await prisma.build.update({
        where: { id: buildId },
        data: {
          status: 'success',
          finishedAt: new Date(),
          buildPath: buildResult.artifactsPath
        }
      });

      // Create deployment record
      const deployment = await prisma.deployment.create({
        data: {
          tenantId: tenantId,
          userId: userId,
          buildId: buildId,
          version: `deploy-${Date.now()}`,
          status: 'pending',
          url: buildResult.deploymentUrl
        }
      });

      // Emit success via WebSocket (optional)
      try {
        const websocketService = require('./websocketService');
        websocketService.emitToTenant(tenantId, 'build:completed', {
          buildId,
          status: 'success',
          deploymentId: deployment.id,
          url: buildResult.deploymentUrl
        });
      } catch (error) {
        logger.warn('WebSocket service not available for success notification:', error.message);
      }

      logger.info('Build completed successfully', { buildId, deploymentId: deployment.id });

    } else {
      // Update build status to failed
      await prisma.build.update({
        where: { id: buildId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: buildResult.error
        }
      });

      // Emit failure via WebSocket (optional)
      try {
        const websocketService = require('./websocketService');
        websocketService.emitToTenant(tenantId, 'build:failed', {
          buildId,
          status: 'failed',
          error: buildResult.error
        });
      } catch (error) {
        logger.warn('WebSocket service not available for failure notification:', error.message);
      }

      logger.error('Build failed', { buildId, error: buildResult.error });
    }

  } catch (error) {
    logger.error('Build process error:', error);

    // Update build status to failed
    await prisma.build.update({
      where: { id: buildId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: error.message
      }
    });

    // Emit failure via WebSocket (optional)
    try {
      const websocketService = require('./websocketService');
      websocketService.emitToTenant(tenantId, 'build:failed', {
        buildId,
        status: 'failed',
        error: error.message
      });
    } catch (wsError) {
      logger.warn('WebSocket service not available for error notification:', wsError.message);
    }
  }
});

/**
 * Process build in sandboxed environment with complete ZIP processing
 * Downloads ZIP from S3, extracts, validates Next.js project, builds and deploys
 */
async function processBuild({ buildId, storageKey, buildConfig }) {
  let tempDir = null;
  let sourceDir = null;
  let outputDir = null;
  
  try {
    logger.info('Starting complete build process', { 
      buildId, 
      storageKey, 
      framework: buildConfig?.framework || 'nextjs' 
    });

    // 1. Create temporary directories for this build
    const buildWorkspace = path.join(process.cwd(), 'temp', 'builds', buildId);
    tempDir = path.join(buildWorkspace, 'temp');
    sourceDir = path.join(buildWorkspace, 'source');
    outputDir = path.join(buildWorkspace, 'output');

    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(outputDir, { recursive: true });

    logger.info('Build workspace created', { 
      buildId, 
      buildWorkspace,
      tempDir,
      sourceDir,
      outputDir
    });

    // 2. Download ZIP file from S3
    const zipFilePath = path.join(tempDir, 'source.zip');
    logger.info('Downloading ZIP from S3', { 
      buildId,
      storageKey, 
      destination: zipFilePath 
    });
    
    // Determine which bucket contains the ZIP file (following enhanced storage logic)
    let bucket = process.env.AWS_S3_BUCKET_NAME; // Default
    if (storageKey.includes('/builds/')) {
      bucket = process.env.AWS_S3_BUCKET_UPLOADS || process.env.AWS_S3_BUCKET_NAME;
    }

    await storageService.downloadFromS3({
      key: storageKey,
      bucket: bucket,
      localPath: zipFilePath
    });

    logger.info('ZIP file downloaded successfully', { 
      buildId,
      fileSize: (await fs.stat(zipFilePath)).size,
      filePath: zipFilePath
    });

    // 3. Extract ZIP file using adm-zip
    logger.info('Extracting ZIP file', { buildId, zipFilePath, extractTo: sourceDir });
    await extractZipFile(zipFilePath, sourceDir);

    // 4. Find the actual project directory (handle nested folders)
    const projectDir = await findProjectDirectory(sourceDir);
    logger.info('Project directory located', { buildId, projectDir });

    // 5. Validate Next.js project structure
    await validateNextJsProject(projectDir, buildId);

    // 6. Install dependencies
    logger.info('Installing project dependencies', { buildId, cwd: projectDir });
    const installResult = await execAsync('npm install --production', { 
      cwd: projectDir,
      timeout: 600000, // 10 minutes timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });
    
    logger.info('Dependencies installed successfully', { 
      buildId,
      stdout: installResult.stdout?.substring(0, 500) + '...' // Truncate for logging
    });

    // 7. Inject tenant-specific environment variables
    await injectEnvironmentVariables(projectDir, buildId, buildConfig);

    // 8. Build Next.js application
    logger.info('Building Next.js application', { buildId, cwd: projectDir });
    const buildResult = await execAsync('npm run build', { 
      cwd: projectDir,
      timeout: 900000, // 15 minutes timeout
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });

    logger.info('Next.js build completed', { 
      buildId,
      stdout: buildResult.stdout?.substring(0, 500) + '...'
    });

    // 9. Export static files (if Next.js supports static export)
    let staticExportPath = projectDir;
    try {
      logger.info('Attempting static export', { buildId, cwd: projectDir });
      const exportResult = await execAsync('npx next export', { 
        cwd: projectDir,
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024 * 10
      });
      
      staticExportPath = path.join(projectDir, 'out');
      logger.info('Static export successful', { 
        buildId,
        staticExportPath,
        stdout: exportResult.stdout?.substring(0, 500) + '...'
      });
    } catch (exportError) {
      logger.warn('Static export failed, using build output', { 
        buildId,
        error: exportError.message,
        fallbackPath: path.join(projectDir, '.next')
      });
      
      // Use .next build output if static export fails
      staticExportPath = path.join(projectDir, '.next');
    }

    // 10. Upload built files to deployment bucket
    const deploymentPath = `tenants/${buildConfig.tenantId}/deployments/${buildId}`;
    logger.info('Uploading built files to S3', { 
      buildId,
      source: staticExportPath,
      destination: deploymentPath
    });

    await uploadDirectoryToS3(staticExportPath, deploymentPath, buildId);

    // 11. Generate deployment URL
    const deploymentUrl = generateDeploymentUrl(buildConfig.tenantId, buildId);

    // 12. Cleanup temporary files
    await cleanupBuildWorkspace(buildWorkspace, buildId);

    logger.info('Build process completed successfully', { 
      buildId,
      deploymentUrl,
      artifactsPath: deploymentPath
    });

    return {
      success: true,
      artifactsPath: deploymentPath,
      deploymentUrl: deploymentUrl,
      logs: `Build completed successfully. Deployed to: ${deploymentUrl}`,
      buildStats: {
        processingTime: Date.now(),
        deploymentPath: deploymentPath,
        framework: 'nextjs'
      }
    };

  } catch (error) {
    logger.error('Build process failed', { 
      buildId,
      error: error.message,
      stack: error.stack,
      phase: error.phase || 'unknown'
    });

    // Cleanup on failure
    if (tempDir) {
      try {
        await cleanupBuildWorkspace(path.dirname(tempDir), buildId);
      } catch (cleanupError) {
        logger.warn('Cleanup failed after build error', { 
          buildId,
          cleanupError: cleanupError.message 
        });
      }
    }

    return {
      success: false,
      error: error.message,
      logs: `Build failed: ${error.message}`,
      phase: error.phase || 'unknown'
    };
  }
}

/**
 * Extract ZIP file using adm-zip library
 */
async function extractZipFile(zipFilePath, extractToDir) {
  try {
    logger.info('Starting ZIP extraction', { zipFilePath, extractToDir });
    
    // Basic file validation
    const stats = await fs.stat(zipFilePath);
    if (stats.size === 0) {
      throw new Error('ZIP file is empty (0 bytes)');
    }
    
    if (stats.size < 22) {
      throw new Error(`ZIP file too small (${stats.size} bytes) - likely corrupted`);
    }
    
    // Extract using adm-zip
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();
    
    if (zipEntries.length === 0) {
      throw new Error('ZIP file appears to be empty - no entries found');
    }
    
    logger.info('ZIP file contents', { 
      zipFilePath,
      entryCount: zipEntries.length,
      entries: zipEntries.slice(0, 10).map(entry => ({ 
        name: entry.entryName, 
        size: entry.header.size,
        isDirectory: entry.isDirectory 
      }))
    });
    
    // Extract all files
    zip.extractAllTo(extractToDir, true);
    
    // Verify extraction worked
    const extractedFiles = await fs.readdir(extractToDir);
    if (extractedFiles.length === 0) {
      throw new Error('ZIP extraction completed but no files found in output directory');
    }
    
    logger.info('ZIP extraction successful', { 
      zipFilePath,
      extractToDir,
      extractedFileCount: extractedFiles.length,
      extractedFiles: extractedFiles.slice(0, 10)
    });
    
  } catch (error) {
    logger.error('ZIP extraction failed', { 
      error: error.message, 
      zipFilePath,
      extractToDir,
      errorType: error.constructor.name
    });
    
    throw new Error(`ZIP extraction failed: ${error.message}`);
  }
}

/**
 * Find the actual project directory (handle cases where project is in subdirectory)
 */
async function findProjectDirectory(sourceDir) {
  try {
    // Check if package.json exists in root
    const rootPackageJson = path.join(sourceDir, 'package.json');
    if (await fs.access(rootPackageJson).then(() => true).catch(() => false)) {
      return sourceDir;
    }

    // Look for package.json in subdirectories
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPackageJson = path.join(sourceDir, entry.name, 'package.json');
        if (await fs.access(subDirPackageJson).then(() => true).catch(() => false)) {
          return path.join(sourceDir, entry.name);
        }
      }
    }

    const error = new Error('No package.json found in extracted files. Please ensure your ZIP contains a valid Next.js project.');
    error.phase = 'validation';
    throw error;

  } catch (error) {
    if (!error.phase) error.phase = 'validation';
    throw error;
  }
}

/**
 * Validate that the project is a valid Next.js application
 */
async function validateNextJsProject(projectDir, buildId) {
  try {
    const packageJsonPath = path.join(projectDir, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    
    logger.info('Validating Next.js project', { 
      buildId,
      projectName: packageJson.name,
      version: packageJson.version
    });

    // Check for Next.js dependency
    const hasNext = packageJson.dependencies?.next || packageJson.devDependencies?.next;
    if (!hasNext) {
      const error = new Error('This does not appear to be a Next.js project. Please upload a valid Next.js application with "next" in dependencies.');
      error.phase = 'validation';
      throw error;
    }

    // Check for required scripts
    const hasRequiredScripts = packageJson.scripts?.build;
    if (!hasRequiredScripts) {
      const error = new Error('Missing required "build" script in package.json. Please ensure your Next.js project has proper build scripts.');
      error.phase = 'validation';
      throw error;
    }

    logger.info('Next.js project validation successful', { 
      buildId,
      nextVersion: hasNext,
      scripts: Object.keys(packageJson.scripts || {})
    });

  } catch (error) {
    if (!error.phase) error.phase = 'validation';
    throw error;
  }
}

/**
 * Inject tenant-specific environment variables
 */
async function injectEnvironmentVariables(projectDir, buildId, buildConfig) {
  try {
    const envPath = path.join(projectDir, '.env.local');
    const envContent = [
      `# Auto-generated environment variables for build ${buildId}`,
      `NEXT_PUBLIC_TENANT_ID=${buildConfig.tenantId}`,
      `NEXT_PUBLIC_BUILD_ID=${buildId}`,
      `NEXT_PUBLIC_API_BASE_URL=${process.env.API_BASE_URL || 'http://localhost:8000'}`,
      `NEXT_PUBLIC_BASE_DOMAIN=${process.env.BASE_DOMAIN || 'localhost'}`,
      `NEXT_PUBLIC_DEPLOYED_AT=${new Date().toISOString()}`,
      ''
    ];

    // Add any custom environment variables from buildConfig
    if (buildConfig.environmentVariables) {
      Object.entries(buildConfig.environmentVariables).forEach(([key, value]) => {
        envContent.push(`${key}=${value}`);
      });
    }

    await fs.writeFile(envPath, envContent.join('\n'));
    
    logger.info('Environment variables injected', { 
      buildId,
      envPath,
      variableCount: envContent.length - 2 // Exclude comment and empty line
    });

  } catch (error) {
    logger.warn('Failed to inject environment variables', { 
      buildId,
      error: error.message 
    });
    // Don't fail the build for environment variable issues
  }
}

/**
 * Upload directory contents to S3 recursively
 */
async function uploadDirectoryToS3(localDir, s3Prefix, buildId) {
  try {
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    const uploadPromises = [];

    for (const entry of entries) {
      const localPath = path.join(localDir, entry.name);
      const s3Key = `${s3Prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        // Recursively upload subdirectory
        uploadPromises.push(uploadDirectoryToS3(localPath, s3Key, buildId));
      } else {
        // Upload file
        uploadPromises.push(
          storageService.uploadFile({
            key: s3Key,
            bucket: process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME,
            filePath: localPath,
            contentType: getContentType(entry.name)
          })
        );
      }
    }

    await Promise.all(uploadPromises);
    
    logger.info('Directory uploaded to S3', { 
      buildId,
      localDir,
      s3Prefix,
      fileCount: entries.length
    });

  } catch (error) {
    logger.error('Failed to upload directory to S3', { 
      buildId,
      localDir,
      s3Prefix,
      error: error.message 
    });
    error.phase = 'upload';
    throw error;
  }
}

/**
 * Get appropriate content type for file
 */
function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject'
  };

  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Generate deployment URL for the tenant
 */
function generateDeploymentUrl(tenantId, buildId) {
  const baseDomain = process.env.BASE_DOMAIN || 'localhost:8000';
  
  if (process.env.NODE_ENV === 'production') {
    // Production: Use subdomain approach
    return `https://${tenantId}.${baseDomain}`;
  } else {
    // Development: Use path-based approach
    return `http://${baseDomain}/sites/${tenantId}/${buildId}`;
  }
}

/**
 * Cleanup build workspace to free disk space
 */
async function cleanupBuildWorkspace(buildWorkspace, buildId) {
  try {
    await fs.rm(buildWorkspace, { recursive: true, force: true });
    logger.info('Build workspace cleaned up', { buildId, buildWorkspace });
  } catch (error) {
    logger.warn('Failed to cleanup build workspace', { 
      buildId,
      buildWorkspace,
      error: error.message 
    });
  }
}

module.exports = {
  buildQueue,
  processBuild,
  BuildService
};
