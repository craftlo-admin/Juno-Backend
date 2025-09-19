require('dotenv').config();
const DNSService = require('../src/services/dnsService');
const logger = require('../src/utils/logger');

/**
 * DNS Service Validation Script
 * Tests Route 53 configuration and DNS service functionality
 */
async function validateDNSService() {
  console.log('🔍 Validating DNS Service Configuration...\n');
  
  const dnsService = new DNSService();
  
  try {
    // 1. Validate configuration
    console.log('1️⃣ Checking DNS Service Configuration...');
    const validation = await dnsService.validateConfiguration();
    
    console.log(`   - DNS Automation: ${validation.enabled ? '✅ Enabled' : '❌ Disabled'}`);
    console.log(`   - Hosted Zone ID: ${validation.hostedZoneId ? '✅ Set' : '❌ Missing'}`);
    console.log(`   - Domain: ${validation.domain || '❌ Missing'}`);
    console.log(`   - Route 53 Access: ${validation.hostedZoneAccess ? '✅ Accessible' : '❌ Failed'}`);
    
    if (validation.errors.length > 0) {
      console.log('\n❌ Configuration Errors:');
      validation.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    if (validation.warnings.length > 0) {
      console.log('\n⚠️ Configuration Warnings:');
      validation.warnings.forEach(warning => console.log(`   - ${warning}`));
    }
    
    if (!validation.enabled) {
      console.log('\n💡 To enable DNS automation, set ROUTE53_ENABLED=true in your .env file');
      return;
    }
    
    if (validation.errors.length > 0) {
      console.log('\n❌ Please fix configuration errors before proceeding');
      return;
    }
    
    // 2. Test DNS record creation (dry run)
    console.log('\n2️⃣ Testing DNS Record Operations...');
    
    const testTenantId = 'test-validation-' + Date.now();
    const testCloudfrontDomain = 'd123456789.cloudfront.net';
    
    console.log(`   - Test Tenant: ${testTenantId}`);
    console.log(`   - Test CloudFront Domain: ${testCloudfrontDomain}`);
    
    // Create test DNS record
    console.log('\n   Creating test DNS record...');
    const changeId = await dnsService.createTenantDNSRecord(testTenantId, testCloudfrontDomain);
    
    if (changeId) {
      console.log(`   ✅ DNS record creation initiated (Change ID: ${changeId})`);
      
      // Check if record exists
      console.log('   Checking if DNS record exists...');
      const recordExists = await dnsService.checkTenantDNSRecord(testTenantId);
      console.log(`   📋 DNS record exists: ${recordExists ? '✅ Yes' : '❌ No'}`);
      
      // Wait for propagation (short timeout for testing)
      console.log('   Waiting for DNS propagation (30 seconds timeout)...');
      const propagated = await dnsService.waitForDNSPropagation(changeId, 30000);
      console.log(`   🌐 DNS propagated: ${propagated ? '✅ Yes' : '⏳ Still propagating'}`);
      
      // Clean up test record
      console.log('   Cleaning up test DNS record...');
      const deleteChangeId = await dnsService.deleteTenantDNSRecord(testTenantId, testCloudfrontDomain);
      if (deleteChangeId) {
        console.log(`   🗑️ DNS record deletion initiated (Change ID: ${deleteChangeId})`);
      }
    } else {
      console.log('   ❌ DNS record creation failed');
    }
    
    // 3. List current DNS records
    console.log('\n3️⃣ Current DNS Records in Hosted Zone...');
    const records = await dnsService.getAllDNSRecords();
    
    if (records.length > 0) {
      console.log(`   Found ${records.length} DNS records:`);
      records.slice(0, 10).forEach(record => {
        console.log(`   - ${record.Name} (${record.Type})`);
      });
      if (records.length > 10) {
        console.log(`   ... and ${records.length - 10} more records`);
      }
    } else {
      console.log('   ❌ No DNS records found or access denied');
    }
    
    console.log('\n✅ DNS Service validation completed!');
    console.log('\n💡 Next steps:');
    console.log('   1. Create an SSL certificate for *.junotech.in in AWS Certificate Manager');
    console.log('   2. Set SSL_CERTIFICATE_ARN in your .env file');
    console.log('   3. Test tenant creation to verify end-to-end functionality');
    
  } catch (error) {
    console.error('\n❌ DNS Service validation failed:', error.message);
    console.error('\n🔧 Common solutions:');
    console.error('   1. Check AWS credentials are correct');
    console.error('   2. Verify ROUTE53_HOSTED_ZONE_ID is set correctly');
    console.error('   3. Ensure AWS IAM user has Route 53 permissions');
    console.error('   4. Check if hosted zone exists in Route 53');
  }
}

// Run validation if called directly
if (require.main === module) {
  validateDNSService().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Validation script failed:', error);
    process.exit(1);
  });
}

module.exports = { validateDNSService };