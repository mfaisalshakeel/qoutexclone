import { describe, expect, it } from 'vitest';
import {
  emailOverrideCache,
  getEmailOverride,
  isAnnouncementStyle,
  isEmailTemplateKey,
  isHomepageSectionKey,
  isLegalSlug,
} from './content.js';

describe('content CMS: the fixed sets', () => {
  it('knows every legal slug and rejects an unknown one', () => {
    expect(isLegalSlug('terms')).toBe(true);
    expect(isLegalSlug('privacy')).toBe(true);
    expect(isLegalSlug('risk-disclosure')).toBe(true);
    expect(isLegalSlug('aml-kyc')).toBe(true);
    expect(isLegalSlug('cookie-policy')).toBe(true);
    expect(isLegalSlug('made-up')).toBe(false);
  });

  it('knows every homepage section key and rejects an unknown one', () => {
    expect(isHomepageSectionKey('hero')).toBe(true);
    expect(isHomepageSectionKey('footer')).toBe(true);
    expect(isHomepageSectionKey('made-up')).toBe(false);
  });

  it('knows every announcement style and rejects an unknown one', () => {
    expect(isAnnouncementStyle('info')).toBe(true);
    expect(isAnnouncementStyle('warning')).toBe(true);
    expect(isAnnouncementStyle('success')).toBe(true);
    expect(isAnnouncementStyle('danger')).toBe(false);
  });

  it('knows every email template key and rejects an unknown one', () => {
    expect(isEmailTemplateKey('verify-email')).toBe(true);
    expect(isEmailTemplateKey('tournament-result')).toBe(true);
    expect(isEmailTemplateKey('made-up')).toBe(false);
  });
});

describe('email override cache', () => {
  it('has nothing before load, and reflects whatever is set afterwards', () => {
    emailOverrideCache._clear();
    expect(getEmailOverride('verify-email')).toBeUndefined();

    emailOverrideCache.set('verify-email', { subject: 'Custom subject', body: 'Custom body' });
    expect(getEmailOverride('verify-email')).toEqual({ subject: 'Custom subject', body: 'Custom body' });

    emailOverrideCache.delete('verify-email');
    expect(getEmailOverride('verify-email')).toBeUndefined();
    emailOverrideCache._clear();
  });
});
