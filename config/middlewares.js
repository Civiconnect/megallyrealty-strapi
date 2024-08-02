module.exports = ({ env }) => [
  "strapi::errors",
  //'strapi::security',
  {
    name: "strapi::security",
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "https:"],
          "img-src": [
            "'self'",
            "data:",
            "blob:",
            `https://${env("S3_BUCKET_NAME")}.s3.${env("S3_REGION")}.amazonaws.com`,
            `https://${env("S3_BUCKET_NAME")}.s3.amazonaws.com`,
          ],
          "media-src": ["'self'", "data:", "blob:", `https://${env("S3_BUCKET_NAME")}.s3.${env("S3_REGION")}.amazonaws.com`,
          `https://${env("S3_BUCKET_NAME")}.s3.amazonaws.com`],
          "script-src": ["'self'", "'unsafe-inline'", "maps.googleapis.com"],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      origin: ['*'],
    },
  },
  "strapi::poweredBy",
  "strapi::logger",
  "strapi::query",
  {
    name: "strapi::body",
    config: {
      formLimit: "2gb", // modify form body
      jsonLimit: "2gb", // modify JSON body
      textLimit: "2gb", // modify text body
      formidable: {
        maxFileSize: 2000 * 1024 * 1024, // multipart data, modify here limit of uploaded file size
      },
    },
  },
  "strapi::session",
  "strapi::favicon",
  "strapi::public",
];
