/**
 * OpenAPI/Swagger Documentation Configuration
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Website Builder API',
      version: '2.0.0',
      description: `
        A comprehensive multi-tenant website deployment platform API that provides:
        - User authentication and tenant management
        - File upload and build processing
        - Real-time deployment tracking
        - Custom domain management
      `,
      contact: {
        name: 'Website Builder Team',
        email: 'support@websitebuilder.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000/api',
        description: 'Development server'
      },
      {
        url: 'https://api.websitebuilder.com/api',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from the /auth/login endpoint'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'Unique user identifier'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            full_name: {
              type: 'string',
              description: 'User full name'
            },
            role: {
              type: 'string',
              enum: ['admin', 'owner', 'member'],
              description: 'User role within the tenant'
            },
            tenant_id: {
              type: 'string',
              format: 'uuid',
              description: 'Associated tenant ID'
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Tenant: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            tenant_id: {
              type: 'string',
              description: 'Human-readable tenant identifier'
            },
            name: {
              type: 'string',
              description: 'Tenant organization name'
            },
            subdomain: {
              type: 'string',
              description: 'Default subdomain for the tenant'
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'building', 'deployed', 'failed'],
              description: 'Current tenant status'
            },
            current_version: {
              type: 'string',
              description: 'Currently deployed version'
            }
          }
        },
        Build: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            tenant_id: {
              type: 'string'
            },
            version: {
              type: 'string',
              description: 'Build version identifier'
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed'],
              description: 'Current build status'
            },
            source_file: {
              type: 'string',
              description: 'Original source file name'
            },
            started_at: {
              type: 'string',
              format: 'date-time'
            },
            finished_at: {
              type: 'string',
              format: 'date-time'
            },
            error_message: {
              type: 'string',
              description: 'Error message if build failed'
            }
          }
        },
        Deployment: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            build_id: {
              type: 'string',
              format: 'uuid'
            },
            status: {
              type: 'string',
              enum: ['pending', 'deploying', 'completed', 'failed'],
              description: 'Current deployment status'
            },
            url: {
              type: 'string',
              format: 'uri',
              description: 'Deployment URL'
            },
            deployed_at: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        ApiResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['success', 'error'],
              description: 'Response status'
            },
            data: {
              type: 'object',
              description: 'Response data'
            },
            meta: {
              type: 'object',
              properties: {
                version: {
                  type: 'string',
                  description: 'API version used'
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time'
                },
                request_id: {
                  type: 'string',
                  description: 'Unique request identifier'
                }
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error type'
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            details: {
              type: 'object',
              description: 'Additional error details'
            }
          }
        }
      },
      parameters: {
        ApiVersionHeader: {
          name: 'API-Version',
          in: 'header',
          description: 'API version to use (v1 or v2)',
          schema: {
            type: 'string',
            enum: ['v1', 'v2'],
            default: 'v1'
          }
        },
        TenantId: {
          name: 'tenantId',
          in: 'path',
          required: true,
          description: 'Tenant identifier',
          schema: {
            type: 'string'
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Unauthorized',
                message: 'Authentication token required'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'Access forbidden',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Forbidden',
                message: 'Insufficient permissions'
              }
            }
          }
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Not Found',
                message: 'The requested resource was not found'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                error: 'Bad Request',
                message: 'Validation failed',
                details: {
                  fields: ['email is required', 'password must be at least 8 characters']
                }
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization'
      },
      {
        name: 'Tenants',
        description: 'Tenant management operations'
      },
      {
        name: 'Uploads',
        description: 'File upload and management'
      },
      {
        name: 'Builds',
        description: 'Build process management'
      },
      {
        name: 'Deployments',
        description: 'Deployment operations'
      },
      {
        name: 'Domains',
        description: 'Custom domain management'
      },
      {
        name: 'System',
        description: 'System health and monitoring'
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/middleware/*.js',
    './src/server.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
