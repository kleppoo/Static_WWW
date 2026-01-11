# Battery Info Static (template)

Statyczny template stron informacyjnych o bateriach w dwóch wersjach:
- **battery-info.html** - strona po zeskanowaniu QR (dane techniczne, zgodność, dokumenty)
- **instructions-safety.html** - instrukcje użytkowania i bezpieczeństwa

## 🎯 Kluczowa cecha: 10-letnia trwałość

Wynikowe pliki HTML są **w pełni samodzielne** i zaprojektowane do działania przez 10+ lat bez aktualizacji:
- ✅ Wszystkie CSS/JS/SVG wbudowane inline
- ✅ **Dane hardcoded w HTML** (nie JSON runtime)
- ✅ Brak zewnętrznych zależności (CDN, biblioteki)
- ✅ Działa offline (można otworzyć z dysku)
- ✅ **Działa bez JavaScript** (tylko UI interakcje wymagają JS)
- ✅ Vanilla JavaScript (ES6+), bez frameworków, bez data binding
- ✅ ~24KB + ~35KB (dwa pliki)
- ✅ SHA-256 checksum dla weryfikacji integralności

## Architektura 2-stronowa

### Strona główna: index.html (= battery-info.html)
**Landing page** po zeskanowaniu kodu QR:
- Identyfikacja baterii (model, ID, daty)
- Parametry techniczne (napięcie, pojemność, wymiary)
- Zgodność (piktogramy, SDS, certyfikaty)
- Recykling i utylizacja
- Dokumenty do pobrania
- Link do strony instrukcji →

### Strona 2: instructions-safety.html
**Szczegółowe instrukcje i bezpieczeństwo**:
- Krytyczne ostrzeżenia (emergency grid)
- Instrukcje użytkowania (check/x lists)
- Zasady ładowania
- Przechowywanie i transport
- Wymiana baterii
- Utylizacja (disposal steps)
- FAQ
- Link powrotu do strony głównej ←

**Uwaga**: `index.html` i `battery-info.html` to ten sam plik (kopia). Index.html jest stroną domyślną.

## Lokalny podgląd (DEV)
**Nie otwieraj pliku podwójnym kliknięciem (file://)** — uruchom prosty serwer HTTP.

### Opcja A: Python
```bash
npm run dev
# lub bezpośrednio:
python -m http.server 5173
```

Otwórz w przeglądarce:
- http://localhost:5173/battery-info.template.html (podgląd strony głównej)
- http://localhost:5173/instructions-safety.template.html (podgląd instrukcji)

Edytuj dane w:
- `data/page.json`

Odśwież stronę.

### Opcja B: Node (serve)
```bash
npm run dev:node
# lub bezpośrednio:
npx serve .
```

## Build do publikacji (PROD)
Build tworzy **w pełni samodzielne** pliki HTML bez żadnych zewnętrznych zależności.
Wszystkie assets (CSS, JS, SVG) są wbudowane inline.
Wymaga Node.js 18+.

```bash
npm run build
# lub bezpośrednio:
node tools/build.mjs
```

**Wynik**: dwa pliki HTML (~24KB + ~35KB), które:
- Działają offline przez 10+ lat bez aktualizacji
- **Wszystkie dane wbudowane w HTML** (nie JSON)
- **Działają bez JavaScript** - treść widoczna nawet gdy JS wyłączony
- JavaScript tylko dla UI (przełącznik języka, copy ID)
- Nie wymagają serwera (można otworzyć bezpośrednio z dysku)
- Zawierają wszystko: style, skrypty, logo, dane

### Weryfikacja integralności

Po buildzie możesz zweryfikować poprawność plików:

```bash
npm run verify
# lub bezpośrednio:
node tools/verify.mjs
```

Sprawdza:
- SHA-256 checksum dla obu plików
- Obecność wszystkich inline assetów
- Brak zewnętrznych zależności
- Gotowość do archiwizacji

### Pliki w dist/

- **`index.html`** - **strona główna** (landing page, identyczna z battery-info.html)
- `battery-info.html` - kopia strony głównej
- `battery-info.html.sha256` - checksum
- `instructions-safety.html` - strona instrukcji i bezpieczeństwa
- `instructions-safety.html.sha256` - checksum
- `index.html.sha256` - checksum strony głównej
- `build-metadata.json` - metadane buildu (data, rozmiar, źródła)
- `README.txt` - instrukcje archiwalne

**Do hostingu** wrzucasz wszystkie pliki, ale głównym punktem wejścia jest `index.html`.

## 📚 Dokumentacja archiwalna

Zobacz [ARCHIVAL.md](ARCHIVAL.md) dla szczegółowych instrukcji:
- Jak przechowywać pliki długoterminowo
- Jak weryfikować integralność
- Zalecenia hostingowe
- Co wolno, a czego nie wolno robić z plikami

## Jak to podepniemy pod przyszły panel admina
Panel będzie:
1) zapisywał dane jako JSON (jak `data/page.json`)
2) uruchamiał generator (analogiczny do `tools/build.mjs` albo po stronie backend/worker)
3) publikował `dist/index.html` do S3 pod ścieżką:
   `/b/<kod>/index.html` (gdzie `<kod>` jest unikalnym kodem/slug użytkownika)
