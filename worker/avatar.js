// Profile pictures are small square images, shrunk in the browser and stored
// as data URLs. Pure checks only, so they can be unit tested.

export const AVATAR_SIZE = 160;
// A 160 px JPEG is about 10 kB. This leaves room without letting the
// database be used as file storage.
export const MAX_AVATAR_LENGTH = 60_000;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

// Returns an error message, or null when the image is acceptable.
export function avatarProblem(image) {
  if (typeof image !== "string") return "The picture is missing.";
  if (image.length > MAX_AVATAR_LENGTH) return "The picture is too large.";
  if (!DATA_URL.test(image)) return "The picture must be a JPEG, PNG or WebP image.";
  return null;
}

// Identifies the current set of pictures, so clients know when to reload them.
export function avatarsVersion(rows) {
  const latest = rows.reduce((max, row) => (row.updatedAt > max ? row.updatedAt : max), "");
  return `${rows.length}:${latest}`;
}
