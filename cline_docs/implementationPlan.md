# Implementation Plan

## 1. Card Number Matching Enhancement

### Current Issue

When matching cards between collections, only a single card number is being checked. For cards with multiple numbers (e.g., PR-007 and 2-006R), we need to check all numbers for potential matches.

### Solution

Modify `findCardNumberMatch` in `updateCardsWithSquareEnixData.ts`:

```typescript
function findCardNumberMatch(tcgCard: TcgCard, seCard: SquareEnixCard): boolean {
  function normalizeForComparison(number: string): string {
    return number.replace(/[-\s.,;/]/g, "").toUpperCase();
  }

  // Get all Square Enix card numbers (split by forward slash)
  const seNumbers = seCard.code.split("/").map(n => normalizeForComparison(n.trim()));
  
  // Get all TCG card numbers
  const tcgNumbers = getAllCardNumbers(tcgCard);
  if (!tcgNumbers) {
    return false;
  }

  // For each TCG card number, check if it matches any Square Enix number
  return tcgNumbers.some(tcgNum => {
    const normalizedTcgNum = normalizeForComparison(tcgNum);
    
    // For promo cards, extract and compare the base number
    if (isPromoCard([tcgNum])) {
      const match = tcgNum.match(/PR-\d+\/(.+)/);
      if (match) {
        const baseNum = normalizeForComparison(match[1]);
        return seNumbers.some(seNum => baseNum === seNum);
      }
      return false;
    }

    // For non-promo cards, directly compare normalized numbers
    return seNumbers.some(seNum => normalizedTcgNum === seNum);
  });
}
```

## 2. Card Name Processing Improvements

### Current Issue

Card names are not being processed correctly in certain cases:

- "Kain - PR-009/2-103H (Alternate Art Promo)" becomes "Kain - PR"
- "Yuri (PR-055)" becomes "Yuri (PR"
- "Zack - PR071/007H" retains numbers

### Solution

Update `cleanDisplayName` in `cardSync.ts`:

```typescript
private cleanDisplayName(name: string): string {
  // First remove card numbers while preserving content in parentheses
  const withoutNumbers = name
    .replace(/\s*[-–—]\s*(?:PR-\d{3}(?:\/\d{1,2}-\d{3}[A-Z])?|\d{1,2}-\d{3}[A-Z]|[A-C]-\d{3})\s*(?=\(|$)/, "")
    .replace(/\s*[-–—]\s*(?:PR|P)-?\d+(?:\/\d+-\d+[A-Z])?(?=\s*\(|$)/, "") // Handle PR/P prefix numbers
    .trim();

  // Special keywords that indicate we should keep the content
  const specialKeywords = [
    "Full Art",
    "Promo",
    "Road to World Championship",
    "Champion",
    "Anniversary",
    "Prerelease Promo",
    "Alternate Art Promo",
    "Full Art Reprint",
    "Buy A Box Promo"
  ];

  // Process all parentheses content
  const parts = withoutNumbers.split(/\s*\((.*?)\)\s*/);
  const processedParts: string[] = [parts[0]]; // Start with the base name

  // Process each parentheses content
  for (let i = 1; i < parts.length; i += 2) {
    const content = parts[i];
    if (!content) continue;

    // Remove "(Common)" and "(Rare)" suffixes
    if (/^(?:Common|Rare)$/.test(content)) {
      continue;
    }

    // Always keep special keywords
    if (specialKeywords.some(keyword => content.includes(keyword))) {
      // Special case: If content is just "PR" or starts with "PR-", skip it
      if (content === "PR" || content.startsWith("PR-")) {
        continue;
      }
      processedParts.push(`(${content})`);
      continue;
    }

    // Keep month year patterns
    const monthYearPattern = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/;
    if (monthYearPattern.test(content)) {
      processedParts.push(`(${content})`);
      continue;
    }

    // Keep content with years (but not if it's just a number)
    if (/\b\d{4}\b/.test(content) && !/^\d+$/.test(content)) {
      processedParts.push(`(${content})`);
      continue;
    }
  }

  // Join all parts with spaces and clean up any double spaces
  return processedParts.join(" ").replace(/\s+/g, " ").trim();
}
```

## 3. Dull Text Processing

