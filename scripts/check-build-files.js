require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

async function checkBuildFiles() {
  const bucketName = process.env.AWS_S3_BUCKET_STATIC;
  const buildId = '524b2a9e-4a46-4548-beb2-b6355024e636';
  const tenantId = 'himanshus-organization-bj3y65eh';
  
  console.log(`🔍 Checking build files in bucket: ${bucketName}`);
  console.log(`Build ID: ${buildId}`);
  console.log(`Tenant ID: ${tenantId}`);
  
  // Check multiple possible paths where files might be uploaded
  const possiblePaths = [
    `tenants/${tenantId}/builds/${buildId}/`,
    `tenants/${tenantId}/deployments/${buildId}/`,
    `deployments/${buildId}/`,
    `builds/${buildId}/`,
    `${buildId}/`
  ];
  
  for (const prefix of possiblePaths) {
    console.log(`\n📂 Checking path: ${prefix}`);
    
    try {
      const objects = await s3.listObjectsV2({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 20
      }).promise();
      
      if (objects.Contents && objects.Contents.length > 0) {
        console.log(`✅ Found ${objects.Contents.length} files:`);
        objects.Contents.forEach(obj => {
          console.log(`   📄 ${obj.Key} (${obj.Size} bytes)`);
        });
        
        // Test direct access to index.html
        const indexFile = objects.Contents.find(obj => obj.Key.endsWith('index.html'));
        if (indexFile) {
          const directUrl = `https://${bucketName}.s3.amazonaws.com/${indexFile.Key}`;
          console.log(`\n🧪 Direct S3 URL for index.html:`);
          console.log(directUrl);
          
          // Also show the CloudFront URL
          const cloudfrontUrl = `https://d24nen47hvpejf.cloudfront.net/${indexFile.Key.replace(prefix, '')}`;
          console.log(`\n🌐 CloudFront URL (with correct path):`);
          console.log(cloudfrontUrl);
        }
        
        break; // Found files, no need to check other paths
      } else {
        console.log(`❌ No files found in this path`);
      }
      
    } catch (error) {
      console.error(`❌ Error checking path ${prefix}:`, error.message);
    }
  }
  
  // Also check pointers
  console.log(`\n📍 Checking version pointer:`);
  try {
    const pointerKey = `pointers/${tenantId}/current.json`;
    const pointer = await s3.getObject({
      Bucket: bucketName,
      Key: pointerKey
    }).promise();
    
    const pointerData = JSON.parse(pointer.Body.toString());
    console.log(`✅ Version pointer found:`, pointerData);
    
  } catch (error) {
    console.log(`❌ No version pointer found: ${error.message}`);
  }
}

checkBuildFiles();