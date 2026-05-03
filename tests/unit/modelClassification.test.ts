/**
 * Tests for classifyModel — the rule table that maps model name strings
 * to { modelClass, modelProvider }.
 */

import { describe, it, expect } from 'vitest';
import { classifyModel } from '../../src/shared/model-classification';

describe('classifyModel — null / missing', () => {
  it('returns unknown/null for null', () => {
    expect(classifyModel(null)).toEqual({ modelClass: 'unknown', modelProvider: null });
  });
});

describe('classifyModel — Anthropic Claude (cloud)', () => {
  const cases = [
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
    'Claude-3-Haiku', // capitalisation
  ];
  for (const model of cases) {
    it(`classifies "${model}" as cloud/anthropic`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'cloud', modelProvider: 'anthropic' });
    });
  }
});

describe('classifyModel — OpenAI (cloud)', () => {
  const cases = ['gpt-4o', 'gpt-3.5-turbo', 'o1-preview', 'o3-mini', 'chatgpt-4o-latest'];
  for (const model of cases) {
    it(`classifies "${model}" as cloud/openai`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'cloud', modelProvider: 'openai' });
    });
  }
});

describe('classifyModel — Google Gemini (cloud)', () => {
  const cases = ['gemini-1.5-pro', 'gemini-pro', 'gemini-flash-2.0'];
  for (const model of cases) {
    it(`classifies "${model}" as cloud/google`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'cloud', modelProvider: 'google' });
    });
  }
});

describe('classifyModel — xAI Grok (cloud)', () => {
  it('classifies grok-2 as cloud/xai', () => {
    expect(classifyModel('grok-2')).toEqual({ modelClass: 'cloud', modelProvider: 'xai' });
  });
});

describe('classifyModel — DeepSeek (cloud)', () => {
  it('classifies deepseek-coder as cloud/deepseek', () => {
    expect(classifyModel('deepseek-coder')).toEqual({ modelClass: 'cloud', modelProvider: 'deepseek' });
  });
});

describe('classifyModel — Ollama (local)', () => {
  const cases = ['ollama/llama3.1:70b', 'ollama:llama3', 'ollama/mistral'];
  for (const model of cases) {
    it(`classifies "${model}" as local/ollama`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'local', modelProvider: 'ollama' });
    });
  }
});

describe('classifyModel — LM Studio (local)', () => {
  const cases = ['lmstudio/llama3', 'some-lm-studio-model'];
  for (const model of cases) {
    it(`classifies "${model}" as local/lmstudio`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'local', modelProvider: 'lmstudio' });
    });
  }
});

describe('classifyModel — llama.cpp (local)', () => {
  const cases = ['llama.cpp/llama-7b', 'llamacpp/mixtral'];
  for (const model of cases) {
    it(`classifies "${model}" as local/llamacpp`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'local', modelProvider: 'llamacpp' });
    });
  }
});

describe('classifyModel — unknown', () => {
  const cases = ['totally-unknown-model', 'custom-finetune-v1', 'my-private-llm'];
  for (const model of cases) {
    it(`classifies "${model}" as unknown`, () => {
      expect(classifyModel(model)).toEqual({ modelClass: 'unknown', modelProvider: null });
    });
  }
});
