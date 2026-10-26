import { useEffect, useState } from "react";
import { canRedirect, exchangeCode, prepareCodeLogin, startLogin } from "../lib/auth";
import { Icon } from "./Icon";

interface Props {
  onKey: (key: string) => void;
  /** Prominent button on the welcome screen, quieter one in the settings. */
  primary?: boolean;
  label?: string;
}

/** One button that connects the app to an OpenRouter account. */
export function OpenRouterLogin({ onKey, primary, label = "Mit OpenRouter anmelden" }: Props) {
  const [waitingForCode, setWaitingForCode] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirect = canRedirect();
  const [codeLink, setCodeLink] = useState<string | null>(null);

  useEffect(() => {
    if (!redirect) prepareCodeLogin().then(setCodeLink, (e: Error) => setError(e.message));
  }, [redirect]);

  async function begin() {
    setError(null);
    setBusy(true);
    try {
      await startLogin();
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }

  async function submitCode() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onKey(await exchangeCode(code));
      setWaitingForCode(false);
      setCode("");
    } catch (e) {
      setError(e instanceof TypeError ? "OpenRouter ist nicht erreichbar. Prüfe die Internetverbindung." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="or-login">
      {redirect ? (
        <button
          type="button"
          className={`button${primary ? " primary" : ""}`}
          onClick={() => void begin()}
          disabled={busy}
          aria-busy={busy}
          title="Zu openrouter.ai wechseln, anmelden oder ein Konto anlegen; danach kommst du automatisch zurück"
        >
          <Icon name="login" size={16} />
          {busy ? "Weiter zu OpenRouter …" : label}
        </button>
      ) : (
        <a
          className={`button${primary ? " primary" : ""}`}
          href={codeLink ?? undefined}
          target="_blank"
          rel="noopener"
          aria-disabled={!codeLink}
          title="Öffnet openrouter.ai in einem neuen Tab; dort anmelden und den Code hierher kopieren"
          onClick={() => {
            setError(null);
            setWaitingForCode(true);
          }}
        >
          <Icon name="login" size={16} />
          {label}
        </a>
      )}
      {waitingForCode && (
        <form
          className="or-code"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <label htmlFor="or-code">
            OpenRouter hat sich in einem neuen Tab geöffnet. Melde dich dort an und klicke auf „Authorize“. Danach
            zeigt OpenRouter einen Code: Kopiere ihn und füge ihn hier ein.
          </label>
          <div className="or-code-row">
            <input
              id="or-code"
              className="input"
              value={code}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Code einfügen"
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="submit" className="button primary" disabled={busy || !code.trim()} aria-busy={busy} title="Mit dem eingefügten Code bei OpenRouter anmelden">
              {busy ? "Prüft …" : "Verbinden"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="or-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
