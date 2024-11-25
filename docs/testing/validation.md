# Validation Testing Guide

## Overview

This guide covers the validation testing suite (`validateSync.ts`) which
 ensures data integrity and consistency across the FFTCG Sync Service.

## Validation Configuration

### Firebase Initialization

```typescript
async function initializeFirebase(): Promise<FirebaseFirestore.Firestore> {
  try {
    const serviceAccountPath = path.resolve(
      __dirname,
      "../../../service_account_key.json"
    );
    const serviceAccount = JSON.parse(
      await fs.readFile(serviceAccountPath, "utf8")
    );

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }

    return admin.firestore();
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    throw error;
  }
}
```

## Validation Functions

### Collection Validation

```typescript
async function validateCollection(
  db: FirebaseFirestore.Firestore,
  collectionName: string,
  validator: (doc: FirebaseFirestore.DocumentData) => boolean,
  options: ValidationOptions = {}
): Promise<ValidationResult> {
  const result: ValidationResult = {
    collection: collectionName,
    documentsChecked: 0,
    documentsValid: 0,
    errors: [],
    details: {}
  };

  try {
    let query = db.collection(collectionName)
      .orderBy("lastUpdated", "desc");

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.groupId) {
      query = query.where("groupId", "==", options.groupId);
    }

    const snapshot = await query.get();
    result.documentsChecked = snapshot.size;

    snapshot.forEach((doc) => {
      const data = doc.data();
      try {
        if (validator(data)) {
          result.documentsValid++;
          if (options.verbose) {
            result.details![doc.id] = data;
          }
        } else {
          result.errors.push(`Document ${doc.id} failed validation`);
        }
      } catch (error) {
        result.errors.push(`Error validating ${doc.id}: ${error}`);
      }
    });
  } catch (error) {
    result.errors.push(`Error accessing collection: ${error}`);
  }

  return result;
}
```

## Validation Rules

### Card Data Validation

```typescript
const cardValidator = (data: FirebaseFirestore.DocumentData): boolean => {
  return (
    typeof data.productId === "number" &&
    typeof data.name === "string" &&
    typeof data.lastUpdated === "object" &&
    data.lastUpdated instanceof Timestamp
  );
};
```

### Price Data Validation

```typescript
const priceValidator = (data: FirebaseFirestore.DocumentData): boolean => {
  return (
    data.lastUpdated instanceof Timestamp &&
    (!data.normal || typeof data.normal.midPrice === "number") &&
    (!data.foil || typeof data.foil.midPrice === "number")
  );
};
```

### Sync Metadata Validation

```typescript
const syncMetadataValidator = (data: FirebaseFirestore.DocumentData):
 boolean => {
  return (
    data.lastSync instanceof Timestamp &&
    typeof data.status === "string" &&
    typeof data.cardCount === "number" &&
    Array.isArray(data.errors)
  );
};
```

## Running Validations

### Full Validation

```typescript
async function validateSync(options: ValidationOptions = {}) {
  console.log("Starting sync validation...");
  console.log("Options:", JSON.stringify(options, null, 2));

  const db = await initializeFirebase();

  // Validate cards
  const cardResult = await validateCollection(
    db,
    COLLECTION.CARDS,
    cardValidator,
    options
  );

  // Validate prices
  const priceResult = await validateCollection(
    db,
    COLLECTION.PRICES,
    priceValidator,
    options
  );

  // Validate sync metadata
  const metadataResult = await validateCollection(
    db,
    COLLECTION.SYNC_METADATA,
    syncMetadataValidator,
    options
  );

  // Print results
  printResults([cardResult, priceResult, metadataResult]);
}
```

### Results Output

```typescript
function printResults(results: ValidationResult[]) {
  console.log("\nValidation Results:");
  
  results.forEach((result) => {
    console.log(`\n${result.collection}:`);
    console.log(`Documents Checked: ${result.documentsChecked}`);
    console.log(`Valid Documents: ${result.documentsValid}`);
    
    if (result.errors.length > 0) {
      console.log("Errors:");
      result.errors.forEach((error) => console.log(`- ${error}`));
    }
  });
}
```

## Command Line Interface

### Command Line Options

```typescript
const args = process.argv.slice(2);
const options: ValidationOptions = {
  limit: args.includes("--limit") ? 
    parseInt(args[args.indexOf("--limit") + 1]) : undefined,
  verbose: args.includes("--verbose"),
  groupId: args.includes("--groupId") ? 
    args[args.indexOf("--groupId") + 1] : undefined,
};
```

### Usage Examples

```bash
# Run basic validation
npm run validate-sync

# Run validation with limit
npm run validate-sync -- --limit 100

# Run verbose validation for specific group
npm run validate-sync -- --verbose --groupId 23783
```

## Validation Results

### Success Example

```json
{
  "collection": "cards",
  "documentsChecked": 100,
  "documentsValid": 100,
  "errors": [],
  "details": {}
}
```

### Error Example

```json
{
  "collection": "prices",
  "documentsChecked": 50,
  "documentsValid": 48,
  "errors": [
    "Document abc123 failed validation",
    "Error validating def456: Invalid price format"
  ],
  "details": {}
}
```

## Best Practices

### Validation Strategy

- Validate all required fields
- Check data types
- Verify relationships
- Monitor performance

### Error Handling

- Log validation errors
- Provide detailed messages
- Track error patterns
- Implement recovery

### Performance

- Use appropriate limits
- Implement batching
- Monitor resource usage
- Cache results when appropriate

## Related Documentation

- [Data Models](/reference/types)
- [Error Handling](/utils/error-handling)
- [Testing Overview](/testing/)
- [Configuration Guide](/setup/configuration)
