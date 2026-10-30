import { type FormEvent, useState } from "react";

interface Props {
  disabled: boolean;
  analyzing: boolean;
  onSubmit: (url: string) => void;
}

export function UrlForm({ disabled, analyzing, onSubmit }: Props) {
  const [url, setUrl] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (trimmed !== "" && !disabled) onSubmit(trimmed);
  };

  return (
    <form className="url-form" onSubmit={handleSubmit}>
      <label htmlFor="video-url">動画URL</label>
      <div className="url-row">
        <input
          id="video-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          maxLength={2048}
          onChange={(event) => setUrl(event.target.value)}
          disabled={disabled}
          required
        />
        <button type="submit" disabled={disabled || url.trim() === ""}>
          {analyzing ? "解析中…" : "解析"}
        </button>
      </div>
    </form>
  );
}
