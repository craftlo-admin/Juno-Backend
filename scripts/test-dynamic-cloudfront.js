const TenantDistributionService = require('../src/services/tenantDistributionService');
const logger = require('../src/utils/logger');
require('dotenv').config();

/**
 * Test script for the new dynamic CloudFront distribution system
 * This replaces the junotech.in approach with individual tenant distributions
 */
async function testDynamicCloudFrontSystem() {
  console.log('🧪 Testing Dynamic CloudFront Distribution System');
  console.log('='.repeat(60));
  
  const testTenantId = 'testuser_example_com-abc123';
  
  try {
    console.log(`\n1. 🔍 Testing tenant distribution lookup for: ${testTenantId}`);
    
    // Check if tenant already has a distribution
    let distribution = await TenantDistributionService.getTenantDistribution(testTenantId);
    
    if (distribution) {
      console.log('✅ Found existing distribution:');
      console.log(`   Distribution ID: ${distribution.distributionId}`);
      console.log(`   Domain: ${distribution.domain}`);
      console.log(`   Status: ${distribution.status}`);
      console.log(`   Deployment URL: ${distribution.deploymentUrl}`);
    } else {
      console.log('ℹ️ No existing distribution found');
    }
    
    console.log(`\n2. 🚀 Testing get-or-create distribution for: ${testTenantId}`);
    
    // Get or create distribution (this is what the build process will use)
    distribution = await TenantDistributionService.getOrCreateTenantDistribution(testTenantId);
    
    console.log('✅ Distribution ready:');
    console.log(`   Distribution ID: ${distribution.distributionId}`);
    console.log(`   CloudFront Domain: ${distribution.domain}`);
    console.log(`   Status: ${distribution.status}`);
    console.log(`   Unique ID: ${distribution.uniqueId}`);
    console.log(`   Full Deployment URL: ${distribution.deploymentUrl}`);
    
    console.log(`\n3. 🧪 Testing cache invalidation for: ${testTenantId}`);
    
    // Test cache invalidation
    const invalidationId = await TenantDistributionService.invalidateTenantCache(testTenantId, 'test-build-123');
    
    if (invalidationId) {
      console.log(`✅ Cache invalidation created: ${invalidationId}`);
    } else {
      console.log('ℹ️ Cache invalidation skipped (distribution may still be deploying)');
    }
    
    console.log(`\n4. 📊 Distribution Details:`);
    console.log(`   Each tenant now gets their own CloudFront distribution`);
    console.log(`   Domain format: *.cloudfront.net (AWS managed)`);
    console.log(`   No custom domain configuration needed`);
    console.log(`   No DNS management required`);
    console.log(`   Each tenant is completely isolated`);
    
    console.log(`\n5. 🔗 Example URLs:`);
    console.log(`   Tenant Distribution: https://${distribution.domain}`);
    console.log(`   Build Deployment: https://${distribution.domain}/deployments/build-123/`);
    console.log(`   Index File: https://${distribution.domain}/deployments/build-123/index.html`);
    
    console.log(`\n✅ Dynamic CloudFront system test completed successfully!`);
    
    return {
      success: true,
      tenantId: testTenantId,
      distribution: distribution
    };
    
  } catch (error) {
    console.error(`\n❌ Test failed for ${testTenantId}:`, error.message);
    console.error('Stack:', error.stack);
    
    return {
      success: false,
      error: error.message
    };
  }
}

async function testMultipleTenants() {
  console.log('\n🔄 Testing Multiple Tenant Distributions');
  console.log('='.repeat(40));
  
  const testTenants = [
    'user1_example_com-xyz789',
    'company_test_org-def456',
    'demo_site_net-ghi012'
  ];
  
  const results = [];
  
  for (const tenantId of testTenants) {
    try {
      console.log(`\n📋 Processing tenant: ${tenantId}`);
      
      const distribution = await TenantDistributionService.getOrCreateTenantDistribution(tenantId);
      
      console.log(`   ✅ Distribution: ${distribution.distributionId}`);
      console.log(`   🌐 Domain: ${distribution.domain}`);
      
      results.push({
        tenantId,
        success: true,
        distributionId: distribution.distributionId,
        domain: distribution.domain
      });
      
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      results.push({
        tenantId,
        success: false,
        error: error.message
      });
    }
  }
  
  console.log('\n📊 Multi-tenant Test Summary:');
  results.forEach(result => {
    if (result.success) {
      console.log(`   ✅ ${result.tenantId}: ${result.domain}`);
    } else {
      console.log(`   ❌ ${result.tenantId}: ${result.error}`);
    }
  });
  
  return results;
}

async function main() {
  console.log('🎯 Dynamic CloudFront Distribution Testing');
  console.log('Replacing junotech.in with individual tenant distributions');
  console.log('Each tenant gets: unique-id.cloudfront.net domain\n');
  
  // Test single tenant
  const singleTest = await testDynamicCloudFrontSystem();
  
  if (singleTest.success) {
    // Test multiple tenants
    await testMultipleTenants();
    
    console.log('\n🎉 All tests completed!');
    console.log('\n💡 Key Benefits of New System:');
    console.log('   • Each tenant gets isolated CloudFront distribution');
    console.log('   • No domain management complexity');
    console.log('   • Automatic *.cloudfront.net domains');
    console.log('   • Better security isolation');
    console.log('   • Easier scaling');
    console.log('   • No DNS configuration required');
    
  } else {
    console.log('\n❌ Single tenant test failed, skipping multi-tenant tests');
  }
}

// Run tests
main().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});