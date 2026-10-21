import { describe, expect, it } from 'vitest';
import { aiSchemas, schemaProps, SCHEMA_PROPS_MAX } from '@/lib/ai/schema-registry';

describe('AI 답 모양(JSON 스키마) 크기', () => {
  it('모든 스키마가 Claude 의 문법 한도(속성 약 42개)보다 넉넉히 작다', () => {
    const big = aiSchemas()
      .map((s) => [s.name, schemaProps(s.schema)] as const)
      .filter(([, n]) => n > SCHEMA_PROPS_MAX);
    expect(big).toEqual([]);
  });
  it('속성 수는 안쪽 객체·배열 칸까지 센다', () => {
    const item = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'number' } } } } },
    };
    expect(schemaProps({ type: 'object', properties: { x: item, y: { type: 'array', items: item } } })).toBe(2 + 3 + 3);
  });
  it('모든 객체는 칸을 모두 요구하고 다른 칸을 받지 않는다 (빠지는 칸이 있으면 문법이 커진다)', () => {
    const bad: string[] = [];
    const walk = (name: string, s: unknown) => {
      if (!s || typeof s !== 'object') return;
      if (Array.isArray(s)) return s.forEach((x) => walk(name, x));
      const o = s as Record<string, unknown>;
      if (o.properties) {
        const keys = Object.keys(o.properties as object);
        if (o.additionalProperties !== false || JSON.stringify(o.required) !== JSON.stringify(keys)) bad.push(name);
      }
      Object.values(o).forEach((v) => walk(name, v));
    };
    for (const s of aiSchemas()) walk(s.name, s.schema);
    expect([...new Set(bad)]).toEqual([]);
  });
});
