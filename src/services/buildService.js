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
    await injectEnvironmentVariables(projectDir, buildId, buildConfig);

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

    // 10. Export static files (if Next.js supports static export)
    let staticExportPath = projectDir;
    try {
      logger.info('Attempting static export', { buildId, cwd: projectDir });
      const exportResult = await execAsync('npx next export', { 
        cwd: projectDir,
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 1024 * 1024 * 10,
        env: { ...process.env, NODE_ENV: 'production' }
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

    // 11. Upload built files to deployment bucket
    const deploymentPath = `tenants/${buildConfig.tenantId}/deployments/${buildId}`;
    logger.info('Uploading built files to S3', { 
      buildId,
      source: staticExportPath,
      destination: deploymentPath
    });

    await uploadDirectoryToS3(staticExportPath, deploymentPath, buildId);

    // 12. Generate deployment URL
    const deploymentUrl = generateDeploymentUrl(buildConfig.tenantId, buildId);

    // 13. Cleanup temporary files
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
