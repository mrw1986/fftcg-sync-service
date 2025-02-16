# Current Task: Card Name and Number Processing

## Objectives

- Fix card name processing to properly handle special parentheses content
- Fix cardNumbers array to include all numbers for multi-number cards
- Skip name processing for Crystal cards

## Current Status

- In Progress
- Issues identified with name processing and card numbers

### Name Processing Issues

1. Special parentheses content not being preserved correctly
   - Example: "Rufus (Road to Worlds 2024)" being reduced to just "Rufus"
   - Special content like "Road to Worlds 2024" should be kept
2. Crystal cards being unnecessarily processed
   - Need to skip name processing for Crystal cards entirely

### Card Numbers Issues

1. Combined card numbers not being properly split
   - Example: "PR-050;1-080H" appearing in cardNumbers array
   - Should be split into ["PR-050", "1-080H"]
2. fullCardNumber field format
   - Should use forward slash (/) instead of semicolon (;)

## Next Steps

1. Fix name processing in updateCardsWithSquareEnixData.ts:
   - Review and update isSpecialContent function
   - Ensure cleanCardName preserves special parentheses
   - Add proper logging to track name changes
2. Fix card numbers handling:
   - Update cardNumbers array splitting logic
   - Ensure proper separator usage in fullCardNumber
3. Add Crystal card exclusion:
   - Skip name processing for Crystal cards
   - Maintain original names for Crystal cards

## Technical Details

- Location: functions/src/scripts/updateCardsWithSquareEnixData.ts
- Related Files:
  - functions/src/services/cardSync.ts
  - functions/src/scripts/syncAll.ts
