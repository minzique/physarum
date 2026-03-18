function fixed(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function vec3(color) {
  return color.map((value) => fixed(value, 2)).join(",");
}

function spectrumGLSL(palette) {
  return `
vec3 spectrum(float value) {
  vec3 c0 = vec3(${vec3(palette[0])});
  vec3 c1 = vec3(${vec3(palette[1])});
  vec3 c2 = vec3(${vec3(palette[2])});
  vec3 c3 = vec3(${vec3(palette[3])});
  vec3 c4 = vec3(${vec3(palette[4])});
  value = clamp(value, 0.0, 1.0);
  if (value < 0.25) return mix(c0, c1, value * 4.0);
  if (value < 0.50) return mix(c1, c2, (value - 0.25) * 4.0);
  if (value < 0.75) return mix(c2, c3, (value - 0.50) * 4.0);
  return mix(c3, c4, (value - 0.75) * 4.0);
}
`;
}

const HASH_GLSL = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21b(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.3183);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21c(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.2171);
  p3 += dot(p3, p3.yzx + 41.73);
  return fract((p3.x + p3.y) * p3.z);
}

float hash21d(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1271);
  p3 += dot(p3, p3.yzx + 28.11);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
void main() {
  vec2 vertices[3];
  vertices[0] = vec2(-1.0, -1.0);
  vertices[1] = vec2( 3.0, -1.0);
  vertices[2] = vec2(-1.0,  3.0);
  gl_Position = vec4(vertices[gl_VertexID], 0.0, 1.0);
}
`;

export const AGENT_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform sampler2D uTraits;
uniform vec2 uTrailRes;
uniform float uAgentTexSize;
uniform float uPointSize;
uniform vec3 uView; // x,y=offset, z=scale

flat out vec4 vTraits;
flat out float vEnergy;

void main() {
  int id = gl_VertexID;
  int width = int(uAgentTexSize);
  ivec2 cell = ivec2(id % width, id / width);
  vec4 state = texelFetch(uState, cell, 0);
  vec4 traits = texelFetch(uTraits, cell, 0);

  vec2 uv = state.xy / uTrailRes;
  vec2 viewUV = (uv - uView.xy) / uView.z;
  gl_Position = vec4(viewUV * 2.0 - 1.0, 0.0, 1.0);

  gl_PointSize = uPointSize / uView.z;
  vTraits = traits;
  vEnergy = state.w;
}
`;

