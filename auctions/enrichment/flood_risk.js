/**
 * flood_risk.js
 *
 * Fetches FEMA National Flood Hazard Layer (NFHL) flood zone designation
 * and NOAA climate normals for a property location. Both are public APIs,
 * no key required.
 *
 * Usage (standalone):
 *   node enrichment/flood_risk.js 41.4256 -82.3479
 *
 * API:
 *   import { fetchFloodRisk } from './enrichment/flood_risk.js';
 *   const data = await fetchFloodRisk({ lat, lng });
 */

import { withRetry } from './retry.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H  = { 'user-agent': UA, 'accept': 'application/json' };

// FEMA flood zone descriptions and risk levels
const ZONE_INFO = {
  'A':   { risk: 'High',     label: 'Special Flood Hazard Area (1% annual chance)', sfha: true  },
  'AE':  { risk: 'High',     label: 'Special Flood Hazard Area with BFE determined', sfha: true  },
  'AH':  { risk: 'High',     label: 'Flood depths 1–3 ft (ponding)', sfha: true  },
  'AO':  { risk: 'High',     label: 'River or stream flood with average depth', sfha: true  },
  'AR':  { risk: 'High',     label: 'Temporary increased risk (levee rebuilding)', sfha: true  },
  'A99': { risk: 'High',     label: 'Protected by federal flood control system', sfha: true  },
  'V':   { risk: 'Very High', label: 'Coastal high-hazard area (wave action)', sfha: true  },
  'VE':  { risk: 'Very High', label: 'Coastal high-hazard area with BFE', sfha: true  },
  'X':   { risk: 'Minimal',  label: 'Area of minimal flood hazard (above 500-yr)', sfha: false },
  'D':   { risk: 'Unknown',  label: 'Possible but undetermined flood hazard', sfha: false },
  'B':   { risk: 'Moderate', label: 'Moderate flood hazard (500-yr floodplain)', sfha: false },
  'C':   { risk: 'Moderate', label: 'Moderate flood hazard (500-yr floodplain)', sfha: false },
};

async function fetchFemaFloodZone(lat, lng) {
  const url = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?' +
    `geometry=${lng}%2C${lat}&geometryType=esriGeometryPoint&inSR=4326&` +
    'spatialRel=esriSpatialRelIntersects&' +
    'outFields=FLD_ZONE%2CZONE_SUBTY%2CSFHA_TF%2CSTATIC_BFE%2CDEPTH&' +
    'returnGeometry=false&f=json';

  const data = await withRetry(async () => {
    const res = await fetch(url, { headers: H });
    if (!res.ok) {
      const err = new Error(`FEMA NFHL API ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, { label: 'hazards.fema.gov' });

  const feature = data.features?.[0]?.attributes;
  if (!feature) return { zone: null, zone_subtype: null, in_sfha: null, risk_level: null, description: null };

  const zone    = feature.FLD_ZONE || null;
  const info    = ZONE_INFO[zone] || ZONE_INFO[zone?.charAt(0)] || { risk: 'Unknown', label: 'Zone not in standard lookup', sfha: null };
  const inSfha  = feature.SFHA_TF === 'T';
  const bfe     = feature.STATIC_BFE > 0 ? feature.STATIC_BFE : null;
  const depth   = feature.DEPTH > 0 ? feature.DEPTH : null;

  return {
    zone,
    zone_subtype:          feature.ZONE_SUBTY || null,
    in_special_flood_hazard_area: inSfha,
    risk_level:            info.risk,
    description:           info.label,
    base_flood_elevation:  bfe,
    expected_flood_depth:  depth,
  };
}

async function fetchNoaaClimateRisk(lat, lng) {
  // NOAA's Climate Data Online — get nearest station and precipitation normals
  const stationUrl = `https://www.ncdc.noaa.gov/cdo-web/api/v2/stations?extent=${lat-0.5},${lng-0.5},${lat+0.5},${lng+0.5}&datasetid=NORMAL_ANN&limit=1`;
  // NOAA CDO requires a token — fall back to county-level data from Census geocoding
  // Instead, use the OpenFEMA API for disaster declarations as a climate risk proxy
  const disasterUrl = `https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?` +
    `$filter=state%20ne%20null&$orderby=declarationDate%20desc&$top=3&` +
    `$filter=incidentBeginDate%20ge%20%272020-01-01%27`;

  // Use the NWS point API for the location — gives local forecast office and zone
  const nwsUrl = `https://api.weather.gov/points/${lat},${lng}`;
  try {
    const res  = await fetch(nwsUrl, { headers: { ...H, 'accept': 'application/geo+json' } });
    if (!res.ok) return null;
    const d    = await res.json();
    const prop = d.properties;
    return {
      nws_office:   prop?.cwa ?? null,
      forecast_zone:prop?.forecastZone?.split('/').pop() ?? null,
      county:       prop?.county?.split('/').pop() ?? null,
      radar_station:prop?.radarStation ?? null,
      time_zone:    prop?.timeZone ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchFloodRisk({ lat, lng }) {
  const [flood, climate] = await Promise.all([
    fetchFemaFloodZone(lat, lng),
    fetchNoaaClimateRisk(lat, lng),
  ]);

  return {
    source:       'FEMA NFHL + NWS',
    coordinates:  { lat, lng },
    flood_zone:   flood,
    climate_info: climate,
    insurance_note: flood.in_special_flood_hazard_area
      ? 'Flood insurance required by federally-backed mortgages (SFHA zone)'
      : flood.zone === 'X'
        ? 'Flood insurance not federally required but may be advisable'
        : 'Flood zone not determined — verify with local authority',
  };
}

if (process.argv[1]?.endsWith('flood_risk.js')) {
  const [,, lat, lng] = process.argv;
  console.log(`Fetching flood/climate risk for ${lat}, ${lng}…`);
  fetchFloodRisk({ lat: parseFloat(lat||'41.4256'), lng: parseFloat(lng||'-82.3479') })
    .then(d => console.log(JSON.stringify(d, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
