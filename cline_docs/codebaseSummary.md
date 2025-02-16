# Codebase Summary

## Key Components and Their Interactions

### Card Sync Pipeline

1. TCGCSV API Integration (cardSync.ts)
   - Fetches card data
   - Processes basic card information
   - Handles image URLs

2. Square Enix Integration (squareEnixSync.ts)
   - Enriches card data
   - Provides additional card details
   - Manages data versioning

3. Search Indexing (searchIndexService.ts)
   - Maintains search index
   - Updates on card changes
   - Optimizes search performance

## Data Flow

1. Card Data Ingestion
   - TCGCSV API → Card Sync Service
   - Square Enix Data → Square Enix Sync
   - Combined Data → Firestore

2. Image Processing
   - Source URLs → R2 Storage
   - Multiple resolutions
   - Metadata tracking

3. Search Index Updates
   - Card Changes → Search Index
   - Batch Processing
   - Real-time Updates

## External Dependencies

- TCGCSV API
- Square Enix Data Source
- Cloudflare R2
- Firebase/Firestore

## Recent Significant Changes

1. Name Processing Updates
   - Special parentheses handling
   - Crystal card exclusion
   - Improved logging

2. Card Number Improvements
   - Multi-number support
   - Separator standardization
   - Format validation

## Current Issues

1. Name Processing
   - Special content not being preserved (e.g., "Rufus (Road to Worlds 2024)" → "Rufus")
   - Crystal cards being unnecessarily processed
   - Inconsistent parentheses handling

2. Card Numbers
   - Combined numbers not splitting correctly (e.g., "PR-050;1-080H" in cardNumbers array)
   - Inconsistent separator usage (semicolons vs forward slashes)
   - Format validation issues

## User Feedback Integration

- Name preservation requirements identified
  - Special content like "Road to Worlds 2024" must be kept
  - Crystal card names should remain unchanged
  - Parentheses content needs proper validation

- Card Number Format Standardization
  - cardNumbers array should contain individual numbers
  - fullCardNumber should use forward slashes
  - Consistent separator usage across all fields
