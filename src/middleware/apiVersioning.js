/**
 * API Version Middleware
 * Handles API versioning through headers, query parameters, or URL path
 */

const logger = require('../utils/logger');

// Supported API versions
const SUPPORTED_VERSIONS = ['v1', 'v2'];
const DEFAULT_VERSION = 'v1';
const LATEST_VERSION = 'v2';

function getApiVersion(req) {
  // Check for version in URL path (highest priority)
  const urlVersion = req.path.match(/^\/api\/(v\d+)\//);
  if (urlVersion) {
    return urlVersion[1];
  }

  // Check for version in header
  const headerVersion = req.headers['api-version'] || req.headers['x-api-version'];
  if (headerVersion) {
    return headerVersion.startsWith('v') ? headerVersion : `v${headerVersion}`;
  }

  // Check for version in query parameter
  const queryVersion = req.query.version;
  if (queryVersion) {
    return queryVersion.startsWith('v') ? queryVersion : `v${queryVersion}`;
  }

  // Check for Accept header with version
  const acceptHeader = req.headers.accept;
  if (acceptHeader) {
    const versionMatch = acceptHeader.match(/application\/vnd\.websitebuilder\.(v\d+)\+json/);
    if (versionMatch) {
      return versionMatch[1];
    }
  }

  return DEFAULT_VERSION;
}

function isVersionSupported(version) {
  return SUPPORTED_VERSIONS.includes(version);
}

function apiVersioning(req, res, next) {
  // Skip versioning for non-API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const requestedVersion = getApiVersion(req);

  // Validate version
  if (!isVersionSupported(requestedVersion)) {
    return res.status(400).json({
      error: 'Unsupported API Version',
      message: `API version '${requestedVersion}' is not supported`,
      supported_versions: SUPPORTED_VERSIONS,
      latest_version: LATEST_VERSION,
      links: {
        documentation: `/api/docs/${LATEST_VERSION}`,
        migration_guide: `/api/docs/migration`
      }
    });
  }

  // Set version info in request object
  req.apiVersion = requestedVersion;
  req.apiVersionInfo = {
    requested: requestedVersion,
    latest: LATEST_VERSION,
    isLatest: requestedVersion === LATEST_VERSION,
    isDefault: requestedVersion === DEFAULT_VERSION
  };

  // Add version info to response headers
  res.set({
    'X-API-Version': requestedVersion,
    'X-API-Latest-Version': LATEST_VERSION,
    'X-API-Supported-Versions': SUPPORTED_VERSIONS.join(', ')
  });

  // Log version usage for analytics
  logger.debug(`API ${requestedVersion} accessed: ${req.method} ${req.path}`);

  // Add deprecation warnings for older versions
  if (requestedVersion === 'v1' && LATEST_VERSION !== 'v1') {
    res.set({
      'Warning': '299 - "API version v1 is deprecated. Please upgrade to v2"',
      'Sunset': new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
      'Link': `</api/docs/migration>; rel="successor-version"`
    });

    logger.warn(`Deprecated API v1 accessed: ${req.method} ${req.path} by ${req.ip}`);
  }

  next();
}

// Middleware to handle version-specific route mappings
function versionRouter(versionRoutes) {
  return (req, res, next) => {
    const version = req.apiVersion || DEFAULT_VERSION;
    
    if (versionRoutes[version]) {
      // Route to version-specific handler
      return versionRoutes[version](req, res, next);
    }
    
    // Fall back to default version if specific version handler not found
    if (versionRoutes[DEFAULT_VERSION]) {
      return versionRoutes[DEFAULT_VERSION](req, res, next);
    }
    
    // No handler found
    res.status(501).json({
      error: 'Not Implemented',
      message: `Handler for API version ${version} not implemented for this endpoint`
    });
  };
}

// Helper function to create version-specific response formats
function formatResponse(data, req, additionalMeta = {}) {
  const version = req.apiVersion || DEFAULT_VERSION;
  const baseResponse = {
    status: 'success',
    data: data
  };

  switch (version) {
    case 'v1':
      // Simple response format for v1
      return baseResponse;
      
    case 'v2':
      // Enhanced response format for v2
      return {
        ...baseResponse,
        meta: {
          version: version,
          timestamp: new Date().toISOString(),
          request_id: req.headers['x-request-id'] || req.id,
          ...additionalMeta
        },
        links: {
          self: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          docs: `/api/docs/${version}`
        }
      };
      
    default:
      return baseResponse;
  }
}

// Helper function to create version-specific error responses
function formatError(error, req, statusCode = 500) {
  const version = req.apiVersion || DEFAULT_VERSION;
  
  const baseError = {
    error: error.name || 'Error',
    message: error.message
  };

  switch (version) {
    case 'v1':
      return baseError;
      
    case 'v2':
      return {
        ...baseError,
        meta: {
          version: version,
          timestamp: new Date().toISOString(),
          request_id: req.headers['x-request-id'] || req.id,
          status_code: statusCode
        },
        ...(error.details && { details: error.details }),
        ...(error.code && { error_code: error.code })
      };
      
    default:
      return baseError;
  }
}

// Version-specific feature flags
function hasFeature(feature, version = DEFAULT_VERSION) {
  const features = {
    v1: [
      'basic_auth',
      'file_upload',
      'basic_deployment',
      'simple_metrics'
    ],
    v2: [
      'basic_auth',
      'file_upload', 
      'basic_deployment',
      'simple_metrics',
      'bulk_operations',
      'rate_limiting_per_endpoint',
      'enhanced_error_details'
    ]
  };

  return features[version]?.includes(feature) || false;
}

module.exports = {
  apiVersioning,
  versionRouter,
  formatResponse,
  formatError,
  hasFeature,
  getApiVersion,
  isVersionSupported,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  LATEST_VERSION
};
