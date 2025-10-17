# FFTCG Sync Service - Data Flow Architecture

## Overview

The FFTCG Sync Service implements a **4-phase data synchronization architecture**
that combines data from multiple sources to create comprehensive, accurate card
records. This document outlines the complete data flow, prioritization logic,
and field-by-field source mapping.

## Architecture Principles

### Data Source Hierarchy

1. **Square Enix API**: Authoritative source for core card data (descriptions,
    types, elements)
2. **TCGPlayer API**: Primary source for card discovery and basic metadata
3. **Computed Fields**: Generated from processing the above sources

### Sync Process Philosophy

- **Two-Phase Approach**: Initial creation + authoritative enhancement
- **Defensive Programming**: Always ensure complete data, never leave fields empty
- **Source Prioritization**: Official sources override marketplace sources
- **Batch Processing**: Optimize for performance and reliability

## Complete Sync Process (4 Steps)

### Phase 1: Foundation Setup

#### Step 1: Group Synchronization

**Service**: [`GroupSyncService`](../services/group-sync.md)
**Purpose**: Establish set/group metadata foundation

```typescript
await groupSync.syncGroups();
```

**Data Flow**:

```text
TCGPlayer Groups API → Group Metadata → Firestore Groups Collection
```

**Output**: Set names, group IDs, release information

---

### Phase 2: Initial Card Creation

#### Step 2: TCGPlayer Card Sync

**Service**: [`CardSyncService`](../services/card-sync.md)
**Purpose**: Create base card records with marketplace data

```typescript
await cardSync.syncCards();
```

**Data Sources**: TCGPlayer Products API
**Data Quality**:

- ✅ Complete for: Basic metadata, product IDs, card numbers, images
- ⚠️ Incomplete for: Descriptions (often truncated), some game mechanics

**Fields Populated**:

```typescript
interface TCGPlayerCardData {
  productId: number;           // ✅ Reliable
  name: string;               // ✅ Reliable  
  cardNumbers: string[];      // ✅ Reliable
  description: string;        // ⚠️ Often truncated
  cost: number | null;        // ⚠️ Sometimes missing
  power: number | null;       // ⚠️ Sometimes missing
  elements: string[];         // ⚠️ Basic only
  category: string;           // ⚠️ May be incomplete
  imageUrl: string;           // ✅ Reliable
  set: string[];              // ✅ Reliable
}
```

---

### Phase 3: Authoritative Data Collection

#### Step 3: Square Enix Data Sync

**Service**: [`SquareEnixStorageService`](../services/square-enix-sync.md)
**Purpose**: Collect complete, official card data

```typescript
await squareEnixStorage.syncSquareEnixCards();
```

**Data Sources**: Square Enix Official API
**Data Quality**:

- ✅ Authoritative for: Descriptions, types, elements, categories, mechanics
- ✅ Complete and accurate

**Fields Available**:

```typescript
interface SquareEnixCardData {
  code: string;               // ✅ Official card number
  name: string;               // ✅ Official name
  text: string;               // ✅ COMPLETE description
  type: string;               // ✅ Official type
  element: string[];          // ✅ Complete elements
  category_1: string;         // ✅ Primary category
  category_2?: string;        // ✅ Secondary category
  cost: number | null;        // ✅ Official stats
  power: number | null;       // ✅ Official stats
  job_en: string;             // ✅ Official job
  rarity: string;             // ✅ Official rarity
}
```

---

### Phase 4: Data Enhancement

#### Step 4: Square Enix Enhancement

**Service**: [`updateCardsWithSquareEnixData`](../services/square-enix-sync.md)
**Purpose**: Apply authoritative data to create complete card records

```typescript
await updateCardsWithSquareEnixData();
```

**Process**:

1. Match TCGPlayer cards to Square Enix cards by number and set
2. Apply Square Enix data using field prioritization rules
3. Create complete, accurate card records

---

## Field Prioritization Matrix

| Field | Primary | Fallback | Logic | Why |
|---|---|---|---|---|
| **`description`** | SE `text` | TCG | Overwrite | SE complete |
| **`cardType`** | SE `type` | TCG | Overwrite | SE official |
| **`elements`** | SE `element` | TCG | Overwrite | SE complete |
| **`categories`** | SE categories | TCG | Overwrite | SE official |
| **`job`** | SE `job_en` | TCG | Overwrite | SE official |
| **`rarity`** | SE `rarity` | TCG | Overwrite | SE official |
| **`set`** | SE `set` | TCG | Overwrite | SE official |
| **`cost`** | SE `cost` | TCG | Fill empty | Both OK |
| **`power`** | SE `power` | TCG | Fill empty | Both OK |
| **`productId`** | TCG | N/A | Never | TCG ID |
| **`name`** | Special | | Conditional | Preserve |
| **`cardNumbers`** | Merged | | Merge | Combine |

## Critical Update Logic

### Description Field (Most Important Fix)

**Problem Solved**: Interface mismatch caused descriptions to never update

```typescript
// OLD (BROKEN) - Interface declared wrong field name
interface SquareEnixCard {
  text_en: string; // ❌ Field didn't exist in actual data
}

// NEW (FIXED) - Correct field name
interface SquareEnixCard {
  text: string; // ✅ Matches actual Square Enix data
}
```

