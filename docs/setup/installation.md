# Installation Guide

## Prerequisites

- Node.js 18 or higher
- Firebase CLI (`npm install -g firebase-tools`)
- Git for version control
- A Firebase project with Firestore and Storage enabled

## Firebase Project Setup

1. Create or select a Firebase project:

   ```bash
   # Login to Firebase
   firebase login

   # List projects
   firebase projects:list

   # Set project
   firebase use your-project-id
   ```

2. Enable required services in Firebase Console:
   - Firestore Database
   - Cloud Storage
   - Cloud Functions
   - Authentication

3. Configure Firebase project settings:

   ```typescript
   // src/config/firebase.ts
   export const COLLECTION = {
     CARDS: "cards",
     PRICES: "prices",
     SYNC_METADATA: "syncMetadata",
     LOGS: "logs",
     CARD_HASHES: "cardHashes",
     PRICE_HASHES: "priceHashes",
     IMAGE_METADATA: "imageMetadata",
   };

   export const STORAGE = {
     BUCKETS: {
       CARD_IMAGES: "your-project-id.firebasestorage.app",
     },
     PATHS: {
       IMAGES: "card-images",
     },
   };
   ```

## Local Development Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd fftcg-sync-service
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up ESLint configuration:

   ```json
   // .eslintrc.js
   {
     "root": true,
     "env": {
       "es6": true,
       "node": true
     },
     "extends": [
       "eslint:recommended",
       "plugin:import/errors",
       "plugin:import/warnings",
       "plugin:import/typescript",
       "google",
       "plugin:@typescript-eslint/recommended"
     ],
     "parser": "@typescript-eslint/parser",
     "parserOptions": {
       "project": ["tsconfig.json", "tsconfig.dev.json"],
       "sourceType": "module"
     }
   }
   ```

4. Configure TypeScript:

   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "module": "commonjs",
       "noImplicitReturns": true,
       "noUnusedLocals": true,
       "outDir": "lib",
       "sourceMap": true,
       "strict": true,
       "target": "es2017",
       "esModuleInterop": true,
       "skipLibCheck": true,
       "types": ["node", "express"],
       "baseUrl": "./src",
       "lib": ["es2017", "dom"]
     },
     "compileOnSave": true,
     "include": [
       "src/**/*"
     ]
   }
   ```

## Project Structure

The project follows this structure:

<ProjectStructure />

Key directories:

- `/src/config`: Configuration files
- `/src/services`: Core service implementations
- `/src/utils`: Utility functions
- `/src/types`: TypeScript type definitions
- `/src/test`: Test implementations

## Function Configuration

Configure Cloud Functions runtime options:

```typescript
// src/config/firebase.ts
export const runtimeOpts = {
  timeoutSeconds: 540,
  memory: "1GiB",
} as const;
```

## Available Scripts

```json
{
  "scripts": {
    "clean": "rimraf lib",
    "lint": "eslint --ext .js,.ts .",
    "lint:fix": "eslint --ext .js,.ts . --fix",
    "build": "npm run clean && tsc",
    "build:watch": "tsc --watch",
    "serve": "npm run build && firebase emulators:start --only functions,firestore,storage",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "npm run lint:fix && firebase deploy --only functions",
    "logs": "firebase functions:log",
    "test:images": "ts-node src/test/testImageHandler.ts"
  }
}
```

## Testing Setup

1. Configure test endpoints:

   ```typescript
   // src/test/testEndpoints.ts
   const FIREBASE_REGION = "us-central1";
   const PROJECT_ID = "your-project-id";
   const BASE_URL = `https://${FIREBASE_REGION}-${PROJECT_ID}.cloudfunctions.net`;
   ```

2. Run image processing tests:

   ```bash
   npm run test:images
   ```

3. Test sync operations:

   ```typescript
   // src/test/testSync.ts
   const testSync = async () => {
     // Test card sync
     const cardSyncResult = await runSyncTest("testCardSync", {
       limit: 5,
       dryRun: true,
       groupId: "23783"
     }, "Card Sync");

     // Test price sync
     const priceSyncResult = await runSyncTest("testPriceSync", {
       groupId: "23783",
       dryRun: true,
       limit: 5
     }, "Price Sync");
   };
   ```

## Deployment

1. Build the project:

   ```bash
   npm run build
   ```

2. Deploy to Firebase:

   ```bash
   npm run deploy
   ```

3. Verify deployment:

   ```bash
   firebase functions:log
   ```

## Environment Configuration

Set up environment variables in Firebase:

```bash
firebase functions:config:set tcgplayer.base_url="https://tcgcsv.com"
firebase functions:config:set tcgplayer.category_id="24"
```

## Firebase Security Rules

1. Storage Rules:

   ```typescript
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /card-images/{groupId}/{imageId} {
         allow read: if true;
         allow write: if request.auth != null 
           && request.auth.token.admin == true;
       }
     }
   }
   ```

2. Firestore Rules:

   ```typescript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read: if true;
         allow write: if request.auth != null 
           && request.auth.token.admin == true;
       }
     }
   }
   ```

## Post-Installation Verification

1. Check system health:

   ```bash
   curl https://${REGION}-${PROJECT_ID}.cloudfunctions.net/healthCheck
   ```

2. Run validation:

   ```bash
   ts-node src/test/validateSync.ts
   ```

3. Monitor logs:

   ```bash
   firebase functions:log --only syncCards,syncPrices
   ```

## Troubleshooting

Common installation issues:

1. **Node.js Version Mismatch**:

   ```bash
   # Check Node.js version
   node --version

   # Should be >= 18.0.0
   ```

2. **Firebase CLI Authentication**:

   ```bash
   # Re-authenticate
   firebase logout
   firebase login
   ```

3. **Build Errors**:

   ```bash
   # Clear build cache
   npm run clean

   # Reinstall dependencies
   rm -rf node_modules
   npm install

   # Rebuild
   npm run build
   ```

## Next Steps

1. [Configure the service](/setup/configuration)
2. [Review the API documentation](/api/)
3. [Check the architecture overview](/architecture)
4. [View the troubleshooting guide](/troubleshooting)
