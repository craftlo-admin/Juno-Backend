const express = require('express');
const router = express.Router();
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('../config/swagger');
const { formatResponse } = require('../middleware/apiVersioning');

// Swagger UI documentation
router.use('/ui', swaggerUi.serve);
router.get('/ui', swaggerUi.setup(swaggerSpecs, {
  customCss: `
    .topbar-wrapper img { display: none; }
    .topbar-wrapper::after { 
      content: "Website Builder API Documentation"; 
      font-size: 1.5em; 
      font-weight: bold; 
      color: #3b82f6;
    }
  `,
  customSiteTitle: "Website Builder API Docs",
  explorer: true
}));

// OpenAPI JSON specification
router.get('/openapi.json', (req, res) => {
  res.json(swaggerSpecs);
});

// API documentation landing page
router.get('/', (req, res) => {
  const docInfo = {
    title: 'Website Builder API Documentation',
    version: swaggerSpecs.info.version,
    description: 'Comprehensive API documentation for the Website Builder platform',
    available_formats: [
      {
        name: 'Interactive Documentation',
        url: '/api/docs/ui',
        description: 'Browse and test API endpoints interactively'
      },
      {
        name: 'OpenAPI Specification',
        url: '/api/docs/openapi.json',
        description: 'Machine-readable API specification in OpenAPI 3.0 format'
      },
      {
        name: 'Postman Collection',
        url: '/api/docs/postman',
        description: 'Import into Postman for API testing'
      }
    ],
    quick_start: {
      authentication: {
        step: 1,
        description: 'Obtain an API token by registering and logging in',
        endpoint: 'POST /api/auth/login',
        example: {
          email: 'user@example.com',
          password: 'your-password'
        }
      },
      first_request: {
        step: 2,
        description: 'Make your first authenticated request',
        endpoint: 'GET /api/tenants/current',
        headers: {
          'Authorization': 'Bearer your-jwt-token'
        }
      }
    },
    api_versioning: {
      current_version: 'v2',
      supported_versions: ['v1', 'v2'],
      version_methods: [
        {
          method: 'Header',
          example: 'API-Version: v2'
        },
        {
          method: 'Query Parameter',
          example: '?version=v2'
        },
        {
          method: 'Accept Header',
          example: 'Accept: application/vnd.websitebuilder.v2+json'
        }
      ]
    },
    rate_limiting: {
      general: '100 requests per 15 minutes per IP',
      authenticated: '1000 requests per hour per user'
    }
  };

  res.json(formatResponse(docInfo, req));
});

