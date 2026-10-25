import { itemPrice, makesImages, makesMusic, makesAudio, type Model, type VideoModel } from "./openrouter";
import { blendedPrice } from "./recommend";
import { minPricePerSecond } from "../components/VideoDialog";

/**
 * "Erzeugen" in the input bar: an image, a video or music right in the current chat, at a level
 * instead of a model. Levels come from the catalog by price, so new models move in by themselves.
 */
export type MediaKind = "image" | "video" | "music";

export interface MediaLevel {
  label: string;
  hint: string;
  model: string;
  /** Short price note, if the catalog allows one. */
  price?: string;
}

export const MEDIA_INFO: Record<MediaKind, { label: string; hint: string; placeholder: string }> = {
  image: { label: "Bild", hint: "Foto, Grafik oder Illustration. Ein angehängtes Foto wird bearbeitet.", placeholder: "Beschreibe das Bild" },
  video: { label: "Video", hint: "Kurzer Clip, wahlweise mit Ton. Kostet je nach Länge einige Cent bis Dollar.", placeholder: "Beschreibe das Video" },
  music: { label: "Musik", hint: "Ein Song oder kurzer Clip, mit Gesang oder instrumental.", placeholder: "Beschreibe die Musik: Stil, Stimmung, Text" },
};

const YEAR = 365 * 86_400;
const recent = (created: number | undefined) => !created || Date.now() / 1000 - created < YEAR;

/** Low, middle and high of a price-sorted list (fewer when there are fewer). */
function spread<T>(sorted: T[]): T[] {
  if (sorted.length <= 3) return sorted;
  return [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted[sorted.length - 1]];
}

const LEVEL_NAMES = [
  { label: "Schnell", hint: "Günstig und flott, gut zum Ausprobieren" },
  { label: "Standard", hint: "Gute Qualität für die meisten Zwecke" },
  { label: "Beste", hint: "Höchste Qualität, kostet am meisten" },
];

function named<T>(picks: T[], toLevel: (t: T, name: (typeof LEVEL_NAMES)[number]) => MediaLevel): MediaLevel[] {
  const names = picks.length === 3 ? LEVEL_NAMES : picks.length === 2 ? [LEVEL_NAMES[0], LEVEL_NAMES[2]] : [LEVEL_NAMES[1]];
  return picks.map((p, i) => toLevel(p, names[i]));
}

export function imageLevels(models: Model[] | null): MediaLevel[] {
  const pool = (models ?? [])
    .filter((m) => makesImages(m) && recent(m.created) && !/-preview\b/.test(m.id) && Number.isFinite(blendedPrice(m)))
    .sort((a, b) => blendedPrice(a) - blendedPrice(b));
  return named(spread(pool), (m, n) => ({ ...n, model: m.id }));
}

export function musicLevels(models: Model[] | null): MediaLevel[] {
  const pool = (models ?? [])
    .filter((m) => makesAudio(m) && makesMusic(m) && itemPrice(m))
    .sort((a, b) => itemPrice(a)!.usd - itemPrice(b)!.usd);
  return pool.map((m) => {
    const item = itemPrice(m)!;
    const usd = `${item.usd.toFixed(2).replace(".", ",")} $`;
    return item.unit === "Clip"
      ? { label: "Kurzer Clip", hint: "Etwa 30 Sekunden, gut für Jingles und Ideen", model: m.id, price: `${usd} pro Clip` }
      : { label: "Ganzer Song", hint: "Ein vollständiges Lied mit Strophen und Refrain", model: m.id, price: `${usd} pro Song` };
  });
}

export function videoLevels(videos: VideoModel[] | null): MediaLevel[] {
  const pool = (videos ?? [])
    .filter(
      (v) => v.supported_durations?.length && !/edit|upscale|avatar/.test(v.id) && recent(v.created) && minPricePerSecond(v) !== null,
    )
    .sort((a, b) => minPricePerSecond(a)! - minPricePerSecond(b)!);
  return named(spread(pool), (v, n) => ({
    ...n,
    model: v.id,
    price: `ab ${Math.round(minPricePerSecond(v)! * 100)} Cent pro Sekunde`,
  }));
}

export function mediaLevels(kind: MediaKind, models: Model[] | null, videos: VideoModel[] | null) {
  return kind === "image" ? imageLevels(models) : kind === "video" ? videoLevels(videos) : musicLevels(models);
}
