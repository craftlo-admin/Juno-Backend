// Load environment variables
require('dotenv').config();

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Configure AWS SDK
AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function fixCloudfrontFunction() {
    try {
        console.log('🔧 Fixing CloudFront Function with complete code...');
        
        // Read the complete function code
        const functionPath = path.join(__dirname, '..', 'src', 'cloudfront', 'tenant-routing-function.js');
        const fullCode = fs.readFileSync(functionPath, 'utf8');
        
        // Extract just the function handler (remove comments and extra code)
        const functionMatch = fullCode.match(/function handler\(event\)\s*{([\s\S]*?)}\s*(?:\/\*|$)/);
        
        if (!functionMatch) {
            throw new Error('Could not extract function handler from source file');
        }
        
        const cleanFunctionCode = `function handler(event) {${functionMatch[1]}}`;
        
        console.log('📝 Function code length:', cleanFunctionCode.length, 'characters');
        console.log('📋 First 200 chars:', cleanFunctionCode.substring(0, 200) + '...');
        
        // Syntax check
        try {
            eval(cleanFunctionCode);
            console.log('✅ Function syntax is valid');
        } catch (syntaxError) {
            console.error('❌ Function syntax error:', syntaxError.message);
            return;
        }
        
        const functionName = 'tenant-routing-1758343255348';
        
        // Get current function to get ETag
        console.log('🔍 Getting current function state...');
        const getParams = {
            Name: functionName
        };
        
        const currentFunction = await cloudfront.getFunction(getParams).promise();
        const etag = currentFunction.ETag;
        
        console.log('📝 Current ETag:', etag);
        
        // Update function code
        const updateParams = {
            Name: functionName,
            IfMatch: etag,
            FunctionCode: Buffer.from(cleanFunctionCode, 'utf8'),
            FunctionConfig: {
                Comment: 'Tenant routing function for shared CloudFront distribution - FIXED VERSION',
                Runtime: 'cloudfront-js-1.0'
            }
        };
        
        console.log('🚀 Updating CloudFront Function...');
        const updateResult = await cloudfront.updateFunction(updateParams).promise();
        
        console.log('✅ Function updated successfully!');
        console.log('📝 New ETag:', updateResult.ETag);
        
        // Publish the function
        console.log('📤 Publishing function...');
        const publishParams = {
            Name: functionName,
            IfMatch: updateResult.ETag
        };
        
        const publishResult = await cloudfront.publishFunction(publishParams).promise();
        console.log('✅ Function published successfully!');
        console.log('📝 Published ETag:', publishResult.FunctionSummary.FunctionMetadata.ETag);
        
        // Verify the deployment
        console.log('🔍 Verifying function deployment...');
        const verifyResult = await cloudfront.getFunction({
            Name: functionName,
            Stage: 'LIVE'
        }).promise();
        
        const deployedCode = verifyResult.FunctionCode.toString('utf8');
        console.log('📝 Deployed function length:', deployedCode.length, 'characters');
        console.log('🎯 Code matches:', deployedCode === cleanFunctionCode ? '✅ YES' : '❌ NO');
        
        if (deployedCode !== cleanFunctionCode) {
            console.log('⚠️  Code mismatch detected!');
            console.log('Expected length:', cleanFunctionCode.length);
            console.log('Deployed length:', deployedCode.length);
        }
        
        console.log('\\n🎉 CloudFront Function fix completed!');
        console.log('⏱️  Allow 5-10 minutes for global distribution');
        console.log('🔗 Test URL: https://himanshus-organization-clql5u68.junotech.in/index.html');
        
    } catch (error) {
        console.error('❌ Error fixing CloudFront Function:', error);
        
        if (error.code === 'PreconditionFailed') {
            console.log('💡 ETag mismatch - function was modified by another process');
            console.log('🔄 Try running the script again');
        }
    }
}

// Run the fix
fixCloudfrontFunction();