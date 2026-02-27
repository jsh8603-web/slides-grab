import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const modulePath = '../../src/vlm/analyze.js';

async function createTempImage(rootDir, fileName, content) {
  const filePath = path.join(rootDir, fileName);
  await writeFile(filePath, content);
  return filePath;
}

test('analyze module exports analyzeImage and analyzeImages', async () => {
  const mod = await import(modulePath);
  assert.equal(typeof mod.analyzeImage, 'function');
  assert.equal(typeof mod.analyzeImages, 'function');
});

test('analyzeImage returns standardized response shape', async () => {
  const mod = await import(modulePath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vlm-analyze-'));
  try {
    const imagePath = await createTempImage(tempDir, 'one.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let capturedArgs;

    const result = await mod.analyzeImage(imagePath, 'describe image', {
      provider: 'google',
      model: 'gemini-test',
      maxTokens: 256,
      temperature: 0.2,
      _internals: {
        resolveModel: () => 'mock-model',
        generateText: async (args) => {
          capturedArgs = args;
          return {
            text: 'analysis result',
            usage: {
              inputTokens: 111,
              outputTokens: 22,
            },
          };
        },
      },
    });

    assert.deepEqual(result, {
      content: 'analysis result',
      usage: {
        inputTokens: 111,
        outputTokens: 22,
      },
    });

    assert.equal(capturedArgs.model, 'mock-model');
    assert.equal(capturedArgs.maxOutputTokens, 256);
    assert.equal(capturedArgs.temperature, 0.2);

    const [message] = capturedArgs.messages;
    assert.equal(message.role, 'user');
    assert.equal(message.content[0].type, 'text');
    assert.equal(message.content[0].text, 'describe image');
    assert.equal(message.content[1].type, 'image');
    assert.ok(Buffer.isBuffer(message.content[1].image));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('analyzeImages sends multiple images and normalizes missing usage', async () => {
  const mod = await import(modulePath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vlm-analyze-'));
  try {
    const imagePathA = await createTempImage(tempDir, 'a.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    const imagePathB = await createTempImage(tempDir, 'b.jpeg', Buffer.from([0xff, 0xd8, 0xfe]));
    let capturedArgs;

    const result = await mod.analyzeImages([imagePathA, imagePathB], 'analyze both', {
      provider: 'anthropic',
      model: 'claude-test',
      _internals: {
        resolveModel: () => 'mock-model',
        generateText: async (args) => {
          capturedArgs = args;
          return { text: 'multi-analysis' };
        },
      },
    });

    assert.deepEqual(result, {
      content: 'multi-analysis',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    });

    const [message] = capturedArgs.messages;
    assert.equal(message.content.length, 3);
    assert.equal(message.content[1].type, 'image');
    assert.equal(message.content[2].type, 'image');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('analyzeImages validates provider API key environment variable', async () => {
  const mod = await import(modulePath);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'vlm-analyze-'));
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  try {
    const imagePath = await createTempImage(tempDir, 'x.png', Buffer.from([1, 2, 3]));

    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    await assert.rejects(
      () =>
        mod.analyzeImages([imagePath], 'check', {
          provider: 'google',
          model: 'gemini-test',
          _internals: {
            resolveModel: () => 'mock-model',
            generateText: async () => ({ text: 'unused' }),
          },
        }),
      /GEMINI_API_KEY/,
    );
  } finally {
    if (previousGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = previousGemini;
    }

    if (previousGoogle === undefined) {
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    } else {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousGoogle;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});
