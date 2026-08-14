/**
 * lib/mapbox.ts
 *
 * Mapbox initialisation. Imported once from the root layout so the
 * access token is set before any map component mounts.
 */

import Mapbox from "@rnmapbox/maps";

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

if (!token) {
  console.warn(
    "EXPO_PUBLIC_MAPBOX_TOKEN is not set. Maps will render blank. " +
      "Add it to mobile/.env and restart Metro.",
  );
} else {
  Mapbox.setAccessToken(token);
}

export default Mapbox;
