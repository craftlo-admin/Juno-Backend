require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function analyze503Issue() {
    try {
        console.log('🔍 DEEP ANALYSIS: CloudFront 503 Function Error');
        console.log('================================================\n');

        const distributionId = 'E21LRYPVGD34E4';
        const functionName = 'tenant-routing-1758343255348';

        // Step 1: Check distribution configuration
        console.log('📋 Step 1: Analyzing distribution configuration...');
        const distribution = await cloudfront.getDistribution({ Id: distributionId }).promise();
        
        const defaultCacheBehavior = distribution.Distribution.DistributionConfig.DefaultCacheBehavior;
        console.log('🎯 Default Cache Behavior:');
        console.log('   ViewerProtocolPolicy:', defaultCacheBehavior.ViewerProtocolPolicy);
        console.log('   Compress:', defaultCacheBehavior.Compress);
        console.log('   CachePolicyId:', defaultCacheBehavior.CachePolicyId);
        
        // Check for function associations
        const functionAssociations = defaultCacheBehavior.FunctionAssociations;
        console.log('\n🔗 Function Associations:');
        console.log('   Count:', functionAssociations.Quantity);
        
        if (functionAssociations.Quantity > 0) {
            functionAssociations.Items.forEach((assoc, index) => {
                console.log(`   Association ${index + 1}:`);
                console.log(`     Function ARN: ${assoc.FunctionARN}`);
                console.log(`     Event Type: ${assoc.EventType}`);
            });
        } else {
            console.log('   ❌ NO FUNCTION ASSOCIATIONS FOUND!');
        }

        // Step 2: Check function status
        console.log('\n📋 Step 2: Checking function status...');
        let functionInfo = null;
        try {
            functionInfo = await cloudfront.getFunction({ 
                Name: functionName,
                Stage: 'LIVE'
            }).promise();
            
            console.log('✅ Function exists in LIVE stage');
            console.log('   ETag:', functionInfo.ETag);
            console.log('   Last Modified:', functionInfo.FunctionMetadata?.LastModifiedTime || 'Unknown');
            console.log('   Code size:', functionInfo.FunctionCode.length, 'bytes');
            
            // Get function metadata
            const describeResult = await cloudfront.describeFunction({ Name: functionName }).promise();
            console.log('   Status:', describeResult.FunctionSummary.Status);
            console.log('   Stage:', describeResult.FunctionSummary.Stage);
            
        } catch (funcError) {
            console.log('❌ Function error:', funcError.message);
        }

        // Step 3: Test function with sample event
        console.log('\n📋 Step 3: Testing function with sample event...');
        if (functionInfo) {
            try {
                const testEvent = {
                    "Records": [{
                        "cf": {
                            "request": {
                                "uri": "/index.html",
                                "method": "GET",
                                "headers": {
                                    "host": [{
                                        "key": "Host",
                                        "value": "himanshus-organization-clql5u68.junotech.in"
                                    }]
                                }
                            }
                        }
                    }]
                };

                const testResult = await cloudfront.testFunction({
                    Name: functionName,
                    IfMatch: functionInfo.ETag,
                    Stage: 'LIVE',
                    EventObject: Buffer.from(JSON.stringify(testEvent))
                }).promise();

                console.log('✅ Function test successful!');
                console.log('   Test result:', testResult.TestResult.FunctionOutput);
                console.log('   Execution time:', testResult.TestResult.FunctionExecutionLogs);
                
            } catch (testError) {
                console.log('❌ Function test failed:', testError.message);
                console.log('   Code:', testError.code);
                if (testError.code === 'InvalidArgument') {
                    console.log('   This usually indicates a syntax error in the function');
                }
            }
        } else {
            console.log('❌ Cannot test function - function info not available');
        }

        // Step 4: Check distribution deployment status
        console.log('\n📋 Step 4: Checking distribution deployment status...');
        console.log('   Status:', distribution.Distribution.Status);
        console.log('   Last Modified:', distribution.Distribution.LastModifiedTime);
        console.log('   In Progress:', distribution.Distribution.InProgressInvalidationBatches);

        // Step 5: Try to identify the exact issue
        console.log('\n📋 Step 5: Issue Analysis...');
        
        // Check if function is properly associated
        let functionAssociated = false;
        if (functionAssociations.Quantity > 0) {
            const targetARN = `arn:aws:cloudfront::992382663165:function/${functionName}`;
            functionAssociated = functionAssociations.Items.some(assoc => 
                assoc.FunctionARN === targetARN && assoc.EventType === 'viewer-request'
            );
        }
        
        console.log('🔍 DIAGNOSIS:');
        console.log('   Function exists:', functionInfo ? '✅' : '❌');
        console.log('   Function associated:', functionAssociated ? '✅' : '❌');
        console.log('   Distribution deployed:', distribution.Distribution.Status === 'Deployed' ? '✅' : '❌');
        
        if (!functionAssociated) {
            console.log('\n❌ CRITICAL ISSUE: Function is not associated with distribution!');
            console.log('   Expected ARN: arn:aws:cloudfront::992382663165:function/' + functionName);
            console.log('   Event Type: viewer-request');
            console.log('   This is likely the cause of the 503 error.');
        }

    } catch (error) {
        console.error('❌ Analysis failed:', error);
    }
}

analyze503Issue();