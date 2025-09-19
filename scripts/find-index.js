require('dotenv').config();
const AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

async function findIndexFile() {
  const bucketName = process.env.AWS_S3_BUCKET_STATIC;
  const prefix = 'tenants/himanshus-organization-bj3y65eh/deployments/524b2a9e-4a46-4548-beb2-b6355024e636/';
  
  try {
    const objects = await s3.listObjectsV2({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 100
    }).promise();
    
    console.log('🔍 Looking for index.html files...');
    
    const indexFiles = objects.Contents.filter(obj => 
      obj.Key.includes('index.html')
    );
    
    if (indexFiles.length > 0) {
      console.log(`✅ Found ${indexFiles.length} index.html files:`);
      indexFiles.forEach(file => {
        console.log(`   📄 ${file.Key}`);
        
        // Test URLs
        const s3Url = `https://${bucketName}.s3.amazonaws.com/${file.Key}`;
        const pathAfterTenant = file.Key.replace(`tenants/himanshus-organization-bj3y65eh/`, '');
        const cloudfrontUrl = `https://d24nen47hvpejf.cloudfront.net/${pathAfterTenant}`;
        
        console.log(`   🔗 S3 Direct: ${s3Url}`);
        console.log(`   ☁️ CloudFront: ${cloudfrontUrl}`);
        console.log('');
      });
    }
    
    // Also look for the main index.html
    const mainIndex = objects.Contents.find(obj => 
      obj.Key === prefix + 'index.html'
    );
    
    if (mainIndex) {
      console.log('🎯 Found main index.html!');
      const s3Url = `https://${bucketName}.s3.amazonaws.com/${mainIndex.Key}`;
      const pathAfterTenant = mainIndex.Key.replace(`tenants/himanshus-organization-bj3y65eh/`, '');
      const cloudfrontUrl = `https://d24nen47hvpejf.cloudfront.net/${pathAfterTenant}`;
      
      console.log(`📄 File: ${mainIndex.Key}`);
      console.log(`🔗 S3 Direct: ${s3Url}`);
      console.log(`☁️ CloudFront: ${cloudfrontUrl}`);
    } else {
      console.log('❌ No main index.html found in root of build');
      
      // List all files to see what's there
      console.log('\n📋 All files in build:');
      objects.Contents.forEach(obj => {
        const fileName = obj.Key.replace(prefix, '');
        console.log(`   📄 ${fileName}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findIndexFile();