# Technology Stack

## Core Technologies

- TypeScript
- Node.js
- Firebase/Firestore
- Cloudflare R2 Storage

## Key Components

### Card Sync Service

- Location: functions/src/services/cardSync.ts
- Purpose: Handles card data synchronization from TCGCSV API
- Current Focus:
  - Name processing improvements
  - Card number handling enhancements
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
   - Parentheses content validation

2. Card Number Handling
   - Multi-number support
   - Format standardization
   - Separator consistency
