const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const unzipper = require('unzipper');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const logger = require('../utils/logger');
const { getFromS3, uploadToS3, deleteFromS3 } = require('./storageService');
const { deployToCloudFront } = require('./deploymentService');
const { scanForMalware } = require('./securityService');
const { generateTenantConfig } = require('./tenantConfigService');

async function processBuilds(job) {
  const { buildId, tenantId, version, uploadPath, buildConfig } = job.data;
  
  // Create temporary working directory
  const workDir = path.join(os.tmpdir(), `build-${buildId}-${Date.now()}`);
  
  try {
    logger.info(`Starting build process for ${buildId} in ${workDir}`);
    
    // Update job progress
    job.progress(10);
    
    // Step 1: Download and extract ZIP
    await downloadAndExtract(uploadPath, workDir);
    job.progress(25);
    
    // Step 2: Security scan
    await scanForMalware(workDir);
    job.progress(35);
    
    // Step 3: Validate structure and install dependencies
    await validateAndInstall(workDir, buildConfig);
    job.progress(50);
    
    // Step 4: Generate tenant-specific configuration
    await injectTenantConfig(workDir, tenantId, version);
    job.progress(60);
    
    // Step 5: Build the site
    await buildSite(workDir, buildConfig);
    job.progress(80);
    
    // Step 6: Upload to S3 and deploy
    const buildPath = await uploadBuildArtifacts(workDir, tenantId, version);
    job.progress(90);
    
    // Step 7: Deploy to CloudFront
    await deployToCloudFront(tenantId, version, buildPath);
    job.progress(100);
    
    logger.info(`Build completed successfully: ${buildId}`);
    
    return { success: true, buildPath, version };
    
  } catch (error) {
    logger.error(`Build failed for ${buildId}:`, error);
    throw error;
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rmdir(workDir, { recursive: true });
    } catch (cleanupError) {
      logger.warn('Failed to cleanup build directory:', cleanupError);
    }
  }
}

async function downloadAndExtract(uploadPath, workDir) {
  try {
    logger.info(`Downloading and extracting: ${uploadPath}`);
    
    // Create work directory
    await fs.mkdir(workDir, { recursive: true });
    
    // Download ZIP from S3
    const zipData = await getFromS3({
      key: uploadPath,
      bucket: process.env.AWS_S3_BUCKET_UPLOADS
    });
    
    // Save ZIP temporarily
    const zipPath = path.join(workDir, 'source.zip');
    await fs.writeFile(zipPath, zipData.Body);
    
    // Extract ZIP
    const extractDir = path.join(workDir, 'source');
    await fs.mkdir(extractDir, { recursive: true });
    
    await new Promise((resolve, reject) => {
      fs.createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });
    
    // Remove ZIP file
    await fs.unlink(zipPath);
    
    logger.info('Extraction completed');
  } catch (error) {
    logger.error('Download and extract failed:', error);
    throw new Error(`Failed to download and extract: ${error.message}`);
  }
}

async function validateAndInstall(workDir, buildConfig) {
  try {
    logger.info('Validating project structure and installing dependencies');
    
    const sourceDir = path.join(workDir, 'source');
    
    // Check if package.json exists
    const packageJsonPath = path.join(sourceDir, 'package.json');
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Basic validation for Next.js project
      if (!packageJson.dependencies?.next && !packageJson.devDependencies?.next) {
        throw new Error('This does not appear to be a Next.js project');
      }
      
      // Check for prohibited server-side code
      const hasApiRoutes = await checkForApiRoutes(sourceDir);
      if (hasApiRoutes) {
        logger.warn('API routes detected - these will not work in static export');
      }
      
    } catch (error) {
      throw new Error('Invalid or missing package.json');
    }
    
    // Install dependencies
    await runCommand('npm', ['ci'], sourceDir);
    
    logger.info('Dependencies installed successfully');
  } catch (error) {
    logger.error('Validation and install failed:', error);
    throw new Error(`Validation failed: ${error.message}`);
  }
}

async function checkForApiRoutes(sourceDir) {
  try {
    const apiDir = path.join(sourceDir, 'pages', 'api');
    const appApiDir = path.join(sourceDir, 'app', 'api');
    
    const [pagesApiExists, appApiExists] = await Promise.all([
      fs.access(apiDir).then(() => true).catch(() => false),
      fs.access(appApiDir).then(() => true).catch(() => false)
    ]);
    
    return pagesApiExists || appApiExists;
  } catch (error) {
    return false;
  }
}

