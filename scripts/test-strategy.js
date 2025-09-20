#!/usr/bin/env node

require('dotenv').config();

console.log('🧪 Testing Deployment Strategy Selection');
console.log('='.repeat(45));

console.log('\n📋 Environment Variables:');
console.log(`FORCE_DEPLOYMENT_STRATEGY: ${process.env.FORCE_DEPLOYMENT_STRATEGY}`);
console.log(`DEFAULT_DEPLOYMENT_STRATEGY: ${process.env.DEFAULT_DEPLOYMENT_STRATEGY}`);

// Mock the strategy selector logic
class MockDeploymentStrategySelector {
  constructor() {
    this.defaultStrategy = process.env.DEFAULT_DEPLOYMENT_STRATEGY || 'shared';
    this.forceStrategy = process.env.FORCE_DEPLOYMENT_STRATEGY || null;
  }
  
  async determineStrategy(tenant, options = {}) {
    const decision = {
      strategy: 'shared',
      reason: [],
      canUpgrade: false,
      canDowngrade: false,
      currentDistributionCount: options.currentDistributionCount || 0
    };
    
    if (this.forceStrategy) {
      decision.strategy = this.forceStrategy;
      decision.reason.push(`Forced to ${this.forceStrategy} strategy via FORCE_DEPLOYMENT_STRATEGY`);
      return decision;
    }
    
    // Default logic...
    decision.strategy = this.defaultStrategy;
    decision.reason.push(`Using default strategy: ${this.defaultStrategy}`);
    
    return decision;
  }
}

async function testStrategySelection() {
  const selector = new MockDeploymentStrategySelector();
  
  const mockTenant = {
    id: 'himanshus-organization-clql5u68',
    subscription_tier: 'standard',
    deployment_strategy: null
  };
  
  const strategy = await selector.determineStrategy(mockTenant);
  
  console.log('\n🎯 Strategy Selection Result:');
  console.log(`Strategy: ${strategy.strategy}`);
  console.log(`Reasons: ${strategy.reason.join(', ')}`);
  
  if (strategy.strategy === 'shared') {
    console.log('\n✅ Will use shared distribution!');
    console.log('This should fix the undefined URL issue.');
  } else {
    console.log('\n⚠️  Will use individual distribution');
    console.log('This might still cause undefined URLs if individual distribution setup fails.');
  }
}

console.log('\n🔍 Testing strategy selection...');
testStrategySelection().then(() => {
  console.log('\n✨ Test completed!');
}).catch(error => {
  console.error('❌ Test failed:', error.message);
});