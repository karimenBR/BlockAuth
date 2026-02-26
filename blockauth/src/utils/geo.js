'use strict';

const geoip = require('geoip-lite');

/**
 * Look up geo data for an IP address.
 * Returns { country, city, region, ll: [lat, lon] } or null.
 */
function lookupIP(ip) {
  // Skip private / loopback addresses
  if (isPrivateIP(ip)) return null;
  const geo = geoip.lookup(ip);
  if (!geo) return null;
  return {
    country : geo.country,
    city    : geo.city    || 'Unknown',
    region  : geo.region  || '',
    ll      : geo.ll,        // [latitude, longitude]
    timezone: geo.timezone || null,
  };
}

/**
 * Haversine great-circle distance between two [lat, lon] pairs.
 * Returns distance in kilometres.
 */
function distanceKm([lat1, lon1], [lat2, lon2]) {
  const R    = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Returns true if the travel speed between two events exceeds the
 * configured maximum (default: 900 km/h — commercial aircraft).
 */
function isImpossibleTravel(eventA, eventB) {
  if (!eventA?.geo?.ll || !eventB?.geo?.ll) return false;

  const km      = distanceKm(eventA.geo.ll, eventB.geo.ll);
  const hours   = Math.abs(eventB.timestamp - eventA.timestamp) / 3_600_000;
  if (hours === 0) return km > 0;                   // same time, different place
  const speedKph = km / hours;
  const maxSpeed = Number(process.env.MAX_TRAVEL_SPEED_KPH) || 900;
  return speedKph > maxSpeed;
}

function toRad(deg) { return (deg * Math.PI) / 180; }

function isPrivateIP(ip) {
  return (
    /^127\./.test(ip)        ||
    /^10\./.test(ip)         ||
    /^192\.168\./.test(ip)   ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip === '::1'             ||
    ip === 'localhost'
  );
}

module.exports = { lookupIP, distanceKm, isImpossibleTravel };
