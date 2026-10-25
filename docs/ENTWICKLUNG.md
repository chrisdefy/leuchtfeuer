# Leuchtfeuer: Technik und Funktionen im Detail

Für alle, die am Code arbeiten. Was die App ist und wie man sie nutzt, steht in der [README](../README.md).

```sh
npm install
npm run dev            # http://localhost:5173
npm run build          # statischer Build nach dist/
npm run pack:desktop   # Leuchtfeuer-Desktop.zip: eine Leuchtfeuer.html + Anleitung, startet per Doppelklick
npm run typecheck      # tsc --noEmit (nicht `tsc -b`: das schreibt .js neben die Quellen)
```

Stack: Vite 8, React 19, TypeScript. Abhängigkeiten nur für Markdown, Code-Hervorhebung, Schriften,
`fflate` (Office-Dateien entpacken) und `@breezystack/lamejs` (MP3 für Hörspiele). Die Speicher-Schlüssel heißen aus
der Zeit vor der Umbenennung `router.*`; sie bleiben so, damit vorhandene Chats erhalten bleiben.

## Funktionen

**Konto und Kosten**
- Anmelden mit OpenRouter (OAuth PKCE, `lib/auth.ts`): mit Rückleitung über eine Web-Adresse, als Datei vom
  Desktop mit einem Code zum Einfügen. Alternativ eigenen API-Key einfügen.
- Guthaben und Gratis-Kontingent in der Seitenleiste, Link „Aufladen“, Warnung unter 0,50 $.
- Jede Antwort zeigt Modell, Tokens, Kosten und Dauer. Anfragen gehen immer an den günstigsten Anbieter
  eines Modells (`provider.sort: "price"`).

**Einführung**
- Beim ersten Start nach der Anmeldung eine geführte Tour (14 Schritte, `components/Tour.tsx`) durch einen
  Beispiel-Chat, der nichts kostet und danach verschwindet. Beim ersten Öffnen der Chatrooms eine eigene Tour
  (13 Schritte, `ROOM_TOUR`) durch einen Beispielraum (Nachbarschaftsstreit mit Mediatorin). Beide wieder aufrufbar
  über „Einführung“ unten in der Seitenleiste (je nach Bereich) und in den Einstellungen.

**Modelle**
- Picker (`⌘K`, `components/ModelPicker.tsx`): Bereiche Text, Bilder, Video, Audio; Preisklassen, Filter nach
  Fähigkeiten (kostenlos, versteht Bilder, liest PDFs, denkt nach, Werkzeuge, viel Gedächtnis). Standardmäßig
  ausgeblendet: Sicherheitsfilter, Spezial-Leuchtfeuer, Vorschau- und datierte Versionen eines veröffentlichten Modells,
  Gratis-Doppelgänger (erscheinen mit „Kostenlos“) und Modelle älter als ein Jahr; die Suche findet alles. „Alle
  Modelle“ zeigt sie samt Experten-Filtern und Anwendungsfällen mit Empfehlungen (`lib/recommend.ts`).
  Modelle mit wenigen Einschränkungen nur nach Opt-in (18+) in den Einstellungen, im Chat mit „18+“ markiert;
  Sortierung nach Benchmark („intelligenteste“, `lib/benchmarks.ts`), Favoriten, zuletzt genutzt. „Schnell &
  günstig“ sortiert automatisch nach Preis, „Kostenlos“ nach Intelligenz. Reiter „Favoriten“: alle Stern-Modelle
  als Tabelle mit Art, Klasse, Fähigkeiten, Intelligenz, Gedächtnis, Preis und Kosten einer typischen Antwort.
  Eine gewählte Sortierung gilt für die ganze Liste (Favoriten und „Zuletzt genutzt“ treten dann zurück); Video hat
  eigene Sortierungen (Preis, Neueste, Länge, Auflösung). Audio ist in „Musik“ (Lyria, Preis pro Song/Clip) und
  „Sprechen“ (GPT Audio) geteilt; kostenlos sind nur `:free`-Modelle und `openrouter/free`.
