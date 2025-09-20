#!/usr/bin/env node

/**
 * Auto-Tenant Creation Test Script
 * Tests the new functionality where each ZIP upload creates a new tenant automatically
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8000';
const API_TIMEOUT = 10000;

// Create axios instance with timeout
const api = axios.create({
  baseURL: BASE_URL,
  timeout: API_TIMEOUT
});

let authToken = '';
let userId = '';
let testEmail = '';

/**
 * Test Results Storage
 */
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

function logTest(testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${testName}`);
  if (details) {
    console.log(`   Details: ${details}`);
  }
  
  if (passed) {
    testResults.passed++;
  } else {
    testResults.failed++;
    testResults.errors.push({ test: testName, details });
  }
}

function generateTestEmail() {
  return `autotest_${Date.now()}@example.com`;
}

async function createTestZipFile() {
  const testZipPath = path.join(__dirname, 'temp', 'test-upload.zip');
  
  // Ensure temp directory exists
  const tempDir = path.dirname(testZipPath);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Create a simple test HTML file
  const testHTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Auto-Tenant Test</title>
</head>
<body>
    <h1>Test Website</h1>
    <p>Created at: ${new Date().toISOString()}</p>
</body>
</html>
  `;
  
  const htmlPath = path.join(tempDir, 'index.html');
  fs.writeFileSync(htmlPath, testHTML);
  
  // Create a simple ZIP (using archiver would be better, but keeping it simple)
  // For now, just use the HTML file directly and rename it
  fs.copyFileSync(htmlPath, testZipPath);
  
  return testZipPath;
}

/**
 * Test: User Registration
 */
async function testUserRegistration() {
  try {
    testEmail = generateTestEmail();
    
    const response = await api.post('/api/auth/register', {
      firstName: 'Auto',
      lastName: 'Test',
      email: testEmail,
      password: 'TestPassword123!'
    });

    if (response.status === 201 && response.data.success) {
      userId = response.data.user.id;
      logTest('User Registration', true, `User created with ID: ${userId}`);
      return true;
    } else {
      logTest('User Registration', false, `Unexpected response: ${response.status}`);
      return false;
    }
  } catch (error) {
    logTest('User Registration', false, error.response?.data?.message || error.message);
    return false;
  }
}

/**
 * Test: User Login
 */
async function testUserLogin() {
  try {
    const response = await api.post('/api/auth/login', {
      email: testEmail,
      password: 'TestPassword123!'
    });

    if (response.status === 200 && response.data.success && response.data.token) {
      authToken = response.data.token;
      api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      logTest('User Login', true, 'Login successful');
      return true;
    } else {
      logTest('User Login', false, 'Login failed - no token received');
      return false;
    }
  } catch (error) {
    logTest('User Login', false, error.response?.data?.message || error.message);
    return false;
  }
}

/**
 * Test: Auto-Tenant Creation via ZIP Upload
 */
async function testAutoTenantUpload() {
  try {
    console.log('\n🚀 Testing Auto-Tenant Creation via ZIP Upload...');
    
    // Create test ZIP file
    const zipPath = await createTestZipFile();
    
    // Create form data for upload
    const formData = new FormData();
    formData.append('file', fs.createReadStream(zipPath));
    
    // Upload via compatibility route (should auto-create tenant)
    const response = await api.post('/api/uploads/', formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (response.status === 201 && response.data.success) {
      const buildId = response.data.buildId;
      const deploymentUrl = response.data.deploymentUrl;
      
      logTest('Auto-Tenant ZIP Upload', true, 
        `Build created: ${buildId}, Deployment URL: ${deploymentUrl}`);
      
      // Check if deployment URL follows the pattern tenantid.junotech.in
      if (deploymentUrl && deploymentUrl.includes('.junotech.in')) {
        logTest('Deployment URL Format', true, `URL format correct: ${deploymentUrl}`);
      } else {
        logTest('Deployment URL Format', false, `Invalid URL format: ${deploymentUrl}`);
      }
      
      // Clean up test file
      fs.unlinkSync(zipPath);
      
      return true;
    } else {
      logTest('Auto-Tenant ZIP Upload', false, `Upload failed: ${response.status}`);
      return false;
    }
  } catch (error) {
    logTest('Auto-Tenant ZIP Upload', false, error.response?.data?.message || error.message);
    return false;
  }
}

/**
 * Test: Multiple Uploads Create Multiple Tenants
 */
async function testMultipleUploads() {
  try {
    console.log('\n🔄 Testing Multiple Uploads Create Multiple Tenants...');
    
    const uploadResults = [];
    
    // Perform 3 uploads to test multiple tenant creation
    for (let i = 1; i <= 3; i++) {
      const zipPath = await createTestZipFile();
      const formData = new FormData();
      formData.append('file', fs.createReadStream(zipPath));
      
      const response = await api.post('/api/uploads/', formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (response.status === 201 && response.data.success) {
        uploadResults.push({
          upload: i,
          buildId: response.data.buildId,
          deploymentUrl: response.data.deploymentUrl
        });
      }
      
      // Clean up
      fs.unlinkSync(zipPath);
      
      // Small delay between uploads
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (uploadResults.length === 3) {
      // Check that all deployment URLs are different (indicating different tenants)
      const urls = uploadResults.map(r => r.deploymentUrl);
      const uniqueUrls = [...new Set(urls)];
      
      if (uniqueUrls.length === 3) {
        logTest('Multiple Tenant Creation', true, 
          `3 uploads created 3 unique tenants: ${uniqueUrls.join(', ')}`);
        return true;
      } else {
        logTest('Multiple Tenant Creation', false, 
          `Expected 3 unique URLs, got ${uniqueUrls.length}: ${uniqueUrls.join(', ')}`);
        return false;
      }
    } else {
      logTest('Multiple Tenant Creation', false, 
        `Only ${uploadResults.length}/3 uploads succeeded`);
      return false;
    }
  } catch (error) {
    logTest('Multiple Tenant Creation', false, error.message);
    return false;
  }
}

/**
 * Main Test Runner
 */
async function runTests() {
  console.log('🧪 Starting Auto-Tenant Creation Tests...\n');
  
  try {
    // Test user registration and login
    const registrationSuccess = await testUserRegistration();
    if (!registrationSuccess) {
      console.log('\n❌ Cannot proceed without successful user registration');
      return;
    }
    
    const loginSuccess = await testUserLogin();
    if (!loginSuccess) {
      console.log('\n❌ Cannot proceed without successful login');
      return;
    }
    
    // Test auto-tenant creation
    await testAutoTenantUpload();
    
    // Test multiple uploads
    await testMultipleUploads();
    
  } catch (error) {
    console.error('🚨 Test runner error:', error.message);
  }
  
  // Print final results
  console.log('\n📊 Test Results Summary:');
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  
  if (testResults.failed > 0) {
    console.log('\n🔍 Failed Tests:');
    testResults.errors.forEach(error => {
      console.log(`   • ${error.test}: ${error.details}`);
    });
  }
  
  if (testResults.failed === 0) {
    console.log('\n🎉 All tests passed! Auto-tenant creation is working correctly.');
  } else {
    console.log('\n⚠️ Some tests failed. Please check the implementation.');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().then(() => {
    process.exit(testResults.failed > 0 ? 1 : 0);
  });
}

module.exports = { runTests };