export function createShaderSources(preset) {
  const { ecology, phenotype, palette, foodPalette, displayMode } = preset;

  const stepFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform sampler2D uTraits;
uniform sampler2D uTrail;
uniform sampler2D uFood;
uniform vec2 uTrailRes;
uniform float uFrame;

layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outTraits;

const float KIN = ${fixed(ecology.kin)};
const float DRIFT = ${fixed(ecology.drift, 6)};
const float SPLIT = ${fixed(ecology.splitStrength, 6)};
const float RARITY_BOOST = ${fixed(ecology.rarityBoost)};
const float NICHE_SCALE = ${fixed(ecology.nicheScale)};
const float FOOD_WEIGHT = ${fixed(ecology.foodWeight)};
const float HUNT_WEIGHT = ${fixed(ecology.huntWeight)};
const float AVOID_WEIGHT = ${fixed(ecology.avoidWeight)};
const float SYMBIOSIS_WEIGHT = ${fixed(ecology.symbiosisWeight)};
const float MUTATION_MAX = ${fixed(ecology.mutationMax, 6)};
const float MUTATION_MIN = ${fixed(ecology.mutationMin, 6)};
const float CROWD_START = ${fixed(ecology.crowdingStart)};
const float CROWD_END = ${fixed(ecology.crowdingEnd)};

${HASH_GLSL}

float foodMatchScore(float foodType, float preference) {
  return clamp(1.0 - abs(foodType - preference) * 1.8, 0.0, 1.0);
}

vec4 trailSample(vec2 samplePos) {
  return texture(uTrail, samplePos / uTrailRes);
}

vec2 foodSample(vec2 samplePos) {
  return texture(uFood, samplePos / uTrailRes).rg;
}

float trailResponse(vec2 samplePos, vec4 traits) {
  vec4 trail = trailSample(samplePos);
  vec2 food = foodSample(samplePos);

  float intensity = trail.r;
  float avgHue = intensity > 0.0005 ? clamp(trail.g / intensity, 0.0, 1.0) : 0.5;
  float alien = abs(avgHue - traits.x);
  float kinAffinity = max(1.0 - alien * KIN, -0.35);
  float nicheWave = 0.75 + 0.25 * cos((avgHue - traits.x) * 6.28318 * NICHE_SCALE);

  float foodDrive = food.r * foodMatchScore(food.g, traits.y) * mix(0.75, 1.45, traits.y);
  float symbiosis = trail.b * traits.w * max(0.2, kinAffinity + 0.5);
  float avoidance = trail.a * (1.0 - traits.z) * mix(0.45, 1.25, alien);
  float hunting = trail.a * traits.z * alien;

  return intensity * kinAffinity * nicheWave
    + FOOD_WEIGHT * foodDrive
    + SYMBIOSIS_WEIGHT * symbiosis
    + HUNT_WEIGHT * hunting
    - AVOID_WEIGHT * avoidance;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 state = texelFetch(uState, cell, 0);
  vec4 traits = texelFetch(uTraits, cell, 0);

  vec2 pos = state.xy;
  float angle = state.z;
  float energy = state.w;

  float speciesHue = traits.x;
  float foodPreference = traits.y;
  float aggression = traits.z;
  float sociality = traits.w;

  float sensorAngle = mix(${fixed(phenotype.sensorAngle[0])}, ${fixed(phenotype.sensorAngle[1])}, speciesHue);
  float sensorDistance = mix(${fixed(phenotype.sensorDistance[0])}, ${fixed(phenotype.sensorDistance[1])}, foodPreference);
  float turnSpeed = mix(${fixed(phenotype.turnSpeed[0])}, ${fixed(phenotype.turnSpeed[1])}, aggression);
  float baseStepSize = mix(${fixed(phenotype.stepSize[0])}, ${fixed(phenotype.stepSize[1])}, foodPreference);
  float stepSize = baseStepSize * mix(0.45, 1.10, energy);

  vec2 dirForward = vec2(cos(angle), sin(angle));
  vec2 dirLeft = vec2(cos(angle + sensorAngle), sin(angle + sensorAngle));
  vec2 dirRight = vec2(cos(angle - sensorAngle), sin(angle - sensorAngle));

  float senseForward = trailResponse(pos + dirForward * sensorDistance, traits);
  float senseLeft = trailResponse(pos + dirLeft * sensorDistance, traits);
  float senseRight = trailResponse(pos + dirRight * sensorDistance, traits);

  float randomTurn = hash21(gl_FragCoord.xy * 317.7 + fract(uFrame * 0.1731));
  float randomA = hash21b(gl_FragCoord.xy * 419.3 + fract(uFrame * 0.2917));
  float randomB = hash21c(gl_FragCoord.xy * 251.1 + fract(uFrame * 0.1371));
  float randomC = hash21d(gl_FragCoord.xy * 179.1 + fract(uFrame * 0.2217));

  if (senseForward > senseLeft && senseForward > senseRight) {
    angle += (randomTurn - 0.5) * 0.05;
  } else if (senseForward < senseLeft && senseForward < senseRight) {
    angle += randomTurn > 0.5 ? turnSpeed : -turnSpeed;
  } else if (senseLeft > senseRight) {
    angle += turnSpeed;
  } else {
    angle -= turnSpeed;
  }

  pos += vec2(cos(angle), sin(angle)) * stepSize;
  pos = mod(pos + uTrailRes, uTrailRes);

  vec4 localTrail = trailSample(pos);
  vec2 localFood = foodSample(pos);
  float localAvgHue = localTrail.r > 0.0005 ? clamp(localTrail.g / localTrail.r, 0.0, 1.0) : speciesHue;
  float alien = abs(localAvgHue - speciesHue);
  float overcrowding = smoothstep(CROWD_START, CROWD_END, localTrail.r);
  float foodMatch = foodMatchScore(localFood.g, foodPreference);

  float foodGain = localFood.r * foodMatch * mix(0.012, 0.024, foodPreference);
  float huntGain = localTrail.a * aggression * alien * 0.004;
  float socialGain = localTrail.b * sociality * max(0.0, 1.0 - alien * 2.0) * 0.002;
  float cost = 0.003 + stepSize * 0.0014 + aggression * 0.0016;
  energy = clamp(energy + foodGain + huntGain + socialGain - cost, 0.0, 1.0);

  float mutationStrength = mix(MUTATION_MAX, MUTATION_MIN, energy) + MUTATION_MAX * overcrowding;

  speciesHue += (randomA - 0.5) * 2.0 * mutationStrength;
  foodPreference += (randomB - 0.5) * mutationStrength * 0.9;
  aggression += (randomC - 0.5) * mutationStrength * 0.8;
  sociality += (randomTurn - 0.5) * mutationStrength * 0.8;

  if (localTrail.r > 0.004) {
    float kinSimilarity = max(0.0, 1.0 - abs(localAvgHue - speciesHue) * 3.0);
    float branchPush = sign(randomA - 0.5) * overcrowding * (0.45 + alien * RARITY_BOOST) * SPLIT;
    speciesHue += (localAvgHue - speciesHue) * DRIFT * kinSimilarity * energy;
    speciesHue += branchPush;
    sociality += (localTrail.b - sociality) * DRIFT * 0.35;
    aggression += (localTrail.a - aggression) * DRIFT * 0.20;
  }

  speciesHue = fract(speciesHue + 1.0);
  foodPreference = clamp(foodPreference, 0.0, 1.0);
  aggression = clamp(aggression, 0.0, 1.0);
  sociality = clamp(sociality, 0.0, 1.0);

  outState = vec4(pos, angle, energy);
  outTraits = vec4(speciesHue, foodPreference, aggression, sociality);
}
`;

  const depositFragmentShader = `#version 300 es
precision highp float;

flat in vec4 vTraits;
flat in float vEnergy;
out vec4 fragColor;

const float BASE_DEPOSIT = ${fixed(preset.baseDeposit)};

void main() {
  float intensity = BASE_DEPOSIT * mix(0.20, 1.0, vEnergy);
  fragColor = vec4(
    intensity,
    intensity * vTraits.x,
    intensity * vTraits.w,
    intensity * vTraits.z
  );
}
`;

  const diffuseFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uTrail;
uniform vec2 uPixelSize;
uniform float uDecay;
uniform vec3 uMouse;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uPixelSize;
  vec4 sum = vec4(0.0);

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      sum += texture(uTrail, uv + vec2(float(dx), float(dy)) * uPixelSize);
    }
  }

  vec4 result = (sum / 9.0) * uDecay;
  result = min(result, vec4(${fixed(preset.trailCap)}));

  if (uMouse.z > 0.5) {
    float distanceToMouse = length(gl_FragCoord.xy - uMouse.xy);
    float deposit = exp(-(distanceToMouse * distanceToMouse) / 3200.0) * ${fixed(preset.mouseDeposit)};
    float localHue = result.r > 0.001 ? clamp(result.g / result.r, 0.0, 1.0) : 0.5;
    result += vec4(deposit, deposit * localHue, deposit * 0.18, deposit * 0.06);
  }

  fragColor = result;
}
`;

  const spectrum = spectrumGLSL(palette);
  const foodColor = vec3(foodPalette);

  const displayFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uTrail;
uniform sampler2D uFood;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uView; // x,y=offset, z=scale

out vec4 fragColor;

${HASH_GLSL}
${spectrum}

vec3 foodTint(float amount, float typeValue) {
  vec3 nutrient = vec3(${foodColor});
  vec3 accent = spectrum(typeValue);
  return mix(nutrient, accent, 0.25 + amount * 0.30);
}

vec3 renderDark(vec2 screenUV, vec4 trail, vec2 food) {
  float intensity = trail.r;
  float hueValue = intensity > 0.001 ? clamp(trail.g / intensity, 0.0, 1.0) : 0.5;
  vec3 color = spectrum(hueValue) * (1.0 - exp(-intensity * ${fixed(preset.exposure, 1)}));
  color += foodTint(food.r, food.g) * food.r * 0.18;
  vec2 vignette = screenUV * (1.0 - screenUV);
  color *= pow(clamp(vignette.x * vignette.y * 18.0, 0.0, 1.0), 0.35);
  return color;
}

vec3 renderDish(vec2 screenUV, vec4 trail, vec2 food) {
  float intensity = trail.r;
  float hueValue = intensity > 0.001 ? clamp(trail.g / intensity, 0.0, 1.0) : 0.5;
  vec3 agar = vec3(0.987, 0.972, 0.925);
  vec3 nutrient = foodTint(food.r, food.g);
  vec3 colony = spectrum(hueValue);
  float foodGlow = clamp(food.r * 0.90, 0.0, 1.0);
  float colonyAmount = 1.0 - exp(-intensity * ${fixed(preset.exposure, 1)});
  vec3 color = mix(agar, nutrient, foodGlow * 0.52);
  color = mix(color, colony, colonyAmount * 0.84);
  color += colony * pow(colonyAmount, 1.7) * 0.18;
  vec2 center = (screenUV - 0.5) * 2.0;
  center.x *= uResolution.x / uResolution.y;
  float dishEdge = 1.0 - smoothstep(0.88, 0.97, length(center));
  return mix(vec3(0.91, 0.89, 0.82), color, dishEdge);
}

vec3 renderScope(vec2 screenUV, vec4 trail, vec2 food) {
  float intensity = trail.r;
  float hueValue = intensity > 0.001 ? clamp(trail.g / intensity, 0.0, 1.0) : 0.5;
  vec3 base = vec3(0.965, 0.952, 0.915);
  vec3 nutrient = foodTint(food.r, food.g);
  vec3 stain = spectrum(hueValue);
  float amount = 1.0 - exp(-intensity * ${fixed(preset.exposure, 1)});
  vec3 color = mix(base, nutrient, food.r * 0.22);
  color = mix(color, stain, amount * 0.44);
  vec2 centered = (screenUV - 0.5) * 2.0;
  centered.x *= uResolution.x / uResolution.y;
  float eyepiece = 1.0 - smoothstep(0.88, 0.96, length(centered));
  return mix(vec3(0.06), color, eyepiece);
}

void main() {
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  vec2 worldUV = screenUV * uView.z + uView.xy;

  vec4 trail = texture(uTrail, worldUV);
  vec2 food = texture(uFood, worldUV).rg;
  vec3 color;

  if (${displayMode === "dark" ? 1 : 0} == 1) {
    color = renderDark(screenUV, trail, food);
  } else if (${displayMode === "scope" ? 1 : 0} == 1) {
    color = renderScope(screenUV, trail, food);
  } else {
    color = renderDish(screenUV, trail, food);
  }

  float grain = ${displayMode === "dark" ? "0.010" : "0.004"};
  color += (hash(screenUV * 1733.0 + fract(uTime * 1.7)) - 0.5) * grain;
  fragColor = vec4(max(color, 0.0), 1.0);
}
`;

  const agentRenderFragmentShader = `#version 300 es
precision highp float;

flat in vec4 vTraits;
flat in float vEnergy;
out vec4 fragColor;

${spectrum}

void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius = dot(point, point);
  if (radius > 1.0) {
    discard;
  }
  float alpha = smoothstep(1.0, 0.0, radius) * mix(0.15, 0.62, vEnergy);
  fragColor = vec4(spectrum(vTraits.x) * 0.94, alpha);
}
`;

  const foodUpdateFragmentShader = `#version 300 es
precision highp float;

uniform sampler2D uFood;
uniform sampler2D uFoodOriginal;
uniform sampler2D uTrail;
uniform vec2 uPixelSize;

out vec4 fragColor;

const float CONSUME_RATE = ${fixed(preset.food.consumeRate, 6)};
const float REGROW_RATE = ${fixed(preset.food.regrowRate, 6)};

void main() {
  vec2 uv = gl_FragCoord.xy * uPixelSize;
  vec4 current = texture(uFood, uv);
  vec4 original = texture(uFoodOriginal, uv);
  float trailDensity = texture(uTrail, uv).r;

  float consumption = trailDensity * CONSUME_RATE;
  float amount = max(current.r - consumption, 0.0);

  float regrowth = (original.r - amount) * REGROW_RATE;
  amount += max(regrowth, 0.0);
  amount = min(amount, original.r * 1.05);

  fragColor = vec4(amount, original.g, current.b, 1.0);
}
`;

  return {
    stepFragmentShader,
    depositFragmentShader,
    diffuseFragmentShader,
    displayFragmentShader,
    agentRenderFragmentShader,
    foodUpdateFragmentShader,
  };
}
