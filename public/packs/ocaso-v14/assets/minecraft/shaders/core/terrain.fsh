#version 330
#extension GL_ARB_separate_shader_objects : require

#include <minecraft:fog.glsl>
#include <minecraft:globals.glsl>
#include <minecraft:texture_sampling.glsl>
#include <minecraft:oit.glsl>
#include <minecraft:terrainglobals.glsl>
#ifndef MULTIDRAW_TERRAIN
    #include <minecraft:chunksection.glsl>
#endif

uniform sampler2D Sampler0;

layout(location = 0) in float sphericalVertexDistance;
layout(location = 1) in float cylindricalVertexDistance;
layout(location = 2) in vec4 vertexColor;
layout(location = 3) in vec2 texCoord0;
layout(location = 4) in float chunkVisibility;
layout(location = 5) in float grayAmount;
layout(location = 6) in float ringAmount;
layout(location = 7) in float tripAmount;

#ifndef OIT_ALPHA_ONLY
layout(location = 0) out vec4 fragColor;
#endif

vec4 calculateFinalColor(vec4 color) {
    #ifdef OIT_ACCUMULATE
    color = sampleColorForAccumulation(color);
    vec4 fogColor = vec4(FogColor.rgb * color.a, FogColor.a);
    #else
    vec4 fogColor = FogColor;
    #endif
    return apply_fog(color, sphericalVertexDistance, cylindricalVertexDistance, FogEnvironmentalStart, FogEnvironmentalEnd, FogRenderDistanceStart, FogRenderDistanceEnd, fogColor);
}

void main() {
    vec4 color = (UseRgss == 1 ? sampleRGSS(Sampler0, texCoord0, 1.0f / TextureSize) : sampleNearest(Sampler0, texCoord0, 1.0f / TextureSize)) * vertexColor;
    #ifndef OIT_ALPHA_ONLY
    // Ocaso: mushroom trip — colours rotate in slow waves across the screen
    if (tripAmount > 0.01) {
        float t = GameTime * 1200.0; // seconds
        vec2 sp = gl_FragCoord.xy / ScreenSize;
        float ang = t * 0.8 + sin(sp.y * 9.0 + t * 1.7) * 1.2 + sin(sp.x * 7.0 - t * 1.3) * 0.8;
        float Y = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float I = dot(color.rgb, vec3(0.596, -0.274, -0.322));
        float Q = dot(color.rgb, vec3(0.211, -0.523, 0.312));
        float cs = cos(ang), sn = sin(ang);
        float I2 = (I * cs - Q * sn) * 1.8, Q2 = (I * sn + Q * cs) * 1.8;
        vec3 trip = vec3(Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2);
        color.rgb = mix(color.rgb, clamp(trip, 0.0, 1.0), tripAmount);
    }
    // Ocaso: fade to grey away from light
    float ocasoLuma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(color.rgb, vec3(ocasoLuma), clamp(grayAmount, 0.0, 1.0) * (1.0 - tripAmount));
    #endif
    #ifndef OIT_ALPHA_ONLY
    color = mix(FogColor * vec4(1, 1, 1, color.a), color, chunkVisibility);
    #endif
    #ifdef ALPHA_CUTOUT
    if (color.a < ALPHA_CUTOUT) {
        discard;
    }
    #endif

    #ifdef OIT_ALPHA_ONLY
    executeAlphaOnlyPhase(gl_FragCoord.z, color.a);
    #else
    fragColor = calculateFinalColor(color);
    // Ocaso: dark ring that closes in as sanity drops (same signal as the grey)
    if (ringAmount > 0.01) {
        vec2 ocasoUv = gl_FragCoord.xy / ScreenSize - 0.5;
        ocasoUv.x *= ScreenSize.x / ScreenSize.y;
        float inner = mix(0.75, 0.18, ringAmount);
        float ring = smoothstep(inner, inner + 0.5, length(ocasoUv));
        fragColor.rgb *= 1.0 - ring * mix(0.35, 0.96, ringAmount);
    }
    #endif
}
