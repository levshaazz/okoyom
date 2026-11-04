import { describe, expect, it } from 'vitest';
import { addQ, formatQ, formatWeight, mulQ, q } from './rational';

describe('дроби слотов', () => {
  it('сокращает и складывает', () => {
    expect(formatQ(q(2, 4))).toBe('½');
    expect(formatQ(q(2, 3))).toBe('⅔');
    expect(formatQ(q(4, 5))).toBe('⅘');
    expect(formatQ(q(1, 1))).toBe('1');
    expect(formatQ(addQ(q(11), q(1, 3)))).toBe('11⅓');
    expect(formatQ(q(167, 15))).toBe('11 2/15');
    expect(formatWeight(q(0))).toBe('—');
    expect(formatQ(mulQ(q(1, 20), 20))).toBe('1');
  });
});
