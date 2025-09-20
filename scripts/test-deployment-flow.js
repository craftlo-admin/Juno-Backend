#!/usr/bin/env node

require('dotenv').config();

// Mock the deploymentService logic without database
async function mockDeployToSharedDistribution(tenantId, version, buildPath) {
  console.log(`🚀 Mock: Deploying ${tenantId} to shared CloudFront distribution`);

  // Simulate what sharedDistributionService.getOrSetupTenantDomain would return
  const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
  const sharedDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;
  
  // Mock the DNS-safe conversion
  const dnsafeTenantId = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .substring(0, 63);

  const tenantDomain = {
    customDomain: `${dnsafeTenantId}.${customDomainBase}`,
    distributionId: process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID,
    cloudFrontDomain: sharedDomain,
    tenantDomain: `${dnsafeTenantId}.${customDomainBase}`,  // This is the key field!
    deploymentUrl: `https://${dnsafeTenantId}.${customDomainBase}/`,
    setupType: 'shared_distribution'
  };
  
  console.log('📋 Mock tenant domain response:', {
    tenantDomain: tenantDomain.tenantDomain,
    deploymentUrl: tenantDomain.deploymentUrl
  });

  return {
    type: 'shared',
    distributionId: tenantDomain.distributionId,
    domain: tenantDomain.cloudFrontDomain,
    tenantDomain: tenantDomain.tenantDomain,
    deploymentUrl: `https://${tenantDomain.tenantDomain}`  // This line is in deploymentService.js:124
  };
}

async function testDeployment() {
  console.log('🧪 Testing Deployment Service Logic');
  console.log('='.repeat(40));
  
  const testTenantId = 'himanshus-organization-clql5u68';
  
  try {
    const result = await mockDeployToSharedDistribution(testTenantId, 'test-version', '/path/to/build');
    
    console.log('\n📤 Final deployment result:');
    console.log(`deploymentUrl: ${result.deploymentUrl}`);
    
    if (result.deploymentUrl.includes('undefined')) {
      console.log('\n❌ FOUND THE PROBLEM!');
      console.log('The tenantDomain field is undefined in the shared distribution service response');
    } else {
      console.log('\n✅ URLs are correctly generated!');
      console.log('The issue must be elsewhere - check logs for actual shared distribution service calls');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testDeployment();