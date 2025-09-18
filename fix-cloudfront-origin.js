// Fix CloudFront distribution origin endpoint
require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const cloudfront = new AWS.CloudFront();

async function fixCloudFrontOrigin() {
    console.log('🔧 Fixing CloudFront Origin Configuration\n');
    
    try {
        const distributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;
        
        // 1. Get current distribution configuration
        console.log('1️⃣ Getting current distribution configuration...');
        const currentDistribution = await cloudfront.getDistribution({ Id: distributionId }).promise();
        const config = currentDistribution.Distribution.DistributionConfig;
        
        console.log(`   📍 Current Origin: ${config.Origins.Items[0].DomainName}`);
        
        // 2. Update the origin to use regional endpoint
        const correctOriginDomain = 'user-app-static-sites-uploads.s3.ap-southeast-2.amazonaws.com';
        config.Origins.Items[0].DomainName = correctOriginDomain;
        
        console.log(`   ✅ New Origin: ${correctOriginDomain}`);
        
        // 3. Update the distribution
        console.log('\n2️⃣ Updating CloudFront distribution...');
        const updateParams = {
            Id: distributionId,
            DistributionConfig: config,
            IfMatch: currentDistribution.ETag
        };
        
        const updateResult = await cloudfront.updateDistribution(updateParams).promise();
        
        console.log(`   ✅ Distribution updated successfully!`);
        console.log(`   🆔 Distribution ID: ${updateResult.Distribution.Id}`);
        console.log(`   📊 Status: ${updateResult.Distribution.Status}`);
        console.log(`   🔄 ETag: ${updateResult.ETag}`);
        
        console.log('\n3️⃣ Distribution Update Details:');
        console.log(`   🌐 Domain: ${updateResult.Distribution.DomainName}`);
        console.log(`   📡 Origin: ${updateResult.Distribution.DistributionConfig.Origins.Items[0].DomainName}`);
        
        console.log('\n⏰ Note: Changes will take 5-10 minutes to propagate globally');
        console.log('🔄 You can monitor the status in the AWS CloudFront console');
        
        // 4. Trigger cache invalidation to ensure changes take effect
        console.log('\n4️⃣ Triggering cache invalidation...');
        const invalidationParams = {
            DistributionId: distributionId,
            InvalidationBatch: {
                Paths: {
                    Quantity: 1,
                    Items: ['/*']
                },
                CallerReference: `fix-origin-${Date.now()}`
            }
        };
        
        const invalidationResult = await cloudfront.createInvalidation(invalidationParams).promise();
        console.log(`   ✅ Cache invalidation created: ${invalidationResult.Invalidation.Id}`);
        console.log(`   📊 Status: ${invalidationResult.Invalidation.Status}`);
        
        console.log('\n🎉 CloudFront origin fix completed!');
        console.log('🚀 Your deployed site should be accessible in 5-10 minutes at:');
        console.log(`   🔗 https://d2hvyig9aqs577.cloudfront.net/tenants/himanshubarnwal26_gmail_com-35aebtgz/deployments/70c6f5ec-a92e-4638-87ad-349f8ffd93d3/server/app/index.html`);
        
    } catch (error) {
        console.error('❌ Error fixing CloudFront origin:', error.message);
        console.error('📋 Full error:', error);
    }
}

fixCloudFrontOrigin();