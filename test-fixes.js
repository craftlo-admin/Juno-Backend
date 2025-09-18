// Test the fixes without running a full build
require('dotenv').config();

// Import the fixed functions
const path = require('path');
const fs = require('fs').promises;

// Mock the logger to see what our fixes will do
const logger = {
    info: (...args) => console.log('ℹ️', ...args),
    warn: (...args) => console.log('⚠️', ...args),
    error: (...args) => console.log('❌', ...args),
    debug: (...args) => console.log('🔍', ...args)
};

// Test the fixed generateDeploymentUrl function
function generateDeploymentUrl(tenantId, buildId) {
    try {
        // Check if CloudFront is configured
        const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;
        if (cloudfrontDomain) {
            const url = `https://${cloudfrontDomain}/tenants/${tenantId}/deployments/${buildId}`;
            logger.info('Generated CloudFront URL', { url, tenantId, buildId });
            return url;
        }

        // Check for subdomain configuration
        const baseDomain = process.env.BASE_DOMAIN;
        if (baseDomain && !baseDomain.includes('localhost')) {
            const subdomain = tenantId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
            const url = `https://${subdomain}.${baseDomain.replace(/^https?:\/\//, '')}`;
            logger.info('Generated subdomain URL', { url, tenantId, buildId });
            return url;
        }

        // Fallback to localhost for development
        const devUrl = `${baseDomain || 'http://localhost:3000'}/tenant/${tenantId}/deployment/${buildId}`;
        logger.info('Generated development URL', { url: devUrl, tenantId, buildId });
        return devUrl;

    } catch (error) {
        logger.error('Failed to generate deployment URL', { error: error.message, tenantId, buildId });
        return `${process.env.BASE_DOMAIN || 'http://localhost:3000'}/tenant/${tenantId}/deployment/${buildId}`;
    }
}

// Test the configureNextJsForStaticExport function  
async function configureNextJsForStaticExport(projectDir, buildId) {
    try {
        logger.info('🔧 Configuring Next.js for static export', { buildId, projectDir });

        const nextConfigPath = path.join(projectDir, 'next.config.js');
        let nextConfigExists = false;

        // Check if next.config.js already exists
        try {
            await fs.access(nextConfigPath);
            nextConfigExists = true;
            
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
    }
}

async function testFixedFunctions() {
    console.log('🧪 Testing Fixed Functions\n');

    // Test URL generation
    console.log('1️⃣ Testing URL Generation:');
    const tenantId = 'himanshubarnwal26_gmail_com-35aebtgz';
    const buildId = '70c6f5ec-a92e-4638-87ad-349f8ffd93d3';
    
    const url = generateDeploymentUrl(tenantId, buildId);
    console.log(`Generated URL: ${url}\n`);

    // Test Next.js config creation
    console.log('2️⃣ Testing Next.js Static Export Config:');
    const testDir = './test-next-config';
    
    try {
        await fs.mkdir(testDir, { recursive: true });
        await configureNextJsForStaticExport(testDir, 'test-build-123');
        
        // Check if config was created
        const configPath = path.join(testDir, 'next.config.js');
        const configContent = await fs.readFile(configPath, 'utf8');
        console.log('📄 Created next.config.js:');
        console.log(configContent);
        
        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
        
    } catch (error) {
        console.error('❌ Error testing Next.js config:', error.message);
    }

    console.log('\n3️⃣ Environment Check:');
    console.log(`CLOUDFRONT_DOMAIN: ${process.env.CLOUDFRONT_DOMAIN}`);
    console.log(`BASE_DOMAIN: ${process.env.BASE_DOMAIN}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

    console.log('\n✅ Function tests completed!');
    console.log('\n🎯 Expected behavior:');
    console.log('- URL generation should use CloudFront domain');
    console.log('- Next.js config should enable static export');
    console.log('- Build process should generate index.html files');
}

testFixedFunctions();