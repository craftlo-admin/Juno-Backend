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
const deploymentService = require('./deploymentService');
const TenantDistributionService = require('./tenantDistributionService');

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
  let buildId, tenantId, userId, storageKey, buildConfig;
  
  try {
    // Validate job data exists
    if (!job || !job.data) {
      throw new Error('Invalid job: missing job data');
    }

    // Log job data for debugging
    logger.debug('Job data received:', { 
      jobData: job.data,
      hasJobData: !!job.data,
      jobKeys: job.data ? Object.keys(job.data) : 'none'
    });

    // Extract job data with validation
    ({ buildId, tenantId, userId, storageKey, buildConfig } = job.data);
    
    // Validate each required field individually
    if (!buildId) {
      throw new Error('Missing required field: buildId');
    }
    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }
    if (!userId) {
      throw new Error('Missing required field: userId');
    }
    if (!storageKey) {
      throw new Error('Missing required field: storageKey');
    }

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
      tenantId,
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
          buildId: buildId,
          version: `deploy-${Date.now()}`,
          status: 'pending',
          deployer: `user-${userId}`, // Store user info in deployer field
          notes: `Automated deployment for build ${buildId}`
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

      // 🌐 Log the live website URL
      if (buildResult.deploymentUrl) {
        logger.info('🌐 WEBSITE DEPLOYED SUCCESSFULLY!');
        logger.info(`🔗 Live URL: ${buildResult.deploymentUrl}`);
        logger.info(`📄 Index Page: ${buildResult.deploymentUrl.replace(/\/$/, '')}/index.html`);
      }

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

    // Update build status to failed (if we have a buildId)
    if (buildId) {
      try {
        await prisma.build.update({
          where: { id: buildId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorMessage: error.message
          }
        });
      } catch (buildUpdateError) {
        logger.error('Failed to update build status to failed', { 
          buildId, 
          error: buildUpdateError.message 
        });
      }
    }

    // Update deployment status to failed (if we have both buildId and tenantId)
    if (buildId && tenantId) {
      try {
        await prisma.deployment.updateMany({
          where: {
            buildId: buildId,
            tenantId: tenantId,
            status: 'pending'
          },
          data: {
            status: 'failed',
            notes: `Deployment failed: ${error.message}`
          }
        });
      } catch (deploymentUpdateError) {
        logger.warn('Failed to update deployment status to failed', { 
          buildId, 
          error: deploymentUpdateError.message 
        });
      }
    }

    // Emit failure via WebSocket (if we have tenantId)
    if (tenantId) {
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

    // Re-throw the error for the queue to handle
    throw error;
  }
});

/**
 * Process build in sandboxed environment with complete ZIP processing
 * Downloads ZIP from S3, extracts, validates Next.js project, builds and deploys
 */
