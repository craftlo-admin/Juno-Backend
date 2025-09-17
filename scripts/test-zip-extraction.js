const fs = require('fs').promises;
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Test ZIP extraction functionality
 * This script tests ZIP file extraction capabilities that replaced RAR processing
 */

async function testZipExtraction() {
  console.log('🧪 Testing ZIP Extraction Functionality');
  console.log('=====================================');
  
  const testDir = path.join(__dirname, '..', 'temp', 'zip-test');
  
  try {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
    console.log('✅ Test directory created');
    
    // Test 1: Basic ZIP validation
    console.log('\n📋 Test 1: ZIP File Validation');
    await testZipValidation();
    
    // Test 2: ZIP extraction
    console.log('\n📋 Test 2: ZIP Extraction');
    await testZipExtractionProcess(testDir);
    
    console.log('\n🎉 All ZIP tests completed successfully!');
    
  } catch (error) {
    console.error('❌ ZIP test failed:', error.message);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await fs.rmdir(testDir, { recursive: true });
      console.log('🧹 Test directory cleaned up');
    } catch (cleanupError) {
      console.warn('⚠️ Cleanup warning:', cleanupError.message);
    }
  }
}

async function testZipValidation() {
  try {
    // Test ZIP validation function (basic implementation)
    console.log('  • Testing ZIP file validation...');
    
    // This would test the validateZipFile function from buildService
    // For now, just test basic ZIP file handling
    const testZip = new AdmZip();
    testZip.addFile('test.txt', Buffer.from('Hello ZIP world!'));
    
    const zipBuffer = testZip.toBuffer();
    console.log(`  • Created test ZIP: ${zipBuffer.length} bytes`);
    
    // Test reading ZIP
    const readZip = new AdmZip(zipBuffer);
    const entries = readZip.getEntries();
    console.log(`  • ZIP contains ${entries.length} entries`);
    
    if (entries.length > 0) {
      console.log(`  • First entry: ${entries[0].entryName}`);
    }
    
    console.log('  ✅ ZIP validation test passed');
    
  } catch (error) {
    console.error('  ❌ ZIP validation test failed:', error.message);
    throw error;
  }
}

async function testZipExtractionProcess(testDir) {
  try {
    console.log('  • Creating test ZIP file...');
    
    // Create a test ZIP with sample Next.js structure
    const zip = new AdmZip();
    
    // Add package.json
    const packageJson = {
      name: 'test-nextjs-app',
      version: '1.0.0',
      scripts: {
        build: 'next build',
        start: 'next start'
      },
      dependencies: {
        next: '^13.0.0',
        react: '^18.0.0',
        'react-dom': '^18.0.0'
      }
    };
    zip.addFile('package.json', Buffer.from(JSON.stringify(packageJson, null, 2)));
    
    // Add pages/index.js
    const indexPage = `
export default function Home() {
  return (
    <div>
      <h1>Test Next.js App</h1>
      <p>This is a test application for ZIP extraction.</p>
    </div>
  );
}
`;
    zip.addFile('pages/index.js', Buffer.from(indexPage));
    
    // Add next.config.js
    const nextConfig = `
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: false
  }
}

module.exports = nextConfig
`;
    zip.addFile('next.config.js', Buffer.from(nextConfig));
    
    // Save test ZIP
    const testZipPath = path.join(testDir, 'test-project.zip');
    await fs.writeFile(testZipPath, zip.toBuffer());
    console.log(`  • Test ZIP created: ${testZipPath}`);
    
    // Test extraction
    console.log('  • Testing ZIP extraction...');
    const extractDir = path.join(testDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    
    const extractZip = new AdmZip(testZipPath);
    extractZip.extractAllTo(extractDir, true);
    
    // Verify extracted files
    const extractedFiles = await fs.readdir(extractDir);
    console.log(`  • Extracted ${extractedFiles.length} items:`, extractedFiles);
    
    // Check for expected files
    const expectedFiles = ['package.json', 'pages', 'next.config.js'];
    for (const expectedFile of expectedFiles) {
      try {
        await fs.access(path.join(extractDir, expectedFile));
        console.log(`    ✅ Found: ${expectedFile}`);
      } catch {
        throw new Error(`Missing expected file: ${expectedFile}`);
      }
    }
    
    console.log('  ✅ ZIP extraction test passed');
    
  } catch (error) {
    console.error('  ❌ ZIP extraction test failed:', error.message);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testZipExtraction().catch(error => {
    console.error('Test suite failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testZipExtraction,
  testZipValidation,
  testZipExtractionProcess
};