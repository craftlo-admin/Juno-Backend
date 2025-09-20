#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const route53 = new AWS.Route53();

/**
 * Create wildcard CNAME record in Route 53 for CloudFront distribution
 */

async function main() {
  console.log('🚀 Creating Wildcard DNS CNAME Record in Route 53');
  console.log('='.repeat(55));

  const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
  const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
  const cloudfrontDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;

  if (!hostedZoneId) {
    console.error('❌ ROUTE53_HOSTED_ZONE_ID not found in environment');
    process.exit(1);
  }

  if (!cloudfrontDomain) {
    console.error('❌ SHARED_CLOUDFRONT_DOMAIN not found in environment');
    process.exit(1);
  }

  console.log('📋 Configuration:');
  console.log(`   Hosted Zone ID: ${hostedZoneId}`);
  console.log(`   Domain: *.${customDomainBase}`);
  console.log(`   Target: ${cloudfrontDomain}`);

  try {
    // Check if the record already exists
    console.log('\n🔍 Checking existing DNS records...');
    const existingRecords = await route53.listResourceRecordSets({ 
      HostedZoneId: hostedZoneId 
    }).promise();

    const wildcardRecord = existingRecords.ResourceRecordSets.find(record => 
      record.Name === `*.${customDomainBase}.` && record.Type === 'CNAME'
    );

    if (wildcardRecord) {
      const currentTarget = wildcardRecord.ResourceRecords[0].Value;
      console.log(`   Found existing wildcard CNAME: *.${customDomainBase} → ${currentTarget}`);
      
      if (currentTarget === cloudfrontDomain) {
        console.log('   ✅ Record already points to correct CloudFront domain');
        console.log('   No action needed.');
        return;
      } else {
        console.log(`   ⚠️  Record points to different domain: ${currentTarget}`);
        console.log('   Will update to point to new CloudFront domain...');
      }
    } else {
      console.log(`   No existing wildcard CNAME found for *.${customDomainBase}`);
      console.log('   Will create new record...');
    }

    // Create or update the CNAME record
    console.log('\n🔧 Creating/updating DNS CNAME record...');
    
    const changeParams = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: `${wildcardRecord ? 'Update' : 'Create'} wildcard CNAME for shared CloudFront distribution`,
        Changes: [{
          Action: wildcardRecord ? 'UPSERT' : 'CREATE',
          ResourceRecordSet: {
            Name: `*.${customDomainBase}`,
            Type: 'CNAME',
            TTL: 300,
            ResourceRecords: [{
              Value: cloudfrontDomain
            }]
          }
        }]
      }
    };

    console.log(`   Action: ${wildcardRecord ? 'UPSERT' : 'CREATE'}`);
    console.log(`   Record: *.${customDomainBase} → ${cloudfrontDomain}`);
    console.log(`   TTL: 300 seconds`);

    const changeResult = await route53.changeResourceRecordSets(changeParams).promise();
    
    console.log('✅ DNS record created/updated successfully!');
    console.log(`   Change ID: ${changeResult.ChangeInfo.Id}`);
    console.log(`   Status: ${changeResult.ChangeInfo.Status}`);
    console.log(`   Submitted: ${changeResult.ChangeInfo.SubmittedAt}`);

    // Wait for the change to propagate
    console.log('\n⏳ Waiting for DNS change to propagate...');
    console.log('   This typically takes 30-60 seconds');
    
    const changeId = changeResult.ChangeInfo.Id;
    let propagated = false;
    let attempts = 0;
    const maxAttempts = 20; // 10 minutes max

    while (!propagated && attempts < maxAttempts) {
      attempts++;
      console.log(`   Attempt ${attempts}/${maxAttempts}...`);
      
      try {
        const statusResult = await route53.getChange({ Id: changeId }).promise();
        
        if (statusResult.ChangeInfo.Status === 'INSYNC') {
          propagated = true;
          console.log('   ✅ DNS change propagated successfully!');
        } else {
          console.log(`   Status: ${statusResult.ChangeInfo.Status} (waiting...)`);
          await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        }
      } catch (error) {
        console.log(`   Error checking status: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }

    if (!propagated) {
      console.log('   ⚠️  DNS change is still propagating (this is normal)');
      console.log('   Check again in a few minutes');
    }

    console.log('\n🎉 DNS Configuration Complete!');
    console.log('\n🧪 Test Commands:');
    console.log('   # Test DNS resolution:');
    console.log(`   nslookup test.${customDomainBase}`);
    console.log('   ');
    console.log('   # Test HTTPS connections:');
    console.log(`   curl -I https://test.${customDomainBase}/`);
    console.log(`   curl -I https://demo.${customDomainBase}/`);
    
    console.log('\n📋 What happens next:');
    console.log('1. DNS propagation completes globally (up to 24 hours)');
    console.log('2. CloudFront distribution finishes deploying');
    console.log('3. Test tenant URLs will work:');
    console.log(`   https://tenant1.${customDomainBase}/`);
    console.log(`   https://company.${customDomainBase}/`);
    console.log(`   https://demo.${customDomainBase}/`);

  } catch (error) {
    console.error('\n❌ Failed to create DNS record');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'InvalidChangeBatch') {
      console.error('\n💡 DNS Change Issue:');
      console.error('   - Check that the domain name is valid');
      console.error('   - Verify CloudFront domain format');
      console.error('   - Ensure no conflicting records exist');
    }
    
    if (error.code === 'NoSuchHostedZone') {
      console.error('\n💡 Hosted Zone Issue:');
      console.error('   - Verify ROUTE53_HOSTED_ZONE_ID is correct');
      console.error('   - Check Route 53 console for the correct zone ID');
    }
    
    if (error.code === 'RRRNotFound') {
      console.error('\n💡 Record Issue:');
      console.error('   - The record you are trying to update does not exist');
      console.error('   - Try creating a new record instead');
    }
    
    process.exit(1);
  }
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('\n💥 Unhandled error:', error.message);
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('\n💥 Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main };