async function processBuild({ buildId, tenantId, storageKey, buildConfig }) {
  let tempDir = null;
  let sourceDir = null;
  let outputDir = null;
  
  try {
    // Validate required parameters
    if (!buildId) {
      throw new Error('buildId is required for processBuild');
    }
    if (!tenantId) {
      throw new Error('tenantId is required for processBuild');
    }
    if (!storageKey) {
      throw new Error('storageKey is required for processBuild');
    }

    logger.info('Starting complete build process', { 
      buildId, 
      tenantId,
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

    // 6. Force install Tailwind dependencies (no detection, always install)
    const depCheck = await forceInstallTailwindDependencies(projectDir, buildId);
    
    logger.info('📦 Tailwind dependencies force-installed', { 
      buildId,
      addedDependencies: depCheck.addedDeps.map(d => `${d.name}@${d.version}`),
      willInstallDevDependencies: true
    });

    // 7. Install dependencies (always use full install with Tailwind dependencies)
    logger.info('Installing project dependencies with Tailwind support', { buildId, cwd: projectDir });
    
    logger.info('📦 Installing with dev dependencies (Tailwind force-installed)', { 
      buildId,
      addedDependencies: depCheck.addedDeps.map(d => `${d.name}@${d.version}`)
    });
    
    // First, clean npm cache to avoid any cache issues
    try {
      await execAsync('npm cache clean --force', { 
        cwd: projectDir,
        timeout: 120000,
        env: { ...process.env, NODE_ENV: 'development' } // Explicitly set to development
      });
      logger.info('✅ npm cache cleaned', { buildId });
    } catch (error) {
      logger.warn('⚠️ npm cache clean failed (continuing)', { buildId, error: error.message });
    }
    
    // Install dependencies with explicit flags to include devDependencies
    const installResult = await execAsync('npm install --include=dev --legacy-peer-deps', { 
      cwd: projectDir,
      timeout: 600000, // 10 minutes timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      env: { 
        ...process.env, 
        NODE_ENV: 'development', // Explicitly set to development to ensure devDeps are installed
        npm_config_production: 'false' // Explicitly disable production mode
      }
    });
    
    logger.info('Dependencies installed successfully (full install with Tailwind support)', { 
      buildId,
      stdout: installResult.stdout?.substring(0, 500) + '...'
    });

    // 7a. Verify Tailwind dependencies are actually installed
    await verifyTailwindInstallation(projectDir, buildId);

    // 8. Inject tenant-specific environment variables
    await injectEnvironmentVariables(projectDir, buildId, buildConfig, tenantId);

    // 8a. Configure Next.js for static export
    await configureNextJsForStaticExport(projectDir, buildId);

    // 9. Build Next.js application
    logger.info('Building Next.js application', { buildId, cwd: projectDir });
    const buildResult = await execAsync('npm run build', { 
      cwd: projectDir,
      timeout: 900000, // 15 minutes timeout
      maxBuffer: 1024 * 1024 * 20, // 20MB buffer
      env: { ...process.env, NODE_ENV: 'production' } // Now switch back to production for build
    });

    logger.info('Next.js build completed', { 
      buildId,
      stdout: buildResult.stdout?.substring(0, 500) + '...'
    });

    // 10. Export static files (Next.js static export)
    let staticExportPath = projectDir;
    try {
      logger.info('📤 Attempting Next.js static export', { buildId, cwd: projectDir });
      
      // With output: 'export' in next.config.js, the build command should generate static files
      // But let's also try explicit export command as backup
      const exportResult = await execAsync('npm run build && npx next export', { 
        cwd: projectDir,
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      staticExportPath = path.join(projectDir, 'out');
      logger.info('✅ Static export successful', { 
        buildId,
        staticExportPath,
        stdout: exportResult.stdout?.substring(0, 500) + '...'
      });
    } catch (exportError) {
      logger.warn('⚠️ Static export failed, checking for existing out directory', { 
        buildId,
        error: exportError.message
      });
      
      // Check if 'out' directory exists from the build with output: 'export'
      const outPath = path.join(projectDir, 'out');
      try {
        await fs.access(outPath);
        staticExportPath = outPath;
        logger.info('✅ Found out directory from build', { buildId, staticExportPath });
      } catch (outError) {
        logger.warn('❌ No out directory found, using .next build output', { 
          buildId,
          error: outError.message,
          fallbackPath: path.join(projectDir, '.next')
        });
        
        // Use .next build output if static export fails
        staticExportPath = path.join(projectDir, '.next');
      }
    }

    // Validate that the static export path exists and contains files
    staticExportPath = await validateStaticExportPath(staticExportPath, buildId);

    // 11. Upload built files to deployment bucket
    const deploymentPath = `tenants/${tenantId}/deployments/${buildId}`;
    logger.info('Uploading built files to S3', { 
      buildId,
      tenantId,
      source: staticExportPath,
      destination: deploymentPath
    });

    await uploadDirectoryToS3(staticExportPath, deploymentPath, buildId);

    // 12. Setup CloudFront distribution and deployment
    let cloudfrontInvalidationId = null;
    let distributionInfo = null;
    try {
      logger.info('Setting up CloudFront distribution for tenant', { buildId, tenantId });
      
      // Get or create tenant-specific CloudFront distribution
      distributionInfo = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
      
      logger.info('CloudFront distribution ready for tenant', {
        buildId,
        tenantId,
        distributionId: distributionInfo.distributionId,
        domain: distributionInfo.domain
      });
      
      // Update version pointer for the deployment
      await deploymentService.updateVersionPointer(tenantId, buildId);
      
      // Invalidate CloudFront cache to ensure immediate deployment
      cloudfrontInvalidationId = await TenantDistributionService.invalidateTenantCache(tenantId, buildId);
      
      logger.info('CloudFront deployment completed', { 
        buildId,
        tenantId,
        distributionId: distributionInfo.distributionId,
        invalidationId: cloudfrontInvalidationId 
      });
    } catch (cloudFrontError) {
      // Don't fail the build for CloudFront issues, but log the error
      logger.warn('CloudFront distribution setup failed (build will continue)', { 
        buildId,
        tenantId,
        error: cloudFrontError.message 
      });
    }

    // 13. Generate deployment URL with correct file path detection
    const deploymentUrl = await generateDeploymentUrl(tenantId, buildId, staticExportPath);

    // 14. Update deployment status to active
    try {
      const updateData = {
        status: 'active',
        notes: `Deployment completed successfully. URL: ${deploymentUrl}`
      };
      
      // Add CloudFront invalidation ID if available
      if (cloudfrontInvalidationId) {
        updateData.cloudfrontInvalidationId = cloudfrontInvalidationId;
      }
      
      await prisma.deployment.updateMany({
        where: {
          buildId: buildId,
          tenantId: tenantId
        },
        data: updateData
      });
      
      logger.info('Deployment status updated to active', { 
        buildId, 
        deploymentUrl,
        cloudfrontInvalidationId 
      });
    } catch (deploymentUpdateError) {
      logger.warn('Failed to update deployment status', { 
        buildId, 
        error: deploymentUpdateError.message 
      });
    }

    // 15. Cleanup temporary files
    await cleanupBuildWorkspace(buildWorkspace, buildId);

    logger.info('Build process completed successfully', { 
      buildId,
      deploymentUrl,
      artifactsPath: deploymentPath
    });

    // 🎉 Log the deployment URL prominently
    logger.info('🎉 DEPLOYMENT SUCCESSFUL! 🎉');
    logger.info('🌐 Your website is now live at:');
    logger.info(`🔗 ${deploymentUrl}`);
    logger.info('📄 Direct link to index page:');
    logger.info(`🏠 ${deploymentUrl.replace(/\/$/, '')}/index.html`);
    logger.info('✨ CloudFront distribution ready with tenant-specific domain!');

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
    
    logger.info('ZIP file contents analysis', { 
      zipFilePath,
      totalEntries: zipEntries.length,
      fileSize: `${(stats.size / 1024 / 1024).toFixed(2)} MB`
    });
    
    // Log all ZIP entries for debugging
    logger.info('📦 Complete ZIP contents:');
    zipEntries.forEach((entry, index) => {
      const size = entry.header.size || 0;
      const compressed = entry.header.compressedSize || 0;
      logger.info(`   ${index + 1}. ${entry.entryName}`, {
        isDirectory: entry.isDirectory,
        originalSize: size,
        compressedSize: compressed,
        compressionRatio: size > 0 ? `${((1 - compressed / size) * 100).toFixed(1)}%` : '0%'
      });
    });
    
    // Extract all files
    logger.info('🔄 Extracting ZIP contents to:', { extractToDir });
    zip.extractAllTo(extractToDir, true);
    
    // Verify extraction worked
    const extractedFiles = await fs.readdir(extractToDir);
    if (extractedFiles.length === 0) {
      throw new Error('ZIP extraction completed but no files found in output directory');
    }
    
    logger.info('✅ ZIP extraction completed successfully', { 
      extractedFileCount: extractedFiles.length,
      extractedFiles: extractedFiles.slice(0, 10) // Show first 10 files
    });
    
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
    logger.info('🔍 Searching for package.json in extracted files', { sourceDir });
    
    // Function to recursively list all files and directories
    async function listAllFiles(dir, prefix = '') {
      const files = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = prefix + entry.name;
          
          if (entry.isDirectory()) {
            files.push(`📁 ${relativePath}/`);
            // Recursively list subdirectory contents (limit depth to avoid spam)
            if (prefix.split('/').length < 3) {
              const subFiles = await listAllFiles(fullPath, relativePath + '/');
              files.push(...subFiles);
            }
          } else {
            files.push(`📄 ${relativePath} (${entry.isFile() ? 'file' : 'unknown'})`);
          }
        }
      } catch (error) {
        files.push(`❌ Error reading directory ${dir}: ${error.message}`);
      }
      return files;
    }

    // Log all extracted files
    logger.info('📋 Listing all extracted files and directories:');
    const allFiles = await listAllFiles(sourceDir);
    allFiles.forEach((file, index) => {
      logger.info(`   ${index + 1}. ${file}`);
    });
    
    // Check if package.json exists in root
    logger.info('🔍 Checking for package.json in root directory', { rootDir: sourceDir });
    const rootPackageJson = path.join(sourceDir, 'package.json');
    
    try {
      await fs.access(rootPackageJson);
      logger.info('✅ Found package.json in root directory', { packageJsonPath: rootPackageJson });
      return sourceDir;
    } catch (error) {
      logger.info('❌ No package.json found in root directory', { 
        rootDir: sourceDir,
        error: error.message 
      });
    }

    // Look for package.json in subdirectories (recursive search)
    logger.info('🔍 Searching for package.json in subdirectories...');
    
    async function searchForPackageJson(searchDir, depth = 0) {
      if (depth > 3) {
        logger.warn(`⚠️ Skipping deeper search (depth ${depth}) in ${searchDir}`);
        return null;
      }
      
      try {
        const entries = await fs.readdir(searchDir, { withFileTypes: true });
        
        // First, check for package.json in current directory
        for (const entry of entries) {
          if (entry.name === 'package.json' && entry.isFile()) {
            const packageJsonPath = path.join(searchDir, entry.name);
            
            // Verify the package.json is readable and valid
            try {
              const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
              const packageData = JSON.parse(packageJsonContent);
              
              logger.info('✅ Found and validated package.json!', { 
                directory: path.relative(sourceDir, searchDir) || 'root',
                fullPath: packageJsonPath,
                projectName: packageData.name || 'Unknown',
                hasNextJs: !!(packageData.dependencies?.next || packageData.devDependencies?.next),
                hasReact: !!(packageData.dependencies?.react || packageData.devDependencies?.react)
              });
              
              return searchDir;
            } catch (parseError) {
              logger.warn('⚠️ Found package.json but cannot parse it:', { 
                packageJsonPath,
                error: parseError.message 
              });
              // Continue searching instead of failing
            }
          }
        }
        
        // Then search in subdirectories
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDir = path.join(searchDir, entry.name);
            const relativePath = path.relative(sourceDir, subDir);
            
            logger.info(`🔍 Checking ${depth === 0 ? 'subdirectory' : 'nested directory'}: ${entry.name}`, { 
              fullPath: subDir,
              relativePath: relativePath,
              depth: depth
            });
            
            const result = await searchForPackageJson(subDir, depth + 1);
            if (result) {
              return result;
            }
          }
        }
        
        return null;
      } catch (error) {
        logger.warn(`❌ Error searching directory ${searchDir}:`, { error: error.message });
        return null;
      }
    }
    
    const foundProjectDir = await searchForPackageJson(sourceDir);
    
    if (foundProjectDir) {
      logger.info('🎯 Project directory found!', { 
        projectDir: foundProjectDir,
        relativePath: path.relative(sourceDir, foundProjectDir) || 'root'
      });
      return foundProjectDir;
    }

    // Enhanced error with detailed file listing
    logger.error('❌ No package.json found anywhere in extracted ZIP', {
      sourceDir,
      extractedFiles: allFiles.slice(0, 20), // Show first 20 files
      totalFiles: allFiles.length
    });

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
 * Configure Next.js for static export
 */
async function configureNextJsForStaticExport(projectDir, buildId) {
  try {
    logger.info('🔧 Configuring Next.js for static export', { buildId, projectDir });

    const nextConfigPath = path.join(projectDir, 'next.config.js');
    let nextConfigExists = false;
    let existingConfig = {};

    // Check if next.config.js already exists
    try {
      await fs.access(nextConfigPath);
      nextConfigExists = true;
      
      // Try to read existing config (basic parsing)
      const configContent = await fs.readFile(nextConfigPath, 'utf8');
      logger.info('📄 Existing next.config.js found', { buildId, configContent: configContent.substring(0, 200) + '...' });
      
      // Simple check if static export is already configured
      if (configContent.includes("output: 'export'") || configContent.includes('output:"export"')) {
        logger.info('✅ Static export already configured in next.config.js', { buildId });
        return;
      }
    } catch (error) {
      logger.info('📄 No existing next.config.js found, creating new one', { buildId });
    }

    // Create or update next.config.js for static export
    const nextConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  // Disable server-side features for static export
  experimental: {
    esmExternals: false
  }
}

module.exports = nextConfig`;

    await fs.writeFile(nextConfigPath, nextConfig);
    
    logger.info('✅ Next.js configured for static export', { 
      buildId,
      configPath: nextConfigPath,
      wasExisting: nextConfigExists
    });

  } catch (error) {
    logger.warn('⚠️ Failed to configure Next.js for static export', { 
      buildId,
      error: error.message 
    });
    // Don't fail the build for config issues, but log the error
  }
}

/**
 * Inject tenant-specific environment variables
 */
async function injectEnvironmentVariables(projectDir, buildId, buildConfig, tenantId) {
  try {
    if (!tenantId) {
      throw new Error('tenantId parameter is undefined in injectEnvironmentVariables');
    }

    const envPath = path.join(projectDir, '.env.local');
    const envContent = [
      `# Auto-generated environment variables for build ${buildId}`,
      `NEXT_PUBLIC_TENANT_ID=${tenantId}`,
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
 * Upload directory contents to S3 recursively with enhanced error handling
 */
async function uploadDirectoryToS3(localDir, s3Prefix, buildId, isRootCall = true) {
  try {
    if (isRootCall) {
      logger.info('📤 Starting S3 upload process', { buildId, localDir, s3Prefix });
    }

    const entries = await fs.readdir(localDir, { withFileTypes: true });
    const uploadPromises = [];
    let totalFiles = 0;
    let totalDirs = 0;

    for (const entry of entries) {
      const localPath = path.join(localDir, entry.name);
      const s3Key = `${s3Prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        totalDirs++;
        // Recursively upload subdirectory (mark as non-root call)
        uploadPromises.push(uploadDirectoryToS3(localPath, s3Key, buildId, false));
      } else {
        totalFiles++;
        // Upload file with enhanced error handling
        uploadPromises.push(
          uploadFileWithRetry({
            key: s3Key,
            bucket: process.env.AWS_S3_BUCKET_STATIC || process.env.AWS_S3_BUCKET_NAME,
            filePath: localPath,
            contentType: getContentType(entry.name)
          }, buildId, 3) // 3 retry attempts
        );
      }
    }

    if (isRootCall && uploadPromises.length > 0) {
      logger.info('📊 Upload batch prepared', { 
        buildId,
        totalFiles,
        totalDirs,
        totalPromises: uploadPromises.length
      });
    }

    // Process uploads with error collection and progress tracking
    const results = await Promise.allSettled(uploadPromises);
    
    // Analyze results
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    
    if (failed.length > 0) {
      logger.error('❌ Some uploads failed', {
        buildId,
        successful,
        failed: failed.length,
        failureReasons: failed.slice(0, 3).map(f => f.reason?.message || 'Unknown error') // Limit to first 3 errors
      });
      
      // If more than 20% of uploads failed, throw an error
      if (failed.length / results.length > 0.2) {
        throw new Error(`Upload failure rate too high: ${failed.length}/${results.length} failed`);
      }
    }
    
    // Only log completion for root-level call
    if (isRootCall) {
      logger.info('✅ Directory upload completed', { 
        buildId,
        localDir,
        s3Prefix,
        totalUploaded: successful,
        failedUploads: failed.length,
        directories: totalDirs,
        files: totalFiles,
        successRate: `${Math.round((successful / (successful + failed.length)) * 100)}%`
      });
    }

  } catch (error) {
    logger.error('❌ Failed to upload directory to S3', { 
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
 * Upload single file with retry logic
 */
async function uploadFileWithRetry(uploadParams, buildId, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await storageService.uploadFile(uploadParams);
      
      if (attempt > 1) {
        logger.info(`✅ File upload succeeded on attempt ${attempt}`, {
          buildId,
          key: uploadParams.key,
          attempt
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`⚠️ File upload attempt ${attempt} failed, retrying in ${delay}ms`, {
          buildId,
          key: uploadParams.key,
          attempt,
          error: error.message,
          nextDelay: delay
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error(`❌ File upload failed after ${maxRetries} attempts`, {
    buildId,
    key: uploadParams.key,
    error: lastError.message
  });
  
  throw lastError;
}

/**
 * Get appropriate content type for file (uses storageService helper)
 */
function getContentType(filename) {
  return storageService.getContentTypeFromExtension(path.extname(filename).toLowerCase());
}

/**
 * Generate deployment URL for the tenant using individual CloudFront distribution
 */
async function generateDeploymentUrl(tenantId, buildId, staticExportPath = null) {
  try {
    logger.info('Generating deployment URL for tenant', { tenantId, buildId });
    
    // Get or create CloudFront distribution for this tenant
    const distribution = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
    
    if (distribution && distribution.domain) {
      // Use tenant-specific CloudFront distribution
      const baseUrl = `https://${distribution.domain}`;
      let deploymentPath = `/deployments/${buildId}`;
      
      // Try to find index.html in the exported files for better UX
      if (staticExportPath) {
        try {
          const indexHtmlPath = await findIndexHtmlPath(staticExportPath);
          if (indexHtmlPath) {
            const relativePath = path.relative(staticExportPath, indexHtmlPath);
            const urlPath = '/' + relativePath.replace(/\\/g, '/');
            deploymentPath += urlPath;
          }
        } catch (error) {
          logger.warn('Could not find index.html path, using base deployment path', { 
            buildId, 
            error: error.message 
          });
        }
      }
      
      const fullUrl = baseUrl + deploymentPath;
      
      logger.info('Generated tenant-specific CloudFront URL', { 
        tenantId,
        buildId,
        distributionId: distribution.distributionId,
        distributionDomain: distribution.domain,
        deploymentUrl: fullUrl
      });
      
      return fullUrl;
    }
    
    // Fallback to development/testing URL if CloudFront distribution creation failed
    logger.warn('CloudFront distribution not available, using fallback URL', { tenantId, buildId });
    
    const bucketUrl = `https://${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`;
    const fallbackUrl = `${bucketUrl}/tenants/${tenantId}/deployments/${buildId}/index.html`;
    
    return fallbackUrl;
    
  } catch (error) {
    logger.error('Failed to generate deployment URL', { 
      error: error.message, 
      tenantId, 
      buildId 
    });
    
    // Emergency fallback to S3 direct URL
    const bucketUrl = `https://${process.env.AWS_S3_BUCKET_STATIC}.s3.amazonaws.com`;
    return `${bucketUrl}/tenants/${tenantId}/deployments/${buildId}/index.html`;
  }
}

/**
 * Find the path to index.html in the static export directory
 */
async function findIndexHtmlPath(staticExportPath) {
  try {
    // First, try root level
    const rootIndexPath = path.join(staticExportPath, 'index.html');
    try {
      await fs.access(rootIndexPath);
      return rootIndexPath;
    } catch (error) {
      // Not at root level, search subdirectories
    }
    
    // Search for index.html in subdirectories
    const searchPaths = [
      path.join(staticExportPath, 'server', 'app', 'index.html'),
      path.join(staticExportPath, 'app', 'index.html'),
      path.join(staticExportPath, 'build', 'index.html'),
      path.join(staticExportPath, 'dist', 'index.html')
    ];
    
    for (const searchPath of searchPaths) {
      try {
        await fs.access(searchPath);
        logger.info('Found index.html', { path: searchPath });
        return searchPath;
      } catch (error) {
        // Continue searching
      }
    }
    
    // If not found in common locations, do a recursive search
    return await recursivelyFindIndexHtml(staticExportPath);
    
  } catch (error) {
    logger.warn('Could not find index.html', { 
      staticExportPath, 
      error: error.message 
    });
    return null;
  }
}

/**
 * Recursively search for index.html in the export directory
 */
async function recursivelyFindIndexHtml(dir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) {
    return null;
  }
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    // First check for index.html in current directory
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'index.html') {
        return path.join(dir, entry.name);
      }
    }
    
    // Then search subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDirPath = path.join(dir, entry.name);
        const result = await recursivelyFindIndexHtml(subDirPath, maxDepth, currentDepth + 1);
        if (result) {
          return result;
        }
      }
    }
    
  } catch (error) {
    // Ignore directory access errors
  }
  
  return null;
}

