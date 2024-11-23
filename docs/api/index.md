# API Documentation

## Overview

This documentation covers the FFTCG Sync Service API endpoints, authentication, and usage.

## Authentication

To use authenticated endpoints, you'll need a Firebase Authentication token. Here's how to obtain one:

1. Log in to the [Firebase Console](https://console.firebase.google.com)
2. Navigate to Project Settings
3. Go to Service Accounts
4. Click "Generate New Private Key"
5. Use the key to generate a token:

```bash
# Install Firebase CLI if you haven't already
npm install -g firebase-tools

# Login to Firebase
firebase login

# Get a token
firebase auth:token
```

## Making Authenticated Requests

Include the token in your API requests:

```bash
curl -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" https://us-central1-fftcg-sync-service.cloudfunctions.net/api/endpoint
```

## API Explorer

Use the interactive API explorer below to test endpoints. For authenticated endpoints, you'll need to add your Firebase token in the Headers section.

::: tip
Log in to the Firebase Console first to ensure your token has the necessary permissions.
:::

<ApiExplorer />

## Rate Limits

- 100 requests per minute for authenticated endpoints
- 25 requests per minute for unauthenticated endpoints
- Batch operations limited to 500 items

## Response Codes

| Code | Description |
|------|-------------|
| 200  | Success |
| 400  | Bad Request |
| 401  | Unauthorized |
| 403  | Forbidden |
| 429  | Too Many Requests |
| 500  | Server Error |

## Support

For API support or issues:

- Open an issue on GitHub
- Contact the development team
- Check the troubleshooting guide
