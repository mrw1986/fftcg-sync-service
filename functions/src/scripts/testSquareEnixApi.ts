import { squareEnixSync, type SquareEnixCard } from '../services/squareEnixSync';

async function testApi() {
  try {
    console.log('Testing Square Enix API integration');

    // Fetch all cards using the service
    const cards = await squareEnixSync.fetchAllCards();
    console.log(`Successfully fetched ${cards.length} cards`);

    // Test some sample card codes
    const sampleCodes = [
      'PR-071',  // Promo card
      '1-001H',  // Single digit prefix
      '11-083R', // Double digit prefix
      'A-001'    // A prefix
    ];

    // Create a mock TCGCSV card for testing enrichment
    const mockCard = {
      productId: 123,
      name: 'Test Card',
      cleanName: 'Test Card',
      cardNumbers: ['1-001H'],
      imageUrl: 'https://example.com/image.jpg',
      extendedData: [
        {
          name: 'Number',
          value: '1-001H'
        }
      ]
    };

    // Test enrichment
    const enrichedCard = squareEnixSync.enrichCardData(mockCard, cards);
    
    // Log enrichment results
    console.log('Sample card enrichment result:');
    console.log(JSON.stringify({ 
      original: mockCard, 
      enriched: enrichedCard 
    }, null, 2));

    // Find and display specific cards by code
    console.log('\nLooking up sample card codes...');
    for (const code of sampleCodes) {
      const card = cards.find((c: SquareEnixCard) => c.code === code);
      
      if (card) {
        console.log(`\nFound card ${code}:`);
        console.log(JSON.stringify({
          code: card.code,
          name: card.name_en,
          type: card.type_en,
          element: card.element,
          set: card.set,
          images: card.images
        }, null, 2));
      } else {
        console.log(`\nCard not found: ${code}`);
      }
    }

  } catch (error) {
    console.error('Test failed:');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  }
}

// Run the test
console.log('Starting Square Enix API test...');
testApi()
  .then(() => console.log('Test complete'))
  .catch(error => {
    console.error('Test failed with error:');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
  });