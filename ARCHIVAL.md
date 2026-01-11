# Archival Instructions - Battery Info Static Page

## For Archivers / System Administrators (English)

This HTML file is designed for **long-term preservation (10+ years)**.

### Key Properties:
- **Self-contained**: All resources embedded inline
- **No dependencies**: Works without internet connection
- **Future-proof**: Vanilla ES6+ JavaScript, no frameworks
- **Verifiable**: SHA-256 checksum included

### Storage Recommendations:
1. Store alongside `index.html.sha256` checksum file
2. Verify integrity periodically using the checksum
3. Keep in immutable storage (S3 with object lock, Git LFS, etc.)
4. Document in asset inventory with build date

### Hosting (if applicable):
```
Content-Type: text/html; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

### Verification Command (requires Node.js):
```bash
sha256sum -c index.html.sha256
```

Or manually compare SHA-256 hash against `build-metadata.json`.

### DO NOT:
- ❌ Minify or compress (already optimized)
- ❌ Split into separate files
- ❌ Add CDN links or external dependencies
- ❌ Remove HTML comments (contain important archival info)

### Regeneration:
To rebuild from source (requires Node.js 18+):
```bash
node tools/build.mjs
```

---

## Dla Archiwistów / Administratorów (Polski)

Ten plik HTML jest zaprojektowany do **długoterminowego przechowywania (10+ lat)**.

### Kluczowe właściwości:
- **Samodzielny**: Wszystkie zasoby wbudowane
- **Bez zależności**: Działa bez internetu
- **Przyszłościowy**: Czysty JavaScript ES6+, bez frameworków
- **Weryfikowalny**: Zawiera sumę kontrolną SHA-256

### Zalecenia przechowywania:
1. Przechowuj razem z plikiem `index.html.sha256`
2. Weryfikuj integralność okresowo używając sumy kontrolnej
3. Trzymaj w niezmiennym storage (S3 object lock, Git LFS, itp.)
4. Udokumentuj w inwentarzu z datą buildu

### Hosting (jeśli dotyczy):
```
Content-Type: text/html; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
```

### Weryfikacja (wymaga Node.js):
```bash
node tools/verify.mjs
```

Lub ręcznie porównaj hash SHA-256 z `build-metadata.json`.

### NIE WOLNO:
- ❌ Minifikować ani kompresować (już zoptymalizowany)
- ❌ Dzielić na osobne pliki
- ❌ Dodawać linków CDN czy zewnętrznych zależności
- ❌ Usuwać komentarzy HTML (zawierają ważne info archiwalne)

### Ponowne wygenerowanie:
Aby przebudować ze źródeł (wymaga Node.js 18+):
```bash
node tools/build.mjs
```

---

**Generated**: 2026-01-10  
**Builder**: Battery Info Static Builder v1.0  
**License**: [Your license]
