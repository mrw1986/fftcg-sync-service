# Project Roadmap

## High-Level Goals

- [x] Initial project setup
- [x] Basic card syncing functionality
- [x] Square Enix data integration
- [x] Card name and number processing improvements
- [x] Search functionality enhancements
- [x] Group sync integration
- [x] Category handling improvements
- [x] Cost/power value synchronization
- [x] Category deduplication
- [x] Proper null handling for card fields

## Current Features

- Card syncing from TCGCSV API
- Square Enix data integration
- Image processing and storage
- Search indexing with prefix search
- Proper category handling
- Multi-number card support
- Special name handling
- Crystal card handling
- Batch processing optimization
- Rate limiting and retry logic
- Error handling and logging
- Group-based set name handling
- Enhanced category formatting
- Accurate cost/power synchronization
- Deduplicated categories with proper ordering
- Proper null handling for non-card products
- Improved set matching for data updates

## Completed Tasks

- [x] Basic card syncing implementation
- [x] Square Enix data integration
- [x] Image processing pipeline
- [x] Search index implementation
  - [x] Progressive substring search
  - [x] Number-specific search terms
  - [x] Hash-based change detection
- [x] Batch processing optimization
- [x] Rate limiting implementation
- [x] Error handling improvements
- [x] Logging enhancements
- [x] Category handling improvements
  - [x] Raw category preservation
  - [x] Removed unnecessary processing
  - [x] Fixed array format issues
  - [x] DFF category prioritization
  - [x] Middot separator implementation
  - [x] Category deduplication
  - [x] Consistent character encoding
- [x] Card name processing
  - [x] Special parentheses content preservation
  - [x] Crystal card handling
  - [x] Name normalization improvements
  - [x] Card number removal from display names
  - [x] Proper handling of special keywords
  - [x] Date preservation in names
- [x] Card number handling
  - [x] Multi-number card support
  - [x] Proper separator usage
  - [x] Number format validation
  - [x] Promo card special handling
  - [x] Null handling for non-card products
- [x] Group sync integration
  - [x] Set name handling from groups
  - [x] Group sync as first step
  - [x] Proper group ID handling
- [x] Data accuracy improvements
  - [x] Cost/power value synchronization
    - [x] Proper value validation
    - [x] Conditional updates
    - [x] Null value handling
    - [x] Improved set matching
  - [x] Category handling
    - [x] Removed duplicate categories
    - [x] Consistent middot handling
    - [x] Maintained proper category ordering

## Current Tasks

- [ ] Performance Optimization
  - [ ] Batch processing efficiency review
  - [ ] Memory usage analysis
  - [ ] Query optimization
  - [ ] Rate limiting strategy improvements
  - [ ] Cache mechanism enhancements

- [ ] Testing Infrastructure
  - [ ] Unit test implementation
  - [ ] Integration test setup
  - [ ] Error scenario coverage
  - [ ] Load testing
  - [ ] Performance benchmarks

- [ ] Documentation
  - [ ] API documentation
  - [ ] Architecture details
  - [ ] Deployment guides
  - [ ] Error handling documentation
  - [ ] Performance tuning guidelines

## Future Considerations

- Performance optimization for large card sets
- Enhanced error recovery
- Improved validation for card data
- Extended search capabilities
- Automated testing implementation
- Documentation improvements
- Real-time sync capabilities
- API endpoint development
- Mobile optimization
- Data validation improvements
- Caching strategy enhancements
- Monitoring and alerting system
