import {
  SCHEMA_LIMITS,
  TripLeg,
  TripOption,
  VerifiedPlace,
  VerifiedRoute,
} from '../types/transit';

export function generateRouteMeta(stops: VerifiedPlace[]): {
  name: string;
  direction: string;
} {
  if (stops.length < 2) {
    return {name: '', direction: ''};
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const name = `خط ${first.name} — ${last.name}`.slice(
    0,
    SCHEMA_LIMITS.ROUTE_NAME_MAX
  );
  const direction = `من ${first.name} إلى ${last.name}`.slice(
    0,
    SCHEMA_LIMITS.ROUTE_NAME_MAX
  );
  return {name, direction};
}

function buildLeg(
  route: VerifiedRoute,
  fromIdx: number,
  toIdx: number,
  placeById: Record<string, VerifiedPlace>
): TripLeg | null {
  if (fromIdx < 0 || toIdx <= fromIdx || toIdx >= route.stopIds.length) {
    return null;
  }
  const subStopIds = route.stopIds.slice(fromIdx, toIdx + 1);
  const subStops = subStopIds
    .map((id) => placeById[id])
    .filter((p): p is VerifiedPlace => Boolean(p));

  if (subStops.length < 2) {
    return null;
  }

  const totalSegments = Math.max(1, route.stopIds.length - 1);
  const ratio = (toIdx - fromIdx) / totalSegments;
  const estimatedMinutes = Math.max(
    3,
    Math.round(route.estimatedMinutes * Math.max(0.35, ratio))
  );

  return {
    route,
    fromPlace: subStops[0],
    toPlace: subStops[subStops.length - 1],
    subStops,
    fareEgp: route.fareEgp,
    estimatedMinutes,
  };
}

export const TRANSFER_WAIT_MINUTES = 6;

/**
 * Computes direct routes and 1-transfer options exclusively from verified active places and routes.
 */
export function findVerifiedTrips(
  originId: string,
  destinationId: string,
  places: VerifiedPlace[],
  routes: VerifiedRoute[],
  sortBy: 'fastest' | 'cheapest' = 'fastest'
): TripOption[] {
  if (!originId || !destinationId || originId === destinationId) {
    return [];
  }

  const activePlaces = places.filter((p) => p.isActive);
  const placeById: Record<string, VerifiedPlace> = {};
  for (const place of activePlaces) {
    placeById[place.id] = place;
  }

  if (!placeById[originId] || !placeById[destinationId]) {
    return [];
  }

  const activeRoutes = routes.filter((r) => r.isActive && r.stopIds.length >= 2);
  const options: TripOption[] = [];

  // 1. Direct routes
  for (const route of activeRoutes) {
    const oIdx = route.stopIds.indexOf(originId);
    const dIdx = route.stopIds.indexOf(destinationId);
    if (oIdx !== -1 && dIdx !== -1 && oIdx < dIdx) {
      const leg = buildLeg(route, oIdx, dIdx, placeById);
      if (leg) {
        options.push({
          id: `direct-${route.id}`,
          type: 'direct',
          legs: [leg],
          totalFarePerRiderEgp: leg.fareEgp,
          totalMinutes: leg.estimatedMinutes,
          transferWaitMinutes: 0,
          stopCount: leg.subStops.length,
        });
      }
    }
  }

  // 2. Single-transfer routes via shared verified stop
  const seenPairs = new Set<string>();
  for (const firstRoute of activeRoutes) {
    const oIdx = firstRoute.stopIds.indexOf(originId);
    if (oIdx === -1) continue;

    for (let t1Idx = oIdx + 1; t1Idx < firstRoute.stopIds.length; t1Idx++) {
      const transferId = firstRoute.stopIds[t1Idx];
      if (transferId === destinationId) continue;
      const transferPlace = placeById[transferId];
      if (!transferPlace) continue;

      for (const secondRoute of activeRoutes) {
        if (secondRoute.id === firstRoute.id) continue;
        const t2Idx = secondRoute.stopIds.indexOf(transferId);
        const dIdx = secondRoute.stopIds.indexOf(destinationId);
        if (t2Idx !== -1 && dIdx !== -1 && t2Idx < dIdx) {
          const pairKey = `${firstRoute.id}->${transferId}->${secondRoute.id}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);

          const leg1 = buildLeg(firstRoute, oIdx, t1Idx, placeById);
          const leg2 = buildLeg(secondRoute, t2Idx, dIdx, placeById);
          if (leg1 && leg2) {
            options.push({
              id: `transfer-${pairKey}`,
              type: 'transfer',
              legs: [leg1, leg2],
              transferPlace,
              totalFarePerRiderEgp: leg1.fareEgp + leg2.fareEgp,
              totalMinutes:
                leg1.estimatedMinutes +
                TRANSFER_WAIT_MINUTES +
                leg2.estimatedMinutes,
              transferWaitMinutes: TRANSFER_WAIT_MINUTES,
              stopCount: leg1.subStops.length + leg2.subStops.length - 1,
            });
          }
        }
      }
    }
  }

  return options.sort((a, b) => {
    if (sortBy === 'cheapest') {
      if (a.totalFarePerRiderEgp !== b.totalFarePerRiderEgp) {
        return a.totalFarePerRiderEgp - b.totalFarePerRiderEgp;
      }
      return a.totalMinutes - b.totalMinutes;
    }
    if (a.totalMinutes !== b.totalMinutes) {
      return a.totalMinutes - b.totalMinutes;
    }
    return a.totalFarePerRiderEgp - b.totalFarePerRiderEgp;
  });
}

export function calculateTripFareAndTime(trip: TripOption): {
  farePerRider: number;
  totalMinutes: number;
  legsCount: number;
} {
  return {
    farePerRider: Math.round(trip.totalFarePerRiderEgp * 100) / 100,
    totalMinutes: trip.totalMinutes,
    legsCount: trip.legs.length,
  };
}

