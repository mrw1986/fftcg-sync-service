# Codebase Summary

## Key Components and Their Interactions

### Card Sync Pipeline

1. TCGCSV API Integration (cardSync.ts)
   - Fetches card data
   - Processes basic card information
   - Handles image URLs
   - Manages special card names
   - Validates card numbers
   - Handles promo cards

2. Square Enix Integration (squareEnixSync.ts)
   - Enriches card data
   - Provides additional card details
   - Manages data versioning
   - Handles categories properly
   - Maintains data consistency

3. Search Indexing (searchIndexService.ts)
   - Maintains search index
   - Progressive substring search
   - Number-specific search terms
   - Hash-based change detection
   - Batch processing optimization

## Data Flow

1. Card Data Ingestion
   - TCGCSV API → Card Sync Service
   - Square Enix Data → Square Enix Sync
   - Combined Data → Firestore
   - Hash-based change detection

2. Image Processing
   - Source URLs → R2 Storage
   - Multiple resolutions
   - Metadata tracking
   - Optimized storage

3. Search Index Updates
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

1. Search Improvements
   - Progressive substring search
   - Number-specific terms
   - Optimized indexing
   - Batch processing

2. Name Processing Updates
   - Special content preservation
   - Crystal card handling
   - Improved normalization
   - Promo card handling

3. Card Number Improvements
   - Multi-number support
   - Separator standardization
   - Format validation
   - Promo number handling

4. Category Handling
   - Raw category preservation
   - Proper array format
   - Square Enix integration
   - Consistent data structure

## Current Focus

1. Performance Optimization
   - Batch processing efficiency
   - Memory usage optimization
   - Query optimization
   - Rate limiting improvements
   - Caching strategies

2. Testing Implementation
   - Unit test development
   - Integration testing
   - Error scenario coverage
   - Load testing
   - Performance benchmarking

3. Documentation
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

- Card number format standardization complete
  - Multi-number support implemented
  - Proper separator usage
  - Format validation in place

- Category handling requirements satisfied
  - Raw data preserved
  - Proper structure maintained
  - Square Enix integration complete

- Search functionality enhanced
  - Progressive search implemented
  - Number search optimized
  - Batch processing improved

## Future Development

1. Performance Enhancements
   - Query optimization
   - Caching improvements
   - Memory usage optimization

2. Testing Infrastructure
   - Automated testing pipeline
   - Performance testing suite
   - Error scenario coverage

3. Feature Extensions
   - Real-time sync capabilities
   - Enhanced search features
   - API endpoint development
   - Mobile optimization
