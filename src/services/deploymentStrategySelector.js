const logger = require('../utils/logger');

/**
 * Deployment Strategy Selector
 * Determines whether a tenant should use individual CloudFront distribution
 * or shared CloudFront distribution based on tenant configuration and subscription tier
 */
class DeploymentStrategySelector {
  
  constructor() {
    // Default deployment strategy from environment
    this.defaultStrategy = process.env.DEFAULT_DEPLOYMENT_STRATEGY || 'shared';
    
    // Force all tenants to use specific strategy (useful for migrations)
    this.forceStrategy = process.env.FORCE_DEPLOYMENT_STRATEGY || null;
    
    // Enable individual distributions for enterprise tiers
    this.enableIndividualForEnterprise = process.env.ENABLE_INDIVIDUAL_FOR_ENTERPRISE === 'true';
    
    // Maximum number of individual distributions allowed (AWS quota management)
    this.maxIndividualDistributions = parseInt(process.env.MAX_INDIVIDUAL_DISTRIBUTIONS) || 400;
    
    logger.info('DeploymentStrategySelector initialized', {
      defaultStrategy: this.defaultStrategy,
      forceStrategy: this.forceStrategy,
      enableIndividualForEnterprise: this.enableIndividualForEnterprise,
      maxIndividualDistributions: this.maxIndividualDistributions
    });
  }
  
  /**
   * Determine deployment strategy for tenant
   * @param {Object} tenant - Tenant object with subscription and configuration
   * @param {Object} options - Additional options for strategy selection
   * @returns {Object} - Strategy decision with reasoning
   */
  async determineStrategy(tenant, options = {}) {
    const decision = {
      strategy: 'shared', // default
      reason: [],
      canUpgrade: false,
      canDowngrade: false,
      currentDistributionCount: options.currentDistributionCount || 0
    };
    
    // If force strategy is set, use it (useful for migrations)
    if (this.forceStrategy) {
      decision.strategy = this.forceStrategy;
      decision.reason.push(`Forced to ${this.forceStrategy} strategy via FORCE_DEPLOYMENT_STRATEGY`);
      return decision;
    }
    
    // Check tenant's explicit preference first
    if (tenant.deployment_strategy) {
      decision.strategy = tenant.deployment_strategy;
      decision.reason.push(`Tenant has explicit deployment_strategy: ${tenant.deployment_strategy}`);
      
      // Validate the strategy is still feasible
      const validation = await this.validateStrategy(tenant, tenant.deployment_strategy, options);
      if (!validation.valid) {
        decision.reason.push(`Explicit strategy not feasible: ${validation.reason}`);
        decision.strategy = validation.fallbackStrategy;
        decision.reason.push(`Falling back to ${validation.fallbackStrategy} strategy`);
      }
    } else {
      // Determine strategy based on tenant attributes
      const recommendation = await this.recommendStrategy(tenant, options);
      decision.strategy = recommendation.strategy;
      decision.reason.push(...recommendation.reasons);
    }
    
    // Check if tenant can upgrade/downgrade
    decision.canUpgrade = await this.canUpgradeToIndividual(tenant, options);
    decision.canDowngrade = await this.canDowngradeToShared(tenant, options);
    
    logger.info('Deployment strategy determined', {
      tenantId: tenant.id,
      strategy: decision.strategy,
      reasons: decision.reason,
      canUpgrade: decision.canUpgrade,
      canDowngrade: decision.canDowngrade
    });
    
    return decision;
  }
  
