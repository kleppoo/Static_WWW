# Battery Info Static (template)

To jest statyczny template publicznej strony "Battery Info" (nie paszport), w stylu podobnym do strony ze screena:
- czarny pasek z tytułem
- taby (Battery / Documents / Safety)
- metryki w 3 kolumnach
- dokumenty (PDF) + link do wideo

## 🎯 Kluczowa cecha: 10-letnia trwałość

Wynikowy plik HTML jest **w pełni samodzielny** i zaprojektowany do działania przez 10+ lat bez aktualizacji:
- ✅ Wszystkie CSS/JS/SVG wbudowane inline
- ✅ **Dane hardcoded w HTML** (nie JSON runtime)
- ✅ Brak zewnętrznych zależności (CDN, biblioteki)
- ✅ Działa offline (można otworzyć z dysku)
- ✅ **Działa bez JavaScript** (tylko UI interakcje wymagają JS)
- ✅ Vanilla JavaScript (ES6+), bez frameworków, bez data binding
- ✅ ~20KB jeden plik
- ✅ SHA-256 checksum dla weryfikacji integralności

## Lokalny podgląd (DEV)
**Nie otwieraj pliku podwójnym kliknięciem (file://)** — uruchom prosty serwer HTTP.

### Opcja A: Python
```bash
npm run dev
# lub bezpośrednio:
python -m http.server 5173
```

Otwórz w przeglądarce:
- http://localhost:5173/index.template.html

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
Build tworzy **w pełni samodzielny** `dist/index.html` bez żadnych zewnętrznych zależności.
Wszystkie assets (CSS, JS, SVG, JSON) są wbudowane inline.
Wymaga Node.js 18+.

```bash
npm run build
# lub bezpośrednio:
node tools/build.mjs
```

**Wynik**: jeden plik HTML (~20KB), który:
- Działa offline przez 10+ lat bez aktualizacji
- **Wszystkie dane wbudowane w HTML** (nie JSON)
- **Działa bez JavaScript** - treść widoczna nawet gdy JS wyłączony
- JavaScript tylko dla UI (taby, przełącznik języka)
- Nie wymaga serwera (można otworzyć bezpośrednio z dysku)
- Zawiera wszystko: style, skrypty, logo, dane

### Weryfikacja integralności

Po buildzie możesz zweryfikować poprawność pliku:

```bash
npm run verify
# lub bezpośrednio:
node tools/verify.mjs
```

Sprawdza:
- SHA-256 checksum
- Obecność wszystkich inline assetów
- Brak zewnętrznych zależności
- Gotowość do archiwizacji

### Pliki w dist/

- `index.html` - główny plik (samodzielny)
- `index.html.sha256` - checksum dla weryfikacji
- `build-metadata.json` - metadane buildu (data, rozmiar, źródła)
- `README.txt` - instrukcje archiwalne

Potem do hostingu (S3/CloudFront) wrzucasz tylko `dist/index.html`.

## 📚 Dokumentacja archiwalna

Zobacz [ARCHIVAL.md](ARCHIVAL.md) dla szczegółowych instrukcji:
- Jak przechowywać plik długoterminowo
- Jak weryfikować integralność
- Zalecenia hostingowe
- Co wolno, a czego nie wolno robić z plikiem

## Jak to podepniemy pod przyszły panel admina
Panel będzie:
1) zapisywał dane jako JSON (jak `data/page.json`)
2) uruchamiał generator (analogiczny do `tools/build.mjs` albo po stronie backend/worker)
3) publikował `dist/index.html` do S3 pod ścieżką:
   `/b/<kod>/index.html` (gdzie `<kod>` jest unikalnym kodem/slug użytkownika)
