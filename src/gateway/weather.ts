// Open-Meteo: free, no key required. https://open-meteo.com
// Returns "is it raining in the next hour" + temp at the requested location.

export type WeatherSnapshot = {
  source: "open-meteo" | "fallback";
  fetched_at: string;
  temp_c: number;
  precipitation_mm_next_hour: number;
  is_raining_soon: boolean;
};

const FALLBACK: WeatherSnapshot = {
  source: "fallback",
  fetched_at: new Date(0).toISOString(),
  temp_c: 22,
  precipitation_mm_next_hour: 0,
  is_raining_soon: false,
};

export async function getWeather(
  lat = 37.5665, // Seoul default — change in SOUL.md once geofencing lands
  lon = 126.978,
): Promise<WeatherSnapshot> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation&hourly=precipitation&forecast_hours=2`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return FALLBACK;
    const json = (await res.json()) as {
      current: { temperature_2m: number; precipitation: number };
      hourly: { precipitation: number[] };
    };
    const nextHourPrecip = json.hourly.precipitation?.[1] ?? 0;
    return {
      source: "open-meteo",
      fetched_at: new Date().toISOString(),
      temp_c: json.current.temperature_2m,
      precipitation_mm_next_hour: nextHourPrecip,
      is_raining_soon: nextHourPrecip > 0.2,
    };
  } catch (e) {
    console.warn("[weather] failed, using fallback:", (e as Error).message);
    return FALLBACK;
  }
}
