// Comprehensive deployment validation script
require('dotenv').config();
const AWS = require('aws-sdk');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Configure AWS
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

async function validateEntireDeploymentWorkflow() {
    console.log('🔍 Comprehensive Deployment Validation\n');
    
    const tenantId = 'himanshubarnwal26_gmail_com-35aebtgz';
    const buildId = '70c6f5ec-a92e-4638-87ad-349f8ffd93d3';
    
    try {
        // 1. Check database records
        console.log('1️⃣ Database Records Check:');
        const build = await prisma.build.findUnique({
            where: { id: buildId },
            include: {
                deployments: true
            }
        });
        
        if (build) {
            console.log(`   ✅ Build found: ${build.status}`);
            console.log(`   📁 Storage Key: ${build.storageKey}`);
            console.log(`   🏗️ Deployments: ${build.deployments.length}`);
            
            build.deployments.forEach((dep, i) => {
                console.log(`      ${i + 1}. Status: ${dep.status}, Notes: ${dep.notes}`);
            });
        } else {
            console.log('   ❌ Build not found');
        }

        // 2. Check S3 bucket structure
        console.log('\n2️⃣ S3 Bucket Analysis:');
        const bucketName = 'user-app-static-sites-uploads';
        const deploymentPrefix = `tenants/${tenantId}/deployments/${buildId}/`;
        
        console.log(`   📦 Bucket: ${bucketName}`);
        console.log(`   📂 Deployment Path: ${deploymentPrefix}`);
        
        // List all objects in the deployment
        const objects = await s3.listObjectsV2({
            Bucket: bucketName,
            Prefix: deploymentPrefix,
            MaxKeys: 50
        }).promise();
        
        console.log(`   📊 Total Files: ${objects.Contents.length}`);
        
        // Categorize files
        const htmlFiles = objects.Contents.filter(obj => obj.Key.endsWith('.html'));
        const cssFiles = objects.Contents.filter(obj => obj.Key.endsWith('.css'));
        const jsFiles = objects.Contents.filter(obj => obj.Key.endsWith('.js'));
        const imageFiles = objects.Contents.filter(obj => /\.(png|jpg|jpeg|gif|svg|ico)$/i.test(obj.Key));
        const manifestFiles = objects.Contents.filter(obj => obj.Key.includes('manifest'));
        const cacheFiles = objects.Contents.filter(obj => obj.Key.includes('cache/'));
        
        console.log(`   📄 HTML files: ${htmlFiles.length}`);
        console.log(`   🎨 CSS files: ${cssFiles.length}`);
        console.log(`   ⚡ JS files: ${jsFiles.length}`);
        console.log(`   🖼️ Image files: ${imageFiles.length}`);
        console.log(`   📋 Manifest files: ${manifestFiles.length}`);
        console.log(`   💾 Cache files: ${cacheFiles.length}`);
        
        // Check for critical files
        const hasIndexHtml = htmlFiles.some(f => f.Key.endsWith('index.html'));
        const hasRootIndex = objects.Contents.some(f => f.Key === deploymentPrefix + 'index.html');
        
        console.log(`   🏠 Has index.html: ${hasIndexHtml ? '✅' : '❌'}`);
        console.log(`   🎯 Root index.html: ${hasRootIndex ? '✅' : '❌'}`);
        
        if (htmlFiles.length > 0) {
            console.log('   📝 HTML Files:');
            htmlFiles.slice(0, 5).forEach(file => {
                console.log(`      - ${file.Key.replace(deploymentPrefix, '')}`);
            });
        }

        // 3. Check CloudFront distribution
        console.log('\n3️⃣ CloudFront Distribution:');
        const distribution = await cloudfront.getDistribution({
            Id: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID
        }).promise();
        
        console.log(`   🌐 Domain: ${distribution.Distribution.DomainName}`);
        console.log(`   📊 Status: ${distribution.Distribution.Status}`);
        console.log(`   🔗 Origin: ${distribution.Distribution.DistributionConfig.Origins.Items[0].DomainName}`);

        // 4. Test URL generation
        console.log('\n4️⃣ URL Generation Test:');
        const expectedUrl = `https://${process.env.CLOUDFRONT_DOMAIN}/tenants/${tenantId}/deployments/${buildId}`;
        console.log(`   🎯 Expected URL: ${expectedUrl}`);
        
        // 5. Check CloudFront cache invalidations
        console.log('\n5️⃣ CloudFront Cache Status:');
        const invalidations = await cloudfront.listInvalidations({
            DistributionId: process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID,
            MaxItems: '3'
        }).promise();
        
        invalidations.InvalidationList.Items.forEach((inv, i) => {
            console.log(`   ${i + 1}. ${inv.Id} - ${inv.Status} (${new Date(inv.CreateTime).toLocaleString()})`);
        });

        // 6. Diagnosis and recommendations
        console.log('\n6️⃣ Diagnosis & Recommendations:');
        
        if (cacheFiles.length > 0 && htmlFiles.length === 0) {
            console.log('   ❌ ISSUE: Only build artifacts uploaded, no static HTML files');
            console.log('   💡 SOLUTION: Static export failed - Next.js config needed');
            console.log('   🔧 FIX: Add output: "export" to next.config.js');
        } else if (htmlFiles.length > 0) {
            console.log('   ✅ Static files found - deployment should work');
        }
        
        if (!hasRootIndex && htmlFiles.length > 0) {
            console.log('   ⚠️ WARNING: No root index.html - might need trailing slash');
            console.log('   💡 SOLUTION: Ensure trailingSlash: true in next.config.js');
        }

        console.log('\n✅ Validation Complete!');
        
    } catch (error) {
        console.error('❌ Validation Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

validateEntireDeploymentWorkflow();