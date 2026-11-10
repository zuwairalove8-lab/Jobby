import { describe, expect, it } from 'vitest';
import { ageFromDate, computeMatch } from './match';

describe('computeMatch', () => {
  it('scores full required-skill coverage highly', () => {
    const result = computeMatch({
      skills: ['TypeScript', 'React', 'SQL', 'Communication'],
      requirements: ['TypeScript', 'React', 'SQL'],
    });
    expect(result.score).toBe(100);
    expect(result.missing).toEqual([]);
  });

  it('penalises missing required skills and explains them', () => {
    const result = computeMatch({
      skills: ['TypeScript'],
      requirements: ['TypeScript', 'Kubernetes', 'Terraform'],
    });
    expect(result.score).toBeLessThan(100);
    expect(result.missing).toEqual(['Kubernetes', 'Terraform']);
    expect(result.matched).toEqual(['TypeScript → TypeScript']);
  });

  it('matches token overlap such as PostgreSQL vs SQL', () => {
    const result = computeMatch({ skills: ['PostgreSQL'], requirements: ['SQL databases'] });
    expect(result.matched.length).toBe(1);
  });

  it('flags an ineligible age', () => {
    const result = computeMatch({
      skills: ['Security'],
      requirements: ['Security'],
      age: 17,
      minAge: 18,
    });
    expect(result.eligible).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.notes.join(' ')).toMatch(/Age eligibility/);
  });

  it('never exceeds 0..100', () => {
    const result = computeMatch({ skills: [], requirements: [] });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('ageFromDate', () => {
  it('returns null for invalid input', () => {
    expect(ageFromDate(null)).toBeNull();
    expect(ageFromDate('not-a-date')).toBeNull();
  });

  it('computes a plausible age', () => {
    const age = ageFromDate('2000-01-01');
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(25);
  });
});
