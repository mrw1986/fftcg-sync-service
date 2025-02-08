import { db, COLLECTION } from "../config/firebase";
import { OptimizedBatchProcessor } from "../services/batchProcessor";
import { FieldValue } from "firebase-admin/firestore";

function generateSearchTerms(text: string): string[] {
  if (!text) return [];

  const terms = new Set<string>();
  const cleanText = text.toLowerCase().trim();

  // Add full word
  terms.add(cleanText);

  // Add progressive substrings for prefix search
  for (let i = 1; i < cleanText.length; i++) {
    terms.add(cleanText.substring(0, i));
  }

  // Add soundex code
  const soundexCode = soundex(cleanText);
  if (soundexCode) {
    terms.add(soundexCode);
  }

  return Array.from(terms);
}

function generateNumberSearchTerms(numbers: string[]): string[] {
  if (!numbers?.length) return [];

  const terms = new Set<string>();

  numbers.forEach((number) => {
    if (!number) return;

    // Clean and normalize the number
    const cleanNumber = number.toLowerCase().replace(/\s+/g, "");
    const withoutSpecial = cleanNumber.replace(/[^a-z0-9]/g, "");

    // Add full number
    terms.add(cleanNumber); // Original format (e.g., "1-001H")
    terms.add(withoutSpecial); // Without special chars (e.g., "1001H")

    // Add progressive substrings
    for (let i = 1; i < withoutSpecial.length; i++) {
      terms.add(withoutSpecial.substring(0, i));
    }

    // If number contains hyphen, add parts
    if (cleanNumber.includes("-")) {
      const [prefix, suffix] = cleanNumber.split("-");
      if (prefix) terms.add(prefix);
      if (suffix) terms.add(suffix);
    }
  });

  return Array.from(terms);
}

function soundex(s: string): string {
  if (!s) return "";

  // Convert to uppercase and get first character
  s = s.toUpperCase();
  const firstChar = s[0];

  // Map of characters to soundex codes
  const codes: Record<string, string> = {
    A: "",
    E: "",
    I: "",
    O: "",
    U: "",
    B: "1",
    F: "1",
    P: "1",
    V: "1",
    C: "2",
    G: "2",
    J: "2",
    K: "2",
    Q: "2",
    S: "2",
    X: "2",
    Z: "2",
    D: "3",
    T: "3",
    L: "4",
    M: "5",
    N: "5",
    R: "6",
  };

  // Convert remaining characters to codes
  const remaining = s
    .substring(1)
    .split("")
    .map((c) => codes[c] || "")
    .filter((code) => code !== "")
    .join("");

  // Build final soundex code
  const code = firstChar + remaining;
  return (code + "000").substring(0, 4);
}

async function processCardBatch(
  cards: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>,
  batchProcessor: OptimizedBatchProcessor
): Promise<number> {
  let updatedCount = 0;

  try {
    const updatePromises = cards.docs.map(async (doc) => {
      try {
        const cardData = doc.data();

        // Skip if card numbers are missing
        if (!Array.isArray(cardData.cardNumbers)) return;

        // Skip if regular card has no name
        if (!cardData.isNonCard && !cardData.name) return;

        // Generate search terms
        const nameTerms = cardData.name ? generateSearchTerms(cardData.name) : [];
        const numberTerms = generateNumberSearchTerms(cardData.cardNumbers);

        // For regular cards, require name search terms
        if (!cardData.isNonCard && nameTerms.length === 0) return;

        // Combine all search terms
        const searchTerms = [...new Set([...nameTerms, ...numberTerms])];

        // Update the card document
        await batchProcessor.addOperation((batch) => {
          const cardRef = db.collection(COLLECTION.CARDS).doc(doc.id);
          batch.update(cardRef, {
            searchTerms: searchTerms,
            searchLastUpdated: FieldValue.serverTimestamp(),
          });
        });

        updatedCount++;
      } catch (cardError) {
        console.error(`Error processing card ${doc.id}:`, cardError);
      }
    });

    await Promise.all(updatePromises);
    await batchProcessor.commitAll();

    return updatedCount;
  } catch (error) {
    console.error(`Error processing batch:`, error);
    throw error;
  }
}

export async function main(): Promise<void> {
  const batchProcessor = new OptimizedBatchProcessor(db);
  const batchSize = 500;
  let lastProcessedId: string | null = null;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let retryCount = 0;
  const maxRetries = 3;

  try {
    console.log("Starting search index update");

    let hasMoreCards = true;
    while (hasMoreCards) {
      try {
        // Query the next batch of cards
        let query = db.collection(COLLECTION.CARDS).orderBy("__name__").limit(batchSize);

        if (lastProcessedId) {
          query = query.startAfter(lastProcessedId);
        }

        const cards = await query.get();

        // Break if no more cards to process
        if (cards.empty) {
          hasMoreCards = false;
          continue;
        }

        // Process this batch
        const updatedCount = await processCardBatch(cards, batchProcessor);

        // Update progress tracking
        lastProcessedId = cards.docs[cards.docs.length - 1].id;
        totalProcessed += cards.docs.length;
        totalUpdated += updatedCount;
        retryCount = 0; // Reset retry count on success

        console.log("Progress:", {
          batchSize: cards.docs.length,
          totalProcessed,
          totalUpdated,
        });

        // Small delay between batches
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (batchError) {
        console.error("Batch error:", batchError);

        retryCount++;
        if (retryCount >= maxRetries) {
          throw new Error(`Failed after ${maxRetries} retries`);
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    console.log("Search index update completed:", {
      totalProcessed,
      totalUpdated,
    });
  } catch (error) {
    console.error("Search index update failed:", error);
    throw error;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
}
