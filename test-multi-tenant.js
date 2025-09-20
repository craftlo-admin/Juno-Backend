#!/usr/bin/env node

/**
 * Multi-Tenant Architecture Test Script
 * Tests all critical functionalities after the architectural changes
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:8000';
const API_TIMEOUT = 5000;

// Create axios instance with timeout
const api = axios.create({
  baseURL: BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json'
  }
});

let authToken = '';
let userId = '';
let testTenantIds = [];

/**
 * Test Results Storage
 */
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

/**
 * Utility Functions
 */
function generateTestEmail() {
  return `test_${Date.now()}@example.com`;
}

function generateTenantName() {
  return `Test Tenant ${Date.now()}`;
}

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
    testResults.errors.push(`${testName}: ${details}`);
  }
}

function logSection(sectionName) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🧪 ${sectionName}`);
  console.log(`${'='.repeat(50)}`);
}

/**
 * Test Functions
 */

async function testServerHealth() {
  logSection('SERVER HEALTH CHECK');
  
  try {
    const response = await api.get('/health');
    const isHealthy = response.status === 200 && response.data;
    
    logTest('Server Health Check', isHealthy, 
      isHealthy ? 'Server is running and healthy' : 'Server not responding properly');
    
    if (isHealthy) {
      console.log(`   Server Response: ${JSON.stringify(response.data, null, 2)}`);
    }
    
    return isHealthy;
  } catch (error) {
    logTest('Server Health Check', false, `Error: ${error.message}`);
    return false;
  }
}

async function testUserRegistration() {
  logSection('USER REGISTRATION WITHOUT AUTO-TENANT');
  
  const testEmail = generateTestEmail();
  const testData = {
    email: testEmail,
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'User'
  };
  
  try {
    const response = await api.post('/api/auth/register', testData);
    const registrationSuccess = response.status === 200 || response.status === 201;
    
    logTest('User Registration Request', registrationSuccess, 
      registrationSuccess ? 'Registration request processed' : 'Registration failed');
    
    if (registrationSuccess && response.data) {
      console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);
      
      // Check if user was registered without auto-creating tenant
      const hasNoAutoTenant = !response.data.tenantId && !response.data.tenant;
      logTest('No Auto-Tenant Creation', hasNoAutoTenant,
        hasNoAutoTenant ? 'User registered without automatic tenant creation' : 'Auto-tenant creation detected');
      
      return { success: true, email: testEmail, data: response.data };
    }
    
    return { success: false };
  } catch (error) {
    logTest('User Registration Request', false, `Error: ${error.message}`);
    if (error.response) {
      console.log(`   Error Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false };
  }
}