  /**
   * Recommend deployment strategy based on tenant attributes
   * @param {Object} tenant - Tenant object
   * @param {Object} options - Additional options
   * @returns {Object} - Strategy recommendation with reasons
   */
  async recommendStrategy(tenant, options = {}) {
    const recommendation = {
      strategy: this.defaultStrategy,
      reasons: []
    };
    
    // Check subscription tier
    if (this.enableIndividualForEnterprise && this.isEnterpriseTier(tenant)) {
      // Check if we're under the distribution limit
      const currentCount = options.currentDistributionCount || 0;
      if (currentCount < this.maxIndividualDistributions) {
        recommendation.strategy = 'individual';
        recommendation.reasons.push(`Enterprise tier eligible for individual distribution`);
        recommendation.reasons.push(`Within distribution limit (${currentCount}/${this.maxIndividualDistributions})`);
      } else {
        recommendation.strategy = 'shared';
        recommendation.reasons.push(`Enterprise tier but at distribution limit (${currentCount}/${this.maxIndividualDistributions})`);
        recommendation.reasons.push(`Using shared distribution to stay within AWS quotas`);
      }
    } else {
      recommendation.strategy = 'shared';
      recommendation.reasons.push(`Standard tier uses shared distribution by default`);
    }
    
    // Check for custom domain requirements
    if (tenant.custom_domain && tenant.custom_domain !== `${tenant.id}.junotech.in`) {
      if (recommendation.strategy === 'shared') {
        recommendation.reasons.push(`Custom domain ${tenant.custom_domain} requires individual distribution for SSL`);
        
        // Check if we can accommodate individual distribution
        const currentCount = options.currentDistributionCount || 0;
        if (currentCount < this.maxIndividualDistributions) {
          recommendation.strategy = 'individual';
          recommendation.reasons.push(`Upgrading to individual distribution for custom domain support`);
        } else {
          recommendation.reasons.push(`Cannot provide individual distribution due to quota limits`);
          recommendation.reasons.push(`Custom domain will not be supported`);
        }
      }
    }
    
    // Check for high traffic requirements
    if (tenant.traffic_tier === 'high' || tenant.monthly_page_views > 1000000) {
      if (recommendation.strategy === 'shared') {
        recommendation.reasons.push(`High traffic tenant may benefit from individual distribution`);
        
        const currentCount = options.currentDistributionCount || 0;
        if (currentCount < this.maxIndividualDistributions) {
          recommendation.strategy = 'individual';
          recommendation.reasons.push(`Upgrading to individual distribution for performance isolation`);
        } else {
          recommendation.reasons.push(`Cannot provide individual distribution due to quota limits`);
        }
      }
    }
    
    // Check for compliance requirements
    if (tenant.compliance_requirements && tenant.compliance_requirements.includes('data_isolation')) {
      if (recommendation.strategy === 'shared') {
        recommendation.reasons.push(`Compliance requirements mandate data isolation`);
        
        const currentCount = options.currentDistributionCount || 0;
        if (currentCount < this.maxIndividualDistributions) {
          recommendation.strategy = 'individual';
          recommendation.reasons.push(`Upgrading to individual distribution for compliance`);
        } else {
          recommendation.reasons.push(`Cannot provide individual distribution due to quota limits`);
          recommendation.reasons.push(`Compliance requirements cannot be met`);
        }
      }
    }
    
    return recommendation;
  }
  
  /**
   * Validate if a specific strategy is feasible for tenant
   * @param {Object} tenant - Tenant object
   * @param {string} strategy - Strategy to validate
   * @param {Object} options - Additional options
   * @returns {Object} - Validation result
   */
  async validateStrategy(tenant, strategy, options = {}) {
    const validation = {
      valid: true,
      reason: '',
      fallbackStrategy: 'shared'
    };
    
    if (strategy === 'individual') {
      // Check distribution quota
      const currentCount = options.currentDistributionCount || 0;
      if (currentCount >= this.maxIndividualDistributions) {
        validation.valid = false;
        validation.reason = `At distribution limit (${currentCount}/${this.maxIndividualDistributions})`;
        validation.fallbackStrategy = 'shared';
        return validation;
      }
      
      // Check if individual distributions are enabled
      if (!this.enableIndividualForEnterprise && !this.isEnterpriseTier(tenant)) {
        validation.valid = false;
        validation.reason = 'Individual distributions only available for enterprise tiers';
        validation.fallbackStrategy = 'shared';
        return validation;
      }
    }
    
    if (strategy === 'shared') {
      // Shared strategy is always valid as fallback
      validation.valid = true;
    }
    
    return validation;
  }
  