// Generate Postman collection
router.get('/postman', (req, res) => {
  const postmanCollection = {
    info: {
      name: 'Website Builder API',
      description: swaggerSpecs.info.description,
      version: swaggerSpecs.info.version,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    auth: {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{api_token}}',
          type: 'string'
        }
      ]
    },
    variable: [
      {
        key: 'base_url',
        value: req.protocol + '://' + req.get('host') + '/api'
      },
      {
        key: 'api_token',
        value: 'your-jwt-token-here'
      }
    ],
    item: [
      {
        name: 'Authentication',
        item: [
          {
            name: 'Login',
            request: {
              method: 'POST',
              header: [
                {
                  key: 'Content-Type',
                  value: 'application/json'
                }
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify({
                  email: 'user@example.com',
                  password: 'password123'
                }, null, 2)
              },
              url: {
                raw: '{{base_url}}/auth/login',
                host: ['{{base_url}}'],
                path: ['auth', 'login']
              }
            }
          },
          {
            name: 'Register',
            request: {
              method: 'POST',
              header: [
                {
                  key: 'Content-Type',
                  value: 'application/json'
                }
              ],
              body: {
                mode: 'raw',
                raw: JSON.stringify({
                  email: 'user@example.com',
                  password: 'password123',
                  full_name: 'John Doe',
                  tenant_name: 'My Organization'
                }, null, 2)
              },
              url: {
                raw: '{{base_url}}/auth/register',
                host: ['{{base_url}}'],
                path: ['auth', 'register']
              }
            }
          }
        ]
      },
      {
        name: 'Tenants',
        item: [
          {
            name: 'Get Current Tenant',
            request: {
              method: 'GET',
              header: [],
              url: {
                raw: '{{base_url}}/tenants/current',
                host: ['{{base_url}}'],
                path: ['tenants', 'current']
              }
            }
          }
        ]
      },
      {
        name: 'File Uploads',
        item: [
          {
            name: 'Upload ZIP File',
            request: {
              method: 'POST',
              header: [],
              body: {
                mode: 'formdata',
                formdata: [
                  {
                    key: 'file',
                    type: 'file',
                    src: 'path/to/your/website.zip'
                  }
                ]
              },
              url: {
                raw: '{{base_url}}/uploads',
                host: ['{{base_url}}'],
                path: ['uploads']
              }
            }
          }
        ]
      },
      {
        name: 'System',
        item: [
          {
            name: 'Health Check',
            request: {
              method: 'GET',
              header: [],
              url: {
                raw: '{{base_url}}/../health',
                host: ['{{base_url}}'],
                path: ['..', 'health']
              }
            }
          }
        ]
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="website-builder-api.postman_collection.json"');
  res.json(postmanCollection);
});

// API changelog
router.get('/changelog', (req, res) => {
  const changelog = {
    versions: [
      {
        version: 'v2.0.0',
        release_date: '2025-09-11',
        changes: [
          'Enhanced API versioning system implementation',
          'Improved error handling and response formats',
          'Added comprehensive OpenAPI documentation',
          'Streamlined core functionality and removed unused features'
        ],
        breaking_changes: [
          'Response format changed to include meta information',
          'Error responses now include more detailed information'
        ]
      },
      {
        version: 'v1.0.0',
        release_date: '2025-09-10',
        changes: [
          'Initial API release',
          'User authentication and authorization',
          'Multi-tenant architecture',
          'File upload and build processing',
          'Basic deployment functionality',
          'Domain management'
        ]
      }
    ],
    migration_guides: [
      {
        from: 'v1',
        to: 'v2',
        guide_url: '/api/docs/migration/v1-to-v2',
        summary: 'v2 introduces enhanced response formats and new features while maintaining backward compatibility'
      }
    ]
  };

  res.json(formatResponse(changelog, req));
});

// Migration guide for v1 to v2
router.get('/migration/v1-to-v2', (req, res) => {
  const migrationGuide = {
    title: 'Migration Guide: API v1 to v2',
    overview: 'API v2 introduces enhanced features while maintaining backward compatibility. Existing v1 endpoints continue to work.',
    key_changes: {
      response_format: {
        description: 'v2 responses include additional meta information',
        v1_example: {
          status: 'success',
          data: { message: 'Hello' }
        },
        v2_example: {
          status: 'success',
          data: { message: 'Hello' },
          meta: {
            version: 'v2',
            timestamp: '2025-09-11T10:00:00Z',
            request_id: 'req_123'
          },
          links: {
            self: 'https://api.example.com/endpoint'
          }
        }
      },
      error_format: {
        description: 'v2 errors include more detailed information',
        v1_example: {
          error: 'Bad Request',
          message: 'Invalid input'
        },
        v2_example: {
          error: 'Bad Request',
          message: 'Invalid input',
          meta: {
            version: 'v2',
            timestamp: '2025-09-11T10:00:00Z',
            request_id: 'req_123',
            status_code: 400
          },
          details: {
            field_errors: ['email is required']
          }
        }
      }
    },
    new_features: [
      'Enhanced API versioning and documentation',
      'Streamlined core functionality',
      'Improved error handling and response formats',
      'Optimized build and deployment processes'
    ],
    deprecated_features: [
      'Some v1-specific response formats (will be removed in v3)'
    ],
    migration_steps: [
      {
        step: 1,
        action: 'Update API version header',
        code: 'API-Version: v2'
      },
      {
        step: 2,
        action: 'Update response parsing to handle new format',
        code: 'const data = response.data; // Same as v1\nconst meta = response.meta; // New in v2'
      },
      {
        step: 3,
        action: 'Update error handling for enhanced error details',
        code: 'const errorDetails = error.details; // New in v2'
      }
    ]
  };

  res.json(formatResponse(migrationGuide, req));
});

// SDK examples and code samples
router.get('/examples/:language?', (req, res) => {
  const { language = 'javascript' } = req.params;

  const examples = {
    javascript: {
      authentication: `
// Authentication example
const axios = require('axios');

const response = await axios.post('/api/auth/login', {
  email: 'user@example.com',
  password: 'password123'
});

const token = response.data.data.token;

// Use token in subsequent requests
const config = {
  headers: {
    'Authorization': \`Bearer \${token}\`,
    'API-Version': 'v2'
  }
};
      `,
      file_upload: `
// File upload example
const FormData = require('form-data');
const fs = require('fs');

const form = new FormData();
form.append('file', fs.createReadStream('website.zip'));

const response = await axios.post('/api/uploads', form, {
  headers: {
    ...form.getHeaders(),
    'Authorization': 'Bearer your-token'
  }
});
      `
    },
    python: {
      authentication: `
# Authentication example
import requests

response = requests.post('/api/auth/login', json={
    'email': 'user@example.com',
    'password': 'password123'
})

token = response.json()['data']['token']

# Use token in subsequent requests
headers = {
    'Authorization': f'Bearer {token}',
    'API-Version': 'v2'
}
      `,
      file_upload: `
# File upload example
import requests

files = {'file': open('website.zip', 'rb')}
headers = {'Authorization': 'Bearer your-token'}

response = requests.post('/api/uploads', files=files, headers=headers)
      `
    },
    curl: {
      authentication: `
# Authentication
curl -X POST /api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"password123"}'

# Use the returned token
export TOKEN="your-jwt-token"
      `,
      file_upload: `
# File upload
curl -X POST /api/uploads \\
  -H "Authorization: Bearer $TOKEN" \\
  -F "file=@website.zip"
      `
    }
  };

  const supportedLanguages = Object.keys(examples);
  
  if (!supportedLanguages.includes(language)) {
    return res.status(400).json({
      error: 'Unsupported Language',
      message: `Language '${language}' not supported`,
      supported_languages: supportedLanguages
    });
  }

  res.json(formatResponse({
    language,
    examples: examples[language],
    available_languages: supportedLanguages
  }, req));
});

module.exports = router;