async function testUserLogin() {
  logSection('USER LOGIN & JWT TOKEN');
  
  // For testing, we'll try with a test account or skip if no registration worked
  const testData = {
    email: 'test@example.com',
    password: 'TestPassword123!'
  };
  
  try {
    const response = await api.post('/api/auth/login', testData);
    const loginSuccess = response.status === 200 && response.data.token;
    
    logTest('User Login Request', loginSuccess,
      loginSuccess ? 'Login successful' : 'Login failed');
    
    if (loginSuccess) {
      authToken = response.data.token;
      userId = response.data.user?.id || response.data.user?.userId;
      
      // Set auth header for future requests
      api.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      
      // Check JWT doesn't contain fixed tenantId
      const hasNoFixedTenant = !response.data.tenantId;
      logTest('JWT Without Fixed Tenant', hasNoFixedTenant,
        hasNoFixedTenant ? 'JWT token does not contain fixed tenantId' : 'JWT contains fixed tenantId (should not)');
      
      console.log(`   User ID: ${userId}`);
      console.log(`   Token received: ${authToken ? 'Yes' : 'No'}`);
      
      return true;
    }
    
    return false;
  } catch (error) {
    logTest('User Login Request', false, `Error: ${error.message}`);
    if (error.response) {
      console.log(`   Error Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function testTenantCRUD() {
  logSection('TENANT CRUD OPERATIONS');
  
  if (!authToken) {
    logTest('Tenant CRUD - Auth Check', false, 'No auth token available for testing');
    return false;
  }
  
  try {
    // Test: Get user's tenants (should be empty or minimal initially)
    const getUserTenantsResponse = await api.get('/api/tenants');
    const getUserTenantsSuccess = getUserTenantsResponse.status === 200;
    
    logTest('Get User Tenants', getUserTenantsSuccess,
      getUserTenantsSuccess ? `Found ${getUserTenantsResponse.data.length || 0} tenants` : 'Failed to get tenants');
    
    if (getUserTenantsSuccess) {
      console.log(`   Initial Tenants: ${JSON.stringify(getUserTenantsResponse.data, null, 2)}`);
    }
    
    // Test: Create first tenant
    const tenant1Data = {
      name: generateTenantName(),
      description: 'First test tenant for multi-tenant testing'
    };
    
    const createTenant1Response = await api.post('/api/tenants', tenant1Data);
    const createTenant1Success = createTenant1Response.status === 201 && createTenant1Response.data.tenantId;
    
    logTest('Create First Tenant', createTenant1Success,
      createTenant1Success ? `Tenant created: ${createTenant1Response.data.tenantId}` : 'Failed to create tenant');
    
    if (createTenant1Success) {
      testTenantIds.push(createTenant1Response.data.tenantId);
      console.log(`   Tenant 1 ID: ${createTenant1Response.data.tenantId}`);
    }
    
    // Test: Create second tenant
    const tenant2Data = {
      name: generateTenantName(),
      description: 'Second test tenant for multi-tenant testing'
    };
    
    const createTenant2Response = await api.post('/api/tenants', tenant2Data);
    const createTenant2Success = createTenant2Response.status === 201 && createTenant2Response.data.tenantId;
    
    logTest('Create Second Tenant', createTenant2Success,
      createTenant2Success ? `Tenant created: ${createTenant2Response.data.tenantId}` : 'Failed to create second tenant');
    
    if (createTenant2Success) {
      testTenantIds.push(createTenant2Response.data.tenantId);
      console.log(`   Tenant 2 ID: ${createTenant2Response.data.tenantId}`);
    }
    
    // Test: Get user's tenants again (should show multiple)
    const getUserTenantsResponse2 = await api.get('/api/tenants');
    const multiTenantSuccess = getUserTenantsResponse2.status === 200 && 
                              getUserTenantsResponse2.data.length >= 2;
    
    logTest('Multiple Tenants Per User', multiTenantSuccess,
      multiTenantSuccess ? `User now has ${getUserTenantsResponse2.data.length} tenants` : 'Multi-tenant functionality failed');
    
    return createTenant1Success && createTenant2Success;
    
  } catch (error) {
    logTest('Tenant CRUD Operations', false, `Error: ${error.message}`);
    if (error.response) {
      console.log(`   Error Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

async function testTenantAuthentication() {
  logSection('TENANT ACCESS CONTROL');
  
  if (testTenantIds.length === 0) {
    logTest('Tenant Auth - Tenant Check', false, 'No test tenants available');
    return false;
  }
  
  const testTenantId = testTenantIds[0];
  
  try {
    // Test: Access tenant without tenant header (should fail)
    const noTenantResponse = await api.get('/api/storage/list').catch(err => err.response);
    const noTenantBlocked = noTenantResponse && noTenantResponse.status >= 400;
    
    logTest('Block Access Without Tenant Context', noTenantBlocked,
      noTenantBlocked ? 'Request properly blocked without tenant context' : 'Security issue: Request allowed without tenant');
    
    // Test: Access tenant with valid tenant header (should succeed)
    const withTenantResponse = await api.get(`/api/storage/list/${testTenantId}`, {
      headers: {
        'x-tenant-id': testTenantId
      }
    }).catch(err => err.response);
    
    const withTenantAllowed = withTenantResponse && withTenantResponse.status < 400;
    
    logTest('Allow Access With Valid Tenant Context', withTenantAllowed,
      withTenantAllowed ? 'Request allowed with valid tenant context' : 'Valid tenant access blocked');
    
    // Test: Access with invalid tenant ID (should fail)
    const invalidTenantResponse = await api.get('/api/storage/list/invalid-tenant-id', {
      headers: {
        'x-tenant-id': 'invalid-tenant-id'
      }
    }).catch(err => err.response);
    
    const invalidTenantBlocked = invalidTenantResponse && invalidTenantResponse.status >= 400;
    
    logTest('Block Access With Invalid Tenant', invalidTenantBlocked,
      invalidTenantBlocked ? 'Invalid tenant access properly blocked' : 'Security issue: Invalid tenant allowed');
    
    return noTenantBlocked && withTenantAllowed && invalidTenantBlocked;
    
  } catch (error) {
    logTest('Tenant Authentication Tests', false, `Error: ${error.message}`);
    return false;
  }
}

async function testAPIEndpointsRequireTenant() {
  logSection('API ENDPOINTS REQUIRE TENANT CONTEXT');
  
  if (testTenantIds.length === 0) {
    logTest('API Tenant Context - Setup', false, 'No test tenants available');
    return false;
  }
  
  const testTenantId = testTenantIds[0];
  
  // Test various endpoints that should require tenant context
  const endpointsToTest = [
    { path: '/api/build-upload', method: 'get', description: 'Build Upload Routes' },
    { path: '/api/storage/list', method: 'get', description: 'Storage List (auto-tenant removed)' },
    { path: '/api/projects', method: 'get', description: 'Project List' }
  ];
  
  let allEndpointsRequireTenant = true;
  
  for (const endpoint of endpointsToTest) {
    try {
      // Test without tenant context
      const response = await api[endpoint.method](endpoint.path).catch(err => err.response);
      const requiresTenant = response && response.status >= 400;
      
      logTest(`${endpoint.description} Requires Tenant`, requiresTenant,
        requiresTenant ? 'Endpoint properly requires tenant context' : 'Endpoint allows access without tenant');
      
      if (!requiresTenant) {
        allEndpointsRequireTenant = false;
      }
      
    } catch (error) {
      logTest(`${endpoint.description} Test`, false, `Error: ${error.message}`);
      allEndpointsRequireTenant = false;
    }
  }
  
  return allEndpointsRequireTenant;
}

async function testDatabaseRelationships() {
  logSection('DATABASE RELATIONSHIPS & DATA INTEGRITY');
  
  if (!authToken || testTenantIds.length === 0) {
    logTest('Database Relationships - Setup', false, 'Auth token or tenants not available');
    return false;
  }
  
  try {
    // Test: Get user's tenants and verify relationships
    const tenantsResponse = await api.get('/api/tenants');
    const hasMultipleTenants = tenantsResponse.status === 200 && tenantsResponse.data.length >= 2;
    
    logTest('User Has Multiple Tenants', hasMultipleTenants,
      hasMultipleTenants ? `User has ${tenantsResponse.data.length} tenants` : 'User does not have multiple tenants');
    
    if (hasMultipleTenants) {
      // Verify each tenant belongs to the user
      let allTenantsValid = true;
      
      for (const tenant of tenantsResponse.data) {
        const hasValidStructure = tenant.tenantId && tenant.name && 
                                 (tenant.ownerId === userId || tenant.owner?.id === userId);
        
        if (!hasValidStructure) {
          allTenantsValid = false;
          console.log(`   Invalid tenant structure:`, tenant);
        }
      }
      
      logTest('Tenant Data Integrity', allTenantsValid,
        allTenantsValid ? 'All tenant data is properly structured' : 'Some tenant data has integrity issues');
      
      return allTenantsValid;
    }
    
    return false;
    
  } catch (error) {
    logTest('Database Relationships Test', false, `Error: ${error.message}`);
    return false;
  }
}

/**
 * Main Test Runner
 */
async function runAllTests() {
  console.log('🚀 Starting Multi-Tenant Architecture Tests');
  console.log('='.repeat(60));
  
  const startTime = Date.now();
  
  // Run all tests
  const serverHealthy = await testServerHealth();
  
  if (!serverHealthy) {
    console.log('\n❌ Server is not healthy. Stopping tests.');
    return;
  }
  
  await testUserRegistration();
  await testUserLogin();
  await testTenantCRUD();
  await testTenantAuthentication();
  await testAPIEndpointsRequireTenant();
  await testDatabaseRelationships();
  
  // Summary
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⏱️  Duration: ${duration}s`);
  
  if (testResults.failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    testResults.errors.forEach(error => {
      console.log(`   • ${error}`);
    });
  }
  
  const overallSuccess = testResults.failed === 0;
  console.log(`\n🎯 Overall Result: ${overallSuccess ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (overallSuccess) {
    console.log('\n🎉 Multi-tenant architecture is working correctly!');
    console.log('✨ Users can now have multiple tenants with separate deployments.');
  } else {
    console.log('\n🔧 Some issues need to be addressed before the architecture is ready.');
  }
  
  process.exit(overallSuccess ? 0 : 1);
}

// Handle unhandled errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Error:', error.message);
  process.exit(1);
});

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testServerHealth,
  testUserRegistration,
  testUserLogin,
  testTenantCRUD,
  testTenantAuthentication,
  testAPIEndpointsRequireTenant,
  testDatabaseRelationships
};