**Current Logic**:

```typescript
function updateDescription(tcgCard: TcgCard, seCard: SquareEnixCard): string {
  if (seCard.text && seCard.text.trim() !== "") {
    // ALWAYS use Square Enix when available
    const processed = translateDescription(seCard.text);
    return processed || seCard.text; // Fallback to raw if processing fails
  } else {
    // Only use TCGPlayer if Square Enix has no description
    return tcgCard.description;
  }
}
```

### Card Matching Logic

Cards are matched between sources using:

1. **Card Number Matching**: Normalized comparison (remove separators,
    case-insensitive)
2. **Set Matching**: Verify cards belong to same set/expansion
3. **Special Handling**: Promo cards, multi-number cards, reprint numbers

```typescript
function findCardMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  const numberMatch = findCardNumberMatch(tcgCard, seCard);
  const setMatch = findSetMatch(tcgCard, seCard);
  return numberMatch && setMatch;
}
```

## Data Quality Assurance

### Validation Steps

1. **Length Verification**: Ensure descriptions aren't truncated during
    processing
2. **Content Preservation**: Maintain special formatting and game mechanics text
3. **Fallback Protection**: Always provide valid data, never leave fields null
4. **Change Detection**: Hash-based system to avoid unnecessary updates

### Error Handling

- **Batch Processor Isolation**: Each sync step gets fresh batch processor
- **Graceful Degradation**: Continue processing other cards if one fails
- **Comprehensive Logging**: Track each step for debugging
- **Retry Logic**: Handle transient failures automatically

## Sync Execution

### Scheduled Sync (`scheduledCardSync`)

**Complete 4-step process runs automatically**:

```typescript
export const scheduledCardSync = onSchedule({
  schedule: "0 21 * * *", // Daily at 21:00 UTC
}, async () => {
  // Step 1: Group sync
  await groupSync.syncGroups();
  
  // Step 2: TCGPlayer card sync  
  await cardSync.syncCards();
  
  // Step 3: Square Enix data sync
  await squareEnixStorage.syncSquareEnixCards();
  
  // Step 4: Square Enix enhancement (CRITICAL)
  await updateCardsWithSquareEnixData();
});
```

### Manual Sync Options

- **Individual Steps**: Run any step independently for testing
- **Complete Sync**: [`syncAll.ts`](../scripts/syncAll.ts) includes additional
  steps (search index, filters)
- **Limited Sync**: Test with subset of cards using `limit` parameter

## Performance Considerations

### Batch Processing

- **Concurrent Operations**: Process multiple cards simultaneously
- **Memory Management**: Process in chunks to avoid memory exhaustion  
- **Rate Limiting**: Respect API limits for external services
- **Progress Tracking**: Monitor and log processing progress

### Optimization Strategies

- **Hash-Based Updates**: Only update changed cards
- **Incremental Sync**: Support for updating only newer cards
- **Cache Utilization**: Reduce redundant API calls
- **Connection Pooling**: Efficient database connections

## Monitoring and Observability

### Key Metrics

- **Cards Processed**: Total cards synchronized per run
- **Match Rate**: Percentage of TCGPlayer cards matched with Square Enix data
- **Update Rate**: Cards actually updated (changes detected)
- **Error Rate**: Failed operations per total operations
- **Duration**: Time for each sync phase

### Logging Strategy

- **Structured Logging**: Consistent format for all sync operations
- **Progress Indicators**: Regular updates during long-running operations  
- **Error Context**: Detailed information for debugging failures
- **Performance Metrics**: Timing and resource usage data

## Troubleshooting Guide

### Common Issues

1. **Descriptions Still Truncated**
    - Verify `scheduledCardSync` includes all 4 steps
    - Check Square Enix data exists for specific cards
    - Ensure interface uses correct field names (`text` not `text_en`)

2. **Cards Not Matching**
    - Verify card number normalization logic
    - Check set name consistency between sources
    - Review special character handling

3. **Batch Processing Errors**
    - Ensure each service uses separate batch processor instances
    - Check for memory constraints during large syncs
    - Verify database connection limits

4. **Performance Issues**
    - Monitor batch sizes and processing chunks
    - Check API rate limiting and implement backoff
    - Review memory usage during sync operations

### Debug Tools

- **Card Debug Script**: [`debugCard24005L.ts`](../scripts/debugCard24005L.ts) -
  Test specific card processing
- **Description Test**:
  [`testCard24005LProcessing.ts`](../scripts/testCard24005LProcessing.ts) -
  Verify description processing
- **Consistency Check**:
  [`testSquareEnixConsistency.ts`](../scripts/testSquareEnixConsistency.ts) -
  Validate data consistency

## Related Documentation

- [Card Sync Service](../services/card-sync.md)
- [Square Enix Integration](../services/square-enix-sync.md)
- [Group Sync Service](../services/group-sync.md)
- [Storage Service](../services/storage-service.md)
- [Search Index Service](../services/search-index.md)
- [Batch Processing](../utils/batch.md)
- [Error Handling](../utils/error-handling.md)
