# react-i18next integration

- **Install:** `npm install react-i18next@17.0.11 i18next`
- **Surface:** app shell and settings language switch.
- **Theme hook:** set `lang` and `dir`; convert physical CSS to logical properties before Arabic launch.
- **Escape hatch:** English resources stay local JSON; remove the provider and map keys to English.
- **Removal cost:** medium once many strings migrate.

```tsx
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
void i18n.use(initReactI18next).init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { translation: { accounts: 'Accounts', reports: 'Reports' } } },
  interpolation: { escapeValue: false },
});
export function applyLocale(locale: 'en' | 'ar') {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}
```

**Test:** switching locale updates text, `lang` and `dir` without reload; money stays governed by `Intl.NumberFormat`.
