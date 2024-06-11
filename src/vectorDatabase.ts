import { Pinecone } from '@pinecone-database/pinecone';
import { PINECONE_API_KEY, PINECONE_INDEX_NAME } from './config';

let pineconeIndex: any = null;

// Check if PINECONE_API_KEY is a string 
// and PINECONE_INDEX_NAME is a string and they are not empty
if (
  typeof PINECONE_API_KEY == 'string' 
  && typeof PINECONE_INDEX_NAME == 'string' 
  && PINECONE_API_KEY 
  && PINECONE_INDEX_NAME
) {
  (async () => {
    try {
      // Initialize the Pinecone client
      const pinecone = new Pinecone({
        apiKey: PINECONE_API_KEY,
      });

      // Connect to the Pinecone index
      pineconeIndex = pinecone.index(PINECONE_INDEX_NAME);

      console.log('Pinecone database connected');
    } catch (error) {
      console.error('Error connecting to Pinecone:', error);
    }
  })();
} else {
  console.log('Pinecone database not connected');
}

export { pineconeIndex };
