#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-southeast-2'
});

const route53 = new AWS.Route53();

async function createDNSRecord() {
    console.log('🔧 Creating DNS Record for himanshus-organization-v4ijjx74.junotech.in\n');
    
    try {
        // Get hosted zone ID
        const hostedZones = await route53.listHostedZones().promise();
        const junotechZone = hostedZones.HostedZones.find(zone => 
            zone.Name === 'junotech.in.'
        );
        
        if (!junotechZone) {
            console.error('❌ junotech.in hosted zone not found');
            return;
        }
        
        console.log(`✅ Found hosted zone: ${junotechZone.Id}`);
        
        const params = {
            HostedZoneId: junotechZone.Id,
            ChangeBatch: {
                Comment: 'Create CNAME for new tenant CloudFront distribution',
                Changes: [{
                    Action: 'CREATE',
                    ResourceRecordSet: {
                        Name: 'himanshus-organization-v4ijjx74.junotech.in',
                        Type: 'CNAME',
                        TTL: 300,
                        ResourceRecords: [{
                            Value: 'di9ic2845k4tn.cloudfront.net'
                        }]
                    }
                }]
            }
        };
        
        console.log('🔄 Creating DNS record...');
        console.log(`   Domain: himanshus-organization-v4ijjx74.junotech.in`);
        console.log(`   Points to: di9ic2845k4tn.cloudfront.net`);
        
        const result = await route53.changeResourceRecordSets(params).promise();
        
        console.log(`✅ DNS record created successfully!`);
        console.log(`   Change ID: ${result.ChangeInfo.Id}`);
        console.log(`   Status: ${result.ChangeInfo.Status}`);
        console.log(`\n⏱️ DNS propagation will take a few minutes...`);
        
        // Check change status
        console.log('\n🔍 Checking change status...');
        let changeStatus = 'PENDING';
        let attempts = 0;
        const maxAttempts = 6;
        
        while (changeStatus === 'PENDING' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
            
            const statusResult = await route53.getChange({
                Id: result.ChangeInfo.Id
            }).promise();
            
            changeStatus = statusResult.ChangeInfo.Status;
            attempts++;
            
            console.log(`   Attempt ${attempts}/${maxAttempts}: ${changeStatus}`);
        }
        
        if (changeStatus === 'INSYNC') {
            console.log('\n🎉 DNS record created and propagated successfully!');
            console.log('🌐 Your custom domain is now ready!');
            console.log('🔗 Test URL: https://himanshus-organization-v4ijjx74.junotech.in/deployments/267c5caa-a636-4731-b9ff-b197d2704017/index.html');
        } else {
            console.log('\n⏱️ DNS is still propagating. This may take up to 5 minutes.');
            console.log('🔗 Test URL: https://himanshus-organization-v4ijjx74.junotech.in/deployments/267c5caa-a636-4731-b9ff-b197d2704017/index.html');
        }
        
    } catch (error) {
        if (error.code === 'RRSetAlreadyExists') {
            console.log('✅ DNS record already exists!');
            console.log('🌐 Your custom domain should be working.');
            console.log('🔗 Test URL: https://himanshus-organization-v4ijjx74.junotech.in/deployments/267c5caa-a636-4731-b9ff-b197d2704017/index.html');
        } else {
            console.error('❌ Error creating DNS record:', error.message);
        }
    }
}

createDNSRecord();