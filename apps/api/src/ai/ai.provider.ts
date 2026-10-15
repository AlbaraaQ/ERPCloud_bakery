import { Injectable } from '@nestjs/common';
import { ConfigurationError } from '@erpcloud/shared';
export interface AiProviderAdapter { complete(input: { baseUrl: string; model: string; apiKey: string; system: string; user: string }): Promise<string>; }
/** OpenAI-compatible chat adapter. The API key is resolved from the environment/secret store
 *  by reference NAME (ai_provider_configs.secret_ref) — keys never live in the database or client. */
@Injectable()
export class HttpAiProvider implements AiProviderAdapter {
  async complete(input: { baseUrl: string; model: string; apiKey: string; system: string; user: string }): Promise<string> {
    if (!input.apiKey) throw new ConfigurationError('مفتاح مزود الذكاء الاصطناعي غير موجود في مخزن الأسرار');
    const res = await fetch(input.baseUrl.replace(/\/$/, '') + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` }, body: JSON.stringify({ model: input.model, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }], temperature: 0.2 }) });
    if (!res.ok) throw new Error(`AI provider error HTTP ${res.status}`);
    const body = await res.json() as any;
    return body?.choices?.[0]?.message?.content ?? '';
  }
}
export function resolveProviderKey(secretRef: string): string {
  const key = process.env[secretRef];
  if (!key) throw new ConfigurationError(`سر المزود (${secretRef}) غير موجود في بيئة الخادم`);
  return key;
}
