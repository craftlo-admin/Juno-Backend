require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

/**
 * Test the TenantDistributionService with real tenant data
 */

async function testWithRealTenant() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔍 Finding existing tenants in database...');
    
    // Get the first tenant from database
    const tenant = await prisma.tenant.findFirst({
      select: {
        id: true,
        tenantId: true,
        name: true,
        domain: true,
        status: true,
        cloudfrontDistributionId: true,
        cloudfrontDomain: true
      }
    });
    
    if (!tenant) {
      console.log('❌ No tenants found in database');
      console.log('💡 Create a tenant first before testing CloudFront distributions');
      return;
    }
    
    console.log('✅ Found tenant:');
    console.log(`   ID: ${tenant.id}`);
    console.log(`   Tenant ID: ${tenant.tenantId}`);
    console.log(`   Name: ${tenant.name}`);
    console.log(`   Domain: ${tenant.domain}`);
    console.log(`   Status: ${tenant.status}`);
    
    if (tenant.cloudfrontDistributionId) {
      console.log(`   Existing CloudFront: ${tenant.cloudfrontDistributionId}`);
      console.log(`   CloudFront Domain: ${tenant.cloudfrontDomain}`);
    } else {
      console.log('   No CloudFront distribution yet');
    }
    
    console.log('\n🧪 Testing TenantDistributionService...');
    
    // Test the service (this would create a CloudFront distribution in real usage)
    console.log(`Testing with tenant ID: ${tenant.tenantId}`);
    
    // For now, just test the database query part
    const TenantDistributionService = require('../src/services/tenantDistributionService');
    
    const existingDistribution = await TenantDistributionService.getTenantDistribution(tenant.tenantId);
    
    if (existingDistribution) {
      console.log('✅ Found existing distribution:');
      console.log(`   Distribution ID: ${existingDistribution.distributionId}`);
      console.log(`   Domain: ${existingDistribution.domain}`);
      console.log(`   Status: ${existingDistribution.status}`);
    } else {
      console.log('ℹ️ No existing distribution found - ready to create new one');
    }
    
    console.log('\n✅ Database query test successful!');
    console.log('\n💡 Next: Test with actual CloudFront creation in AWS environment');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

testWithRealTenant();