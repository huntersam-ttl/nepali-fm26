import type { Location, Venue } from "@nepal-football-sim/shared-types";
import { DEFAULT_MATCH_ENVIRONMENT, type MatchEnvironment } from "./match-engine.js";

export type VenueEnvironmentSignals = {
  venueId: string;
  locationId?: string;
  altitudeMeters?: number;
  surfaceType?: Venue["surfaceType"];
  pitchQuality?: Venue["pitchQuality"];
  climateZone?: string;
  seasonalHeatRisk?: string;
  monsoonRisk?: string;
  coldRisk?: string;
  humidityRisk?: string;
};

export type VenueEnvironmentContext = {
  environment: MatchEnvironment;
  signals: VenueEnvironmentSignals;
};

export const buildMatchEnvironmentFromVenue = (
  venue: Venue,
  location?: Location,
): VenueEnvironmentContext => ({
  environment: { ...DEFAULT_MATCH_ENVIRONMENT },
  signals: {
    venueId: venue.id,
    locationId: venue.locationId ?? location?.id,
    altitudeMeters: venue.altitudeMeters ?? location?.altitudeMeters,
    surfaceType: venue.surfaceType,
    pitchQuality: venue.pitchQuality,
    climateZone: location?.climateProfile?.climateZone,
    seasonalHeatRisk: location?.climateProfile?.seasonalHeatRisk,
    monsoonRisk: location?.climateProfile?.monsoonRisk,
    coldRisk: location?.climateProfile?.coldRisk,
    humidityRisk: location?.climateProfile?.humidityRisk,
  },
});