### Current Issue

"Dull" text is not being handled consistently in card descriptions. The rules are:

1. [Dull] should only appear to the left of the colon in the description
2. HTML tags (<b>, <strong>, <em>) should never be used for "Dull"
3. "Dull" should either be wrapped in brackets [Dull] or appear as plain text

### Solution

Update `processDescription` in `cardSync.ts`:

```typescript
private processDescription(description: string | null): string | null {
  if (!description) return null;

  // 1. Capitalize "ex burst" to "EX BURST"
  let processed = description.replace(/\bex burst\b/gi, "EX BURST");

  // 2. Handle "Dull" text
  // Split description into left and right parts at the colon
  const parts = processed.split(/\s*:\s*/);
  if (parts.length === 2) {
    // Left side: Keep [Dull] and remove unbracketed Dull
    let leftSide = parts[0];
    // Temporarily protect [Dull]
    leftSide = leftSide.replace(/\[Dull\]/g, "###PROTECTED_DULL###");
    // Remove unbracketed Dull
    leftSide = leftSide.replace(/\bDull\b/g, "");
    // Restore [Dull]
    leftSide = leftSide.replace(/###PROTECTED_DULL###/g, "[Dull]");

    // Right side: Remove any [Dull] and keep unbracketed Dull
    let rightSide = parts[1];
    // Remove any bracketed [Dull]
    rightSide = rightSide.replace(/\[Dull\]/g, "Dull");

    // Combine the parts
    processed = `${leftSide}: ${rightSide}`;
  }

  // Remove any HTML tags wrapping Dull
  processed = processed.replace(/<[^>]+>Dull<\/[^>]+>/g, "Dull");

  return processed;
}
```

### Dull Text Processing Examples

1. Example with [Dull] on left side:

   ```
   Input: "[Dull]: Dull all the Forwards opponent controls."
   Output: "[Dull]: Dull all the Forwards opponent controls."
   ```

   - Preserves [Dull] on left side
   - Keeps unbracketed Dull on right side

2. Example with unbracketed Dull:

   ```
   Input: "Dull: Dull all the Forwards opponent controls."
   Output: "Dull all the Forwards opponent controls."
   ```

   - Removes unbracketed Dull on left side
   - Keeps unbracketed Dull on right side

3. Example with HTML tags:

   ```
   Input: "<b>Dull</b>: Dull all the Forwards opponent controls."
   Output: "Dull all the Forwards opponent controls."
   ```

   - Removes HTML-tagged Dull
   - Keeps unbracketed Dull on right side

4. Example with multiple Dull instances:

   ```
   Input: "[Dull] Dull: [Dull] Dull all the Forwards opponent controls."
   Output: "[Dull]: Dull all the Forwards opponent controls."
   ```

   - Keeps only [Dull] on left side
   - Removes extra Dull on left side
   - Removes [Dull] on right side
   - Keeps unbracketed Dull on right side

## Implementation Steps

1. Card Number Matching:
   - Update findCardNumberMatch function in updateCardsWithSquareEnixData.ts
   - Add logging for number matching process
   - Test with cards having multiple numbers

2. Card Name Processing:
   - Update cleanDisplayName function in cardSync.ts
   - Add new special keywords
   - Improve number removal regex
   - Test with various card name formats

3. Dull Text Processing:
   - Update processDescription function in cardSync.ts
   - Split description at colon
   - Handle [Dull] only on left side
   - Remove HTML tags for Dull
   - Test with various description formats

## Testing Plan

1. Card Number Matching:
   - Test cards with single numbers
   - Test cards with multiple numbers
   - Test promo cards with alternate numbers
   - Verify all valid matches are found

2. Card Name Processing:
   - Test regular card names
   - Test promo card names
   - Test alternate art cards
   - Test cards with dates/special content
   - Verify correct preservation of special terms

3. Dull Text Processing:
   - Test descriptions with [Dull] on left side
   - Test descriptions with unbracketed Dull
   - Test descriptions with HTML tags
   - Test descriptions with multiple Dull instances
   - Verify correct handling based on colon position

## Recommendation

After updating the implementation plan with the correct Dull text handling rules, we should proceed with implementing these changes one at a time, starting with the card number matching enhancement.
