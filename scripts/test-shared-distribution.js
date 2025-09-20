#!/usr/bin/env node

require('dotenv').config();

/**
 * Test script to verify shared CloudFront distribution setup
 * This version avoids database connections to prevent shutdown loops
 */

async function main() {
  console.log('🧪 Testing Shared CloudFront Distribution Setup');
  console.log('='.repeat(50));

  // Test 1: Check environment variables first
  console.log('\n1. � Checking Environment Variables...');
  const requiredVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY', 
    'AWS_S3_BUCKET_STATIC',
    'CUSTOM_DOMAIN_BASE'
  ];
  
  const optionalVars = [
    'SHARED_CLOUDFRONT_DISTRIBUTION_ID',
    'SHARED_CLOUDFRONT_DOMAIN',
    'WILDCARD_SSL_CERTIFICATE_ARN',
    'ROUTE53_HOSTED_ZONE_ID'
  ];

  let hasRequiredVars = true;
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`   ✅ ${varName}: ${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`);
    } else {
      console.log(`   ❌ ${varName}: NOT SET`);
      hasRequiredVars = false;
    }
  });

  optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`   ✅ ${varName}: ${value.substring(0, 30)}${value.length > 30 ? '...' : ''}`);
    } else {
      console.log(`   ⚠️  ${varName}: NOT SET (optional)`);
    }
  });

  if (!hasRequiredVars) {
    console.log('\n❌ Missing required environment variables. Please configure them in .env file.');
    return;
  }

  // Test 2: Check AWS SDK availability (without connecting)
  console.log('\n2. 📦 Testing AWS SDK...');
  try {
    const AWS = require('aws-sdk');
    console.log(`   ✅ AWS SDK version: ${AWS.VERSION}`);
    console.log(`   ✅ AWS Region: ${process.env.AWS_REGION || 'us-east-1'}`);
  } catch (error) {
    console.log(`   ❌ AWS SDK error: ${error.message}`);
    return;
  }

  // Test 3: Check if services can be loaded (without database)
  console.log('\n3. 📋 Testing Service Imports...');
  try {
    // Load setup service (doesn't require database)
    const SharedDistributionSetupService = require('../src/services/sharedDistributionSetupService');
    console.log('   ✅ SharedDistributionSetupService loaded');
    
    const setupService = new SharedDistributionSetupService();
    console.log('   ✅ Setup service instantiated');
    
  } catch (error) {
    console.log(`   ❌ Service loading error: ${error.message}`);
  }

  // Test 4: Check CloudFront distribution (if configured)
  const distributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID;
  if (distributionId) {
    console.log('\n4. ☁️  Testing CloudFront Distribution...');
    try {
      const AWS = require('aws-sdk');
      AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
      
      const cloudFront = new AWS.CloudFront();
      console.log(`   🔍 Checking distribution ${distributionId}...`);
      
      const result = await cloudFront.getDistribution({ Id: distributionId }).promise();
      const distribution = result.Distribution;
      
      console.log('   ✅ Distribution found');
      console.log(`   ✅ Domain: ${distribution.DomainName}`);
      console.log(`   ✅ Status: ${distribution.Status}`);
      console.log(`   ✅ Enabled: ${distribution.DistributionConfig.Enabled}`);
      
      if (distribution.DistributionConfig.Aliases.Items.length > 0) {
        console.log(`   ✅ Aliases: ${distribution.DistributionConfig.Aliases.Items.join(', ')}`);
      } else {
        console.log('   ⚠️  No aliases configured (will use CloudFront domain only)');
      }
      
    } catch (error) {
      console.log(`   ❌ CloudFront error: ${error.message}`);
      if (error.code === 'NoSuchDistribution') {
        console.log('   💡 Distribution does not exist. Run: npm run cloudfront:setup');
      }
    }
  } else {
    console.log('\n4. ☁️  CloudFront Distribution: NOT CONFIGURED');
    console.log('   💡 Run: npm run cloudfront:setup');
  }

  // Test 5: URL structure examples
  console.log('\n5. 🌐 Expected URL Structure...');
  const domainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
  const cfDomain = process.env.SHARED_CLOUDFRONT_DOMAIN || '[distribution-domain].cloudfront.net';
  
  console.log('   Tenant Subdomains:');
  console.log(`     https://tenant1.${domainBase}`);
  console.log(`     https://company.${domainBase}`);
  console.log('   Direct CloudFront Access:');
  console.log(`     https://${cfDomain}/tenant-tenant1/`);
  console.log(`     https://${cfDomain}/tenant-company/`);
  console.log('   S3 Path Mapping:');
  console.log('     /tenants/tenant1/deployments/current/index.html');
  console.log('     /tenants/company/deployments/current/assets/style.css');

  // Test 6: Next steps
  console.log('\n6. 🚀 Next Steps...');
  
  if (!process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID) {
    console.log('   ❗ Create shared distribution:');
    console.log('     npm run cloudfront:setup');
  }
  
  if (!process.env.WILDCARD_SSL_CERTIFICATE_ARN) {
    console.log('   ❗ Create wildcard SSL certificate in ACM (us-east-1):');
    console.log(`     Domain: *.${domainBase}`);
  }
  
  if (!process.env.ROUTE53_HOSTED_ZONE_ID) {
    console.log('   ❗ Configure DNS:');
    console.log(`     CNAME: *.${domainBase} -> ${cfDomain}`);
  }
  
  if (process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID) {
    console.log('   ✅ Test tenant routing:');
    console.log(`     curl -H "Host: test.${domainBase}" https://${cfDomain}/`);
    console.log('   ✅ Test direct access:');
    console.log(`     curl https://${cfDomain}/tenant-test/`);
  }

  console.log('\n🏁 Test complete! No database connections required.');
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n💥 Unhandled error:', error.message);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\n💥 Test failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main };