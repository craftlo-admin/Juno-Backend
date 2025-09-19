require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

async function checkAndFixS3Permissions() {
  const bucketName = process.env.AWS_S3_BUCKET_STATIC;
  
  try {
    console.log(`🔍 Checking S3 bucket: ${bucketName}`);
    
    // Check if bucket exists and we have access
    try {
      await s3.headBucket({ Bucket: bucketName }).promise();
      console.log('✅ Bucket exists and accessible');
    } catch (error) {
      console.error('❌ Cannot access bucket:', error.message);
      return;
    }
    
    // Check bucket policy
    try {
      const policy = await s3.getBucketPolicy({ Bucket: bucketName }).promise();
      console.log('📋 Current bucket policy exists');
      console.log(policy.Policy);
    } catch (error) {
      if (error.code === 'NoSuchBucketPolicy') {
        console.log('ℹ️ No bucket policy exists - need to create one');
      } else {
        console.error('❌ Error checking bucket policy:', error.message);
      }
    }
    
    // Set public read policy for static website hosting
    const publicReadPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketName}/*`
        }
      ]
    };
    
    console.log('\n🔧 Setting public read policy...');
    
    try {
      await s3.putBucketPolicy({
        Bucket: bucketName,
        Policy: JSON.stringify(publicReadPolicy)
      }).promise();
      
      console.log('✅ Public read policy applied successfully');
    } catch (error) {
      console.error('❌ Failed to set bucket policy:', error.message);
      
      if (error.message.includes('block public access')) {
        console.log('\n💡 The bucket has "Block Public Access" enabled.');
        console.log('You need to:');
        console.log('1. Go to AWS S3 Console');
        console.log(`2. Select bucket: ${bucketName}`);
        console.log('3. Go to Permissions tab');
        console.log('4. Edit "Block public access" settings');
        console.log('5. Uncheck "Block all public access"');
        console.log('6. Save changes');
        console.log('7. Then run this script again');
      }
    }
    
    // Check if files exist for the tenant
    console.log('\n🔍 Checking uploaded files...');
    
    const tenantPrefix = 'tenants/himanshus-organization-bj3y65eh/builds/524b2a9e-4a46-4548-beb2-b6355024e636/';
    
    try {
      const objects = await s3.listObjectsV2({
        Bucket: bucketName,
        Prefix: tenantPrefix,
        MaxKeys: 10
      }).promise();
      
      if (objects.Contents && objects.Contents.length > 0) {
        console.log(`✅ Found ${objects.Contents.length} files for this build:`);
        objects.Contents.forEach(obj => {
          console.log(`   📄 ${obj.Key}`);
        });
        
        // Test direct S3 access to index.html
        const indexKey = tenantPrefix + 'index.html';
        const indexExists = objects.Contents.find(obj => obj.Key === indexKey);
        
        if (indexExists) {
          console.log(`\n🧪 Testing direct S3 access to index.html:`);
          console.log(`https://${bucketName}.s3.amazonaws.com/${indexKey}`);
        }
        
      } else {
        console.log('❌ No files found for this build');
      }
      
    } catch (error) {
      console.error('❌ Error checking files:', error.message);
    }
    
  } catch (error) {
    console.error('❌ General error:', error.message);
  }
}

checkAndFixS3Permissions();