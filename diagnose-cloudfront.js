// Check S3 bucket configuration and CloudFront setup
require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

async function diagnoseBucketCloudFrontIssue() {
    console.log('🔍 Diagnosing S3/CloudFront Configuration\n');
    
    try {
        // 1. Check S3 bucket location
        console.log('1️⃣ S3 Bucket Configuration:');
        const bucketName = 'user-app-static-sites-uploads';
        
        const bucketLocation = await s3.getBucketLocation({ Bucket: bucketName }).promise();
        console.log(`   📍 Bucket Region: ${bucketLocation.LocationConstraint || 'us-east-1'}`);
        console.log(`   🌍 Our AWS Region: ${process.env.AWS_REGION}`);
        
        // Check bucket policy and CORS
        try {
            const bucketPolicy = await s3.getBucketPolicy({ Bucket: bucketName }).promise();
            console.log('   📋 Bucket Policy: Exists');
        } catch (err) {
            console.log('   📋 Bucket Policy: None');
        }
        
        try {
            const corsConfig = await s3.getBucketCors({ Bucket: bucketName }).promise();
            console.log('   🌐 CORS Config: Exists');
        } catch (err) {
            console.log('   🌐 CORS Config: None');
        }

        // 2. Check CloudFront distribution details
        console.log('\n2️⃣ CloudFront Distribution:');
        const distribution = await cloudfront.getDistribution({
            Id: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
        }).promise();
        
        const config = distribution.Distribution.DistributionConfig;
        const origin = config.Origins.Items[0];
        
        console.log(`   🏷️ Distribution ID: ${distribution.Distribution.Id}`);
        console.log(`   🌐 Domain: ${distribution.Distribution.DomainName}`);
        console.log(`   📊 Status: ${distribution.Distribution.Status}`);
        console.log(`   ✅ Enabled: ${config.Enabled}`);
        console.log(`   📡 Origin Domain: ${origin.DomainName}`);
        console.log(`   📂 Origin Path: ${origin.OriginPath || '(none)'}`);
        console.log(`   🔑 Origin ID: ${origin.Id}`);
        
        // Check default cache behavior
        const defaultBehavior = config.DefaultCacheBehavior;
        console.log(`   🎯 Target Origin: ${defaultBehavior.TargetOriginId}`);
        console.log(`   👀 Viewer Protocol: ${defaultBehavior.ViewerProtocolPolicy}`);
        console.log(`   📝 Methods: ${defaultBehavior.AllowedMethods?.Items?.join(', ') || 'GET, HEAD'}`);

        // 3. Test direct S3 access
        console.log('\n3️⃣ Direct S3 Access Test:');
        const testKey = 'tenants/himanshubarnwal26_gmail_com-35aebtgz/deployments/70c6f5ec-a92e-4638-87ad-349f8ffd93d3/server/app/index.html';
        
        try {
            const headResult = await s3.headObject({
                Bucket: bucketName,
                Key: testKey
            }).promise();
            
            console.log(`   ✅ File exists: ${headResult.ContentLength} bytes`);
            console.log(`   📄 Content-Type: ${headResult.ContentType}`);
            console.log(`   🔒 ACL: ${headResult.Metadata?.acl || 'Unknown'}`);
            
            // Test if file is publicly accessible
            const s3Url = `https://${bucketName}.s3.${bucketLocation.LocationConstraint || 'us-east-1'}.amazonaws.com/${testKey}`;
            console.log(`   🌐 Direct S3 URL: ${s3Url}`);
            
        } catch (err) {
            console.log(`   ❌ File access error: ${err.message}`);
        }

        // 4. Identify the issue
        console.log('\n4️⃣ Issue Analysis:');
        
        const bucketRegion = bucketLocation.LocationConstraint || 'us-east-1';
        const expectedOrigin = `${bucketName}.s3.${bucketRegion}.amazonaws.com`;
        
        if (origin.DomainName !== expectedOrigin) {
            console.log(`   ⚠️ ISSUE: Origin domain mismatch`);
            console.log(`   📍 Current: ${origin.DomainName}`);
            console.log(`   ✅ Expected: ${expectedOrigin}`);
            console.log(`   💡 SOLUTION: Update CloudFront origin to correct regional endpoint`);
        } else {
            console.log(`   ✅ Origin domain is correct`);
        }

        // Check if it's a redirect issue
        if (bucketRegion !== 'us-east-1' && origin.DomainName.includes('.s3.amazonaws.com')) {
            console.log(`   ⚠️ ISSUE: Using generic S3 endpoint for non-us-east-1 bucket`);
            console.log(`   💡 SOLUTION: Use regional endpoint ${expectedOrigin}`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

diagnoseBucketCloudFrontIssue();