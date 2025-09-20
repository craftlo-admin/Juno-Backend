#!/usr/bin/env node

require('dotenv').config();
const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

const s3 = new AWS.S3();

async function checkCurrentDirectory() {
  console.log('🔍 Checking S3 /current/ Directory Structure');
  console.log('='.repeat(50));

  const testTenantId = 'himanshus-organization-clql5u68';
  const bucket = process.env.AWS_S3_BUCKET_STATIC;

  console.log(`📋 Configuration:`);
  console.log(`   Bucket: ${bucket}`);
  console.log(`   Tenant: ${testTenantId}`);

  try {
    // Check if /current/ directory exists
    const currentPrefix = `tenants/${testTenantId}/deployments/current/`;
    console.log(`\n📁 Checking: ${currentPrefix}`);

    const currentObjects = await s3.listObjectsV2({
      Bucket: bucket,
      Prefix: currentPrefix,
      MaxKeys: 10
    }).promise();

    if (currentObjects.Contents.length > 0) {
      console.log(`✅ /current/ directory exists with ${currentObjects.Contents.length} files:`);
      currentObjects.Contents.forEach(obj => {
        console.log(`   📄 ${obj.Key} (${obj.Size} bytes)`);
      });
    } else {
      console.log(`❌ /current/ directory is EMPTY or doesn't exist!`);
    }

    // Check versioned directories
    const deploymentsPrefix = `tenants/${testTenantId}/deployments/`;
    console.log(`\n📂 Checking all deployments: ${deploymentsPrefix}`);

    const allObjects = await s3.listObjectsV2({
      Bucket: bucket,
      Prefix: deploymentsPrefix,
      MaxKeys: 20
    }).promise();

    if (allObjects.Contents.length > 0) {
      console.log(`📋 Found ${allObjects.Contents.length} objects in deployments:`);
      
      // Group by directory
      const directories = {};
      allObjects.Contents.forEach(obj => {
        const parts = obj.Key.split('/');
        if (parts.length >= 5) { // tenants/tenant/deployments/version/file
          const version = parts[3];
          if (!directories[version]) directories[version] = [];
          directories[version].push(obj.Key);
        }
      });

      Object.keys(directories).forEach(version => {
        console.log(`   📁 ${version}/ (${directories[version].length} files)`);
        if (version === 'current') {
          console.log(`      ✅ CURRENT DIRECTORY EXISTS!`);
        }
      });
      
      if (!directories['current']) {
        console.log(`   ❌ NO CURRENT DIRECTORY FOUND!`);
        console.log(`   Available versions: ${Object.keys(directories).filter(v => v !== 'current').join(', ')}`);
      }
    } else {
      console.log(`❌ No deployment files found for tenant!`);
    }

    // Check if CloudFront Function would find the file
    const testUrl = `/tenants/${testTenantId}/deployments/current/index.html`;
    console.log(`\n🌐 CloudFront Function expects: ${testUrl}`);
    
    try {
      const testObject = await s3.headObject({
        Bucket: bucket,
        Key: `tenants/${testTenantId}/deployments/current/index.html`
      }).promise();
      
      console.log(`✅ index.html found in /current/ directory!`);
      console.log(`   Size: ${testObject.ContentLength} bytes`);
      console.log(`   Type: ${testObject.ContentType}`);
    } catch (headError) {
      console.log(`❌ index.html NOT found in /current/ directory!`);
      console.log(`   This is why CloudFront returns 503 error`);
    }

  } catch (error) {
    console.error('❌ Failed to check S3 structure:', error.message);
  }
}

checkCurrentDirectory();