import { squareEnixSync } from '../services/squareEnixSync';

async function testApi() {
  try {
    console.log('Testing Square Enix API integration');

    // Fetch all cards using the service
    const cards = await squareEnixSync.fetchAllCards();
    const totalCards = cards.length;
    console.log(`Successfully fetched ${totalCards} cards`);
    
    // Display first card as a sample
    if (cards.length > 0) {
      const firstCard = cards[0];
      console.log('\nFirst card sample:');
      const sampleCard = {
        id: firstCard.id,
        code: firstCard.code,
        image: firstCard.image,
        element: firstCard.element,
        rarity: firstCard.rarity,
        cost: firstCard.cost,
        power: firstCard.power,
        category_1: firstCard.category_1,
        category_2: firstCard.category_2,
        multicard: firstCard.multicard,
        ex_burst: firstCard.ex_burst,
        set: firstCard.set,
        name_en: firstCard.name_en,
        type_en: firstCard.type_en,
        job_en: firstCard.job_en,
        text_en: firstCard.text_en,
        images: firstCard.images
      };

      // Log the sample card with special handling for arrays
      const output = Object.entries(sampleCard).map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${JSON.stringify(value)}`;
        }
        if (typeof value === 'object' && value !== null) {
          return `${key}: ${JSON.stringify(value, null, 2)}`;
        }
        return `${key}: ${value}`;
      }).join('\n');

      console.log(output);

      // Verify data integrity
      console.log('\nVerifying data integrity:');
      console.log('1. Sequential IDs:', cards.every((card, index) => card.id === index + 1));
      console.log('2. Total cards validation:', totalCards > 0);
      console.log('3. First card validation:');
      console.log('   - ID = 1:', firstCard.id === 1);
      console.log('   - Code = 1-001H:', firstCard.code === '1-001H');
      console.log('   - Element = ["火"]:', JSON.stringify(firstCard.element) === JSON.stringify(['火']));
      console.log('   - Set = ["Opus I"]:', JSON.stringify(firstCard.set) === JSON.stringify(['Opus I']));
      console.log('   - Has valid image URLs:', 
        firstCard.images.thumbs.length > 0 && 
        firstCard.images.full.length > 0 && 
        firstCard.images.thumbs[0].startsWith('https://') &&
        firstCard.images.full[0].startsWith('https://')
      );
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
