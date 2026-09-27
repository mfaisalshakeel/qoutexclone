import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ar from './locales/ar.json';
import { STORAGE_KEY, applyDocumentDirection } from './config';

function initialLanguage(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* a browser with storage denied just starts in English */
  }
  return 'en';
}

const startingLanguage = initialLanguage();
applyDocumentDirection(startingLanguage);

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: startingLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/** Switches the interface language, persists the choice, and flips the document's text direction. */
export function changeLanguage(language: string): void {
  void i18n.changeLanguage(language);
  applyDocumentDirection(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* a browser with storage denied just asks again next visit */
  }
}

/** Languages this build ships a real translation for — anything else in `localisation.enabledLanguages` falls back to English. */
export const TRANSLATED_LANGUAGES = new Set(['en', 'ar']);

export default i18n;
