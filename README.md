# Leuchtfeuer

**Alle KI-Modelle in einem Fenster, ohne dass du dich mit KI-Modellen auskennen musst.**

Leuchtfeuer ist eine Chat-Oberfläche für [OpenRouter](https://openrouter.ai), den Dienst, über den man mit einem
Konto Hunderte KI-Modelle nutzen kann: von Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral und vielen mehr. Statt
aus einer langen Liste zu wählen, sagst du, wie gut die Antwort sein soll. Leuchtfeuer sucht das passende Modell aus
und hält die Kosten im Blick.

*English: a browser-only chat app for OpenRouter, built for people who don't know (or care) which AI model to pick.
No server, no account of its own: your key and your chats stay in your browser. The interface is in German.*

## Was Leuchtfeuer kann

- **Stufen statt Modelle:** Kostenlos, Leicht, Standard, Stark. Hinter jeder Stufe steckt das klügste Modell in
  ihrem Preisrahmen, laut unabhängigen Benchmarks. Kommen neue Modelle heraus, rücken sie von selbst nach.
- **Beste Antwort:** Drei starke Modelle verschiedener Hersteller beantworten deine Frage. Das klügste macht daraus
  eine Antwort, in der Fehler und Widersprüche geklärt sind. Für wichtige Fragen.
- **Profile:** Eine Arbeitsweise einmal festlegen, etwa „Einfach erklärt“ oder „Recherche mit Quellen“, und sie mit
  einem Klick nutzen.
- **Chatrooms:** Mehrere Modelle diskutieren in Rollen miteinander, zum Beispiel um ein schwieriges Gespräch zu
  üben, Ideen zu sammeln oder einen Text prüfen zu lassen. Du kannst selbst mitspielen. Ein unabhängiger Bewerter
  fasst am Ende zusammen, was herausgekommen ist und was du daraus lernen kannst. Auf Wunsch als Hörspiel mit
  Stimmen und Musik.
- **Sprechen und Zuhören:** Fragen diktieren statt tippen, Antworten vorlesen lassen.
- **Dokumente und Bilder:** PDFs, Word, Excel, PowerPoint und Fotos anhängen. Dokumente werden einmal in Text
  umgewandelt, das spart Kosten.
- **Websuche und Links:** Modelle dürfen im Internet suchen und Links öffnen, die du schickst.
- **Erzeugen:** Bilder, Videos und Musik direkt im Chat.
- **Diagramme:** Antworten mit Grafiken und Abläufen veranschaulichen.
- **Für alle lesbar:** große Schrift auf Wunsch, Hell- und Dunkelmodus, geführte Einführung beim ersten Start.

## Deine Daten bleiben bei dir

Leuchtfeuer hat keinen eigenen Server.

- **Chats, Dateien und dein Zugang** liegen nur in deinem Browser auf deinem Gerät.
- **Anfragen** gehen direkt von deinem Browser an OpenRouter, nirgendwo sonst hin.
- **Kosten** laufen über dein eigenes OpenRouter-Konto. Jede Antwort zeigt, was sie gekostet hat. Bei OpenRouter
  kannst du ein Ausgabelimit festlegen.
- **Datenschutz-Modus:** Auf Wunsch nutzt Leuchtfeuer nur Anbieter, die nichts speichern und nichts zum Training
  verwenden.
- **Sicherung:** Alles lässt sich in eine Datei sichern und auf einem anderen Gerät wieder einlesen. Dein Zugang
  wird dabei nicht mitgesichert.

Mehrere Personen können dieselbe Leuchtfeuer-Adresse nutzen, ohne sich zu stören: Jede sieht nur die Chats auf
ihrem eigenen Gerät. Wer sich ein Gerät und einen Browser teilt, teilt sich auch die Chats.

## Loslegen

Du brauchst ein [OpenRouter-Konto](https://openrouter.ai). Die Anmeldung geht in Leuchtfeuer mit einem Klick,
zum Beispiel mit deinem Google-Konto. Viele Modelle sind kostenlos, für die anderen lädst du bei OpenRouter
Guthaben auf.

**Selbst bauen und starten:**

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # fertige Seite in dist/
```

## Selbst online stellen

`npm run build` erzeugt eine statische Seite in `dist/`, die jeder Hoster für statische Seiten ausliefern kann,
zum Beispiel Cloudflare Pages oder Netlify. Ein Server mit eigener Logik ist nicht nötig. Zwei Empfehlungen:

- **Eine eigene Adresse**, die nur Leuchtfeuer nutzt (etwa `leuchtfeuer.example.de` oder `name.pages.dev`), nicht
  einen Unterordner einer Adresse, unter der noch andere Seiten laufen. Der Browser trennt gespeicherte Daten nach
  Adresse, nicht nach Ordner.
- **Zwei-Faktor-Anmeldung** beim Hoster und bei GitHub: Wer den ausgelieferten Code ändern kann, könnte die
  Zugänge aller Nutzer abgreifen.

## Für Entwickler

Aufbau, alle Funktionen im Detail und Speicherorte: [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md).
Stack: Vite, React, TypeScript, ohne Backend.

## Hinweis

Leuchtfeuer ist ein unabhängiges Projekt und gehört nicht zu OpenRouter.