/**
 * Validate that the static export path exists and contains deployable files
 */
async function validateStaticExportPath(staticExportPath, buildId) {
  try {
    logger.info('🔍 Validating static export path', { buildId, staticExportPath });

    // Check if directory exists
    try {
      await fs.access(staticExportPath);
    } catch (error) {
      const fallbackPath = path.join(path.dirname(staticExportPath), '.next');
      logger.warn(`❌ Static export path not found: ${staticExportPath}, trying fallback: ${fallbackPath}`, { buildId });
      
      try {
        await fs.access(fallbackPath);
        logger.info('✅ Fallback path exists, updating staticExportPath', { buildId, fallbackPath });
        return fallbackPath;
      } catch (fallbackError) {
        throw new Error(`Neither static export path (${staticExportPath}) nor fallback path (${fallbackPath}) exists`);
      }
    }

    // Check if directory contains files
    const entries = await fs.readdir(staticExportPath);
    if (entries.length === 0) {
      throw new Error(`Static export directory is empty: ${staticExportPath}`);
    }

    // Log directory contents for debugging
    logger.info('📁 Static export directory contents', { 
      buildId,
      staticExportPath,
      fileCount: entries.length,
      files: entries.slice(0, 10) // Show first 10 files
    });

    // Check for essential files (at least index.html or _next folder)
    const hasIndexHtml = entries.includes('index.html');
    const hasNextFolder = entries.includes('_next');
    const hasStaticFolder = entries.includes('static');

    if (!hasIndexHtml && !hasNextFolder && !hasStaticFolder) {
      logger.warn('⚠️ Static export directory may not contain valid Next.js build output', {
        buildId,
        hasIndexHtml,
        hasNextFolder,
        hasStaticFolder,
        entries: entries.slice(0, 20)
      });
    }

    logger.info('✅ Static export path validation successful', { 
      buildId,
      staticExportPath,
      fileCount: entries.length,
      hasIndexHtml,
      hasNextFolder
    });

    return staticExportPath;

  } catch (error) {
    logger.error('❌ Static export path validation failed', { 
      buildId,
      staticExportPath,
      error: error.message 
    });
    error.phase = 'validation';
    throw error;
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

/**
 * Force install Tailwind dependencies - no detection, always add them
 * Ensures Tailwind CSS is always available for builds
 */
async function forceInstallTailwindDependencies(projectDir, buildId) {
  try {
    logger.info('� Force-installing Tailwind dependencies', { buildId, projectDir });

    const packageJsonPath = path.join(projectDir, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    
    const tailwindDeps = {
      'tailwindcss': '^3.4.17',
      'autoprefixer': '^10.4.21',
      'postcss': '^8.5.6'
    };

    const addedDeps = [];

    // Always ensure Tailwind dependencies are in devDependencies with correct versions
    if (!packageJson.devDependencies) packageJson.devDependencies = {};
    
    for (const [dep, version] of Object.entries(tailwindDeps)) {
      // Update version regardless of whether it exists
      packageJson.devDependencies[dep] = version;
      addedDeps.push({ name: dep, version });
      logger.info(`📦 Force-added/updated dependency: ${dep}@${version}`, { buildId });
    }

    // Also ensure they're NOT in regular dependencies to avoid conflicts
    if (packageJson.dependencies) {
      for (const dep of Object.keys(tailwindDeps)) {
        if (packageJson.dependencies[dep]) {
          logger.info(`📦 Moving ${dep} from dependencies to devDependencies`, { buildId });
          delete packageJson.dependencies[dep];
        }
      }
    }

    // Always update package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
    
    logger.info('✅ Tailwind dependencies force-installed to package.json', { 
      buildId,
      addedDependencies: addedDeps.map(d => `${d.name}@${d.version}`)
    });

    return { addedDeps };

  } catch (error) {
    logger.warn('⚠️ Failed to force-install Tailwind dependencies', { 
      buildId,
      error: error.message 
    });
    // Return empty array if failed
    return { addedDeps: [] };
  }
}

/**
 * Verify that Tailwind dependencies are actually installed in node_modules
 */
async function verifyTailwindInstallation(projectDir, buildId) {
  try {
    logger.info('🔍 Verifying Tailwind installation in node_modules', { buildId });

    const tailwindDeps = ['tailwindcss', 'autoprefixer', 'postcss'];
    const nodeModulesPath = path.join(projectDir, 'node_modules');
    
    // Check if node_modules exists
    try {
      await fs.access(nodeModulesPath);
      logger.info('✅ node_modules directory exists', { buildId, nodeModulesPath });
    } catch (error) {
      logger.error('❌ node_modules directory not found', { buildId, nodeModulesPath });
      throw new Error('node_modules directory not found after installation');
    }

    // Check each Tailwind dependency
    for (const dep of tailwindDeps) {
      const depPath = path.join(nodeModulesPath, dep);
      try {
        await fs.access(depPath);
        const packageJsonPath = path.join(depPath, 'package.json');
        const depPackageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
        
        logger.info(`✅ ${dep} installed successfully`, { 
          buildId,
          version: depPackageJson.version,
          path: depPath
        });
      } catch (error) {
        logger.error(`❌ ${dep} not found in node_modules`, { 
          buildId,
          expectedPath: depPath,
          error: error.message
        });
        
        // Try to reinstall the specific missing package
        logger.info(`🔄 Attempting to reinstall ${dep}`, { buildId });
        await execAsync(`npm install ${dep} --legacy-peer-deps --include=dev`, { 
          cwd: projectDir,
          timeout: 300000,
          maxBuffer: 1024 * 1024 * 5,
          env: { 
            ...process.env, 
            NODE_ENV: 'development',
            npm_config_production: 'false'
          }
        });
        
        // Verify the reinstall worked
        try {
          await fs.access(depPath);
          logger.info(`✅ ${dep} reinstalled successfully`, { buildId });
        } catch (verifyError) {
          logger.error(`❌ ${dep} reinstall failed - still not found`, { 
            buildId,
            error: verifyError.message
          });
        }
      }
    }

    // List some contents of node_modules for debugging
    try {
      const nodeModulesContents = await fs.readdir(nodeModulesPath);
      logger.info('📦 node_modules contents (first 20 packages)', { 
        buildId,
        totalPackages: nodeModulesContents.length,
        packages: nodeModulesContents.slice(0, 20)
      });
    } catch (error) {
      logger.warn('⚠️ Could not list node_modules contents', { buildId, error: error.message });
    }

    logger.info('✅ Tailwind installation verification completed', { buildId });

  } catch (error) {
    logger.error('❌ Tailwind installation verification failed', { 
      buildId,
      error: error.message 
    });
    // Don't fail the build, just warn
  }
}

/**
 * Detect if project uses Tailwind CSS by scanning existing files
 */
async function detectTailwindUsage(projectDir, buildId) {
  try {
    // Check CSS files for Tailwind directives
    const cssFiles = [
      'app/globals.css',
      'styles/globals.css', 
      'src/styles/globals.css',
      'globals.css'
    ];
    
    for (const cssFile of cssFiles) {
      const cssPath = path.join(projectDir, cssFile);
      try {
        const cssContent = await fs.readFile(cssPath, 'utf8');
        
        // Look for Tailwind directives
        const hasTailwindDirectives = cssContent.includes('@tailwind base') || 
                                     cssContent.includes('@tailwind components') || 
                                     cssContent.includes('@tailwind utilities') ||
                                     cssContent.includes('tailwindcss');
        
        if (hasTailwindDirectives) {
          logger.info('🎨 Tailwind directives found in CSS file', { 
            buildId,
            cssFile,
            filePath: cssPath
          });
          return true;
        }
      } catch (error) {
        // File doesn't exist, continue checking
      }
    }

    // Check for existing tailwind.config.js
    const tailwindConfigPath = path.join(projectDir, 'tailwind.config.js');
    try {
      await fs.access(tailwindConfigPath);
      logger.info('🎨 Existing tailwind.config.js found', { buildId, configPath: tailwindConfigPath });
      return true;
    } catch (error) {
      // No tailwind config found
    }

    return false;
  } catch (error) {
    logger.warn('⚠️ Error detecting Tailwind usage', { buildId, error: error.message });
    return false;
  }
}

module.exports = {
  buildQueue,
  processBuild,
  BuildService
};
