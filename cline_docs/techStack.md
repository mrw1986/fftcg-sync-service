# Technology Stack

## Core Technologies

- TypeScript
- Node.js
- Firebase/Firestore
- Cloudflare R2 Storage

## Key Components

### Group Sync Service

- Location: functions/src/services/groupSync.ts
- Purpose: Manages group data and set names
- Features:
  - Group data synchronization
  - Set name management
  - Data consistency
  - Hash-based change detection

### Card Sync Service

- Location: functions/src/services/cardSync.ts
- Purpose: Handles card data synchronization from TCGCSV API
- Current Features:
  - Enhanced name processing
    - Special content preservation
    - Date handling
    - Card number removal
  - Category handling
    - DFF prioritization
    - Middot separator
    - Array ordering
  - Description formatting
    - "EX BURST" capitalization
    - Duplicate "Dull" removal
    - Tag preservation
  - Group-based set names
  - Crystal card special handling

### Square Enix Integration

- Location: functions/src/services/squareEnixSync.ts
- Purpose: Integrates Square Enix card data
- Features:
  - Data normalization
  - Hash-based change detection
  - Batch processing

### Search Index Service

- Location: functions/src/services/searchIndexService.ts
- Purpose: Maintains searchable card index
- Features:
  - Full-text search support
  - Automatic index updates
  - Batch processing optimization

## Architecture Decisions

### Data Processing

- Group sync as first step
- Batch processing for efficiency
- Hash-based change detection
- Incremental updates
- Rate limiting for API calls

### Storage

- Firestore for card data
- Cloudflare R2 for image storage
- Optimized image processing pipeline

### Current Challenges

1. Name Processing
   - Special content preservation
   - Crystal card handling
   - Date preservation
   - Card number removal
   - Parentheses content validation

2. Category Handling
   - DFF prioritization
   - Middot separator
   - Array ordering
   - Format consistency

3. Group Integration
   - Set name consistency
   - Group ID handling
   - Data synchronization
   - Process ordering
