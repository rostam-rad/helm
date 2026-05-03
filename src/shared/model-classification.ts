/**
 * Model classification.
 *
 * Centralizes the table that decides whether a given model name is
 * cloud, local, or unknown. This is the kind of data that wants to live
 * outside business logic — when Anthropic ships a new model or a user
 * runs a model through a new provider, only this file changes.
 */

import type { ModelClass } from './types';

export interface ModelClassification {
  modelClass: ModelClass;
  modelProvider: string | null;
}

interface Rule {
  match: (model: string) => boolean;
  classification: ModelClassification;
}

const RULES: Rule[] = [
  // Local-model providers — tools that proxy local models often prefix the
  // model name with the provider, e.g. "ollama/llama3.1:70b".
  { match: m => m.startsWith('ollama/') || m.startsWith('ollama:'),  classification: { modelClass: 'local', modelProvider: 'ollama' } },
  { match: m => m.startsWith('lmstudio/') || m.includes('lm-studio'),classification: { modelClass: 'local', modelProvider: 'lmstudio' } },
  { match: m => m.startsWith('llama.cpp/') || m.startsWith('llamacpp/'), classification: { modelClass: 'local', modelProvider: 'llamacpp' } },

  // Cloud providers — match by recognisable model family.
  { match: m => /^claude/i.test(m),                                  classification: { modelClass: 'cloud', modelProvider: 'anthropic' } },
  { match: m => /^gpt-|^o[1-9]|^o[1-9]-|chatgpt/i.test(m),           classification: { modelClass: 'cloud', modelProvider: 'openai' } },
  { match: m => /^gemini/i.test(m),                                  classification: { modelClass: 'cloud', modelProvider: 'google' } },
  { match: m => /^grok/i.test(m),                                    classification: { modelClass: 'cloud', modelProvider: 'xai' } },
  { match: m => /^deepseek/i.test(m),                                classification: { modelClass: 'cloud', modelProvider: 'deepseek' } },
];

export function classifyModel(model: string | null): ModelClassification {
  if (!model) return { modelClass: 'unknown', modelProvider: null };
  for (const rule of RULES) {
    if (rule.match(model)) return rule.classification;
  }
  return { modelClass: 'unknown', modelProvider: null };
}
