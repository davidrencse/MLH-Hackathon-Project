// What the city does with a weather reading: is it raining, and how hard.
//
//   node --test scripts/weather.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCurrent, conditionLabel, severityFromMm } from '../src/weather/nyc.ts'

const current = (over = {}) => ({
  temperature_2m: 54,
  apparent_temperature: 51,
  wind_speed_10m: 11,
  weather_code: 3,
  precipitation: 0,
  rain: 0,
  showers: 0,
  snowfall: 0,
  ...over,
})

test('a dry sky leaves the city dry', () => {
  const clear = classifyCurrent(current({ weather_code: 0 }))
  assert.equal(clear.raining, false)
  assert.equal(clear.severity, 0)
  assert.equal(clear.kind, 'none')
  assert.equal(clear.label, 'Clear skies')
  assert.equal(classifyCurrent(current()).raining, false) // overcast is not rain
})

test('the weather code sets the severity when nothing has been measured yet', () => {
  const cases = [
    [51, 1], // drizzle
    [61, 1], // slight rain
    [63, 2],
    [65, 3], // heavy rain
    [80, 1], // slight showers
    [82, 4], // violent showers
    [95, 4], // thunderstorm
    [99, 4],
  ]
  for (const [code, severity] of cases) {
    const weather = classifyCurrent(current({ weather_code: code }))
    assert.equal(weather.severity, severity, `code ${code}`)
    assert.equal(weather.raining, true, `code ${code}`)
    assert.equal(weather.kind, 'rain', `code ${code}`)
  }
})

test('measured rain counts even when the code has not caught up', () => {
  const drizzle = classifyCurrent(current({ weather_code: 3, rain: 0.2 }))
  assert.equal(drizzle.raining, true)
  assert.equal(drizzle.severity, 1)
  assert.equal(drizzle.rainMm, 0.2)

  const downpour = classifyCurrent(current({ weather_code: 3, showers: 4.1 }))
  assert.equal(downpour.severity, 3)
})

test('severity is the worse of the two signals, never the milder', () => {
  const heavy = classifyCurrent(current({ weather_code: 61, rain: 9 })) // code says 1, gauge says 4
  assert.equal(heavy.severity, 4)
  const storm = classifyCurrent(current({ weather_code: 95, rain: 0.1 })) // code says 4, gauge says 1
  assert.equal(storm.severity, 4)
})

test('snow is not rain: the city stays dry under it', () => {
  for (const code of [71, 73, 75, 77, 85, 86]) {
    const weather = classifyCurrent(current({ weather_code: code, snowfall: 2 }))
    assert.equal(weather.raining, false, `code ${code}`)
    assert.equal(weather.severity, 0, `code ${code}`)
    assert.equal(weather.kind, 'snow', `code ${code}`)
    assert.equal(weather.label, 'Snow', `code ${code}`)
  }
  // Sleet — snow code, liquid in the gauge — does rain.
  const sleet = classifyCurrent(current({ weather_code: 85, snowfall: 1, rain: 1.2 }))
  assert.equal(sleet.raining, true)
  assert.equal(sleet.severity, 2)
})

test('rain bands rise with the millimetres', () => {
  assert.equal(severityFromMm(0), 0)
  assert.equal(severityFromMm(-1), 0)
  assert.equal(severityFromMm(0.1), 1)
  assert.equal(severityFromMm(0.5), 2)
  assert.equal(severityFromMm(2.5), 3)
  assert.equal(severityFromMm(7.6), 4)
  assert.equal(severityFromMm(120), 4)
})

test('an unusable payload is rejected, so the city falls back instead of inventing weather', () => {
  assert.equal(classifyCurrent(null), null)
  assert.equal(classifyCurrent('rain'), null)
  assert.equal(classifyCurrent({}), null)
  assert.equal(classifyCurrent(current({ temperature_2m: null })), null)
  assert.equal(classifyCurrent(current({ weather_code: 'rainy' })), null)
  assert.equal(classifyCurrent(current({ wind_speed_10m: Number.NaN })), null)
})

test('a reading says it is live and when it was taken', () => {
  const weather = classifyCurrent(current({ weather_code: 63, rain: 1 }), 1_700_000_000_000)
  assert.equal(weather.live, true)
  assert.equal(weather.fetchedAt, 1_700_000_000_000)
  assert.equal(weather.temperature, 54)
  assert.equal(weather.wind, 11)
})

test('condition labels cover the sky', () => {
  assert.equal(conditionLabel(0), 'Clear skies')
  assert.equal(conditionLabel(2), 'Partly cloudy')
  assert.equal(conditionLabel(3), 'Overcast')
  assert.equal(conditionLabel(45), 'Foggy')
  assert.equal(conditionLabel(53), 'Drizzle')
  assert.equal(conditionLabel(63), 'Rain')
  assert.equal(conditionLabel(81), 'Showers')
  assert.equal(conditionLabel(96), 'Thunderstorms')
  assert.equal(conditionLabel(75), 'Snow')
})

