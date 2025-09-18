// Test CloudFront Configuration
require('dotenv').config();
const AWS = require('aws-sdk');

async function testCloudFrontConfig() {
    console.log('🔍 Checking CloudFront Configuration...\n');
    
    // Configure AWS
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION
    });

    const cloudfront = new AWS.CloudFront();
    const s3 = new AWS.S3();

    try {
        // Check CloudFront distribution
        console.log('📊 CloudFront Distribution Details:');
        const distribution = await cloudfront.getDistribution({
            Id: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
        }).promise();

        console.log(`   ID: ${distribution.Distribution.Id}`);
        console.log(`   Domain: ${distribution.Distribution.DomainName}`);
        console.log(`   Status: ${distribution.Distribution.Status}`);
        console.log(`   Enabled: ${distribution.Distribution.DistributionConfig.Enabled}`);
        
        const origin = distribution.Distribution.DistributionConfig.Origins.Items[0];
        console.log(`   Origin Domain: ${origin.DomainName}`);
        console.log(`   Origin Path: ${origin.OriginPath || '(none)'}`);

        // Check S3 bucket files
        console.log('\n📁 S3 Bucket Content Check:');
        const bucketName = 'user-app-static-sites-uploads';
        const prefix = 'tenants/himanshubarnwal26_gmail_com-35aebtgz/deployments/70c6f5ec-a92e-4638-87ad-349f8ffd93d3/';
        
        const objects = await s3.listObjectsV2({
            Bucket: bucketName,
            Prefix: prefix,
            MaxKeys: 10
        }).promise();

        console.log(`   Bucket: ${bucketName}`);
        console.log(`   Prefix: ${prefix}`);
        console.log(`   Files found: ${objects.Contents.length}`);
        
        objects.Contents.forEach((obj, i) => {
            console.log(`   ${i + 1}. ${obj.Key} (${obj.Size} bytes)`);
        });

        // Test direct S3 access
        console.log('\n🌐 Testing Direct S3 Access:');
        try {
            const indexKey = prefix + 'index.html';
            const headResult = await s3.headObject({
                Bucket: bucketName,
                Key: indexKey
            }).promise();
            console.log(`   ✅ index.html exists: ${headResult.ContentLength} bytes`);
            console.log(`   Content-Type: ${headResult.ContentType}`);
        } catch (err) {
            console.log(`   ❌ index.html not found: ${err.message}`);
        }

        // Check CloudFront cache invalidations
        console.log('\n🔄 Recent CloudFront Invalidations:');
        const invalidations = await cloudfront.listInvalidations({
            DistributionId: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID,
            MaxItems: '5'
        }).promise();

        invalidations.InvalidationList.Items.forEach((inv, i) => {
            console.log(`   ${i + 1}. ${inv.Id} - ${inv.Status} (${new Date(inv.CreateTime).toLocaleString()})`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testCloudFrontConfig();