- Stufen statt Modellliste (`lib/tiers.ts`, `components/TierMenu.tsx`): In der Eingabeleiste wählt man Kostenlos, Leicht,
  Standard oder Stark samt Nachdenken (kurz/normal/gründlich); „Alle Modelle …“ öffnet den Picker. Jede Stufe wird bei
  jedem Start aus Benchmark und Preis bestimmt (klügstes Modell im Preisrahmen 0,60 / 4 / 40 $ pro 1M, mit Werkzeugen,
  höchstens ein Jahr alt, jede Stufe günstiger als die darüber); in den Einstellungen lässt sich jede Stufe auf ein
  Modell aus Favoriten oder zuletzt genutzten festlegen.
- „Beste Antwort“ (`lib/fusion.ts`, nach OpenRouters Fusion): fünfter Eintrag im Stufen-Menü. Die drei klügsten Modelle
  bis zum Standard-Preisrahmen, je eins pro Hersteller, beantworten die Frage parallel; das klügste führt die Antworten
  zusammen. Es sieht sie nur als A, B, C, damit es die eigene nicht bevorzugt. Unter der Antwort lassen sich die
  Einzelantworten mit Kosten aufklappen; die Kosten der Antwort enthalten alles. Websuche und Links öffnen die drei
  Modelle, das Zusammenführen nicht. „Neu erzeugen“ führt mit dem aktuellen Team neu zusammen.
- Profile (`lib/profiles.ts`, `components/ProfileMenu.tsx`, `components/ProfileDialog.tsx`, nach OpenRouters Presets):
  Name, Anweisung, Stufe (auch „Beste Antwort“), Websuche, Visualisieren, Nachdenken. Im Eingabefeld per Klick für den
  neuen oder laufenden Chat; eines kann jeden neuen Chat starten. Vier Vorlagen (Einfach erklärt, Kurz und knapp,
  Recherche, Wichtige Frage). Der Chat behält die Anweisung (`Chat.profile`); Profile reisen mit der Sicherung.
- Helfer-Modelle (`lib/helpers.ts`) werden wie die Stufen bei jedem Start aus Katalog und Benchmark gewählt, damit neue
  Modelle von selbst nachrücken: Bewerter und Ergebnisprotokoll (klügstes Modell bis 8 $ pro 1M, anderer Hersteller als
  die Teilnehmer), Zielprüfung, Titel, Zusammenfassungen und Lückenprüfung (klügstes bis 1,50 $ mit genug Kontext),
  Raum-Stufen (je vier Hersteller bis 0,60 / 2 / 8 $), Vorlese-Stimme (neuestes Gemini-TTS), Diktieren (neuestes
  Whisper), Videomodell im Dialog (Mitte der aktuellen Preisspanne). Feste Listen gelten nur ohne Benchmark-Daten.
- Standard für neue Chats: die Stufe „Kostenlos“ (bestes kostenloses Modell nach Artificial-Analysis-Index).
- Modellwechsel mitten im Chat: Das neue Modell erfährt, welche Antworten von wem stammen.
- Vergleich: bis zu vier Modelle beantworten dieselbe Frage nebeneinander (`lib/conversation.ts`).

**Chats**
- Automatische Titel, Ordner mit Drag & Drop, Abzweigen an einer Antwort, Export als Markdown.
- Entwurf pro Chat: Ungesendeter Text und Anhänge bleiben beim Chatwechsel und Neuladen erhalten, beim neuen Chat
  auch Modell und Schalter. Der neue Chat entsteht erst beim ersten Absenden.
- Kontextanzeige; „Zusammenfassen und neu starten“ mit Lückenprüfung (`lib/context.ts`),
  „Bis hier zusammenfassen“ an jeder Antwort; Knopf „Zusammenfassen“ oben im Chat, Ergebnis wahlweise kopieren.
