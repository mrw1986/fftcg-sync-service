# Codebase Summary

## Key Components and Their Interactions

### Card Sync Pipeline

1. Group Sync (groupSync.ts)
   - First step in sync process
   - Manages set names
   - Handles group data
   - Ensures data consistency

2. TCGCSV API Integration (cardSync.ts)
   - Fetches card data
   - Processes basic card information
   - Enhanced name processing
   - Improved category handling
   - Description text formatting
   - Group-based set names
   - Validates card numbers
   - Handles promo cards
   - Card versioning with dataVersion field
   - Incremental sync support for app clients

3. Square Enix Integration (squareEnixSync.ts)
   - Enriches card data
   - Provides additional card details
   - Manages data versioning
   - Handles categories properly
   - Maintains data consistency
   - Updates cost/power values

4. Search Indexing (searchIndexService.ts)
   - Maintains search index
   - Progressive substring search
   - Number-specific search terms
   - Hash-based change detection
   - Batch processing optimization

## Data Flow

1. Group Data Ingestion
   - TCGCSV API → Group Sync Service
   - Group Data → Firestore
   - Set Names → Card Processing

2. Card Data Ingestion
   - TCGCSV API → Card Sync Service
   - Square Enix Data → Square Enix Sync
   - Combined Data → Firestore
   - Hash-based change detection

3. Image Processing
   - Source URLs → R2 Storage
   - Multiple resolutions
   - Metadata tracking
   - Optimized storage

4. Search Index Updates
   - Card Changes → Search Index
   - Batch Processing
   - Real-time Updates
   - Progressive search terms

## External Dependencies

- TCGCSV API
- Square Enix Data Source
- Cloudflare R2
- Firebase/Firestore

## Recent Significant Changes

1. Card Description Processing Fixes
   - Fixed incorrect removal of "Dull" text from card descriptions
   - Modified [`processDescription`](functions/src/services/cardSync.ts:356) function to preserve "Dull" when it's an ability cost
   - Added comprehensive test coverage in [`testDescriptionProcessing.ts`](functions/src/scripts/testDescriptionProcessing.ts)
   - Analyzed HTML entity case conversion (determined to be external to processing code)

2. Missing Field Population from Square Enix Data
   - Added intelligent detection and correction of cards incorrectly marked as non-cards
   - Implemented automatic population of missing fields (cardType, elements, categories, etc.)
   - Fixed field mapping between Square Enix API and Firestore (type_en → type)
   - Enhanced validation of card-specific fields
   - Improved logging for better debugging and monitoring

3. Reprint Card Number Handling
   - Added support for "Re-" prefix card numbers
   - Improved hash calculation to include "Re-" prefix numbers
   - Enhanced Square Enix data integration to preserve "Re-" prefix numbers
   - Updated search index generation for "Re-" prefix numbers
   - Fixed card number merging during Square Enix data updates

4. Metadata System Implementation
   - Added dataVersion field to card documents
   - Implemented smart detection for existing cards
   - Enabled incremental sync for app clients
   - Reduced Firestore reads during updates
   - Improved version tracking between app and backend

5. Square Enix Data Integration
   - Cost/power value updates
   - Category handling improvements
   - Square Enix data used as the source of truth for categories
   - Duplicate category prevention
   - Consistent middot handling
   - Preservation of TCGCSV-specific card numbers
   - Enhanced non-card product detection
6. Group Integration
   - Group sync as first step
   - Set name handling from groups
   - Proper group ID handling
   - Data consistency improvements

7. Name Processing Updates
   - Enhanced special content preservation
   - Improved card number removal
   - Date preservation in names
   - Crystal card handling
   - Proper handling of special keywords

8. Category Handling Improvements
   - DFF category prioritization
   - Middot separator implementation
   - Array ordering
   - Format consistency
   - Raw category preservation
   - Duplicate category prevention
   - Square Enix data used as the source of truth for categories
   - Consistent formatting rules for specific categories:
     - "Theatrhythm", "Mobius", "Pictlogica", and "Type-0" in exact format
     - "World of Final Fantasy" converted to "WOFF"
     - "Lord of Vermilion" converted to "LOV"
   - Roman numerals always in uppercase
   - Known acronyms preserved in uppercase
   - Other categories in title case

## Current Focus

1. Data Accuracy
   - Cost/power value synchronization
   - Category deduplication
   - Middot handling consistency
   - Data validation improvements
   - Edge case handling

2. Performance Optimization
   - Batch processing efficiency
   - Memory usage optimization
   - Query optimization
   - Rate limiting improvements
   - Caching strategies

3. Testing Implementation
   - Unit test development
   - Integration testing
   - Error scenario coverage
   - Load testing
   - Performance benchmarking

4. Documentation
   - API documentation
   - Architecture details
   - Deployment guides
   - Performance tuning
   - Error handling guides

## User Feedback Integration

- Name preservation requirements met
  - Special content preserved
  - Crystal cards handled correctly
  - Promo cards managed properly
  - Dates preserved in names
  - Card numbers properly removed

- Category handling requirements satisfied
  - DFF prioritization implemented
  - Middot separator added
  - Array ordering maintained
  - Format consistency ensured
  - Raw data preserved
  - Duplicates prevented
  - Specific category formatting rules implemented:
    - "Theatrhythm", "Mobius", "Pictlogica", and "Type-0" in exact format
    - "World of Final Fantasy" as "WOFF"
    - "Lord of Vermilion" as "LOV"
    - Roman numerals in uppercase
  - Square Enix data used as the source of truth for categories

- Group integration complete
  - Set names from groups
  - Proper ID handling
  - Data consistency maintained
  - Sync order optimized

- Description formatting improved
  - "EX BURST" capitalization
  - Duplicate "Dull" removal
  - Tag preservation
  - Format consistency

## Future Development

1. Performance Enhancements
   - Query optimization
   - Caching improvements
   - Memory usage optimization
   - Batch processing refinements

2. Testing Infrastructure
   - Automated testing pipeline
   - Performance testing suite
   - Error scenario coverage
   - Integration test framework

3. Feature Extensions
   - Real-time sync capabilities
   - Enhanced search features
   - API endpoint development
   - Mobile optimization
   - Data validation improvements
