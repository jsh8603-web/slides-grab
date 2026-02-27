import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

const SUPPORTED_PROVIDERS = new Set(['google', 'anthropic', 'openai']);

const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function validatePrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('`prompt` must be a non-empty string.');
  }
}

function validateImagePaths(imagePaths) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('`imagePaths` must be a non-empty array.');
  }

  for (const imagePath of imagePaths) {
    if (typeof imagePath !== 'string' || imagePath.trim() === '') {
      throw new Error('Each image path must be a non-empty string.');
    }
  }
}

function resolveProvider(provider) {
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error(
      '`config.provider` is required. Use one of: google, anthropic, openai.',
    );
  }

  const normalizedProvider = provider.toLowerCase();
  if (!SUPPORTED_PROVIDERS.has(normalizedProvider)) {
    throw new Error(
      `Unsupported provider "${provider}". Use one of: google, anthropic, openai.`,
    );
  }

  return normalizedProvider;
}

function resolveModelName(model) {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('`config.model` is required and must be a non-empty string.');
  }

  return model;
}

function resolveApiKey(provider) {
  if (provider === 'google') {
    const apiKey =
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'Google provider requires `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`).',
      );
    }

    return apiKey;
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic provider requires `ANTHROPIC_API_KEY`.');
    }

    return apiKey;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI provider requires `OPENAI_API_KEY`.');
  }

  return apiKey;
}

function createModel({ provider, model, apiKey }) {
  if (provider === 'google') {
    return createGoogleGenerativeAI({ apiKey })(model);
  }

  if (provider === 'anthropic') {
    return createAnthropic({ apiKey })(model);
  }

  return createOpenAI({ apiKey })(model);
}

function toImageContentPart(imagePath, imageBuffer) {
  const extension = path.extname(imagePath).toLowerCase();
  const mediaType = IMAGE_MEDIA_TYPES[extension];

  if (mediaType) {
    return { type: 'image', image: imageBuffer, mediaType };
  }

  return { type: 'image', image: imageBuffer };
}

function normalizeUsage(usage) {
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
}

function normalizeResult(result) {
  return {
    content: result?.text ?? '',
    usage: normalizeUsage(result?.usage),
  };
}

function buildRequestPayload(prompt, imageParts, maxTokens, temperature) {
  const payload = {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }, ...imageParts],
      },
    ],
  };

  if (typeof maxTokens === 'number') {
    payload.maxOutputTokens = maxTokens;
  }

  if (typeof temperature === 'number') {
    payload.temperature = temperature;
  }

  return payload;
}

export async function analyzeImages(imagePaths, prompt, config = {}) {
  validateImagePaths(imagePaths);
  validatePrompt(prompt);

  const provider = resolveProvider(config.provider);
  const model = resolveModelName(config.model);
  const apiKey = resolveApiKey(provider);

  const resolveModel = config._internals?.resolveModel ?? createModel;
  const generateTextFn = config._internals?.generateText ?? generateText;

  const providerModel = resolveModel({ provider, model, apiKey });

  const imageParts = await Promise.all(
    imagePaths.map(async (imagePath) => {
      const imageBuffer = await readFile(imagePath);
      return toImageContentPart(imagePath, imageBuffer);
    }),
  );

  const requestPayload = buildRequestPayload(
    prompt,
    imageParts,
    config.maxTokens,
    config.temperature,
  );

  const result = await generateTextFn({
    model: providerModel,
    ...requestPayload,
  });

  return normalizeResult(result);
}

export async function analyzeImage(imagePath, prompt, config = {}) {
  if (typeof imagePath !== 'string' || imagePath.trim() === '') {
    throw new Error('`imagePath` must be a non-empty string.');
  }

  return analyzeImages([imagePath], prompt, config);
}