- Werkbank „Aufgabe vorbereiten“ (`lib/workbench.ts`): Idee → Rückfragen → ausformulierte Aufgabe,
  Rolle und Vorgehen (als Anweisung nur für diesen Chat), Modellempfehlung.
- Sicherung: alles als eine Datei herunterladen und wieder einlesen (`lib/backup.ts`, ohne API-Key).

**Texte**
- Fertige Texte (Brief, E-Mail, Beitrag) kommen als Textkarte (```` ```text ````) mit „Kopieren“ und „Als .txt
  speichern“; jeder Code-Block lässt sich als Datei herunterladen.
- Stelle ändern: Text in einer Antwort markieren, sagen, was anders werden soll. Das Modell bekommt nur diese Antwort
  und liefert nur die neue Stelle (`lib/textwork.ts`); „Änderung zurück“ stellt die vorige Fassung wieder her.

**Kosten und Datenschutz**
- Claude-Chats nutzen Prompt-Caching (`cache_control`): Der bisherige Verlauf kostet beim erneuten Lesen ein Zehntel.
- „Nachdenken: kurz / normal / gründlich“ pro Chat für Modelle, die nachdenken (`reasoning.effort`).
- Datenschutz-Modus in den Einstellungen: nur Server ohne Datenspeicherung (`provider.zdr`).
- Jede Anfrage nennt dem Modell das heutige Datum.

**Ein- und Ausgabe**
- Diktieren per Mikrofon (Whisper über OpenRouter, `lib/transcribe.ts`).
- Vorlesen mit Browser-Stimme oder KI-Stimme (Gemini TTS), Leiste mit Pause/Weiter/Stopp (`lib/speech.ts`).
- Websuche (`openrouter:web_search`, 5/10/20 Quellen).
- Links in der Nachricht: Das Modell darf sie öffnen (`openrouter:web_fetch`, höchstens 5 Seiten, je bis 15.000
  Tokens, `lib/links.ts`). Unter der Antwort steht „Gelesen: …“, wenn OpenRouter einen Abruf meldet. Modelle ohne
  Werkzeuge können keine Links öffnen; darauf weist das Eingabefeld schon vor dem Senden hin.
- Anhänge: Bilder und Screenshots, PDFs, Word, Excel, PowerPoint, CSV, Text. Dokumente werden einmal in
  Markdown umgewandelt (`lib/convert.ts` im Browser, PDFs über OpenRouters kostenlosen Parser, Scans
  optional per OCR) und als Text geschickt; je Anhang wählbar: Text, Zusammenfassung, Original-PDF
  (`lib/documents.ts`, `components/DocumentDialog.tsx`).
- „Visualisieren“ (Schalter pro Chat): Das Modell bekommt eine kurze Anleitung (`lib/visual.ts`) und schickt Diagramme
  als ```` ```chart ````-JSON (Säulen, Linien, Ring) und Skizzen als ```` ```svg ````. Leuchtfeuer zeichnet Diagramme selbst
  (`components/Chart.tsx`, Farben `--series-1…4` mit dem Dataviz-Validator geprüft, Tooltip, Tabellenansicht) und
  zeigt SVG nur als Bild, damit darin nichts ausgeführt wird. Abläufe schreibt das Modell in Mermaid-Flowchart-Notation;
  Leuchtfeuer liest sie selbst (`lib/flow.ts`, ohne die 4 MB große Mermaid-Bibliothek), misst jeden Text und legt das
  Diagramm mit dagre aus (`components/Flowchart.tsx`), damit kein Text über seinen Kasten ragt. Diagramme und Abläufe
  lassen sich als SVG herunterladen (`lib/svgExport.ts`).
- „Erzeugen“ in der Eingabeleiste (`lib/media.ts`, `components/CreateMenu.tsx`): Bild, Video oder Musik direkt im
  laufenden Chat, das Chat-Modell bleibt. Stufen statt Modelle: Bild und Video Schnell/Standard/Beste (günstigstes,
  mittleres und teuerstes aktuelles Modell), Musik Kurzer Clip/Ganzer Song (Lyria, Preis pro Stück). Bild und Musik
  bekommen den Chatverlauf als Kontext; Video nutzt die Optionen in der Leiste. ✕ führt zurück zum Text.
- Bilder erzeugen und bearbeiten (z. B. Nano Banana), mit Prompt-Verbesserer (`lib/enhance.ts`).
- Videos erzeugen (`components/VideoDialog.tsx`): Kosten vorab, günstiger Entwurf, Fotos als Start-,
  End- oder Referenzbild. Ein Videomodell als Chat-Modell macht das Eingabefeld zur Videobeschreibung: Dauer,
  Auflösung, Format und Ton (nur was das Modell laut `/videos/models` kann) stehen in der Leiste samt Preis; Enter
  erstellt das Video direkt, über 1 $ oder bei unbekanntem Preis nach einer Rückfrage. Fotos öffnen den Dialog.
- Hilfe-Hinweise beim Überfahren aller Symbole (`components/Tooltips.tsx`).

**Aussehen** („Nachtsignal“)
- Dunkel als Standard, dazu Hell und „Wie das Gerät“; Schriftgröße Normal, Groß, Sehr groß (Einstellungen, gilt
  sofort). `index.html` setzt beides vor dem ersten Bild, damit nichts weiß aufblitzt. Alle Textfarben ≥ 4,5:1.
- Begrüßung und leerer Chat: leuchtende Signallinien in reinem WebGL (`components/SignalField.tsx`), reagieren auf
  Tippen und pulsieren, solange das Modell an der ersten Antwort denkt. Ein Standbild bei „Bewegung reduzieren“,
  pausiert im Hintergrund-Tab.
- Schriften: Bricolage Grotesque (Überschriften), Geist (Text), Geist Mono (Zahlen, IDs).

**Chatrooms** (`lib/rooms.ts`, `components/room/`)
- Mehrere Modelle mit Rollen diskutieren; Moderator, Interviewer und Mediator leiten als Autorität.
- Runden einzeln oder mehrere am Stück, Play/Pause/Stopp, Tempo, Budget, Zielprüfung, Protokoll.
- Zielprüfung nach jeder Runde mit einem günstigen Modell (Gemini Flash o. ä.). Ein erreichtes Ziel wird nur vermerkt:
  Karte „Ziel erreicht“ im Verlauf mit „Beenden und bewerten“ / „Nur anhalten“, das Gespräch läuft weiter, bis der Nutzer
  es beendet oder die Runden vorbei sind; danach keine weitere Prüfung.
- Halt als Karte im Gesprächsverlauf (Runden gespielt, Budget, Fehler) mit den passenden Wegen weiter:
  „Bewertung und Fazit“, „2 Runden mehr“, „Budget erhöhen“.
- Bewerter: standardmäßig ein starkes Modell eines Herstellers, den kein Teilnehmer nutzt (Claude Sonnet 5.5, sonst
  GPT-6.1 Sol, Gemini 4 Argon, Grok 4.7), für Bewertung, Rückfragen und Ergebnisprotokoll; von Hand wählbar. Das
  Ergebnisprotokoll endet mit einer „Empfehlung“: nächste Schritte zum Ziel und ein Rat für die echte Situation.
- Hörspiel (`lib/audiobook.ts`, `components/room/AudioPlayDialog.tsx`): „Export → Als Hörspiel (MP3)“. Ein Sprecher
  (eine von den Figuren unbenutzte Stimme) stellt Titel, Figuren und Ausgangslage vor, jeder Beitrag kommt in der Stimme
  seiner Figur, zum Schluss liest der Sprecher „Bewertung und Fazit“ (fehlt sie oder ist sie veraltet, wird sie vorher
  erstellt). Gemini-TTS-PCM wird je drei Teile parallel geholt und im Browser mit lamejs (`@breezystack/lamejs`) zu
  MP3 64 kbit/s kodiert, ca. 0,5 MB und 1 Cent pro Minute.
  „Mit Musik“ (Standard an): Eine günstige KI beschreibt passende Instrumentalmusik, Lyria komponiert einen Clip für
  Intro, kurze Übergänge zwischen Runden (höchstens alle 45 s) und Outro rund um die Auswertung. Sobald eine Stimme
  spricht, wird die Musik automatisch um rund 20 dB abgesenkt (aus der Sprachspur erkannt, mit 0,3 s Vorlauf und
  weichem Wiederanstieg), damit jedes Wort klar bleibt. Geräusche gibt es bewusst nicht.
- Szenario-Assistent: Situation in eigenen Worten beschreiben („Ich will meinen Chef um mehr Gehalt bitten“), eine KI
  entwirft Rollen mit Persönlichkeit, Thema, Ziel und Runden (`scenarioMessages`/`parseScenario` in `lib/rooms.ts`);
  wer üben will, bekommt eine eigene Rolle. Danach alles änderbar.
- Eigene Rollen per Vorlage oder KI-Ausfüllen, Nutzer kann selbst mitspielen.
- „Mit KI ausformulieren“ in Schritt 3: arbeitet die Idee zur Ausgangslage aus, gibt jeder Figur eine Rolle aus der
  Situation (z. B. „Schwester“) und beschreibt, wie sie zueinander stehen („Wer ist wer“, `Room.cast`); alle Teilnehmer
  bekommen das im Systemprompt. Rückgängig mit „Meine Fassung wiederherstellen“.
- Denkende Modelle bekommen im Raum 2.500 Tokens zusätzlich zur Beitragslänge; ein leerer Beitrag wird einmal
  wiederholt.
- Vorlesen im Raum: „Vorlesen“ unter jedem Beitrag wie im Chat, dazu Schalter „Automatisch vorlesen“; jede Figur bekommt eine passende Gemini-Stimme (ein günstiges Modell besetzt
  nach Geschlecht und Charakter, sonst eine Regel; änderbar im Teilnehmer-Dialog). Beiträge werden nacheinander
  gesprochen, der nächste wartet; einzelne Beiträge lassen sich per Lautsprecher-Symbol vorlesen. Die Betonung passt
  Gemini TTS selbst dem Inhalt an.
- Unabhängiger Bewerter (`components/room/ReviewDialog.tsx`, `judgeOf` in `lib/rooms.ts`): automatisch ein starkes Modell
  eines anderen Herstellers als die Teilnehmer, änderbar. „Bewerten“ (und am Ende der Runden) liefert Ergebnis, Verlauf (wer überzeugte, wo es kippte), Fazit und „Was du daraus lernen kannst“ samt
  Empfehlung weiter/fertig („2 Runden weiter“). Danach Rückfragen an den Bewerter; alles bleibt im Raum gespeichert.

## Speicherorte

- `localStorage`: `router.settings.v1`, `router.chats.v1`, `router.rooms.v1`, `router.folders.v1`,
  `router.roles.v1`, `router.drafts.v1`, Caches für Modelle und Benchmarks.
- IndexedDB `router-files`: Anhänge, umgewandelte Texte, erzeugte Bilder, Videos und Audio.

## Desktop-Version

`npm run pack:desktop` baut mit einem eigenen Vite-Plugin (`vite.config.ts`, Modus `desktop`) eine einzige
`Leuchtfeuer.html`, in der Skript, Stile, Schriften und Symbol stecken, und packt sie mit
`desktop/So startest du Leuchtfeuer.txt` in `Leuchtfeuer-Desktop.zip`. In Chrome und Edge bleiben Chats über
Neustarts erhalten; ein Update ist das Ersetzen der HTML-Datei.
