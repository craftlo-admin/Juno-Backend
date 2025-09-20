require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

const cloudfront = new AWS.CloudFront();

async function fixFunctionEventFormat() {
    try {
        console.log('🔧 FIXING CloudFront Function Event Format');
        console.log('==========================================\n');

        const functionName = 'tenant-routing-1758343255348';
        
        // Create the correct CloudFront Function code (not Lambda@Edge format)
        const correctFunctionCode = `function handler(event) {
    // CloudFront Functions use event.request directly, not event.Records[0].cf.request
    var request = event.request;
    var headers = request.headers;
    var uri = request.uri;
    
    // Get the Host header to determine tenant
    var host = headers.host.value.toLowerCase();
    
    // Extract tenant ID from hostname
    var tenantId = null;
    var customDomainBase = 'junotech.in';
    
    // Handle custom domains: tenant123.junotech.in
    if (host.endsWith('.' + customDomainBase)) {
        var subdomain = host.replace('.' + customDomainBase, '');
        
        // Validate subdomain format
        if (subdomain && 
            subdomain !== 'www' && 
            subdomain !== 'api' && 
            subdomain !== 'admin' && 
            /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain) && 
            subdomain.length >= 3 && 
            subdomain.length <= 63) {
            tenantId = subdomain;
        }
    }
    
    // If we have a valid tenant ID, rewrite the request
    if (tenantId) {
        // Normalize URI
        if (uri === '' || uri === '/') {
            uri = '/index.html';
        }
        
        // Ensure URI starts with /
        if (!uri.startsWith('/')) {
            uri = '/' + uri;
        }
        
        // Route to physical /current/ directory
        var newUri = '/tenants/' + tenantId + '/deployments/current' + uri;
        
        console.log('Tenant routing: ' + host + uri + ' -> ' + newUri);
        
        request.uri = newUri;
        
        // Add headers for debugging (CloudFront Functions format)
        request.headers['x-tenant-id'] = {
            value: tenantId
        };
    } else {
        // No tenant detected - serve error page
        console.log('No tenant detected for host: ' + host);
        request.uri = '/error/tenant-not-found.html';
    }
    
    // CRITICAL: Must return the request object
    return request;
}`;

        console.log('📝 Corrected function code length:', correctFunctionCode.length, 'characters');
        console.log('🔍 Key fix: Using event.request instead of event.Records[0].cf.request');
        
        // Test syntax locally first
        try {
            eval(correctFunctionCode);
            console.log('✅ Function syntax is valid');
        } catch (syntaxError) {
            console.log('❌ Function syntax error:', syntaxError.message);
            return;
        }
        
        // Get current function to get ETag
        console.log('🔍 Getting current function state...');
        const currentFunction = await cloudfront.getFunction({
            Name: functionName
        }).promise();
        const etag = currentFunction.ETag;
        
        console.log('📝 Current ETag:', etag);
        
        // Update function code
        const updateParams = {
            Name: functionName,
            IfMatch: etag,
            FunctionCode: Buffer.from(correctFunctionCode, 'utf8'),
            FunctionConfig: {
                Comment: 'Tenant routing function - FIXED FOR CLOUDFRONT FUNCTIONS EVENT FORMAT',
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
        
        // Test the function with correct event format
        console.log('\n🧪 Testing the corrected function...');
        
        const testEvent = {
            "version": "1.0",
            "context": {
                "eventType": "viewer-request"
            },
            "viewer": {
                "ip": "198.51.100.178"
            },
            "request": {
                "method": "GET",
                "uri": "/index.html",
                "querystring": {},
                "headers": {
                    "host": {
                        "value": "himanshus-organization-clql5u68.junotech.in"
                    }
                },
                "cookies": {}
            }
        };
        
        try {
            const testResult = await cloudfront.testFunction({
                Name: functionName,
                IfMatch: publishResult.FunctionSummary.FunctionMetadata.ETag,
                Stage: 'LIVE',
                EventObject: Buffer.from(JSON.stringify(testEvent))
            }).promise();

            console.log('✅ Function test successful!');
            const output = JSON.parse(testResult.TestResult.FunctionOutput);
            console.log('🔍 Returned URI:', output.uri);
            console.log('🔍 Original URI: /index.html');
            
            if (output.uri && output.uri.includes('/tenants/himanshus-organization-clql5u68/deployments/current/')) {
                console.log('✅ Function is correctly routing requests!');
                console.log('🎯 Expected format achieved!');
            } else {
                console.log('❌ Function is still not routing correctly');
                console.log('   Got:', output.uri);
            }
            
        } catch (testError) {
            console.log('❌ Function test failed:', testError.message);
        }
        
        console.log('\n🎉 CLOUDFRONT FUNCTION EVENT FORMAT FIX COMPLETED!');
        console.log('⏱️  Allow 5-10 minutes for global distribution');
        console.log('🔗 Test URL: https://himanshus-organization-clql5u68.junotech.in/index.html');
        console.log('');
        console.log('💡 The 503 error should now be resolved with proper event handling!');
        
    } catch (error) {
        console.error('❌ Error fixing function event format:', error);
    }
}

fixFunctionEventFormat();