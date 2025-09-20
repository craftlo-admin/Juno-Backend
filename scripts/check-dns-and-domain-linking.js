#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');
const https = require('https');
const dns = require('dns').promises;

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const route53 = new AWS.Route53();
const cloudFront = new AWS.CloudFront();

/**
 * Check Route 53 DNS configuration and domain linking for CloudFront
 */

async function checkDNSRecord(domain, type = 'CNAME') {
  try {
    const records = await dns.resolve(domain, type);
    return records;
  } catch (error) {
    return null;
  }
}

async function testHTTPSConnection(domain) {
  return new Promise((resolve) => {
    const options = {
      hostname: domain,
      port: 443,
      path: '/',
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'DNS-Check-Bot/1.0'
      }
    };

    const req = https.request(options, (res) => {
      resolve({
        success: true,
        statusCode: res.statusCode,
        headers: res.headers,
        ssl: res.socket.getPeerCertificate()
      });
    });

    req.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Connection timeout'
      });
    });

    req.end();
  });
}

async function main() {
  console.log('🔍 Checking Route 53 DNS Configuration and Domain Linking');
  console.log('='.repeat(65));

  const hostedZoneId = process.env.ROUTE53_HOSTED_ZONE_ID;
  const customDomainBase = process.env.CUSTOM_DOMAIN_BASE || 'junotech.in';
  const cloudfrontDomain = process.env.SHARED_CLOUDFRONT_DOMAIN;
  const distributionId = process.env.SHARED_CLOUDFRONT_DISTRIBUTION_ID;

  console.log('📋 Configuration:');
  console.log(`   Hosted Zone ID: ${hostedZoneId}`);
  console.log(`   Custom Domain: *.${customDomainBase}`);
  console.log(`   CloudFront Domain: ${cloudfrontDomain}`);
  console.log(`   Distribution ID: ${distributionId}`);

  try {
    // 1. Check CloudFront Distribution Status
    console.log('\n🌐 Checking CloudFront Distribution Status...');
    const distResult = await cloudFront.getDistribution({ Id: distributionId }).promise();
    const distribution = distResult.Distribution;

    console.log(`   Status: ${distribution.Status}`);
    console.log(`   Domain Name: ${distribution.DomainName}`);
    console.log(`   Aliases: ${distribution.DistributionConfig.Aliases.Items.join(', ') || 'None'}`);
    
    if (distribution.DistributionConfig.ViewerCertificate.ACMCertificateArn) {
      console.log(`   SSL Certificate: ✅ Configured`);
      console.log(`   Certificate ARN: ${distribution.DistributionConfig.ViewerCertificate.ACMCertificateArn}`);
    } else {
      console.log(`   SSL Certificate: ❌ Not configured`);
    }

    // 2. Check Route 53 Hosted Zone
    console.log('\n🏗️ Checking Route 53 Hosted Zone...');
    const hostedZoneResult = await route53.getHostedZone({ Id: hostedZoneId }).promise();
    const hostedZone = hostedZoneResult.HostedZone;

    console.log(`   Zone Name: ${hostedZone.Name}`);
    console.log(`   Record Count: ${hostedZoneResult.DelegationSet ? 'Unknown' : hostedZone.ResourceRecordSetCount || 'Unknown'}`);

    // 3. List DNS Records
    console.log('\n📋 Checking DNS Records...');
    const recordsResult = await route53.listResourceRecordSets({ HostedZoneId: hostedZoneId }).promise();
    const records = recordsResult.ResourceRecordSets;

    // Look for wildcard CNAME record
    const wildcardRecord = records.find(record => 
      record.Name === `*.${customDomainBase}.` && record.Type === 'CNAME'
    );

    if (wildcardRecord) {
      console.log(`   ✅ Wildcard CNAME found: *.${customDomainBase}`);
      console.log(`      Points to: ${wildcardRecord.ResourceRecords[0].Value}`);
      
      if (wildcardRecord.ResourceRecords[0].Value === cloudfrontDomain) {
        console.log(`      ✅ Correctly points to CloudFront domain`);
      } else {
        console.log(`      ❌ Does NOT point to CloudFront domain`);
        console.log(`      Expected: ${cloudfrontDomain}`);
      }
    } else {
      console.log(`   ❌ No wildcard CNAME record found for *.${customDomainBase}`);
      console.log(`   ⚠️  DNS record needs to be created!`);
    }

    // Show other relevant records
    console.log('\n📝 Other DNS Records:');
    records.forEach(record => {
      if (record.Name.includes(customDomainBase) && record.Type !== 'SOA' && record.Type !== 'NS') {
        console.log(`   ${record.Type}: ${record.Name} → ${record.ResourceRecords ? record.ResourceRecords[0].Value : 'Alias'}`);
      }
    });

    // 4. Test DNS Resolution
    console.log('\n🔍 Testing DNS Resolution...');
    
    // Test wildcard domain
    const testDomain = `test.${customDomainBase}`;
    console.log(`   Testing: ${testDomain}`);
    
    const cnameRecords = await checkDNSRecord(testDomain, 'CNAME');
    if (cnameRecords) {
      console.log(`   ✅ DNS Resolution: ${testDomain} → ${cnameRecords[0]}`);
      
      if (cnameRecords[0] === cloudfrontDomain) {
        console.log(`   ✅ Correctly resolves to CloudFront domain`);
      } else {
        console.log(`   ⚠️  Resolves to unexpected domain: ${cnameRecords[0]}`);
      }
    } else {
      console.log(`   ❌ DNS Resolution failed for ${testDomain}`);
    }

    // 5. Test HTTPS Connection
    console.log('\n🔒 Testing HTTPS Connections...');
    
    // Test CloudFront default domain
    console.log(`   Testing CloudFront domain: ${cloudfrontDomain}`);
    const cloudfrontTest = await testHTTPSConnection(cloudfrontDomain);
    
    if (cloudfrontTest.success) {
      console.log(`   ✅ CloudFront HTTPS: Status ${cloudfrontTest.statusCode}`);
      if (cloudfrontTest.headers['x-amz-cf-id']) {
        console.log(`   ✅ CloudFront Response ID: ${cloudfrontTest.headers['x-amz-cf-id']}`);
      }
    } else {
      console.log(`   ❌ CloudFront HTTPS failed: ${cloudfrontTest.error}`);
    }

    // Test custom domain if DNS is configured
    if (cnameRecords) {
      console.log(`   Testing custom domain: ${testDomain}`);
      const customDomainTest = await testHTTPSConnection(testDomain);
      
      if (customDomainTest.success) {
        console.log(`   ✅ Custom Domain HTTPS: Status ${customDomainTest.statusCode}`);
        if (customDomainTest.headers['x-amz-cf-id']) {
          console.log(`   ✅ Custom Domain CloudFront ID: ${customDomainTest.headers['x-amz-cf-id']}`);
        }
        
        // Check SSL certificate
        if (customDomainTest.ssl && customDomainTest.ssl.subject) {
          console.log(`   ✅ SSL Certificate: ${customDomainTest.ssl.subject.CN}`);
          console.log(`   ✅ Certificate Valid: ${customDomainTest.ssl.valid_from} to ${customDomainTest.ssl.valid_to}`);
        }
      } else {
        console.log(`   ❌ Custom Domain HTTPS failed: ${customDomainTest.error}`);
      }
    }

    // 6. Summary and Recommendations
    console.log('\n📊 Summary:');
    
    if (distribution.Status === 'Deployed') {
      console.log('   ✅ CloudFront Distribution: Fully deployed');
    } else {
      console.log(`   ⏳ CloudFront Distribution: ${distribution.Status} (wait for deployment)`);
    }
    
    if (wildcardRecord && wildcardRecord.ResourceRecords[0].Value === cloudfrontDomain) {
      console.log('   ✅ DNS Configuration: Correctly configured');
    } else {
      console.log('   ❌ DNS Configuration: Needs setup');
    }
    
    if (cnameRecords && cloudfrontTest.success) {
      console.log('   ✅ Domain Linking: Working correctly');
    } else {
      console.log('   ❌ Domain Linking: Not working');
    }

    // Provide action items
    console.log('\n🚀 Action Items:');
    
    if (!wildcardRecord) {
      console.log('   1. Create DNS CNAME record:');
      console.log(`      Record Name: *.${customDomainBase}`);
      console.log(`      Record Type: CNAME`);
      console.log(`      Record Value: ${cloudfrontDomain}`);
      console.log(`      TTL: 300`);
    }
    
    if (distribution.Status !== 'Deployed') {
      console.log('   2. Wait for CloudFront distribution to finish deploying (15-20 minutes)');
    }
    
    if (wildcardRecord && cnameRecords) {
      console.log('   3. Test tenant URLs:');
      console.log(`      https://tenant1.${customDomainBase}/`);
      console.log(`      https://company.${customDomainBase}/`);
      console.log(`      https://demo.${customDomainBase}/`);
    }

  } catch (error) {
    console.error('\n❌ DNS Check failed');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'NoSuchHostedZone') {
      console.error('\n💡 Hosted Zone Issue:');
      console.error('   - Verify ROUTE53_HOSTED_ZONE_ID is correct');
      console.error('   - Check Route 53 console for the correct zone ID');
    }
    
    if (error.code === 'NoSuchDistribution') {
      console.error('\n💡 Distribution Issue:');
      console.error('   - Verify SHARED_CLOUDFRONT_DISTRIBUTION_ID is correct');
      console.error('   - Check CloudFront console for the correct distribution ID');
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