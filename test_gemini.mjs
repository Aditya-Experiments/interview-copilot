import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
  console.log('Please set GEMINI_API_KEY environment variable to run this test.');
  process.exit(0);
}

const ai = new GoogleGenAI({
  apiKey
});

async function test() {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: 'Hello! Respond with: Gemini 3.1 Flash Lite is working!'
    });
    console.log('SUCCESS:', response.text);
  } catch (err) {
    console.error('ERROR status:', err?.status);
    console.error('ERROR message:', err?.message);
    console.error('ERROR details:', JSON.stringify(err, null, 2));
  }
}

test();
