import { config, googleConfigured } from '../config.js';

/**
 * Fetches Google Business reviews via the Places API (Place Details) and
 * normalises them to the same shape the website uses for its own reviews.
 *
 * NOTE: Google reviews are text + rating + author photo only — Google has no
 * concept of video reviews, so `video` is never present here. Video testimonials
 * come from the site's own /review flow. The two are merged on the Reviews page.
 *
 * Until GOOGLE_API_KEY + GOOGLE_PLACE_ID are set, this returns []
 * so the feature is a safe no-op.
 *
 * Upgrade path: swap this one function to call the Google Business Profile API
 * (all reviews, OAuth) — the rest of the app/UI stays the same.
 */

let cache = { at: 0, data: [] };

function normalize(r) {
  return {
    source: 'google',
    name: r.author_name || 'Google user',
    role: 'Verified Google review',
    rating: Math.round(r.rating) || 5,
    text: (r.text || '').slice(0, 2000),
    photo: r.profile_photo_url || undefined,
    url: r.author_url || undefined,
    when: r.relative_time_description || undefined,
    createdAt: r.time ? r.time * 1000 : Date.now(),
  };
}

export async function getGoogleReviews() {
  if (!googleConfigured()) return [];

  const fresh = Date.now() - cache.at < config.google.cacheTtlMs;
  if (fresh && cache.data.length) return cache.data;

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', config.google.placeId);
  url.searchParams.set('fields', 'reviews,rating,user_ratings_total');
  url.searchParams.set('reviews_sort', 'newest');
  url.searchParams.set('key', config.google.apiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const body = await res.json();
    if (body.status !== 'OK') {
      console.warn('[google] Places API status:', body.status, body.error_message || '');
      // Serve stale cache if we have it, rather than nothing.
      return cache.data;
    }
    const reviews = (body.result?.reviews || []).map(normalize);
    cache = { at: Date.now(), data: reviews };
    return reviews;
  } catch (err) {
    console.warn('[google] fetch failed:', err.message);
    return cache.data;
  }
}
