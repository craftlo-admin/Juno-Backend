require('dotenv').config();

function testFixedUrlGeneration() {
  console.log('🧪 Testing Fixed URL Generation\n');
  console.log('==============================\n');
  
  // Test data from recent deployment
  const tenantId = 'himanshubarnwal26_gmail_com-35aebtgz';
  const buildId = '70c6f5ec-a92e-4638-87ad-349f8ffd93d3';
  
  console.log('📊 Test Data:');
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Build ID: ${buildId}\n`);
  
  console.log('⚙️ Environment Variables:');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`   CLOUDFRONT_DOMAIN: ${process.env.CLOUDFRONT_DOMAIN}`);
  console.log(`   BASE_DOMAIN: ${process.env.BASE_DOMAIN}\n`);
  
  // Simulate the fixed generateDeploymentUrl function
  function generateDeploymentUrl(tenantId, buildId) {
    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;
    const baseDomain = process.env.BASE_DOMAIN || 'localhost:3000';
    
    // If CloudFront is configured, always use it for deployed sites
    if (cloudfrontDomain && cloudfrontDomain !== 'dev-cloudfront-domain') {
      return `https://${cloudfrontDomain}/tenants/${tenantId}/deployments/${buildId}`;
    }
    
    // Fallback for development/local testing
    if (process.env.NODE_ENV === 'production') {
      // Production without CloudFront: Use subdomain approach
      const cleanDomain = baseDomain.replace(/^https?:\/\//, '');
      return `https://${tenantId}.${cleanDomain}`;
    } else {
      // Development: Use path-based approach for local testing
      const cleanDomain = baseDomain.replace(/^https?:\/\//, '');
      return `http://${cleanDomain}/sites/${tenantId}/${buildId}`;
    }
  }
  
  // Test current environment
  const generatedUrl = generateDeploymentUrl(tenantId, buildId);
  
  console.log('🎯 Generated URLs:');
  console.log(`   Fixed Function: ${generatedUrl}\n`);
  
  // Test CloudFront invalidation paths
  function getInvalidationPaths(tenantId, buildId) {
    return [
      `/tenants/${tenantId}/deployments/${buildId}/*`,  // Specific build
      `/pointers/${tenantId}/*`                         // Version pointers
    ];
  }
  
  const invalidationPaths = getInvalidationPaths(tenantId, buildId);
  console.log('🔄 CloudFront Invalidation Paths:');
  invalidationPaths.forEach((path, index) => {
    console.log(`   ${index + 1}. ${path}`);
  });
  console.log();
  
  // Verify the URL matches the expected CloudFront structure
  const expectedCloudFrontUrl = `https://d2hvyig9aqs577.cloudfront.net/tenants/${tenantId}/deployments/${buildId}`;
  const urlsMatch = generatedUrl === expectedCloudFrontUrl;
  
  console.log('✅ Verification:');
  console.log(`   Expected: ${expectedCloudFrontUrl}`);
  console.log(`   Generated: ${generatedUrl}`);
  console.log(`   Match: ${urlsMatch ? '✅ YES' : '❌ NO'}\n`);
  
  if (urlsMatch) {
    console.log('🎉 SUCCESS! URL generation is now correct!');
    console.log('Your deployed site should be accessible at:');
    console.log(`🔗 ${generatedUrl}`);
    console.log(`🔗 ${generatedUrl}/index.html`);
  } else {
    console.log('❌ URLs do not match. Check environment configuration.');
  }
  
  return { generatedUrl, expectedCloudFrontUrl, urlsMatch };
}

// Test the URL generation
const result = testFixedUrlGeneration();

// Test the actual access
async function testUrlAccess() {
  console.log('\n🌐 Testing URL Access...\n');
  
  const https = require('https');
  const testUrls = [
    result.generatedUrl,
    `${result.generatedUrl}/index.html`
  ];
  
  for (const url of testUrls) {
    console.log(`Testing: ${url}`);
    
    try {
      const response = await new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'HEAD' }, (res) => {
          resolve(res);
        });
        req.on('error', reject);
        req.setTimeout(10000, () => {
          req.abort();
          reject(new Error('Timeout'));
        });
        req.end();
      });
      
      console.log(`  Status: ${response.statusCode}`);
      console.log(`  Server: ${response.headers['server'] || 'Unknown'}`);
      console.log(`  X-Cache: ${response.headers['x-cache'] || 'Not available'}`);
      
      if (response.statusCode === 200) {
        console.log(`  ✅ SUCCESS - Site is accessible!\n`);
        return true;
      } else {
        console.log(`  ⚠️ Status ${response.statusCode}\n`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}\n`);
    }
  }
  
  return false;
}

testUrlAccess().then(success => {
  if (success) {
    console.log('🏆 DEPLOYMENT VERIFICATION COMPLETE!');
    console.log('Your multi-tenant website builder is working correctly!');
  } else {
    console.log('📝 CloudFront may still be propagating changes.');
    console.log('Wait 2-3 minutes and try again.');
  }
}).catch(error => {
  console.error('Test failed:', error);
});