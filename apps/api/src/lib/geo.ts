// Haversine distance in SQL. For millions of vendors, swap to PostGIS geography + GiST index;
// the matching query shape stays the same.
export const distanceSql = (latA: string, lngA: string, latB: string, lngB: string) => `
  (6371 * 2 * asin(sqrt(
    power(sin(radians((${latB}) - (${latA})) / 2), 2) +
    cos(radians(${latA})) * cos(radians(${latB})) *
    power(sin(radians((${lngB}) - (${lngA})) / 2), 2)
  )))`;
