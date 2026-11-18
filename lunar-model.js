/* Astronomy Engine based lunar model for Novosibirsk.
 * All internal vectors use Astronomy Engine's J2000 equatorial frame (EQJ).
 * The final observer-facing vectors are transformed into the local horizontal
 * frame: x=north, y=west, z=zenith.
 */
(() => {
  "use strict";

  const LOCATION = { latitude: 55.0084, longitude: 82.9357, elevation: 0 };
  const observer = new Astronomy.Observer(
    LOCATION.latitude,
    LOCATION.longitude,
    LOCATION.elevation
  );
  const Body = Astronomy.Body;

  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  });
  const scale = (v, k) => ({ x: v.x * k, y: v.y * k, z: v.z * k });
  const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const unit = (v) => {
    const length = Math.hypot(v.x, v.y, v.z);
    if (!Number.isFinite(length) || length === 0) {
      throw new Error("Invalid lunar direction vector");
    }
    return scale(v, 1 / length);
  };
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function phaseName(phaseCycle) {
    if (phaseCycle < 0.035 || phaseCycle >= 0.965) return "Новолуние";
    if (phaseCycle < 0.215) return "Растущий серп";
    if (phaseCycle < 0.285) return "Первая четверть";
    if (phaseCycle < 0.465) return "Растущая Луна";
    if (phaseCycle < 0.535) return "Полнолуние";
    if (phaseCycle < 0.715) return "Убывающая Луна";
    if (phaseCycle < 0.785) return "Последняя четверть";
    return "Убывающий серп";
  }

  function horizontalPositionAt(date) {
    const moon = Astronomy.GeoVector(Body.Moon, date, true);
    const earthObserver = Astronomy.ObserverVector(date, observer, false);
    const topocentric = new Astronomy.Vector(
      moon.x - earthObserver.x,
      moon.y - earthObserver.y,
      moon.z - earthObserver.z,
      moon.t
    );
    const rotation = Astronomy.Rotation_EQJ_HOR(date, observer);
    const horizontalVector = Astronomy.RotateVector(rotation, topocentric);
    const horizontal = Astronomy.HorizonFromVector(horizontalVector, "normal");
    return { azimuth: horizontal.lon, altitude: horizontal.lat };
  }

  function eventsAfter(date = new Date()) {
    const moonrise = Astronomy.SearchRiseSet(Body.Moon, observer, +1, date, 2, 0);
    const moonset = Astronomy.SearchRiseSet(Body.Moon, observer, -1, date, 2, 0);
    const culmination = Astronomy.SearchHourAngle(Body.Moon, observer, 0, date, +1);
    return {
      moonrise: moonrise ? moonrise.date : null,
      moonset: moonset ? moonset.date : null,
      culmination: culmination ? culmination.time.date : null
    };
  }

  function stateAt(date = new Date()) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError("A valid JavaScript Date is required");
    }

    // Geocentric phase and illuminated fraction.
    const phaseDegrees = ((Astronomy.MoonPhase(date) % 360) + 360) % 360;
    const phaseCycle = phaseDegrees / 360;
    const illuminationInfo = Astronomy.Illumination(Body.Moon, date);
    const illumination = clamp(illuminationInfo.phase_fraction, 0, 1);
    const phaseAngle = clamp(illuminationInfo.phase_angle, 0, 180);

    // Topocentric Moon direction: geocentric Moon vector minus observer vector.
    const moonGeo = Astronomy.GeoVector(Body.Moon, date, true);
    const sunGeo = Astronomy.GeoVector(Body.Sun, date, true);
    const observerGeo = Astronomy.ObserverVector(date, observer, false);
    const moonTopocentric = new Astronomy.Vector(
      moonGeo.x - observerGeo.x,
      moonGeo.y - observerGeo.y,
      moonGeo.z - observerGeo.z,
      moonGeo.t
    );

    // Transform the observer-to-Moon vector into local horizontal coordinates.
    const eqjToHorizontal = Astronomy.Rotation_EQJ_HOR(date, observer);
    const moonHorizontalVector = Astronomy.RotateVector(
      eqjToHorizontal,
      moonTopocentric
    );
    const horizontal = Astronomy.HorizonFromVector(moonHorizontalVector, "normal");
    const earlier = horizontalPositionAt(new Date(date.getTime() - 5 * 60 * 1000));
    const later = horizontalPositionAt(new Date(date.getTime() + 5 * 60 * 1000));
    const azimuthDelta = ((later.azimuth - earlier.azimuth + 540) % 360) - 180;
    const azimuthRate = azimuthDelta / 10;
    const altitudeRate = (later.altitude - earlier.altitude) / 10;

    // Direction from the Moon toward the Sun, projected onto the apparent
    // lunar-disc plane as seen by this observer.
    const moonToSun = new Astronomy.Vector(
      sunGeo.x - moonGeo.x,
      sunGeo.y - moonGeo.y,
      sunGeo.z - moonGeo.z,
      moonGeo.t
    );
    const sunHorizontalVector = Astronomy.RotateVector(eqjToHorizontal, moonToSun);
    const lineOfSight = unit(moonHorizontalVector);
    const sunDirection = unit(sunHorizontalVector);
    const brightProjection = subtract(
      sunDirection,
      scale(lineOfSight, dot(sunDirection, lineOfSight))
    );
    const brightLength = Math.hypot(
      brightProjection.x, brightProjection.y, brightProjection.z
    );

    // Local vertical projected onto the disc is its screen-up direction.
    const zenith = { x: 0, y: 0, z: 1 };
    const upProjection = subtract(
      zenith,
      scale(lineOfSight, dot(zenith, lineOfSight))
    );
    const upLength = Math.hypot(upProjection.x, upProjection.y, upProjection.z);
    const screenUp = upLength > 1e-10
      ? scale(upProjection, 1 / upLength)
      : { x: 1, y: 0, z: 0 };
    // With HOR axes (north, west, zenith), this points to the observer's right.
    const screenRight = unit(cross(lineOfSight, screenUp));
    // At exact new/full moon the bright-limb direction is undefined; the
    // terminator is respectively a full disc or absent, so zero is safe.
    const brightLimbAngle = brightLength > 1e-12
      ? Math.atan2(
          dot(brightProjection, screenRight),
          dot(brightProjection, screenUp)
        )
      : 0;

    return {
      phaseDegrees,
      phaseCycle,
      illumination,
      phaseAngle,
      waxing: phaseDegrees < 180,
      name: phaseName(phaseCycle),
      azimuth: horizontal.lon,
      altitude: horizontal.lat,
      brightLimbAngle,
      distanceAu: moonTopocentric.Length(),
      motion: {
        azimuthRateDegPerMinute: azimuthRate,
        altitudeRateDegPerMinute: altitudeRate,
        horizontalDirection: azimuthRate >= 0 ? "westward" : "eastward",
        verticalDirection: altitudeRate > 0.005
          ? "rising"
          : altitudeRate < -0.005 ? "setting" : "near-culmination"
      }
    };
  }

  window.NovosibirskLunar = Object.freeze({
    location: Object.freeze({ ...LOCATION }),
    stateAt,
    eventsAfter
  });
})();
