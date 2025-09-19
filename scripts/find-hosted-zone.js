require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS Route 53
const route53 = new AWS.Route53({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

async function findHostedZone() {
  try {
    console.log('🔍 Searching for junotech.in hosted zone...\n');
    
    const result = await route53.listHostedZones().promise();
    
    const junotechZone = result.HostedZones.find(zone => 
      zone.Name === 'junotech.in.' || zone.Name === 'junotech.in'
    );
    
    if (junotechZone) {
      console.log('✅ Found Route 53 hosted zone for junotech.in:');
      console.log(`   Zone ID: ${junotechZone.Id}`);
      console.log(`   Zone Name: ${junotechZone.Name}`);
      console.log(`   Resource Record Count: ${junotechZone.ResourceRecordSetCount}`);
      console.log(`   Config: ${junotechZone.Config ? 'Private' : 'Public'}`);
      
      // Get the clean zone ID (remove the /hostedzone/ prefix)
      const cleanZoneId = junotechZone.Id.replace('/hostedzone/', '');
      console.log(`\n🔧 Add this to your .env file:`);
      console.log(`ROUTE53_HOSTED_ZONE_ID=${cleanZoneId}`);
      
      // Check current DNS records
      console.log('\n📋 Current DNS records in hosted zone:');
      const recordsResult = await route53.listResourceRecordSets({
        HostedZoneId: junotechZone.Id
      }).promise();
      
      recordsResult.ResourceRecordSets.forEach(record => {
        console.log(`   ${record.Type}: ${record.Name} → ${record.ResourceRecords ? record.ResourceRecords.map(r => r.Value).join(', ') : 'Alias'}`);
      });
      
    } else {
      console.log('❌ No hosted zone found for junotech.in');
      console.log('\nAvailable hosted zones:');
      result.HostedZones.forEach(zone => {
        console.log(`   - ${zone.Name} (${zone.Id})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to list hosted zones:', error.message);
    console.error('\nPossible issues:');
    console.error('   - AWS credentials not configured correctly');
    console.error('   - Missing Route 53 permissions');
    console.error('   - No internet connection');
  }
}

findHostedZone();