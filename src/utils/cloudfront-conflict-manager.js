const AWS = require('aws-sdk');
const { prisma } = require('../lib/prisma');
const TenantDistributionService = require('../services/tenantDistributionService');
const CloudFrontConflictResolver = require('../services/cloudFrontConflictResolver');
require('dotenv').config();

/**
 * CloudFront Conflict Management Tool
 * Helps diagnose and resolve CNAME conflicts
 */
class CloudFrontConflictManager {
  
  constructor() {
    this.cloudfront = new AWS.CloudFront({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.conflictResolver = new CloudFrontConflictResolver();
  }

  /**
   * Analyze all existing CloudFront distributions for potential conflicts
   */
  async analyzeAllDistributions() {
    console.log('🔍 Analyzing All CloudFront Distributions for Conflicts\n');

    try {
      const result = await this.cloudfront.listDistributions().promise();
      const distributions = result.DistributionList.Items;

      console.log(`📊 Found ${distributions.length} CloudFront distributions\n`);

      const aliasMap = new Map();
      const conflicts = [];

      distributions.forEach(dist => {
        console.log(`📋 Distribution: ${dist.Id}`);
        console.log(`   Domain: ${dist.DomainName}`);
        console.log(`   Status: ${dist.Status}`);
        console.log(`   Enabled: ${dist.Enabled}`);
        console.log(`   Comment: ${dist.Comment || 'No comment'}`);

        if (dist.Aliases && dist.Aliases.Items && dist.Aliases.Items.length > 0) {
          console.log(`   Custom Domains:`);
          dist.Aliases.Items.forEach(alias => {
            console.log(`     - ${alias}`);
            
            if (aliasMap.has(alias)) {
              conflicts.push({
                alias,
                distributions: [aliasMap.get(alias), dist.Id]
              });
            } else {
              aliasMap.set(alias, dist.Id);
            }
          });
        } else {
          console.log(`   Custom Domains: None`);
        }
        console.log('');
      });

      if (conflicts.length > 0) {
        console.log('🚨 CONFLICTS DETECTED:\n');
        conflicts.forEach(conflict => {
          console.log(`❌ Alias "${conflict.alias}" is used by multiple distributions:`);
          conflict.distributions.forEach(distId => {
            console.log(`   - ${distId}`);
          });
          console.log('');
        });
      } else {
        console.log('✅ No CNAME conflicts detected\n');
      }

      return { distributions, conflicts, aliasMap };

    } catch (error) {
      console.error('❌ Error analyzing distributions:', error.message);
      throw error;
    }
  }

  /**
   * Test tenant creation with conflict handling
   */
  async testTenantCreation(testTenantId) {
    console.log(`🧪 Testing Tenant Creation: ${testTenantId}\n`);

    try {
      // First check if domain would conflict
      const proposedDomain = TenantDistributionService.generateTenantSubdomain(testTenantId);
      console.log(`📍 Proposed domain: ${proposedDomain}`);

      if (proposedDomain) {
        const conflictCheck = await this.conflictResolver.checkCNAMEConflict(proposedDomain);
        
        if (conflictCheck.hasConflict) {
          console.log('⚠️  CONFLICT DETECTED:');
          console.log(`   Conflicting Distribution: ${conflictCheck.conflictingDistributionId}`);
          console.log(`   Conflicting Domain: ${conflictCheck.conflictingDomain}`);
          console.log(`   Status: ${conflictCheck.conflictingStatus}`);
          
          // Test resolution strategies
          const resolution = await this.conflictResolver.resolveCNAMEConflict(
            testTenantId,
            proposedDomain,
            conflictCheck
          );
          
          console.log('\n💡 Proposed Resolution:');
          console.log(`   Strategy: ${resolution.strategy}`);
          console.log(`   New Domain: ${resolution.domain || 'CloudFront domain only'}`);
          console.log(`   Message: ${resolution.message}`);
          
        } else {
          console.log('✅ No conflicts detected for proposed domain');
        }
      }

      // Test actual creation (be careful - this creates real resources!)
      console.log('\n⚠️  Note: Actual creation test not performed to avoid resource creation');
      console.log('   To test actual creation, uncomment the lines below and run carefully');
      
      // Uncomment these lines to test actual creation:
      // const result = await TenantDistributionService.createTenantDistribution(testTenantId);
      // console.log('✅ Tenant distribution created successfully:', result);

    } catch (error) {
      console.error('❌ Error testing tenant creation:', error.message);
    }
  }

  /**
   * Clean up orphaned or problematic distributions
   */
  async cleanupProblematicDistributions() {
    console.log('🧹 Checking for Problematic Distributions\n');

    try {
      const result = await this.cloudfront.listDistributions().promise();
      const distributions = result.DistributionList.Items;

      const problematic = [];

      for (const dist of distributions) {
        // Check for disabled distributions with custom domains
        if (!dist.Enabled && dist.Aliases && dist.Aliases.Items.length > 0) {
          problematic.push({
            id: dist.Id,
            domain: dist.DomainName,
            aliases: dist.Aliases.Items,
            reason: 'Disabled but has custom domains',
            action: 'Consider removing aliases or deleting'
          });
        }

        // Check for distributions with old/test patterns
        if (dist.Comment && (
          dist.Comment.includes('test') || 
          dist.Comment.includes('temp') ||
          dist.Comment.includes('dev')
        )) {
          problematic.push({
            id: dist.Id,
            domain: dist.DomainName,
            aliases: dist.Aliases?.Items || [],
            reason: 'Appears to be test/temporary distribution',
            action: 'Review if still needed'
          });
        }
      }

      if (problematic.length > 0) {
        console.log('⚠️  Found potentially problematic distributions:\n');
        problematic.forEach(prob => {
          console.log(`📋 Distribution: ${prob.id}`);
          console.log(`   Domain: ${prob.domain}`);
          console.log(`   Aliases: ${prob.aliases.join(', ') || 'None'}`);
          console.log(`   Issue: ${prob.reason}`);
          console.log(`   Suggestion: ${prob.action}`);
          console.log('');
        });
      } else {
        console.log('✅ No obviously problematic distributions found\n');
      }

      return problematic;

    } catch (error) {
      console.error('❌ Error checking for problematic distributions:', error.message);
      throw error;
    }
  }

  /**
   * Get suggestions for resolving conflicts
   */
  async getConflictResolutionSuggestions() {
    console.log('💡 CloudFront Conflict Resolution Strategies\n');

    console.log('🎯 Available Strategies:\n');
    
    console.log('1. 🔄 Reuse Existing Distribution');
    console.log('   - Check if conflicting distribution belongs to same tenant');
    console.log('   - Use existing distribution if owned by same tenant');
    console.log('   - Benefits: No resource duplication, faster setup');
    
    console.log('\n2. 🏷️  Alternative Domain Names');
    console.log('   - Generate alternative subdomains (tenant-v2, tenant-alt)');
    console.log('   - Use systematic suffixes to avoid conflicts');
    console.log('   - Benefits: Still gets custom domain, avoids conflicts');
    
    console.log('\n3. 🌐 CloudFront Domain Only');
    console.log('   - Create distribution without custom CNAME');
    console.log('   - Use only CloudFront domain (e.g., abc123.cloudfront.net)');
    console.log('   - Benefits: Always works, no DNS dependencies');
    
    console.log('\n4. 🧹 Clean Up Conflicts');
    console.log('   - Remove aliases from inactive distributions');
    console.log('   - Delete unused distributions');
    console.log('   - Benefits: Frees up custom domains for reuse');

    console.log('\n🔧 Implementation Tips:\n');
    console.log('- Always check for conflicts before creating distributions');
    console.log('- Implement graceful fallbacks in your code');
    console.log('- Monitor and clean up unused distributions regularly');
    console.log('- Use consistent naming patterns for easier management');
  }
}

// CLI Interface
async function main() {
  const manager = new CloudFrontConflictManager();
  const command = process.argv[2];

  switch (command) {
    case 'analyze':
      await manager.analyzeAllDistributions();
      break;
    
    case 'test':
      const tenantId = process.argv[3] || 'test-tenant-123';
      await manager.testTenantCreation(tenantId);
      break;
    
    case 'cleanup':
      await manager.cleanupProblematicDistributions();
      break;
    
    case 'help':
    default:
      await manager.getConflictResolutionSuggestions();
      console.log('\n📋 Usage:');
      console.log('  node cloudfront-conflict-manager.js analyze    # Analyze all distributions');
      console.log('  node cloudfront-conflict-manager.js test [id]  # Test tenant creation');
      console.log('  node cloudfront-conflict-manager.js cleanup    # Find problematic distributions');
      console.log('  node cloudfront-conflict-manager.js help       # Show this help');
      break;
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = CloudFrontConflictManager;