async function injectTenantConfig(workDir, tenantId, version) {
  try {
    logger.info('Injecting tenant-specific configuration');
    
    const sourceDir = path.join(workDir, 'source');
    
    // Generate tenant configuration
    const tenantConfig = await generateTenantConfig(tenantId, version);
    
    // Create public directory if it doesn't exist
    const publicDir = path.join(sourceDir, 'public');
    await fs.mkdir(publicDir, { recursive: true });
    
    // Write tenant config file
    const configPath = path.join(publicDir, 'tenant-config.json');
    await fs.writeFile(configPath, JSON.stringify(tenantConfig, null, 2));
    
    // Inject environment variables for build
    const envContent = [
      `NEXT_PUBLIC_TENANT_ID=${tenantId}`,
      `NEXT_PUBLIC_VERSION=${version}`,
      `NEXT_PUBLIC_API_BASE_URL=${process.env.API_BASE_URL}`,
      `NEXT_PUBLIC_BASE_DOMAIN=${process.env.BASE_DOMAIN}`
    ].join('\n');
    
    await fs.writeFile(path.join(sourceDir, '.env.local'), envContent);
    
    logger.info('Tenant configuration injected');
  } catch (error) {
    logger.error('Config injection failed:', error);
    throw new Error(`Failed to inject tenant config: ${error.message}`);
  }
}

async function buildSite(workDir, buildConfig) {
  try {
    logger.info('Building the site');
    
    const sourceDir = path.join(workDir, 'source');
    
    // Run build command
    const buildCommand = buildConfig.build_command || 'npm run build';
    const [cmd, ...args] = buildCommand.split(' ');
    
    await runCommand(cmd, args, sourceDir);
    
    // Run export for static site
    await runCommand('npx', ['next', 'export'], sourceDir);
    
    // Verify output directory exists
    const outputDir = path.join(sourceDir, buildConfig.output_directory || 'out');
    await fs.access(outputDir);
    
    logger.info('Site built successfully');
  } catch (error) {
    logger.error('Build failed:', error);
    throw new Error(`Build failed: ${error.message}`);
  }
}

async function uploadBuildArtifacts(workDir, tenantId, version) {
  try {
    logger.info('Uploading build artifacts to S3');
    
    const sourceDir = path.join(workDir, 'source');
    const outputDir = path.join(sourceDir, 'out');
    const buildPath = `tenants/${tenantId}/${version}`;
    
    // Create archive of build output
    const archivePath = path.join(workDir, 'build.tar.gz');
    await createArchive(outputDir, archivePath);
    
    // Upload archive to S3
    const archiveKey = `${buildPath}/build.tar.gz`;
    await uploadToS3({
      key: archiveKey,
      body: await fs.readFile(archivePath),
      contentType: 'application/gzip',
      bucket: process.env.AWS_S3_BUCKET_STATIC
    });
    
    // Upload individual files for CloudFront serving
    await uploadDirectoryToS3(outputDir, buildPath);
    
    logger.info('Build artifacts uploaded successfully');
    return buildPath;
  } catch (error) {
    logger.error('Artifact upload failed:', error);
    throw new Error(`Failed to upload artifacts: ${error.message}`);
  }
}

async function createArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('tar', { gzip: true });
    
    output.on('close', resolve);
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function uploadDirectoryToS3(localDir, s3Prefix) {
  const files = await getFilesRecursively(localDir);
  
  for (const file of files) {
    const relativePath = path.relative(localDir, file);
    const s3Key = `${s3Prefix}/${relativePath.replace(/\\/g, '/')}`; // Handle Windows paths
    
    const fileContent = await fs.readFile(file);
    const contentType = getContentType(file);
    
    await uploadToS3({
      key: s3Key,
      body: fileContent,
      contentType,
      bucket: process.env.AWS_S3_BUCKET_STATIC
    });
  }
}

async function getFilesRecursively(dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...await getFilesRecursively(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  
  return files;
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
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

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { 
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true 
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
    
    process.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  processBuilds
};