  /**
   * Check if tenant can upgrade to individual distribution
   * @param {Object} tenant - Tenant object
   * @param {Object} options - Additional options
   * @returns {boolean} - Can upgrade
   */
  async canUpgradeToIndividual(tenant, options = {}) {
    if (!this.enableIndividualForEnterprise) {
      return false;
    }
    
    const currentCount = options.currentDistributionCount || 0;
    if (currentCount >= this.maxIndividualDistributions) {
      return false;
    }
    
    // Must be enterprise tier or have special requirements
    return this.isEnterpriseTier(tenant) || 
           tenant.custom_domain || 
           tenant.traffic_tier === 'high' ||
           (tenant.compliance_requirements && tenant.compliance_requirements.includes('data_isolation'));
  }
  
  /**
   * Check if tenant can downgrade to shared distribution
   * @param {Object} tenant - Tenant object
   * @param {Object} options - Additional options
   * @returns {boolean} - Can downgrade
   */
  async canDowngradeToShared(tenant, options = {}) {
    // Check if downgrade would break functionality
    if (tenant.custom_domain && tenant.custom_domain !== `${tenant.id}.junotech.in`) {
      return false; // Custom domain requires individual distribution
    }
    
    if (tenant.compliance_requirements && tenant.compliance_requirements.includes('data_isolation')) {
      return false; // Compliance requirements prevent shared usage
    }
    
    // Can always downgrade to shared if no blocking requirements
    return true;
  }
  
  /**
   * Check if tenant is enterprise tier
   * @param {Object} tenant - Tenant object
   * @returns {boolean} - Is enterprise tier
   */
  isEnterpriseTier(tenant) {
    return tenant.subscription_tier === 'enterprise' || 
           tenant.subscription_tier === 'premium' ||
           tenant.plan_type === 'enterprise';
  }
  
  /**
   * Get strategy statistics for monitoring
   * @param {Array} tenants - Array of tenant objects
   * @returns {Object} - Strategy statistics
   */
  async getStrategyStatistics(tenants) {
    const stats = {
      total: tenants.length,
      individual: 0,
      shared: 0,
      canUpgrade: 0,
      canDowngrade: 0,
      quotaUtilization: 0
    };
    
    for (const tenant of tenants) {
      const decision = await this.determineStrategy(tenant, {
        currentDistributionCount: stats.individual
      });
      
      if (decision.strategy === 'individual') {
        stats.individual++;
      } else {
        stats.shared++;
      }
      
      if (decision.canUpgrade) {
        stats.canUpgrade++;
      }
      
      if (decision.canDowngrade) {
        stats.canDowngrade++;
      }
    }
    
    stats.quotaUtilization = (stats.individual / this.maxIndividualDistributions) * 100;
    
    return stats;
  }
  
  /**
   * Get configuration summary
   * @returns {Object} - Configuration details
   */
  getConfiguration() {
    return {
      defaultStrategy: this.defaultStrategy,
      forceStrategy: this.forceStrategy,
      enableIndividualForEnterprise: this.enableIndividualForEnterprise,
      maxIndividualDistributions: this.maxIndividualDistributions,
      quotaThreshold: 90 // Warn when approaching quota
    };
  }
  
  /**
   * Recommend quota adjustments based on current usage
   * @param {Object} stats - Current strategy statistics
   * @returns {Object} - Quota recommendations
   */
  recommendQuotaAdjustments(stats) {
    const recommendations = {
      currentUtilization: stats.quotaUtilization,
      recommendations: []
    };
    
    if (stats.quotaUtilization > 90) {
      recommendations.recommendations.push({
        type: 'urgent',
        action: 'Request AWS quota increase',
        reason: `Quota utilization at ${stats.quotaUtilization.toFixed(1)}%`
      });
    } else if (stats.quotaUtilization > 75) {
      recommendations.recommendations.push({
        type: 'warning',
        action: 'Plan AWS quota increase',
        reason: `Quota utilization at ${stats.quotaUtilization.toFixed(1)}%`
      });
    }
    
    if (stats.canUpgrade > 0 && stats.quotaUtilization > 80) {
      recommendations.recommendations.push({
        type: 'info',
        action: `Consider keeping ${stats.canUpgrade} tenants on shared distribution`,
        reason: 'Approaching quota limits'
      });
    }
    
    return recommendations;
  }
}

module.exports = DeploymentStrategySelector;