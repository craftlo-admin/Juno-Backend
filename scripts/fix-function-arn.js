require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function fixFunctionARN() {
    try {
        console.log('🔧 FIXING CloudFront Function ARN Mismatch');
        console.log('==========================================\n');

        const distributionId = 'E21LRYPVGD34E4';
        const functionName = 'tenant-routing-1758343255348';
        
        // Get current distribution config
        console.log('📋 Getting current distribution configuration...');
        const distributionResult = await cloudfront.getDistribution({ Id: distributionId }).promise();
        const config = distributionResult.Distribution.DistributionConfig;
        const etag = distributionResult.ETag;
        
        console.log('✅ Current distribution ETag:', etag);
        
        // Get our account ID from STS
        const sts = new AWS.STS();
        const identity = await sts.getCallerIdentity().promise();
        const accountId = identity.Account;
        
        console.log('✅ Current AWS Account ID:', accountId);
        
        // Construct correct function ARN
        const correctFunctionARN = `arn:aws:cloudfront::${accountId}:function/${functionName}`;
        console.log('🎯 Correct Function ARN:', correctFunctionARN);
        
        // Check current function associations
        const currentAssociations = config.DefaultCacheBehavior.FunctionAssociations;
        console.log('📋 Current function associations:');
        currentAssociations.Items.forEach((assoc, index) => {
            console.log(`   ${index + 1}. ARN: ${assoc.FunctionARN}`);
            console.log(`      Event: ${assoc.EventType}`);
        });
        
        // Update function associations with correct ARN
        const updatedAssociations = {
            Quantity: 1,
            Items: [{
                FunctionARN: correctFunctionARN,
                EventType: 'viewer-request'
            }]
        };
        
        // Update the distribution configuration
        config.DefaultCacheBehavior.FunctionAssociations = updatedAssociations;
        config.CallerReference = Date.now().toString(); // Update caller reference
        
        console.log('\n🚀 Updating CloudFront distribution...');
        const updateParams = {
            Id: distributionId,
            DistributionConfig: config,
            IfMatch: etag
        };
        
        const updateResult = await cloudfront.updateDistribution(updateParams).promise();
        
        console.log('✅ Distribution updated successfully!');
        console.log('📝 New ETag:', updateResult.ETag);
        console.log('🔄 Status:', updateResult.Distribution.Status);
        
        console.log('\n📋 Updated function associations:');
        const newAssociations = updateResult.Distribution.DistributionConfig.DefaultCacheBehavior.FunctionAssociations;
        newAssociations.Items.forEach((assoc, index) => {
            console.log(`   ${index + 1}. ARN: ${assoc.FunctionARN}`);
            console.log(`      Event: ${assoc.EventType}`);
        });
        
        console.log('\n🎉 FUNCTION ARN FIX COMPLETED!');
        console.log('⏱️  Distribution deployment will take 5-15 minutes');
        console.log('🔗 Test URL: https://himanshus-organization-clql5u68.junotech.in/index.html');
        console.log('');
        console.log('💡 The 503 error should be resolved once deployment completes!');
        
    } catch (error) {
        console.error('❌ Error fixing function ARN:', error);
        
        if (error.code === 'PreconditionFailed') {
            console.log('💡 ETag mismatch - distribution was modified by another process');
            console.log('🔄 Try running the script again');
        } else if (error.code === 'InvalidArgument') {
            console.log('💡 Invalid function ARN or configuration');
            console.log('🔍 Check that the function exists and is published');
        }
    }
}

fixFunctionARN();