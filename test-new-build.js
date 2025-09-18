// Test a new build with fixed static export
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const buildService = require('./src/services/buildService');

const prisma = new PrismaClient();

async function testFixedBuild() {
    console.log('🧪 Testing Fixed Build Process with Static Export\n');
    
    try {
        // Get the tenant and existing build
        const tenantId = 'himanshubarnwal26_gmail_com-35aebtgz';
        
        // Find the latest build for this tenant
        const latestBuild = await prisma.build.findFirst({
            where: { tenantId },
            orderBy: { createdAt: 'desc' }
        });

        if (!latestBuild) {
            console.log('❌ No previous build found');
            return;
        }

        console.log('📊 Latest Build Info:');
        console.log(`   Build ID: ${latestBuild.id}`);
        console.log(`   Status: ${latestBuild.status}`);
        console.log(`   Storage Key: ${latestBuild.storageKey}`);
        console.log(`   Created: ${latestBuild.createdAt}`);

        // Create a new build for testing the fix
        console.log('\n🔄 Creating new build to test static export fix...');
        
        const newBuild = await prisma.build.create({
            data: {
                tenantId: tenantId,
                userId: latestBuild.userId,
                storageKey: latestBuild.storageKey, // Reuse the same source
                status: 'pending',
                buildConfig: latestBuild.buildConfig || {},
                notes: 'Testing static export fix'
            }
        });

        console.log(`✅ New build created: ${newBuild.id}`);

        // Queue the build
        console.log('\n⚡ Queueing build with fixed static export...');
        await buildService.queueBuild({
            buildId: newBuild.id,
            tenantId: tenantId,
            userId: latestBuild.userId,
            storageKey: latestBuild.storageKey,
            buildConfig: latestBuild.buildConfig || {}
        });

        console.log('✅ Build queued successfully!');
        console.log('\n📝 Monitor the build progress in the logs...');
        console.log(`   Build ID: ${newBuild.id}`);
        console.log(`   Expected URL: https://d2hvyig9aqs577.cloudfront.net/tenants/${tenantId}/deployments/${newBuild.id}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        await prisma.$disconnect();
    }
}

testFixedBuild();