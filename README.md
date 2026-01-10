# Battery Info Static (template)

To jest statyczny template publicznej strony "Battery Info" (nie paszport), w stylu podobnym do strony ze screena:
- czarny pasek z tytułem
- taby (Battery / Documents / Safety)
- metryki w 3 kolumnach
- dokumenty (PDF) + link do wideo

## Lokalny podgląd (DEV)
**Nie otwieraj pliku podwójnym kliknięciem (file://)** — uruchom prosty serwer HTTP.

### Opcja A: Python
```bash
cd battery-info-static
python -m http.server 5173
```

Otwórz w przeglądarce:
- http://localhost:5173/index.template.html

Edytuj dane w:
- `data/page.json`

Odśwież stronę.

### Opcja B: Node (serve)
```bash
cd battery-info-static
npx serve .
```

## Build do publikacji (PROD)
Build tworzy `dist/index.html` z osadzonym JSON (bez `data/`).
Wymaga Node.js 18+.

```bash
cd battery-info-static
node tools/build.mjs
```

Potem do hostingu (S3/CloudFront) wrzucasz zawartość `dist/`.

## Jak to podepniemy pod przyszły panel admina
Panel będzie:
1) zapisywał dane jako JSON (jak `data/page.json`)
2) uruchamiał generator (analogiczny do `tools/build.mjs` albo po stronie backend/worker)
3) publikował `dist/index.html` do S3 pod ścieżką:
   `/b/<kod>/index.html` (gdzie `<kod>` jest unikalnym kodem/slug użytkownika)
